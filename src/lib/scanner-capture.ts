/**
 * scanner-capture.ts — سازگاری دوربین اندروید / WebView (بدون دیکود).
 *
 * گزارش مشتری: اسکن روی بعضی گوشی‌ها کار می‌کند و روی گوشی برادر نه.
 * علت‌های تکراری در WebView سیستمی و کروم قدیمی اندروید:
 *   1. facingMode به‌صورت { ideal } یا رزولوشن ۱۹۲۰ Overconstrained می‌شود
 *   2. دوربین پشت با label انتخاب می‌شود نه facingMode (سامسونگ/شیائومی)
 *   3. createImageBitmap(HTMLVideoElement) وجود ندارد یا کراپ را throw می‌کند
 *   5. BarcodeDetector روی کروم جدید گاهی detect را resolve نمی‌کند و حلقه یخ می‌زند
 *      (گوشی جدید که قبلاً کار می‌کرد). تایم‌اوت کوتاه Native را قطع می‌کند و ZXing ادامه می‌دهد.
 *
 * این فایل فقط استریم و برش فریم است؛ دیکود در Worker / decodeRgba می‌ماند.
 */

import { cropSourceRect, fitDecodeSize, type ScanCrop } from "./scanner-engine";

export type RearCameraDevice = { deviceId: string; label: string; kind: string };

/** پشت/محیط — لیبل فارسی و انگلیسی رایج بازار ایران. */
export function pickRearCameraId(
  devices: Array<{ deviceId: string; label: string; kind: string }>,
): string | undefined {
  const videos = devices.filter((d) => d.kind === "videoinput");
  if (videos.length === 0) return undefined;
  const rear = videos.find((d) =>
    /back|rear|environment|world|facing back|camera2 0|پشت|خلفی|عقب/i.test(d.label),
  );
  if (rear) return rear.deviceId;
  const front = videos.find((d) => /front|user|facing front|جلو|سلفی/i.test(d.label));
  if (front && videos.length > 1) {
    return videos.find((d) => d.deviceId !== front.deviceId)?.deviceId;
  }
  // در بسیاری از اندرویدها آخرین videoinput دوربین پشت است.
  return videos.length > 1 ? videos[videos.length - 1].deviceId : videos[0].deviceId;
}

/** دو تایم‌اوت پیاپی → Native را خاموش کن تا حلقه دیگر منتظر نماند. */
export const NATIVE_HANG_LIMIT = 2;

/** شمارش آویزان شدن BarcodeDetector؛ موفقیت شمارنده را صفر می‌کند. */
export function nextNativeHangState(
  timedOut: boolean,
  hangCount: number,
  limit = NATIVE_HANG_LIMIT,
): { hangCount: number; disable: boolean } {
  if (!timedOut) return { hangCount: 0, disable: false };
  const next = hangCount + 1;
  return { hangCount: next, disable: next >= Math.max(1, limit | 0) };
}

/** اگر promise تا ms برنگردد، fallback می‌دهد — برای detect بومیِ آویزان روی کروم جدید. */
export function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(
      () => {
        if (done) return;
        done = true;
        resolve({ value: fallback, timedOut: true });
      },
      Math.max(1, ms | 0),
    );
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ value, timedOut: false });
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ value: fallback, timedOut: false });
      },
    );
  });
}

export function cameraConstraintTries(isLow: boolean): MediaStreamConstraints[] {
  const envStr: MediaStreamConstraints = {
    video: { facingMode: "environment" },
    audio: false,
  };
  const envObj: MediaStreamConstraints = {
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  };
  const hd: MediaStreamConstraints = {
    video: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };
  const fhd: MediaStreamConstraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: isLow ? 1280 : 1920 },
      height: { ideal: isLow ? 720 : 1080 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  };
  // اول قید ساده تا Overconstrained روی WebView قدیمی ۲۰ ثانیه طول نکشد.
  return [hd, envStr, envObj, fhd, { video: true, audio: false }];
}

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  success: (stream: MediaStream) => void,
  error: (err: Error) => void,
) => void;

function getGum(): ((c: MediaStreamConstraints) => Promise<MediaStream>) | null {
  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === "function") {
    return (c) => md.getUserMedia(c);
  }
  const legacy = navigator as Navigator & {
    getUserMedia?: LegacyGetUserMedia;
    webkitGetUserMedia?: LegacyGetUserMedia;
  };
  const fn = legacy.getUserMedia || legacy.webkitGetUserMedia;
  if (!fn) return null;
  return (c) =>
    new Promise((resolve, reject) => {
      fn.call(navigator, c, resolve, reject);
    });
}

async function gumTry(
  gum: (c: MediaStreamConstraints) => Promise<MediaStream>,
  c: MediaStreamConstraints,
): Promise<MediaStream | null> {
  try {
    return await gum(c);
  } catch {
    return null;
  }
}

