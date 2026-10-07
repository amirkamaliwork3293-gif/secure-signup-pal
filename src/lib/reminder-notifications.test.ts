import assert from "node:assert/strict";
import {
  canRequestReminderWidget,
  dueAtReadyToNotify,
  futureNotificationPayloads,
  MAX_WIDGET_ITEMS,
  REMINDER_NOTIFY_LEAD_MS,
  requestReminderWidget,
  syncReminderNotifications,
  syncReminderWidget,
  takeCompletedReminderIds,
  takeWidgetOpenRoute,
  widgetPayload,
  WIDGET_FUTURE_WINDOW_MS,
  WIDGET_PAST_WINDOW_MS,
} from "./reminder-notifications.ts";
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

const g = globalThis as typeof globalThis & {
  window?: { KamaliReminders?: { sync: (json: string) => void; last?: string } };
};
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

// ─── ویجت صفحهٔ اصلی ───────────────────────────────────────────────────────
{
  // «امروز» به وقت تهران: ساعت ۱۴ روز ۱۵ مهر ۱۴۰۵
  const wNow = Date.parse("2026-10-07T14:00:00+03:30");
  const list = [
    reminder({ id: "old", title: "خیلی قدیمی", dueAt: wNow - WIDGET_PAST_WINDOW_MS - 1 }),
    reminder({
      id: "morning",
      title: "  صبح  ",
      customerName: " علی ",
      dueAt: Date.parse("2026-10-07T00:00:00+03:30"),
    }),
    reminder({ id: "overdue", title: "", dueAt: wNow - 60_000 }),
    reminder({ id: "doneToday", title: "تمام", dueAt: wNow - 1_000, done: true }),
    reminder({
      id: "evening",
      title: "عصر",
      note: "یادداشت خصوصی",
      dueAt: Date.parse("2026-10-07T18:00:00+03:30"),
    }),
    reminder({ id: "tomorrow", title: "فردا", dueAt: Date.parse("2026-10-08T00:00:00+03:30") }),
    reminder({ id: "far", title: "دور", dueAt: wNow + WIDGET_FUTURE_WINDOW_MS }),
    reminder({ id: "nan", title: "خراب", dueAt: Number.NaN }),
    reminder({ id: "", title: "بی‌شناسه", dueAt: wNow }),
  ];
  const p = widgetPayload(list, true, wNow);
  assert.equal(p.v, 1);
  assert.equal(p.enabled, true);
  assert.equal(p.generatedAt, wNow);
  // ترتیب زمانی؛ گذشتهٔ امروز می‌ماند؛ انجام‌شده، خیلی قدیمی، خیلی دور و نامعتبر نمی‌آیند؛ فردا برای عبور از نیمه‌شب می‌آید.
  assert.deepEqual(
    p.items.map((i) => i.id),
    ["morning", "overdue", "evening", "tomorrow"],
  );
  assert.deepEqual(p.items[0], {
    id: "morning",
    title: "صبح",
    customer: "علی",
    at: Date.parse("2026-10-07T00:00:00+03:30"),
  });
  assert.equal(p.items[1].title, "یادآوری", "empty title falls back");
  // حریم خصوصی: یادداشت هرگز به ویجت نمی‌رود
  assert.ok(!JSON.stringify(p).includes("یادداشت خصوصی"));
  assert.deepEqual(Object.keys(p.items[2]).sort(), ["at", "customer", "id", "title"]);

  // مستقل از منطقهٔ زمانی میزبان: پنجره نسبی است، پس همان نتیجه
  assert.deepEqual(widgetPayload(list, true, wNow), p);

  // غیرفعال/خروج: هیچ آیتمی
  assert.deepEqual(widgetPayload(list, false, wNow).items, []);
  assert.equal(widgetPayload(list, false, wNow).enabled, false);
  assert.deepEqual(widgetPayload([], true, wNow).items, []);
  assert.deepEqual(widgetPayload(null as unknown as Reminder[], true, wNow).items, []);

  // متن‌های خیلی بلند کوتاه می‌شوند
  const long = widgetPayload(
    [reminder({ id: "l", title: "ا".repeat(500), customerName: "ب".repeat(500), dueAt: wNow })],
    true,
    wNow,
  );
  assert.equal(long.items[0].title.length, 120);
  assert.ok(long.items[0].title.endsWith("…"));
  assert.equal(long.items[0].customer.length, 60);

  // فهرست خیلی بزرگ: سقف و ترتیب
  const huge = Array.from({ length: 50_000 }, (_, i) =>
    reminder({ id: `h${i}`, title: `t${i}`, dueAt: wNow + ((i * 7919) % 86_400) * 1_000 }),
  );
  const hp = widgetPayload(huge, true, wNow);
  assert.equal(hp.items.length, MAX_WIDGET_ITEMS);
  for (let i = 1; i < hp.items.length; i++) assert.ok(hp.items[i - 1].at <= hp.items[i].at);
  assert.ok(JSON.stringify(hp).length < 100_000, "payload stays small");

  // ─── پل: سازگاری نسخه‌ها ───
  // مرورگر معمولی: هیچ کاری نمی‌کند و خطا نمی‌دهد
  g.window = {};
  syncReminderWidget(list, true, wNow);
  assert.equal(takeWidgetOpenRoute(), null);
  assert.equal(canRequestReminderWidget(), false);
  assert.equal(requestReminderWidget(), false);
  g.window = undefined;
  syncReminderNotifications(list, true, wNow);
  assert.equal(takeWidgetOpenRoute(), null);

  // APK قدیمی (فقط sync/takeCompleted): زنگ‌ها دقیقاً مثل قبل، بدون syncWidget
  const calls: string[] = [];
  g.window = {
    KamaliReminders: { sync: (json: string) => void calls.push(`sync:${json}`) },
  } as never;
  syncReminderNotifications(list, true, wNow);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].slice(5)), futureNotificationPayloads(list, wNow));
  assert.equal(takeWidgetOpenRoute(), null);
  assert.equal(canRequestReminderWidget(), false);

  // APK جدید: sync همان قبلی + syncWidget جداگانه
  const bridge = {
    syncs: [] as string[],
    widgets: [] as string[],
    route: "/reminders",
    sync(json: string) {
      this.syncs.push(json);
    },
    syncWidget(json: string) {
      this.widgets.push(json);
    },
    takeOpenRoute() {
      const r = this.route;
      this.route = "";
      return r;
    },
    canPinWidget: () => true,
    requestPinWidget: () => true,
  };
  g.window = { KamaliReminders: bridge } as never;
  syncReminderNotifications(list, true, wNow);
  assert.deepEqual(JSON.parse(bridge.syncs[0]), futureNotificationPayloads(list, wNow));
  assert.deepEqual(JSON.parse(bridge.widgets[0]), p);
  syncReminderNotifications([], false, wNow);
  assert.deepEqual(JSON.parse(bridge.syncs[1]), []);
  assert.deepEqual(JSON.parse(bridge.widgets[1]).items, []);
  assert.equal(JSON.parse(bridge.widgets[1]).enabled, false);
  assert.equal(takeWidgetOpenRoute(), "/reminders");
  assert.equal(takeWidgetOpenRoute(), null, "route is one-shot");
  assert.equal(canRequestReminderWidget(), true);
  assert.equal(requestReminderWidget(), true);

  // فقط مسیر مجاز
  bridge.route = "javascript:alert(1)";
  assert.equal(takeWidgetOpenRoute(), null);
  bridge.route = "/admin";
  assert.equal(takeWidgetOpenRoute(), null);

  // پل خراب: هیچ خطایی به برنامه نمی‌رسد و زنگ‌ها جدا از ویجت کار می‌کنند
  const synced: string[] = [];
  g.window = {
    KamaliReminders: {
      sync: (json: string) => void synced.push(json),
      syncWidget: () => {
        throw new Error("boom");
      },
      takeOpenRoute: () => {
        throw new Error("boom");
      },
      canPinWidget: () => {
        throw new Error("boom");
      },
      requestPinWidget: () => {
        throw new Error("boom");
      },
    },
  } as never;
  assert.doesNotThrow(() => syncReminderNotifications(list, true, wNow));
  assert.equal(synced.length, 1, "alarm sync unaffected by widget failure");
  assert.equal(takeWidgetOpenRoute(), null);
  assert.equal(canRequestReminderWidget(), false);
  assert.equal(requestReminderWidget(), false);

  const widgetOnly: string[] = [];
  g.window = {
    KamaliReminders: {
      sync: () => {
        throw new Error("boom");
      },
      syncWidget: (json: string) => void widgetOnly.push(json),
    },
  } as never;
  assert.doesNotThrow(() => syncReminderNotifications(list, true, wNow));
  assert.equal(widgetOnly.length, 1, "widget still synced if alarm sync throws");
  g.window = origWindow;
}

console.log("reminder-notifications tests passed");
