import { beforeAll, describe, expect, it } from "vitest";
import { base64ToBytes, base64UrlToText, bytesToBase64Url, textToBase64Url } from "../src/base64";
import { parseServiceAccount, signServiceAccountJwt } from "../src/googleAuth";
import { HttpError } from "../src/http";
import { requireAdmin, verifyIdToken, type Jwk } from "../src/idToken";

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const PROJECT = "demo-project";
const NOW = 1_800_000_000;

let keys: CryptoKeyPair;
let jwks: Jwk[];

async function sign(claims: Record<string, unknown>, header: Record<string, unknown> = {}, key = keys.privateKey) {
  const head = textToBase64Url(JSON.stringify({ alg: "RS256", kid: "key-1", typ: "JWT", ...header }));
  const body = textToBase64Url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

const claims = (extra: Record<string, unknown> = {}) => ({
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  sub: "uid-1",
  iat: NOW - 10,
  exp: NOW + 3600,
  admin: true,
  ...extra
});

const loadKeys = async () => jwks;

async function statusOf(run: Promise<unknown>): Promise<number> {
  try {
    await run;
    return 200;
  } catch (error) {
    return error instanceof HttpError ? error.status : -1;
  }
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as Jwk;
  jwks = [{ ...jwk, kid: "key-1", alg: "RS256", use: "sig" }];
});

describe("Firebase ID token", () => {
  it("accepts a valid owner token", async () => {
    const token = await sign(claims({ email: "owner@example.com" }));
    const result = await requireAdmin(`Bearer ${token}`, PROJECT, loadKeys, NOW);
    expect(result.sub).toBe("uid-1");
    expect(result.email).toBe("owner@example.com");
  });

  it("rejects a token with no admin claim", async () => {
    for (const admin of [undefined, false, "true"]) {
      const token = await sign(claims({ admin }));
      expect(await statusOf(requireAdmin(`Bearer ${token}`, PROJECT, loadKeys, NOW))).toBe(403);
    }
  });

  it("rejects a missing header", async () => {
    expect(await statusOf(requireAdmin(null, PROJECT, loadKeys, NOW))).toBe(401);
    expect(await statusOf(requireAdmin("Basic abc", PROJECT, loadKeys, NOW))).toBe(401);
    expect(await statusOf(requireAdmin("Bearer not.a.token", PROJECT, loadKeys, NOW))).toBe(401);
  });

  it("rejects a wrong audience, issuer, time or subject", async () => {
    const bad = [
      claims({ aud: "other-project" }),
      claims({ iss: "https://securetoken.google.com/other-project" }),
      claims({ exp: NOW - 1 }),
      claims({ iat: NOW + 600 }),
      claims({ sub: "" })
    ];
    for (const entry of bad) {
      expect(await statusOf(verifyIdToken(await sign(entry), PROJECT, loadKeys, NOW))).toBe(401);
    }
  });

  it("rejects a wrong algorithm, an unknown key and a changed payload", async () => {
    expect(await statusOf(verifyIdToken(await sign(claims(), { alg: "none" }), PROJECT, loadKeys, NOW))).toBe(401);
    expect(await statusOf(verifyIdToken(await sign(claims(), { kid: "key-2" }), PROJECT, loadKeys, NOW))).toBe(401);

    const token = await sign(claims({ admin: false }));
    const [head, , signature] = token.split(".");
    const forged = `${head}.${textToBase64Url(JSON.stringify(claims()))}.${signature}`;
    expect(await statusOf(verifyIdToken(forged, PROJECT, loadKeys, NOW))).toBe(401);
  });

  it("rejects a token that a different key signed", async () => {
    const other = (await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"])) as CryptoKeyPair;
    const token = await sign(claims(), {}, other.privateKey);
    expect(await statusOf(verifyIdToken(token, PROJECT, loadKeys, NOW))).toBe(401);
  });
});

describe("service-account JWT", () => {
  it("signs a JWT that the public key verifies", async () => {
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", keys.privateKey)) as ArrayBuffer);
    const base64 = btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n");
    const account = parseServiceAccount(
      JSON.stringify({
        client_email: "worker@demo.iam.gserviceaccount.com",
        private_key: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`
      })
    );
    const jwt = await signServiceAccountJwt(account, NOW);
    const [head, body, signature] = jwt.split(".");
    expect(JSON.parse(base64UrlToText(head))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(base64UrlToText(body))).toEqual({
      iss: "worker@demo.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: NOW,
      exp: NOW + 3600
    });
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      keys.publicKey,
      base64ToBytes(signature),
      new TextEncoder().encode(`${head}.${body}`)
    );
    expect(valid).toBe(true);
  });

  it("rejects a secret that is not a service-account key", () => {
    expect(() => parseServiceAccount("{}")).toThrow("client_email");
  });
});
