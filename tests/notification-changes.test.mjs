import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChangeNotification,
  diffOfficialAnnouncements,
  isAnnouncementFresh
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

test("never re-alerts an expired deadline notice that disappears and returns", () => {
  const previous = { announcements: [{
    id: "another-notice",
    source: "大正高尔夫官方公告",
    publishedAt: "2026-07-14 09:00",
    kind: "open"
  }] };
  const current = { announcements: [{
    id: "dazheng-announcement-44946",
    source: "大正高尔夫官方公告",
    publishedAt: "2026-06-11 17:36",
    kind: "deadline"
  }] };
  assert.deepEqual(diffOfficialAnnouncements(previous, current, { today: "2026-07-14" }), []);
  assert.equal(isAnnouncementFresh(current.announcements[0], "2026-07-14"), false);
});

test("keeps genuinely recent deadline notices eligible for alerts", () => {
  assert.equal(isAnnouncementFresh({ publishedAt: "2026-07-13 18:00", kind: "deadline" }, "2026-07-14"), true);
});

test("expires relative-time registration notices after their stated day", () => {
  const announcement = {
    publishedAt: "2026-07-09 09:11",
    kind: "open",
    title: "【报名开放】第26届张连伟杯明日12:00开启"
  };
  assert.equal(isAnnouncementFresh(announcement, "2026-07-10"), true);
  assert.equal(isAnnouncementFresh(announcement, "2026-07-11"), false);
  assert.equal(isAnnouncementFresh(announcement, "2026-07-14"), false);
});

test("keeps ordinary recent registration notices eligible", () => {
  assert.equal(isAnnouncementFresh({
    publishedAt: "2026-07-09 09:11",
    kind: "open",
    title: "张连伟杯报名通道开放"
  }, "2026-07-14"), true);
});

test("suppresses a recent deadline notice when the matched registration already closed", () => {
  const previous = { announcements: [{
    id: "baseline",
    source: "官方公告",
    publishedAt: "2026-07-14",
    kind: "open"
  }] };
  const current = {
    announcements: [{
      id: "expired-deadline",
      source: "官方公告",
      publishedAt: "2026-07-14 09:00",
      kind: "deadline",
      matchedEventIds: ["event-1"]
    }],
    events: [{ id: "event-1", registrationEnd: "2026-07-13 18:00" }]
  };
  assert.deepEqual(diffOfficialAnnouncements(previous, current, { today: "2026-07-14" }), []);
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

test("treats a date-derived ID change as an update to the same event", () => {
  const previous = {
    announcements: [],
    events: [{
      id: "同一赛事-2026-07-01",
      category: "junior",
      name: "同一场青少年赛事",
      startDate: "2026-07-20",
      endDate: "2026-07-21"
    }]
  };
  const current = {
    announcements: [],
    generatedAt: "2026-07-13T00:00:00.000Z",
    events: [{
      ...previous.events[0],
      id: "同一赛事-2026-07-02",
      startDate: "2026-07-21",
      endDate: "2026-07-22"
    }]
  };
  const markdown = buildChangeNotification(previous, current);
  assert.match(markdown, /变化：比赛开始、比赛结束/);
  assert.doesNotMatch(markdown, /新增赛事|赛事下架/);
});

test("treats an added competition-grade suffix as the same event", () => {
  const previous = {
    announcements: [],
    events: [{
      id: "tour-old",
      category: "junior",
      name: "2026京津冀鲁辽青少年高尔夫球巡回赛",
      startDate: "2026-08-13",
      endDate: "2026-08-14",
      registrationOpen: true
    }]
  };
  const current = {
    announcements: [],
    generatedAt: "2026-07-14T02:42:21.000Z",
    events: [{
      ...previous.events[0],
      id: "tour-new",
      name: "2026京津冀鲁辽青少年高尔夫球巡回赛（二级一档）"
    }]
  };
  const markdown = buildChangeNotification(previous, current);
  assert.match(markdown, /变化：赛事名称/);
  assert.doesNotMatch(markdown, /新开放报名|赛事下架/);
});
