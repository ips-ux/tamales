import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { readFile } from "node:fs/promises";

const seed = JSON.parse(await readFile(new URL("../../firebase/firestore.seed.json", import.meta.url), "utf8"));
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

async function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  }

  console.error("Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS before seeding Firestore.");
  console.error("Example: $env:GOOGLE_APPLICATION_CREDENTIALS = \"C:\\path\\to\\bustostamale-service-account.json\"");
  process.exit(1);
}

function toFirestoreData(value) {
  if (Array.isArray(value)) return value.map(toFirestoreData);
  if (typeof value === "string" && isoTimestampPattern.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : Timestamp.fromDate(date);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toFirestoreData(entry)]));
  }
  return value;
}

const serviceAccount = await readServiceAccount();
const projectId = process.env.FIREBASE_PROJECT_ID ?? serviceAccount.project_id;
initializeApp({ credential: cert(serviceAccount), projectId });

const db = getFirestore();
console.log(`Seeding Firestore${projectId ? ` for ${projectId}` : ""}...`);

for (const [collection, docs] of Object.entries(seed)) {
  for (const [id, data] of Object.entries(docs)) {
    await db.collection(collection).doc(id).set(toFirestoreData(data), { merge: true });
    console.log(`Seeded ${collection}/${id}`);
  }
}

console.log("Firestore seed complete.");
