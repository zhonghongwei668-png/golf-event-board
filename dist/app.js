const state = {
  data: null,
  sources: [],
  events: [],
  filtered: [],
  selected: null,
  category: "all",
  status: "all",
  month: "all",
  sort: "asc",
  search: "",
  hasLiveApi: false
};

const els = {
  updatedAt: document.querySelector("#updatedAt"),
  stats: document.querySelector("#stats"),
  categoryFilters: document.querySelector("#categoryFilters"),
  statusFilters: document.querySelector("#statusFilters"),
  searchInput: document.querySelector("#searchInput"),
  monthSelect: document.querySelector("#monthSelect"),
  sortSelect: document.querySelector("#sortSelect"),
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
  detailSignup: document.querySelector("#detailSignup"),
  detailRequirement: document.querySelector("#detailRequirement"),
  sourceFrame: document.querySelector("#sourceFrame"),
  previewOpen: document.querySelector("#previewOpen"),
  closeDetail: document.querySelector("#closeDetail")
};

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
  return new Date(`${event.endDate}T23:59:59+08:00`) >= todayInShanghai();
}

function hasDeadline(event) {
  return Boolean(event.registrationEnd);
}

function daysUntil(dateText) {
  if (!dateText) return null;
  const date = new Date(`${dateText.slice(0, 10)}T23:59:59+08:00`);
  const diff = date.getTime() - todayInShanghai().getTime();
  return Math.ceil(diff / 86400000);
}

function isHotEvent(event) {
  return /汇丰|斐乐|CJGT|精英|锦标赛|公开赛|如歌|宝马|BMW|劳力士|沃尔沃|冯珊珊|朝向/i.test(event.name);
}

function linkButton(label, url, tone = "") {
  if (!url) return "";
  return `<a class="action-link ${tone}" href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
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
  return fetch("./data/events.json", { cache: "no-store" });
}

async function fetchSources() {
  try {
    const response = await fetch("./data/sources.json", { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    return payload.sources || [];
  } catch {
    return [];
  }
}

async function loadData() {
  const response = await fetchData();
  if (!response.ok) throw new Error("赛事数据读取失败");
  state.data = await response.json();
  state.sources = await fetchSources();
  state.events = state.data.events || [];
  renderMonths();
  applyFilters();
  renderStats();
  renderAlerts();
  renderWatchPanel();
  const generated = state.data.generatedAt ? new Date(state.data.generatedAt) : null;
  els.updatedAt.textContent = generated ? `最近更新 ${generated.toLocaleString("zh-CN", { hour12: false })}` : "已读取本地数据";
  els.refreshButton.textContent = state.hasLiveApi ? "更新官方数据" : "每日自动更新";
  els.refreshButton.title = state.hasLiveApi ? "立即从官方来源刷新" : "公网静态版由定时任务每日自动更新";
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
      <span>白天每小时检查</span>
    </div>
    <div class="alert-grid">
      ${candidates.map(({ event, deadlineDays }) => `
        <button class="alert-card" data-id="${event.id}" style="--accent:${event.color}">
          <strong>${event.name}</strong>
          <span>${event.registrationEnd ? `报名截止：${event.registrationEnd}` : "热门赛事，关注官方首发"}</span>
          <em>${deadlineDays === null ? event.categoryLabel : deadlineDays <= 0 ? "今天/已临近" : `${deadlineDays} 天内`}</em>
        </button>
      `).join("")}
    </div>
  `;

  els.alertsPanel.querySelectorAll(".alert-card").forEach((card) => {
    card.addEventListener("click", () => selectEvent(card.dataset.id));
  });
}

