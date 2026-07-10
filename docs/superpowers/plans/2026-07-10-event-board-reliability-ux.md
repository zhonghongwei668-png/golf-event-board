# Event Board Reliability And UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the golf registration calendar reject contradictory dates, preserve updates when one source fails, deliver reliable DingTalk alerts, and reduce mobile signup friction.

**Architecture:** Add a browser-compatible shared event-rules module used by data generation, notification, and the frontend. Keep the existing static-site architecture, but make source merges authority-aware and source failures category-local. Improve the existing three-column UI without introducing a framework.

**Tech Stack:** Node.js 20, Node test runner, vanilla ES modules, HTML/CSS, GitHub Actions, DingTalk webhook.

---

### Task 1: Shared Event Rules And Tests

**Files:**
- Create: `event-logic.js`
- Create: `tests/event-logic.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for source authority, live status, and validation**

Test that a regulation schedule beats a calendar API schedule, an expired cached `open` status is closed at read time, and registration after the event end is rejected.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/event-logic.test.mjs`
Expected: FAIL because `event-logic.js` does not exist.

- [ ] **Step 3: Implement pure shared rules**

Export `parseShanghaiDateTime`, `statusForEvent`, `isRegistrationOpenAt`, `scheduleAuthorityRank`, `chooseSchedule`, and `validateEvents`. Keep the module free of Node-only imports so the browser can import it.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all event-rule tests pass.

### Task 2: Reliable Data Merge And Validation

**Files:**
- Modify: `scripts/update-data.mjs`
- Create: `scripts/validate-data.mjs`
- Modify: `2026国内女子青少年业余高尔夫赛事报名入口汇总.md`
- Modify: `data/events.json`

- [ ] **Step 1: Correct the central-region official schedule**

Change the event to `2026-08-12~2026-08-15`, retaining the July 31 registration deadline and event 5065 signup URL.

- [ ] **Step 2: Mark schedule authority at ingestion**

Parsed specific regulations receive `scheduleAuthority: "regulation"`; CGA calendar API events receive `calendar_api`; CLPGA events receive `official_api`.

- [ ] **Step 3: Merge dates with authority-aware rules**

Use `chooseSchedule(existing, incoming)` so a broad annual calendar cannot overwrite a later single-event regulation.

- [ ] **Step 4: Isolate source failures**

Fetch CLPGA, CGA amateur, and CGA junior independently. On one failure, merge the previous events for only that source category while accepting successful updates from the other sources.

- [ ] **Step 5: Validate before writing**

Reject duplicate IDs, end dates before start dates, registration deadlines after event end, and open events without a signup URL. Abort without replacing the last good data when validation fails.

- [ ] **Step 6: Regenerate and validate data**

Run: `npm run update && npm run validate`
Expected: 82 or more events, no validation errors, central-region dates in August.

### Task 3: Reliable Notification Delivery

**Files:**
- Modify: `scripts/notify-changes.mjs`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Recompute registration state when notifying**

Use `isRegistrationOpenAt(event)` rather than trusting serialized `statusCode`.

- [ ] **Step 2: Retry transient webhook failures**

Retry DingTalk/WeCom JSON delivery three times with short bounded backoff, while preserving strict failure behavior.

- [ ] **Step 3: Notify before committing changed data**

Compare `HEAD` to the working tree and send the notification before the data commit. If notification fails, the workflow stops and the next scheduled run sees the same uncommitted logical change and retries.

- [ ] **Step 4: Run dry-run notification tests**

Run: `NOTIFY_DRY_RUN=1 npm run notify -- --base HEAD --head working`
Expected: any current change is formatted once, with newly open events highlighted.

### Task 4: Mobile And Calendar Interaction

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

- [ ] **Step 1: Use shared live statuses**

Render card labels and filters from `statusForEvent` so stale cached `open` values cannot remain open after their deadline.

- [ ] **Step 2: Add direct signup actions to open cards**

Show `立即报名` when an event is currently open and has a safe signup URL. Card click handlers must ignore link clicks.

- [ ] **Step 3: Add mobile detail history**

Push one detail state on narrow screens and handle `popstate`, so the system/browser Back action closes event details instead of leaving the calendar.

- [ ] **Step 4: Collapse mobile filters**

Default the 82px sidebar to a compact 48px rail on phones. A clear filter toggle expands the existing category/status controls and collapses after a selection.

- [ ] **Step 5: Collapse information-source groups**

Render A/B source groups as closed `<details>` sections so the source matrix remains available at the bottom without creating a long visible page.

- [ ] **Step 6: Improve accessibility**

Make event cards keyboard-focusable and operable with Enter/Space, preserve visible focus, and keep direct links independently actionable.

### Task 5: Build, Documentation, And Release Verification

**Files:**
- Modify: `scripts/build-static.mjs`
- Modify: `README.md`
- Regenerate: `dist/**`

- [ ] **Step 1: Copy the shared browser module into the static build**

Add `event-logic.js` to the build file list.

- [ ] **Step 2: Document monitoring scope honestly**

State that core public APIs run hourly in daytime, while WeChat/mini-program sources remain human verification channels.

- [ ] **Step 3: Run all checks**

Run: `npm test && npm run validate && npm run build && git diff --check`
Expected: all tests pass, validation succeeds, and no whitespace errors are reported.

- [ ] **Step 4: Verify desktop and mobile behavior**

Check desktop and a 390px mobile viewport: filters do not cover content, open cards show signup actions, detail Back works, and source groups stay collapsed.

- [ ] **Step 5: Commit and push**

Commit only the requested implementation and generated static files, preserving the unrelated untracked research document.
