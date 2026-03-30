/**
 * Instruction dispatcher — exports contextual instructions based on job state.
 *
 * Replaces the monolithic MCP_INSTRUCTIONS with focused instruction sets:
 * - Handshake: compact intro delivered on MCP connect
 * - Clean: Job 1 instructions for frame cleaning
 * - Build: Job 2 instructions for website assembly
 */

export { CLEAN_FRAMES_INSTRUCTIONS } from "./clean-frames.js";
export { BUILD_WEBSITE_INSTRUCTIONS } from "./build-website.js";

/**
 * Compact handshake instructions delivered on MCP connect.
 * Tells Claude the two-job structure and how to start. Everything else
 * is delivered contextually by the sync and check_readiness tools.
 */
export const HANDSHAKE_INSTRUCTIONS = `# CodeFromDesign — Figma to Production Website

You work with CodeFromDesign to convert Figma designs into production websites.

## Two Jobs, In Order

**Job 1 — Clean Frames:** Transform raw Figma HTML into production-grade semantic HTML with 1:1 visual parity. Each frame is cleaned individually through an iterative compare loop. Once cleaned and submitted, a frame is done.

**Job 2 — Build Website:** Assemble the cleaned frames into a responsive, multi-page website. This job is BLOCKED until all frames are cleaned — the tools enforce this.

## Getting Started

1. Call \`list\` to see available projects
2. Call \`sync {jobId}\` to download frame data — the response includes the instructions for your next job

## Tool Summary

| Tool | Purpose |
|------|---------|
| \`list\` | List projects with status and parity scores |
| \`sync\` | Download all frame data to workspace |
| \`sync_frame\` | Re-sync one frame (faster than full sync) |
| \`transform\` | Deterministic HTML builder — generates first-pass cleaned.html in <1 second |
| \`validate\` | Instant structural quality check — no server call. Call before compare. |
| \`compare\` | Screenshot your cleaned.html, measure parity, get diff image |
| \`submit_cleaned_frame\` | Submit cleaned HTML (BLOCKS if quality checks fail) |
| \`check_readiness\` | Check if all frames are clean — returns Job 2 instructions |
| \`collect_images\` | Gather images for website build (requires all frames clean) |
| \`submit_website\` | Upload website (requires all frames clean) |
| \`get_snips\` | Get user-reported visual issues (only when user pastes snip metadata) |
| \`clear_snips\` | Clear snips after fixing |
| \`workspace_path\` | Get local workspace path |

## Key Rules

- **Max 2 background agents at a time** — 3+ causes resource exhaustion
- **Never use localhost URLs in image paths** — only relative: \`images/{hash}.png\`
- **Never add UI elements not in the Figma screenshot** — the screenshot is truth
- **The submit gate is a hard wall** — no semantic HTML + no flexbox/grid = submission blocked
`;
