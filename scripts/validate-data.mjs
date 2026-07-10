import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvents } from "../event-logic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const payload = JSON.parse(await readFile(path.join(rootDir, "data", "events.json"), "utf8"));
const errors = validateEvents(payload.events || []);

if (errors.length) {
  console.error(`赛事数据校验失败:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${payload.events?.length || 0} events`);
}
