/**
 * بعد از «ثبت فاکتور»: فاکتور از قبل در تاریخچه ذخیره شده.
 * این پنجره فقط می‌پرسد بعدش چه کار کند — بستن با ضربدر هم کافی است.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Eye, ImageDown, Send, X, Printer } from "lucide-react";
import type { Invoice } from "@/lib/store";
import { formatToman, invoiceDocumentTitle } from "@/lib/store";
import { invoiceTotals } from "@/lib/invoice-math";
import { InvoicePreviewModal } from "@/components/InvoicePreviewModal";
import { InvoiceMessageDialog } from "@/components/InvoiceMessageDialog";
import { buildShareText } from "@/components/InvoiceActions";
import { canSaveInvoiceFile, exportInvoiceImages } from "@/lib/invoice-export";
import { isAppShell } from "@/lib/print";

export function InvoiceSavedDialog({ inv, onClose }: { inv: Invoice; onClose: () => void }) {
  const [preview, setPreview] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [longPressImages, setLongPressImages] = useState<string[] | null>(null);
  const t = invoiceTotals(inv);

  const saveToGallery = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const { result, dataUrls } = await exportInvoiceImages(inv);
      if (result === "shared") {
        setNotice(
          "پنجره ذخیره یا ارسال باز شد. تصویر را در گالری ذخیره کنید یا برای مشتری بفرستید.",
        );
      } else if (result === "downloaded") {
        setNotice("تصویر فاکتور ذخیره شد.");
      } else if (result === "unsupported") {
        setLongPressImages(dataUrls);
        setNotice(
          "چند ثانیه روی تصویر بزنید و «ذخیره تصویر» را بزنید — این روش در اپ صفحه را نمی‌بندد.",
        );
      } else {
        setNotice("ساخت تصویر ممکن نشد. از پیش‌نمایش، چاپ بگیرید.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;

  if (preview) {
    return (
      <InvoicePreviewModal
        inv={inv}
        heading={`پیش‌نمایش ${invoiceDocumentTitle(inv)}`}
        hint="فاکتور ذخیره شده است. از اینجا چاپ کنید یا ببندید."
        allowSave
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
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              در تاریخچه و بخش فاکتورها ذخیره شده. حالا می‌توانید پیش‌نمایش ببینید، در گالری ذخیره
              کنید یا برای مشتری بفرستید. با ضربدر هم بسته می‌شود.
            </p>
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
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">پیش‌نمایش فاکتور</span>
              <span className="block text-[11px] text-muted-foreground">
                بزرگ ببینید و در صورت نیاز چاپ کنید
              </span>
            </span>
            <Printer className="h-4 w-4 text-muted-foreground" />
          </button>

          <button
            type="button"
            onClick={() => void saveToGallery()}
            disabled={busy}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-right shadow-card hover:bg-accent disabled:opacity-60"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <ImageDown className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {busy ? "در حال آماده‌سازی تصویر…" : "ذخیره در گالری"}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {canSaveInvoiceFile() || !isAppShell()
                  ? "تصویر فاکتور را در گوشی ذخیره کنید"
                  : "تصویر داخل برنامه باز می‌شود؛ چند ثانیه روی آن بزنید"}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMessaging(true)}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-right shadow-card hover:bg-accent"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Send className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">ارسال برای مشتری</span>
              <span className="block text-[11px] text-muted-foreground">
                واتساپ، پیامک یا کپی متن فاکتور
              </span>
            </span>
          </button>
        </div>

        {longPressImages && longPressImages.length > 0 && (
          <div className="mt-3 space-y-2 rounded-2xl border border-dashed border-border p-2">
            {longPressImages.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`فاکتور صفحه ${i + 1}`}
                className="w-full rounded-xl bg-white"
              />
            ))}
          </div>
        )}

        {notice && <p className="mt-3 text-center text-[11px] leading-5 text-primary">{notice}</p>}

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
