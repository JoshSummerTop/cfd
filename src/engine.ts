import type { CfdConfig } from "./config.js";

/** Authenticated fetch to the CodeFromDesign engine API */
export async function engineFetch(
  config: CfdConfig,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
  };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }
  return fetch(`${config.engineUrl}${path}`, { ...init, headers });
}
