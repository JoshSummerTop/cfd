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

## Try Your Best, Ship What You Have

Every \`compare\` response shows three lines:

\`\`\`
Target (ai-ready):  overall 85.1%  non-font 89.4%
You are now:        overall 82.6%  non-font 87.8%
Delta vs baseline:  non-font -1.6pp   ← ship-it range
\`\`\`

The **baseline** is what the engine's own rendered.html scored against the Figma reference. Match it when you can; it's fine to ship a few points off when you can't. The real deliverable is semantic HTML + correct structure, not pixel-perfect parity.

**Submit gate policy:**
- **Structural gate stays strict.** Semantic elements, flex/grid, no raw Figma positioning, no localhost URLs. These are non-negotiable production standards. Fix these before submitting — no exceptions.
- **Parity gate is a wide guardrail, not a perfection bar.** It blocks only catastrophic regressions (more than 15pp below baseline, or below the 40% absolute floor). Within that band, ship.

Non-font parity is the metric — it excludes Chromium-vs-Figma font rendering you can't fix. Aim for baseline, settle for "within a few points," call it done once structure is clean.

**Do not chase perfect parity.** Iteration 28 chasing a 3pp gap is wasted work. Iteration 5 submitting at -6pp with solid structure is shipped.

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

### Compare response (inline) — WHAT TO FIX NEXT
Every \`compare\` call surfaces inline:
- **Top issues by pixel impact** — ranked failure categories with fixable/engine-inherent tags.
- **Top failing nodes** — specific node IDs + failure types to target in cleaned.html.
- **Strip map + crops** — only the vertical bands with diffs, full-resolution.

You usually do NOT need to fetch \`cleaned-issue-diff.json\` separately. The inline top-N tables cover 90%+ of the signal you need.

### figma-screenshot.png — VISUAL TRUTH
What the design should look like. When in doubt, match this.

### Authority: figma-screenshot.png > manifest.json > ai-ready.html

## The Transformation Workflow

1. **INIT** — call \`init_cleaned_frame\` with jobId + frameIndex. This copies ai-ready.html to cleaned.html on disk so you have a starting point (avoids needing \`cp\` in bash).
2. **STUDY** — look at the Figma screenshot, count sections top-to-bottom. Read \`manifest.json\` for section roles + autoLayout values.
3. **TRANSFORM** \`cleaned.html\` in place:

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
   - Use \`position:absolute\` within a \`position:relative\` container — standard production CSS

4. **VALIDATE** — call \`validate\` to check structural quality. Fix errors before compare.
5. **COMPARE** — call \`compare\`. Read the target/you-are-now/delta block first.
6. **FIX** the top failing nodes. Use the \`fixable\` tag: skip anything marked engine-inherent.
7. **REPEAT** 5-6. Stop at any of (whichever hits first):
   - Structure is clean AND delta is anywhere in the "ship-it range" (i.e. not more than 15pp below baseline and above the 40% floor). **Just submit.** Don't chase small deltas.
   - 5 iterations with steady but minor improvement → submit what you have.
   - STALL warning appears (parity flat + topIssue cycling; see below) → submit or save_frame_note + move on.
   - IMAGE ISSUE DETECTED banner appears → fix the image path or force-submit with reason (CSS edits cannot fix it).
   - 10 iterations reached (soft stop — re-evaluate if there's a specific breakthrough ahead).
   - Compare refuses to run past **iteration 20** (hard stop).
8. **NOTE** — every compare auto-appends a breadcrumb (iter N: parity X% delta Y top-node Z) to \`frames/{i}/notes.md\`. Use \`save_frame_note\` on top of that for richer observations: strategies that regressed, broken image refs, layout class you identified, anything a retry agent would benefit from knowing.
9. **SUBMIT** — call \`submit_cleaned_frame\`.

## Reading a STALL Warning

The compare response will sometimes include:

\`\`\`
STALL DETECTED — parity flat across iterations N-2..N (spread 0.3pp) and topIssue cycling between [wrong_color, wrong_position].
\`\`\`

This means your last 3 edits haven't meaningfully changed parity and the top issue keeps flipping. You're chasing a moving target. **Stop iterating.** Do one of:

- **If non-font delta is within tolerance:** submit. You're done; further iteration is waste.
- **If topIssue includes wrong_color / wrong_fill_color:** suspect a missing image. Check the compare response for \`missing_image\` or \`wrong_image_fit\` in top failing nodes — those are image-loading problems, not CSS-color problems. CSS color edits cannot fix a missing image. Verify the image path in cleaned.html and that the file exists in \`frames/{index}/images/\`.
- **If the layout is structurally wrong:** revert the last 1-2 edits and try a different structural change (e.g. change the outer container from flex-row to flex-col, or adjust \`max-width\` on the wrapper).
- Before retrying, call \`save_frame_note\` with what didn't work so the next attempt doesn't repeat it.

## wrong_color Is Often NOT About CSS Colors

A common trap: \`topIssue: wrong_color\` shows up with 5+ nodes all reporting identical diff pixels and identical average colors. This is almost always a broken image rendering as the engine's \`#f0f0f0\` fallback grey, not a CSS color problem. The engine now correctly classifies these as \`missing_image\` (asset didn't load) or \`wrong_image_fit\` (image loaded but wrong background-size/position), so read the top failing nodes in the compare response before you start editing CSS colors.

## Cleaning Is Mandatory for ALL Frames

Even a 99% parity frame has junk layout — absolute positioning, inline styles, no semantic structure. **Every frame gets cleaned.** Parity is the stop signal, not the quality bar. The quality bar is production-grade semantic HTML with proper CSS.

## What Gets Blocked at Submission

\`submit_cleaned_frame\` runs two gates.

**Gate 1 — Structural quality** (same checks as the \`validate\` tool):
- Raw Figma positioning (many elements with position:absolute + large px coordinates like top:200px;left:500px)
- No semantic elements (header, main, section, footer)
- No display:flex or display:grid in CSS
- Fixed viewport width (1440px or 1920px on body/wrapper)
- More than 30 inline style="" attributes
- Localhost or engine API URLs

**Gate 2 — Parity non-regression (non-font):**
- Reads the non-font baseline from \`job.json\` (engine's rendered.html non-font parity).
- Reads the latest non-font parity from \`compare-log.json\`.
- Blocks if \`latest < baseline − 2pp\`.
- Blocks if no compare has been run yet. Always compare before submitting.

Overall/font-inclusive parity is NOT used by the gate. Font-rendering noise between Chromium and Figma is engine-inherent and cannot count against your work.

**Override (use sparingly):**
\`\`\`
submit_cleaned_frame({ jobId, frameIndex, force: true, forceReason: "short explanation" })
\`\`\`
Only for intentional structural changes that legitimately regressed parity — e.g. a decorative region deliberately simplified. Overrides appear in the submit response for traceability.

## Do Not

- Rewrite HTML from scratch — transform the copy of ai-ready.html you created with \`init_cleaned_frame\`.
- Rewrite content that's already correct — only restructure layout.
- Skip sections visible in the screenshot.
- Add UI elements not in the Figma screenshot.
- Use position:absolute for page-level layout (fine for overlays in relative containers).
- Add responsive @media queries — that is Job 2.
- Keep iterating past iteration 10 or past a STALL warning, or past an IMAGE ISSUE banner. Submit, note + hand off, or force-submit with reason.
- Apply "universal transforms" across frames. A script that worked on frame 1 (stacked vertical layout) will flatten frame 0 if frame 0 uses layered absolute positioning (hero + gradient overlay + nav bar at the same y-coord). Inspect the frame's structure before applying any blanket position-absolute→transform conversion.
- Read \`cleaned-issue-diff.json\` directly when the inline top-N tables already answer the question. That file is 80KB+ and blocks context.

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
- "Use these shared sections. Only write the unique <main> content for this frame."
- "Use save_frame_note to leave observations for retries."`;

export const CLEAN_FRAMES_INSTRUCTIONS = [
  CLEAN_FRAMES_CORE,
  WORKSPACE_STRUCTURE,
  DIFF_SYSTEM,
  IMAGES_AND_SVGS,
  OUTPUT_FORMAT,
  SNIPS,
].join("\n\n---\n\n");
