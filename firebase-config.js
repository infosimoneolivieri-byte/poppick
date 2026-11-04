/*
 * Dati del vostro progetto Firebase. Si trovano in Firebase, Impostazioni progetto, Generali.
 * Scrivete i due valori tra le virgolette e salvate: la nuova build avrà l'accesso con email e password.
 * Se restano vuoti, l'app funziona lo stesso, ma senza account.
 */
window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: 'AIzaSyBHZZQwdKjQ-l8PC061qOI3ETZE-Uqx8QI',
  projectId: 'poppick-3d601',
};

// Chiave TMDB inclusa, così chi riceve l'app può cercare subito. Non è un segreto: è solo offuscata.
window.POPPICK_SHARED = { tmdb: 'OTlmYTI3NjRjNzNjMDA1OGE3OWY0ZmFkNmEyZmVhYTU=' };
// Indirizzo da condividere con gli amici.
window.POPPICK_SITE = 'https://infosimoneolivieri-byte.github.io/poppick/';
