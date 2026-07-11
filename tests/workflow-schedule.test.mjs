import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/deploy.yml", import.meta.url);

test("scheduled updates avoid GitHub Actions top-of-hour congestion", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /cron: "17 0-14 \* \* \*"/);
  assert.doesNotMatch(workflow, /cron: "0 0-14 \* \* \*"/);
});

test("push updates notify for event data already included in the commit", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /EVENT_BEFORE: \$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /git diff --quiet "\$EVENT_BEFORE" HEAD -- data\/events\.json/);
  assert.match(workflow, /outputs\.notify_changed == 'true'/);
  assert.match(workflow, /outputs\.working_changed == 'true'/);
});
