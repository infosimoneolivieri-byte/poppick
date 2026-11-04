/* Stasera: account con email e password e sincronizzazione tra telefoni, tramite Firebase. */
(function (root) {
  'use strict';
  const A = root.Api;
  const X = root.Extras;
  const S = A.store;
  const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:';
  const TOKEN = 'https://securetoken.googleapis.com/v1/token';
  const FS = 'https://firestore.googleapis.com/v1/';
  const MAX_PART = 950000; // un documento Firestore arriva a 1 MiB
  class UserError extends A.UserError {}

  const cfg = () => root.FIREBASE_CONFIG || {};
  const configured = () => !!(cfg().apiKey && cfg().projectId);
  const session = () => S.get('session', null);

  const AUTH_ERRORS = {
    EMAIL_EXISTS: 'Esiste già un account con questa email. Scegli Accedi.',
    INVALID_LOGIN_CREDENTIALS: 'Email o password non corrette.',
    EMAIL_NOT_FOUND: 'Email o password non corrette.',
    INVALID_PASSWORD: 'Email o password non corrette.',
    WEAK_PASSWORD: 'La password deve avere almeno 6 caratteri.',
    INVALID_EMAIL: 'Questa email non è valida.',
    MISSING_EMAIL: 'Inserisci la tua email.',
    MISSING_PASSWORD: 'Inserisci la password.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Troppi tentativi. Riprova tra qualche minuto.',
    USER_DISABLED: 'Questo account è stato disattivato.',
    OPERATION_NOT_ALLOWED: 'In Firebase non è attivo l\'accesso con email e password: attivalo in Authentication.',
    ADMIN_ONLY_OPERATION: 'In Firebase la creazione di nuovi account è disattivata.',
  };
  function authMessage(code) {
    const key = String(code || '').split(' ')[0];
    if (AUTH_ERRORS[key]) return AUTH_ERRORS[key];
    if (/API_KEY|API key/i.test(code || '')) return 'Firebase ha rifiutato la configurazione: controlla apiKey in firebase-config.js.';
    return 'Firebase ha risposto con un errore (' + (key || 'sconosciuto') + ').';
  }
  async function post(url, headers, body) {
    try {
      return await A.http('POST', url, headers, body);
    } catch (e) {
      throw new UserError('Firebase non risponde. Controlla la connessione e riprova.');
    }
  }
  const parse = (t) => { try { return JSON.parse(t); } catch (e) { return {}; } };

  async function authCall(path, body) {
    const res = await post(AUTH + path + '?key=' + encodeURIComponent(cfg().apiKey), { 'content-type': 'application/json' }, JSON.stringify(body));
    const data = parse(res.text);
    if (res.status >= 400) throw new UserError(authMessage(data.error && data.error.message));
    return data;
  }
  function saveSession(d) {
    S.set('session', {
      uid: d.localId, email: d.email, idToken: d.idToken, refreshToken: d.refreshToken,
      exp: Date.now() + (parseInt(d.expiresIn, 10) || 3600) * 1000,
    });
    S.remove('syncBase');
  }
  async function signUp(email, password) {
    saveSession(await authCall('signUp', { email, password, returnSecureToken: true }));
    return syncNow();
  }
  async function signIn(email, password) {
    saveSession(await authCall('signInWithPassword', { email, password, returnSecureToken: true }));
    return syncNow();
  }
  async function resetPassword(email) {
    await authCall('sendOobCode', { requestType: 'PASSWORD_RESET', email });
  }

  async function token(force) {
    const s = session();
    if (!s) throw new UserError('Accedi al tuo account per sincronizzare.');
    if (!force && s.exp - Date.now() > 60000) return s.idToken;
    // Più richieste insieme condividono lo stesso rinnovo.
    if (!refreshing) refreshing = refresh(s).finally(() => { refreshing = null; });
    return refreshing;
  }
  let refreshing = null;
  async function refresh(s) {
    const res = await post(TOKEN + '?key=' + encodeURIComponent(cfg().apiKey),
      { 'content-type': 'application/x-www-form-urlencoded' },
      'grant_type=refresh_token&refresh_token=' + encodeURIComponent(s.refreshToken));
    const d = parse(res.text);
    if (res.status >= 400) {
      S.remove('session');
      throw new UserError('La sessione è scaduta: accedi di nuovo.');
    }
    S.set('session', Object.assign({}, s, {
      idToken: d.id_token, refreshToken: d.refresh_token,
      exp: Date.now() + (parseInt(d.expires_in, 10) || 3600) * 1000,
    }));
    return d.id_token;
  }

  const dbPath = () => 'projects/' + cfg().projectId + '/databases/(default)/documents';
  const partName = (part) => dbPath() + '/households/' + session().uid + '/parts/' + part;

  // Un documento non ancora creato è normale, e anche il suo messaggio contiene la parola "databases".
  const dbMissing = (msg) => /database[^/]*does not exist/i.test(msg);
  function firestoreError(status, body) {
    const msg = (body && body.error && body.error.message) || '';
    if (status === 403) return new UserError('Firebase ha negato l\'accesso ai dati: controlla le regole di Firestore indicate nella guida.');
    if (status === 404 && dbMissing(msg)) return new UserError('In Firebase manca il database Firestore: crealo seguendo la guida.');
    return new UserError('Firebase ha risposto con un errore (' + status + '). Riprova tra poco.');
  }
  async function fsRequest(method, url, body) {
    let res = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await token(attempt > 0);
      try {
        res = await A.http(method, url, { Authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body);
      } catch (e) {
        throw new UserError('Firebase non risponde. I dati restano sul telefono e si sincronizzeranno appena possibile.');
      }
      if (res.status !== 401) break;
    }
    return res;
  }
  async function readPart(part) {
    const res = await fsRequest('GET', FS + partName(part));
    const body = parse(res.text);
    if (res.status === 404 && !dbMissing((body.error && body.error.message) || '')) return { json: null, updateTime: null };
    if (res.status >= 400) throw firestoreError(res.status, body);
    return { json: (body.fields && body.fields.json && body.fields.json.stringValue) || null, updateTime: body.updateTime };
  }
  /** Scrive solo se il documento è ancora com'era quando l'abbiamo letto. */
  async function commit(writes) {
    const body = JSON.stringify({
      writes: writes.map((w) => ({
        update: { name: partName(w.part), fields: { json: { stringValue: w.json } } },
        currentDocument: w.updateTime ? { updateTime: w.updateTime } : { exists: false },
      })),
    });
    const res = await fsRequest('POST', FS + dbPath() + ':commit', body);
    if (res.status < 400) return true;
    const b = parse(res.text);
    const st = (b.error && b.error.status) || '';
    if (st === 'FAILED_PRECONDITION' || st === 'ABORTED' || st === 'ALREADY_EXISTS' || res.status === 409) return false;
    throw firestoreError(res.status, b);
  }

  const syncing = { busy: false, again: false, applying: false, timer: null, listeners: [] };
  const onRemoteChange = (fn) => syncing.listeners.push(fn);

  function localState() {
    const out = {};
    X.SYNC_KEYS.forEach((k) => { const v = S.get(k, undefined); if (v !== undefined) out[k] = v; });
    return out;
  }

  async function once() {
    const parts = X.SYNC_PARTS;
    const names = Object.keys(parts);
    const remoteDocs = {};
    await Promise.all(names.map(async (p) => { remoteDocs[p] = await readPart(p); }));

    const remote = {};
    names.forEach((p) => { if (remoteDocs[p].json) Object.assign(remote, parse(remoteDocs[p].json)); });
    const base = S.get('syncBase', null);
    // Da qui in poi nessuna attesa finché lo stato locale non è aggiornato.
    const local = localState();
    const merged = X.threeWay(base, local, remote);

    let changedLocal = false;
    syncing.applying = true;
    X.SYNC_KEYS.forEach((k) => {
      if (X.stable(merged[k]) !== X.stable(local[k])) {
        changedLocal = true;
        if (merged[k] === undefined) S.remove(k); else S.set(k, merged[k]);
      }
    });
    syncing.applying = false;

    const writes = [];
    names.forEach((p) => {
      const slice = {};
      parts[p].forEach((k) => { if (merged[k] !== undefined) slice[k] = merged[k]; });
      const json = X.stable(slice);
      if (json.length > MAX_PART) throw new UserError('I dati sono troppi per la sincronizzazione: riduci la cronologia importata.');
      const current = remoteDocs[p].json ? X.stable(parse(remoteDocs[p].json)) : null;
      if (json !== current && !(current === null && json === '{}')) writes.push({ part: p, json, updateTime: remoteDocs[p].updateTime });
    });
    if (writes.length && !(await commit(writes))) return { retry: true, changedLocal };
    S.set('syncBase', merged);
    return { retry: false, changedLocal };
  }

  /** Legge il cloud, unisce le modifiche di entrambi i telefoni e riscrive il risultato. */
  async function syncNow() {
    if (!configured() || !session()) return null;
    if (syncing.busy) { syncing.again = true; return null; }
    syncing.busy = true;
    let changed = false;
    try {
      for (let i = 0; i < 4; i++) {
        const r = await once();
        changed = changed || r.changedLocal;
        if (!r.retry) break;
        if (i === 3) throw new UserError('L\'altro telefono sta salvando: riprova tra poco.');
      }
      S.set('syncStatus', { at: Date.now(), error: null });
      if (changed) syncing.listeners.forEach((fn) => fn());
      return { changed };
    } catch (e) {
      S.set('syncStatus', Object.assign({}, S.get('syncStatus', {}), { error: e.message || 'Sincronizzazione non riuscita.' }));
      throw e;
    } finally {
      syncing.busy = false;
      if (syncing.again) { syncing.again = false; schedule(500); }
    }
  }
  function schedule(delay) {
    clearTimeout(syncing.timer);
    syncing.timer = setTimeout(() => { syncNow().catch(() => {}); }, delay == null ? 2500 : delay);
  }

  /** Esce solo dopo aver salvato: così sul cloud resta tutto. */
  async function signOut() {
    clearTimeout(syncing.timer);
    while (syncing.busy) await new Promise((r) => setTimeout(r, 100));
    await syncNow();
    syncing.applying = true;
    X.SYNC_KEYS.concat(['session', 'syncBase', 'syncStatus']).forEach((k) => S.remove(k));
    syncing.applying = false;
  }

  A.store.onSet = (k) => {
    if (!syncing.applying && session() && X.SYNC_KEYS.includes(k)) schedule();
  };
  root.Sync = { configured, session, signUp, signIn, resetPassword, signOut, syncNow, schedule, onRemoteChange };
})(window);
