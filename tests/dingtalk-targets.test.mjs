import assert from "node:assert/strict";
import test from "node:test";
import { configuredDingTalkTargets } from "../scripts/notify-changes.mjs";

test("configures two independent DingTalk robots", () => {
  const targets = configuredDingTalkTargets({
    DINGTALK_WEBHOOK: "https://example.test/primary",
    DINGTALK_SECRET: "primary-secret",
    DINGTALK_WEBHOOK_2: "https://example.test/secondary",
    DINGTALK_SECRET_2: "secondary-secret",
  });

  assert.deepEqual(targets, [
    { label: "主机器人", webhook: "https://example.test/primary", secret: "primary-secret" },
    { label: "第二机器人", webhook: "https://example.test/secondary", secret: "secondary-secret" },
  ]);
});

test("does not send twice when both settings contain the same webhook", () => {
  const targets = configuredDingTalkTargets({
    DINGTALK_WEBHOOK: "https://example.test/shared",
    DINGTALK_WEBHOOK_2: "https://example.test/shared",
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].label, "主机器人");
});
