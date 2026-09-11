/**
 * InvoiceActions.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * عملیات فاکتور: مشاهده، پرینت (A4/حرارتی)، اشتراک PDF و پیام به مشتری.
 * HTML سند فاکتور در ‎@/lib/invoice-document‎ ساخته می‌شود.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Printer, Share2, Receipt, FileDown, MessageSquare } from "lucide-react";
import { InvoiceMessageDialog } from "@/components/InvoiceMessageDialog";
import { InvoicePreviewModal } from "@/components/InvoicePreviewModal";
import type { Invoice } from "@/lib/store";
import { settings, invoiceDocumentTitle } from "@/lib/store";
import {
  printHtml,
  OLD_APP_MESSAGE,
  isNativeApp,
  isAppShell,
  canNativeFileShare,
  saveBase64File,
  downloadBlob,
  PAPER_SIZES,
  normalizePaperSize,
  type PaperSize,
} from "@/lib/print";
import { buildInvoiceHTML, type InvoiceTemplate } from "@/lib/invoice-template";
import { buildThermalInvoiceHTML, buildShareText } from "@/lib/invoice-document";
import { shareText } from "@/lib/openExternal";

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  inv: Invoice;
  /** اندازه دکمه‌ها */
  size?: "sm" | "md";
  /** اگر true باشه label زیر آیکون نشون داده میشه */
  showLabels?: boolean;
};

// ─── کامپوننت ────────────────────────────────────────────────────────────────

