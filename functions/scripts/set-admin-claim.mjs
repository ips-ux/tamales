import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readFile } from "node:fs/promises";

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm --prefix functions run set-admin -- owner@example.com");
  process.exit(1);
}

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (serviceAccountJson) {
  initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
} else if (credentialsPath) {
  const serviceAccount = JSON.parse(await readFile(credentialsPath, "utf8"));
  initializeApp({ credential: cert(serviceAccount) });
} else {
  console.error("Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS first.");
  process.exit(1);
}

const user = await getAuth().getUserByEmail(email);
await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
console.log(`Granted admin claim to ${email}. Ask them to sign out and sign back in.`);
