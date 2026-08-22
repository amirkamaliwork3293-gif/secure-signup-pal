/**
 * پیش‌نمایش بزرگ فاکتور / پیش‌فاکتور داخل خود برنامه.
 * چاپ از همین پنجره با یک ضربه انجام می‌شود (بدون منوی دوم اندازه کاغذ).
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Printer, Receipt, X, ImageDown, Send } from "lucide-react";
import type { Invoice } from "@/lib/store";
import { invoiceDocumentTitle, settings } from "@/lib/store";
import {
  printHtml,
  OLD_APP_MESSAGE,
  isAppShell,
  canNativeFileShare,
  normalizePaperSize,
  type PaperSize,
  PAPER_SIZES,
} from "@/lib/print";
import { normalizeTemplate, type InvoiceTemplate } from "@/lib/invoice-template";
import {
  buildInvoiceHTML,
  buildThermalInvoiceHTML,
  buildShareText,
} from "@/components/InvoiceActions";
import { InvoiceMessageDialog } from "@/components/InvoiceMessageDialog";
import { canSaveInvoiceFile, exportInvoiceImages } from "@/lib/invoice-export";

type Props = {
  inv: Invoice;
  onClose: () => void;
  /** مثلاً «پیش‌فاکتور» یا «پیش‌نمایش فاکتور» */
  heading?: string;
  hint?: string;
  allowSave?: boolean;
  allowSend?: boolean;
};

export function InvoicePreviewModal({
  inv,
  onClose,
  heading,
  hint,
  allowSave = false,
  allowSend = false,
}: Props) {
  const [appSettings] = settings.useAll();
  const fontSize = appSettings.invoiceFontSize ?? 13;
  const template = appSettings.invoiceTemplate as Partial<InvoiceTemplate> | undefined;
  const savedPaper = normalizePaperSize(appSettings.invoicePaperSize);
  const [paper, setPaper] = useState<PaperSize>(savedPaper);
  const [busy, setBusy] = useState<"print" | "thermal" | "save" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [images, setImages] = useState<string[] | null>(null);
  const [messaging, setMessaging] = useState(false);

  const title = heading || invoiceDocumentTitle(inv);
  const html = useMemo(
    () => buildInvoiceHTML(inv, fontSize, normalizeTemplate(template), paper),
    [inv, fontSize, template, paper],
  );

  const printNow = async () => {
    if (busy) return;
    setBusy("print");
    setNotice(null);
    try {
      const ok = await printHtml(html, `${invoiceDocumentTitle(inv)} ${inv.id.toUpperCase()}`);
      if (!ok) {
        setNotice(
          isAppShell()
            ? "چاپ سیستم در این نسخه اپ باز نشد. همین پیش‌نمایش را ببینید یا نسخه جدید اپ را نصب کنید."
            : OLD_APP_MESSAGE,
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const printThermal = async () => {
    if (busy) return;
    setBusy("thermal");
    setNotice(null);
    try {
      const ok = await printHtml(buildThermalInvoiceHTML(inv), `فیش ${inv.id.toUpperCase()}`);
      if (!ok) {
        setNotice(isAppShell() ? "چاپ حرارتی در این نسخه اپ در دسترس نیست." : OLD_APP_MESSAGE);
      }
    } finally {
      setBusy(null);
    }
  };

  const saveImage = async () => {
    if (busy) return;
    setBusy("save");
    setNotice(null);
    try {
      const { result, dataUrls } = await exportInvoiceImages(inv);
      if (result === "shared")
        setNotice("پنجره ذخیره / ارسال باز شد. می‌توانید در گالری ذخیره کنید.");
      else if (result === "downloaded") setNotice("تصویر فاکتور دانلود شد.");
      else if (result === "unsupported") {
        setImages(dataUrls);
        setNotice(
          "چند ثانیه روی تصویر بزنید و «ذخیره تصویر» را انتخاب کنید تا در گالری ذخیره شود.",
        );
      } else {
        setNotice("ساخت تصویر فاکتور ناموفق بود.");
      }
    } finally {
      setBusy(null);
    }
  };

  if (typeof document === "undefined") return null;

  const showSave = allowSave && (canSaveInvoiceFile() || canNativeFileShare() || isAppShell());

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[96vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-background shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <Eye className="h-4 w-4 text-primary" />
              {title}
            </h2>
            {hint ? (
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{hint}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground hover:bg-accent"
            aria-label="بستن"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3">
          {images && images.length > 0 ? (
            <div className="space-y-3">
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`${title} صفحه ${i + 1}`}
                  className="mx-auto w-full max-w-xl rounded-xl border border-border bg-white shadow-sm"
                />
              ))}
            </div>
          ) : (
            <iframe
              title={title}
              srcDoc={html}
              className="mx-auto h-[min(70vh,820px)] w-full rounded-xl border border-border bg-white shadow-sm"
            />
          )}
        </div>

        <div className="space-y-2 border-t border-border p-3">
          <div className="flex flex-wrap gap-1.5">
            {PAPER_SIZES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPaper(p.id)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                  paper === p.id
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground"
                }`}
              >
                {p.id}
              </button>
            ))}
            <span className="self-center text-[10px] text-muted-foreground">اندازه کاغذ چاپ</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void printNow()}
              disabled={!!busy}
              className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              {busy === "print" ? "در حال چاپ…" : "چاپ فاکتور"}
            </button>
            <button
              type="button"
              onClick={() => void printThermal()}
              disabled={!!busy}
              className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold disabled:opacity-50"
            >
              <Receipt className="h-4 w-4" />
              چاپ حرارتی
            </button>
          </div>

          {(showSave || allowSend) && (
            <div className="grid grid-cols-2 gap-2">
              {showSave && (
                <button
                  type="button"
                  onClick={() => void saveImage()}
                  disabled={!!busy}
                  className="flex items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  <ImageDown className="h-4 w-4" />
                  {busy === "save" ? "در حال آماده‌سازی…" : "ذخیره در گالری"}
                </button>
              )}
              {allowSend && (
                <button
                  type="button"
                  onClick={() => setMessaging(true)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium"
                >
                  <Send className="h-4 w-4" />
                  ارسال به مشتری
                </button>
              )}
            </div>
          )}

          {notice && <p className="text-center text-[11px] leading-5 text-primary">{notice}</p>}
        </div>
      </div>

      {messaging && (
        <InvoiceMessageDialog
          defaultText={buildShareText(inv)}
          defaultPhone={inv.customer?.phone ?? ""}
          onClose={() => setMessaging(false)}
        />
      )}
    </div>,
    document.body,
  );
}
