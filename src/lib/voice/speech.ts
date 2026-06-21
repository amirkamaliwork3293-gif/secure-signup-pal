/**
 * speech.ts — لایه‌ی انتزاعی تبدیل گفتار به متن (Speech-to-Text) سازگار با
 * مرورگر و اپ اندروید (Capacitor).
 *
 * چرا؟ Web Speech API (`SpeechRecognition`) داخل WebView اندروید وجود ندارد —
 * گوگل آن را فقط در خود کروم ارائه می‌دهد، نه در کامپوننت WebView. پس در نسخه
 * APK باید از پلاگین نیتیو `@capacitor-community/speech-recognition` استفاده کنیم
 * که مثل بقیه‌ی پلاگین‌ها (Printer/Share/...) روی `window.Capacitor.Plugins`
 * تزریق می‌شود. مسیرها:
 *
 *   1. اپ اندروید + پلاگین SpeechRecognition → تشخیص گفتار نیتیو گوگل (fa-IR)
 *   2. مرورگر دارای Web Speech API            → webkitSpeechRecognition
 *   3. هیچ‌کدام                                → پشتیبانی ندارد؛ ورود دستی متن
 *
 * تمام خطاها (رد دسترسی میکروفون، عدم پشتیبانی) با پیام فارسی روشن برمی‌گردند
 * تا رابط کاربری بدون کرش یا شکست بی‌صدا، پیام مناسب نشان دهد.
 */

import { isNativeApp } from "@/lib/print";

export type SpeechEngine = "native" | "web" | "none";

export type StartHandlers = {
  /** نتیجه‌ی موقت (زنده) حین صحبت */
  onPartial?: (text: string) => void;
  /** نتیجه‌ی نهایی پس از پایان صحبت */
  onResult: (text: string) => void;
  /** خطای موقت تشخیص گفتار (مثلاً صدایی شنیده نشد) — کاربر می‌تواند دوباره تلاش کند */
  onError: (message: string) => void;
  /**
   * میکروفون در دسترس نیست (اجازه داده نشد یا دستگاه پشتیبانی نمی‌کند).
   * در این حالت رابط کاربری باید بی‌سروصدا به «ورود دستی متن» برگردد — نه اینکه
   * کاربر را مجبور به فعال‌کردن میکروفون کند. اگر تعریف نشده باشد، به onError می‌افتد.
   */
  onUnavailable?: (message: string) => void;
  /** پایان شنیدن (به هر دلیل) */
  onEnd?: () => void;
};

export type Recognizer = {
  engine: SpeechEngine;
  isSupported: boolean;
  start: (handlers: StartHandlers) => Promise<void>;
  stop: () => Promise<void>;
};

// ─── دسترسی به پلاگین نیتیو ───────────────────────────────────────────────────

type PermState = "granted" | "denied" | "prompt" | string;

type NativeSpeechPlugin = {
  available: () => Promise<{ available: boolean }>;
  checkPermissions?: () => Promise<{ speechRecognition: PermState }>;
  requestPermissions?: () => Promise<{ speechRecognition: PermState }>;
  start: (opts: {
    language?: string;
    maxResults?: number;
    prompt?: string;
    popup?: boolean;
    partialResults?: boolean;
  }) => Promise<{ matches?: string[] }>;
  stop: () => Promise<void>;
  addListener: (
    event: "partialResults" | "listeningState",
    cb: (data: { matches?: string[]; status?: string }) => void,
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => void };
  removeAllListeners: () => Promise<void>;
};

function nativeSpeech(): NativeSpeechPlugin | null {
  if (typeof window === "undefined") return null;
  const p = (
    window as unknown as {
      Capacitor?: { Plugins?: { SpeechRecognition?: NativeSpeechPlugin } };
    }
  ).Capacitor?.Plugins?.SpeechRecognition;
  return p && typeof p.start === "function" ? p : null;
}

// ─── Web Speech API ───────────────────────────────────────────────────────────

type WebSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function webSpeechCtor(): (new () => WebSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => WebSpeechRecognition;
    webkitSpeechRecognition?: new () => WebSpeechRecognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// ─── تشخیص موتور ──────────────────────────────────────────────────────────────

export function detectEngine(): SpeechEngine {
  if (isNativeApp() && nativeSpeech()) return "native";
  if (webSpeechCtor()) return "web";
  return "none";
}

const PERMISSION_DENIED_MSG = "میکروفون فعال نشد — می‌توانید در عوض متن را دستی وارد کنید.";
const UNSUPPORTED_MSG =
  "تشخیص گفتار روی این دستگاه در دسترس نیست — می‌توانید متن را دستی وارد کنید.";

/** میکروفون در دسترس نیست → ترجیحاً به ورود دستی برگرد؛ اگر هندلر نبود، خطا بده. */
function notifyUnavailable(h: StartHandlers, message: string) {
  if (h.onUnavailable) h.onUnavailable(message);
  else h.onError(message);
}

// ─── ساخت Recognizer ──────────────────────────────────────────────────────────

export function createRecognizer(): Recognizer {
  const engine = detectEngine();

  if (engine === "native") {
    return createNativeRecognizer();
  }
  if (engine === "web") {
    return createWebRecognizer();
  }
  return {
    engine: "none",
    isSupported: false,
    start: async (h) => notifyUnavailable(h, UNSUPPORTED_MSG),
    stop: async () => {},
  };
}

function createNativeRecognizer(): Recognizer {
  let listeners: Array<{ remove: () => void | Promise<void> }> = [];
  let lastPartial = "";
  let ended = false;

  const cleanup = async () => {
    for (const l of listeners) {
      try {
        await l.remove();
      } catch {
        /* ignore */
      }
    }
    listeners = [];
    const p = nativeSpeech();
    try {
      await p?.removeAllListeners();
    } catch {
      /* ignore */
    }
  };

  return {
    engine: "native",
    isSupported: true,
    start: async (h) => {
      const p = nativeSpeech();
      if (!p) return h.onError(UNSUPPORTED_MSG);
      ended = false;
      lastPartial = "";
      try {
        const avail = await p.available();
        if (!avail?.available) return notifyUnavailable(h, UNSUPPORTED_MSG);

        // اجازه‌ی میکروفون فقط همین‌جا — یعنی وقتی کاربر خودش دکمه‌ی ضبط را زده —
        // درخواست می‌شود؛ نه هنگام باز شدن صفحه. اگر داده نشد، به‌جای اجبار کاربر
        // به تنظیمات، بی‌سروصدا به ورود دستی برمی‌گردیم.
        const perm = (await p.checkPermissions?.())?.speechRecognition;
        if (perm !== "granted") {
          const req = (await p.requestPermissions?.())?.speechRecognition;
          if (req && req !== "granted") return notifyUnavailable(h, PERMISSION_DENIED_MSG);
        }

        const partial = await p.addListener("partialResults", (data) => {
          const text = data?.matches?.[0];
          if (text) {
            lastPartial = text;
            h.onPartial?.(text);
          }
        });
        if (partial && "remove" in partial) listeners.push(partial as { remove: () => void });

        const state = await p.addListener("listeningState", (data) => {
          if (data?.status === "stopped" && !ended) {
            ended = true;
            void cleanup();
            if (lastPartial) h.onResult(lastPartial);
            h.onEnd?.();
          }
        });
        if (state && "remove" in state) listeners.push(state as { remove: () => void });

        const res = await p.start({
          language: "fa-IR",
          maxResults: 3,
          partialResults: true,
          popup: false,
        });
        // برخی نسخه‌ها نتیجه‌ی نهایی را مستقیم برمی‌گردانند
        const direct = res?.matches?.[0];
        if (direct && !ended) {
          ended = true;
          await cleanup();
          h.onResult(direct);
          h.onEnd?.();
        }
      } catch (e) {
        await cleanup();
        const msg = String((e as { message?: string })?.message ?? e);
        if (/permission|denied|اجازه|not.?allowed/i.test(msg))
          notifyUnavailable(h, PERMISSION_DENIED_MSG);
        else h.onError("خطا در تشخیص گفتار. دوباره تلاش کنید یا متن را دستی وارد کنید.");
      }
    },
    stop: async () => {
      const p = nativeSpeech();
      try {
        await p?.stop();
      } catch {
        /* ignore */
      }
    },
  };
}

function createWebRecognizer(): Recognizer {
  const Ctor = webSpeechCtor();
  let rec: WebSpeechRecognition | null = null;

  return {
    engine: "web",
    isSupported: !!Ctor,
    start: async (h) => {
      if (!Ctor) return notifyUnavailable(h, UNSUPPORTED_MSG);
      try {
        rec = new Ctor();
        rec.lang = "fa-IR";
        rec.continuous = false;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        let finalText = "";

        rec.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            const txt = r[0]?.transcript ?? "";
            if (r.isFinal) finalText += txt;
            else interim += txt;
          }
          if (interim) h.onPartial?.((finalText + " " + interim).trim());
          if (finalText) h.onPartial?.(finalText.trim());
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed")
            notifyUnavailable(h, PERMISSION_DENIED_MSG);
          else if (e.error === "no-speech") h.onError("صدایی شنیده نشد. دوباره تلاش کنید.");
          else h.onError("خطا در تشخیص گفتار. دوباره تلاش کنید.");
        };
        rec.onend = () => {
          if (finalText.trim()) h.onResult(finalText.trim());
          h.onEnd?.();
        };
        rec.start();
      } catch {
        h.onError(UNSUPPORTED_MSG);
      }
    },
    stop: async () => {
      try {
        rec?.stop();
      } catch {
        /* ignore */
      }
    },
  };
}
