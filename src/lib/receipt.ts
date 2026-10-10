/**
 * فیش (چاپگر حرارتی) — یک موتور واحد برای فاکتور فروش، فاکتور خرید و چاپ آزمایشی.
 *
 * چرا قبلاً نصف فیش چاپ می‌شد یا خطوط می‌افتاد؟
 *  - ‎`@page { size: 80mm auto }`‎ در CSS نامعتبر است؛ مرورگر آن را نادیده می‌گرفت و
 *    کاغذ A4/Letter را فرض می‌کرد → درایور فیش را کوچک یا از وسط بریده چاپ می‌کرد.
 *  - کل عرض ۸۰ میلی‌متر چیده می‌شد ولی هد چاپگرهای ۸۰ فقط حدود ۷۲ میلی‌متر چاپ
 *    می‌کنند → لبه‌ی راست/چپ (اعداد و مبلغ) بریده می‌شد.
 *  - رنگ‌های خاکستری (#333 و کمرنگ‌تر) روی حرارتی کمرنگ یا ناپیدا می‌شوند.
 *  - فونت سند چاپی با پیش‌نمایش فرق داشت.
 *
 * حالا: عرض کاغذ و «عرض قابل چاپ» قابل تنظیم است (پیش‌فرض‌ها بدون تنظیم کار می‌کنند)،
 * ارتفاع صفحه هنگام چاپ از روی محتوای واقعی اندازه‌گیری می‌شود (print.ts)، همه‌چیز
 * سیاه خالص است و فونت وزیرمتن همراه سند است.
 */
import { escapeHtml as esc } from "@/lib/html-escape";

export type ReceiptShow = {
  logo: boolean;
  shopContact: boolean;
  invoiceId: boolean;
  customer: boolean;
  customerFields: boolean;
  notes: boolean;
  itemDiscount: boolean;
  amountWords: boolean;
  thanks: boolean;
};

export type ReceiptSettings = {
  /** عرض کاغذ (میلی‌متر) — ۵۸ یا ۸۰ یا دلخواه */
  paperMm: number;
  /** عرضی که هد چاپگر واقعاً چاپ می‌کند (میلی‌متر) — ۸۰←۷۲، ۵۸←۴۸ */
  printableMm: number;
  /** فاصلهٔ داخلی از دو طرف ناحیهٔ چاپ (میلی‌متر) */
  sideMarginMm: number;
  /** اندازهٔ قلم پایه (پیکسل CSS) */
  fontPx: number;
  /** همهٔ نوشته‌ها پررنگ (برای چاپگرهای کم‌حرارت) */
  boldText: boolean;
  /** فضای خالی انتهای فیش برای برش (میلی‌متر) */
  feedMm: number;
  show: ReceiptShow;
  /** متن پایین فیش */
  footerText: string;
  /**
   * اندازهٔ کل فیش (درصد) — عرض، قلم و فاصله‌ها با هم بزرگ/کوچک می‌شوند. برای وقتی که
   * فیش در برنامهٔ چاپگر (مثلاً PDF در Print Master) ریز یا درشت درمی‌آید. ۱۰۰ = بدون تغییر.
   */
  scalePct: number;
};

export const RECEIPT_PRESETS = [
  { paperMm: 80, printableMm: 72, label: "۸۰ میلی‌متر (رایج)" },
  { paperMm: 58, printableMm: 48, label: "۵۸ میلی‌متر (کوچک)" },
] as const;

export const DEFAULT_RECEIPT: ReceiptSettings = {
  paperMm: 80,
  printableMm: 72,
  sideMarginMm: 1,
  fontPx: 13,
  boldText: false,
  feedMm: 12,
  show: {
    logo: true,
    shopContact: true,
    invoiceId: true,
    customer: true,
    customerFields: true,
    notes: true,
    itemDiscount: true,
    amountWords: false,
    thanks: true,
  },
  footerText: "با تشکر از خرید شما",
  scalePct: 100,
};

export const RECEIPT_SCALE_MIN = 50;
export const RECEIPT_SCALE_MAX = 300;

const clamp = (n: unknown, lo: number, hi: number, d: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};

