import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { DatabaseBackup, Download, Loader2, Smartphone, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { isWebView } from "@/lib/isWebView";
import { authUserId, isAppSession } from "@/lib/subscription-access";
import {
  backupReminderDue,
  readBackupReminderPref,
  snoozeBackupReminder,
  writeBackupReminderPref,
  type BackupReminderFreq,
} from "@/lib/backup-reminder";
import { exportFullBackupExcel } from "@/lib/backup-export";
import { isCloudHydrated, settings } from "@/lib/store";

const SHOW_DELAY_MS = 1800;

function onboardingStillActive(): boolean {
  const s = settings.get();
  if (s.onboardingEligible === true && !s.onboardingDismissed) return true;
  if (s.onboardingEligible === true && !s.apkWelcomeDismissed) return true;
  return false;
}

/**
 * یادآوری پشتیبان‌گیری: سایت = دانلود اکسل کامل؛ اپ = فقط یادآوری.
 */
export function BackupReminderDialog({ forceOpen = false }: { forceOpen?: boolean }) {
  const { state } = useAuth();
  const userId = authUserId(state);
  const [open, setOpen] = useState(forceOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inApp = useMemo(() => isWebView(), []);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      return;
    }
    if (!isAppSession(state) || !userId) {
      setOpen(false);
      return;
    }
    if (!backupReminderDue(readBackupReminderPref(userId))) return;

    let cancelled = false;
    let retry: number | undefined;
    const timer = window.setTimeout(() => {
      if (cancelled || onboardingStillActive()) return;
      const show = () => {
        if (!cancelled && backupReminderDue(readBackupReminderPref(userId))) setOpen(true);
      };
      if (!isCloudHydrated()) {
        retry = window.setTimeout(show, 2500);
        return;
      }
      show();
    }, SHOW_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retry) window.clearTimeout(retry);
    };
  }, [state, userId, forceOpen]);

  const snooze = (freq: BackupReminderFreq) => {
    if (!userId) return;
    writeBackupReminderPref(userId, snoozeBackupReminder(freq));
    setOpen(false);
    setError(null);
    setBusy(false);
  };

  const onConfirm = async () => {
    if (inApp) {
      snooze("daily");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await exportFullBackupExcel();
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    snooze("daily");
  };

  if (!open) return null;

  const body = (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-reminder-title"
      dir="rtl"
    >
      <div className="relative w-full max-w-[22.5rem] overflow-hidden rounded-3xl border border-border bg-background shadow-2xl">
        <div className="bg-gradient-to-l from-sky-600 to-teal-500 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15">
                <DatabaseBackup className="h-5 w-5" />
              </div>
              <div>
                <h2 id="backup-reminder-title" className="text-base font-bold">
                  پشتیبان‌گیری پیشنهادی
                </h2>
                <p className="mt-0.5 text-[11px] text-white/85">یک فایل اکسل برای خودتان</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => snooze("daily")}
              aria-label="بعداً"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-3 p-5 text-sm leading-7">
          {inApp ? (
            <>
              <p className="text-[13px] leading-7 text-foreground">
                اطلاعات فروشگاهتان مثل همیشه در حساب شما هست. اگر دوست دارید یک فایل اکسل هم روی
                گوشی یا رایانهٔ خودتان داشته باشید، از سایت بگیرید — داخل اپ دانلود فایل باز
                نمی‌شود.
              </p>
              <div className="rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-[12px] leading-7 text-foreground">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-primary">
                  <Smartphone className="h-3.5 w-3.5" />
                  راهنمای کوتاه
                </div>
                <ol className="list-decimal space-y-1 pr-4">
                  <li>مرورگر گوشی یا رایانه را باز کنید (مثلاً کروم).</li>
                  <li>
                    بروید به{" "}
                    <span className="font-semibold" dir="ltr">
                      kamixapp.ir
                    </span>
                  </li>
                  <li>با همان نام کاربری و همان رمز عبوری که در این اپ وارد می‌شوید، وارد شوید.</li>
                  <li>
                    از منوی پایین «بیشتر» را بزنید، «پشتیبان‌گیری» را باز کنید و فایل اکسل را دریافت
                    کنید.
                  </li>
                </ol>
              </div>
            </>
          ) : (
            <p className="text-[13px] leading-7 text-foreground">
              اگر دوست دارید یک فایل اکسل از فاکتورها، مشتریان و محصولاتتان روی همین دستگاه هم باشد،
              با تأیید دانلود می‌شود. کار فروشگاه مثل همیشه ادامه دارد.
            </p>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-600">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : inApp ? null : (
              <Download className="h-4 w-4" />
            )}
            {inApp ? "متوجه شدم" : "تأیید و دریافت اکسل"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => snooze("weekly")}
            className="w-full rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
          >
            هفته‌ای یک‌بار یادآوری کن
          </button>
          <p className="text-center text-[11px] leading-5 text-muted-foreground">
            {inApp
              ? "اگر هر روز این یادآوری را نمی‌خواهید، گزینهٔ هفتگی را بزنید."
              : "تأیید فقط فایل را ذخیره می‌کند. اگر هر روز این پنجره را نمی‌خواهید، یادآوری هفتگی را انتخاب کنید."}
          </p>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}
