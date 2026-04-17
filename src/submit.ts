import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
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

/** MIME types for the file extensions the engine accepts. Used for the PUT
 *  Content-Type header on signed URL uploads — Supabase Storage stores what we
 *  send, and the web app serves it back with the same type. */
const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

function mimeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_BY_EXT[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/** Upload a single file to a Supabase signed PUT URL. These URLs live outside
 *  Render/Next.js, so there is no ~10MB edge-proxy cap on the payload. */
async function putToSignedUrl(url: string, data: Buffer, contentType: string): Promise<void> {
  // Cast to BodyInit — Node's undici fetch accepts Buffer/Uint8Array, but the
  // bundled lib.dom types are stricter than the runtime. Behavior is the same.
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      // Supabase storage requires x-upsert on re-uploads to the same path.
      "x-upsert": "true",
    },
    body: data as unknown as BodyInit,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PUT ${url} → ${res.status}: ${body}`);
  }
}

export async function uploadWebsite(
  config: CfdConfig,
  jobId: string,
  directory: string
): Promise<string> {
  if (!existsSync(directory)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  const filePaths = await walkDir(directory);
  if (filePaths.length === 0) {
    throw new Error(`No files found in ${directory}`);
  }

  // Collect relative paths + derive page metadata (same naming scheme as before).
  const relPaths: string[] = [];
  const htmlPages: { name: string; route: string }[] = [];
  const absByRel = new Map<string, string>();
  for (const fullPath of filePaths) {
    const relPath = relative(directory, fullPath).split("\\").join("/");
    relPaths.push(relPath);
    absByRel.set(relPath, fullPath);
    if (relPath.endsWith(".html")) {
      const name = relPath === "index.html"
        ? "Home"
        : relPath.replace(/\.html$/, "").replace(/^pages\//, "").replace(/(^|\/)(\w)/g, (_, sep, c) => sep + c.toUpperCase());
      htmlPages.push({ name, route: relPath });
    }
  }

  // Phase 1: ask engine for a signed upload URL per file. Body here is just
  // a list of paths — tiny regardless of site size, so it fits under the
  // Render/Next.js edge proxy's body limit.
  const urlsRes = await engineFetch(config, `/api/jobs/${jobId}/website/upload-urls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: relPaths }),
  });
  if (!urlsRes.ok) {
    const body = await urlsRes.text();
    throw new Error(`Request upload URLs failed: ${urlsRes.status}: ${body}`);
  }
  const { uploads } = (await urlsRes.json()) as {
    uploads: { path: string; url: string; method: string }[];
  };
  if (!uploads || uploads.length !== relPaths.length) {
    throw new Error(`Engine returned ${uploads?.length ?? 0} upload URLs for ${relPaths.length} files`);
  }

  // Phase 2: PUT each file directly to Supabase Storage. Parallel, but capped
  // so we don't open hundreds of sockets on a large site. A PUT failure stops
  // the whole upload — no partial builds.
  const CONCURRENCY = 6;
  let cursor = 0;
  let uploaded = 0;
  async function worker() {
    while (cursor < uploads.length) {
      const mine = cursor++;
      const entry = uploads[mine];
      const abs = absByRel.get(entry.path);
      if (!abs) throw new Error(`No local file for upload entry ${entry.path}`);
      const data = await readFile(abs);
      await putToSignedUrl(entry.url, data, mimeFor(entry.path));
      uploaded++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uploads.length) }, worker));

  // Phase 3: finalize — engine verifies everything landed in storage and
  // writes the website_builds row.
  const finalizeRes = await engineFetch(config, `/api/jobs/${jobId}/website/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: relPaths, pages: htmlPages }),
  });
  if (!finalizeRes.ok) {
    const body = await finalizeRes.text();
    throw new Error(`Finalize failed: ${finalizeRes.status}: ${body}`);
  }
  const data = (await finalizeRes.json()) as {
    buildId: string;
    files: number;
    pages: number;
    warnings?: { code: string; severity: string; message: string }[];
  };

  let warningText = "";
  if (data.warnings?.length) {
    warningText = data.warnings.map(w => `  ${w.severity.toUpperCase()}: ${w.message}`).join("\n") + "\n";
  }
  return `${warningText}Website uploaded: ${data.files} files, ${data.pages} pages. Build ID: ${data.buildId}. View it in the CodeFromDesign web app.`;
}
