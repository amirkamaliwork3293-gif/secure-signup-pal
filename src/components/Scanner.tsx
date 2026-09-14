/**
 * Scanner.tsx — اسکن بارکد/QR موبایل (v7)
 *
 * علت لگ و نخواندن در نسخهٔ قبل:
 *   1. onDetected هر اسکن والد را رندر می‌کرد → useEffect دوربین را قطع و از نو می‌ساخت
 *   2. کادر عریض روی کانواس ۴:۳ کش می‌آمد و میله‌های EAN/Code128 خراب می‌شد
 *   3. getImageData + استخراج روشنایی روی ترد اصلی هر فریم
 *   4. Native و ZXing همزمان + TRY_HARDER/ITF که Worker را قفل و watchdog را آتش می‌کرد
 *
 * پروفایل v5 (فرضیهٔ ۱ تأیید شد):
 *   وقتی Native روی کراپ چیزی پیدا نمی‌کرد، همان فریم detect(video) روی کل
 *   ۱۲۸۰×۷۲۰ هم اجرا می‌شد. اکثر فریم‌ها خالی‌اند → دو تشخیص بومی سریال در
 *   ترد اصلی، که حلقهٔ RVFC را بند می‌آورد. حالا کل‌فریم فقط هر ۶ تیک یک‌بار
 *   است (همان الگوی extra در ZXing)، مگر این‌که ImageBitmap اصلاً پشتیبانی نشود.
 *
 * بارکد کوچک (گزارش کاربر بعد از v5):
 *   downsample کل کادر به ۷۲۰px میله‌های EAN کوچک را نابود می‌کرد. فریم‌های فرد
 *   کادر مرکز ۰.۶۲ را بدون کوچک‌کردن اضافه می‌گیرند (زوم دیجیتال)، فریم‌های زوج
 *   کادر کامل را برای بارکد عریض. دوربین mid/high ideal ۱۹۲۰×۱۰۸۰.
 *
 * سازگاری اندروید / WebView (گزارش «روی گوشی من کار می‌کند روی گوشی برادر نه»):
 *   BarcodeDetector در WebView غالباً نیست؛ Worker ماژول و OffscreenCanvas و
 *   createImageBitmap(video) روی WebView قدیمی throw می‌شوند و قبلاً کل فریم
 *   بدون دیکود رد می‌شد. مسیر canvas + بافر RGBA + دیکود اصلی به‌عنوان پشتیبان
 *   است؛ روی کروم جدید همان Worker+ImageBitmap می‌ماند. اگر BarcodeDetector روی
 *   گوشی جدید آویزان شود (قبلاً کار می‌کرد، الان هیچی)، بعد از دو تایم‌اوت خاموش
 *   می‌شود تا ZXing ادامه دهد.
 *
 * رگرسیون v7 («اسکن روی همهٔ گوشی‌ها کاملاً خراب شد»):
 *   1. URL Worker به متغیر جدا شد → Vite آن را باندل نکرد و سورس خام .ts به‌صورت
 *      data: URL داخل باندل رفت؛ Worker با SyntaxError می‌مرد و بی‌نهایت ساخته می‌شد.
 *   2. تایم‌اوت ۳۲۰ms Native، اولین detect (لود مدل ML Kit، چند ثانیه) را می‌کشت و
 *      بعد از دو بار Native خاموش می‌شد. با (۱) هیچ موتوری نمی‌ماند.
 *   حالا: الگوی Worker همان یک عبارتی که Vite می‌شناسد، بودجهٔ گرم‌شدن ۴s برای سه
 *   detect اول، نتیجهٔ دیررسِ detect دور ریخته نمی‌شود، و Worker مرده بعد از سه
 *   شکست به دیکود ترد اصلی می‌سپارد.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Flashlight, FlashlightOff, RefreshCw } from "lucide-react";
import { decodeBudget, detectDeviceTier } from "@/lib/device-tier";
import { cropSourceRect, fitDecodeSize, insetScanCrop } from "@/lib/scanner-engine";
import {
  attachVideoStream,
  bitmapToRgba,
  canUseOffscreenCanvas,
  grabFrameViaCanvas,
  NATIVE_HANG_LIMIT,
  nativeDetectBudgetMs,
  nextNativeHangState,
  openCameraStream,
  raceTimeout,
} from "@/lib/scanner-capture";
import { normalizeScannedCode, scannedCodesMatch } from "@/lib/barcode-match";

type Props = {
  onDetected: (code: string, format?: string) => void;
  paused?: boolean;
};

type NativeBarcode = { rawValue: string; format: string };
type NativeDetector = { detect: (src: ImageBitmap | HTMLVideoElement) => Promise<NativeBarcode[]> };

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeDetector;
  }
}

const NATIVE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "qr_code",
  "code_39",
  "itf",
  "data_matrix",
  "pdf417",
  "aztec",
  "codabar",
];

const CORE_NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code", "code_39"];

function createNativeDetector(): NativeDetector | null {
  const BD =
    window.BarcodeDetector ||
    (globalThis as unknown as { BarcodeDetector?: typeof window.BarcodeDetector }).BarcodeDetector;
  if (!BD) return null;
  const attempts: Array<{ formats?: string[] } | undefined> = [
    { formats: NATIVE_FORMATS },
    { formats: CORE_NATIVE_FORMATS },
    undefined,
  ];
  for (const opts of attempts) {
    try {
      return opts ? new BD(opts) : new BD();
    } catch {
      /* some engines throw if any listed format is unsupported */
    }
  }
  return null;
}

