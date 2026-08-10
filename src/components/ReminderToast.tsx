import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, Check, Clock, X, CalendarClock } from "lucide-react";
import {
  reminders as remindersStore,
  reminderStatus,
  formatJalaliDate,
  formatNumber,
  type Reminder,
} from "@/lib/store";

const SNOOZE_MINUTES = 60;

/**
 * اعلان شناور یادآوری‌ها — وقتی یادآوری‌ای سررسید شده باشد (امروز یا عقب‌افتاده)
 * یک کارت زیبا بالای نوار پایین ظاهر می‌شود با سه اقدام سریع:
 * «انجام شد»، «۱ ساعت بعد» و بستن (فقط تا پایان همین اجرا پنهان می‌شود).
 */
export function ReminderToast() {
  const [list] = remindersStore.useAll();
  const [dismissed, setDismissed] = useState<string[]>([]);
  // هر دقیقه دوباره ارزیابی می‌شود تا یادآوری‌ای که همین حالا سررسید شده هم دیده شود
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const due = useMemo(
    () =>
      list
        .filter((r) => {
          if (r.done || dismissed.includes(r.id)) return false;
          const st = reminderStatus(r);
          // یادآوری «امروز» فقط بعد از رسیدن ساعتش نمایش داده می‌شود
          if (st === "due-today") return r.dueAt <= Date.now();
          return st === "overdue";
        })
        .sort((a, b) => a.dueAt - b.dueAt),
    [list, dismissed],
  );

  if (due.length === 0) return null;
  const current = due[0] as Reminder;
  const overdue = reminderStatus(current) === "overdue";

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: "calc(5.5rem + var(--safe-bottom))" }}
    >
      <div className="pointer-events-auto w-full max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-elegant">
          <div className={`flex items-center gap-2 px-4 py-2 text-[11px] font-semibold ${
            overdue ? "bg-destructive/10 text-destructive" : "bg-amber-500/15 text-amber-600"
          }`}>
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                overdue ? "bg-destructive" : "bg-amber-500"
              }`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${overdue ? "bg-destructive" : "bg-amber-500"}`} />
            </span>
            <Bell className="h-3.5 w-3.5" />
            {overdue ? "یادآوری عقب‌افتاده" : "یادآوری همین حالا"}
            {due.length > 1 && (
              <span className="mr-auto rounded-full bg-background/60 px-2 py-0.5 text-[10px]">
                +{formatNumber(due.length - 1)} مورد دیگر
              </span>
            )}
            <button
              onClick={() => setDismissed((d) => [...d, current.id])}
              className="mr-1 grid h-6 w-6 place-items-center rounded-lg hover:bg-background/60"
              aria-label="بستن"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="px-4 py-3">
            <div className="truncate text-sm font-bold">{current.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                {formatJalaliDate(current.dueAt)}
              </span>
              {current.customerName && <span>{current.customerName}</span>}
            </div>
            {current.note && <div className="mt-1 text-[11px] text-muted-foreground">{current.note}</div>}

            <div className="mt-3 flex items-center gap-1.5">
              <button
                onClick={() => remindersStore.markDone(current.id)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground"
              >
                <Check className="h-3.5 w-3.5" />
                انجام شد
              </button>
              <button
                onClick={() =>
                  remindersStore.update({ ...current, dueAt: Date.now() + SNOOZE_MINUTES * 60_000 })
                }
                className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs"
              >
                <Clock className="h-3.5 w-3.5" />
                ۱ ساعت بعد
              </button>
              <Link
                to="/reminders"
                className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground"
              >
                همه
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
