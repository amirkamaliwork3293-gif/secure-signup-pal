/**
 * invoice-pdf.ts — ساخت PDF فاکتور با رندر روی canvas
 *
 * چرا canvas؟ jsPDF به‌تنهایی متن فارسی را درست رندر نمی‌کند. متن روی canvas
 * با موتور متن سیستم‌عامل (شکل‌دهی کامل حروف فارسی) کشیده می‌شود و سپس
 * به‌صورت تصویر در PDF قرار می‌گیرد — خروجی در وب و اپ اندروید یکسان است
 * و همان چیدمان و زبان بصریِ نسخه چاپی سایت را دارد.
 *
 * ⚠️ اینجا هیچ مبلغی محاسبه نمی‌شود؛ همه‌ی اعداد از invoiceTotals/lineTotal و
 * invoiceAmountLines می‌آیند تا PDF دقیقاً همان اعداد صفحه و چاپ را نشان دهد.
 */
import { jsPDF } from "jspdf";
import {
  formatNumber,
  formatAmount,
  formatJalaliDateTime,
  formatChequeDue,
  currencyLabel,
  PAYMENT_LABEL,
  invoiceDocumentTitle,
  type Invoice,
} from "@/lib/store";
import { lineTotal, invoiceTotals, invoiceCheques } from "@/lib/invoice-math";
import {
  invoiceAmountLines,
  invoicePalette,
  customerDisplayName,
  qtyWithUnit,
  DEFAULT_INVOICE_ACCENT,
} from "@/lib/invoice-document";
import { amountToPersianWords } from "@/lib/amount-words";

// A4 با مقیاس ‎6px/mm ≈ 150dpi — حجم کم، کیفیت چاپ خوب
const SCALE = 6;
const PAGE_W = 210 * SCALE;
const PAGE_H = 297 * SCALE;
const MARGIN = 12 * SCALE;
const FONT = "Vazirmatn, Tahoma, 'Segoe UI', sans-serif";
const FOOTER_H = 16 * SCALE;
const INNER_W = PAGE_W - MARGIN * 2;

const P = invoicePalette(DEFAULT_INVOICE_ACCENT);
const PAPER = P.paper;

type Ctx = CanvasRenderingContext2D;

