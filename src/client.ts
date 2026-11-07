import { need, parseJSON } from "./core.js";
export function endpoint(value: string): string {
  const u = new URL(value);
  need(
    u.protocol === "http:" &&
      u.hostname === "127.0.0.1" &&
      !u.username &&
      !u.password &&
      (u.pathname === "/" || !u.pathname) &&
      !u.search &&
      !u.hash,
    "ENDPOINT",
  );
  return u.origin;
}
export async function request(
  url: string,
  path: string,
  packet?: unknown,
): Promise<any> {
  const base = endpoint(url);
  const response = await fetch(base + path, {
    method: packet ? "POST" : "GET",
    headers: packet ? { "content-type": "application/json" } : {},
    body: packet ? JSON.stringify(packet) : undefined,
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  const data = parseJSON(await response.text(), 16777216);
  need(response.ok || response.status === 404, data.code ?? "HTTP");
  return data;
}
