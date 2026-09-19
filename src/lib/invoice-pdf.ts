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
  PAYMENT_LABEL,
  invoiceDocumentTitle,
  type Invoice,
} from "@/lib/store";
import { lineTotal, invoiceTotals } from "@/lib/invoice-math";
import {
  invoiceAmountLines,
  invoicePalette,
  customerDisplayName,
  qtyWithUnit,
  DEFAULT_INVOICE_ACCENT,
} from "@/lib/invoice-document";

// A4 با مقیاس ‎6px/mm ≈ 150dpi — حجم کم، کیفیت چاپ خوب
const SCALE = 6;
const PAGE_W = 210 * SCALE;
const PAGE_H = 297 * SCALE;
const MARGIN = 12 * SCALE;
const FONT = "Vazirmatn, Tahoma, 'Segoe UI', sans-serif";
const FOOTER_H = 20 * SCALE;

const P = invoicePalette(DEFAULT_INVOICE_ACCENT);
const PAPER = "#ffffff";

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

/** کارت روشن با حاشیه‌ی مویی — پایه‌ی همه‌ی باکس‌های سند */
function softCard(ctx: Ctx, x: number, y: number, w: number, h: number, r = 3.5 * SCALE) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, P.wash);
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function accentGradient(ctx: Ctx, x: number, y: number, w: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(x + w, y, x, y + h);
  g.addColorStop(0, P.deep);
  g.addColorStop(0.55, P.accent);
  g.addColorStop(1, P.soft);
  return g;
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
    const restStart = out.join(" ").length;
    const hasRest = restStart < text.replace(/\s+/g, " ").trim().length;
    if (hasRest) out[maxLines - 1] = fitText(ctx, `${out[maxLines - 1]}…`, maxWidth);
  }
  return out;
}

function newPage(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.direction = "rtl";
  ctx.textBaseline = "middle";
  drawPageBackdrop(ctx);
  return { canvas, ctx };
}

/** پس‌زمینه‌ی ظریف — همان حسِ نسخه وب، بدون کم‌کردن خوانایی متن */
function drawPageBackdrop(ctx: Ctx) {
  const top = ctx.createRadialGradient(PAGE_W, 0, 0, PAGE_W, 0, 120 * SCALE);
  top.addColorStop(0, withAlpha(P.accent, 0.13));
  top.addColorStop(0.55, withAlpha(P.accent, 0.04));
  top.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, PAGE_W, 150 * SCALE);

  const bottom = ctx.createRadialGradient(0, PAGE_H, 0, 0, PAGE_H, 110 * SCALE);
  bottom.addColorStop(0, withAlpha(P.glow, 0.5));
  bottom.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, PAGE_H - 150 * SCALE, PAGE_W, 150 * SCALE);

  ctx.strokeStyle = withAlpha(P.accent, 0.07);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(-14 * SCALE, 18 * SCALE, 58 * SCALE, 0, Math.PI * 2);
  ctx.stroke();
}