/** بارگذاری تصویر لوگو برای رسم روی canvas — در صورت خطا/نبود، null برمی‌گرداند (هرگز throw نمی‌کند) */
function loadLogoImage(url?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return `rgba(13,124,107,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const tint = (a: number) => withAlpha(P.accent, a);

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** پنل رنگیِ بسیار کم‌رنگ — پایه‌ی همه‌ی بخش‌های سند (بدون کادر سنگین) */
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, alpha = 0.05, r = 4 * SCALE) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = tint(alpha);
  ctx.fill();
}

function hLine(ctx: Ctx, x1: number, x2: number, y: number, color: string, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

function dashed(ctx: Ctx, x1: number, x2: number, y: number, color: string, dash: number[]) {
  ctx.save();
  ctx.setLineDash(dash);
  hLine(ctx, x1, x2, y, color, 1.6);
  ctx.restore();
}

function fitText(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

/** شکستن متن به چند خط با سقف تعداد خط — خط آخر در صورت سرریز «…» می‌گیرد */
function wrapText(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line);
      line = word;
      if (out.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (out.length < maxLines && line) out.push(line);
  if (out.length === maxLines) {
    const joined = out.join(" ").length;
    if (joined < text.replace(/\s+/g, " ").trim().length) {
      out[maxLines - 1] = fitText(ctx, `${out[maxLines - 1]}…`, maxWidth);
    }
  }
  return out;
}

/** بوم کوچک فقط برای اندازه‌گیری متن هنگام محاسبه‌ی ارتفاع بخش‌ها */
let measureCtx: Ctx | null = null;
function measurer(): Ctx {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    c.width = 10;
    c.height = 10;
    measureCtx = c.getContext("2d")!;
    measureCtx.direction = "rtl";
  }
  return measureCtx;
}

/** آیکون‌های ریز خطی — معادل SVGهای نسخه وب */
function glyph(ctx: Ctx, kind: string, cx: number, cy: number, size: number, color: string) {
  const s = size / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.9, size * 0.11);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "calendar") {
    ctx.rect(cx - s * 0.8, cy - s * 0.65, s * 1.6, s * 1.4);
    ctx.moveTo(cx - s * 0.8, cy - s * 0.18);
    ctx.lineTo(cx + s * 0.8, cy - s * 0.18);
  } else if (kind === "clock") {
    ctx.arc(cx, cy, s * 0.82, 0, Math.PI * 2);
    ctx.moveTo(cx, cy - s * 0.45);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + s * 0.35, cy + s * 0.2);
  } else if (kind === "wallet") {
    ctx.rect(cx - s * 0.85, cy - s * 0.6, s * 1.7, s * 1.2);
    ctx.moveTo(cx + s * 0.3, cy);
    ctx.lineTo(cx + s * 0.55, cy);
  } else if (kind === "layers") {
    ctx.moveTo(cx, cy - s * 0.75);
    ctx.lineTo(cx + s * 0.85, cy - s * 0.25);
    ctx.lineTo(cx, cy + s * 0.25);
    ctx.lineTo(cx - s * 0.85, cy - s * 0.25);
    ctx.closePath();
    ctx.moveTo(cx - s * 0.85, cy + s * 0.35);
    ctx.lineTo(cx, cy + s * 0.85);
    ctx.lineTo(cx + s * 0.85, cy + s * 0.35);
  } else if (kind === "store") {
    ctx.moveTo(cx - s * 0.85, cy - s * 0.15);
    ctx.lineTo(cx - s * 0.6, cy - s * 0.78);
    ctx.lineTo(cx + s * 0.6, cy - s * 0.78);
    ctx.lineTo(cx + s * 0.85, cy - s * 0.15);
    ctx.moveTo(cx - s * 0.62, cy - s * 0.15);
    ctx.lineTo(cx - s * 0.62, cy + s * 0.82);
    ctx.lineTo(cx + s * 0.62, cy + s * 0.82);
    ctx.lineTo(cx + s * 0.62, cy - s * 0.15);
  } else if (kind === "user") {
    ctx.arc(cx, cy - s * 0.32, s * 0.4, 0, Math.PI * 2);
    ctx.moveTo(cx - s * 0.72, cy + s * 0.82);
    ctx.arc(cx, cy + s * 0.82, s * 0.72, Math.PI, 0);
  } else if (kind === "phone") {
    ctx.moveTo(cx - s * 0.6, cy - s * 0.8);
    ctx.lineTo(cx - s * 0.1, cy - s * 0.8);
    ctx.lineTo(cx + s * 0.1, cy - s * 0.2);
    ctx.lineTo(cx - s * 0.2, cy + s * 0.05);
    ctx.lineTo(cx + s * 0.35, cy + s * 0.6);
    ctx.lineTo(cx + s * 0.75, cy + s * 0.35);
  } else if (kind === "pin") {
    ctx.moveTo(cx, cy + s * 0.85);
    ctx.bezierCurveTo(cx + s * 0.9, cy - s * 0.1, cx + s * 0.6, cy - s * 0.9, cx, cy - s * 0.9);
    ctx.bezierCurveTo(cx - s * 0.6, cy - s * 0.9, cx - s * 0.9, cy - s * 0.1, cx, cy + s * 0.85);
  } else if (kind === "note") {
    ctx.rect(cx - s * 0.62, cy - s * 0.85, s * 1.24, s * 1.7);
    ctx.moveTo(cx - s * 0.3, cy - s * 0.35);
    ctx.lineTo(cx + s * 0.3, cy - s * 0.35);
    ctx.moveTo(cx - s * 0.3, cy + s * 0.1);
    ctx.lineTo(cx + s * 0.3, cy + s * 0.1);
  } else {
    // seal — نشان تأیید
    ctx.arc(cx, cy, s * 0.85, 0, Math.PI * 2);
    ctx.moveTo(cx - s * 0.36, cy);
    ctx.lineTo(cx - s * 0.1, cy + s * 0.3);
    ctx.lineTo(cx + s * 0.42, cy - s * 0.33);
  }
  ctx.stroke();
  ctx.restore();
}

function newPage(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.direction = "rtl";
  ctx.textBaseline = "middle";
  drawPageBackdrop(ctx);
  return { canvas, ctx };
}

/** کاغذ: تابش نرم رنگ تم و شیرازه‌ی لبه — همان امضای بصری نسخه وب */
function drawPageBackdrop(ctx: Ctx) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const top = ctx.createRadialGradient(
    PAGE_W * 0.94,
    -10 * SCALE,
    0,
    PAGE_W * 0.94,
    -10 * SCALE,
    130 * SCALE,
  );
  top.addColorStop(0, tint(0.11));
  top.addColorStop(0.45, tint(0.035));
  top.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, PAGE_W, 150 * SCALE);

  const bottom = ctx.createRadialGradient(0, PAGE_H, 0, 0, PAGE_H, 95 * SCALE);
  bottom.addColorStop(0, tint(0.07));
  bottom.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, PAGE_H - 120 * SCALE, PAGE_W, 120 * SCALE);

  const spine = ctx.createLinearGradient(0, 0, 0, PAGE_H);
  spine.addColorStop(0, P.accent);
  spine.addColorStop(0.36, tint(0.6));
  spine.addColorStop(1, tint(0.14));
  ctx.fillStyle = spine;
  ctx.fillRect(PAGE_W - 7 * SCALE, 0, 1.8 * SCALE, PAGE_H);
}

// ─── سربرگ ──────────────────────────────────────────────────────────────────

/** خط دست‌کشیده زیر عنوان سند */
function drawSwash(ctx: Ctx, x: number, y: number, w: number) {
  ctx.save();
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = 1.1 * SCALE;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + 1.1 * SCALE);
  ctx.bezierCurveTo(
    x + w * 0.3,
    y - 0.5 * SCALE,
    x + w * 0.62,
    y - 0.2 * SCALE,
    x + w,
    y + 1.4 * SCALE,
  );
  ctx.stroke();
  ctx.restore();
}

/** عنوان دو وزنی: واژه‌ی آخر پررنگ — در RTL واژه‌ی آخر سمت چپ می‌نشیند */
function drawDocTitle(ctx: Ctx, title: string, x: number, y: number, size: number): number {
  const words = String(title || "فاکتور")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  ctx.textAlign = "left";
  if (words.length < 2) {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.fillStyle = P.deep;
    ctx.fillText(words[0] || "فاکتور", x, y);
    return ctx.measureText(words[0] || "فاکتور").width;
  }
  const last = words.pop() as string;
  const head = words.join(" ");
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.fillStyle = P.deep;
  ctx.fillText(last, x, y);
  const lastW = ctx.measureText(last).width;
  ctx.font = `300 ${size}px ${FONT}`;
  ctx.fillStyle = P.ink;
  const gap = ctx.measureText(" ").width;
  ctx.fillText(head, x + lastW + gap, y);
  return lastW + gap + ctx.measureText(head).width;
}

function drawHero(
  ctx: Ctx,
  inv: Invoice,
  pageNo: number,
  logoImg?: HTMLImageElement | null,
): number {
  const shopName = inv.shopName || "فروشگاه";
  const docTitle = invoiceDocumentTitle(inv);
  const y = MARGIN;

  if (pageNo > 1) {
    ctx.textAlign = "right";
    ctx.fillStyle = P.ink;
    ctx.font = `700 ${4.2 * SCALE}px ${FONT}`;
    ctx.fillText(shopName, PAGE_W - MARGIN, y + 3 * SCALE);
    ctx.textAlign = "left";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${3 * SCALE}px ${FONT}`;
    ctx.fillText(`ادامه ${docTitle} — ${inv.id.toUpperCase()}`, MARGIN, y + 3 * SCALE);
    hLine(ctx, MARGIN, PAGE_W - MARGIN, y + 7 * SCALE, tint(0.3));
    return y + 12 * SCALE;
  }

  const brandRight = PAGE_W - MARGIN;
  let textX = brandRight;

  if (logoImg) {
    const box = 15 * SCALE;
    const ratio = Math.min(
      (box - 3 * SCALE) / logoImg.width,
      (box - 3 * SCALE) / logoImg.height,
      1,
    );
    const w = logoImg.width * ratio;
    const h = logoImg.height * ratio;
    const lx = brandRight - box;
    roundRect(ctx, lx, y, box, box, 4.2 * SCALE);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.drawImage(logoImg, lx + (box - w) / 2, y + (box - h) / 2, w, h);
    textX = lx - 3.5 * SCALE;
  }

  const brandW = textX - MARGIN - 58 * SCALE;
  ctx.textAlign = "right";
  ctx.fillStyle = P.ink;
  ctx.font = `800 ${5.4 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, shopName, brandW), textX, y + 5 * SCALE);

  ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
  let cy = y + 11 * SCALE;
  for (const [kind, value] of [
    ["phone", inv.shopPhone],
    ["pin", inv.shopAddress],
  ] as [string, string | undefined][]) {
    if (!value) continue;
    glyph(ctx, kind, textX - 1.4 * SCALE, cy, 2.8 * SCALE, tint(0.75));
    ctx.fillStyle = P.muted;
    ctx.fillText(fitText(ctx, value, brandW - 4 * SCALE), textX - 4 * SCALE, cy);
    cy += 4.4 * SCALE;
  }

  // عنوان سند — بزرگ‌ترین عنصر متنی سربرگ
  const titleW = drawDocTitle(ctx, docTitle, MARGIN, y + 6 * SCALE, 8.6 * SCALE);
  const swashW = Math.min(Math.max(titleW, 26 * SCALE), 74 * SCALE);
  drawSwash(ctx, MARGIN, y + 11 * SCALE, swashW);

  const idText = inv.id.toUpperCase();
  ctx.font = `700 ${3 * SCALE}px ${FONT}`;
  const idW = ctx.measureText(idText).width + 7 * SCALE;
  const pillY = y + 14.5 * SCALE;
  roundRect(ctx, MARGIN, pillY, idW, 6.4 * SCALE, 3.2 * SCALE);
  ctx.fillStyle = tint(0.09);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = P.accent;
  ctx.fillText(idText, MARGIN + idW / 2, pillY + 3.3 * SCALE);

  const bottom = Math.max(cy, pillY + 6.4 * SCALE, y + 17 * SCALE);
  const g = ctx.createLinearGradient(PAGE_W - MARGIN, 0, MARGIN, 0);
  g.addColorStop(0, tint(0.55));
  g.addColorStop(0.45, tint(0.2));
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(MARGIN, bottom + 2 * SCALE, INNER_W, 1.2);
  return bottom + 6 * SCALE;
}

// ─── نوار اطلاعات فاکتور ────────────────────────────────────────────────────

type MetaItem = { k: string; v: string; icon: string; tone?: "ok" | "due" };

function metaItems(inv: Invoice): MetaItem[] {
  const t = invoiceTotals(inv);
  const out: MetaItem[] = [
    { k: "تاریخ صدور", v: formatJalaliDateTime(inv.createdAt), icon: "calendar" },
  ];
  const due = invoiceCheques(inv)
    .map((c) => c.dueDate)
    .filter((d): d is string => !!d)
    .sort()[0];
  if (due) out.push({ k: "سررسید چک", v: formatChequeDue(due), icon: "clock" });
  if (inv.paymentMethod) {
    out.push({ k: "نوع فاکتور", v: PAYMENT_LABEL[inv.paymentMethod], icon: "wallet" });
  }
  out.push({ k: "تعداد اقلام", v: formatNumber(inv.items.length), icon: "layers" });
  out.push(
    t.remaining > 0
      ? { k: "وضعیت", v: "دارای مانده", icon: "seal", tone: "due" }
      : { k: "وضعیت", v: "تسویه شده", icon: "seal", tone: "ok" },
  );
  return out;
}

function drawMetaStrip(ctx: Ctx, y: number, inv: Invoice): number {
  const items = metaItems(inv);
  const h = 11 * SCALE;

  ctx.font = `700 ${3.4 * SCALE}px ${FONT}`;
  const weights = items.map((it) => Math.max(16 * SCALE, ctx.measureText(it.v).width + 12 * SCALE));
  const sum = weights.reduce((s, x) => s + x, 0);
  const widths = weights.map((x) => (x / sum) * INNER_W);

  let offset = 0;
  items.forEach((it, i) => {
    const cellW = widths[i];
    const right = PAGE_W - MARGIN - offset;
    offset += cellW;
    if (i > 0) {
      ctx.strokeStyle = tint(0.14);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(right, y + 0.5 * SCALE);
      ctx.lineTo(right, y + h - 1.5 * SCALE);
      ctx.stroke();
    }
    const textRight = i === 0 ? right : right - 3.5 * SCALE;
    const textW = cellW - 6 * SCALE;
    glyph(ctx, it.icon, textRight - 1.3 * SCALE, y + 2.6 * SCALE, 2.7 * SCALE, tint(0.8));
    ctx.textAlign = "right";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${2.8 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, it.k, textW - 4 * SCALE), textRight - 3.6 * SCALE, y + 2.6 * SCALE);
    ctx.fillStyle = it.tone === "due" ? P.danger : it.tone === "ok" ? P.success : P.ink;
    ctx.font = `700 ${3.4 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, it.v, textW), textRight, y + 7.6 * SCALE);
  });

  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + h, tint(0.12));
  return y + h + 5 * SCALE;
}

