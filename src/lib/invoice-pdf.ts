/**
 * invoice-pdf.ts — ساخت PDF فاکتور با رندر روی canvas
 *
 * چرا canvas؟ jsPDF به‌تنهایی متن فارسی را درست رندر نمی‌کند. متن روی canvas
 * با موتور متن سیستم‌عامل (شکل‌دهی کامل حروف فارسی) کشیده می‌شود و سپس
 * به‌صورت تصویر در PDF قرار می‌گیرد — خروجی در وب و اپ اندروید یکسان است
 * و دقیقاً همان چیدمان نسخه چاپی سایت را دارد.
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
import { lineTotal } from "@/lib/invoice-math";
import {
  invoiceAmountLines,
  customerDisplayName,
  qtyWithUnit,
  DEFAULT_INVOICE_ACCENT,
  DEFAULT_INVOICE_GOLD,
} from "@/lib/invoice-document";

// A4 با مقیاس ‎6px/mm ≈ 150dpi — حجم کم، کیفیت چاپ خوب
const SCALE = 6;
const PAGE_W = 210 * SCALE;
const PAGE_H = 297 * SCALE;
const MARGIN = 12 * SCALE;
const FONT = "Vazirmatn, Tahoma, 'Segoe UI', sans-serif";

const NAVY = DEFAULT_INVOICE_ACCENT;
const GOLD = DEFAULT_INVOICE_GOLD;
const INK = "#1a2332";
const MUTED = "#5d6b7a";
const BORDER = "#c9d4e0";
const ZEBRA_BG = "#f4f7fb";
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

function newPage(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  // صفحه جدید A4 با پس‌زمینه سفید
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PAPER;
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
    idx: { x: xRight, w: idx },
    name: { x: xRight - idx, w: name },
    qty: { x: xRight - idx - name, w: qty },
    unitPrice: { x: xRight - idx - name - qty, w: unitPrice },
    total: { x: xRight - idx - name - qty - unitPrice, w: total },
  };
}

const ROW_H = 11 * SCALE;
const HEAD_H = 12 * SCALE;
const SIG_H = 24 * SCALE;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGoldRule(ctx: Ctx, y: number) {
  ctx.fillStyle = GOLD;
  ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 1.1 * SCALE);
}

function drawHeader(
  ctx: Ctx,
  inv: Invoice,
  pageNo: number,
  logoImg?: HTMLImageElement | null,
): number {
  const shopName = inv.shopName || "فروشگاه";
  const docTitle = invoiceDocumentTitle(inv);
  let y = MARGIN;

  const barH = pageNo === 1 ? 32 * SCALE : 22 * SCALE;
  ctx.fillStyle = NAVY;
  ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, barH);

  let textX = PAGE_W - MARGIN - 4 * SCALE;
  if (pageNo === 1 && logoImg) {
    const maxH = 22 * SCALE;
    const maxW = 28 * SCALE;
    const ratio = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
    const w = logoImg.width * ratio;
    const h = logoImg.height * ratio;
    const lx = PAGE_W - MARGIN - 3 * SCALE - w;
    const ly = y + (barH - h) / 2;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, lx - 2 * SCALE, ly - 2 * SCALE, w + 4 * SCALE, h + 4 * SCALE, 2 * SCALE);
    ctx.fill();
    ctx.drawImage(logoImg, lx, ly, w, h);
    textX = lx - 4 * SCALE;
  }

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "right";
  ctx.font = `700 ${7.2 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, shopName, textX - MARGIN - 52 * SCALE), textX, y + 11 * SCALE);

  ctx.font = `400 ${3.4 * SCALE}px ${FONT}`;
  ctx.fillStyle = "rgba(255,255,255,.88)";
  const sub =
    pageNo === 1
      ? [inv.shopAddress, inv.shopPhone ? `تلفن: ${inv.shopPhone}` : ""]
          .filter(Boolean)
          .join("  ·  ") || `${docTitle} کالا و خدمات`
      : `ادامه ${docTitle} — صفحه ${formatNumber(pageNo)}`;
  ctx.fillText(fitText(ctx, sub, textX - MARGIN - 52 * SCALE), textX, y + 20 * SCALE);

  ctx.fillStyle = "rgba(255,255,255,.12)";
  roundRect(ctx, MARGIN + 4 * SCALE, y + 5 * SCALE, 48 * SCALE, barH - 10 * SCALE, 2.2 * SCALE);
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.textAlign = "center";
  ctx.font = `700 ${3.1 * SCALE}px ${FONT}`;
  ctx.fillText(fitText(ctx, docTitle, 44 * SCALE), MARGIN + 28 * SCALE, y + 11 * SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${4.4 * SCALE}px ${FONT}`;
  ctx.fillText(inv.id.toUpperCase(), MARGIN + 28 * SCALE, y + 19 * SCALE);
  if (pageNo === 1) {
    ctx.font = `400 ${2.9 * SCALE}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillText(
      fitText(ctx, formatJalaliDateTime(inv.createdAt), 44 * SCALE),
      MARGIN + 28 * SCALE,
      y + 25.5 * SCALE,
    );
  }

  y += barH;
  drawGoldRule(ctx, y);
  y += 4 * SCALE;

  if (pageNo === 1) {
    const boxH = 28 * SCALE;
    const gap = 3 * SCALE;
    const boxW = (PAGE_W - MARGIN * 2 - gap) / 2;
    const sellerX = PAGE_W - MARGIN - boxW;
    const buyerX = MARGIN;
    const drawParty = (x: number, title: string, lines: [string, string][]) => {
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, boxW, boxH);
      ctx.fillStyle = NAVY;
      ctx.fillRect(x, y, boxW, 7 * SCALE);
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${3.2 * SCALE}px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(title, x + boxW - 3 * SCALE, y + 3.6 * SCALE);
      ctx.fillStyle = INK;
      ctx.font = `400 ${3.3 * SCALE}px ${FONT}`;
      let ly = y + 11 * SCALE;
      for (const [k, v] of lines) {
        ctx.fillStyle = MUTED;
        ctx.font = `400 ${2.8 * SCALE}px ${FONT}`;
        ctx.fillText(k, x + boxW - 3 * SCALE, ly);
        ctx.fillStyle = INK;
        ctx.font = `600 ${3.3 * SCALE}px ${FONT}`;
        ctx.fillText(fitText(ctx, v || "—", boxW - 22 * SCALE), x + boxW - 20 * SCALE, ly);
        ly += 5.2 * SCALE;
      }
    };
    const customerName = customerDisplayName(inv) || "—";
    const payment = inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : "—";
    drawParty(sellerX, "مشخصات فروشنده", [
      ["نام", shopName],
      ["تلفن", inv.shopPhone || "—"],
      ["نشانی", inv.shopAddress || "—"],
    ]);
    drawParty(buyerX, "مشخصات خریدار", [
      ["نام", customerName],
      ["تلفن", inv.customer?.phone || "—"],
      ["پرداخت", payment],
    ]);
    y += boxH + 3 * SCALE;

    if (inv.notes) {
      ctx.fillStyle = "#fff8e6";
      ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, 8 * SCALE);
      ctx.strokeStyle = "#ead9a0";
      ctx.strokeRect(MARGIN, y, PAGE_W - MARGIN * 2, 8 * SCALE);
      ctx.fillStyle = "#5c4a12";
      ctx.font = `400 ${3.3 * SCALE}px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(
        fitText(ctx, `توضیحات: ${inv.notes}`, PAGE_W - MARGIN * 2 - 6 * SCALE),
        PAGE_W - MARGIN - 3 * SCALE,
        y + 4 * SCALE,
      );
      y += 10 * SCALE;
    }
  }

  return y;
}

function drawTableHead(ctx: Ctx, y: number): number {
  const cols = columns();
  ctx.fillStyle = NAVY;
  ctx.fillRect(MARGIN, y, PAGE_W - MARGIN * 2, HEAD_H);
  ctx.fillStyle = GOLD;
  ctx.fillRect(MARGIN, y + HEAD_H - SCALE, PAGE_W - MARGIN * 2, SCALE);

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${3.8 * SCALE}px ${FONT}`;
  ctx.textAlign = "center";
  const cy = y + HEAD_H / 2;
  ctx.fillText("#", cols.idx.x - cols.idx.w / 2, cy);
  ctx.fillText("شرح کالا / خدمات", cols.name.x - cols.name.w / 2, cy);
  ctx.fillText("تعداد", cols.qty.x - cols.qty.w / 2, cy);
  ctx.fillText("مبلغ واحد", cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  ctx.fillText("مبلغ کل", cols.total.x - cols.total.w / 2, cy);
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
  ctx.font = `400 ${3.8 * SCALE}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(formatNumber(i + 1), cols.idx.x - cols.idx.w / 2, cy);
  ctx.fillText(qtyWithUnit(item), cols.qty.x - cols.qty.w / 2, cy);
  const priceText = item.originalPrice ? `${formatAmount(item.price)}` : formatAmount(item.price);
  ctx.fillText(priceText, cols.unitPrice.x - cols.unitPrice.w / 2, cy);
  ctx.font = `700 ${3.8 * SCALE}px ${FONT}`;
  ctx.fillStyle = NAVY;
  ctx.fillText(formatAmount(lineTotal(item)), cols.total.x - cols.total.w / 2, cy);

  ctx.fillStyle = INK;
  ctx.font = `600 ${3.8 * SCALE}px ${FONT}`;
  ctx.textAlign = "right";
  const name = item.discountPercent
    ? `${item.name}  ٪${formatNumber(item.discountPercent)} تخفیف`
    : item.name;
  ctx.fillText(fitText(ctx, name, cols.name.w - 3 * SCALE), cols.name.x - 1.5 * SCALE, cy);

  return y + ROW_H;
}

function drawTotal(ctx: Ctx, y: number, inv: Invoice): number {
  const lines = invoiceAmountLines(inv);
  const boxW = 88 * SCALE;
  const x = MARGIN;
  const cur = y + 4 * SCALE;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 1.5;
  const h = lines.reduce(
    (s, l) => s + (l.kind === "grand" || l.kind === "due" ? HEAD_H : ROW_H),
    0,
  );
  ctx.strokeRect(x, cur, boxW, h);
  let ly = cur;
  for (const line of lines) {
    const rowH = line.kind === "grand" || line.kind === "due" ? HEAD_H : ROW_H;
    if (line.kind === "grand") {
      ctx.fillStyle = NAVY;
      ctx.fillRect(x, ly, boxW, rowH);
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${4 * SCALE}px ${FONT}`;
    } else if (line.kind === "due") {
      ctx.fillStyle = "#fff1f0";
      ctx.fillRect(x, ly, boxW, rowH);
      ctx.fillStyle = "#9b1c1c";
      ctx.font = `700 ${3.8 * SCALE}px ${FONT}`;
    } else {
      ctx.fillStyle = INK;
      ctx.font = `400 ${3.6 * SCALE}px ${FONT}`;
    }
    const cy = ly + rowH / 2;
    ctx.textAlign = "right";
    ctx.fillText(fitText(ctx, line.label, boxW * 0.52), x + boxW - 3 * SCALE, cy);
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, line.value, boxW * 0.42), x + 3 * SCALE, cy);
    ly += rowH;
  }

  const sigY = cur;
  const sigW = (PAGE_W - MARGIN * 2 - boxW - 8 * SCALE) / 2;
  const sellerX = PAGE_W - MARGIN - sigW;
  const buyerX = sellerX - 4 * SCALE - sigW;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(sellerX, sigY, sigW, SIG_H);
  ctx.strokeRect(buyerX, sigY, sigW, SIG_H);
  ctx.setLineDash([]);
  ctx.fillStyle = MUTED;
  ctx.font = `600 ${3.2 * SCALE}px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("مهر و امضای فروشنده", sellerX + sigW - 3 * SCALE, sigY + 5 * SCALE);
  ctx.fillText("امضای خریدار", buyerX + sigW - 3 * SCALE, sigY + 5 * SCALE);

  return Math.max(ly, sigY + SIG_H) + 2 * SCALE;
}

function totalBlockHeight(inv: Invoice): number {
  const lines = invoiceAmountLines(inv);
  const sums = lines.reduce(
    (h, l) => h + (l.kind === "grand" || l.kind === "due" ? HEAD_H : ROW_H),
    0,
  );
  return Math.max(sums, SIG_H) + 6 * SCALE;
}

function drawFooter(ctx: Ctx, y: number, inv: Invoice) {
  const shopName = inv.shopName || "فروشگاه";
  drawGoldRule(ctx, y + 2 * SCALE);
  ctx.fillStyle = MUTED;
  ctx.font = `400 ${3.3 * SCALE}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`با سپاس از اعتماد شما — ${shopName}`, PAGE_W / 2, y + 9 * SCALE);
}

async function renderInvoiceCanvases(inv: Invoice): Promise<HTMLCanvasElement[]> {
  try {
    await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  } catch {
    /* ignore */
  }

  const logoImg = await loadLogoImage(inv.shopLogoUrl);
  const items = inv.items;
  const pages: HTMLCanvasElement[] = [];
  let pageNo = 1;
  let i = 0;

  while (i < items.length || pageNo === 1) {
    const { canvas, ctx } = newPage();
    let y = drawHeader(ctx, inv, pageNo, logoImg);
    y = drawTableHead(ctx, y);

    const reservedBottom = MARGIN + 18 * SCALE;
    const totalsH = totalBlockHeight(inv);
    while (i < items.length && y + ROW_H + totalsH <= PAGE_H - reservedBottom) {
      y = drawRow(ctx, y, i, items[i]);
      i++;
    }

    const isLast = i >= items.length;
    if (isLast) {
      y = drawTotal(ctx, y, inv);
      drawFooter(ctx, y, inv);
    }

    pages.push(canvas);
    if (isLast) break;
    pageNo++;
  }

  return pages;
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
