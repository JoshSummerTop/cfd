/**
 * Job 2: Build Website — Assemble cleaned frames into a responsive production website.
 *
 * This is the focused instruction set for website assembly.
 * Delivered contextually when all frames have been cleaned and submitted.
 */

import { SNIPS } from "./shared.js";

const BUILD_WEBSITE_CORE = `# Job 2: Build Website

## Prerequisites

All frames must be cleaned and submitted before you can build the website.
If \`check_readiness\` reports uncleaned frames, go back to Job 1.

## Think Like a Developer

Before building anything, reason about what the frames represent:

### Classify Each Frame

| Type | Description | Example | Treatment |
|------|-------------|---------|-----------|
| **page** | Standalone page a user navigates to | Home, Shop, About | Becomes its own HTML file |
| **overlay** | Modal/sidebar/popup on another page | Cart Sidebar, Search Modal | HTML inside parent page, hidden by default |
| **component** | Reusable element shown in isolation | Header, Footer | Integrated into pages that use it |
| **state** | Different state of an existing page | Cart Empty, 404 | Informs design, not a separate page |

**Key test:** Would a real user navigate directly to this URL? Yes → page. No → overlay/component/state.

### Plan the Website

Write to \`logs/session-log.md\`:
- Pages you will build (with which frame indices they use)
- Overlays and which pages they belong to
- Navigation structure (from Figma screenshots, not invented)
- Frames you are NOT building as standalone pages, and why

**build-guide.json is a starting point, not gospel.** Override it based on your analysis.

## Build Process

### 1. Create Output Directory

Mandatory structure:
\`\`\`
{workspace}/website/
  index.html              ← Home page
  css/
    styles.css            ← Shared design system only
  pages/
    {slug}.html           ← One per non-home page
  images/
    {hash}.png            ← All images, deduplicated
\`\`\`

### 2. Extract Shared Design System → css/styles.css

- CSS custom properties from \`:root\` — merge from all desktop cleaned frames
- CSS reset (box-sizing, body base)
- Shared components ONLY if visually identical across 2+ pages in Figma
- Responsive breakpoints from build-guide.json

**Never invent shared components not in the designs.**

### 3. Build Each Page

For each page in your plan:
1. **Desktop cleaned.html** = base structure, all content, default CSS
2. **Laptop cleaned.html** (if available) = reference for CSS differences only
3. **Mobile cleaned.html** (if available) = reference for CSS differences only
4. Merge into ONE responsive HTML file with \`@media\` queries
5. If only desktop exists: add responsive breakpoints at 1024px, 768px, 375px
6. Link to \`css/styles.css\` for shared tokens
7. Page-specific styles in \`<style>\` block
8. Images: \`index.html\` uses \`images/{hash}.png\`, \`pages/*.html\` uses \`../images/{hash}.png\`

### 4. Wire Navigation

- The \`navigation\` array in build-guide.json is for FILE LINKING only — not a visible element
- The Figma screenshots are the SOLE authority on what navigation looks like
- If Figma shows 4 nav links, your output has exactly 4 — even if build-guide lists 9 pages
- Use relative paths: \`index.html\`, \`pages/{slug}.html\`
- Mobile: collapse to hamburger if 4+ links and no mobile frame exists

### 5. Collect Images

Call \`collect_images\` — gathers images from all frames into \`website/images/\`, deduplicates.

### 6. Submit

Call \`submit_website\` with the \`website/\` directory path.

## Overlays

Include overlay HTML in the parent page, hidden by default (\`display: none\` or \`visibility: hidden\` + \`opacity: 0\`). Add a trigger element that could toggle it with JavaScript. The structure should be ready for JS activation.

## Background Agents

Delegate per-page work to background agents:
- **HARD LIMIT: 2 agents max at the same time**
- Each agent builds ONE page to completion
- Provide: job ID, frame indices, workspace path, design system, navigation structure
- Queue remaining pages and process in order

## Do Not

- Create pages for overlay/modal/component frames
- Add navigation not visible in Figma screenshots
- Render build-guide.json navigation array as a visible nav bar
- Skip responsive breakpoints
- Use \`position:absolute\` for page layout

## Session Logging

- \`logs/build-log.md\` — pages built, shared components, navigation, output files
- \`logs/session-log.md\` — final state after website submission`;

export const BUILD_WEBSITE_INSTRUCTIONS = [
  BUILD_WEBSITE_CORE,
  SNIPS,
].join("\n\n---\n\n");
