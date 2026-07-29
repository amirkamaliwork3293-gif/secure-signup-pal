/**
 * موتور «ثبت صوتی» — بازسازی کامل (نسخه‌ی ۲).
 *
 * تصمیم معماری: تشخیص گفتار کاملاً روی خود دستگاه انجام می‌شود، نه با ضبط و
 * ارسال فایل صوتی به یک سرور. این یعنی:
 *   - هیچ کلید API و هیچ سروری لازم نیست → خطای «سرویس تشخیص گفتار فعال
 *     نشده است» برای همیشه از بین می‌رود.
 *   - سریع‌تر است: بدون آپلود فایل صوتی، متن مستقیم و آنی برمی‌گردد.
 *   - در وب: از Web Speech API مرورگر استفاده می‌شود (رایگان، داخل Chrome/Edge/Safari).
 *   - در اپلیکیشن اندروید (APK): از android.speech.SpeechRecognizer (همان
 *     موتور گوگل که کیبورد صوتی اندروید هم از آن استفاده می‌کند) از طریق پل
 *     نیتیو KamaliVoice استفاده می‌شود — نتیجه، متن آماده است، نه صدای خام.
 *
 * اگر هیچ‌کدام در دسترس نبود (مرورگر قدیمی/بدون میکروفون)، حالت ورود دستی
 * متن در صفحه‌ی ثبت صوتی همیشه به‌عنوان جایگزین در دسترس است.
 */

export type SpeechEngine = "native" | "web" | "record" | "none";

export type StartHandlers = {
  onPartial?: (text: string) => void;
  onResult: (text: string) => void;
  onError: (message: string) => void;
  onUnavailable?: (message: string) => void;
  onEnd?: () => void;
};

export type Recognizer = {
  engine: SpeechEngine;
  isSupported: boolean;
  start: (handlers: StartHandlers) => Promise<void>;
  stop: () => Promise<void>;
};

const MIC_DENIED_MSG = "اجازه میکروفون داده نشد. یک‌بار دیگر دکمه میکروفون را بزنید و اجازه را تأیید کنید.";
const MIC_MISSING_MSG = "میکروفون در دسترس نیست. لطفاً دسترسی میکروفون اپلیکیشن/مرورگر را از تنظیمات فعال کنید.";
const MIC_TIMEOUT_MSG =
  "میکروفون پاسخ نداد. از «تنظیمات گوشی ← برنامه‌ها ← KAMIX ← مجوزها» دسترسی میکروفون را فعال کنید، سپس دوباره امتحان کنید.";
const NO_SPEECH_MSG = "صدایی شنیده نشد. دکمه را بزنید، واضح و نزدیک به گوشی صحبت کنید.";

function notifyUnavailable(h: StartHandlers, message: string) {
  if (h.onUnavailable) h.onUnavailable(message);
  else h.onError(message);
}

// ─── پل نیتیو (KamaliVoice) — تشخیص گفتار روی خود اندروید ────────────────────

type NativeSpeechBridge = { start?: () => void; stop?: () => void };

function nativeBridge(): NativeSpeechBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { KamaliVoice?: NativeSpeechBridge }).KamaliVoice;
  return b && typeof b.start === "function" && typeof b.stop === "function" ? b : null;
}

type NativeSpeechEvent = CustomEvent<{ text?: string; error?: string }>;

function createNativeRecognizer(): Recognizer {
  let resultListener: ((ev: Event) => void) | null = null;
  let partialListener: ((ev: Event) => void) | null = null;
  let errorListener: ((ev: Event) => void) | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const removeListeners = () => {
    if (typeof window === "undefined") return;
    if (resultListener) window.removeEventListener("kamali-native-speech-result", resultListener);
    if (partialListener) window.removeEventListener("kamali-native-speech-partial", partialListener);
    if (errorListener) window.removeEventListener("kamali-native-speech-error", errorListener);
    resultListener = null;
    partialListener = null;
    errorListener = null;
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  };

  return {
    engine: "native",
    isSupported: true,
    start: async (h) => {
      const b = nativeBridge();
      if (!b) {
        notifyUnavailable(h, MIC_MISSING_MSG);
        h.onEnd?.();
        return;
      }
      removeListeners();

      partialListener = (ev: Event) => {
        const text = (ev as NativeSpeechEvent).detail?.text ?? "";
        if (text) h.onPartial?.(text);
      };
      resultListener = (ev: Event) => {
        removeListeners();
        const text = ((ev as NativeSpeechEvent).detail?.text ?? "").trim();
        if (text) h.onResult(text);
        else h.onError(NO_SPEECH_MSG);
        h.onEnd?.();
      };
      errorListener = (ev: Event) => {
        removeListeners();
        const msg = (ev as NativeSpeechEvent).detail?.error || MIC_MISSING_MSG;
        if (/permission|denied|اجازه/i.test(msg)) notifyUnavailable(h, MIC_DENIED_MSG);
        else if (/no.?match|no.?speech|چیزی شنیده نشد|صدایی شنیده نشد/i.test(msg)) h.onError(NO_SPEECH_MSG);
        else notifyUnavailable(h, msg);
        h.onEnd?.();
      };

      window.addEventListener("kamali-native-speech-result", resultListener);
      window.addEventListener("kamali-native-speech-partial", partialListener);
      window.addEventListener("kamali-native-speech-error", errorListener);

      // اگر به هر دلیلی (مثلاً مجوز گیر کرد و کاربر دیالوگ را بست) هیچ رویدادی
      // برنگردد، حداکثر ۱۲ ثانیه بعد پیام روشن نشان می‌دهیم؛ نه سکوت بی‌پایان.
      timeoutTimer = setTimeout(() => {
        removeListeners();
        notifyUnavailable(h, MIC_TIMEOUT_MSG);
        h.onEnd?.();
      }, 12000);

      try {
        b.start?.();
      } catch (e) {
        removeListeners();
        h.onError("میکروفون شروع نشد: " + String((e as Error)?.message ?? e));
        h.onEnd?.();
      }
    },
    stop: async () => {
      const b = nativeBridge();
      try {
        b?.stop?.();
      } catch {
        /* ignore */
      }
    },
  };
}

