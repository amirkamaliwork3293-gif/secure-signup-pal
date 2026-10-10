import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server function that issues a short-lived signed upload URL for the
 * private `receipts` storage bucket. Used by the public signup and renew
 * flows so that unauthenticated visitors do NOT need a direct anon INSERT
 * policy on `storage.objects` (which is a storage-exhaustion vector).
 *
 * The server picks the object path (so clients cannot overwrite arbitrary
 * keys) and uses the service-role admin client to mint an upload token,
 * which the client then consumes with `uploadToSignedUrl`.
 */
/**
 * ساخت متن «رسید دستی» از کد پیگیری + تاریخ واریز + ساعت و دقیقه‌ی واریز.
 * جایگزین آپلود عکس است (هم ترافیک استوریج را کم می‌کند، هم برای کاربری که
 * عکس رسید ندارد راه ثبت‌نام را باز می‌گذارد). ساعت و دقیقه الزامی است چون
 * مدیر با آن می‌تواند صحت تراکنش را در صورت‌حساب بانکی تطبیق دهد. اگر هر سه
 * فیلد پر نباشند null برمی‌گرداند تا مدیر هیچ‌وقت اطلاعات ناقص نبیند.
 */
export function receiptNote(ref: string, date: string, time = ""): string | null {
  const r = ref.trim();
  const d = date.trim();
  const t = time.trim();
  if (!r || !d || !t) return null;
  return `کد پیگیری: ${r} — تاریخ واریز: ${d} — ساعت واریز: ${t}`.slice(0, 500);
}

export const createReceiptUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        username: z.string().min(1).max(64),
        // فقط پسوندهای تصویری. نسخه‌ی قبلی هر رشته‌ی حروف/عددی را می‌پذیرفت،
        // یعنی یک بازدیدکننده‌ی ناشناس می‌توانست `receipt.html` آپلود کند و
        // صفحه‌ای HTML روی دامنه‌ی استوریج پروژه میزبانی کند (زمینه‌ی فیشینگ).
        // پسوندهای رایج آیفون (heic/heif) عمداً مجازند.
        ext: z
          .string()
          .min(1)
          .max(8)
          .transform((s) => s.toLowerCase())
          .refine(
            (s) => ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"].includes(s),
            "فقط تصویر (jpg، png، webp یا heic) قابل آپلود است.",
          ),
        kind: z.enum(["signup", "renew"]).default("signup"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clientIp, enforceRateLimit } = await import("@/lib/rate-limit.server");
    // آپلود رسید عمومی و ناشناس است — بدون سقف، یک اسکریپت می‌تواند فضای
    // استوریج را پر کند (و هزینه بسازد).
    await enforceRateLimit(supabaseAdmin, "receipt-upload", clientIp(), 20, 3600);
    await enforceRateLimit(supabaseAdmin, "receipt-upload-global", "all", 80, 3600);
    const safeUser =
      (data.username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "") || "user").slice(0, 60);
    const rand = Math.random().toString(36).slice(2, 8);
    const filename =
      data.kind === "renew"
        ? `renew-${Date.now()}-${rand}.${data.ext}`
        : `${Date.now()}-${rand}.${data.ext}`;
    const path = `${safeUser}/${filename}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from("receipts")
      .createSignedUploadUrl(path);
    if (error || !signed) {
      throw new Error(error?.message || "امکان آماده‌سازی آپلود رسید فراهم نشد.");
    }
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });
/**
 * مسیر جایگزین آپلود رسید از طریق سرور خود سایت.
 *
 * آپلود معمولی مستقیم از مرورگر به دامنه‌ی استوریج Supabase انجام می‌شود. روی
 * بعضی اینترنت‌ها/اپراتورها این دامنه گاهی در دسترس نیست و کاربر پیام «ارتباط با
 * سرور برقرار نشد» می‌گرفت. اگر آپلود مستقیم شکست بخورد، صفحه فایل را به همین
 * تابع (روی دامنه‌ی خود سایت) می‌فرستد و سرور آن را در همان باکت خصوصی ذخیره
 * می‌کند. همان سقف نرخ، همان الگوی مسیر و همان محدودیت «فقط تصویر» اعمال می‌شود؛
 * به‌علاوه بایت‌های فایل هم بررسی می‌شوند (نه فقط پسوند).
 */
const MAX_SERVER_RECEIPT_BYTES = 3 * 1024 * 1024;
const RECEIPT_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"] as const;
const RECEIPT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
};

export const uploadReceiptViaServer = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        username: z.string().min(1).max(64),
        ext: z
          .string()
          .min(1)
          .max(8)
          .transform((s) => s.toLowerCase())
          .refine((s) => (RECEIPT_EXTS as readonly string[]).includes(s), "فقط تصویر قابل آپلود است."),
        kind: z.enum(["signup", "renew"]).default("signup"),
        // base64 خالص (بدون پیشوند data:) — سقف حجم پیش از decode هم چک می‌شود
        base64: z
          .string()
          .min(16)
          .max(Math.ceil((MAX_SERVER_RECEIPT_BYTES * 4) / 3) + 8),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clientIp, enforceRateLimit } = await import("@/lib/rate-limit.server");
    const { isImageBytes } = await import("@/lib/image-bytes");
    // همان سهمیه‌های مسیر معمولی — این مسیر راه دور زدن سقف نیست.
    await enforceRateLimit(supabaseAdmin, "receipt-upload", clientIp(), 20, 3600);
    await enforceRateLimit(supabaseAdmin, "receipt-upload-global", "all", 80, 3600);

    let bytes: Uint8Array;
    try {
      const bin = atob(data.base64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      throw new Error("فایل رسید معتبر نیست.");
    }
    if (bytes.length === 0 || bytes.length > MAX_SERVER_RECEIPT_BYTES) {
      throw new Error("حجم عکس رسید بیش از حد مجاز است.");
    }
    if (!isImageBytes(bytes.subarray(0, 16))) {
      throw new Error("فقط عکس رسید (jpg، png، webp یا heic) قابل آپلود است.");
    }

    const safeUser =
      (data.username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "") || "user").slice(0, 60);
    const rand = Math.random().toString(36).slice(2, 8);
    const filename =
      data.kind === "renew"
        ? `renew-${Date.now()}-${rand}.${data.ext}`
        : `${Date.now()}-${rand}.${data.ext}`;
    const path = `${safeUser}/${filename}`;
    const { error } = await supabaseAdmin.storage.from("receipts").upload(path, bytes, {
      contentType: RECEIPT_MIME[data.ext] ?? "image/jpeg",
      upsert: false,
    });
    if (error) throw new Error("امکان ذخیره‌ی عکس رسید فراهم نشد. لطفاً دوباره تلاش کنید.");
    return { path };
  });
