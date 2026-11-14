import { cert } from "firebase-admin/app";
import { readFile, writeFile } from "node:fs/promises";
import { readServiceAccount } from "./lib/service-account.mjs";

const rootDir = new URL("../", import.meta.url);
const envPath = new URL(".env.local", rootDir);
const createIfMissing = process.argv.includes("--create-if-missing");
const displayName = "Bangin Bustos Tamales Web";

function mergeEnv(existing, updates) {
  const seen = new Set();
  const lines = existing
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/^([A-Z0-9_]+)=/);
      if (!match || !(match[1] in updates)) return line;
      seen.add(match[1]);
      return `${match[1]}=${updates[match[1]] ?? ""}`;
    });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${value ?? ""}`);
  }

  return `${lines.join("\n")}\n`;
}

const serviceAccount = await readServiceAccount();
const projectId = process.env.FIREBASE_PROJECT_ID ?? serviceAccount.project_id;
const credential = cert(serviceAccount);

async function firebaseRequest(url, options = {}) {
  const { access_token: accessToken } = await credential.getAccessToken();
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: options.data ? JSON.stringify(options.data) : undefined
  });
  if (!response.ok) {
    throw new Error(`Firebase request failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function listWebApps() {
  return firebaseRequest(`https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOperation(name) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const operation = await firebaseRequest(`https://firebase.googleapis.com/v1beta1/${name}`);
    if (operation.done) {
      if (operation.error) throw new Error(operation.error.message ?? "Firebase Web App creation failed.");
      return operation;
    }
    await wait(2000);
  }
  throw new Error("Timed out waiting for Firebase Web App creation.");
}

async function createWebApp() {
  const operation = await firebaseRequest(`https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`, {
    method: "POST",
    data: { displayName }
  });
  await waitForOperation(operation.name);
}

let apps = await listWebApps();
let app = apps.apps?.[0];

if (!app && createIfMissing) {
  console.log(`Creating Firebase Web App "${displayName}" for ${projectId}...`);
  await createWebApp();
  apps = await listWebApps();
  app = apps.apps?.[0];
}

if (!app) {
  console.error(`No Firebase Web App is registered for project ${projectId}.`);
  console.error("Run npm run firebase:env:create to create one, or use Firebase Console > Project settings > General > Your apps.");
  process.exit(1);
}

const config = await firebaseRequest(`https://firebase.googleapis.com/v1beta1/${app.name}/config`);
const updates = {
  VITE_FIREBASE_API_KEY: config.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
  VITE_FIREBASE_PROJECT_ID: config.projectId ?? projectId,
  VITE_FIREBASE_APP_ID: config.appId,
  VITE_FIREBASE_STORAGE_BUCKET: config.storageBucket ?? "",
  VITE_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId ?? "",
  VITE_FIREBASE_MEASUREMENT_ID: config.measurementId ?? ""
};

const current = await readFile(envPath, "utf8").catch(() => "");
await writeFile(envPath, mergeEnv(current, updates), "utf8");

console.log(`Wrote Firebase web config for ${projectId} to .env.local.`);
console.log("Restart the Vite dev server so the login page can read the new VITE_FIREBASE values.");
