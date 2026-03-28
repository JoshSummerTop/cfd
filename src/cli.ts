#!/usr/bin/env node

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig, saveConfig, DEFAULT_ENGINE_URL } from "./config.js";
import { engineFetch } from "./engine.js";
import { syncJob } from "./sync.js";
import { buildWebsite } from "./submit.js";
import { startMcpServer } from "./serve.js";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case "init":
      return cmdInit();
    case "list":
      return cmdList();
    case "sync":
      return cmdSync(args[1]);
    case "build":
      return cmdBuild(args[1]);
    case "serve":
      return startMcpServer();
    case "status":
      return cmdStatus();
    case "--help":
    case "-h":
    case undefined:
      return cmdHelp();
    default:
      console.error(`Unknown command: ${command}`);
      console.error(`Run "cfd --help" for usage.`);
      process.exit(1);
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

async function cmdInit() {
  console.log("cfd init — configure CodeFromDesign CLI\n");

  // Get API key from arg or prompt
  const apiKey = args[1] || process.env.CFD_API_KEY || "";
  const engineUrl = args.includes("--local")
    ? "http://localhost:8082"
    : DEFAULT_ENGINE_URL;

  if (!apiKey) {
    console.log("Usage: cfd init <api-key>");
    console.log("       cfd init <api-key> --local    (use localhost engine)");
    console.log("");
    console.log("Get your API key from codefromdesign.com/settings");
    process.exit(1);
  }

  // Save config
  await saveConfig({ apiKey, engineUrl });
  console.log(`Config saved to ~/.codefromdesign/config.json`);
  console.log(`  engine: ${engineUrl}`);
  console.log(`  api key: ${apiKey.slice(0, 8)}...`);

  // Set up MCP config for Claude Code
  await setupMcpConfig();

  console.log("\nDone. Claude Code will auto-connect to CodeFromDesign.");
  console.log("Open Claude Code and ask it to list your projects.");
}

async function setupMcpConfig() {
  // Write to the user's global Claude Code MCP settings
  const claudeDir = join(homedir(), ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  await mkdir(claudeDir, { recursive: true });

  let settings: any = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  if (!settings.mcpServers) settings.mcpServers = {};

  settings.mcpServers["cfd"] = {
    command: "cfd",
    args: ["serve"],
  };

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log(`MCP server registered in ${settingsPath}`);
}

// ── list ─────────────────────────────────────────────────────────────────────

async function cmdList() {
  const config = await loadConfig();
  requireApiKey(config.apiKey);

  const res = await engineFetch(config, "/api/jobs");
  if (!res.ok) {
    console.error(`Failed to fetch jobs: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const jobs = await res.json();
  if (!jobs.length) {
    console.log("No projects found.");
    return;
  }

  console.log(`${jobs.length} project(s):\n`);
  for (const job of jobs) {
    const frameCount = job.frames?.length ?? 0;
    const parity = frameCount
      ? (job.frames.reduce((sum: number, f: any) => sum + (f.parityScore ?? 0), 0) / frameCount).toFixed(1) + "%"
      : "n/a";
    console.log(`  ${job.id}  ${job.status.padEnd(10)}  ${frameCount} frames  ${parity} parity  ${job.figmaUrl || ""}`);
  }
}

// ── sync ─────────────────────────────────────────────────────────────────────

async function cmdSync(jobId?: string) {
  if (!jobId) {
    console.error("Usage: cfd sync <job-id>");
    process.exit(1);
  }

  const config = await loadConfig();
  requireApiKey(config.apiKey);

  console.log(`Syncing job ${jobId}...`);
  const result = await syncJob(config, jobId);

  console.log(`\nSynced ${result.frameCount} frames to ${result.workspacePath}`);
  for (const f of result.frames) {
    console.log(`  frame ${f.index}: ${f.name} (${f.width}x${f.height}, ${f.parity})`);
  }
}

// ── build ────────────────────────────────────────────────────────────────────

async function cmdBuild(jobId?: string) {
  if (!jobId) {
    console.error("Usage: cfd build <job-id>");
    process.exit(1);
  }

  const config = await loadConfig();
  requireApiKey(config.apiKey);

  console.log(`Triggering website build for job ${jobId}...`);
  const result = await buildWebsite(config, jobId);
  console.log(result);
}

// ── status ───────────────────────────────────────────────────────────────────

async function cmdStatus() {
  const config = await loadConfig();

  console.log("cfd status\n");
  console.log(`  engine:  ${config.engineUrl}`);
  console.log(`  api key: ${config.apiKey ? config.apiKey.slice(0, 8) + "..." : "(not set)"}`);

  // Health check
  try {
    const res = await engineFetch(config, "/health");
    if (res.ok) {
      const data = await res.json();
      console.log(`  health:  online (${data.uptime || "ok"})`);
    } else {
      console.log(`  health:  error (${res.status})`);
    }
  } catch {
    console.log(`  health:  offline`);
  }
}

// ── help ─────────────────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`cfd — CodeFromDesign CLI

usage:
  cfd init <api-key>        configure cfd and set up Claude Code MCP
  cfd init <api-key> --local  use localhost engine (development)
  cfd list                  list all projects
  cfd sync <job-id>         sync project data to local workspace
  cfd build <job-id>        trigger website build from cleaned frames
  cfd status                show config and engine health
  cfd serve                 start MCP server (used by Claude Code)

environment:
  CFD_API_KEY               override API key
  CFD_ENGINE_URL            override engine URL

files:
  ~/.codefromdesign/config.json     configuration
  ~/.codefromdesign/workspace/      synced project data
`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

function requireApiKey(apiKey: string) {
  if (!apiKey) {
    console.error("Not configured. Run: cfd init <api-key>");
    console.error("Get your API key from codefromdesign.com/settings");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`cfd error: ${err.message}`);
  process.exit(1);
});
