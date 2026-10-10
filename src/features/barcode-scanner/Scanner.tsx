/**
 * Scanner.tsx — رابط کاربری اسکنر. هیچ منطق دوربین یا دیکودی اینجا نیست.
 *
 * قرارداد عمومی (بدون تغییر نسبت به قبل، تا صفحهٔ اسکن دست‌نخورده بماند):
 *
 *   <Scanner onDetected={(code, format?) => void} paused={boolean} />
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CameraOff,
  Check,
  Flashlight,
  FlashlightOff,
  ImageUp,
  Loader2,
  Pause,
  RefreshCw,
  SwitchCamera,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { CameraErrorKind } from "./camera";
import { formatLabel } from "./formats";
import { RETICLE } from "./geometry";
import { useBarcodeScanner } from "./useBarcodeScanner";

export type ScannerProps = {
  onDetected: (code: string, format?: string) => void;
  paused?: boolean;
};

const ERROR_TEXT: Record<CameraErrorKind, { title: string; hint: string }> = {
  denied: {
    title: "اجازهٔ دسترسی به دوربین داده نشده",
    hint: "از تنظیمات مرورگر یا برنامه، دسترسی دوربین را فعال کنید و «تلاش دوباره» را بزنید.",
  },
  "not-found": {
    title: "دوربینی روی این دستگاه پیدا نشد",
    hint: "می‌توانید از عکس یا بارکدخوان سخت‌افزاری استفاده کنید.",
  },
  busy: {
    title: "دوربین در اختیار برنامهٔ دیگری است",
    hint: "برنامه‌های دیگری که از دوربین استفاده می‌کنند را ببندید و دوباره تلاش کنید.",
  },
  insecure: {
    title: "دوربین فقط روی اتصال امن کار می‌کند",
    hint: "صفحه را با https باز کنید.",
  },
  unsupported: {
    title: "این مرورگر از دوربین پشتیبانی نمی‌کند",
    hint: "از کروم یا برنامهٔ اندروید استفاده کنید، یا بارکد را از عکس بخوانید.",
  },
  unknown: {
    title: "روشن کردن دوربین ممکن نشد",
    hint: "دوباره تلاش کنید. اگر تکرار شد، صفحه را یک بار ببندید و باز کنید.",
  },
};

const TRACK_VISIBLE_MS = 320;
const LAST_VISIBLE_MS = 1600;

export function Scanner({ onDetected, paused = false }: ScannerProps) {
  const handleDetected = useCallback(
    (code: string, format: string) => onDetected(code, format),
    [onDetected],
  );
  const {
    videoRef,
    viewRef,
    engine,
    snapshot: s,
  } = useBarcodeScanner({ onDetected: handleDetected, paused });

  const fileRef = useRef<HTMLInputElement>(null);
  const [imageMiss, setImageMiss] = useState(false);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; key: number } | null>(null);

  const trackVisible = useFreshness(s.track?.at ?? null, TRACK_VISIBLE_MS);
  const lastVisible = useFreshness(s.last?.at ?? null, LAST_VISIBLE_MS);
  const flash = useFreshness(s.last?.at ?? null, 220);

  useEffect(() => {
    if (!imageMiss) return;
    const t = setTimeout(() => setImageMiss(false), 2600);
    return () => clearTimeout(t);
  }, [imageMiss]);

  useEffect(() => {
    if (!focusRing) return;
    const t = setTimeout(() => setFocusRing(null), 700);
    return () => clearTimeout(t);
  }, [focusRing]);

  const onViewPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    engine?.unlockAudio();
    if (!e.isPrimary || s.phase !== "running") return;
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    setFocusRing({ x, y, key: Date.now() });
    void engine?.focusAt(x, y);
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !engine) return;
    setImageMiss(false);
    const found = await engine.scanImage(file);
    if (!found) setImageMiss(true);
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const accepted = s.track?.accepted ?? false;
  const polygon = s.track?.corners
    .map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`)
    .join(" ");
  const error = s.phase === "error" && s.error ? ERROR_TEXT[s.error] : null;
  const canPickImage = !paused && !s.imageBusy && engine !== null;

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-black shadow-card"
      dir="rtl"
      data-scanner-zxing={s.engines.zxing}
      data-scanner-native={s.engines.native ? "on" : "off"}
    >
      <div
        ref={viewRef}
        className="relative aspect-[4/3] w-full touch-manipulation select-none"
        onPointerDown={onViewPointerDown}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          autoPlay
          disablePictureInPicture
          aria-label="تصویر زندهٔ دوربین برای اسکن بارکد"
        />

        {/* کادر اسکن با پس‌زمینهٔ تیره در اطراف */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute rounded-xl transition-[box-shadow] duration-150"
            style={{
              left: `${RETICLE.x * 100}%`,
              top: `${RETICLE.y * 100}%`,
              width: `${RETICLE.width * 100}%`,
              height: `${RETICLE.height * 100}%`,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.42)",
            }}
          >
            {CORNERS.map((cls) => (
              <span
                key={cls}
                className={`absolute h-7 w-7 transition-colors duration-150 ${cls} ${
                  flash ? "border-emerald-400" : "border-white/90"
                }`}
              />
            ))}
            {s.phase === "running" && !paused && <div className="bcs-laser" />}
          </div>
        </div>

        {/* کادر ردیابی دور بارکد پیدا‌شده */}
        {trackVisible && polygon && !paused && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <polygon
              points={polygon}
              fill={accepted ? "rgba(52,211,153,0.22)" : "rgba(250,204,21,0.12)"}
              stroke={accepted ? "rgb(52,211,153)" : "rgb(250,204,21)"}
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {flash && <div className="pointer-events-none absolute inset-0 bg-emerald-400/25" />}

        {/* حلقهٔ فوکوس لمسی */}
        {focusRing && (
          <span
            key={focusRing.key}
            className="bcs-focus pointer-events-none absolute h-14 w-14 rounded-full border-2 border-white/90"
            style={{ left: `${focusRing.x * 100}%`, top: `${focusRing.y * 100}%` }}
          />
        )}

        {/* نوار بالا: وضعیت و صدا */}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <StatusPill phase={s.phase} paused={paused} imageBusy={s.imageBusy} />
          <button
            type="button"
            onPointerDown={stop}
            onClick={() => engine?.setSound(!s.sound)}
            className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white/90 backdrop-blur-sm active:scale-95"
            aria-label={s.sound ? "خاموش کردن صدای بیپ" : "روشن کردن صدای بیپ"}
            aria-pressed={s.sound}
          >
            {s.sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>

        {/* کد خوانده‌شده */}
        {lastVisible && s.last && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
            <div className="bcs-pop flex max-w-full items-center gap-2 rounded-full bg-emerald-500/95 px-3 py-1.5 text-white shadow-lg">
              <Check className="h-4 w-4 shrink-0" />
              <span className="truncate font-mono text-sm" dir="ltr">
                {s.last.code}
              </span>
              <span className="shrink-0 rounded-full bg-white/20 px-1.5 text-[10px]">
                {formatLabel(s.last.format)}
              </span>
            </div>
          </div>
        )}

        {!lastVisible && s.phase === "running" && !paused && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] text-white/75">
            بارکد یا QR را داخل کادر بگیرید — کوچک یا بزرگ
          </div>
        )}

        {/* حالت‌های پوششی */}
        {s.phase === "starting" && (
          <Overlay>
            <Loader2 className="h-7 w-7 animate-spin text-white/90" />
            <div className="text-sm text-white/90">در حال روشن کردن دوربین…</div>
          </Overlay>
        )}

        {paused && s.phase === "running" && (
          <Overlay subtle>
            <Pause className="h-7 w-7 text-white/90" />
            <div className="text-sm text-white/90">اسکن متوقف است</div>
          </Overlay>
        )}

        {error && (
          <Overlay>
            <CameraOff className="h-8 w-8 text-white/90" />
            <div className="px-6 text-center text-sm font-semibold text-white">{error.title}</div>
            <div className="px-6 text-center text-xs leading-5 text-white/75">{error.hint}</div>
            <button
              type="button"
              onPointerDown={stop}
              onClick={() => engine?.retry()}
              className="pointer-events-auto mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black active:scale-95"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              تلاش دوباره
            </button>
          </Overlay>
        )}
      </div>

      {/* نوار کنترل */}
      <div
        className="flex items-center gap-2 bg-neutral-950 px-2 py-2 text-white"
        onPointerDown={stop}
      >
        <ControlButton
          label={s.torch.on ? "خاموش کردن چراغ" : "روشن کردن چراغ"}
          active={s.torch.on}
          disabled={!s.torch.supported || s.phase !== "running"}
          onClick={() => void engine?.toggleTorch()}
        >
          {s.torch.on ? <Flashlight className="h-5 w-5" /> : <FlashlightOff className="h-5 w-5" />}
        </ControlButton>

        <div
          className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto"
          dir="ltr"
        >
          {s.zoom && s.phase === "running"
            ? s.zoom.steps.map((z) => {
                const active = Math.abs(s.zoom!.value - z) < 0.12;
                return (
                  <button
                    key={z}
                    type="button"
                    onClick={() => void engine?.setZoom(z)}
                    className={`h-8 min-w-10 shrink-0 rounded-full px-2 text-xs font-semibold tabular-nums transition-colors ${
                      active ? "bg-white text-black" : "bg-white/10 text-white/85 hover:bg-white/20"
                    }`}
                    aria-label={`زوم ${z} برابر`}
                    aria-pressed={active}
                  >
                    {formatZoom(z)}×
                  </button>
                );
              })
            : null}
        </div>

        {s.lenses.length > 1 && (
          <ControlButton
            label="تغییر لنز دوربین"
            disabled={s.phase === "starting"}
            onClick={() => engine?.nextLens()}
          >
            <SwitchCamera className="h-5 w-5" />
          </ControlButton>
        )}

        <ControlButton
          label="اسکن بارکد از عکس"
          disabled={!canPickImage}
          onClick={() => fileRef.current?.click()}
        >
          {s.imageBusy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ImageUp className="h-5 w-5" />
          )}
        </ControlButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPickImage(e)}
          tabIndex={-1}
        />
      </div>

      {imageMiss && (
        <div className="bg-neutral-900 px-3 py-2 text-center text-xs text-amber-300" role="status">
          بارکدی در عکس پیدا نشد. عکس واضح‌تر و نزدیک‌تری انتخاب کنید.
        </div>
      )}
    </div>
  );
}

