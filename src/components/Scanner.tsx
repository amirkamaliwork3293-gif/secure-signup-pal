/**
 * Scanner.tsx — اسکن بارکد/QR موبایل (v4)
 *
 * علت لگ و نخواندن در نسخهٔ قبل:
 *   1. onDetected هر اسکن والد را رندر می‌کرد → useEffect دوربین را قطع و از نو می‌ساخت
 *   2. کادر عریض روی کانواس ۴:۳ کش می‌آمد و میله‌های EAN/Code128 خراب می‌شد
 *   3. getImageData + استخراج روشنایی روی ترد اصلی هر فریم
 *   4. Native و ZXing همزمان + TRY_HARDER/ITF که Worker را قفل و watchdog را آتش می‌کرد
 *
 * مسیر جدید:
 *   - دوربین فقط یک‌بار روی mount روشن می‌شود (onDetected از طریق ref)
 *   - Native BarcodeDetector روی ImageBitmap بریده‌شده (GPU)
 *   - ZXing فقط اگر Native نبود یا چیزی نخواند؛ داخل Worker
 *   - نسبت تصویر کادر حفظ می‌شود
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Flashlight, FlashlightOff, RefreshCw } from "lucide-react";
import { decodeBudget, detectDeviceTier } from "@/lib/device-tier";
import { cropSourceRect, fitDecodeSize } from "@/lib/scanner-engine";
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
  if (!window.BarcodeDetector) return null;
  const attempts: Array<{ formats?: string[] } | undefined> = [
    { formats: NATIVE_FORMATS },
    { formats: CORE_NATIVE_FORMATS },
    undefined,
  ];
  for (const opts of attempts) {
    try {
      return opts ? new window.BarcodeDetector!(opts) : new window.BarcodeDetector!();
    } catch {
      /* some engines throw if any listed format is unsupported */
    }
  }
  return null;
}

function spawnZxingWorker(): Worker | null {
  try {
    return new Worker(new URL("../lib/zxing.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
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

    const attachWorker = (w: Worker | null) => {
      if (!w) {
        workerRef.current = null;
        return;
      }
      w.onmessage = (e: MessageEvent<{ id: number; text: string | null }>) => {
        clearWatchdog();
        workerBusy.current = false;
        if (e.data.text) emitRef.current(e.data.text, "ZXing");
      };
      w.onerror = (ev) => {
        console.warn("[scanner] ZXing worker error", ev.message);
        clearWatchdog();
        workerBusy.current = false;
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
        workerRef.current = null;
        if (!cancelled) attachWorker(spawnZxingWorker());
      };
      workerRef.current = w;
    };

    const armWatchdog = () => {
      clearWatchdog();
      workerWatchdog.current = setTimeout(() => {
        workerWatchdog.current = null;
        workerBusy.current = false;
        console.warn("[scanner] ZXing worker decode timed out — recycling");
        try {
          workerRef.current?.terminate();
        } catch {
          /* ignore */
        }
        workerRef.current = null;
        if (!cancelled) attachWorker(spawnZxingWorker());
      }, 2000);
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

    const grabBitmap = async (video: HTMLVideoElement): Promise<ImageBitmap | null> => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const src = cropSourceRect(vw, vh, cropRef.current);
      const fit = fitDecodeSize(src.sw, src.sh, BUDGET.maxW, BUDGET.maxH);
      try {
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

    const scanFrame = async (video: HTMLVideoElement) => {
      if (pausedRef.current || video.readyState < 2) return;
      fpsCountRef.current++;

      const bitmap = await grabBitmap(video);
      if (!bitmap || cancelled || pausedRef.current) {
        bitmap?.close();
        return;
      }

      if (nativeRef.current) {
        try {
          let codes: NativeBarcode[] = [];
          if (nativeBitmapOk.current) {
            try {
              codes = await nativeRef.current.detect(bitmap);
            } catch {
              nativeBitmapOk.current = false;
            }
          }
          if (!codes.length) {
            try {
              codes = await nativeRef.current.detect(video);
            } catch {
              /* ZXing fallback */
            }
          }
          if (cancelled) {
            bitmap.close();
            return;
          }
          if (codes.length) {
            emitRef.current(codes[0].rawValue, codes[0].format);
            bitmap.close();
            return;
          }
        } catch {
          /* fall through to ZXing */
        }
      }

      const worker = workerRef.current;
      if (worker && !workerBusy.current) {
        extraTick.current += 1;
        workerBusy.current = true;
        armWatchdog();
        try {
          worker.postMessage(
            { id: extraTick.current, bitmap, extra: extraTick.current % 10 === 0 },
            [bitmap],
          );
          return;
        } catch {
          clearWatchdog();
          workerBusy.current = false;
        }
      }
      bitmap.close();
    };

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("دوربین در این مرورگر پشتیبانی نمی‌شود");
      }

      const isLow = DEVICE_TIER === "low";
      const tries: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: isLow ? 640 : 1280 },
            height: { ideal: isLow ? 480 : 720 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        },
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        { video: true, audio: false },
      ];

      let stream: MediaStream | null = null;
      for (const c of tries) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(c);
          break;
        } catch {
          /* try next */
        }
      }
      if (!stream) throw new Error("دسترسی به دوربین امکان‌پذیر نیست");
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
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;

      await new Promise<void>((res) => {
        if (video.readyState >= 1) {
          res();
          return;
        }
        video.onloadedmetadata = () => res();
        setTimeout(res, 2500);
      });
      await video.play().catch(() => {});
      if (cancelled) return;

      const track = stream.getVideoTracks()[0];
      try {
        (track as MediaStreamTrack & { contentHint?: string }).contentHint = "detail";
      } catch {
        /* ignore */
      }
      if (track.getCapabilities) {
        const caps = track.getCapabilities() as Record<string, unknown>;
        setTorchSupported(!!caps.torch);
        const zc = caps.zoom as { min?: number; max?: number } | undefined;
        if (zc) {
          zoomMinRef.current = zc.min ?? 1;
          zoomMaxRef.current = zc.max ?? 10;
        }
        setZoomSupported(!!caps.zoom);

        const adv: Record<string, unknown>[] = [];
        if (Array.isArray(caps.focusMode) && (caps.focusMode as string[]).includes("continuous")) {
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
          await track.applyConstraints({ advanced: adv } as MediaTrackConstraints).catch(() => {});
        }
      }

      attachWorker(spawnZxingWorker());
      nativeRef.current = createNativeDetector();
      if (nativeRef.current) {
        setEngine(workerRef.current ? "Native + ZXing" : "Native");
      } else {
        setEngine(workerRef.current ? "ZXing Worker" : "دوربین");
      }

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
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
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
