const DAY_MS = 86400000;

function publishedDate(announcement) {
  return String(announcement?.publishedAt || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

export function mergeAnnouncementHistory(incoming = [], previous = [], options = {}) {
  const today = options.today;
  const retentionDays = options.retentionDays ?? 45;
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  const retained = previous.filter((announcement) => {
    const published = publishedDate(announcement);
    const publishedTime = Date.parse(`${published}T00:00:00Z`);
    if (!published || !Number.isFinite(todayTime) || !Number.isFinite(publishedTime)) return false;
    const ageDays = (todayTime - publishedTime) / DAY_MS;
    return ageDays >= -1 && ageDays <= retentionDays;
  });

  return [...new Map(
    [...retained, ...incoming].map((announcement) => [announcement.id, announcement])
  ).values()];
}
