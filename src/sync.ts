import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getCfdDir, type CfdConfig } from "./config.js";
import { engineFetch } from "./engine.js";

// ---------------------------------------------------------------------------
// Build guide generation — groups frames by page and classifies breakpoints
// ---------------------------------------------------------------------------

interface FrameInfo {
  index: number;
  name: string;
  page: string;
  width: number;
  height: number;
  parityScore?: number;
}

interface PageGroup {
  name: string;
  slug: string;
  outputFile: string;
  frames: Record<string, { index: number; width: number; height: number }>;
}

function classifyBreakpoint(width: number): string {
  if (width >= 1200) return "desktop";
  if (width >= 700) return "laptop";
  return "mobile";
}

function parseFrameName(name: string): { pageName: string; breakpoint: string } | null {
  // Common patterns:
  //   "Home Page - Desktop"
  //   "Sign Up Page - Mobile"
  //   "About Page - Laptop"
  //   "Home - Desktop 1920"
  //   "Home / Desktop"
  const separators = [" - ", " — ", " / "];
  for (const sep of separators) {
    const idx = name.lastIndexOf(sep);
    if (idx !== -1) {
      let pagePart = name.slice(0, idx).trim();
      const bpPart = name.slice(idx + sep.length).trim().toLowerCase();

      // Strip trailing " Page" from page name
      pagePart = pagePart.replace(/\s+Page$/i, "");

      // Determine breakpoint from the text
      let breakpoint: string;
      if (bpPart.includes("desktop") || bpPart.includes("1920") || bpPart.includes("1440")) {
        // If "1440" appears but not "desktop", treat as laptop
        if (bpPart.includes("1440") && !bpPart.includes("desktop")) {
          breakpoint = "laptop";
        } else {
          breakpoint = "desktop";
        }
      } else if (bpPart.includes("laptop") || bpPart.includes("tablet")) {
        breakpoint = "laptop";
      } else if (bpPart.includes("mobile") || bpPart.includes("phone") || bpPart.includes("375") || bpPart.includes("390")) {
        breakpoint = "mobile";
      } else {
        breakpoint = "unknown";
      }

      return { pageName: pagePart, breakpoint };
    }
  }
  return null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateBuildGuide(
  frames: FrameInfo[],
  wsPath: string,
): object {
  // Group frames by page
  const pageMap = new Map<string, PageGroup>();

  for (const frame of frames) {
    // Try parsing the frame name first
    const parsed = parseFrameName(frame.name);

    let pageName: string;
    let breakpoint: string;

    if (parsed) {
      pageName = parsed.pageName;
      breakpoint = parsed.breakpoint === "unknown"
        ? classifyBreakpoint(frame.width)
        : parsed.breakpoint;
    } else {
      // Fallback: use full name as page, classify breakpoint by width
      pageName = frame.name.replace(/\s+Page$/i, "");
      breakpoint = classifyBreakpoint(frame.width);
    }

    if (!pageMap.has(pageName)) {
      const slug = slugify(pageName);
      pageMap.set(pageName, {
        name: pageName,
        slug,
        outputFile: slug === "home" ? "index.html" : `pages/${slug}.html`,
        frames: {},
      });
    }

    const group = pageMap.get(pageName)!;
    group.frames[breakpoint] = {
      index: frame.index,
      width: frame.width,
      height: frame.height,
    };
  }

  // Sort pages: Home first, then alphabetical
  const pages = Array.from(pageMap.values()).sort((a, b) => {
    if (a.slug === "home") return -1;
    if (b.slug === "home") return 1;
    return a.name.localeCompare(b.name);
  });

  // If no page is named "home", make the first one index.html
  if (pages.length > 0 && pages[0].slug !== "home") {
    pages[0].outputFile = "index.html";
  }

  // Derive breakpoint CSS rules from actual frame widths
  const allWidths = frames.map((f) => f.width);
  const desktopWidth = Math.max(...allWidths.filter((w) => w >= 1200));
  const laptopWidth = Math.max(...allWidths.filter((w) => w >= 700 && w < 1200), 0) ||
    Math.min(...allWidths.filter((w) => w >= 1200));
  const mobileWidth = Math.max(...allWidths.filter((w) => w < 700), 0);

  const breakpoints: Record<string, object> = {
    desktop: {
      width: desktopWidth || 1920,
      cssRule: "default (no media query)",
    },
  };

  if (laptopWidth && laptopWidth < desktopWidth) {
    breakpoints.laptop = {
      width: laptopWidth,
      cssRule: `@media (max-width: ${laptopWidth}px)`,
    };
  }

  if (mobileWidth && mobileWidth < 700) {
    breakpoints.mobile = {
      width: mobileWidth,
      cssRule: `@media (max-width: ${Math.min(mobileWidth + 90, 480)}px)`,
    };
  }

  // Navigation = page names in order (for file linking, NOT for rendering as a visible nav bar)
  const navigation = pages.map((p) => p.name);

  return {
    pages,
    navigation,
    navigationNote: "This array lists ALL pages for inter-page LINKING (href targets). It does NOT define the visible nav bar. The visible nav bar must match the Figma screenshot exactly — most designs show only 3-5 main links, not every page.",
    breakpoints,
    outputStructure: {
      root: "website/",
      sharedCss: "css/styles.css",
      images: "images/",
    },
  };
}

// ---------------------------------------------------------------------------
// Log structure creation
// ---------------------------------------------------------------------------

async function createLogStructure(wsPath: string, jobMeta: any): Promise<void> {
  const logsDir = join(wsPath, "logs");
  const framesLogDir = join(logsDir, "frames");

  await mkdir(logsDir, { recursive: true });
  await mkdir(framesLogDir, { recursive: true });

  // Only write initial session-log.md if it doesn't exist yet
  const sessionLogPath = join(logsDir, "session-log.md");
  if (!existsSync(sessionLogPath)) {
    const frameCount = jobMeta.frames?.length ?? 0;
    const initialLog = [
      `# Session Log — Job ${jobMeta.id}`,
      ``,
      `**Figma URL:** ${jobMeta.figmaUrl || "n/a"}`,
      `**Frames:** ${frameCount}`,
      `**Created:** ${jobMeta.createdAt || "n/a"}`,
      ``,
      `---`,
      ``,
    ].join("\n");
    await writeFile(sessionLogPath, initialLog);
  }
}

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
  frames: Array<{ index: number; name: string; width: number; height: number; parity: string; images: string }>;
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
  const frameSummaries: Array<{ index: number; name: string; width: number; height: number; parity: string; images: string }> = [];

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

    // Download frame images and rewrite image-map.json with relative paths
    let imagesDownloaded = 0;
    let imagesTotal = 0;
    try {
      const mapRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${i}/image-map`);
      if (mapRes.ok) {
        const imageMap: Record<string, string> = await mapRes.json();
        imagesTotal = Object.keys(imageMap).length;
        const imgDir = join(frameDir, "images");
        await mkdir(imgDir, { recursive: true });

        // Rewrite image-map.json: replace full URLs with relative paths
        const rewrittenMap: Record<string, string> = {};

        await Promise.allSettled(
          Object.entries(imageMap).map(async ([ref, value]) => {
            try {
              // image-map.json values may be full URLs (http://localhost:8082/api/.../images/hash.png)
              // or relative paths. Extract just the filename for both API fetch and local storage.
              const filename = value.split("/").pop() || value;
              rewrittenMap[ref] = `images/${filename}`;
              const imgRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${i}/images/${filename}`);
              if (imgRes.ok) {
                const data = Buffer.from(await imgRes.arrayBuffer());
                await writeFile(join(imgDir, filename), data);
                imagesDownloaded++;
              }
            } catch {
              // Skip missing images
            }
          })
        );

        // Overwrite image-map.json with relative paths so Claude Code sees clean filenames
        await writeFile(
          join(frameDir, "image-map.json"),
          JSON.stringify(rewrittenMap, null, 2),
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
      images: `${imagesDownloaded}/${imagesTotal}`,
    });

    console.error(`[cfd] synced frame ${i}/${frames.length - 1}: ${frame.name} (images: ${imagesDownloaded}/${imagesTotal})`);
  }

  // Generate build guide (page-to-frame mapping, breakpoints, output structure)
  const frameInfos: FrameInfo[] = frames.map((f: any, i: number) => ({
    index: i,
    name: f.name || `Frame ${i}`,
    page: f.page || "Page 1",
    width: f.width,
    height: f.height,
    parityScore: f.parityScore,
  }));

  const buildGuide = generateBuildGuide(frameInfos, wsPath);
  await writeFile(join(wsPath, "build-guide.json"), JSON.stringify(buildGuide, null, 2));
  console.error(`[cfd] generated build-guide.json`);

  // Create log structure for session tracking
  await createLogStructure(wsPath, jobMeta);
  console.error(`[cfd] created logs/ directory structure`);

  console.error(`[cfd] sync complete: ${frames.length} frames -> ${wsPath}`);

  return {
    workspacePath: wsPath,
    frameCount: frames.length,
    frames: frameSummaries,
  };
}
