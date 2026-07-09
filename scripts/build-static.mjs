import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(path.join(distDir, "data"), { recursive: true });

for (const file of ["index.html", "app.js", "styles.css", "manifest.webmanifest", "icon.svg"]) {
  await cp(path.join(rootDir, file), path.join(distDir, file));
}

await cp(path.join(rootDir, "data", "events.json"), path.join(distDir, "data", "events.json"));
await writeFile(path.join(distDir, ".nojekyll"), "", "utf8");
console.log(`Built static site -> ${path.relative(rootDir, distDir)}`);
