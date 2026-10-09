/**
 * InvoiceActions.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * عملیات فاکتور: مشاهده، پرینت (A4/حرارتی)، فیش به‌صورت عکس، اشتراک PDF و پیام به مشتری.
 * HTML سند فاکتور در ‎@/lib/invoice-document‎ ساخته می‌شود.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Printer, Share2, Receipt, FileDown, MessageSquare, ImageDown } from "lucide-react";
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
  const [makingImage, setMakingImage] = useState(false);
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

  /**
   * فیش به‌صورت عکس PNG — برای مینی‌پرینترهای بلوتوثی (فوممو و…) که فقط از
   * برنامهٔ خودشان (مثل Print Master) چاپ می‌کنند. فقط خواندنی؛ داده‌ای تغییر نمی‌کند.
   */
  const handleReceiptImage = async () => {
    if (makingImage) return;
    setMakingImage(true);
    try {
      const { buildReceiptImageDataUrl } = await import("@/lib/receipt-image");
      const dataUrl = await buildReceiptImageDataUrl(buildThermalInvoiceHTML(inv));
      // نام لاتین: بعضی برنامه‌های پرینتر نام فایل فارسی را باز نمی‌کنند
      const filename = `receipt-${inv.id.toUpperCase()}.png`;

      if (canNativeFileShare() || isNativeApp()) {
        const ok = await saveBase64File(dataUrl, filename, "image/png");
        if (!ok) {
          alert(
            isAppShell()
              ? "ذخیره عکس در این نسخه اپ پشتیبانی نمی‌شود. لطفاً نسخه جدید APK را از سایت نصب کنید."
              : OLD_APP_MESSAGE,
          );
        }
        return;
      }

      if (isAppShell()) {
        alert(
          "در این نسخه اپ نمی‌توان عکس را ذخیره کرد. لطفاً نسخه جدید APK را از سایت نصب کنید یا از سایت در مرورگر استفاده کنید.",
        );
        return;
      }

      const bin = atob(dataUrl.split(",")[1] ?? "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "image/png" });
      const file = new File([blob], filename, { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data?: { files?: File[] }) => boolean;
        share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        try {
          await nav.share({ files: [file], title: filename });
          return;
        } catch (e) {
          // کاربر پنجره اشتراک را بست — کاری لازم نیست
          if ((e as { name?: string })?.name === "AbortError") return;
        }
      }
      downloadBlob(blob, filename);
    } catch (e) {
      console.error("[InvoiceActions] receipt image failed", e);
      alert("ساخت عکس فیش ناموفق بود. لطفاً دوباره تلاش کنید یا از «چاپ حرارتی» استفاده کنید.");
    } finally {
      setMakingImage(false);
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
          title="چاپ فیش (چاپگر حرارتی)"
        >
          <Receipt className={iconSize} />
          {showLabels && <span>چاپ حرارتی</span>}
        </button>

        <button
          type="button"
          onClick={handleReceiptImage}
          disabled={makingImage}
          className={`${btnBase} ${btnSize} ${size !== "sm" ? "bg-accent text-foreground hover:bg-accent/80" : ""} disabled:opacity-60`}
          title="فیش به‌صورت عکس (برای مینی‌پرینتر بلوتوثی مثل فوممو — در برنامه پرینتر چاپ کنید)"
        >
          <ImageDown className={iconSize} />
          {showLabels && <span>{makingImage ? "در حال ساخت…" : "فیش عکس"}</span>}
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
