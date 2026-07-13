import { fetchWithRetry } from "./fetch-with-retry.mjs";

const DAZHENG_BASE = "https://www.bwvip.com";
export const DAZHENG_ANNOUNCEMENT_URL = `${DAZHENG_BASE}/default.php?g=m&m=arc&a=arc_list`;
const DAZHENG_ANNOUNCEMENT_DATA_URL = `${DAZHENG_BASE}/default.php?g=m&m=arc&a=arc_list_data`;

function textContent(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function announcementKind(title = "") {
  if (/补录|增补|追加|候补|释放名额|新增名额/.test(title)) return "supplemental";
  if (/报名|缴费|席位|名额/.test(title) && /截止|倒计时|最后\s*\d+\s*天|最后一天/.test(title)) return "deadline";
  if (/开启|开放|启动|开通|报名开始|报名通道/.test(title) && !/已开启后关闭|停止报名/.test(title)) return "open";
  return "";
}

function golfAnnouncement(title = "") {
  return /高尔夫|GCCT|张连伟|WAGR|JGS|SLGS|FCG|U\.S\.\s*Kids|USKG|CWJPGA|CJGT|嘉年华/i.test(title);
}

export function parseDazhengAnnouncements(html = "") {
  const announcements = [];
  const pattern = /<a\s+[^>]*class=["'][^"']*alist[^"']*["'][^>]*href=["']([^"']*arc_id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const body = match[3];
    const title = textContent((body.match(/class=["']name_v2["'][^>]*>([\s\S]*?)<\/td>/i) || [])[1] || "");
    const publishedAt = textContent((body.match(/class=["']time_v2["'][^>]*>([\s\S]*?)<\/td>/i) || [])[1] || "");
    const kind = announcementKind(title);
    if (!title || !publishedAt || !kind || !golfAnnouncement(title)) continue;
    announcements.push({
      id: `dazheng-announcement-${match[2]}`,
      sourceId: match[2],
      title,
      publishedAt,
      kind,
      source: "大正高尔夫官方公告",
      url: new URL(match[1], DAZHENG_BASE).href,
      matchedEventIds: []
    });
  }
  return announcements;
}

function normalizedTitle(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/报名|开启|开放|启动|开通|截止|倒计时|补录|增补|追加|候补|缴费|名额|席位|明日|今日|最后\d+天/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function matchEventIds(announcement, events = []) {
  const title = normalizedTitle(announcement.title);
  if (title.length < 6) return [];
  return events
    .filter((event) => {
      const eventTitle = normalizedTitle(event.name);
      return eventTitle.length >= 6 && (title.includes(eventTitle) || eventTitle.includes(title));
    })
    .map((event) => event.id)
    .slice(0, 3);
}

async function fetchText(url, fetchImpl) {
  const response = await fetchWithRetry(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 GolfScheduleBot/1.0"
    }
  }, {
    fetchImpl,
    timeoutMs: 15000,
    attempts: 3
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

export async function fetchDazhengAnnouncements(events = [], options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const pages = options.pages || 5;
  const pageResults = await Promise.allSettled(
    Array.from({ length: pages }, (_, index) => (
      fetchText(`${DAZHENG_ANNOUNCEMENT_DATA_URL}&page=${index + 1}`, fetchImpl)
    ))
  );
  const successfulPages = pageResults.filter((result) => result.status === "fulfilled");
  const failedPages = pageResults.filter((result) => result.status === "rejected");
  if (!successfulPages.length) throw new Error("Dazheng announcement pages all failed");
  if (failedPages.length) {
    options.onWarnings?.(failedPages.map((result) => result.reason.message));
  }
  const unique = new Map();
  for (const result of successfulPages) {
    const html = result.value;
    for (const announcement of parseDazhengAnnouncements(html)) {
      unique.set(announcement.id, {
        ...announcement,
        matchedEventIds: matchEventIds(announcement, events)
      });
    }
  }
  return [...unique.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.sourceId.localeCompare(a.sourceId))
    .slice(0, 50);
}
