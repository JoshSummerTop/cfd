import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, posix } from "node:path";
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

// Recursively walk a directory and return all file paths
async function walkDir(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      files.push(...await walkDir(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export async function uploadWebsite(
  config: CfdConfig,
  jobId: string,
  directory: string
): Promise<string> {
  if (!existsSync(directory)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  // Walk the directory and collect all files
  const filePaths = await walkDir(directory);
  if (filePaths.length === 0) {
    throw new Error(`No files found in ${directory}`);
  }

  // Read and base64-encode each file, tracking cumulative payload size
  const files: { path: string; content: string }[] = [];
  const htmlPages: { name: string; route: string }[] = [];
  let totalPayloadBytes = 0;
  const PAYLOAD_WARNING_BYTES = 400 * 1024 * 1024; // 400MB
  const PAYLOAD_LIMIT_BYTES = 500 * 1024 * 1024; // 500MB (engine limit is 512MB)

  for (const fullPath of filePaths) {
    const relPath = relative(directory, fullPath).split("\\").join("/"); // normalize to forward slashes
    const data = await readFile(fullPath);
    const b64 = data.toString("base64");
    totalPayloadBytes += b64.length;
    files.push({ path: relPath, content: b64 });

    if (relPath.endsWith(".html")) {
      const name = relPath === "index.html"
        ? "Home"
        : relPath.replace(/\.html$/, "").replace(/^pages\//, "").replace(/(^|\/)(\w)/g, (_, sep, c) => sep + c.toUpperCase());
      htmlPages.push({ name, route: relPath });
    }
  }

  if (totalPayloadBytes > PAYLOAD_LIMIT_BYTES) {
    const sizeMB = (totalPayloadBytes / (1024 * 1024)).toFixed(0);
    throw new Error(
      `Payload too large (${sizeMB}MB). Engine limit is 512MB. ` +
      `Optimize images (compress PNGs, convert to WebP) before submitting.`
    );
  }

  let sizeWarning = "";
  if (totalPayloadBytes > PAYLOAD_WARNING_BYTES) {
    const sizeMB = (totalPayloadBytes / (1024 * 1024)).toFixed(0);
    sizeWarning = `\u{26A0}\u{FE0F} Large payload: ${sizeMB}MB (engine limit is 512MB). Consider optimizing images.\n`;
  }

  // Upload to engine
  const res = await engineFetch(config, `/api/jobs/${jobId}/website/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, pages: htmlPages }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed: ${res.status}: ${body}`);
  }

  const data = await res.json();
  return `${sizeWarning}Website uploaded: ${data.files} files, ${data.pages} pages. Build ID: ${data.buildId}. View it in the CodeFromDesign web app.`;
}
