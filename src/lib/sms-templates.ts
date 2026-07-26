/**
 * قالب‌های آماده‌ی پیام/پیامک — برای استفاده در پنل ادمین (هم تب «پیامک» برای
 * ارسال گروهی، و هم دکمه‌ی «پیام به کاربر» برای ارسال تکی/نیمه‌دستی).
 *
 * این فایل فقط متن آماده می‌سازد؛ خودِ ارسال یا از طریق sendSms (پیامک انبوه با
 * ملی‌پیامک) یا از طریق لینک‌های نیمه‌دستی sms:/whatsapp: انجام می‌شود — این فایل
 * به هیچ‌کدام وابسته نیست و کاملاً سمت کلاینت است.
 */

export type MessageTemplateId = "welcome" | "renewal_reminder" | "thanks" | "payment_received" | "custom";

export type MessageTemplateCtx = {
  /** نام نمایشی گیرنده (نام + نام‌خانوادگی، یا یوزرنیم اگر نام موجود نبود) */
  name: string;
  username?: string;
  /** رمز عبور انتخابی کاربر — فقط برای قالب «خوش‌آمدگویی» لازم است */
  password?: string | null;
  /** لینک تمدید اشتراک */
  renewLink?: string;
};

export type MessageTemplateDef = {
  id: MessageTemplateId;
  label: string;
  /** آیا این قالب برای معنا داشتن به رمز عبور کاربر نیاز دارد؟ (فقط برای ارسال تکی کاربرد دارد) */
  needsPassword?: boolean;
  build: (ctx: MessageTemplateCtx) => string;
};

const DEFAULT_RENEW_LINK = "https://kamixapp.ir/renew";

export const MESSAGE_TEMPLATES: MessageTemplateDef[] = [
  {
    id: "welcome",
    label: "خوش‌آمدگویی (تایید ثبت‌نام + یوزرنیم/رمز)",
    needsPassword: true,
    build: ({ name, username, password }) =>
      `${name} عزیز، ثبت‌نام شما در KAMIX (کامیکس) تایید شد. ✅\n` +
      `یوزرنیم: ${username || "—"}\n` +
      `رمز عبور: ${password || "همان رمزی که هنگام ثبت‌نام انتخاب کردید"}\n` +
      `اپلیکیشن را نصب و با همین مشخصات وارد شوید.\nkamixapp.ir`,
  },
  {
    id: "renewal_reminder",
    label: "یادآوری تمدید اشتراک",
    build: ({ name, renewLink }) =>
      `${name} عزیز، اشتراک شما در KAMIX رو به پایان است. برای جلوگیری از قطع دسترسی، از لینک زیر تمدید کنید:\n${renewLink || DEFAULT_RENEW_LINK}`,
  },
  {
    id: "payment_received",
    label: "تایید دریافت پرداخت",
    build: ({ name }) =>
      `${name} عزیز، پرداخت شما با موفقیت دریافت و ثبت شد. از اعتماد شما سپاسگزاریم. 🌹\nKAMIX`,
  },
  {
    id: "thanks",
    label: "تشکر از همکاری/خرید",
    build: ({ name }) =>
      `سلام ${name} عزیز،\nاز اینکه KAMIX (کامیکس) را انتخاب کرده‌اید سپاسگزاریم.\nبا تشکر 🌹`,
  },
  {
    id: "custom",
    label: "متن دلخواه (خالی)",
    build: () => "",
  },
];

export function getTemplate(id: MessageTemplateId): MessageTemplateDef {
  return MESSAGE_TEMPLATES.find((t) => t.id === id) ?? MESSAGE_TEMPLATES[MESSAGE_TEMPLATES.length - 1];
}
