const OWNER = "zhonghongwei668-png";
const REPO = "golf-event-board";
const WORKFLOW = "deploy.yml";
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
const DEFAULT_STALE_MINUTES = 35;
const ACTIVE_STALE_MINUTES = 15;
const ACTIVE_START_HOUR = 8;
const ACTIVE_END_HOUR = 23;

function shanghaiHour(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value);
}

export function isActiveWindow(now = new Date()) {
  const hour = shanghaiHour(now);
  return hour >= ACTIVE_START_HOUR && hour < ACTIVE_END_HOUR;
}

function githubHeaders(token = "") {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "golf-event-board-watchdog",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };
}

async function githubRequest(path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      ...githubHeaders(options.token),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export async function getWorkflowHealth(env, fetchImpl = fetch, now = new Date()) {
  const payload = await githubRequest(
    `/actions/workflows/${WORKFLOW}/runs?per_page=20`,
    { token: env.GITHUB_TOKEN },
    fetchImpl
  );
  const runs = payload?.workflow_runs || [];
  const latestSuccess = runs.find((run) => run.status === "completed" && run.conclusion === "success");
  const active = runs.find((run) => run.status === "queued" || run.status === "in_progress");
  const latestFailure = runs.find((run) => run.status === "completed" && run.conclusion !== "success");
  const staleMinutes = Number(env.STALE_MINUTES || DEFAULT_STALE_MINUTES);
  const successAt = latestSuccess?.updated_at ? new Date(latestSuccess.updated_at) : null;
  const ageMinutes = successAt ? Math.max(0, (now.getTime() - successAt.getTime()) / 60000) : Infinity;
  const activeAt = active?.run_started_at || active?.created_at;
  const activeAgeMinutes = activeAt ? Math.max(0, (now.getTime() - new Date(activeAt).getTime()) / 60000) : 0;
  const activeStale = Boolean(active && activeAgeMinutes > ACTIVE_STALE_MINUTES);
  const failureAt = latestFailure?.updated_at ? new Date(latestFailure.updated_at) : null;
  const recentFailure = Boolean(
    failureAt &&
    (!successAt || failureAt > successAt) &&
    now.getTime() - failureAt.getTime() <= 15 * 60000
  );
  return {
    healthy: ageMinutes <= staleMinutes,
    ageMinutes,
    staleMinutes,
    latestSuccess,
    active,
    activeAgeMinutes,
    activeStale,
    latestFailure,
    recentFailure
  };
}

export async function dispatchWorkflow(env, fetchImpl = fetch) {
  if (!env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN secret");
  await githubRequest(
    `/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      token: env.GITHUB_TOKEN,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "main" })
    },
    fetchImpl
  );
}

function base64(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signedDingTalkUrl(webhook, secret) {
  if (!secret) return webhook;
  const timestamp = Date.now();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}\n${secret}`)
  );
  const separator = webhook.includes("?") ? "&" : "?";
  return `${webhook}${separator}timestamp=${timestamp}&sign=${encodeURIComponent(base64(signature))}`;
}

async function notifyDingTalk(env, message, fetchImpl = fetch) {
  const targets = [
    [env.DINGTALK_WEBHOOK, env.DINGTALK_SECRET],
    [env.DINGTALK_WEBHOOK_2, env.DINGTALK_SECRET_2]
  ].filter(([webhook]) => webhook);
  if (targets.length < 2) throw new Error(`DingTalk robots configured: ${targets.length}/2`);

  const results = await Promise.all(targets.map(async ([webhook, secret]) => {
    const response = await fetchImpl(await signedDingTalkUrl(webhook, secret), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { title: "高尔夫赛历更新任务报警", text: message },
        at: { isAtAll: false }
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`DingTalk ${response.status}: ${text}`);
    const payload = JSON.parse(text);
    if (payload.errcode) throw new Error(`DingTalk: ${text}`);
  }));
  return results.length;
}

export async function runWatchdog(env, fetchImpl = fetch, now = new Date()) {
  if (!isActiveWindow(now)) return { action: "outside_window" };

  const health = await getWorkflowHealth(env, fetchImpl, now);
  if (health.healthy) return { action: "healthy", health };
  if (health.active && !health.activeStale) return { action: "active", health };

  try {
    await dispatchWorkflow(env, fetchImpl);
    if (health.activeStale) {
      await notifyDingTalk(env, [
        "### 【报警】赛事更新任务执行超时",
        `当前任务已运行：${Math.round(health.activeAgeMinutes)} 分钟`,
        "已触发补偿任务，请检查 GitHub Actions。",
        "",
        `[查看 GitHub Actions](https://github.com/${OWNER}/${REPO}/actions)`
      ].join("\n"), fetchImpl);
      return { action: "dispatched_stale_active", health };
    }
    if (health.recentFailure) {
      await notifyDingTalk(env, [
        "### 【报警】赛事更新任务执行失败",
        `失败任务：${health.latestFailure?.name || health.latestFailure?.display_title || "Update golf event data"}`,
        "已自动触发补偿任务。",
        "",
        `[查看失败记录](${health.latestFailure?.html_url || `https://github.com/${OWNER}/${REPO}/actions`})`
      ].join("\n"), fetchImpl);
      return { action: "dispatched_after_failure", health };
    }
    return { action: "dispatched", health };
  } catch (error) {
    const age = Number.isFinite(health.ageMinutes) ? `${Math.round(health.ageMinutes)} 分钟` : "未知";
    const message = [
      "### 【报警】赛事更新任务未按时运行",
      `最近成功运行距今：${age}`,
      `自动补偿触发失败：${error.message}`,
      "",
      `[查看 GitHub Actions](https://github.com/${OWNER}/${REPO}/actions)`
    ].join("\n");
    await notifyDingTalk(env, message, fetchImpl);
    throw error;
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runWatchdog(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/health") return new Response("Not found", { status: 404 });
    try {
      const health = await getWorkflowHealth(env);
      return Response.json({
        ok: true,
        healthy: health.healthy,
        active: Boolean(health.active),
        ageMinutes: Number.isFinite(health.ageMinutes) ? Math.round(health.ageMinutes) : null,
        latestRunUrl: health.latestSuccess?.html_url || null
      });
    } catch (error) {
      return Response.json({ ok: false, error: error.message }, { status: 502 });
    }
  }
};
