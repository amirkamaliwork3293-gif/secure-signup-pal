/**
 * ‎/printer-test‎ — آزمایش چاپ مستقیم فیش روی مینی‌پرینتر فوممو (M220 و…) با بلوتوث
 *
 * صفحهٔ آزمایشی و جدا: از هیچ منو یا دکمه‌ای لینک نشده، فقط فیش نمونه چاپ می‌کند و
 * هیچ داده‌ای را نمی‌خواند یا تغییر نمی‌دهد (جز خواندن تنظیمات ظاهری فیش).
 * بلوتوث مرورگر فقط در Chrome (نه داخل اپ اندروید) در دسترس است.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Bluetooth, Printer, Receipt, Copy, Unplug } from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { settings, emptyInvoice, recalc, type Invoice } from "@/lib/store";
import { buildThermalInvoiceHTML } from "@/lib/invoice-document";
import { normalizeReceiptSettings, receiptDocument, receiptParts } from "@/lib/receipt";
import { renderReceiptCanvas } from "@/lib/receipt-raster";
import {
  bluetoothAvailable,
  buildPrintSteps,
  connectPhomemo,
  packBitmap,
  sendSteps,
  type PhomemoConnection,
  type PhomemoMedia,
  type PhomemoProtocol,
} from "@/lib/phomemo";

export const Route = createFileRoute("/printer-test")({
  head: () => ({
    meta: [{ title: "آزمایش چاپ مستقیم | KAMIX" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AuthGuard>
      <Layout>
        <PrinterTestPage />
      </Layout>
    </AuthGuard>
  ),
});

/** عرض هد چاپ (نقطه، ۸ نقطه = ۱ میلی‌متر در ۲۰۳dpi) */
const WIDTHS = [
  { dots: 576, label: "۷۲ میلی‌متر (پیشنهادی)" },
  { dots: 600, label: "۷۵ میلی‌متر" },
  { dots: 640, label: "۸۰ میلی‌متر" },
  { dots: 384, label: "۴۸ میلی‌متر" },
];

function sampleInvoice(shopName: string): Invoice {
  const names = [
    "ژل مو",
    "بوگیر",
    "شامپو ۴۰۰ میلی",
    "صابون گلنار",
    "خمیر دندان",
    "مسواک نرم",
    "دستمال کاغذی",
    "کرم دست",
    "اسپری بدن",
    "نرم‌کننده مو",
    "تیغ اصلاح",
    "پنبه ۱۰۰ گرمی",
    "لوسیون بدن",
    "ماسک صورت",
    "روغن آرگان",
  ];
  return recalc({
    ...emptyInvoice(),
    id: "test01",
    shopName,
    items: names.map((name, i) => ({
      productId: `t${i}`,
      name,
      price: 25000 + i * 13000,
      quantity: (i % 3) + 1,
    })),
    paymentMethod: "cash",
  });
}

