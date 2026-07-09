import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const eventDataPath = "data/events.json";
const siteUrl = process.env.NOTIFY_SITE_URL || "https://zhonghongwei668-png.github.io/golf-event-board/";
const strictFailure = process.env.NOTIFY_STRICT === "1";

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
  const changed = [];

  for (const [key, event] of currentByKey) {
    const previous = previousByKey.get(key);
    if (!previous) {
      added.push(event);
      continue;
    }

    const fields = changedFields(previous, event);
    if (fields.length) {
      changed.push({ event, fields });
    }
    if (previous.statusCode !== "open" && event.statusCode === "open") {
      opened.push(event);
    }
  }

  return { added, opened, changed };
}

function topItems(items, formatter, limit = 8) {
  const visible = items.slice(0, limit).map(formatter);
  if (items.length > limit) visible.push(`- 另有 ${items.length - limit} 条，打开赛历查看`);
  return visible.join("\n");
}

function buildMarkdown(diff, currentPayload) {
  const sections = [];
  if (diff.added.length) {
    sections.push(`**新增赛事 ${diff.added.length} 场**\n${topItems(diff.added, formatEvent)}`);
  }
  if (diff.opened.length) {
    sections.push(`**新变为可报名 ${diff.opened.length} 场**\n${topItems(diff.opened, formatEvent)}`);
  }
  if (diff.changed.length) {
    sections.push(`**报名/日期/入口变化 ${diff.changed.length} 条**\n${topItems(diff.changed, ({ event, fields }) => `${formatEvent(event)}，变化：${fields.join("、")}`)}`);
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

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);

  try {
    const json = JSON.parse(text);
    if (json.errcode && json.errcode !== 0) {
      throw new Error(text);
    }
  } catch (error) {
    if (text.trim().startsWith("{")) throw error;
  }
  return text;
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

async function notifyDingTalk(markdown) {
  const webhook = process.env.DINGTALK_WEBHOOK;
  if (!webhook) return false;

  await postJson(signedDingTalkUrl(webhook, process.env.DINGTALK_SECRET), {
    msgtype: "markdown",
    markdown: {
      title: "高尔夫赛事报名信息更新",
      text: markdown,
    },
    at: { isAtAll: false },
  });
  console.log("Sent DingTalk notification");
  return true;
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
  }
  if (strictFailure && failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  if (strictFailure) process.exitCode = 1;
});