/** نشان کوچک کنار هر خانه‌ی کارت اطلاعات — معادل آیکون‌های نسخه وب */
function drawGlyph(ctx: Ctx, kind: string, cx: number, cy: number, size: number) {
  const s = size / 2;
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "hash") {
    ctx.moveTo(cx - s * 0.8, cy - s * 0.3);
    ctx.lineTo(cx + s * 0.8, cy - s * 0.3);
    ctx.moveTo(cx - s * 0.8, cy + s * 0.3);
    ctx.lineTo(cx + s * 0.8, cy + s * 0.3);
    ctx.moveTo(cx - s * 0.25, cy - s * 0.8);
    ctx.lineTo(cx - s * 0.45, cy + s * 0.8);
    ctx.moveTo(cx + s * 0.45, cy - s * 0.8);
    ctx.lineTo(cx + s * 0.25, cy + s * 0.8);
  } else if (kind === "calendar") {
    ctx.rect(cx - s * 0.75, cy - s * 0.6, s * 1.5, s * 1.3);
    ctx.moveTo(cx - s * 0.75, cy - s * 0.15);
    ctx.lineTo(cx + s * 0.75, cy - s * 0.15);
    ctx.moveTo(cx - s * 0.35, cy - s * 0.95);
    ctx.lineTo(cx - s * 0.35, cy - s * 0.45);
    ctx.moveTo(cx + s * 0.35, cy - s * 0.95);
    ctx.lineTo(cx + s * 0.35, cy - s * 0.45);
  } else if (kind === "wallet") {
    ctx.rect(cx - s * 0.8, cy - s * 0.55, s * 1.6, s * 1.15);
    ctx.moveTo(cx + s * 0.25, cy + s * 0.05);
    ctx.lineTo(cx + s * 0.45, cy + s * 0.05);
  } else if (kind === "store") {
    ctx.moveTo(cx - s * 0.85, cy - s * 0.15);
    ctx.lineTo(cx - s * 0.6, cy - s * 0.75);
    ctx.lineTo(cx + s * 0.6, cy - s * 0.75);
    ctx.lineTo(cx + s * 0.85, cy - s * 0.15);
    ctx.moveTo(cx - s * 0.65, cy - s * 0.15);
    ctx.lineTo(cx - s * 0.65, cy + s * 0.8);
    ctx.lineTo(cx + s * 0.65, cy + s * 0.8);
    ctx.lineTo(cx + s * 0.65, cy - s * 0.15);
  } else if (kind === "user") {
    ctx.arc(cx, cy - s * 0.3, s * 0.4, 0, Math.PI * 2);
    ctx.moveTo(cx - s * 0.7, cy + s * 0.8);
    ctx.arc(cx, cy + s * 0.8, s * 0.7, Math.PI, 0);
  } else {
    ctx.arc(cx, cy, s * 0.82, 0, Math.PI * 2);
    ctx.moveTo(cx - s * 0.35, cy);
    ctx.lineTo(cx - s * 0.1, cy + s * 0.3);
    ctx.lineTo(cx + s * 0.42, cy - s * 0.32);
  }
  ctx.stroke();
  ctx.restore();
}

function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return `rgba(35,44,99,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ─── سربرگ ──────────────────────────────────────────────────────────────────

function drawHero(
  ctx: Ctx,
  inv: Invoice,
  pageNo: number,
  logoImg?: HTMLImageElement | null,
): number {
  const shopName = inv.shopName || "فروشگاه";
  const docTitle = invoiceDocumentTitle(inv);
  let y = MARGIN;

  if (pageNo > 1) {
    ctx.textAlign = "right";
    ctx.fillStyle = P.deep;
    ctx.font = `700 ${4.6 * SCALE}px ${FONT}`;
    ctx.fillText(shopName, PAGE_W - MARGIN, y + 4 * SCALE);
    ctx.textAlign = "left";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${3.2 * SCALE}px ${FONT}`;
    ctx.fillText(`ادامه ${docTitle} — ${inv.id.toUpperCase()}`, MARGIN, y + 4 * SCALE);
    y += 9 * SCALE;
    drawHairRule(ctx, y);
    return y + 5 * SCALE;
  }

  const brandRight = PAGE_W - MARGIN;
  let textX = brandRight;

  if (logoImg) {
    const box = 17 * SCALE;
    const ratio = Math.min(
      (box - 3 * SCALE) / logoImg.width,
      (box - 3 * SCALE) / logoImg.height,
      1,
    );
    const w = logoImg.width * ratio;
    const h = logoImg.height * ratio;
    const lx = brandRight - box;
    softCard(ctx, lx, y, box, box, 4.5 * SCALE);
    ctx.drawImage(logoImg, lx + (box - w) / 2, y + (box - h) / 2, w, h);
    textX = lx - 4 * SCALE;
  }

  const brandW = textX - MARGIN - 62 * SCALE;
  ctx.textAlign = "right";
  ctx.fillStyle = P.deep;
  ctx.font = `800 ${6.2 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, shopName, brandW), textX, y + 6 * SCALE);

  const contact = [inv.shopPhone, inv.shopAddress].filter(Boolean).join("  ·  ");
  if (contact) {
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${3.1 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, contact, brandW), textX, y + 13 * SCALE);
  }

  // عنوان سند — بزرگ‌ترین عنصر متنی سربرگ
  ctx.textAlign = "left";
  ctx.fillStyle = P.soft;
  ctx.font = `700 ${2.8 * SCALE}px ${FONT}`;
  ctx.fillText("سند مالی", MARGIN, y + 2.6 * SCALE);

  const titleGrad = ctx.createLinearGradient(MARGIN + 58 * SCALE, 0, MARGIN, 0);
  titleGrad.addColorStop(0, P.deep);
  titleGrad.addColorStop(0.6, P.accent);
  titleGrad.addColorStop(1, P.soft);
  ctx.fillStyle = titleGrad;
  ctx.font = `800 ${9.4 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, docTitle, 62 * SCALE), MARGIN, y + 10.5 * SCALE);

  ctx.fillStyle = P.muted;
  ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
  ctx.fillText("با سپاس از اعتماد شما", MARGIN, y + 16 * SCALE);

  y += 20 * SCALE;
  drawHairRule(ctx, y);
  return y + 5 * SCALE;
}

