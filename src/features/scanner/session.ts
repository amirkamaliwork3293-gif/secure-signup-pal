/**
 * session.ts — چرخهٔ عمر اسکن: دوربین، حلقهٔ فریم، دیکود، پذیرش.
 *
 * کل منابع اسکنر در همین یک شیء است و یک `dispose()` دارد. افکت ری‌اکت فقط
 * می‌سازد و dispose می‌کند — هیچ‌جای دیگری تراک یا Worker نگه نمی‌دارد. نتیجه:
 * نه استریم آویزان، نه Worker یتیم، نه AudioContext باز بعد از خروج از صفحه.
 *
 * حلقه با `requestVideoFrameCallback` به فریم واقعی دوربین قفل می‌شود و در هر
 * لحظه **فقط یک دیکود** در پرواز است (`await` روی خودِ حلقه). فریم جدید در صف
 * نمی‌رود، دور ریخته می‌شود؛ پس پیش‌نمایش هیچ‌وقت لگ نمی‌گیرد.
 */
import { acceptScan, initialAcceptState, type AcceptState } from "./accept";
import {
  applyAdvanced,
  applyPreferredSettings,
  attachAndVerify,
  isFrontStream,
  listRearCameras,
  openByDeviceId,
  primeCameraPermission,
  readCapabilities,
  stopStream,
} from "./camera";
import { shouldReusePrimedCamera } from "./camera-select";
import { Decoder } from "./decoder";
import {
  averageMs,
  pushDecodeSample,
  type ScannerDiagnostics,
  type TrackSnapshot,
} from "./diagnostics";
import { getScannerFlags, resolveScannerFlags, type ScannerFlags } from "./flags";
import { FrameSource, closeGrab } from "./frame-source";
import { insetScanCrop, type ScanRect } from "./geometry";
import { NativeScanner } from "./native";

export type ScannerStatus = {
  phase: "starting" | "running" | "error";
  error: string | null;
  engine: "worker" | "main" | null;
  native: boolean;
  torchSupported: boolean;
  torchOn: boolean;
  zoom: { min: number; max: number; value: number } | null;
  /** تعداد لنزهای قابل انتخاب — دکمهٔ تغییر دوربین فقط با بیش از یکی معنی دارد. */
  cameraCount: number;
  cameraIndex: number;
  fps: number;
};

export type SessionOptions = {
  video: HTMLVideoElement;
  /** کد خوانده‌شده و پذیرفته‌شده. تنها خروجی اسکنر به بقیهٔ اپ. */
  onCode: (code: string, format: string) => void;
  onStatus: (status: ScannerStatus) => void;
  /** کادر فعلی — UI می‌تواند وسط کار عوضش کند. */
  getRect: () => ScanRect;
  isPaused: () => boolean;
  /** فلگ‌های مؤثر. نبودنش یعنی پیش‌فرض‌های محیط (برای صداکنندهٔ قدیمی و تست). */
  flags?: ScannerFlags;
};

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/** اگر این مدت هیچ فریمی نیاید، لنز بعدی را امتحان می‌کنیم. */
const FRAME_STALL_MS = 4000;

export class ScannerSession {
  private opts: SessionOptions;
  private flags: ScannerFlags;
  private decoder = new Decoder();
  private native = new NativeScanner();
  private frames = new FrameSource();
  private accept: AcceptState = initialAcceptState;
  private roiTick = 0;

  // فقط گزارش. هیچ تصمیمی در پایپ‌لاین به این سه وابسته نیست، و در حالت legacy
  // اصلاً پر نمی‌شوند تا مسیر دقیقاً همان قبل باشد.
  private decodeSamples: number[] = [];
  private lastDecodeAt: number | null = null;
  private lastDecodeFormat: string | null = null;

  private stream: MediaStream | null = null;
  private candidates: string[] = [];
  private candidateIndex = 0;

  private disposed = false;
  private frameHandle: number | null = null;
  private releaseFrame: (() => void) | null = null;
  private audio: AudioContext | null = null;
  private fpsTimer: ReturnType<typeof setInterval> | null = null;
  private frameCount = 0;
  private lastFrameAt = 0;

  private status: ScannerStatus = {
    phase: "starting",
    error: null,
    engine: null,
    native: false,
    torchSupported: false,
    torchOn: false,
    zoom: null,
    cameraCount: 0,
    cameraIndex: 0,
    fps: 0,
  };

  constructor(opts: SessionOptions) {
    this.opts = opts;
    try {
      this.flags = opts.flags ?? getScannerFlags();
    } catch {
      this.flags = resolveScannerFlags({ override: null, experimentalPreference: false });
    }
  }

