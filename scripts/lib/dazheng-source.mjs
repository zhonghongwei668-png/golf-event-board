const DAZHENG_BASE = "https://www.bwvip.com";
export const DAZHENG_LIST_URL = `${DAZHENG_BASE}/default.php?g=m&m=baoming&a=baoming_list`;

function decodeHtml(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDazhengRegistrationWindow(value = "") {
  const normalized = decodeHtml(value).replace(/\s+/g, "");
  const [leftText = "", rightText = ""] = normalized.split(/[~～]/, 2);
  const left = leftText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  if (!left) return { registrationStart: "", registrationEnd: "" };

  const year = Number(left[1]);
  const month = Number(left[2]);
  const day = Number(left[3]);
  let endYear = year;
  let endMonth = month;
  let endDay = day;

  const fullRight = rightText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  const monthRight = rightText.match(/(\d{1,2})月(\d{1,2})日?/);
  const dayRight = rightText.match(/(\d{1,2})日/);
  if (fullRight) {
    endYear = Number(fullRight[1]);
    endMonth = Number(fullRight[2]);
    endDay = Number(fullRight[3]);
  } else if (monthRight) {
    endMonth = Number(monthRight[1]);
    endDay = Number(monthRight[2]);
    if (endMonth < month) endYear += 1;
  } else if (dayRight) {
    endDay = Number(dayRight[1]);
  }

  return {
    registrationStart: isoDate(year, month, day),
    registrationEnd: isoDate(endYear, endMonth, endDay)
  };
}

export function parseDazhengList(html = "") {
  const entries = [];
  const pattern = /<a\s+class=["']alist["']\s+href=["']([^"']*?event_id=(\d+)[^"']*)["']>[\s\S]*?<td\s+class=["']name["']>([\s\S]*?)<\/td>[\s\S]*?<td\s+class=["']time["']>([\s\S]*?)<\/td>/gi;
  for (const match of html.matchAll(pattern)) {
    const registrationText = decodeHtml(match[4]);
    entries.push({
      eventId: match[2],
      name: decodeHtml(match[3]),
      detailUrl: new URL(match[1], DAZHENG_BASE).href,
      registrationText,
      ...parseDazhengRegistrationWindow(registrationText)
    });
  }
  return entries;
}

function parseCompetitionDescription(value = "") {
  const desc = decodeHtml(value);
  const match = desc.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*[～~至—-]\s*(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日)?\s*(.*)$/);
  if (!match) return { startDate: "", endDate: "", location: "" };

  const startYear = Number(match[1]);
  const startMonth = Number(match[2]);
  const startDay = Number(match[3]);
  const endYear = Number(match[4] || startYear);
  const endMonth = Number(match[5] || startMonth);
  const endDay = Number(match[6] || startDay);
  return {
    startDate: isoDate(startYear, startMonth, startDay),
    endDate: isoDate(endYear, endMonth, endDay),
    location: decodeHtml(match[7] || "")
  };
}

export function parseDazhengDetail(html = "") {
  const title = decodeHtml((html.match(/<div\s+class=["']activity_title["']>([\s\S]*?)<\/div>/i) || [])[1] || "");
  const description = (html.match(/desc:\s*'([^']*)'/i) || [])[1] || "";
  const buttonValue = decodeHtml((html.match(/<input[^>]*name=["']button2["'][^>]*value=["']([^"']*)["'][^>]*>/i) || [])[1] || "");
  let registrationState = "unknown";
  if (/^报\s*名$/.test(buttonValue)) registrationState = "open";
  else if (/未开始|待开放/.test(buttonValue)) registrationState = "pending";
  else if (/已结束|报名截止|已满/.test(buttonValue)) registrationState = "closed";
  return {
    name: title,
    registrationOpen: registrationState === "open",
    registrationState,
    registrationButtonText: buttonValue,
    ...parseCompetitionDescription(description)
  };
}

export function classifyDazhengEvent(name = "") {
  const text = decodeHtml(name);
  let category = "junior";
  if (/起点中巡/.test(text)) category = "women_development";
  else if (/业余/.test(text) && !/青少年|少年/.test(text)) category = "amateur";

  let seriesLabel = category === "amateur" ? "业余赛-大正高尔夫" : "青少赛-大正高尔夫";
  if (/嘉年华|Sports Journey|CWJPGA|PCGC/i.test(text)) seriesLabel = "青少赛-嘉年华挑战赛";
  else if (/迈阅|U\.S\.\s*Kids|USKG/i.test(text)) seriesLabel = "青少赛-迈阅巡回赛";
  else if (/北京高协/.test(text)) seriesLabel = "协会赛-北京高协";
  else if (/超级荔枝|SLGS|FCG/i.test(text)) seriesLabel = "青少赛-超级荔枝";
  else if (/GCCT/.test(text)) seriesLabel = "青少赛-GCCT";

  return { category, seriesLabel };
}

export function isEligibleDazhengEvent(event = {}) {
  const name = decodeHtml(event.name);
  if (!event.startDate?.startsWith("2026-")) return false;
  if (/会员招募|教练员|继续教育|等级标准.*考试|培训班|训练营/.test(name)) return false;
  if (/马来西亚|新加坡|泰国|越南|日本|韩国|海外站/.test(`${name} ${event.location || ""}`)) return false;
  return true;
}

export function dazhengEventIdFromEvent(event = {}) {
  if (event.externalIds?.dazheng) return String(event.externalIds.dazheng);
  for (const value of [event.signupUrl, event.sourceUrl, ...(event.sourceLinks || []).map((link) => link.url)]) {
    if (!value) continue;
    try {
      const id = new URL(value, DAZHENG_BASE).searchParams.get("event_id");
      if (id && /\d+/.test(id)) return id;
    } catch {
      // Ignore malformed legacy links and continue searching.
    }
  }
  return "";
}

function sourceEvent(entry, detail) {
  const name = detail.name || entry.name;
  const { category, seriesLabel } = classifyDazhengEvent(name);
  const registrationState = detail.registrationState || "unknown";
  const registrationOpen = registrationState === "open";
  const registrationClosed = registrationState === "closed";
  const registrationWindow = `${entry.registrationStart || "以页面为准"} 至 ${entry.registrationEnd || "以页面为准"}`;
  const windowConflictsWithEvent = Boolean(
    entry.registrationEnd && detail.endDate && entry.registrationEnd > detail.endDate
  );
  const registrationMessage = registrationOpen
    ? "大正高尔夫公开报名页当前显示可报名"
    : registrationClosed ? "大正高尔夫赛事详情显示报名已结束" : "大正高尔夫赛事详情显示待开放";
  return {
    id: `dazheng-${entry.eventId}`,
    category,
    name,
    startDate: detail.startDate || "",
    endDate: detail.endDate || detail.startDate || "",
    location: detail.location || "待定/详情未列",
    sourceUrl: entry.detailUrl,
    sourceLinks: [{ label: "大正赛事详情", url: entry.detailUrl }],
    signupUrl: entry.detailUrl,
    signupMethod: `${registrationMessage}；平台展示报名期 ${registrationWindow}${windowConflictsWithEvent ? "，该日期晚于单场赛期，截止以详情实时状态为准" : ""}。`,
    registrationText: entry.registrationText,
    requirement: "年龄、组别、差点、会员资格和费用以大正赛事详情及主办方最新通知为准。",
    registrationStart: entry.registrationStart,
    registrationEnd: windowConflictsWithEvent ? "" : entry.registrationEnd,
    registrationOpen,
    registrationClosed,
    registrationStatusAuthoritative: true,
    sourceSystem: `大正高尔夫 · ${seriesLabel}`,
    scheduleAuthority: "signup_detail",
    seriesLabel,
    externalIds: { dazheng: entry.eventId },
    updatedFromOfficial: true
  };
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 GolfScheduleBot/1.0"
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchDazhengEvents(previousEvents = [], options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const listHtml = await fetchText(DAZHENG_LIST_URL, fetchImpl);
  const entries = parseDazhengList(listHtml);
  if (!entries.length) throw new Error("Dazheng signup list returned no events");

  const previousById = new Map();
  for (const event of previousEvents) {
    const id = dazhengEventIdFromEvent(event);
    if (id) previousById.set(id, event);
  }

  const listedIds = new Set(entries.map((entry) => entry.eventId));
  const monitoredEntries = [...entries];
  const preservedPast = [];
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(options.now || new Date());
  for (const [eventId, previous] of previousById) {
    if (listedIds.has(eventId) || !previous.startDate?.startsWith("2026-")) continue;
    if (previous.endDate && previous.endDate < today) {
      preservedPast.push(previous);
      continue;
    }
    monitoredEntries.push({
      eventId,
      name: previous.name,
      detailUrl: previous.signupUrl || previous.sourceUrl,
      registrationText: previous.registrationText || "",
      registrationStart: previous.registrationStart || "",
      registrationEnd: previous.registrationEnd || "",
      previousOnly: true
    });
  }

  const detailErrors = [];
  const monitored = await mapWithConcurrency(monitoredEntries, options.concurrency || 6, async (entry) => {
    const previous = previousById.get(entry.eventId);
    let detail;
    try {
      const parsed = parseDazhengDetail(await fetchText(entry.detailUrl, fetchImpl));
      const previousState = previous?.registrationClosed
        ? "closed"
        : previous?.registrationOpen === true ? "open" : "pending";
      detail = {
        ...parsed,
        name: parsed.name || previous?.name || entry.name,
        startDate: parsed.startDate || previous?.startDate || "",
        endDate: parsed.endDate || previous?.endDate || previous?.startDate || "",
        location: parsed.location || previous?.location || "",
        registrationState: parsed.registrationState === "unknown" ? previousState : parsed.registrationState
      };
    } catch (error) {
      detailErrors.push(`${entry.eventId}: ${error.message}`);
      if (!previous?.startDate) return null;
      detail = {
        name: previous.name,
        startDate: previous.startDate,
        endDate: previous.endDate,
        location: previous.location,
        registrationOpen: previous.registrationOpen === true,
        registrationState: previous.registrationClosed
          ? "closed"
          : previous.registrationOpen === true ? "open" : "pending"
      };
    }
    let event = sourceEvent(entry, detail);
    if (entry.previousOnly && previous) {
      event = {
        ...previous,
        signupMethod: event.signupMethod,
        registrationOpen: event.registrationOpen,
        registrationClosed: event.registrationClosed,
        registrationStatusAuthoritative: true,
        externalIds: { ...(previous.externalIds || {}), dazheng: entry.eventId }
      };
    }
    return isEligibleDazhengEvent(event) ? event : null;
  });

  const eligible = monitored.filter(Boolean);
  if (!eligible.length) throw new Error("Dazheng details returned no eligible tournaments");
  if (detailErrors.length) {
    console.warn(`Dazheng detail warnings (${detailErrors.length}):`);
    for (const error of detailErrors) console.warn(`- ${error}`);
  }

  return [...eligible, ...preservedPast];
}
