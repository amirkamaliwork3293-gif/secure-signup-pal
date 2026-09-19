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

const SCALE = 6;
const PAGE_W = 210 * SCALE;
const PAGE_H = 297 * SCALE;
const MARGIN = 14 * SCALE;
const FONT = "Vazirmatn, Tahoma, 'Segoe UI', sans-serif";
const FOOTER_H = 16 * SCALE;
const INNER_W = PAGE_W - MARGIN * 2;
const FRAME = 4 * SCALE;

const P = invoicePalette(DEFAULT_INVOICE_ACCENT);
const PAPER = P.paper;
const GOLD = P.gold;
const BRONZE = P.bronze;

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

function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return `rgba(196,165,116,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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

/** ستارهٔ هشت‌پر توپر */
function drawShamse(ctx: Ctx, cx: number, cy: number, size: number) {
  const outer = size * 0.5;
  const inner = size * 0.22;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const ang = ((-90 + i * 22.5) * Math.PI) / 180;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.restore();
}

function drawCornerL(ctx: Ctx, x: number, y: number, dx: number, dy: number, len: number) {
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x + dx * len, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + dy * len);
  ctx.stroke();
}

function newPage(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.direction = "rtl";
  ctx.textBaseline = "middle";
  drawPageFrame(ctx);
  return { canvas, ctx };
}

function drawPageFrame(ctx: Ctx) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(3 * SCALE, 3 * SCALE, PAGE_W - 6 * SCALE, PAGE_H - 6 * SCALE);
  ctx.strokeStyle = withAlpha(P.accent, 0.35);
  ctx.lineWidth = 1.1;
  ctx.strokeRect(6.5 * SCALE, 6.5 * SCALE, PAGE_W - 13 * SCALE, PAGE_H - 13 * SCALE);
  const pad = 9 * SCALE;
  const len = 7 * SCALE;
  drawCornerL(ctx, pad, pad, 1, 1, len);
  drawCornerL(ctx, PAGE_W - pad, pad, -1, 1, len);
  drawCornerL(ctx, pad, PAGE_H - pad, 1, -1, len);
  drawCornerL(ctx, PAGE_W - pad, PAGE_H - pad, -1, -1, len);
}

function drawOrnament(ctx: Ctx, y: number): number {
  const mid = PAGE_W / 2;
  drawShamse(ctx, mid, y + 3 * SCALE, 7 * SCALE);
  hLine(ctx, MARGIN, mid - 8 * SCALE, y + 3 * SCALE, GOLD, 1.2);
  hLine(ctx, mid + 8 * SCALE, PAGE_W - MARGIN, y + 3 * SCALE, GOLD, 1.2);
  hLine(ctx, MARGIN, mid - 8 * SCALE, y + 4.4 * SCALE, withAlpha(P.accent, 0.35), 1);
  hLine(ctx, mid + 8 * SCALE, PAGE_W - MARGIN, y + 4.4 * SCALE, withAlpha(P.accent, 0.35), 1);
  return y + 9 * SCALE;
}

function drawMonogram(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  inv: Invoice,
  logoImg?: HTMLImageElement | null,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = P.accent;
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = GOLD;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2.2 * SCALE, 0, Math.PI * 2);
  ctx.strokeStyle = withAlpha(GOLD, 0.55);
  ctx.lineWidth = 1.1;
  ctx.stroke();
  if (logoImg) {
    const box = r * 1.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.2 * SCALE, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    const ratio = Math.min(box / logoImg.width, box / logoImg.height, 1);
    const w = logoImg.width * ratio;
    const h = logoImg.height * ratio;
    ctx.drawImage(logoImg, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
    return;
  }
  const ch = (inv.shopName || "ف").trim().charAt(0) || "ف";
  ctx.textAlign = "center";
  ctx.fillStyle = GOLD;
  ctx.font = `800 ${r * 0.95}px ${FONT}`;
  ctx.fillText(ch, cx, cy + r * 0.06);
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
    ctx.font = `800 ${4.2 * SCALE}px ${FONT}`;
    ctx.fillText(shopName, PAGE_W - MARGIN, y + 3 * SCALE);
    ctx.textAlign = "left";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${3 * SCALE}px ${FONT}`;
    ctx.fillText(`ادامه ${docTitle} — ${inv.id.toUpperCase()}`, MARGIN, y + 3 * SCALE);
    return drawOrnament(ctx, y + 7 * SCALE);
  }

  const r = 8.2 * SCALE;
  const cx = PAGE_W - MARGIN - r;
  const cy = y + r;
  drawMonogram(ctx, cx, cy, r, inv, logoImg);

  const textX = cx - r - 3.5 * SCALE;
  const brandW = textX - MARGIN - 58 * SCALE;
  ctx.textAlign = "right";
  ctx.fillStyle = P.ink;
  ctx.font = `800 ${5.2 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, shopName, brandW), textX, y + 5.2 * SCALE);

  ctx.fillStyle = P.muted;
  ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
  const contact = [inv.shopPhone, inv.shopAddress].filter(Boolean).join("  ·  ");
  if (contact) ctx.fillText(fitText(ctx, contact, brandW), textX, y + 11.2 * SCALE);

  ctx.textAlign = "left";
  ctx.fillStyle = BRONZE;
  ctx.font = `700 ${2.8 * SCALE}px ${FONT}`;
  ctx.fillText("سند فروش", MARGIN, y + 3.4 * SCALE);
  ctx.fillStyle = P.accent;
  ctx.font = `800 ${8.4 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, docTitle, 62 * SCALE), MARGIN, y + 10.4 * SCALE);
  ctx.fillStyle = BRONZE;
  ctx.font = `700 ${3 * SCALE}px ${FONT}`;
  ctx.fillText(inv.id.toUpperCase(), MARGIN, y + 16.4 * SCALE);

  return drawOrnament(ctx, y + 20 * SCALE);
}

