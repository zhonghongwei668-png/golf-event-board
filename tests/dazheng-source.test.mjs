import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDazhengEvent,
  dazhengEventIdFromEvent,
  fetchDazhengEvents,
  isEligibleDazhengEvent,
  parseDazhengDetail,
  parseDazhengList,
  parseDazhengRegistrationWindow
} from "../scripts/lib/dazheng-source.mjs";

const YEAR = new Date().getFullYear();

test("parses Dazheng list entries and direct signup URLs", () => {
  const html = `
    <li class="event_baoming_list">
      <a class="alist" href="/default.php?g=m&m=baoming&a=baoming_detail&event_id=5062">
        <table><tr><td class="name">PCGC-CWJPGA INTERNATIONAL JUNIOR GOLF CHAMPIONSHIP</td></tr>
        <tr><td class="time">2026年07月06日 ~ 10月01日</td></tr></table>
      </a>
    </li>`;
  const [event] = parseDazhengList(html);

  assert.equal(event.eventId, "5062");
  assert.equal(event.registrationStart, "2026-07-06");
  assert.equal(event.registrationEnd, "2026-10-01");
  assert.match(event.detailUrl, /event_id=5062/);
});

test("extracts stable Dazheng IDs from existing manual signup links", () => {
  assert.equal(dazhengEventIdFromEvent({
    signupUrl: "https://www.bwvip.com/default.php?g=m&m=baoming&a=baoming_detail&event_id=5065"
  }), "5065");
});

test("parses compact same-month and cross-month registration ranges", () => {
  assert.deepEqual(parseDazhengRegistrationWindow("2026年07月10 ~ 26日"), {
    registrationStart: "2026-07-10",
    registrationEnd: "2026-07-26"
  });
  assert.deepEqual(parseDazhengRegistrationWindow("2026年07月09日 ~ 08月09日"), {
    registrationStart: "2026-07-09",
    registrationEnd: "2026-08-09"
  });
});

test("parses competition dates, location, and live signup button from detail", () => {
  const html = `
    <div class="activity_title">2026迈阅青少年高尔夫巡回赛·天津27人站（第二站）</div>
    <input name="button2" type="button" value="报 名" />
    <script>wx.updateAppMessageShareData({
      title: '赛事',
      desc: '2026年07月30日～07月31日 天津27人高尔夫俱乐部'
    });</script>`;
  const event = parseDazhengDetail(html);

  assert.equal(event.registrationOpen, true);
  assert.equal(event.startDate, "2026-07-30");
  assert.equal(event.endDate, "2026-07-31");
  assert.equal(event.location, "天津27人高尔夫俱乐部");
});

test("distinguishes a pending Dazheng detail from an open registration", () => {
  const event = parseDazhengDetail(`
    <div class="activity_title">2026测试青少年系列赛</div>
    <input name="button2" value="未开始">
    <script>const share = { desc: '2026年08月15日 上海测试高尔夫球会' };</script>`);

  assert.equal(event.registrationOpen, false);
  assert.equal(event.registrationState, "pending");
});

test("classifies user-requested Dazheng series", () => {
  assert.equal(classifyDazhengEvent("NSP-2026青少年高尔夫嘉年华挑战赛").seriesLabel, "青少赛-嘉年华挑战赛");
  assert.equal(classifyDazhengEvent("2026迈阅青少年高尔夫巡回赛").seriesLabel, "青少赛-迈阅巡回赛");
  assert.equal(classifyDazhengEvent("2026 北京高协 青少年邀请赛").seriesLabel, "协会赛-北京高协");
  assert.equal(classifyDazhengEvent("GCCT青少年高尔夫球技能等级二级赛").seriesLabel, "青少赛-GCCT");
});

test("excludes non-tournaments and overseas events", () => {
  assert.equal(isEligibleDazhengEvent({ name: "北京高尔夫球运动协会-会员招募", startDate: `${YEAR}-07-10` }), false);
  assert.equal(isEligibleDazhengEvent({ name: "中高协教练员继续教育系列活动", startDate: `${YEAR}-07-17` }), false);
  assert.equal(isEligibleDazhengEvent({ name: "中国海南国际青少年巡回赛-马来西亚站", startDate: `${YEAR}-08-13` }), false);
  assert.equal(isEligibleDazhengEvent({ name: "PCGC-CWJPGA INTERNATIONAL JUNIOR GOLF CHAMPIONSHIP", startDate: `${YEAR}-10-02` }), true);
});

