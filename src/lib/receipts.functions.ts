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