function drawHairRule(ctx: Ctx, y: number) {
  const g = ctx.createLinearGradient(PAGE_W - MARGIN, 0, MARGIN, 0);
  g.addColorStop(0, P.accent);
  g.addColorStop(0.45, withAlpha(P.accent, 0.3));
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 1.4);
}

// ─── کارت اطلاعات فاکتور ────────────────────────────────────────────────────

type MetaItem = { k: string; v: string; glyph: string; tone?: "ok" | "due" };

function metaItems(inv: Invoice): MetaItem[] {
  const t = invoiceTotals(inv);
  const out: MetaItem[] = [
    { k: "شماره فاکتور", v: inv.id.toUpperCase(), glyph: "hash" },
    { k: "تاریخ صدور", v: formatJalaliDateTime(inv.createdAt), glyph: "calendar" },
  ];
  if (inv.paymentMethod) {
    out.push({ k: "نوع فاکتور", v: PAYMENT_LABEL[inv.paymentMethod], glyph: "wallet" });
  }
  out.push(
    t.remaining > 0
      ? { k: "وضعیت", v: "دارای مانده", glyph: "seal", tone: "due" }
      : { k: "وضعیت", v: "تسویه شده", glyph: "seal", tone: "ok" },
  );
  return out;
}

function drawMetaCard(ctx: Ctx, y: number, inv: Invoice): number {
  const items = metaItems(inv);
  const h = 15 * SCALE;
  const w = PAGE_W - MARGIN * 2;
  softCard(ctx, MARGIN, y, w, h);

  // عرض هر خانه به اندازه‌ی متنش — تاریخ و ساعت جا بماند و کوتاه نشود
  ctx.font = `700 ${3.6 * SCALE}px ${FONT}`;
  const weights = items.map((it) => Math.max(18 * SCALE, ctx.measureText(it.v).width + 16 * SCALE));
  const weightSum = weights.reduce((s, x) => s + x, 0);
  const widths = weights.map((x) => (x / weightSum) * w);

  let offset = 0;
  items.forEach((it, i) => {
    const cellW = widths[i];
    const right = PAGE_W - MARGIN - offset;
    offset += cellW;
    if (i > 0) {
      ctx.strokeStyle = withAlpha(P.accent, 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(right, y + 3 * SCALE);
      ctx.lineTo(right, y + h - 3 * SCALE);
      ctx.stroke();
    }
    const badge = 8 * SCALE;
    const bx = right - 4 * SCALE - badge;
    roundRect(ctx, bx, y + (h - badge) / 2, badge, badge, 2.4 * SCALE);
    ctx.fillStyle = accentGradient(ctx, bx, y, badge, badge);
    ctx.fill();
    drawGlyph(ctx, it.glyph, bx + badge / 2, y + h / 2, badge * 0.62);

    const textRight = bx - 2.6 * SCALE;
    const textW = cellW - badge - 10 * SCALE;
    ctx.textAlign = "right";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${2.8 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, it.k, textW), textRight, y + 5.4 * SCALE);
    ctx.fillStyle = it.tone === "due" ? P.danger : it.tone === "ok" ? P.success : P.deep;
    ctx.font = `700 ${3.6 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, it.v, textW), textRight, y + 10.4 * SCALE);
  });

  return y + h + 4 * SCALE;
}

// ─── فروشنده و خریدار ───────────────────────────────────────────────────────

function drawParties(ctx: Ctx, y: number, inv: Invoice): number {
  const gap = 4 * SCALE;
  const boxW = (PAGE_W - MARGIN * 2 - gap) / 2;
  const seller: [string, string][] = [
    ["نام", inv.shopName || "فروشگاه"],
    ["تلفن", inv.shopPhone || "—"],
    ["نشانی", inv.shopAddress || "—"],
  ];
  const buyer: [string, string][] = [
    ["نام", customerDisplayName(inv) || "—"],
    ["تلفن", inv.customer?.phone || "—"],
    ["پرداخت", inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : "—"],
  ];
  const h = 27 * SCALE;

  const drawParty = (x: number, title: string, glyph: string, rows: [string, string][]) => {
    softCard(ctx, x, y, boxW, h);
    const dot = 6.8 * SCALE;
    const dx = x + boxW - 4 * SCALE - dot;
    ctx.beginPath();
    ctx.arc(dx + dot / 2, y + 6.5 * SCALE, dot / 2, 0, Math.PI * 2);
    ctx.fillStyle = accentGradient(ctx, dx, y, dot, dot);
    ctx.fill();
    drawGlyph(ctx, glyph, dx + dot / 2, y + 6.5 * SCALE, dot * 0.55);
    ctx.textAlign = "right";
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${3.4 * SCALE}px ${FONT}`;
    ctx.fillText(title, dx - 2.4 * SCALE, y + 6.5 * SCALE);

    let ly = y + 13 * SCALE;
    rows.forEach(([k, v], i) => {
      if (i > 0) {
        ctx.strokeStyle = withAlpha(P.accent, 0.08);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 4 * SCALE, ly - 3.2 * SCALE);
        ctx.lineTo(x + boxW - 4 * SCALE, ly - 3.2 * SCALE);
        ctx.stroke();
      }
      ctx.textAlign = "right";
      ctx.fillStyle = P.muted;
      ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
      ctx.fillText(k, x + boxW - 4 * SCALE, ly);
      ctx.fillStyle = P.ink;
      ctx.font = `600 ${3.3 * SCALE}px ${FONT}`;
      ctx.fillText(fitText(ctx, v, boxW - 22 * SCALE), x + boxW - 17 * SCALE, ly);
      ly += 6 * SCALE;
    });
  };

  drawParty(PAGE_W - MARGIN - boxW, "اطلاعات فروشنده", "store", seller);
  drawParty(MARGIN, "اطلاعات خریدار", "user", buyer);
  return y + h + 5 * SCALE;
}

