/**
 * camera.ts — باز و بسته کردن دوربین و کنترل‌های سخت‌افزاری (چراغ، زوم، فوکوس).
 *
 * ترتیب باز کردن، برای سریع‌ترین شروع:
 *   1. لنزی که قبلاً روی همین دستگاه **واقعاً بارکد خوانده** (کلید ذخیره‌شده).
 *   2. وگرنه `facingMode: environment`، سپس اگر برچسب‌ها نشان دهند لنز بهتری
 *      هست، جابه‌جایی به آن.
 *
 * هر خطای کنترل سخت‌افزاری بلعیده می‌شود: نبودِ چراغ یا زوم نباید اسکن را بکشد.
 */
import {
  initialZoom,
  isFrontLens,
  labelsAreInformative,
  rankRearLenses,
  type LensInfo,
} from "./lens";
import { forgetLens, recallLens } from "./prefs";

export type CameraErrorKind =
  "unsupported" | "insecure" | "denied" | "not-found" | "busy" | "unknown";

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
  }
}

export type ZoomRange = { min: number; max: number; step: number };

export type CameraHandle = {
  stream: MediaStream;
  track: MediaStreamTrack;
  deviceId: string | null;
  lenses: LensInfo[];
  torchSupported: boolean;
  zoom: ZoomRange | null;
  focusSupported: boolean;
};

const RESOLUTION = { width: { ideal: 1920 }, height: { ideal: 1080 } } as const;

type ExtendedCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
  pointsOfInterest?: unknown;
};

export function cameraAvailability(): CameraErrorKind | null {
  if (typeof navigator === "undefined") return "unsupported";
  if (typeof window !== "undefined" && window.isSecureContext === false) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  return null;
}

function classify(err: unknown): CameraError {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return new CameraError("denied");
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  )
    return new CameraError("not-found");
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
    return new CameraError("busy");
  return new CameraError("unknown", String((err as Error)?.message ?? err));
}

export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try {
      t.stop();
    } catch {
      /* already stopped */
    }
  }
}

async function request(video: MediaTrackConstraints): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: false, video });
}

async function listLenses(): Promise<LensInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput" && d.deviceId)
      .map((d) => ({ deviceId: d.deviceId, label: d.label || "" }));
  } catch {
    return [];
  }
}

function trackDeviceId(track: MediaStreamTrack): string | null {
  try {
    return track.getSettings().deviceId ?? null;
  } catch {
    return null;
  }
}

/**
 * دوربین را باز می‌کند. `deviceId` برای انتخاب صریح کاربر (دکمهٔ تغییر لنز).
 * `isCancelled` بعد از هر await بررسی می‌شود تا استریمی که دیگر لازم نیست بلافاصله بسته شود.
 */
