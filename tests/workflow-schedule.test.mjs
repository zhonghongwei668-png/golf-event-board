import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/deploy.yml", import.meta.url);

test("scheduled updates avoid GitHub Actions top-of-hour congestion", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /cron: "17,47 0-14 \* \* \*"/);
  assert.doesNotMatch(workflow, /cron: "0 0-14 \* \* \*"/);
  assert.match(workflow, /timeout-minutes: 12/);
  assert.match(workflow, /node-version: 22/);
});

test("push updates notify for event data already included in the commit", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /EVENT_BEFORE: \$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /git diff --quiet "\$EVENT_BEFORE" HEAD -- data\/events\.json/);
  assert.match(workflow, /outputs\.notify_changed == 'true'/);
  assert.match(workflow, /steps\.persist_changes\.outputs\.changed == 'true'/);
});

test("source health is notified, persisted, and enforced", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /npm run notify -- --source-health/);
  assert.match(workflow, /git add data\/events\.json data\/source-health\.json data\/notification-state\.json/);
  assert.match(workflow, /name: Enforce source health\n\s+run: npm run health:check/);
});

test("failed DingTalk targets are persisted and retried before the next update", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /npm run notify -- --retry-pending/);
  assert.match(workflow, /data\/notification-state\.json/);
  assert.match(workflow, /name: Enforce DingTalk delivery\n\s+run: npm run notify:check/);
});
