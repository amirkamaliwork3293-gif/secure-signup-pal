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
  formatJalaliDate,
  formatJalaliDateTime,
  formatChequeDue,
  currencyLabel,
  amountInDisplayUnit,
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

const SCALE = 6;
const PAGE_W = 210 * SCALE;
const PAGE_H = 297 * SCALE;
const MARGIN = 14 * SCALE;
const FONT = "Vazirmatn, Tahoma, 'Segoe UI', sans-serif";
const FOOTER_H = 16 * SCALE;
const INNER_W = PAGE_W - MARGIN * 2;
const FRAME = 4 * SCALE;
// صفحه سفید و بدون قاب تزئینی — همان طراحی فاکتور چاپی (invoice-document.ts)

const P = invoicePalette(DEFAULT_INVOICE_ACCENT);
/** خط جدول/کادر — تیره تا روی چاپ سیاه‌وسفید دیده شود (همان HTML چاپی) */
const RULE = P.line;
const LABEL = P.bronze;

type Ctx = CanvasRenderingContext2D;

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

function hLine(ctx: Ctx, x1: number, x2: number, y: number, color: string, width = 1.2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

function vLine(ctx: Ctx, x: number, y1: number, y2: number, color: string, width = 1.2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x, y2);
  ctx.stroke();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function box(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; stroke?: string; width?: number } = {},
) {
  roundRect(ctx, x, y, w, h, 1.2 * SCALE);
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.fill();
  }
  ctx.strokeStyle = opts.stroke ?? RULE;
  ctx.lineWidth = opts.width ?? 1.4;
  ctx.stroke();
}

