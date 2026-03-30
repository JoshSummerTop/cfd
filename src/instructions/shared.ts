/**
 * Shared instruction sections used by both Job 1 (clean frames) and Job 2 (build website).
 * Contains workspace structure, diff system, image/SVG handling, and output format.
 */

export const WORKSPACE_STRUCTURE = `## Workspace Structure

\`\`\`
~/.codefromdesign/workspace/{jobId}/
  job.json                          — job metadata, frame list, parity scores
  build-guide.json                  — page-to-frame mapping, breakpoints, output structure
  logs/                             — session and frame logs
  frames/
    0/
      metadata.json                 — frame dimensions, parity, issue breakdown
      rendered.html                 — raw engine HTML (absolute positioning, inline styles)
      ai-ready.html                 — cleaned HTML with layout hints applied
      figma-screenshot.png          — THE REFERENCE — what the design looks like
      screenshot.png                — what the current HTML renders as
      diff.png                      — color-coded pixel diff
      manifest.json                 — layout metadata (flexbox hints, section roles, design tokens)
      svg-map.json                  — node ID → inline SVG markup for vectors/icons
      image-map.json                — reference ID → filename for images
      images/                       — actual image files (hash-named PNGs)
      cleaned.html                  — YOUR OUTPUT — production-grade code
      cleaned-screenshot.png        — screenshot of your output (after compare)
      cleaned-diff.png              — diff of your output vs Figma (after compare)
      compare-log.json              — iteration history
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

The **non-font parity** score is the primary metric (excludes font rendering differences between OSes).`;

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

When the user pastes snip metadata (text with \`type:\`, \`frame:\`, \`image:\` fields):
1. Read the image at the given path — it shows exactly what the user is pointing at
2. Use the metadata (frame index, source, region) to locate the issue
3. Fix the specific problem highlighted

ONLY call \`get_snips\` when the user pastes snip metadata. Never call it proactively.
Call \`clear_snips\` after fixes are confirmed.`;
