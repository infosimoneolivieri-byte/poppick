/* Stasera: rete (TMDB, OMDb, Claude) e flusso di ricerca. */
(function (root) {
  'use strict';
  const E = root.Engine;
  const X = root.Extras;
  const TMDB = 'https://api.themoviedb.org/3';
  const OMDB = 'https://www.omdbapi.com/';
  const CLAUDE = 'https://api.anthropic.com/v1/messages';
  const CLAUDE_MODEL = 'claude-haiku-5-5';

  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem('stasera.' + k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem('stasera.' + k, JSON.stringify(v)); } catch (e) { /* memoria piena: l'app continua */ }
      if (store.onSet) store.onSet(k);
    },
    remove(k) {
      try { localStorage.removeItem('stasera.' + k); } catch (e) { /* nulla da togliere */ }
    },
  };

  // Nell'APK le richieste passano dal lato Android, così non dipendono dalle regole del browser.
  const pending = new Map();
  let nextId = 1;
  root.__httpDone = function (id, status, b64) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (status < 0) { p.reject(new Error('network')); return; }
    const bytes = Uint8Array.from(atob(b64 || ''), (c) => c.charCodeAt(0));
    p.resolve({ status, text: new TextDecoder().decode(bytes) });
  };
  function http(method, url, headers, body) {
    if (root.Android && root.Android.http) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        root.Android.http(id, method, url, JSON.stringify(headers || {}), body || '');
      });
    }
    return fetch(url, { method, headers: headers || {}, body: body || undefined })
      .then((r) => r.text().then((text) => ({ status: r.status, text })));
  }

  class UserError extends Error {}

  const storedKeys = () => store.get('keys', { tmdb: '', omdb: '', claude: '' });
  function sharedTmdb() {
    try {
      const v = root.POPPICK_SHARED && root.POPPICK_SHARED.tmdb;
      return v ? atob(v).split('').reverse().join('') : '';
    } catch (e) { return ''; }
  }
  const hasSharedTmdb = () => !!sharedTmdb();
  // La chiave personale, se c'è, ha la precedenza su quella inclusa.
  const keys = () => { const k = storedKeys(); return Object.assign({}, k, { tmdb: (k.tmdb || '').trim() || sharedTmdb() }); };

  async function tmdb(path, params, keyOverride) {
    const key = (keyOverride != null ? keyOverride : keys().tmdb || '').trim();
    if (!key) throw new UserError('Inserisci la chiave TMDB nelle impostazioni per iniziare a cercare.');
    const q = new URLSearchParams(params || {});
    const headers = { Accept: 'application/json' };
    // TMDB offre due tipi di chiave: il token lungo va nell'intestazione, quella corta nell'indirizzo.
    if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
    else q.set('api_key', key);
    const url = TMDB + path + '?' + q.toString();
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await http('GET', url, headers);
      } catch (e) {
        throw new UserError('TMDB non risponde. Controlla la connessione e riprova.');
      }
      if (res.status !== 429) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (res.status === 401) throw new UserError('TMDB ha rifiutato la chiave. Controllala nelle impostazioni.');
    if (res.status === 404) return null;
    if (res.status >= 400) throw new UserError('TMDB ha risposto con un errore (' + res.status + '). Riprova tra poco.');
    return JSON.parse(res.text);
  }

  /** Esegue fn su ogni elemento con al massimo n richieste insieme. */
  async function pool(list, n, fn) {
    let i = 0;
    const out = new Array(list.length);
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) {
        const idx = i++;
        out[idx] = await fn(list[idx], idx);
      }
    }));
    return out;
  }

  const detailCache = new Map();
  async function details(item) {
    if (detailCache.has(item.key)) return E.mergeDetails(item, detailCache.get(item.key));
    const append = 'credits,external_ids,videos,keywords,watch/providers,' + (item.kind === 'movie' ? 'release_dates' : 'content_ratings');
    const d = await tmdb('/' + item.kind + '/' + item.id, { language: 'it-IT', append_to_response: append, include_video_language: 'it,en' });
    if (!d) return item;
    detailCache.set(item.key, d);
    return E.mergeDetails(item, d);
  }

  const OMDB_TTL = 14 * 24 * 3600 * 1000;
  let omdbCache = null;
  function omdbStore() {
    if (!omdbCache) omdbCache = store.get('omdb', {});
    return omdbCache;
  }
  async function omdbLookup(imdbId, state) {
    const cache = omdbStore();
    const hit = cache[imdbId];
    if (hit && Date.now() - hit.at < OMDB_TTL) return hit.v;
    if (state.stop) return null;
    const key = (keys().omdb || '').trim();
    let res;
    try {
      res = await http('GET', OMDB + '?i=' + encodeURIComponent(imdbId) + '&apikey=' + encodeURIComponent(key));
    } catch (e) { state.stop = 'network'; return null; }
    let body = null;
    try { body = JSON.parse(res.text); } catch (e) { /* risposta non valida */ }
    const err = (body && body.Error) || '';
    if (res.status === 401 || /invalid api key/i.test(err)) { state.stop = 'key'; return null; }
    if (/limit/i.test(err)) { state.stop = 'limit'; return null; }
    const v = E.parseOmdb(body);
    cache[imdbId] = { at: Date.now(), v };
    return v;
  }

  const ENRICH_LIMIT = 36;

  function profilesOf() {
    return store.get('profiles', [{ id: 'p1', name: 'Io' }, { id: 'p2', name: 'Lei' }]);
  }
  function viewersOf(profiles) {
    const v = store.get('viewers', 'both');
    const only = profiles.filter((p) => p.id === v);
    return only.length ? only : profiles;
  }
  /** Previsione per chi guarda stasera, e chi tra loro ha già visto il titolo. */
  function tasteFor(it, viewers, ratings) {
    const predictions = viewers.map((p) => ({ p, pred: X.predict(X.buildProfile(ratings, p.id), it) }));
    const ready = predictions.filter((x) => x.pred);
    const entry = ratings[it.key];
    const seenBy = entry ? viewers.filter((p) => entry.w && entry.w[p.id]).map((p) => p.name) : [];
    if (!ready.length) return { taste: null, tasteBy: [], seenBy };
    const best = ready.map((x) => x.pred.likes).reduce((a, b) => a.concat(b), []);
    return {
      taste: X.combineTaste(ready.map((x) => x.pred.score)),
      tasteBy: ready.map((x) => ({ name: x.p.name, score: x.pred.score })),
      tasteNote: best.length ? 'Vi piace di solito: ' + [...new Set(best)].slice(0, 3).join(', ') + '.' : '',
      seenBy,
    };
  }

  /** Trova gli id delle etichette TMDB, con il nome esatto, e li ricorda sul telefono. */
  async function resolveTerms(terms) {
    const cache = store.get('kwmap', {});
    const missing = terms.filter((t) => !cache[t]);
    await pool(missing, 5, async (term) => {
      const d = await tmdb('/search/keyword', { query: term });
      const hit = ((d && d.results) || []).find((k) => (k.name || '').toLowerCase() === term.toLowerCase());
      if (hit) cache[term] = hit.id;
    });
    if (missing.length) store.set('kwmap', cache);
    return cache;
  }

  async function search(f, onProgress, opts) {
    const seed = opts && opts.seed;
    const progress = onProgress || (() => {});
    const kwMap = await resolveTerms(E.neededTerms(f));
    const { kinds, notes } = E.planKinds(f, kwMap);
    const seenList = store.get('seen', []);
    const seen = new Set(seenList.map((x) => x.key));
    const hidden = new Set(store.get('hidden', []).map((x) => x.key));
    const ratings = store.get('ratings', {});
    const profiles = profilesOf();
    const viewers = viewersOf(profiles);
    // Visto da tutti quelli che guardano stasera: non si ripropone.
    Object.entries(ratings).forEach(([key, e]) => {
      if (viewers.every((p) => e.w && e.w[p.id])) seen.add(key);
    });
    const tracked = new Set(store.get('tracked', []).map((t) => t.key));
    const available = E.availableMinutes(f, new Date());
    const movieFilters = available ? Object.assign({}, f, { runtimeMax: Math.min(f.runtimeMax || Infinity, available) }) : f;
    const found = new Map();

    if (seed) {
      progress('Cerco titoli simili a ' + seed.title);
      const paths = [['recommendations', '1'], ['recommendations', '2'], ['similar', '1'], ['similar', '2']];
      await pool(paths, 4, async ([what, page]) => {
        const d = await tmdb('/' + seed.kind + '/' + seed.id + '/' + what, { language: 'it-IT', page });
        ((d && d.results) || []).forEach((r) => {
          const it = E.normalizeRow(r, seed.kind);
          if (it.key !== seed.key && !found.has(it.key) && E.matchesBasics(it, f)) found.set(it.key, it);
        });
      });
    }

    progress(seed ? 'Controllo i titoli simili' : 'Cerco tra i titoli che rispettano i vostri filtri');
    const jobs = [];
    if (!seed) kinds.forEach((kind) => {
      if (kind === 'tv' && f.people.length) return;
      const { specs } = E.buildSpecs(f, kind, kwMap);
      specs.forEach((spec) => E.planPools(f).forEach((p) => {
        // Con più combinazioni bastano meno pagine per ciascuna.
        const pages = specs.length > 1 ? 1 : p.pages;
        for (let page = 1; page <= pages; page++) {
          jobs.push({ kind, params: E.buildDiscover(kind === 'movie' ? movieFilters : f, kind, E.poolSort(p.sort, kind), page, spec) });
        }
      }));
    });
    await pool(jobs, 6, async (job) => {
      const data = await tmdb('/discover/' + job.kind, job.params);
      ((data && data.results) || []).forEach((r) => {
        const it = E.normalizeRow(r, job.kind);
        if (!found.has(it.key)) found.set(it.key, it);
      });
    });

    if (!seed && kinds.includes('tv') && f.people.length) {
      const lists = await pool(f.people, 4, (p) => tmdb('/person/' + p.id + '/tv_credits', { language: 'it-IT' }).then((d) => d || {}));
      E.filterTvCredits(lists, f).forEach((r) => {
        const it = E.normalizeRow(r, 'tv');
        if (!found.has(it.key)) found.set(it.key, it);
      });
    }

    const all = [...found.values()];
    const unseen = all.filter((i) => !seen.has(i.key) && !hidden.has(i.key));
    const queue = E.rank(unseen, f.weights);
    const ctx = { kwMap, viewers, ratings, seen, tracked, available, queue: queue.slice(ENRICH_LIMIT), kept: [], funnel: {} };

    const short = queue.slice(0, ENRICH_LIMIT);
    progress('Controllo piattaforme e cast di ' + short.length + ' titoli');
    await enrichInto(ctx, short, f, notes, progress);
    const removed = all.length - unseen.length;
    if (removed) ctx.funnel.seen = (ctx.funnel.seen || 0) + removed;
    const ranked = E.rank(ctx.kept, f.weights);
    return {
      items: ranked, funnel: ctx.funnel, notes, examined: all.length, ctx,
      seed: seed ? { key: seed.key, title: seed.title } : null,
      hints: ranked.length ? [] : E.relaxHints(ctx.funnel, f),
    };
  }

  /** Dettagli, gusti, voti OMDb e filtri finali per un gruppo di titoli. */
  async function enrichInto(ctx, list, f, notes, progress) {
    let detailed = await pool(list, 6, details);
    detailed = detailed.map((it) => {
      const { hits, possible } = E.styleHits(it, f, ctx.kwMap);
      return Object.assign({}, it, {
        styleHits: hits, stylePossible: possible,
        styleBonus: (f.genreMode === 'any' && hits.length > 1 ? (hits.length - 1) * 5 : 0)
          + (f.beyondSubs && (E.accessOf(it, f) || {}).kind === 'mine' ? 8 : 0),
      }, tasteFor(it, ctx.viewers, ctx.ratings));
    });
    const omdbKey = (keys().omdb || '').trim();
    if (omdbKey) {
      if (progress) progress('Confronto i voti della critica');
      const state = { stop: null };
      detailed = await pool(detailed, 5, async (it) => {
        if (!it.imdbId) return it;
        const v = await omdbLookup(it.imdbId, state);
        return v ? Object.assign({}, it, v) : it;
      });
      store.set('omdb', omdbStore());
      const add = (n) => { if (!notes.includes(n)) notes.push(n); };
      if (state.stop === 'key') add('OMDb ha rifiutato la chiave: la classifica non usa IMDb e critica. Controllala nelle impostazioni.');
      if (state.stop === 'limit') add('Avete esaurito le richieste OMDb di oggi: alcuni titoli non hanno i voti di IMDb e critica.');
      if (state.stop === 'network') add('OMDb non risponde: alcuni titoli non hanno i voti di IMDb e critica.');
    } else if (f.minCritic && !notes.some((n) => n.startsWith('Il minimo della critica'))) {
      notes.push('Il minimo della critica richiede la chiave OMDb: aggiungila nelle impostazioni.');
    }
    const { kept, funnel } = E.finalFilter(detailed, f, { seen: ctx.seen, tracked: ctx.tracked, available: ctx.available });
    Object.entries(funnel).forEach(([k, n]) => { ctx.funnel[k] = (ctx.funnel[k] || 0) + n; });
    ctx.kept = ctx.kept.concat(kept);
  }

  /** Continua la stessa ricerca con i titoli successivi in classifica. */
  async function more(result, f) {
    const ctx = result.ctx;
    const drop = new Set(store.get('seen', []).concat(store.get('hidden', [])).map((x) => x.key));
    let added = 0;
    while (ctx.queue.length && added < 10) {
      const before = ctx.kept.length;
      const batch = ctx.queue.splice(0, 24);
      await enrichInto(ctx, batch, f, result.notes);
      added += ctx.kept.length - before;
    }
    ctx.kept = ctx.kept.filter((x) => !drop.has(x.key));
    result.items = E.rank(ctx.kept, f.weights);
    return added;
  }

  /** Cerca un film o una serie per nome. */
  async function searchTitles(q) {
    const d = await tmdb('/search/multi', { query: q, language: 'it-IT', include_adult: 'false' });
    return ((d && d.results) || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 8)
      .map((r) => E.normalizeRow(r, r.media_type));
  }

  /** Carica un singolo titolo, per esempio dalle liste o dai titoli simili. */
  async function loadTitle(ref, f) {
    let it = ref;
    if (!it.providers) {
      it = await details(it);
      if ((keys().omdb || '').trim() && it.imdbId) {
        const v = await omdbLookup(it.imdbId, {});
        if (v) it = Object.assign({}, it, v);
        store.set('omdb', omdbStore());
      }
    }
    return it;
  }

  async function similar(item) {
    const d = await tmdb('/' + item.kind + '/' + item.id + '/recommendations', { language: 'it-IT', page: '1' });
    return ((d && d.results) || []).slice(0, 10).map((r) => E.normalizeRow(r, item.kind));
  }

  async function providersIT() {
    const [m, t] = await Promise.all([
      tmdb('/watch/providers/movie', { language: 'it-IT', watch_region: 'IT' }),
      tmdb('/watch/providers/tv', { language: 'it-IT', watch_region: 'IT' }),
    ]);
    const map = new Map();
    [(m && m.results) || [], (t && t.results) || []].forEach((list) => list.forEach((p) => {
      if (!map.has(p.provider_id)) {
        map.set(p.provider_id, { id: p.provider_id, name: p.provider_name, logo: p.logo_path, order: (p.display_priorities && p.display_priorities.IT) ?? p.display_priority ?? 999 });
      }
    }));
    return [...map.values()]
      .filter((p) => !/with ads|amazon channel|apple tv channel|roku/i.test(p.name))
      .sort((a, b) => a.order - b.order);
  }

  async function searchPeople(q) {
    const d = await tmdb('/search/person', { query: q, language: 'it-IT', include_adult: 'false' });
    return ((d && d.results) || []).slice(0, 6).map((p) => ({ id: p.id, name: p.name, photo: p.profile_path, dept: p.known_for_department }));
  }
  async function searchKeywords(q) {
    const d = await tmdb('/search/keyword', { query: q });
    return ((d && d.results) || []).slice(0, 8).map((k) => ({ id: k.id, name: k.name }));
  }

  /** Trasforma una frase in filtri con Claude, poi trova su TMDB persone e temi citati. */
  async function interpret(text) {
    const key = (keys().claude || '').trim();
    if (!key) throw new UserError('Aggiungi la chiave Claude nelle impostazioni per descrivere a parole cosa cercate.');
    let res;
    try {
      res = await http('POST', CLAUDE, {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }, JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: 500, system: E.AI_SYSTEM,
        messages: [{ role: 'user', content: text }],
      }));
    } catch (e) {
      throw new UserError('Claude non risponde. Controlla la connessione o usa i filtri.');
    }
    if (res.status === 401) throw new UserError('Claude ha rifiutato la chiave. Controllala nelle impostazioni.');
    if (res.status >= 400) throw new UserError('Claude ha risposto con un errore (' + res.status + '). Riprova o usa i filtri.');
    let parsed;
    try {
      const body = JSON.parse(res.text);
      const out = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      parsed = E.normalizeAI(E.extractJson(out));
    } catch (e) {
      throw new UserError('Non ho capito la risposta di Claude. Riformula la frase o usa i filtri.');
    }
    const people = (await pool(parsed.peopleNames, 3, async (n) => (await searchPeople(n))[0])).filter(Boolean).map((p) => ({ id: p.id, name: p.name }));
    const keywords = (await pool(parsed.keywordNames, 3, async (n) => (await searchKeywords(n))[0])).filter(Boolean);
    return Object.assign({}, parsed.filters, people.length ? { people } : {}, keywords.length ? { keywords } : {});
  }

  /** Riassunto senza spoiler, scritto da Claude a partire dalla trama disponibile. */
  async function spoilerFree(it) {
    const cache = store.get('summaries', {});
    if (cache[it.key]) return cache[it.key];
    const key = (keys().claude || '').trim();
    if (!key) throw new UserError('Aggiungi la chiave Claude nelle impostazioni per avere il riassunto.');
    let res;
    try {
      res = await http('POST', CLAUDE, {
        'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }, JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: 200,
        system: 'Scrivi in italiano due frasi che invoglino a guardare il titolo: solo premessa, atmosfera e genere. Nessun colpo di scena, nessun evento oltre il primo atto, nessun finale. Usa solo le informazioni fornite e non inventare dettagli.',
        messages: [{ role: 'user', content: 'Titolo: ' + it.title + '\nGeneri: ' + (it.genres || []).join(', ') + '\nTrama: ' + (it.overview || 'non disponibile') }],
      }));
    } catch (e) { throw new UserError('Claude non risponde. Riprova tra poco.'); }
    if (res.status === 401) throw new UserError('Claude ha rifiutato la chiave. Controllala nelle impostazioni.');
    if (res.status >= 400) throw new UserError('Claude ha risposto con un errore (' + res.status + '). Riprova tra poco.');
    const text = (JSON.parse(res.text).content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    cache[it.key] = text;
    store.set('summaries', cache);
    return text;
  }

  /** Salva voto e caratteristiche di un titolo per un profilo. */
  function saveRating(it, votes) {
    const ratings = store.get('ratings', {});
    const cur = ratings[it.key] || { r: {}, w: {}, id: it.id, kind: it.kind, title: it.title, year: it.year, poster: it.poster };
    if (it.keywordList || it.cast) cur.f = X.featuresOf(it);
    Object.entries(votes).forEach(([pid, v]) => {
      if (v == null) { delete cur.r[pid]; delete cur.w[pid]; } else { cur.r[pid] = v; cur.w[pid] = true; }
    });
    cur.t = Date.now();
    ratings[it.key] = cur;
    store.set('ratings', ratings);
  }

  /** Importa una cronologia in un profilo. Conta anche ciò che non è stato riconosciuto. */
  async function importHistory(parsed, pid, onProgress) {
    const rows = parsed.rows.slice(0, 500);
    const ratings = store.get('ratings', {});
    let done = 0;
    let ok = 0;
    let missed = 0;
    await pool(rows, 5, async (row) => {
      let hit = null;
      let kind = row.kind;
      if (row.imdb) {
        const d = await tmdb('/find/' + row.imdb, { external_source: 'imdb_id', language: 'it-IT' });
        const m = d && d.movie_results && d.movie_results[0];
        const t = d && d.tv_results && d.tv_results[0];
        hit = m || t || null;
        kind = m ? 'movie' : 'tv';
      } else {
        const path = kind === 'tv' ? '/search/tv' : kind === 'movie' ? '/search/movie' : '/search/multi';
        const d = await tmdb(path, { query: row.title, language: 'it-IT', include_adult: 'false' });
        hit = X.matchSearch((d && d.results) || [], row);
        if (hit && !kind) kind = hit.media_type === 'tv' ? 'tv' : 'movie';
      }
      done++;
      if (done % 5 === 0) onProgress(done, rows.length);
      if (!hit) { missed++; return; }
      let it = E.normalizeRow(hit, kind);
      if (row.rating != null) it = await details(it);
      const cur = ratings[it.key] || { r: {}, w: {}, id: it.id, kind: it.kind, title: it.title, year: it.year, poster: it.poster };
      if (row.rating != null) { cur.r[pid] = row.rating; cur.f = X.featuresOf(it); }
      cur.w[pid] = true;
      cur.t = Date.now();
      ratings[it.key] = cur;
      ok++;
    });
    store.set('ratings', ratings);
    return { ok, missed, truncated: parsed.rows.length - rows.length };
  }

  /** Titoli noti da votare per insegnare i gusti all'app. */
  async function teachBatch(page) {
    const d = await tmdb('/discover/movie', { language: 'it-IT', sort_by: 'vote_count.desc', page: String(page), include_adult: 'false' });
    return ((d && d.results) || []).map((r) => E.normalizeRow(r, 'movie'));
  }

  /** Aggiorna le serie in corso con gli ultimi episodi usciti. */
  async function refreshTracked(force) {
    const list = store.get('tracked', []);
    const last = store.get('trackedAt', 0);
    if (!list.length || (!force && Date.now() - last < 6 * 3600 * 1000)) return list;
    const out = await pool(list, 4, async (t) => {
      const d = await tmdb('/tv/' + t.id, { language: 'it-IT' });
      if (!d) return t;
      const fake = E.mergeDetails({ kind: 'tv', key: t.key, id: t.id, title: t.title }, d);
      return X.normalizeTracked(Object.assign({}, t, { lastAired: fake.lastAired, nextAir: fake.nextAir, seasonCounts: fake.seasonCounts }));
    });
    store.set('tracked', out);
    store.set('trackedAt', Date.now());
    return out;
  }

  /** Prova le chiavi appena inserite con una richiesta reale. */
  async function testKeys(k) {
    const result = {};
    if (k.tmdb) {
      try { await tmdb('/configuration', {}, k.tmdb); result.tmdb = true; } catch (e) { result.tmdb = false; }
    }
    if (k.omdb) {
      try {
        const r = await http('GET', OMDB + '?i=tt0111161&apikey=' + encodeURIComponent(k.omdb.trim()));
        result.omdb = r.status === 200 && JSON.parse(r.text).Response === 'True';
      } catch (e) { result.omdb = false; }
    }
    return result;
  }

  root.Api = { more, searchTitles, storedKeys, hasSharedTmdb, http, profilesOf, viewersOf, tasteFor, spoilerFree, saveRating, importHistory, teachBatch, refreshTracked, details, store, UserError, search, loadTitle, similar, providersIT, searchPeople, searchKeywords, interpret, testKeys, keys };
})(window);
