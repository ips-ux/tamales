/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Cloudflare Worker, for example https://api.bustostamales.com */
  readonly VITE_API_BASE_URL?: string;
  /** Cloudflare Turnstile site key. Leave it empty in local development. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
