# cfd

CLI + MCP server for [CodeFromDesign](https://codefromdesign.com) — sync Figma-to-code pipeline results with Claude Code.

## Install

```bash
npm install -g @codefromdesign/cfd
```

Requires Node.js 18 or later.

## Setup

1. Get your API key from [codefromdesign.com/settings](https://codefromdesign.com)
2. Run:

```bash
cfd init <your-api-key>
```

This saves your config and registers the MCP server with Claude Code.

## Usage

### CLI Commands

```bash
cfd list                  # list all projects
cfd sync <job-id>         # sync project data to local workspace
cfd build <job-id>        # trigger website build
cfd status                # show config and engine health
```

### With Claude Code

After `cfd init`, open Claude Code anywhere on your machine. It auto-connects to CodeFromDesign via MCP. Ask Claude to:

- "List my CodeFromDesign projects"
- "Sync project abc123 and start cleaning the frames"
- "Compare frame 0 and show me the parity score"

Claude Code will iteratively refine each frame's HTML until it matches the Figma design, then assemble a production website.

## How it works

```
codefromdesign.com → Go engine processes Figma design → Frame packages
                                                              ↓
cfd sync → downloads frames to ~/.codefromdesign/workspace/
                                                              ↓
Claude Code → reads screenshots, refines HTML, calls compare
                                                              ↓
cfd compare → engine screenshots HTML, diffs against Figma
                                                              ↓
repeat until parity > 95% → submit → build → production website
```

## Development

```bash
npm install               # install dependencies
npm run dev -- --help     # run CLI from source via tsx
npm run build             # bundle with esbuild
npm run build:check       # type-check without emitting
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CFD_API_KEY` | Override API key |
| `CFD_ENGINE_URL` | Override engine URL (default: https://engine.codefromdesign.com) |

## Files

| Path | Purpose |
|------|---------|
| `~/.codefromdesign/config.json` | Configuration |
| `~/.codefromdesign/workspace/` | Synced project data |
