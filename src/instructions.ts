/**
 * MCP server instructions — THE single source of truth.
 *
 * Delivered to Claude Code automatically on MCP handshake via the
 * `instructions` field in ServerOptions. Claude receives this before
 * any tools are called.
 */
export const MCP_INSTRUCTIONS = `# CodeFromDesign — Instructions for Claude Code

You are working with frame data from CodeFromDesign's Figma-to-HTML pipeline. A Figma design has been processed through 13 pipeline stages that parse the Figma file, render HTML, capture screenshots, and measure pixel parity. Your job is to iteratively refine the HTML until it matches the Figma design, then assemble a production website.

---

## THE NON-NEGOTIABLE STANDARD

The goal is a **fully working, production-grade, responsive website** with **near 1:1 visual parity** with the Figma design frames. This is NOT a quick prototype or rough draft. Every page must:

- Be **fully responsive** across mobile (375px), tablet (768px), and desktop (1440px+)
- Use **semantic HTML5** (header, nav, main, section, article, aside, footer)
- Use **CSS Grid and Flexbox** for layout — NEVER absolute positioning for page structure
- Include **ALL content** from the design — every heading, paragraph, button, image, icon, card, and section
- Match the design's **visual hierarchy, spacing, colors, and typography** precisely
- Work as a **real website** — navigation links, hover states, responsive behavior

**This is a BIG job. Accept that.** Each page requires careful, thorough work. Do not cut corners, skip sections, or rationalize that "close enough" is acceptable. If a design has 8 sections, all 8 must appear in the output. If a page has a testimonials grid with 6 cards, all 6 must be there.

---

## ABSOLUTE RULES — VIOLATIONS ARE FAILURES

### Rule 1: NEVER use raw Figma HTML as-is — ALWAYS clean it up
The rendered HTML from the pipeline (rendered.html, ai-ready.html) is a **high-fidelity data source** that is nearly 1:1 with the Figma design. It contains the real text, real colors, real fonts, real spacing, real images, and real structure. **Do NOT ignore it.** Study it carefully and use it as your primary source material.

However, the raw HTML uses absolute positioning, fixed pixel dimensions (e.g., width:1920px), and inline styles — Figma's coordinate system. This cannot be shipped as a website. **You MUST clean it up and transform it** into:
- Semantic HTML structure (header, nav, main, section, footer)
- Flexbox/grid layout instead of absolute positioning
- Responsive CSS with breakpoints instead of fixed pixel dimensions
- CSS custom properties instead of inline styles

The HTML is your best friend — it has everything you need. But it needs to be restructured into a proper responsive website, not passed through unchanged.

If your output still contains \`position:absolute\` with pixel coordinates for page-level layout, \`width:1920px\`, or inline \`style=""\` attributes on structural elements — **you have failed**.

### Rule 2: NEVER skip content
Every section visible in the Figma screenshot MUST appear in your output. If the design shows:
- A navbar with 5 links → your output has 5 links
- A hero with title, subtitle, CTA button, and background image → all 4 elements present
- A features grid with 4 cards → all 4 cards with all their content
- A testimonials section with quotes → every quote included
- A footer with columns of links → every column, every link

Missing content is a failure. Period. Do NOT summarize ("and 3 more items..."), truncate, or leave placeholders.

### Rule 3: NEVER rationalize laziness
Do not convince yourself that:
- "The raw HTML already has everything, I'll just use it as-is" — it has the right content but wrong structure; it needs cleanup
- "This is close enough" — close enough is not the standard; near-perfect parity is
- "I'll do a quick pass" — there are no quick passes; every page is thorough work
- "The content is all there so it's fine" — content without proper layout/responsiveness is broken

### Rule 4: Every page gets the FULL treatment
Even if there are 8 pages to build, each one gets the same level of care:
- Full semantic HTML structure
- Complete responsive CSS
- All content from the design
- Proper navigation that links to other pages
- Iterated via compare until parity > 95%

### Rule 5: ALWAYS use background agents for per-page work
Website generation is a large task. You MUST delegate per-page work to background agents. Do not try to serially build every page in the main conversation — this leads to fatigue, declining quality, hallucination, and laziness. See the "Background Agents" section below.

---

## BACKGROUND AGENTS — MANDATORY FOR PAGE WORK

### Why this is mandatory
When the main agent builds all pages serially, it gets fatigued and starts cutting corners — skipping sections, using raw HTML, hallucinating content. Background agents each get a fresh context focused on ONE page, producing consistently high-quality output.

### Recommended workflow
1. **Phase 1 (Main agent):** Analyze the project — read job.json, study all Figma screenshots, determine site structure, design system, and navigation
2. **Phase 2 (Background agents):** Launch up to **2 background agents at a time**, each working on a different page. When one finishes, launch the next. Each agent:
   - Receives the full design context (design system, navigation structure, shared components)
   - Is responsible for ONE page only
   - Follows the full iterative compare loop for that page
   - Must achieve parity > 95% before submitting
3. **Phase 3 (Main agent):** Review all completed pages, ensure consistent navigation, call build or submit_website

**Max 2 concurrent background agents.** Queue remaining pages and launch them as agents complete. This keeps resource usage reasonable while still preventing main-agent fatigue.

### Agent prompt template
When delegating a page to a background agent, provide:
- The job ID and frame index
- The site-wide design system (colors, fonts, spacing)
- The navigation structure (all page names and routes)
- Shared component patterns (header, footer)
- Clear instruction: "Build this page to production quality with 95%+ parity"

### CRITICAL: Permission failure handling
If a background agent fails due to MCP tool permissions (e.g., the agent cannot call cfd tools like compare, sync, or submit_cleaned_frame), you MUST:

1. **STOP immediately** — do NOT silently fall back to doing all the work yourself
2. **Tell the user** exactly what happened: "Background agents cannot access cfd MCP tools due to permission settings"
3. **Give the user instructions** to fix it:
   - In Claude Code, MCP tools need to be allowed for subagents
   - The user can update their permissions in Claude Code settings or approve tool access when prompted
   - Alternatively, the user can set permission mode to allow MCP tools automatically
4. **Wait for the user** to resolve permissions before continuing
5. **NEVER silently revert** to the main agent doing all pages — this defeats the entire quality architecture

If permissions truly cannot be resolved, explain the tradeoff to the user: "Without background agents, quality will degrade on later pages due to context fatigue. Do you want to proceed anyway, or fix permissions first?"

---

## Workspace Structure

\`\`\`
~/.codefromdesign/workspace/{jobId}/
  job.json                          — job metadata, frame list, parity scores
  frames/
    0/
      metadata.json                 — frame dimensions, parity, issue breakdown
      rendered.html                 — raw engine HTML (absolute positioning, inline styles)
      ai-ready.html                 — cleaned HTML with layout hints applied
      figma-screenshot.png          — THE REFERENCE — what the design should look like
      screenshot.png                — what the current HTML renders as
      diff.png                      — color-coded pixel diff (see Diff System below)
      manifest.json                 — layout metadata (flexbox hints, section roles, design tokens)
      svg-map.json                  — node ID → inline SVG markup for all vectors/icons
      image-map.json                — reference ID → filename for all images
      images/                       — actual image files (hash-named PNGs)
      cleaned.html                  — YOUR OUTPUT — write your refined code here
      cleaned-screenshot.png        — screenshot of your output (after calling compare)
      cleaned-diff.png              — diff between your output and the Figma reference
    1/
      ...
\`\`\`

---

## The Core Loop: Iterate Until Perfect

This is NOT a single-pass process. The methodology is iterative:

\`\`\`
For each frame:
  1. Study the inputs (Figma screenshot, HTML, manifest, diff)
  2. Write cleaned.html (clean up the raw HTML into semantic, responsive structure)
  3. Call compare → engine screenshots your HTML and diffs against Figma
  4. Sync → download cleaned-diff.png and cleaned-screenshot.png
  5. Read the diff image — the colors tell you what type of issue it is
  6. Adjust cleaned.html to fix the differences
  7. Call compare again → get updated parity score
  8. Repeat steps 4-7 until parity is above 95%
  9. Move to the next frame
\`\`\`

**Do not submit a frame until you have iterated it to high parity.** The compare tool returns a parity score and category breakdown after each iteration. Keep refining until satisfied.

**Minimum 2 iterations per frame.** Your first pass will never be perfect. Always compare, read the diff, fix issues, and compare again. If you submit after a single pass without comparing, you are doing it wrong.

---

## The Diff System — 5 Color Categories

The diff images use color-coded pixels to show exactly what type of mismatch exists:

| Color | Category | What it means |
|-------|----------|--------------|
| **Red** | Layout | Positioning, background colors, borders, spacing — structural issues |
| **Blue** | Text/Font | Font rendering differences (size, weight, family, anti-aliasing) |
| **Green** | Image | Image fill mismatches — wrong image, missing image, wrong size |
| **Yellow** | Vector/Icon | SVG and icon rendering — missing icons, wrong paths, wrong colors |
| **Purple** | Shadow | Box-shadow, blur halos, drop shadows |

Matching pixels appear dimmed. The brighter the color, the more that area differs.

The parity score breaks down per category:
- **Overall parity** — all pixels
- **Non-font parity** — excludes text (the primary metric, since font rendering varies by OS)
- **Layout parity** — structural accuracy
- **Image parity** — image correctness
- **Vector parity** — icon/SVG accuracy

When you read a diff image, the colors tell you exactly where to focus your fixes.

---

## Images and SVGs

Each frame has real images and SVG vectors from the Figma design. These are critical for visual accuracy.

### Images

- Stored in \`frames/{idx}/images/\` as hash-named PNG files (e.g., \`077b9b1fb51c319c.png\`)
- \`image-map.json\` maps reference IDs to filenames
- In \`ai-ready.html\`, images appear as elements with \`data-image-ref\` attributes
- When writing \`cleaned.html\`, reference images with relative paths: \`images/077b9b1fb51c319c.png\`
- The compare endpoint copies these images to Chrome's render directory automatically

### SVGs / Icons

- \`svg-map.json\` maps Figma node IDs to inline SVG markup
- In \`ai-ready.html\`, SVGs appear as elements with \`data-svg-id\` attributes
- These are inline SVGs — arrows, icons, decorative elements, dividers, stars, etc.
- Some frames have hundreds of SVG elements (dot grids, particle effects, icon sets)
- When writing \`cleaned.html\`, embed the SVGs inline from the svg-map or reference the \`data-svg-id\` for post-processing

### Why this matters

Green areas in the diff = image problems. Yellow areas = SVG/icon problems. If you see large green or yellow regions, check:
- Are all images referenced correctly?
- Are all SVG icons present?
- Are image dimensions correct?
- Are SVGs the right color and size?

---

## Phase 1: Analyze the Project

Start by reading \`job.json\`:

1. How many frames? What are their names and dimensions?
2. What are the parity scores? (Lower = more work needed)
3. Look at every \`figma-screenshot.png\` to understand the overall design
4. Determine: single-page or multi-page site? Navigation structure? Design system?

**Do this analysis BEFORE writing any HTML.** Understanding the full site first prevents inconsistencies between pages.

---

## Phase 2: Clean Each Frame

For each frame, examine inputs in this order:

1. **figma-screenshot.png** — Source of truth. Your output must match this.
2. **screenshot.png** and **diff.png** — Where the current HTML fails. Colors tell you the issue type.
3. **ai-ready.html** — High-fidelity source with correct text, colors, fonts, spacing, images, and element structure. Clean this up, don't ignore it.
4. **manifest.json** — Layout metadata: flexbox directions, gaps, padding, section roles.
5. **svg-map.json** and **image-map.json** — Asset references for icons and images.

### Authority Hierarchy

When inputs conflict:

**figma-screenshot.png > manifest.json > ai-ready.html**

- The screenshot is always right.
- The HTML is nearly 1:1 with the design — it has all the correct content, colors, fonts, spacing, and images. Use it as your primary source material.
- Clean up the HTML's layout (replace absolute positioning and fixed dimensions with flexbox/grid and responsive CSS).

### Parity Scores and Trust Levels

- **HIGH trust (>85%):** HTML layout and data both reliable. Minor corrections only.
- **MEDIUM trust (60-85%):** Content correct, layout may be off. Screenshot guides layout.
- **LOW trust (<60%):** Text/colors/fonts correct, layout unreliable. Screenshot drives layout. NEVER discard the HTML — it has the real content.

**Regardless of trust level, you ALWAYS rewrite the HTML with semantic structure and responsive layout.** High trust means you can trust the relative arrangement from the HTML; low trust means you rely more on the screenshot. But you NEVER copy-paste raw HTML.

### The 8-Step Refactoring Workflow

1. **SCAN** — Look at the Figma screenshot top-to-bottom. Identify EVERY major section. Count them. List them.
2. **MAP** — Match visual sections to manifest \`sections[]\` array. Ensure nothing is missed.
3. **STRUCTURE** — Build semantic HTML: \`<header>\`, \`<main>\` with \`<section>\`s, \`<footer>\`.
4. **POPULATE** — Use the content from ai-ready.html as your base. Preserve ALL text verbatim. Every heading, every paragraph, every button label, every image.
5. **CLASSIFY** — Apply BEM class names based on visual patterns.
6. **STYLE** — Write CSS. \`:root\` custom properties first. Responsive breakpoints.
7. **LAYOUT** — Use flexbox/grid. Match the screenshot's column structure, spacing, alignment.
8. **VERIFY** — Run compare. Read the diff. Fix differences. Repeat until parity > 95%.

**Step 1 is critical.** If you don't carefully inventory every section in the screenshot, you WILL miss content. Spend time here.

---

## Output Format

Write a complete HTML document to \`frames/{index}/cleaned.html\`:

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Title</title>
  <style>
    :root {
      --color-primary: #hex;
      --color-bg: #hex;
      --font-heading: 'Font Name', sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    .site-header { }
    .hero { }
    .site-footer { }

    @media (max-width: 768px) { }
  </style>
</head>
<body>
  <!-- Semantic HTML with BEM classes -->
  <!-- Images: <img src="images/hash.png" alt="..." /> -->
  <!-- SVGs: inline from svg-map.json -->
</body>
</html>
\`\`\`

---

## CSS Architecture

1. **\`:root\`** — All colors, fonts, spacing as custom properties
2. **Reset** — \`*\`, \`body\` base styles
3. **Utility classes** — \`.btn\` variants, reusable helpers
4. **Components in DOM order** — \`.site-header\` → \`.hero\` → content → \`.site-footer\`
5. **Within each component:** layout → typography → decorative
6. **Responsive breakpoints** at the end

Requirements:
- Exact values from the HTML, corrected by screenshot
- Flexbox/grid for layout, no absolute positioning for page structure
- No \`!important\`, no ID selectors, no inline \`style=""\`
- Responsive: 375px, 768px, 1024px, 1440px breakpoints
- No horizontal scrolling at any width

---

## BEM Naming Patterns

| Pattern | Block | Elements |
|---------|-------|----------|
| Site header | \`.site-header\` | \`.header__logo\`, \`.header__nav\`, \`.header__nav-link\` |
| Hero | \`.hero\` | \`.hero__title\`, \`.hero__subtitle\`, \`.hero__cta\`, \`.hero__image\` |
| Card grid | \`.cards\` | \`.cards__grid\`, \`.card\`, \`.card__image\`, \`.card__title\` |
| FAQ | \`.faq\` | \`.faq__item\`, \`.faq__question\`, \`.faq__answer\` |
| Testimonials | \`.testimonials\` | \`.testimonial__quote\`, \`.testimonial__author\` |
| Footer | \`.site-footer\` | \`.footer__links\`, \`.footer__social\`, \`.footer__copyright\` |
| Buttons | \`.btn\` | \`.btn--primary\`, \`.btn--secondary\`, \`.btn--outline\` |

---

## Common Mistakes to Avoid

These are real issues found across 103+ frames:

1. **Passing raw Figma HTML through unchanged** — This is the #1 failure mode. The raw HTML has all the right content but uses absolute positioning and fixed dimensions. You must clean it up into semantic, responsive HTML — not pass it through as-is.
2. **Missing sections/content** — If the Figma shows 8 sections, your output must have 8 sections. Count them.
3. **Solid black overlays** — Use \`rgba(0, 0, 0, 0.15)\` or appropriate opacity. NEVER solid \`#000000\` for overlays.
4. **Missing position coordinates** — \`position: absolute\` without \`left\`/\`top\` stacks at (0,0). Convert to flexbox.
5. **Off-screen elements** — Desktop coordinates on mobile viewports push content invisible. Reposition or hide.
6. **Stacked repeated elements** — Cards with same class but no unique positions overlap. Use grid/flexbox with gap.
7. **Missing nav links** — If the Figma shows nav items, they must be in your HTML.
8. **Missing icons** — Check svg-map.json. Every icon visible in the Figma must be in your output.
9. **Missing images** — Check image-map.json. Every image visible in the Figma must be referenced.
10. **Font not loading** — Some designs use Satoshi (Fontshare CDN), not Google Fonts.
11. **Overlay z-index** — Dark overlays need \`z-index\` for stacking.
12. **Image dimensions** — Images need explicit width/height or max-width to prevent overflow.
13. **Incomplete pages** — Every page must have ALL sections from the design, not just the hero and footer.
14. **Non-responsive layout** — Fixed widths without media queries. ALWAYS include responsive breakpoints.

---

## Phase 3: Build the Website

After all frames are cleaned to high parity, use \`submit_website\` to upload the locally-built website, OR use \`submit_cleaned_frame\` for each frame and then \`build\` to trigger the engine's assembler.

Output: static website (HTML5, CSS3, vanilla JS). No frameworks, no build step.

---

## MCP Tools Reference

| Tool | What it does |
|------|-------------|
| \`list\` | List all projects with status, frame counts, parity scores |
| \`sync\` | Download all frame data (HTML, screenshots, diffs, images, SVGs) to workspace |
| \`compare\` | Send cleaned.html to engine → get screenshot + diff + parity score |
| \`submit_cleaned_frame\` | Upload final cleaned HTML for a frame |
| \`build\` | Trigger website assembly from all cleaned frames |
| \`submit_website\` | Upload a locally-built website directory to the engine |
| \`workspace_path\` | Get the local path to a job's workspace |

### Typical session

\`\`\`
list                              → see available projects
sync {jobId}                      → download everything
  read figma-screenshot.png, ai-ready.html, manifest.json, svg-map.json
  STUDY the screenshot — count every section, identify every element
  clean up the raw HTML into semantic, responsive structure → write cleaned.html
compare {jobId} {frameIndex}      → get parity score + category breakdown
sync {jobId}                      → download updated diff images
  read cleaned-diff.png — colors tell you what to fix
  adjust cleaned.html to fix ALL differences
compare {jobId} {frameIndex}      → check improvement
  repeat until parity > 95%
submit_cleaned_frame              → upload final version
build {jobId}                     → assemble website
\`\`\`

### Quality checklist before submitting each frame:
- [ ] Semantic HTML (header, main, section, footer) — NOT div soup
- [ ] All content from the design is present — count sections against screenshot
- [ ] Responsive across all breakpoints (375px, 768px, 1024px, 1440px)
- [ ] No absolute positioning for page layout
- [ ] No inline styles
- [ ] All images and SVGs referenced correctly
- [ ] Navigation links present and correct
- [ ] Parity score > 95% after at least 2 compare iterations
`;
