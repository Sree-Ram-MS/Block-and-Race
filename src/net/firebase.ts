/**
 * Firebase bootstrap — all SDK imports are dynamic (`await import`) so the
 * app builds and runs fully offline-capable (local / AI modes) even when no
 * Firebase config is present.
 */

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
}

export function getFirebaseConfig(): FirebaseConfig {
  const env = import.meta.env;
  return {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    databaseURL: env.VITE_FIREBASE_DATABASE_URL ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  };
}

export function isFirebaseConfigured(): boolean {
  const c = getFirebaseConfig();
  return Boolean(c.apiKey && c.authDomain && c.databaseURL && c.projectId && c.appId);
}

export interface FirebaseHandles {
  // Typed as `any` at this boundary: the modular SDK types are heavy and the
  // online layer is deliberately isolated behind OnlineManager.
  app: any;
  auth: any;
  db: any;
  uid: string;
  api: {
    ref: any; set: any; get: any; update: any; push: any; remove: any;
    onValue: any; runTransaction: any; onDisconnect: any; serverTimestamp: any;
    signInAnonymously: any; onAuthStateChanged: any;
  };
}

let cached: FirebaseHandles | null = null;

export async function initFirebase(): Promise<FirebaseHandles> {
  if (cached) return cached;
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured.');
  const cfg = getFirebaseConfig();
  // The SDK loads from Google's official CDN at runtime instead of being
  // bundled: this keeps the GitHub Pages build to one small JS file and the
  // SDK is only fetched when a user actually goes online.
  const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';
  const [appMod, authMod, dbMod] = await Promise.all([
    import(/* @vite-ignore */ `${CDN}/firebase-app.js`),
    import(/* @vite-ignore */ `${CDN}/firebase-auth.js`),
    import(/* @vite-ignore */ `${CDN}/firebase-database.js`),
  ]);
  const { initializeApp } = appMod;
  const app = initializeApp(cfg);
  const auth = authMod.getAuth(app);
  const db = dbMod.getDatabase(app);
  const cred = await authMod.signInAnonymously(auth);
  cached = {
    app,
    auth,
    db,
    uid: cred.user.uid,
    api: {
      ref: dbMod.ref, set: dbMod.set, get: dbMod.get, update: dbMod.update,
      push: dbMod.push, remove: dbMod.remove, onValue: dbMod.onValue,
      runTransaction: dbMod.runTransaction, onDisconnect: dbMod.onDisconnect,
      serverTimestamp: dbMod.serverTimestamp,
      signInAnonymously: authMod.signInAnonymously,
      onAuthStateChanged: authMod.onAuthStateChanged,
    },
  };
  return cached;
}

/** Anonymous display name: `anon-12345`, persisted and editable by the user. */
export function getAnonName(): string {
  const key = 'barricade-name';
  let name = localStorage.getItem(key);
  if (!name) {
    name = `anon-${Math.floor(10000 + Math.random() * 90000)}`;
    localStorage.setItem(key, name);
  }
  return name;
}

export function setAnonName(name: string): void {
  localStorage.setItem('barricade-name', name.trim() || getAnonName());
}
