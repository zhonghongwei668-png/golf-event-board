import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [app, appLinks] = await Promise.all([
  readFile(path.join(rootDir, "app.js"), "utf8"),
  readFile(path.join(rootDir, "data", "app-links.json"), "utf8").then(JSON.parse),
]);

test("events without a verified signup URL expose an official follow-up path", () => {
  assert.match(app, /label: "入口待发布"/);
  assert.match(app, /event\.signupUrl \? "报名入口" : "查看官方公告"/);
  assert.match(app, /尚未发现可验证的公开报名入口/);
});

test("HSBC events include official web and WeChat follow-up channels", () => {
  const hsbc = appLinks.apps.find((item) => item.id === "wechat-hsbc-junior");
  assert.ok(hsbc);
  assert.ok(hsbc.match.includes("汇丰"));
  assert.match(hsbc.webUrl, /^https:\/\/www\.business\.hsbc\.com\.cn\//);
  assert.equal(hsbc.openUrl, "weixin://");
});
