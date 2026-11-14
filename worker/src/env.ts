// Worker bindings. Vars come from wrangler.toml. Secrets come from `wrangler secret put`.
export interface Env {
  FIREBASE_SERVICE_ACCOUNT?: string;
  RESEND_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  ALLOWED_ORIGINS?: string;
  PUBLIC_SITE_ORIGIN?: string;
  EMAIL_FROM?: string;
  OWNER_EMAIL?: string;
}

export const BUSINESS_NAME = "Bangin Bustos Tamales";

export const DEFAULT_ALLOWED_ORIGINS =
  "https://bustostamales.com,https://www.bustostamales.com,https://bustostamale.web.app,http://127.0.0.1:5173,http://localhost:5173";

export interface Config {
  projectId: string;
  allowedOrigins: string[];
  siteOrigin: string;
  emailFrom: string;
  ownerEmail: string;
}

export function parseOrigins(list: string | undefined): string[] {
  return (list || DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function readConfig(env: Env): Config {
  return {
    projectId: env.FIREBASE_PROJECT_ID || "bustostamale",
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    siteOrigin: (env.PUBLIC_SITE_ORIGIN || "https://bustostamales.com").replace(/\/+$/, ""),
    emailFrom: env.EMAIL_FROM || `${BUSINESS_NAME} <orders@bustostamales.com>`,
    ownerEmail: env.OWNER_EMAIL || "banginbustostamales@gmail.com"
  };
}
