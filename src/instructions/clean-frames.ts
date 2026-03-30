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

## The Workflow

1. **STUDY** the Figma screenshot — understand what you're building.
2. **TRANSFORM** — call \`transform\` to generate first-pass \`cleaned.html\` automatically (<1 second). This tool:
   - Wraps sections in semantic tags using manifest.json roles
   - Applies flex layout from manifest.json autoLayout data
   - Resolves images via image-map.json
   - Resolves SVGs via svg-map.json
   - Fixes viewport and wrapper dimensions
3. **REVIEW** the generated cleaned.html — check structure, fix any layout issues the tool missed.
   - Elements without autoLayout data keep absolute positioning — convert overlays manually if needed
   - \`position:absolute\` within \`position:relative\` containers is FINE for overlays (badges, captions, hover states)
4. **VALIDATE** — call \`validate\` to check structural quality. Fix errors.
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

\`submit_cleaned_frame\` and \`validate\` check structural quality. Submission is REFUSED if:
- Raw Figma positioning (many elements with position:absolute + large px coordinates like top:200px;left:500px)
- No semantic elements (header, main, section, footer)
- No display:flex or display:grid in CSS
- Fixed viewport width (1440px or 1920px on body/wrapper)
- More than 30 inline style="" attributes
- Localhost or engine API URLs

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
