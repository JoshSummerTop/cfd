import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { engineFetch } from "./engine.js";
import { syncJob, getWorkspacePath } from "./sync.js";
import { submitFrame, buildWebsite, uploadWebsite } from "./submit.js";
import { MCP_INSTRUCTIONS } from "./instructions.js";

export async function startMcpServer(): Promise<void> {
  const config = await loadConfig();

  const server = new McpServer(
    { name: "cfd", version: "0.4.2" },
    { instructions: MCP_INSTRUCTIONS },
  );

  // --- Tool: list ---
  server.tool(
    "list",
    "List all pipeline jobs from CodeFromDesign. Returns job IDs, status, Figma URLs, frame counts, and parity scores.",
    {},
    async () => {
      const res = await engineFetch(config, "/api/jobs");
      if (!res.ok) {
        return { content: [{ type: "text", text: `Error: ${res.status} ${res.statusText}` }] };
      }
      const jobs = await res.json();

      const summary = jobs.map((job: any) => ({
        id: job.id,
        status: job.status,
        figmaUrl: job.figmaUrl,
        frameCount: job.frames?.length ?? 0,
        overallParity: job.frames?.length
          ? (job.frames.reduce((sum: number, f: any) => sum + (f.parityScore ?? 0), 0) / job.frames.length).toFixed(1) + "%"
          : "n/a",
        createdAt: job.createdAt,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // --- Tool: sync ---
  server.tool(
    "sync",
    "Sync a job's frame data to the local workspace. Downloads HTML, screenshots, diffs, metadata, images, and SVGs for each frame.",
    {
      jobId: z.string().describe("The job ID to sync"),
    },
    async ({ jobId }) => {
      try {
        const result = await syncJob(config, jobId);
        return {
          content: [{
            type: "text",
            text: [
              `Synced job ${jobId} to workspace.`,
              ``,
              `Workspace: ${result.workspacePath}`,
              `Frames synced: ${result.frameCount}`,
              ``,
              `Directory structure:`,
              `  ${result.workspacePath}/`,
              `    job.json                    -- job metadata + frame summaries`,
              `    build-guide.json            -- page-to-frame mapping, breakpoints, output structure`,
              `    logs/                       -- session and frame logs (see instructions)`,
              `    frames/`,
              ...result.frames.map((f: any) =>
                `      ${f.index}/                   -- ${f.name} (${f.width}x${f.height}, parity: ${f.parity}, images: ${f.images ?? "n/a"})`
              ),
              ``,
              `Each frame directory contains:`,
              `  metadata.json         -- dimensions, parity scores, issues`,
              `  rendered.html         -- raw engine HTML output`,
              `  figma-screenshot.png  -- reference (what it should look like)`,
              `  screenshot.png        -- what the HTML currently renders as`,
              `  diff.png              -- pixel diff overlay`,
              `  manifest.json         -- component/section metadata (if available)`,
              ``,
              `Read build-guide.json for the website assembly plan (page-to-frame mapping, breakpoints, output structure).`,
              `Read job.json for an overview of all frames and parity scores.`,
            ].join("\n"),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Sync failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: submit_cleaned_frame ---
  server.tool(
    "submit_cleaned_frame",
    "Submit cleaned HTML for a frame. Reads cleaned.html and uploads to engine. WARNING: cleaned.html must NOT contain localhost URLs or http:// image paths — only relative paths like images/{hash}.png.",
    {
      jobId: z.string().describe("The job ID"),
      frameIndex: z.number().describe("The frame index (0-based)"),
    },
    async ({ jobId, frameIndex }) => {
      try {
        const result = await submitFrame(config, jobId, frameIndex);
        return { content: [{ type: "text", text: result }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Submit failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: build ---
  server.tool(
    "build",
    "Trigger website build from cleaned frames. The engine assembles a production website.",
    {
      jobId: z.string().describe("The job ID to build a website from"),
    },
    async ({ jobId }) => {
      try {
        const result = await buildWebsite(config, jobId);
        return { content: [{ type: "text", text: result }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Build failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: submit_website ---
  server.tool(
    "submit_website",
    "Upload a locally-built website directory to the engine. Reads all files (HTML, CSS, JS, images) and creates a build record viewable in the web app.",
    {
      jobId: z.string().describe("The job ID this website was built from"),
      directory: z.string().describe("Absolute path to the directory containing the built website files (HTML, CSS, JS, images)"),
    },
    async ({ jobId, directory }) => {
      try {
        // Validate images directory
        const imagesDir = join(directory, "images");
        if (!existsSync(imagesDir)) {
          return { content: [{ type: "text", text: `\u{1F6A8} VALIDATION FAILED: No images/ directory found in the website. Copy images from frames/{idx}/images/ to website/images/ (Phase C Step C5). Fix this before submitting.` }] };
        }
        const imageFiles = (await readdir(imagesDir)).filter((f) => !f.startsWith("."));
        if (imageFiles.length === 0) {
          return { content: [{ type: "text", text: `\u{1F6A8} VALIDATION FAILED: website/images/ directory is EMPTY. Copy images from frames/{idx}/images/ to website/images/ (Phase C Step C5). Fix this before submitting.` }] };
        }

        // Scan HTML files for localhost references
        const htmlFiles = (await readdir(directory, { recursive: true })) as string[];
        for (const f of htmlFiles) {
          if (typeof f === "string" && f.endsWith(".html")) {
            const content = await readFile(join(directory, f), "utf-8");
            if (/https?:\/\/localhost/i.test(content)) {
              return { content: [{ type: "text", text: `\u{1F6A8} VALIDATION FAILED: ${f} contains localhost URLs. All image/asset references must use relative paths (images/{hash}.png). Fix this before submitting.` }] };
            }
          }
        }

        const result = await uploadWebsite(config, jobId, directory);
        return { content: [{ type: "text", text: result }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Upload failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: compare ---
  server.tool(
    "compare",
    "Screenshot cleaned.html and diff against the Figma reference. Returns parity score and category breakdown. Call sync after to download updated diff images. REMINDER: max 2 background agents at a time.",
    {
      jobId: z.string().describe("The job ID"),
      frameIndex: z.number().describe("The frame index (0-based)"),
    },
    async ({ jobId, frameIndex }) => {
      try {
        // Read cleaned.html from workspace
        const wsPath = getWorkspacePath(jobId);
        const cleanedPath = join(wsPath, "frames", String(frameIndex), "cleaned.html");

        if (!existsSync(cleanedPath)) {
          return {
            content: [{
              type: "text",
              text: `No cleaned.html found at ${cleanedPath}. Write your HTML there first, then call compare.`,
            }],
          };
        }

        const html = await readFile(cleanedPath, "utf-8");

        // MCP-level image path validation (warn but don't block)
        const mcpWarnings: string[] = [];
        if (/(?:src|url)\s*[=(]\s*['"]?https?:\/\/localhost/i.test(html)) {
          mcpWarnings.push(`\u{1F6A8} [localhost_url] cleaned.html contains localhost URLs in image/asset references. Use relative paths: images/{hash}.png`);
        }
        if (/(?:src|url)\s*[=(]\s*['"]?https?:\/\/engine\.codefromdesign/i.test(html)) {
          mcpWarnings.push(`\u{1F6A8} [engine_url] cleaned.html contains engine API URLs in image/asset references. Use relative paths: images/{hash}.png`);
        }

        // Send to engine for screenshot + diff
        const res = await engineFetch(config, `/api/jobs/${jobId}/frames/${frameIndex}/compare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html }),
        });

        if (!res.ok) {
          const body = await res.text();
          return { content: [{ type: "text", text: `Compare failed: ${res.status} ${body}` }] };
        }

        const result = await res.json();

        const lines: string[] = [];

        // Surface engine validation warnings first (most important)
        if (result.warnings?.length) {
          for (const w of result.warnings) {
            const icon = w.severity === 'critical' ? '\u{1F6A8}' : '\u{26A0}\u{FE0F}';
            lines.push(`${icon} [${w.code}] ${w.message}`);
            if (w.context) lines.push(`   Context: ${w.context}`);
          }
          lines.push(``);
        }

        // Surface MCP-level warnings
        if (mcpWarnings.length > 0) {
          lines.push(...mcpWarnings, ``);
        }

        // MCP-level parity regression check (only on iteration 2+).
        // Iteration 1 converts absolute-positioned Figma HTML to semantic/responsive
        // HTML — parity drop from raw HTML is expected and normal.
        const iterationCount = result.iterationCount ?? 1;
        if (iterationCount >= 2) {
          const compareLogPath = join(wsPath, "frames", String(frameIndex), "compare-log.json");
          if (existsSync(compareLogPath)) {
            try {
              const logEntries = JSON.parse(await readFile(compareLogPath, "utf-8"));
              if (Array.isArray(logEntries) && logEntries.length > 0) {
                const prevParity = logEntries[logEntries.length - 1]?.parity ?? 0;
                const currentParity = result.parityScore ?? 0;
                if (currentParity < prevParity - 1) {
                  lines.push(`\u{1F6A8} PARITY REGRESSION: Previous iteration was ${prevParity.toFixed(1)}%. This iteration scored ${currentParity.toFixed(1)}%. Your latest changes made things WORSE.`);
                  lines.push(``);
                }
              }
            } catch { /* ignore */ }
          }
        }

        lines.push(`Frame ${frameIndex} comparison complete (iteration ${result.iterationCount})`);
        lines.push(``);
        lines.push(`Parity: ${result.parityScore?.toFixed(1) ?? "n/a"}%`);

        if (result.nonFontParity != null) {
          lines.push(`Non-font parity: ${result.nonFontParity.toFixed(1)}%`);
        }
        if (result.layoutParity != null) {
          lines.push(`Layout: ${result.layoutParity.toFixed(1)}%  Font: ${result.fontParity?.toFixed(1) ?? "n/a"}%  Image: ${result.imageParity?.toFixed(1) ?? "n/a"}%  Vector: ${result.vectorParity?.toFixed(1) ?? "n/a"}%`);
        }
        if (result.topIssue) {
          lines.push(`Top issue: ${result.topIssue} (${result.topIssueDiffPixels} diff pixels)`);
        }
        lines.push(`Duration: ${result.durationMs}ms`);
        lines.push(``);

        if ((result.parityScore ?? 0) >= 95) {
          lines.push(`Parity is above 95% — frame looks good. You can submit it or keep refining.`);
        } else if ((result.parityScore ?? 0) >= 85) {
          lines.push(`Parity is decent but can be improved. Check the diff image for remaining issues.`);
          lines.push(`Run: sync to download the updated cleaned-diff.png and cleaned-screenshot.png`);
        } else {
          lines.push(`Parity is below 85% — significant differences remain. Review the diff carefully.`);
          lines.push(`Run: sync to download the updated cleaned-diff.png and cleaned-screenshot.png`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Compare failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: get_snips ---
  server.tool(
    "get_snips",
    "Retrieve user-reported visual issues (snips). ONLY call this when the user pastes snip metadata into the conversation. Never call proactively or as a first action.",
    {
      jobId: z.string().describe("The job ID"),
    },
    async ({ jobId }) => {
      const snipsDir = join(getWorkspacePath(jobId), "snips");
      if (!existsSync(snipsDir)) {
        return { content: [{ type: "text", text: "No snips found. The user can create snips using the snip tool in the CodeFromDesign web app." }] };
      }

      try {
        const files = await readdir(snipsDir);
        const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

        if (jsonFiles.length === 0) {
          return { content: [{ type: "text", text: "No snips found." }] };
        }

        // Build content array with text metadata + inline images
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

        content.push({ type: "text", text: `Found ${jsonFiles.length} snip(s) for job ${jobId}:\n` });

        for (const file of jsonFiles) {
          try {
            const raw = await readFile(join(snipsDir, file), "utf-8");
            const snip = JSON.parse(raw);

            // Add metadata as text
            const lines: string[] = [`--- Snip (${new Date(snip.timestamp).toISOString()}) ---`];
            for (const [key, val] of Object.entries(snip)) {
              if (key !== "timestamp") {
                lines.push(`  ${key}: ${val}`);
              }
            }
            content.push({ type: "text", text: lines.join("\n") });

            // Add the cropped image inline if it exists
            if (snip.imagePath && existsSync(snip.imagePath)) {
              const imgData = await readFile(snip.imagePath);
              content.push({
                type: "image",
                data: imgData.toString("base64"),
                mimeType: "image/png",
              });
            }

            content.push({ type: "text", text: "" });
          } catch {
            // skip malformed files
          }
        }

        content.push({ type: "text", text: "Address these snips — they are user-reported issues that take priority." });

        return { content };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Failed to read snips: ${err.message}` }] };
      }
    }
  );

  // --- Tool: clear_snips ---
  server.tool(
    "clear_snips",
    "Remove all snips for a job. Call this after the user-reported issues have been resolved and confirmed via compare.",
    {
      jobId: z.string().describe("The job ID"),
    },
    async ({ jobId }) => {
      const snipsDir = join(getWorkspacePath(jobId), "snips");
      if (!existsSync(snipsDir)) {
        return { content: [{ type: "text", text: "No snips directory found — nothing to clear." }] };
      }

      try {
        await rm(snipsDir, { recursive: true });
        return { content: [{ type: "text", text: `Cleared all snips for job ${jobId}.` }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Failed to clear snips: ${err.message}` }] };
      }
    }
  );

  // --- Tool: workspace_path ---
  server.tool(
    "workspace_path",
    "Get the local filesystem path to a job's workspace directory.",
    {
      jobId: z.string().describe("The job ID"),
    },
    async ({ jobId }) => {
      const wsPath = getWorkspacePath(jobId);
      return { content: [{ type: "text", text: wsPath }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[cfd] mcp server started");
}
