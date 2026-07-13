const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function retryDelay(response, attempt, baseDelayMs) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1000, 10000);
  const exponential = baseDelayMs * (2 ** (attempt - 1));
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const fetchImpl = retryOptions.fetchImpl || fetch;
  const attempts = retryOptions.attempts || 3;
  const timeoutMs = retryOptions.timeoutMs || 15000;
  const baseDelayMs = retryOptions.baseDelayMs || 300;
  const sleep = retryOptions.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(timeoutMs)
      });
      if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) return response;
      lastError = new Error(`${response.status} ${response.statusText} for ${url}`);
      await sleep(retryDelay(response, attempt, baseDelayMs));
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(retryDelay(null, attempt, baseDelayMs));
    }
  }
  throw lastError;
}
