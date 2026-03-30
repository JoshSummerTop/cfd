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

## The Raw HTML: Your Source Material AND Your Trap

\`ai-ready.html\` contains the real text, colors, fonts, spacing, images, and structure from the Figma design. It is your best source of content — every heading, paragraph, button label, and image reference is there.

**BUT** — the HTML uses Figma's coordinate system (absolute positioning, fixed pixel widths). You cannot ship it as-is. You must READ the content from it and WRITE proper code.

**If you copy the HTML and just replace URLs, the submit gate will block you.**

## The Developer Workflow

Work like a developer looking at a design mockup:

1. **STUDY** the Figma screenshot (\`figma-screenshot.png\`) — this is truth. Count every section top-to-bottom.
2. **READ** \`ai-ready.html\` + \`manifest.json\` for content, colors, fonts, spacing, image refs.
3. **WRITE** \`cleaned.html\` with:
   - Semantic HTML: \`<header>\`, \`<main>\`, \`<section>\`, \`<footer>\`
   - Flexbox/grid layout — no \`position:absolute\` for page structure
   - CSS custom properties in \`:root\`
   - BEM class names (\`.hero__title\`, \`.card__image\`, \`.btn--primary\`)
   - ALL content from the design — every element visible in the Figma screenshot
   - Match the frame's exact dimensions — responsiveness comes later in Job 2
4. **COMPARE** — call \`compare\` to get a parity score and diff image
5. **READ** the diff image — colors tell you what type of issue (see Diff System below)
6. **FIX** issues in cleaned.html based on the diff
7. **COMPARE** again — parity should improve
8. **REPEAT** until parity > 95% (max 5 iterations)
9. **SUBMIT** — call \`submit_cleaned_frame\` (blocks if quality checks fail)

## Expected Parity Progression

- **Iteration 1:** 65-85% — normal. You restructured absolute positioning into flexbox/grid.
- **Iteration 2:** 80-92% — layout fixes, spacing, image sizing.
- **Iteration 3-5:** 90-97% — fine-tuning to reach 95%.

If iteration 1 returns >95%, you likely copied raw HTML without cleaning. The submit gate will block this.

If parity DROPS on iteration 2+, stop — your changes made things worse. Review what you changed.

After 5 iterations without reaching 95%, stop and ask the user for guidance.

## Authority Hierarchy

When inputs conflict: **figma-screenshot.png > manifest.json > ai-ready.html**

The screenshot is always right. The HTML has the correct content. Clean up the layout.

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
- Queue remaining frames and process in order`;

export const CLEAN_FRAMES_INSTRUCTIONS = [
  CLEAN_FRAMES_CORE,
  WORKSPACE_STRUCTURE,
  DIFF_SYSTEM,
  IMAGES_AND_SVGS,
  OUTPUT_FORMAT,
  SNIPS,
].join("\n\n---\n\n");
