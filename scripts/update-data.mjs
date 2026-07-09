import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const reportPath = path.join(rootDir, "2026国内女子青少年业余高尔夫赛事报名入口汇总.md");
const dataDir = path.join(rootDir, "data");
const outPath = path.join(dataDir, "events.json");

const YEAR = 2026;
const CGA_API = "https://ranking.cgagolf.org.cn/api/game/match/events";
const CLPGA_API = `https://www.clpga.org/public/index.php/core/zh-cn/matchs/match/list.json?year=${YEAR}`;

const CATEGORY_META = {
  women: {
    label: "女子赛",
    color: "#b8325f",
    defaultSource: "https://www.clpga.org/MatchList?lang=cn",
    defaultRequirement: "以CLPGA/赛事官方资格排序、会员体系、外卡及单站通知为准。"
  },
  women_development: {
    label: "女子二级",
    color: "#7a4bc2",
    defaultSource: "https://www.clpgq.com/",
    defaultRequirement: "起点中巡赛小程序注册、报名、缴费；差点和年龄要求以规程为准。"
  },
  amateur: {
    label: "业余赛",
    color: "#167e75",
    defaultSource: "https://www.cgagolf.org.cn/game_spare.html",
    defaultRequirement: "业余身份、年龄和WHS差点要求以中高协单项规程/补充通知为准。"
  },
  junior: {
    label: "青少年赛",
    color: "#c66a1f",
    defaultSource: "https://www.cgagolf.org.cn/game_young.html",
    defaultRequirement: "通常要求6-18岁、业余身份、有效中高协电子会员卡/身份证明；以单项规程为准。"
  }
};

const KNOWN_SOURCE_OVERRIDES = [
  ["希望赛", "https://www.cgagolf.org.cn/xnews_details/2246.html"],
  ["全国业余高尔夫球巡回赛", "https://www.cgagolf.org.cn/xnews_details/2329.html"],
  ["中国业余高尔夫球冠军赛", "https://www.cgagolf.org.cn/xnews_details/2339.html"],
  ["南山全国业余高尔夫球锦标赛", "https://www.cgagolf.org.cn/xnews_details/2378.html"],
  ["第十九届全国青少年高尔夫球精英赛", "https://www.cgagolf.org.cn/xnews_details/2255.html"],
  ["公开赛-西南地区", "https://www.cgagolf.org.cn/xnews_details/2280.html"],
  ["如歌中国青少年", "https://www.cgagolf.org.cn/xnews_details/2315.html"],
  ["青少年高尔夫球团体锦标赛", "https://www.cgagolf.org.cn/xnews_details/2389.html"],
  ["公开赛·中部地区", "https://www.cgagolf.org.cn/xnews_details/2417.html"],
  ["大连全国青少年", "https://www.cgagolf.org.cn/xnews_details/2411.html"],
  ["第三十二届全国青少年", "https://www.cgagolf.org.cn/xnews_details/2410.html"],
  ["武夷山全国青少年", "https://www.cgagolf.org.cn/xnews_details/2412.html"]
];

function clean(text = "") {
  return String(text)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(text) {
  return clean(text).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "");
}

function firstUrl(text = "") {
  const markdownLink = text.match(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/);
  if (markdownLink) return markdownLink[1];
  const bare = text.match(/https?:\/\/[^\s；;，,)]+/);
  return bare ? bare[0] : "";
}

