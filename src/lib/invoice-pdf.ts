/**
 * invoice-pdf.ts — ساخت PDF فاکتور با رندر روی canvas
 *
 * چرا canvas؟ jsPDF به‌تنهایی متن فارسی را درست رندر نمی‌کند. متن روی canvas
 * با موتور متن سیستم‌عامل (شکل‌دهی کامل حروف فارسی) کشیده می‌شود و سپس
 * به‌صورت تصویر در PDF قرار می‌گیرد — خروجی در وب و اپ اندروید یکسان است
 * و دقیقاً همان چیدمان نسخه چاپی سایت را دارد.
 */
import { jsPDF } from "jspdf";
import { formatNumber, formatAmount, currencyLabel, formatJalaliDate, PAYMENT_LABEL, type Invoice } from "@/lib/store";

// A4 با مقیاس ‎6px/mm ≈ 150dpi — حجم کم، کیفیت چاپ خوب
const SCALE = 6;
const PAGE_W = 210 * SCALE;
const PAGE_H = 297 * SCALE;
const MARGIN = 14 * SCALE;
const FONT = "Vazirmatn, Tahoma, 'Segoe UI', sans-serif";

const INK = "#111111";
const MUTED = "#555555";
const BORDER = "#bbbbbb";
const HEAD_BG = "#f0f0f0";
const ZEBRA_BG = "#fafafa";

type Ctx = CanvasRenderingContext2D;

function newPage(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  // صفحه جدید A4 با پس‌زمینه سفید
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  ctx.direction = "rtl";
  ctx.textBaseline = "middle";
  return { canvas, ctx };
}

