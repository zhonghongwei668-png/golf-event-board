import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchRungolfAnnouncements,
  parseRungolfAnnouncements
} from "../scripts/lib/rungolf-announcement-source.mjs";

const fixture = `
<a href="/news/info/2586" class="news-list"><div class="left">
  <div class="news-item"><h3>无境POLO全程护航丨2026 FILA KIDS · 如歌高尔夫U系列邀请赛-线上赛启幕！</h3>
  <div class="news-info"><p><span>2026 FILA KIDS · 如歌高尔夫U系列青少年高尔夫球邀请赛线上资格赛已正式开启报名。</span>
  <span class="tiem">2026-06-08</span></p></div></div></div></a>
<a href="/news/info/2585" class="news-list"><div class="news-item">
  <h3>如歌室内高尔夫超级贺岁杯圆满收官</h3><p><span>赛事结束。</span><span class="tiem">2026-06-08</span></p>
</div></a>`;

test("parses actionable junior registration news and ignores reports", () => {
  const announcements = parseRungolfAnnouncements(fixture, [{
    id: "fila-u-series",
    name: "2026 FILA KIDS 如歌高尔夫U系列青少年高尔夫球邀请赛"
  }]);
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].sourceId, "2586");
  assert.equal(announcements[0].kind, "open");
  assert.deepEqual(announcements[0].matchedEventIds, ["fila-u-series"]);
});

test("fetches the official Rungolf event-news page", async () => {
  const announcements = await fetchRungolfAnnouncements([], {
    fetchImpl: async () => new Response(fixture, { status: 200 })
  });
  assert.equal(announcements[0].url, "https://www.rungolf.com/news/info/2586");
});

test("empty actionable result is non-fatal and returns an empty list", async () => {
  const onlyReports = `
  <a href="/news/info/2585" class="news-list"><div class="news-item">
    <h3>如歌室内高尔夫超级贺岁杯圆满收官</h3><p><span>赛事结束。</span><span class="tiem">2026-06-08</span></p>
  </div></a>`;
  const announcements = await fetchRungolfAnnouncements([], {
    fetchImpl: async () => new Response(onlyReports, { status: 200 })
  });
  assert.deepEqual(announcements, []);
});

test("parses notices without a hardcoded 2026 year filter", () => {
  const nextYear = `
  <a href="/news/info/3001" class="news-list"><div class="news-item">
    <h3>2027 FILA KIDS 如歌高尔夫U系列邀请赛线上赛报名开启</h3>
    <p><span>资格赛报名开启。</span><span class="tiem">2027-01-05</span></p>
  </div></a>`;
  const announcements = parseRungolfAnnouncements(nextYear, []);
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].publishedAt, "2027-01-05");
});
