/**
 * diagnostics.ts — عکس لحظه‌ای از وضعیت اسکنر، برای عیب‌یابی روی گوشی کاربر.
 *
 * چرا: «دوربین روشن است ولی بارکد خوانده نمی‌شود» از راه دور قابل تشخیص نیست.
 * باید بدانیم کدام موتور فعال است، فریم واقعاً چه اندازه‌ای است، کپی فریم سیاه
 * می‌آید یا نه، و دیکود چقدر طول می‌کشد. این فایل فقط **گزارش** می‌سازد؛ هیچ
 * تصمیمی دربارهٔ دوربین یا دیکود اینجا گرفته نمی‌شود.
 *
 * همهٔ توابع اینجا خالص‌اند (بدون DOM، بدون زمانِ پنهان) تا در Node تست شوند.
 */
import type { ScannerFlags } from "./flags";

/** از کجا پیکسل گرفته شد. `none` یعنی هنوز هیچ فریم سالمی نیامده. */
export type FrameGrabPath = "canvas" | "image-capture" | "none";

/**
 * وضعیت «حالت نجات» (مرحلهٔ ۱). در مرحلهٔ ۰ همیشه `off` است و فقط برای اینکه
 * شکل گزارش بین مرحله‌ها عوض نشود اینجا تعریف شده.
 */
export type RescueState = "off" | "armed" | "running" | "disabled";

/** تنها بخش‌هایی از `track.getSettings()` که به درد عیب‌یابی می‌خورند. */
export type TrackSnapshot = {
  label: string;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  zoom: number | null;
  focusMode: string | null;
  facingMode: string | null;
};

export type ScannerDiagnostics = {
  phase: "starting" | "running" | "error";
  error: string | null;
  engine: "worker" | "main" | null;
  nativeActive: boolean;
  barcodeDetectorPresent: boolean;
  videoWidth: number;
  videoHeight: number;
  track: TrackSnapshot | null;
  framePath: FrameGrabPath;
  blankFrames: number;
  decodeSamples: number;
  avgDecodeMs: number;
  fps: number;
  /** میلی‌ثانیه از آخرین خوانش موفق (پیش از دروازهٔ پذیرش). `null` یعنی هیچ‌وقت. */
  msSinceLastDecode: number | null;
  lastDecodeFormat: string | null;
  rescue: RescueState;
  cameraCount: number;
  cameraIndex: number;
  flags: ScannerFlags;
};

/* ------------------------------------------------- ژست باز کردن پنل */

/** پنل مخفی است تا کاربر عادی اتفاقی بازش نکند؛ پشتیبانی تلفنی راهنمایی می‌کند. */
export const DIAG_TAP_COUNT = 5;
/** ضربه‌ها باید «پشت سر هم» باشند، وگرنه لمس‌های پراکنده هم بازش می‌کردند. */
export const DIAG_TAP_WINDOW_MS = 2000;

/**
 * یک ضربه را ثبت می‌کند. `open: true` یعنی به شمار رسید و شمارش صفر می‌شود
 * (وگرنه ضربهٔ ششم بلافاصله دوباره بازش می‌کرد).
 */
export function registerDiagnosticsTap(
  previous: readonly number[],
  now: number,
): { taps: number[]; open: boolean } {
  const taps = [...previous, now]
    .filter((t) => now - t <= DIAG_TAP_WINDOW_MS)
    .slice(-DIAG_TAP_COUNT);
  if (taps.length >= DIAG_TAP_COUNT) return { taps: [], open: true };
  return { taps, open: false };
}

/* ------------------------------------------------- میانگین زمان دیکود */

/** چند نمونهٔ آخر کافی است؛ میانگین کل عمر جلسه، کندیِ همین حالا را پنهان می‌کند. */
export const DECODE_SAMPLE_LIMIT = 30;

export function pushDecodeSample(
  samples: readonly number[],
  ms: number,
  limit = DECODE_SAMPLE_LIMIT,
): number[] {
  if (!Number.isFinite(ms) || ms < 0) return [...samples];
  const next = [...samples, ms];
  const max = Math.max(1, limit | 0);
  return next.length > max ? next.slice(next.length - max) : next;
}

export function averageMs(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s;
  return Math.round((sum / samples.length) * 10) / 10;
}

/* ------------------------------------------------- شناسایی مرورگر/WebView */

