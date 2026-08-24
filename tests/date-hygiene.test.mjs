import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * 日期卫生防护：时间敏感函数调用必须注入固定的 today/now。
 * 防止"写死日期 + 无注入"的测试随时间过期导致流水线静默中断
 * （2026-08-16 与 2026-08-20 两次事故的根因）。
 *
 * 注入判据（调用行前后窗口内任一）：
 * - today/now 选项或变量赋值（today= / now= / today: / now:）
 * - new Date(...) 显式时间参数
 * - 调用行本身带日期字符串参数（如 isAnnouncementFresh(x, "2026-07-14")）
 * - 行尾 // time-agnostic 注释：显式声明该调用与时间无关（如远未来日期 fixture）
 */
const TIME_SENSITIVE_CALLS = [
  "buildChangeNotification(",
  "buildOpenRegistrationDigest(",
  "fetchDazhengEvents(",
  "mergeAnnouncementHistory(",
  "diffOfficialAnnouncements(",
  "diffDazhengAnnouncements(",
  "statusForEvent(",
  "isRegistrationOpenAt(",
  "isAnnouncementFresh(",
  "validateEvents(",
];

test("time-sensitive calls in tests inject a fixed now/today", () => {
  const dir = new URL(".", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs"));
  const violations = [];

  for (const file of files) {
    if (file === "date-hygiene.test.mjs") continue;
    const lines = readFileSync(new URL(`./${file}`, import.meta.url), "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const matchedCall = TIME_SENSITIVE_CALLS.find((call) => line.includes(call));
      if (!matchedCall) continue;
      if (/\/\/\s*time-agnostic/.test(line)) continue;
      const window = lines.slice(Math.max(0, i - 5), i + 14).join(" ");
      const injected =
        /(today|now)\s*[:=]/.test(window)
        || /new Date\(/.test(window)
        || /"[0-9]{4}-[0-9]{2}-[0-9]{2}"/.test(lines.slice(i, i + 6).join(" "));
      if (!injected) {
        violations.push(`${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "时间敏感调用缺少 today/now 注入（会随日期过期导致流水线中断）：\n" + violations.join("\n"),
  );
});
