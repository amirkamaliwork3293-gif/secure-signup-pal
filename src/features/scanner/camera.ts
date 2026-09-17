/**
 * camera.ts — باز و بست کردن استریم دوربین عقب.
 *
 * نکتهٔ اصلی این فایل **تأیید زنده‌بودن** است: باز شدن استریم به معنی رسیدن فریم
 * نیست. روی گوشی‌های چنددوربینه، `facingMode: "environment"` ممکن است به لنزی
 * بسته شود که تصویر می‌دهد ولی در فاصلهٔ بارکد فوکوس نمی‌کند، یا حتی هیچ فریمی
 * نمی‌دهد. نسخهٔ قبل همین حالت را بی‌صدا شکست می‌خورد. اینجا هر کاندیدا آزمایش
 * می‌شود و اگر فریم نداد، سراغ بعدی می‌رویم.
 *
 * این فایل فقط استریم و قابلیت‌های تراک است؛ نه دیکود، نه UI.
 */
import { looksLikeFrontCamera, preferredInitialZoom, rankRearCameras } from "./camera-select";

/** تا این مدت منتظر اولین فریم واقعی می‌مانیم، بعد کاندیدا را رد می‌کنیم. */
const FIRST_FRAME_TIMEOUT_MS = 2500;

export type CameraCapabilities = {
  torch: boolean;
  zoom: { min: number; max: number } | null;
};

function gum(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  if (md?.getUserMedia) return md.getUserMedia(constraints);
  return Promise.reject(new Error("دوربین در این مرورگر پشتیبانی نمی‌شود"));
}

async function tryGum(constraints: MediaStreamConstraints): Promise<MediaStream | null> {
  try {
    return await gum(constraints);
  } catch {
    return null;
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* تراک از قبل بسته است */
    }
  });
}

/** ویدیو با رزولوشن مطلوب؛ همه با `ideal` تا هیچ‌وقت OverconstrainedError نگیریم. */
function videoConstraints(deviceId?: string, exactId = false): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) video.deviceId = exactId ? { exact: deviceId } : { ideal: deviceId };
  else video.facingMode = { ideal: "environment" };
  return { video, audio: false };
}

/**
 * گرفتن مجوز دوربین. قبل از مجوز، `enumerateDevices` لیبل خالی می‌دهد و
 * رتبه‌بندی لنز ممکن نیست — پس این مرحله باید اول باشد.
 */
export async function primeCameraPermission(): Promise<MediaStream> {
  const stream =
    (await tryGum(videoConstraints())) ||
    (await tryGum({ video: { facingMode: "environment" }, audio: false })) ||
    (await tryGum({ video: { facingMode: { ideal: "environment" } }, audio: false })) ||
    (await tryGum({ video: true, audio: false }));
  if (!stream) throw new Error("دسترسی به دوربین ممکن نشد");
  return stream;
}

/**
 * فهرست کاندیداهای لنز عقب، از محتمل‌ترین به کم‌محتمل‌ترین.
 * اگر `enumerateDevices` در دسترس نباشد (WebView قدیمی) فهرست خالی برمی‌گردد و
 * صداکننده به همان استریم اولیه بسنده می‌کند.
 */
export async function listRearCameras(): Promise<string[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return rankRearCameras(
      devices.map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind })),
    );
  } catch {
    return [];
  }
}

export async function openByDeviceId(deviceId: string): Promise<MediaStream | null> {
  return (
    (await tryGum(videoConstraints(deviceId, true))) ||
    (await tryGum(videoConstraints(deviceId, false))) ||
    (await tryGum({ video: { deviceId: { exact: deviceId } }, audio: false })) ||
    (await tryGum({ video: { deviceId: { ideal: deviceId } }, audio: false }))
  );
}

/**
 * استریم را به ویدیو وصل می‌کند و **منتظر یک فریم واقعی می‌ماند**.
 * `false` یعنی این لنز تصویر نداد و باید کاندیدای بعدی را امتحان کرد.
 */
export async function attachAndVerify(
  video: HTMLVideoElement,
  stream: MediaStream,
  timeoutMs = FIRST_FRAME_TIMEOUT_MS,
): Promise<boolean> {
  // این چهار خط روی iOS و WebView قدیمی لازم است، وگرنه ویدیو تمام‌صفحه می‌شود.
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("muted", "true");
  video.muted = true;
  video.playsInline = true;

  try {
    video.srcObject = stream;
  } catch {
    return false;
  }

  try {
    await video.play();
  } catch {
    // بعضی WebViewها play را رد می‌کنند ولی فریم می‌دهند — قضاوت را به حلقهٔ زیر بسپار.
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) return true;
    if (stream.getVideoTracks()[0]?.readyState === "ended") return false;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

/** آیا این استریم به‌احتمال زیاد دوربین جلو است؟ */
export function isFrontStream(stream: MediaStream): boolean {
  const track = stream.getVideoTracks()[0];
  if (!track) return false;
  const settings = track.getSettings?.() ?? {};
  return looksLikeFrontCamera(settings.facingMode, track.label);
}

/**
 * فوکوس/نوردهی پیوسته و زوم نزدیک به ۱.۶× — جداگانه، چون `advanced` دسته‌ای
 * روی بعضی سامسونگ‌ها پیش‌نمایش را زنده می‌گذارد ولی کپی فریم را می‌کشد.
 */
export async function applyPreferredSettings(track: MediaStreamTrack): Promise<number | null> {
  try {
    (track as MediaStreamTrack & { contentHint?: string }).contentHint = "detail";
  } catch {
    /* پشتیبانی نمی‌شود */
  }

  const caps = readRawCapabilities(track);
  if (!caps) return null;

  for (const mode of ["focusMode", "exposureMode"] as const) {
    const values = caps[mode];
    if (Array.isArray(values) && values.includes("continuous")) {
      await applyAdvanced(track, { [mode]: "continuous" });
    }
  }

  const zoom = caps.zoom as { min?: number; max?: number } | undefined;
  if (!zoom) return null;
  const min = zoom.min ?? 1;
  const max = zoom.max ?? min;
  const value = preferredInitialZoom(min, max);
  if (await applyAdvanced(track, { zoom: value })) return value;
  return null;
}

function readRawCapabilities(track: MediaStreamTrack): Record<string, unknown> | null {
  try {
    if (typeof track.getCapabilities !== "function") return null;
    return track.getCapabilities() as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readCapabilities(track: MediaStreamTrack): CameraCapabilities {
  const caps = readRawCapabilities(track);
  if (!caps) return { torch: false, zoom: null };
  const zoom = caps.zoom as { min?: number; max?: number } | undefined;
  return {
    torch: !!caps.torch,
    zoom: zoom ? { min: zoom.min ?? 1, max: zoom.max ?? 10 } : null,
  };
}

/** یک قید پیشرفتهٔ تکی. `false` یعنی این دستگاه پشتیبانی نمی‌کند. */
export async function applyAdvanced(
  track: MediaStreamTrack,
  constraint: Record<string, unknown>,
): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [constraint] } as MediaTrackConstraints);
    return true;
  } catch {
    return false;
  }
}