function fitText(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

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

function newPage(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.direction = "rtl";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  return { canvas, ctx };
}

/** «برچسب: مقدار» راست‌چین */
function drawKv(
  ctx: Ctx,
  right: number,
  y: number,
  k: string,
  v: string,
  maxW: number,
  size = 3.2,
) {
  ctx.textAlign = "right";
  ctx.fillStyle = LABEL;
  ctx.font = `400 ${size * SCALE}px ${FONT}`;
  const label = `${k}:`;
  ctx.fillText(label, right, y);
  const kw = ctx.measureText(label).width;
  ctx.fillStyle = P.ink;
  ctx.font = `700 ${size * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, v, maxW - kw - 2 * SCALE), right - kw - 1.6 * SCALE, y);
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
    ctx.fillStyle = LABEL;
    ctx.font = `400 ${3 * SCALE}px ${FONT}`;
    ctx.fillText(`ادامه ${docTitle} — ${inv.id.toUpperCase()}`, MARGIN, y + 3 * SCALE);
    hLine(ctx, MARGIN, PAGE_W - MARGIN, y + 8 * SCALE, P.accent, 2.4);
    return y + 12 * SCALE;
  }

  // لوگو یا حرف اول در کادر
  const lb = 17 * SCALE;
  const lx = PAGE_W - MARGIN - lb;
  box(ctx, lx, y, lb, lb, { stroke: P.ink, width: 1.8 });
  if (logoImg) {
    const inner = lb - 2 * SCALE;
    const ratio = Math.min(inner / logoImg.width, inner / logoImg.height, 1);
    const w = logoImg.width * ratio;
    const h = logoImg.height * ratio;
    ctx.drawImage(logoImg, lx + (lb - w) / 2, y + (lb - h) / 2, w, h);
  } else {
    ctx.textAlign = "center";
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${8 * SCALE}px ${FONT}`;
    ctx.fillText(shopName.trim().charAt(0) || "ف", lx + lb / 2, y + lb / 2 + 0.6 * SCALE);
  }

  const titleW = 58 * SCALE;
  const textX = lx - 4 * SCALE;
  const brandW = textX - MARGIN - titleW - 6 * SCALE;
  ctx.textAlign = "right";
  ctx.fillStyle = P.ink;
  ctx.font = `700 ${5.8 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, shopName, brandW), textX, y + 5.6 * SCALE);
  ctx.fillStyle = LABEL;
  ctx.font = `400 ${3 * SCALE}px ${FONT}`;
  const contact = [inv.shopPhone, inv.shopAddress].filter(Boolean).join("  ·  ");
  if (contact) {
    wrapText(ctx, contact, brandW, 2).forEach((line, i) =>
      ctx.fillText(line, textX, y + 11.6 * SCALE + i * 4.2 * SCALE),
    );
  }

  // کادر عنوان: نوار رنگی + شماره و تاریخ
  const tx = MARGIN;
  const th = 22 * SCALE;
  box(ctx, tx, y - 2 * SCALE, titleW, th, { stroke: P.ink, width: 1.8 });
  ctx.save();
  roundRect(ctx, tx, y - 2 * SCALE, titleW, 8.5 * SCALE, 1.2 * SCALE);
  ctx.clip();
  ctx.fillStyle = P.accent;
  ctx.fillRect(tx, y - 2 * SCALE, titleW, 8.5 * SCALE);
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${4.6 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, docTitle, titleW - 4 * SCALE), tx + titleW / 2, y + 2.3 * SCALE);
  const row = (k: string, v: string, ry: number) => {
    ctx.textAlign = "right";
    ctx.fillStyle = LABEL;
    ctx.font = `400 ${3 * SCALE}px ${FONT}`;
    ctx.fillText(k, tx + titleW - 3 * SCALE, ry);
    ctx.textAlign = "left";
    ctx.fillStyle = P.ink;
    ctx.font = `700 ${3.1 * SCALE}px ${FONT}`;
    ctx.fillText(v, tx + 3 * SCALE, ry);
  };
  row("شماره", inv.id.toUpperCase(), y + 10.8 * SCALE);
  row("تاریخ", formatJalaliDate(inv.createdAt), y + 16 * SCALE);

  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + 23 * SCALE, P.accent, 2.6);
  return y + 27 * SCALE;
}

type MetaItem = { k: string; v: string; tone?: "ok" | "due" };

function metaItems(inv: Invoice): MetaItem[] {
  const t = invoiceTotals(inv);
  const out: MetaItem[] = [{ k: "تاریخ و ساعت", v: formatJalaliDateTime(inv.createdAt) }];
  const due = invoiceCheques(inv)
    .map((c) => c.dueDate)
    .filter((d): d is string => !!d)
    .sort()[0];
  if (due) out.push({ k: "سررسید چک", v: formatChequeDue(due) });
  if (inv.paymentMethod) out.push({ k: "نوع پرداخت", v: PAYMENT_LABEL[inv.paymentMethod] });
  out.push({ k: "تعداد اقلام", v: formatNumber(inv.items.length) });
  if (t.remaining > 0) out.push({ k: "وضعیت", v: "دارای مانده", tone: "due" });
  return out;
}

function drawFacts(ctx: Ctx, y: number, inv: Invoice): number {
  const items = metaItems(inv);
  const h = 11 * SCALE;
  box(ctx, MARGIN, y, INNER_W, h);
  const slot = INNER_W / items.length;
  items.forEach((it, i) => {
    const right = PAGE_W - MARGIN - i * slot;
    if (i > 0) vLine(ctx, right, y, y + h, RULE);
    ctx.textAlign = "right";
    ctx.fillStyle = LABEL;
    ctx.font = `400 ${2.7 * SCALE}px ${FONT}`;
    ctx.fillText(it.k, right - 2.5 * SCALE, y + 3.2 * SCALE);
    ctx.fillStyle = it.tone === "due" ? P.danger : it.tone === "ok" ? P.success : P.ink;
    ctx.font = `700 ${3.3 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, it.v, slot - 5 * SCALE), right - 2.5 * SCALE, y + 7.6 * SCALE);
  });
  return y + h + 4 * SCALE;
}

