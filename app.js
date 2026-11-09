/* Stasera: interfaccia. */
(function () {
  'use strict';
  const E = window.Engine;
  const A = window.Api;
  const X = window.Extras;
  const Y = window.Sync;
  const S = A.store;
  const IMG = 'https://image.tmdb.org/t/p/';
  const $ = (id) => document.getElementById(id);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const COLORS = { audience: 'var(--c-audience)', critic: 'var(--c-critic)', popularity: 'var(--c-popularity)', recency: 'var(--c-recency)', taste: 'var(--c-taste)' };
  const FADER_HELP = { audience: 'Voti di IMDb e TMDB', critic: 'Rotten Tomatoes e Metacritic', popularity: 'Quanta gente lo ha votato', recency: 'Quanto è recente', taste: 'Quanto dovrebbe piacervi in base ai vostri voti' };

  const app = {
    tab: 'search',
    filters: (() => { const d = E.defaultFilters(); const f = Object.assign(d, S.get('filters', {})); f.weights = Object.assign(E.defaultFilters().weights, f.weights); return f; })(),
    preset: S.get('preset', null),
    providers: null,
    openGroups: new Set(['stili']),
    results: null, heroIndex: 0, loading: null, error: null, reveal: false,
    news: { mode: 'stream', kind: 'movie', provider: 0, page: 0, pages: 1, items: [], loading: false, error: null },
    sheet: null, wheel: null, showCount: 20, sortBy: 'match', titleHits: [],
    personHits: [], keywordHits: [],
  };

  const seenList = () => S.get('seen', []);
  const watchList = () => S.get('watchlist', []);
  const hiddenList = () => S.get('hidden', []);
  const alertList = () => S.get('alerts', []);
  const savedList = () => S.get('saved', []);
  const slim = (it) => ({ key: it.key, id: it.id, kind: it.kind, title: it.title, year: it.year, date: it.date, poster: it.poster, tmdbVote: it.tmdbVote, tmdbVotes: it.tmdbVotes, overview: it.overview, genreIds: it.genreIds || [] });
  const inList = (list, key) => list.some((x) => x.key === key);

  function toast(msg) {
    const t = $('toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>';
    clearTimeout(toast.h);
    toast.h = setTimeout(() => { t.innerHTML = ''; }, 2600);
  }
  function openExternal(url) {
    if (window.Android && window.Android.openUrl) window.Android.openUrl(url);
    else window.open(url, '_blank', 'noopener');
  }
  function saveFilters() { S.set('filters', app.filters); S.set('preset', app.preset); }
  function setFilters(patch, keepPreset) {
    Object.assign(app.filters, patch);
    if (!keepPreset) app.preset = null;
    saveFilters();
  }

  /* ---------- Pezzi riutilizzabili ---------- */
  const icon = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2.2" fill="var(--sipario)"/><circle cx="16" cy="12" r="2.2" fill="var(--sipario)"/><circle cx="7" cy="17" r="2.2" fill="var(--sipario)"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z" fill="currentColor"/></svg>',
    news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l2.4 5.2 5.6.6-4.2 3.8 1.2 5.6L12 15.4 7 18.2l1.2-5.6L4 8.8l5.6-.6z"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  };

  function poster(it, size, zoom) {
    return it.poster
      ? '<img class="poster' + (zoom ? ' zoomable' : '') + '" loading="lazy" alt="Copertina di ' + esc(it.title) + '" src="' + IMG + (size || 'w342') + it.poster + '"'
        + (zoom ? ' data-act="zoom" data-src="' + IMG + 'w780' + it.poster + '" role="button" tabindex="0"' : '') + '>'
      : '<div class="poster none">' + esc(it.title) + '</div>';
  }
  function bar(it) {
    if (!it.parts) return '';
    const seg = E.CRITERIA.map(({ k }) => {
      const v = it.parts[k] || 0;
      return v > 0 ? '<i class="' + k + '" style="width:' + v.toFixed(1) + '%"></i>' : '';
    }).join('');
    return '<div class="bar" role="img" aria-label="Compatibilità ' + it.match + ' su 100">' + seg + '</div>';
  }
  function metaLine(it) {
    const bits = [it.kind === 'tv' ? 'Serie' : 'Film'];
    if (it.year) bits.push(it.year);
    if (it.kind === 'movie' && it.runtime) bits.push(E.fmtRuntime(it.runtime));
    if (it.kind === 'tv' && it.seasons) bits.push(it.seasons === 1 ? '1 stagione' : it.seasons + ' stagioni');
    return bits.join(', ');
  }
  function alertHtml(it) {
    if (!('providers' in it)) return '';
    const subs = app.filters.providers;
    const a = alertList().find((x) => x.key === it.key);
    if (a && a.foundOn) return '<p class="alert-on">È arrivato su ' + esc(a.foundOn) + '.</p>';
    if (E.firstStreamingOffer(it.providers, subs)) return '';
    const where = subs.length ? 'sulle vostre piattaforme' : 'in streaming';
    return '<button class="btn alert-btn" data-act="alert" data-key="' + esc(it.key) + '" aria-pressed="' + !!a + '">'
      + (a ? 'Ti avviserò quando arriva ' + where : 'Avvisami quando arriva ' + where) + '</button>';
  }
  function offersHtml(it) {
    const f = app.filters;
    const offers = E.offersOf(it, true);
    const mine = offers.filter((o) => f.providers.includes(o.provider_id));
    const rest = offers.filter((o) => !f.providers.includes(o.provider_id));
    const ordered = mine.concat(rest).slice(0, 5);
    const link = it.providers && it.providers.link;
    const alert = alertHtml(it);
    if (!ordered.length) return '<p class="none-note">In Italia non risulta su nessuna piattaforma in questo momento.</p>' + alert;
    return alert + ordered.map((o, i) => {
      const url = E.watchUrl(o.provider_name, it.title, link);
      return '<button class="offer ' + (i === 0 ? '' : 'alt') + '" data-act="open" data-url="' + esc(url) + '">'
        + '<img alt="" src="' + IMG + 'w92' + o.logo_path + '">'
        + '<span>Cerca su ' + esc(o.provider_name) + '<small>' + esc(o.mode) + (o.mode === 'noleggio' || o.mode === 'acquisto' ? ', prezzo indicato dal servizio' : f.providers.length && !f.providers.includes(o.provider_id) && o.mode === 'abbonamento' ? ', non tra i tuoi' : '') + '</small></span></button>';
    }).join('') + '<div class="offer-links">' + (link ? '<button class="link-btn small" data-act="open" data-url="' + esc(link) + '">Vedi tutte le offerte</button>' : '') + '<button class="link-btn small" data-act="tv-help">Come vederlo sulla TV</button></div>';
  }
  function accessHtml(it) {
    const a = E.accessOf(it, app.filters);
    return a ? '<p class="access ' + a.kind + '">' + esc(a.text) + '</p>' : '';
  }
  function reasonsHtml(it) {
    return '<ul class="why">' + E.reasons(it, app.filters).map((r) =>
      '<li class="' + r.tone + '" style="--dot:' + (COLORS[r.c] || 'var(--polvere)') + '">' + esc(r.text) + '</li>').join('') + '</ul>';
  }
  function plot(it) {
    const prefs = S.get('prefs', {});
    const revealed = app.revealed && app.revealed.has(it.key);
    const summary = S.get('summaries', {})[it.key];
    const body = prefs.hidePlot && !revealed
      ? '<button class="plot-hidden" data-act="reveal" data-key="' + esc(it.key) + '">Mostra la trama (può contenere anticipazioni)</button>'
      : '<p class="plot">' + esc(it.overview || 'Trama non disponibile in italiano.') + '</p>';
    const ai = summary
      ? '<div class="ai-summary">' + esc(summary) + '<small>Riassunto scritto da Claude dalla trama di TMDB</small></div>'
      : (A.keys().claude || '').trim() ? '<button class="link-btn small" data-act="summary" data-key="' + esc(it.key) + '">Riassunto senza spoiler</button>' : '';
    return body + ai + infoLines(it);
  }
  function infoLines(it) {
    const lines = [];
    if (it.certification) lines.push('<p><b>Età consigliata:</b> ' + esc(it.certification.value) + ' (' + esc(it.certification.country) + ')</p>');
    if (it.pace) lines.push('<p><b>Ritmo:</b> ' + esc(it.pace) + '</p>');
    if (it.warnings && it.warnings.length) lines.push('<p class="warn-line"><b>Contiene:</b> ' + esc(it.warnings.join(', ')) + '</p>');
    return lines.length ? '<div class="info-lines">' + lines.join('') + '</div>' : '';
  }
  function actionButtons(it) {
    return '<button class="btn" data-act="seen" data-key="' + esc(it.key) + '" aria-pressed="' + inList(seenList(), it.key) + '">Già visto</button>'
      + '<button class="btn" data-act="watch" data-key="' + esc(it.key) + '" aria-pressed="' + inList(watchList(), it.key) + '">' + (inList(watchList(), it.key) ? 'Nella lista' : 'Salva per dopo') + '</button>'
      + '<button class="btn" data-act="rate" data-key="' + esc(it.key) + '">' + (S.get('ratings', {})[it.key] ? 'Modifica i voti' : 'Vota') + '</button>'
      + '<button class="btn" data-act="hide" data-key="' + esc(it.key) + '" aria-pressed="' + inList(hiddenList(), it.key) + '">' + (inList(hiddenList(), it.key) ? 'Nascosto' : 'Non mi interessa') + '</button>'
      + '<button class="btn wide" data-act="similar-search" data-key="' + esc(it.key) + '">Trova simili con i vostri filtri</button>';
  }
  function trailerHtml(it) {
    const search = '<button class="link-btn small" data-act="open" data-url="' + esc(E.trailerSearchUrl(it)) + '">Cerca il trailer in italiano su YouTube</button>';
    const t = it.trailer;
    if (!t) return '<div class="trailer-box"><p class="none-note">TMDB non ha un trailer per questo titolo.</p>' + search + '</div>';
    const url = 'https://www.youtube.com/watch?v=' + esc(t.key);
    return '<div class="trailer-box"><button class="trailer" data-act="open" data-url="' + url + '">'
      + '<img alt="" loading="lazy" src="https://i.ytimg.com/vi/' + esc(t.key) + '/hqdefault.jpg"><span class="play" aria-hidden="true"></span>'
      + '<span class="trailer-label">' + (t.italian ? 'Guarda il trailer in italiano' : 'Trailer originale: in italiano non è disponibile') + '</span></button>'
      + (t.italian ? '' : search) + '</div>';
  }

  /* ---------- Cerca ---------- */
  function group(id, title, value, body) {
    const on = value && !['Tutti', 'Tutte', 'Qualsiasi'].includes(value);
    return '<details class="group" data-group="' + id + '"' + (app.openGroups.has(id) ? ' open' : '') + '>'
      + '<summary><h3>' + title + '</h3><span class="val ' + (on ? 'on' : '') + '">' + esc(value) + '</span></summary>'
      + '<div class="body">' + body + '</div></details>';
  }
  function chip(act, val, label, on, extra) {
    return '<button class="chip ' + (extra || '') + '" data-act="' + act + '" data-val="' + esc(val) + '" aria-pressed="' + !!on + '">' + esc(label) + '</button>';
  }
  function seg(act, options, current) {
    return '<div class="seg">' + options.map(([v, l]) => '<button data-act="' + act + '" data-val="' + v + '" aria-pressed="' + (current === v) + '">' + l + '</button>').join('') + '</div>';
  }
  function slider(name, label, value, min, max, step, color, fmt) {
    return '<label class="slider" style="--c:' + color + '"><span>' + label + '</span><b id="out-' + name + '">' + fmt(value) + '</b>'
      + '<input type="range" data-slider="' + name + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"></label>';
  }
  const SLIDER_FMT = {
    minAudience: (v) => (v ? 'da ' + v : 'Nessun minimo'),
    minCritic: (v) => (v ? 'da ' + v : 'Nessun minimo'),
    minVotes: (v) => (v ? 'da ' + (+v).toLocaleString('it-IT') : 'Nessun minimo'),
  };

  function tick(act, val, label, on) {
    return '<button class="tick" data-act="' + act + '" data-val="' + esc(val) + '" role="checkbox" aria-checked="' + !!on + '"><i aria-hidden="true"></i><span>' + esc(label) + '</span></button>';
  }
  function stylesSection() {
    const f = app.filters;
    const names = f.genres.map((k) => E.GENRES.find((g) => g.k === k).n)
      .concat(f.styles.map((k) => E.STYLES.find((x) => x.k === k).n))
      .concat(f.keywords.map((k) => k.name));
    const body = '<div class="tick-group"><h4>Periodo di uscita</h4><div class="chips">'
      + [[0, 'Qualsiasi'], [2017, 'Dopo il 2016'], [2010, 'Dal 2010'], [2000, 'Dal 2000'], [1990, 'Dal 1990']].map(([v, l]) => chip('year-from', v, l, (f.yearFrom || 0) === v)).join('') + '</div></div>'
      + '<div class="tick-group"><h4>Generi</h4><div class="ticks">' + E.GENRES.map((g) => tick('genre', g.k, g.n, f.genres.includes(g.k))).join('') + '</div></div>'
      + E.STYLE_GROUPS.map((g) => '<div class="tick-group"><h4>' + esc(g.n) + '</h4><div class="ticks">' + g.items.map((x) => tick('style', x.k, x.n, f.styles.includes(x.k))).join('') + '</div></div>').join('')
      + '<div class="tick-group"><h4>Un altro tema</h4><div class="picked">' + f.keywords.map((k) => '<span class="tag">' + esc(k.name) + '<button data-act="rmkeyword" data-val="' + k.id + '" aria-label="Togli ' + esc(k.name) + '">×</button></span>').join('') + '</div>'
      + '<input class="text-in" id="keyword-q" autocomplete="off" placeholder="In inglese, es. submarine" aria-label="Cerca un altro tema"><div class="suggest" id="keyword-hits"></div></div>'
      + '<div class="tick-group"><h4>Da evitare</h4><div class="chips">' + E.GENRES.map((g) => chip('nogenre', g.k, g.n, f.excludeGenres.includes(g.k), 'no')).join('') + '</div></div>';
    // Sempre presente: se comparisse alla seconda spunta, la pagina salterebbe sotto il dito.
    const mode = '<div class="mode' + (names.length > 1 ? '' : ' off') + '"><span class="field-label">Se spunti più voci</span>' + seg('genreMode', [['all', 'Tutte insieme'], ['any', 'Ne basta una']], f.genreMode) + '</div>';
    const fromLabel = f.yearFrom === 2017 ? 'dopo il 2016' : f.yearFrom ? 'dal ' + f.yearFrom : '';
    const summary = names.concat(fromLabel ? [fromLabel] : []);
    return group('stili', 'Stili e generi', summary.length ? summary.join(', ') : 'Tutti', mode + body);
  }

  function renderSearch() {
    const f = app.filters;
    const keys = A.keys();
    const hasKey = !!(keys.tmdb || '').trim();
    const hasOmdb = !!(keys.omdb || '').trim();
    const provs = app.providers || [];
    const provNames = f.providers.map((id) => (provs.find((p) => p.id === id) || {}).name).filter(Boolean);
    const ageValue = f.yearFrom || f.yearTo ? [f.yearFrom || '…', f.yearTo || 'oggi'].join(' – ') : 'Qualsiasi';
    const lenValue = f.runtimeMax ? 'fino a ' + E.fmtRuntime(f.runtimeMax) : f.runtimeMin ? 'da ' + E.fmtRuntime(f.runtimeMin) : 'Qualsiasi';

    const ratings = S.get('ratings', {});
    const tasteReady = A.profilesOf().some((p) => X.buildProfile(ratings, p.id).ready);
    const viewersPref = S.get('viewers', 'both');
    const profiles = A.profilesOf();
    const faders = E.CRITERIA.filter(({ k }) => k !== 'taste' || tasteReady).map(({ k, n }) => {
      const v = f.weights[k];
      return '<div class="fader" style="--c:' + COLORS[k] + ';--v:' + v + '%"><output id="w-' + k + '">' + v + '</output>'
        + '<div class="fader-track"><input type="range" id="fader-' + k + '" data-weight="' + k + '" min="0" max="100" step="5" value="' + v + '" aria-label="' + n + ': ' + FADER_HELP[k] + '"></div>'
        + '<label for="fader-' + k + '">' + n + '</label></div>';
    }).join('');

    const provBody = !hasKey
      ? '<p class="muted small">L\'elenco arriva appena inserisci la chiave TMDB.</p>'
      : !app.providers ? '<p class="muted small">Carico le piattaforme disponibili in Italia.</p>'
      : '<div class="provs">' + provs.slice(0, 16).map((p) => '<button class="prov" data-act="provider" data-val="' + p.id + '" aria-pressed="' + f.providers.includes(p.id) + '">'
          + '<img alt="" src="' + IMG + 'w92' + p.logo + '"><span>' + esc(p.name) + '</span></button>').join('') + '</div>';

    $('screen').innerHTML = '<header class="masthead"><div class="brand"><svg viewBox="16 16 76 76" aria-hidden="true"><path fill="#FFE3A3" d="M22.975 43.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#FFE3A3" d="M33.475 43.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#F8EDE0" d="M27.7 36.75a6.300000000000001 6.300000000000001 0 1 0 12.600000000000001 0a6.300000000000001 6.300000000000001 0 1 0 -12.600000000000001 0Z"/><path fill="#F2BC5E" d="M32.11 43.05a1.8900000000000001 1.8900000000000001 0 1 0 3.7800000000000002 0a1.8900000000000001 1.8900000000000001 0 1 0 -3.7800000000000002 0Z"/><path fill="#FFE3A3" d="M62.975 43.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#FFE3A3" d="M73.475 43.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#F8EDE0" d="M67.7 36.75a6.300000000000001 6.300000000000001 0 1 0 12.600000000000001 0a6.300000000000001 6.300000000000001 0 1 0 -12.600000000000001 0Z"/><path fill="#F2BC5E" d="M72.11 43.05a1.8900000000000001 1.8900000000000001 0 1 0 3.7800000000000002 0a1.8900000000000001 1.8900000000000001 0 1 0 -3.7800000000000002 0Z"/><path fill="#FFE3A3" d="M32.975 36.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#FFE3A3" d="M43.475 36.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#F8EDE0" d="M37.7 29.75a6.300000000000001 6.300000000000001 0 1 0 12.600000000000001 0a6.300000000000001 6.300000000000001 0 1 0 -12.600000000000001 0Z"/><path fill="#F2BC5E" d="M42.11 36.05a1.8900000000000001 1.8900000000000001 0 1 0 3.7800000000000002 0a1.8900000000000001 1.8900000000000001 0 1 0 -3.7800000000000002 0Z"/><path fill="#FFE3A3" d="M52.975 36.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#FFE3A3" d="M63.475 36.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#F8EDE0" d="M57.7 29.75a6.300000000000001 6.300000000000001 0 1 0 12.600000000000001 0a6.300000000000001 6.300000000000001 0 1 0 -12.600000000000001 0Z"/><path fill="#F2BC5E" d="M62.11 36.05a1.8900000000000001 1.8900000000000001 0 1 0 3.7800000000000002 0a1.8900000000000001 1.8900000000000001 0 1 0 -3.7800000000000002 0Z"/><path fill="#FFE3A3" d="M42.975 43.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#FFE3A3" d="M53.475 43.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#F8EDE0" d="M47.7 36.75a6.300000000000001 6.300000000000001 0 1 0 12.600000000000001 0a6.300000000000001 6.300000000000001 0 1 0 -12.600000000000001 0Z"/><path fill="#F2BC5E" d="M52.11 43.05a1.8900000000000001 1.8900000000000001 0 1 0 3.7800000000000002 0a1.8900000000000001 1.8900000000000001 0 1 0 -3.7800000000000002 0Z"/><path fill="#FFE3A3" d="M42.975 28.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#FFE3A3" d="M53.475 28.05a5.775 5.775 0 1 0 11.55 0a5.775 5.775 0 1 0 -11.55 0Z"/><path fill="#F8EDE0" d="M47.7 21.75a6.300000000000001 6.300000000000001 0 1 0 12.600000000000001 0a6.300000000000001 6.300000000000001 0 1 0 -12.600000000000001 0Z"/><path fill="#F2BC5E" d="M52.11 28.05a1.8900000000000001 1.8900000000000001 0 1 0 3.7800000000000002 0a1.8900000000000001 1.8900000000000001 0 1 0 -3.7800000000000002 0Z"/><path fill="#F8EDE0" d="M30 44H78L71 88H37Z"/><path fill="#C22F52" d="M30 44H39.6L43.8 88H37Z"/><path fill="#C22F52" d="M49.2 44H58.8L57.4 88H50.6Z"/><path fill="#C22F52" d="M68.4 44H78L71 88H64.2Z"/><path fill="#2A0D1C" d="M40 67a14 14 0 1 0 28 0a14 14 0 1 0 -28 0Z"/><path fill="#F2BC5E" d="M49.5 59.5L62 67L49.5 74.5Z"/></svg><h1>PopPick</h1></div>'
      + '<button class="icon-btn" data-act="settings" aria-label="Impostazioni e chiavi">' + icon.gear + '</button></header>'
      + '<div class="title-search"><input class="text-in" id="title-q" type="search" autocomplete="off" placeholder="Cerca un film o una serie per nome" aria-label="Cerca un film o una serie per nome"><div class="suggest" id="title-hits"></div></div>'
      + ((keys.claude || '').trim() ? '<form class="ask" id="ask"><input id="ask-text" aria-label="Descrivi cosa cercate" placeholder="Es. un thriller italiano sotto le due ore"><button>Cerca</button></form>' : '')
      + bannersHtml()
      + '<div class="who-seg">' + seg('viewers', [['both', esc(profiles[0].name) + ' e ' + esc(profiles[1].name)], ['p1', 'Solo ' + esc(profiles[0].name)], ['p2', 'Solo ' + esc(profiles[1].name)]], viewersPref) + '</div>'
      + '<div class="strip">' + E.PRESETS.map((p) => chip('preset', p.k, p.n, app.preset === p.k)).join('') + '</div>'
      + seg('type', [['both', 'Film e serie'], ['movie', 'Solo film'], ['tv', 'Solo serie']], f.type)
      + stylesSection()
      + '<section class="mixer"><h2>Cosa conta stasera</h2><p>Più alzi un cursore, più quel criterio pesa nella classifica.</p><div class="faders' + (tasteReady ? ' five' : '') + '">' + faders + '</div>' + (tasteReady ? '' : '<p class="small muted" style="margin-top:10px">Votate almeno ' + X.MIN_RATINGS + ' titoli per attivare il cursore dei vostri gusti. <button class="link-btn" data-act="teach">Inizia a votare</button></p>') + '</section>'

      + group('fine', 'A che ora volete finire', f.endTime ? 'entro le ' + f.endTime : 'Qualsiasi',
        '<div class="field-inline"><label for="end-time">Finire entro le</label><input type="time" id="end-time" value="' + esc(f.endTime || '') + '">' + (f.endTime ? '<button class="link-btn" data-act="clear-end">Togli</button>' : '') + '</div>'
        + '<p class="small muted">Scarta i film troppo lunghi per finire in tempo. Per le serie indica quanti episodi riuscite a vedere.</p>')
      + group('prov', 'Piattaforme', provNames.length ? provNames.join(', ') : 'Tutte',
        provBody
        + '<label class="switch"><span>Solo titoli gratis</span><input type="checkbox" data-check="onlyFree" ' + (f.onlyFree ? 'checked' : '') + '></label>'
        + (f.providers.length && !f.onlyFree ? '<label class="switch"><span>Anche titoli fuori dai miei abbonamenti</span><input type="checkbox" data-check="beyondSubs" ' + (f.beyondSubs ? 'checked' : '') + '></label>' : '')
        + '<label class="switch"><span>Anche noleggio e acquisto</span><input type="checkbox" data-check="includePaid" ' + (f.includePaid ? 'checked' : '') + '></label>'
        + '<label class="switch"><span>Solo titoli disponibili in Italia</span><input type="checkbox" data-check="onlyAvailable" ' + (f.onlyAvailable ? 'checked' : '') + '></label>')

      + group('voti', 'Voti minimi', [f.minAudience ? 'pubblico ' + f.minAudience : '', f.minCritic ? 'critica ' + f.minCritic : ''].filter(Boolean).join(', ') || 'Qualsiasi',
        slider('minAudience', 'Pubblico', f.minAudience, 0, 90, 5, COLORS.audience, SLIDER_FMT.minAudience)
        + slider('minCritic', 'Critica', f.minCritic, 0, 95, 5, COLORS.critic, SLIDER_FMT.minCritic)
        + (hasOmdb ? '' : '<p class="muted small">Per IMDb e critica serve la chiave OMDb: <button class="link-btn" data-act="settings">aggiungila</button></p>')
        + slider('minVotes', 'Numero di voti', f.minVotes, 0, 5000, 100, 'var(--c-popularity)', SLIDER_FMT.minVotes)
        + '<label class="switch"><span>Solo titoli poco conosciuti</span><input type="checkbox" data-check="hidden" ' + (f.maxVotes ? 'checked' : '') + '></label>')

      + group('persone', 'Attori e registi', f.people.length ? f.people.map((p) => p.name).join(', ') : 'Tutti',
        '<div class="picked">' + f.people.map((p) => '<span class="tag">' + esc(p.name) + '<button data-act="rmperson" data-val="' + p.id + '" aria-label="Togli ' + esc(p.name) + '">×</button></span>').join('') + '</div>'
        + '<input class="text-in" id="person-q" autocomplete="off" placeholder="Cerca un nome" aria-label="Cerca attore o regista"><div class="suggest" id="person-hits"></div>'
        + (f.people.length > 1 ? seg('peopleMode', [['any', 'Almeno uno'], ['all', 'Tutti insieme']], f.peopleMode) : ''))

      + group('tempo', 'Anno e durata', ageValue !== 'Qualsiasi' ? ageValue : lenValue,
        '<div class="twin"><label><span class="field-label">Dal</span><input class="text-in" type="number" inputmode="numeric" data-num="yearFrom" min="1900" max="2100" value="' + (f.yearFrom || '') + '"></label>'
        + '<label><span class="field-label">Al</span><input class="text-in" type="number" inputmode="numeric" data-num="yearTo" min="1900" max="2100" value="' + (f.yearTo || '') + '"></label></div>'
        + '<div><span class="field-label">Durata massima, per le serie vale a episodio</span><div class="chips">'
        + [[0, 'Qualsiasi'], [30, '30 min'], [60, '1 h'], [90, '1 h 30'], [110, '1 h 50'], [130, '2 h 10']].map(([v, l]) => chip('runtime', v, l, (f.runtimeMax || 0) === v)).join('') + '</div></div>')

      + group('origine', 'Lingua e paese', [(E.LANGUAGES.find((l) => l[0] === f.language) || [])[1], (E.COUNTRIES.find((c) => c[0] === f.country) || [])[1]].filter(Boolean).join(', ') || 'Qualsiasi',
        '<div><span class="field-label">Lingua originale</span><div class="chips">' + E.LANGUAGES.map(([v, l]) => chip('language', v, l, f.language === v)).join('') + '</div></div>'
        + '<div><span class="field-label">Paese di produzione</span><div class="chips">' + E.COUNTRIES.map(([v, l]) => chip('country', v, l, f.country === v)).join('') + '</div></div>')

      + (f.type === 'movie' ? '' : group('serie', 'Solo per le serie', [f.tvStatus === 'ended' ? 'concluse' : f.tvStatus === 'returning' ? 'in corso' : '', f.maxSeasons ? 'fino a ' + f.maxSeasons + ' stagioni' : ''].filter(Boolean).join(', ') || 'Qualsiasi',
        seg('tvStatus', [['any', 'Tutte'], ['ended', 'Concluse'], ['returning', 'In corso']], f.tvStatus)
        + '<div><span class="field-label">Stagioni al massimo</span><div class="chips">' + [[0, 'Qualsiasi'], [1, '1'], [2, '2'], [3, '3'], [5, '5']].map(([v, l]) => chip('seasons', v, l, (f.maxSeasons || 0) === v)).join('') + '</div></div>'))

      + '<div class="search-tools"><button class="link-btn" data-act="reset">Azzera i filtri</button><button class="link-btn" data-act="save-search">Salva questa ricerca</button></div>';

    $('cta-slot').innerHTML = hasKey
      ? '<div class="cta-pair"><button class="cta" data-act="go">Trova i titoli</button><button class="cta spin" data-act="wheel">Scegli per me</button></div>'
      : '<button class="cta" data-act="settings">Inserisci la chiave per iniziare</button>';
  }

  /* ---------- Proposte ---------- */
  function renderResults() {
    $('cta-slot').innerHTML = '';
    if (app.loading) {
      $('screen').innerHTML = '<div class="state"><h1>Un momento</h1><p aria-live="polite">' + esc(app.loading) + '</p><div class="loading-line"><i></i></div></div>';
      return;
    }
    if (app.error) {
      $('screen').innerHTML = '<div class="state"><h1>Ricerca interrotta</h1><p>' + esc(app.error) + '</p>'
        + '<button class="btn" data-act="go">Riprova</button><button class="btn" data-act="settings">Apri le impostazioni</button></div>';
      return;
    }
    const r = app.results;
    if (!r) {
      $('screen').innerHTML = '<div class="state"><h1>Nessuna ricerca</h1><p>Scegli cosa conta stasera e l\'app propone un titolo con le sue ragioni.</p><button class="btn" data-act="tab" data-val="search">Imposta i filtri</button></div>';
      return;
    }
    const notes = r.notes.map((n) => '<p class="note">' + esc(n) + '</p>').join('');
    if (!r.items.length) {
      $('screen').innerHTML = '<div class="state"><h1>Nessun titolo</h1><p>' + (r.examined ? 'Ho esaminato ' + r.examined + ' titoli, ma i filtri li escludono tutti.' : 'Nessun titolo rispetta tutti i filtri.') + ' Prova così:</p>'
        + '<div class="hints">' + r.hints.map((h, i) => '<button class="btn" data-act="relax" data-val="' + i + '">' + esc(h.label) + (h.count ? ' (ha escluso ' + plural(h.count, 'titolo', 'titoli') + ')' : '') + '</button>').join('') + '</div>'
        + '<button class="btn" data-act="tab" data-val="search">Modifica i filtri</button>' + notes + '</div>';
      return;
    }
    const idx = app.heroIndex % r.items.length;
    const hero = r.items[idx];
    const others = r.items.filter((_, i) => i !== idx);
    const usedCriteria = E.CRITERIA.filter(({ k }) => (hero.parts[k] || 0) > 0);

    const sorted = E.sortItems(others, app.sortBy);
    const shown = sorted.slice(0, app.showCount);
    const canMore = sorted.length > app.showCount || (r.ctx && r.ctx.queue.length > 0);
    const sorts = [['match', 'Punteggio'], ['critic', 'Critica'], ['audience', 'Pubblico'], ['year', 'Più recenti'], ['runtime', 'Più brevi']];
    $('screen').innerHTML = (app.reveal ? '<div class="curtain" aria-hidden="true"><i></i><i></i></div>' : '')
      + (r.seed ? '<p class="seed-note">Titoli simili a <b>' + esc(r.seed.title) + '</b> che rispettano i vostri filtri. <button class="link-btn" data-act="go">Torna alla ricerca normale</button></p>' : '')
      + '<article class="pick"><div class="pick-top' + (hero.title.length > 24 ? ' long' : '') + '">' + poster(hero, 'w500', true) + '<div>'
      + '<p class="lead-label">' + (r.seed ? 'Simile a ' + esc(r.seed.title) : idx === 0 ? 'La proposta per stasera' : 'Un\'altra proposta') + '</p>'
      + '<h1>' + esc(hero.title) + '</h1><p class="meta">' + esc(metaLine(hero)) + '</p>' + accessHtml(hero) + '</div></div>'
      + '<div class="match"><strong>' + hero.match + '</strong><span>su 100 rispetto a ciò che conta per voi</span></div>'
      + bar(hero)
      + '<div class="legend">' + usedCriteria.map(({ k, n }) => '<span><i style="background:' + COLORS[k] + '"></i>' + n + '</span>').join('') + '</div>'
      + reasonsHtml(hero) + plot(hero) + trackerHtml(hero) + trailerHtml(hero)
      + '<div class="offers">' + offersHtml(hero) + '</div>'
      + '<div class="actions">' + actionButtons(hero)
      + (r.items.length > 1 ? '<button class="btn wide" data-act="next">Proponine un altro</button>' : '') + '</div></article>'
      + notes
      + (others.length ? '<section class="others"><h2>Le altre proposte</h2>'
        + '<div class="sort-row" role="group" aria-label="Ordina per">' + sorts.map(([v, l]) => chip('sort', v, l, app.sortBy === v)).join('') + '</div>'
        + shown.map((it) => {
        const logos = E.offersOf(it, app.filters.includePaid).slice(0, 4).map((o) => '<img alt="' + esc(o.provider_name) + '" src="' + IMG + 'w92' + o.logo_path + '">').join('');
        return '<button class="row" data-act="detail" data-key="' + esc(it.key) + '">' + poster(it, 'w185')
          + '<span><h3>' + esc(it.title) + '</h3><div class="meta">' + esc(metaLine(it)) + '</div>' + accessHtml(it) + bar(it)
          + (logos ? '<div class="logos">' + logos + '</div>' : '') + '</span>'
          + '<span class="score">' + it.match + '</span></button>';
      }).join('')
        + (canMore ? '<button class="btn more-btn" data-act="more"' + (app.loadingMore ? ' disabled' : '') + '>' + (app.loadingMore ? 'Cerco altri titoli' : 'Mostrane altri') + '</button>' : '')
        + '</section>' : '');

    if (app.reveal) {
      app.reveal = false;
      setTimeout(() => { const c = document.querySelector('.curtain'); if (c) c.remove(); }, 900);
    }
  }

  /* ---------- Novità ---------- */
  function newsProviders() {
    const all = app.providers || [];
    const mine = all.filter((p) => app.filters.providers.includes(p.id));
    const rest = all.filter((p) => !app.filters.providers.includes(p.id)).slice(0, Math.max(0, 8 - mine.length));
    return mine.concat(rest);
  }
  function renderNews() {
    $('cta-slot').innerHTML = '';
    const n = app.news;
    if (!n.page && !n.loading && !n.error) { loadNews(true); return; }
    const drop = new Set(seenList().concat(hiddenList()).map((x) => x.key));
    const items = n.items.filter((x) => !drop.has(x.key));
    const subs = app.filters.providers;
    const explain = n.mode === 'cinema' ? 'Film in programmazione nei cinema italiani.'
      : n.kind === 'movie' ? 'Film usciti negli ultimi sei mesi e già disponibili ' + (n.provider || !subs.length ? 'in streaming' : 'sulle vostre piattaforme') + ', i più seguiti per primi. TMDB non indica il giorno di arrivo sulla piattaforma.'
        : 'Serie con episodi usciti nelle ultime settimane, disponibili ' + (n.provider || !subs.length ? 'in streaming' : 'sulle vostre piattaforme') + '.';
    $('screen').innerHTML = '<h1 class="page-title">Novità</h1>'
      + seg('news-mode', [['stream', 'In streaming'], ['cinema', 'Al cinema']], n.mode)
      + (n.mode === 'stream' ? '<div style="margin-top:10px">' + seg('news-kind', [['movie', 'Film'], ['tv', 'Serie']], n.kind) + '</div>'
        + '<div class="strip news-strip">' + chip('news-prov', 0, subs.length ? 'Le mie piattaforme' : 'Tutte', !n.provider)
        + newsProviders().map((p) => chip('news-prov', p.id, p.name, n.provider === p.id)).join('') + '</div>' : '')
      + '<p class="small muted news-explain">' + explain + '</p>'
      + (n.error ? '<p class="note">' + esc(n.error) + '</p>' : '')
      + (items.length ? items.map((it) => '<button class="row news-row" data-act="detail" data-key="' + esc(it.key) + '">' + poster(it, 'w185')
          + '<span><h3>' + esc(it.title) + '</h3><div class="meta">' + esc((it.kind === 'tv' ? 'Serie' : 'Film') + (it.date ? ', ' + (n.mode === 'cinema' || it.kind === 'movie' ? 'uscito il ' : 'dal ') + it.date.split('-').reverse().join('/') : ''))
          + (it.tmdbVotes >= 20 ? ', voto ' + (Math.round(it.tmdbVote * 10) / 10).toLocaleString('it-IT') : '') + '</div></span></button>').join('')
        : n.loading ? '' : '<p class="empty-line">Nessuna novità con questa scelta.</p>')
      + (n.loading ? '<div class="loading-line"><i></i></div>' : n.page < n.pages && items.length ? '<button class="btn more-btn" data-act="news-more">Mostrane altri</button>' : '');
  }
  async function loadNews(reset) {
    const n = app.news;
    if (n.loading) return;
    if (reset) { n.page = 0; n.items = []; n.pages = 1; }
    n.loading = true; n.error = null;
    if (app.tab === 'news') renderNews();
    try {
      const r = await A.news({ cinema: n.mode === 'cinema', kind: n.kind, provider: n.provider, providers: app.filters.providers, page: n.page + 1 });
      const known = new Set(n.items.map((x) => x.key));
      n.items = n.items.concat(r.items.filter((x) => !known.has(x.key)));
      n.page += 1; n.pages = r.pages;
    } catch (e) { n.error = e instanceof A.UserError ? e.message : 'Non riesco a caricare le novità. Riprova.'; n.page = n.page || 1; }
    n.loading = false;
    if (app.tab === 'news') { const y = window.scrollY; renderNews(); window.scrollTo(0, y); }
  }

  /* ---------- Liste ---------- */
  function listRows(list, kind) {
    const empty = { watch: 'I titoli salvati per dopo compaiono qui.', seen: 'I titoli segnati come già visti non verranno più proposti.', hidden: 'I titoli che non vi interessano compaiono qui. Toglili per vederli di nuovo nelle proposte.', alerts: 'Su un titolo non ancora in streaming tocca "Avvisami quando arriva".' };
    if (!list.length) return '<p class="empty-line">' + empty[kind] + '</p>';
    return list.map((it) => '<div class="saved"><button class="with-thumb" data-act="detail-ref" data-list="' + kind + '" data-key="' + esc(it.key) + '">' + poster(it, 'w185') + '<span>' + esc(it.title) + (it.year ? ' <span class="muted small">' + it.year + '</span>' : '') + (kind === 'alerts' ? '<small class="alert-state">' + (it.foundOn ? 'Arrivato su ' + esc(it.foundOn) : 'In attesa') + '</small>' : '') + '</span></button>'
      + '<button class="del" data-act="rm-' + kind + '" data-key="' + esc(it.key) + '" aria-label="Togli ' + esc(it.title) + ' dalla lista">×</button></div>').join('');
  }
  function renderLists() {
    $('cta-slot').innerHTML = '';
    const saved = savedList();
    $('screen').innerHTML = '<h1 class="page-title">Le vostre liste</h1>'
      + '<div class="row-buttons"><button class="btn" data-act="teach">Insegna i vostri gusti</button><button class="btn" data-act="settings">Importa cronologia e backup</button></div>'
      + '<p class="small muted" style="margin-top:8px">' + A.profilesOf().map((p) => esc(p.name) + ': ' + plural(X.buildProfile(S.get('ratings', {}), p.id).count, 'voto', 'voti')).join(', ') + '</p>'
      + '<h2 class="list-title">Serie in corso</h2>' + (S.get('tracked', []).length ? bannersHtml(true) : '<p class="empty-line">Apri una serie e tocca "La stiamo guardando".</p>')
      + '<h2 class="list-title">Da vedere</h2>' + listRows(watchList(), 'watch')
      + '<h2 class="list-title">Ricerche salvate</h2>'
      + (saved.length ? saved.map((s, i) => '<div class="saved"><button data-act="run-saved" data-val="' + i + '">' + esc(s.name) + '</button><button class="del" data-act="rm-saved" data-val="' + i + '" aria-label="Elimina ' + esc(s.name) + '">×</button></div>').join('') : '<p class="empty-line">Salva una combinazione di filtri per ritrovarla con un tocco.</p>')
      + '<h2 class="list-title">Avvisi</h2>' + listRows(alertList(), 'alerts')
      + '<h2 class="list-title">Già visti</h2>' + listRows(seenList(), 'seen')
      + '<h2 class="list-title">Non vi interessano</h2>' + listRows(hiddenList(), 'hidden');
  }

  /* ---------- Schede ---------- */
  function renderSheet() {
    const root = $('sheet-root');
    const s = app.sheet;
    if (!s) { root.innerHTML = ''; return; }
    const firstOpen = !root.firstChild;
    drawSheet(root, s);
    if (firstOpen) { const el = root.querySelector('.sheet'); if (el) el.classList.add('enter'); }
  }
  function drawSheet(root, s) {
    if (s.type === 'detail') {
      const it = s.item;
      root.innerHTML = '<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(it.title) + '"><div class="sheet-head"><button class="close" data-act="close" aria-label="Chiudi">×</button></div>'
        + (s.loading ? '<p>Carico la scheda di ' + esc(it.title) + '.</p>' :
          '<div class="pick"><div class="pick-top' + (it.title.length > 24 ? ' long' : '') + '">' + poster(it, 'w342', true) + '<div><h1>' + esc(it.title) + '</h1><p class="meta">' + esc(metaLine(it)) + '</p>' + accessHtml(it) + '</div></div>'
          + (it.match != null ? '<div class="match"><strong>' + it.match + '</strong><span>su 100 rispetto a ciò che conta per voi</span></div>' + bar(it) : '')
          + reasonsHtml(it) + plot(it)
          + (it.directors && it.directors.length ? '<p class="cast"><b>' + (it.kind === 'movie' ? 'Regia' : 'Ideata da') + ':</b> ' + esc(it.directors.join(', ')) + '</p>' : '')
          + (it.cast && it.cast.length ? '<p class="cast"><b>Con:</b> ' + esc(it.cast.join(', ')) + '</p>' : '')
          + trackerHtml(it) + trailerHtml(it) + '<div class="offers">' + offersHtml(it) + '</div><div class="actions">' + actionButtons(it) + '</div>'
          + (s.similar && s.similar.length ? '<div class="others"><h2>Se vi piace questo</h2><div class="simil">' + s.similar.map((x) => '<button data-act="detail-similar" data-key="' + esc(x.key) + '">' + poster(x, 'w185') + esc(x.title) + '</button>').join('') + '</div></div>' : '')
          + '</div>')
        + '</div>';
      return;
    }
    if (s.type === 'install') {
      const ua = navigator.userAgent;
      const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
      const android = /Android/.test(ua);
      const body = ios
        ? '<h1 class="page-title" style="padding-top:0">Aggiungi PopPick all\'iPhone</h1><ol class="install-steps">'
          + '<li>Apri questa pagina con <b>Safari</b>.</li><li>Tocca <b>Condividi</b>, il quadrato con la freccia verso l\'alto.</li>'
          + '<li>Scorri e tocca <b>Aggiungi alla schermata Home</b>, poi <b>Aggiungi</b>.</li><li>Apri PopPick dalla sua icona e crea il tuo account.</li></ol>'
        : android
          ? '<h1 class="page-title" style="padding-top:0">Installa PopPick</h1><ol class="install-steps"><li>Scarica l\'app con il pulsante qui sotto.</li>'
            + '<li>Apri il file. Se Android lo blocca, tocca <b>Impostazioni</b> e consenti questa fonte. Sui Samsung può servire disattivare <b>Blocco automatico</b>.</li>'
            + '<li>Tocca <b>Installa</b>, apri PopPick e crea il tuo account.</li></ol><a class="cta install-go" href="PopPick.apk" download>Scarica l\'app per Android</a>'
          : '<h1 class="page-title" style="padding-top:0">PopPick</h1><p style="margin-top:12px">Apri questo indirizzo dal telefono per installarla. Puoi anche usarla qui nel browser.</p>';
      root.innerHTML = '<div class="sheet full" role="dialog" aria-modal="true" aria-label="Installa PopPick">' + body
        + '<button class="link-btn install-more" data-act="install-skip">Continua nel browser</button></div>';
      return;
    }
    if (s.type === 'tv') {
      root.innerHTML = '<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Come vederlo sulla TV" style="top:auto;bottom:0"><div class="sheet-head"><button class="close" data-act="close" aria-label="Chiudi">×</button></div>'
        + '<h2 style="font-size:32px">Come vederlo sulla TV</h2><ol class="tv-steps">'
        + '<li><b>Dall\'app sulla TV.</b> Se la tua TV ha l\'app del servizio, apri il titolo direttamente lì: è il modo più affidabile.</li>'
        + '<li><b>Con il tasto Cast.</b> Apri il titolo nell\'app del servizio sul telefono e tocca l\'icona dello schermo con le onde, se il servizio la offre. Telefono e TV devono essere sulla stessa rete Wi-Fi.</li>'
        + '<li><b>Con Smart View, come ultima prova.</b> Su Samsung duplica lo schermo del telefono. Molti servizi lo bloccano per proteggere i film: se vedi lo schermo nero, usa uno dei modi precedenti.</li>'
        + '</ol></div>';
      return;
    }
    if (s.type === 'rate') { drawRate(root, s); return; }
    if (s.type === 'teach') { drawTeach(root, s); return; }
    if (s.type === 'wheel') { drawWheel(root, s); return; }
    if (s.type === 'zoom') {
      root.innerHTML = '<div class="zoom" data-act="close" role="dialog" aria-modal="true" aria-label="Copertina"><img alt="Copertina ingrandita" src="' + esc(s.src) + '"><button class="close" aria-label="Chiudi">×</button></div>';
      return;
    }
    if (s.type === 'save') {
      root.innerHTML = '<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Salva questa ricerca" style="top:auto;bottom:0"><div class="sheet-head"><button class="close" data-act="close" aria-label="Chiudi">×</button></div>'
        + '<form id="save-form" class="setting"><h3>Salva questa ricerca</h3><input class="text-in" id="save-name" required maxlength="50" placeholder="Es. Venerdì sera"><button class="cta">Salva la ricerca</button></form></div>';
      setTimeout(() => { const i = $('save-name'); if (i) i.focus(); }, 50);
      return;
    }
    if (s.type === 'settings') {
      const k = A.storedKeys();
      const shared = A.hasSharedTmdb();
      const stat = (v, ok, bad) => (v === true ? '<span class="status-ok">' + ok + '</span>' : v === false ? '<span class="status-bad">' + bad + '</span>' : '');
      const t = s.test || {};
      root.innerHTML = '<div class="sheet full" role="dialog" aria-modal="true" aria-label="Impostazioni"><div class="sheet-head"><button class="close" data-act="close" aria-label="Chiudi">×</button></div>'
        + '<h1 class="page-title" style="padding-top:0">Impostazioni</h1>'
        + accountHtml(s) + '<p style="margin-top:22px">' + (Y.session() ? 'Le chiavi sono salvate nel vostro account, così arrivano anche sull\'altro telefono.' : 'Le chiavi restano su questo telefono.') + ' OMDb è gratuita, Claude si paga a consumo.</p>'
        + '<form id="keys-form">'
        + '<div class="setting"><h3>' + (shared ? 'TMDB, già inclusa' : 'TMDB, obbligatoria') + '</h3><p>' + (shared ? 'Non serve fare nulla. Inserisci una chiave tua solo se quella inclusa smette di funzionare.' : 'Titoli, cast, generi e piattaforme. Crea un account, poi apri Impostazioni, API.') + '</p><button type="button" class="link-btn" data-act="open" data-url="https://www.themoviedb.org/settings/api" style="justify-self:start">Ottieni la chiave TMDB</button><input class="text-in" id="key-tmdb" autocomplete="off" aria-label="Chiave TMDB" value="' + esc(k.tmdb) + '" placeholder="Incolla la chiave">' + stat(t.tmdb, 'Chiave TMDB funzionante.', 'TMDB ha rifiutato la chiave: ricontrollala.') + '</div>'
        + '<div class="setting"><h3>OMDb, consigliata</h3><p>Voti di IMDb, Rotten Tomatoes e Metacritic, fino a 1.000 richieste al giorno. Arriva via email.</p><button type="button" class="link-btn" data-act="open" data-url="https://www.omdbapi.com/apikey.aspx" style="justify-self:start">Ottieni la chiave OMDb</button><input class="text-in" id="key-omdb" autocomplete="off" aria-label="Chiave OMDb" value="' + esc(k.omdb) + '" placeholder="Incolla la chiave">' + stat(t.omdb, 'Chiave OMDb funzionante.', 'OMDb ha rifiutato la chiave: ricontrollala, o attivala dal link nell\'email.') + '</div>'
        + '<div class="setting"><h3>Claude, facoltativa</h3><p>Permette di scrivere a parole cosa cercate, e l\'app imposta i filtri da sola.</p><button type="button" class="link-btn" data-act="open" data-url="https://console.anthropic.com/settings/keys" style="justify-self:start">Ottieni la chiave Claude</button><input class="text-in" id="key-claude" autocomplete="off" aria-label="Chiave Claude" value="' + esc(k.claude) + '" placeholder="Incolla la chiave"></div>'
        + '<button class="cta" style="margin-top:22px"' + (s.testing ? ' disabled' : '') + '>' + (s.testing ? 'Provo le chiavi' : 'Salva e prova le chiavi') + '</button></form>'
        + settingsExtraHtml()
        + '<div class="credits"><img alt="The Movie Database (TMDB)" src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg">'
        + '<p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>'
        + '<p>Dati sulla disponibilità in streaming forniti da JustWatch tramite TMDB. Voti di IMDb, Rotten Tomatoes e Metacritic forniti da OMDb.</p></div></div>';
    }
  }
  function openSheet(s) { app.sheet = s; renderSheet(); }
  function closeSheet() { app.sheet = null; renderSheet(); }

  async function showDetail(ref) {
    openSheet({ type: 'detail', item: ref, loading: !ref.providers });
    try {
      const it = await A.loadTitle(ref, app.filters);
      if (!app.sheet || app.sheet.item.key !== ref.key) return;
      app.sheet = { type: 'detail', item: it, loading: false, similar: null };
      renderSheet();
      const sim = await A.similar(it);
      if (app.sheet && app.sheet.item.key === it.key) { app.sheet.similar = sim; const top = document.querySelector('.sheet').scrollTop; renderSheet(); document.querySelector('.sheet').scrollTop = top; }
    } catch (e) {
      closeSheet();
      toast(e instanceof A.UserError ? e.message : 'Non riesco ad aprire la scheda. Riprova.');
    }
  }

  /* ---------- Ricerca ---------- */
  async function go(seed) {
    app.tab = 'results';
    app.showCount = 20;
    app.sortBy = 'match';
    app.loading = 'Cerco tra i titoli che rispettano i vostri filtri';
    app.error = null; app.heroIndex = 0;
    render();
    window.scrollTo(0, 0);
    try {
      const r = await A.search(app.filters, (msg) => { app.loading = msg; if (app.tab === 'results') renderResults(); }, seed && seed.key ? { seed } : null);
      app.results = r;
      app.reveal = r.items.length > 0;
    } catch (e) {
      console.error(e);
      app.error = e instanceof A.UserError ? e.message : 'Qualcosa è andato storto durante la ricerca. Riprova.';
    }
    app.loading = null;
    render();
    window.scrollTo(0, 0);
  }
  async function askAI(text) {
    app.tab = 'results'; app.loading = 'Traduco la richiesta in filtri'; app.error = null;
    render();
    try {
      const patch = await A.interpret(text);
      const base = E.defaultFilters();
      base.providers = app.filters.providers; base.includePaid = app.filters.includePaid; base.onlyAvailable = app.filters.onlyAvailable;
      if (patch.weights) patch.weights = Object.assign({}, base.weights, patch.weights);
      app.filters = Object.assign(base, patch);
      app.preset = null;
      saveFilters();
      await go();
    } catch (e) {
      app.loading = null;
      app.error = e instanceof A.UserError ? e.message : 'Non riesco a interpretare la richiesta. Usa i filtri.';
      render();
    }
  }

  function findItem(key) {
    const pools = [app.titleHits || [], app.news.items, alertList(), (app.sheet && app.sheet.slices ? app.sheet.slices.map((x) => x.item) : []), hiddenList(), (app.sheet && app.sheet.lock ? [app.sheet.lock.item] : []), (app.sheet && app.sheet.queue) || [], (app.results && app.results.items) || [], (app.sheet && app.sheet.similar) || [], (app.sheet && app.sheet.item ? [app.sheet.item] : []), watchList(), seenList()];
    for (const p of pools) { const hit = p.find((x) => x.key === key); if (hit) return hit; }
    return null;
  }
  function toggleList(name, key) {
    const list = S.get(name, []);
    const i = list.findIndex((x) => x.key === key);
    if (i >= 0) { list.splice(i, 1); S.set(name, list); return false; }
    const it = findItem(key);
    if (it) { list.unshift(slim(it)); S.set(name, list); }
    return true;
  }
  function keepScroll(fn) {
    const el = document.querySelector('.sheet');
    const top = el ? el.scrollTop : 0;
    fn();
    const next = document.querySelector('.sheet');
    if (next) next.scrollTop = top;
  }
  function refreshAll() {
    keepScroll(renderSheet);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
  function openRate(it, opts) {
    const e = S.get('ratings', {})[it.key];
    openSheet(Object.assign({ type: 'rate', item: it, votes: e ? Object.assign({}, e.r) : {} }, opts || {}));
  }
  function toggleIn(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }

  /* ---------- Serie in corso ---------- */
  const trackedList = () => S.get('tracked', []);
  function trackerHtml(it) {
    if (it.kind !== 'tv') return '';
    const t = trackedList().find((x) => x.key === it.key);
    if (!t) return '<div class="episode"><button class="btn" data-act="track" data-key="' + esc(it.key) + '">La stiamo guardando</button></div>';
    return '<div class="episode"><div class="steps"><b>Siete a: stagione ' + t.season + ', episodio ' + t.episode + '</b></div>'
      + '<div class="row-buttons"><button class="btn" data-act="ep-next" data-key="' + esc(it.key) + '">Episodio visto</button><button class="btn" data-act="ep-back" data-key="' + esc(it.key) + '">Torna indietro</button><button class="btn" data-act="untrack" data-key="' + esc(it.key) + '">Smetti di seguirla</button></div></div>';
  }
  function bannersHtml(onlyTracked) {
    const out = [];
    trackedList().forEach((t) => {
      const st = X.seriesStatus(t);
      const note = t.finished || st.caughtUp
        ? (t.nextAir ? 'Prossimo episodio il ' + t.nextAir.split('-').reverse().join('/') : 'Siete in pari')
        : st.newSeason ? 'Inizia la stagione ' + t.season : 'Continua da stagione ' + t.season + ', episodio ' + t.episode;
      out.push('<div class="banner">' + poster({ title: t.title, poster: t.poster }, 'w92')
        + '<button class="banner-main" data-act="detail-tracked" data-key="' + esc(t.key) + '"><b>' + esc(t.title) + '</b><small class="' + (st.newSeason ? 'new' : '') + '">' + esc(note) + '</small></button>'
        + (st.caughtUp || t.finished ? '' : '<button class="btn" data-act="ep-next" data-key="' + esc(t.key) + '">Visto</button>') + '</div>');
    });
    if (onlyTracked) return out.join('');
    alertList().filter((a) => a.foundOn && !a.seenFound).forEach((a) => {
      out.unshift('<div class="banner">' + poster(a, 'w92')
        + '<button class="banner-main" data-act="detail-alert" data-key="' + esc(a.key) + '"><b>' + esc(a.title) + '</b><small class="new">È arrivato su ' + esc(a.foundOn) + '</small></button>'
        + '<button class="btn" data-act="alert-ok" data-key="' + esc(a.key) + '">Ok</button></div>');
    });
    const pending = pendingVerdict();
    if (pending) {
      out.unshift('<div class="banner">' + poster(pending.item, 'w92')
        + '<button class="banner-main" data-act="rate-verdict"><b>Com\'è andata con ' + esc(pending.item.title) + '?</b><small>Il vostro voto migliora le prossime proposte</small></button>'
        + '<button class="btn" data-act="skip-verdict">Non ora</button></div>');
    }
    return out.join('');
  }
  function setTracked(list) { S.set('tracked', list); }
  function updateTracked(key, fn) {
    setTracked(trackedList().map((t) => (t.key === key ? Object.assign({}, t, fn(t)) : t)));
  }

  /* ---------- Voti ---------- */
  function starRow(pid, value) {
    let html = '<div class="stars" role="radiogroup" aria-label="Voto">';
    for (let i = 1; i <= 5; i++) html += '<button role="radio" data-act="star" data-pid="' + pid + '" data-val="' + i + '" aria-checked="' + !!(value && i <= value) + '" aria-label="' + i + ' su 5">★</button>';
    return html + '</div>';
  }
  function voteRows(votes) {
    return A.profilesOf().map((p) => '<div class="vote-row"><div class="who"><span>' + esc(p.name) + '</span><button class="link-btn" data-act="star-none" data-pid="' + p.id + '">' + (votes[p.id] ? 'Togli il voto' : 'Non l\'ha visto') + '</button></div>' + starRow(p.id, votes[p.id]) + '</div>').join('');
  }
  function drawRate(root, s) {
    root.innerHTML = '<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="Vota" style="top:auto;bottom:0"><div class="sheet-head"><button class="close" data-act="close" aria-label="Chiudi">×</button></div>'
      + '<h2 style="font-size:32px">' + esc(s.item.title) + '</h2>' + voteRows(s.votes)
      + '<button class="cta" style="margin-top:18px" data-act="rate-save">Salva i voti</button></div>';
  }
  function drawTeach(root, s) {
    const it = s.queue && s.queue[s.index];
    const count = A.profilesOf().map((p) => esc(p.name) + ' ' + X.buildProfile(S.get('ratings', {}), p.id).count).join(', ');
    root.innerHTML = '<div class="sheet full" role="dialog" aria-modal="true" aria-label="Insegna i vostri gusti"><div class="sheet-head"><button class="close" data-act="close" aria-label="Chiudi">×</button></div>'
      + '<h1 class="page-title" style="padding-top:0">I vostri gusti</h1><p class="muted">Votate i titoli che avete visto. Bastano ' + X.MIN_RATINGS + ' voti a testa per iniziare; più sono, meglio è. Voti finora: ' + count + '.</p>'
      + (s.error ? '<p class="note">' + esc(s.error) + '</p>' : '')
      + (!it ? '<p style="margin-top:20px">Carico i titoli.</p>'
        : '<div class="teach-card" style="margin-top:18px">' + poster(it, 'w342') + '<div><h2>' + esc(it.title) + '</h2><p class="muted">' + (it.year || '') + '</p></div></div>'
          + voteRows(s.votes)
          + '<div class="actions"><button class="btn" data-act="teach-next">Nessuno dei due l\'ha visto</button><button class="btn" data-act="teach-save" style="background:var(--avorio);color:var(--velluto);font-weight:600">Salva e continua</button></div>')
      + '</div>';
  }
  async function teachLoad(s) {
    try {
      s.page = (s.page || 0) + 1;
      const rated = S.get('ratings', {});
      const batch = (await A.teachBatch(s.page)).filter((x) => !rated[x.key]);
      s.queue = (s.queue || []).concat(batch);
      if (s.queue.length <= s.index && s.page < 15) return teachLoad(s);
    } catch (e) { s.error = e.message; }
    if (app.sheet === s) renderSheet();
  }

  /* ---------- Ruota ---------- */
  const PALETTE = ['#F2BC5E', '#8BE0CC', '#F5A3AC', '#BDB8FF', '#8FC7FF', '#E9956B', '#B9DE8A', '#F6E2B3'];
  const lockNow = () => { const l = S.get('wheelLock', null); return l && l.night === X.nightId() ? l : null; };
  function pendingVerdict() {
    const l = S.get('wheelLock', null);
    return l && l.night !== X.nightId() && !l.rated ? l : null;
  }
  function jollyMax() { const v = S.get('prefs', {}).jolly; return v == null ? 0 : v; }

  async function openWheel() {
    const lock = lockNow();
    if (lock) { openSheet({ type: 'wheel', phase: 'verdict', lock }); return; }
    const c = S.get('wheelCtx', null);
    await prepareWheel(c && c.night === X.nightId() ? c : { usedJolly: 0 });
  }
  // Esclusioni solo per la ruota, su questo telefono: non toccano i filtri della ricerca.
  const wheelPrefs = () => Object.assign({ exclude: [], size: 8 }, S.get('wheelPrefs', {}));
  function wheelFilters() {
    const wp = wheelPrefs();
    const f = JSON.parse(JSON.stringify(app.filters));
    f.excludeGenres = [...new Set((f.excludeGenres || []).concat(wp.exclude))];
    f.genres = (f.genres || []).filter((g) => !wp.exclude.includes(g));
    return f;
  }
  function excludedIds() {
    const ids = [];
    wheelPrefs().exclude.forEach((k) => {
      const g = E.GENRES.find((x) => x.k === k);
      if (g) [g.m, g.t].forEach((id) => { if (id != null && !ids.includes(id)) ids.push(id); });
    });
    return ids;
  }
  async function prepareWheel(ctx) {
    S.set('wheelCtx', Object.assign({}, ctx, { night: X.nightId() }));
    const s = { type: 'wheel', phase: 'loading', msg: 'Preparo la ruota con i titoli più adatti', ctx };
    openSheet(s);
    try {
      const r = await A.search(wheelFilters(), (m) => { if (app.sheet === s) { s.msg = m; renderSheet(); } });
      if (app.sheet !== s) return;
      const excluded = new Set((ctx.exclude || []));
      const noGenres = excludedIds();
      const items = r.items.filter((i) => !excluded.has(i.key) && !(i.genreIds || []).some((id) => noGenres.includes(id)));
      if (items.length < 2) {
        s.phase = 'empty'; s.hints = r.hints; s.notes = r.notes; s.count = items.length;
      } else {
        s.phase = 'ready'; s.all = items; s.slices = X.wheelSlices(items, wheelPrefs().size); s.notes = r.notes;
      }
    } catch (e) {
      s.phase = 'error'; s.msg = e instanceof A.UserError ? e.message : 'Qualcosa è andato storto. Riprova.';
    }
    if (app.sheet === s) renderSheet();
  }
  function wheelCss(slices) {
    return 'conic-gradient(' + slices.map((sl, i) => PALETTE[i % PALETTE.length] + ' ' + (sl.start * 360).toFixed(2) + 'deg ' + (sl.end * 360).toFixed(2) + 'deg').join(',') + ')';
  }
  function wheelControls() {
    const wp = wheelPrefs();
    const label = (g) => (g.k === 'animazione' ? 'Animazione e cartoni' : g.n);
    return '<details class="wheel-opts"><summary><b>Stasera escludi</b><span class="muted small">'
      + (wp.exclude.length ? esc(wp.exclude.map((k) => label(E.GENRES.find((g) => g.k === k))).join(', ')) : 'Nessun genere escluso') + '</span></summary>'
      + '<div class="chips">' + E.GENRES.map((g) => chip('wheel-ex', g.k, label(g), wp.exclude.includes(g.k), 'no')).join('') + '</div>'
      + '<span class="field-label" style="margin-top:14px">Quanti titoli sulla ruota</span>' + seg('wheel-size', [['4', '4'], ['6', '6'], ['8', '8']], String(wp.size))
      + '<p class="small muted" style="margin-top:8px">Valgono solo per la ruota e restano salvati su questo telefono.</p></details>';
  }
  function drawWheel(root, s) {
    const head = '<div class="sheet full wheel-page" role="dialog" aria-modal="true" aria-label="Scegli per me"><div class="sheet-head"><button class="close" data-act="close" aria-label="Chiudi">×</button></div>';
    if (s.phase === 'loading') { root.innerHTML = head + '<h1>La ruota</h1><p aria-live="polite">' + esc(s.msg) + '</p><div class="loading-line"><i></i></div></div>'; return; }
    if (s.phase === 'error') { root.innerHTML = head + '<h1>Ruota ferma</h1><p>' + esc(s.msg) + '</p></div>'; return; }
    if (s.phase === 'empty') {
      root.innerHTML = head + '<h1>Troppo pochi titoli</h1><p>Per girare servono almeno due titoli che rispettano i filtri.</p>' + wheelControls()
        + (s.notes || []).map((n) => '<p class="note">' + esc(n) + '</p>').join('')
        + '<button class="btn" style="width:100%;margin-top:16px" data-act="close">Modifica i filtri</button></div>';
      return;
    }
    if (s.phase === 'verdict') {
      const it = s.lock.item;
      const jolly = jollyMax() - (s.lock.usedJolly || 0);
      root.innerHTML = head + (s.reveal ? '<div class="curtain" aria-hidden="true" style="z-index:40"><i></i><i></i></div>' : '')
        + '<div class="verdict"><p class="lead-label">Stasera si guarda</p>' + poster(it, 'w500', true) + '<h1>' + esc(it.title) + '</h1><p class="meta muted" style="margin-top:8px">' + esc(metaLine(it)) + '</p></div>'
        + '<div style="text-align:left">' + reasonsHtml(it) + plot(it) + trailerHtml(it) + '<div class="offers">' + offersHtml(it) + '</div>'
        + '<p class="locked">La ruota ha deciso: si può girare di nuovo domani. Unica eccezione: se lo avete già visto.' + (jolly > 0 ? ' Vi resta anche ' + jolly + ' jolly per questa sera.' : '') + '</p>'
        + '<div class="actions"><button class="btn wide" data-act="verdict-done">L\'abbiamo visto, ora lo votiamo</button>'
        + '<button class="btn" data-act="verdict-seen">Già visto, rigira</button>'
        + (jolly > 0 ? '<button class="btn" data-act="verdict-jolly">Usa il jolly</button>' : '')
        + '</div></div></div>';
      if (s.reveal) { s.reveal = false; setTimeout(() => { const c = document.querySelector('.wheel-page .curtain'); if (c) c.remove(); }, 900); }
      return;
    }
    const thumbs = s.slices.map((sl) => {
      const a = sl.mid * 360;
      return sl.item.poster ? '<img class="wheel-thumb" alt="" src="' + IMG + 'w92' + sl.item.poster + '" style="transform:rotate(' + a.toFixed(1) + 'deg) translateY(-190%)">' : '';
    }).join('');
    root.innerHTML = head + '<h1>La ruota</h1><p>Quello che esce si guarda. Gli spicchi più grandi sono i titoli più adatti a voi.</p>'
      + (s.phase === 'ready' ? wheelControls() : '')
      + '<div class="wheel-wrap"><div class="wheel-pointer"></div><div class="wheel" id="wheel" style="background:' + wheelCss(s.slices) + '">' + thumbs + '</div>'
      + '<button class="wheel-hub" data-act="spin" id="spin-btn">' + (s.phase === 'spinning' ? '…' : 'Gira') + '</button></div>'
      + '<ul class="wheel-names">' + s.slices.map((sl, i) => '<li><i style="background:' + PALETTE[i % PALETTE.length] + '"></i><span>' + esc(sl.item.title) + '</span><span>' + Math.round(sl.frac * 100) + '%</span></li>').join('') + '</ul>'
      + (s.notes || []).map((n) => '<p class="note">' + esc(n) + '</p>').join('') + '</div>';
  }
  function finishSpin(s, idx) {
    const item = s.slices[idx].item;
    const lock = { night: X.nightId(), item, usedJolly: s.ctx.usedJolly || 0, exclude: s.ctx.exclude || [], at: Date.now() };
    S.set('wheelLock', lock);
    if (navigator.vibrate) { try { navigator.vibrate(80); } catch (e) { /* non disponibile */ } }
    if (app.sheet === s) { s.phase = 'verdict'; s.lock = lock; s.reveal = true; renderSheet(); }
  }
  function spin(s) {
    if (s.phase !== 'ready') return;
    s.phase = 'spinning';
    const idx = X.pickSlice(s.slices, Math.random());
    const deg = X.spinDegrees(s.slices[idx], Math.random(), 7);
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = $('wheel');
    $('spin-btn').disabled = true;
    $('spin-btn').textContent = '…';
    if (reduced || !el) { finishSpin(s, idx); return; }
    el.classList.add('spinning');
    requestAnimationFrame(() => { el.style.transform = 'rotate(' + deg + 'deg)'; });
    setTimeout(() => finishSpin(s, idx), 5300);
  }

  /* ---------- Account ---------- */
  function accountHtml(s) {
    if (!Y.configured()) {
      return '<div class="account"><h3>Account condiviso</h3><p class="small muted">Non è ancora attivo: serve il progetto Firebase descritto in LEGGIMI. Intanto l\'app funziona su questo telefono.</p></div>';
    }
    const me = Y.session();
    if (me) {
      const st = S.get('syncStatus', {});
      const when = st.at ? new Date(st.at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
      return '<div class="account"><h3>Il vostro account</h3><p>' + esc(me.email) + '</p>'
        + (st.error ? '<p class="status-bad">' + esc(st.error) + '</p>' : when ? '<p class="status-ok">Sincronizzato il ' + when + '</p>' : '')
        + '<div class="row-buttons"><button type="button" class="btn" data-act="sync-now"' + (s.syncing ? ' disabled' : '') + '>' + (s.syncing ? 'Sincronizzo' : 'Sincronizza ora') + '</button><button type="button" class="btn" data-act="sign-out">Esci</button></div></div>';
    }
    const signup = s.authMode === 'signup';
    return '<form id="account-form" class="account"><h3>' + (signup ? 'Crea il vostro account' : 'Accedi al vostro account') + '</h3>'
      + '<p class="small muted">' + (signup ? 'Createlo una volta sola, poi accedete con le stesse credenziali da entrambi i telefoni.' : 'Usate la stessa email e password su entrambi i telefoni.') + '</p>'
      + '<input class="text-in" id="acc-email" type="email" autocomplete="username" autocapitalize="none" placeholder="Email" aria-label="Email" value="' + esc(s.authEmail || '') + '">'
      + '<input class="text-in" id="acc-pass" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" placeholder="Password' + (signup ? ', almeno 6 caratteri' : '') + '" aria-label="Password">'
      + (s.authError ? '<p class="status-bad" role="alert">' + esc(s.authError) + '</p>' : '')
      + (s.authInfo ? '<p class="status-ok">' + esc(s.authInfo) + '</p>' : '')
      + '<button class="btn account-go"' + (s.authBusy ? ' disabled' : '') + '>' + (s.authBusy ? 'Attendi' : signup ? 'Crea account' : 'Accedi') + '</button>'
      + '<div class="search-tools"><button type="button" class="link-btn" data-act="auth-mode">' + (signup ? 'Ho già un account' : 'Crea un account') + '</button>'
      + (signup ? '' : '<button type="button" class="link-btn" data-act="auth-reset">Password dimenticata</button>') + '</div></form>';
  }
  function afterAccountChange() {
    app.providers = null;
    const f = E.defaultFilters();
    app.filters = Object.assign(f, S.get('filters', {}));
    app.filters.weights = Object.assign(E.defaultFilters().weights, app.filters.weights);
    loadProviders(true);
    keepScroll(renderSheet);
    render();
  }
  /** Quando arrivano dati dall'altro telefono: aggiorna, senza disturbare chi sta scrivendo. */
  Y.onRemoteChange(() => {
    if (!(A.keys().tmdb || '').trim()) return;
    if (!app.providers) loadProviders(true);
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
    if (!app.sheet && !typing && app.tab !== 'results') render();
  });

  /* ---------- Impostazioni aggiuntive ---------- */
  function settingsExtraHtml() {
    const p = A.profilesOf();
    const prefs = S.get('prefs', {});
    const canNotify = !!(window.Android && window.Android.syncBackground);
    const invite = window.POPPICK_SITE ? '<div class="setting"><h3>Invita un amico</h3><p>Invia il link: da lì installa PopPick su Android o iPhone e crea il suo account, con dati separati dai vostri.</p><button type="button" class="btn" data-act="invite">Condividi il link</button></div>' : '';
    return invite + '<div class="setting"><h3>Profili</h3><div class="twin"><label><span class="field-label">Primo profilo</span><input class="text-in" data-profile="0" maxlength="20" value="' + esc(p[0].name) + '"></label>'
      + '<label><span class="field-label">Secondo profilo</span><input class="text-in" data-profile="1" maxlength="20" value="' + esc(p[1].name) + '"></label></div></div>'
      + '<div class="setting"><h3>La ruota</h3><span class="field-label">Jolly per sera: quante volte potete rifiutare il titolo uscito</span>' + seg('jolly', [['0', 'Nessuno'], ['1', '1'], ['2', '2']], String(jollyMax())) + '</div>'
      + '<div class="setting"><h3>Niente spoiler</h3><label class="switch"><span>Nascondi la trama finché non la apro</span><input type="checkbox" data-pref="hidePlot" ' + (prefs.hidePlot ? 'checked' : '') + '></label></div>'
      + '<div class="setting"><h3>Notifiche</h3>' + (canNotify ? '' : '<p>Disponibili solo nell\'app installata.</p>')
      + '<label class="switch"><span>Un titolo salvato o con avviso arriva sulle vostre piattaforme</span><input type="checkbox" data-pref="notifyList" ' + (prefs.notifyList ? 'checked' : '') + '></label>'
      + '<label class="switch"><span>Nuova stagione di una serie che seguite</span><input type="checkbox" data-pref="notifySeries" ' + (prefs.notifySeries ? 'checked' : '') + '></label>'
      + '<label class="switch"><span>Il venerdì sera, promemoria per girare la ruota</span><input type="checkbox" data-pref="notifyFriday" ' + (prefs.notifyFriday ? 'checked' : '') + '></label></div>'
      + '<div class="setting"><h3>Importa ciò che avete già visto</h3><p>File CSV di Netflix (cronologia), Letterboxd (ratings o watched) o IMDb (ratings). I voti vanno nel profilo scelto.</p>'
      + '<div class="row-buttons"><label class="file-btn">Importa per ' + esc(p[0].name) + '<input type="file" accept=".csv,text/csv,text/comma-separated-values,text/plain" data-import="p1"></label><label class="file-btn">Importa per ' + esc(p[1].name) + '<input type="file" accept=".csv,text/csv,text/comma-separated-values,text/plain" data-import="p2"></label></div></div>'
      + '<div class="setting"><h3>Backup su file</h3><p>Copia di sicurezza di liste, voti e serie, senza le chiavi. Importandola, i dati si uniscono a quelli presenti.</p>'
      + '<div class="row-buttons"><button type="button" class="btn" data-act="backup">Salva il backup</button><label class="file-btn">Importa un backup<input type="file" accept=".json,application/json,text/plain,application/octet-stream" id="restore"></label></div></div>';
  }
  function saveTextFile(name, text) {
    if (window.Android && window.Android.saveFile) { window.Android.saveFile(name, text); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  window.onFileSaved = function (ok) { toast(ok ? 'Backup salvato' : 'Backup non salvato'); };
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }
  async function handleImport(input, pid) {
    const file = input.files && input.files[0];
    if (!file) return;
    const text = await readFile(file);
    const parsed = X.parseHistory(text);
    if (!parsed.source || !parsed.rows.length) { toast('File non riconosciuto: serve il CSV di Netflix, Letterboxd o IMDb'); return; }
    toast('Importo da ' + parsed.source + ': ' + parsed.rows.length + ' titoli');
    try {
      const r = await A.importHistory(parsed, pid, (d, t) => toast('Importo: ' + d + ' di ' + t));
      toast('Importati: ' + plural(r.ok, 'titolo', 'titoli') + (r.missed ? ', non riconosciuti: ' + r.missed : '') + (r.truncated ? ', oltre il limite di 500: ' + r.truncated : ''));
      if (app.tab !== 'results') render();
    } catch (e) { toast(e instanceof A.UserError ? e.message : 'Importazione non riuscita.'); }
  }
  async function handleRestore(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const o = JSON.parse(await readFile(file));
      if (!X.validBackup(o)) throw new Error('bad');
      const local = {};
      X.BACKUP_KEYS.forEach((k) => { local[k] = S.get(k, undefined); });
      const merged = X.mergeBackup(local, o.data);
      Object.entries(merged).forEach(([k, v]) => { if (v !== undefined) S.set(k, v); });
      toast('Backup importato e unito ai dati del telefono');
      render();
    } catch (e) { toast('Questo file non è un backup di PopPick'); }
  }
  let lastBg = '';
  function syncBackground() {
    if (!(window.Android && window.Android.syncBackground)) return;
    const prefs = S.get('prefs', {});
    const payload = JSON.stringify({
      tmdb: (A.keys().tmdb || '').trim(), providers: app.filters.providers,
      watchlist: watchList().slice(0, 60).map((x) => ({ key: x.key, id: x.id, kind: x.kind, title: x.title })),
      alerts: alertList().filter((a) => !a.foundOn).slice(0, 60).map((a) => ({ key: a.key, id: a.id, kind: a.kind, title: a.title })),
      tracked: trackedList().filter((t) => t.lastAired).map((t) => ({ key: t.key, id: t.id, title: t.title, season: (t.lastAired && t.lastAired.season) || t.season })),
      notifyList: !!prefs.notifyList, notifySeries: !!prefs.notifySeries, notifyFriday: !!prefs.notifyFriday,
    });
    if (payload !== lastBg) { lastBg = payload; window.Android.syncBackground(payload); }
  }

  /* ---------- Eventi ---------- */
  const actions = {
    go() { go(); },
    settings() { openSheet({ type: 'settings' }); },
    close() {
      if (app.sheet && app.sheet.back) { app.sheet = app.sheet.back; renderSheet(); return; }
      closeSheet();
      refreshAll();
    },
    zoom(_, el) { app.sheet = { type: 'zoom', src: el.dataset.src, back: app.sheet }; renderSheet(); },
    style(v) { toggleIn(app.filters.styles, v); setFilters({}); render(); },
    viewers(v) { S.set('viewers', v); render(); },
    'year-from'(v) { setFilters({ yearFrom: +v || null }); render(); },
    'clear-end'() { setFilters({ endTime: null }); render(); },
    'auth-mode'() { const s = app.sheet; s.authEmail = $('acc-email').value; s.authMode = s.authMode === 'signup' ? 'login' : 'signup'; s.authError = s.authInfo = null; keepScroll(renderSheet); },
    async 'auth-reset'() {
      const s = app.sheet;
      s.authEmail = $('acc-email').value.trim();
      s.authError = s.authInfo = null;
      if (!s.authEmail) { s.authError = 'Scrivi la tua email, poi tocca di nuovo Password dimenticata.'; keepScroll(renderSheet); return; }
      try { await Y.resetPassword(s.authEmail); s.authInfo = 'Se l\'email è registrata, riceverai il link per cambiare la password.'; }
      catch (e) { s.authError = e.message; }
      keepScroll(renderSheet);
    },
    async 'sync-now'() {
      const s = app.sheet;
      s.syncing = true; keepScroll(renderSheet);
      try { await Y.syncNow(); toast('Dati sincronizzati'); } catch (e) { toast(e.message); }
      s.syncing = false;
      if (app.sheet === s) keepScroll(renderSheet);
    },
    async 'sign-out'() {
      try {
        await Y.signOut();
        app.sheet = { type: 'settings' };
        afterAccountChange();
        toast('Sei uscito: i dati restano nel vostro account');
      } catch (e) { toast(e.message + ' Per uscire serve la connessione, così non si perde nulla.'); }
    },
    wheel: openWheel,
    'install-skip'() { S.set('installSeen', true); closeSheet(); welcome(); },
    invite() {
      const url = window.POPPICK_SITE;
      const text = 'Prova PopPick per scegliere film e serie: ' + url;
      if (window.Android && window.Android.shareText) { window.Android.shareText(text); return; }
      if (navigator.share) { navigator.share({ title: 'PopPick', text, url }).catch(() => {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Indirizzo copiato')).catch(() => toast(url));
      else toast(url);
    },
    'tv-help'() { app.sheet = { type: 'tv', back: app.sheet }; renderSheet(); },
    spin() { if (app.sheet && app.sheet.type === 'wheel') spin(app.sheet); },
    'wheel-ex'(v) {
      const wp = wheelPrefs();
      wp.exclude = wp.exclude.includes(v) ? wp.exclude.filter((x) => x !== v) : wp.exclude.concat(v);
      S.set('wheelPrefs', wp);
      prepareWheel(app.sheet.ctx || { usedJolly: 0 }).then(() => { const d = document.querySelector('.wheel-opts'); if (d) d.open = true; });
    },
    'wheel-size'(v) {
      const wp = wheelPrefs();
      wp.size = +v;
      S.set('wheelPrefs', wp);
      const s = app.sheet;
      if (s && s.all && s.phase === 'ready') {
        s.slices = X.wheelSlices(s.all, wp.size);
        keepScroll(renderSheet);
        const d = document.querySelector('.wheel-opts'); if (d) d.open = true;
      }
    },
    'verdict-seen'() {
      const s = app.sheet;
      const it = s.lock.item;
      const list = S.get('seen', []);
      if (!inList(list, it.key)) { list.unshift(slim(it)); S.set('seen', list); }
      S.set('wheelLock', null);
      prepareWheel({ usedJolly: s.lock.usedJolly || 0, exclude: s.lock.exclude || [] });
    },
    'verdict-jolly'() {
      const s = app.sheet;
      const used = (s.lock.usedJolly || 0) + 1;
      if (used > jollyMax()) return;
      const exclude = (s.lock.exclude || []).concat(s.lock.item.key);
      S.set('wheelLock', null);
      prepareWheel({ usedJolly: used, exclude });
    },
    'verdict-done'() {
      const lock = app.sheet.lock;
      openRate(lock.item, { verdict: true });
    },
    'rate-verdict'() { const p = pendingVerdict(); if (p) openRate(p.item, { verdict: true }); },
    'skip-verdict'() { const l = S.get('wheelLock', null); if (l) { l.rated = true; S.set('wheelLock', l); } render(); },
    rate(_, el) { const it = findItem(el.dataset.key); if (it) openRate(it, { back: app.sheet }); },
    star(v, el) { app.sheet.votes[el.dataset.pid] = +v; keepScroll(renderSheet); },
    'star-none'(_, el) { delete app.sheet.votes[el.dataset.pid]; keepScroll(renderSheet); },
    async 'rate-save'() {
      const s = app.sheet;
      let it = s.item;
      if (!it.keywordList) { try { it = await A.details(it); } catch (e) { /* si salva senza caratteristiche */ } }
      const votes = {};
      A.profilesOf().forEach((p) => { votes[p.id] = s.votes[p.id] == null ? null : s.votes[p.id]; });
      A.saveRating(it, votes);
      if (s.verdict) { const l = S.get('wheelLock', null); if (l && l.item.key === it.key) { l.rated = true; S.set('wheelLock', l); } }
      toast('Voti salvati');
      app.sheet = s.back && s.back.type !== 'rate' ? s.back : null;
      renderSheet();
      if (app.tab !== 'results' || !app.sheet) render();
    },
    teach() {
      const s = { type: 'teach', index: 0, votes: {} };
      openSheet(s);
      teachLoad(s);
    },
    async 'teach-save'() {
      const s = app.sheet;
      const it0 = s.queue[s.index];
      if (Object.keys(s.votes).length) {
        let it = it0;
        try { it = await A.details(it0); } catch (e) { /* si salva senza caratteristiche */ }
        A.saveRating(it, s.votes);
      }
      actions['teach-next']();
    },
    'teach-next'() {
      const s = app.sheet;
      s.index++; s.votes = {};
      if (s.index >= s.queue.length - 2) teachLoad(s);
      renderSheet();
    },
    track(_, el) {
      const it = findItem(el.dataset.key);
      if (!it) return;
      const list = trackedList();
      if (!list.some((t) => t.key === it.key)) {
        list.unshift({ key: it.key, id: it.id, title: it.title, poster: it.poster, season: 1, episode: 1, seasonCounts: it.seasonCounts || {}, lastAired: it.lastAired || null, nextAir: it.nextAir || null, seenSeason: 0 });
        setTracked(list);
      }
      toast('Aggiunta a Serie in corso');
      refreshAll();
    },
    untrack(_, el) { setTracked(trackedList().filter((t) => t.key !== el.dataset.key)); refreshAll(); },
    'ep-next'(_, el) {
      updateTracked(el.dataset.key, (t) => Object.assign({ finished: false }, X.advanceEpisode(t), { seenSeason: t.season }));
      toast('Episodio segnato');
      refreshAll();
    },
    'ep-back'(_, el) {
      updateTracked(el.dataset.key, (t) => (t.episode > 1 ? { episode: t.episode - 1, finished: false } : t.season > 1 ? { season: t.season - 1, episode: (t.seasonCounts && t.seasonCounts[t.season - 1]) || 1, finished: false } : {}));
      refreshAll();
    },
    'detail-tracked'(_, el) { const t = trackedList().find((x) => x.key === el.dataset.key); if (t) showDetail({ key: t.key, id: t.id, kind: 'tv', title: t.title, poster: t.poster, overview: '', tmdbVote: 0, tmdbVotes: 0 }); },
    reveal(_, el) { app.revealed = app.revealed || new Set(); app.revealed.add(el.dataset.key); refreshAll(); },
    async summary(_, el) {
      const it = findItem(el.dataset.key) || (app.sheet && app.sheet.lock && app.sheet.lock.item);
      if (!it) return;
      toast('Scrivo il riassunto');
      try { await A.spoilerFree(it); refreshAll(); } catch (e) { toast(e.message || 'Riassunto non disponibile.'); }
    },
    jolly(v) { const p = S.get('prefs', {}); p.jolly = +v; S.set('prefs', p); keepScroll(renderSheet); },
    backup() {
      const data = {};
      X.BACKUP_KEYS.forEach((k) => { data[k] = S.get(k, undefined); });
      saveTextFile('poppick-backup-' + X.nightId() + '.json', JSON.stringify({ app: 'stasera', version: 1, at: new Date().toISOString(), data }));
    },
    tab(v) { app.tab = v; render(); window.scrollTo(0, 0); },
    preset(v) {
      if (app.preset === v) { app.filters = E.applyPreset(app.filters, null); app.preset = null; }
      else { app.filters = E.applyPreset(app.filters, v); app.preset = v; }
      saveFilters(); render();
    },
    type(v) { setFilters({ type: v }); render(); },
    provider(v) { toggleIn(app.filters.providers, +v); setFilters({}); render(); },
    genre(v) { toggleIn(app.filters.genres, v); app.filters.excludeGenres = app.filters.excludeGenres.filter((g) => g !== v); setFilters({}); render(); },
    nogenre(v) { toggleIn(app.filters.excludeGenres, v); app.filters.genres = app.filters.genres.filter((g) => g !== v); setFilters({}); render(); },
    genreMode(v) { setFilters({ genreMode: v }); render(); },
    peopleMode(v) { setFilters({ peopleMode: v }); render(); },
    tvStatus(v) { setFilters({ tvStatus: v }); render(); },
    runtime(v) { setFilters({ runtimeMax: +v || null }); render(); },
    seasons(v) { setFilters({ maxSeasons: +v || null }); render(); },
    language(v) { setFilters({ language: app.filters.language === v ? '' : v }); render(); },
    country(v) { setFilters({ country: app.filters.country === v ? '' : v }); render(); },
    rmperson(v) { setFilters({ people: app.filters.people.filter((p) => p.id !== +v) }); render(); },
    rmkeyword(v) { setFilters({ keywords: app.filters.keywords.filter((k) => k.id !== +v) }); render(); },
    addperson(v, el) { setFilters({ people: app.filters.people.concat({ id: +v, name: el.dataset.name }) }); render(); },
    addkeyword(v, el) { setFilters({ keywords: app.filters.keywords.concat({ id: +v, name: el.dataset.name }) }); render(); },
    reset() { app.filters = E.applyPreset(app.filters, null); app.preset = null; saveFilters(); render(); toast('Filtri azzerati'); },
    'save-search'() { openSheet({ type: 'save' }); },
    open(_, el) { openExternal(el.dataset.url); },
    next() { app.heroIndex++; renderResults(); window.scrollTo(0, 0); },
    relax(v) { setFilters(app.results.hints[+v].patch); go(); },
    detail(_, el) { showDetail(findItem(el.dataset.key)); },
    'detail-ref'(_, el) { showDetail(findItem(el.dataset.key)); },
    'detail-similar'(_, el) { showDetail(findItem(el.dataset.key)); },
    seen(_, el) {
      const key = el.dataset.key;
      const added = toggleList('seen', key);
      if (added) toast('Segnato come già visto: non verrà più proposto');
      const seenItem = added ? findItem(key) : null;
      if (added && app.results) {
        app.results.items = app.results.items.filter((x) => x.key !== key);
        if (app.results.items.length === 0) app.results.hints = E.relaxHints({}, app.filters);
        app.heroIndex = 0;
      }
      if (app.sheet && added) closeSheet(); else if (app.sheet) renderSheet();
      render();
      if (seenItem) openRate(seenItem);
    },
    watch(_, el) {
      const added = toggleList('watchlist', el.dataset.key);
      toast(added ? 'Salvato nella lista Da vedere' : 'Tolto dalla lista Da vedere');
      if (app.sheet) { const t = document.querySelector('.sheet').scrollTop; renderSheet(); document.querySelector('.sheet').scrollTop = t; }
      if (app.tab !== 'search') { const y = window.scrollY; render(); window.scrollTo(0, y); }
    },
    'rm-watch'(_, el) { toggleList('watchlist', el.dataset.key); render(); },
    'rm-seen'(_, el) { toggleList('seen', el.dataset.key); render(); },
    'rm-hidden'(_, el) { toggleList('hidden', el.dataset.key); render(); },
    'rm-alerts'(_, el) { toggleList('alerts', el.dataset.key); render(); },
    alert(_, el) {
      const added = toggleList('alerts', el.dataset.key);
      if (added) {
        toast(window.Android ? 'Ti arriverà una notifica quando è disponibile' : 'Lo vedrai qui quando apri l\'app');
        if (window.Android && window.Android.requestNotifications) window.Android.requestNotifications();
      } else toast('Avviso tolto');
      if (app.sheet) keepScroll(renderSheet);
      const y = window.scrollY; render(); window.scrollTo(0, y);
    },
    'alert-ok'(_, el) {
      S.set('alerts', alertList().filter((a) => a.key !== el.dataset.key));
      const y = window.scrollY; render(); window.scrollTo(0, y);
    },
    'detail-alert'(_, el) { const a = alertList().find((x) => x.key === el.dataset.key); if (a) showDetail(Object.assign({ overview: '', tmdbVote: 0, tmdbVotes: 0 }, a)); },
    'news-mode'(v) { app.news.mode = v; app.news.provider = 0; loadNews(true); },
    'news-kind'(v) { app.news.kind = v; loadNews(true); },
    'news-prov'(v) { app.news.provider = +v; loadNews(true); },
    'news-more'() { loadNews(false); },
    hide(_, el) {
      const key = el.dataset.key;
      const added = toggleList('hidden', key);
      toast(added ? 'Non verrà più proposto. Lo ritrovi in Liste' : 'Di nuovo tra le proposte');
      if (added && app.results) {
        app.results.items = app.results.items.filter((x) => x.key !== key);
        if (app.results.ctx) app.results.ctx.kept = app.results.ctx.kept.filter((x) => x.key !== key);
        if (app.results.items.length === 0) app.results.hints = E.relaxHints({}, app.filters);
        app.heroIndex = 0;
      }
      if (app.sheet && added && app.sheet.type === 'detail') closeSheet(); else if (app.sheet) keepScroll(renderSheet);
      const y = window.scrollY; render(); window.scrollTo(0, y);
    },
    'similar-search'(_, el) {
      const it = findItem(el.dataset.key);
      if (!it) return;
      app.sheet = null; renderSheet();
      go(it);
    },
    sort(v) { app.sortBy = v; const y = window.scrollY; renderResults(); window.scrollTo(0, y); },
    async more() {
      const r = app.results;
      const others = r.items.length - 1;
      if (others > app.showCount) { app.showCount += 20; const y = window.scrollY; renderResults(); window.scrollTo(0, y); return; }
      app.loadingMore = true;
      let y = window.scrollY; renderResults(); window.scrollTo(0, y);
      try {
        const added = await A.more(r, app.filters);
        if (!added) toast('Non ci sono altri titoli con questi filtri');
        app.showCount += 20;
      } catch (e) { toast(e.message || 'Non riesco a caricare altri titoli.'); }
      app.loadingMore = false;
      if (app.results === r && app.tab === 'results') { y = window.scrollY; renderResults(); window.scrollTo(0, y); }
    },
    'rm-saved'(v) { const l = savedList(); l.splice(+v, 1); S.set('saved', l); render(); },
    'run-saved'(v) {
      const s = savedList()[+v];
      if (!s) return;
      app.filters = Object.assign(E.defaultFilters(), s.filters); app.preset = null; saveFilters(); go();
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) { ev.preventDefault(); fn(el.dataset.val, el); }
  });
  // Copertina che non si carica: al suo posto il titolo.
  document.addEventListener('error', (ev) => {
    const el = ev.target;
    if (el.tagName === 'IMG' && el.classList.contains('poster')) {
      const d = document.createElement('div');
      d.className = 'poster none';
      d.textContent = (el.alt || '').replace('Copertina di ', '');
      el.replaceWith(d);
    }
  }, true);
  document.addEventListener('toggle', (ev) => {
    const g = ev.target.dataset && ev.target.dataset.group;
    if (!g) return;
    if (ev.target.open) app.openGroups.add(g); else app.openGroups.delete(g);
  }, true);
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.weight) {
      const k = el.dataset.weight;
      app.filters.weights[k] = +el.value; app.preset = null;
      $('w-' + k).textContent = el.value;
      el.closest('.fader').style.setProperty('--v', el.value + '%');
      saveFilters();
    } else if (el.dataset.slider) {
      const k = el.dataset.slider;
      app.filters[k] = +el.value; app.preset = null;
      $('out-' + k).textContent = SLIDER_FMT[k](el.value);
      saveFilters();
    } else if (el.dataset.num) {
      const n = parseInt(el.value, 10);
      app.filters[el.dataset.num] = n >= 1900 && n <= 2100 ? n : null;
      app.preset = null; saveFilters();
    } else if (el.id === 'person-q') lookup(el.value, A.searchPeople, 'person-hits', 'addperson', app.filters.people);
    else if (el.id === 'title-q') lookupTitle(el.value);
    else if (el.id === 'keyword-q') lookup(el.value, A.searchKeywords, 'keyword-hits', 'addkeyword', app.filters.keywords);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.id === 'end-time') { setFilters({ endTime: el.value || null }); render(); return; }
    if (el.dataset.import) { handleImport(el, el.dataset.import); return; }
    if (el.id === 'restore') { handleRestore(el); return; }
    if (el.dataset.profile != null) {
      const list = A.profilesOf();
      list[+el.dataset.profile].name = el.value.trim() || list[+el.dataset.profile].name;
      S.set('profiles', list);
      render();
      return;
    }
    if (el.dataset.pref) {
      const p = S.get('prefs', {});
      p[el.dataset.pref] = el.checked;
      S.set('prefs', p);
      if (el.checked && el.dataset.pref.startsWith('notify') && window.Android && window.Android.requestNotifications) window.Android.requestNotifications();
      syncBackground();
      if (el.dataset.pref === 'hidePlot') render();
      return;
    }
    if (!el.dataset.check) return;
    if (el.dataset.check === 'hidden') setFilters({ maxVotes: el.checked ? 2500 : null });
    else setFilters({ [el.dataset.check]: el.checked });
    render();
  });
  let titleTimer;
  function lookupTitle(q) {
    clearTimeout(titleTimer);
    const box = $('title-hits');
    if (q.trim().length < 2) { box.innerHTML = ''; app.titleHits = []; return; }
    titleTimer = setTimeout(async () => {
      try {
        app.titleHits = await A.searchTitles(q.trim());
        const target = $('title-hits');
        if (!target) return;
        target.innerHTML = app.titleHits.length ? app.titleHits.map((h) => '<button data-act="detail" data-key="' + esc(h.key) + '">'
          + (h.poster ? '<img alt="" src="' + IMG + 'w92' + h.poster + '">' : '<span class="noimg"></span>')
          + '<span>' + esc(h.title) + ' <span class="muted small">' + (h.kind === 'tv' ? 'Serie' : 'Film') + (h.year ? ', ' + h.year : '') + '</span></span></button>').join('')
          : '<p class="empty-line">Nessun titolo con questo nome.</p>';
      } catch (e) { toast(e.message || 'Ricerca non riuscita.'); }
    }, 350);
  }
  let lookupTimer;
  function lookup(q, fn, targetId, act, picked) {
    clearTimeout(lookupTimer);
    const target = $(targetId);
    if (q.trim().length < 2) { target.innerHTML = ''; return; }
    lookupTimer = setTimeout(async () => {
      try {
        const hits = (await fn(q.trim())).filter((h) => !picked.some((p) => p.id === h.id));
        const box = $(targetId);
        if (!box) return;
        box.innerHTML = hits.length ? hits.map((h) => '<button data-act="' + act + '" data-val="' + h.id + '" data-name="' + esc(h.name) + '">'
          + (act === 'addperson' ? (h.photo ? '<img alt="" src="' + IMG + 'w92' + h.photo + '">' : '<span class="noimg"></span>') : '')
          + '<span>' + esc(h.name) + (h.dept ? ' <span class="muted small">' + (h.dept === 'Directing' ? 'regia' : h.dept === 'Acting' ? 'attore o attrice' : '') + '</span>' : '') + '</span></button>').join('')
          : '<p class="empty-line">Nessun risultato per questa ricerca.</p>';
      } catch (e) { toast(e.message || 'Ricerca non riuscita.'); }
    }, 320);
  }
  document.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (ev.target.id === 'ask') {
      const t = $('ask-text').value.trim();
      if (t) askAI(t);
    } else if (ev.target.id === 'save-form') {
      const name = $('save-name').value.trim();
      if (!name) return;
      const l = savedList();
      l.unshift({ name, filters: JSON.parse(JSON.stringify(app.filters)) });
      S.set('saved', l);
      closeSheet();
      toast('Ricerca salvata: la trovi in Liste');
    } else if (ev.target.id === 'account-form') {
      const s = app.sheet;
      const email = $('acc-email').value.trim();
      const pass = $('acc-pass').value;
      s.authEmail = email; s.authError = s.authInfo = null; s.authBusy = true;
      keepScroll(renderSheet);
      try {
        if (s.authMode === 'signup') await Y.signUp(email, pass); else await Y.signIn(email, pass);
        app.sheet = { type: 'settings' };
        afterAccountChange();
        toast('Accesso effettuato');
      } catch (e) {
        s.authBusy = false; s.authError = e.message || 'Accesso non riuscito.';
        if (Y.session()) { app.sheet = { type: 'settings' }; afterAccountChange(); toast(s.authError); }
        else keepScroll(renderSheet);
      }
    } else if (ev.target.id === 'keys-form') {
      const k = { tmdb: $('key-tmdb').value.trim(), omdb: $('key-omdb').value.trim(), claude: $('key-claude').value.trim() };
      S.set('keys', k);
      app.sheet = { type: 'settings', testing: true };
      renderSheet();
      const test = await A.testKeys(k);
      app.sheet = { type: 'settings', test };
      renderSheet();
      if (test.tmdb) loadProviders(true);
      render();
    }
  });

  // Tasto indietro di Android: chiude la scheda, poi torna ai filtri, poi esce.
  window.onOpenIntent = function (what) { if (what === 'wheel') { app.tab = 'search'; render(); openWheel(); } };
  window.onAndroidBack = function () {
    if (app.sheet) { actions.close(); return true; }
    if (app.tab !== 'search') { app.tab = 'search'; render(); return true; }
    return false;
  };

  async function loadProviders(force) {
    if ((app.providers && !force) || !(A.keys().tmdb || '').trim()) return;
    try {
      app.providers = await A.providersIT();
      if (app.tab === 'search') { const y = window.scrollY; renderSearch(); window.scrollTo(0, y); }
    } catch (e) { /* il riquadro resta in attesa; la ricerca segnalerà l'errore */ }
  }

  function renderTabs() {
    const tabs = [['search', 'Cerca', icon.search], ['results', 'Proposte', icon.star], ['news', 'Novità', icon.news], ['lists', 'Liste', icon.list]];
    $('tabs').innerHTML = tabs.map(([k, l, ic]) => '<button data-act="tab" data-val="' + k + '"' + (app.tab === k ? ' aria-current="page"' : '') + '>' + ic + '<span>' + l + '</span></button>').join('');
  }
  function render() {
    const y = window.scrollY;
    renderTabs();
    if (app.tab === 'search') { renderSearch(); window.scrollTo(0, y); }
    else if (app.tab === 'results') renderResults();
    else if (app.tab === 'news') renderNews();
    else renderLists();
    syncBackground();
  }

  render();
  loadProviders();
  // Sincronizza all'apertura, al ritorno nell'app e ogni minuto mentre è aperta.
  async function runAlertCheck(force) {
    try {
      const found = await A.checkAlerts(app.filters.providers, force);
      if (found.length) {
        toast(found.length === 1 ? found[0].title + ' è arrivato su ' + found[0].foundOn : found.length + ' titoli con avviso sono arrivati in streaming');
        if (!app.sheet && app.tab !== 'results') { const y = window.scrollY; render(); window.scrollTo(0, y); }
      }
    } catch (e) { /* si riprova al prossimo avvio */ }
  }
  setTimeout(() => runAlertCheck(false), 1500);
  window.onAppResume = () => { Y.syncNow().catch(() => {}); runAlertCheck(false); };
  window.onAppPause = () => { Y.syncNow().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') window.onAppResume(); else window.onAppPause(); });
  if (Y.session()) window.onAppResume();
  setInterval(() => { if (document.visibilityState === 'visible') Y.syncNow().catch(() => {}); }, 60000);
  A.refreshTracked(false).then(() => { if (app.tab === 'search' && !app.sheet) render(); }).catch(() => {});
  function welcome() {
    const needsAccount = Y.configured() && !Y.session() && !S.get('welcomeSeen', false);
    if (!(A.keys().tmdb || '').trim() || needsAccount) {
      S.set('welcomeSeen', true);
      openSheet({ type: 'settings', authMode: 'signup' });
    }
  }
  const installed = !!window.Android || navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  if (!installed && !S.get('installSeen', false)) openSheet({ type: 'install' });
  else welcome();
})();
