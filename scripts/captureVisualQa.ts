import { chromium, type Browser, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const port = 5174;
const baseUrl = `http://127.0.0.1:${port}`;
const outputDir = path.resolve("qa/visual");
const manifestJsonPath = path.join(outputDir, "manifest.json");
const manifestMarkdownPath = path.join(outputDir, "manifest.md");

type VisualQaCapture = {
  file: string;
  route: string;
  url: string;
  viewport: {
    width: number;
    height: number;
  };
  fullPage: boolean;
  bytes: number;
};

type VisualQaManifest = {
  generatedAt: string;
  baseUrl: string;
  repo: {
    commit: string | null;
    branch: string | null;
  };
  captures: VisualQaCapture[];
};

async function main() {
  await mkdir(outputDir, { recursive: true });

  const server = startDevServer();
  let browser: Browser | null = null;

  try {
    await waitForServer();

    browser = await chromium.launch();
    const captures = [
      await capturePage(browser, "/", "desktop-dashboard.png", { width: 1440, height: 900 }),
      await capturePage(browser, "/", "mobile-dashboard.png", { width: 390, height: 844 }, true),
      await capturePage(
        browser,
        "/?obs=1&sources=twitch,kick,x&limit=14",
        "obs-overlay.png",
        { width: 1280, height: 720 }
      )
    ];
    const manifest = buildVisualQaManifest(captures);

    await writeFile(manifestJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(manifestMarkdownPath, formatVisualQaManifestMarkdown(manifest), "utf8");

    console.log(`Visual QA screenshots written to ${outputDir}`);
    console.log(`Visual QA manifest: ${manifestMarkdownPath}`);
  } finally {
    await browser?.close();
    stopDevServer(server);
  }
}

function startDevServer() {
  const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    env: process.env
  });

  server.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  return server;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);

      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
    }
  }

  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function capturePage(
  browser: Browser,
  route: string,
  fileName: string,
  viewport: { width: number; height: number },
  fullPage = false
): Promise<VisualQaCapture> {
  const page = await browser.newPage({ viewport });
  const screenshotPath = path.join(outputDir, fileName);

  await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
  await assertRendered(page);
  await page.screenshot({ path: screenshotPath, fullPage });
  await page.close();

  const fileStats = await stat(screenshotPath);

  return {
    file: path.relative(process.cwd(), screenshotPath),
    route,
    url: `${baseUrl}${route}`,
    viewport,
    fullPage,
    bytes: fileStats.size
  };
}

async function assertRendered(page: Page) {
  await page.getByRole("heading", { name: "Unified chat aggregator" }).waitFor({ state: "visible" });
  await page.getByRole("log").waitFor({ state: "visible" });
}

function stopDevServer(server: ChildProcessWithoutNullStreams) {
  if (!server.killed) {
    server.kill("SIGTERM");
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function buildVisualQaManifest(captures: VisualQaCapture[]): VisualQaManifest {
  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    repo: {
      commit: runGit(["rev-parse", "--short", "HEAD"]),
      branch: runGit(["branch", "--show-current"])
    },
    captures
  };
}

export function formatVisualQaManifestMarkdown(manifest: VisualQaManifest) {
  const lines = [
    "# Visual QA Manifest",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Base URL: ${manifest.baseUrl}`,
    `Commit: ${manifest.repo.commit ?? "unknown"}`,
    `Branch: ${manifest.repo.branch ?? "unknown"}`,
    "",
    "| Capture | Route | Viewport | Full page | Size |",
    "| --- | --- | --- | --- | --- |",
    ...manifest.captures.map(
      (capture) =>
        `| \`${capture.file}\` | \`${capture.route}\` | ${capture.viewport.width}x${capture.viewport.height} | ${
          capture.fullPage ? "yes" : "no"
        } | ${formatBytes(capture.bytes)} |`
    ),
    ""
  ];

  return lines.join("\n");
}

function runGit(args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
