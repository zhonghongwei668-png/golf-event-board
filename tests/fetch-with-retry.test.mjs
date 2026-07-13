import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry } from "../scripts/lib/fetch-with-retry.mjs";

test("retries transient HTTP failures and returns the recovered response", async () => {
  let calls = 0;
  const response = await fetchWithRetry("https://example.com", {}, {
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return calls < 3
        ? new Response("temporary", { status: 502, statusText: "Bad Gateway" })
        : new Response("ok", { status: 200 });
    }
  });
  assert.equal(calls, 3);
  assert.equal(await response.text(), "ok");
});

test("does not retry a permanent client error", async () => {
  let calls = 0;
  const response = await fetchWithRetry("https://example.com", {}, {
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    }
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 404);
});
