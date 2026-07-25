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
export const createReceiptUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        username: z.string().min(1).max(64),
        // هر پسوند فایل واقع‌بینانه‌ای (حروف/عدد، حداکثر ۸ کاراکتر) پذیرفته می‌شود —
        // قبلاً فقط چند فرمت خاص مجاز بود که باعث می‌شد رسید بعضی کاربران (خصوصاً
        // عکس‌های HEIC آیفون یا فرمت‌های غیرمعمول) رد شود. اعتبارسنجی امنیتی
        // (بدون کاراکتر خطرناک/path traversal) هنوز برقرار است.
        ext: z
          .string()
          .min(1)
          .max(8)
          .regex(/^[a-zA-Z0-9]+$/, "پسوند فایل نامعتبر است.")
          .transform((s) => s.toLowerCase()),
        kind: z.enum(["signup", "renew"]).default("signup"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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