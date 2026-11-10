// Browser response policy only. Never modifies requests, RPC, response bytes or escrow state.
export const DOMAIN_FONT_FILE = "domain-emoji.a5ec1ef950064a71.woff2";
export const IMMUTABLE_FONT_CACHE = "public, max-age=31536000, immutable";
export const UI_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const UI_SECURITY: Readonly<Record<string,string>> = Object.freeze({
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": UI_CSP,
  // Deliberately no includeSubDomains/preload on shared hosting, and no COEP/CORP.
  "strict-transport-security": "max-age=31536000",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), clipboard-write=(self)",
  "cross-origin-opener-policy": "same-origin",
});
export function secureUiResponse(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  for (const [name,value] of Object.entries(UI_SECURITY)) headers.set(name,value);
  if (/^text\/html(?:;|$)/i.test(headers.get("content-type") ?? "")) headers.delete("access-control-allow-origin");
  if (url.pathname === "/" + DOMAIN_FONT_FILE && response.status === 200) {
    headers.set("cache-control", IMMUTABLE_FONT_CACHE);
    headers.set("content-type", "font/woff2");
  }
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}