// ─── فروشنده و خریدار ───────────────────────────────────────────────────────

function drawParties(ctx: Ctx, y: number, inv: Invoice): number {
  const gap = 4 * SCALE;
  const boxW = (INNER_W - gap) / 2;
  const seller: [string, string | undefined][] = [
    ["تلفن", inv.shopPhone],
    ["نشانی", inv.shopAddress],
  ];
  const buyer: [string, string | undefined][] = [
    ["تلفن", inv.customer?.phone],
    ["پرداخت", inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : undefined],
  ];
  const h = 24 * SCALE;

  const drawParty = (
    x: number,
    kicker: string,
    icon: string,
    name: string,
    rows: [string, string | undefined][],
  ) => {
    panel(ctx, x, y, boxW, h, 0.04, 4.5 * SCALE);
    const right = x + boxW - 4.5 * SCALE;
    glyph(ctx, icon, right - 1.4 * SCALE, y + 5 * SCALE, 3 * SCALE, P.accent);
    ctx.textAlign = "right";
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${3 * SCALE}px ${FONT}`;
    ctx.fillText(kicker, right - 4 * SCALE, y + 5 * SCALE);

    ctx.fillStyle = P.ink;
    ctx.font = `800 ${4.3 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, name || "—", boxW - 9 * SCALE), right, y + 11 * SCALE);

    let ly = y + 16.5 * SCALE;
    for (const [k, v] of rows) {
      if (!v || !v.trim()) continue;
      ctx.fillStyle = P.muted;
      ctx.font = `400 ${3 * SCALE}px ${FONT}`;
      ctx.fillText(k, right, ly);
      const kw = ctx.measureText(k).width;
      ctx.fillStyle = P.ink;
      ctx.font = `600 ${3.2 * SCALE}px ${FONT}`;
      ctx.fillText(fitText(ctx, v.trim(), boxW - kw - 12 * SCALE), right - kw - 2.4 * SCALE, ly);
      ly += 4.6 * SCALE;
    }
  };

  drawParty(PAGE_W - MARGIN - boxW, "فروشنده", "store", inv.shopName || "فروشگاه", seller);
  drawParty(MARGIN, "خریدار", "user", customerDisplayName(inv), buyer);
  return y + h + 6 * SCALE;
}

