import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, readdir, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { engineFetch } from "./engine.js";
import { syncJob, syncFrame, getWorkspacePath, getFrameCleanStatus } from "./sync.js";
import { submitFrame, buildWebsite, uploadWebsite } from "./submit.js";
import { HANDSHAKE_INSTRUCTIONS, CLEAN_FRAMES_INSTRUCTIONS, BUILD_WEBSITE_INSTRUCTIONS } from "./instructions/index.js";
import { validateForSubmission, containsLoopbackUrls } from "./validate.js";

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
    { name: "cfd", version: "0.8.0" },
    { instructions: HANDSHAKE_INSTRUCTIONS },
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
              `  ai-ready.html         -- YOUR PRIMARY INPUT (DOM with data-image-ref/data-svg-id placeholders)`,
              `  manifest.json         -- section roles, flex properties, component detection`,
              `  issue-diff.json       -- per-node parity breakdown (fixable vs unfixable)`,
              `  figma-screenshot.png  -- reference (what it should look like)`,
              `  diff.png              -- pixel diff overlay`,
              ``,
              `Read build-guide.json for the website assembly plan (page-to-frame mapping, breakpoints, output structure).`,
              `Read job.json for an overview of all frames and parity scores.`,
              ``,
              // Contextual instructions based on frame clean status
              ...await (async () => {
                const cleanStatus = await getFrameCleanStatus(jobId);
                if (cleanStatus.total === 0) return [];
                if (cleanStatus.uncleaned.length === 0) {
                  return [
                    `---`,
                    ``,
                    `All ${cleanStatus.total} frames are cleaned and submitted. Ready for Job 2 (website build).`,
                    `Call check_readiness to get the website build instructions.`,
                  ];
                }
                return [
                  `---`,
                  ``,
                  `${cleanStatus.cleaned}/${cleanStatus.total} frames cleaned. ${cleanStatus.uncleaned.length} remaining: [${cleanStatus.uncleaned.join(", ")}]`,
                  ``,
                  CLEAN_FRAMES_INSTRUCTIONS,
                ];
              })(),
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
    "Submit production-quality cleaned HTML for a frame. BLOCKS submission if HTML fails structural quality checks (no semantic elements, mass absolute positioning, inline styles, missing flexbox/grid). Write proper production code before calling this.",
    {
      jobId: z.string().describe("The job ID"),
      frameIndex: z.number().describe("The frame index (0-based)"),
    },
    async ({ jobId, frameIndex }) => {
      try {
        const wsPath = getWorkspacePath(jobId);
        const cleanedPath = join(wsPath, "frames", String(frameIndex), "cleaned.html");

        if (!existsSync(cleanedPath)) {
          return { content: [{ type: "text", text: `No cleaned.html found at ${cleanedPath}. Write cleaned HTML to this path before submitting.` }] };
        }

        const html = await readFile(cleanedPath, "utf-8");

        // --- Structural quality gate — BLOCKS on failure ---
        const imagesDir = join(wsPath, "frames", String(frameIndex), "images");
        const submission = validateForSubmission(html, existsSync(imagesDir) ? imagesDir : undefined);
        if (!submission.pass) {
          const lines = [
            `SUBMISSION BLOCKED — cleaned.html failed structural quality checks:\n`,
            ...submission.errors.map(e => `  FAIL: ${e}`),
            ``,
            `Fix these issues in cleaned.html and try again.`,
            `The quality gate ensures production-grade code — no shortcuts.`,
          ];
          if (submission.warnings.length > 0) {
            lines.push(``, `Warnings (non-blocking):`, ...submission.warnings.map(w => `  WARN: ${w}`));
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        // Passed gate — submit to engine
        const result = await submitFrame(config, jobId, frameIndex);

        // Write .submitted marker for build gate
        const markerPath = join(wsPath, "frames", String(frameIndex), ".submitted");
        await writeFile(markerPath, "", "utf-8");

        // Report status
        const lines: string[] = [];
        if (submission.warnings.length > 0) {
          lines.push(`Warnings (non-blocking):`, ...submission.warnings.map(w => `  ${w}`), ``);
        }
        lines.push(result);

        // Count cleaned vs total frames
        const framesDir = join(wsPath, "frames");
        if (existsSync(framesDir)) {
          const frameDirs = (await readdir(framesDir)).filter(d => /^\d+$/.test(d));
          const total = frameDirs.length;
          const submitted = frameDirs.filter(d => existsSync(join(framesDir, d, ".submitted"))).length;
          const remaining = total - submitted;
          if (remaining === 0) {
            lines.push(`\nAll ${total} frames cleaned and submitted. Ready for website build — call check_readiness to proceed.`);
          } else {
            lines.push(`\n${submitted}/${total} frames submitted. ${remaining} remaining.`);
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Submit failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: validate ---
  server.tool(
    "validate",
    "Instant structural quality check on cleaned.html — no server round-trip. Runs the same checks as submit_cleaned_frame's gate. Call this before compare to catch issues early.",
    {
      jobId: z.string().describe("The job ID"),
      frameIndex: z.number().describe("The frame index (0-based)"),
    },
    async ({ jobId, frameIndex }) => {
      try {
        const wsPath = getWorkspacePath(jobId);
        const cleanedPath = join(wsPath, "frames", String(frameIndex), "cleaned.html");

        if (!existsSync(cleanedPath)) {
          return { content: [{ type: "text", text: `No cleaned.html found at ${cleanedPath}. Write cleaned HTML first.` }] };
        }

        const html = await readFile(cleanedPath, "utf-8");
        const imagesDir = join(wsPath, "frames", String(frameIndex), "images");
        const result = validateForSubmission(html, existsSync(imagesDir) ? imagesDir : undefined);

        const lines: string[] = [];
        if (result.pass) {
          lines.push(`PASSED — cleaned.html meets structural quality requirements.`);
        } else {
          lines.push(`FAILED — ${result.errors.length} blocking issue(s):\n`);
          lines.push(...result.errors.map(e => `  FAIL: ${e}`));
        }
        if (result.warnings.length > 0) {
          lines.push(``, `Warnings:`, ...result.warnings.map(w => `  WARN: ${w}`));
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Validate failed: ${err.message}` }] };
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

  // --- Tool: check_readiness ---
  server.tool(
    "check_readiness",
    "Check if all frames are cleaned and ready for website assembly. Returns Job 2 (build website) instructions if ready, or lists which frames still need cleaning.",
    {
      jobId: z.string().describe("The job ID"),
    },
    async ({ jobId }) => {
      try {
        const cleanStatus = await getFrameCleanStatus(jobId);

        if (cleanStatus.total === 0) {
          return { content: [{ type: "text", text: `No frames found for job ${jobId}. Run sync first.` }] };
        }

        if (cleanStatus.uncleaned.length > 0) {
          return { content: [{ type: "text", text: `NOT READY for website build.\n\nCleaned: ${cleanStatus.cleaned}/${cleanStatus.total}\nUncleaned frames: [${cleanStatus.uncleaned.join(", ")}]\n\nComplete Job 1 — clean and submit each uncleaned frame before proceeding.` }] };
        }

        // All frames clean — return Job 2 instructions
        return { content: [{ type: "text", text: `All ${cleanStatus.total} frames cleaned and submitted. Ready for website build.\n\n${BUILD_WEBSITE_INSTRUCTIONS}` }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Check failed: ${err.message}` }] };
      }
    }
  );

  // --- Tool: submit_website ---
  server.tool(
    "submit_website",
    "Upload website directory to engine. BLOCKS if any frames have not been cleaned and submitted first. Validates images, HTML quality, and localhost URLs before uploading.",
    {
      jobId: z.string().describe("The job ID this website was built from"),
      directory: z.string().describe("Absolute path to the directory containing the built website files (HTML, CSS, JS, images)"),
    },
    async ({ jobId, directory }) => {
      try {
        // --- Build gate: all frames must be cleaned ---
        const cleanStatus = await getFrameCleanStatus(jobId);
        if (cleanStatus.total > 0 && cleanStatus.uncleaned.length > 0) {
          return { content: [{ type: "text", text: `SUBMISSION BLOCKED — not all frames have been cleaned and submitted.\n\nUncleaned frames: [${cleanStatus.uncleaned.join(", ")}]\nCleaned: ${cleanStatus.cleaned}/${cleanStatus.total}\n\nComplete Job 1 (clean frames) before building a website. Use submit_cleaned_frame for each frame.` }] };
        }

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
    "Collect all images from all frames into website/images/ for website assembly. Deduplicates by filename. Requires all frames to be cleaned and submitted first.",
    {
      jobId: z.string().describe("The job ID"),
    },
    async ({ jobId }) => {
      try {
        // --- Build gate: all frames must be cleaned ---
        const cleanStatus = await getFrameCleanStatus(jobId);
        if (cleanStatus.total > 0 && cleanStatus.uncleaned.length > 0) {
          return { content: [{ type: "text", text: `BLOCKED — not all frames have been cleaned and submitted.\n\nUncleaned frames: [${cleanStatus.uncleaned.join(", ")}]\nCleaned: ${cleanStatus.cleaned}/${cleanStatus.total}\n\nComplete Job 1 (clean frames) before collecting images for website build.` }] };
        }

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

        // Just data — no warnings, no coaching. The submit gate handles enforcement.
        const lines: string[] = [];
        const iterationCount = result.iterationCount ?? 1;

        lines.push(`Frame ${frameIndex} — iteration ${iterationCount}`);
        lines.push(``);
        lines.push(`Parity: ${result.parityScore?.toFixed(1) ?? "n/a"}%`);
        if (result.nonFontParity != null) {
          lines.push(`Non-font: ${result.nonFontParity.toFixed(1)}%`);
        }
        if (result.layoutParity != null) {
          lines.push(`Layout: ${result.layoutParity.toFixed(1)}%  Font: ${result.fontParity?.toFixed(1) ?? "n/a"}%  Image: ${result.imageParity?.toFixed(1) ?? "n/a"}%  Vector: ${result.vectorParity?.toFixed(1) ?? "n/a"}%`);
        }
        if (result.topIssue) {
          lines.push(`Top issue: ${result.topIssue} (${result.topIssueDiffPixels} diff px)`);
        }
        lines.push(`Duration: ${result.durationMs}ms`);

        // Parity regression detection (iteration 2+) — this is actionable data, not a warning
        if (iterationCount >= 2) {
          const compareLogPath = join(wsPath, "frames", String(frameIndex), "compare-log.json");
          if (existsSync(compareLogPath)) {
            try {
              const logEntries = JSON.parse(await readFile(compareLogPath, "utf-8"));
              if (Array.isArray(logEntries) && logEntries.length > 0) {
                const prevParity = logEntries[logEntries.length - 1]?.parity ?? 0;
                const currentParity = result.parityScore ?? 0;
                if (currentParity < prevParity - 3) {
                  lines.push(``);
                  lines.push(`REGRESSION: ${prevParity.toFixed(1)}% -> ${currentParity.toFixed(1)}%. Latest changes made things worse.`);
                }
              }
            } catch { /* non-critical */ }
          }
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
      try {
        const res = await engineFetch(config, `/api/jobs/${jobId}/snips`);
        if (!res.ok) {
          return { content: [{ type: "text", text: "No snips found. The user can create snips using the snip tool in the CodeFromDesign web app." }] };
        }

        const entries: Array<{ snipName: string; metadata: Record<string, unknown>; imageBase64?: string }> = await res.json();

        if (entries.length === 0) {
          return { content: [{ type: "text", text: "No snips found." }] };
        }

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
        content.push({ type: "text", text: `Found ${entries.length} snip(s) for job ${jobId}:\n` });

        for (const entry of entries) {
          const meta = entry.metadata;
          const lines: string[] = [`--- Snip ${entry.snipName} (${meta.timestamp ? new Date(meta.timestamp as number).toISOString() : "unknown"}) ---`];
          for (const [key, val] of Object.entries(meta)) {
            if (key !== "timestamp" && key !== "snipName") {
              lines.push(`  ${key}: ${val}`);
            }
          }
          content.push({ type: "text", text: lines.join("\n") });

          if (entry.imageBase64) {
            content.push({
              type: "image",
              data: entry.imageBase64,
              mimeType: "image/png",
            });
          }

          content.push({ type: "text", text: "" });
        }

        content.push({ type: "text", text: "Address these snips — they are user-reported issues that take priority." });
        return { content };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Failed to fetch snips: ${err.message}` }] };
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
      try {
        const res = await engineFetch(config, `/api/jobs/${jobId}/snips`, { method: "DELETE" });
        if (!res.ok) {
          const errText = await res.text().catch(() => "unknown error");
          return { content: [{ type: "text", text: `Failed to clear snips: ${errText}` }] };
        }
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