// ─── جدول کالاها ────────────────────────────────────────────────────────────
// ستون‌ها از راست به چپ: ردیف | نام کالا / خدمات | تعداد | مبلغ واحد | مبلغ کل

function columns() {
  const inner = PAGE_W - MARGIN * 2;
  const idx = 11 * SCALE;
  const qty = 22 * SCALE;
  const unitPrice = 34 * SCALE;
  const total = 38 * SCALE;
  const name = inner - idx - qty - unitPrice - total;
  const xRight = PAGE_W - MARGIN;
  return {
    idx: { x: xRight, w: idx },
    name: { x: xRight - idx, w: name },
    qty: { x: xRight - idx - name, w: qty },
    unitPrice: { x: xRight - idx - name - qty, w: unitPrice },
    total: { x: xRight - idx - name - qty - unitPrice, w: total },
  };
}

const ROW_H = 10.5 * SCALE;
const HEAD_H = 12 * SCALE;
const SIG_H = 20 * SCALE;
const RADIUS = 3.5 * SCALE;

function drawTableHead(ctx: Ctx, y: number): number {
  const cols = columns();
  const w = PAGE_W - MARGIN * 2;
  ctx.save();
  roundRect(ctx, MARGIN, y, w, HEAD_H + RADIUS, RADIUS);
  ctx.clip();
  ctx.fillStyle = accentGradient(ctx, MARGIN, y, w, HEAD_H);
  ctx.fillRect(MARGIN, y, w, HEAD_H + RADIUS);
  ctx.restore();

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${3.5 * SCALE}px ${FONT}`;
  ctx.textAlign = "center";
  const cy = y + HEAD_H / 2;
  ctx.fillText("ردیف", cols.idx.x - cols.idx.w / 2, cy);
  ctx.fillText("نام کالا / خدمات", cols.name.x - cols.name.w / 2, cy);
  ctx.fillText("تعداد", cols.qty.x - cols.qty.w / 2, cy);
  ctx.fillText("مبلغ واحد", cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  ctx.fillText("مبلغ کل", cols.total.x - cols.total.w / 2, cy);
  return y + HEAD_H;
}

function drawRow(ctx: Ctx, y: number, i: number, item: Invoice["items"][number]): number {
  const cols = columns();
  const w = PAGE_W - MARGIN * 2;
  if (i % 2 === 1) {
    ctx.fillStyle = withAlpha(P.accent, 0.035);
    ctx.fillRect(MARGIN, y, w, ROW_H);
  }
  ctx.strokeStyle = withAlpha(P.accent, 0.1);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y + ROW_H);
  ctx.lineTo(MARGIN + w, y + ROW_H);
  ctx.stroke();

  const cy = y + ROW_H / 2;
  ctx.fillStyle = P.muted;
  ctx.font = `400 ${3.3 * SCALE}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(formatNumber(i + 1), cols.idx.x - cols.idx.w / 2, cy);

  ctx.fillStyle = P.ink;
  ctx.font = `400 ${3.5 * SCALE}px ${FONT}`;
  ctx.fillText(qtyWithUnit(item), cols.qty.x - cols.qty.w / 2, cy);
  ctx.fillText(formatAmount(item.price), cols.unitPrice.x - cols.unitPrice.w / 2, cy);

  ctx.font = `700 ${3.7 * SCALE}px ${FONT}`;
  ctx.fillStyle = P.accent;
  ctx.fillText(formatAmount(lineTotal(item)), cols.total.x - cols.total.w / 2, cy);

  ctx.fillStyle = P.deep;
  ctx.font = `700 ${3.6 * SCALE}px ${FONT}`;
  ctx.textAlign = "right";
  const name = item.discountPercent
    ? `${item.name}  (٪${formatNumber(item.discountPercent)} تخفیف)`
    : item.name;
  ctx.fillText(fitText(ctx, name, cols.name.w - 4 * SCALE), cols.name.x - 2 * SCALE, cy);

  return y + ROW_H;
}

