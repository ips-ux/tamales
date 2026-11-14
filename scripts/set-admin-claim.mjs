import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { readServiceAccount } from "./lib/service-account.mjs";

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm run set-admin -- owner@example.com");
  process.exit(1);
}

initializeApp({ credential: cert(await readServiceAccount()) });

const user = await getAuth().getUserByEmail(email);
await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
console.log(`Granted the admin claim to ${email}. Tell this person to log out, then log in again.`);
