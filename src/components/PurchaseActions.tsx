/**
 * PurchaseActions.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * همتای InvoiceActions برای فاکتورهای خرید — پرینت (A4/حرارتی)، PDF، اشتراک متنی.
 * همه‌ی اطلاعات واردشده (تامین‌کننده، تلفن، یادداشت، روش پرداخت، لوگو) روی
 * خروجی چاپی/PDF نمایش داده می‌شود.
 */

import { useState } from "react";
import { Printer, Share2, Receipt, FileDown } from "lucide-react";
import type { Purchase } from "@/lib/store";
import {
  formatJalaliDate,
  formatJalaliDateTime,
  PAYMENT_LABEL,
  formatAmount,
  currencyLabel,
  amountInDisplayUnit,
} from "@/lib/store";
import {
  printHtml,
  normalizePaperSize,
  OLD_APP_MESSAGE,
  isNativeApp,
  isAppShell,
  canNativeFileShare,
  saveBase64File,
  downloadBlob,
} from "@/lib/print";
import { shareText } from "@/lib/openExternal";
import { purchaseLineTotal, purchaseTotals } from "@/lib/invoice-math";
import { purchaseCreditRemaining, settings } from "@/lib/store";
import { formatQtyWithUnit } from "@/lib/qty-format";
import {
  normalizeReceiptSettings,
  receiptDocument,
  receiptItemsHtml,
  receiptParts,
  type ReceiptSettings,
} from "@/lib/receipt";
import { escapeHtml as esc } from "@/lib/html-escape";
import {
  DEFAULT_INVOICE_ACCENT,
  invoiceBaseFontSize,
  invoiceHeroHtml,
  partyHtml,
  wrapInvoiceHtml,
  type InvoiceHtmlMode,
} from "@/lib/invoice-document";
import type { PaperSize } from "@/lib/print";

// ─── HTML فاکتور خرید (A4) ──────────────────────────────────────────────────

/**
 * فاکتور خرید A4 — همان سیستم طراحی فاکتور فروش (سربرگ، کادر طرفین، جدول خط‌دار،
 * کادر جمع) تا خرید و فروش یک‌شکل و هر دو روی چاپگر سیاه‌وسفید خوانا باشند.
 */