// ─── جمع‌بندی، توضیحات و امضا ───────────────────────────────────────────────

const PAY_W = 78 * SCALE;

function payCardHeight(inv: Invoice): number {
  const lines = invoiceAmountLines(inv);
  const normal = lines.filter((l) => l.kind === "normal").length;
  const due = lines.some((l) => l.kind === "due") ? 10 * SCALE : 0;
  return 10 * SCALE + normal * 5.6 * SCALE + 20 * SCALE + due;
}

function drawPayCard(ctx: Ctx, y: number, inv: Invoice): number {
  const lines = invoiceAmountLines(inv);
  const grandAt = lines.findIndex((l) => l.kind === "grand");
  const grand = grandAt >= 0 ? lines[grandAt] : undefined;
  const before = lines.filter((l, i) => l.kind === "normal" && (grandAt < 0 || i < grandAt));
  const after = lines.filter((l, i) => l.kind === "normal" && grandAt >= 0 && i > grandAt);
  const due = lines.find((l) => l.kind === "due");

  const h = payCardHeight(inv);
  const x = PAGE_W - MARGIN - PAY_W;
  roundRect(ctx, x, y, PAY_W, h, 4.5 * SCALE);
  ctx.fillStyle = accentGradient(ctx, x, y, PAY_W, h);
  ctx.fill();

  let ly = y + 6 * SCALE;
  const row = (label: string, value: string) => {
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.font = `400 ${3.1 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, label, PAY_W * 0.55), x + PAY_W - 5 * SCALE, ly);
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${3.2 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, value, PAY_W * 0.45), x + 5 * SCALE, ly);
    ly += 5.6 * SCALE;
  };

  for (const l of before) row(l.label, l.value);

  if (grand) {
    const boxH = 17 * SCALE;
    const bx = x + 4 * SCALE;
    const bw = PAY_W - 8 * SCALE;
    roundRect(ctx, bx, ly - 1.5 * SCALE, bw, boxH, 3 * SCALE);
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.26)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,.86)";
    ctx.font = `600 ${2.9 * SCALE}px ${FONT}`;
    ctx.fillText("مبلغ قابل پرداخت", bx + bw - 4 * SCALE, ly + 3.4 * SCALE);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${6.2 * SCALE}px ${FONT}`;
    const amountText = fitText(ctx, grand.amount, bw - 22 * SCALE);
    ctx.fillText(amountText, bx + bw - 4 * SCALE, ly + 10.8 * SCALE);
    const amountW = ctx.measureText(amountText).width;
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = `600 ${2.9 * SCALE}px ${FONT}`;
    ctx.fillText(grand.currency, bx + bw - 6 * SCALE - amountW, ly + 11.4 * SCALE);
    ly += boxH + 2.5 * SCALE;
  }

  for (const l of after) row(l.label, l.value);

  if (due) {
    const boxH = 8 * SCALE;
    const bx = x + 4 * SCALE;
    const bw = PAY_W - 8 * SCALE;
    roundRect(ctx, bx, ly - 1 * SCALE, bw, boxH, 2.6 * SCALE);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.textAlign = "right";
    ctx.fillStyle = P.danger;
    ctx.font = `700 ${3.2 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, due.label, bw * 0.5), bx + bw - 4 * SCALE, ly + 3 * SCALE);
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, due.value, bw * 0.46), bx + 4 * SCALE, ly + 3 * SCALE);
    ly += boxH + 1 * SCALE;
  }

  return y + h;
}

function drawSideColumn(ctx: Ctx, y: number, inv: Invoice, maxH: number): number {
  const w = PAGE_W - MARGIN * 2 - PAY_W - 5 * SCALE;
  const x = MARGIN;
  let ly = y;

  const noteH = Math.min(maxH - SIG_H - 4 * SCALE, 20 * SCALE);
  if (inv.notes && noteH > 11 * SCALE) {
    softCard(ctx, x, ly, w, noteH);
    ctx.textAlign = "right";
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${3.2 * SCALE}px ${FONT}`;
    ctx.fillText("توضیحات", x + w - 4 * SCALE, ly + 5.5 * SCALE);
    ctx.fillStyle = P.ink;
    ctx.font = `400 ${3.2 * SCALE}px ${FONT}`;
    const maxW = w - 8 * SCALE;
    const maxLines = Math.max(1, Math.floor((noteH - 9 * SCALE) / (4.6 * SCALE)));
    const wrapped = wrapText(ctx, inv.notes, maxW, maxLines);
    wrapped.forEach((line, idx) => {
      ctx.fillText(line, x + w - 4 * SCALE, ly + 11.5 * SCALE + idx * 4.6 * SCALE);
    });
    ly += noteH + 4 * SCALE;
  }

  const sigW = (w - 4 * SCALE) / 2;
  const sigY = Math.max(ly, y + maxH - SIG_H);
  const drawSign = (sx: number, label: string) => {
    softCard(ctx, sx, sigY, sigW, SIG_H);
    ctx.textAlign = "right";
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${3 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, label, sigW - 6 * SCALE), sx + sigW - 3.5 * SCALE, sigY + 5 * SCALE);
  };
  drawSign(x + sigW + 4 * SCALE, "مهر و امضای فروشنده");
  drawSign(x, "امضای خریدار");

  return sigY + SIG_H;
}

