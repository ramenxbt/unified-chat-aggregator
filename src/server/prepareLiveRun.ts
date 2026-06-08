import { buildLiveRunPlan, formatLiveRunPlan } from "./liveRunPlan";
import { parseLiveRunCliArgs } from "./liveCliArgs";
import { loadLocalEnv } from "./loadLocalEnv";

loadLocalEnv();

const plan = buildLiveRunPlan(process.env, parseLiveRunCliArgs(process.argv.slice(2)));

console.log(formatLiveRunPlan(plan));

if (!plan.ok) {
  process.exitCode = 1;
}
