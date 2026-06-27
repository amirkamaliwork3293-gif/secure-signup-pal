import { transcribeAudio } from "@/lib/voice/stt.functions";

export type SpeechEngine = "native" | "web" | "none";

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

type NativeVoiceBridge = {
  start?: () => void;
  stop?: () => void;
};

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

const MIC_DENIED_MSG = "اجازه میکروفون داده نشد. یک‌بار دیگر دکمه میکروفون را بزنید و اجازه را تأیید کنید.";
const MIC_MISSING_MSG = "میکروفون باز نشد. لطفاً دسترسی میکروفون اپلیکیشن را از تنظیمات گوشی فعال کنید.";
const EMPTY_AUDIO_MSG = "صدایی ضبط نشد. دکمه را بزنید، واضح صحبت کنید و بعد دوباره بزنید.";

function notifyUnavailable(h: StartHandlers, message: string) {
  if (h.onUnavailable) h.onUnavailable(message);
  else h.onError(message);
}

function bridge(): NativeVoiceBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { KamaliVoice?: NativeVoiceBridge }).KamaliVoice;
  return b && typeof b.start === "function" && typeof b.stop === "function" ? b : null;
}

function hasGetUserMedia(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

function webSpeechCtor(): (new () => WebSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => WebSpeechRecognition;
    webkitSpeechRecognition?: new () => WebSpeechRecognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function looksLikeAndroidWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent) && /; wv\)|Version\/\d+\.\d+/i.test(navigator.userAgent);
}

export function detectEngine(): SpeechEngine {
  // در APK جدید، پل KamaliVoice مستقیماً میکروفون اندروید را باز می‌کند.
  if (bridge() || looksLikeAndroidWebView()) return "native";
  // مسیر اصلی بازسازی‌شده: ضبط کامل WAV با Web Audio و ارسال به STT.
  if (hasGetUserMedia() && typeof window !== "undefined" && "AudioContext" in window) return "native";
  if (webSpeechCtor()) return "web";
  return "none";
}

export function createRecognizer(): Recognizer {
  const engine = detectEngine();
  if (engine === "native") return createFullAudioRecognizer();
  if (engine === "web") return createWebSpeechRecognizer();
  return {
    engine: "none",
    isSupported: false,
    start: async (h) => notifyUnavailable(h, MIC_MISSING_MSG),
    stop: async () => {},
  };
}

type NativeAudioEvent = CustomEvent<{ audioBase64?: string; format?: string; error?: string }>;