// ─── دفتر اقلام ─────────────────────────────────────────────────────────────
// ستون‌ها از راست به چپ: ردیف | شرح کالا / خدمات | تعداد | مبلغ واحد | مبلغ کل

function columns() {
  const idx = 10 * SCALE;
  const qty = 22 * SCALE;
  const unitPrice = 34 * SCALE;
  const total = 38 * SCALE;
  const name = INNER_W - idx - qty - unitPrice - total;
  const xRight = PAGE_W - MARGIN;
  return {
    idx: { x: xRight, w: idx },
    name: { x: xRight - idx, w: name },
    qty: { x: xRight - idx - name, w: qty },
    unitPrice: { x: xRight - idx - name - qty, w: unitPrice },
    total: { x: xRight - idx - name - qty - unitPrice, w: total },
  };
}

const ROW_H = 10 * SCALE;
const HEAD_H = 7 * SCALE;

function drawTableHead(ctx: Ctx, y: number): number {
  const cols = columns();
  const cur = currencyLabel();
  ctx.fillStyle = P.accent;
  ctx.font = `700 ${2.9 * SCALE}px ${FONT}`;
  const cy = y + HEAD_H / 2;
  ctx.textAlign = "center";
  ctx.fillText("ردیف", cols.idx.x - cols.idx.w / 2, cy);
  ctx.fillText("تعداد", cols.qty.x - cols.qty.w / 2, cy);
  ctx.fillText(`مبلغ واحد (${cur})`, cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  ctx.fillText(`مبلغ کل (${cur})`, cols.total.x - cols.total.w / 2, cy);
  ctx.textAlign = "right";
  ctx.fillText("شرح کالا / خدمات", cols.name.x - 2 * SCALE, cy);
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + HEAD_H, tint(0.55), 1.6);
  return y + HEAD_H + 0.5 * SCALE;
}

