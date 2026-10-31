import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const specsDir = ".kiro/specs";
const problems = [];

for (const spec of existsSync(specsDir) ? readdirSync(specsDir) : []) {
  const tasksPath = join(specsDir, spec, "tasks.md");
  if (!existsSync(tasksPath)) continue;
  for (const line of readFileSync(tasksPath, "utf8").split("\n")) {
    const done = line.match(/^\s*- \[x\]\*? (\d+(?:\.\d+)?)\.? (.*)$/);
    if (!done) continue;
    for (const [, path] of done[2].matchAll(/`((?:skeleton|apps|site|\.github)\/[^`\s]+)`/g)) {
      if (!existsSync(path)) problems.push(`${spec} task ${done[1]} is ticked but ${path} does not exist`);
    }
  }
}

const tests = spawnSync("npm", ["test", "--workspaces", "--if-present", "--silent"], { encoding: "utf8", timeout: 600_000 });
if (tests.status !== 0) {
  const tail = `${tests.stdout ?? ""}${tests.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
  problems.push(`npm test failed after this task:\n${tail}`);
}

if (problems.length) {
  const message = `Task verification failed. Untick the task or finish it:\n- ${problems.join("\n- ")}`;
  console.log(message);
  console.error(message);
  process.exit(2);
}
console.log("Task verification passed: every ticked task has its files and npm test is green.");
