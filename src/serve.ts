import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, readdir, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { engineFetch } from "./engine.js";
import { syncJob, syncFrame, getWorkspacePath } from "./sync.js";
import { submitFrame, buildWebsite, uploadWebsite } from "./submit.js";
import { MCP_INSTRUCTIONS } from "./instructions.js";
import { validateCleanedHtml, containsLoopbackUrls } from "./validate.js";

// Recursively walk a directory — cross-platform, works on all Node 18+ versions
async function walkWebsiteDir(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      files.push(...await walkWebsiteDir(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export async function startMcpServer(): Promise<void> {
  const config = await loadConfig();

  const server = new McpServer(
    { name: "cfd", version: "0.5.0" },
    { instructions: MCP_INSTRUCTIONS },
  );

  // --- Tool: list ---
  server.tool(
    "list",
    "List all pipeline jobs from CodeFromDesign. Returns job IDs, status, Figma URLs, frame counts, and parity scores.",
    {},
    async () => {
      // API key check — catch missing config early
      if (!config.apiKey) {
        return { content: [{ type: "text", text: `No API key configured. Run \`cfd init <your-api-key>\` to set up, or set the CFD_API_KEY environment variable.` }] };
      }

      // Health check — catch unreachable engine early with a clear message
      try {
        const healthRes = await engineFetch(config, "/health");
        if (!healthRes.ok) {
          return { content: [{ type: "text", text: `Engine health check failed (${healthRes.status}). Is the engine running at ${config.engineUrl}?` }] };
        }
      } catch (err: any) {
        return { content: [{ type: "text", text: `Engine not reachable at ${config.engineUrl}. Check that the engine is running and your network connection is active.\n\nError: ${err.message}` }] };
      }

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

        // Collect warnings from all frames
        const allWarnings: string[] = [];
        for (const f of result.frames) {
          if (f.warnings?.length) {
            allWarnings.push(`\u{1F6A8} Frame ${f.index} (${f.name}): missing critical artifacts: ${f.warnings.join(", ")}`);
          }
        }

        return {
          content: [{
            type: "text",
            text: [
              // Surface warnings first — most important
              ...(allWarnings.length > 0 ? [...allWarnings, ``] : []),
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
              ...result.frames.map((f) =>
                `      ${f.index}/                   -- ${f.name} (${f.width}x${f.height}, parity: ${f.parity}, images: ${f.images})`
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

  // --- Tool: sync_frame ---
  server.tool(
    "sync_frame",
    "Re-sync a single frame's artifacts (screenshots, diffs, metadata, images). Much faster than full sync — use after compare to get updated artifacts, or to re-download a specific frame.",
    {
      jobId: z.string().describe("The job ID"),
      frameIndex: z.number().describe("The frame index (0-based)"),
    },
    async ({ jobId, frameIndex }) => {
      try {
        const result = await syncFrame(config, jobId, frameIndex);

        const warnings: string[] = [];
        if (result.warnings?.length) {
          warnings.push(`\u{1F6A8} Missing critical artifacts: ${result.warnings.join(", ")}`);
        }

        return {
          content: [{
            type: "text",
            text: [
              ...(warnings.length > 0 ? [...warnings, ``] : []),
              `Synced frame ${frameIndex}: ${result.name}`,
              `Dimensions: ${result.width}x${result.height}`,
              `Parity: ${result.parity}`,
              `Images: ${result.images}`,
            ].join("\n"),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Sync frame failed: ${err.message}` }] };
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
        // Validate cleaned.html before submitting (warn, don't block)
        const wsPath = getWorkspacePath(jobId);
        const cleanedPath = join(wsPath, "frames", String(frameIndex), "cleaned.html");
        const lines: string[] = [];

        if (existsSync(cleanedPath)) {
          const html = await readFile(cleanedPath, "utf-8");
          const validation = validateCleanedHtml(html);
          if (validation.warnings.length > 0) {
            lines.push(...validation.warnings);
            lines.push(``);
          }
          if (validation.isRawHtml) {
            lines.push(`\u{26A0}\u{FE0F} Submitting anyway, but this HTML will NOT produce a functional website.`);
            lines.push(`Run compare first, then rewrite with semantic HTML before submitting.`);
            lines.push(``);
          }
        }

        const result = await submitFrame(config, jobId, frameIndex);
        lines.push(result);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Submit failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: build ---
  server.tool(
    "build",
    "Trigger ENGINE-SIDE website build from cleaned frames (engine does all the work). Rarely needed — prefer submit_website for the standard Claude Code workflow where YOU build the responsive website locally.",
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
    "Upload YOUR locally-built website directory to the engine. THIS IS THE STANDARD FLOW — you build the responsive website locally (Phase C), then upload it here. Validates images and HTML before uploading.",
    {
      jobId: z.string().describe("The job ID this website was built from"),
      directory: z.string().describe("Absolute path to the directory containing the built website files (HTML, CSS, JS, images)"),
    },
    async ({ jobId, directory }) => {
      try {
        // Validate images directory
        const imagesDir = join(directory, "images");
        if (!existsSync(imagesDir)) {
          return { content: [{ type: "text", text: `\u{1F6A8} VALIDATION FAILED: No images/ directory found in the website. Call collect_images first to gather images from all frames into website/images/ (Phase C Step C5). Fix this before submitting.` }] };
        }
        const imageFiles = (await readdir(imagesDir)).filter((f) => !f.startsWith("."));
        if (imageFiles.length === 0) {
          return { content: [{ type: "text", text: `\u{1F6A8} VALIDATION FAILED: website/images/ directory is EMPTY. Call collect_images first to gather images from all frames (Phase C Step C5). Fix this before submitting.` }] };
        }

        // Scan ALL HTML files for localhost/loopback references (report all violations at once)
        const localhostViolations: string[] = [];
        const allFiles = await walkWebsiteDir(directory);
        for (const fullPath of allFiles) {
          const relPath = fullPath.slice(directory.length + 1).split("\\").join("/");
          if (relPath.endsWith(".html")) {
            const fileContent = await readFile(fullPath, "utf-8");
            if (containsLoopbackUrls(fileContent)) {
              localhostViolations.push(relPath);
            }
          }
        }
        if (localhostViolations.length > 0) {
          return { content: [{ type: "text", text: `\u{1F6A8} VALIDATION FAILED: ${localhostViolations.length} file(s) contain localhost/loopback URLs:\n${localhostViolations.map(f => `  - ${f}`).join("\n")}\n\nAll image/asset references must use relative paths (images/{hash}.png). Fix ALL files before submitting.` }] };
        }

        // Validate against build-guide.json (warn, don't block)
        const submitWarnings: string[] = [];
        const buildGuidePath = join(getWorkspacePath(jobId), "build-guide.json");
        if (existsSync(buildGuidePath)) {
          try {
            const guide = JSON.parse(await readFile(buildGuidePath, "utf-8"));
            if (guide.pages) {
              for (const page of guide.pages) {
                const expectedFile = join(directory, page.outputFile);
                if (!existsSync(expectedFile)) {
                  submitWarnings.push(`\u{26A0}\u{FE0F} Missing page: ${page.outputFile} (expected for "${page.name}")`);
                }
              }
            }
            const cssPath = join(directory, "css", "styles.css");
            if (!existsSync(cssPath)) {
              submitWarnings.push(`\u{26A0}\u{FE0F} Missing css/styles.css — shared design system file expected`);
            }
          } catch {
            submitWarnings.push(`\u{26A0}\u{FE0F} Could not read build-guide.json — structural validation skipped`);
          }
        }

        const result = await uploadWebsite(config, jobId, directory);

        const finalText = submitWarnings.length > 0
          ? [...submitWarnings, ``, result].join("\n")
          : result;

        return { content: [{ type: "text", text: finalText }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Upload failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: collect_images ---
  server.tool(
    "collect_images",
    "Collect all images from all frames into website/images/ for website assembly. Deduplicates by filename. Call this during Phase C (website assembly) instead of manually copying images.",
    {
      jobId: z.string().describe("The job ID"),
    },
    async ({ jobId }) => {
      try {
        const wsPath = getWorkspacePath(jobId);
        const framesDir = join(wsPath, "frames");

        if (!existsSync(framesDir)) {
          return { content: [{ type: "text", text: `No frames directory found at ${framesDir}. Run sync first to download frame data.` }] };
        }

        const websiteImagesDir = join(wsPath, "website", "images");
        await mkdir(websiteImagesDir, { recursive: true });

        // Read all frame directories
        const frameDirs = (await readdir(framesDir)).filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(a) - Number(b));

        let collected = 0;
        let duplicates = 0;
        const errors: string[] = [];
        const collisions: string[] = [];
        const seen = new Map<string, { size: number; frame: string }>();

        for (const frameIdx of frameDirs) {
          const imgDir = join(framesDir, frameIdx, "images");
          if (!existsSync(imgDir)) continue;

          const files = await readdir(imgDir);
          for (const file of files) {
            if (file.startsWith(".")) continue;
            try {
              const srcPath = join(imgDir, file);
              const fileStat = await stat(srcPath);

              if (seen.has(file)) {
                const prev = seen.get(file)!;
                if (prev.size !== fileStat.size) {
                  collisions.push(`${file} (frame ${prev.frame}: ${prev.size}B vs frame ${frameIdx}: ${fileStat.size}B)`);
                }
                duplicates++;
                continue;
              }

              seen.set(file, { size: fileStat.size, frame: frameIdx });
              const data = await readFile(srcPath);
              await writeFile(join(websiteImagesDir, file), data);
              collected++;
            } catch (fileErr: any) {
              errors.push(`frame ${frameIdx}/${file}: ${fileErr.message}`);
            }
          }
        }

        const resultLines = [
          `Collected images to ${websiteImagesDir}`,
          `Files: ${collected} unique, ${duplicates} duplicates skipped`,
          `Source frames: ${frameDirs.length}`,
        ];

        if (collisions.length > 0) {
          resultLines.push(``);
          resultLines.push(`\u{26A0}\u{FE0F} ${collisions.length} filename collision(s) with DIFFERENT sizes (first copy kept):`);
          for (const c of collisions) resultLines.push(`  - ${c}`);
        }

        if (errors.length > 0) {
          resultLines.push(``);
          resultLines.push(`\u{26A0}\u{FE0F} ${errors.length} file(s) failed to copy:`);
          for (const e of errors) resultLines.push(`  - ${e}`);
        }

        resultLines.push(``);
        resultLines.push(`Images are ready. Reference them in your HTML as: images/{filename}`);

        return {
          content: [{
            type: "text",
            text: resultLines.join("\n"),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Collect images failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: compare ---
  server.tool(
    "compare",
    "Screenshot cleaned.html and diff against the Figma reference. Returns parity score, category breakdown, AND diff images inline (no sync needed). REMINDER: max 2 background agents at a time.",
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

        // MCP-level validation (localhost, engine URLs, raw HTML detection)
        const sharedValidation = validateCleanedHtml(html);
        const mcpWarnings = sharedValidation.warnings;

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
        const iterationCount = result.iterationCount ?? 1;

        // ── RAW HTML DETECTION ──────────────────────────────────────────
        // Check if engine flagged excessive absolute positioning (raw Figma HTML).
        // This is the #1 failure mode: Claude submits raw HTML unchanged, gets 99%
        // parity, and stops — producing a non-functional website.
        // Combine engine-side and local raw HTML detection
        let rawHtmlDetected = sharedValidation.isRawHtml;
        const absWarning = result.warnings?.find((w: any) => w.code === "absolute_position");
        if (absWarning) {
          const countMatch = absWarning.message?.match(/(\d+)\s+elements/);
          const absCount = countMatch ? parseInt(countMatch[1], 10) : 0;
          if (absCount > 50) rawHtmlDetected = true;
        }
        if (rawHtmlDetected) {
          // Remove any raw-HTML warning from mcpWarnings (avoid duplication) and show detailed guidance
          const filteredWarnings = mcpWarnings.filter((w) => !w.includes("RAW HTML DETECTED"));
          mcpWarnings.length = 0;
          mcpWarnings.push(...filteredWarnings);

          const absCount = absWarning ? (absWarning.message?.match(/(\d+)\s+elements/)?.[1] ?? "many") : "many";
          lines.push(`\u{1F6D1} RAW HTML DETECTED: Your HTML has ${absCount} absolute-positioned elements.`);
          lines.push(`This is raw Figma output, NOT cleaned HTML. You MUST convert to semantic HTML`);
          lines.push(`with flexbox/grid before the parity score becomes meaningful.`);
          lines.push(``);
          lines.push(`What to do:`);
          lines.push(`1. Read figma-screenshot.png and ai-ready.html`);
          lines.push(`2. REWRITE the HTML with <header>, <main>, <section>, <footer>`);
          lines.push(`3. Use flexbox/grid for layout — NO position:absolute for page structure`);
          lines.push(`4. Expect 65-85% parity on first clean — this is NORMAL`);
          lines.push(`5. Then iterate to 95%+ from the cleaned version`);
          lines.push(``);
        }

        // ── FIRST-ITERATION SUSPICION CHECK ─────────────────────────────
        // If iteration 1 returns >95% parity, Claude almost certainly submitted
        // raw HTML with only URL fixes. Flag it.
        if (iterationCount === 1 && (result.parityScore ?? 0) > 95 && !rawHtmlDetected) {
          lines.push(`\u{26A0}\u{FE0F} SUSPICIOUSLY HIGH FIRST-ITERATION PARITY (${result.parityScore?.toFixed(1)}%).`);
          lines.push(`First iteration after cleaning should score 65-85% because you are converting`);
          lines.push(`absolute positioning to flexbox/grid. >95% on iteration 1 usually means raw`);
          lines.push(`Figma HTML was submitted without structural cleanup.`);
          lines.push(`Verify: does your HTML use semantic elements and flexbox/grid? Or is it still`);
          lines.push(`using position:absolute with pixel coordinates?`);
          lines.push(``);
        }

        // Surface engine validation warnings (skip abs_position if already handled above)
        if (result.warnings?.length) {
          for (const w of result.warnings) {
            if (w.code === "absolute_position" && rawHtmlDetected) continue; // already shown above
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
        if (iterationCount >= 2) {
          const compareLogPath = join(wsPath, "frames", String(frameIndex), "compare-log.json");
          if (existsSync(compareLogPath)) {
            try {
              const logEntries = JSON.parse(await readFile(compareLogPath, "utf-8"));
              if (Array.isArray(logEntries) && logEntries.length > 0) {
                const prevParity = logEntries[logEntries.length - 1]?.parity ?? 0;
                const currentParity = result.parityScore ?? 0;
                if (currentParity < prevParity - 3) {
                  lines.push(`\u{1F6A8} PARITY REGRESSION: Previous iteration was ${prevParity.toFixed(1)}%. This iteration scored ${currentParity.toFixed(1)}%. Your latest changes made things WORSE.`);
                  lines.push(``);
                }
              } else {
                lines.push(`\u{26A0}\u{FE0F} compare-log.json has unexpected format — regression detection skipped for this frame.`);
                lines.push(``);
              }
            } catch {
              lines.push(`\u{26A0}\u{FE0F} compare-log.json is corrupted — regression detection unavailable for this frame.`);
              lines.push(``);
            }
          }
        }

        lines.push(`Frame ${frameIndex} comparison complete (iteration ${iterationCount})`);
        lines.push(``);

        // Show parity — but label it as meaningless if raw HTML detected
        if (rawHtmlDetected) {
          lines.push(`Raw pixel parity: ${result.parityScore?.toFixed(1) ?? "n/a"}% (NOT MEANINGFUL — clean the HTML first)`);
        } else {
          lines.push(`Parity: ${result.parityScore?.toFixed(1) ?? "n/a"}%`);
        }

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

        if (rawHtmlDetected) {
          lines.push(`\u{1F6D1} DO NOT ITERATE ON RAW HTML. Go back and rewrite with semantic structure + flexbox/grid.`);
        } else if ((result.parityScore ?? 0) >= 95) {
          lines.push(`Parity is above 95% — frame looks good. You can submit it or keep refining.`);
        } else if ((result.parityScore ?? 0) >= 85) {
          lines.push(`Parity is decent but can be improved. Check the diff image below for remaining issues.`);
        } else {
          lines.push(`Parity is below 85% — significant differences remain. Review the diff image below.`);
        }

        // Build content array with text + inline images
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
        content.push({ type: "text", text: lines.join("\n") });

        // Fetch diff and screenshot images inline — eliminates need for separate sync call
        const inlineImages: Array<{ label: string; name: string; endpoint: string }> = [
          { label: "DIFF IMAGE (color-coded: red=layout, blue=font, green=image, yellow=vector, purple=shadow):",
            name: "cleaned-diff.png",
            endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/cleaned-diff` },
          { label: "YOUR RENDERED OUTPUT (what your cleaned.html looks like):",
            name: "cleaned-screenshot.png",
            endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/cleaned-screenshot` },
        ];

        for (const img of inlineImages) {
          try {
            const imgRes = await engineFetch(config, img.endpoint);
            if (imgRes.ok) {
              const imgData = Buffer.from(await imgRes.arrayBuffer());
              await writeFile(join(wsPath, "frames", String(frameIndex), img.name), imgData);
              content.push({ type: "text", text: img.label });
              content.push({
                type: "image",
                data: imgData.toString("base64"),
                mimeType: "image/png",
              });
            } else {
              content.push({ type: "text", text: `${img.label} [Image unavailable — engine returned ${imgRes.status}]` });
            }
          } catch (imgErr: any) {
            content.push({ type: "text", text: `${img.label} [Image unavailable — ${imgErr.message || "fetch failed"}]` });
          }
        }

        // Update local compare-log.json from engine
        try {
          const logRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${frameIndex}/artifact/compare-log.json`);
          if (logRes.ok) {
            const logData = Buffer.from(await logRes.arrayBuffer());
            await writeFile(join(wsPath, "frames", String(frameIndex), "compare-log.json"), logData);
          }
        } catch { /* non-critical */ }

        return { content };
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