function allLinks(text = "") {
  const links = [];
  for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
    links.push({ label: clean(match[1]), url: match[2] });
  }
  for (const match of text.matchAll(/https?:\/\/[^\s；;，,)]+/g)) {
    if (!links.some((link) => link.url === match[0])) {
      links.push({ label: match[0].replace(/^https?:\/\//, ""), url: match[0] });
    }
  }
  return links;
}

function splitDateRange(range = "") {
  const dates = range.match(/\d{4}-\d{2}-\d{2}/g) || [];
  return { startDate: dates[0] || "", endDate: dates[1] || dates[0] || "" };
}

function datePattern() {
  return String.raw`(\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?)`;
}

function shanghaiDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function parseShanghaiDateTime(value, endOfDay = false) {
  if (!value) return null;
  const text = String(value).trim().replace(" ", "T");
  const hasTime = /T\d{1,2}:\d{2}/.test(text);
  const normalized = hasTime ? text : `${text}T${endOfDay ? "23:59:59" : "00:00:00"}`;
  const date = new Date(`${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRegistrationWindow(text = "") {
  const normalized = clean(text);
  const date = datePattern();
  const range = normalized.match(new RegExp(`(?:报名|报送|提交|缴费)[^。；;]*?${date}\\s*(?:至|到|-|—|－)\\s*${date}`));
  const deadlineOnly =
    normalized.match(new RegExp(`(?:报名|报送|提交|缴费|即日起)[^。；;]*?(?:截止|截至|至|到)\\s*${date}`)) ||
    normalized.match(new RegExp(`${date}\\s*前(?:发|发送|提交|完成|报名|缴费|确认)`));

  return {
    registrationStart: range ? range[1] : "",
    registrationEnd: range ? range[2] : (deadlineOnly ? deadlineOnly[1] : ""),
    registrationText: normalized
  };
}

function statusFor(event, now = new Date()) {
  const today = parseShanghaiDateTime(shanghaiDateString(now));
  const start = parseShanghaiDateTime(event.startDate);
  const end = parseShanghaiDateTime(event.endDate, true) || start;
  const regStart = parseShanghaiDateTime(event.registrationStart);
  const regEnd = parseShanghaiDateTime(event.registrationEnd, true);

  if (end && end < today) return { code: "past", label: "已结束" };
  if (start && start <= today && end && end >= today) return { code: "running", label: "比赛中" };
  if (regEnd && regEnd < now) return { code: "closed", label: "报名截止" };
  if (regStart && regStart > now) return { code: "pending", label: "待开放" };
  if (regEnd && regEnd >= now) return { code: "open", label: "可报名" };
  if (event.registrationOpen === true) return { code: "open", label: "可报名" };
  if (event.registrationOpen === false) return { code: "pending", label: "待开放" };
  return { code: "watch", label: "关注公告" };
}

function eventKey(event) {
  return `${event.category}:${event.id || slug(event.name)}:${event.startDate || "undated"}`;
}

function normalizeEvent(event) {
  const status = statusFor(event);
  return {
    id: event.id || `${slug(event.name)}-${event.startDate || "date"}`,
    category: event.category,
    categoryLabel: CATEGORY_META[event.category]?.label || event.category,
    color: CATEGORY_META[event.category]?.color || "#333",
    name: clean(event.name),
    startDate: event.startDate || "",
    endDate: event.endDate || event.startDate || "",
    location: clean(event.location || "待定/年历未列"),
    sourceUrl: event.sourceUrl || CATEGORY_META[event.category]?.defaultSource || "",
    sourceLinks: event.sourceLinks?.length ? event.sourceLinks : [{ label: "官方信息源", url: event.sourceUrl || CATEGORY_META[event.category]?.defaultSource || "" }].filter((x) => x.url),
    signupUrl: event.signupUrl || "",
    signupMethod: clean(event.signupMethod || ""),
    requirement: clean(event.requirement || CATEGORY_META[event.category]?.defaultRequirement || ""),
    registrationStart: event.registrationStart || "",
    registrationEnd: event.registrationEnd || "",
    registrationText: clean(event.registrationText || event.signupMethod || ""),
    registrationOpen: event.registrationOpen,
    statusCode: status.code,
    statusLabel: status.label,
    sourceSystem: event.sourceSystem || "",
    updatedFromOfficial: Boolean(event.updatedFromOfficial),
    notes: clean(event.notes || "")
  };
}

function appendSourceSystem(existing = "", incoming = "") {
  const parts = `${existing} + ${incoming}`
    .split("+")
    .map((part) => clean(part))
    .filter(Boolean);
  return [...new Set(parts)].join(" + ");
}

function parseMarkdownEvents(markdown) {
  const events = [];
  let section = "";
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) section = line;
    if (!line.startsWith("|") || line.includes("---")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.some((cell) => ["赛事", "项目", "赛事ID"].includes(cell))) continue;

    if (section.includes("女子职业赛") && cells.length >= 6) {
      const [id, name, time, location, sourceCell, info] = cells;
      const { startDate, endDate } = splitDateRange(time);
      const links = allLinks(sourceCell);
      events.push(normalizeEvent({
        id: `clpga-${id}`,
        category: "women",
        name,
        startDate,
        endDate,
        location,
        sourceUrl: links.find((link) => link.label.includes("赛程"))?.url || firstUrl(sourceCell),
        sourceLinks: links,
        signupUrl: links.find((link) => link.label.includes("报名"))?.url || "",
        signupMethod: info,
        registrationText: info,
        registrationOpen: info.includes("GameRegIsOk=1"),
        sourceSystem: "CLPGA官网/人工核实"
      }));
    }

    if (section.includes("起点中巡赛") && cells.length >= 4 && !cells[0].includes("项目")) {
      const links = allLinks(cells[1]);
      const window = parseRegistrationWindow(cells[2]);
      events.push(normalizeEvent({
        id: "clpgq-2026",
        category: "women_development",
        name: cells[0],
        sourceUrl: links[0]?.url || CATEGORY_META.women_development.defaultSource,
        sourceLinks: links,
        signupMethod: cells[2],
        requirement: cells[3],
        ...window,
        sourceSystem: "中高协规程/起点中巡"
      }));
    }

    if (section.includes("业余赛事") && cells.length >= 5) {
      const [name, time, location, sourceCell, info] = cells;
      const { startDate, endDate } = splitDateRange(time);
      const window = parseRegistrationWindow(info);
      events.push(normalizeEvent({
        category: "amateur",
        name,
        startDate,
        endDate,
        location,
        sourceUrl: firstUrl(sourceCell) || CATEGORY_META.amateur.defaultSource,
        sourceLinks: allLinks(sourceCell),
        signupMethod: info,
        requirement: info,
        ...window,
        sourceSystem: "中高协年历/规程"
      }));
    }

    if (section.includes("青少年赛事") && cells.length >= 5) {
      const [name, time, location, sourceCell, info] = cells;
      const { startDate, endDate } = splitDateRange(time);
      const window = parseRegistrationWindow(info);
      events.push(normalizeEvent({
        category: "junior",
        name,
        startDate,
        endDate,
        location,
        sourceUrl: firstUrl(sourceCell) || CATEGORY_META.junior.defaultSource,
        sourceLinks: allLinks(sourceCell),
        signupMethod: info,
        requirement: info,
        ...window,
        sourceSystem: "中高协年历/规程"
      }));
    }
  }
  return events;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 GolfScheduleBot/1.0"
    },
    ...options
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

function msToDate(ms) {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function resolveKnownSource(name, category) {
  const match = KNOWN_SOURCE_OVERRIDES.find(([needle]) => name.includes(needle));
  if (match) return match[1];
  return CATEGORY_META[category]?.defaultSource || "";
}

async function fetchCgaEvents(category, kindCode) {
  const payload = {
    kindCode,
    startTime: `${YEAR}-01-01`,
    endTime: `${YEAR}-12-31`,
    dataCount: 500
  };
  const json = await fetchJson(CGA_API, { method: "POST", body: JSON.stringify(payload) });
  if (!json?.success || !Array.isArray(json.data)) {
    throw new Error(`CGA API returned unexpected payload for ${category}`);
  }
  return json.data.map((item) => normalizeEvent({
    category,
    name: item.fieldName || item.eventsName,
    startDate: msToDate(item.fieldTime),
    endDate: msToDate(item.fieldEndtime),
    location: item.fieldCourt || "待定/年历未列",
    sourceUrl: resolveKnownSource(item.fieldName || item.eventsName || "", category),
    signupMethod: CATEGORY_META[category].defaultRequirement,
    requirement: CATEGORY_META[category].defaultRequirement,
    sourceSystem: "中高协年历接口",
    updatedFromOfficial: true
  }));
}

async function fetchClpgaEvents() {
  const json = await fetchJson(CLPGA_API);
  if (!Array.isArray(json?.data)) throw new Error("CLPGA API returned unexpected payload");
  return json.data
    .filter((item) => {
      const place = `${item.ColumnPlace || ""} ${item.ColumnName || ""}`;
      return !/Singapore|新加坡/i.test(place);
    })
    .map((item) => normalizeEvent({
      id: `clpga-${item.ID}`,
      category: "women",
      name: item.ColumnName,
      startDate: (item.ColumnStart || "").slice(0, 10),
      endDate: (item.ColumnEnd || "").slice(0, 10),
      location: item.ColumnPlace,
      sourceUrl: `https://www.clpga.org/Match?lang=cn&id=${item.ID}`,
      sourceLinks: [
        { label: "赛程/详情", url: `https://www.clpga.org/Match?lang=cn&id=${item.ID}` },
        { label: "报名页", url: `https://www.clpga.org/SignUp?lang=cn&mt_id=${item.ID}` }
      ],
      signupUrl: `https://www.clpga.org/SignUp?lang=cn&mt_id=${item.ID}`,
      signupMethod: item.GameRegIsOk ? "CLPGA官网字段显示可报名/曾开放，仍需进入报名页确认。" : "报名未公开/未开放，以CLPGA官网为准。",
      requirement: CATEGORY_META.women.defaultRequirement,
      registrationOpen: Boolean(Number(item.GameRegIsOk)),
      sourceSystem: "CLPGA官网接口",
      updatedFromOfficial: true
    }));
}

