/* Stasera: logica pura (filtri, parametri API, punteggio, spiegazioni). Nessun accesso a rete o DOM. */
(function (root) {
  'use strict';

  // TMDB usa id diversi per film e serie; "t: null" = genere che non esiste per le serie.
  const GENRES = [
    { k: 'azione', n: 'Azione', m: 28, t: 10759 },
    { k: 'avventura', n: 'Avventura', m: 12, t: 10759 },
    { k: 'animazione', n: 'Animazione', m: 16, t: 16 },
    { k: 'commedia', n: 'Commedia', m: 35, t: 35 },
    { k: 'crime', n: 'Crime', m: 80, t: 80 },
    { k: 'documentario', n: 'Documentario', m: 99, t: 99 },
    { k: 'dramma', n: 'Dramma', m: 18, t: 18 },
    { k: 'famiglia', n: 'Famiglia', m: 10751, t: 10751 },
    { k: 'fantascienza', n: 'Fantascienza', m: 878, t: 10765 },
    { k: 'fantasy', n: 'Fantasy', m: 14, t: 10765 },
    { k: 'guerra', n: 'Guerra', m: 10752, t: 10768 },
    { k: 'horror', n: 'Horror', m: 27, t: null, tk: 'horror' },
    { k: 'mistero', n: 'Mistero', m: 9648, t: 9648 },
    { k: 'musica', n: 'Musica', m: 10402, t: null, tk: 'music' },
    { k: 'romantico', n: 'Romantico', m: 10749, t: null, tk: 'romance' },
    { k: 'storia', n: 'Storia', m: 36, t: null, tk: 'historical' },
    { k: 'thriller', n: 'Thriller', m: 53, t: null, tk: 'thriller' },
    { k: 'western', n: 'Western', m: 37, t: 37 },
  ];

  /*
   * Stili: un titolo vi rientra se ha tutti i generi indicati e almeno una delle etichette.
   * Le etichette sono i nomi inglesi di TMDB: l'app ne ricava gli id con /search/keyword.
   */
  const st = (k, n, genres, kws) => ({ k, n, genres, kws });
  const STYLE_GROUPS = [
    { n: 'Horror', items: [
      st('horror-psico', 'Horror psicologico', ['horror'], ['psychological horror', 'psychological thriller', 'psychological']),
      st('soprannaturale', 'Soprannaturale', ['horror'], ['supernatural', 'supernatural horror']),
      st('fantasmi', 'Fantasmi e case infestate', [], ['ghost', 'haunted house']),
      st('possessioni', 'Demoni e possessioni', [], ['demonic possession', 'demon', 'exorcism']),
      st('zombie', 'Zombie', [], ['zombie']),
      st('vampiri', 'Vampiri', [], ['vampire']),
      st('slasher', 'Slasher', [], ['slasher']),
      st('survival', 'Sopravvivenza', [], ['survival', 'survival horror']),
    ] },
    { n: 'Fantascienza', items: [
      st('spazio', 'Spazio', [], ['space', 'outer space', 'space travel']),
      st('alieni', 'Alieni', [], ['alien', 'alien invasion']),
      st('tempo', 'Viaggi nel tempo', [], ['time travel', 'time loop']),
      st('distopia', 'Distopia', [], ['dystopia']),
      st('postapocalittico', 'Post-apocalittico', [], ['post-apocalyptic future', 'apocalypse']),
      st('cyberpunk', 'Cyberpunk', [], ['cyberpunk']),
      st('ia', 'Intelligenza artificiale e robot', [], ['artificial intelligence (a.i.)', 'artificial intelligence', 'robot']),
      st('paralleli', 'Mondi paralleli', [], ['parallel world', 'alternate reality', 'multiverse']),
    ] },
    { n: 'Thriller e crime', items: [
      st('thriller-psico', 'Thriller psicologico', [], ['psychological thriller']),
      st('serial', 'Serial killer', [], ['serial killer']),
      st('giallo', 'Giallo da risolvere', [], ['whodunit', 'murder mystery', 'detective']),
      st('colpi', 'Colpi di scena', [], ['plot twist', 'twist ending']),
      st('rapina', 'Rapine e colpi grossi', [], ['heist']),
      st('mafia', 'Mafia e criminalità', [], ['mafia', 'organized crime', 'gangster']),
      st('spie', 'Spionaggio', [], ['espionage', 'spy']),
      st('noir', 'Noir', [], ['film noir', 'neo-noir']),
      st('tribunale', 'Processi e tribunali', [], ['courtroom', 'legal thriller']),
    ] },
    { n: 'Commedia e sentimenti', items: [
      st('romcom', 'Commedia romantica', [], ['romcom', 'romantic comedy']),
      st('nera', 'Commedia nera', [], ['dark comedy', 'black comedy']),
      st('satira', 'Satira', [], ['satire', 'political satire']),
      st('formazione', 'Storie di crescita', [], ['coming of age']),
      st('feelgood', 'Fa stare bene', [], ['feel-good', 'heartwarming']),
      st('famiglie', 'Famiglie complicate', [], ['dysfunctional family', 'family drama']),
    ] },
    { n: 'Fede e spiritualità', items: [
      st('spirituale', 'Spirituali', [], ['spirituality', 'religion', 'faith', 'christianity', 'christian', 'bible', 'biblical', 'biblical epic', 'jesus christ']),
      st('cristiano', 'Cristiani e biblici', [], ['christianity', 'christian', 'christian film', 'bible', 'biblical', 'biblical epic', 'jesus christ']),
    ] },
    { n: 'Storie vere e mondi', items: [
      st('costume', 'Film in costume', [], ['period drama', 'costume drama', 'period piece', 'historical fiction']),
      st('vero', 'Tratto da una storia vera', [], ['based on true story', 'true crime']),
      st('biografia', 'Biografico', [], ['biography']),
      st('libro', 'Tratto da un libro', [], ['based on novel or book']),
      st('ww2', 'Seconda guerra mondiale', [], ['world war ii']),
      st('medioevo', 'Medioevo', [], ['medieval']),
      st('antichita', 'Antica Roma e Grecia', [], ['ancient rome', 'ancient greece']),
      st('supereroi', 'Supereroi', [], ['superhero']),
      st('magia', 'Magia', [], ['magic']),
      st('marziali', 'Arti marziali', [], ['martial arts']),
      st('sport', 'Sport', [], ['sports']),
      st('viaggio', 'On the road', [], ['road trip', 'road movie']),
      st('cucina', 'Cucina', [], ['cooking', 'food']),
      st('natale', 'Natale', [], ['christmas']),
    ] },
  ];
  const STYLES = STYLE_GROUPS.reduce((a, g) => a.concat(g.items), []);
  const styleOf = (k) => STYLES.find((x) => x.k === k);

  const LANGUAGES = [
    ['it', 'Italiano'], ['en', 'Inglese'], ['fr', 'Francese'], ['es', 'Spagnolo'],
    ['de', 'Tedesco'], ['ko', 'Coreano'], ['ja', 'Giapponese'],
  ];
  const COUNTRIES = [
    ['IT', 'Italia'], ['US', 'Stati Uniti'], ['GB', 'Regno Unito'], ['FR', 'Francia'],
    ['ES', 'Spagna'], ['KR', 'Corea del Sud'], ['JP', 'Giappone'],
  ];

  const CRITERIA = [
    { k: 'audience', n: 'Pubblico' },
    { k: 'critic', n: 'Critica' },
    { k: 'popularity', n: 'Fama' },
    { k: 'recency', n: 'Novità' },
    { k: 'taste', n: 'Gusti' },
  ];

  function defaultFilters() {
    return {
      type: 'both', providers: [], includePaid: false, onlyAvailable: true, beyondSubs: false, onlyFree: false,
      genres: [], styles: [], genreMode: 'all', excludeGenres: [],
      yearFrom: null, yearTo: null, runtimeMin: null, runtimeMax: null,
      minAudience: 60, minVotes: 100, maxVotes: null, minCritic: 0,
      people: [], peopleMode: 'any', keywords: [], language: '', country: '',
      tvStatus: 'any', maxSeasons: null,
      weights: { audience: 70, critic: 50, popularity: 25, recency: 25, taste: 60 },
      endTime: null,
    };
  }

  const PRESETS = [
    { k: 'sicuro', n: 'Non si sbaglia', patch: { minAudience: 75, minVotes: 1000, weights: { audience: 80, critic: 80, popularity: 30, recency: 10 } } },
    { k: 'leggero', n: 'Leggero e breve', patch: { genres: ['commedia', 'famiglia', 'animazione'], genreMode: 'any', excludeGenres: ['horror', 'guerra'], runtimeMax: 110, minAudience: 62, weights: { audience: 80, critic: 20, popularity: 40, recency: 30 } } },
    { k: 'gemme', n: 'Gemme nascoste', patch: { minAudience: 72, minVotes: 100, maxVotes: 2500, weights: { audience: 80, critic: 70, popularity: 0, recency: 15 } } },
    { k: 'critica', n: 'Amato dalla critica', patch: { minCritic: 80, minAudience: 60, type: 'movie', weights: { audience: 30, critic: 100, popularity: 0, recency: 10 } } },
    { k: 'tensione', n: 'Tensione', patch: { genres: ['thriller', 'crime', 'mistero', 'horror'], genreMode: 'any', minAudience: 65, weights: { audience: 75, critic: 45, popularity: 30, recency: 35 } } },
    { k: 'novita', n: 'Appena usciti', patch: { yearFromOffset: 1, minAudience: 60, minVotes: 50, weights: { audience: 60, critic: 35, popularity: 40, recency: 100 } } },
    { k: 'miniserie', n: 'Serie da finire presto', patch: { type: 'tv', tvStatus: 'ended', maxSeasons: 2, minAudience: 72, minVotes: 200, weights: { audience: 90, critic: 30, popularity: 30, recency: 20 } } },
  ];

  /** Applica un punto di partenza: azzera i filtri ma conserva piattaforme e impostazioni di streaming. */
  function applyPreset(current, presetKey, now) {
    const preset = PRESETS.find((p) => p.k === presetKey);
    const next = defaultFilters();
    next.providers = current.providers.slice();
    next.includePaid = current.includePaid;
    next.onlyAvailable = current.onlyAvailable;
    next.beyondSubs = current.beyondSubs;
    next.onlyFree = current.onlyFree;
    if (!preset) return next;
    const patch = Object.assign({}, preset.patch);
    if (patch.yearFromOffset != null) {
      next.yearFrom = (now || new Date()).getFullYear() - patch.yearFromOffset;
      delete patch.yearFromOffset;
    }
    return Object.assign(next, patch);
  }

  function genreIds(keys, kind) {
    const field = kind === 'movie' ? 'm' : 't';
    const ids = [];
    let missing = 0;
    keys.forEach((k) => {
      const g = GENRES.find((x) => x.k === k);
      if (!g) return;
      if (g[field] == null) missing++;
      else if (!ids.includes(g[field])) ids.push(g[field]);
    });
    return { ids, missing };
  }

  /** Le etichette TMDB da cercare per i filtri scelti. */
  function neededTerms(f, kind) {
    const out = new Set();
    (f.styles || []).forEach((k) => { const x = styleOf(k); if (x) x.kws.forEach((t) => out.add(t)); });
    (f.genres || []).forEach((k) => { const g = GENRES.find((x) => x.k === k); if (g && g.tk) out.add(g.tk); });
    return [...out];
  }
  const termIds = (terms, kwMap) => terms.map((t) => kwMap[t]).filter(Boolean);

  /** Un requisito per ogni spunta: generi obbligatori più etichette alternative. */
  function ticksFor(f, kind, kwMap) {
    const ticks = [];
    const unavailable = [];
    const field = kind === 'movie' ? 'm' : 't';
    const genreToTick = (key) => {
      const g = GENRES.find((x) => x.k === key);
      if (!g) return null;
      if (g[field] != null) return { name: g.n, g: [g[field]], kw: [] };
      const kw = g.tk ? termIds([g.tk], kwMap) : [];
      return kw.length ? { name: g.n, g: [], kw } : null;
    };
    (f.genres || []).forEach((key) => {
      const t = genreToTick(key);
      if (t) ticks.push(Object.assign(t, { fromGenre: true }));
      else unavailable.push((GENRES.find((x) => x.k === key) || {}).n || key);
    });
    (f.styles || []).forEach((k) => {
      const x = styleOf(k);
      if (!x) return;
      const kw = termIds(x.kws, kwMap);
      // Senza etichette su TMDB resta il genere, se c'è; le serie non hanno il genere horror.
      const g = [];
      let missingGenre = false;
      x.genres.forEach((key) => {
        const id = (GENRES.find((y) => y.k === key) || {})[field];
        if (id != null) g.push(id); else missingGenre = true;
      });
      if (!kw.length && (!g.length || missingGenre)) { unavailable.push(x.n); return; }
      ticks.push({ name: x.n, g, kw, style: x.k });
    });
    (f.keywords || []).forEach((k) => ticks.push({ name: k.name, g: [], kw: [k.id] }));
    return { ticks, unavailable };
  }

  /**
   * Le interrogazioni da fare a TMDB. "Tutti insieme" moltiplica le etichette alternative
   * delle spunte, perché TMDB non accetta gruppi come (A o B) e (C o D).
   */
  function buildSpecs(f, kind, kwMap) {
    const map = kwMap || {};
    const { ticks, unavailable } = ticksFor(f, kind, map);
    const asked = (f.genres || []).length + (f.styles || []).length + (f.keywords || []).length;
    if (!asked) return { specs: [{}], unavailable };
    if (f.genreMode === 'all') {
      if (unavailable.length) return { specs: [], unavailable };
      const genres = [...new Set(ticks.reduce((a, t) => a.concat(t.g), []))];
      const withKw = ticks.filter((t) => t.kw.length);
      if (withKw.length === 1) return { specs: [{ withGenres: genres.join(',') || undefined, withKeywords: withKw[0].kw.join('|') }], unavailable };
      let combos = [[]];
      withKw.forEach((t) => {
        const next = [];
        combos.forEach((c) => t.kw.slice(0, 3).forEach((id) => { if (!c.includes(id)) next.push(c.concat(id)); else next.push(c); }));
        combos = next;
      });
      const seen = new Set();
      const specs = [];
      combos.forEach((c) => {
        const kw = c.join(',');
        if (seen.has(kw) || specs.length >= 8) return;
        seen.add(kw);
        specs.push({ withGenres: genres.join(',') || undefined, withKeywords: kw || undefined });
      });
      return { specs, unavailable };
    }
    const specs = [];
    const plainGenres = ticks.filter((t) => t.fromGenre && t.g.length);
    if (plainGenres.length) specs.push({ withGenres: [...new Set(plainGenres.reduce((a, t) => a.concat(t.g), []))].join('|') });
    ticks.filter((t) => !(t.fromGenre && t.g.length)).forEach((t) => {
      specs.push({ withGenres: t.g.join(',') || undefined, withKeywords: t.kw.join('|') || undefined });
    });
    return { specs: specs.slice(0, 8), unavailable };
  }

  /** Quali tipi cercare davvero, e perché uno è stato saltato. */
  function planKinds(f, kwMap) {
    const kinds = f.type === 'both' ? ['movie', 'tv'] : [f.type];
    const out = [];
    const notes = [];
    kinds.forEach((kind) => {
      const { specs, unavailable } = buildSpecs(f, kind, kwMap);
      if (specs.length) {
        if (unavailable.length) notes.push((kind === 'tv' ? 'Per le serie ' : 'Per i film ') + 'ignoro: ' + unavailable.join(', ') + '.');
        out.push(kind);
      } else if (f.type === 'tv') {
        notes.push('Per le serie non trovo una categoria per: ' + unavailable.join(', ') + '. Prova con altri stili.');
      } else if (f.type === 'both' && kind === 'tv') {
        notes.push('Cerco solo film: per le serie non trovo una categoria per ' + unavailable.join(', ') + '.');
      } else if (f.type === 'movie' || kind === 'movie') {
        notes.push('Per i film non trovo una categoria per: ' + unavailable.join(', ') + '.');
      }
    });
    return { kinds: out, notes };
  }

  /** Quali stili scelti ha un titolo, leggendo generi ed etichette della sua scheda. */
  function styleHits(it, f, kwMap) {
    const hits = [];
    let possible = 0;
    const kwSet = new Set(it.keywordIds || []);
    const gSet = new Set(it.genreIds || []);
    const field = it.kind === 'movie' ? 'm' : 't';
    (f.styles || []).forEach((k) => {
      const x = styleOf(k);
      if (!x) return;
      const kw = termIds(x.kws, kwMap || {});
      const g = x.genres.map((key) => (GENRES.find((y) => y.k === key) || {})[field]);
      const usableG = g.filter((id) => id != null);
      if (!kw.length && (!usableG.length || usableG.length < g.length)) return;
      possible++;
      const okG = usableG.every((id) => gSet.has(id));
      const okK = !kw.length || kw.some((id) => kwSet.has(id));
      if (okG && okK) hits.push(x.n);
    });
    return { hits, possible };
  }

  function monetization(f) {
    return (f.includePaid ? ['flatrate', 'free', 'ads', 'rent', 'buy'] : ['flatrate', 'free', 'ads']).join('|');
  }

  /** Margine sul voto TMDB: il filtro finale usa anche IMDb, quindi non scartiamo troppo presto. */
  function buildDiscover(f, kind, sort, page, spec) {
    const q = spec || buildSpecs(f, kind, {}).specs[0] || {};
    const p = { language: 'it-IT', include_adult: 'false', page: String(page), sort_by: sort };
    let minVotes = f.minVotes || 0;
    if (sort === 'vote_average.desc') minVotes = Math.max(minVotes, 100);
    if (minVotes) p['vote_count.gte'] = String(minVotes);
    if (f.maxVotes) p['vote_count.lte'] = String(f.maxVotes);
    if (f.minAudience) p['vote_average.gte'] = String(Math.max(0, f.minAudience / 10 - 0.5));

    if (q.withGenres) p.with_genres = q.withGenres;
    if (q.withKeywords) p.with_keywords = q.withKeywords;
    const exc = genreIds(f.excludeGenres, kind);
    if (exc.ids.length) p.without_genres = exc.ids.join(',');

    const dateField = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
    if (f.yearFrom) p[dateField + '.gte'] = f.yearFrom + '-01-01';
    if (f.yearTo) p[dateField + '.lte'] = f.yearTo + '-12-31';
    if (f.runtimeMin) p['with_runtime.gte'] = String(f.runtimeMin);
    if (f.runtimeMax) p['with_runtime.lte'] = String(f.runtimeMax);
    if (f.language) p.with_original_language = f.language;
    if (f.country) p.with_origin_country = f.country;

    if (f.onlyFree) {
      p.watch_region = 'IT';
      p.with_watch_monetization_types = 'free|ads';
    } else if (f.providers.length && !f.beyondSubs) {
      p.with_watch_providers = f.providers.join('|');
      p.watch_region = 'IT';
      p.with_watch_monetization_types = monetization(f);
    }
    if (kind === 'movie') {
      p.region = 'IT';
      if (f.people.length) p.with_people = f.people.map((x) => x.id).join(f.peopleMode === 'all' ? ',' : '|');
    } else {
      if (f.tvStatus === 'ended') p.with_status = '3|4';
      if (f.tvStatus === 'returning') p.with_status = '0';
    }
    return p;
  }

  /** Le classifiche da cui pescare i candidati, secondo ciò che conta per voi. */
  function planPools(f) {
    const pools = [
      { sort: 'vote_average.desc', pages: 3 },
      { sort: 'popularity.desc', pages: 2 },
    ];
    if (f.weights.recency >= 50) {
      pools.push({ sort: 'primary_release_date.desc', pages: 2 });
    }
    return pools;
  }
  function poolSort(sort, kind) {
    return sort === 'primary_release_date.desc' && kind === 'tv' ? 'first_air_date.desc' : sort;
  }

  /**
   * TMDB non filtra le serie per attore: partiamo dalla filmografia della persona
   * e applichiamo qui i filtri che altrove farebbe il server.
   */
  function filterTvCredits(creditLists, f) {
    const lists = creditLists.map((credits) => {
      const seen = new Map();
      (credits.cast || []).concat(credits.crew || []).forEach((r) => seen.set(r.id, r));
      return seen;
    });
    if (!lists.length) return [];
    let rows;
    if (f.peopleMode === 'all') {
      rows = [...lists[0].values()].filter((r) => lists.every((m) => m.has(r.id)));
    } else {
      const u = new Map();
      lists.forEach((m) => m.forEach((r, id) => u.set(id, r)));
      rows = [...u.values()];
    }
    const inc = genreIds(f.genres, 'tv').ids;
    const exc = genreIds(f.excludeGenres, 'tv').ids;
    return rows.filter((r) => {
      const g = r.genre_ids || [];
      if (inc.length) {
        const ok = f.genreMode === 'all' ? inc.every((x) => g.includes(x)) : inc.some((x) => g.includes(x));
        if (!ok) return false;
      }
      if (exc.some((x) => g.includes(x))) return false;
      if ((r.vote_count || 0) < (f.minVotes || 0)) return false;
      if (f.maxVotes && r.vote_count > f.maxVotes) return false;
      if (f.minAudience && (r.vote_average || 0) < f.minAudience / 10 - 0.5) return false;
      const year = parseInt((r.first_air_date || '').slice(0, 4), 10);
      if (f.yearFrom && !(year >= f.yearFrom)) return false;
      if (f.yearTo && !(year <= f.yearTo)) return false;
      if (f.language && r.original_language !== f.language) return false;
      return true;
    });
  }

  /** Riga di /discover o /credits ridotta ai campi che servono. */
  function normalizeRow(r, kind) {
    const date = (kind === 'movie' ? r.release_date : r.first_air_date) || '';
    return {
      key: kind + ':' + r.id, id: r.id, kind,
      title: (kind === 'movie' ? r.title : r.name) || r.title || r.name || 'Senza titolo',
      date, year: date ? parseInt(date.slice(0, 4), 10) : null,
      overview: r.overview || '', poster: r.poster_path || null,
      tmdbVote: r.vote_average || 0, tmdbVotes: r.vote_count || 0,
      genreIds: r.genre_ids || [],
    };
  }

  /** Aggiunge alla riga i dettagli di /movie/{id} o /tv/{id} con append_to_response. */
  function mergeDetails(item, d) {
    const it = (d['watch/providers'] && d['watch/providers'].results && d['watch/providers'].results.IT) || null;
    const credits = d.credits || {};
    const crew = credits.crew || [];
    const videos = (d.videos && d.videos.results) || [];
    const trailer = pickTrailer(videos);
    const kwBlock = d.keywords || {};
    const kwList = kwBlock.keywords || kwBlock.results || [];
    const directors = item.kind === 'movie'
      ? crew.filter((c) => c.job === 'Director').map((c) => c.name)
      : (d.created_by || []).map((c) => c.name);
    return Object.assign({}, item, {
      overview: d.overview || item.overview,
      poster: d.poster_path || item.poster,
      genres: (d.genres || []).map((g) => g.name),
      genreIds: d.genres ? d.genres.map((g) => g.id) : item.genreIds,
      keywordIds: kwList.map((k) => k.id),
      keywordList: kwList.map((k) => ({ id: k.id, name: k.name })),
      certification: certOf(d, item.kind),
      warnings: warningsOf(kwList.map((k) => k.name)),
      pace: paceOf(kwList.map((k) => k.name)),
      lastAired: d.last_episode_to_air ? { season: d.last_episode_to_air.season_number, episode: d.last_episode_to_air.episode_number } : null,
      nextAir: d.next_episode_to_air ? d.next_episode_to_air.air_date || null : null,
      seasonCounts: (d.seasons || []).reduce((o, x) => { if (x.season_number > 0) o[x.season_number] = x.episode_count; return o; }, {}),
      runtime: item.kind === 'movie' ? d.runtime || null : ((d.episode_run_time || [])[0] || (d.last_episode_to_air && d.last_episode_to_air.runtime) || null),
      seasons: d.number_of_seasons || null,
      status: d.status || null,
      imdbId: d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || null,
      cast: (credits.cast || []).slice(0, 8).map((c) => c.name),
      directors,
      providers: it,
      trailer,
    });
  }

  /** Età consigliata: prima quella italiana, altrimenti quella statunitense, indicando il paese. */
  function certOf(d, kind) {
    const pick = (country) => {
      if (kind === 'movie') {
        const c = ((d.release_dates && d.release_dates.results) || []).find((r) => r.iso_3166_1 === country);
        const hit = c && (c.release_dates || []).find((x) => x.certification);
        return hit ? hit.certification : null;
      }
      const c = ((d.content_ratings && d.content_ratings.results) || []).find((r) => r.iso_3166_1 === country);
      return c && c.rating ? c.rating : null;
    };
    const it = pick('IT');
    if (it) return { value: it, country: 'Italia' };
    const us = pick('US');
    return us ? { value: us, country: 'USA' } : null;
  }

  const WARNINGS = [
    [/\bgore\b|splatter|torture|mutilation|dismember/i, 'scene molto cruente'],
    [/graphic violence|brutality|extreme violence/i, 'violenza esplicita'],
    [/\brape\b|sexual assault|sexual abuse/i, 'violenza sessuale'],
    [/suicide|self[- ]harm/i, 'suicidio o autolesionismo'],
    [/child abuse|child death|death of a child/i, 'violenza o morte di bambini'],
    [/animal cruelty|animal abuse|animal death/i, 'violenza sugli animali'],
    [/drug addiction|heroin|overdose/i, 'droga e dipendenze'],
    [/nudity|erotic|sex scene|softcore/i, 'nudo o scene di sesso esplicite'],
  ];
  function warningsOf(names) {
    return WARNINGS.filter(([re]) => names.some((n) => re.test(n))).map(([, label]) => label);
  }
  function paceOf(names) {
    if (names.some((n) => /slow burn|slow[- ]paced/i.test(n))) return 'lento';
    if (names.some((n) => /fast[- ]paced|non[- ]stop action/i.test(n))) return 'veloce';
    return null;
  }

  /** Minuti da adesso all'ora di fine; se l'ora è già passata vale per domani notte. */
  function availableMinutes(f, now) {
    if (!f.endTime || !/^\d{2}:\d{2}$/.test(f.endTime)) return null;
    const n = now || new Date();
    const [h, m] = f.endTime.split(':').map(Number);
    let mins = h * 60 + m - (n.getHours() * 60 + n.getMinutes());
    if (mins <= 0) mins += 24 * 60;
    return mins;
  }
  function fmtClock(date) {
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  /** Il miglior video: trailer italiano, poi teaser italiano, altrimenti il trailer originale. */
  function pickTrailer(videos) {
    const yt = (videos || []).filter((v) => v.site === 'YouTube' && v.key);
    const it = yt.filter((v) => v.iso_639_1 === 'it');
    const best = it.find((v) => v.type === 'Trailer') || it.find((v) => v.type === 'Teaser')
      || yt.find((v) => v.type === 'Trailer') || yt.find((v) => v.type === 'Teaser');
    return best ? { key: best.key, italian: best.iso_639_1 === 'it', lang: best.iso_639_1 || '' } : null;
  }
  function trailerSearchUrl(it) {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(it.title + ' ' + (it.year || '') + ' trailer italiano');
  }

  function parseOmdb(o) {
    if (!o || o.Response === 'False') return { imdb: null, imdbVotes: 0, rt: null, mc: null };
    const num = (s) => { const n = parseFloat(String(s || '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
    const rating = (src) => { const r = (o.Ratings || []).find((x) => x.Source === src); return r ? r.Value : null; };
    return {
      imdb: num(o.imdbRating),
      imdbVotes: num(o.imdbVotes) || 0,
      rt: num(rating('Rotten Tomatoes')),
      mc: num(o.Metascore) != null ? num(o.Metascore) : num(rating('Metacritic')),
    };
  }

  /** Media con prudenza: pochi voti non bastano per stare in cima. */
  function shrink(avg10, votes, m, prior) {
    return (votes * avg10 + m * prior) / (votes + m);
  }

  function audienceRaw(it) {
    const vals = [];
    if (it.tmdbVotes > 0) vals.push(it.tmdbVote * 10);
    if (it.imdb != null) vals.push(it.imdb * 10);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  function audienceRanked(it) {
    const vals = [];
    if (it.tmdbVotes > 0) vals.push(shrink(it.tmdbVote, it.tmdbVotes, 200, 6.5) * 10);
    if (it.imdb != null) vals.push(shrink(it.imdb, it.imdbVotes || 0, 2000, 6.5) * 10);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  function criticRaw(it) {
    const vals = [it.rt, it.mc].filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  function fame(it) { return Math.max(it.tmdbVotes || 0, it.imdbVotes || 0); }

  /** Classifica: ogni criterio va da 0 a 100 e pesa quanto dice il suo cursore. */
  function rank(items, weights, now) {
    const year = (now || new Date()).getFullYear();
    const maxFame = Math.max(1, ...items.map(fame));
    const anyCritic = items.some((i) => criticRaw(i) != null);
    const anyTaste = items.some((i) => i.taste != null);
    let w = {
      audience: weights.audience, critic: anyCritic ? weights.critic : 0,
      popularity: weights.popularity, recency: weights.recency,
      taste: anyTaste ? (weights.taste == null ? 60 : weights.taste) : 0,
    };
    if (Object.values(w).every((v) => !v)) w = { audience: 1, critic: anyCritic ? 1 : 0, popularity: 1, recency: 1 };
    const total = Object.values(w).reduce((a, b) => a + b, 0);

    return items.map((it) => {
      const aud = audienceRanked(it);
      const crit = criticRaw(it);
      const c = {
        audience: aud == null ? 50 : aud,
        critic: crit == null ? 50 : crit, // senza dati: né premio né condanna
        popularity: Math.log10(fame(it) + 1) / Math.log10(maxFame + 1) * 100,
        recency: it.year ? Math.max(0, Math.min(100, 100 - (year - it.year) * 2.5)) : 30,
        taste: it.taste == null ? 50 : it.taste,
      };
      const parts = {};
      let match = 0;
      Object.keys(w).forEach((k) => {
        parts[k] = c[k] * w[k] / total;
        match += parts[k];
      });
      return Object.assign({}, it, { match: Math.min(100, Math.round(match + (it.styleBonus || 0))), parts, components: c });
    }).sort((a, b) => b.match - a.match || fame(b) - fame(a));
  }

  /** Filtri finali, dopo aver raccolto i dettagli. Conta anche cosa ha scartato ogni filtro. */
  function finalFilter(items, f, ctx) {
    const seen = (ctx && ctx.seen) || new Set();
    const funnel = {};
    const drop = (r) => { funnel[r] = (funnel[r] || 0) + 1; };
    const kept = items.filter((it) => {
      if (seen.has(it.key)) return drop('seen'), false;
      if (ctx && ctx.tracked && ctx.tracked.has(it.key)) return drop('tracked'), false;
      if (it.stylePossible) {
        const need = f.genreMode === 'all' ? it.stylePossible : 1;
        if ((it.styleHits || []).length < need) return drop('style'), false;
      }
      const raw = audienceRaw(it);
      if (f.minAudience && raw != null && raw < f.minAudience) return drop('audience'), false;
      if (f.minCritic) {
        const crit = criticRaw(it);
        // Le serie raramente hanno voti della critica: filtriamo solo se il dato c'è.
        if (crit == null && it.kind === 'movie') return drop('criticMissing'), false;
        if (crit != null && crit < f.minCritic) return drop('critic'), false;
      }
      if (it.kind === 'tv' && f.maxSeasons && it.seasons && it.seasons > f.maxSeasons) return drop('seasons'), false;
      if (it.kind === 'tv' && f.tvStatus === 'ended' && it.status && !['Ended', 'Canceled'].includes(it.status)) return drop('status'), false;
      if (it.kind === 'tv' && f.tvStatus === 'returning' && it.status && it.status !== 'Returning Series') return drop('status'), false;
      if (ctx && ctx.available && it.runtime && it.runtime > ctx.available) return drop('time'), false;
      if (f.runtimeMax && it.runtime && it.runtime > f.runtimeMax) return drop('runtime'), false;
      if (f.runtimeMin && it.runtime && it.runtime < f.runtimeMin) return drop('runtime'), false;
      const offers = offersOf(it, f.includePaid || f.beyondSubs);
      if (f.onlyFree) {
        if (!offers.some((o) => o.mode !== 'abbonamento' && o.mode !== 'noleggio' && o.mode !== 'acquisto')) return drop('notFree'), false;
      } else if (f.providers.length && !f.beyondSubs && !offers.some((o) => f.providers.includes(o.provider_id))) return drop('provider'), false;
      if (f.onlyAvailable && !offers.length) return drop('unavailable'), false;
      return true;
    });
    return { kept, funnel };
  }

  /** Offerte in Italia, abbonamenti e gratis prima di noleggio e acquisto, senza doppioni. */
  function offersOf(it, includePaid) {
    const p = it.providers;
    if (!p) return [];
    const out = [];
    const add = (list, mode) => (list || []).forEach((o) => {
      if (!out.some((x) => x.provider_id === o.provider_id)) out.push(Object.assign({}, o, { mode }));
    });
    add(p.flatrate, 'abbonamento');
    add(p.free, 'gratis');
    add(p.ads, 'gratis con pubblicità');
    if (includePaid) {
      add(p.rent, 'noleggio');
      add(p.buy, 'acquisto');
    }
    return out;
  }

  /** Come si può vedere un titolo, rispetto agli abbonamenti scelti. */
  function accessOf(it, f) {
    const offers = offersOf(it, true);
    if (!offers.length) return null;
    const subs = f.providers || [];
    const flat = offers.filter((o) => o.mode === 'abbonamento');
    const free = offers.filter((o) => o.mode === 'gratis' || o.mode === 'gratis con pubblicità');
    const paid = offers.filter((o) => o.mode === 'noleggio' || o.mode === 'acquisto');
    const mine = flat.find((o) => subs.includes(o.provider_id));
    if (mine) return { kind: 'mine', text: 'Nei tuoi abbonamenti: ' + mine.provider_name };
    if (free.length) return { kind: 'free', text: (free[0].mode === 'gratis' ? 'Gratis su ' : 'Gratis con pubblicità su ') + free[0].provider_name };
    const prefix = subs.length ? 'Non nei tuoi abbonamenti: ' : '';
    if (flat.length) return { kind: subs.length ? 'other' : 'neutral', text: prefix + (subs.length ? 'è su ' : 'In abbonamento su ') + flat[0].provider_name };
    if (paid.length) return { kind: subs.length ? 'paid' : 'neutral', text: prefix + (subs.length ? 'noleggio o acquisto' : 'Noleggio o acquisto') };
    return null;
  }

  const SEARCH_URLS = [
    [/netflix/i, 'https://www.netflix.com/search?q='],
    [/amazon prime|prime video/i, 'https://www.primevideo.com/search?phrase='],
    [/disney/i, 'https://www.disneyplus.com/search?q='],
    [/apple tv/i, 'https://tv.apple.com/search?term='],
    [/paramount/i, 'https://www.paramountplus.com/search/?q='],
    [/mubi/i, 'https://mubi.com/search/films?query='],
    [/raiplay/i, 'https://www.raiplay.it/ricerca.html?q='],
  ];
  /** Link alla ricerca del titolo nel servizio; altrimenti la pagina TMDB con tutte le offerte. */
  function watchUrl(providerName, title, fallback) {
    const hit = SEARCH_URLS.find(([re]) => re.test(providerName || ''));
    return hit ? hit[1] + encodeURIComponent(title) : fallback;
  }

  const fmtVotes = (n) => Math.round(n).toLocaleString('it-IT');

  /** Le ragioni in chiaro, con i numeri veri. Include anche ciò che non convince. */
  function reasons(it, f, now) {
    const out = [];
    if (it.tasteBy && it.tasteBy.length) {
      out.push({ tone: it.taste >= 65 ? 'good' : it.taste < 45 ? 'warn' : 'neutral', c: 'taste', text: 'Gusti: ' + it.tasteBy.map((t) => t.name + ' ' + t.score).join(', ') + '.' + (it.tasteNote ? ' ' + it.tasteNote : '') });
    }
    if (it.seenBy && it.seenBy.length) out.push({ tone: 'warn', c: null, text: it.seenBy.join(' e ') + ' l\'ha già visto.' });
    if (it.styleHits && it.styleHits.length) out.push({ tone: 'good', c: null, text: 'Stile: ' + it.styleHits.join(', ') + '.' });
    const aud = audienceRaw(it);
    if (aud != null) {
      const sources = [];
      if (it.imdb != null) sources.push('IMDb ' + it.imdb.toLocaleString('it-IT') + '/10');
      if (it.tmdbVotes > 0) sources.push('TMDB ' + (Math.round(it.tmdbVote * 10) / 10).toLocaleString('it-IT') + '/10');
      out.push({ tone: aud >= 70 ? 'good' : aud < 60 ? 'warn' : 'neutral', c: 'audience', text: 'Pubblico: ' + sources.join(', ') + ', su ' + fmtVotes(fame(it)) + ' voti.' });
    }
    const crit = criticRaw(it);
    if (crit != null) {
      const sources = [];
      if (it.rt != null) sources.push('Rotten Tomatoes ' + it.rt + '%');
      if (it.mc != null) sources.push('Metacritic ' + it.mc + '/100');
      out.push({ tone: crit >= 70 ? 'good' : crit < 55 ? 'warn' : 'neutral', c: 'critic', text: 'Critica: ' + sources.join(', ') + '.' });
    } else {
      out.push({ tone: 'neutral', c: 'critic', text: 'Critica: nessun voto disponibile, quindi conta come neutra.' });
    }
    const names = (it.cast || []).concat(it.directors || []);
    const wanted = (f.people || []).filter((p) => names.includes(p.name)).map((p) => p.name);
    if (wanted.length) out.push({ tone: 'good', c: null, text: 'Con ' + wanted.join(' e ') + ', come avete chiesto.' });
    if (it.kind === 'tv' && it.seasons) {
      const ended = it.status === 'Ended' || it.status === 'Canceled';
      out.push({ tone: 'neutral', c: null, text: (it.seasons === 1 ? '1 stagione' : it.seasons + ' stagioni') + (ended ? ', conclusa.' : ', ancora in corso.') });
    }
    const avail = availableMinutes(f, now);
    if (it.kind === 'movie' && it.runtime) {
      const end = new Date((now || new Date()).getTime() + it.runtime * 60000);
      out.push({ tone: 'neutral', c: null, text: 'Dura ' + fmtRuntime(it.runtime) + (avail ? ': cominciando adesso finisce alle ' + fmtClock(end) + '.' : '.') });
    }
    if (it.kind === 'tv' && it.runtime && avail) {
      const n = Math.floor(avail / it.runtime);
      out.push({ tone: 'neutral', c: null, text: 'Prima delle ' + f.endTime + ' ' + (n === 1 ? 'riuscite a vedere 1 episodio' : 'riuscite a vedere ' + n + ' episodi') + ' da ' + it.runtime + ' minuti.' });
    }
    return out;
  }

  function fmtRuntime(min) {
    if (!min) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  }

  /** Se non resta nulla, propone di togliere il filtro che ha scartato di più. */
  function relaxHints(funnel, f) {
    const ticks = (f.genres || []).length + (f.styles || []).length + (f.keywords || []).length;
    const first = [];
    if (ticks > 1 && f.genreMode === 'all') first.push({ label: 'Basta che rispetti almeno una spunta', patch: { genreMode: 'any' } });
    const hints = {
      style: { label: 'Togli gli stili scelti', patch: { styles: [] } },
      notFree: { label: 'Togli il filtro Solo gratis', patch: { onlyFree: false } },
      time: { label: 'Togli l\'ora di fine', patch: { endTime: null } },
      audience: { label: 'Abbassa il voto del pubblico a ' + Math.max(0, (f.minAudience || 0) - 10), patch: { minAudience: Math.max(0, (f.minAudience || 0) - 10) } },
      critic: { label: 'Abbassa il voto della critica a ' + Math.max(0, (f.minCritic || 0) - 15), patch: { minCritic: Math.max(0, (f.minCritic || 0) - 15) } },
      criticMissing: { label: 'Togli il minimo della critica', patch: { minCritic: 0 } },
      provider: { label: 'Cerca su tutte le piattaforme', patch: { providers: [] } },
      unavailable: { label: 'Mostra anche i titoli non in streaming', patch: { onlyAvailable: false } },
      runtime: { label: 'Togli il limite di durata', patch: { runtimeMin: null, runtimeMax: null } },
      seasons: { label: 'Togli il limite di stagioni', patch: { maxSeasons: null } },
      status: { label: 'Accetta anche le serie in corso', patch: { tvStatus: 'any' } },
    };
    const fromFunnel = Object.entries(funnel)
      .filter(([r]) => hints[r])
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => Object.assign({ count: n }, hints[r]));
    if (fromFunnel.length) return first.concat(fromFunnel).slice(0, 3);
    // Il server non ha restituito nulla: allentiamo ciò che restringe di più.
    const out = first.slice();
    if ((f.styles || []).length) out.push({ label: 'Togli gli stili scelti', patch: { styles: [] } });
    if (f.people.length) out.push({ label: 'Togli attori e registi', patch: { people: [] } });
    if (f.keywords.length) out.push({ label: 'Togli gli altri temi', patch: { keywords: [] } });
    if (f.genres.length) out.push({ label: 'Togli i generi', patch: { genres: [] } });
    if (f.providers.length) out.push({ label: 'Cerca su tutte le piattaforme', patch: { providers: [] } });
    if (f.yearFrom || f.yearTo) out.push({ label: 'Togli il periodo', patch: { yearFrom: null, yearTo: null } });
    if (f.minAudience > 50) out.push({ label: 'Abbassa il voto del pubblico a 50', patch: { minAudience: 50 } });
    return out.slice(0, 3);
  }

  const AI_SYSTEM = [
    'Trasformi una richiesta in italiano su cosa guardare stasera in filtri JSON per un motore di ricerca di film e serie.',
    'Rispondi solo con un oggetto JSON, senza testo attorno. Includi solo i campi che la richiesta giustifica.',
    'Campi: type ("movie"|"tv"|"both"); genres e excludeGenres (array tra: ' + GENRES.map((g) => g.k).join(', ') + ');',
    'styles (array, solo tra: ' + STYLES.map((x) => x.k + ' = ' + x.n).join('; ') + '); genreMode ("all" se le richieste devono valere insieme, "any" se ne basta una);',
    'yearFrom, yearTo (interi); runtimeMax, runtimeMin (minuti); minAudience, minCritic (0-100); maxVotes (intero, basso per titoli poco noti);',
    'people (array di nomi completi di attori o registi); keywords (array di temi brevi IN INGLESE, es. "heist", "time travel");',
    'language (codice ISO 639-1); country (codice ISO 3166-1); tvStatus ("any"|"ended"|"returning"); maxSeasons (intero);',
    'weights (oggetto con audience, critic, popularity, recency da 0 a 100: quanto conta ciascuno).',
    'Non inventare vincoli non richiesti. "Leggero" indica commedia o famiglia ed esclude horror e guerra.',
  ].join('\n');

  /** Valida la risposta dell'AI: tiene solo campi noti e valori nei limiti. */
  function normalizeAI(raw) {
    const clean = {};
    const int = (v, lo, hi) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, Math.round(+v))) : undefined);
    const setInt = (k, lo, hi) => { const n = int(raw[k], lo, hi); if (n !== undefined) clean[k] = n; };
    if (['movie', 'tv', 'both'].includes(raw.type)) clean.type = raw.type;
    const gk = GENRES.map((g) => g.k);
    if (Array.isArray(raw.genres)) clean.genres = raw.genres.filter((g) => gk.includes(g));
    if (Array.isArray(raw.excludeGenres)) clean.excludeGenres = raw.excludeGenres.filter((g) => gk.includes(g));
    if (Array.isArray(raw.styles)) clean.styles = raw.styles.filter((k) => !!styleOf(k));
    if (['all', 'any'].includes(raw.genreMode)) clean.genreMode = raw.genreMode;
    setInt('yearFrom', 1900, 2100); setInt('yearTo', 1900, 2100);
    setInt('runtimeMax', 10, 400); setInt('runtimeMin', 0, 400);
    setInt('minAudience', 0, 100); setInt('minCritic', 0, 100);
    setInt('maxVotes', 1, 100000000); setInt('maxSeasons', 1, 50);
    if (typeof raw.language === 'string' && /^[a-z]{2}$/.test(raw.language)) clean.language = raw.language;
    if (typeof raw.country === 'string' && /^[A-Z]{2}$/.test(raw.country)) clean.country = raw.country;
    if (['any', 'ended', 'returning'].includes(raw.tvStatus)) clean.tvStatus = raw.tvStatus;
    if (raw.weights && typeof raw.weights === 'object') {
      const w = {};
      CRITERIA.forEach(({ k }) => { const n = int(raw.weights[k], 0, 100); if (n !== undefined) w[k] = n; });
      if (Object.keys(w).length) clean.weights = w;
    }
    const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 6) : []);
    return { filters: clean, peopleNames: names(raw.people), keywordNames: names(raw.keywords) };
  }

  /** Estrae il JSON anche se il modello lo avvolge in un blocco di codice. */
  function extractJson(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('no json');
    return JSON.parse(text.slice(start, end + 1));
  }

  const api = {
    accessOf, availableMinutes, certOf, warningsOf, paceOf, GENRES, STYLE_GROUPS, STYLES, neededTerms, buildSpecs, styleHits, pickTrailer, trailerSearchUrl, LANGUAGES, COUNTRIES, CRITERIA, PRESETS, AI_SYSTEM,
    defaultFilters, applyPreset, genreIds, planKinds, buildDiscover, planPools, poolSort,
    filterTvCredits, normalizeRow, mergeDetails, parseOmdb, audienceRaw, audienceRanked, criticRaw, fame,
    rank, finalFilter, offersOf, watchUrl, reasons, fmtRuntime, relaxHints, normalizeAI, extractJson,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