type MetaItem = { k: string; v: string; tone?: "ok" | "due" };

function metaItems(inv: Invoice): MetaItem[] {
  const t = invoiceTotals(inv);
  const out: MetaItem[] = [{ k: "تاریخ", v: formatJalaliDateTime(inv.createdAt) }];
  const due = invoiceCheques(inv)
    .map((c) => c.dueDate)
    .filter((d): d is string => !!d)
    .sort()[0];
  if (due) out.push({ k: "سررسید چک", v: formatChequeDue(due) });
  if (inv.paymentMethod) out.push({ k: "نوع", v: PAYMENT_LABEL[inv.paymentMethod] });
  out.push({ k: "اقلام", v: formatNumber(inv.items.length) });
  out.push(
    t.remaining > 0
      ? { k: "وضعیت", v: "دارای مانده", tone: "due" }
      : { k: "وضعیت", v: "تسویه شده", tone: "ok" },
  );
  return out;
}

function drawFacts(ctx: Ctx, y: number, inv: Invoice): number {
  const items = metaItems(inv);
  const slot = INNER_W / items.length;
  items.forEach((it, i) => {
    const right = PAGE_W - MARGIN - i * slot;
    ctx.textAlign = "right";
    ctx.fillStyle = BRONZE;
    ctx.font = `700 ${2.8 * SCALE}px ${FONT}`;
    ctx.fillText(it.k, right, y + 2.2 * SCALE);
    const kw = ctx.measureText(it.k).width;
    ctx.fillStyle = it.tone === "due" ? P.danger : it.tone === "ok" ? P.success : P.ink;
    ctx.font = `700 ${3.4 * SCALE}px ${FONT}`;
    ctx.fillText(
      fitText(ctx, it.v, slot - kw - 6 * SCALE),
      right - kw - 2.4 * SCALE,
      y + 2.2 * SCALE,
    );
  });
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + 7 * SCALE, withAlpha(GOLD, 0.5));
  return y + 11 * SCALE;
}

