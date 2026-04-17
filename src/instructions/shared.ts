/**
 * Shared instruction sections used by both Job 1 (clean frames) and Job 2 (build website).
 * Contains workspace structure, diff system, image/SVG handling, and output format.
 */

export const WORKSPACE_STRUCTURE = `## Workspace Structure

\`\`\`
~/.codefromdesign/workspace/{jobId}/
  job.json                          — job metadata, frame list, parity scores
  build-guide.json                  — page-to-frame mapping, breakpoints, output structure
  frames/
    0/
      ai-ready.html                 — YOUR PRIMARY INPUT — DOM structure with data-image-ref and data-svg-id placeholders
      manifest.json                 — section roles, flex properties, component detection — READ THIS FIRST
      issue-diff.json               — per-node parity breakdown — fixable vs unfixable diffs
      figma-screenshot.png          — THE REFERENCE — what the design looks like
      diff.png                      — color-coded pixel diff
      svg-map.json                  — node ID → inline SVG markup for vectors/icons
      image-map.json                — reference ID → filename for images
      images/                       — actual image files (hash-named PNGs)
      compare-log.json              — iteration history (populated after compare)
      cleaned.html                  — YOUR OUTPUT — production-grade code
      .submitted                    — marker file (present = frame has been submitted)
    1/
      ...
\`\`\``;

export const DIFF_SYSTEM = `## Reading the Diff

The diff images use color-coded pixels to show what type of mismatch exists:

| Color | Category | What to fix |
|-------|----------|-------------|
| **Red** | Layout | Positioning, backgrounds, borders, spacing |
| **Blue** | Text/Font | Font size, weight, family (often OS-level — less actionable) |
| **Green** | Image | Wrong image, missing image, wrong dimensions |
| **Yellow** | Vector/Icon | Missing SVGs, wrong colors, wrong size |
| **Purple** | Shadow | Box-shadow, blur, drop shadows |

The **non-font parity** score is the primary metric (excludes font rendering differences between OSes).

## Compare Response Layout — Strips

Tall frames (often 6,000-12,000 px) can't be sent as one full-resolution image
without exhausting the subagent image budget. \`compare\` returns:

1. A **strip map** — a text grid of every vertical strip in the frame, marked
   \`[X]\` (has diffs) or \`[.]\` (clean). Each strip is 1,500 px tall.
2. A small **overview** of the full diff image (navigation aid only — low
   resolution, use for seeing where diffs cluster, not for inspecting detail).
3. For each dirty strip, **three full-resolution crops** labeled with the
   y-range: the Figma reference, your render, and the color-coded diff.

Work strip-by-strip in y-order. Use the strip map to budget your attention —
strips marked \`[.]\` already match; don't chase them. Strips with the highest
diff-pixel counts are where your effort pays off most.

Clean strips are *not* streamed as images, so multi-iteration sessions on a
tall frame keep running instead of dying mid-fix.`;

export const IMAGES_AND_SVGS = `## Images and SVGs

### Images
1. Read \`image-map.json\` — maps ref IDs to filenames: \`{ "img-0": "images/hash.png" }\`
2. Find \`data-image-ref\` attributes in \`ai-ready.html\`: \`<div data-image-ref="img-0">\`
3. Look up the ref → \`"images/2727769ba747.png"\`
4. Use that relative path in cleaned.html: \`<img src="images/2727769ba747.png" alt="..." />\`

**NEVER use localhost URLs, API URLs, or http:// paths.** Only relative paths: \`images/{filename}\`.
The compare endpoint copies images to the render directory automatically.

### SVGs / Icons
- \`svg-map.json\` maps Figma node IDs to inline SVG markup
- In \`ai-ready.html\`, SVGs appear as elements with \`data-svg-id\` attributes
- Embed SVGs inline in your cleaned.html`;

export const OUTPUT_FORMAT = `## Output Format

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
  </style>
</head>
<body>
  <!-- Semantic HTML with BEM classes -->
  <!-- Images: <img src="images/hash.png" alt="..." /> -->
  <!-- SVGs: inline from svg-map.json -->
</body>
</html>
\`\`\``;

export const SNIPS = `## Snips — User-Reported Issues

When the user pastes snip metadata (text with \`type:\`, \`frame:\`, \`snip:\` fields):
1. Call \`get_snips\` with the **current job ID** (the same job ID you used for \`sync\`) — it fetches the snip image and metadata from the engine
2. The \`jobId\` parameter is the pipeline job UUID, NOT a value from the snip metadata fields
3. Use the returned image and metadata (frame index, source, region) to locate the issue
4. Fix the specific problem highlighted

ONLY call \`get_snips\` when the user pastes snip metadata. Never call it proactively.
Call \`clear_snips\` after fixes are confirmed.`;
