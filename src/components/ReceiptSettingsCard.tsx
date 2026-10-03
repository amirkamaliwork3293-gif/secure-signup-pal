import { useMemo, useState } from "react";
import { Minus, Plus, Printer, Receipt, RotateCcw, Ruler } from "lucide-react";
import { settings, emptyInvoice, recalc, type Invoice } from "@/lib/store";
import {
  DEFAULT_RECEIPT,
  RECEIPT_PRESETS,
  buildReceiptCalibrationHTML,
  normalizeReceiptSettings,
  type ReceiptSettings,
  type ReceiptShow,
} from "@/lib/receipt";
import { buildThermalInvoiceHTML } from "@/lib/invoice-document";
import { printHtml, isAppShell, OLD_APP_MESSAGE } from "@/lib/print";

const SHOW_LABELS: [keyof ReceiptShow, string][] = [
  ["logo", "لوگو"],
  ["shopContact", "نشانی و تلفن فروشگاه"],
  ["invoiceId", "شماره فاکتور"],
  ["customer", "نام و تلفن مشتری"],
  ["customerFields", "اطلاعات تکمیلی مشتری"],
  ["notes", "توضیحات فاکتور"],
  ["itemDiscount", "تخفیف هر کالا"],
  ["amountWords", "مبلغ به حروف"],
  ["thanks", "متن پایین فیش"],
];

function sampleInvoice(shopName: string): Invoice {
  return recalc({
    ...emptyInvoice(),
    id: "sample1",
    shopName,
    items: [
      { productId: "a", name: "چای ممتاز ۵۰۰ گرمی", price: 185000, quantity: 2 },
      { productId: "b", name: "پنیر محلی", price: 240000, quantity: 1.25, unit: "کیلوگرم" },
    ],
    customer: { firstName: "مشتری", lastName: "نمونه", phone: "09120000000" },
    paymentMethod: "cash",
  });
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  const set = (n: number) => onChange(Math.round(Math.min(max, Math.max(min, n)) * 10) / 10);
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2">
      <span className="text-xs">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => set(value - step)}
          aria-label={`کم کردن ${label}`}
          className="grid h-8 w-8 place-items-center rounded-lg border border-border"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-14 text-center text-sm font-semibold tabular-nums">
          {value.toLocaleString("fa-IR")}
          {unit ? <span className="mr-0.5 text-[10px] text-muted-foreground">{unit}</span> : null}
        </span>
        <button
          type="button"
          onClick={() => set(value + step)}
          aria-label={`زیاد کردن ${label}`}
          className="grid h-8 w-8 place-items-center rounded-lg border border-border"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * تنظیم چاپ فیش برای چاپگر خود کاربر. پیش‌فرض‌ها بدون هیچ تنظیمی روی بیشتر
 * چاپگرهای ۸۰ میلی‌متری درست چاپ می‌کنند؛ «چاپ آزمایشی» خط‌کش میلی‌متری می‌دهد
 * تا عرض قابل چاپ واقعی چاپگر پیدا شود.
 */
