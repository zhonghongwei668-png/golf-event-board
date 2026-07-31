import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyNotificationState,
  ensureNotificationMessage,
  hasSeenOpenEvent,
  markOpenEventSeen,
  markNotificationDelivery,
  pendingNotificationMessages,
  pruneNotificationState
} from "../scripts/lib/notification-state.mjs";

test("tracks each DingTalk target independently and only leaves failures pending", () => {
  const state = emptyNotificationState();
  const { fingerprint } = ensureNotificationMessage(state, {
    kind: "event-change",
    title: "赛事更新",
    markdown: "new event",
    targetIds: ["dingtalk-primary", "dingtalk-secondary"],
    now: "2026-07-13T00:00:00.000Z"
  });
  markNotificationDelivery(state, fingerprint, "dingtalk-primary", { ok: true }, "2026-07-13T00:00:01.000Z");
  markNotificationDelivery(state, fingerprint, "dingtalk-secondary", { ok: false, error: "timeout" }, "2026-07-13T00:00:02.000Z");

  assert.deepEqual(pendingNotificationMessages(state).map((message) => message.fingerprint), [fingerprint]);
  assert.equal(state.messages[fingerprint].targets["dingtalk-primary"].status, "sent");
  assert.equal(state.messages[fingerprint].targets["dingtalk-secondary"].status, "failed");

  markNotificationDelivery(state, fingerprint, "dingtalk-secondary", { ok: true }, "2026-07-13T00:01:00.000Z");
  assert.deepEqual(pendingNotificationMessages(state), []);
});

test("pruning keeps pending deliveries while limiting completed history", () => {
  const state = emptyNotificationState();
  for (let index = 0; index < 3; index += 1) {
    const { fingerprint } = ensureNotificationMessage(state, {
      kind: "test",
      title: "test",
      markdown: `message-${index}`,
      targetIds: ["dingtalk-primary"],
      now: `2026-07-13T00:00:0${index}.000Z`
    });
    if (index < 2) markNotificationDelivery(state, fingerprint, "dingtalk-primary", { ok: true });
  }
  pruneNotificationState(state, 1);
  assert.equal(Object.keys(state.messages).length, 2);
  assert.equal(pendingNotificationMessages(state).length, 1);
});

test("keeps a permanent history of events that have already opened", () => {
  const state = emptyNotificationState();
  assert.equal(hasSeenOpenEvent(state, ["id:event-1"]), false);
  assert.equal(markOpenEventSeen(state, ["id:event-1", "external:dazheng:5050"], "2026-07-01T00:00:00.000Z"), true);
  assert.equal(hasSeenOpenEvent(state, ["external:dazheng:5050"]), true);
  assert.equal(markOpenEventSeen(state, ["id:event-1"], "2026-07-31T00:00:00.000Z"), false);
  pruneNotificationState(state, 0);
  assert.equal(hasSeenOpenEvent(state, ["id:event-1"]), true);
});
