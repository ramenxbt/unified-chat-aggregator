import { spawnSync } from "node:child_process";
import process from "node:process";

type QaStep = {
  name: string;
  args: string[];
};

const finalQaSteps: QaStep[] = [
  { name: "Repository hygiene", args: ["run", "qa:repo"] },
  { name: "Unit and integration tests", args: ["test"] },
  { name: "Lint", args: ["run", "lint"] },
  { name: "Production build", args: ["run", "build"] },
  { name: "Browser workflows", args: ["run", "test:e2e"] },
  { name: "Connector rehearsal", args: ["run", "qa:connectors"] },
  { name: "Live stack rehearsal", args: ["run", "qa:rehearsal"] },
  { name: "Stress rehearsal", args: ["run", "qa:stress"] },
  { name: "Visual QA", args: ["run", "qa:visual"] }
];

for (const [index, step] of finalQaSteps.entries()) {
  console.log(`\n[${index + 1}/${finalQaSteps.length}] ${step.name}`);

  const result = spawnSync("npm", step.args, {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    console.error(`Final QA failed during ${step.name}: ${result.error.message}`);
    process.exitCode = 1;
    break;
  }

  if (result.status !== 0) {
    console.error(`Final QA failed during ${step.name}.`);
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) {
  console.log("\nFinal QA passed");
}
