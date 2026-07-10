const AUTHORITY_RANK = {
  unknown: 0,
  calendar: 100,
  calendar_api: 120,
  manual: 200,
  official_api: 300,
  signup_detail: 350,
  regulation: 400
};

export function parseShanghaiDateTime(value, endOfDay = false) {
  if (!value) return null;
  const text = String(value).trim().replace(" ", "T");
  const hasTime = /T\d{1,2}:\d{2}/.test(text);
  const normalized = hasTime ? text : `${text}T${endOfDay ? "23:59:59" : "00:00:00"}`;
  const date = new Date(`${normalized}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shanghaiDateString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function statusForEvent(event, now = new Date()) {
  const today = parseShanghaiDateTime(shanghaiDateString(now));
  const start = parseShanghaiDateTime(event.startDate);
  const end = parseShanghaiDateTime(event.endDate, true) || start;
  const regStart = parseShanghaiDateTime(event.registrationStart);
  const regEnd = parseShanghaiDateTime(event.registrationEnd, true);

  if (end && end < today) return { code: "past", label: "已结束" };
  if (start && start <= today && end && end >= today) return { code: "running", label: "比赛中" };
  if (event.registrationClosed === true) return { code: "closed", label: "报名截止" };
  if (regEnd && regEnd < now) return { code: "closed", label: "报名截止" };
  if (regStart && regStart > now) return { code: "pending", label: "待开放" };
  if (regEnd && regEnd >= now) return { code: "open", label: "可报名" };
  if (event.registrationOpen === true) return { code: "open", label: "可报名" };
  if (event.registrationOpen === false) return { code: "pending", label: "待开放" };
  return { code: "watch", label: "关注公告" };
}

export function isRegistrationOpenAt(event, now = new Date()) {
  return statusForEvent(event, now).code === "open";
}

export function inferScheduleAuthority(event = {}) {
  if (event.scheduleAuthority && AUTHORITY_RANK[event.scheduleAuthority] !== undefined) {
    return event.scheduleAuthority;
  }

  const system = String(event.sourceSystem || "");
  const urls = [event.sourceUrl, ...(event.sourceLinks || []).map((link) => link.url)].filter(Boolean);
  const joinedUrls = urls.join(" ");

  if (/年历接口/.test(system)) return "calendar_api";
  if (/CLPGA官网接口/.test(system)) return "official_api";
  if (/baoming_detail/.test(joinedUrls)) return "signup_detail";
  if (/xnews_details\/(?!2253\.html)/.test(joinedUrls)) return "regulation";
  if (/年历|赛程表/.test(system) || /xnews_details\/2253\.html/.test(joinedUrls)) return "calendar";
  return "manual";
}

export function scheduleAuthorityRank(event = {}) {
  return AUTHORITY_RANK[inferScheduleAuthority(event)] || 0;
}

export function chooseSchedule(existing = {}, incoming = {}) {
  const existingHasSchedule = Boolean(existing.startDate || existing.endDate);
  const incomingHasSchedule = Boolean(incoming.startDate || incoming.endDate);
  if (!incomingHasSchedule) return { startDate: existing.startDate || "", endDate: existing.endDate || existing.startDate || "" };
  if (!existingHasSchedule || scheduleAuthorityRank(incoming) >= scheduleAuthorityRank(existing)) {
    return {
      startDate: incoming.startDate || existing.startDate || "",
      endDate: incoming.endDate || incoming.startDate || existing.endDate || existing.startDate || ""
    };
  }
  return { startDate: existing.startDate || "", endDate: existing.endDate || existing.startDate || "" };
}

export function validateEvents(events = [], now = new Date()) {
  const errors = [];
  const ids = new Set();

  for (const event of events) {
    const label = event.name || event.id || "未命名赛事";
    if (!event.id) errors.push(`${label}: 缺少赛事ID`);
    if (event.id && ids.has(event.id)) errors.push(`${label}: 重复赛事ID ${event.id}`);
    if (event.id) ids.add(event.id);

    const start = parseShanghaiDateTime(event.startDate);
    const end = parseShanghaiDateTime(event.endDate, true);
    const regStart = parseShanghaiDateTime(event.registrationStart);
    const regEnd = parseShanghaiDateTime(event.registrationEnd, true);

    if (start && end && end < start) errors.push(`${label}: 比赛结束早于开始`);
    if (regStart && regEnd && regEnd < regStart) errors.push(`${label}: 报名截止早于报名开始`);
    if (end && regEnd && regEnd > end) errors.push(`${label}: 报名截止晚于比赛结束`);
    if (isRegistrationOpenAt(event, now) && !event.signupUrl) errors.push(`${label}: 可报名但缺少报名入口`);
  }

  return errors;
}
