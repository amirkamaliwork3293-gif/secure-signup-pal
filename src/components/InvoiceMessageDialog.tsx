/**
 * InvoiceMessageDialog.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * ارسال «نیمه‌دستی» متن فاکتور برای مشتری — دقیقاً مثل پیامک‌های بخش شاگردان:
 * متن آماده‌ی فاکتور نمایش داده می‌شود، کاربر می‌تواند آن را دلخواه ویرایش کند و
 * بعد با واتساپ یا پیامک برای مشتری بفرستد (یا فقط کپی کند).
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Send, X, Copy } from "lucide-react";
import { openExternal, toIntlPhone } from "@/lib/openExternal";

const inputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

export function InvoiceMessageDialog({
  defaultText,
  defaultPhone,
  onClose,
}: {
  defaultText: string;
  defaultPhone?: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(defaultText);
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [copied, setCopied] = useState(false);

  const intl = toIntlPhone(phone);
  const canSend = text.trim().length > 0;

  const sendWhatsapp = () => {
    if (!canSend) return;
    const base = intl ? `https://wa.me/${intl}` : "https://wa.me/";
    openExternal(`${base}?text=${encodeURIComponent(text)}`);
  };

  const sendSms = () => {
    if (!canSend) return;
    openExternal(`sms:${phone.trim()}?body=${encodeURIComponent(text)}`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-2 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-background p-4 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Send className="h-4 w-4 text-primary" />
            ارسال متن فاکتور برای مشتری
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">شماره مشتری</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="مثلاً: 09121234567"
          dir="ltr"
          className={`${inputCls} mb-3`}
        />

        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          متن پیام (می‌توانید دلخواه ویرایش کنید)
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`${inputCls} min-h-[180px] leading-6`}
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={sendWhatsapp}
            disabled={!canSend}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <MessageCircle className="h-4 w-4" />
            واتساپ
          </button>
          <button
            type="button"
            onClick={sendSms}
            disabled={!canSend || !phone.trim()}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            پیامک
          </button>
        </div>
        <button
          type="button"
          onClick={copy}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm"
        >
          <Copy className="h-4 w-4" />
          {copied ? "کپی شد ✅" : "کپی متن"}
        </button>
      </div>
    </div>,
    document.body,
  );
}