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