function closingHeight(inv: Invoice): number {
  return Math.max(payCardHeight(inv), (inv.notes ? 24 * SCALE : 0) + SIG_H) + 4 * SCALE;
}

// ─── پانویس ─────────────────────────────────────────────────────────────────

function drawFooter(ctx: Ctx, inv: Invoice, pageNo: number, pageCount: number) {
  const shopName = inv.shopName || "فروشگاه";
  const bandH = 9 * SCALE;
  const top = PAGE_H - bandH;
  const waveTop = top - 7 * SCALE;

  ctx.beginPath();
  ctx.moveTo(0, waveTop + 5 * SCALE);
  ctx.bezierCurveTo(
    PAGE_W * 0.28,
    waveTop - 4 * SCALE,
    PAGE_W * 0.52,
    waveTop + 9 * SCALE,
    PAGE_W,
    waveTop + 1.5 * SCALE,
  );
  ctx.lineTo(PAGE_W, PAGE_H);
  ctx.lineTo(0, PAGE_H);
  ctx.closePath();
  ctx.fillStyle = withAlpha(P.accent, 0.3);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, waveTop + 9 * SCALE);
  ctx.bezierCurveTo(
    PAGE_W * 0.3,
    waveTop + 2 * SCALE,
    PAGE_W * 0.58,
    waveTop + 12 * SCALE,
    PAGE_W,
    waveTop + 6 * SCALE,
  );
  ctx.lineTo(PAGE_W, PAGE_H);
  ctx.lineTo(0, PAGE_H);
  ctx.closePath();
  ctx.fillStyle = P.deep;
  ctx.fill();

  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${3.1 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, shopName, 70 * SCALE), PAGE_W - MARGIN, top + bandH / 2);

  const ways = [inv.shopPhone, inv.shopAddress].filter(Boolean).join("  ·  ");
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = `400 ${2.8 * SCALE}px ${FONT}`;
  const tail =
    pageCount > 1
      ? `صفحه ${formatNumber(pageNo)} از ${formatNumber(pageCount)}`
      : "با سپاس از اعتماد شما";
  ctx.fillText(
    fitText(ctx, ways ? `${ways}  ·  ${tail}` : tail, 120 * SCALE),
    MARGIN,
    top + bandH / 2,
  );
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
      y = drawMetaCard(ctx, y, inv);
      y = drawParties(ctx, y, inv);
    }
    y = drawTableHead(ctx, y);

    const closing = closingHeight(inv);
    const bottomLimit = PAGE_H - FOOTER_H;
    while (i < items.length && y + ROW_H + closing <= bottomLimit) {
      y = drawRow(ctx, y, i, items[i]);
      i++;
    }

    const isLast = i >= items.length;
    if (isLast) {
      const closeY = y + 5 * SCALE;
      const boxH = closingHeight(inv) - 4 * SCALE;
      drawPayCard(ctx, closeY, inv);
      drawSideColumn(ctx, closeY, inv, boxH);
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