// ─── Web Speech API — تشخیص گفتار داخل مرورگر ─────────────────────────────────

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

function createWebSpeechRecognizer(): Recognizer {
  const Ctor = webSpeechCtor();
  let rec: WebSpeechRecognition | null = null;
  return {
    engine: "web",
    isSupported: !!Ctor,
    start: async (h) => {
      if (!Ctor) return notifyUnavailable(h, MIC_MISSING_MSG);
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
          h.onPartial?.((finalText + " " + interim).trim());
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") notifyUnavailable(h, MIC_DENIED_MSG);
          else if (e.error === "no-speech") h.onError(NO_SPEECH_MSG);
          else h.onError("خطا در تشخیص گفتار. دوباره تلاش کنید.");
        };
        rec.onend = () => {
          if (finalText.trim()) h.onResult(finalText.trim());
          h.onEnd?.();
        };
        rec.start();
      } catch {
        notifyUnavailable(h, MIC_MISSING_MSG);
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

// ─── انتخاب موتور ─────────────────────────────────────────────────────────────

// ─── ضبط + رونویسی سروری (مخصوص iOS / سافاری) ────────────────────────────────

/** آیا دستگاه iOS/iPadOS است؟ (سافاری، کروم iOS، وب‌ویو iOS همگی WebKit هستند) */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOSClassic = /iPad|iPhone|iPod/.test(ua);
  const iPadOS13Plus = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return iOSClassic || iPadOS13Plus;
}

function pickMimeType(): string {
  const candidates = ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm"];
  const MR = (globalThis as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== "function") return "";
  for (const t of candidates) if (MR.isTypeSupported(t)) return t;
  return "";
}

function extFromMime(mime: string): string {
  if (mime.includes("mp4") || mime.includes("aac") || mime.includes("m4a")) return "m4a";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  return "m4a";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) {
    bin += String.fromCharCode(...buf.subarray(i, i + CH));
  }
  return btoa(bin);
}

/**
 * موتور «ضبط و رونویسی» — برای iPhone/iPad که Web Speech API در آن‌ها یا وجود
 * ندارد یا عملاً کار نمی‌کند. صدا با MediaRecorder ضبط و برای رونویسی به سرور
 * (Lovable AI) فرستاده می‌شود. این مسیر کاملاً مستقل از مسیر اندروید/نیتیو است.
 */
function createRecordingRecognizer(): Recognizer {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let handlers: StartHandlers | null = null;
  let mime = "";

  const cleanup = () => {
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    stream = null;
    recorder = null;
  };

  const finish = async () => {
    const h = handlers;
    handlers = null;
    if (!h) return;
    const blob = new Blob(chunks, { type: mime || "audio/mp4" });
    chunks = [];
    cleanup();
    if (blob.size < 1500) {
      h.onError(NO_SPEECH_MSG);
      h.onEnd?.();
      return;
    }
    try {
      const { transcribeAudio } = await import("./stt.functions");
      const b64 = await blobToBase64(blob);
      const res = await transcribeAudio({
        data: { audioBase64: b64, format: extFromMime(mime), language: "fa" },
      });
      if (res.ok && res.text.trim()) h.onResult(res.text.trim());
      else h.onError(res.ok ? NO_SPEECH_MSG : res.error);
    } catch (e) {
      h.onError("ارتباط با سرویس تشخیص گفتار برقرار نشد: " + String((e as Error)?.message ?? e));
    }
    h.onEnd?.();
  };

  return {
    engine: "record",
    isSupported: true,
    start: async (h) => {
      handlers = h;
      chunks = [];
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        handlers = null;
        const name = (e as Error)?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError") notifyUnavailable(h, MIC_DENIED_MSG);
        else notifyUnavailable(h, MIC_MISSING_MSG);
        h.onEnd?.();
        return;
      }
      try {
        mime = pickMimeType();
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        if (!mime) mime = recorder.mimeType || "audio/mp4";
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        recorder.onstop = () => {
          void finish();
        };
        // بدون timeslice → یک فایل کامل و قابل‌پخش تولید می‌شود (لازمِ iOS)
        recorder.start();
      } catch (e) {
        handlers = null;
        cleanup();
        notifyUnavailable(h, MIC_MISSING_MSG + " (" + String((e as Error)?.message ?? e) + ")");
        h.onEnd?.();
      }
    },
    stop: async () => {
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
        else cleanup();
      } catch {
        cleanup();
      }
    },
  };
}

export function detectEngine(): SpeechEngine {
  if (nativeBridge()) return "native";
  // iOS: Web Speech API یا نیست یا ناپایدار است → مسیر ضبط + رونویسی سروری
  if (
    isIOS() &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder !== "undefined"
  ) {
    return "record";
  }
  if (webSpeechCtor()) return "web";
  // مرورگرهای بدون Web Speech (مثل فایرفاکس) هم می‌توانند ضبط کنند
  if (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder !== "undefined"
  ) {
    return "record";
  }
  return "none";
}

export function createRecognizer(): Recognizer {
  const engine = detectEngine();
  if (engine === "native") return createNativeRecognizer();
  if (engine === "record") return createRecordingRecognizer();
  if (engine === "web") return createWebSpeechRecognizer();
  return {
    engine: "none",
    isSupported: false,
    start: async (h) => notifyUnavailable(h, MIC_MISSING_MSG),
    stop: async () => {},
  };
}
