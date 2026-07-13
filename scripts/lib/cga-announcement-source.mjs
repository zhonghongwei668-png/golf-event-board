import { fetchWithRetry } from "./fetch-with-retry.mjs";

const CGA_BASE = "https://www.cgagolf.org.cn";
export const CGA_ANNOUNCEMENT_URL = `${CGA_BASE}/society/c-_detailId%3D19827639.html`;

function clean(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function announcementKind(title = "") {
  if (/补充通知|补录|候补|追加|名额/.test(title)) return "supplemental";
  if (/截止|倒计时/.test(title)) return "deadline";
  if (/报名|开放|开启/.test(title)) return "open";
  return "regulation";
}

function relevantAnnouncement(title = "") {
  const event = /青少年|业余|女子|LPGA|高尔夫球锦标赛|高尔夫球公开赛/.test(title);
  const actionable = /竞赛规程|规程的通知|补充通知|报名|补录|名额|认证赛事|参赛资格/.test(title);
  return event && actionable && !/训练营|管理办法|团体标准/.test(title);
}

function normalizedTitle(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/中国高尔夫球协会|中高协|关于|印发|公布|发布|竞赛规程|规程|补充通知|通知/g, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function matchEventIds(title, events = []) {
  const normalized = normalizedTitle(title);
  if (normalized.length < 6) return [];
  return events
    .filter((event) => {
      const candidate = normalizedTitle(event.name);
      return candidate.length >= 6 && (normalized.includes(candidate) || candidate.includes(normalized));
    })
    .map((event) => event.id)
    .slice(0, 3);
}

export function parseCgaAnnouncements(html = "", events = []) {
  const announcements = [];
  const pattern = /<li>[\s\S]*?<a\s+href=["']([^"']*xnews_details\/(\d+)\.html)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<p\s+class=["']time1["']>([^<]+)<\/p>[\s\S]*?<\/li>/gi;
  for (const match of html.matchAll(pattern)) {
    const title = clean(match[3]);
    const publishedAt = clean(match[4]);
    if (!relevantAnnouncement(title) || !/^2026-\d{2}-\d{2}$/.test(publishedAt)) continue;
    announcements.push({
      id: `cga-announcement-${match[2]}`,
      sourceId: match[2],
      title,
      publishedAt,
      kind: announcementKind(title),
      source: "中国高尔夫球协会官方公告",
      url: new URL(match[1], CGA_BASE).href,
      matchedEventIds: matchEventIds(title, events)
    });
  }
  return announcements;
}

export async function fetchCgaAnnouncements(events = [], options = {}) {
  const response = await fetchWithRetry(CGA_ANNOUNCEMENT_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    }
  }, {
    fetchImpl: options.fetchImpl || fetch,
    timeoutMs: 15000,
    attempts: 3
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${CGA_ANNOUNCEMENT_URL}`);
  const announcements = parseCgaAnnouncements(await response.text(), events);
  if (!announcements.length) throw new Error("CGA announcement page returned no actionable 2026 notices");
  return announcements;
}
