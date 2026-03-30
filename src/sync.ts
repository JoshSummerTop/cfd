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
  //   "01_Home_Desktop" (underscore with optional numeric prefix)

  // First try standard separators (higher priority — more explicit)
  const separators = [" - ", " — ", " / "];
  for (const sep of separators) {
    const idx = name.lastIndexOf(sep);
    if (idx !== -1) {
      // Standard separators always return (even with unknown breakpoint — width classification handles it)
      return extractPageAndBreakpoint(name.slice(0, idx), name.slice(idx + sep.length), /* strict */ false)!;
    }
  }

  // Try underscore separator — strip leading numeric prefix like "01_"
  // Strict mode: only return if breakpoint was recognized (avoids false splits like "Cart_Sidebar")
  const underscoreMatch = name.match(/^(?:\d+_)?(.+?)_([^_]+)$/);
  if (underscoreMatch) {
    const result = extractPageAndBreakpoint(underscoreMatch[1], underscoreMatch[2], /* strict */ true);
    if (result) return result;
  }

  return null;
}

function extractPageAndBreakpoint(rawPage: string, rawBp: string, strict: boolean): { pageName: string; breakpoint: string } | null {
  let pagePart = rawPage.trim();
  const bpPart = rawBp.trim().toLowerCase();

  // Strip trailing " Page" from page name
  pagePart = pagePart.replace(/\s+Page$/i, "");
  // Also strip underscore-separated "Page" for underscore format
  pagePart = pagePart.replace(/_Page$/i, "");
  // Convert remaining underscores to spaces for display
  pagePart = pagePart.replace(/_/g, " ");

  // Determine breakpoint from the text
  let breakpoint: string;
  if (bpPart.includes("desktop") || bpPart.includes("1920") || bpPart.includes("1440")) {
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
    // For underscore format, unknown breakpoint likely means this wasn't actually
    // a page_breakpoint pattern (e.g., "Cart_Sidebar" isn't a breakpoint split)
    breakpoint = "unknown";
  }

  // In strict mode (underscore format), only return if breakpoint was recognized
  // (avoids false splits like "Cart_Sidebar" being treated as page "Cart" + breakpoint "sidebar")
  if (strict && breakpoint === "unknown") return null;

  return { pageName: pagePart, breakpoint };
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

  // Auto-classify frames by name heuristics (must happen before navigation derivation)
  const frameClassifications: Record<string, { type: string; name: string; note?: string }> = {};
  const overlayKeywords = ["sidebar", "modal", "popup", "overlay", "drawer", "dropdown", "lightbox", "dialog", "panel", "flyout", "quick view", "quickview"];
  const componentKeywords = ["component", "header only", "footer only", "nav only", "widget"];
  // State keywords: only unambiguous UI-state compound terms that wouldn't appear in page titles.
  // Single words like "open", "active", "error" are TOO GENERIC — "Open Positions",
  // "Active Listings", "Error 404" are legitimate page names. Phase A2 reasoning handles ambiguous cases.
  const stateKeywords = ["hover state", "active state", "empty state", "error state",
    "loading state", "selected state", "disabled state", "open state", "closed state",
    " - hover", " - active", " - empty", " - loading", " - selected", " - disabled"];

  for (const frame of frames) {
    const nameLower = frame.name.toLowerCase();
    let type = "page";
    let note: string | undefined;

    if (overlayKeywords.some((kw) => nameLower.includes(kw))) {
      type = "overlay";
      note = "Auto-detected as overlay/modal. Likely appears ON another page, not as a standalone page.";
    } else if (componentKeywords.some((kw) => nameLower.includes(kw))) {
      type = "component";
      note = "Auto-detected as reusable component. Integrate into pages that use it.";
    } else if (stateKeywords.some((kw) => nameLower.includes(kw))) {
      type = "state";
      note = "Auto-detected as a state variation. Informs page design but is NOT a separate page.";
    }

    frameClassifications[String(frame.index)] = {
      type,
      name: frame.name,
      ...(note && { note }),
    };
  }

  // Separate pages from non-pages based on classification
  const pageFrameIndices = new Set(
    Object.entries(frameClassifications)
      .filter(([, c]) => c.type === "page")
      .map(([idx]) => parseInt(idx, 10))
  );

  // Filter pages array to only include frames classified as pages
  const pageEntries = pages.filter((p) => {
    // Check if any frame in this page group is classified as a page
    return Object.values(p.frames).some((f: any) => pageFrameIndices.has(f.index));
  });

  // Collect non-page frames into overlays/components/states
  const nonPageFrames = Object.entries(frameClassifications)
    .filter(([, c]) => c.type !== "page")
    .map(([idx, c]) => ({ index: parseInt(idx, 10), ...c }));

  // Navigation derived from FILTERED pages only (excludes overlays/components/states)
  const navigation = pageEntries.map((p) => p.name);

  return {
    pages: pageEntries,
    nonPageFrames: nonPageFrames.length > 0 ? nonPageFrames : undefined,
    nonPageNote: nonPageFrames.length > 0
      ? "These frames are auto-classified as overlays/components/states — NOT standalone pages. Review in Phase A2 and integrate into parent pages during assembly."
      : undefined,
    navigation,
    navigationNote: "This array lists ALL pages for inter-page LINKING (href targets). It does NOT define the visible nav bar. The visible nav bar must match the Figma screenshot exactly — most designs show only 3-5 main links, not every page.",
    frameClassifications,
    classificationNote: "Auto-detected frame types. REVIEW these in Phase A2 — override any misclassifications in your session plan. Not every frame should become a standalone page.",
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

// ---------------------------------------------------------------------------
// Per-frame sync — shared between full sync and single-frame sync
// ---------------------------------------------------------------------------

export interface FrameSummary {
  index: number;
  name: string;
  width: number;
  height: number;
  parity: string;
  images: string;
  warnings?: string[];
}

const CRITICAL_ARTIFACTS = new Set(["ai-ready.html", "figma-screenshot.png", "rendered.html"]);

async function syncFrameArtifacts(
  config: CfdConfig,
  jobId: string,
  frameIndex: number,
  frame: any,
  frameDir: string,
): Promise<FrameSummary> {
  await mkdir(frameDir, { recursive: true });

  // Write frame metadata (trim name — Figma sometimes adds trailing whitespace)
  const frameName = (frame.name || `Frame ${frameIndex}`).trim();
  const frameMeta = {
    index: frameIndex,
    name: frameName,
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
    { name: "rendered.html", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/html` },
    { name: "figma-screenshot.png", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/figma-screenshot` },
    { name: "screenshot.png", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/screenshot` },
    { name: "diff.png", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/diff` },
    { name: "manifest.json", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/manifest` },
    { name: "ai-ready.html", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/ai-ready-html` },
    { name: "cleaned-screenshot.png", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/cleaned-screenshot` },
    { name: "cleaned-diff.png", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/cleaned-diff` },
    { name: "compare-log.json", endpoint: `/api/jobs/${jobId}/frames/${frameIndex}/artifact/compare-log.json` },
  ];

  const missingCritical: string[] = [];

  const artifactResults = await Promise.allSettled(
    artifacts.map(async (art) => {
      try {
        const res = await engineFetch(config, art.endpoint);
        if (res.ok) {
          const data = Buffer.from(await res.arrayBuffer());
          await writeFile(join(frameDir, art.name), data);
          return { name: art.name, ok: true };
        }
        return { name: art.name, ok: false };
      } catch {
        return { name: art.name, ok: false };
      }
    })
  );

  for (const result of artifactResults) {
    if (result.status === "fulfilled" && !result.value.ok && CRITICAL_ARTIFACTS.has(result.value.name)) {
      missingCritical.push(result.value.name);
    }
  }

  // Download issue-diff if available
  try {
    const issueRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${frameIndex}/artifact/issue-diff.json`);
    if (issueRes.ok) {
      const data = Buffer.from(await issueRes.arrayBuffer());
      await writeFile(join(frameDir, "issue-diff.json"), data);
    }
  } catch { /* skip */ }

  // Download SVG map (image-map.json is handled below with image downloads + rewrite)
  try {
    const res = await engineFetch(config, `/api/jobs/${jobId}/frames/${frameIndex}/svg-map`);
    if (res.ok) {
      const data = Buffer.from(await res.arrayBuffer());
      await writeFile(join(frameDir, "svg-map.json"), data);
    }
  } catch { /* skip */ }

  // Download frame images and rewrite image-map.json with relative paths
  let imagesDownloaded = 0;
  let imagesTotal = 0;
  try {
    const mapRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${frameIndex}/image-map`);
    if (mapRes.ok) {
      const imageMap: Record<string, string> = await mapRes.json();
      imagesTotal = Object.keys(imageMap).length;
      const imgDir = join(frameDir, "images");
      await mkdir(imgDir, { recursive: true });

      const rewrittenMap: Record<string, string> = {};

      await Promise.allSettled(
        Object.entries(imageMap).map(async ([ref, value]) => {
          try {
            const filename = value.split("/").pop() || value;
            rewrittenMap[ref] = `images/${filename}`;
            const imgRes = await engineFetch(config, `/api/jobs/${jobId}/frames/${frameIndex}/images/${filename}`);
            if (imgRes.ok) {
              const data = Buffer.from(await imgRes.arrayBuffer());
              await writeFile(join(imgDir, filename), data);
              imagesDownloaded++;
            }
          } catch { /* skip */ }
        })
      );

      await writeFile(
        join(frameDir, "image-map.json"),
        JSON.stringify(rewrittenMap, null, 2),
      );
    }
  } catch { /* skip */ }

  const summary: FrameSummary = {
    index: frameIndex,
    name: frameName,
    width: frame.width,
    height: frame.height,
    parity: `${(frame.parityScore ?? 0).toFixed(1)}%`,
    images: `${imagesDownloaded}/${imagesTotal}`,
    warnings: missingCritical.length > 0 ? missingCritical : undefined,
  };

  console.error(`[cfd] synced frame ${frameIndex}: ${summary.name} (images: ${imagesDownloaded}/${imagesTotal})`);
  return summary;
}

// ---------------------------------------------------------------------------
// Public: sync a single frame (used after compare to get updated artifacts)
// ---------------------------------------------------------------------------

export async function syncFrame(
  config: CfdConfig,
  jobId: string,
  frameIndex: number,
): Promise<FrameSummary> {
  const jobRes = await engineFetch(config, `/api/jobs/${jobId}`);
  if (!jobRes.ok) {
    throw new Error(`Failed to fetch job: ${jobRes.status} ${jobRes.statusText}`);
  }
  const job = await jobRes.json();
  const frames = job.frames || [];

  if (frameIndex < 0 || frameIndex >= frames.length) {
    throw new Error(`Frame index ${frameIndex} out of range (job has ${frames.length} frames)`);
  }

  const wsPath = getWorkspacePath(jobId);
  const frameDir = join(wsPath, "frames", String(frameIndex));
  return syncFrameArtifacts(config, jobId, frameIndex, frames[frameIndex], frameDir);
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
  frames: FrameSummary[];
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
      name: (f.name || `Frame ${i}`).trim(),
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
  const frameSummaries: Array<FrameSummary> = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const summary = await syncFrameArtifacts(config, jobId, i, frame, join(framesDir, String(i)));
    frameSummaries.push(summary);
  }

  // Generate build guide (page-to-frame mapping, breakpoints, output structure)
  const frameInfos: FrameInfo[] = frames.map((f: any, i: number) => ({
    index: i,
    name: (f.name || `Frame ${i}`).trim(),
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
