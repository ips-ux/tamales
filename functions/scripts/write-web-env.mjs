import { GoogleAuth } from "google-auth-library";
import { readdir, readFile, writeFile } from "node:fs/promises";

const rootDir = new URL("../../", import.meta.url);
const envPath = new URL(".env.local", rootDir);
const secretsDir = new URL(".secrets/", rootDir);
const createIfMissing = process.argv.includes("--create-if-missing");
const displayName = "Bangin Bustos Tamales Web";

async function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  }

  const files = await readdir(secretsDir).catch(() => []);
  const candidates = files.filter((file) => file.endsWith(".json"));
  for (const file of candidates) {
    const body = await readFile(new URL(file, secretsDir), "utf8");
    const parsed = JSON.parse(body);
    if (parsed.type === "service_account" && parsed.project_id && parsed.private_key) {
      return parsed;
    }
  }

  console.error("No Firebase service-account JSON found. Set GOOGLE_APPLICATION_CREDENTIALS or place it in .secrets/.");
  process.exit(1);
}

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
const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/firebase"]
});
const client = await auth.getClient();

async function firebaseRequest(url, options = {}) {
  const response = await client.request({ url, ...options });
  return response.data;
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