  async start(): Promise<void> {
    try {
      await this.decoder.start();
      if (this.disposed) return;
      this.native.start();
      this.patch({ engine: this.decoder.mode, native: this.native.active });

      await this.openBestCamera();
      if (this.disposed) return;

      this.fpsTimer = setInterval(() => {
        this.patch({ fps: this.frameCount });
        this.frameCount = 0;
      }, 1000);

      this.patch({ phase: "running" });
      await this.loop();
    } catch (err) {
      if (this.disposed) return;
      this.patch({
        phase: "error",
        error: err instanceof Error ? err.message : "خطای نامشخص دوربین",
      });
    }
  }

  /* ------------------------------------------------------------- دوربین */

  /**
   * مجوز می‌گیرد، لنزها را رتبه‌بندی می‌کند و اولین کاندیدایی را نگه می‌دارد که
   * **واقعاً فریم می‌دهد**. باز شدن استریم تنهایی کافی نیست.
   */
  private async openBestCamera(): Promise<void> {
    const primed = await primeCameraPermission();
    if (this.disposed) {
      stopStream(primed);
      return;
    }

    this.candidates = await listRearCameras();
    this.patch({ cameraCount: this.candidates.length });

    const primedId = primed.getVideoTracks()[0]?.getSettings?.().deviceId;
    const reuse = !isFrontStream(primed) && shouldReusePrimedCamera(primedId, this.candidates);

    if (reuse) {
      if (await this.adopt(primed, 0)) return;
    } else {
      stopStream(primed);
    }

    for (let i = 0; i < this.candidates.length; i++) {
      if (this.disposed) return;
      const stream = await openByDeviceId(this.candidates[i]);
      if (!stream) continue;
      if (await this.adopt(stream, i)) return;
    }

    // آخرین تیر: هر دوربینی که باز شود، حتی دوربین جلو — بهتر از صفحهٔ سیاه.
    const last = await primeCameraPermission();
    if (await this.adopt(last, 0)) return;
    stopStream(last);
    throw new Error("دوربین تصویری نمی‌دهد");
  }

  /** استریم را می‌پذیرد فقط اگر فریم بدهد؛ وگرنه خودش می‌بنددش. */
  private async adopt(stream: MediaStream, index: number): Promise<boolean> {
    const alive = await attachAndVerify(this.opts.video, stream);
    if (this.disposed) {
      stopStream(stream);
      return false;
    }
    if (!alive) {
      stopStream(stream);
      return false;
    }

    stopStream(this.stream);
    this.stream = stream;
    this.candidateIndex = index;
    this.lastFrameAt = Date.now();

    const track = stream.getVideoTracks()[0];
    const appliedZoom = await applyPreferredSettings(track);
    if (this.disposed) return true;

    const caps = readCapabilities(track);
    this.patch({
      cameraIndex: index,
      torchSupported: caps.torch,
      torchOn: false,
      zoom: zoomStatus(caps.zoom, appliedZoom),
    });
    return true;
  }

  /** لنز بعدی. راه فرار کاربر وقتی رتبه‌بندی، لنز اشتباهی را انتخاب کرده. */
  async cycleCamera(): Promise<void> {
    if (this.disposed || this.candidates.length < 2) return;
    for (let step = 1; step <= this.candidates.length; step++) {
      const next = (this.candidateIndex + step) % this.candidates.length;
      const stream = await openByDeviceId(this.candidates[next]);
      if (!stream) continue;
      if (await this.adopt(stream, next)) return;
    }
  }

  /* --------------------------------------------------------- حلقهٔ فریم */

  private async loop(): Promise<void> {
    const video = this.opts.video;
    while (!this.disposed) {
      await this.nextFrame(video);
      if (this.disposed) break;
      try {
        await this.scanOnce(video);
      } catch {
        // هیچ خطای یک فریم نباید حلقه را بکشد؛ پیش‌نمایش باید زنده بماند.
      }
    }
  }

