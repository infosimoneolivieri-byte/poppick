/* Stasera: gusti, ruota, importazione, backup e serie in corso. Solo logica, senza rete né schermo. */
(function (root) {
  'use strict';
  const Engine = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  /* ---------- Gusti ---------- */
  const MIN_RATINGS = 5;
  const W = { g: 1.5, k: 1, c: 0.7, d: 2, y: 0.4 };

  /** Le caratteristiche di un titolo che servono a imparare i gusti. */
  function featuresOf(it) {
    return {
      g: (it.genreIds || []).slice(0, 6),
      k: (it.keywordList || []).slice(0, 12).map((k) => [k.id, k.name]),
      c: (it.cast || []).slice(0, 5),
      d: (it.directors || []).slice(0, 3),
      y: it.year ? Math.floor(it.year / 10) * 10 : null,
    };
  }
  function featureList(f) {
    const out = [];
    const genreLabel = (id) => { const g = Engine.GENRES.find((x) => x.m === id || x.t === id); return g ? g.n : null; };
    (f.g || []).forEach((id) => out.push(['g' + id, W.g, genreLabel(id)]));
    (f.k || []).forEach(([id, name]) => out.push(['k' + id, W.k, name]));
    (f.c || []).forEach((n) => out.push(['p' + n, W.c, n]));
    (f.d || []).forEach((n) => out.push(['p' + n, W.d, n]));
    if (f.y) out.push(['y' + f.y, W.y, 'anni ' + f.y]);
    return out;
  }

  /** Riassume i voti di un profilo: quanto ogni caratteristica sposta il voto rispetto alla sua media. */
  function buildProfile(ratings, pid) {
    const rated = Object.values(ratings || {}).filter((e) => e.r && e.r[pid] != null && e.f);
    if (rated.length < MIN_RATINGS) return { count: rated.length, ready: false };
    const mean = rated.reduce((a, e) => a + e.r[pid], 0) / rated.length;
    const map = {};
    rated.forEach((e) => {
      const delta = e.r[pid] - mean;
      featureList(e.f).forEach(([key, w, label]) => {
        const m = map[key] || (map[key] = { sum: 0, n: 0, label });
        m.sum += delta * w;
        m.n += w;
      });
    });
    Object.values(map).forEach((m) => { m.v = m.sum / (m.n + 2); });
    return { count: rated.length, ready: true, mean, map };
  }

  /** Quanto dovrebbe piacere un titolo a un profilo, da 0 a 100, e per quali motivi. */
  function predict(profile, it) {
    if (!profile || !profile.ready) return null;
    const list = featureList(featuresOf(it));
    let total = 0;
    let weight = 0;
    const seen = new Set();
    const hits = [];
    list.forEach(([key, w, label]) => {
      if (seen.has(key)) return;
      seen.add(key);
      weight += w;
      const m = profile.map[key];
      if (!m) return;
      total += m.v * w;
      if (label) hits.push({ label, v: m.v });
    });
    const shift = weight ? Math.max(-2, Math.min(2, (total / Math.sqrt(weight)) * 1.4)) : 0;
    const score = Math.max(0, Math.min(100, ((profile.mean + shift - 1) / 4) * 100));
    hits.sort((a, b) => b.v - a.v);
    return {
      score: Math.round(score),
      likes: hits.filter((h) => h.v > 0.05).slice(0, 2).map((h) => h.label),
      dislikes: hits.filter((h) => h.v < -0.05).slice(-1).map((h) => h.label),
    };
  }

  /** Per due persone conta soprattutto chi è meno convinto: così vince ciò che va bene a entrambi. */
  function combineTaste(scores) {
    const vals = scores.filter((v) => v != null);
    if (!vals.length) return null;
    const low = Math.min(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.round(low * 0.6 + avg * 0.4);
  }

  /* ---------- Ruota ---------- */
  /** Spicchi proporzionali al punteggio: chi è più adatto ha più probabilità, e si vede. */
  function wheelSlices(items, size) {
    const top = items.slice(0, size || 8);
    if (!top.length) return [];
    const min = Math.min(...top.map((i) => i.match || 0));
    const raw = top.map((i) => Math.pow((i.match || 0) - min + 15, 1.5));
    const total = raw.reduce((a, b) => a + b, 0);
    const floored = raw.map((v) => Math.max(v / total, 0.05));
    const sum = floored.reduce((a, b) => a + b, 0);
    let start = 0;
    return top.map((item, i) => {
      const frac = floored[i] / sum;
      const slice = { item, start, frac, end: start + frac, mid: start + frac / 2 };
      start += frac;
      return slice;
    });
  }
  function pickSlice(slices, r) {
    const idx = slices.findIndex((s) => r < s.end);
    return idx < 0 ? slices.length - 1 : idx;
  }
  /** Rotazione finale: l'indicatore è in alto e il punto d'arrivo cade dentro lo spicchio. */
  function spinDegrees(slice, r, turns) {
    const pos = slice.start + slice.frac * (0.1 + 0.8 * r);
    return 360 * (turns || 6) + (360 - pos * 360);
  }
  function landedIndex(slices, degrees) {
    const norm = ((360 - (degrees % 360)) % 360) / 360;
    return pickSlice(slices, norm);
  }
  /** La serata dura fino alle 6 del mattino dopo. */
  function nightId(now) {
    const d = new Date((now || new Date()).getTime() - 6 * 3600 * 1000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- Importazione ---------- */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const src = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && src[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((x) => x !== '')) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x !== '')) rows.push(row);
    return rows;
  }

  const TV_MARK = /:\s*(stagione|season|serie|series|episodio|episode|miniserie|limited series|volume|parte|part)\b/i;
  function netflixTitle(raw) {
    const m = raw.match(TV_MARK);
    return m ? { title: raw.slice(0, m.index).trim(), kind: 'tv' } : { title: raw.trim(), kind: null };
  }

  /** Riconosce file di Netflix, Letterboxd e IMDb dall'intestazione. */
  function parseHistory(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { source: null, rows: [] };
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (n) => head.indexOf(n);
    const body = rows.slice(1);
    const dedupe = (list) => {
      const seen = new Map();
      list.forEach((r) => {
        const k = (r.imdb || r.title.toLowerCase() + '|' + (r.year || '')) + '';
        if (r.title || r.imdb) { if (!seen.has(k) || r.rating != null) seen.set(k, r); }
      });
      return [...seen.values()];
    };
    if (col('const') >= 0 && col('your rating') >= 0) {
      const type = col('title type');
      const out = [];
      body.forEach((r) => {
        const t = (r[type] || '').toLowerCase();
        if (t.includes('episode')) return;
        const rating = parseFloat(r[col('your rating')]);
        out.push({
          imdb: r[col('const')], title: r[col('title')] || '', year: parseInt(r[col('year')], 10) || null,
          kind: /tv|series/.test(t) ? 'tv' : 'movie',
          rating: Number.isFinite(rating) ? Math.max(1, Math.min(5, Math.round(rating / 2))) : null,
        });
      });
      return { source: 'IMDb', rows: dedupe(out) };
    }
    if (col('letterboxd uri') >= 0 && col('name') >= 0) {
      const rc = col('rating');
      const out = body.map((r) => {
        const rating = rc >= 0 ? parseFloat(r[rc]) : NaN;
        return {
          title: r[col('name')] || '', year: parseInt(r[col('year')], 10) || null, kind: 'movie',
          rating: Number.isFinite(rating) ? Math.max(1, Math.min(5, Math.round(rating))) : null,
        };
      });
      return { source: 'Letterboxd', rows: dedupe(out) };
    }
    if (col('title') >= 0 && col('date') >= 0 && head.length <= 3) {
      const out = body.map((r) => {
        const t = netflixTitle(r[col('title')] || '');
        return { title: t.title, year: null, kind: t.kind, rating: null };
      });
      return { source: 'Netflix', rows: dedupe(out) };
    }
    return { source: null, rows: [] };
  }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  /** Sceglie il risultato di ricerca giusto; meglio nessuno che uno sbagliato. */
  function matchSearch(results, row) {
    const want = norm(row.title);
    const titles = (r) => [r.title, r.name, r.original_title, r.original_name].map(norm);
    const yearOf = (r) => parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10);
    const exact = (results || []).filter((r) => titles(r).includes(want) && (r.media_type == null || r.media_type === 'movie' || r.media_type === 'tv'));
    if (!exact.length) return null;
    if (row.year) {
      const close = exact.find((r) => Math.abs(yearOf(r) - row.year) <= 1);
      if (close) return close;
      return null;
    }
    return exact[0];
  }

  /* ---------- Serie in corso ---------- */
  /** Passa all'episodio dopo; a fine stagione va alla successiva. */
  function advanceEpisode(t) {
    const counts = t.seasonCounts || {};
    const inSeason = counts[t.season];
    if (inSeason && t.episode >= inSeason) {
      if (counts[t.season + 1]) return { season: t.season + 1, episode: 1 };
      return { season: t.season, episode: t.episode + 1, finished: true };
    }
    return { season: t.season, episode: t.episode + 1 };
  }
  /** Confronta dove siete con l'ultimo episodio uscito. */
  function seriesStatus(t) {
    const last = t.lastAired;
    if (!last) return { available: true, newSeason: false, caughtUp: false };
    const after = t.season > last.season || (t.season === last.season && t.episode > last.episode);
    return {
      available: !after,
      newSeason: !after && t.episode === 1 && !!t.seenSeason && t.season > t.seenSeason,
      caughtUp: after,
    };
  }
  /** Quando esce la stagione nuova, chi aveva finito riparte dal suo primo episodio. */
  function normalizeTracked(t) {
    if (t.finished && t.seasonCounts && t.seasonCounts[t.season + 1]) {
      return Object.assign({}, t, { season: t.season + 1, episode: 1, finished: false });
    }
    return t;
  }

  /* ---------- Backup ---------- */
  const BACKUP_KEYS = ['seen', 'hidden', 'watchlist', 'saved', 'ratings', 'tracked', 'profiles', 'filters', 'prefs'];

  function byKeyUnion(a, b) {
    const m = new Map();
    (a || []).concat(b || []).forEach((x) => { if (x && x.key && !m.has(x.key)) m.set(x.key, x); });
    return [...m.values()];
  }
  function mergeRatings(a, b) {
    const out = Object.assign({}, a || {});
    Object.entries(b || {}).forEach(([key, e]) => {
      const cur = out[key];
      if (!cur) { out[key] = e; return; }
      const newer = (e.t || 0) >= (cur.t || 0);
      out[key] = Object.assign({}, cur, e.f && !cur.f ? { f: e.f } : {}, {
        r: newer ? Object.assign({}, cur.r, e.r) : Object.assign({}, e.r, cur.r),
        w: Object.assign({}, cur.w, e.w),
        t: Math.max(e.t || 0, cur.t || 0),
      });
    });
    return out;
  }
  function mergeTracked(a, b) {
    const m = new Map();
    (a || []).concat(b || []).forEach((t) => {
      const cur = m.get(t.key);
      const further = !cur || t.season > cur.season || (t.season === cur.season && t.episode > cur.episode);
      if (further) m.set(t.key, t);
    });
    return [...m.values()];
  }
  /** Unisce due backup senza perdere nulla; profili, filtri e preferenze restano quelli del telefono. */
  function mergeBackup(local, incoming) {
    const saved = [...(local.saved || [])];
    (incoming.saved || []).forEach((s) => { if (!saved.some((x) => x.name === s.name)) saved.push(s); });
    return {
      seen: byKeyUnion(local.seen, incoming.seen),
      hidden: byKeyUnion(local.hidden, incoming.hidden),
      watchlist: byKeyUnion(local.watchlist, incoming.watchlist),
      saved,
      ratings: mergeRatings(local.ratings, incoming.ratings),
      tracked: mergeTracked(local.tracked, incoming.tracked),
      profiles: local.profiles || incoming.profiles,
    };
  }
  function validBackup(o) {
    return !!o && o.app === 'stasera' && typeof o.data === 'object' && o.data !== null;
  }

  /* ---------- Sincronizzazione ---------- */
  const SYNC_PARTS = {
    lists: ['seen', 'hidden', 'watchlist', 'saved', 'tracked', 'profiles', 'prefs', 'wheelLock', 'wheelCtx'],
    ratings: ['ratings'],
    keys: ['keys'],
  };
  const SYNC_KEYS = Object.values(SYNC_PARTS).reduce((a, b) => a.concat(b), []);
  const SHARED_PREFS = ['jolly', 'hidePlot'];

  /** JSON con le chiavi sempre nello stesso ordine, per confrontare due stati. */
  function stable(v) {
    if (v === undefined) return undefined;
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : stable(x))).join(',') + ']';
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  const same = (a, b) => stable(a) === stable(b);

  /** Un elemento aggiunto, cambiato o tolto su un telefono resta tale; ciò che non è stato toccato segue l'altro. */
  function mergeKeyed(base, local, remote, id) {
    const toMap = (list) => new Map((list || []).map((x) => [x[id], x]));
    const b = toMap(base);
    const l = toMap(local);
    const r = toMap(remote);
    const added = (local || []).filter((x) => !b.has(x[id]) && !r.has(x[id]));
    const rest = [];
    (remote || []).forEach((x) => {
      const k = x[id];
      if (b.has(k) && !l.has(k)) return; // tolto qui
      if (l.has(k) && !same(l.get(k), b.get(k))) rest.push(l.get(k)); // cambiato qui
      else rest.push(x);
    });
    return added.concat(rest);
  }
  function mergeRatings3(base, local, remote) {
    const out = {};
    const b = base || {};
    const l = local || {};
    const r = remote || {};
    new Set(Object.keys(l).concat(Object.keys(r))).forEach((key) => {
      const be = b[key];
      const le = l[key];
      const re = r[key];
      if (!re) { out[key] = le; return; }
      if (!le) { out[key] = re; return; }
      const pids = new Set([].concat(
        Object.keys(le.r || {}), Object.keys(le.w || {}), Object.keys(re.r || {}), Object.keys(re.w || {}),
        be ? Object.keys(be.r || {}) : [], be ? Object.keys(be.w || {}) : [],
      ));
      const merged = Object.assign({}, re, le, { r: {}, w: {}, f: le.f || re.f });
      if (le.t || re.t) merged.t = Math.max(le.t || 0, re.t || 0);
      pids.forEach((p) => {
        const get = (e, f) => (e && e[f] ? e[f][p] : undefined);
        const changedHere = get(le, 'r') !== get(be, 'r') || get(le, 'w') !== get(be, 'w');
        const src = changedHere ? le : re;
        if (get(src, 'r') != null) merged.r[p] = get(src, 'r');
        if (get(src, 'w')) merged.w[p] = get(src, 'w');
      });
      if (merged.f === undefined) delete merged.f;
      out[key] = merged;
    });
    return out;
  }
  function mergeScalar(base, local, remote, first) {
    if (remote === undefined) return local;
    if (first) return remote;
    return same(local, base) ? remote : local;
  }
  /** Campo per campo; al primo accesso vince ciò che è già sull'account, se presente. */
  function mergeFields(base, local, remote, fields, first) {
    const out = Object.assign({}, local || {});
    const b = base || {};
    const r = remote || {};
    fields.forEach((f) => {
      const empty = (v) => v === undefined || v === '' || v === null;
      if (empty(r[f]) && first) return;
      const v = first ? r[f] : same(out[f], b[f]) ? r[f] : out[f];
      if (v === undefined) delete out[f]; else out[f] = v;
    });
    return out;
  }
  /** Unione a tre: ultimo stato comune, questo telefono, cloud. */
  function threeWay(base, local, remote) {
    const first = !base;
    const b = base || {};
    const out = {};
    [['seen', 'key'], ['hidden', 'key'], ['watchlist', 'key'], ['tracked', 'key'], ['saved', 'name']].forEach(([k, id]) => {
      if (local[k] !== undefined || remote[k] !== undefined) out[k] = mergeKeyed(b[k], local[k], remote[k], id);
    });
    if (local.ratings !== undefined || remote.ratings !== undefined) out.ratings = mergeRatings3(b.ratings, local.ratings, remote.ratings);
    ['profiles', 'wheelLock', 'wheelCtx'].forEach((k) => {
      const v = mergeScalar(b[k], local[k], remote[k], first);
      if (v !== undefined) out[k] = v;
    });
    if (local.prefs !== undefined || remote.prefs !== undefined) out.prefs = mergeFields(b.prefs, local.prefs, remote.prefs, SHARED_PREFS, first);
    if (local.keys !== undefined || remote.keys !== undefined) out.keys = mergeFields(b.keys, local.keys, remote.keys, ['tmdb', 'omdb', 'claude'], first);
    return out;
  }

  const api = {
    SYNC_PARTS, SYNC_KEYS, stable, threeWay,
    MIN_RATINGS, featuresOf, buildProfile, predict, combineTaste,
    wheelSlices, pickSlice, spinDegrees, landedIndex, nightId,
    parseCsv, parseHistory, matchSearch, advanceEpisode, seriesStatus, normalizeTracked,
    BACKUP_KEYS, mergeBackup, validBackup,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Extras = api;
})(typeof window !== 'undefined' ? window : globalThis);
