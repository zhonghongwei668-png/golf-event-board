import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChangeNotification,
  diffOfficialAnnouncements,
  isAnnouncementFresh,
  openHistoryKeys
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
  }, { today: "2026-07-14" });
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

test("never pushes deadline notices even when they are recent", () => {
  const previous = { announcements: [{
    id: "baseline",
    source: "官方公告",
    publishedAt: "2026-07-14",
    kind: "open"
  }] };
  const current = { announcements: [{
    id: "fresh-deadline",
    source: "官方公告",
    publishedAt: "2026-07-17 09:00",
    kind: "deadline"
  }] };
  assert.deepEqual(diffOfficialAnnouncements(previous, current, { today: "2026-07-17" }), []);
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

test("does not push registration deadline or closed-status-only changes", () => {
  const previous = {
    announcements: [],
    events: [{
      id: "event-1",
      category: "junior",
      name: "青少年测试赛",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      statusLabel: "可报名",
      registrationOpen: true,
      registrationEnd: "2026-07-20"
    }]
  };
  const current = {
    ...previous,
    generatedAt: "2026-07-17T00:00:00.000Z",
    events: [{
      ...previous.events[0],
      statusLabel: "报名截止",
      registrationOpen: false,
      registrationEnd: "2026-07-19"
    }]
  };
  assert.equal(buildChangeNotification(previous, current, { today: "2026-07-14" }), "");
});

test("does not push location or eligibility changes", () => {
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
  const markdown = buildChangeNotification(before, after, { today: "2026-07-14" });
  assert.equal(markdown, "");
});

test("does not push competition start or end changes", () => {
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
  const markdown = buildChangeNotification(previous, current, { today: "2026-07-14" });
  assert.equal(markdown, "");
});

test("does not push a name or competition-grade change", () => {
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
  const markdown = buildChangeNotification(previous, current, { today: "2026-07-14" });
  assert.equal(markdown, "");
});

test("pushes an existing event only when its registration newly opens", () => {
  const previous = {
    announcements: [],
    events: [{
      id: "opening-event",
      category: "junior",
      name: "青少年报名开放测试赛",
      startDate: "2026-08-20",
      endDate: "2026-08-21",
      registrationOpen: false
    }]
  };
  const current = {
    ...previous,
    generatedAt: "2026-07-20T02:00:00.000Z",
    events: [{
      ...previous.events[0],
      registrationOpen: true,
      signupUrl: "https://example.com/signup"
    }]
  };
  const markdown = buildChangeNotification(previous, current, { today: "2026-08-10" });
  assert.match(markdown, /高尔夫赛事报名开始提醒/);
  assert.match(markdown, /新开放报名 1 场/);
  assert.match(markdown, /青少年报名开放测试赛/);
  assert.match(markdown, /https:\/\/example\.com\/signup/);
});

test("pushes a newly discovered event only when registration is already open", () => {
  const previous = { announcements: [], events: [] };
  const closed = {
    generatedAt: "2026-07-20T02:00:00.000Z",
    announcements: [],
    events: [{
      id: "new-event",
      category: "junior",
      name: "新发现赛事",
      startDate: "2026-08-20",
      registrationOpen: false
    }]
  };
  assert.equal(buildChangeNotification(previous, closed), "");
  const markdown = buildChangeNotification(previous, {
    ...closed,
    events: [{ ...closed.events[0], registrationOpen: true }]
  }, { today: "2026-08-10" });
  assert.match(markdown, /新开放报名 1 场/);
});

test("does not push a registration that closes and later reopens", () => {
  const previous = {
    announcements: [],
    events: [{
      id: "dazheng-5050",
      category: "junior",
      name: "佛山云东海站",
      startDate: "2026-08-01",
      registrationOpen: false,
      registrationClosed: true,
      externalIds: { dazheng: "5050" }
    }]
  };
  const current = {
    ...previous,
    generatedAt: "2026-07-31T01:20:29.468Z",
    events: [{
      ...previous.events[0],
      registrationOpen: true,
      registrationClosed: false
    }]
  };
  const seen = new Set(["external:dazheng:5050"]);
  assert.equal(buildChangeNotification(previous, current, {
    wasOpenBefore: (event) => openHistoryKeys(event).some((key) => seen.has(key)),
    today: "2026-07-14"
  }), "");
});

test("recognizes previously open events after an ID or name variation", () => {
  const event = {
    id: "renamed-event",
    category: "junior",
    name: "太平松体育锦标赛暨AJGA IPS系列赛（二级一档）",
    externalIds: { dazheng: "5110" },
    registrationOpen: true
  };
  assert.equal(buildChangeNotification({ events: [] }, { events: [event] }, {
    wasOpenBefore: (candidate) => openHistoryKeys(candidate).includes("external:dazheng:5110"),
    today: "2026-07-14"
  }), "");
});