export async function openCamera(opts: {
  deviceId?: string;
  isCancelled: () => boolean;
}): Promise<CameraHandle> {
  const unavailable = cameraAvailability();
  if (unavailable) throw new CameraError(unavailable);

  let stream: MediaStream | null = null;
  const cancelled = () => {
    if (opts.isCancelled()) {
      stopStream(stream);
      return true;
    }
    return false;
  };

  const explicit = opts.deviceId ?? recallLens();
  if (explicit) {
    try {
      stream = await request({ ...RESOLUTION, deviceId: { exact: explicit } });
    } catch (err) {
      stream = null;
      if (!opts.deviceId) forgetLens();
      // مجوز ردشده با لنز دیگر هم رد می‌شود؛ تلاش بیشتر بی‌فایده است.
      if (classify(err).kind === "denied") throw classify(err);
    }
  }

  if (!stream) {
    try {
      stream = await request({ ...RESOLUTION, facingMode: { ideal: "environment" } });
    } catch (err) {
      const e = classify(err);
      if (e.kind === "denied") throw e;
      // بعضی وب‌کم‌ها با قید وضوح باز نمی‌شوند؛ آخرین تلاش بدون قید.
      try {
        stream = await request({ facingMode: { ideal: "environment" } });
      } catch (err2) {
        throw classify(err2);
      }
    }
  }
  if (cancelled()) throw new CameraError("unknown", "cancelled");

  let lenses = await listLenses();
  if (cancelled()) throw new CameraError("unknown", "cancelled");

  // انتخاب خودکار لنز فقط وقتی کاربر یا حافظه لنز مشخصی نخواسته‌اند.
  if (!explicit && labelsAreInformative(lenses)) {
    const current = trackDeviceId(stream.getVideoTracks()[0]);
    const best = rankRearLenses(lenses)[0];
    if (best && current && best.deviceId !== current) {
      // بسیاری از گوشی‌ها دو دوربین هم‌زمان باز نمی‌کنند؛ اول قبلی بسته می‌شود.
      stopStream(stream);
      stream = null;
      try {
        stream = await request({ ...RESOLUTION, deviceId: { exact: best.deviceId } });
      } catch {
        try {
          stream = await request({ ...RESOLUTION, facingMode: { ideal: "environment" } });
        } catch (err) {
          throw classify(err);
        }
      }
      if (cancelled()) throw new CameraError("unknown", "cancelled");
    }
  }

  const track = stream.getVideoTracks()[0];
  if (!track) {
    stopStream(stream);
    throw new CameraError("not-found");
  }
  if (lenses.length === 0) lenses = await listLenses();

  const caps = capabilities(track);
  const handle: CameraHandle = {
    stream,
    track,
    deviceId: trackDeviceId(track),
    lenses: lenses.filter((l) => !isFrontLens(l.label)),
    torchSupported: caps.torch === true,
    zoom:
      caps.zoom && typeof caps.zoom.min === "number" && caps.zoom.max > caps.zoom.min
        ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 }
        : null,
    focusSupported: Array.isArray(caps.focusMode) && caps.focusMode.length > 0,
  };

  await tune(handle);
  if (cancelled()) throw new CameraError("unknown", "cancelled");
  return handle;
}

function capabilities(track: MediaStreamTrack): ExtendedCapabilities {
  try {
    return (track.getCapabilities?.() ?? {}) as ExtendedCapabilities;
  } catch {
    return {};
  }
}

async function apply(
  track: MediaStreamTrack,
  constraint: Record<string, unknown>,
): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** فوکوس پیوسته و زوم شروع. هر کدام جدا اعمال می‌شود تا شکست یکی دیگری را خنثی نکند. */
async function tune(handle: CameraHandle): Promise<void> {
  const caps = capabilities(handle.track);
  if (caps.focusMode?.includes("continuous"))
    await apply(handle.track, { focusMode: "continuous" });
  const zoom = initialZoom(handle.zoom);
  if (zoom !== null) await apply(handle.track, { zoom });
}

export function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  return apply(track, { torch: on });
}

export function setZoom(track: MediaStreamTrack, value: number): Promise<boolean> {
  return apply(track, { zoom: value });
}

export function currentZoom(track: MediaStreamTrack): number | null {
  try {
    const z = (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom;
    return typeof z === "number" ? z : null;
  } catch {
    return null;
  }
}

/** فوکوس روی نقطهٔ لمس‌شده (کسر ۰ تا ۱)، سپس برگشت به فوکوس پیوسته. */
export async function focusAt(track: MediaStreamTrack, x: number, y: number): Promise<void> {
  const caps = capabilities(track);
  const modes = caps.focusMode ?? [];
  const constraint: Record<string, unknown> = {};
  if ("pointsOfInterest" in caps) constraint.pointsOfInterest = [{ x, y }];
  if (modes.includes("single-shot")) constraint.focusMode = "single-shot";
  else if (modes.includes("continuous")) constraint.focusMode = "continuous";
  if (Object.keys(constraint).length === 0) return;
  await apply(track, constraint);
  if (constraint.focusMode === "single-shot" && modes.includes("continuous")) {
    setTimeout(() => void apply(track, { focusMode: "continuous" }), 1500);
  }
}