function drawParties(ctx: Ctx, y: number, inv: Invoice): number {
  const gap = 5 * SCALE;
  const boxW = (INNER_W - gap) / 2;
  const sellerRows: [string, string | undefined][] = [
    ["تلفن", inv.shopPhone],
    ["نشانی", inv.shopAddress],
  ];
  const buyerRows: [string, string | undefined][] = [
    ["تلفن", inv.customer?.phone],
    ...(inv.customerFields ?? []).map((f): [string, string] => [f.label, f.value]),
  ];
  const filled = (r: [string, string | undefined][]) => r.filter(([, v]) => v && v.trim());
  const rowsN = Math.max(filled(sellerRows).length, filled(buyerRows).length);
  const head = 7 * SCALE;
  const h = head + 9 * SCALE + rowsN * 4.8 * SCALE + 2 * SCALE;

  const drawParty = (
    x: number,
    kicker: string,
    name: string,
    rows: [string, string | undefined][],
  ) => {
    box(ctx, x, y, boxW, h);
    ctx.save();
    roundRect(ctx, x, y, boxW, head, 1.2 * SCALE);
    ctx.clip();
    ctx.fillStyle = P.wash;
    ctx.fillRect(x, y, boxW, head);
    ctx.restore();
    hLine(ctx, x, x + boxW, y + head, RULE);
    const right = x + boxW - 3 * SCALE;
    ctx.textAlign = "right";
    ctx.fillStyle = P.ink;
    ctx.font = `700 ${3.1 * SCALE}px ${FONT}`;
    ctx.fillText(kicker, right, y + head / 2);
    ctx.font = `700 ${4.2 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, name || "—", boxW - 6 * SCALE), right, y + head + 5 * SCALE);
    let ly = y + head + 10.4 * SCALE;
    for (const [k, v] of filled(rows)) {
      drawKv(ctx, right, ly, k, (v as string).trim(), boxW - 6 * SCALE, 3);
      ly += 4.8 * SCALE;
    }
  };
  drawParty(PAGE_W - MARGIN - boxW, "مشخصات فروشنده", inv.shopName || "فروشگاه", sellerRows);
  drawParty(MARGIN, "مشخصات خریدار", customerDisplayName(inv), buyerRows);
  return y + h + 5 * SCALE;
}

function columns() {
  const idx = 11 * SCALE;
  const qty = 24 * SCALE;
  const unitPrice = 33 * SCALE;
  const total = 36 * SCALE;
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
const HEAD_H = 9 * SCALE;
const SIGN_H = 22 * SCALE;

function colEdges(): number[] {
  const c = columns();
  return [c.idx.x, c.name.x, c.qty.x, c.unitPrice.x, c.total.x, c.total.x - c.total.w];
}

function drawTableHead(ctx: Ctx, y: number): number {
  const cols = columns();
  const cur = currencyLabel();
  ctx.fillStyle = P.wash;
  ctx.fillRect(MARGIN, y, INNER_W, HEAD_H);
  ctx.fillStyle = P.ink;
  ctx.font = `700 ${2.9 * SCALE}px ${FONT}`;
  const cy = y + HEAD_H / 2;
  ctx.textAlign = "center";
  ctx.fillText("ردیف", cols.idx.x - cols.idx.w / 2, cy);
  ctx.fillText("تعداد / مقدار", cols.qty.x - cols.qty.w / 2, cy);
  ctx.fillText(`مبلغ واحد (${cur})`, cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  ctx.fillText(`مبلغ کل (${cur})`, cols.total.x - cols.total.w / 2, cy);
  ctx.fillText("شرح کالا / خدمات", cols.name.x - cols.name.w / 2, cy);
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(MARGIN, y, INNER_W, HEAD_H);
  for (const x of colEdges().slice(1, -1)) vLine(ctx, x, y, y + HEAD_H, RULE);
  return y + HEAD_H;
}

function drawRow(ctx: Ctx, y: number, i: number, item: Invoice["items"][number]): number {
  const cols = columns();
  const cy = y + ROW_H / 2;
  // شبکهٔ کامل جدول
  for (const x of colEdges())
    vLine(
      ctx,
      x,
      y,
      y + ROW_H,
      x === colEdges()[0] || x === colEdges()[5] ? P.ink : RULE,
      x === colEdges()[0] || x === colEdges()[5] ? 1.8 : 1.2,
    );
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + ROW_H, RULE);

  ctx.textAlign = "center";
  ctx.fillStyle = P.ink;
  ctx.font = `700 ${3.1 * SCALE}px ${FONT}`;
  ctx.fillText(formatNumber(i + 1), cols.idx.x - cols.idx.w / 2, cy);
  ctx.font = `400 ${3.3 * SCALE}px ${FONT}`;
  ctx.fillText(qtyWithUnit(item), cols.qty.x - cols.qty.w / 2, cy);

  if (item.originalPrice) {
    ctx.fillText(
      formatAmount(item.price),
      cols.unitPrice.x - cols.unitPrice.w / 2,
      cy - 1.8 * SCALE,
    );
    ctx.fillStyle = LABEL;
    ctx.font = `400 ${2.7 * SCALE}px ${FONT}`;
    const was = formatAmount(item.originalPrice);
    const wy = cy + 2.6 * SCALE;
    const wx = cols.unitPrice.x - cols.unitPrice.w / 2;
    ctx.fillText(was, wx, wy);
    const ww = ctx.measureText(was).width;
    hLine(ctx, wx - ww / 2, wx + ww / 2, wy, LABEL);
  } else {
    ctx.fillText(formatAmount(item.price), cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  }

  ctx.fillStyle = P.ink;
  ctx.font = `700 ${3.4 * SCALE}px ${FONT}`;
  ctx.fillText(formatAmount(lineTotal(item)), cols.total.x - cols.total.w / 2, cy);

  ctx.textAlign = "right";
  const nameRight = cols.name.x - 2.5 * SCALE;
  const nameW = cols.name.w - 5 * SCALE;
  ctx.fillStyle = P.ink;
  ctx.font = `700 ${3.3 * SCALE}px ${FONT}`;
  if (item.discountPercent) {
    ctx.fillText(fitText(ctx, item.name, nameW), nameRight, cy - 2 * SCALE);
    ctx.font = `400 ${2.7 * SCALE}px ${FONT}`;
    ctx.fillText(`٪${formatNumber(item.discountPercent)} تخفیف`, nameRight, cy + 2.8 * SCALE);
  } else {
    ctx.fillText(fitText(ctx, item.name, nameW), nameRight, cy);
  }
  return y + ROW_H;
}

const PAY_ROW_H = 6.4 * SCALE;
const GRAND_H = 10 * SCALE;
const TOTALS_W = 82 * SCALE;

function payWordsLines(inv: Invoice): string[] {
  const t = invoiceTotals(inv);
  const words = amountInDisplayUnit(t.total).wordsText;
  if (!words) return [];
  const ctx = measurer();
  ctx.font = `400 ${3 * SCALE}px ${FONT}`;
  return wrapText(ctx, `مبلغ به حروف: ${words}`, INNER_W - TOTALS_W - 12 * SCALE, 4);
}

function folioHeight(inv: Invoice): number {
  const lines = invoiceAmountLines(inv);
  const body = lines.reduce((s, l) => s + (l.kind === "grand" ? GRAND_H : PAY_ROW_H), 0);
  const words = payWordsLines(inv);
  return Math.max(body, words.length * 4.6 * SCALE + 5 * SCALE);
}

function drawFolio(ctx: Ctx, y: number, inv: Invoice): number {
  const all = invoiceAmountLines(inv);
  const h = folioHeight(inv);
  const tx = MARGIN;
  // کادر جمع‌ها (سمت چپ)
  let ly = y;
  const bodyH = all.reduce((s, l) => s + (l.kind === "grand" ? GRAND_H : PAY_ROW_H), 0);
  box(ctx, tx, y, TOTALS_W, bodyH, { stroke: P.ink, width: 1.8 });
  all.forEach((l, i) => {
    const rh = l.kind === "grand" ? GRAND_H : PAY_ROW_H;
    if (l.kind === "grand") {
      ctx.fillStyle = P.tint;
      ctx.fillRect(tx + 1, ly + 1, TOTALS_W - 2, rh - 2);
      if (i > 0) hLine(ctx, tx, tx + TOTALS_W, ly, P.ink, 2.4);
      if (i < all.length - 1) hLine(ctx, tx, tx + TOTALS_W, ly + rh, P.ink, 2.4);
    } else if (i > 0 && all[i - 1].kind !== "grand") {
      hLine(ctx, tx, tx + TOTALS_W, ly, RULE);
    }
    const cy = ly + rh / 2;
    const isDue = l.kind === "due";
    ctx.textAlign = "right";
    ctx.fillStyle = isDue ? P.danger : l.kind === "grand" ? P.ink : LABEL;
    ctx.font = `${l.kind === "normal" ? 400 : 700} ${(l.kind === "grand" ? 3.6 : 3.1) * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, l.label, TOTALS_W * 0.5), tx + TOTALS_W - 3 * SCALE, cy);
    ctx.textAlign = "left";
    ctx.fillStyle = isDue ? P.danger : P.ink;
    ctx.font = `700 ${(l.kind === "grand" ? 4.8 : 3.2) * SCALE}px ${FONT}`;
    ctx.fillText(l.kind === "grand" ? `${l.amount} ${l.currency}` : l.value, tx + 3 * SCALE, cy);
    ly += rh;
  });

  // مبلغ به حروف (سمت راست)
  const words = payWordsLines(inv);
  const wx = tx + TOTALS_W + 6 * SCALE;
  const ww = PAGE_W - MARGIN - wx;
  if (words.length) {
    const wh = words.length * 4.6 * SCALE + 4 * SCALE;
    box(ctx, wx, y, ww, wh);
    ctx.textAlign = "right";
    ctx.fillStyle = P.ink;
    ctx.font = `400 ${3 * SCALE}px ${FONT}`;
    words.forEach((line, i) =>
      ctx.fillText(line, PAGE_W - MARGIN - 3 * SCALE, y + 4.4 * SCALE + i * 4.6 * SCALE),
    );
  }
  return y + h;
}

