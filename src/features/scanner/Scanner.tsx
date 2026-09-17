/**
 * Scanner.tsx — فقط نمایش. هیچ منطق دوربین یا دیکودی اینجا نیست.
 *
 * ظاهر عمداً همان نسخهٔ قبل است (کادر، اسلایدر اندازه، زوم، چراغ، فوکوس) تا
 * کاربر تغییری در عادتش حس نکند. تنها اضافه، دکمهٔ **تغییر لنز** است: روی
 * گوشی‌های چنددوربینه اگر رتبه‌بندی، لنز اشتباهی را انتخاب کند، کاربر خودش
 * می‌تواند عوض کند.
 */
import { useCallback, useRef, useState } from "react";
import { Flashlight, FlashlightOff, RefreshCw, SwitchCamera } from "lucide-react";
import { reticleRect } from "./geometry";
import { useScanner } from "./useScanner";

export type ScannerProps = {
  onDetected: (code: string, format?: string) => void;
  paused?: boolean;
};

export function Scanner({ onDetected, paused }: ScannerProps) {
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // پرش سبز کوتاه روی خوانش موفق. تایمر قبلی پاک می‌شود تا اسکن‌های پشت‌سرهم
  // تایمر روی هم انبار نکنند.
  const handleDetected = useCallback(
    (code: string, format?: string) => {
      setFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 220);
      onDetected(code, format);
    },
    [onDetected],
  );

  const { videoRef, status, boxScale, setBoxScale, controls } = useScanner({
    onDetected: handleDetected,
    paused,
  });

  const rect = reticleStyle(boxScale);
  const { zoom } = status;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = clamp01((e.clientX - box.left) / box.width);
    const y = clamp01((e.clientY - box.top) / box.height);
    controls.focusAt(x, y);
  };

  const stopFocus = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-card">
      <div className="relative aspect-[4/3] w-full" onPointerDown={onPointerDown}>
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />

        {/* کادر اسکن */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute" style={rect}>
            <div
              className="absolute inset-0"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
            />
            {[
              "top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg",
              "top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg",
              "bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg",
              "bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg",
            ].map((cls) => (
              <span key={cls} className={`absolute h-8 w-8 border-primary ${cls}`} />
            ))}
            <div
              className="absolute inset-x-2 top-1/2 h-[2px] -translate-y-1/2 animate-pulse bg-primary/80"
              style={{ boxShadow: "0 0 10px 3px rgba(99,102,241,0.6)" }}
            />
            <div className="absolute -bottom-6 inset-x-0 text-center text-[11px] text-white/70">
              بارکد یا QR را داخل کادر قرار دهید
            </div>
          </div>
        </div>

        {flash && <div className="pointer-events-none absolute inset-0 bg-green-400/40" />}

        {/* اندازهٔ کادر */}
        <div
          className="pointer-events-auto absolute top-2 left-2 right-2 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5"
          onPointerDown={stopFocus}
        >
          <span className="shrink-0 text-[10px] text-white/70">اندازه کادر</span>
          <input
            type="range"
            min={0.4}
            max={1.4}
            step={0.05}
            value={boxScale}
            onChange={(e) => setBoxScale(parseFloat(e.target.value))}
            aria-label="اندازه کادر اسکن"
            className="zoom-slider h-1.5 flex-1 appearance-none rounded-full"
            style={{ background: sliderTrack((boxScale - 0.4) / 1) }}
          />
          <span className="w-8 text-center text-[10px] text-white/70">
            {Math.round(boxScale * 100)}%
          </span>
        </div>

        {/* زوم دوربین */}
        {zoom && zoom.max > zoom.min && (
          <div
            className="absolute bottom-16 left-4 right-4 flex flex-col items-center gap-1"
            onPointerDown={stopFocus}
          >
            <div className="flex w-full items-center gap-2">
              <span className="w-6 text-center text-[10px] text-white/60">
                {zoom.min.toFixed(0)}×
              </span>
              <input
                type="range"
                min={zoom.min}
                max={zoom.max}
                step={0.1}
                value={zoom.value}
                onChange={(e) => controls.setZoom(parseFloat(e.target.value))}
                aria-label="زوم دوربین"
                className="zoom-slider h-1.5 flex-1 appearance-none rounded-full"
                style={{
                  background: sliderTrack((zoom.value - zoom.min) / (zoom.max - zoom.min)),
                }}
              />
              <span className="w-6 text-center text-[10px] text-white/60">
                {zoom.max.toFixed(0)}×
              </span>
            </div>
            <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white/80">
              {zoom.value.toFixed(1)}×
            </span>
          </div>
        )}

        {/* نوار پایین: وضعیت و دکمه‌ها */}
        <div
          className="absolute bottom-2 left-2 right-2 flex items-end justify-between gap-2"
          onPointerDown={stopFocus}
        >
          <div className="flex flex-col gap-0.5">
            <div className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] text-white/80">
              {engineLabel(status.engine, status.phase, status.native)}
            </div>
            <div className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] text-white/50">
              {status.fps} fps
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={controls.refocus}
              aria-label="فوکوس مجدد"
              className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white active:bg-black/80"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            {status.cameraCount > 1 && (
              <button
                type="button"
                onClick={controls.cycleCamera}
                aria-label="تغییر دوربین"
                title="اگر تصویر تار است یا بارکد خوانده نمی‌شود، لنز را عوض کنید"
                className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white active:bg-black/80"
              >
                <SwitchCamera className="h-4 w-4" />
              </button>
            )}

            {status.torchSupported && (
              <button
                type="button"
                onClick={controls.toggleTorch}
                aria-label={status.torchOn ? "خاموش کردن چراغ" : "روشن کردن چراغ"}
                className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white active:bg-black/80"
              >
                {status.torchOn ? (
                  <FlashlightOff className="h-4 w-4" />
                ) : (
                  <Flashlight className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {status.phase === "error" && (
        <div className="bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="font-semibold">دسترسی به دوربین ممکن نشد</div>
          {status.error && <div className="mt-1 text-xs opacity-75">{status.error}</div>}
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>
              • صفحه باید روی <strong>HTTPS</strong> باز شود
            </li>
            <li>• اجازه دوربین را در مرورگر یا تنظیمات اپ فعال کنید</li>
            <li>• اگر برنامهٔ دیگری دوربین را گرفته، آن را ببندید</li>
            <li>• از حالت ناشناس خارج شوید و صفحه را دوباره باز کنید</li>
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * کادر روی صفحه باید **دقیقاً** همان مستطیلی باشد که دیکود می‌شود، وگرنه کاربر
 * بارکد را جایی می‌گذارد که خوانده نمی‌شود. پس همان تابع `reticleRect` مبناست.
 */
function reticleStyle(scale: number): React.CSSProperties {
  const r = reticleRect(scale);
  return {
    left: `${r.x * 100}%`,
    right: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    bottom: `${r.y * 100}%`,
  };
}

function sliderTrack(ratio: number): string {
  const pct = Math.round(clamp01(ratio) * 100);
  return `linear-gradient(to right, rgba(139,92,246,0.9) 0%, rgba(139,92,246,0.9) ${pct}%, rgba(255,255,255,0.25) ${pct}%, rgba(255,255,255,0.25) 100%)`;
}

function engineLabel(engine: ScannerEngine, phase: string, native: boolean): string {
  if (phase === "starting") return "در حال آماده‌سازی…";
  const zxing = engine === "worker" ? "ZXing (Worker)" : engine === "main" ? "ZXing" : null;
  if (native && zxing) return `Native + ${zxing}`;
  if (native) return "Native";
  if (zxing) return zxing;
  return "—";
}

type ScannerEngine = "worker" | "main" | null;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