export function ReceiptSettingsCard() {
  const [appSettings] = settings.useAll();
  const s = useMemo(() => normalizeReceiptSettings(appSettings.receipt), [appSettings.receipt]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const save = (patch: Partial<ReceiptSettings>) => {
    const next = normalizeReceiptSettings({
      ...s,
      ...patch,
      show: { ...s.show, ...(patch.show ?? {}) },
    });
    settings.save({ ...settings.get(), receipt: next });
  };

  const preset = RECEIPT_PRESETS.find((p) => p.paperMm === s.paperMm);
  const preview = useMemo(
    () => (showPreview ? buildThermalInvoiceHTML(sampleInvoice(appSettings.shopName), s) : ""),
    [showPreview, s, appSettings.shopName],
  );

  const print = async (html: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const ok = await printHtml(html, "چاپ آزمایشی فیش");
      if (!ok) setNotice(isAppShell() ? "چاپ در این نسخه اپ باز نشد." : OLD_APP_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Receipt className="h-4 w-4 text-primary" />
        چاپ فیش (چاپگر حرارتی)
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">
        پیش‌فرض برای چاپگرهای ۸۰ میلی‌متری تنظیم است. اگر فیش بریده یا کوچک چاپ می‌شود، یک «چاپ
        آزمایشی» بگیرید و عرض قابل چاپ را مطابق خط‌کش تنظیم کنید.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {RECEIPT_PRESETS.map((p) => (
          <button
            key={p.paperMm}
            type="button"
            onClick={() =>
              save({
                paperMm: p.paperMm,
                printableMm: p.printableMm,
                fontPx: p.paperMm <= 60 ? 11 : 13,
              })
            }
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              preset?.paperMm === p.paperMm
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Stepper
          label="عرض کاغذ"
          value={s.paperMm}
          step={1}
          min={40}
          max={120}
          unit="mm"
          onChange={(paperMm) => save({ paperMm, printableMm: Math.min(s.printableMm, paperMm) })}
        />
        <Stepper
          label="عرض قابل چاپ"
          value={s.printableMm}
          step={1}
          min={30}
          max={s.paperMm}
          unit="mm"
          onChange={(printableMm) => save({ printableMm })}
        />
        <Stepper
          label="فاصله از لبه‌ها"
          value={s.sideMarginMm}
          step={0.5}
          min={0}
          max={10}
          unit="mm"
          onChange={(sideMarginMm) => save({ sideMarginMm })}
        />
        <Stepper
          label="اندازهٔ قلم"
          value={s.fontPx}
          step={1}
          min={9}
          max={20}
          onChange={(fontPx) => save({ fontPx })}
        />
        <Stepper
          label="فضای خالی برای برش"
          value={s.feedMm}
          step={2}
          min={0}
          max={40}
          unit="mm"
          onChange={(feedMm) => save({ feedMm })}
        />
        <label className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs">
          همهٔ نوشته‌ها پررنگ (چاپگر کم‌رنگ)
          <input
            type="checkbox"
            checked={s.boldText}
            onChange={(e) => save({ boldText: e.target.checked })}
            className="h-4 w-4"
          />
        </label>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          روی فیش نمایش داده شود:
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {SHOW_LABELS.map(([k, label]) => (
            <label
              key={k}
              className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-[11px]"
            >
              <input
                type="checkbox"
                checked={s.show[k]}
                onChange={(e) => save({ show: { ...s.show, [k]: e.target.checked } })}
                className="h-3.5 w-3.5"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] text-muted-foreground">متن پایین فیش</span>
        <input
          value={s.footerText}
          onChange={(e) => save({ footerText: e.target.value })}
          maxLength={200}
          className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void print(buildReceiptCalibrationHTML(s, appSettings.shopName))}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Ruler className="h-4 w-4" /> چاپ آزمایشی (کالیبره)
        </button>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-xs font-semibold"
        >
          <Receipt className="h-4 w-4" /> {showPreview ? "بستن پیش‌نمایش" : "پیش‌نمایش فیش نمونه"}
        </button>
      </div>
      {showPreview && (
        <div className="space-y-2 rounded-xl bg-[#e9ebef] p-3">
          <iframe
            title="پیش‌نمایش فیش"
            srcDoc={preview}
            className="mx-auto block bg-white shadow-md"
            style={{ width: `${s.paperMm}mm`, height: 520 }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void print(preview)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2 text-xs"
          >
            <Printer className="h-4 w-4" /> چاپ همین فیش نمونه
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => settings.save({ ...settings.get(), receipt: { ...DEFAULT_RECEIPT } })}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <RotateCcw className="h-3 w-3" /> بازگشت به تنظیمات پیش‌فرض
      </button>
      {notice && <p className="text-[11px] text-primary">{notice}</p>}
    </div>
  );
}