function drawRow(ctx: Ctx, y: number, i: number, item: Invoice["items"][number]): number {
  const cols = columns();
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + ROW_H, tint(0.11));

  const cy = y + ROW_H / 2;
  ctx.textAlign = "center";
  ctx.fillStyle = tint(0.6);
  ctx.font = `800 ${3.1 * SCALE}px ${FONT}`;
  ctx.fillText(formatNumber(i + 1), cols.idx.x - cols.idx.w / 2, cy);

  ctx.fillStyle = P.muted;
  ctx.font = `600 ${3.3 * SCALE}px ${FONT}`;
  ctx.fillText(qtyWithUnit(item), cols.qty.x - cols.qty.w / 2, cy);

  ctx.fillStyle = P.ink;
  ctx.font = `400 ${3.4 * SCALE}px ${FONT}`;
  if (item.originalPrice) {
    ctx.fillText(
      formatAmount(item.price),
      cols.unitPrice.x - cols.unitPrice.w / 2,
      cy - 1.8 * SCALE,
    );
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${2.8 * SCALE}px ${FONT}`;
    const was = formatAmount(item.originalPrice);
    const wy = cy + 2.6 * SCALE;
    const wx = cols.unitPrice.x - cols.unitPrice.w / 2;
    ctx.fillText(was, wx, wy);
    const ww = ctx.measureText(was).width;
    hLine(ctx, wx - ww / 2, wx + ww / 2, wy, P.muted);
  } else {
    ctx.fillText(formatAmount(item.price), cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  }

  ctx.fillStyle = P.ink;
  ctx.font = `800 ${3.5 * SCALE}px ${FONT}`;
  ctx.fillText(formatAmount(lineTotal(item)), cols.total.x - cols.total.w / 2, cy);

  ctx.textAlign = "right";
  const nameRight = cols.name.x - 2 * SCALE;
  const nameW = cols.name.w - 4 * SCALE;
  if (item.discountPercent) {
    ctx.fillStyle = P.success;
    ctx.font = `700 ${2.7 * SCALE}px ${FONT}`;
    ctx.fillText(`٪${formatNumber(item.discountPercent)} تخفیف`, nameRight, cy + 3 * SCALE);
    ctx.fillStyle = P.ink;
    ctx.font = `700 ${3.4 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, item.name, nameW), nameRight, cy - 2 * SCALE);
  } else {
    ctx.fillStyle = P.ink;
    ctx.font = `700 ${3.4 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, item.name, nameW), nameRight, cy);
  }

  return y + ROW_H;
}

// ─── ته‌برگ مالی ────────────────────────────────────────────────────────────

const STUB_PAD = 6 * SCALE;
const PAY_ROW_H = 5 * SCALE;
const GRAND_H = 15 * SCALE;
const SIGN_H = 14 * SCALE;

function payWordsLines(inv: Invoice): string[] {
  const t = invoiceTotals(inv);
  const words = amountToPersianWords(t.total);
  if (!words) return [];
  const ctx = measurer();
  ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
  return wrapText(ctx, `به حروف: ${words} ${currencyLabel()}`, INNER_W - STUB_PAD * 2, 2);
}

function stubHeight(inv: Invoice): number {
  const lines = invoiceAmountLines(inv).filter((l) => l.kind !== "grand");
  const body = Math.max(lines.length * PAY_ROW_H, GRAND_H);
  const words = payWordsLines(inv);
  const wordsH = words.length ? 3.5 * SCALE + words.length * 4.2 * SCALE : 0;
  return STUB_PAD + body + wordsH + STUB_PAD;
}

function drawStub(ctx: Ctx, y: number, inv: Invoice): number {
  const all = invoiceAmountLines(inv);
  const grand = all.find((l) => l.kind === "grand");
  const rows = all.filter((l) => l.kind !== "grand");
  const settled = !!grand && !all.some((l) => l.kind === "due");
  const h = stubHeight(inv);
  const x = MARGIN;

  panel(ctx, x, y, INNER_W, h, 0.05, 5.5 * SCALE);
  dashed(ctx, x + 5 * SCALE, x + INNER_W - 5 * SCALE, y, tint(0.34), [3 * SCALE, 2.4 * SCALE]);
  for (const nx of [x, x + INNER_W]) {
    ctx.beginPath();
    ctx.arc(nx, y, 2.6 * SCALE, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
  }

  // ستون راست: سطرهای جمع‌بندی با راهنمای نقطه‌چین
  const listRight = x + INNER_W - STUB_PAD;
  const listW = INNER_W * 0.52;
  let ly = y + STUB_PAD + 2.4 * SCALE;
  for (const l of rows) {
    const isDue = l.kind === "due";
    ctx.textAlign = "right";
    ctx.fillStyle = isDue ? P.danger : P.muted;
    ctx.font = `${isDue ? 800 : 400} ${3 * SCALE}px ${FONT}`;
    const label = fitText(ctx, l.label, listW * 0.55);
    ctx.fillText(label, listRight, ly);
    const labelW = ctx.measureText(label).width;

    ctx.textAlign = "left";
    ctx.fillStyle = isDue ? P.danger : P.ink;
    ctx.font = `${isDue ? 800 : 700} ${3.1 * SCALE}px ${FONT}`;
    const valueLeft = listRight - listW;
    ctx.fillText(l.value, valueLeft, ly);
    const valueW = ctx.measureText(l.value).width;

    const dotFrom = valueLeft + valueW + 1.6 * SCALE;
    const dotTo = listRight - labelW - 1.6 * SCALE;
    if (dotTo > dotFrom) {
      ctx.save();
      ctx.setLineDash([1, 2.4]);
      hLine(ctx, dotFrom, dotTo, ly + 1.2 * SCALE, tint(0.45));
      ctx.restore();
    }
    ly += PAY_ROW_H;
  }

  // ستون چپ: مبلغ قابل پرداخت
  if (grand) {
    const gx = x + STUB_PAD;
    const gy = y + STUB_PAD + 2 * SCALE;
    ctx.textAlign = "left";
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${3 * SCALE}px ${FONT}`;
    ctx.fillText("مبلغ قابل پرداخت", gx, gy);

    ctx.font = `800 ${8.6 * SCALE}px ${FONT}`;
    ctx.fillStyle = P.ink;
    const amount = fitText(ctx, grand.amount, INNER_W * 0.4);
    ctx.fillText(amount, gx, gy + 7 * SCALE);
    const aw = ctx.measureText(amount).width;
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${3 * SCALE}px ${FONT}`;
    ctx.fillText(grand.currency, gx + aw + 2 * SCALE, gy + 9 * SCALE);

    if (settled) {
      const sw = 22 * SCALE;
      const sh = 8 * SCALE;
      const sx = gx + Math.max(aw, INNER_W * 0.28) + 8 * SCALE;
      const sy = gy + 2 * SCALE;
      ctx.save();
      ctx.translate(sx + sw / 2, sy + sh / 2);
      ctx.rotate((-9 * Math.PI) / 180);
      roundRect(ctx, -sw / 2, -sh / 2, sw, sh, 2.4 * SCALE);
      ctx.strokeStyle = withAlpha(P.success, 0.42);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = withAlpha(P.success, 0.75);
      ctx.font = `800 ${3.4 * SCALE}px ${FONT}`;
      ctx.fillText("تسویه شد", 0, 0.2 * SCALE);
      ctx.restore();
    }
  }

  const words = payWordsLines(inv);
  if (words.length) {
    const wy = y + h - STUB_PAD - (words.length - 1) * 4.2 * SCALE - 1 * SCALE;
    ctx.save();
    ctx.setLineDash([2.5, 2.5]);
    hLine(ctx, x + STUB_PAD, x + INNER_W - STUB_PAD, wy - 4.4 * SCALE, tint(0.3));
    ctx.restore();
    ctx.textAlign = "right";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
    words.forEach((line, i) => {
      ctx.fillText(line, x + INNER_W - STUB_PAD, wy + i * 4.2 * SCALE);
    });
  }

  return y + h;
}

// ─── توضیحات و امضا ─────────────────────────────────────────────────────────

function closingHeight(inv: Invoice): number {
  const noteH = inv.notes ? 20 * SCALE : 0;
  return Math.max(noteH, SIGN_H) + 5 * SCALE;
}

function drawClosing(ctx: Ctx, y: number, inv: Invoice) {
  const gap = 5 * SCALE;
  const half = (INNER_W - gap) / 2;

  if (inv.notes) {
    const h = 20 * SCALE;
    const x = PAGE_W - MARGIN - half;
    panel(ctx, x, y, half, h, 0.04, 3.6 * SCALE);
    const right = x + half - 4 * SCALE;
    glyph(ctx, "note", right - 1.3 * SCALE, y + 4.6 * SCALE, 2.8 * SCALE, P.accent);
    ctx.textAlign = "right";
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${3 * SCALE}px ${FONT}`;
    ctx.fillText("توضیحات", right - 3.6 * SCALE, y + 4.6 * SCALE);
    ctx.fillStyle = P.ink;
    ctx.font = `400 ${3.1 * SCALE}px ${FONT}`;
    const lines = wrapText(ctx, inv.notes, half - 8 * SCALE, 3);
    lines.forEach((line, i) => ctx.fillText(line, right, y + 10 * SCALE + i * 4.4 * SCALE));
  }

  const signW = (half - gap) / 2;
  const drawSign = (sx: number, label: string, icon: string) => {
    ctx.save();
    ctx.setLineDash([3, 3]);
    hLine(ctx, sx, sx + signW, y + SIGN_H - 5 * SCALE, tint(0.5));
    ctx.restore();
    ctx.textAlign = "center";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
    const cx = sx + signW / 2;
    ctx.fillText(label, cx + 2 * SCALE, y + SIGN_H - 0.6 * SCALE);
    const lw = ctx.measureText(label).width;
    glyph(ctx, icon, cx + lw / 2 + 4 * SCALE, y + SIGN_H - 0.6 * SCALE, 2.6 * SCALE, tint(0.8));
  };
  drawSign(MARGIN + signW + gap, "مهر و امضای فروشنده", "seal");
  drawSign(MARGIN, "امضای خریدار", "note");
}

