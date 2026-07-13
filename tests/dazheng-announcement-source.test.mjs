import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchDazhengAnnouncements,
  parseDazhengAnnouncements
} from "../scripts/lib/dazheng-announcement-source.mjs";
import {
  buildChangeNotification,
  diffDazhengAnnouncements
} from "../scripts/notify-changes.mjs";

const announcementList = `
  <a class="alist" href="/default.php?g=m&m=arc&a=arc_detail&arc_id=45003">
    <td class="name_v2">第26届尤尼克斯“张连伟”杯国际青少年高尔夫球邀请赛明日12:00开启</td>
    <td class="time_v2">2026-07-09 09:11</td>
  </a>
  <a class="alist" href="/default.php?g=m&m=arc&a=arc_detail&arc_id=45004">
    <td class="name_v2">青少年公路自行车锦标赛圆满结束</td>
    <td class="time_v2">2026-07-09 11:49</td>
  </a>
  <a class="alist" href="/default.php?g=m&m=arc&a=arc_detail&arc_id=44973">
    <td class="name_v2">第八届全国高等院校高尔夫球冠军赛倒计时2天</td>
    <td class="time_v2">2026-05-21 18:16</td>
  </a>`;

test("parses actionable golf announcements and excludes unrelated sports", () => {
  const announcements = parseDazhengAnnouncements(announcementList);

  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].kind, "open");
  assert.equal(announcements[0].sourceId, "45003");
});

test("matches an official announcement to an existing registration event", async () => {
  const fetchImpl = async () => new Response(announcementList, { status: 200 });
  const [announcement] = await fetchDazhengAnnouncements([{
    id: "dazheng-5069",
    name: "第26届尤尼克斯“张连伟”杯国际青少年高尔夫球邀请赛"
  }], { fetchImpl, pages: 1 });

  assert.deepEqual(announcement.matchedEventIds, ["dazheng-5069"]);
});

test("keeps successful announcement pages when another page fails", async () => {
  let warnings = [];
  const fetchImpl = async (url) => (
    url.includes("page=2")
      ? new Response("temporary", { status: 404, statusText: "Not Found" })
      : new Response(announcementList, { status: 200 })
  );
  const announcements = await fetchDazhengAnnouncements([], {
    fetchImpl,
    pages: 2,
    onWarnings: (incoming) => { warnings = incoming; }
  });
  assert.equal(announcements.length, 1);
  assert.equal(warnings.length, 1);
});

test("does not notify the initial announcement baseline twice", () => {
  const current = { announcements: [{ id: "notice-1" }] };

  assert.deepEqual(diffDazhengAnnouncements({}, current), []);
  assert.deepEqual(diffDazhengAnnouncements({ announcements: [] }, current), current.announcements);
  assert.deepEqual(diffDazhengAnnouncements(current, current), []);
});

test("formats a new App announcement with its matched signup link", () => {
  const previous = { announcements: [], events: [] };
  const current = {
    generatedAt: "2026-07-11T12:00:00.000Z",
    announcements: [{
      id: "notice-2",
      title: "测试青少年高尔夫公开赛报名开启",
      publishedAt: "2026-07-11 20:00",
      kind: "open",
      url: "https://www.bwvip.com/notice-2",
      matchedEventIds: ["event-2"]
    }],
    events: [{
      id: "event-2",
      name: "测试青少年高尔夫公开赛",
      signupUrl: "https://www.bwvip.com/signup-2"
    }]
  };
  const markdown = buildChangeNotification(previous, current);

  assert.match(markdown, /【重点】官方赛事公告 1 条/);
  assert.match(markdown, /【报名开放】测试青少年高尔夫公开赛报名开启/);
  assert.match(markdown, /\[报名入口\]\(https:\/\/www\.bwvip\.com\/signup-2\)/);
});
