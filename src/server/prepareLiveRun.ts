import { buildLiveRunPlan, formatLiveRunPlan } from "./liveRunPlan";
import { loadLocalEnv } from "./loadLocalEnv";

loadLocalEnv();

const allowPartial = process.argv.includes("--allow-partial");
const plan = buildLiveRunPlan(process.env, {
  allowPartial
});

console.log(formatLiveRunPlan(plan));

if (!plan.ok) {
  process.exitCode = 1;
}