function isLikelyFrontTrack(track: MediaStreamTrack): boolean {
  try {
    const s = track.getSettings?.() ?? {};
    if (s.facingMode === "user") return true;
    if (s.facingMode === "environment") return false;
    return /front|user|جلو|سلفی/i.test(track.label || "");
  } catch {
    return false;
  }
}

/**
 * استریم دوربین پشت با چند شکل قید + enumerateDevices.
 * اگر فقط دوربین جلو در دسترس باشد همان را برمی‌گرداند تا اسکن صفر نشود.
 */
export async function openCameraStream(isLow: boolean): Promise<MediaStream> {
  const gum = getGum();
  if (!gum) throw new Error("دوربین در این مرورگر پشتیبانی نمی‌شود");

  let stream: MediaStream | null = null;
  for (const c of cameraConstraintTries(isLow)) {
    stream = await gumTry(gum, c);
    if (stream) break;
  }
  if (!stream) throw new Error("دسترسی به دوربین امکان‌پذیر نیست");

  const track0 = stream.getVideoTracks()[0];
  if (!track0) throw new Error("دسترسی به دوربین امکان‌پذیر نیست");
  const currentId = track0.getSettings?.().deviceId;
  const looksFront = isLikelyFrontTrack(track0);

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const rearId = pickRearCameraId(devices);
    // اگر facingMode نادیده گرفته شد (سامسونگ/شیائومی) یا لیبل خالی است، deviceId پشت را امتحان کن.
    if (rearId && rearId !== currentId && (looksFront || !currentId)) {
      const rear =
        (await gumTry(gum, { video: { deviceId: { exact: rearId } }, audio: false })) ||
        (await gumTry(gum, { video: { deviceId: { ideal: rearId } }, audio: false }));
      if (rear) {
        stream.getTracks().forEach((t) => t.stop());
        stream = rear;
      }
    }
  } catch {
    /* enumerateDevices بدون مجوز یا WebView قدیمی */
  }

  return stream;
}

export async function attachVideoStream(
  video: HTMLVideoElement,
  stream: MediaStream,
): Promise<void> {
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("muted", "true");
  video.muted = true;
  video.playsInline = true;
  try {
    video.srcObject = stream;
  } catch {
    const url = URL.createObjectURL(stream as unknown as Blob);
    video.src = url;
  }
  await new Promise<void>((res) => {
    if (video.readyState >= 1) {
      res();
      return;
    }
    const done = () => res();
    video.onloadedmetadata = done;
    video.onloadeddata = done;
    setTimeout(done, 2500);
  });
  for (let i = 0; i < 4; i++) {
    try {
      await video.play();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 180));
    }
  }
  for (let i = 0; i < 8 && (!video.videoWidth || !video.videoHeight); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function canUseOffscreenCanvas(): boolean {
  try {
    const C = (globalThis as unknown as { OffscreenCanvas?: typeof OffscreenCanvas })
      .OffscreenCanvas;
    if (!C) return false;
    const c = new C(2, 2);
    return !!c.getContext("2d");
  } catch {
    return false;
  }
}

export type GrabbedFrame = {
  bitmap?: ImageBitmap;
  data?: Uint8ClampedArray;
  width: number;
  height: number;
};

let grabCanvas: HTMLCanvasElement | null = null;
let grabCtx: CanvasRenderingContext2D | null = null;

function ensureGrabCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  if (!grabCanvas) {
    grabCanvas = document.createElement("canvas");
    grabCtx = grabCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
  }
  if (!grabCtx || !grabCanvas) return null;
  return { canvas: grabCanvas, ctx: grabCtx };
}

/** کراپ ویدیو با canvas — مسیر WebView بدون createImageBitmap. */
export function grabFrameViaCanvas(
  video: HTMLVideoElement,
  crop: ScanCrop,
  maxW: number,
  maxH: number,
): GrabbedFrame | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const src = cropSourceRect(vw, vh, crop);
  const fit = fitDecodeSize(src.sw, src.sh, maxW, maxH);
  const pair = ensureGrabCanvas();
  if (!pair) return null;
  const { canvas, ctx } = pair;
  if (canvas.width !== fit.dw) canvas.width = fit.dw;
  if (canvas.height !== fit.dh) canvas.height = fit.dh;
  try {
    ctx.drawImage(video, src.sx, src.sy, src.sw, src.sh, 0, 0, fit.dw, fit.dh);
    const img = ctx.getImageData(0, 0, fit.dw, fit.dh);
    return { data: img.data, width: fit.dw, height: fit.dh };
  } catch {
    return null;
  }
}

export function bitmapToRgba(bitmap: ImageBitmap): GrabbedFrame | null {
  const pair = ensureGrabCanvas();
  if (!pair) return null;
  const w = bitmap.width | 0;
  const h = bitmap.height | 0;
  if (w < 8 || h < 8) return null;
  const { canvas, ctx } = pair;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  try {
    ctx.drawImage(bitmap, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return { data: img.data, width: w, height: h };
  } catch {
    return null;
  }
}
