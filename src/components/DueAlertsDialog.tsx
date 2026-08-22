/**
 * پاپ‌آپ سررسید: وقتی یادآوری برسد یا موعد تسویه مشتری (همان روز / یک روز قبل /
 * عقب‌افتاده) فرا برسد، یک پنجره روی صفحه باز می‌شود با پیامک و تماس.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  CalendarClock,
  Check,
  Clock,
  MessageCircle,
  Phone,
  Send,
  Wallet,
  X,
} from "lucide-react";
import {
  reminders as remindersStore,
  reminderStatus,
  customers as customersStore,
  dueSettlementCustomers,
  customerFullName,
  customerBalance,
  formatJalaliDate,
  formatJalaliYmd,
  formatToman,
  formatNumber,
  settings,
  toJalali,
  jalaliToTimestamp,
  type Reminder,
  type Customer,
  type SettlementAlertKind,
} from "@/lib/store";
import { openExternal, toIntlPhone, telHref } from "@/lib/openExternal";
import { DebtContactDialog } from "@/components/DebtContactDialog";

const SNOOZE_MINUTES = 60;
const DISMISS_KEY = "acc.dueAlerts.dismissed.v1";

const SETTLEMENT_COPY: Record<SettlementAlertKind, { badge: string; title: string }> = {
  overdue: {
    badge: "موعد تسویه گذشته",
    title: "پرداخت عقب افتاده است",
  },
  today: {
    badge: "موعد تسویه امروز",
    title: "پرداخت امروز سررسید شده",
  },
  tomorrow: {
    badge: "موعد تسویه فردا",
    title: "فردا موعد پرداخت است",
  },
};

function endOfTehranToday(): number {
  const j = toJalali(Date.now());
  if (!j) return Date.now() + 86_400_000;
  return jalaliToTimestamp(j.jy, j.jm, j.jd, 23, 59) + 59_999;
}

function readDismissed(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const now = Date.now();
    const fresh: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > now) fresh[k] = v;
    }
    return fresh;
  } catch {
    return {};
  }
}

function writeDismissed(map: Record<string, number>) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

type AlertItem =
  | { type: "reminder"; key: string; reminder: Reminder; customer?: Customer }
  | { type: "settlement"; key: string; customer: Customer; when: SettlementAlertKind };

function collectAlerts(
  reminders: Reminder[],
  customers: Customer[],
  dismissed: Record<string, number>,
  includeReminders: boolean,
): AlertItem[] {
  const now = Date.now();
  const isOpen = (key: string) => !(typeof dismissed[key] === "number" && dismissed[key] > now);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const items: AlertItem[] = [];

  for (const { customer, kind } of dueSettlementCustomers(customers)) {
    const key = `settlement:${customer.id}:${kind}:${customer.settlementDate || ""}`;
    if (!isOpen(key)) continue;
    items.push({ type: "settlement", key, customer, when: kind });
  }

  if (includeReminders) {
    for (const r of reminders) {
      if (r.done) continue;
      const st = reminderStatus(r);
      if (st === "due-today" && r.dueAt > now) continue;
      if (st !== "due-today" && st !== "overdue") continue;
      const key = `reminder:${r.id}:${r.dueAt}`;
      if (!isOpen(key)) continue;
      items.push({
        type: "reminder",
        key,
        reminder: r,
        customer: r.customerId ? byId.get(r.customerId) : undefined,
      });
    }
  }

  const rank = (a: AlertItem) => {
    if (a.type === "settlement") return a.when === "overdue" ? 0 : a.when === "today" ? 2 : 4;
    return reminderStatus(a.reminder) === "overdue" ? 1 : 3;
  };
  return items.sort((a, b) => rank(a) - rank(b));
}

export function DueAlertsDialog({ includeReminders = true }: { includeReminders?: boolean }) {
  const [reminderList] = remindersStore.useAll();
  const [customerList] = customersStore.useAll();
  const [dismissed, setDismissed] = useState<Record<string, number>>(() => readDismissed());
  const [index, setIndex] = useState(0);
  const [contactTarget, setContactTarget] = useState<{
    customer: Customer;
    heading?: string;
    presetText?: string;
  } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const due = useMemo(
    () => collectAlerts(reminderList, customerList, dismissed, includeReminders),
    [reminderList, customerList, dismissed, includeReminders],
  );

  useEffect(() => {
    if (index >= due.length) setIndex(0);
  }, [due.length, index]);

  if (due.length === 0) return null;
  const current = due[Math.min(index, due.length - 1)];
  if (!current) return null;

  const dismissCurrent = () => {
    const next = { ...dismissed, [current.key]: endOfTehranToday() };
    writeDismissed(next);
    setDismissed(next);
  };

  const customer: Customer | undefined =
    current.type === "settlement" ? current.customer : current.customer;
  const phone = customer?.phone?.trim() || "";
  const shopName = settings.get().shopName || "فروشگاه ما";

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[70] flex items-end justify-center bg-foreground/55 p-3 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="due-alert-title"
      >
        <div className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-elegant animate-in fade-in zoom-in-95 duration-200">
          <AlertHeader item={current} extraCount={due.length - 1} onClose={dismissCurrent} />

          <div className="px-5 py-4">
            <AlertBody item={current} />

            {customer && customerBalance(customer) > 0 && (
              <div className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-destructive">
                  <Wallet className="h-3.5 w-3.5" />
                  بدهی {customerFullName(customer)}: {formatToman(customerBalance(customer))}
                </div>
                {customer.settlementDate && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    موعد تسویه: {formatJalaliYmd(customer.settlementDate)}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!phone}
                onClick={() => phone && openExternal(telHref(phone))}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                <Phone className="h-4 w-4" />
                تماس
              </button>
              <button
                type="button"
                disabled={!customer}
                onClick={() => {
                  if (!customer) return;
                  const isDebt = customerBalance(customer) > 0;
                  setContactTarget({
                    customer,
                    heading:
                      current.type === "settlement"
                        ? "یادآور موعد تسویه"
                        : "ارسال یادآوری به مشتری",
                    presetText:
                      isDebt || current.type === "settlement"
                        ? undefined
                        : `سلام ${customerFullName(customer)} عزیز،\nیادآوری: ${current.reminder.title}${
                            current.reminder.note ? `\n${current.reminder.note}` : ""
                          }`,
                  });
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
                پیامک یادآور
              </button>
            </div>
            {phone && (
              <button
                type="button"
                onClick={() =>
                  openExternal(
                    `https://wa.me/${toIntlPhone(phone)}?text=${encodeURIComponent(
                      current.type === "settlement"
                        ? `سلام ${customerFullName(customer!)} عزیز، موعد تسویه بدهی شما به ${shopName} رسیده است.`
                        : `سلام${customer ? ` ${customerFullName(customer)}` : ""}، یادآوری: ${current.reminder.title}`,
                    )}`,
                  )
                }
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-green-600 py-2.5 text-xs font-semibold text-white"
              >
                <MessageCircle className="h-4 w-4" />
                واتساپ
              </button>
            )}
            {!phone && (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {customer
                  ? "شماره تلفن این مشتری ثبت نشده — از ویرایش مشتری اضافه کنید."
                  : "این یادآوری به مشتری وصل نیست؛ برای تماس، هنگام ثبت یادآوری مشتری را انتخاب کنید."}
              </p>
            )}

            <div className="mt-3 flex items-center gap-1.5">
              {current.type === "reminder" ? (
                <>
                  <button
                    type="button"
                    onClick={() => remindersStore.markDone(current.reminder.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-semibold text-white"
                  >
                    <Check className="h-3.5 w-3.5" />
                    انجام شد
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      remindersStore.update({
                        ...current.reminder,
                        dueAt: Date.now() + SNOOZE_MINUTES * 60_000,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2.5 text-xs"
                  >
                    <Clock className="h-3.5 w-3.5" />۱ ساعت بعد
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={dismissCurrent}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-semibold"
                >
                  امروز دیگر نشان نده
                </button>
              )}
              <Link
                to={current.type === "reminder" ? "/reminders" : "/customers"}
                className="rounded-xl border border-border px-3 py-2.5 text-xs text-muted-foreground"
              >
                {current.type === "reminder" ? "یادآوری‌ها" : "مشتریان"}
              </Link>
            </div>

            {due.length > 1 && (
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {formatNumber(Math.min(index, due.length - 1) + 1)} از {formatNumber(due.length)}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIndex((i) => (i - 1 + due.length) % due.length)}
                    className="rounded-lg border border-border px-2 py-1 hover:bg-accent"
                  >
                    قبلی
                  </button>
                  <button
                    type="button"
                    onClick={() => setIndex((i) => (i + 1) % due.length)}
                    className="rounded-lg border border-border px-2 py-1 hover:bg-accent"
                  >
                    بعدی
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {contactTarget && (
        <DebtContactDialog
          customer={contactTarget.customer}
          heading={contactTarget.heading}
          presetText={contactTarget.presetText}
          onClose={() => setContactTarget(null)}
        />
      )}
    </>,
    document.body,
  );
}

function AlertHeader({
  item,
  extraCount,
  onClose,
}: {
  item: AlertItem;
  extraCount: number;
  onClose: () => void;
}) {
  const overdue =
    item.type === "settlement"
      ? item.when === "overdue"
      : reminderStatus(item.reminder) === "overdue";
  const label =
    item.type === "settlement"
      ? SETTLEMENT_COPY[item.when].badge
      : overdue
        ? "یادآوری عقب‌افتاده"
        : "یادآوری همین حالا";
  const cls = overdue
    ? "bg-destructive/10 text-destructive"
    : "bg-amber-500/15 text-amber-700 dark:text-amber-400";

  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold ${cls}`}>
      <span className="relative flex h-2 w-2">
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
            overdue ? "bg-destructive" : "bg-amber-500"
          }`}
        />
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${overdue ? "bg-destructive" : "bg-amber-500"}`}
        />
      </span>
      <Bell className="h-3.5 w-3.5" />
      <span id="due-alert-title">{label}</span>
      {extraCount > 0 && (
        <span className="mr-auto rounded-full bg-background/70 px-2 py-0.5 text-[10px]">
          +{formatNumber(extraCount)} مورد دیگر
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mr-1 grid h-7 w-7 place-items-center rounded-lg hover:bg-background/60"
        aria-label="بستن تا پایان امروز"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AlertBody({ item }: { item: AlertItem }) {
  if (item.type === "settlement") {
    const copy = SETTLEMENT_COPY[item.when];
    return (
      <>
        <div className="text-base font-bold">{copy.title}</div>
        <p className="mt-1 text-sm leading-6">
          پرداخت <strong>{customerFullName(item.customer)}</strong>{" "}
          {item.when === "tomorrow" ? "فردا" : item.when === "today" ? "امروز" : "از موعد گذشته"}{" "}
          است. از پیامک یا تماس برای پیگیری طلب استفاده کنید.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3 w-3" />
            موعد {formatJalaliYmd(item.customer.settlementDate)}
          </span>
        </div>
      </>
    );
  }

  const r = item.reminder;
  return (
    <>
      <div className="text-base font-bold">{r.title}</div>
      {r.note && <p className="mt-1 text-sm text-muted-foreground">{r.note}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <CalendarClock className="h-3 w-3" />
          {formatJalaliDate(r.dueAt)}
        </span>
        {(item.customer || r.customerName) && (
          <span>{item.customer ? customerFullName(item.customer) : r.customerName}</span>
        )}
      </div>
    </>
  );
}
