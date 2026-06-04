import { evaluateLivePreflight, formatLivePreflightReport } from "./livePreflight";

const allowPartial = process.argv.includes("--allow-partial");
const report = evaluateLivePreflight(process.env, {
  requireAllPlatforms: !allowPartial
});

console.log(formatLivePreflightReport(report));

if (!report.ok) {
  process.exitCode = 1;
}
