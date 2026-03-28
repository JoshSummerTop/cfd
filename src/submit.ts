import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getWorkspacePath } from "./sync.js";
import { type CfdConfig } from "./config.js";
import { engineFetch } from "./engine.js";

export async function submitFrame(
  config: CfdConfig,
  jobId: string,
  frameIndex: number
): Promise<string> {
  const wsPath = getWorkspacePath(jobId);
  const cleanedPath = join(wsPath, "frames", String(frameIndex), "cleaned.html");

  if (!existsSync(cleanedPath)) {
    throw new Error(
      `No cleaned.html found at ${cleanedPath}. ` +
      `Write the cleaned HTML to this path before submitting.`
    );
  }

  const html = await readFile(cleanedPath, "utf-8");

  const res = await engineFetch(config, `/api/jobs/${jobId}/frames/${frameIndex}/reconvert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cleaned_html: html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Engine returned ${res.status}: ${body}`);
  }

  return `Frame ${frameIndex} cleaned HTML submitted successfully.`;
}

export async function buildWebsite(
  config: CfdConfig,
  jobId: string
): Promise<string> {
  const res = await engineFetch(config, `/api/jobs/${jobId}/website/build`, {
    method: "POST",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Build request failed: ${res.status}: ${body}`);
  }

  const data = await res.json();
  return `Website build started. Build ID: ${data.id || "unknown"}. Check status via the web UI.`;
}