const CORNERS = [
  "-top-px -left-px rounded-tl-xl border-t-[3px] border-l-[3px]",
  "-top-px -right-px rounded-tr-xl border-t-[3px] border-r-[3px]",
  "-bottom-px -left-px rounded-bl-xl border-b-[3px] border-l-[3px]",
  "-bottom-px -right-px rounded-br-xl border-b-[3px] border-r-[3px]",
];

function formatZoom(z: number): string {
  return Number.isInteger(z) ? String(z) : z.toFixed(1).replace(/\.0$/, "");
}

/** true تا `ms` میلی‌ثانیه بعد از هر تغییر `stamp`. */
function useFreshness(stamp: number | null, ms: number): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (stamp === null) {
      setFresh(false);
      return;
    }
    setFresh(true);
    const t = setTimeout(() => setFresh(false), ms);
    return () => clearTimeout(t);
  }, [stamp, ms]);
  return fresh;
}

function StatusPill({
  phase,
  paused,
  imageBusy,
}: {
  phase: string;
  paused: boolean;
  imageBusy: boolean;
}) {
  let dot = "bg-amber-400";
  let text = "آماده‌سازی…";
  if (imageBusy) text = "در حال خواندن عکس…";
  else if (phase === "error") {
    dot = "bg-red-500";
    text = "دوربین در دسترس نیست";
  } else if (paused) {
    dot = "bg-white/60";
    text = "متوقف";
  } else if (phase === "running") {
    dot = "bg-emerald-400 animate-pulse";
    text = "آمادهٔ اسکن";
  }
  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white/90 backdrop-blur-sm"
      role="status"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </div>
  );
}

function Overlay({ children, subtle }: { children: React.ReactNode; subtle?: boolean }) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${
        subtle ? "bg-black/45" : "bg-black/80"
      }`}
    >
      {children}
    </div>
  );
}

function ControlButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition active:scale-95 disabled:opacity-35 ${
        props.active ? "bg-amber-300 text-black" : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {props.children}
    </button>
  );
}