function closingHeight(inv: Invoice): number {
  return SIGN_H + (inv.notes ? 0 : 0) + 4 * SCALE;
}

function drawClosing(ctx: Ctx, y: number, inv: Invoice) {
  const gap = 5 * SCALE;
  const half = (INNER_W - gap) / 2;
  if (inv.notes) {
    const x = PAGE_W - MARGIN - half;
    box(ctx, x, y, half, SIGN_H);
    const right = x + half - 3 * SCALE;
    ctx.textAlign = "right";
    ctx.fillStyle = P.ink;
    ctx.font = `700 ${3 * SCALE}px ${FONT}`;
    ctx.fillText("توضیحات", right, y + 4 * SCALE);
    ctx.font = `400 ${3 * SCALE}px ${FONT}`;
    wrapText(ctx, inv.notes, half - 6 * SCALE, 3).forEach((line, i) => {
      ctx.fillText(line, right, y + 9 * SCALE + i * 4.4 * SCALE);
    });
  }
  const signW = (half - gap) / 2;
  const drawSign = (sx: number, label: string) => {
    box(ctx, sx, y, signW, SIGN_H);
    ctx.textAlign = "center";
    ctx.fillStyle = LABEL;
    ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
    ctx.fillText(label, sx + signW / 2, y + SIGN_H - 3.6 * SCALE);
  };
  drawSign(MARGIN + signW + gap, "مهر و امضای فروشنده");
  drawSign(MARGIN, "امضای خریدار");
}