function createFullAudioRecognizer(): Recognizer {
  let nativeHandlers: StartHandlers | null = null;
  let nativeResultListener: ((ev: Event) => void) | null = null;
  let nativeErrorListener: ((ev: Event) => void) | null = null;
  let webRecorder: WebRecorder | null = null;
  let processing = false;

  const removeNativeListeners = () => {
    if (typeof window === "undefined") return;
    if (nativeResultListener) window.removeEventListener("kamali-native-audio", nativeResultListener);
    if (nativeErrorListener) window.removeEventListener("kamali-native-audio-error", nativeErrorListener);
    nativeResultListener = null;
    nativeErrorListener = null;
  };

  const startNativeBridge = (h: StartHandlers, b: NativeVoiceBridge): boolean => {
    if (typeof window === "undefined") return false;
    nativeHandlers = h;
    processing = false;
    removeNativeListeners();

    nativeResultListener = (ev: Event) => {
      const detail = (ev as NativeAudioEvent).detail ?? {};
      const audioBase64 = detail.audioBase64 ?? "";
      const format = detail.format || "m4a";
      if (!audioBase64 || processing) return;
      processing = true;
      h.onPartial?.("در حال تبدیل صدا به متن…");
      void transcribeAudio({ data: { audioBase64, format, language: "fa" } })
        .then((result) => {
          if (result.ok) h.onResult(result.text);
          else h.onError(result.error);
        })
        .catch((e) => h.onError("ارسال صدا ناموفق بود: " + String((e as Error)?.message ?? e)))
        .finally(() => {
          processing = false;
          removeNativeListeners();
          h.onEnd?.();
        });
    };

    nativeErrorListener = (ev: Event) => {
      const detail = (ev as NativeAudioEvent).detail ?? {};
      removeNativeListeners();
      processing = false;
      const msg = detail.error || MIC_MISSING_MSG;
      if (/permission|denied|اجازه/i.test(msg)) notifyUnavailable(h, MIC_DENIED_MSG);
      else h.onError(msg);
      h.onEnd?.();
    };

    window.addEventListener("kamali-native-audio", nativeResultListener);
    window.addEventListener("kamali-native-audio-error", nativeErrorListener);

    try {
      // بدون هیچ await: درخواست میکروفون نیتیو در همان زنجیره کلیک کاربر شروع می‌شود.
      b.start?.();
      return true;
    } catch (e) {
      removeNativeListeners();
      h.onError("میکروفون اپلیکیشن شروع نشد: " + String((e as Error)?.message ?? e));
      h.onEnd?.();
      return true;
    }
  };

  return {
    engine: "native",
    isSupported: true,
    start: async (h) => {
      const b = bridge();
      if (b && startNativeBridge(h, b)) return;

      if (!hasGetUserMedia()) {
        notifyUnavailable(h, MIC_MISSING_MSG);
        h.onEnd?.();
        return;
      }

      try {
        webRecorder = pickWebRecorder(h);
        // اولین await واقعی همین getUserMedia است تا WebView زنجیره کلیک را از دست ندهد.
        await webRecorder.start();
      } catch (e) {
        const msg = String((e as { name?: string; message?: string })?.name ?? (e as Error)?.message ?? e);
        if (/NotAllowed|Security|permission|denied/i.test(msg)) notifyUnavailable(h, MIC_DENIED_MSG);
        else if (/NotFound|DevicesNotFound/i.test(msg)) notifyUnavailable(h, "میکروفونی روی این دستگاه پیدا نشد.");
        else notifyUnavailable(h, MIC_MISSING_MSG);
        h.onEnd?.();
      }
    },
    stop: async () => {
      const b = bridge();
      if (b && nativeHandlers) {
        try {
          b.stop?.();
          return;
        } catch {
          nativeHandlers.onEnd?.();
        }
      }
      await webRecorder?.stop();
    },
  };
}

class WebAudioRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 44100;
  private stopped = false;

  constructor(private handlers: StartHandlers) {}

  async start() {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) throw new Error("AudioContext unavailable");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioCtx();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.sampleRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (ev) => {
      if (this.stopped) return;
      const input = ev.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    const chunks = this.chunks.slice();
    this.cleanup();
    if (chunks.reduce((sum, c) => sum + c.length, 0) < this.sampleRate * 0.25) {
      this.handlers.onError(EMPTY_AUDIO_MSG);
      this.handlers.onEnd?.();
      return;
    }
    try {
      this.handlers.onPartial?.("در حال تبدیل صدا به متن…");
      const wav = encodeWav(chunks, this.sampleRate, 16000);
      if (wav.size < 2048) throw new Error("empty");
      const base64 = await blobToBase64(wav);
      const result = await transcribeAudio({ data: { audioBase64: base64, format: "wav", language: "fa" } });
      if (result.ok) this.handlers.onResult(result.text);
      else this.handlers.onError(result.error);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      this.handlers.onError(msg === "empty" ? EMPTY_AUDIO_MSG : "ارسال صدا ناموفق بود: " + msg);
    } finally {
      this.handlers.onEnd?.();
    }
  }

  private cleanup() {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const s = String(fr.result || "");
      const i = s.indexOf("base64,");
      resolve(i >= 0 ? s.slice(i + 7) : s);
    };
    fr.readAsDataURL(blob);
  });
}

function encodeWav(chunks: Float32Array[], inputRate: number, outputRate: number): Blob {
  const inputLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const input = new Float32Array(inputLength);
  let offset = 0;
  for (const c of chunks) {
    input.set(c, offset);
    offset += c.length;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const pcm = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)] || 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputRate, true);
  view.setUint32(28, outputRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let pos = 44;
  for (let i = 0; i < pcm.length; i++, pos += 2) view.setInt16(pos, pcm[i], true);
  return new Blob([view], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
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
          else if (e.error === "no-speech") h.onError("صدایی شنیده نشد. دوباره تلاش کنید.");
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