function mergeEvents(baseEvents, officialEvents) {
  const byKey = new Map(baseEvents.map((event) => [eventKey(event), event]));

  for (const incoming of officialEvents) {
    const directKey = eventKey(incoming);
    const existingKey = [...byKey.keys()].find((key) => {
      const event = byKey.get(key);
      return event.category === incoming.category && (
        event.id === incoming.id ||
        event.name === incoming.name ||
        (event.name.includes(incoming.name) || incoming.name.includes(event.name)) && event.startDate === incoming.startDate
      );
    });
    const key = existingKey || directKey;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, incoming);
      continue;
    }

    byKey.set(key, normalizeEvent({
      ...existing,
      startDate: incoming.startDate || existing.startDate,
      endDate: incoming.endDate || existing.endDate,
      location: incoming.location || existing.location,
      sourceUrl: existing.sourceUrl && !existing.sourceUrl.includes("game_") ? existing.sourceUrl : incoming.sourceUrl,
      sourceLinks: existing.sourceLinks?.length ? existing.sourceLinks : incoming.sourceLinks,
      signupUrl: existing.signupUrl || incoming.signupUrl,
      registrationOpen: incoming.registrationOpen ?? existing.registrationOpen,
      sourceSystem: appendSourceSystem(existing.sourceSystem || "本地", incoming.sourceSystem),
      updatedFromOfficial: true
    }));
  }

  return [...byKey.values()].sort((a, b) => {
    const ad = a.startDate || "9999-12-31";
    const bd = b.startDate || "9999-12-31";
    return ad.localeCompare(bd) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "zh-CN");
  });
}

