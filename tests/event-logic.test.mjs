import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseSchedule,
  compareEventLevel,
  eventLevelInfo,
  isRegistrationOpenAt,
  statusForEvent,
  validateEvents
} from "../event-logic.js";

test("classifies and sorts events by competition level", () => {
  const events = [
    { name: "青少年无积分赛", category: "junior", startDate: "2026-07-01" },
    { name: "全国业余希望赛", category: "amateur", competitionGrade: "4", startDate: "2026-07-02" },
    { name: "全国青少年精英赛", category: "junior", competitionGrade: "2", startDate: "2026-07-03" },
    { name: "汇丰全国青少年冠军赛", category: "junior", competitionGrade: "1", startDate: "2026-07-04" }
  ];

  assert.deepEqual(events.map((event) => eventLevelInfo(event).code), ["junior-unranked", "amateur-4", "junior-2", "junior-1"]);
  assert.deepEqual(events.sort(compareEventLevel).map((event) => eventLevelInfo(event).code), ["junior-1", "junior-2", "amateur-4", "junior-unranked"]);
});

test("single-event regulation schedule beats annual calendar API", () => {
  const schedule = chooseSchedule(
    {
      startDate: "2026-08-12",
      endDate: "2026-08-15",
      scheduleAuthority: "regulation"
    },
    {
      startDate: "2026-07-16",
      endDate: "2026-07-18",
      scheduleAuthority: "calendar_api"
    }
  );

  assert.deepEqual(schedule, { startDate: "2026-08-12", endDate: "2026-08-15" });
});

test("expired registration is closed even when cached status says open", () => {
  const event = {
    startDate: "2026-08-10",
    endDate: "2026-08-13",
    registrationEnd: "2026-07-09 17:00",
    statusCode: "open"
  };
  const now = new Date("2026-07-10T08:00:00+08:00");

  assert.equal(isRegistrationOpenAt(event, now), false);
  assert.equal(statusForEvent(event, now).code, "closed");
});

test("authoritatively removed registration is closed before its old deadline", () => {
  const event = {
    startDate: "2026-08-10",
    endDate: "2026-08-13",
    registrationEnd: "2026-08-01",
    registrationOpen: false,
    registrationClosed: true
  };

  assert.equal(statusForEvent(event, new Date("2026-07-10T08:00:00+08:00")).code, "closed");
});

test("future registration start remains pending", () => {
  const event = {
    startDate: "2026-08-10",
    endDate: "2026-08-13",
    registrationStart: "2026-07-15 09:00",
    registrationEnd: "2026-07-31 17:00",
    signupUrl: "https://example.com/signup"
  };

  assert.equal(statusForEvent(event, new Date("2026-07-10T08:00:00+08:00")).code, "pending");
});

test("authoritative pending state beats a conflicting registration date", () => {
  const event = {
    startDate: "2026-08-10",
    endDate: "2026-08-13",
    registrationStart: "2026-07-01",
    registrationEnd: "2026-08-01",
    registrationOpen: false,
    registrationClosed: false,
    registrationStatusAuthoritative: true
  };

  assert.equal(statusForEvent(event, new Date("2026-07-10T08:00:00+08:00")).code, "pending");
});

test("validation rejects deadline after the event and duplicate IDs", () => {
  const events = [
    {
      id: "central",
      name: "中部地区",
      startDate: "2026-07-16",
      endDate: "2026-07-18",
      registrationEnd: "2026-07-31 17:00",
      signupUrl: "https://example.com/signup"
    },
    {
      id: "central",
      name: "重复赛事",
      startDate: "2026-08-01",
      endDate: "2026-08-02"
    }
  ];

  const errors = validateEvents(events, new Date("2026-07-10T08:00:00+08:00"));
  assert.ok(errors.some((error) => error.includes("报名截止晚于比赛结束")));
  assert.ok(errors.some((error) => error.includes("重复赛事ID")));
});
