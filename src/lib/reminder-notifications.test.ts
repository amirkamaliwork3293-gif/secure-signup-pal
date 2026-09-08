import assert from "node:assert/strict";
import { dueAtReadyToNotify, futureNotificationPayloads, REMINDER_NOTIFY_LEAD_MS, syncReminderNotifications, takeCompletedReminderIds } from "./reminder-notifications.ts";
import type { Reminder } from "./store.ts";

function reminder(partial: Partial<Reminder> & Pick<Reminder, "id" | "dueAt">): Reminder {
  return {
    title: "چک",
    note: "",
    customerName: "",
    recurringDays: 0,
    done: false,
    createdAt: 1,
    ...partial,
  };
}

const now = 1_000_000;
const items = [
  reminder({ id: "past", title: "گذشته", dueAt: now - 60_000 }),
  reminder({ id: "soon", title: "نزدیک", dueAt: now + 1_000 }),
  reminder({ id: "later", title: "بعدا", note: "بانک", customerName: "علی", dueAt: now + 60_000 }),
  reminder({ id: "done", title: "تمام", dueAt: now + 120_000, done: true }),
];
const payloads = futureNotificationPayloads(items, now);
assert.equal(payloads.length, 2);
assert.equal(payloads[0].id, "soon");
assert.equal(payloads[1].id, "later");
assert.equal(payloads[0].title, "نزدیک");
assert.equal(payloads[1].title, "بعدا");
assert.match(payloads[1].body, /علی/);
assert.match(payloads[1].body, /بانک/);
assert.equal(payloads[1].at, now + 60_000);

const sameMinutePast = dueAtReadyToNotify(now - 20_000, now);
assert.equal(sameMinutePast, now + REMINDER_NOTIFY_LEAD_MS);
const farFuture = dueAtReadyToNotify(now + 120_000, now);
assert.equal(farFuture, now + 120_000);
const overdueHour = dueAtReadyToNotify(now - 3_600_000, now);
assert.equal(overdueHour, now - 3_600_000);

const many = Array.from({ length: 80 }, (_, i) =>
  reminder({ id: `r${i}`, title: `t${i}`, dueAt: now + (i + 1) * 60_000 }),
);
assert.equal(futureNotificationPayloads(many, now).length, 64);

const g = globalThis as typeof globalThis & { window?: { KamaliReminders?: { sync: (json: string) => void; last?: string } } };
const origWindow = g.window;
g.window = {};
syncReminderNotifications(items, true, now);
g.window = {
  KamaliReminders: {
    sync(json: string) {
      this.last = json;
    },
  },
};
syncReminderNotifications(items, true, now);
const sent = JSON.parse(g.window.KamaliReminders?.last ?? "[]") as { id: string }[];
assert.equal(sent.length, 2);
assert.equal(sent[0].id, "soon");
assert.equal(sent[1].id, "later");

g.window = {
  KamaliReminders: {
    sync() {},
    takeCompleted() {
      return JSON.stringify(["later", ""]);
    },
  },
};
assert.deepEqual(takeCompletedReminderIds(), ["later"]);
g.window = origWindow;
g.window = origWindow;

console.log("reminder-notifications tests passed");
