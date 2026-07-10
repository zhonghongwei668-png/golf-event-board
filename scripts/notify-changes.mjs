import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { isRegistrationOpenAt } from "../event-logic.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const eventDataPath = "data/events.json";
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

function formatDateRange(event) {
  if (!event.startDate) return "日期待定";
  if (!event.endDate || event.endDate === event.startDate) return event.startDate;
  return `${event.startDate} 至 ${event.endDate}`;
}

function formatEvent(event) {
  const label = event.categoryLabel || event.category || "赛事";
  const deadline = event.registrationEnd ? `，报名截止 ${event.registrationEnd}` : "";
  return `- ${label}｜${event.name}｜${formatDateRange(event)}${deadline}`;
}

function formatPriorityOpenEvent(event) {
  const deadline = event.registrationEnd ? `，报名截止 ${event.registrationEnd}` : "";
  const signup = event.signupUrl ? `，[报名入口](${event.signupUrl})` : "";
  return `- **【重点】新开放报名｜${formatDateRange(event)}｜${event.name}${deadline}${signup}**`;
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
  return `| ${compactDateRange(event)} | ${compactTableText(event.name)} | ${compactDate(event.registrationEnd)} |`;
}

function isOpenRegistration(event) {
  return isRegistrationOpenAt(event);
}

function changedFields(before, after) {
  return [
    ["statusLabel", "状态"],
    ["registrationStart", "报名开始"],
    ["registrationEnd", "报名截止"],
    ["signupUrl", "报名入口"],
    ["sourceUrl", "信息源"],
    ["startDate", "比赛开始"],
    ["endDate", "比赛结束"],
  ]
    .filter(([key]) => (before[key] || "") !== (after[key] || ""))
    .map(([, label]) => label);
}

function diffEvents(previousPayload, currentPayload) {
  const previousEvents = previousPayload?.events || [];
  const currentEvents = currentPayload?.events || [];
  const previousByKey = new Map(previousEvents.map((event) => [eventKey(event), event]));
  const currentByKey = new Map(currentEvents.map((event) => [eventKey(event), event]));

  const added = [];
  const opened = [];
  const priorityOpen = [];
  const changed = [];
  const removed = [];

  for (const [key, event] of currentByKey) {
    const previous = previousByKey.get(key);
    if (!previous) {
      added.push(event);
      if (isOpenRegistration(event)) priorityOpen.push(event);
      continue;
    }

    const fields = changedFields(previous, event);
    if (fields.length) {
      changed.push({ event, fields });
    }
    if (!isOpenRegistration(previous) && isOpenRegistration(event)) {
      opened.push(event);
      priorityOpen.push(event);
    }
  }

  for (const [key, event] of previousByKey) {
    if (!currentByKey.has(key)) {
      removed.push(event);
    }
  }

  return { added, opened, priorityOpen, changed, removed };
}

function topItems(items, formatter, limit = 8) {
  const visible = items.slice(0, limit).map(formatter);
  if (items.length > limit) visible.push(`- 另有 ${items.length - limit} 条，打开赛历查看`);
  return visible.join("\n");
}

function buildMarkdown(diff, currentPayload) {
  const sections = [];
  const priorityOpenKeys = new Set((diff.priorityOpen || []).map(eventKey));
  const regularAdded = diff.added.filter((event) => !priorityOpenKeys.has(eventKey(event)));
  const regularChanged = diff.changed.filter(({ event }) => !priorityOpenKeys.has(eventKey(event)));

  if (diff.priorityOpen?.length) {
    sections.push(`**【重点】新开放报名 ${diff.priorityOpen.length} 场**\n${topItems(diff.priorityOpen, formatPriorityOpenEvent, 10)}`);
  }
  if (regularAdded.length) {
    sections.push(`**新增赛事 ${regularAdded.length} 场**\n${topItems(regularAdded, formatEvent)}`);
  }
  if (regularChanged.length) {
    sections.push(`**报名/日期/入口变化 ${regularChanged.length} 条**\n${topItems(regularChanged, ({ event, fields }) => `${formatEvent(event)}，变化：${fields.join("、")}`)}`);
  }
  if (diff.removed.length) {
    sections.push(`**赛事下架/消失 ${diff.removed.length} 条**\n${topItems(diff.removed, formatEvent)}\n需人工核验是否取消、改名或官方接口暂时缺失。`);
  }

  if (!sections.length) return "";

  const generatedAt = currentPayload?.generatedAt
    ? new Date(currentPayload.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })
    : new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  return [
    "### 高尔夫赛事报名信息更新",
    `更新时间：${generatedAt}`,
    "",
    sections.join("\n\n"),
    "",
    `[打开赛事日历](${siteUrl})`,
  ].join("\n");
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
        "| 比赛日期 | 赛事名称 | 报名截止 |",
        "| --- | --- | --- |",
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
    { label: "主机器人", webhook: env.DINGTALK_WEBHOOK, secret: env.DINGTALK_SECRET },
    { label: "第二机器人", webhook: env.DINGTALK_WEBHOOK_2, secret: env.DINGTALK_SECRET_2 },
  ];
  const seen = new Set();
  return candidates.filter((target) => {
    if (!target.webhook || seen.has(target.webhook)) return false;
    seen.add(target.webhook);
    return true;
  });
}

async function notifyDingTalk(markdown) {
  const targets = configuredDingTalkTargets();
  if (!targets.length) return false;

  const results = await Promise.allSettled(targets.map((target) => (
    postJson(signedDingTalkUrl(target.webhook, target.secret), {
      msgtype: "markdown",
      markdown: {
        title: "高尔夫赛事报名信息更新",
        text: markdown,
      },
      at: { isAtAll: false },
    })
  )));
  const failures = results
    .map((result, index) => ({ result, target: targets[index] }))
    .filter(({ result }) => result.status === "rejected");
  if (failures.length) {
    throw new Error(failures.map(({ result, target }) => `${target.label}: ${result.reason.message}`).join("; "));
  }

  console.log(`Sent DingTalk notification to ${targets.length} robot(s)`);
  return targets.length;
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
  if (process.argv.includes("--open-digest") || process.env.NOTIFY_OPEN_DIGEST === "1") {
    const currentPayload = await readPayload(argValue("--head") || process.env.NOTIFY_HEAD_REF || "working");
    const markdown = buildOpenRegistrationDigest(currentPayload);

    if (process.env.NOTIFY_DRY_RUN === "1") {
      console.log(markdown);
      return;
    }

    const results = await Promise.allSettled([
      notifyDingTalk(markdown),
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
      "- 后续发现新增赛事、可报名、报名截止/入口变化、赛事下架时，会自动推送摘要。",
      "",
      `[打开赛事日历](${siteUrl})`,
    ].join("\n");

    if (process.env.NOTIFY_DRY_RUN === "1") {
      console.log(markdown);
      return;
    }

    const results = await Promise.allSettled([
      notifyDingTalk(markdown),
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

  const diff = diffEvents(previousPayload, currentPayload);
  const markdown = buildMarkdown(diff, currentPayload);
  if (!markdown) {
    console.log("No event changes worth notifying.");
    return;
  }

  if (process.env.NOTIFY_DRY_RUN === "1") {
    console.log(markdown);
    return;
  }

  const results = await Promise.allSettled([
    notifyDingTalk(markdown),
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
    if (strictFailure) process.exitCode = 1;
  });
}
