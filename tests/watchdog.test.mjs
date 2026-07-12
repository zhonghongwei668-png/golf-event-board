import assert from "node:assert/strict";
import test from "node:test";
import { getWorkflowHealth, isActiveWindow, runWatchdog } from "../ops/watchdog/src/index.mjs";

function response(payload, status = 200) {
  return new Response(payload === null ? "" : JSON.stringify(payload), { status });
}

test("watchdog leaves a recent successful workflow alone", async () => {
  const fetchImpl = async () => response({
    workflow_runs: [{
      status: "completed",
      conclusion: "success",
      updated_at: "2026-07-12T02:00:00.000Z"
    }]
  });
  const health = await getWorkflowHealth({}, fetchImpl, new Date("2026-07-12T02:20:00.000Z"));

  assert.equal(health.healthy, true);
  assert.equal(Math.round(health.ageMinutes), 20);
});

test("watchdog dispatches a replacement run when the last success is stale", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET" });
    if (url.includes("/runs?")) {
      return response({
        workflow_runs: [{
          status: "completed",
          conclusion: "success",
          updated_at: "2026-07-12T01:00:00.000Z"
        }]
      });
    }
    return response(null);
  };

  const result = await runWatchdog(
    { GITHUB_TOKEN: "test-token" },
    fetchImpl,
    new Date("2026-07-12T02:00:00.000Z")
  );

  assert.equal(result.action, "dispatched");
  assert.equal(requests.at(-1).method, "POST");
  assert.match(requests.at(-1).url, /actions\/workflows\/deploy\.yml\/dispatches$/);
});

test("watchdog does not duplicate an active replacement run", async () => {
  const fetchImpl = async () => response({
    workflow_runs: [
      { status: "in_progress", conclusion: null, updated_at: "2026-07-12T02:00:00.000Z" },
      { status: "completed", conclusion: "success", updated_at: "2026-07-12T01:00:00.000Z" }
    ]
  });
  const result = await runWatchdog({}, fetchImpl, new Date("2026-07-12T02:00:00.000Z"));

  assert.equal(result.action, "active");
});

test("watchdog only compensates during the Beijing active window", async () => {
  assert.equal(isActiveWindow(new Date("2026-07-11T23:59:00.000Z")), false);
  assert.equal(isActiveWindow(new Date("2026-07-12T00:00:00.000Z")), true);
  assert.equal(isActiveWindow(new Date("2026-07-12T14:59:00.000Z")), true);
  assert.equal(isActiveWindow(new Date("2026-07-12T15:00:00.000Z")), false);

  let requests = 0;
  const result = await runWatchdog(
    {},
    async () => {
      requests += 1;
      return response({ workflow_runs: [] });
    },
    new Date("2026-07-12T16:00:00.000Z")
  );

  assert.equal(result.action, "outside_window");
  assert.equal(requests, 0);
});
