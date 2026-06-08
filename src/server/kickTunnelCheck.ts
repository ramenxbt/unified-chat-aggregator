import process from "node:process";
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

export function formatKickTunnelCheck(check: KickTunnelCheck) {
  return [`Kick tunnel: ${check.ok ? "ready" : "needs setup"}`, `URL: ${check.url ?? "not configured"}`, check.detail].join("\n");
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
  loadLocalEnv();

  const check = await checkKickTunnel(process.env);

  console.log(formatKickTunnelCheck(check));

  if (!check.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
