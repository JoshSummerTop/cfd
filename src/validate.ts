/**
 * HTML validation for cleaned frames.
 *
 * validateForSubmission() is the single entry point — used by both the
 * submit_cleaned_frame gate and the standalone validate tool.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// How many percentage points a cleaned compare may trail the ai-ready
// baseline before the submit gate refuses the submission. Covers Chromium
// run-to-run nondeterminism and minor rendering noise without letting real
// regressions through.
export const PARITY_REGRESSION_TOLERANCE = 2.0;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SubmissionValidationResult {
  pass: boolean;
  errors: string[];   // blocking — submission refused
  warnings: string[]; // advisory — submission allowed
}

export interface ParityRegressionCheck {
  // status === "ok": submission safe on parity grounds (may still be gated by force override below).
  // status === "regressed": submission currently scores below baseline - tolerance.
  // status === "no_compare": the user never ran `compare` on this frame, so we can't decide.
  // status === "no_baseline": job.json lacks a parityScore for this frame (pipeline never measured).
  status: "ok" | "regressed" | "no_compare" | "no_baseline";
  baseline?: number;  // ai-ready/rendered.html parity from job.json (the chosen metric)
  current?: number;   // most recent compare-log.json parity (the chosen metric)
  delta?: number;     // current - baseline (negative = regression)
  // metric tells callers WHICH parity number was used for the comparison. "nonFont"
  // is the agent-addressable metric and the preferred gate; "overall" is the fallback
  // when non-font parity isn't available (older jobs / basic-parity mode).
  metric: "nonFont" | "overall";
  message: string;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// Localhost/loopback in src= or url( contexts
const LOOPBACK_SRC_PATTERN =
  /(?:src|url)\s*[=(]\s*['"]?https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;

// Engine production URL in src= or url( contexts
const ENGINE_URL_PATTERN =
  /(?:src|url)\s*[=(]\s*['"]?https?:\/\/engine\.codefromdesign/i;

// Broader loopback check (for submit_website HTML scanning)
const LOOPBACK_URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;

// Raw Figma HTML: position:absolute with LARGE px coordinates (>100px).
// This detects Figma's coordinate system (top:200px;left:500px) not
// legitimate overlay patterns (top:24px;right:24px within a relative container).
const RAW_FIGMA_ABS_STYLE_DOUBLE =
  /style="[^"]*position\s*:\s*absolute[^"]*(?:top|left)\s*:\s*(?:1\d{2,}|[2-9]\d{2,}|\d{4,})px/gi;
const RAW_FIGMA_ABS_STYLE_SINGLE =
  /style='[^']*position\s*:\s*absolute[^']*(?:top|left)\s*:\s*(?:1\d{2,}|[2-9]\d{2,}|\d{4,})px/gi;

// Same pattern inside <style> blocks
const STYLE_BLOCK_PATTERN = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const RAW_FIGMA_ABS_IN_CSS =
  /position\s*:\s*absolute[\s\S]*?(?:top|left)\s*:\s*(?:1\d{2,}|[2-9]\d{2,}|\d{4,})px/gi;

// Semantic HTML5 elements
const SEMANTIC_ELEMENTS = /<(?:header|main|section|nav|footer|article)\b/i;

// Flexbox or grid usage
const FLEX_OR_GRID = /display\s*:\s*(?:flex|grid)/i;

// Fixed Figma viewport widths on body/wrapper
const FIXED_VIEWPORT_WIDTH =
  /(?:body|\.wrapper|\.page|\.container|#root|#app|\.site)\s*\{[^}]*width\s*:\s*(?:1440|1920)px/i;
const FIXED_WIDTH_INLINE =
  /<(?:body|html)[^>]*style="[^"]*width\s*:\s*(?:1440|1920)px/i;

// Count inline style attributes
const INLINE_STYLE_ATTR = /\s+style\s*=\s*"/gi;

// CSS custom properties in :root
const CSS_CUSTOM_PROPS = /:root\s*\{[^}]*--/i;

// BEM-style class names
const BEM_CLASS = /class="[^"]*\b\w+(?:__\w+|--\w+)\b/i;

// Image src paths for resolution check
const IMG_SRC_PATTERN = /src=["']([^"']+)["']/gi;

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate cleaned HTML for structural quality.
 * Returns blocking errors and advisory warnings.
 *
 * Used by:
 * - submit_cleaned_frame (gate — blocks on errors)
 * - validate tool (standalone — returns results for inspection)
 *
 * @param html The cleaned HTML content
 * @param imagesDir Optional path to the frame's images/ directory for path resolution
 */