function fitText(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

// ستون‌های جدول از راست به چپ: ردیف | نام کالا | تعداد | قیمت واحد | جمع
function columns() {
  const inner = PAGE_W - MARGIN * 2;
  const idx = 10 * SCALE;
  const qty = 20 * SCALE;
  const unitPrice = 34 * SCALE;
  const total = 38 * SCALE;
  const name = inner - idx - qty - unitPrice - total;
  // مرز راستِ هر ستون (RTL)
  const xRight = PAGE_W - MARGIN;
  return {
    idx:       { x: xRight,                          w: idx },
    name:      { x: xRight - idx,                    w: name },
    qty:       { x: xRight - idx - name,             w: qty },
    unitPrice: { x: xRight - idx - name - qty,       w: unitPrice },
    total:     { x: xRight - idx - name - qty - unitPrice, w: total },
  };
}

const ROW_H = 9 * SCALE;
const HEAD_H = 10 * SCALE;

function drawHeader(ctx: Ctx, inv: Invoice, pageNo: number): number {
  const shopName = inv.shopName || "فروشگاه";
  let y = MARGIN + 4 * SCALE;

  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.font = `700 ${7 * SCALE}px ${FONT}`;
  ctx.fillText(shopName, PAGE_W / 2, y);
  y += 7 * SCALE;

  ctx.font = `400 ${3.4 * SCALE}px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(pageNo === 1 ? "KAMIX | فاکتور فروش" : `ادامه فاکتور — صفحه ${formatNumber(pageNo)}`, PAGE_W / 2, y);
  y += 5 * SCALE;

  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.5 * SCALE;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(PAGE_W - MARGIN, y);
  ctx.stroke();
  y += 6 * SCALE;

  if (pageNo === 1) {
    const customer = inv.customer;
    const customerName = customer
      ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "—"
      : "—";
    const date = formatJalaliDate(inv.createdAt);
    const payment = inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : "—";

    ctx.font = `400 ${3.6 * SCALE}px ${FONT}`;
    const colR = PAGE_W - MARGIN;            // ستون راست
    const colL = PAGE_W / 2 - 2 * SCALE;     // ستون چپ
    const meta: [string, string, number][] = [
      [`شماره: ${inv.id.toUpperCase()}`, "", colR],
      [`تاریخ: ${date}`, "", colL],
      [`مشتری: ${customerName}`, "", colR],
      [`تلفن: ${customer?.phone || "—"} · پرداخت: ${payment}`, "", colL],
    ];
    ctx.textAlign = "right";
    ctx.fillStyle = INK;
    for (let i = 0; i < meta.length; i++) {
      const rowY = y + Math.floor(i / 2) * 6 * SCALE;
      ctx.fillText(fitText(ctx, meta[i][0], PAGE_W / 2 - MARGIN - 2 * SCALE), meta[i][2], rowY);
    }
    y += Math.ceil(meta.length / 2) * 6 * SCALE + 3 * SCALE;
  }

  return y;
}

function drawTableHead(ctx: Ctx, y: number): number {
  const cols = columns();
  ctx.fillStyle = HEAD_BG;
  ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, HEAD_H);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN, y, PAGE_W - MARGIN * 2, HEAD_H);

  ctx.fillStyle = INK;
  ctx.font = `600 ${3.6 * SCALE}px ${FONT}`;
  ctx.textAlign = "center";
  const cy = y + HEAD_H / 2;
  ctx.fillText("#", cols.idx.x - cols.idx.w / 2, cy);
  ctx.fillText("نام کالا", cols.name.x - cols.name.w / 2, cy);
  ctx.fillText("تعداد", cols.qty.x - cols.qty.w / 2, cy);
  ctx.fillText("قیمت واحد", cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  ctx.fillText("جمع", cols.total.x - cols.total.w / 2, cy);

  // خطوط عمودی سرستون
  for (const c of Object.values(cols)) {
    ctx.beginPath();
    ctx.moveTo(c.x - c.w, y);
    ctx.lineTo(c.x - c.w, y + HEAD_H);
    ctx.stroke();
  }
  return y + HEAD_H;
}

function drawRow(ctx: Ctx, y: number, i: number, item: Invoice["items"][number]): number {
  const cols = columns();
  if (i % 2 === 1) {
    ctx.fillStyle = ZEBRA_BG;
    ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, ROW_H);
  }
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN, y, PAGE_W - MARGIN * 2, ROW_H);
  for (const c of Object.values(cols)) {
    ctx.beginPath();
    ctx.moveTo(c.x - c.w, y);
    ctx.lineTo(c.x - c.w, y + ROW_H);
    ctx.stroke();
  }

  const cy = y + ROW_H / 2;
  ctx.fillStyle = INK;
  ctx.font = `400 ${3.5 * SCALE}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(formatNumber(i + 1), cols.idx.x - cols.idx.w / 2, cy);
  ctx.fillText(
    formatNumber(item.quantity) + (item.unit && item.unit !== "عدد" ? ` ${item.unit}` : ""),
    cols.qty.x - cols.qty.w / 2, cy,
  );
  ctx.fillText(formatAmount(item.price), cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  ctx.fillText(formatAmount(Math.round(item.price * item.quantity)), cols.total.x - cols.total.w / 2, cy);

  ctx.textAlign = "right";
  ctx.fillText(fitText(ctx, item.name, cols.name.w - 3 * SCALE), cols.name.x - 1.5 * SCALE, cy);

  return y + ROW_H;
}

function drawTotal(ctx: Ctx, y: number, inv: Invoice): number {
  const cols = columns();
  ctx.fillStyle = HEAD_BG;
  ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, HEAD_H);
  ctx.strokeStyle = BORDER;
  ctx.strokeRect(MARGIN, y, PAGE_W - MARGIN * 2, HEAD_H);

  const cy = y + HEAD_H / 2;
  ctx.fillStyle = INK;
  ctx.font = `700 ${3.8 * SCALE}px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("جمع کل", PAGE_W - MARGIN - 2 * SCALE, cy);
  ctx.textAlign = "center";
  ctx.fillText(`${formatAmount(inv.total)} ${currencyLabel()}`, cols.total.x - cols.total.w / 2, cy);

  return y + HEAD_H;
}

function drawFooter(ctx: Ctx, y: number, inv: Invoice) {
  const shopName = inv.shopName || "فروشگاه";
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y + 4 * SCALE);
  ctx.lineTo(PAGE_W - MARGIN, y + 4 * SCALE);
  ctx.stroke();
  ctx.fillStyle = "#888888";
  ctx.font = `400 ${3.2 * SCALE}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`با تشکر از خرید شما — ${shopName}`, PAGE_W / 2, y + 9 * SCALE);
}

/** ساخت PDF چندصفحه‌ای فاکتور — خروجی آماده savePdf / save */
export async function buildInvoicePdf(inv: Invoice): Promise<jsPDF> {
  // اطمینان از آماده‌بودن فونت‌های وب پیش از رندر روی canvas
  try { await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const items = inv.items;
  let pageNo = 1;
  let i = 0;

  while (i < items.length || pageNo === 1) {
    const { canvas, ctx } = newPage();
    let y = drawHeader(ctx, inv, pageNo);
    y = drawTableHead(ctx, y);

    const reservedBottom = MARGIN + 14 * SCALE; // جا برای پانویس
    while (i < items.length && y + ROW_H + HEAD_H <= PAGE_H - reservedBottom) {
      y = drawRow(ctx, y, i, items[i]);
      i++;
    }

    const isLast = i >= items.length;
    if (isLast) {
      y = drawTotal(ctx, y, inv);
      drawFooter(ctx, y, inv);
    }

    if (pageNo > 1) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);

    if (isLast) break;
    pageNo++;
  }

  return pdf;
}