/**
 * `new Worker(new URL(..., import.meta.url))` باید دقیقاً همین شکل و در یک عبارت باشد.
 * Vite فقط این الگو را به‌عنوان Worker باندل می‌کند؛ اگر URL در متغیر جدا شود،
 * فایل .ts خام به‌صورت data: URL داخل باندل می‌رود و Worker با SyntaxError می‌میرد
 * (رگرسیون v7: ZXing در پروداکشن هیچ‌وقت دیکود نمی‌کرد).
 */
function spawnZxingWorker(): Worker | null {
  try {
    return new Worker(new URL("../lib/zxing.worker.ts", import.meta.url), { type: "module" });
  } catch {
    try {
      return new Worker(new URL("../lib/zxing.worker.ts", import.meta.url));
    } catch {
      return null;
    }
  }
}

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

const DEVICE_TIER = detectDeviceTier();
const BUDGET = decodeBudget(DEVICE_TIER);
const BASE_W = 0.78;
const BASE_H = 0.46;
/** پشت این فلگ تایمر مرحله‌ای روشن می‌شود؛ در پروداکشن باید false بماند. */
const DEBUG_PERF = false;
/** کل‌فریم Native فقط هر N فریمِ بدون‌hit روی کراپ — تعادل سرعت و بارکد لبِ کادر. */
const NATIVE_FULL_FRAME_EVERY = 6;
/** زوم دیجیتال مرکز کادر — بارکد کوچک را قبل از downsample می‌خواند. */
const ZOOM_CROP_SCALE = 0.62;
/** extra ZXing (invert / CODE-39) هر N فریم Worker. */
const ZXING_EXTRA_EVERY = 5;
/** Worker که پشت‌سرهم می‌میرد (باندل خراب / WebView قدیمی) → دیکود روی ترد اصلی. */
const WORKER_FAIL_LIMIT = 3;

