import test from "node:test";
import assert from "node:assert/strict";
import {
  degradedSourceState,
  detectCountAnomaly,
  healthySourceState,
  shouldAlertFailure,
  summarizeSourceHealth
} from "../scripts/lib/source-health.mjs";
import { buildSourceHealthNotification } from "../scripts/notify-changes.mjs";

test("detects a material source count drop but allows small changes", () => {
  assert.match(detectCountAnomaly(100, 40), /100.*40/);
  assert.equal(detectCountAnomaly(100, 90), null);
  assert.equal(detectCountAnomaly(8, 1), null);
});

test("tracks source recovery and consecutive failures", () => {
  const firstFailure = degradedSourceState({ lastSuccessAt: "2026-07-13T00:00:00.000Z" }, {
    label: "中高协青少年",
    checkedAt: "2026-07-13T01:00:00.000Z",
    error: "502"
  });
  const secondFailure = degradedSourceState(firstFailure, {
    label: "中高协青少年",
    checkedAt: "2026-07-13T02:00:00.000Z",
    error: "502"
  });
  const recovered = healthySourceState(secondFailure, {
    label: "中高协青少年",
    checkedAt: "2026-07-13T03:00:00.000Z",
    itemCount: 120,
    durationMs: 500
  });

  assert.equal(secondFailure.consecutiveFailures, 2);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(summarizeSourceHealth({ source: secondFailure }).overallStatus, "degraded");
});

test("rate limits repeated source failure alerts", () => {
  assert.equal(shouldAlertFailure(1), true);
  assert.equal(shouldAlertFailure(2), false);
  assert.equal(shouldAlertFailure(3), true);
  assert.equal(shouldAlertFailure(12), true);
});

test("formats source degradation and recovery notifications", () => {
  const markdown = buildSourceHealthNotification({
    checkedAt: "2026-07-13T05:00:00.000Z",
    sources: {
      failed: { label: "中高协青少年", status: "degraded", consecutiveFailures: 1, error: "502" },
      recovered: { label: "大正高尔夫", status: "healthy", recovered: true, itemCount: 80 }
    }
  });
  assert.match(markdown, /【报警】1 个信息源更新异常/);
  assert.match(markdown, /中高协青少年.*502/);
  assert.match(markdown, /【恢复】1 个信息源已恢复/);
});
