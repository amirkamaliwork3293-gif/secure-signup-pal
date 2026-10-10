/**
 * engine.ts — قلب اسکنر. چرخهٔ عمر کامل در یک کلاس با یک `dispose()`.
 *
 *            ┌─────────── هر فریم تازهٔ دوربین (requestVideoFrameCallback) ───────────┐
 *            │                                                                        │
 *   BarcodeDetector بومی ← کل فریم مستقیم از پایپ‌لاین دوربین (اگر دستگاه دارد)        │
 *   zxing در Worker      ← یک برش از چرخهٔ پاس‌ها: focus → wide → focus → micro        │
 *            │                                                                        │
 *            └────────► Consensus (دقت + ضدتکرار) ──► بیپ/لرزش ──► onDetected(code) ◄─┘
 *
 * اصول:
 *   - هر موتور حداکثر یک کار در پرواز دارد؛ فریم‌ها صف نمی‌شوند (تأخیر ثابت و کم).
 *   - موتورها هم‌زمان با باز شدن دوربین گرم می‌شوند، نه بعد از آن.
 *   - وقتی صفحه پنهان می‌شود دوربین آزاد می‌شود و با برگشت دوباره باز می‌شود.
 *   - اسکنر هیچ عارضهٔ جانبی روی داده ندارد؛ تنها خروجی‌اش صدا زدن onDetected است.
 */
import {
  CameraError,
  currentZoom,
  focusAt,
  openCamera,
  setTorch,
  setZoom,
  stopStream,
  type CameraErrorKind,
  type CameraHandle,
  type ZoomRange,
} from "./camera";
import { Consensus, type Reading } from "./consensus";
import { NativeEngine } from "./engines/native";
import { ZxingClient } from "./engines/zxing-client";
import { Feedback } from "./feedback";
import { FrameGrabber } from "./frame-grabber";
import {
  insideAimZone,
  outputPointToVideo,
  PASS_CYCLE,
  planCrop,
  videoPointToView,
  type Point,
  type Size,
} from "./geometry";
import type { CanonicalFormat } from "./formats";
import { rankRearLenses, zoomSteps, type LensInfo } from "./lens";
import { rememberLens, setSoundEnabled, soundEnabled } from "./prefs";

export type ScannerPhase = "starting" | "running" | "error";

export type ScannerSnapshot = {
  phase: ScannerPhase;
  error: CameraErrorKind | null;
  paused: boolean;
  torch: { supported: boolean; on: boolean };
  zoom: { range: ZoomRange; value: number; steps: number[] } | null;
  lenses: LensInfo[];
  lensId: string | null;
  engines: { native: boolean; zxing: "worker" | "main" | "none" };
  sound: boolean;
  /** آخرین بارکد دیده‌شده؛ برای کشیدن کادر ردیابی روی تصویر. گوشه‌ها کسری از نما (۰ تا ۱). */
  track: { corners: Point[]; at: number; accepted: boolean } | null;
  /** آخرین کد پذیرفته‌شده؛ برای نمایش کوتاه روی تصویر. */
  last: { code: string; format: CanonicalFormat; at: number } | null;
  imageBusy: boolean;
};