/** تنظیمات ذخیره‌شده (یا هیچ) → تنظیمات کامل و معتبر. داده‌ی خراب هرگز چاپ را نمی‌شکند. */
export function normalizeReceiptSettings(raw: unknown): ReceiptSettings {
  const r = raw && typeof raw === "object" ? (raw as Partial<ReceiptSettings>) : {};
  const paperMm = clamp(r.paperMm, 40, 120, DEFAULT_RECEIPT.paperMm);
  const presetPrintable = paperMm <= 60 ? 48 : paperMm - 8;
  const printableMm = clamp(r.printableMm, 30, paperMm, Math.min(paperMm, presetPrintable));
  const show = { ...DEFAULT_RECEIPT.show };
  if (r.show && typeof r.show === "object") {
    for (const k of Object.keys(show) as (keyof ReceiptShow)[]) {
      const v = (r.show as Partial<ReceiptShow>)[k];
      if (typeof v === "boolean") show[k] = v;
    }
  }
  return {
    paperMm,
    printableMm,
    sideMarginMm: clamp(r.sideMarginMm, 0, 10, DEFAULT_RECEIPT.sideMarginMm),
    fontPx: clamp(r.fontPx, 9, 20, paperMm <= 60 ? 11 : DEFAULT_RECEIPT.fontPx),
    boldText: typeof r.boldText === "boolean" ? r.boldText : DEFAULT_RECEIPT.boldText,
    feedMm: clamp(r.feedMm, 0, 40, DEFAULT_RECEIPT.feedMm),
    show,
    footerText:
      typeof r.footerText === "string" ? r.footerText.slice(0, 200) : DEFAULT_RECEIPT.footerText,
    scalePct: Math.round(
      clamp(r.scalePct, RECEIPT_SCALE_MIN, RECEIPT_SCALE_MAX, DEFAULT_RECEIPT.scalePct),
    ),
  };
}

/**
 * اندازه‌های واقعی چاپ با اعمال «اندازهٔ فیش». در ۱۰۰٪ همان شیء بدون تغییر برمی‌گردد
 * تا خروجی کاربرانی که این تنظیم را دست نزده‌اند دقیقاً مثل قبل بماند.
 */
export function scaledReceipt(s: ReceiptSettings): ReceiptSettings {
  const pct = Number.isFinite(s.scalePct) ? s.scalePct : 100;
  if (pct === 100) return s;
  const k = pct / 100;
  const r1 = (n: number) => Math.round(n * k * 10) / 10;
  return {
    ...s,
    paperMm: r1(s.paperMm),
    printableMm: r1(s.printableMm),
    sideMarginMm: r1(s.sideMarginMm),
    feedMm: r1(s.feedMm),
    fontPx: r1(s.fontPx),
  };
}

/** عرض صفحهٔ فیش (میلی‌متر) پس از اعمال اندازه — برای قاب پیش‌نمایش */
export function receiptPageWidthMm(s: ReceiptSettings): number {
  return scaledReceipt(s).paperMm;
}

/** نشانه‌ای که print.ts با آن فیش را می‌شناسد و ارتفاع صفحه را اندازه می‌گیرد */
export const RECEIPT_MARK = "data-kamix-receipt";

export function printFontFaceCss(origin = ""): string {
  const base = origin.replace(/\/$/, "");
  const face = (w: number, file: string) =>
    `@font-face{font-family:"Vazirmatn";src:url("${base}/fonts/${file}") format("woff2"),url("https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/${file}") format("woff2");font-weight:${w};font-display:block}`;
  return [
    face(400, "Vazirmatn-Regular.woff2"),
    face(700, "Vazirmatn-Bold.woff2"),
    face(900, "Vazirmatn-Black.woff2"),
  ].join("\n");
}

function currentOrigin(): string {
  try {
    return typeof window !== "undefined" && window.location?.origin?.startsWith("http")
      ? window.location.origin
      : "";
  } catch {
    return "";
  }
}

