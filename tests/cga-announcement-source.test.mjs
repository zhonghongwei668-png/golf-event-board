import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchCgaAnnouncements,
  parseCgaAnnouncements
} from "../scripts/lib/cga-announcement-source.mjs";

const fixture = `
<li><div class="time"></div><div class="text"><h3>
<a href="/xnews_details/2419.html">中国高尔夫球协会关于印发第26届尤尼克斯“张连伟”杯国际青少年高尔夫球邀请赛竞赛规程通知</a>
</h3><p class="time1">2026-07-13</p></div></li>
<li><div class="text"><h3><a href="/xnews_details/2400.html">中国高尔夫球协会关于组织青少年训练营的通知</a></h3>
<p class="time1">2026-07-01</p></div></li>`;

test("parses current actionable CGA notices and matches an event", () => {
  const announcements = parseCgaAnnouncements(fixture, [{
    id: "event-1",
    name: "第26届尤尼克斯张连伟杯国际青少年高尔夫球邀请赛"
  }]);
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].sourceId, "2419");
  assert.deepEqual(announcements[0].matchedEventIds, ["event-1"]);
});

test("fetches the CGA announcement source with an official direct link", async () => {
  const announcements = await fetchCgaAnnouncements([], {
    fetchImpl: async () => new Response(fixture, { status: 200 })
  });
  assert.match(announcements[0].url, /cgagolf\.org\.cn\/xnews_details\/2419\.html/);
});
