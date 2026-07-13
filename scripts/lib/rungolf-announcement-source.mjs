import { fetchWithRetry } from "./fetch-with-retry.mjs";

const RUNGOLF_BASE = "https://www.rungolf.com";
export const RUNGOLF_ANNOUNCEMENT_URL = `${RUNGOLF_BASE}/news/match`;

function clean(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function announcementKind(text = "") {
  if (/补录|候补|追加|名额/.test(text)) return "supplemental";
  if (/截止|倒计时/.test(text)) return "deadline";
  if (/报名|开放|开启|启幕/.test(text)) return "open";
  return "regulation";
}

function relevantAnnouncement(title = "", summary = "") {
  const text = `${title} ${summary}`;
  const target = /青少年|FILA\s*KIDS|斐乐|女子|业余|U系列/i.test(text);
  const actionable = /报名|补录|候补|截止|竞赛规程|参赛资格|资格赛|名额|开启|启幕/.test(text);
  return target && actionable;
}

function normalizedTitle(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/无境\s*polo全程护航|fila\s*kids|如歌高尔夫|中国高尔夫球协会|中高协|青少年高尔夫球|线上赛|报名|开启|启幕|竞赛规程|资格赛/g, "")
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

export function parseRungolfAnnouncements(html = "", events = []) {
  const announcements = [];
  const itemPattern = /<a\s+href=["']\/news\/info\/(\d+)["'][^>]*class=["'][^"']*news-list[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(itemPattern)) {
    const body = match[2];
    const title = clean(body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const publishedAt = clean(body.match(/<span[^>]*class=["']tiem["'][^>]*>([^<]+)<\/span>/i)?.[1]);
    const summary = clean(body.match(/<p[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    if (!title || !/^2026-\d{2}-\d{2}$/.test(publishedAt) || !relevantAnnouncement(title, summary)) continue;
    announcements.push({
      id: `rungolf-announcement-${match[1]}`,
      sourceId: match[1],
      title,
      publishedAt,
      kind: announcementKind(`${title} ${summary}`),
      source: "如歌高尔夫官方赛事新闻",
      url: `${RUNGOLF_BASE}/news/info/${match[1]}`,
      matchedEventIds: matchEventIds(title, events)
    });
  }
  return announcements;
}

export async function fetchRungolfAnnouncements(events = [], options = {}) {
  const response = await fetchWithRetry(RUNGOLF_ANNOUNCEMENT_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    }
  }, {
    fetchImpl: options.fetchImpl || fetch,
    timeoutMs: 25000,
    attempts: 2
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${RUNGOLF_ANNOUNCEMENT_URL}`);
  const announcements = parseRungolfAnnouncements(await response.text(), events);
  if (!announcements.length) throw new Error("Rungolf event news returned no actionable 2026 notices");
  return announcements;
}