export function receiptCss(s: ReceiptSettings): string {
  const fs = s.fontPx;
  const w = s.boldText ? 700 : 400;
  return `
  ${printFontFaceCss(currentOrigin())}
  /* اندازهٔ واقعی صفحه هنگام چاپ از روی ارتفاع محتوا جایگزین می‌شود (print.ts) */
  @page { size: ${s.paperMm}mm 297mm; margin: 0; }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:#fff}
  body{width:${s.paperMm}mm;color:#000;direction:rtl;font-family:"Vazirmatn",Tahoma,"Noto Naskh Arabic",sans-serif;
    font-size:${fs}px;line-height:1.5;font-weight:${w};-webkit-print-color-adjust:exact;print-color-adjust:exact;
    font-variant-numeric:tabular-nums}
  .r{width:${s.printableMm}mm;margin:0 auto;padding:2mm ${s.sideMarginMm}mm ${s.feedMm}mm}
  .c{text-align:center}
  .shop{font-size:${Math.round(fs * 1.3)}px;font-weight:900;line-height:1.3;word-break:break-word}
  .sub{font-size:${Math.max(9, Math.round(fs * 0.85))}px;word-break:break-word}
  .title{display:inline-block;margin-top:1.2mm;padding:0.4mm 3mm;border:1.5px solid #000;font-weight:900;font-size:${Math.round(fs * 1.02)}px}
  .logo{display:block;margin:0 auto 1.5mm;max-width:70%;max-height:22mm;object-fit:contain;filter:grayscale(1) contrast(1.4)}
  hr{border:0;border-top:1px dashed #000;margin:1.6mm 0}
  hr.b{border-top:2px solid #000}
  .kv{display:flex;justify-content:space-between;gap:2mm;align-items:baseline}
  .kv > span:first-child{flex:0 0 auto}
  .kv > span:last-child{text-align:left;min-width:0;word-break:break-word;overflow-wrap:anywhere;font-weight:700;unicode-bidi:plaintext}
  .ltr{direction:ltr;unicode-bidi:isolate;display:inline-block}
  .it{padding:0.8mm 0;border-bottom:1px dotted #000;break-inside:avoid;page-break-inside:avoid}
  .it:last-child{border-bottom:0}
  .it .n{font-weight:700;word-break:break-word;overflow-wrap:anywhere}
  .it .q{display:flex;justify-content:space-between;gap:2mm;align-items:baseline}
  .it .q b{font-weight:900;white-space:nowrap}
  .tag{font-size:${Math.max(9, Math.round(fs * 0.85))}px}
  s{text-decoration:line-through}
  .tot{display:flex;justify-content:space-between;gap:1.5mm;align-items:baseline;font-weight:900;
    font-size:${Math.round(fs * (s.printableMm < 60 ? 1.1 : 1.25))}px;border:2px solid #000;padding:1mm 1.5mm;margin:1.2mm 0}
  .tot span{white-space:nowrap}
  .due{font-weight:900}
  .words{font-size:${Math.max(9, Math.round(fs * 0.85))}px;margin-top:1mm}
  .foot{margin-top:2.5mm;text-align:center;font-weight:700}
  .cut{margin-top:3mm;text-align:center;font-size:9px;letter-spacing:2px}
  `;
}