export function InvoiceActions({ inv, size = "md", showLabels = false }: Props) {
  const [appSettings, setSettings] = settings.useAll();
  const fontSize = appSettings.invoiceFontSize ?? 13;
  const template = appSettings.invoiceTemplate as Partial<InvoiceTemplate> | undefined;
  const paper = normalizePaperSize(appSettings.invoicePaperSize);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [paperMenu, setPaperMenu] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [preview, setPreview] = useState(false);

  const handlePrint = async (chosen: PaperSize = paper) => {
    if (printing) return;
    setPaperMenu(false);
    setPrinting(true);
    if (chosen !== paper) {
      setSettings({ ...appSettings, invoicePaperSize: chosen });
    }
    try {
      const html = buildInvoiceHTML(inv, fontSize, template, chosen, "print");
      const ok = await printHtml(html, `${invoiceDocumentTitle(inv)} ${inv.id.toUpperCase()}`);
      if (!ok) {
        alert(
          isAppShell()
            ? "چاپ سیستم در این نسخه اپ باز نشد. فاکتور را از پیش‌نمایش داخل برنامه ببینید."
            : OLD_APP_MESSAGE,
        );
      }
    } finally {
      setPrinting(false);
    }
  };

  const handleThermalPrint = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      const html = buildThermalInvoiceHTML(inv);
      const ok = await printHtml(html, `فیش ${inv.id.toUpperCase()}`);
      if (!ok) {
        alert(isAppShell() ? "چاپ حرارتی در این نسخه اپ در دسترس نیست." : OLD_APP_MESSAGE);
      }
    } finally {
      setPrinting(false);
    }
  };

  const handleSharePdf = async () => {
    if (sharingPdf) return;
    setSharingPdf(true);
    try {
      const { buildInvoicePdf } = await import("@/lib/invoice-pdf");
      const pdf = await buildInvoicePdf(inv);
      const filename = `${invoiceDocumentTitle(inv)}-${inv.id.toUpperCase()}.pdf`;

      if (canNativeFileShare() || isNativeApp()) {
        const dataUri = pdf.output("datauristring");
        const ok = await saveBase64File(dataUri, filename, "application/pdf");
        if (!ok) {
          alert(
            isAppShell()
              ? "ذخیره فایل در این نسخه اپ پشتیبانی نمی‌شود. از پرینت یا پیش‌نمایش استفاده کنید."
              : OLD_APP_MESSAGE,
          );
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
      console.error("[InvoiceActions] share pdf failed", e);
      alert("ساخت یا ارسال فایل PDF ناموفق بود.");
    } finally {
      setSharingPdf(false);
    }
  };

  const handleShare = async () => {
    const text = buildShareText(inv);
    const result = await shareText({
      title: `${invoiceDocumentTitle(inv)} ${inv.shopName || "فروشگاه"}`,
      text,
      fallbackPhones: inv.customer?.phone ? [inv.customer.phone] : undefined,
    });
    if (result === "copied") alert("متن فاکتور کپی شد.");
  };

  const btnBase =
    size === "sm"
      ? "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition"
      : "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition";

  const btnSize = size === "sm" ? "h-8 w-8" : "flex-1";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-4 w-4";

  return (
    <>
      <div
        className={
          size === "sm"
            ? "flex flex-wrap items-center justify-end gap-0.5"
            : "flex min-w-0 flex-1 flex-wrap gap-1.5"
        }
      >
        <button
          type="button"
          onClick={() => setPreview(true)}
          className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""}`}
          title="مشاهده فاکتور"
        >
          <Eye className={iconSize} />
          {showLabels && <span>مشاهده</span>}
        </button>

        <button
          type="button"
          onClick={() => setPaperMenu(true)}
          disabled={printing}
          className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""} disabled:opacity-60`}
          title="پرینت فاکتور"
        >
          <Printer className={iconSize} />
          {showLabels && <span>پرینت</span>}
        </button>

        <button
          type="button"
          onClick={handleThermalPrint}
          className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""}`}
          title="چاپ حرارتی ۸۰ میلی‌متر (فیش/رسید)"
        >
          <Receipt className={iconSize} />
          {showLabels && <span>چاپ حرارتی</span>}
        </button>

        <button
          type="button"
          onClick={handleSharePdf}
          disabled={sharingPdf}
          className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""} disabled:opacity-60`}
          title="ارسال فایل PDF فاکتور (واتساپ و…)"
        >
          <FileDown className={iconSize} />
          {showLabels && <span>{sharingPdf ? "در حال آماده‌سازی…" : "ارسال PDF"}</span>}
        </button>

        <button
          type="button"
          onClick={handleShare}
          className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""}`}
          title="ارسال فاکتور"
        >
          <Share2 className={iconSize} />
          {showLabels && <span>ارسال</span>}
        </button>

        <button
          type="button"
          onClick={() => setMessaging(true)}
          className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-primary/10 text-primary hover:bg-primary/20" : ""}`}
          title="ارسال متن فاکتور با واتساپ/پیامک (قابل ویرایش)"
        >
          <MessageSquare className={iconSize} />
          {showLabels && <span>پیام به مشتری</span>}
        </button>
      </div>

      {paperMenu &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
            onClick={() => setPaperMenu(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-4 shadow-xl"
            >
              <div className="text-sm font-bold">اندازه کاغذ چاپ</div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                اندازه کاغذ فقط روی چاپ اثر دارد. پیش‌نمایش داخل برنامه همیشه خوانا است. فاکتورهای
                بلند در چاپ روی چند صفحه می‌آیند تا نوشته‌ها ریز نشوند.
              </p>
              <div className="grid gap-1.5">
                {PAPER_SIZES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void handlePrint(p.id)}
                    className={`rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      paper === p.id
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-background hover:bg-accent"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPaperMenu(false)}
                className="w-full rounded-xl border border-border py-2 text-sm"
              >
                انصراف
              </button>
            </div>
          </div>,
          document.body,
        )}

      {preview && <InvoicePreviewModal inv={inv} onClose={() => setPreview(false)} allowSend />}

      {messaging && (
        <InvoiceMessageDialog
          defaultText={buildShareText(inv)}
          defaultPhone={inv.customer?.phone ?? ""}
          onClose={() => setMessaging(false)}
        />
      )}
    </>
  );
}
