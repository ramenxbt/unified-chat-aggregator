import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export type LoadLocalEnvOptions = {
  envPath?: string;
  cwd?: string;
  target?: NodeJS.ProcessEnv;
};

export function loadLocalEnv(options: LoadLocalEnvOptions = {}) {
  const envPath = options.envPath ?? path.join(options.cwd ?? process.cwd(), ".env");
  const target = options.target ?? process.env;
  let loaded = 0;

  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { loaded, path: envPath };
    }

    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || target[parsed.key] !== undefined) continue;

    target[parsed.key] = parsed.value;
    loaded += 1;
  }

  return { loaded, path: envPath };
}

function parseEnvLine(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine || trimmedLine.startsWith("#")) return null;

  const assignment = trimmedLine.startsWith("export ") ? trimmedLine.slice("export ".length).trim() : trimmedLine;
  const separatorIndex = assignment.indexOf("=");
  if (separatorIndex <= 0) return null;

  const key = assignment.slice(0, separatorIndex).trim();
  const rawValue = assignment.slice(separatorIndex + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  return {
    key,
    value: parseEnvValue(rawValue)
  };
}

function parseEnvValue(value: string) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return stripInlineComment(value).trim();
}

function stripInlineComment(value: string) {
  const commentIndex = value.search(/\s#/);

  return commentIndex === -1 ? value : value.slice(0, commentIndex);
}