export function receiptDocument(opts: { title: string; body: string; s: ReceiptSettings }): string {
  const s = scaledReceipt(opts.s);
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl" ${RECEIPT_MARK}="${s.paperMm}" data-feed="${s.feedMm}"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.title)}</title>
<style>${receiptCss(s)}</style>
</head><body><div class="r">${opts.body}</div></body></html>`;
}

/** بخش‌های تکرارشونده‌ی فیش */
export const receiptParts = {
  kv(label: string, value: string): string {
    return `<div class="kv"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  },
  item(opts: {
    name: string;
    qty: string;
    unitPrice: string;
    was?: string;
    tag?: string;
    total: string;
  }): string {
    return `<div class="it"><div class="n">${esc(opts.name)}${opts.tag ? ` <span class="tag">(${esc(opts.tag)})</span>` : ""}</div>
      <div class="q"><span>${esc(opts.qty)} × ${opts.was ? `<s>${esc(opts.was)}</s> ` : ""}${esc(opts.unitPrice)}</span><b>${esc(opts.total)}</b></div></div>`;
  },
  total(label: string, value: string): string {
    return `<div class="tot"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  },
};

/**
 * چاپ آزمایشی / کالیبره: خط‌کش میلی‌متری سراسری و نشانه‌های لبه. کاربر می‌بیند
 * کدام عدد اولین/آخرین عدد چاپ‌شده است و «عرض قابل چاپ» را همان می‌گذارد.
 */
export function buildReceiptCalibrationHTML(s: ReceiptSettings, shopName = "فروشگاه"): string {
  const ticks: string[] = [];
  for (let mm = 0; mm <= s.paperMm; mm += 2) {
    const major = mm % 10 === 0;
    ticks.push(
      `<span style="position:absolute;right:${mm}mm;top:0;width:0;height:${major ? 5 : 2.5}mm;border-right:${major ? 1.4 : 0.8}px solid #000"></span>` +
        (major && mm > 0 && mm < s.paperMm
          ? `<span style="position:absolute;right:${mm}mm;top:5.2mm;transform:translateX(50%);font-size:9px;font-weight:700">${mm.toLocaleString("fa-IR")}</span>`
          : ""),
    );
  }
  const ruler = `<div style="position:relative;width:${s.paperMm}mm;height:10mm;margin-right:calc((${s.printableMm}mm - ${s.paperMm}mm) / 2 - ${s.sideMarginMm}mm)">${ticks.join("")}</div>`;
  const body = `
  <div class="c shop">${esc(shopName)}</div>
  <div class="c"><span class="title">چاپ آزمایشی فیش</span></div>
  <hr class="b"/>
  <p class="sub">خط‌کش زیر از لبهٔ راست کاغذ شروع می‌شود (عدد = میلی‌متر). اولین و آخرین عددی که کامل
  چاپ شده، عرض قابل چاپ چاپگر شماست.</p>
  ${ruler}
  <hr/>
  ${receiptParts.kv("عرض کاغذ", `${s.paperMm.toLocaleString("fa-IR")} میلی‌متر`)}
  ${receiptParts.kv("عرض قابل چاپ", `${s.printableMm.toLocaleString("fa-IR")} میلی‌متر`)}
  ${receiptParts.kv("فاصله از لبه", `${s.sideMarginMm.toLocaleString("fa-IR")} میلی‌متر`)}
  ${receiptParts.kv("اندازهٔ قلم", `${s.fontPx.toLocaleString("fa-IR")}`)}
  <hr/>
  <div class="kv"><span>◀ لبهٔ راست</span><span>لبهٔ چپ ▶</span></div>
  <div style="border:2px solid #000;height:6mm;margin-top:1mm"></div>
  <p class="sub" style="margin-top:1mm">اگر هر دو خط عمودی کادر بالا دیده می‌شود، فیش کامل چاپ خواهد شد.
  اگر یک طرف بریده شده، «عرض قابل چاپ» را کمتر کنید.</p>
  <hr/>
  ${receiptParts.item({ name: "کالای نمونه با نام طولانی برای آزمایش شکستن خط", qty: "۲", unitPrice: "۱۲۵٬۰۰۰", total: "۲۵۰٬۰۰۰" })}
  ${receiptParts.item({ name: "کالای وزنی", qty: "۱ کیلو و ۲۵۰ گرم", unitPrice: "۸۰٬۰۰۰", total: "۱۰۰٬۰۰۰" })}
  ${receiptParts.total("جمع کل", "۳۵۰٬۰۰۰ تومان")}
  <p class="sub c">۰۱۲۳۴۵۶۷۸۹ — ABCDEFGHIJ abcdefghij</p>
  <div class="foot">پایان چاپ آزمایشی</div>
  <div class="cut">- - - - - - - - - -</div>`;
  // خط‌کش میلی‌متری با اندازهٔ واقعی چاپ می‌شود — اندازهٔ فیش روی آن اعمال نمی‌شود
  return receiptDocument({ title: "چاپ آزمایشی فیش", body, s: { ...s, scalePct: 100 } });
}

/**
 * ‎@page‎ فیش را به «عرض کاغذ × ارتفاع واقعی محتوا» تبدیل می‌کند (یک برگ بلند، بدون برش).
 * ارتفاع از اندازه‌گیری محتوا می‌آید (print.ts)؛ اگر عدد نامعتبر بود HTML دست نمی‌خورد.
 */
export function withReceiptPageHeight(html: string, heightMm: number): string {
  if (!Number.isFinite(heightMm) || heightMm <= 0) return html;
  const paper = Number(html.match(/data-kamix-receipt="([\d.]+)"/)?.[1]) || 80;
  const h = Math.min(5000, Math.ceil(heightMm));
  return html.replace(
    /@page\s*\{\s*size:\s*[\d.]+mm\s+[\d.]+mm;/i,
    `@page { size: ${paper}mm ${h}mm;`,
  );
}
