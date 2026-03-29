import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
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
    { name: "cfd", version: "0.3.0" },
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
              `    conversion-instructions.md  -- methodology for cleaning frames`,
              `    frames/`,
              ...result.frames.map((f) =>
                `      ${f.index}/                   -- ${f.name} (${f.width}x${f.height}, parity: ${f.parity})`
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
              `Use Claude Code's Read tool to examine these files. Start with job.json for an overview.`,
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
    "Submit cleaned HTML for a frame. Reads from workspace frames/{idx}/cleaned.html and uploads to the engine.",
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
    "Screenshot cleaned.html and diff against the Figma reference. Returns parity score and category breakdown. Call sync after to download updated diff images.",
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

        const lines = [
          `Frame ${frameIndex} comparison complete (iteration ${result.iterationCount})`,
          ``,
          `Parity: ${result.parityScore?.toFixed(1) ?? "n/a"}%`,
        ];

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
