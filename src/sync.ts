import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCfdDir, type CfdConfig } from "./config.js";
import { engineFetch } from "./engine.js";

const WORKSPACE_BASE = () => join(getCfdDir(), "workspace");

export function getWorkspacePath(jobId: string): string {
  return join(WORKSPACE_BASE(), jobId);
}

export async function syncJob(
  config: CfdConfig,
  jobId: string
): Promise<{
  workspacePath: string;
  frameCount: number;
  frames: Array<{ index: number; name: string; width: number; height: number; parity: string }>;
}> {
  const jobRes = await engineFetch(config, `/api/jobs/${jobId}`);
  if (!jobRes.ok) {
    throw new Error(`Failed to fetch job: ${jobRes.status} ${jobRes.statusText}`);
  }
  const job = await jobRes.json();

  if (job.status !== "completed" && job.status !== "running") {
    throw new Error(`Job is ${job.status}, expected completed or running`);
  }

  const wsPath = getWorkspacePath(jobId);
  const framesDir = join(wsPath, "frames");

  await mkdir(wsPath, { recursive: true });
  await mkdir(framesDir, { recursive: true });

  // Write job metadata
  const jobMeta = {
    id: job.id,
    status: job.status,
    figmaUrl: job.figmaUrl,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    stages: job.stages?.map((s: any) => ({
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
    })),
    frames: job.frames?.map((f: any, i: number) => ({
      index: i,
      name: f.name || `Frame ${i}`,
      page: f.page || "Page 1",
      width: f.width,
      height: f.height,
      parityScore: f.parityScore,
      parityNonFont: f.parityNonFont,
      parityBreakdown: f.parityBreakdown,
      correctionIterations: f.correctionIterations,
      issues: f.issues,
    })),
  };
  await writeFile(join(wsPath, "job.json"), JSON.stringify(jobMeta, null, 2));

  // Sync each frame
  const frames = job.frames || [];
  const frameSummaries: Array<{ index: number; name: string; width: number; height: number; parity: string }> = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const frameDir = join(framesDir, String(i));
    await mkdir(frameDir, { recursive: true });

    // Write frame metadata
    const frameMeta = {
      index: i,
      name: frame.name || `Frame ${i}`,
      page: frame.page || "Page 1",
      width: frame.width,
      height: frame.height,
      parityScore: frame.parityScore,
      parityNonFont: frame.parityNonFont,
      parityBreakdown: frame.parityBreakdown,
      correctionIterations: frame.correctionIterations,
      issues: frame.issues,
    };
    await writeFile(join(frameDir, "metadata.json"), JSON.stringify(frameMeta, null, 2));

    // Download artifacts in parallel
    const artifacts = [
      { name: "rendered.html", endpoint: `/api/jobs/${jobId}/frames/${i}/html` },
      { name: "figma-screenshot.png", endpoint: `/api/jobs/${jobId}/frames/${i}/figma-screenshot` },
      { name: "screenshot.png", endpoint: `/api/jobs/${jobId}/frames/${i}/screenshot` },
      { name: "diff.png", endpoint: `/api/jobs/${jobId}/frames/${i}/diff` },
      { name: "manifest.json", endpoint: `/api/jobs/${jobId}/frames/${i}/manifest` },
      { name: "ai-ready.html", endpoint: `/api/jobs/${jobId}/frames/${i}/ai-ready-html` },
      // Compare iteration artifacts (available after calling compare)
      { name: "cleaned-screenshot.png", endpoint: `/api/jobs/${jobId}/frames/${i}/cleaned-screenshot` },
      { name: "cleaned-diff.png", endpoint: `/api/jobs/${jobId}/frames/${i}/cleaned-diff` },
    ];

    await Promise.allSettled(
      artifacts.map(async (art) => {
        try {
          const res = await engineFetch(config, art.endpoint);
          if (res.ok) {
            const data = Buffer.from(await res.arrayBuffer());
            await writeFile(join(frameDir, art.name), data);
          }
        } catch {
          // Skip missing artifacts
        }
      })
    );

    // Download issue-diff if available
    try {
      const issueRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${i}/artifact/issue-diff.json`);
      if (issueRes.ok) {
        const data = Buffer.from(await issueRes.arrayBuffer());
        await writeFile(join(frameDir, "issue-diff.json"), data);
      }
    } catch {
      // Skip
    }

    // Download SVG map and image map
    for (const mapFile of ["svg-map.json", "image-map.json"]) {
      try {
        const res = await engineFetch(config, `/api/jobs/${jobId}/frames/${i}/${mapFile.replace(".json", "")}`);
        if (res.ok) {
          const data = Buffer.from(await res.arrayBuffer());
          await writeFile(join(frameDir, mapFile), data);
        }
      } catch {
        // Skip
      }
    }

    // Download frame images
    try {
      const mapRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${i}/image-map`);
      if (mapRes.ok) {
        const imageMap: Record<string, string> = await mapRes.json();
        const imgDir = join(frameDir, "images");
        await mkdir(imgDir, { recursive: true });

        await Promise.allSettled(
          Object.values(imageMap).map(async (filename) => {
            try {
              const imgRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${i}/images/${filename}`);
              if (imgRes.ok) {
                const data = Buffer.from(await imgRes.arrayBuffer());
                await writeFile(join(imgDir, filename), data);
              }
            } catch {
              // Skip missing images
            }
          })
        );
      }
    } catch {
      // Skip if no image map
    }

    frameSummaries.push({
      index: i,
      name: frame.name || `Frame ${i}`,
      width: frame.width,
      height: frame.height,
      parity: `${(frame.parityScore ?? 0).toFixed(1)}%`,
    });

    console.error(`[cfd] synced frame ${i}/${frames.length - 1}: ${frame.name}`);
  }

  console.error(`[cfd] sync complete: ${frames.length} frames -> ${wsPath}`);

  return {
    workspacePath: wsPath,
    frameCount: frames.length,
    frames: frameSummaries,
  };
}
