/**
 * پیش‌نمایش بزرگ فاکتور داخل خود برنامه.
 * ذخیره تصویر اینجا نیست — در WebView اپ را می‌بندد و پلاگین نیتیو در دسترس نیست.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Printer, Receipt, X, Send } from "lucide-react";
import type { Invoice } from "@/lib/store";
import { invoiceDocumentTitle, settings } from "@/lib/store";
import {
  printHtml,
  OLD_APP_MESSAGE,
  isAppShell,
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

type Props = {
  inv: Invoice;
  onClose: () => void;
  heading?: string;
  allowSend?: boolean;
};

export function InvoicePreviewModal({ inv, onClose, heading, allowSend = false }: Props) {
  const [appSettings] = settings.useAll();
  const fontSize = appSettings.invoiceFontSize ?? 13;
  const template = appSettings.invoiceTemplate as Partial<InvoiceTemplate> | undefined;
  const savedPaper = normalizePaperSize(appSettings.invoicePaperSize);
  const [paper, setPaper] = useState<PaperSize>(savedPaper);
  const [busy, setBusy] = useState<"print" | "thermal" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
            ? "چاپ سیستم در این نسخه اپ باز نشد. همین پیش‌نمایش را ببینید."
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

  if (typeof document === "undefined") return null;

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
          <h2 className="flex min-w-0 items-center gap-2 text-base font-bold">
            <Eye className="h-4 w-4 text-primary" />
            {title}
          </h2>
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
          <iframe
            title={title}
            srcDoc={html}
            className="mx-auto h-[min(70vh,820px)] w-full rounded-xl border border-border bg-white shadow-sm"
          />
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

          {allowSend && (
            <button
              type="button"
              onClick={() => setMessaging(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium"
            >
              <Send className="h-4 w-4" />
              ارسال به مشتری
            </button>
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
