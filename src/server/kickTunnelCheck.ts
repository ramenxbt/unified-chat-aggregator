import process from "node:process";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./loadLocalEnv";
import type { LivePreflightEnv } from "./livePreflight";

export type KickTunnelCheck = {
  ok: boolean;
  url: string | null;
  detail: string;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type FetchLike = (url: string, init: { method: "GET"; signal: AbortSignal }) => Promise<FetchResponse>;

type KickTunnelCheckMetadata = {
  checkedAt?: string;
  commit?: string | null;
};

export async function checkKickTunnel(
  env: LivePreflightEnv,
  options: { fetch?: FetchLike; timeoutMs?: number } = {}
): Promise<KickTunnelCheck> {
  const publicUrl = env.KICK_WEBHOOK_PUBLIC_URL;
  const expectedPath = normalizePath(env.KICK_WEBHOOK_PATH ?? "/webhooks/kick");

  if (!publicUrl) {
    return {
      ok: false,
      url: null,
      detail: "KICK_WEBHOOK_PUBLIC_URL is not configured."
    };
  }

  const urlIssue = validatePublicUrl(publicUrl, expectedPath);
  if (urlIssue) {
    return {
      ok: false,
      url: publicUrl,
      detail: urlIssue
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await (options.fetch ?? fetch)(publicUrl, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        url: publicUrl,
        detail: `Tunnel returned HTTP ${response.status}. Start the feed server and verify the tunnel target.`
      };
    }

    const body = parseHealthBody(await response.text());

    if (body?.ok !== true || body.platform !== "kick" || body.receiver !== "ready" || normalizePath(body.path) !== expectedPath) {
      return {
        ok: false,
        url: publicUrl,
        detail: "Tunnel response did not match the Kick receiver health payload."
      };
    }

    return {
      ok: true,
      url: publicUrl,
      detail: `Kick tunnel reaches the local receiver at ${expectedPath}.`
    };
  } catch (error: unknown) {
    return {
      ok: false,
      url: publicUrl,
      detail: `Tunnel request failed: ${error instanceof Error ? error.message : String(error)}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function formatKickTunnelCheck(check: KickTunnelCheck, metadata: KickTunnelCheckMetadata = {}) {
  return [
    `Kick tunnel: ${check.ok ? "ready" : "needs setup"}`,
    `URL: ${check.url ?? "not configured"}`,
    ...(metadata.commit !== undefined ? [`Repo commit: ${metadata.commit ?? "unknown"}`] : []),
    ...(metadata.checkedAt ? [`Checked at: ${metadata.checkedAt}`] : []),
    check.detail
  ].join("\n");
}

export async function writeKickTunnelCheckProof(filePath: string, content: string) {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(filePath, `${content}\n`, "utf8");
}

function validatePublicUrl(publicUrl: string, expectedPath: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(publicUrl);
  } catch {
    return "KICK_WEBHOOK_PUBLIC_URL is not a valid URL.";
  }

  if (parsedUrl.protocol !== "https:") {
    return "KICK_WEBHOOK_PUBLIC_URL must use HTTPS.";
  }

  if (["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
    return "KICK_WEBHOOK_PUBLIC_URL must use a public tunnel host, not localhost.";
  }

  if (normalizePath(parsedUrl.pathname) !== expectedPath) {
    return `KICK_WEBHOOK_PUBLIC_URL must end in ${expectedPath}.`;
  }

  return null;
}

function parseHealthBody(content: string) {
  try {
    return JSON.parse(content) as {
      ok?: boolean;
      platform?: string;
      receiver?: string;
      path?: string;
    };
  } catch {
    return null;
  }
}

function normalizePath(value: string | undefined) {
  const normalized = value?.startsWith("/") ? value : `/${value ?? ""}`;

  return normalized.replace(/\/+$/, "");
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  loadLocalEnv();

  const check = await checkKickTunnel(process.env, { timeoutMs: args.timeoutMs });
  const output = formatKickTunnelCheck(check, {
    commit: currentCommit(),
    checkedAt: new Date().toISOString()
  });

  console.log(output);

  if (args.outputPath) {
    await writeKickTunnelCheckProof(args.outputPath, output);
  }

  if (!check.ok) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]) {
  const parsed: {
    outputPath?: string;
    timeoutMs?: number;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--out" || arg === "--output") {
      parsed.outputPath = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      const timeoutMs = Number(args[index + 1]);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        parsed.timeoutMs = timeoutMs;
      }
      index += 1;
      continue;
    }
  }

  return parsed;
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
