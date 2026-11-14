import { readdir, readFile } from "node:fs/promises";

const secretsDir = new URL("../../.secrets/", import.meta.url);

function isServiceAccount(value) {
  return value?.type === "service_account" && value.project_id && value.private_key;
}

/**
 * Finds the Firebase service-account key. It looks in this sequence:
 * FIREBASE_SERVICE_ACCOUNT_JSON (the JSON text), GOOGLE_APPLICATION_CREDENTIALS
 * (a file path), then the first key file in `.secrets/` at the repository root.
 */
export async function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
  }

  const files = await readdir(secretsDir).catch(() => []);
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const parsed = JSON.parse(await readFile(new URL(file, secretsDir), "utf8"));
    if (isServiceAccount(parsed)) return parsed;
  }

  console.error("No Firebase service-account key found.");
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the key file path, or put the key file in .secrets/.");
  console.error('PowerShell: $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\\path\\to\\service-account.json"');
  process.exit(1);
}
