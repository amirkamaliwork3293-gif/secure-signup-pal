import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { CalendarX, FileSpreadsheet, Printer, RefreshCw, X } from "lucide-react";

type Props = {
  onClose: () => void;
};

/**
 * پنجرهٔ تمدید پس از انقضای اشتراک — کار جدید قطع است، سوابق و خروجی آزاد است.
 */
export function RenewRequiredDialog({ onClose }: Props) {
  const body = (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="renew-required-title"
      dir="rtl"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[22rem] overflow-hidden rounded-3xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-l from-red-600 to-rose-500 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15">
                <CalendarX className="h-5 w-5" />
              </div>
              <div>
                <h2 id="renew-required-title" className="text-base font-bold">
                  اشتراک به پایان رسیده
                </h2>
                <p className="mt-0.5 text-[11px] text-white/85">برای کار جدید باید تمدید کنید</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-3 p-5 text-sm leading-7">
          <p className="text-foreground">
            ثبت فاکتور تازه، اسکن بارکد، ثبت صوتی، دستیار هوشمند و افزودن مشتری یا بدهکار فعلاً
            غیرفعال است.
          </p>
          <div className="rounded-2xl border border-border bg-muted/40 px-3 py-2.5 text-[12px] leading-6 text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <Printer className="h-3.5 w-3.5 text-primary" />
              همچنان می‌توانید
            </div>
            فاکتورهای قبلی را ببینید و چاپ کنید، از مشتریان خروجی بگیرید و فایل اکسل پشتیبان دانلود
            کنید.
            <span className="mt-1 flex items-center gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
              دادهٔ قبلی شما پاک نمی‌شود.
            </span>
          </div>

          <Link
            to="/renew"
            onClick={onClose}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
          >
            <RefreshCw className="h-4 w-4" />
            تمدید اشتراک
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-accent"
          >
            فعلاً فقط مشاهده کنم
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(body, document.body) : null;
}
