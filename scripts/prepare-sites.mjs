import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "public", "site");

await rm(target, { recursive: true, force: true });
await mkdir(path.join(target, "data"), { recursive: true });

for (const file of ["index.html", "app.js", "event-logic.js", "styles.css", "manifest.webmanifest", "icon.svg"]) {
  await cp(path.join(root, file), path.join(target, file));
}
for (const file of ["events.json", "sources.json", "app-links.json"]) {
  await cp(path.join(root, "data", file), path.join(target, "data", file));
}
