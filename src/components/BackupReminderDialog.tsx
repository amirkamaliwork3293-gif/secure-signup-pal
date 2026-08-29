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
                  یک نسخه پیش خودتان نگه دارید
                </h2>
                <p className="mt-0.5 text-[11px] text-white/85">یادآوری روزانه پشتیبان‌گیری</p>
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
              <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-6 text-amber-800 dark:text-amber-300">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
                دانلود فایل داخل اپلیکیشن ممکن نیست. لطفاً با همین حساب از مرورگر وارد kamixapp.ir
                شوید و از بخش «پشتیبان‌گیری» فایل اکسل را بگیرید.
              </div>
              <p className="text-[13px] text-foreground">
                اطلاعات فروشگاه روی سرور همگام است؛ یک نسخهٔ اکسل روی رایانه یا گوشی، اگر روزی مشکلی
                پیش آمد خیالتان را راحت می‌کند.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-foreground">
              پیشنهاد می‌کنیم همین حالا از همهٔ بخش‌ها (فاکتور، مشتری، محصول و…) یک فایل اکسل بگیرید
              و در جای امن ذخیره کنید. با «تأیید» فایل دانلود می‌شود و فردا دوباره یادآوری می‌کنیم.
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
              ? "اگر هر روز این پیام را نمی‌خواهید، یادآوری هفتگی را انتخاب کنید."
              : "تأیید یعنی فردا دوباره یادآوری می‌شود. یادآوری هفتگی تا هفت روز بعد نشان داده نمی‌شود."}
          </p>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}
