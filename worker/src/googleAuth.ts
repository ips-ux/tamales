// Google access token for the Firebase service account (RS256 JWT, OAuth 2.0 JWT bearer grant).

import { base64ToBytes, bytesToBase64Url, textToBase64Url } from "./base64";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

export function parseServiceAccount(json: string): ServiceAccount {
  const parsed = JSON.parse(json) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT has no client_email or private_key.");
  }
  return parsed as ServiceAccount;
}

export function pemToDer(pem: string): Uint8Array {
  return base64ToBytes(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\\n/g, ""));
}

/** Builds and signs the JWT that the token endpoint exchanges for an access token. */
export async function signServiceAccountJwt(account: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = textToBase64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600
    })
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  );
  return `${header}.${claims}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

// Module scope lives as long as the Worker isolate, so most requests reuse the token.
let cached: { email: string; token: string; expiresAtMs: number } | null = null;

export async function getAccessToken(account: ServiceAccount, fetchFn: typeof fetch = fetch): Promise<string> {
  const now = Date.now();
  if (cached && cached.email === account.client_email && cached.expiresAtMs - 60_000 > now) {
    return cached.token;
  }
  const assertion = await signServiceAccountJwt(account, Math.floor(now / 1000));
  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  if (!response.ok) {
    throw new Error(`Google token request failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { access_token: string; expires_in: number };
  cached = { email: account.client_email, token: data.access_token, expiresAtMs: now + data.expires_in * 1000 };
  return data.access_token;
}
