/**
 * پیش‌نمایش بزرگ فاکتور داخل خود برنامه — مستقل از اندازه کاغذ چاپ.
 * ذخیره تصویر اینجا نیست — در WebView اپ را می‌بندد و پلاگین نیتیو در دسترس نیست.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Printer, Receipt, X, Send, Minus, Plus } from "lucide-react";
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
import { buildInvoiceHTML, type InvoiceTemplate } from "@/lib/invoice-template";
import { buildThermalInvoiceHTML, buildShareText } from "@/lib/invoice-document";
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
  const [zoom, setZoom] = useState(1);

  const title = heading || invoiceDocumentTitle(inv);
  const screenHtml = useMemo(
    () => buildInvoiceHTML(inv, fontSize, template, paper, "screen"),
    [inv, fontSize, template, paper],
  );
  const printDoc = useMemo(
    () => buildInvoiceHTML(inv, fontSize, template, paper, "print"),
    [inv, fontSize, template, paper],
  );

  const printNow = async () => {
    if (busy) return;
    setBusy("print");
    setNotice(null);
    try {
      const ok = await printHtml(printDoc, `${invoiceDocumentTitle(inv)} ${inv.id.toUpperCase()}`);
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
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[98vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-background shadow-2xl sm:rounded-3xl"
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

        <div className="min-h-0 flex-1 overflow-auto bg-[#d7e0ea] p-2 sm:p-4">
          <iframe
            title={title}
            srcDoc={screenHtml}
            className="mx-auto w-full rounded-xl border border-black/5 bg-transparent"
            style={{
              height: "min(72vh, 980px)",
              zoom,
              minHeight: 520,
            }}
          />
        </div>

        <div className="space-y-2 border-t border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.85, Math.round((z - 0.1) * 10) / 10))}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                aria-label="کوچک‌تر"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-10 text-center text-[11px] font-medium tabular-nums">
                {Math.round(zoom * 100)}٪
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.45, Math.round((z + 0.1) * 10) / 10))}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                aria-label="بزرگ‌تر"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            این پیش‌نمایش برای خواندن روی صفحه است و کوچک نمی‌شود. اندازه کاغذ فقط هنگام چاپ اعمال
            می‌شود.
          </p>

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
