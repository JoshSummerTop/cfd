import type { CfdConfig } from "./config.js";

/** Default timeout for engine requests (120s — compare can take 30-60s for complex pages) */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Authenticated fetch to the CodeFromDesign engine API with timeout */
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

  // Add timeout via AbortController (prevents indefinite hang if engine is unresponsive)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(`${config.engineUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`Engine request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