function PrinterTestPage() {
  const [appSettings] = settings.useAll();
  const [conn, setConn] = useState<PhomemoConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [widthDots, setWidthDots] = useState(576);
  const [density, setDensity] = useState(10);
  const [speed, setSpeed] = useState(3);
  const [media, setMedia] = useState<PhomemoMedia>("continuous");
  const [safeMode, setSafeMode] = useState(false);
  const [protocol, setProtocol] = useState<PhomemoProtocol>("escpos");
  const [feedMm, setFeedMm] = useState(4);
  const [sendInit, setSendInit] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const supported = typeof window !== "undefined" && bluetoothAvailable();
  const connRef = useRef<PhomemoConnection | null>(null);
  connRef.current = conn;

  // خروج از صفحه = قطع اتصال (تا Print Master دوباره بتواند وصل شود)
  useEffect(() => () => connRef.current?.disconnect(), []);

  const addLog = (msg: string) =>
    setLog((l) => [...l.slice(-80), `${new Date().toLocaleTimeString("fa-IR")} — ${msg}`]);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      conn?.disconnect();
      const c = await connectPhomemo(addLog, {
        notifications,
        onDisconnect: () => setConn(null),
      });
      setConn(c);
      addLog(`آماده چاپ — ${c.canWriteWithoutResponse ? "ارسال سریع" : "ارسال با تأیید"}`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/cancel/i.test(m) || (e as { name?: string })?.name === "NotFoundError")
        addLog("انتخاب دستگاه لغو شد");
      else if (m === "no-bluetooth") addLog("این مرورگر بلوتوث ندارد — سایت را در Chrome باز کنید");
      else if (m === "no-writable-characteristic")
        addLog("پرینتر وصل شد ولی راه ارسال پیدا نشد (لطفاً از همین گزارش عکس بفرستید)");
      else addLog(`خطا در اتصال: ${m}`);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    conn?.disconnect();
    setConn(null);
    addLog("اتصال قطع شد");
  };

  /** HTML فیش با عرض دقیق هد چاپ، با تنظیمات ظاهری خود کاربر (قلم، پررنگ، نمایش‌ها) */
  const receiptSettingsForPrint = () => {
    const s = normalizeReceiptSettings(appSettings.receipt);
    const mm = widthDots / 8;
    return { ...s, paperMm: mm, printableMm: mm, scalePct: 100, splitA4: false };
  };

  const printHtmlDirect = async (html: string, label: string) => {
    if (!conn || busy) return;
    setBusy(true);
    setProgress(0);
    try {
      addLog(`ساخت تصویر ${label}…`);
      const canvas = await renderReceiptCanvas(html, widthDots);
      setPreviewUrl(canvas.toDataURL("image/png"));
      const ctx = canvas.getContext("2d")!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { bits, widthBytes } = packBitmap(data, canvas.width, canvas.height);
      const steps = buildPrintSteps(protocol, bits, widthBytes, canvas.height, {
        density,
        speed,
        media,
        feedDots: feedMm * 8,
        sendInit,
      });
      const bytes = steps.reduce((n, st) => n + st.bytes.length, 0);
      addLog(
        `روش ${protocol === "escpos" ? "ESC/POS" : "M110"} — تصویر ${canvas.width}×${canvas.height} نقطه (${Math.round(canvas.height / 8)} میلی‌متر) — ارسال ${bytes.toLocaleString("fa-IR")} بایت…`,
      );
      const t0 = Date.now();
      await sendSteps(
        conn,
        steps,
        safeMode
          ? { chunk: 100, delayMs: 30, withResponse: true }
          : { chunk: 128, delayMs: 20, withResponse: false },
        (sent, total) => setProgress(Math.round((sent / total) * 100)),
        addLog,
      );
      addLog(`ارسال کامل شد (${((Date.now() - t0) / 1000).toFixed(1)} ثانیه)`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      addLog(m === "disconnected" ? "اتصال پرینتر قطع شد — دوباره وصل شوید" : `خطا: ${m}`);
      if (m === "disconnected") setConn(null);
    } finally {
      setBusy(false);
    }
  };

  const printShortTest = () => {
    const s = receiptSettingsForPrint();
    const body = `
      <div class="c shop">تست چاپ کامیکس</div>
      <div class="c sub">چاپ مستقیم بدون Print Master</div>
      <hr class="b"/>
      ${receiptParts.kv("عرض", `${s.paperMm} میلی‌متر`)}
      ${receiptParts.kv("غلظت", String(density))}
      ${receiptParts.kv("ABC", "۱۲۳۴۵۶۷۸۹۰")}
      <hr/>
      <div class="c">اگر این متن کامل و خوانا است، تنظیمات درست است</div>`;
    void printHtmlDirect(receiptDocument({ title: "test", body, s }), "تست کوتاه");
  };

  const printSample = () => {
    const html = buildThermalInvoiceHTML(
      sampleInvoice(appSettings.shopName || "فروشگاه نمونه"),
      receiptSettingsForPrint(),
    );
    void printHtmlDirect(html, "فیش نمونه ۱۵ کالایی");
  };

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(log.join("\n"));
      addLog("گزارش کپی شد");
    } catch {
      /* ignore */
    }
  };

  const field = "w-full rounded-xl border border-input bg-card px-3 py-2 text-sm";

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4" dir="rtl">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Printer className="h-5 w-5 text-primary" /> آزمایش چاپ مستقیم فیش
        </h1>
        <p className="text-xs leading-6 text-muted-foreground">
          این صفحه آزمایشی است و فقط فیش نمونه چاپ می‌کند؛ به داده‌های شما دست نمی‌زند. پیش از شروع:
          برنامهٔ <b>Print Master را کامل ببندید</b> (پرینتر هم‌زمان فقط به یک برنامه وصل می‌شود)،
          پرینتر را روشن کنید و بلوتوث گوشی را روشن کنید.
        </p>
      </div>

      {!supported && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm leading-6">
          این مرورگر به بلوتوث دسترسی ندارد. لطفاً همین صفحه را در <b>Chrome</b> روی گوشی اندروید
          باز کنید (داخل اپ کامیکس کار نمی‌کند).
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-border bg-background p-3">
        <div className="text-sm font-semibold">۱. اتصال</div>
        {conn ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              وصل به <b>{conn.name}</b>
            </span>
            <button
              type="button"
              onClick={disconnect}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"
            >
              <Unplug className="h-3.5 w-3.5" /> قطع
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!supported || busy}
            onClick={() => void connect()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Bluetooth className="h-4 w-4" /> اتصال به پرینتر
          </button>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-background p-3">
        <div className="text-sm font-semibold">۲. تنظیمات</div>
        <label className="block space-y-1 text-xs">
          <span>روش ارسال (اگر یکی چاپ نکرد، دیگری را امتحان کنید)</span>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as PhomemoProtocol)}
            className={field}
          >
            <option value="escpos">روش ۱ — ESC/POS (پیشنهادی برای M220)</option>
            <option value="m110">روش ۲ — دستورهای M110</option>
          </select>
        </label>
        <label className="block space-y-1 text-xs">
          <span>عرض چاپ</span>
          <select
            value={widthDots}
            onChange={(e) => setWidthDots(Number(e.target.value))}
            className={field}
          >
            {WIDTHS.map((w) => (
              <option key={w.dots} value={w.dots}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs">
          <span>نوع کاغذ (فقط روش ۲)</span>
          <select
            value={media}
            onChange={(e) => setMedia(e.target.value as PhomemoMedia)}
            className={field}
          >
            <option value="continuous">پیوسته (رول فیش)</option>
            <option value="gap">لیبل با فاصله</option>
          </select>
        </label>
        <label className="block space-y-1 text-xs">
          <span>غلظت چاپ: {density.toLocaleString("fa-IR")} از ۱۵</span>
          <input
            type="range"
            min={1}
            max={15}
            value={density}
            onChange={(e) => setDensity(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span>سرعت چاپ: {speed.toLocaleString("fa-IR")} از ۵</span>
          <input
            type="range"
            min={1}
            max={5}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span>فاصلهٔ خالی بعد از چاپ: {feedMm.toLocaleString("fa-IR")} میلی‌متر (فقط روش ۱)</span>
          <input
            type="range"
            min={0}
            max={30}
            value={feedMm}
            onChange={(e) => setFeedMm(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          ارسال دستور شروع ESC @ (فقط روش ۱)
          <input
            type="checkbox"
            checked={sendInit}
            onChange={(e) => setSendInit(e.target.checked)}
            className="h-4 w-4"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          دریافت پاسخ پرینتر (پیش از «اتصال» تنظیم شود)
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
            className="h-4 w-4"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          حالت مطمئن (آهسته‌تر — اگر چاپ نصفه ماند یا به‌هم‌ریخت روشن کنید)
          <input
            type="checkbox"
            checked={safeMode}
            onChange={(e) => setSafeMode(e.target.checked)}
            className="h-4 w-4"
          />
        </label>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-background p-3">
        <div className="text-sm font-semibold">۳. چاپ</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!conn || busy}
            onClick={printShortTest}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-semibold disabled:opacity-50"
          >
            <Printer className="h-4 w-4" /> تست کوتاه
          </button>
          <button
            type="button"
            disabled={!conn || busy}
            onClick={printSample}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Receipt className="h-4 w-4" /> فیش نمونه ۱۵ کالایی
          </button>
        </div>
        {busy && progress > 0 && (
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
        <p className="text-[11px] leading-5 text-muted-foreground">
          اول «تست کوتاه» را بزنید. اگر درست بود «فیش نمونه» را امتحان کنید؛ باید یکسره و بدون فاصله
          چاپ شود.
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-background p-3">
        <div className="flex items-center justify-between text-sm font-semibold">
          گزارش
          <button
            type="button"
            onClick={() => void copyLog()}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-normal"
          >
            <Copy className="h-3 w-3" /> کپی
          </button>
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-[11px] leading-5">
          {log.length ? log.join("\n") : "هنوز کاری انجام نشده است."}
        </pre>
      </div>

      {previewUrl && (
        <div className="space-y-2 rounded-xl border border-border bg-background p-3">
          <div className="text-sm font-semibold">تصویری که برای پرینتر فرستاده شد</div>
          <img src={previewUrl} alt="پیش‌نمایش" className="mx-auto w-full max-w-xs border" />
        </div>
      )}
    </div>
  );
}