test("live fetch keeps other events when one detail page fails", async () => {
  const list = `
    <a class="alist" href="/default.php?g=m&m=baoming&a=baoming_detail&event_id=6001">
      <td class="name">2026测试青少年系列赛第一站</td><td class="time">2026年07月01日 ~ 09月18日</td>
    </a>
    <a class="alist" href="/default.php?g=m&m=baoming&a=baoming_detail&event_id=6002">
      <td class="name">2026测试青少年系列赛第二站</td><td class="time">2026年07月01日 ~ 07月20日</td>
    </a>`;
  const detail = `
    <div class="activity_title">2026测试青少年系列赛第一站</div>
    <input name="button2" value="报 名">
    <script>const share = { desc: '2026年09月12日～09月13日 北京测试高尔夫球会' };</script>`;
  const previous = [{
    id: "dazheng-6002",
    category: "junior",
    name: "2026测试青少年系列赛第二站",
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    location: "上海测试高尔夫球会",
    registrationStart: "2026-07-01",
    registrationEnd: "2026-07-19",
    signupUrl: "https://www.bwvip.com/default.php?event_id=6002",
    externalIds: { dazheng: "6002" }
  }];
  const fetchImpl = async (url) => {
    if (url.includes("baoming_list")) return new Response(list, { status: 200 });
    if (url.includes("event_id=6001")) return new Response(detail, { status: 200 });
    return new Response("temporary failure", { status: 502, statusText: "Bad Gateway" });
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    let warnings = [];
    const events = await fetchDazhengEvents(previous, {
      fetchImpl,
      concurrency: 2,
      now: new Date("2026-07-20T00:00:00+08:00"),
      onWarnings: (incoming) => { warnings = incoming; }
    });
    assert.equal(events.length, 2);
    assert.equal(events.find((event) => event.externalIds.dazheng === "6001").registrationEnd, "");
    assert.equal(events.find((event) => event.externalIds.dazheng === "6002").startDate, "2026-08-01");
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("rechecks a previously seen detail that is absent from the current list", async () => {
  const list = `
    <a class="alist" href="/default.php?g=m&m=baoming&a=baoming_detail&event_id=7001">
      <td class="name">2026测试青少年系列赛第一站</td><td class="time">2026年07月01日 ~ 07月20日</td>
    </a>`;
  const openDetail = (id, name) => `
    <div class="activity_title">${name}</div>
    <input name="button2" value="报 名">
    <script>const share = { desc: '2026年08月15日 北京测试高尔夫球会' };</script>`;
  const previous = [{
    id: "dazheng-7002",
    category: "junior",
    name: "2026测试青少年系列赛第二站",
    startDate: `${YEAR}-08-15`,
    endDate: `${YEAR}-08-15`,
    location: "北京测试高尔夫球会",
    registrationOpen: false,
    registrationClosed: false,
    signupUrl: "https://www.bwvip.com/default.php?g=m&m=baoming&a=baoming_detail&event_id=7002",
    externalIds: { dazheng: "7002" }
  }];
  const fetchImpl = async (url) => {
    if (url.includes("baoming_list")) return new Response(list, { status: 200 });
    const id = url.includes("7002") ? "7002" : "7001";
    return new Response(openDetail(id, `2026测试青少年系列赛第${id === "7002" ? "二" : "一"}站`), { status: 200 });
  };

  const events = await fetchDazhengEvents(previous, {
    fetchImpl,
    concurrency: 2,
    // 固定“今天”为 8-01（早于事件 endDate 8-15），避免真实时间推移导致该用例随日期失效
    now: new Date(`${YEAR}-08-01T00:00:00+08:00`)
  });
  assert.equal(events.find((event) => event.externalIds.dazheng === "7002").registrationOpen, true);
});
