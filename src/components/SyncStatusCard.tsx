import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Copy, RefreshCw, Stethoscope } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { invoice, formatJalaliDateTime, useSyncState } from "@/lib/store";
import { checkConnectionNow, useOnlineStatus } from "@/lib/online-status";
import { isCapacitor, isNativeApp } from "@/lib/isWebView";
import { AUTH_FA, formatSyncLog, readSyncLog, syncErrorFa } from "@/lib/sync-log";
import { readJournal } from "@/lib/invoice-journal";
import { authUserId } from "@/lib/subscription-access";
import { getOfflineReadiness, OFFLINE_READY_KEY } from "@/registerSW";

/**
 * «وضعیت همگام‌سازی و آفلاین»: برای اینکه کاربر ببیند چه چیزی منتظر ارسال است و
 * اگر مشکلی بود، یک عکس یا متن کپی‌شده از همین بخش برای پشتیبانی بفرستد.
 */
export function SyncStatusCard() {
  const [open, setOpen] = useState(false);
  const { state } = useAuth();
  const sync = useSyncState();
  const { kind, lastSyncedAt } = useOnlineStatus();
  const [history] = invoice.useHistory();
  const [journalPending, setJournalPending] = useState<number | null>(null);
  const [logText, setLogText] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const userId = authUserId(state);

  const refresh = async () => {
    setLogText(formatSyncLog(readSyncLog().slice(-60)));
    if (userId) {
      const j = await readJournal(userId);
      setJournalPending(j.filter((e) => !e.confirmedAt).length);
    }
  };

  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sync.pending, sync.lastOkAt, history.length]);

  const readiness = getOfflineReadiness();
  let readyVersion = "";
  try {
    readyVersion = localStorage.getItem(OFFLINE_READY_KEY) || "";
  } catch {
    /* noop */
  }

  const rows: [string, string][] = [
    ["داخل اپ اندروید", isNativeApp() ? (isCapacitor() ? "بله" : "بله (بدون پل)") : "خیر (مرورگر)"],
    ["اتصال", kind === "online" ? "آنلاین" : kind === "offline" ? "آفلاین" : "در حال بررسی"],
    ["وضعیت ورود", AUTH_FA[state.status] || state.status],
    [
      "آمادهٔ کار آفلاین",
      readiness.known
        ? readiness.complete
          ? "کامل ✓"
          : `${readiness.done.toLocaleString("fa-IR")} از ${readiness.total.toLocaleString("fa-IR")}`
        : readyVersion
          ? `کامل (نسخهٔ ${readyVersion.slice(0, 6)})`
          : "نامشخص",
    ],
    ["بخش‌های منتظر ارسال", sync.pending.toLocaleString("fa-IR")],
    ["آخرین ارسال موفق", sync.lastOkAt ? formatJalaliDateTime(sync.lastOkAt) : "—"],
    ["آخرین همگام‌سازی", lastSyncedAt ? formatJalaliDateTime(lastSyncedAt) : "—"],
    ["آخرین خطا", sync.failed ? syncErrorFa(sync.lastError || "") : "—"],
    ["حافظهٔ گوشی", sync.localStorageFull ? "پر است ⚠️" : "عادی"],
    ["فاکتورهای روی گوشی", history.length.toLocaleString("fa-IR")],
    [
      "فاکتورهای هنوز تأییدنشده روی سرور",
      journalPending === null ? "…" : journalPending.toLocaleString("fa-IR"),
    ],
  ];

  const sendNow = async () => {
    setBusy(true);
    try {
      await checkConnectionNow();
      await new Promise((r) => setTimeout(r, 4000));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const text = [
      ...rows.map(([k, v]) => `${k}: ${v}`),
      `کد حساب: ${userId ? userId.slice(0, 8) : "-"}`,
      "",
      "رویدادهای اخیر:",
      formatSyncLog(readSyncLog()),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setLogText(text);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2 text-sm font-bold">
          <Stethoscope className="h-4 w-4 text-primary" />
          وضعیت همگام‌سازی و آفلاین
          {sync.pending > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] text-white">
              {sync.pending.toLocaleString("fa-IR")} منتظر ارسال
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-xs">
          <dl className="divide-y divide-border rounded-xl border border-border">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-semibold" dir="auto">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={sendNow}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              {busy ? "در حال ارسال…" : "ارسال الان"}
            </button>
            <button
              type="button"
              onClick={copy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 font-semibold"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? "کپی شد ✓" : "کپی گزارش برای پشتیبانی"}
            </button>
          </div>
          <pre
            dir="rtl"
            className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-2 text-[10px] leading-4"
          >
            {logText || "—"}
          </pre>
        </div>
      )}
    </div>
  );
}
