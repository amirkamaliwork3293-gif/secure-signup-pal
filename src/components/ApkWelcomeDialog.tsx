/**
 * پنجره‌ی خوش‌آمد دانلود اپ — فقط برای کاربران تازه‌ثبت‌نام در سایت،
 * قبل از تور آموزش. داخل اپلیکیشن اندروید نشان داده نمی‌شود.
 */
import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { settings } from "@/lib/store";
import { useAuth } from "@/lib/AuthContext";
import { ApkDownloadButton } from "@/components/ApkDownloadButton";
import {
  dismissApkWelcome,
  resolveOnboardingEligibility,
  shouldShowApkWelcome,
  waitForStoreHydration,
} from "@/lib/onboarding";

export function ApkWelcomeDialog() {
  const { state: authState } = useAuth();
  const [appSettings] = settings.useAll();
  const [show, setShow] = useState(false);
  const profile = authState.status === "authenticated" ? authState.profile : null;
  const username = profile?.username ?? "";

  useEffect(() => {
    let cancelled = false;
    if (authState.status !== "authenticated") {
      setShow(false);
      return;
    }
    void (async () => {
      await waitForStoreHydration();
      if (cancelled) return;
      try {
        resolveOnboardingEligibility(profile);
      } catch {
        /* تصمیم نگرفتن بهتر از کرش صفحه است */
      }
      if (cancelled) return;
      setShow(shouldShowApkWelcome());
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authState.status,
    username,
    profile,
    appSettings.onboardingEligible,
    appSettings.apkWelcomeDismissed,
    appSettings.onboardingDismissed,
    appSettings.onboardingStep,
  ]);

  const continueOnWeb = () => {
    try {
      dismissApkWelcome();
    } catch {
      /* نادیده */
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-foreground/55 p-0 sm:items-center sm:p-4"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="دانلود اپلیکیشن اندروید"
    >
      <div className="flex max-h-[min(92svh,40rem)] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-elegant sm:rounded-3xl">
        <div className="overflow-y-auto p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Smartphone className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold">دانلود اپلیکیشن اندروید</h2>
              <p className="text-[11px] text-muted-foreground">قبل از شروع آموزش</p>
            </div>
          </div>
          <p className="mb-4 text-xs leading-6 text-muted-foreground">
            برای کار راحت‌تر با دوربین، بارکد و دسترسی آفلاین، اپلیکیشن را نصب کنید. اگر الان
            نمی‌خواهید، می‌توانید از همین سایت ادامه دهید.
          </p>
          <ApkDownloadButton className="w-full" />
        </div>
        <div className="shrink-0 border-t border-border bg-card p-4">
          <button
            type="button"
            onClick={continueOnWeb}
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-accent"
          >
            نمی‌خواهم نصب کنم — ادامه از طریق سایت
          </button>
        </div>
      </div>
    </div>
  );
}