// ─── پانویس ─────────────────────────────────────────────────────────────────

function drawFooter(ctx: Ctx, inv: Invoice, pageNo: number, pageCount: number) {
  const shopName = inv.shopName || "فروشگاه";
  const y = PAGE_H - 10 * SCALE;
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y - 4 * SCALE, tint(0.18));

  ctx.textAlign = "right";
  ctx.fillStyle = P.accent;
  ctx.font = `700 ${2.9 * SCALE}px ${FONT}`;
  glyph(ctx, "seal", PAGE_W - MARGIN - 1.3 * SCALE, y, 2.8 * SCALE, P.accent);
  ctx.fillText(fitText(ctx, shopName, 70 * SCALE), PAGE_W - MARGIN - 3.8 * SCALE, y);

  const ways = [inv.shopPhone, inv.shopAddress].filter(Boolean).join("  ·  ");
  const tail = pageCount > 1 ? `صفحه ${formatNumber(pageNo)} از ${formatNumber(pageCount)}` : "";
  const text = [ways, tail].filter(Boolean).join("  ·  ");
  if (text) {
    ctx.textAlign = "left";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${2.8 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, text, 120 * SCALE), MARGIN, y);
  }
}

// ─── ساخت صفحات ─────────────────────────────────────────────────────────────

