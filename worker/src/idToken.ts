// Verifies a Firebase ID token (RS256) against the Google securetoken public keys.
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

import { base64ToBytes, base64UrlToText } from "./base64";
import { HttpError } from "./http";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export interface Jwk extends JsonWebKey {
  kid?: string;
}

export type KeyLoader = () => Promise<Jwk[]>;

let cachedKeys: { keys: Jwk[]; expiresAtMs: number } | null = null;

/** Loads the Google public keys. Module scope caches them for the time in Cache-Control. */
export async function loadGoogleKeys(fetchFn: typeof fetch = fetch): Promise<Jwk[]> {
  if (cachedKeys && cachedKeys.expiresAtMs > Date.now()) return cachedKeys.keys;
  const response = await fetchFn(JWKS_URL);
  if (!response.ok) throw new Error(`Google key request failed (${response.status}).`);
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "")?.[1] ?? "3600");
  const keys = ((await response.json()) as { keys: Jwk[] }).keys;
  cachedKeys = { keys, expiresAtMs: Date.now() + maxAge * 1000 };
  return keys;
}

export interface IdTokenClaims {
  sub: string;
  email?: string;
  admin?: boolean;
  [claim: string]: unknown;
}

const unauthorized = () => new HttpError(401, "Log in again, then try again.");

/** Returns the claims of a valid token. Throws a 401 if the token is not valid. */
export async function verifyIdToken(
  token: string,
  projectId: string,
  loadKeys: KeyLoader = loadGoogleKeys,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<IdTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw unauthorized();
  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims & { aud?: string; iss?: string; exp?: number; iat?: number };
  let signature: Uint8Array;
  try {
    header = JSON.parse(base64UrlToText(parts[0]));
    claims = JSON.parse(base64UrlToText(parts[1]));
    signature = base64ToBytes(parts[2]);
  } catch {
    throw unauthorized();
  }
  if (header.alg !== "RS256" || !header.kid) throw unauthorized();

  const jwk = (await loadKeys()).find((key) => key.kid === header.kid);
  if (!jwk) throw unauthorized();
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify"
  ]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!valid) throw unauthorized();

  const skew = 60;
  if (claims.aud !== projectId) throw unauthorized();
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw unauthorized();
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) throw unauthorized();
  if (typeof claims.iat !== "number" || claims.iat > nowSeconds + skew) throw unauthorized();
  if (typeof claims.sub !== "string" || !claims.sub) throw unauthorized();
  return claims;
}

/** Returns the claims of a valid owner token. Throws 401 or 403. */
export async function requireAdmin(
  authorization: string | null,
  projectId: string,
  loadKeys: KeyLoader = loadGoogleKeys,
  nowSeconds?: number
): Promise<IdTokenClaims> {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match) throw unauthorized();
  const claims = await verifyIdToken(match[1].trim(), projectId, loadKeys, nowSeconds);
  if (claims.admin !== true) throw new HttpError(403, "This action is for the owner only.");
  return claims;
}
