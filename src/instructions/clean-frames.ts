/**
 * Job 1: Clean Frames — Transform raw Figma HTML into production-grade code.
 *
 * This is the focused instruction set for frame cleaning.
 * Delivered contextually by the sync tool when uncleaned frames exist.
 */

import { WORKSPACE_STRUCTURE, DIFF_SYSTEM, IMAGES_AND_SVGS, OUTPUT_FORMAT, SNIPS } from "./shared.js";

const CLEAN_FRAMES_CORE = `# Job 1: Clean Frames

## What You Are Doing

Each frame has raw HTML from Figma's coordinate system — position:absolute everywhere, fixed pixel dimensions, inline styles. Your job is to transform this into production-grade code that visually matches the Figma design.

This is craft work. Each frame needs careful attention. The result is persistent — once a frame is cleaned and submitted, it's done.

## Your Inputs

### ai-ready.html — YOUR PRIMARY SOURCE
This is a lighter version of the engine's raw HTML. Same DOM structure, but:
- SVGs replaced with \`<div data-svg-id="...">\` placeholders (~40% fewer tokens)
- Images use \`data-image-ref="img-0"\` with grey backgrounds
- No localhost URLs to fix — resolve refs via \`image-map.json\` and \`svg-map.json\`

It has ALL the real text, colors, fonts, spacing, and structure from the Figma design. Read content from here.

**Do NOT use \`rendered.html\`.** It has inline SVGs and localhost URLs — bigger, messier, same content.

### manifest.json — STRUCTURE AND LAYOUT DATA
Contains data that eliminates guesswork:
- **\`sections[]\`** — each section's \`role\` (header, hero, content, footer) and suggested HTML \`tag\`
- **\`autoLayout[]\`** — exact flex properties (\`direction\`, \`gap\`, \`justify\`, \`align\`, \`padding\`) keyed by \`data-node-id\`
- **\`components[]\`** — detected repeating patterns with instance counts

Use \`sections\` to scaffold your semantic HTML structure. Use \`autoLayout\` to apply correct flex properties instead of guessing. Use \`components\` to identify card grids, repeated items, etc.

### issue-diff.json — WHAT'S FIXABLE VS UNFIXABLE
Per-node parity breakdowns showing exactly what's causing diff pixels. Each entry has:
- \`nodeName\`, \`failureType\` (wrong_position, wrong_fill_color, overflow_clip, etc.)
- \`diffPixels\` — how many pixels this node contributes to the diff

**Read this after each compare** to prioritize fixes. Some diffs are UNFIXABLE:
- CSS \`blur()\` filter renders differently between engine and browser (often 90%+ of hero banner diffs)
- Font anti-aliasing differences between OSes
- Sub-pixel rendering

If \`issue-diff.json\` shows remaining diffs are all unfixable, stop iterating even below 90%.

### figma-screenshot.png — VISUAL TRUTH
What the design should look like. When in doubt, match this.

### Authority Hierarchy
**figma-screenshot.png > manifest.json > ai-ready.html**

## The Developer Workflow

Work like a developer looking at a design mockup:

1. **STUDY** the Figma screenshot (\`figma-screenshot.png\`) — count every section top-to-bottom.
2. **READ** \`manifest.json\` — use \`sections[]\` for semantic structure, \`autoLayout[]\` for flex properties.
3. **READ** \`ai-ready.html\` — extract all content (text, colors, fonts, image refs). Resolve images via \`image-map.json\`, SVGs via \`svg-map.json\`.
4. **WRITE** \`cleaned.html\` with:
   - Semantic HTML: \`<header>\`, \`<main>\`, \`<section>\`, \`<footer>\` (use manifest section roles)
   - Flexbox/grid layout from manifest \`autoLayout\` — no \`position:absolute\` for page structure
   - CSS custom properties in \`:root\`
   - BEM class names (\`.hero__title\`, \`.card__image\`, \`.btn--primary\`)
   - ALL content from the design — every element visible in the Figma screenshot
   - Match the frame's exact dimensions — responsiveness comes later in Job 2
5. **COMPARE** — call \`compare\` to get a parity score and diff image
6. **READ** the diff image + \`issue-diff.json\` — identify fixable vs unfixable issues
7. **FIX** fixable issues in cleaned.html
8. **COMPARE** again — parity should improve
9. **REPEAT** until parity > 90% or remaining diffs are all unfixable (max 5 iterations)
10. **SUBMIT** — call \`submit_cleaned_frame\` (blocks if quality checks fail)

## Cleaning Is Mandatory for ALL Frames

Even a 99% parity frame has garbage HTML — absolute positioning, localhost URLs, no semantic structure. **Every frame gets cleaned regardless of its initial parity score.** Parity is the iteration stop signal, not the quality bar. The quality bar is production-grade semantic commented HTML.

## Expected Parity Progression

- **Iteration 1:** 65-85% — normal. You restructured absolute positioning into flexbox/grid.
- **Iteration 2:** 80-90% — layout fixes, spacing, image sizing.
- **Iteration 3-5:** 88-95% — fine-tuning. Some frames will plateau below 90% due to unfixable rendering diffs.

If iteration 1 returns >95%, you likely copied raw HTML without cleaning. The submit gate will block this.

If parity DROPS on iteration 2+, stop — your changes made things worse. Review what you changed.

After 5 iterations without reaching 90%, check \`issue-diff.json\`. If remaining diffs are unfixable, submit. If fixable diffs remain, ask the user for guidance.

## What Gets Blocked at Submission

The \`submit_cleaned_frame\` tool runs structural quality checks. Submission is REFUSED if:
- More than 20 elements with \`position:absolute\` + px coordinates
- No semantic elements (\`<header>\`, \`<main>\`, \`<section>\`, etc.)
- No \`display: flex\` or \`display: grid\` in CSS
- Fixed Figma viewport width (1440px or 1920px on body/wrapper)
- More than 30 elements with inline \`style=""\` attributes
- Localhost or engine API URLs in image references

**There are no shortcuts past this gate.** Write production code.

## Do Not

- Copy raw HTML with URL find-replace — the gate blocks this
- Add UI elements not visible in the Figma screenshot
- Skip sections visible in the screenshot — missing content is a failure
- Iterate more than 5 times per frame without asking the user
- Use \`position:absolute\` for page-level layout
- Use inline \`style=""\` on structural elements
- Add responsive \`@media\` queries — that is Job 2 (website build), not frame cleaning

## Session Logging

Log all work to the workspace:
- \`logs/session-log.md\` — session start/end state (append-only)
- \`logs/frames/frame-{idx}-log.md\` — per-frame iteration log (parity before/after, changes made)

## Background Agents

For multi-frame jobs, delegate per-frame work to background agents:
- **HARD LIMIT: 2 agents max at the same time** — launching 3+ is a failure
- Each agent handles ONE frame
- Each agent follows the full compare loop
- Each agent must log to the frame log
- Queue remaining frames and process in order

### Shared Component Reuse
Most frames share identical sections (header, footer, hero pattern). After cleaning the first frame, note the shared structure. Provide this to subsequent agents so they reuse it — don't redesign header/footer from scratch 9 times.`;

export const CLEAN_FRAMES_INSTRUCTIONS = [
  CLEAN_FRAMES_CORE,
  WORKSPACE_STRUCTURE,
  DIFF_SYSTEM,
  IMAGES_AND_SVGS,
  OUTPUT_FORMAT,
  SNIPS,
].join("\n\n---\n\n");