type Listener = () => void;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class ScanEngine {
  private snapshot: ScannerSnapshot = {
    phase: "starting",
    error: null,
    paused: false,
    torch: { supported: false, on: false },
    zoom: null,
    lenses: [],
    lensId: null,
    engines: { native: false, zxing: "none" },
    sound: soundEnabled(),
    track: null,
    last: null,
    imageBusy: false,
  };
  private listeners = new Set<Listener>();

  private video: HTMLVideoElement | null = null;
  private view: HTMLElement | null = null;
  private camera: CameraHandle | null = null;
  private grabber: FrameGrabber | null = null;
  private zxing = new ZxingClient();
  private native: NativeEngine | null = null;
  private consensus = new Consensus();
  private feedback = new Feedback(() => this.snapshot.sound);

  private disposed = false;
  private generation = 0;
  private loopHandle: number | null = null;
  private loopKind: "vfc" | "raf" | null = null;
  private zxingBusy = false;
  private passIndex = 0;
  private lensRemembered = false;
  private hiddenRelease = false;
  private endedRetries = 0;
  private viewSize: Size = { width: 0, height: 0 };
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly onAccept: (code: string, format: CanonicalFormat) => void) {}

  // ───────────── اشتراک برای React (useSyncExternalStore) ─────────────

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ScannerSnapshot => this.snapshot;

  private patch(next: Partial<ScannerSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of this.listeners) l();
  }

  // ───────────── چرخهٔ عمر ─────────────

  /** المان ویدیو و ظرف نما را وصل و دوربین را روشن می‌کند. */
  start(video: HTMLVideoElement, view: HTMLElement): void {
    if (this.disposed) return;
    this.video = video;
    this.view = view;
    this.measureView();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.measureView());
      this.resizeObserver.observe(view);
    }
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);

    // موتورها موازی با دوربین گرم می‌شوند.
    void this.zxing
      .start()
      .then(() => this.patch({ engines: { ...this.snapshot.engines, zxing: this.zxing.mode } }));
    void NativeEngine.create().then((engine) => {
      if (this.disposed) return engine?.dispose();
      this.native = engine;
      this.patch({ engines: { ...this.snapshot.engines, native: engine !== null } });
    });

    void this.openCamera();
  }

  dispose(): void {
    if (this.disposed) return;
    this.generation++;
    this.stopLoop();
    this.releaseCamera();
    this.disposed = true;
    this.listeners.clear();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.onVisibility);
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onPageHide);
      window.removeEventListener("pageshow", this.onPageShow);
    }
    this.zxing.dispose();
    this.native?.dispose();
    this.native = null;
    this.feedback.dispose();
    this.video = null;
    this.view = null;
  }

  private measureView(): void {
    const el = this.view;
    if (!el) return;
    this.viewSize = { width: el.clientWidth, height: el.clientHeight };
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      // شامل حالتی که دوربین هنوز در حال باز شدن است: افزایش generation آن را لغو می‌کند.
      if (this.camera || this.snapshot.phase === "starting") {
        this.hiddenRelease = true;
        this.generation++;
        this.stopLoop();
        this.releaseCamera();
      }
    } else if (this.hiddenRelease) {
      this.hiddenRelease = false;
      void this.openCamera();
    } else if (this.snapshot.phase === "error" && this.snapshot.error === "busy") {
      // کاربر برنامهٔ دیگری که دوربین را گرفته بود بست و برگشت.
      void this.openCamera();
    }
  };

  private onPageHide = (): void => {
    this.generation++;
    this.stopLoop();
    this.releaseCamera();
    this.hiddenRelease = true;
  };

  /** برگشت از bfcache مرورگر. */
  private onPageShow = (e: PageTransitionEvent): void => {
    if (e.persisted && this.hiddenRelease && !document.hidden) {
      this.hiddenRelease = false;
      void this.openCamera();
    }
  };

  private releaseCamera(): void {
    const cam = this.camera;
    this.camera = null;
    if (cam) {
      cam.track.removeEventListener("ended", this.onTrackEnded);
      stopStream(cam.stream);
    }
    this.grabber?.dispose();
    this.grabber = null;
    if (this.video) {
      try {
        this.video.pause();
      } catch {
        /* ignore */
      }
      this.video.srcObject = null;
    }
  }

  /** دوربین را (دوباره) باز می‌کند. `deviceId` برای انتخاب لنز توسط کاربر. */
  async openCamera(deviceId?: string): Promise<void> {
    if (this.disposed || !this.video) return;
    const gen = ++this.generation;
    this.stopLoop();
    this.releaseCamera();
    this.patch({
      phase: "starting",
      error: null,
      track: null,
      torch: { supported: false, on: false },
    });

    let cam: CameraHandle;
    try {
      cam = await openCamera({
        deviceId,
        isCancelled: () => this.disposed || gen !== this.generation,
      });
    } catch (err) {
      if (this.disposed || gen !== this.generation) return;
      const kind = err instanceof CameraError ? err.kind : "unknown";
      this.patch({ phase: "error", error: kind });
      return;
    }
    if (this.disposed || gen !== this.generation || !this.video) {
      stopStream(cam.stream);
      return;
    }

    this.camera = cam;
    this.grabber = new FrameGrabber(cam.track);
    this.consensus.reset();
    this.lensRemembered = false;
    cam.track.addEventListener("ended", this.onTrackEnded);

    const video = this.video;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.srcObject = cam.stream;
    try {
      await video.play();
    } catch {
      // autoplay ممکن است با AbortError رد شود ولی ویدیو بعداً پخش می‌شود (autoPlay روی المان).
    }
    if (this.disposed || gen !== this.generation) return;

    const z = cam.zoom ? (currentZoom(cam.track) ?? cam.zoom.min) : null;
    this.patch({
      phase: "running",
      error: null,
      torch: { supported: cam.torchSupported, on: false },
      zoom:
        cam.zoom && z !== null ? { range: cam.zoom, value: z, steps: zoomSteps(cam.zoom) } : null,
      lenses: rankRearLenses(cam.lenses),
      lensId: cam.deviceId,
    });
    this.startLoop();
  }

  private onTrackEnded = (): void => {
    // دوربین را برنامهٔ دیگری گرفت یا سیستم قطع کرد؛ حداکثر دو بار تلاش خودکار،
    // بعد پیام خطا با دکمهٔ «تلاش دوباره» (بدون حلقهٔ بی‌پایان).
    if (this.disposed || (typeof document !== "undefined" && document.hidden)) return;
    const gen = this.generation;
    if (this.endedRetries >= 2) {
      this.generation++;
      this.stopLoop();
      this.releaseCamera();
      this.patch({ phase: "error", error: "busy", track: null });
      return;
    }
    this.endedRetries++;
    setTimeout(() => {
      if (!this.disposed && gen === this.generation) void this.openCamera();
    }, 400);
  };

  // ───────────── حلقهٔ فریم ─────────────

  private startLoop(): void {
    this.stopLoop();
    const video = this.video;
    if (!video) return;
    const gen = this.generation;
    const hasVfc =
      typeof (video as HTMLVideoElement & { requestVideoFrameCallback?: unknown })
        .requestVideoFrameCallback === "function";

    const step = () => {
      if (this.disposed || gen !== this.generation) return;
      this.schedule(step, hasVfc);
      this.tick();
    };
    this.schedule(step, hasVfc);
  }

  private schedule(fn: () => void, vfc: boolean): void {
    const video = this.video;
    if (!video) return;
    if (vfc) {
      this.loopKind = "vfc";
      this.loopHandle = video.requestVideoFrameCallback(() => fn());
    } else {
      this.loopKind = "raf";
      this.loopHandle = requestAnimationFrame(() => fn());
    }
  }

  private stopLoop(): void {
    if (this.loopHandle === null) return;
    try {
      if (this.loopKind === "vfc") this.video?.cancelVideoFrameCallback(this.loopHandle);
      else cancelAnimationFrame(this.loopHandle);
    } catch {
      /* ignore */
    }
    this.loopHandle = null;
    this.loopKind = null;
  }

  private tick(): void {
    const video = this.video;
    if (!video || !this.camera || this.snapshot.paused || this.snapshot.imageBusy) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;
    const gen = this.generation;

    const native = this.native;
    if (native?.available) {
      void native.detect(video).then((hit) => {
        if (!hit || gen !== this.generation) return;
        this.handle({ text: hit.text, format: hit.format, source: "native" }, hit.corners);
      });
    }

    if (!this.zxingBusy && this.zxing.mode !== "none" && this.grabber) {
      this.zxingBusy = true;
      void this.runZxing(video, gen).finally(() => {
        this.zxingBusy = false;
      });
    }
  }

  private async runZxing(video: HTMLVideoElement, gen: number): Promise<void> {
    const grabber = this.grabber;
    if (!grabber) return;
    const pass = PASS_CYCLE[this.passIndex++ % PASS_CYCLE.length];
    const plan = planCrop(
      pass,
      { width: video.videoWidth, height: video.videoHeight },
      this.viewSize,
      this.zxing.mode === "main",
    );
    if (!plan) return;
    const px = await grabber.grab(video, plan);
    if (!px || gen !== this.generation) return;
    const hit = await this.zxing.decode(px, plan.mode);
    if (!hit || gen !== this.generation) return;
    const corners = hit.corners.map((p) => outputPointToVideo(p, plan));
    this.handle(
      { text: hit.text, format: hit.format, source: "zxing", lineCount: hit.lineCount },
      corners,
    );
  }

  /** هر خوانش خام از هر موتور از اینجا می‌گذرد. */
  private handle(reading: Reading, cornersInVideo: Point[]): void {
    if (this.disposed || this.snapshot.paused) return;
    const video = this.video;
    const corners =
      video && cornersInVideo.length >= 2
        ? cornersInVideo.map((p) =>
            videoPointToView(
              p,
              { width: video.videoWidth, height: video.videoHeight },
              this.viewSize,
            ),
          )
        : [];
    if (!insideAimZone(corners)) return;

    const t = now();
    const verdict = this.consensus.offer(reading, t);
    if (verdict.kind === "reject") return;

    if (verdict.kind !== "accept") {
      // کادر ردیابی حداکثر ~۱۲ بار در ثانیه به‌روز می‌شود تا رندر اضافه نسازد.
      if (corners.length && t - (this.snapshot.track?.at ?? 0) > 80) {
        this.patch({ track: { corners, at: t, accepted: false } });
      }
      return;
    }

    this.endedRetries = 0;
    this.feedback.success();
    if (!this.lensRemembered && this.camera) {
      // این لنز ثابت کرد بارکد می‌خواند؛ دفعهٔ بعد مستقیم همین باز می‌شود.
      this.lensRemembered = true;
      rememberLens(this.camera.deviceId);
    }
    this.patch({
      track: corners.length ? { corners, at: t, accepted: true } : null,
      last: { code: verdict.code, format: verdict.format, at: t },
    });
    this.emit(verdict.code, verdict.format);
  }

  private emit(code: string, format: CanonicalFormat): void {
    try {
      this.onAccept(code, format);
    } catch (err) {
      // خطای صفحهٔ مصرف‌کننده نباید حلقهٔ اسکن را بکشد.
      console.error("[scanner] onDetected failed", err);
    }
  }

  // ───────────── کنترل‌ها ─────────────

  setPaused(paused: boolean): void {
    if (this.snapshot.paused === paused) return;
    this.patch({ paused, track: null });
  }

  /** در اولین لمس کاربر؛ صدا را برای مرورگرهای سخت‌گیر آزاد می‌کند. */
  unlockAudio(): void {
    this.feedback.unlock();
  }

  setSound(on: boolean): void {
    setSoundEnabled(on);
    this.patch({ sound: on });
    if (on) this.feedback.unlock();
  }

  async toggleTorch(): Promise<void> {
    const cam = this.camera;
    if (!cam || !cam.torchSupported) return;
    const next = !this.snapshot.torch.on;
    const ok = await setTorch(cam.track, next);
    if (ok && cam === this.camera) this.patch({ torch: { supported: true, on: next } });
  }

  async setZoom(value: number): Promise<void> {
    const cam = this.camera;
    const zoom = this.snapshot.zoom;
    if (!cam || !zoom) return;
    const v = Math.min(zoom.range.max, Math.max(zoom.range.min, value));
    const ok = await setZoom(cam.track, v);
    if (ok && cam === this.camera)
      this.patch({ zoom: { ...zoom, value: currentZoom(cam.track) ?? v } });
  }

  async focusAt(x: number, y: number): Promise<void> {
    const cam = this.camera;
    if (!cam || !cam.focusSupported) return;
    await focusAt(cam.track, Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  }

  /** لنز بعدی در فهرست رتبه‌بندی‌شده. */
  nextLens(): void {
    const lenses = this.snapshot.lenses;
    if (lenses.length < 2) return;
    const i = lenses.findIndex((l) => l.deviceId === this.snapshot.lensId);
    const next = lenses[(i + 1) % lenses.length];
    void this.openCamera(next.deviceId);
  }

  retry(): void {
    this.endedRetries = 0;
    void this.openCamera();
  }

  /** ورودی بارکدخوان سخت‌افزاری (کیبورد). */
  keyboardCode(code: string): void {
    if (this.disposed || this.snapshot.paused) return;
    const verdict = this.consensus.offer(
      { text: code, format: "unknown", source: "keyboard" },
      now(),
    );
    if (verdict.kind !== "accept") return;
    this.feedback.success();
    this.patch({ last: { code: verdict.code, format: verdict.format, at: now() } });
    this.emit(verdict.code, verdict.format);
  }

  /** اسکن یک عکس (گالری یا دوربین سیستم). true یعنی بارکد پیدا شد. */
  async scanImage(file: Blob): Promise<boolean> {
    if (this.disposed || this.snapshot.paused || this.snapshot.imageBusy) return false;
    this.patch({ imageBusy: true });
    try {
      const { decodeImageFile } = await import("./image-scan");
      const hit = await decodeImageFile(file, this.native);
      if (this.disposed) return false;
      if (!hit) {
        this.feedback.miss();
        return false;
      }
      const verdict = this.consensus.offer(
        { text: hit.text, format: hit.format, source: "image" },
        now(),
      );
      if (verdict.kind !== "accept") {
        this.feedback.miss();
        return false;
      }
      this.feedback.success();
      this.patch({ last: { code: verdict.code, format: verdict.format, at: now() } });
      this.emit(verdict.code, verdict.format);
      return true;
    } catch {
      this.feedback.miss();
      return false;
    } finally {
      this.patch({ imageBusy: false });
    }
  }
}