  private nextFrame(video: HTMLVideoElement): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        this.frameHandle = null;
        this.releaseFrame = null;
        resolve();
      };
      this.releaseFrame = done;
      if (this.disposed) {
        done();
        return;
      }
      const v = video as RVFCVideo;
      if (typeof v.requestVideoFrameCallback === "function") {
        this.frameHandle = v.requestVideoFrameCallback(done);
      } else {
        // بدون rVFC، rAF نزدیک‌ترین چیز به نرخ نمایش است.
        this.frameHandle = requestAnimationFrame(done);
      }
    });
  }

  private async scanOnce(video: HTMLVideoElement): Promise<void> {
    if (this.opts.isPaused()) return;

    if (video.readyState < 2 || !video.videoWidth) {
      await this.handleStall();
      return;
    }
    this.lastFrameAt = Date.now();
    this.frameCount++;

    // Native روی خودِ ویدیو؛ منتظرش نمی‌مانیم تا آویزان شدنش ZXing را نکشد.
    if (this.native.active) {
      this.native.kick(video, (hit) => this.handleHit(hit.text, hit.format));
    }

    if (this.status.native !== this.native.active) {
      this.patch({ native: this.native.active });
    }

    this.roiTick += 1;
    const rect =
      this.roiTick % 2 === 1 ? insetScanCrop(this.opts.getRect(), 0.62) : this.opts.getRect();

    const grab = await this.frames.grab(video, rect, this.decoder.acceptsBitmap);
    if (!grab) return;
    if (this.disposed || this.opts.isPaused()) {
      closeGrab(grab);
      return;
    }

    const startedAt = this.flags.legacy ? 0 : Date.now();
    const hit = await this.decoder.decode(grab);
    if (!this.flags.legacy) {
      try {
        this.decodeSamples = pushDecodeSample(this.decodeSamples, Date.now() - startedAt);
      } catch {
        /* گزارش نباید دیکود را بکشد */
      }
    }
    if (!hit || this.disposed || this.opts.isPaused()) return;
    this.handleHit(hit.text, hit.format);
  }

  private handleHit(text: string, format: string): void {
    if (this.disposed || this.opts.isPaused()) return;
    if (!this.flags.legacy) {
      try {
        // «آخرین خوانش موفق» یعنی موتور چیزی دید، حتی اگر دروازهٔ پذیرش آن را
        // به‌عنوان تکرار رد کند — برای عیب‌یابی همین عدد مهم است.
        this.lastDecodeAt = Date.now();
        this.lastDecodeFormat = format || null;
      } catch {
        /* گزارش نباید پذیرش را بکشد */
      }
    }
    const decision = acceptScan(this.accept, text, format, Date.now());
    this.accept = decision.state;
    if (!decision.emit) return;
    this.signalSuccess();
    this.opts.onCode(decision.emit, format);
  }

  /** فریم نمی‌آید: دوربین را دیگری گرفته یا این لنز مرده. لنز بعدی را امتحان کن. */
  private async handleStall(): Promise<void> {
    if (this.lastFrameAt === 0) this.lastFrameAt = Date.now();
    if (Date.now() - this.lastFrameAt < FRAME_STALL_MS) return;
    this.lastFrameAt = Date.now();
    if (this.candidates.length > 1) await this.cycleCamera();
  }

  /* ----------------------------------------------------- کنترل‌های تراک */

  private track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  async toggleTorch(): Promise<void> {
    const track = this.track();
    if (!track) return;
    const next = !this.status.torchOn;
    const ok = await applyAdvanced(track, { torch: next });
    this.patch(ok ? { torchOn: next } : { torchSupported: false });
  }

  async setZoom(value: number): Promise<void> {
    const track = this.track();
    const zoom = this.status.zoom;
    if (!track || !zoom) return;
    const clamped = Math.min(zoom.max, Math.max(zoom.min, value));
    if (await applyAdvanced(track, { zoom: clamped })) {
      this.patch({ zoom: { ...zoom, value: clamped } });
    }
  }

  /** فوکوس دستی: یک single-shot و برگشت به پیوسته. */
  async refocus(): Promise<void> {
    const track = this.track();
    if (!track) return;
    if (!(await applyAdvanced(track, { focusMode: "single-shot" }))) return;
    await new Promise((r) => setTimeout(r, 120));
    if (this.disposed) return;
    await applyAdvanced(track, { focusMode: "continuous" });
  }

  /** ضربه روی پیش‌نمایش: فوکوس و نوردهی روی همان نقطه. */
  async focusAt(x: number, y: number): Promise<void> {
    const track = this.track();
    if (!track) return;
    const ok = await applyAdvanced(track, {
      pointsOfInterest: [{ x, y }],
      focusMode: "single-shot",
      exposureMode: "single-shot",
    });
    if (!ok || this.disposed) return;
    await new Promise((r) => setTimeout(r, 300));
    if (this.disposed) return;
    await applyAdvanced(track, { focusMode: "continuous", exposureMode: "continuous" });
  }

  /* ------------------------------------------------------------- تشخیص */

  /**
   * عکس لحظه‌ای برای پنل تشخیصی. هر خواندنی از تراک/ویدیو پشت try/catch است:
   * این متد از UI صدا زده می‌شود و یک استثنا نباید صفحه را پایین بیاورد.
   */
  getDiagnostics(): ScannerDiagnostics {
    try {
      const frames = this.frameStats();
      return {
        phase: this.status.phase,
        error: this.status.error,
        engine: this.status.engine,
        nativeActive: this.status.native,
        barcodeDetectorPresent: barcodeDetectorPresent(),
        videoWidth: safeNumber(() => this.opts.video.videoWidth),
        videoHeight: safeNumber(() => this.opts.video.videoHeight),
        track: this.trackSnapshot(),
        framePath: frames.path,
        blankFrames: frames.blankFrames,
        decodeSamples: this.decodeSamples.length,
        avgDecodeMs: averageMs(this.decodeSamples),
        fps: this.status.fps,
        msSinceLastDecode: this.lastDecodeAt == null ? null : Date.now() - this.lastDecodeAt,
        lastDecodeFormat: this.lastDecodeFormat,
        // مرحلهٔ ۰ حالت نجات ندارد؛ فیلد هست تا شکل گزارش بین مرحله‌ها عوض نشود.
        rescue: "off",
        cameraCount: this.status.cameraCount,
        cameraIndex: this.status.cameraIndex,
        flags: this.flags,
      };
    } catch {
      return emptyDiagnostics(this.flags);
    }
  }

  private frameStats(): { path: ScannerDiagnostics["framePath"]; blankFrames: number } {
    try {
      const s = this.frames.stats();
      return { path: s.path, blankFrames: s.blankFrames };
    } catch {
      return { path: "none", blankFrames: 0 };
    }
  }

  private trackSnapshot(): TrackSnapshot | null {
    const track = this.track();
    if (!track) return null;
    let settings: Record<string, unknown> = {};
    try {
      settings = (track.getSettings?.() ?? {}) as Record<string, unknown>;
    } catch {
      /* بعضی WebViewها getSettings را روی تراک بسته throw می‌کنند. */
    }
    const numberOf = (key: string): number | null => {
      const v = settings[key];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const stringOf = (key: string): string | null => {
      const v = settings[key];
      return typeof v === "string" && v ? v : null;
    };
    return {
      label: safeString(() => track.label),
      width: numberOf("width"),
      height: numberOf("height"),
      frameRate: numberOf("frameRate"),
      zoom: numberOf("zoom"),
      focusMode: stringOf("focusMode"),
      facingMode: stringOf("facingMode"),
    };
  }

  /* ------------------------------------------------------ بازخورد و پاک‌سازی */

  private signalSuccess(): void {
    try {
      navigator.vibrate?.(35);
    } catch {
      /* پشتیبانی نمی‌شود */
    }
    this.beep();
  }

  private beep(): void {
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      if (!this.audio) this.audio = new Ctor();
      const ctx = this.audio;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 1180;
      const t0 = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    } catch {
      /* صدا اختیاری است */
    }
  }

  private patch(next: Partial<ScannerStatus>): void {
    if (this.disposed) return;
    this.status = { ...this.status, ...next };
    this.opts.onStatus(this.status);
  }

  /** تنها راه آزادسازی منابع اسکنر. بعد از این، شیء دیگر استفاده نمی‌شود. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const video = this.opts.video as RVFCVideo;
    if (this.frameHandle != null) {
      try {
        if (typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(this.frameHandle);
        } else {
          cancelAnimationFrame(this.frameHandle);
        }
      } catch {
        /* هندل از قبل مصرف شده */
      }
      this.frameHandle = null;
    }
    // حلقه ممکن است روی nextFrame منتظر باشد؛ آزادش کن تا while خارج شود.
    this.releaseFrame?.();
    this.releaseFrame = null;

    if (this.fpsTimer) {
      clearInterval(this.fpsTimer);
      this.fpsTimer = null;
    }

    this.decoder.dispose();
    this.native.dispose();
    this.frames.dispose();

    stopStream(this.stream);
    this.stream = null;
    try {
      this.opts.video.srcObject = null;
    } catch {
      /* ignore */
    }

    const audio = this.audio;
    this.audio = null;
    if (audio) void audio.close().catch(() => {});
  }
}

function emptyDiagnostics(flags: ScannerFlags): ScannerDiagnostics {
  return {
    phase: "error",
    error: null,
    engine: null,
    nativeActive: false,
    barcodeDetectorPresent: false,
    videoWidth: 0,
    videoHeight: 0,
    track: null,
    framePath: "none",
    blankFrames: 0,
    decodeSamples: 0,
    avgDecodeMs: 0,
    fps: 0,
    msSinceLastDecode: null,
    lastDecodeFormat: null,
    rescue: "off",
    cameraCount: 0,
    cameraIndex: 0,
    flags,
  };
}

function barcodeDetectorPresent(): boolean {
  try {
    return typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector === "function";
  } catch {
    return false;
  }
}

function safeNumber(read: () => number): number {
  try {
    const v = read();
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function safeString(read: () => string | undefined): string {
  try {
    return read() ?? "";
  } catch {
    return "";
  }
}

function zoomStatus(
  zoom: { min: number; max: number } | null,
  applied: number | null,
): { min: number; max: number; value: number } | null {
  if (!zoom) return null;
  const value = applied ?? Math.min(zoom.max, Math.max(zoom.min, 1));
  return { ...zoom, value };
}
