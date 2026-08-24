import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { isRegistrationOpenAt, shanghaiDateString } from "../event-logic.js";
import { shouldAlertFailure } from "./lib/source-health.mjs";
import {
  ensureNotificationMessage,
  hasSeenOpenEvent,
  markOpenEventSeen,
  markNotificationDelivery,
  pendingNotificationMessages,
  readNotificationState,
  writeNotificationState
} from "./lib/notification-state.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const eventDataPath = "data/events.json";
const sourceHealthPath = "data/source-health.json";
const notificationStatePath = path.join(rootDir, "data/notification-state.json");
const siteUrl = process.env.NOTIFY_SITE_URL || "https://zhonghongwei668-png.github.io/golf-event-board/";
const strictFailure = process.env.NOTIFY_STRICT === "1";
const requireWebhook = process.env.NOTIFY_REQUIRE_WEBHOOK === "1";

function argValue(name) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  if (arg) return arg.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function readPayload(ref) {
  if (!ref || ref === "working") {
    return JSON.parse(await readFile(path.join(rootDir, eventDataPath), "utf8"));
  }

  try {
    const { stdout } = await execFileAsync("git", ["show", `${ref}:${eventDataPath}`], {
      cwd: rootDir,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    console.warn(`Could not read ${eventDataPath} at ${ref}: ${error.message}`);
    return null;
  }
}

function eventKey(event) {
  return event.id || `${event.category}:${event.name}:${event.startDate || "undated"}`;
}

function eventIdentity(event) {
  const normalizedName = String(event.name || "")
    .toLowerCase()
    .replace(/[（(]\s*(?:青少|业余)?[一二三四五]级(?:[一二三四]档)?赛?\s*[）)]/gu, "")
    .replace(/[\s\p{P}\p{S}]/gu, "");
  return `${event.category || ""}:${normalizedName}`;
}

export function openHistoryKeys(event) {
  const keys = [
    event.id ? `id:${event.id}` : "",
    `identity:${eventIdentity(event)}`
  ];
  for (const [source, value] of Object.entries(event.externalIds || {})) {
    if (value !== undefined && value !== null && String(value)) {
      keys.push(`external:${source}:${value}`);
    }
  }
  const dazhengId = String(event.signupUrl || event.sourceUrl || "").match(/[?&]event_id=(\d+)/)?.[1];
  if (dazhengId) keys.push(`external:dazheng:${dazhengId}`);
  return [...new Set(keys.filter(Boolean))];
}

function dateDistanceDays(left, right) {
  const leftTime = Date.parse(`${left || ""}T00:00:00Z`);
  const rightTime = Date.parse(`${right || ""}T00:00:00Z`);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftTime - rightTime) / 86400000;
}

function formatDateRange(event) {
  if (!event.startDate) return "日期待定";
  if (!event.endDate || event.endDate === event.startDate) return event.startDate;
  return `${event.startDate} 至 ${event.endDate}`;
}

function formatPriorityOpenEvent(event) {
  const signup = event.signupUrl ? `，[报名入口](${event.signupUrl})` : "";
  return `- **【重点】新开放报名｜${formatDateRange(event)}｜${event.name}${signup}**`;
}

function compactDate(value = "") {
  const match = String(value).match(/^\d{4}-(\d{2})-(\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
  if (!match) return value || "—";
  const date = `${Number(match[1])}/${Number(match[2])}`;
  return match[3] ? `${date} ${match[3]}` : date;
}

function compactDateRange(event) {
  if (!event.startDate) return "待定";
  const start = compactDate(event.startDate);
  if (!event.endDate || event.endDate === event.startDate) return start;
  return `${start}–${compactDate(event.endDate)}`;
}

function compactTableText(value = "", maxLength = 24) {
  const text = String(value).replaceAll("|", "｜").replace(/\s+/g, " ").trim();
  const characters = [...text];
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join("")}…` : text;
}

function formatOpenDigestRow(event) {
  return `| ${compactDateRange(event)} | ${compactTableText(event.name)} |`;
}

function isOpenRegistration(event, now) {
  return isRegistrationOpenAt(event, now);
}

function changedFields(before, after) {
  const comparable = (value) => {
    if (value === undefined || value === null) return "";
    return Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : value;
  };
  return [
    ["name", "赛事名称"],
    ["statusLabel", "状态"],
    ["registrationStart", "报名开始"],
    ["signupUrl", "报名入口"],
    ["signupMethod", "报名方式"],
    ["sourceUrl", "信息源"],
    ["sourceLinks", "信息源链接"],
    ["startDate", "比赛开始"],
    ["endDate", "比赛结束"],
    ["location", "比赛地点"],
    ["requirement", "参赛要求"],
    ["competitionGrade", "赛事级别"],
  ]
    .filter(([key]) => comparable(before[key]) !== comparable(after[key]))
    .filter(([key]) => key !== "statusLabel" || !/报名截止|已截止|报名结束|已满/.test(String(after[key] || "")))
    .map(([, label]) => label);
}

function eventIsHistorical(event, today) {
  const lastDate = event.endDate || event.startDate;
  return Boolean(lastDate && lastDate < today);
}

function diffEvents(previousPayload, currentPayload, options = {}) {
  const previousEvents = previousPayload?.events || [];
  const currentEvents = currentPayload?.events || [];
  const previousByKey = new Map(previousEvents.map((event) => [eventKey(event), event]));
  const previousByIdentity = new Map();
  for (const event of previousEvents) {
    const identity = eventIdentity(event);
    previousByIdentity.set(identity, [...(previousByIdentity.get(identity) || []), event]);
  }
  const matchedPrevious = new Set();

  const added = [];
  const opened = [];
  const priorityOpen = [];
  const changed = [];
  const removed = [];
  const historicalBackfill = [];
  const today = options.today || shanghaiDateString(new Date());
  const todayNow = options.today ? new Date(`${options.today}T00:00:00+08:00`) : new Date();

  for (const event of currentEvents) {
    const exact = previousByKey.get(eventKey(event));
    let previous = exact && !matchedPrevious.has(exact) ? exact : null;
    if (!previous) {
      const candidates = (previousByIdentity.get(eventIdentity(event)) || [])
        .filter((candidate) => !matchedPrevious.has(candidate))
        .sort((a, b) => dateDistanceDays(a.startDate, event.startDate) - dateDistanceDays(b.startDate, event.startDate));
      if (candidates.length === 1 || dateDistanceDays(candidates[0]?.startDate, event.startDate) <= 45) {
        previous = candidates[0] || null;
      }
    }
    if (!previous) {
      if (eventIsHistorical(event, today)) {
        historicalBackfill.push(event);
        continue;
      }
      added.push(event);
      if (isOpenRegistration(event, todayNow) && !options.wasOpenBefore?.(event)) priorityOpen.push(event);
      continue;
    }
    matchedPrevious.add(previous);

    const fields = eventIsHistorical(event, today) ? [] : changedFields(previous, event);
    if (fields.length) {
      changed.push({ event, fields });
    }
    if (!isOpenRegistration(previous, todayNow) && isOpenRegistration(event, todayNow)) {
      opened.push(event);
      if (!options.wasOpenBefore?.(event)) priorityOpen.push(event);
    }
  }

  for (const event of previousEvents) {
    if (!matchedPrevious.has(event) && !eventIsHistorical(event, today)) {
      removed.push(event);
    }
  }

  return { added, opened, priorityOpen, changed, removed, historicalBackfill };
}

const ANNOUNCEMENT_MAX_AGE_DAYS = {
  deadline: 1,
  supplemental: 7,
  open: 14,
  regulation: 30
};

function relativeAnnouncementMaxAge(title = "") {
  const text = String(title);
  if (/今日|今天|今晚|今早|今晨/.test(text)) return 0;
  if (/明日|明天/.test(text)) return 1;
  if (/最后\s*一天/.test(text)) return 0;
  const countdown = text.match(/(?:倒计时|最后)\s*(\d+)\s*天/);
  return countdown ? Math.min(Number(countdown[1]), 7) : Infinity;
}

export function isAnnouncementFresh(announcement, today = shanghaiDateString(new Date())) {
  const published = String(announcement?.publishedAt || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!published) return false;
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  const publishedTime = Date.parse(`${published}T00:00:00Z`);
  if (!Number.isFinite(todayTime) || !Number.isFinite(publishedTime)) return false;
  const ageDays = (todayTime - publishedTime) / 86400000;
  const maxAgeDays = Math.min(
    ANNOUNCEMENT_MAX_AGE_DAYS[announcement.kind] ?? 14,
    relativeAnnouncementMaxAge(announcement.title)
  );
  return ageDays >= -1 && ageDays <= maxAgeDays;
}

export function diffOfficialAnnouncements(previousPayload, currentPayload, options = {}) {
  if (!Array.isArray(previousPayload?.announcements)) return [];
  const previousIds = new Set(previousPayload.announcements.map((item) => item.id));
  const previousSources = new Set(previousPayload.announcements.map((item) => item.source).filter(Boolean));
  const today = options.today || shanghaiDateString(new Date());
  return (currentPayload?.announcements || []).filter((item) => (
    !previousIds.has(item.id)
    && item.kind !== "deadline"
    && isAnnouncementFresh(item, today)
    && (!item.source || previousSources.has(item.source) || item.publishedAt >= today)
  ));
}

export function diffDazhengAnnouncements(previousPayload, currentPayload, options = {}) {
  return diffOfficialAnnouncements(previousPayload, currentPayload, options);
}

function topItems(items, formatter, limit = 8) {
  const visible = items.slice(0, limit).map(formatter);
  if (items.length > limit) visible.push(`- 另有 ${items.length - limit} 条，打开赛历查看`);
  return visible.join("\n");
}

function buildMarkdown(diff, currentPayload) {
  if (!diff.priorityOpen?.length) return "";

  const generatedAt = currentPayload?.generatedAt
    ? new Date(currentPayload.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    : new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  return [
    "### 高尔夫赛事报名开始提醒",
    `更新时间：${generatedAt}`,
    "",
    `**新开放报名 ${diff.priorityOpen.length} 场**\n${topItems(diff.priorityOpen, formatPriorityOpenEvent, 10)}`,
    "",
    `[打开赛事日历](${siteUrl})`,
  ].join("\n");
}

export function buildChangeNotification(previousPayload, currentPayload, options = {}) {
  const diff = diffEvents(previousPayload, currentPayload, options);
  return buildMarkdown(diff, currentPayload);
}

export function buildOpenRegistrationDigest(currentPayload) {
  const events = (currentPayload?.events || [])
    .filter((event) => isRegistrationOpenAt(event))
    .sort((a, b) => {
      const ad = a.startDate || "9999-12-31";
      const bd = b.startDate || "9999-12-31";
      return ad.localeCompare(bd) || (a.endDate || ad).localeCompare(b.endDate || bd) || a.name.localeCompare(b.name, "zh-CN");
    });

  const generatedAt = currentPayload?.generatedAt
    ? new Date(currentPayload.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    : new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const checkedAt = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  const eventTable = events.length
    ? [
        "| 比赛日期 | 赛事名称 |",
        "| --- | --- |",
        ...events.map(formatOpenDigestRow),
      ].join("\n")
    : "当前没有状态为“可报名”的赛事。";

  return [
    `### 可报名赛事一览（${events.length}场）`,
    `检测：${checkedAt}｜数据更新：${generatedAt}`,
    "",
    eventTable,
    "",
    `[查看完整名称、资格要求和报名入口](${siteUrl})`,
  ].join("\n");
}

export function buildSourceHealthNotification(health) {
  const sources = Object.values(health?.sources || {});
  const degraded = sources.filter((source) => (
    source.status === "degraded" && shouldAlertFailure(source.consecutiveFailures)
  ));
  const recovered = sources.filter((source) => source.recovered);
  if (!degraded.length && !recovered.length) return "";

  const checkedAt = health?.checkedAt
    ? new Date(health.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    : new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const sections = [];
  if (degraded.length) {
    sections.push([
      `**【报警】${degraded.length} 个信息源更新异常**`,
      ...degraded.map((source) => (
        `- ${source.label}｜连续失败 ${source.consecutiveFailures} 次｜${source.error}`
      ))
    ].join("\n"));
  }
  if (recovered.length) {
    sections.push([
      `**【恢复】${recovered.length} 个信息源已恢复**`,
      ...recovered.map((source) => `- ${source.label}｜本次抓取 ${source.itemCount} 条`)
    ].join("\n"));
  }
  return [
    "### 高尔夫赛历信息源健康提醒",
    `检测时间：${checkedAt}`,
    "",
    sections.join("\n\n"),
    "",
    `[查看自动任务](${siteUrl})`
  ].join("\n");
}

async function postJson(url, payload, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);

      try {
        const json = JSON.parse(text);
        if (json.errcode && json.errcode !== 0) throw new Error(text);
      } catch (error) {
        if (text.trim().startsWith("{")) throw error;
      }
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw lastError;
}

function signedDingTalkUrl(webhook, secret) {
  if (!secret) return webhook;
  const timestamp = Date.now();
  const sign = createHmac("sha256", secret)
    .update(`${timestamp}\n${secret}`)
    .digest("base64");
  const separator = webhook.includes("?") ? "&" : "?";
  return `${webhook}${separator}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

export function configuredDingTalkTargets(env = process.env) {
  const candidates = [
    { id: "dingtalk-primary", label: "主机器人", webhook: env.DINGTALK_WEBHOOK, secret: env.DINGTALK_SECRET },
    { id: "dingtalk-secondary", label: "第二机器人", webhook: env.DINGTALK_WEBHOOK_2, secret: env.DINGTALK_SECRET_2 },
  ];
  const seen = new Set();
  return candidates.filter((target) => {
    if (!target.webhook || seen.has(target.webhook)) return false;
    seen.add(target.webhook);
    return true;
  });
}

function assertDingTalkConfiguration(targets) {
  const expectedTargets = Number(process.env.DINGTALK_EXPECTED_TARGETS || 0);
  if (expectedTargets && targets.length < expectedTargets) {
    throw new Error(`DingTalk robots configured: ${targets.length}/${expectedTargets}`);
  }
}

async function notifyDingTalk(markdown, options = {}) {
  const targets = configuredDingTalkTargets();
  assertDingTalkConfiguration(targets);
  if (!targets.length) return false;

  const kind = options.kind || "event-change";
  const title = options.title || "高尔夫赛事报名信息更新";
  const state = await readNotificationState(notificationStatePath);
  const { fingerprint, message } = ensureNotificationMessage(state, {
    kind,
    title,
    markdown,
    targetIds: targets.map((target) => target.id)
  });
  const failures = [];
  let newlySent = 0;

  for (const target of targets) {
    if (message.targets?.[target.id]?.status === "sent") {
      console.log(`Skipped ${target.label}: this message was already delivered.`);
      continue;
    }
    try {
      await postJson(signedDingTalkUrl(target.webhook, target.secret), {
        msgtype: "markdown",
        markdown: { title, text: markdown },
        at: { isAtAll: false },
      });
      markNotificationDelivery(state, fingerprint, target.id, { ok: true });
      newlySent += 1;
    } catch (error) {
      markNotificationDelivery(state, fingerprint, target.id, { ok: false, error: error.message });
      failures.push({ target, error });
    }
    await writeNotificationState(notificationStatePath, state);
  }

  if (failures.length) {
    throw new Error(failures.map(({ target, error }) => `${target.label}: ${error.message}`).join("; "));
  }

  console.log(`DingTalk delivery complete: ${newlySent} sent, ${targets.length - newlySent} already delivered.`);
  return targets.length;
}

async function retryPendingDingTalkNotifications() {
  assertDingTalkConfiguration(configuredDingTalkTargets());
  const state = await readNotificationState(notificationStatePath);
  const pending = pendingNotificationMessages(state).slice(0, 20);
  if (!pending.length) {
    console.log("No pending DingTalk notifications.");
    return 0;
  }

  const failures = [];
  for (const message of pending) {
    try {
      await notifyDingTalk(message.markdown, { kind: message.kind, title: message.title });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new Error(`${failures.length} pending notification(s) still failed: ${failures[0].message}`);
  return pending.length;
}

async function notifyWeWork(markdown) {
  const webhook = process.env.WEWORK_WEBHOOK;
  if (!webhook) return false;

  await postJson(webhook, {
    msgtype: "markdown",
    markdown: { content: markdown },
  });
  console.log("Sent WeCom notification");
  return true;
}

async function main() {
  if (process.argv.includes("--retry-pending") || process.env.NOTIFY_RETRY_PENDING === "1") {
    try {
      await retryPendingDingTalkNotifications();
    } catch (error) {
      console.warn(`Pending DingTalk retry failed: ${error.message}`);
      if (strictFailure || requireWebhook) process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes("--source-health") || process.env.NOTIFY_SOURCE_HEALTH === "1") {
    const health = JSON.parse(await readFile(path.join(rootDir, sourceHealthPath), "utf8"));
    const markdown = buildSourceHealthNotification(health);
    if (!markdown) {
      console.log("No source health alert needed.");
      return;
    }
    if (process.env.NOTIFY_DRY_RUN === "1") {
      console.log(markdown);
      return;
    }
    const sent = await notifyDingTalk(markdown, {
      kind: "source-health",
      title: "高尔夫赛历信息源健康提醒"
    });
    if (!sent && (requireWebhook || strictFailure)) process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--open-digest") || process.env.NOTIFY_OPEN_DIGEST === "1") {
    const currentPayload = await readPayload(argValue("--head") || process.env.NOTIFY_HEAD_REF || "working");
    const markdown = buildOpenRegistrationDigest(currentPayload);

    if (process.env.NOTIFY_DRY_RUN === "1") {
      console.log(markdown);
      return;
    }

    const results = await Promise.allSettled([
      notifyDingTalk(markdown, { kind: "open-digest", title: "可报名赛事一览" }),
      notifyWeWork(markdown),
    ]);
    const sent = results.some((result) => result.status === "fulfilled" && result.value);
    const failures = results.filter((result) => result.status === "rejected");

    for (const failure of failures) {
      console.warn(`Notification failed: ${failure.reason.message}`);
    }
    if (!sent && !failures.length) {
      console.log("Notification skipped: no webhook secrets configured.");
      if (requireWebhook || strictFailure) process.exitCode = 1;
    }
    if (strictFailure && failures.length) {
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes("--test") || process.env.NOTIFY_TEST === "1") {
    const markdown = [
      "### 高尔夫赛事报名提醒测试",
      `测试时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
      "",
      "- 钉钉机器人已接入赛事报名日历。",
      "- 后续只在发现新的赛事报名开始时推送消息。",
      "",
      `[打开赛事日历](${siteUrl})`,
    ].join("\n");

    if (process.env.NOTIFY_DRY_RUN === "1") {
      console.log(markdown);
      return;
    }

    const results = await Promise.allSettled([
      notifyDingTalk(markdown, { kind: "test", title: "高尔夫赛事报名提醒测试" }),
      notifyWeWork(markdown),
    ]);
    const sent = results.some((result) => result.status === "fulfilled" && result.value);
    const failures = results.filter((result) => result.status === "rejected");

    for (const failure of failures) {
      console.warn(`Notification failed: ${failure.reason.message}`);
    }
    if (!sent && !failures.length) {
      console.log("Notification skipped: no webhook secrets configured.");
      if (requireWebhook || strictFailure) process.exitCode = 1;
    }
    if (strictFailure && failures.length) {
      process.exitCode = 1;
    }
    return;
  }

  const baseRef = argValue("--base") || process.env.NOTIFY_BASE_REF || "HEAD~1";
  const headRef = argValue("--head") || process.env.NOTIFY_HEAD_REF || "working";
  const previousPayload = await readPayload(baseRef);
  const currentPayload = await readPayload(headRef);

  if (!previousPayload || !currentPayload) {
    console.log("Notification skipped: missing comparable event data.");
    return;
  }

  const notificationState = await readNotificationState(notificationStatePath);
  const markdown = buildChangeNotification(previousPayload, currentPayload, {
    wasOpenBefore: (event) => hasSeenOpenEvent(notificationState, openHistoryKeys(event))
  });
  const seenAt = currentPayload.generatedAt || new Date().toISOString();
  let openHistoryChanged = false;
  for (const event of (currentPayload.events || []).filter((item) => isOpenRegistration(item))) {
    openHistoryChanged = markOpenEventSeen(notificationState, openHistoryKeys(event), seenAt) || openHistoryChanged;
  }
  if (openHistoryChanged && process.env.NOTIFY_DRY_RUN !== "1") {
    await writeNotificationState(notificationStatePath, notificationState);
  }

  if (!markdown) {
    console.log("No newly open registrations to notify.");
    return;
  }

  if (process.env.NOTIFY_DRY_RUN === "1") {
    console.log(markdown);
    return;
  }

  const results = await Promise.allSettled([
    notifyDingTalk(markdown, { kind: "event-change", title: "高尔夫赛事报名开始提醒" }),
    notifyWeWork(markdown),
  ]);
  const sent = results.some((result) => result.status === "fulfilled" && result.value);
  const failures = results.filter((result) => result.status === "rejected");

  for (const failure of failures) {
    console.warn(`Notification failed: ${failure.reason.message}`);
  }
  if (!sent && !failures.length) {
    console.log("Notification skipped: no webhook secrets configured.");
    if (requireWebhook) process.exitCode = 1;
  }
  if (strictFailure && failures.length) {
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error);
    if (strictFailure || requireWebhook) process.exitCode = 1;
  });
}
