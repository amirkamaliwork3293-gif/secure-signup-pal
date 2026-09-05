import { useEffect, useRef, useState } from "react";
import {
  TURNSTILE_SCRIPT_SRC,
  isRestrictedBrowserForTurnstile,
  turnstileScriptTimedOut,
  type TurnstileWidgetStatus,
} from "@/lib/turnstile";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          language?: string;
          appearance?: "always" | "execute" | "interaction-only";
          size?: "normal" | "flexible" | "compact";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function resetTurnstileScriptLoader() {
  scriptPromise = null;
  if (typeof document === "undefined") return;
  document
    .querySelectorAll<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]')
    .forEach((el) => el.remove());
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="challenges.cloudflare.com/turnstile"]',
    );
    const finishOk = () => resolve();
    const finishErr = () => {
      scriptPromise = null;
      reject(new Error("turnstile"));
    };
    if (existing) {
      if (window.turnstile) {
        resolve();
        return;
      }
      existing.addEventListener("load", finishOk, { once: true });
      existing.addEventListener("error", finishErr, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = finishOk;
    script.onerror = finishErr;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

type Props = {
  siteKey: string;
  onToken: (token: string) => void;
  /** با افزایش این عدد، ویجت ریست می‌شود (بعد از خطای ارسال). */
  resetSignal?: number;
  onStatus?: (status: TurnstileWidgetStatus) => void;
};

export function TurnstileWidget({ siteKey, onToken, resetSignal = 0, onStatus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const [status, setStatus] = useState<TurnstileWidgetStatus>("loading");
  const [retry, setRetry] = useState(0);
  const inAppBrowser =
    typeof navigator !== "undefined" && isRestrictedBrowserForTurnstile(navigator.userAgent || "");

  const publish = (next: TurnstileWidgetStatus) => {
    setStatus(next);
    onStatusRef.current?.(next);
  };

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    const startedAt = Date.now();
    widgetIdRef.current = null;
    publish("loading");
    onTokenRef.current("");

    const markBlocked = () => {
      if (cancelled) return;
      publish("blocked");
      onTokenRef.current("");
    };

    const render = () => {
      if (cancelled || !hostRef.current || !window.turnstile) return;
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* already gone */
        }
        widgetIdRef.current = null;
      }
      hostRef.current.innerHTML = "";
      try {
        widgetIdRef.current = window.turnstile.render(hostRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            if (cancelled) return;
            publish("ready");
            onTokenRef.current(token);
          },
          "expired-callback": () => onTokenRef.current(""),
          "error-callback": () => {
            onTokenRef.current("");
            if (!widgetIdRef.current) markBlocked();
          },
          theme: "light",
          language: "fa",
          appearance: "always",
          size: "flexible",
        });
        if (!cancelled && widgetIdRef.current) publish("ready");
        else if (!cancelled) markBlocked();
      } catch {
        markBlocked();
      }
    };

    loadTurnstileScript().then(render).catch(markBlocked);

    const timer = window.setInterval(() => {
      if (cancelled) return;
      if (widgetIdRef.current) {
        window.clearInterval(timer);
        return;
      }
      if (turnstileScriptTimedOut(startedAt, Date.now(), Boolean(widgetIdRef.current))) {
        window.clearInterval(timer);
        markBlocked();
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, retry]);

  useEffect(() => {
    if (!resetSignal) return;
    onTokenRef.current("");
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        /* ignore */
      }
    }
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <div className="space-y-1">
      <div
        ref={hostRef}
        className="flex min-h-[65px] w-full min-w-[280px] justify-center"
        dir="ltr"
      />
      {status === "loading" && (
        <p className="text-center text-[11px] text-muted-foreground">در حال آماده‌سازی تأیید امنیتی…</p>
      )}
      {status === "blocked" && (
        <div className="rounded-xl border border-border bg-card px-3 py-2.5 text-[11px] leading-6 text-foreground">
          <p className="font-semibold">کادر تأیید کلادفلر اینجا باز نشد.</p>
          <p className="mt-1 text-muted-foreground">
            برای بعضی خطوط اینترنت ایران، مرورگر داخل تلگرام یا اینستاگرام، و مسدودکنندهٔ تبلیغات این کادر
            نمی‌آید — سایت سالم است.
          </p>
          {inAppBrowser && (
            <p className="mt-1 text-muted-foreground">
              الان داخل برنامهٔ دیگری هستید. از منو «باز کردن در مرورگر» را بزنید و با کروم ادامه دهید.
            </p>
          )}
          <p className="mt-1 text-muted-foreground">
            صفحه را در کروم یا فایرفاکس باز کنید، تبلیغ‌بند را خاموش کنید، یا فیلترشکن را روشن کنید.
          </p>
          <button
            type="button"
            onClick={() => {
              resetTurnstileScriptLoader();
              setRetry((n) => n + 1);
            }}
            className="mt-2 w-full rounded-lg border border-primary/40 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
          >
            تلاش دوباره
          </button>
        </div>
      )}
    </div>
  );
}