function renderWatchPanel() {
  const high = state.sources.filter((source) => source.priority === "高").slice(0, 8);
  if (!high.length) {
    els.watchPanel.innerHTML = "";
    return;
  }

  els.watchPanel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">一手资讯源</p>
        <h3>青少年热门赛事发布平台</h3>
      </div>
      <span>${state.sources.length} 个渠道</span>
    </div>
    <div class="source-grid">
      ${high.map((source) => `
        <article class="source-card">
          <div>
            <strong>${source.name}</strong>
            <span>${source.type} · ${source.priority}优先级</span>
          </div>
          <p>${source.watch}</p>
          <div class="source-actions">
            ${source.url ? `<a href="${source.url}" target="_blank" rel="noreferrer">官网</a>` : ""}
            ${source.wechat ? `<span>微信：${source.wechat}</span>` : ""}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderMonths() {
  const months = [...new Set(state.events.map(monthKey))].sort();
  els.monthSelect.innerHTML = `<option value="all">全年</option>` + months.map((key) => (
    `<option value="${key}">${monthLabel(key)}</option>`
  )).join("");
}

function renderStats() {
  const counts = state.events.reduce((memo, event) => {
    memo.total += 1;
    memo[event.category] = (memo[event.category] || 0) + 1;
    if (isFuture(event)) memo.future += 1;
    if (event.statusCode === "open") memo.open += 1;
    return memo;
  }, { total: 0, future: 0, open: 0 });

  els.stats.innerHTML = [
    ["全部", counts.total],
    ["未来", counts.future],
    ["女子", counts.women || 0],
    ["业余", counts.amateur || 0],
    ["青少年", counts.junior || 0]
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function applyFilters() {
  const q = state.search.trim().toLowerCase();
  state.filtered = state.events.filter((event) => {
    const matchesCategory = state.category === "all" || event.category === state.category;
    const matchesMonth = state.month === "all" || monthKey(event) === state.month;
    const haystack = `${event.name} ${event.location} ${event.signupMethod} ${event.requirement}`.toLowerCase();
    const matchesSearch = !q || haystack.includes(q);
    let matchesStatus = true;
    if (state.status === "future") matchesStatus = isFuture(event);
    if (state.status === "open") matchesStatus = event.statusCode === "open";
    if (state.status === "deadline") matchesStatus = hasDeadline(event);
    return matchesCategory && matchesMonth && matchesSearch && matchesStatus;
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

  const groups = new Map();
  for (const event of state.filtered) {
    const key = monthKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }

  els.timeline.innerHTML = [...groups.entries()].map(([key, events]) => `
    <section class="month-group">
      <div class="month-heading">
        <h3>${monthLabel(key)}</h3>
        <span>${events.length} 场</span>
      </div>
      <div class="event-grid">
        ${events.map(renderCard).join("")}
      </div>
    </section>
  `).join("");

  els.timeline.querySelectorAll(".event-card").forEach((card) => {
    card.addEventListener("click", () => selectEvent(card.dataset.id));
  });
}

function renderCard(event) {
  const deadline = event.registrationEnd ? `<span>报名至 ${event.registrationEnd}</span>` : `<span>${event.statusLabel}</span>`;
  const selectedClass = state.selected?.id === event.id ? " is-selected" : "";
  return `
    <article class="event-card${selectedClass}" data-id="${event.id}" style="--accent:${event.color}">
      <div class="date-box">
        <strong>${cnDate(event.startDate)}</strong>
        <span>${event.endDate && event.endDate !== event.startDate ? `至 ${cnDate(event.endDate)}` : event.categoryLabel}</span>
      </div>
      <div class="card-body">
        <div class="card-topline">
          <span class="category-tag">${event.categoryLabel}</span>
          <span class="status ${event.statusCode}">${event.statusLabel}</span>
        </div>
        <h4>${event.name}</h4>
        <p>${event.location}</p>
        <div class="card-footer">
          ${deadline}
          <span>${event.sourceSystem || "官方信息源"}</span>
        </div>
      </div>
    </article>
  `;
}

function selectEvent(id) {
  const event = state.events.find((item) => item.id === id);
  if (!event) return;
  state.selected = event;
  renderTimeline();
  renderDetail(event);
}

function renderDetail(event) {
  els.detailPanel.classList.add("is-open");
  els.emptyDetail.hidden = true;
  els.detailContent.hidden = false;
  els.detailCategory.textContent = event.categoryLabel;
  els.detailCategory.style.backgroundColor = event.color;
  els.detailName.textContent = event.name;
  els.detailMeta.innerHTML = [
    ["比赛时间", eventRange(event)],
    ["报名时间", event.registrationStart || event.registrationEnd ? `${event.registrationStart || "即日起"} - ${event.registrationEnd || "以公告为准"}` : "以单项公告/报名平台为准"],
    ["比赛地点", event.location],
    ["数据来源", event.sourceSystem || "官方网页"]
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");

  const sourceLinks = (event.sourceLinks || []).map((link) => linkButton(link.label || "官方信息", link.url)).join("");
  els.detailActions.innerHTML = [
    sourceLinks,
    linkButton("报名入口", event.signupUrl, "primary")
  ].join("");

  els.detailSignup.textContent = event.signupMethod || event.registrationText || "以官方报名入口实时显示为准。";
  els.detailRequirement.textContent = event.requirement || "以赛事单项规程和补充通知为准。";
  const previewUrl = event.sourceUrl || event.sourceLinks?.[0]?.url || event.signupUrl;
  els.previewOpen.href = previewUrl;
  els.sourceFrame.src = previewUrl;
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

els.closeDetail.addEventListener("click", () => {
  state.selected = null;
  els.detailPanel.classList.remove("is-open");
  els.emptyDetail.hidden = false;
  els.detailContent.hidden = true;
  els.sourceFrame.src = "about:blank";
  renderTimeline();
});

els.refreshButton.addEventListener("click", async () => {
  if (!state.hasLiveApi) {
    els.refreshButton.textContent = "公网版每日自动更新";
    setTimeout(() => els.refreshButton.textContent = "每日自动更新", 1800);
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

loadData();
