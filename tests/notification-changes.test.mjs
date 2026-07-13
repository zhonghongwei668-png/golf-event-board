import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChangeNotification,
  diffOfficialAnnouncements
} from "../scripts/notify-changes.mjs";

test("suppresses historical event backfill from change notifications", () => {
  const markdown = buildChangeNotification({ events: [], announcements: [] }, {
    generatedAt: "2026-07-13T00:00:00.000Z",
    announcements: [],
    events: [{
      id: "historical-event",
      category: "junior",
      name: "历史补录赛事",
      startDate: "2026-03-01",
      endDate: "2026-03-02"
    }]
  });
  assert.equal(markdown, "");
});

test("a newly added official source only alerts notices published today", () => {
  const current = { announcements: [
    { id: "old", source: "新官方源", publishedAt: "2026-07-12" },
    { id: "today", source: "新官方源", publishedAt: "2026-07-13" }
  ] };
  assert.deepEqual(
    diffOfficialAnnouncements({ announcements: [] }, current, { today: "2026-07-13" }).map((item) => item.id),
    ["today"]
  );
});

test("notifies material location and eligibility changes", () => {
  const before = {
    events: [{
      id: "future-event",
      category: "junior",
      name: "未来赛事",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      location: "上海",
      requirement: "A组"
    }],
    announcements: []
  };
  const after = {
    ...before,
    generatedAt: "2026-07-13T00:00:00.000Z",
    events: [{ ...before.events[0], location: "苏州", requirement: "A、B组" }]
  };
  const markdown = buildChangeNotification(before, after);
  assert.match(markdown, /比赛地点、参赛要求/);
});
