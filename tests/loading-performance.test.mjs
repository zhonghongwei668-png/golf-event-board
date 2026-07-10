import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app] = await Promise.all([
  readFile(path.join(rootDir, "index.html"), "utf8"),
  readFile(path.join(rootDir, "app.js"), "utf8")
]);

test("starts the event download before the application module", () => {
  const preloadIndex = html.indexOf('rel="preload" href="./data/events.json"');
  const appIndex = html.indexOf('<script src="./app.js');

  assert.notEqual(preloadIndex, -1);
  assert.notEqual(appIndex, -1);
  assert.ok(preloadIndex < appIndex);
});

test("renders primary events before optional support data finishes", () => {
  const parallelStart = app.indexOf("Promise.all([fetchSources(), fetchAppLinks()])");
  const primaryRender = app.indexOf("renderPrimaryData(payload);");
  const supportAwait = app.indexOf("[state.sources, state.appLinks] = await supportData;");

  assert.notEqual(parallelStart, -1);
  assert.ok(parallelStart < primaryRender);
  assert.ok(primaryRender < supportAwait);
});

test("keeps a successful event payload for an immediate repeat visit", () => {
  assert.match(app, /localStorage\.getItem\(EVENT_CACHE_KEY\)/);
  assert.match(app, /localStorage\.setItem\(EVENT_CACHE_KEY/);
  assert.match(app, /if \(cached\) renderPrimaryData\(cached, "cache"\)/);
});

test("Sites deployment reads automatically updated GitHub Pages data", () => {
  assert.match(app, /zhonghongwei668-png\.github\.io\/golf-event-board\/data/);
  assert.match(app, /window\.location\.hostname\.endsWith\("\.chatgpt\.site"\)/);
  assert.match(app, /fetch\(dataUrl\("events\.json"\), \{ cache: "no-store"/);
});
