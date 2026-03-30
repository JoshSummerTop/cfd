/**
 * Deterministic HTML transformer — the "page builder" for Figma-to-code.
 *
 * Takes ai-ready.html + manifest.json + maps and produces a first-pass
 * cleaned.html with semantic structure, flex layout, resolved assets,
 * and extracted styles. Claude then reviews and fine-tunes.
 */

import { parse, HTMLElement, TextNode } from "node-html-parser";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getWorkspacePath } from "./sync.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManifestSection {
  index: number;
  name: string;
  role: string;
  tag: string;
  height: number;
  content?: string;
}

interface AutoLayoutEntry {
  nodeId: string;
  name: string;
  direction: string;
  gap?: number;
  justify?: string;
  align?: string;
  padTop?: number;
  padBottom?: number;
  padLeft?: number;
  padRight?: number;
}

interface Manifest {
  frame: { name: string; role: string; width: number; height: number };
  sections: ManifestSection[];
  autoLayout: AutoLayoutEntry[];
  designTokens?: { colors?: Record<string, string>; fonts?: Record<string, string> };
  components?: Array<{ id: string; name: string; instances: number; source: string }>;
}

interface TransformResult {
  html: string;
  stats: {
    sectionsWrapped: number;
    autoLayoutApplied: number;
    imagesResolved: number;
    svgsResolved: number;
    stylesExtracted: number;
    nodesLeftAbsolute: number;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Style parsing helpers
// ---------------------------------------------------------------------------

function parseInlineStyle(style: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim();
    const val = part.slice(colon + 1).trim();
    if (key && val) props[key] = val;
  }
  return props;
}

function serializeStyle(props: Record<string, string>): string {
  return Object.entries(props)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

// ---------------------------------------------------------------------------
// BEM class name generation
// ---------------------------------------------------------------------------

const ROLE_TO_CLASS: Record<string, string> = {
  header: "site-header",
  hero: "hero",
  content: "content-section",
  footer: "site-footer",
  navigation: "site-nav",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

// ---------------------------------------------------------------------------
// Design token extraction
// ---------------------------------------------------------------------------

interface TokenSet {
  colors: Map<string, string>;  // hex → var name
  fonts: Map<string, string>;   // font-family → var name
}

function extractTokens(root: HTMLElement): TokenSet {
  const colors = new Map<string, string>();
  const fonts = new Map<string, string>();
  let colorIdx = 0;
  let fontIdx = 0;

  // Walk all elements and collect unique colors and fonts
  for (const el of root.querySelectorAll("*")) {
    const style = el.getAttribute("style");
    if (!style) continue;
    const props = parseInlineStyle(style);

    // Colors
    for (const key of ["color", "background-color", "border-color"]) {
      const val = props[key];
      if (val && val.startsWith("#") && val.length >= 4 && !colors.has(val)) {
        colors.set(val, `--color-${colorIdx++}`);
      }
    }

    // Fonts
    const ff = props["font-family"];
    if (ff && !fonts.has(ff)) {
      const name = ff.replace(/['"]/g, "").split(",")[0].trim().toLowerCase();
      fonts.set(ff, `--font-${slugify(name) || `family-${fontIdx++}`}`);
    }
  }

  return { colors, fonts };
}

// ---------------------------------------------------------------------------
// Core transform
// ---------------------------------------------------------------------------

export async function transformFrame(
  jobId: string,
  frameIndex: number,
): Promise<TransformResult> {
  const wsPath = getWorkspacePath(jobId);
  const frameDir = join(wsPath, "frames", String(frameIndex));
  const warnings: string[] = [];

  // Load inputs
  const aiReadyPath = join(frameDir, "ai-ready.html");
  if (!existsSync(aiReadyPath)) {
    throw new Error(`ai-ready.html not found at ${aiReadyPath}. Run sync first.`);
  }

  const htmlContent = await readFile(aiReadyPath, "utf-8");

  let manifest: Manifest | null = null;
  const manifestPath = join(frameDir, "manifest.json");
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  } else {
    warnings.push("manifest.json not found — skipping section wrapping and autoLayout");
  }

  let imageMap: Record<string, string> = {};
  const imageMapPath = join(frameDir, "image-map.json");
  if (existsSync(imageMapPath)) {
    imageMap = JSON.parse(await readFile(imageMapPath, "utf-8"));
  }

  let svgMap: Record<string, string> = {};
  const svgMapPath = join(frameDir, "svg-map.json");
  if (existsSync(svgMapPath)) {
    svgMap = JSON.parse(await readFile(svgMapPath, "utf-8"));
  }

  // Parse HTML
  const doc = parse(htmlContent, {
    comment: true,
    blockTextElements: { style: true, script: true },
  });

  const stats = {
    sectionsWrapped: 0,
    autoLayoutApplied: 0,
    imagesResolved: 0,
    svgsResolved: 0,
    stylesExtracted: 0,
    nodesLeftAbsolute: 0,
  };

  // Find the frame root (first div child of body with data-node-id)
  const body = doc.querySelector("body");
  if (!body) throw new Error("No <body> found in ai-ready.html");

  const frameRoot = body.querySelector("div[data-node-id]");
  if (!frameRoot) throw new Error("No frame root element found");

  // --- Build autoLayout lookup ---
  const autoLayoutMap = new Map<string, AutoLayoutEntry>();
  if (manifest?.autoLayout) {
    for (const entry of manifest.autoLayout) {
      autoLayoutMap.set(entry.nodeId, entry);
    }
  }

  // --- Step 1: Resolve images ---
  const imageElements = doc.querySelectorAll("[data-image-ref]");
  for (const el of imageElements) {
    const ref = el.getAttribute("data-image-ref");
    if (!ref || !imageMap[ref]) continue;

    const imgPath = imageMap[ref];
    const style = parseInlineStyle(el.getAttribute("style") || "");
    const width = style.width;
    const height = style.height;

    // If it has background-size (used as background image), set background-image
    if (style["background-size"] || style["background-position"]) {
      style["background-image"] = `url(${imgPath})`;
      // Fix empty CSS values from engine bug
      if (style["background-size"] === "") style["background-size"] = "cover";
      if (style["background-position"] === "") style["background-position"] = "center";
      if (style["background-repeat"] === "") style["background-repeat"] = "no-repeat";
      delete style["background"]; // remove shorthand if present
      el.setAttribute("style", serializeStyle(style));
    } else {
      // Replace div with img element
      const imgAttrs = [`src="${imgPath}"`, `alt=""`];
      if (width) imgAttrs.push(`width="${parseInt(width)}"`);
      if (height) imgAttrs.push(`height="${parseInt(height)}"`);
      imgAttrs.push(`style="display:block;max-width:100%"`);
      el.replaceWith(`<img ${imgAttrs.join(" ")}/>`);
    }
    stats.imagesResolved++;
  }

  // --- Step 2: Resolve SVGs ---
  const svgElements = doc.querySelectorAll("[data-svg-id]");
  for (const el of svgElements) {
    const svgId = el.getAttribute("data-svg-id");
    if (!svgId || !svgMap[svgId]) continue;

    const svgMarkup = svgMap[svgId];
    const style = parseInlineStyle(el.getAttribute("style") || "");
    const width = style.width || "24px";
    const height = style.height || "24px";

    // Wrap SVG in a span with dimensions
    el.replaceWith(
      `<span style="display:inline-flex;width:${width};height:${height};flex-shrink:0">${svgMarkup}</span>`
    );
    stats.svgsResolved++;
  }

  // Re-parse after replacements (node-html-parser doesn't update in-place after replaceWith)
  const updatedHtml = doc.toString();
  const doc2 = parse(updatedHtml, {
    comment: true,
    blockTextElements: { style: true, script: true },
  });
  const body2 = doc2.querySelector("body")!;
  const frameRoot2 = body2.querySelector("div[data-node-id]")!;

  // --- Step 3: Apply autoLayout flex properties ---
  const allElements = doc2.querySelectorAll("[data-node-id]");
  for (const el of allElements) {
    const nodeId = el.getAttribute("data-node-id");
    if (!nodeId) continue;

    const layout = autoLayoutMap.get(nodeId);
    if (!layout) continue;

    const style = parseInlineStyle(el.getAttribute("style") || "");

    // Replace absolute positioning with flex
    if (style.position === "absolute") {
      delete style.position;
      delete style.left;
      delete style.top;
    }

    style.display = "flex";
    style["flex-direction"] = layout.direction === "col" ? "column" : "row";
    if (layout.gap) style.gap = `${layout.gap}px`;
    if (layout.justify) style["justify-content"] = layout.justify;
    if (layout.align) style["align-items"] = layout.align;

    // Padding
    const padParts: string[] = [];
    padParts.push(layout.padTop ? `${layout.padTop}px` : "0");
    padParts.push(layout.padRight ? `${layout.padRight}px` : "0");
    padParts.push(layout.padBottom ? `${layout.padBottom}px` : "0");
    padParts.push(layout.padLeft ? `${layout.padLeft}px` : "0");
    const padStr = padParts.join(" ");
    if (padStr !== "0 0 0 0") style.padding = padStr;

    el.setAttribute("style", serializeStyle(style));
    stats.autoLayoutApplied++;
  }

  // --- Step 4: Wrap sections in semantic tags ---
  if (manifest?.sections && frameRoot2) {
    const sectionChildren = frameRoot2.childNodes.filter(
      (n): n is HTMLElement => n instanceof HTMLElement && n.tagName !== undefined
    );

    for (const section of manifest.sections) {
      if (section.index >= sectionChildren.length) continue;

      const child = sectionChildren[section.index];
      if (!child) continue;

      const tag = section.tag || "section";
      const className = ROLE_TO_CLASS[section.role] || `section-${slugify(section.name)}`;

      // Change the tag name by wrapping content
      const innerHtml = child.innerHTML;
      const childStyle = child.getAttribute("style") || "";
      child.replaceWith(
        `<${tag} class="${className}" style="${childStyle}">${innerHtml}</${tag}>`
      );
      stats.sectionsWrapped++;
    }
  }

  // Re-parse again after section wrapping
  const updatedHtml2 = doc2.toString();
  const doc3 = parse(updatedHtml2, {
    comment: true,
    blockTextElements: { style: true, script: true },
  });

  // --- Step 5: Fix frame root wrapper ---
  const body3 = doc3.querySelector("body")!;
  const frameRoot3 = body3.querySelector("div[data-node-id]");
  if (frameRoot3) {
    const rootStyle = parseInlineStyle(frameRoot3.getAttribute("style") || "");
    if (rootStyle.width) {
      rootStyle["max-width"] = rootStyle.width;
      rootStyle.width = "100%";
    }
    rootStyle["margin"] = "0 auto";
    delete rootStyle.height;
    rootStyle.position = "relative";
    frameRoot3.setAttribute("style", serializeStyle(rootStyle));
  }

  // --- Step 6: Extract inline styles to <style> block ---
  let classCounter = 0;
  const cssRules: string[] = [];

  for (const el of doc3.querySelectorAll("*")) {
    const inlineStyle = el.getAttribute("style");
    if (!inlineStyle || inlineStyle.length < 10) continue;

    // Generate a class name
    const tag = el.tagName?.toLowerCase() || "el";
    const existingClass = el.getAttribute("class") || "";
    const className = existingClass || `${tag}-${classCounter++}`;

    // Parse the inline style and move to CSS rule
    cssRules.push(`.${className.replace(/\s+/g, ".")} { ${inlineStyle} }`);

    if (!existingClass) {
      el.setAttribute("class", className);
    }
    el.removeAttribute("style");
    stats.stylesExtracted++;
  }

  // Insert extracted CSS into the existing <style> block
  if (cssRules.length > 0) {
    const existingStyle = doc3.querySelector("style");
    if (existingStyle) {
      const currentCss = existingStyle.innerHTML;
      existingStyle.set_content(currentCss + "\n\n/* Extracted from inline styles */\n" + cssRules.join("\n"));
    }
  }

  // --- Step 7: Fix viewport meta ---
  const viewportMeta = doc3.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute("content", "width=device-width, initial-scale=1.0");
  }

  // --- Step 8: Count remaining absolute-positioned elements ---
  // Check CSS rules since styles are now in the <style> block
  const allCss = doc3.querySelector("style")?.innerHTML || "";
  const absInCss = (allCss.match(/position\s*:\s*absolute/gi) || []).length;
  stats.nodesLeftAbsolute = absInCss;

  // --- Step 9: Clean up data attributes ---
  for (const el of doc3.querySelectorAll("*")) {
    el.removeAttribute("data-node-id");
    el.removeAttribute("data-image-ref");
    el.removeAttribute("data-svg-id");
    el.removeAttribute("data-svg-label");
    el.removeAttribute("data-fill-overlay");
  }

  // --- Step 10: Update title ---
  const title = doc3.querySelector("title");
  if (title && manifest?.frame?.name) {
    title.set_content(manifest.frame.name);
  }

  // Build final output
  const finalHtml = doc3.toString();

  if (stats.nodesLeftAbsolute > 20) {
    warnings.push(
      `${stats.nodesLeftAbsolute} elements still have position:absolute. ` +
      `These are likely overlay elements or nodes without autoLayout data. Review and convert where appropriate.`
    );
  }

  return { html: finalHtml, stats, warnings };
}
