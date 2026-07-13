export function detectCountAnomaly(previousCount, currentCount, options = {}) {
  const minimumPrevious = options.minimumPrevious ?? 10;
  const minimumDrop = options.minimumDrop ?? 5;
  const minimumRatio = options.minimumRatio ?? 0.65;
  if (!Number.isFinite(previousCount) || previousCount < minimumPrevious) return null;
  const drop = previousCount - currentCount;
  if (drop < minimumDrop || currentCount >= previousCount * minimumRatio) return null;
  return `抓取数量从 ${previousCount} 降至 ${currentCount}，低于安全阈值`;
}

export function healthySourceState(previous = {}, details = {}) {
  return {
    label: details.label || previous.label || "信息源",
    status: "healthy",
    checkedAt: details.checkedAt,
    lastSuccessAt: details.checkedAt,
    consecutiveFailures: 0,
    itemCount: details.itemCount,
    previousItemCount: Number.isFinite(previous.itemCount) ? previous.itemCount : null,
    durationMs: details.durationMs,
    recovered: previous.status === "degraded",
    error: ""
  };
}

export function degradedSourceState(previous = {}, details = {}) {
  return {
    label: details.label || previous.label || "信息源",
    status: "degraded",
    checkedAt: details.checkedAt,
    lastSuccessAt: previous.lastSuccessAt || "",
    consecutiveFailures: Number(previous.consecutiveFailures || 0) + 1,
    itemCount: Number.isFinite(details.itemCount)
      ? details.itemCount
      : Number.isFinite(previous.itemCount) ? previous.itemCount : details.fallbackCount || 0,
    previousItemCount: Number.isFinite(previous.itemCount) ? previous.itemCount : null,
    durationMs: details.durationMs,
    recovered: false,
    error: details.error || "未知错误"
  };
}

export function shouldAlertFailure(consecutiveFailures) {
  return consecutiveFailures === 1 || consecutiveFailures === 3 || consecutiveFailures === 6 || consecutiveFailures % 12 === 0;
}

export function summarizeSourceHealth(sources = {}) {
  const entries = Object.values(sources);
  return {
    overallStatus: entries.some((source) => source.status === "degraded") ? "degraded" : "healthy",
    degradedCount: entries.filter((source) => source.status === "degraded").length,
    recoveredCount: entries.filter((source) => source.recovered).length
  };
}
