/**
 * HTML validation for cleaned frames.
 *
 * validateForSubmission() is the single entry point — used by both the
 * submit_cleaned_frame gate and the standalone validate tool.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SubmissionValidationResult {
  pass: boolean;
  errors: string[];   // blocking — submission refused
  warnings: string[]; // advisory — submission allowed
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
