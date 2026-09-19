/**
 * DiagnosticsPanel.tsx — پنل مخفی عیب‌یابی (۵ ضربهٔ پشت‌سرهم روی برچسب موتور).
 *
 * چرا لازم است: «دوربین روشن است ولی بارکد خوانده نمی‌شود» از راه دور قابل
 * تشخیص نیست. این پنل همان چند عددی را نشان می‌دهد که فرق گوشی سالم و ناسالم
 * را معلوم می‌کند — موتور فعال، اندازهٔ واقعی فریم، سیاه بودن کپی فریم، و زمان
 * دیکود — و یک دکمهٔ «کپی گزارش» دارد تا کاربر همان را برای پشتیبانی بفرستد.
 *
 * فقط می‌خوانَد. تنها نوشتنش کلید «حالت آزمایشی» است که در `flags.ts` و پشت
 * try/catch انجام می‌شود. تایمر تازه‌سازی فقط تا وقتی پنل باز است زنده می‌ماند.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import { describeUserAgent, formatDiagnosticsReport, type ScannerDiagnostics } from "./diagnostics";

/** کندتر از این، عددها مرده به نظر می‌رسند؛ تندتر از این، بی‌خود باتری می‌سوزاند. */
const REFRESH_MS = 700;

export type DiagnosticsPanelProps = {
  getDiagnostics: () => ScannerDiagnostics | null;
  experimental: boolean;
  onExperimentalChange: (on: boolean) => void;
  onClose: () => void;
};

export function ScannerDiagnosticsPanel({
  getDiagnostics,
  experimental,
  onExperimentalChange,
  onClose,
}: DiagnosticsPanelProps) {
  const [snapshot, setSnapshot] = useState<ScannerDiagnostics | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readRef = useRef(getDiagnostics);
  readRef.current = getDiagnostics;

  useEffect(() => {
    const tick = () => {
      try {
        setSnapshot(readRef.current());
      } catch {
        // یک خواندن خراب نباید پنل را از کار بیندازد.
      }
    };
    tick();
    const timer = setInterval(tick, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const report = snapshot ? formatDiagnosticsReport(snapshot, reportMeta()) : "";

  const onCopy = useCallback(async () => {
    const ok = await copyText(report);
    setCopied(ok ? "ok" : "fail");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied("idle"), 2000);
  }, [report]);

  return (
    <div
      dir="rtl"
      className="absolute inset-0 z-20 overflow-y-auto bg-black/92 px-3 py-2 text-white"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-white/90">اطلاعات فنی اسکنر</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن اطلاعات فنی"
          className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white active:bg-white/20"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!snapshot ? (
        <div className="text-[10px] text-white/60">هنوز اطلاعاتی نیست…</div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px] leading-4">
          {rows(snapshot).map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </dl>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onCopy()}
          disabled={!report}
          className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-[10px] text-white active:bg-white/25 disabled:opacity-40"
        >
          <Copy className="h-3 w-3" />
          کپی گزارش
        </button>
        {copied === "ok" && <span className="text-[10px] text-green-400">کپی شد</span>}
        {copied === "fail" && (
          <span className="text-[10px] text-amber-400">کپی نشد؛ متن پایین را دستی انتخاب کنید</span>
        )}
      </div>

      <label className="mt-2 flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5">
        <input
          type="checkbox"
          checked={experimental}
          onChange={(e) => onExperimentalChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-violet-500"
        />
        <span className="text-[10px] text-white/85">حالت آزمایشی (مرحله ۲)</span>
      </label>
      <div className="mt-1 text-[9px] leading-4 text-white/50">
        این گزینه فقط ذخیره می‌شود و از دفعهٔ بعدِ باز کردن صفحهٔ اسکن اثر می‌گذارد. برای برگشت کامل
        به حالت قبل، صفحه را با <span dir="ltr">?scanner=legacy</span> باز کنید.
      </div>

      <textarea
        readOnly
        dir="ltr"
        value={report}
        aria-label="متن گزارش"
        className="mt-2 h-28 w-full resize-none rounded-lg bg-black/60 p-2 text-[9px] leading-4 text-white/80"
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="whitespace-nowrap text-white/50">{label}</dt>
      <dd dir="ltr" className="break-all text-right text-white/90">
        {value}
      </dd>
    </>
  );
}

function rows(d: ScannerDiagnostics): Array<[string, string]> {
  const ua = describeUserAgent(typeof navigator === "undefined" ? "" : navigator.userAgent);
  const t = d.track;
  return [
    ["وضعیت", d.error ? `${d.phase} — ${d.error}` : d.phase],
    ["موتور", `${d.engine ?? "-"} | native=${d.nativeActive ? "on" : "off"}`],
    ["BarcodeDetector", d.barcodeDetectorPresent ? "هست" : "نیست"],
    ["ویدیو", `${d.videoWidth}×${d.videoHeight}`],
    ["لنز", t?.label || "-"],
    ["تنظیمات تراک", t ? `${nz(t.width)}×${nz(t.height)} @ ${nz(t.frameRate)}fps` : "-"],
    ["زوم / فوکوس", t ? `${nz(t.zoom)} / ${t.focusMode ?? "-"}` : "-"],
    ["مسیر فریم", d.framePath],
    ["فریم سیاه", String(d.blankFrames)],
    ["میانگین دیکود", `${d.avgDecodeMs} ms (${d.decodeSamples})`],
    ["نرخ حلقه", `${d.fps} fps`],
    [
      "آخرین خوانش",
      d.msSinceLastDecode == null
        ? "هیچ‌وقت"
        : `${(d.msSinceLastDecode / 1000).toFixed(1)}s ${d.lastDecodeFormat ?? ""}`.trim(),
    ],
    ["حالت نجات", d.rescue],
    ["دوربین", d.cameraCount === 0 ? "-" : `${d.cameraIndex + 1}/${d.cameraCount}`],
    [
      "مرورگر",
      `${ua.browser || "-"} ${ua.version} ${ua.webView ? "(WebView)" : ""} android ${
        ua.android || "-"
      }`.trim(),
    ],
    [
      "فلگ‌ها",
      `legacy=${b(d.flags.legacy)} photo=${b(d.flags.photoFallback)} rescue=${b(
        d.flags.rescueMode,
      )} exp=${b(d.flags.experimental)}`,
    ],
  ];
}

function nz(v: number | null): string {
  return v == null ? "-" : String(Math.round(v * 100) / 100);
}

function b(v: boolean): string {
  return v ? "1" : "0";
}

function reportMeta(): { userAgent: string; nowIso: string; href?: string } {
  let href: string | undefined;
  try {
    href = typeof window === "undefined" ? undefined : window.location.href;
  } catch {
    href = undefined;
  }
  return {
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    nowIso: new Date().toISOString(),
    href,
  };
}

/**
 * `navigator.clipboard` داخل WebView و روی HTTP در دسترس نیست. پشتیبانِ
 * `execCommand` منسوخ است ولی همان‌جا کار می‌کند؛ اگر هر دو شکست بخورند، متن
 * گزارش در textarea پایین پنل هست و کاربر دستی انتخابش می‌کند.
 */
async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* اجازه داده نشد — پشتیبان را امتحان کن. */
  }
  let area: HTMLTextAreaElement | null = null;
  try {
    area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    if (area?.parentNode) area.parentNode.removeChild(area);
  }
}