function drawParties(ctx: Ctx, y: number, inv: Invoice): number {
  const gap = 8 * SCALE;
  const boxW = (INNER_W - gap) / 2;
  const h = 22 * SCALE;
  const mid = MARGIN + boxW + gap / 2;
  vLine(ctx, mid, y + 1 * SCALE, y + h - 1 * SCALE, withAlpha(GOLD, 0.55));

  const drawParty = (
    x: number,
    kicker: string,
    name: string,
    rows: [string, string | undefined][],
  ) => {
    const right = x + boxW - 1 * SCALE;
    ctx.textAlign = "right";
    ctx.fillStyle = BRONZE;
    ctx.font = `700 ${2.8 * SCALE}px ${FONT}`;
    ctx.fillText(kicker, right, y + 3 * SCALE);
    ctx.fillStyle = P.ink;
    ctx.font = `800 ${4.4 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, name || "—", boxW - 4 * SCALE), right, y + 8.6 * SCALE);
    let ly = y + 14.2 * SCALE;
    for (const [k, v] of rows) {
      if (!v || !v.trim()) continue;
      ctx.fillStyle = P.muted;
      ctx.font = `400 ${3 * SCALE}px ${FONT}`;
      ctx.fillText(k, right, ly);
      const kw = ctx.measureText(k).width;
      ctx.fillStyle = P.ink;
      ctx.font = `600 ${3.2 * SCALE}px ${FONT}`;
      ctx.fillText(fitText(ctx, v.trim(), boxW - kw - 10 * SCALE), right - kw - 2.2 * SCALE, ly);
      ly += 4.6 * SCALE;
    }
  };

  drawParty(PAGE_W - MARGIN - boxW, "فروشنده", inv.shopName || "فروشگاه", [
    ["تلفن", inv.shopPhone],
    ["نشانی", inv.shopAddress],
  ]);
  drawParty(MARGIN, "خریدار", customerDisplayName(inv), [
    ["تلفن", inv.customer?.phone],
    ["پرداخت", inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : undefined],
  ]);
  return y + h + 6 * SCALE;
}

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
const HEAD_H = 8 * SCALE;
const SIGN_H = 14 * SCALE;

function drawTableHead(ctx: Ctx, y: number): number {
  const cols = columns();
  const cur = currencyLabel();
  ctx.fillStyle = BRONZE;
  ctx.font = `700 ${2.9 * SCALE}px ${FONT}`;
  const cy = y + HEAD_H / 2;
  ctx.textAlign = "center";
  ctx.fillText("ردیف", cols.idx.x - cols.idx.w / 2, cy);
  ctx.fillText("تعداد", cols.qty.x - cols.qty.w / 2, cy);
  ctx.fillText(`مبلغ واحد (${cur})`, cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  ctx.fillText(`مبلغ کل (${cur})`, cols.total.x - cols.total.w / 2, cy);
  ctx.textAlign = "right";
  ctx.fillText("شرح کالا / خدمات", cols.name.x - 2 * SCALE, cy);
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + HEAD_H, P.accent, 1.3);
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + HEAD_H + 1.6 * SCALE, GOLD, 1.3);
  return y + HEAD_H + 2.2 * SCALE;
}

function drawRow(ctx: Ctx, y: number, i: number, item: Invoice["items"][number]): number {
  const cols = columns();
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + ROW_H, withAlpha(P.ink, 0.08));
  const cy = y + ROW_H / 2;
  ctx.textAlign = "center";
  ctx.fillStyle = BRONZE;
  ctx.font = `700 ${3.1 * SCALE}px ${FONT}`;
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
    ctx.fillStyle = P.accent;
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

const PAY_ROW_H = 5.2 * SCALE;
const GRAND_H = 16 * SCALE;

function payWordsLines(inv: Invoice): string[] {
  const t = invoiceTotals(inv);
  const words = amountToPersianWords(t.total);
  if (!words) return [];
  const ctx = measurer();
  ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
  return wrapText(ctx, `به حروف — ${words} ${currencyLabel()}`, INNER_W, 2);
}

function folioHeight(inv: Invoice): number {
  const lines = invoiceAmountLines(inv).filter((l) => l.kind !== "grand");
  const body = Math.max(lines.length * PAY_ROW_H, GRAND_H);
  const words = payWordsLines(inv);
  const wordsH = words.length ? 4 * SCALE + words.length * 4.2 * SCALE : 0;
  return 6 * SCALE + body + wordsH;
}

function drawFolio(ctx: Ctx, y: number, inv: Invoice): number {
  const all = invoiceAmountLines(inv);
  const grand = all.find((l) => l.kind === "grand");
  const rows = all.filter((l) => l.kind !== "grand");
  const settled = !!grand && !all.some((l) => l.kind === "due");
  const h = folioHeight(inv);

  hLine(ctx, MARGIN, PAGE_W - MARGIN, y, GOLD, 1.3);
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y + 1.6 * SCALE, withAlpha(P.accent, 0.4), 1.1);

  const listRight = PAGE_W - MARGIN;
  const listW = INNER_W * 0.5;
  let ly = y + 8 * SCALE;
  for (const l of rows) {
    const isDue = l.kind === "due";
    ctx.textAlign = "right";
    ctx.fillStyle = isDue ? P.danger : P.muted;
    ctx.font = `${isDue ? 800 : 400} ${3.1 * SCALE}px ${FONT}`;
    ctx.fillText(fitText(ctx, l.label, listW * 0.55), listRight, ly);
    ctx.textAlign = "left";
    ctx.fillStyle = isDue ? P.danger : P.ink;
    ctx.font = `${isDue ? 800 : 700} ${3.2 * SCALE}px ${FONT}`;
    ctx.fillText(l.value, listRight - listW, ly);
    ly += PAY_ROW_H;
  }

  if (grand) {
    const gx = MARGIN;
    const gy = y + 8 * SCALE;
    ctx.textAlign = "left";
    ctx.fillStyle = BRONZE;
    ctx.font = `700 ${2.9 * SCALE}px ${FONT}`;
    ctx.fillText("مبلغ قابل پرداخت", gx, gy);
    ctx.fillStyle = P.accent;
    ctx.font = `800 ${9 * SCALE}px ${FONT}`;
    const amount = fitText(ctx, grand.amount, INNER_W * 0.42);
    ctx.fillText(amount, gx, gy + 8 * SCALE);
    const aw = ctx.measureText(amount).width;
    ctx.fillStyle = BRONZE;
    ctx.font = `700 ${3 * SCALE}px ${FONT}`;
    ctx.fillText(grand.currency, gx + aw + 2.2 * SCALE, gy + 10 * SCALE);

    if (settled) {
      const sr = 9 * SCALE;
      const sx = gx + Math.max(aw, 36 * SCALE) + 16 * SCALE;
      const sy = gy + 6 * SCALE;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate((-8 * Math.PI) / 180);
      ctx.beginPath();
      ctx.arc(0, 0, sr, 0, Math.PI * 2);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, sr - 2.2 * SCALE, 0, Math.PI * 2);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = P.accent;
      ctx.font = `800 ${2.8 * SCALE}px ${FONT}`;
      ctx.fillText("تسویه", 0, -1.1 * SCALE);
      ctx.fillText("شد", 0, 2.4 * SCALE);
      ctx.restore();
    }
  }

  const words = payWordsLines(inv);
  if (words.length) {
    const wy = y + h - (words.length - 1) * 4.2 * SCALE - 1 * SCALE;
    hLine(ctx, MARGIN, PAGE_W - MARGIN, wy - 4.2 * SCALE, withAlpha(GOLD, 0.4));
    ctx.textAlign = "right";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
    words.forEach((line, i) => ctx.fillText(line, PAGE_W - MARGIN, wy + i * 4.2 * SCALE));
  }
  return y + h;
}

function closingHeight(inv: Invoice): number {
  return Math.max(inv.notes ? 20 * SCALE : 0, SIGN_H) + 4 * SCALE;
}

function drawClosing(ctx: Ctx, y: number, inv: Invoice) {
  const gap = 8 * SCALE;
  const half = (INNER_W - gap) / 2;
  if (inv.notes) {
    const x = PAGE_W - MARGIN - half;
    const right = x + half;
    ctx.textAlign = "right";
    ctx.fillStyle = BRONZE;
    ctx.font = `700 ${2.8 * SCALE}px ${FONT}`;
    ctx.fillText("توضیحات", right, y + 3 * SCALE);
    ctx.fillStyle = P.ink;
    ctx.font = `400 ${3.1 * SCALE}px ${FONT}`;
    wrapText(ctx, inv.notes, half, 3).forEach((line, i) => {
      ctx.fillText(line, right, y + 8.2 * SCALE + i * 4.4 * SCALE);
    });
  }
  const signW = (half - gap) / 2;
  const drawSign = (sx: number, label: string) => {
    hLine(ctx, sx, sx + signW, y + SIGN_H - 5 * SCALE, GOLD);
    ctx.textAlign = "center";
    ctx.fillStyle = P.muted;
    ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
    ctx.fillText(label, sx + signW / 2, y + SIGN_H - 0.4 * SCALE);
  };
  drawSign(MARGIN + signW + gap, "مهر و امضای فروشنده");
  drawSign(MARGIN, "امضای خریدار");
}

function drawFooter(ctx: Ctx, inv: Invoice, pageNo: number, pageCount: number) {
  const shopName = inv.shopName || "فروشگاه";
  const y = PAGE_H - 11 * SCALE;
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y - 4.5 * SCALE, withAlpha(GOLD, 0.5));
  drawShamse(ctx, PAGE_W - MARGIN - 2.2 * SCALE, y, 5.2 * SCALE);
  ctx.textAlign = "right";
  ctx.fillStyle = P.accent;
  ctx.font = `700 ${2.9 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, shopName, 70 * SCALE), PAGE_W - MARGIN - 6 * SCALE, y);
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
      const after = drawFolio(ctx, y + 6 * SCALE, inv);
      drawClosing(ctx, after + 5 * SCALE, inv);
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
