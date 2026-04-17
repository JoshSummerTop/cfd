import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CFD_DIR = join(homedir(), ".codefromdesign");
const CONFIG_PATH = join(CFD_DIR, "config.json");

export const DEFAULT_ENGINE_URL = "https://beta.codefromdesign.com/api/engine";

export interface CfdConfig {
  engineUrl: string;
  apiKey: string;
}

export async function loadConfig(): Promise<CfdConfig> {
  const defaults: CfdConfig = {
    engineUrl: process.env.CFD_ENGINE_URL || DEFAULT_ENGINE_URL,
    apiKey: process.env.CFD_API_KEY || "",
  };

  if (!existsSync(CONFIG_PATH)) return defaults;

  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw);
    return {
      engineUrl: process.env.CFD_ENGINE_URL || saved.engineUrl || defaults.engineUrl,
      apiKey: process.env.CFD_API_KEY || saved.apiKey || defaults.apiKey,
    };
  } catch {
    return defaults;
  }
}

export async function saveConfig(config: Partial<CfdConfig>): Promise<void> {
  await mkdir(CFD_DIR, { recursive: true });

  let existing: Partial<CfdConfig> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
    } catch {
      // ignore
    }
  }

  const merged = { ...existing, ...config };
  await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n");
}

export function getCfdDir(): string {
  return CFD_DIR;
}
