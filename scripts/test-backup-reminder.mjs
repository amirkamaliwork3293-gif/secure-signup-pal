/**
 * زمان‌بندی یادآوری پشتیبان و آستانهٔ هشدار اشتراک.
 * اجرا: node --experimental-strip-types scripts/test-backup-reminder.mjs
 */
import assert from "node:assert/strict";
import {
  backupReminderDue,
  snoozeBackupReminder,
  DAY_MS,
  WEEK_MS,
} from "../src/lib/backup-reminder.ts";
import {
  daysLeftFrom,
  isSubscriptionExpiringSoon,
  isSubscriptionReadOnly,
  isAppSession,
  authUserId,
  SUBSCRIPTION_WARN_DAYS,
} from "../src/lib/subscription-access.ts";

assert.equal(backupReminderDue(null), true);
assert.equal(backupReminderDue({ nextAt: Date.now() + 1000, freq: "daily" }), false);
assert.equal(backupReminderDue({ nextAt: Date.now() - 1, freq: "daily" }), true);

const now = 1_700_000_000_000;
const daily = snoozeBackupReminder("daily", now);
assert.equal(daily.freq, "daily");
assert.equal(daily.nextAt, now + DAY_MS);
assert.equal(backupReminderDue(daily, now + DAY_MS - 1), false);
assert.equal(backupReminderDue(daily, now + DAY_MS), true);

const weekly = snoozeBackupReminder("weekly", now);
assert.equal(weekly.freq, "weekly");
assert.equal(weekly.nextAt, now + WEEK_MS);
assert.equal(backupReminderDue(weekly, now + DAY_MS), false);
assert.equal(backupReminderDue(weekly, now + WEEK_MS), true);

assert.equal(SUBSCRIPTION_WARN_DAYS, 7);
assert.equal(daysLeftFrom(null), null);
assert.equal(daysLeftFrom("not-a-date"), null);

const in7 = new Date(now + 7 * DAY_MS).toISOString();
const in8 = new Date(now + 8 * DAY_MS).toISOString();
const yesterday = new Date(now - DAY_MS).toISOString();
assert.equal(daysLeftFrom(in7, now), 7);
assert.equal(isSubscriptionExpiringSoon(in7, now), true);
assert.equal(isSubscriptionExpiringSoon(in8, now), false);
assert.equal(isSubscriptionExpiringSoon(yesterday, now), true);

assert.equal(isAppSession({ status: "authenticated" }), true);
assert.equal(isAppSession({ status: "expired" }), true);
assert.equal(isAppSession({ status: "pending" }), false);
assert.equal(isSubscriptionReadOnly({ status: "expired" }), true);
assert.equal(isSubscriptionReadOnly({ status: "authenticated" }), false);
assert.equal(isAppSession({ status: "offline-cached" }), true);
assert.equal(
  isSubscriptionReadOnly({
    status: "offline-cached",
    profile: { status: "expired", end_date: "2020-01-01" },
  }),
  true,
);
assert.equal(
  isSubscriptionReadOnly({
    status: "offline-cached",
    profile: { status: "active", end_date: "2027-01-01" },
  }),
  false,
);
assert.equal(authUserId({ status: "expired", session: { user: { id: "u1" } } }), "u1");
assert.equal(authUserId({ status: "unauthenticated" }), null);

console.log("ok: backup reminder + subscription helpers");
