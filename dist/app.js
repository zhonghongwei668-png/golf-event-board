import {
  isRegistrationOpenAt,
  parseShanghaiDateTime,
  statusForEvent
} from "./event-logic.js";

const state = {
  data: null,
  sources: [],
  appLinks: [],
  events: [],
  filtered: [],
  selected: null,
  category: "all",
  status: "all",
  month: "all",
  sort: "asc",
  search: "",
  directOnly: false,
  hasLiveApi: false
};

const EVENT_CACHE_KEY = "golf-event-board:events:v1";

const els = {
  updatedAt: document.querySelector("#updatedAt"),
  categoryFilters: document.querySelector("#categoryFilters"),
  statusFilters: document.querySelector("#statusFilters"),
  searchInput: document.querySelector("#searchInput"),
  monthSelect: document.querySelector("#monthSelect"),
  sortSelect: document.querySelector("#sortSelect"),
  directOnly: document.querySelector("#directOnly"),
  alertsPanel: document.querySelector("#alertsPanel"),
  watchPanel: document.querySelector("#watchPanel"),
  timeline: document.querySelector("#timeline"),
  resultTitle: document.querySelector("#resultTitle"),
  refreshButton: document.querySelector("#refreshButton"),
  detailPanel: document.querySelector("#detailPanel"),
  emptyDetail: document.querySelector("#emptyDetail"),
  detailContent: document.querySelector("#detailContent"),
  detailCategory: document.querySelector("#detailCategory"),
  detailName: document.querySelector("#detailName"),
  detailMeta: document.querySelector("#detailMeta"),
  detailActions: document.querySelector("#detailActions"),
  detailAppLinks: document.querySelector("#detailAppLinks"),
  detailSignup: document.querySelector("#detailSignup"),
  detailRequirement: document.querySelector("#detailRequirement"),
  previewOpen: document.querySelector("#previewOpen"),
  previewDomain: document.querySelector("#previewDomain"),
  closeDetail: document.querySelector("#closeDetail"),
  filterToggle: document.querySelector("#filterToggle")
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeClassToken(value = "") {
  return /^[a-z0-9_-]+$/i.test(String(value)) ? String(value) : "";
}

function safeColor(value = "") {
  return /^#[0-9a-f]{3,8}$/i.test(String(value)) ? String(value) : "#333";
}

function safeUrl(value = "", allowedProtocols = ["http:", "https:"]) {
  if (!value) return "";
  try {
    const url = new URL(String(value), window.location.href);
    return allowedProtocols.includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return new Date(`${parts}T00:00:00+08:00`);
}

function cnDate(date) {
  if (!date) return "待定";
  const d = new Date(`${date}T00:00:00+08:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function fullDate(date) {
  if (!date) return "待定";
  return date.replaceAll("-", ".");
}

function eventRange(event) {
  if (!event.startDate) return "待定";
  if (!event.endDate || event.endDate === event.startDate) return fullDate(event.startDate);
  return `${fullDate(event.startDate)} - ${fullDate(event.endDate)}`;
}

function monthKey(event) {
  return event.startDate ? event.startDate.slice(0, 7) : "undated";
}

function monthLabel(key) {
  if (key === "undated") return "日期待定";
  const [year, month] = key.split("-");
  return `${year}年${Number(month)}月`;
}

function isFuture(event) {
  if (!event.endDate) return true;
  const end = parseShanghaiDateTime(event.endDate, true);
  return !end || end >= todayInShanghai();
}

function hasDeadline(event) {
  return Boolean(event.registrationEnd);
}

function isRegistrationOpen(event) {
  return isRegistrationOpenAt(event);
}

function daysUntil(dateText) {
  if (!dateText) return null;
  const date = new Date(`${dateText.slice(0, 10)}T23:59:59+08:00`);
  const diff = date.getTime() - todayInShanghai().getTime();
  return Math.ceil(diff / 86400000);
}

function deadlineCountdown(event) {
  if (!event.registrationEnd || !isRegistrationOpen(event)) return "";
  const end = parseShanghaiDateTime(event.registrationEnd, true);
  if (!end) return "";
  const hours = Math.ceil((end.getTime() - Date.now()) / 3600000);
  if (hours <= 0) return "今日截止";
  if (hours < 24) return `剩 ${hours} 小时`;
  return `剩 ${Math.ceil(hours / 24)} 天`;
}

function isHotEvent(event) {
  return /汇丰|斐乐|CJGT|精英|锦标赛|公开赛|如歌|宝马|BMW|劳力士|沃尔沃|冯珊珊|朝向/i.test(event.name);
}

function linkButton(label, url, tone = "") {
  const href = safeUrl(url);
  if (!href) return "";
  const className = safeClassToken(tone);
  return `<a class="action-link ${className}" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

async function fetchData() {
  const canUseLocalApi = ["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "4173";
  if (canUseLocalApi) {
    try {
      const apiResponse = await fetch("/api/events", { cache: "no-store" });
      if (apiResponse.ok) {
        state.hasLiveApi = true;
        return apiResponse;
      }
    } catch {
      state.hasLiveApi = false;
    }
  }
  state.hasLiveApi = false;
  return fetch("./data/events.json", { cache: "default", credentials: "omit" });
}

async function fetchSources() {
  try {
    const response = await fetch("./data/sources.json", { cache: "default", credentials: "omit" });
    if (!response.ok) return [];
    const payload = await response.json();
    return payload.sources || [];
  } catch {
    return [];
  }
}

async function fetchAppLinks() {
  try {
    const response = await fetch("./data/app-links.json", { cache: "default", credentials: "omit" });
    if (!response.ok) return [];
    const payload = await response.json();
    return payload.apps || [];
  } catch {
    return [];
  }
}

function readCachedEvents() {
  try {
    const cached = JSON.parse(localStorage.getItem(EVENT_CACHE_KEY) || "null");
    return cached?.payload && Array.isArray(cached.payload.events) ? cached.payload : null;
  } catch {
    return null;
  }
}

function cacheEvents(payload) {
  try {
    localStorage.setItem(EVENT_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {
    // Storage can be unavailable in private browsing; network loading still works.
  }
}

function renderPrimaryData(payload, source = "network") {
  state.data = payload;
  state.events = payload.events || [];
  renderMonths();
  applyFilters();
  const generated = state.data.generatedAt ? new Date(state.data.generatedAt) : null;
  const cacheLabel = source === "cache" ? " · 正在校准最新数据" : "";
  els.updatedAt.textContent = generated ? `最近数据变化 ${generated.toLocaleString("zh-CN", { hour12: false })}${cacheLabel}` : "已读取赛事数据";
  els.refreshButton.textContent = state.hasLiveApi ? "更新官方数据" : "白天每小时更新";
  els.refreshButton.title = state.hasLiveApi ? "立即从官方来源刷新" : "公网静态版每天 08:00 至 22:00 整点自动更新";
  els.timeline.setAttribute("aria-busy", "false");
  document.documentElement.dataset.eventsReady = source;
}

async function loadData() {
  const supportData = Promise.all([fetchSources(), fetchAppLinks()]);
  const cached = readCachedEvents();

  if (cached) renderPrimaryData(cached, "cache");

  try {
    const response = await fetchData();
    if (!response.ok) throw new Error("赛事数据读取失败");
    const payload = await response.json();
    cacheEvents(payload);
    renderPrimaryData(payload);
  } catch (error) {
    if (!cached) throw error;
    els.updatedAt.textContent = `${els.updatedAt.textContent.replace(" · 正在校准最新数据", "")} · 当前为最近缓存`;
  }

  [state.sources, state.appLinks] = await supportData;
  renderWatchPanel();
  if (state.selected) {
    state.selected = state.events.find((event) => event.id === state.selected.id) || null;
    if (state.selected) renderDetail(state.selected);
  }
}

function renderAlerts() {
  const candidates = state.events
    .filter((event) => isFuture(event) && (event.registrationEnd || isHotEvent(event)))
    .map((event) => ({ event, deadlineDays: daysUntil(event.registrationEnd) }))
    .filter((item) => item.deadlineDays === null || item.deadlineDays >= -1)
    .sort((a, b) => {
      const ad = a.deadlineDays ?? 999;
      const bd = b.deadlineDays ?? 999;
      return ad - bd || a.event.startDate.localeCompare(b.event.startDate);
    })
    .slice(0, 5);

  if (!candidates.length) {
    els.alertsPanel.innerHTML = "";
    return;
  }

  els.alertsPanel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">抢手名额提醒</p>
        <h3>优先盯报名开始、截止和补录</h3>
      </div>
      <span>核心官网白天每小时检查</span>
    </div>
    <div class="alert-grid">
      ${candidates.map(({ event, deadlineDays }) => `
        <button class="alert-card" data-id="${escapeHtml(event.id)}" style="--accent:${safeColor(event.color)}">
          <strong>${escapeHtml(event.name)}</strong>
          <span>${event.registrationEnd ? `报名截止：${escapeHtml(event.registrationEnd)}` : "热门赛事，关注官方首发"}</span>
          <em>${deadlineDays === null ? escapeHtml(event.categoryLabel) : deadlineDays <= 0 ? "今天/已临近" : `${deadlineDays} 天内`}</em>
        </button>
      `).join("")}
    </div>
  `;

  els.alertsPanel.querySelectorAll(".alert-card").forEach((card) => {
    card.addEventListener("click", () => selectEvent(card.dataset.id));
  });
}

function renderWatchPanel() {
  const sourceGroups = [
    {
      tier: "A",
      eyebrow: "A档公开来源",
      title: "已确认可访问的信息源",
      note: "公开网页/PDF",
      sources: state.sources.filter((source) => source.tier === "A"),
    },
    {
      tier: "B",
      eyebrow: "B档微信/小程序",
      title: "高价值待确认渠道",
      note: "需人工回查",
      sources: state.sources.filter((source) => source.tier === "B"),
    },
  ].filter((group) => group.sources.length);

  if (!sourceGroups.length) {
    els.watchPanel.innerHTML = "";
    return;
  }

  els.watchPanel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">信息源矩阵</p>
        <h3>公开来源 + 微信待确认渠道</h3>
      </div>
      <span>${escapeHtml(state.sources.length)} 个渠道</span>
    </div>
    ${sourceGroups.map((group) => `
      <details class="source-tier-group source-tier-${safeClassToken(group.tier.toLowerCase())}">
        <summary class="source-tier-heading">
          <div>
            <p class="eyebrow">${escapeHtml(group.eyebrow)}</p>
            <h4>${escapeHtml(group.title)}</h4>
          </div>
          <span>${escapeHtml(group.sources.length)} 个 · ${escapeHtml(group.note)}</span>
        </summary>
        <div class="source-grid">
          ${group.sources.map((source) => `
            <article class="source-card" data-tier="${escapeHtml(source.tier)}">
              <div>
                <strong>${escapeHtml(source.name)}</strong>
                <span>${escapeHtml(source.type)} · ${escapeHtml(source.priority)}优先级 · ${escapeHtml(source.status || "已确认")}</span>
              </div>
              ${source.coverage ? `<p class="source-coverage">${escapeHtml(source.coverage)}</p>` : ""}
              <p>${escapeHtml(source.watch)}</p>
              <div class="source-actions">
                ${safeUrl(source.url) ? `<a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noreferrer">打开来源</a>` : ""}
                ${source.wechat ? `<span>微信：${escapeHtml(source.wechat)}</span>` : ""}
              </div>
            </article>
          `).join("")}
        </div>
      </details>
      `).join("")}
  `;
}

function renderMonths() {
  const months = [...new Set(state.events.map(monthKey))].sort();
  els.monthSelect.innerHTML = `<option value="all">全年</option>` + months.map((key) => (
    `<option value="${escapeHtml(key)}">${escapeHtml(monthLabel(key))}</option>`
  )).join("");
  if (!months.includes(state.month)) state.month = "all";
  els.monthSelect.value = state.month;
}

function applyFilters() {
  const q = state.search.trim().toLowerCase();
  state.filtered = state.events.filter((event) => {
    const matchesCategory = state.category === "all" || event.category === state.category;
    const matchesMonth = state.month === "all" || monthKey(event) === state.month;
    const haystack = `${event.name} ${event.location} ${event.signupMethod} ${event.requirement} ${event.seriesLabel || ""} ${event.sourceSystem || ""}`.toLowerCase();
    const matchesSearch = !q || haystack.includes(q);
    const matchesDirect = !state.directOnly || Boolean(safeUrl(event.signupUrl));
    let matchesStatus = true;
    if (state.status === "future") matchesStatus = isFuture(event);
    if (state.status === "open") matchesStatus = isRegistrationOpen(event);
    if (state.status === "deadline") matchesStatus = hasDeadline(event);
    return matchesCategory && matchesMonth && matchesSearch && matchesDirect && matchesStatus;
  });

  state.filtered.sort((a, b) => {
    const left = a.startDate || "9999-12-31";
    const right = b.startDate || "9999-12-31";
    return state.sort === "asc" ? left.localeCompare(right) : right.localeCompare(left);
  });

  renderTimeline();
  renderAlerts();
}

function renderTimeline() {
  els.resultTitle.textContent = `${state.filtered.length} 场赛事`;
  if (!state.filtered.length) {
    els.timeline.innerHTML = `<div class="empty-list">没有符合条件的赛事</div>`;
    return;
  }

  const activeEvents = state.filtered.filter((event) => isFuture(event));
  const pastEvents = state.filtered.filter((event) => !isFuture(event));
  const groups = new Map();
  for (const event of activeEvents) {
    const key = monthKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }

  const activeHtml = activeEvents.length ? [...groups.entries()].map(([key, events]) => `
    <section class="month-group">
      <div class="month-heading">
        <h3>${escapeHtml(monthLabel(key))}</h3>
        <span>${escapeHtml(events.length)} 场</span>
      </div>
      <div class="event-grid">
        ${events.map(renderCard).join("")}
      </div>
    </section>
  `).join("") : `<div class="empty-list">当前筛选下没有未结束赛事</div>`;

  const pastHtml = pastEvents.length ? `
    <details class="past-events">
      <summary>
        <span>已结束赛事</span>
        <strong>${escapeHtml(pastEvents.length)} 场</strong>
      </summary>
      <div class="past-events-body">
        ${pastEvents.map(renderCompactPastCard).join("")}
      </div>
    </details>
  ` : "";

  els.timeline.innerHTML = activeHtml + pastHtml;

  els.timeline.querySelectorAll(".event-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      selectEvent(card.dataset.id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.target.closest("a") || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      selectEvent(card.dataset.id);
    });
  });
}

function renderCard(event) {
  const liveStatus = statusForEvent(event);
  const countdown = deadlineCountdown(event);
  const deadline = event.registrationEnd
    ? `<span>报名至 ${escapeHtml(event.registrationEnd)}${countdown ? ` · ${escapeHtml(countdown)}` : ""}</span>`
    : `<span>${escapeHtml(liveStatus.label)}</span>`;
  const signupAction = liveStatus.code === "open" && safeUrl(event.signupUrl)
    ? `<a class="card-signup-link" href="${escapeHtml(safeUrl(event.signupUrl))}" target="_blank" rel="noreferrer">立即报名</a>`
    : "";
  const selectedClass = state.selected?.id === event.id ? " is-selected" : "";
  return `
    <article class="event-card${selectedClass}" data-id="${escapeHtml(event.id)}" style="--accent:${safeColor(event.color)}" role="button" tabindex="0" aria-label="查看 ${escapeHtml(event.name)}">
      <div class="date-box">
        <strong>${escapeHtml(cnDate(event.startDate))}</strong>
        <span>${event.endDate && event.endDate !== event.startDate ? `至 ${escapeHtml(cnDate(event.endDate))}` : escapeHtml(event.categoryLabel)}</span>
      </div>
      <div class="card-body">
        <div class="card-topline">
          <span class="category-tag">${escapeHtml(event.categoryLabel)}</span>
          <span class="status ${safeClassToken(liveStatus.code)}">${escapeHtml(liveStatus.label)}</span>
        </div>
        <h4>${escapeHtml(event.name)}</h4>
        <p>${escapeHtml(event.location)}</p>
        <div class="card-footer">
          ${deadline}
          <span class="card-source">${escapeHtml(event.sourceSystem || "官方信息源")}</span>
          ${signupAction}
        </div>
      </div>
    </article>
  `;
}

function renderCompactPastCard(event) {
  const liveStatus = statusForEvent(event);
  return `
    <article class="event-card past-compact" data-id="${escapeHtml(event.id)}" style="--accent:${safeColor(event.color)}" role="button" tabindex="0" aria-label="查看 ${escapeHtml(event.name)}">
      <div class="card-body">
        <div class="card-topline">
          <span class="category-tag">${escapeHtml(event.categoryLabel)}</span>
          <span class="status ${safeClassToken(liveStatus.code)}">${escapeHtml(liveStatus.label)}</span>
        </div>
        <h4>${escapeHtml(event.name)}</h4>
        <p>${escapeHtml(eventRange(event))} · ${escapeHtml(event.location)}</p>
      </div>
    </article>
  `;
}

function usesDetailHistory() {
  return window.matchMedia("(max-width: 1180px)").matches;
}

function selectEvent(id, { pushHistory = true } = {}) {
  const event = state.events.find((item) => item.id === id);
  if (!event) return;
  state.selected = event;
  if (pushHistory && usesDetailHistory() && history.state?.golfEventId !== id) {
    history.pushState({ golfEventDetail: true, golfEventId: id }, "", `#event=${encodeURIComponent(id)}`);
  }
  renderTimeline();
  renderDetail(event);
}

function closeDetailPanel() {
  state.selected = null;
  els.detailPanel.classList.remove("is-open");
  els.emptyDetail.hidden = false;
  els.detailContent.hidden = true;
  renderTimeline();
}

function renderDetail(event) {
  els.detailPanel.classList.add("is-open");
  els.emptyDetail.hidden = true;
  els.detailContent.hidden = false;
  els.detailCategory.textContent = event.categoryLabel;
  els.detailCategory.style.backgroundColor = safeColor(event.color);
  els.detailName.textContent = event.name;
  els.detailMeta.innerHTML = [
    ["比赛时间", eventRange(event)],
    ["报名时间", event.registrationStart || event.registrationEnd ? `${event.registrationStart || "即日起"} - ${event.registrationEnd || "以公告为准"}` : "以单项公告/报名平台为准"],
    ["比赛地点", event.location],
    ...(event.seriesLabel ? [["赛事系列", event.seriesLabel]] : []),
    ["数据来源", event.sourceSystem || "官方网页"]
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");

  const sourceLinks = (event.sourceLinks || []).map((link) => linkButton(link.label || "官方信息", link.url)).join("");
  els.detailActions.innerHTML = [
    sourceLinks,
    linkButton("报名入口", event.signupUrl, "primary")
  ].join("");
  renderDetailAppLinks(event);

  els.detailSignup.textContent = event.signupMethod || event.registrationText || "以官方报名入口实时显示为准。";
  els.detailRequirement.textContent = event.requirement || "以赛事单项规程和补充通知为准。";
  const previewUrl = safeUrl(event.sourceUrl || event.sourceLinks?.[0]?.url || event.signupUrl);
  els.previewOpen.href = previewUrl || "#";
  els.previewDomain.textContent = previewUrl ? new URL(previewUrl).hostname : "官方网页";
}

function getEventAppLinks(event) {
  const haystack = `${event.name} ${event.signupMethod} ${event.requirement} ${event.registrationText}`.toLowerCase();
  return state.appLinks.filter((app) => {
    return (app.match || []).some((term) => haystack.includes(String(term).toLowerCase()));
  });
}

function domainMatches(hostname, domains = []) {
  return domains.some((domain) => {
    const normalized = String(domain).toLowerCase().replace(/^www\./, "");
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

function directSignupButton(app, event) {
  const href = safeUrl(event.signupUrl);
  if (!href || !app.directSignupDomains?.length) return "";

  const hostname = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
  if (!domainMatches(hostname, app.directSignupDomains)) return "";

  const label = app.directSignupLabel || "直接报名";
  return `<a class="primary" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function renderDetailAppLinks(event) {
  const matches = getEventAppLinks(event);
  if (!matches.length) {
    els.detailAppLinks.hidden = true;
    els.detailAppLinks.innerHTML = "";
    return;
  }

  els.detailAppLinks.hidden = false;
  els.detailAppLinks.innerHTML = `
    <h3>App / 小程序入口</h3>
    <div class="app-link-list">
      ${matches.map((app) => `
        <article class="app-link-card">
          <div>
            <strong>${escapeHtml(app.name)}</strong>
            <span>${escapeHtml(app.type)}</span>
          </div>
          <p>${escapeHtml(app.instruction)}</p>
          ${app.wechat ? `<p class="wechat-path">微信搜索：${escapeHtml(app.wechat)}</p>` : ""}
          <div class="app-link-actions">
            ${directSignupButton(app, event)}
            ${safeUrl(app.openUrl, ["weixin:"]) ? `<a href="${escapeHtml(safeUrl(app.openUrl, ["weixin:"]))}">打开微信</a>` : ""}
            ${safeUrl(app.webUrl) ? `<a href="${escapeHtml(safeUrl(app.webUrl))}" target="_blank" rel="noreferrer">官网</a>` : ""}
            ${safeUrl(app.iosUrl, ["http:", "https:", "itms-apps:"]) ? `<a href="${escapeHtml(safeUrl(app.iosUrl, ["http:", "https:", "itms-apps:"]))}" target="_blank" rel="noreferrer">iPhone</a>` : ""}
            ${safeUrl(app.androidUrl, ["http:", "https:", "market:"]) ? `<a href="${escapeHtml(safeUrl(app.androidUrl, ["http:", "https:", "market:"]))}" target="_blank" rel="noreferrer">安卓</a>` : ""}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function bindFilters(container, dataName, setter) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    container.querySelectorAll("button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    setter(button.dataset[dataName]);
    applyFilters();
  });
}

bindFilters(els.categoryFilters, "category", (value) => state.category = value);
bindFilters(els.statusFilters, "status", (value) => state.status = value);

els.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  applyFilters();
});

els.monthSelect.addEventListener("change", (event) => {
  state.month = event.target.value;
  applyFilters();
});

els.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  applyFilters();
});

els.directOnly.addEventListener("change", (event) => {
  state.directOnly = event.target.checked;
  applyFilters();
});

els.closeDetail.addEventListener("click", () => {
  if (usesDetailHistory() && history.state?.golfEventDetail) {
    history.back();
    return;
  }
  closeDetailPanel();
});

window.addEventListener("popstate", (event) => {
  if (event.state?.golfEventDetail && event.state.golfEventId) {
    selectEvent(event.state.golfEventId, { pushHistory: false });
    return;
  }
  closeDetailPanel();
});

function setFiltersOpen(open) {
  document.body.classList.toggle("filters-open", open);
  els.filterToggle.setAttribute("aria-expanded", String(open));
  els.filterToggle.textContent = open ? "收起" : "筛选";
}

els.filterToggle.addEventListener("click", () => {
  setFiltersOpen(!document.body.classList.contains("filters-open"));
});

els.categoryFilters.addEventListener("click", () => {
  if (window.matchMedia("(max-width: 760px)").matches) setFiltersOpen(false);
});

els.statusFilters.addEventListener("click", () => {
  if (window.matchMedia("(max-width: 760px)").matches) setFiltersOpen(false);
});

els.refreshButton.addEventListener("click", async () => {
  if (!state.hasLiveApi) {
    els.refreshButton.textContent = "08:00 至 22:00 整点更新";
    setTimeout(() => els.refreshButton.textContent = "白天每小时更新", 1800);
    return;
  }
  els.refreshButton.disabled = true;
  els.refreshButton.textContent = "更新中...";
  try {
    const response = await fetch("/api/update", { method: "POST" });
    if (!response.ok) throw new Error("更新失败");
    await loadData();
    els.refreshButton.textContent = "已更新";
    setTimeout(() => els.refreshButton.textContent = "更新官方数据", 1600);
  } catch {
    els.refreshButton.textContent = "更新失败";
    setTimeout(() => els.refreshButton.textContent = "更新官方数据", 1600);
  } finally {
    els.refreshButton.disabled = false;
  }
});

loadData().catch(() => {
  els.updatedAt.textContent = "赛事数据暂时无法读取";
  els.resultTitle.textContent = "加载失败";
  els.timeline.setAttribute("aria-busy", "false");
  els.timeline.innerHTML = `<div class="empty-list">网络连接异常，请稍后重新打开</div>`;
});
