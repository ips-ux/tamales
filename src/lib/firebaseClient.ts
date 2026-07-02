import { getApp, getApps, initializeApp } from "firebase/app";
import {
  EmailAuthProvider,
  getAuth,
  getIdToken,
  getIdTokenResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
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

export function getFirebaseApp() {
  if (!firebaseConfigured()) {
    throw new Error("Firebase client config is missing.");
  }
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

function requireAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getCurrentUser(): User | null {
  if (!firebaseConfigured()) return null;
  return getAuth(getFirebaseApp()).currentUser;
}

export function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(requireAuth(), email, password);
}

export function signOutCurrentUser() {
  return signOut(requireAuth());
}

// Firebase requires a recent sign-in before allowing a password change, so
// reauthenticate with the current password first.
export async function changePassword(currentPassword: string, newPassword: string) {
  const user = getCurrentUser();
  if (!user?.email) {
    throw new Error("You need to be signed in to change your password.");
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

export function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(requireAuth(), email);
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
