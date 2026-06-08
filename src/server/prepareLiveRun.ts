import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildLiveRunPlan, formatLiveRunPlan } from "./liveRunPlan";
import { parseLivePrepareCliArgs } from "./liveCliArgs";
import { loadLocalEnv } from "./loadLocalEnv";
import type { LivePreflightEnv } from "./livePreflight";

export async function prepareLiveRun(env: LivePreflightEnv, args: string[] = []) {
  const options = parseLivePrepareCliArgs(args);
  const plan = buildLiveRunPlan(env, options);
  const output = formatLiveRunSheet(formatLiveRunPlan(plan), collectLiveRunMetadata());

  if (options.outPath) {
    await writeLiveRunPlan(options.outPath, output);
  }

  return {
    plan,
    output,
    outPath: options.outPath
  };
}

type LiveRunMetadata = {
  generatedAt: string;
  commit: string | null;
  branch: string | null;
  remote: string | null;
};

function formatLiveRunSheet(planOutput: string, metadata: LiveRunMetadata) {
  return [
    "Live run sheet:",
    `generated at: ${metadata.generatedAt}`,
    `commit: ${metadata.commit ?? "unknown"}`,
    `branch: ${metadata.branch ?? "unknown"}`,
    `remote: ${metadata.remote ?? "unknown"}`,
    "",
    planOutput
  ].join("\n");
}

function collectLiveRunMetadata(): LiveRunMetadata {
  return {
    generatedAt: new Date().toISOString(),
    commit: runGit(["rev-parse", "--short", "HEAD"]),
    branch: runGit(["branch", "--show-current"]),
    remote: runGit(["remote", "get-url", "origin"])
  };
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

async function writeLiveRunPlan(outPath: string, output: string) {
  const resolvedPath = path.resolve(outPath);

  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${output}\n`, "utf8");
}

async function runCli() {
  loadLocalEnv();

  const result = await prepareLiveRun(process.env, process.argv.slice(2));

  console.log(result.output);

  if (result.outPath) {
    console.log(`\nWrote live run plan: ${result.outPath}`);
  }

  if (!result.plan.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
