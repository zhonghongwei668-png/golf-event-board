import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function emptyNotificationState() {
  return { version: 1, updatedAt: "", messages: {} };
}

export function notificationFingerprint(kind, markdown) {
  return createHash("sha256").update(`${kind}\n${markdown}`).digest("hex");
}

export async function readNotificationState(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return {
      version: 1,
      updatedAt: parsed.updatedAt || "",
      messages: parsed.messages && typeof parsed.messages === "object" ? parsed.messages : {}
    };
  } catch (error) {
    if (error.code === "ENOENT") return emptyNotificationState();
    throw error;
  }
}

export function ensureNotificationMessage(state, { kind, title, markdown, targetIds, now = new Date().toISOString() }) {
  const fingerprint = notificationFingerprint(kind, markdown);
  const existing = state.messages[fingerprint];
  const expectedTargetIds = [...new Set([...(existing?.expectedTargetIds || []), ...targetIds])];
  state.messages[fingerprint] = {
    kind,
    title,
    markdown,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    expectedTargetIds,
    targets: existing?.targets || {}
  };
  state.updatedAt = now;
  return { fingerprint, message: state.messages[fingerprint] };
}

export function markNotificationDelivery(state, fingerprint, targetId, result, now = new Date().toISOString()) {
  const message = state.messages[fingerprint];
  if (!message) throw new Error(`Unknown notification fingerprint: ${fingerprint}`);
  message.targets[targetId] = {
    status: result.ok ? "sent" : "failed",
    attemptedAt: now,
    sentAt: result.ok ? now : (message.targets[targetId]?.sentAt || ""),
    error: result.ok ? "" : String(result.error || "Unknown delivery error").slice(0, 500)
  };
  message.updatedAt = now;
  state.updatedAt = now;
}

export function pendingNotificationMessages(state) {
  return Object.entries(state?.messages || {})
    .filter(([, message]) => (
      (message.expectedTargetIds || []).some((id) => message.targets?.[id]?.status !== "sent")
    ))
    .map(([fingerprint, message]) => ({ fingerprint, ...message }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function pruneNotificationState(state, keepCompleted = 60) {
  const pendingIds = new Set(pendingNotificationMessages(state).map((message) => message.fingerprint));
  const completed = Object.entries(state.messages)
    .filter(([fingerprint]) => !pendingIds.has(fingerprint))
    .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt));
  for (const [fingerprint] of completed.slice(keepCompleted)) delete state.messages[fingerprint];
  return state;
}

export async function writeNotificationState(filePath, state) {
  pruneNotificationState(state);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}
