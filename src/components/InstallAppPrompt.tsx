import { useEffect, useState } from "react";
import { Download, X, Share2 } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "kamali_pwa_dismissed_until";

export function InstallAppPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    try {
      const dismissUntil = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      if (dismissUntil > Date.now()) return;
    } catch { /* ignore */ }

    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua);

    if (ios) {
      setIsIOS(true);
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }

    const handlePrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setVisible(true), 1500);
    };

    const handleInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
    } catch { /* ignore */ }
    setVisible(false);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setIsInstalled(true);
    } catch (err) {
      console.warn("PWA install prompt failed:", err);
    } finally {
      setDeferredPrompt(null);
      setVisible(false);
    }
  };

  if (!visible || isInstalled) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-50 px-4 sm:bottom-24 animate-in slide-in-from-bottom-4">
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-card/95 p-4 shadow-elegant backdrop-blur">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
              {isIOS ? <Share2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-foreground">نصب حساب‌بان کمالی</div>
              <div className="mt-1 text-[11px] text-muted-foreground">نصب رایگان — بدون مرورگر اجرا می‌شود</div>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-3 text-xs text-muted-foreground leading-relaxed">
          {isIOS ? (
            <>
              <div className="font-semibold text-foreground mb-2">برای نصب روی iPhone/iPad:</div>
              <ol className="list-decimal pr-5 space-y-1">
                <li>در سافاری روی آیکون اشتراک‌گذاری بزنید</li>
                <li>گزینه «Add to Home Screen» را انتخاب کنید</li>
                <li>روی «Add» بزنید تا نصب شود</li>
              </ol>
              <div className="mt-2 text-primary">اپ مثل یک برنامه واقعی روی صفحه اصلی اضافه می‌شود ✓</div>
            </>
          ) : (
            <p>این برنامه را روی موبایل یا کامپیوتر خود نصب کنید تا مثل یک اپ واقعی، بدون مرورگر اجرا شود.</p>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2">
          {!isIOS && (
            <button
              onClick={handleInstall}
              disabled={!deferredPrompt}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              نصب اپلیکیشن
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
          >
            بعداً
          </button>
        </div>
      </div>
    </div>
  );
}
