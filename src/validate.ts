/**
 * Shared HTML validation for cleaned frames.
 * Used by both compare and submit_cleaned_frame to catch common issues
 * before sending HTML to the engine.
 */

export interface HtmlValidationResult {
  warnings: string[];
  isRawHtml: boolean;
}

// Matches localhost, 127.0.0.1, 0.0.0.0, [::1] in URLs
const LOOPBACK_URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;

// Matches localhost/loopback in src= or url( contexts specifically
const LOOPBACK_SRC_PATTERN =
  /(?:src|url)\s*[=(]\s*['"]?https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;

// Matches engine production URL in src= or url( contexts
const ENGINE_URL_PATTERN =
  /(?:src|url)\s*[=(]\s*['"]?https?:\/\/engine\.codefromdesign/i;

// Raw Figma HTML: position:absolute with px top/left in style attributes (double or single quotes)
const RAW_HTML_STYLE_ATTR_DOUBLE =
  /style="[^"]*position\s*:\s*absolute[^"]*(?:top|left)\s*:\s*\d+px/gi;
const RAW_HTML_STYLE_ATTR_SINGLE =
  /style='[^']*position\s*:\s*absolute[^']*(?:top|left)\s*:\s*\d+px/gi;

// Raw Figma HTML inside <style> blocks: position:absolute with px top/left
const STYLE_BLOCK_PATTERN = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const ABS_POS_IN_CSS =
  /position\s*:\s*absolute[\s\S]*?(?:top|left)\s*:\s*\d+px/gi;

/**
 * Validate cleaned HTML for common issues.
 * Returns warnings (non-blocking) and whether raw Figma HTML was detected.
 */
export function validateCleanedHtml(html: string): HtmlValidationResult {
  const warnings: string[] = [];
  let isRawHtml = false;

  // --- Localhost / loopback detection ---
  if (LOOPBACK_SRC_PATTERN.test(html)) {
    warnings.push(
      `\u{1F6A8} [localhost_url] cleaned.html contains localhost/loopback URLs in image/asset references. Use relative paths: images/{hash}.png`
    );
  }

  // --- Engine URL detection ---
  if (ENGINE_URL_PATTERN.test(html)) {
    warnings.push(
      `\u{1F6A8} [engine_url] cleaned.html contains engine API URLs in image/asset references. Use relative paths: images/{hash}.png`
    );
  }

  // --- Raw HTML detection (absolute positioning with px coordinates) ---
  // Check style attributes (both double and single quotes)
  const absDoubleQuote = (html.match(RAW_HTML_STYLE_ATTR_DOUBLE) || []).length;
  const absSingleQuote = (html.match(RAW_HTML_STYLE_ATTR_SINGLE) || []).length;

  // Check <style> blocks for the same pattern
  let absInStyleBlocks = 0;
  let match: RegExpExecArray | null;
  // Reset lastIndex before use
  STYLE_BLOCK_PATTERN.lastIndex = 0;
  while ((match = STYLE_BLOCK_PATTERN.exec(html)) !== null) {
    const cssContent = match[1];
    ABS_POS_IN_CSS.lastIndex = 0;
    const cssMatches = cssContent.match(ABS_POS_IN_CSS);
    if (cssMatches) {
      absInStyleBlocks += cssMatches.length;
    }
  }

  const totalAbsWithPx = absDoubleQuote + absSingleQuote + absInStyleBlocks;

  if (totalAbsWithPx > 20) {
    isRawHtml = true;
    warnings.push(
      `\u{1F6D1} RAW HTML DETECTED: Found ${totalAbsWithPx} elements with position:absolute + pixel coordinates (${absDoubleQuote} in style="", ${absSingleQuote} in style='', ${absInStyleBlocks} in <style> blocks). This is raw Figma output — rewrite with semantic HTML and flexbox/grid.`
    );
  }

  return { warnings, isRawHtml };
}

/**
 * Check HTML content for loopback/localhost URLs (broader check for full file scanning).
 * Used by submit_website to scan all HTML files.
 */
export function containsLoopbackUrls(content: string): boolean {
  return LOOPBACK_URL_PATTERN.test(content);
}

// ---------------------------------------------------------------------------
// Submission quality gate — BLOCKS submission if HTML fails structural checks
// ---------------------------------------------------------------------------

export interface SubmissionValidationResult {
  pass: boolean;
  errors: string[];   // blocking — submission refused
  warnings: string[]; // advisory — submission allowed
}

// Semantic HTML5 elements that indicate structural cleanup was done
const SEMANTIC_ELEMENTS = /<(?:header|main|section|nav|footer|article)\b/i;

// Flexbox or grid usage in CSS (inline <style> or style attributes)
const FLEX_OR_GRID = /display\s*:\s*(?:flex|grid)/i;

// Fixed Figma viewport widths on body or wrapper elements
const FIXED_VIEWPORT_WIDTH =
  /(?:body|\.wrapper|\.page|\.container|#root|#app|\.site)\s*\{[^}]*width\s*:\s*(?:1440|1920)px/i;
// Also catch inline style on body/html
const FIXED_WIDTH_INLINE =
  /<(?:body|html)[^>]*style="[^"]*width\s*:\s*(?:1440|1920)px/i;

// Count elements with inline style attributes
const INLINE_STYLE_ATTR = /\s+style\s*=\s*"/gi;

// CSS custom properties in :root
const CSS_CUSTOM_PROPS = /:root\s*\{[^}]*--/i;

// Responsive media queries
const MEDIA_QUERY = /@media\s*\(/i;

// BEM-style class names (block__element or block--modifier)
const BEM_CLASS = /class="[^"]*\b\w+(?:__\w+|--\w+)\b/i;

/**
 * Validate cleaned HTML for submission quality.
 * Returns blocking errors and advisory warnings.
 * Used by submit_cleaned_frame to enforce structural quality.
 */
export function validateForSubmission(html: string): SubmissionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- Blocking: Raw HTML detection (reuse existing logic) ---
  const validation = validateCleanedHtml(html);
  if (validation.isRawHtml) {
    errors.push(
      `Raw Figma HTML detected (${_countAbsPositioned(html)} elements with position:absolute + px coordinates). ` +
      `Rewrite with semantic HTML and flexbox/grid layout.`
    );
  }

  // --- Blocking: Localhost/engine URLs ---
  if (validation.warnings.some(w => w.includes('[localhost_url]') || w.includes('[engine_url]'))) {
    errors.push(
      `HTML contains localhost or engine API URLs in image/asset references. ` +
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
      `Production code must use modern CSS layout, not absolute positioning.`
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

  // Note: @media queries are NOT checked here — responsiveness is a Job 2 (website build)
  // concern, not a frame cleaning concern. Each frame targets one viewport.

  // --- Warning: No BEM class naming ---
  if (!BEM_CLASS.test(html)) {
    warnings.push(
      `No BEM-style class names detected (block__element or block--modifier). ` +
      `Consider using BEM for organized, maintainable CSS.`
    );
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
  };
}

/** Count absolute-positioned elements with px coordinates (internal helper) */
function _countAbsPositioned(html: string): number {
  RAW_HTML_STYLE_ATTR_DOUBLE.lastIndex = 0;
  RAW_HTML_STYLE_ATTR_SINGLE.lastIndex = 0;
  const d = (html.match(RAW_HTML_STYLE_ATTR_DOUBLE) || []).length;
  const s = (html.match(RAW_HTML_STYLE_ATTR_SINGLE) || []).length;
  let inBlocks = 0;
  STYLE_BLOCK_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STYLE_BLOCK_PATTERN.exec(html)) !== null) {
    ABS_POS_IN_CSS.lastIndex = 0;
    const cm = m[1].match(ABS_POS_IN_CSS);
    if (cm) inBlocks += cm.length;
  }
  return d + s + inBlocks;
}
