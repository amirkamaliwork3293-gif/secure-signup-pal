/**
 * بعد از «ثبت فاکتور»: فاکتور از قبل در تاریخچه ذخیره شده.
 * ذخیره تصویر در WebView اپ را می‌بندد و پلاگین نیتیو در این پروژه نیست — آن گزینه حذف شد.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Eye, Send, X } from "lucide-react";
import type { Invoice } from "@/lib/store";
import { formatToman } from "@/lib/store";
import { invoiceTotals } from "@/lib/invoice-math";
import { InvoicePreviewModal } from "@/components/InvoicePreviewModal";
import { InvoiceMessageDialog } from "@/components/InvoiceMessageDialog";
import { buildShareText } from "@/components/InvoiceActions";

export function InvoiceSavedDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const [preview, setPreview] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const t = invoiceTotals(inv);

  if (typeof document === "undefined") return null;

  if (preview) {
    return (
      <InvoicePreviewModal
        inv={inv}
        heading="پیش‌فاکتور"
        allowSend
        onClose={() => setPreview(false)}
      />
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/55 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="فاکتور ثبت شد"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-background p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-bold">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              فاکتور ثبت شد
            </div>
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

        <div className="mb-3 rounded-2xl bg-gradient-primary p-3 text-primary-foreground">
          <div className="text-[11px] opacity-80">مبلغ این فاکتور</div>
          <div className="text-xl font-bold">{formatToman(t.total)}</div>
          <div className="mt-0.5 text-[11px] opacity-80">
            شماره {inv.id.toUpperCase()} · {inv.items.length.toLocaleString("fa-IR")} قلم
          </div>
        </div>

        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => setPreview(true)}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-right shadow-card hover:bg-accent"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Eye className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold">پیش‌فاکتور</span>
          </button>

          <button
            type="button"
            onClick={() => setMessaging(true)}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-right shadow-card hover:bg-accent"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Send className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold">ارسال برای مشتری</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-xl border border-border py-2.5 text-sm font-medium"
        >
          بستن
        </button>
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
