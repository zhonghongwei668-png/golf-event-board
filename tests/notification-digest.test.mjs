import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenRegistrationDigest } from "../scripts/notify-changes.mjs";

test("open registration digest is a compact table sorted by competition date", () => {
  const digest = buildOpenRegistrationDigest({
    generatedAt: "2026-07-10T08:00:00.000Z",
    events: [
      {
        id: "later",
        name: "名称很长而且需要在手机表格里自动缩略的青少年高尔夫球公开赛",
        startDate: "2099-08-12",
        endDate: "2099-08-15",
        registrationEnd: "2099-08-01 17:00",
        registrationOpen: true,
      },
      {
        id: "earlier",
        name: "较早的赛事|分站赛",
        startDate: "2099-07-14",
        endDate: "2099-07-15",
        registrationEnd: "2099-07-13",
        registrationOpen: true,
      },
    ],
  });

  assert.match(digest, /### 可报名赛事一览（2场）/);
  assert.match(digest, /\| 比赛日期 \| 赛事名称 \| 报名截止 \|/);
  assert.match(digest, /\| 7\/14–7\/15 \| 较早的赛事｜分站赛 \| 7\/13 \|/);
  assert.match(digest, /名称很长而且需要在手机表格里自动缩略的青少年高…/);
  assert.ok(digest.indexOf("较早的赛事") < digest.indexOf("名称很长"));
});
