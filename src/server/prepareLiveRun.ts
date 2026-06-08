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
  const output = formatLiveRunPlan(plan);

  if (options.outPath) {
    await writeLiveRunPlan(options.outPath, output);
  }

  return {
    plan,
    output,
    outPath: options.outPath
  };
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
