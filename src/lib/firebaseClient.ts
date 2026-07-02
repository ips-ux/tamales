import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  getIdToken,
  getIdTokenResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export function firebaseConfigured() {
  return Object.values(firebaseConfig).every(
    (value) => typeof value === "string" && value.length > 0 && value !== "replace_me"
  );
}

function requireAuth(): Auth {
  if (!firebaseConfigured()) {
    throw new Error("Firebase client config is missing.");
  }
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(requireAuth(), email, password);
}

export function signOutCurrentUser() {
  return signOut(requireAuth());
}

export function watchAuth(callback: (user: User | null) => void) {
  if (!firebaseConfigured()) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(requireAuth(), callback);
}

export async function userIsAdmin(user: User | null) {
  if (!user) return false;
  const token = await getIdTokenResult(user, true);
  return token.claims.admin === true;
}

export async function authHeader() {
  if (!firebaseConfigured()) return {};
  const auth = requireAuth();
  if (!auth.currentUser) return {};
  const token = await getIdToken(auth.currentUser);
  return { Authorization: `Bearer ${token}` };
}
