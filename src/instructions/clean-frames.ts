/**
 * Job 1: Clean Frames — Transform raw Figma HTML into production-grade code.
 *
 * Core principle: TRANSFORM, don't rewrite. ai-ready.html already has the
 * correct content. Restructure it surgically — don't start from a blank page.
 */

import { WORKSPACE_STRUCTURE, DIFF_SYSTEM, IMAGES_AND_SVGS, OUTPUT_FORMAT, SNIPS } from "./shared.js";

const CLEAN_FRAMES_CORE = `# Job 1: Clean Frames

## What You Are Doing

Each frame has HTML from the engine with the correct content — every heading, paragraph, button, image, color, and font is already there. But the layout uses Figma's coordinate system (position:absolute, fixed px dimensions, inline styles). Your job is to **transform the layout** into production-grade CSS while keeping all the content intact.

**TRANSFORM, don't rewrite.** The content is correct. The layout needs restructuring. This is a surgical edit — not starting from a blank page.

## Your Inputs

### ai-ready.html — YOUR STARTING TEMPLATE
Same DOM structure as the engine output but lighter (~40% fewer tokens):
- SVGs replaced with \`<div data-svg-id="...">\` placeholders
- Images use \`data-image-ref="img-0"\` refs
- No localhost URLs

**This is your starting template.** It has ALL the correct text, colors, fonts, spacing, and structure. You are transforming THIS file — not writing new HTML from scratch.

**Do NOT use \`rendered.html\`.** Same content but bloated with inline SVGs and localhost URLs.

### manifest.json — STRUCTURE AND LAYOUT DATA
Eliminates guesswork:
- **\`sections[]\`** — each section's \`role\` (header, hero, content, footer) and suggested HTML \`tag\`
- **\`autoLayout[]\`** — exact flex properties (\`direction\`, \`gap\`, \`justify\`, \`align\`, \`padding\`) keyed by \`data-node-id\`
- **\`components[]\`** — detected repeating patterns with instance counts

### issue-diff.json — WHAT'S FIXABLE VS UNFIXABLE
Per-node parity breakdowns. Read after each compare to:
- Focus on fixable issues (wrong_position, wrong_width, overflow_clip)
- Skip unfixable diffs (CSS blur rendering, font anti-aliasing, sub-pixel rendering)
- If remaining diffs are all unfixable, stop iterating even below 90%

### figma-screenshot.png — VISUAL TRUTH
What the design should look like. When in doubt, match this.

### Authority: figma-screenshot.png > manifest.json > ai-ready.html

## The Transformation Workflow

**You are transforming ai-ready.html, not writing from scratch.**

1. **STUDY** the Figma screenshot — count every section top-to-bottom.
2. **READ** \`manifest.json\` — note section roles, flex properties from \`autoLayout\`.
3. **TRANSFORM** \`ai-ready.html\` into \`cleaned.html\`:

   **What to change (layout):**
   - Replace \`position:absolute\` page layout with flexbox/grid (use \`autoLayout\` values from manifest)
   - Move inline \`style=""\` attributes to a \`<style>\` block with BEM classes
   - Wrap content in semantic elements (\`<header>\`, \`<main>\`, \`<section>\`, \`<footer>\`) based on manifest \`sections[]\` roles
   - Replace \`width:1440px\` on containers with \`max-width\`
   - Add \`:root\` CSS custom properties for colors, fonts, spacing
   - Resolve \`data-image-ref\` → \`images/{hash}.png\` via \`image-map.json\`
   - Resolve \`data-svg-id\` → inline SVG via \`svg-map.json\`

   **What to KEEP (content — do not rewrite):**
   - All text content verbatim — headings, paragraphs, labels, links
   - All colors, font sizes, font weights, font families
   - All spacing values (margins, paddings, gaps)
   - All images and their dimensions
   - All SVG icons
   - Element order and hierarchy

   **position:absolute is fine for overlays:**
   - Badges on product card images (discount/new labels)
   - Content cards overlaid on hero banners
   - Hover overlays, floating buttons, image captions
   - Use \`position:absolute\` within a \`position:relative\` container — this is standard production CSS

4. **VALIDATE** — call \`validate\` to instantly check structural quality. Fix errors before proceeding.
5. **COMPARE** — call \`compare\` for parity score + diff image.
6. **READ** diff image + \`issue-diff.json\` — identify fixable vs unfixable issues.
7. **FIX** fixable issues only.
8. **REPEAT** steps 5-7 until parity > 90% or remaining diffs are all unfixable (max 5 iterations).
9. **SUBMIT** — call \`submit_cleaned_frame\`.

## Cleaning Is Mandatory for ALL Frames

Even a 99% parity frame has junk layout — absolute positioning, inline styles, no semantic structure. **Every frame gets cleaned.** Parity is the iteration stop signal, not the quality bar. The quality bar is production-grade semantic HTML with proper CSS.

## Expected Parity

- **Iteration 1:** 75-90% — normal. Layout restructuring changes pixel output.
- **Iteration 2-3:** 85-95% — spacing and sizing fixes.
- Some frames plateau below 90% due to unfixable engine rendering diffs (blur, fonts). That is OK.

If iteration 1 returns >95%, you likely copied raw HTML without transforming. The submit gate will block this.

If parity DROPS on iteration 2+, your changes made things worse. Revert and try a targeted fix.

## What Gets Blocked at Submission

\`submit_cleaned_frame\` runs TWO gates, both of which can refuse the submission.

**Gate 1 — Structural quality** (same checks as the \`validate\` tool):
- Raw Figma positioning (many elements with position:absolute + large px coordinates like top:200px;left:500px)
- No semantic elements (header, main, section, footer)
- No display:flex or display:grid in CSS
- Fixed viewport width (1440px or 1920px on body/wrapper)
- More than 30 inline style="" attributes
- Localhost or engine API URLs

**Gate 2 — Parity non-regression:**
- Reads the baseline from \`job.json\` (engine's rendered.html parity against Figma).
- Reads the latest compare from \`compare-log.json\`.
- Blocks if latest cleaned parity < baseline - 2pp tolerance.
- Blocks if no compare has been run yet (so there's no data to gate against). Run \`compare\` before submitting.
- The gate is for catching regressions caused by layout mistakes — not for punishing iteration speed. Iterate with \`compare\` until the score at least matches the baseline, then submit.

**Override (use sparingly, document why):** if a regression is intentional — e.g. a decorative region was deliberately simplified, or the cleaned layout is intentionally more responsive in ways the fixed-viewport Figma render can't represent — call:
\`\`\`
submit_cleaned_frame({ jobId, frameIndex, force: true, forceReason: "short explanation" })
\`\`\`
Overrides are logged. Do not use this to avoid fixing a real regression.

## Do Not

- Rewrite HTML from scratch — transform ai-ready.html
- Rewrite content that's already correct — only restructure layout
- Skip sections visible in the screenshot
- Add UI elements not in the Figma screenshot
- Use position:absolute for page-level layout (fine for overlays in relative containers)
- Add responsive @media queries — that is Job 2
- Iterate more than 5 times without checking issue-diff.json for unfixable diffs

## Background Agents

For multi-frame jobs, delegate per-frame work to background agents:
- **HARD LIMIT: 2 agents max at the same time**
- Each agent handles ONE frame
- Queue remaining frames and process in order

### Shared Component Reuse — CRITICAL FOR SPEED
Most frames share identical sections (header, footer, hero banner, features bar). **Clean the first frame fully, then reuse its shared sections for all subsequent frames.** Provide the cleaned header/footer/hero HTML to each agent. Do NOT redesign these from scratch for every frame — that is 60-70% wasted work.

When delegating to an agent, include:
- The shared component HTML (header, footer, etc. from the first cleaned frame)
- The job-specific design tokens (:root variables)
- "Use these shared sections. Only write the unique <main> content for this frame."`;

export const CLEAN_FRAMES_INSTRUCTIONS = [
  CLEAN_FRAMES_CORE,
  WORKSPACE_STRUCTURE,
  DIFF_SYSTEM,
  IMAGES_AND_SVGS,
  OUTPUT_FORMAT,
  SNIPS,
].join("\n\n---\n\n");
