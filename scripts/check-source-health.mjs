import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const health = JSON.parse(await readFile(path.join(rootDir, "data", "source-health.json"), "utf8"));

if (health.overallStatus === "degraded") {
  const failed = Object.values(health.sources || {})
    .filter((source) => source.status === "degraded")
    .map((source) => `${source.label}: ${source.error}`);
  console.error(`信息源健康检查失败:\n- ${failed.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${Object.keys(health.sources || {}).length} source health checks`);
}
