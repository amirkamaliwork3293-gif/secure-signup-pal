/**
 * ارسال نیمه‌دستی یادآور بدهی: متن آماده نمایش داده می‌شود، کاربر ویرایش
 * می‌کند و بعد با پیامک، تماس، واتساپ یا اشتراک‌گذاری می‌فرستد.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Bell, MessageCircle, Phone, Send, Share2, X } from "lucide-react";
import {
  buildDebtReminderText,
  customerFullName,
  formatToman,
  customerBalance,
  formatJalaliYmd,
  settings,
  type Customer,
} from "@/lib/store";
import { openExternal, toIntlPhone, shareText, telHref } from "@/lib/openExternal";

const inputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

export function DebtContactDialog({
  customer,
  onClose,
  heading,
  presetText,
}: {
  customer: Customer;
  onClose: () => void;
  heading?: string;
  /** اگر داده شود، به‌جای متن پیش‌فرض بدهی استفاده می‌شود */
  presetText?: string;
}) {
  const shopName = settings.get().shopName || "فروشگاه ما";
  const [text, setText] = useState(() => presetText || buildDebtReminderText(customer, shopName));
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const phoneRaw = customer.phone?.trim() ?? "";
  const intl = phoneRaw ? toIntlPhone(phoneRaw) : "";
  const balance = customerBalance(customer);

  const sendSms = () => {
    if (!phoneRaw) return;
    openExternal(`sms:${phoneRaw}?body=${encodeURIComponent(text)}`);
  };
  const sendWhatsapp = () => {
    const base = intl ? `https://wa.me/${intl}` : "https://wa.me/";
    openExternal(`${base}?text=${encodeURIComponent(text)}`);
  };
  const call = () => {
    const href = telHref(phoneRaw);
    if (href) openExternal(href);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <Bell className="h-4 w-4 text-primary" />
            {heading || "ارسال یادآور بدهی"}
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-1 text-xs text-muted-foreground">
          به <strong className="text-foreground">{customerFullName(customer)}</strong>
          {phoneRaw ? (
            <>
              {" "}
              — <span dir="ltr">{phoneRaw}</span>
            </>
          ) : (
            " — شماره تلفن ثبت نشده"
          )}
        </p>
        {balance > 0 && (
          <p className="mb-2 text-xs font-semibold text-destructive">
            بدهی: {formatToman(balance)}
            {customer.settlementDate ? ` · موعد ${formatJalaliYmd(customer.settlementDate)}` : ""}
          </p>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          className={`${inputCls} resize-none leading-6`}
        />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={call}
            disabled={!phoneRaw}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-2 py-2.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
          >
            <Phone className="h-4 w-4" />
            تماس
          </button>
          <button
            type="button"
            onClick={sendSms}
            disabled={!phoneRaw || !text.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-2 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
            پیامک
          </button>
          <button
            type="button"
            onClick={sendWhatsapp}
            disabled={!text.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-600 px-2 py-2.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
          >
            <MessageCircle className="h-4 w-4" />
            واتساپ
          </button>
        </div>
        <button
          type="button"
          onClick={async () => {
            const result = await shareText({ title: "یادآور بدهی", text });
            setShareNotice(
              result === "shared"
                ? "پنجره اشتراک باز شد؛ اگر متن داخل اپ نیامد، متن آماده کپی شده و Paste کنید."
                : "متن آماده کپی شد؛ وارد روبیکا، بله یا ایتا شوید و Paste کنید.",
            );
          }}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-semibold hover:bg-accent"
        >
          <Share2 className="h-4 w-4" />
          اشتراک‌گذاری در روبیکا / بله / ایتا / تلگرام ...
        </button>
        {shareNotice && <p className="mt-2 text-center text-[11px] text-primary">{shareNotice}</p>}
        {!phoneRaw && (
          <p className="mt-2 text-center text-[11px] text-destructive">
            برای تماس و پیامک، شماره تلفن مشتری را در ویرایش مشتری ثبت کنید.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
