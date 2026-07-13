import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  pendingNotificationMessages,
  readNotificationState
} from "./lib/notification-state.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = await readNotificationState(path.join(rootDir, "data/notification-state.json"));
const pending = pendingNotificationMessages(state);

if (pending.length) {
  console.error(`${pending.length} notification(s) still have failed or pending DingTalk deliveries.`);
  for (const message of pending.slice(0, 10)) {
    const failedTargets = message.expectedTargetIds.filter((id) => message.targets?.[id]?.status !== "sent");
    console.error(`- ${message.kind}: ${failedTargets.join(", ")}`);
  }
  process.exitCode = 1;
} else {
  console.log("All recorded DingTalk notifications were delivered.");
}
