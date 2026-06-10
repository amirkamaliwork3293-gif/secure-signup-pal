import { useEffect, useState } from "react";
import { Download, X, Share2 } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showHint, setShowHint] = useState<null | "ios" | "desktop" | "android">(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);
    if (ios) {
      setIsIOS(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === "accepted") setIsInstalled(true);
      } catch (err) {
        console.warn("PWA install failed:", err);
      } finally {
        setDeferredPrompt(null);
      }
      return;
    }
    // Fallback: browser hasn't fired beforeinstallprompt (iOS Safari, Firefox, unsupported)
    if (isIOS) {
      setShowHint("ios");
    } else {
      const ua = window.navigator.userAgent.toLowerCase();
      const isAndroid = /android/.test(ua);
      setShowHint(isAndroid ? "android" : "desktop");
    }
  };

  if (isInstalled) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:opacity-90"
        title="نصب اپلیکیشن"
      >
        <Download className="h-3.5 w-3.5" />
        نصب اپ
      </button>
      {showHint && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-elegant">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
                  {showHint === "ios" ? <Share2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
                </div>
                <div className="text-sm font-bold">نصب اپلیکیشن</div>
              </div>
              <button
                onClick={() => setShowHint(null)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
                aria-label="بستن"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 text-xs text-muted-foreground leading-relaxed">
              {showHint === "ios" && (
                <ol className="list-decimal pr-5 space-y-1">
                  <li>در سافاری روی آیکون اشتراک‌گذاری (مربع با فلش رو به بالا) بزنید.</li>
                  <li>گزینه «Add to Home Screen» را انتخاب کنید.</li>
                  <li>روی «Add» بزنید — اپ مثل یک برنامه واقعی نصب می‌شود.</li>
                </ol>
              )}
              {showHint === "android" && (
                <ol className="list-decimal pr-5 space-y-1">
                  <li>روی منوی سه‌نقطه مرورگر بزنید.</li>
                  <li>گزینه «Install app» یا «Add to Home screen» را انتخاب کنید.</li>
                  <li>تأیید کنید — اپ نصب می‌شود.</li>
                </ol>
              )}
              {showHint === "desktop" && (
                <ol className="list-decimal pr-5 space-y-1">
                  <li>در نوار آدرس مرورگر روی آیکون نصب (Install) بزنید.</li>
                  <li>اگر دیده نمی‌شود، از منوی مرورگر گزینه «Install» یا «Apps → Install this site» را انتخاب کنید.</li>
                  <li>برای Firefox: نصب مستقیم پشتیبانی نمی‌شود — از Chrome/Edge استفاده کنید.</li>
                </ol>
              )}
            </div>
            <button
              onClick={() => setShowHint(null)}
              className="mt-4 w-full rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
            >
              متوجه شدم
            </button>
          </div>
        </div>
      )}
    </>
  );
}