export function Scanner({ onDetected, paused }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const nativeRef = useRef<NativeDetector | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerBusy = useRef(false);
  const workerWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extraTick = useRef(0);
  const nativeBitmapOk = useRef(true);
  const nativeInFlight = useRef(false);
  const nativeFullTick = useRef(0);
  const roiTick = useRef(0);
  const bitmapTransferOk = useRef(true);
  const offscreenOk = useRef(true);
  const preferCanvasGrab = useRef(false);
  const mainDecodeBusy = useRef(false);
  const nativeHangCount = useRef(0);
  const nativeCalls = useRef(0);
  const workerFailures = useRef(0);
  const perfAcc = useRef({ n: 0, grab: 0, native: 0, nativeFull: 0 });
  const pinchStartRef = useRef<number | null>(null);
  const pinchZoomStartRef = useRef(1);
  const zoomMinRef = useRef(1);
  const zoomMaxRef = useRef(10);
  const fpsCountRef = useRef(0);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [flash, setFlash] = useState(false);
  const [engine, setEngine] = useState<string>("...");
  const [fps, setFps] = useState(0);
  const [boxScale, setBoxScale] = useState(1);

  onDetectedRef.current = onDetected;
  pausedRef.current = !!paused;

  const crop = useMemo(() => {
    const w = Math.min(0.96, Math.max(0.22, BASE_W * boxScale));
    const h = Math.min(0.86, Math.max(0.16, BASE_H * boxScale));
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }, [boxScale]);
  const cropRef = useRef(crop);
  cropRef.current = crop;

  const beep = useCallback(() => {
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 1180;
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.14);
    } catch {
      /* silent */
    }
  }, []);

  const emit = useCallback(
    (code: string, fmt?: string) => {
      if (pausedRef.current) return;
      const t = normalizeScannedCode(code);
      if (!t) return;
      const now = Date.now();
      const last = lastCodeRef.current;
      if (last && scannedCodesMatch(last.code, t) && now - last.at < 800) return;
      lastCodeRef.current = { code: t, at: now };
      setFlash(true);
      setTimeout(() => setFlash(false), 220);
      navigator.vibrate?.(35);
      beep();
      onDetectedRef.current(t, fmt);
    },
    [beep],
  );
  const emitRef = useRef(emit);
  emitRef.current = emit;

  useEffect(() => {
    let cancelled = false;
    let frameWait: number | null = null;
    let resolveFrame: (() => void) | null = null;
    const videoEl = videoRef.current;

    fpsTimerRef.current = setInterval(() => {
      setFps(fpsCountRef.current);
      fpsCountRef.current = 0;
    }, 1000);

    const clearWatchdog = () => {
      if (workerWatchdog.current) {
        clearTimeout(workerWatchdog.current);
        workerWatchdog.current = null;
      }
    };

    const engineLabel = () => {
      const parts: string[] = [];
      if (nativeRef.current) parts.push("Native");
      parts.push(workerRef.current ? "ZXing Worker" : "ZXing");
      return parts.join(" + ");
    };

    /** Worker مرده را دور بینداز؛ بعد از چند شکست پیاپی دیگر نساز و روی ترد اصلی دیکود کن. */
    const recycleWorker = (reason: string) => {
      clearWatchdog();
      workerBusy.current = false;
      try {
        workerRef.current?.terminate();
      } catch {
        /* ignore */
      }
      workerRef.current = null;
      if (cancelled) return;
      workerFailures.current += 1;
      if (workerFailures.current >= WORKER_FAIL_LIMIT) {
        console.warn(`[scanner] ZXing worker gave up (${reason}) — decoding on main thread`);
        setEngine(engineLabel());
        return;
      }
      console.warn(`[scanner] ZXing worker ${reason} — recycling`);
      attachWorker(spawnZxingWorker());
    };

    const attachWorker = (w: Worker | null) => {
      if (!w) {
        workerRef.current = null;
        return;
      }
      w.onmessage = (e: MessageEvent<{ id: number; text: string | null }>) => {
        clearWatchdog();
        workerBusy.current = false;
        workerFailures.current = 0;
        if (e.data.text) emitRef.current(e.data.text, "ZXing");
      };
      w.onerror = (ev) => {
        if (workerRef.current !== w) return;
        recycleWorker(`error: ${ev.message || "load failed"}`);
      };
      workerRef.current = w;
    };

    const armWatchdog = () => {
      clearWatchdog();
      // ۱۰۰۰ms: فریم خالی extra روی CPU سرور ~۶۰ms بود؛ ضریب ~۸ برای میان‌رده
      // با بودجهٔ high (۹۶۰×۴۰۰) هنوز زیر یک ثانیه می‌ماند. ۲۰۰۰ms قبلی بعد از
      // هنگ، اسکنر را دو ثانیه یخ می‌زد. دیکود عادی ۱۱–۶۰ms است و این سقف را نمی‌زند.
      workerWatchdog.current = setTimeout(() => {
        workerWatchdog.current = null;
        recycleWorker("decode timed out");
      }, 1000);
    };

    const waitFrame = (video: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        resolveFrame = resolve;
        const finish = () => {
          frameWait = null;
          resolveFrame = null;
          resolve();
        };
        if (cancelled) {
          finish();
          return;
        }
        const v = video as RVFCVideo;
        if (typeof v.requestVideoFrameCallback === "function") {
          frameWait = v.requestVideoFrameCallback(finish);
        } else {
          frameWait = requestAnimationFrame(finish);
        }
      });

    const grabBitmap = async (
      video: HTMLVideoElement,
      crop: { x: number; y: number; w: number; h: number },
    ): Promise<ImageBitmap | null> => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const src = cropSourceRect(vw, vh, crop);
      const fit = fitDecodeSize(src.sw, src.sh, BUDGET.maxW, BUDGET.maxH);
      const needResize = fit.dw !== src.sw || fit.dh !== src.sh;
      try {
        if (!needResize) {
          // resample روی بارکد کوچک میله‌ها را خراب می‌کند — اگر جا می‌شود همان پیکسل خام.
          return await createImageBitmap(video, src.sx, src.sy, src.sw, src.sh);
        }
        return await createImageBitmap(video, src.sx, src.sy, src.sw, src.sh, {
          resizeWidth: fit.dw,
          resizeHeight: fit.dh,
          resizeQuality: DEVICE_TIER === "low" ? "medium" : "high",
        });
      } catch {
        try {
          return await createImageBitmap(video, src.sx, src.sy, src.sw, src.sh);
        } catch {
          return null;
        }
      }
    };

    const disableNative = () => {
      nativeRef.current = null;
      nativeHangCount.current = 0;
      setEngine(engineLabel());
    };

    const detectNative = async (
      src: ImageBitmap | HTMLVideoElement,
    ): Promise<{ codes: NativeBarcode[]; timedOut: boolean }> => {
      const det = nativeRef.current;
      if (!det) return { codes: [], timedOut: false };
      const budget = nativeDetectBudgetMs(nativeCalls.current);
      nativeCalls.current += 1;
      const raw = det.detect(src);
      const { value, timedOut } = await raceTimeout(raw, budget, [] as NativeBarcode[]);
      if (timedOut) {
        // اگر دیرتر جواب داد، نتیجه را دور نریز — کاربر هنوز بارکد را جلوی دوربین دارد.
        raw.then(
          (codes) => {
            if (!cancelled && codes.length) emitRef.current(codes[0].rawValue, codes[0].format);
          },
          () => {},
        );
      }
      const hang = nextNativeHangState(timedOut, nativeHangCount.current, NATIVE_HANG_LIMIT);
      nativeHangCount.current = hang.hangCount;
      if (hang.disable) disableNative();
      return { codes: value, timedOut };
    };

    const scanFrame = async (video: HTMLVideoElement) => {
      if (pausedRef.current || video.readyState < 2) return;
      fpsCountRef.current++;
      const tFrame = DEBUG_PERF ? performance.now() : 0;

      roiTick.current += 1;
      const viewCrop =
        roiTick.current % 2 === 1
          ? insetScanCrop(cropRef.current, ZOOM_CROP_SCALE)
          : cropRef.current;

      let bitmap: ImageBitmap | null = null;
      if (!preferCanvasGrab.current) {
        bitmap = await grabBitmap(video, viewCrop);
        if (!bitmap) preferCanvasGrab.current = true;
      }
      if (DEBUG_PERF) perfAcc.current.grab += performance.now() - tFrame;

      if (nativeRef.current && !nativeInFlight.current) {
        nativeInFlight.current = true;
        try {
          let codes: NativeBarcode[] = [];
          let nativeTimedOut = false;
          const tNative = DEBUG_PERF ? performance.now() : 0;
          if (bitmap && nativeBitmapOk.current) {
            try {
              const r = await detectNative(bitmap);
              codes = r.codes;
              if (r.timedOut) {
                // detect هنوز ممکن است این bitmap را بخواند؛ برای ZXing فریم تازه بگیر.
                nativeTimedOut = true;
                bitmap = await grabBitmap(video, viewCrop);
              }
            } catch {
              // throw یعنی ImageBitmap به‌عنوان ورودی پشتیبانی نمی‌شود، نه کندی.
              nativeBitmapOk.current = false;
            }
          }
          if (DEBUG_PERF) perfAcc.current.native += performance.now() - tNative;
          if (
            !nativeTimedOut &&
            !codes.length &&
            nativeRef.current &&
            (!bitmap ||
              !nativeBitmapOk.current ||
              ++nativeFullTick.current % NATIVE_FULL_FRAME_EVERY === 0)
          ) {
            const tFull = DEBUG_PERF ? performance.now() : 0;
            try {
              const r = await detectNative(video);
              codes = r.codes;
            } catch {
              /* ZXing fallback */
            }
            if (DEBUG_PERF) perfAcc.current.nativeFull += performance.now() - tFull;
          }
          if (cancelled) {
            bitmap?.close();
            return;
          }
          if (codes.length) {
            emitRef.current(codes[0].rawValue, codes[0].format);
            bitmap?.close();
            return;
          }
        } catch {
          /* fall through to ZXing */
        } finally {
          nativeInFlight.current = false;
        }
      }

      if (DEBUG_PERF) {
        const p = perfAcc.current;
        p.n += 1;
        if (p.n >= 30) {
          console.debug(
            `[scanner-perf] n=${p.n} grab=${(p.grab / p.n).toFixed(1)}ms nativeCrop=${(p.native / p.n).toFixed(1)}ms nativeFull=${(p.nativeFull / p.n).toFixed(1)}ms`,
          );
          p.n = 0;
          p.grab = 0;
          p.native = 0;
          p.nativeFull = 0;
        }
      }

      const worker = workerRef.current;
      if (worker && workerBusy.current) {
        bitmap?.close();
        return;
      }

      extraTick.current += 1;
      const extra = extraTick.current % ZXING_EXTRA_EVERY === 0;

      const postWorker = (payload: object, transfer: Transferable[]): boolean => {
        if (!worker || workerBusy.current) return false;
        workerBusy.current = true;
        armWatchdog();
        try {
          worker.postMessage(payload, transfer);
          return true;
        } catch {
          clearWatchdog();
          workerBusy.current = false;
          return false;
        }
      };

      if (bitmap && worker && bitmapTransferOk.current && offscreenOk.current) {
        if (postWorker({ id: extraTick.current, bitmap, extra }, [bitmap])) return;
        bitmapTransferOk.current = false;
      }

      let rgba: { data: Uint8ClampedArray; width: number; height: number } | null = null;
      if (bitmap) {
        const conv = bitmapToRgba(bitmap);
        try {
          bitmap.close();
        } catch {
          /* ignore */
        }
        bitmap = null;
        if (conv?.data) rgba = { data: conv.data, width: conv.width, height: conv.height };
      }
      if (!rgba) {
        const grabbed = grabFrameViaCanvas(video, viewCrop, BUDGET.maxW, BUDGET.maxH);
        if (grabbed?.data)
          rgba = { data: grabbed.data, width: grabbed.width, height: grabbed.height };
      }
      if (!rgba) return;

      const bytes = rgba.data;
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      if (
        postWorker(
          { id: extraTick.current, buffer: buf, width: rgba.width, height: rgba.height, extra },
          [buf],
        )
      ) {
        return;
      }

      if (mainDecodeBusy.current) return;
      mainDecodeBusy.current = true;
      try {
        const { decodeRgba } = await import("@/lib/zxing-decode");
        if (cancelled || pausedRef.current) return;
        const text = decodeRgba(rgba.data, rgba.width, rgba.height, extra);
        if (text) emitRef.current(text, "ZXing");
      } catch {
        /* keep preview */
      } finally {
        mainDecodeBusy.current = false;
      }
    };

    const startCamera = async () => {
      const isLow = DEVICE_TIER === "low";
      offscreenOk.current = canUseOffscreenCanvas();

      const stream = await openCameraStream(isLow);
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await attachVideoStream(video, stream);
      if (cancelled) return;

      const track = stream.getVideoTracks()[0];
      try {
        (track as MediaStreamTrack & { contentHint?: string }).contentHint = "detail";
      } catch {
        /* ignore */
      }
      try {
        if (typeof track.getCapabilities === "function") {
          const caps = track.getCapabilities() as Record<string, unknown>;
          setTorchSupported(!!caps.torch);
          const zc = caps.zoom as { min?: number; max?: number } | undefined;
          if (zc) {
            zoomMinRef.current = zc.min ?? 1;
            zoomMaxRef.current = zc.max ?? 10;
          }
          setZoomSupported(!!caps.zoom);

          const adv: Record<string, unknown>[] = [];
          if (
            Array.isArray(caps.focusMode) &&
            (caps.focusMode as string[]).includes("continuous")
          ) {
            adv.push({ focusMode: "continuous" });
          }
          if (
            Array.isArray(caps.exposureMode) &&
            (caps.exposureMode as string[]).includes("continuous")
          ) {
            adv.push({ exposureMode: "continuous" });
          }
          if (
            Array.isArray(caps.whiteBalanceMode) &&
            (caps.whiteBalanceMode as string[]).includes("continuous")
          ) {
            adv.push({ whiteBalanceMode: "continuous" });
          }
          if (adv.length) {
            await track
              .applyConstraints({ advanced: adv } as MediaTrackConstraints)
              .catch(() => {});
          }
          const wcap = caps.width as { max?: number } | undefined;
          if (!isLow && (wcap?.max ?? 0) >= 1600) {
            await track
              .applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 } })
              .catch(() => {});
          }
        }
      } catch {
        setTorchSupported(false);
        setZoomSupported(false);
      }

      attachWorker(spawnZxingWorker());
      nativeRef.current = createNativeDetector();
      setEngine(engineLabel());

      // یک فریم در هر لحظه: waitFrame با requestVideoFrameCallback به فریم
      // واقعی دوربین قفل می‌شود (نه setInterval / rAF آزاد) و await scanFrame
      // جلوی پردازش هم‌زمان چند فریم را می‌گیرد — حتی اگر Native یا Worker طول بکشد.
      while (!cancelled) {
        await waitFrame(video);
        if (cancelled) break;
        try {
          await scanFrame(video);
        } catch {
          /* keep preview alive */
        }
      }
    };

    startCamera().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "خطای دوربین");
    });

    return () => {
      cancelled = true;
      const video = videoEl as RVFCVideo | null;
      if (frameWait != null) {
        if (video && typeof video.cancelVideoFrameCallback === "function") {
          try {
            video.cancelVideoFrameCallback(frameWait);
          } catch {
            /* ignore */
          }
        } else {
          cancelAnimationFrame(frameWait);
        }
      }
      try {
        resolveFrame?.();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      clearWatchdog();
      try {
        workerRef.current?.terminate();
      } catch {
        /* ignore */
      }
      workerRef.current = null;
      workerBusy.current = false;
      nativeInFlight.current = false;
      mainDecodeBusy.current = false;
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
      const audio = audioCtxRef.current;
      audioCtxRef.current = null;
      if (audio) {
        audio.close().catch(() => {});
      }
    };
  }, []);

  const track = () => streamRef.current?.getVideoTracks()[0] ?? null;

  const applyAdvanced = (t: MediaStreamTrack, advanced: Record<string, unknown>) =>
    t.applyConstraints({ advanced: [advanced] } as MediaTrackConstraints);

  const toggleTorch = async () => {
    const t = track();
    if (!t) return;
    try {
      await applyAdvanced(t, { torch: !torchOn });
      setTorchOn((v) => !v);
    } catch {
      setTorchSupported(false);
    }
  };

  const applyZoom = async (nz: number) => {
    const t = track();
    if (!t) return;
    const clamped = Math.min(zoomMaxRef.current, Math.max(zoomMinRef.current, nz));
    try {
      await applyAdvanced(t, { zoom: clamped });
      setZoom(clamped);
    } catch {
      /* ignore */
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartRef.current = Math.sqrt(dx * dx + dy * dy);
      pinchZoomStartRef.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartRef.current !== null && zoomSupported) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = dist / pinchStartRef.current;
      const range = zoomMaxRef.current - zoomMinRef.current;
      applyZoom(pinchZoomStartRef.current + (ratio - 1) * range * 0.4);
    }
  };

  const handleTouchEnd = () => {
    pinchStartRef.current = null;
  };

  const refocus = async () => {
    const t = track();
    if (!t) return;
    try {
      await applyAdvanced(t, { focusMode: "single-shot" });
      await new Promise((r) => setTimeout(r, 80));
      await applyAdvanced(t, { focusMode: "continuous" });
    } catch {
      /* ignore */
    }
  };

  const tapFocus = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    const t = track();
    if (!t) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    try {
      await applyAdvanced(t, {
        pointsOfInterest: [{ x: px, y: py }],
        focusMode: "single-shot",
        exposureMode: "single-shot",
      });
      setTimeout(() => {
        applyAdvanced(t, { focusMode: "continuous", exposureMode: "continuous" }).catch(() => {});
      }, 260);
    } catch {
      /* ignore */
    }
  };

  const stopFocus = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-card">
      <div
        className="relative aspect-[4/3] w-full"
        onPointerDown={tapFocus}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />

        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute"
            style={{
              left: `${crop.x * 100}%`,
              right: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              bottom: `${crop.y * 100}%`,
            }}
          >
            <div
              className="absolute inset-0 bg-transparent"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
            />
            {[
              "top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg",
              "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg",
              "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg",
              "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg",
            ].map((cls, i) => (
              <span key={i} className={`absolute h-8 w-8 border-primary ${cls}`} />
            ))}
            <div
              className="absolute inset-x-2 top-1/2 h-[2px] -translate-y-1/2 bg-primary/80 animate-pulse"
              style={{ boxShadow: "0 0 10px 3px rgba(99,102,241,0.6)" }}
            />
            <div className="absolute -bottom-6 inset-x-0 text-center text-[11px] text-white/70">
              بارکد یا QR را داخل کادر قرار دهید
            </div>
          </div>
        </div>

        {flash && <div className="pointer-events-none absolute inset-0 bg-green-400/40" />}

        <div
          className="pointer-events-auto absolute top-2 left-2 right-2 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5"
          onPointerDown={stopFocus}
        >
          <span className="text-[10px] text-white/70 shrink-0">اندازه کادر</span>
          <input
            type="range"
            min={0.4}
            max={1.4}
            step={0.05}
            value={boxScale}
            onChange={(e) => setBoxScale(parseFloat(e.target.value))}
            className="zoom-slider flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, rgba(139,92,246,0.9) 0%, rgba(139,92,246,0.9) ${((boxScale - 0.4) / 1.0) * 100}%, rgba(255,255,255,0.25) ${((boxScale - 0.4) / 1.0) * 100}%, rgba(255,255,255,0.25) 100%)`,
            }}
          />
          <span className="text-[10px] text-white/70 w-8 text-center">
            {Math.round(boxScale * 100)}%
          </span>
        </div>

        {zoomSupported && (
          <div
            className="absolute bottom-16 left-4 right-4 flex flex-col items-center gap-1"
            onPointerDown={stopFocus}
          >
            <div className="flex w-full items-center gap-2">
              <span className="text-[10px] text-white/60 w-6 text-center">
                {zoomMinRef.current.toFixed(0)}×
              </span>
              <input
                type="range"
                min={zoomMinRef.current}
                max={zoomMaxRef.current}
                step={0.1}
                value={zoom}
                onChange={(e) => applyZoom(parseFloat(e.target.value))}
                className="zoom-slider flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, rgba(139,92,246,0.9) 0%, rgba(139,92,246,0.9) ${((zoom - zoomMinRef.current) / (zoomMaxRef.current - zoomMinRef.current)) * 100}%, rgba(255,255,255,0.25) ${((zoom - zoomMinRef.current) / (zoomMaxRef.current - zoomMinRef.current)) * 100}%, rgba(255,255,255,0.25) 100%)`,
                }}
              />
              <span className="text-[10px] text-white/60 w-6 text-center">
                {zoomMaxRef.current.toFixed(0)}×
              </span>
            </div>
            <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white/80">
              {zoom.toFixed(1)}×
            </span>
          </div>
        )}

        <div
          className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2"
          onPointerDown={stopFocus}
        >
          <div className="flex flex-col gap-0.5">
            <div className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] text-white/80">
              {engine}
            </div>
            <div className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] text-white/50">
              {fps} fps
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={refocus}
              aria-label="فوکوس"
              className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white active:bg-black/80"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                aria-label="چراغ"
                className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white active:bg-black/80"
              >
                {torchOn ? (
                  <FlashlightOff className="h-4 w-4" />
                ) : (
                  <Flashlight className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="font-semibold">دسترسی به دوربین ممکن نشد</div>
          <div className="mt-1 text-xs opacity-75">{error}</div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>
              • صفحه باید روی <strong>HTTPS</strong> باز شود
            </li>
            <li>• اجازه دوربین را در مرورگر فعال کنید</li>
            <li>• از حالت ناشناس خارج شوید و ریفرش کنید</li>
          </ul>
        </div>
      )}
    </div>
  );
}