async function readPreviousPayload() {
  try {
    return JSON.parse(await readFile(outPath, "utf8"));
  } catch {
    return null;
  }
}

function semanticPayload(payload) {
  const { generatedAt, ...rest } = payload;
  return rest;
}

function hasSemanticChanges(previous, next) {
  if (!previous) return true;
  return JSON.stringify(semanticPayload(previous)) !== JSON.stringify(semanticPayload(next));
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  const previousPayload = await readPreviousPayload();
  const markdown = await readFile(reportPath, "utf8");
  const parsedEvents = parseMarkdownEvents(markdown);

  const errors = [];
  const official = [];
  for (const task of [
    () => fetchClpgaEvents(),
    () => fetchCgaEvents("amateur", ["3", "4"]),
    () => fetchCgaEvents("junior", ["5", "6", "7", "8", "16", "17"])
  ]) {
    try {
      official.push(...await task());
    } catch (error) {
      errors.push(error.message);
    }
  }

  const events = errors.length && previousPayload?.events?.length
    ? previousPayload.events
    : mergeEvents(parsedEvents, official);

  const nextPayload = {
    generatedAt: "",
    year: YEAR,
    sources: {
      clpga: "https://www.clpga.org/MatchList?lang=cn",
      cgaWomen: "https://www.cgagolf.org.cn/game_woman.html",
      cgaAmateur: "https://www.cgagolf.org.cn/game_spare.html",
      cgaJunior: "https://www.cgagolf.org.cn/game_young.html",
      cgaMember: "https://member.cgagolf.org.cn/index"
    },
    warnings: errors,
    categories: CATEGORY_META,
    events
  };

  const payload = {
    ...nextPayload,
    generatedAt: hasSemanticChanges(previousPayload, nextPayload)
      ? new Date().toISOString()
      : previousPayload.generatedAt
  };

  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Updated ${events.length} events -> ${path.relative(rootDir, outPath)}`);
  if (errors.length) {
    console.warn("Warnings:");
    for (const error of errors) console.warn(`- ${error}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
