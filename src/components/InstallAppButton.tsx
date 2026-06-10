import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);

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
      return;
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
    if (isIOS) {
      setShowIOSHint(true);
      return;
    }

    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setIsInstalled(true);
    } catch (err) {
      console.warn("PWA install failed:", err);
    } finally {
      setDeferredPrompt(null);
    }
  };

  if (isInstalled) return null;

  if (isIOS && showIOSHint) {
    return (
      <div className="fixed inset-x-0 bottom-24 z-50 mx-auto max-w-sm rounded-2xl border border-border bg-card p-4 shadow-elegant">
        <div className="text-sm font-bold text-foreground">نصب اپلیکیشن روی iOS</div>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          در سافاری روی دکمه اشتراک‌گذاری (آیکون جعبه با فلش) بزنید، سپس «Add to Home Screen» را انتخاب کنید.
        </p>
        <button
          onClick={() => setShowIOSHint(false)}
          className="mt-3 text-xs text-primary font-medium"
        >
          متوجه شدم
        </button>
      </div>
    );
  }

  if (deferredPrompt || isIOS) {
    return (
      <button
        type="button"
        onClick={handleInstallClick}
        className="flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:opacity-90"
        title="نصب اپلیکیشن"
      >
        <Download className="h-3.5 w-3.5" />
        نصب اپ
      </button>
    );
  }

  return null;
}