export function buildPurchaseHTML(
  p: Purchase,
  fontSize: number = 13,
  paper: PaperSize = "A4",
  mode: InvoiceHtmlMode = "print",
): string {
  const t = purchaseTotals(p);
  const s = settings.get();
  const shopName = p.shopName || s.shopName || "فروشگاه";
  const cur = currencyLabel();
  const fs = invoiceBaseFontSize(fontSize, mode);
  const compact = paper === "A5" && mode === "print";
  // سربرگ از همان تابع فاکتور فروش؛ تلفن/نشانی فروشگاه از تنظیمات فعلی
  const head = invoiceHeroHtml(
    {
      id: p.id,
      createdAt: p.createdAt,
      items: [],
      total: t.total,
      shopName,
      shopLogoUrl: p.shopLogoUrl,
      shopPhone: s.storePhones?.[0],
      shopAddress: s.storeAddress,
    },
    { docTitle: "فاکتور خرید" },
  );
  const rows = p.items
    .map(
      (item, i) => `<tr>
        <td class="idx">${(i + 1).toLocaleString("fa-IR")}</td>
        <td class="name">${esc(item.name)}</td>
        <td class="qty">${esc(formatQtyWithUnit(item.quantity, item.unit))}</td>
        <td class="price">${formatAmount(item.buyPrice)}</td>
        <td class="sum">${formatAmount(purchaseLineTotal(item))}</td>
      </tr>`,
    )
    .join("");
  const row = (k: string, v: string, cls = "") =>
    `<div class="pay-row${cls}"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  const remaining = purchaseCreditRemaining(p);
  const totals = [
    t.discount > 0 ? row("جمع اقلام", `${formatAmount(t.subtotal)} ${cur}`) : "",
    t.discount > 0
      ? row(
          `تخفیف${t.discountPercent ? ` (٪${t.discountPercent.toLocaleString("fa-IR")})` : ""}`,
          `${formatAmount(t.discount)} ${cur}`,
        )
      : "",
    `<div class="grand"><span class="grand-k">جمع کل</span><span class="grand-v">${formatAmount(t.total)}<span class="cur">${esc(cur)}</span></span></div>`,
    p.paidAmount != null ? row("پرداخت‌شده", `${formatAmount(p.paidAmount)} ${cur}`) : "",
    p.paymentMethod === "credit" && p.paidAmount != null
      ? row("مانده بدهی به تامین‌کننده", `${formatAmount(remaining)} ${cur}`, " due")
      : "",
  ].join("");
  const words = amountInDisplayUnit(t.total).wordsText;
  const inner = `<div class="sheet"><div class="doc">
  ${head}
  <section class="facts">
    <div class="fact"><span class="k">تاریخ و ساعت</span><span class="v">${esc(formatJalaliDateTime(p.createdAt))}</span></div>
    ${p.paymentMethod ? `<div class="fact"><span class="k">نوع پرداخت</span><span class="v">${esc(PAYMENT_LABEL[p.paymentMethod])}</span></div>` : ""}
    <div class="fact"><span class="k">تعداد اقلام</span><span class="v">${p.items.length.toLocaleString("fa-IR")}</span></div>
  </section>
  <div class="parties">
    ${partyHtml("مشخصات فروشنده (تامین‌کننده)", p.supplierName || "", [
      ["تلفن", p.supplierPhone],
      ...(p.supplierFields ?? []).map((f): [string, string] => [f.label, f.value]),
    ])}
    ${partyHtml("مشخصات خریدار", shopName, [
      ["تلفن", s.storePhones?.[0]],
      ["نشانی", s.storeAddress],
    ])}
  </div>
  <div class="ledger">
  <table class="items">
    <colgroup><col style="width:6%"/><col/><col style="width:15%"/><col style="width:17%"/><col style="width:18%"/></colgroup>
    <thead><tr><th>ردیف</th><th class="t-name">شرح کالا</th><th>مقدار</th><th>قیمت خرید واحد (${esc(cur)})</th><th>مبلغ کل (${esc(cur)})</th></tr></thead>
    <tbody>${rows || `<tr class="empty-row"><td colspan="5">قلمی ثبت نشده است</td></tr>`}</tbody>
  </table>
  </div>
  <section class="folio">
    <div class="folio-side">
      ${words ? `<div class="pay-words"><b>مبلغ به حروف:</b> ${esc(words)}</div>` : ""}
    </div>
    <div class="totals">${totals}</div>
  </section>
  <div class="closing">
    ${p.note ? `<div class="note"><h3>یادداشت</h3><p>${esc(p.note)}</p></div>` : ""}
    <div class="signs">
      <div class="sign"><span class="lbl">مهر و امضای فروشنده</span></div>
      <div class="sign"><span class="lbl">امضای تحویل‌گیرنده</span></div>
    </div>
  </div>
  <footer class="foot"><span class="mark">${esc(shopName)}</span><span>فاکتور خرید</span></footer>
  </div></div>`;
  return wrapInvoiceHtml({
    title: `فاکتور خرید ${p.id.toUpperCase()}`,
    inner,
    paper,
    mode,
    fontSize: fs,
    accent: DEFAULT_INVOICE_ACCENT,
    compact,
  });
}

// ─── HTML فیش حرارتی خرید ────────────────────────────────────────────────

export function buildThermalPurchaseHTML(
  p: Purchase,
  receipt: ReceiptSettings = normalizeReceiptSettings(settings.get().receipt),
): string {
  const t = purchaseTotals(p);
  const sh = receipt.show;
  const fmt = formatAmount;
  const cur = currencyLabel();
  const meta = [
    sh.invoiceId ? receiptParts.kv("شماره", p.id.toUpperCase()) : "",
    receiptParts.kv("تاریخ", formatJalaliDateTime(p.createdAt)),
    p.supplierName ? receiptParts.kv("تامین‌کننده", p.supplierName) : "",
    p.supplierPhone ? receiptParts.kv("تلفن", p.supplierPhone) : "",
    ...(sh.customerFields
      ? (p.supplierFields ?? []).map((f) => receiptParts.kv(f.label, f.value))
      : []),
    p.paymentMethod ? receiptParts.kv("پرداخت", PAYMENT_LABEL[p.paymentMethod]) : "",
  ].join("");
  const items = receiptItemsHtml(
    p.items.map((it) => ({
      name: it.name,
      qty: formatQtyWithUnit(it.quantity, it.unit),
      unitPrice: fmt(it.buyPrice),
      total: fmt(purchaseLineTotal(it)),
    })),
    receipt,
  );
  const remaining = purchaseCreditRemaining(p);
  const body = `
  ${sh.logo && p.shopLogoUrl ? `<img class="logo" src="${esc(p.shopLogoUrl)}" alt=""/>` : ""}
  <div class="c shop">${esc(p.shopName || "فروشگاه")}</div>
  <div class="c"><span class="title">فاکتور خرید</span></div>
  <hr class="b"/>
  ${meta}
  ${sh.notes && p.note ? `<hr/><div class="sub">یادداشت: ${esc(p.note)}</div>` : ""}
  <hr/>
  ${items || `<div class="c sub">قلمی ثبت نشده است</div>`}
  <hr class="b"/>
  ${t.discount > 0 ? receiptParts.kv("جمع اقلام", `${fmt(t.subtotal)} ${cur}`) + receiptParts.kv("تخفیف", `${fmt(t.discount)} ${cur}`) : ""}
  ${receiptParts.total("جمع کل", `${fmt(t.total)} ${cur}`)}
  ${p.paidAmount != null ? receiptParts.kv("پرداخت‌شده", `${fmt(p.paidAmount)} ${cur}`) : ""}
  ${p.paymentMethod === "credit" && p.paidAmount != null ? receiptParts.kv("مانده بدهی", `${fmt(remaining)} ${cur}`) : ""}
  <div class="cut">- - - - - - - -</div>`;
  return receiptDocument({ title: `فاکتور خرید ${p.id.toUpperCase()}`, body, s: receipt });
}

// ─── متن اشتراک‌گذاری ────────────────────────────────────────────────────

function buildPurchaseShareText(p: Purchase): string {
  const date = formatJalaliDate(p.createdAt);
  const lines = [
    `🧾 فاکتور خرید ${p.shopName || "فروشگاه"}`,
    `📅 تاریخ: ${date}`,
    p.supplierName ? `🚚 تامین‌کننده: ${p.supplierName}` : "",
    p.note ? `📝 یادداشت: ${p.note}` : "",
    `─────────────────`,
    ...p.items.map(
      (item) =>
        `• ${item.name}  ×${formatQtyWithUnit(item.quantity, item.unit)}  =  ${formatAmount(purchaseLineTotal(item))} ${currencyLabel()}`,
    ),
    `─────────────────`,
    purchaseTotals(p).discount > 0
      ? `🏷️ تخفیف: ${formatAmount(purchaseTotals(p).discount)} ${currencyLabel()}`
      : "",
    `💰 جمع کل: ${formatAmount(purchaseTotals(p).total)} ${currencyLabel()}`,
  ].filter(Boolean);
  return lines.join("\n");
}

// ─── کامپوننت ────────────────────────────────────────────────────────────────

type Props = {
  p: Purchase;
  size?: "sm" | "md";
  showLabels?: boolean;
  /** اندازه‌ی فونت پرینت — پیش‌فرض ۱۳ */
  fontSize?: number;
};

export function PurchaseActions({ p, size = "md", showLabels = false, fontSize = 13 }: Props) {
  const [sharingPdf, setSharingPdf] = useState(false);

  const handlePrint = async () => {
    const html = buildPurchaseHTML(
      p,
      fontSize,
      normalizePaperSize(settings.get().invoicePaperSize),
    );
    const ok = await printHtml(html, `فاکتور خرید ${p.id.toUpperCase()}`);
    if (!ok) {
      alert(isAppShell() ? "چاپ سیستم در این نسخه اپ باز نشد." : OLD_APP_MESSAGE);
    }
  };

  const handleThermalPrint = async () => {
    const html = buildThermalPurchaseHTML(p);
    const ok = await printHtml(html, `فاکتور خرید ${p.id.toUpperCase()}`);
    if (!ok) {
      alert(isAppShell() ? "چاپ حرارتی در این نسخه اپ در دسترس نیست." : OLD_APP_MESSAGE);
    }
  };

  const handleSharePdf = async () => {
    if (sharingPdf) return;
    setSharingPdf(true);
    try {
      const { buildPurchasePdf } = await import("@/lib/purchase-pdf");
      const pdf = await buildPurchasePdf(p);
      const filename = `فاکتور-خرید-${p.id.toUpperCase()}.pdf`;

      if (canNativeFileShare() || isNativeApp()) {
        const dataUri = pdf.output("datauristring");
        const ok = await saveBase64File(dataUri, filename, "application/pdf");
        if (!ok) {
          alert(isAppShell() ? "ذخیره فایل در این نسخه اپ پشتیبانی نمی‌شود." : OLD_APP_MESSAGE);
        }
        return;
      }

      if (isAppShell()) {
        alert(
          "در اپ نمی‌توان فایل را با لینک دانلود گرفت چون از برنامه خارج می‌شوید. از دکمه پرینت استفاده کنید.",
        );
        return;
      }

      const blob = pdf.output("blob") as Blob;
      const file = new File([blob], filename, { type: "application/pdf" });
      const nav = navigator as Navigator & {
        canShare?: (data?: { files?: File[] }) => boolean;
        share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        try {
          await nav.share({ files: [file], title: filename });
          return;
        } catch {
          /* کاربر لغو کرد — به دانلود ساده برمی‌گردیم */
        }
      }
      downloadBlob(blob, filename);
    } catch (e) {
      console.error("[PurchaseActions] share pdf failed", e);
      alert("ساخت یا ارسال فایل PDF ناموفق بود.");
    } finally {
      setSharingPdf(false);
    }
  };

  const handleShare = async () => {
    const text = buildPurchaseShareText(p);
    const result = await shareText({
      title: `فاکتور خرید ${p.shopName || "فروشگاه"}`,
      text,
    });
    if (result === "copied") alert("متن فاکتور کپی شد.");
  };

  const btnBase =
    size === "sm"
      ? "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition"
      : "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition";
  const btnSize = size === "sm" ? "h-8 w-8" : "flex-1";
  const iconSize = "h-4 w-4";

  return (
    <>
      <button
        type="button"
        onClick={handlePrint}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="پرینت فاکتور خرید (A4)"
      >
        <Printer className={iconSize} />
        {showLabels && <span>پرینت</span>}
      </button>
      <button
        type="button"
        onClick={handleThermalPrint}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
        title="چاپ فیش (چاپگر حرارتی)"
      >
        <Receipt className={iconSize} />
        {showLabels && <span>چاپ حرارتی</span>}
      </button>
      <button
        type="button"
        onClick={handleSharePdf}
        disabled={sharingPdf}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""} disabled:opacity-60`}
        title="ارسال فایل PDF فاکتور خرید"
      >
        <FileDown className={iconSize} />
        {showLabels && <span>{sharingPdf ? "در حال آماده‌سازی…" : "ارسال PDF"}</span>}
      </button>
      <button
        type="button"
        onClick={handleShare}
        className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""}`}
        title="ارسال فاکتور خرید"
      >
        <Share2 className={iconSize} />
        {showLabels && <span>ارسال</span>}
      </button>
    </>
  );
}
