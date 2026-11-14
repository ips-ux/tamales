export function isAllowedOrigin(origin: string | null, allowed: string[]): boolean {
  return Boolean(origin) && allowed.includes(origin as string);
}

/** CORS headers for an allowed origin. An origin that is not in the list gets none. */
export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!isAllowedOrigin(origin, allowed)) return headers;
  return {
    ...headers,
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