export function validateForSubmission(
  html: string,
  imagesDir?: string,
): SubmissionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Blocking: Raw Figma absolute positioning (large px coords) ---
  const absCount = countRawFigmaAbsPositioned(html);
  if (absCount > 10) {
    errors.push(
      `Raw Figma positioning detected (${absCount} elements with position:absolute + large px coordinates like top:200px;left:500px). ` +
      `Use flexbox/grid for page layout. position:absolute is fine for overlays within relative containers.`
    );
  }

  // --- Blocking: Localhost/engine URLs ---
  if (LOOPBACK_SRC_PATTERN.test(html)) {
    errors.push(
      `HTML contains localhost/loopback URLs in image/asset references. ` +
      `Use relative paths: images/{hash}.png`
    );
  }
  if (ENGINE_URL_PATTERN.test(html)) {
    errors.push(
      `HTML contains engine API URLs in image/asset references. ` +
      `Use relative paths: images/{hash}.png`
    );
  }

  // --- Blocking: No semantic elements ---
  if (!SEMANTIC_ELEMENTS.test(html)) {
    errors.push(
      `No semantic HTML elements found (header, main, section, nav, footer, article). ` +
      `Production code must use semantic HTML structure.`
    );
  }

  // --- Blocking: No flexbox/grid ---
  if (!FLEX_OR_GRID.test(html)) {
    errors.push(
      `No flexbox or grid layout found (display: flex or display: grid). ` +
      `Production code must use modern CSS layout.`
    );
  }

  // --- Blocking: Fixed Figma viewport width ---
  if (FIXED_VIEWPORT_WIDTH.test(html) || FIXED_WIDTH_INLINE.test(html)) {
    errors.push(
      `Fixed Figma viewport width detected (1440px or 1920px on body/wrapper). ` +
      `Use max-width or responsive units instead.`
    );
  }

  // --- Blocking: Excessive inline styles ---
  const inlineStyleCount = (html.match(INLINE_STYLE_ATTR) || []).length;
  if (inlineStyleCount > 30) {
    errors.push(
      `Excessive inline styles: ${inlineStyleCount} elements with style="" attributes. ` +
      `Move styles to a <style> block with proper CSS classes.`
    );
  }

  // --- Warning: No CSS custom properties ---
  if (!CSS_CUSTOM_PROPS.test(html)) {
    warnings.push(
      `No CSS custom properties found (:root with -- variables). ` +
      `Consider extracting colors, fonts, and spacing to custom properties.`
    );
  }

  // --- Warning: No BEM class naming ---
  if (!BEM_CLASS.test(html)) {
    warnings.push(
      `No BEM-style class names detected (block__element or block--modifier). ` +
      `Consider using BEM for organized, maintainable CSS.`
    );
  }

  // --- Warning: Image path resolution ---
  if (imagesDir) {
    IMG_SRC_PATTERN.lastIndex = 0;
    let imgMatch: RegExpExecArray | null;
    const missingImages: string[] = [];
    while ((imgMatch = IMG_SRC_PATTERN.exec(html)) !== null) {
      const src = imgMatch[1];
      // Only check relative image paths (not data: URIs, external URLs, or SVGs)
      if (src.startsWith("images/") && !src.startsWith("data:")) {
        const filename = src.replace(/^images\//, "");
        if (!existsSync(join(imagesDir, filename))) {
          missingImages.push(src);
        }
      }
    }
    if (missingImages.length > 0) {
      warnings.push(
        `${missingImages.length} image path(s) reference files not found in images/ directory: ` +
        missingImages.slice(0, 5).join(", ") +
        (missingImages.length > 5 ? ` (and ${missingImages.length - 5} more)` : "")
      );
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Parity-regression gate
// ---------------------------------------------------------------------------

/**
 * Compare the most recent compare-log.json parity against the frame's
 * ai-ready.html baseline (job.json frame.parityScore — the parity the engine's
 * own rendered.html scored against the Figma reference).
 *
 * Why ai-ready rather than the previous submit: if the agent's first clean
 * regresses below ai-ready by 30 points and then climbs back to ai-ready - 20,
 * a previous-submit gate would accept the second submit. An ai-ready gate
 * requires each submission to at least match the engine's own rendering.
 *
 * This is the check Phase 1 diagnostic confirmed is safe — the score is an
 * honest proxy for visual parity, so blocking on a real regression blocks a
 * real visual regression.
 */
export async function checkParityRegression(
  workspacePath: string,
  jobId: string,
  frameIndex: number,
  tolerance = PARITY_REGRESSION_TOLERANCE,
): Promise<ParityRegressionCheck> {
  const jobPath = join(workspacePath, "job.json");
  if (!existsSync(jobPath)) {
    return {
      status: "no_baseline",
      metric: "nonFont",
      message: `No job.json at ${jobPath} — run sync first.`,
    };
  }

  // Baseline + current are read in non-font space when available. Non-font
  // parity excludes text-category pixels (Chromium-vs-Figma font rendering),
  // which is engine-inherent and NOT something cleaning agents can improve by
  // editing HTML. Gating on overall parity blocks submissions for noise the
  // agent cannot fix. Falls back to overall parityScore only if nonFontParity
  // is missing (older jobs or basic-parity path).
  let baseline: number | undefined;
  let metric: "nonFont" | "overall" = "nonFont";
  try {
    const job = JSON.parse(await readFile(jobPath, "utf-8"));
    const frames: Array<{ parityScore?: number | null; nonFontParity?: number | null }> =
      Array.isArray(job.frames) ? job.frames : [];
    const frame = frames[frameIndex];
    if (frame) {
      if (typeof frame.nonFontParity === "number") {
        baseline = frame.nonFontParity;
        metric = "nonFont";
      } else if (typeof frame.parityScore === "number") {
        baseline = frame.parityScore;
        metric = "overall";
      }
    }
  } catch (err: any) {
    return {
      status: "no_baseline",
      metric: "nonFont",
      message: `Failed to parse job.json: ${err.message}`,
    };
  }

  if (baseline == null) {
    return {
      status: "no_baseline",
      metric: "nonFont",
      message: `No parity score on frame ${frameIndex} in job.json. Pipeline may not have measured parity — gate cannot block.`,
    };
  }

  // Current: most recent compare-log.json entry. Read the nonFontParity field
  // (added in engine commit that ships this change); fall back to overall
  // `parity` for older logs so we don't false-block on a re-install.
  const logPath = join(workspacePath, "frames", String(frameIndex), "compare-log.json");
  if (!existsSync(logPath)) {
    return {
      status: "no_compare",
      baseline,
      metric,
      message: `No compare-log.json for frame ${frameIndex}. Run compare at least once before submitting so ${metric === "nonFont" ? "non-font " : ""}parity can be measured against the baseline (${baseline.toFixed(1)}%).`,
    };
  }

  let current: number | undefined;
  try {
    const entries = JSON.parse(await readFile(logPath, "utf-8"));
    if (Array.isArray(entries) && entries.length > 0) {
      const last = entries[entries.length - 1];
      if (metric === "nonFont" && typeof last.nonFontParity === "number") {
        current = last.nonFontParity;
      } else if (typeof last.parity === "number") {
        // Fallback: compare-log was written by an engine that didn't persist
        // nonFontParity yet. Use overall parity but stay on the non-font
        // baseline is an apples-to-oranges mismatch, so degrade gracefully
        // by switching metric to overall for this check.
        current = last.parity;
        metric = "overall";
      }
    }
  } catch {
    // Treat a corrupt log the same as a missing log: user needs to re-compare.
    return {
      status: "no_compare",
      baseline,
      metric,
      message: `compare-log.json for frame ${frameIndex} is unreadable. Re-run compare before submitting.`,
    };
  }

  if (current == null) {
    return {
      status: "no_compare",
      baseline,
      metric,
      message: `compare-log.json exists but has no entries. Run compare on frame ${frameIndex} before submitting.`,
    };
  }

  const metricLabel = metric === "nonFont" ? "non-font parity" : "parity";
  const delta = current - baseline;
  if (delta < -tolerance) {
    return {
      status: "regressed",
      baseline,
      current,
      delta,
      metric,
      message:
        `${metricLabel[0].toUpperCase() + metricLabel.slice(1)} regressed vs ai-ready baseline: ` +
        `${current.toFixed(1)}% < ${baseline.toFixed(1)}% − ${tolerance.toFixed(1)}% tolerance ` +
        `(delta ${delta.toFixed(1)}pp).`,
    };
  }

  return {
    status: "ok",
    baseline,
    current,
    delta,
    metric,
    message: `${metricLabel[0].toUpperCase() + metricLabel.slice(1)} within tolerance: ${current.toFixed(1)}% vs baseline ${baseline.toFixed(1)}% (delta ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp).`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count elements with raw Figma absolute positioning (large px coordinates).
 * Only counts top/left values >100px which indicate Figma's coordinate system.
 * Small values (top:24px;right:24px) are legitimate overlay CSS.
 */
function countRawFigmaAbsPositioned(html: string): number {
  RAW_FIGMA_ABS_STYLE_DOUBLE.lastIndex = 0;
  RAW_FIGMA_ABS_STYLE_SINGLE.lastIndex = 0;
  const d = (html.match(RAW_FIGMA_ABS_STYLE_DOUBLE) || []).length;
  const s = (html.match(RAW_FIGMA_ABS_STYLE_SINGLE) || []).length;

  let inBlocks = 0;
  STYLE_BLOCK_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STYLE_BLOCK_PATTERN.exec(html)) !== null) {
    RAW_FIGMA_ABS_IN_CSS.lastIndex = 0;
    const cm = m[1].match(RAW_FIGMA_ABS_IN_CSS);
    if (cm) inBlocks += cm.length;
  }

  return d + s + inBlocks;
}

/**
 * Check HTML content for loopback/localhost URLs (broader check).
 * Used by submit_website to scan all HTML files.
 */
export function containsLoopbackUrls(content: string): boolean {
  return LOOPBACK_URL_PATTERN.test(content);
}