async function renderInvoiceCanvases(inv: Invoice): Promise<HTMLCanvasElement[]> {
  try {
    await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  } catch {
    /* ignore */
  }

  const logoImg = await loadLogoImage(inv.shopLogoUrl);
  const items = inv.items;
  const pages: { canvas: HTMLCanvasElement; ctx: Ctx }[] = [];
  let pageNo = 1;
  let i = 0;

  while (i < items.length || pageNo === 1) {
    const page = newPage();
    const { ctx } = page;
    let y = drawHero(ctx, inv, pageNo, logoImg);
    if (pageNo === 1) {
      y = drawMetaStrip(ctx, y, inv);
      y = drawParties(ctx, y, inv);
    }
    y = drawTableHead(ctx, y);

    const closing = stubHeight(inv) + closingHeight(inv) + 6 * SCALE;
    const bottomLimit = PAGE_H - FOOTER_H;
    while (i < items.length && y + ROW_H + closing <= bottomLimit) {
      y = drawRow(ctx, y, i, items[i]);
      i++;
    }

    const isLast = i >= items.length;
    if (isLast) {
      const stubY = y + 7 * SCALE;
      const afterStub = drawStub(ctx, stubY, inv);
      drawClosing(ctx, afterStub + 5 * SCALE, inv);
    }

    pages.push(page);
    if (isLast) break;
    pageNo++;
  }

  pages.forEach((p, idx) => drawFooter(p.ctx, inv, idx + 1, pages.length));
  return pages.map((p) => p.canvas);
}

/** تصویر JPEG هر صفحه فاکتور — برای گالری / اشتراک در اپ، بدون لینک دانلود */
export async function buildInvoiceImageDataUrls(inv: Invoice): Promise<string[]> {
  const pages = await renderInvoiceCanvases(inv);
  return pages.map((c) => c.toDataURL("image/jpeg", 0.92));
}

/** ساخت PDF چندصفحه‌ای فاکتور — خروجی آماده savePdf / save */
export async function buildInvoicePdf(inv: Invoice): Promise<jsPDF> {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pages = await renderInvoiceCanvases(inv);
  pages.forEach((canvas, idx) => {
    if (idx > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
  });
  return pdf;
}
