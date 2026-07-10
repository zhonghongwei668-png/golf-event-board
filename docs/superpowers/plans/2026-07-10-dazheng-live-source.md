# Dazheng Live Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Dazheng Golf as a live fourth data source so newly listed domestic tournaments, signup windows, detail links, and open-registration changes flow into the website and DingTalk alerts.

**Architecture:** A focused parser module converts Dazheng's public signup-list and detail HTML into normalized source records. The updater reuses persisted Dazheng details when the list window is unchanged, fetches detail pages only for new/changed records, merges by Dazheng event ID before fuzzy names, and closes previously tracked registrations that disappear from the live list.

**Tech Stack:** Node.js 20 fetch, vanilla HTML parsing with bounded source-specific regular expressions, Node test runner, existing JSON/static build and GitHub Actions.

---

### Task 1: Parser Fixtures And Tests

**Files:**
- Create: `scripts/lib/dazheng-source.mjs`
- Create: `tests/dazheng-source.test.mjs`

- [ ] **Step 1: Add list/detail fixture strings to tests**

Cover event ID, title, registration range forms (`07月10 ~ 26日`, `07月09日 ~ 08月09日`), share-description competition ranges, location, open button, and excluded non-event titles.

- [ ] **Step 2: Implement deterministic parser functions**

Export `parseDazhengList`, `parseDazhengRegistrationWindow`, `parseDazhengDetail`, `classifyDazhengEvent`, and `isEligibleDazhengEvent`. Return normalized ISO dates and never execute page scripts.

- [ ] **Step 3: Run parser tests**

Run: `node --test tests/dazheng-source.test.mjs`
Expected: list, date, status, classification, and exclusion cases all pass.

### Task 2: Live Fetch And Cache Reuse

**Files:**
- Modify: `scripts/lib/dazheng-source.mjs`
- Modify: `scripts/update-data.mjs`

- [ ] **Step 1: Fetch the public signup list**

Use `https://www.bwvip.com/default.php?g=m&m=baoming&a=baoming_list` with the existing bot user agent and a 15-second timeout.

- [ ] **Step 2: Reuse unchanged persisted details**

Index previous events by `externalIds.dazheng`. When registration start/end and title match, reuse competition dates/location instead of requesting the detail page.

- [ ] **Step 3: Fetch new/changed details with bounded concurrency**

Fetch at most six detail pages concurrently. Parse the public share description for competition dates/location and preserve the direct `event_id` URL as both source and signup URL.

- [ ] **Step 4: Exclude non-tournament and overseas entries**

Exclude membership recruitment, coach education, skill-level examinations, camps/training, and names/locations explicitly outside mainland China. Require a 2026 competition date.

- [ ] **Step 5: Preserve disappeared future events as closed**

If a previously tracked Dazheng future event is absent from a successful current list fetch, keep its schedule/details but set `registrationOpen: false` and label it closed through shared status logic.

### Task 3: ID-First Merge And Source Metadata

**Files:**
- Modify: `scripts/update-data.mjs`
- Modify: `event-logic.js`
- Modify: `app.js`

- [ ] **Step 1: Merge by stable external ID**

Before name matching, compare `externalIds.dazheng` or `event_id` parsed from signup URLs. This prevents duplicate copies of manually linked national events.

- [ ] **Step 2: Let Dazheng update registration fields**

For incoming Dazheng records, update registration start/end, live open flag, signup URL, and source links while retaining a higher-authority single-event regulation schedule.

- [ ] **Step 3: Surface series metadata**

Persist `seriesLabel` such as `青少赛-嘉年华挑战赛`, `青少赛-迈阅巡回赛`, `协会赛-北京高协`, `青少赛-GCCT`, or `大正高尔夫`, include it in search, and show it in event detail metadata.

### Task 4: Validation, Notification, And Release

**Files:**
- Modify: `tests/event-logic.test.mjs`
- Modify: `README.md`
- Regenerate: `data/events.json`, `dist/**`

- [ ] **Step 1: Add duplicate/external-ID regression tests**

Verify a Dazheng-linked existing event merges into one record and newly open Dazheng records satisfy existing validation.

- [ ] **Step 2: Run one real update**

Run: `node scripts/update-data.mjs`
Expected: the supplied PCGC, 嘉年华, 迈阅, 北京高协, 超级荔枝, and GCCT examples are present when currently listed, with direct signup URLs.

- [ ] **Step 3: Verify DingTalk dry run**

Run: `NOTIFY_DRY_RUN=1 node scripts/notify-changes.mjs --base HEAD --head working`
Expected: newly discovered open Dazheng events appear in the highlighted section with signup links.

- [ ] **Step 4: Run all checks and build**

Run: `node --test && node scripts/validate-data.mjs && node scripts/build-static.mjs && git diff --check`
Expected: all tests and data validation pass.

- [ ] **Step 5: Commit and push**

Commit source, tests, regenerated data/static files, and this plan. Preserve the unrelated untracked research document.
