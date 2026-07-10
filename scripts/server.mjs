import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const nodeBin = process.execPath;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const staleMs = 23 * 60 * 60 * 1000;

const publicPaths = new Set([
  "/index.html",
  "/app.js",
  "/event-logic.js",
  "/styles.css",
  "/manifest.webmanifest",
  "/icon.svg",
  "/data/events.json",
  "/data/sources.json",
  "/data/app-links.json"
]);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

let updating = null;

async function isDataStale() {
  try {
    const info = await stat(path.join(rootDir, "data", "events.json"));
    return Date.now() - info.mtimeMs > staleMs;
  } catch {
    return true;
  }
}

function runUpdate() {
  if (updating) return updating;
  updating = new Promise((resolve) => {
    const child = spawn(nodeBin, [path.join(rootDir, "scripts", "update-data.mjs")], {
      cwd: rootDir,
      stdio: "pipe"
    });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    child.on("close", (code) => {
      updating = null;
      resolve({ ok: code === 0, code, output });
    });
  });
  return updating;
}

async function sendJson(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (!publicPaths.has(pathname)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const filePath = path.join(rootDir, pathname.slice(1));
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mime[path.extname(filePath)] || "application/octet-stream",
      "cache-control": pathname.includes("/data/") ? "no-store" : "public, max-age=300"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  if (req.url === "/api/events") {
    if (await isDataStale()) await runUpdate();
    try {
      const data = JSON.parse(await readFile(path.join(rootDir, "data", "events.json"), "utf8"));
      await sendJson(res, data);
    } catch (error) {
      await sendJson(res, { error: error.message }, 500);
    }
    return;
  }

  if (req.url === "/api/update" && req.method === "POST") {
    const result = await runUpdate();
    await sendJson(res, result, result.ok ? 200 : 500);
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, host, async () => {
  console.log(`Golf event board: http://${host}:${port}`);
  if (await isDataStale()) await runUpdate();
});

setInterval(runUpdate, 24 * 60 * 60 * 1000).unref();
