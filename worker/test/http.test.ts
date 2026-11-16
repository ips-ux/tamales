import { describe, expect, it } from "vitest";
import { corsHeaders, isAllowedOrigin } from "../src/cors";
import { DEFAULT_ALLOWED_ORIGINS, parseOrigins, readConfig } from "../src/env";
import { handleRequest } from "../src/index";

const API = "https://bbt-api.example.workers.dev";
const SITE = "https://bustostamales.com";
const defer = () => undefined;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("CORS origin check", () => {
  const allowed = parseOrigins(undefined);

  it("uses the default list", () => {
    expect(allowed).toEqual(DEFAULT_ALLOWED_ORIGINS.split(","));
    expect(readConfig({}).allowedOrigins).toEqual(allowed);
  });

  it("reads a list with spaces and slashes at the end", () => {
    expect(parseOrigins(" https://a.example/ , http://localhost:5173 ,")).toEqual([
      "https://a.example",
      "http://localhost:5173"
    ]);
  });

  it("allows only an exact origin from the list", () => {
    expect(isAllowedOrigin("https://bustostamales.com", allowed)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173", allowed)).toBe(true);
    for (const origin of [
      null,
      "",
      "null",
      "http://bustostamales.com",
      "https://bustostamales.com.evil.example",
      "https://evil.example/?https://bustostamales.com",
      "https://shop.bustostamales.com"
    ]) {
      expect(isAllowedOrigin(origin, allowed)).toBe(false);
    }
  });

  it("returns the origin for an allowed site and no allow header for other sites", () => {
    expect(corsHeaders(SITE, allowed)["Access-Control-Allow-Origin"]).toBe(SITE);
    expect(corsHeaders(SITE, allowed).Vary).toBe("Origin");
    expect(corsHeaders("https://evil.example", allowed)).toEqual({ Vary: "Origin" });
  });
});

describe("request handler", () => {
  it("answers the health check", async () => {
    const response = await handleRequest(new Request(`${API}/api/health`), {}, defer);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("answers OPTIONS with the CORS headers", async () => {
    const request = new Request(`${API}/api/contact`, { method: "OPTIONS", headers: { Origin: SITE } });
    const response = await handleRequest(request, {}, defer);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("rejects a POST from a site that is not in the list", async () => {
    const response = await handleRequest(post("/api/contact", {}, { Origin: "https://evil.example" }), {}, defer);
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("answers ok and saves nothing when the honeypot is filled", async () => {
    // No service account and no network: a save attempt would give 503.
    for (const path of ["/api/contact", "/api/signup"]) {
      const response = await handleRequest(post(path, { website: "https://spam.example" }), {}, defer);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
  });

  it("has no route for the old order model", async () => {
    const response = await handleRequest(post("/api/orders", { website: "" }), {}, defer);
    expect(response.status).toBe(404);
  });

  it("returns a 400 with a message for an invalid form", async () => {
    const response = await handleRequest(post("/api/contact", { website: "", firstName: "" }), {}, defer);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Enter your first name." });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
  });

  it("returns 503 for a valid form when the service account is not set", async () => {
    const body = { firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "", message: "Hello" };
    const response = await handleRequest(post("/api/contact", body), {}, defer);
    expect(response.status).toBe(503);
  });

  it("rejects a body that is too large or is not JSON", async () => {
    expect((await handleRequest(post("/api/signup", "x".repeat(20_001)), {}, defer)).status).toBe(413);
    expect((await handleRequest(post("/api/signup", "{"), {}, defer)).status).toBe(400);
  });

  it("requires a token for a receipt", async () => {
    const response = await handleRequest(post("/api/receipts", { ticketId: "a", toEmail: "a@b.co" }), {}, defer);
    expect(response.status).toBe(401);
  });

  it("returns 404 and 405", async () => {
    expect((await handleRequest(post("/api/unknown", {}), {}, defer)).status).toBe(404);
    expect((await handleRequest(new Request(`${API}/api/contact`), {}, defer)).status).toBe(405);
  });
});
