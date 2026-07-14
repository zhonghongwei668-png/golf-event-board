import assert from "node:assert/strict";
import test from "node:test";
import { mergeAnnouncementHistory } from "../scripts/lib/announcement-history.mjs";

test("retains a recently seen announcement when a source page temporarily omits it", () => {
  const previous = [{
    id: "dazheng-announcement-45003",
    publishedAt: "2026-07-09 09:11",
    title: "明日12:00开启"
  }];
  assert.deepEqual(
    mergeAnnouncementHistory([], previous, { today: "2026-07-14", retentionDays: 45 }),
    previous
  );
});

test("incoming announcement data wins while expired history is discarded", () => {
  const incoming = [{ id: "same", publishedAt: "2026-07-14", title: "新标题" }];
  const previous = [
    { id: "same", publishedAt: "2026-07-13", title: "旧标题" },
    { id: "expired", publishedAt: "2026-05-01", title: "过期历史" }
  ];
  assert.deepEqual(
    mergeAnnouncementHistory(incoming, previous, { today: "2026-07-14", retentionDays: 45 }),
    incoming
  );
});