export type UserAgentInfo = {
  browser: string;
  version: string;
  /** نسخهٔ موتور Chromium — روی اندروید همان نسخهٔ «سیستم WebView» است. */
  chromium: string;
  android: string;
  webView: boolean;
};

/**
 * نسخهٔ WebView سیستمی مهم‌ترین عدد این گزارش است: خیلی از تفاوت‌های سامسونگ
 * (وجود `BarcodeDetector`، سالم بودن `ImageCapture`) به همین نسخه برمی‌گردد.
 *
 * ترتیب بررسی اهمیت دارد: سامسونگ اینترنت و Edge هر دو `Chrome/` را هم در UA
 * دارند، پس باید قبل از کروم بررسی شوند.
 */
export function describeUserAgent(ua: string | null | undefined): UserAgentInfo {
  const s = String(ua ?? "");
  const pick = (re: RegExp): string => s.match(re)?.[1] ?? "";

  const chromium = pick(/Chrome\/([\d.]+)/);
  const android = pick(/Android\s+([\d.]+)/);
  const webView = /;\s*wv[;)]/i.test(s) || /\bwv\b/.test(s);

  const named: Array<[string, RegExp]> = [
    ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
    ["Edge", /Edg(?:A|iOS)?\/([\d.]+)/],
    ["Opera", /OPR\/([\d.]+)/],
    ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
  ];
  for (const [browser, re] of named) {
    const version = pick(re);
    if (version) return { browser, version, chromium, android, webView };
  }

  if (chromium) {
    return {
      browser: webView ? "Android WebView" : "Chrome",
      version: chromium,
      chromium,
      android,
      webView,
    };
  }

  const safari = pick(/Version\/([\d.]+).*Safari/);
  if (safari) return { browser: "Safari", version: safari, chromium, android, webView };

  return { browser: s ? "نامشخص" : "", version: "", chromium, android, webView };
}

/* ------------------------------------------------- متن گزارش */

function yn(v: boolean): string {
  return v ? "yes" : "no";
}

function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
}

/**
 * گزارش عمداً ASCII است: قرار است در واتساپ/تلگرام کپی شود و متن دوجهته
 * (فارسی + عدد + پرانتز) آنجا به‌هم می‌ریزد و عددها جابه‌جا خوانده می‌شوند.
 */
export function formatDiagnosticsReport(
  d: ScannerDiagnostics,
  meta: { userAgent: string; nowIso: string; href?: string },
): string {
  const ua = describeUserAgent(meta.userAgent);
  const t = d.track;
  const lines = [
    "KAMIX scanner diagnostics",
    `time: ${meta.nowIso}`,
    meta.href ? `url: ${meta.href}` : null,
    `browser: ${ua.browser || "-"} ${ua.version || "-"} (chromium ${ua.chromium || "-"}, webview=${yn(
      ua.webView,
    )}, android=${ua.android || "-"})`,
    `ua: ${meta.userAgent || "-"}`,
    `phase: ${d.phase}${d.error ? ` (${d.error})` : ""}`,
    `engine: ${d.engine ?? "-"} | native=${yn(d.nativeActive)} | BarcodeDetector=${yn(
      d.barcodeDetectorPresent,
    )}`,
    `video: ${d.videoWidth}x${d.videoHeight} | loop=${num(d.fps)}fps`,
    t
      ? `track: "${t.label || "-"}" ${num(t.width)}x${num(t.height)} fps=${num(t.frameRate, 1)} zoom=${num(
          t.zoom,
          2,
        )} focus=${t.focusMode ?? "-"} facing=${t.facingMode ?? "-"}`
      : "track: -",
    `frames: path=${d.framePath} blank=${d.blankFrames}`,
    `decode: avg=${num(d.avgDecodeMs, 1)}ms samples=${d.decodeSamples}`,
    `lastDecode: ${
      d.msSinceLastDecode == null ? "never" : `${(d.msSinceLastDecode / 1000).toFixed(1)}s ago`
    }${d.lastDecodeFormat ? ` (${d.lastDecodeFormat})` : ""}`,
    `rescue: ${d.rescue}`,
    `camera: ${d.cameraCount === 0 ? "-" : `${d.cameraIndex + 1}/${d.cameraCount}`}`,
    `flags: legacy=${yn(d.flags.legacy)} diagnostics=${yn(d.flags.diagnostics)} photo=${yn(
      d.flags.photoFallback,
    )} rescue=${yn(d.flags.rescueMode)} experimental=${yn(d.flags.experimental)}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}
