/**
 * قالب‌های آماده‌ی پیام/پیامک — برای استفاده در پنل ادمین (هم تب «پیامک» برای
 * ارسال گروهی، و هم دکمه‌ی «پیام به کاربر» برای ارسال تکی/نیمه‌دستی).
 *
 * این فایل فقط متن آماده می‌سازد؛ خودِ ارسال یا از طریق sendSms (پیامک انبوه با
 * ملی‌پیامک) یا از طریق لینک‌های نیمه‌دستی sms:/whatsapp: انجام می‌شود — این فایل
 * به هیچ‌کدام وابسته نیست و کاملاً سمت کلاینت است.
 */

export type MessageTemplateId =
  | "welcome"
  | "renewal_done"
  | "renewal_reminder"
  | "renewal_offer"
  | "thanks"
  | "payment_received"
  | "custom";

export type MessageTemplateCtx = {
  /** نام نمایشی گیرنده (نام + نام‌خانوادگی، یا یوزرنیم اگر نام موجود نبود) */
  name: string;
  username?: string;
  /** رمز عبور انتخابی کاربر — فقط برای قالب «خوش‌آمدگویی» لازم است */
  password?: string | null;
  /** لینک تمدید اشتراک */
  renewLink?: string;
  /** آیا لینک درون متن این قالب اضافه شود؟ پیش‌فرض true (کاربر می‌تواند از طریق تیک آن را خاموش کند) */
  includeLink?: boolean;
};

export type MessageTemplateDef = {
  id: MessageTemplateId;
  label: string;
  /** آیا این قالب برای معنا داشتن به رمز عبور کاربر نیاز دارد؟ (فقط برای ارسال تکی کاربرد دارد) */
  needsPassword?: boolean;
  /** آیا این قالب اصلاً لینکی دارد؟ (برای نمایش/عدم‌نمایش تیک «ارسال لینک») */
  hasLink?: boolean;
  build: (ctx: MessageTemplateCtx) => string;
};

const DEFAULT_RENEW_LINK = "https://kamixapp.ir/renew";
const WEB_LINK = "kamixapp.ir";

export const MESSAGE_TEMPLATES: MessageTemplateDef[] = [
  {
    id: "welcome",
    label: "خوش‌آمدگویی (تایید ثبت‌نام + یوزرنیم/رمز)",
    needsPassword: true,
    hasLink: true,
    build: ({ name, username, password, includeLink = true }) =>
      `${name} عزیز، ثبت‌نام شما در KAMIX (کامیکس) تایید شد. ✅\n` +
      `یوزرنیم: ${username || "—"}\n` +
      `رمز عبور: ${password || "همان رمزی که هنگام ثبت‌نام انتخاب کردید"}\n` +
      `علاوه بر اپلیکیشن، از نسخه‌ی وب هم می‌توانید با همین مشخصات وارد شوید.` +
      (includeLink ? `\n${WEB_LINK}` : ""),
  },
  {
    id: "renewal_reminder",
    label: "یادآوری تمدید اشتراک",
    hasLink: true,
    build: ({ name, renewLink, includeLink = true }) =>
      `${name} عزیز، اشتراک شما در KAMIX رو به پایان است. برای جلوگیری از قطع دسترسی` +
      (includeLink ? `، از لینک زیر تمدید کنید:\n${renewLink || DEFAULT_RENEW_LINK}` : " تمدید کنید."),
  },
  {
    id: "renewal_offer",
    label: "پیشنهاد ویژه تمدید (تخفیف/یادآوری دوستانه)",
    hasLink: true,
    build: ({ name, renewLink, includeLink = true }) =>
      `${name} عزیز، برای قدردانی از همراهی شما، تمدید اشتراک KAMIX این‌بار با شرایط ویژه امکان‌پذیر است. 🎁` +
      (includeLink ? `\nجهت تمدید از لینک زیر استفاده کنید:\n${renewLink || DEFAULT_RENEW_LINK}` : ""),
  },
  {
    id: "renewal_done",
    label: "تایید تمدید اشتراک",
    hasLink: true,
    build: ({ name, includeLink = true }) =>
      `${name} عزیز، تمدید اشتراک شما در KAMIX با موفقیت انجام شد. ✅\n` +
      `مدت پلن جدید به اعتبار قبلی شما اضافه شد و تمام اطلاعات (محصولات، مشتری‌ها و فاکتورها) محفوظ است.\n` +
      `با همان یوزرنیم و رمز قبلی وارد شوید. از همراهی شما سپاسگزاریم 🌹` +
      (includeLink ? `\n${WEB_LINK}` : ""),
  },
  {
    id: "payment_received",
    label: "تایید دریافت پرداخت",
    hasLink: false,
    build: ({ name }) =>
      `${name} عزیز، پرداخت شما با موفقیت دریافت و ثبت شد. از اعتماد شما سپاسگزاریم. 🌹\nKAMIX`,
  },
  {
    id: "thanks",
    label: "تشکر از همکاری/خرید",
    hasLink: false,
    build: ({ name }) =>
      `سلام ${name} عزیز،\nاز اینکه KAMIX (کامیکس) را انتخاب کرده‌اید سپاسگزاریم.\nبا تشکر 🌹`,
  },
  {
    id: "custom",
    label: "متن دلخواه (خالی)",
    hasLink: false,
    build: () => "",
  },
];

export function getTemplate(id: MessageTemplateId): MessageTemplateDef {
  return MESSAGE_TEMPLATES.find((t) => t.id === id) ?? MESSAGE_TEMPLATES[MESSAGE_TEMPLATES.length - 1];
}