function drawFooter(ctx: Ctx, inv: Invoice, pageNo: number, pageCount: number) {
  const shopName = inv.shopName || "فروشگاه";
  const y = PAGE_H - 10 * SCALE;
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y - 4.5 * SCALE, RULE);
  ctx.textAlign = "right";
  ctx.fillStyle = P.ink;
  ctx.font = `700 ${2.9 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, shopName, 70 * SCALE), PAGE_W - MARGIN, y);
  const ways = [inv.shopPhone, inv.shopAddress].filter(Boolean).join("  ·  ");
  const tail = pageCount > 1 ? `صفحه ${formatNumber(pageNo)} از ${formatNumber(pageCount)}` : "";
  const text = [ways, tail].filter(Boolean).join("  ·  ");
  if (text) {
    ctx.textAlign = "left";
    ctx.fillStyle = LABEL;
    ctx.font = `400 ${2.8 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, text, 120 * SCALE), MARGIN, y);
  }
}

/** پیش از کشیدن، وزیرمتن معمولی و پررنگ واقعاً بارگذاری شود (وگرنه canvas با Tahoma می‌کشد) */
async function ensureCanvasFonts() {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    await Promise.race([
      Promise.all([fonts.load(`400 16px Vazirmatn`), fonts.load(`700 16px Vazirmatn`)]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    if (fonts.check(`700 16px Vazirmatn`)) return;
    // CDN در دسترس نبود: فونت همراه برنامه
    for (const [w, file] of [
      ["400", "Vazirmatn-Regular.woff2"],
      ["700", "Vazirmatn-Bold.woff2"],
    ] as const) {
      const face = new FontFace("Vazirmatn", `url(/fonts/${file})`, { weight: w });
      await face.load();
      fonts.add(face);
    }
  } catch {
    /* با فونت جایگزین ادامه می‌دهیم */
  }
}

async function renderInvoiceCanvases(inv: Invoice): Promise<HTMLCanvasElement[]> {
  await ensureCanvasFonts();

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
      y = drawFacts(ctx, y, inv);
      y = drawParties(ctx, y, inv);
    }
    y = drawTableHead(ctx, y);

    const closing = folioHeight(inv) + closingHeight(inv) + 8 * SCALE;
    const bottomLimit = PAGE_H - FOOTER_H - FRAME;
    while (i < items.length && y + ROW_H + closing <= bottomLimit) {
      y = drawRow(ctx, y, i, items[i]);
      i++;
    }

    const isLast = i >= items.length;
    if (isLast) {
      const after = drawFolio(ctx, y + 5 * SCALE, inv);
      drawClosing(ctx, after + 6 * SCALE, inv);
    }

    pages.push(page);
    if (isLast) break;
    pageNo++;
  }

  pages.forEach((p, idx) => drawFooter(p.ctx, inv, idx + 1, pages.length));
  return pages.map((p) => p.canvas);
}

export async function buildInvoiceImageDataUrls(inv: Invoice): Promise<string[]> {
  const pages = await renderInvoiceCanvases(inv);
  return pages.map((c) => c.toDataURL("image/jpeg", 0.92));
}

export async function buildInvoicePdf(inv: Invoice): Promise<jsPDF> {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pages = await renderInvoiceCanvases(inv);
  pages.forEach((canvas, idx) => {
    if (idx > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
  });
  return pdf;
}
