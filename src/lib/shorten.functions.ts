import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * کوتاه‌سازی URL از سمت سرور (Worker) برای دور زدن محدودیت‌های شبکه/CSP داخل
 * WebView اپ اندروید. در داخل WebView، fetch به دامنه‌های شخص ثالث مثل is.gd
 * گاهی بی‌صدا شکست می‌خورد و لینک بلند اصلی در پیامک می‌ماند → پیامک به چند
 * بخش می‌شکند و در اپراتورهای ایرانی نمی‌رسد. این تابع همان درخواست را از
 * سمت سرور می‌زند و فقط رشته‌ی کوتاه‌شده را به کلاینت برمی‌گرداند.
 */
export const shortenUrlServer = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        url: z
          .string()
          .url()
          .max(2000)
          // فقط http(s). بدون این شرط، یک مهاجم می‌توانست سرور را وادار کند
          // اسکیم‌های دیگر (file:، gopher:) را به سرویس بیرونی بفرستد.
          .refine((u) => /^https?:\/\//i.test(u), "آدرس باید با http یا https شروع شود."),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ short: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { clientIp, enforceRateLimit } = await import("@/lib/rate-limit.server");
    await enforceRateLimit(supabaseAdmin, "shorten", clientIp(), 30, 3600);

    const url = data.url;
    if (url.length < 50) return { short: url };
    try {
      const res = await fetch(
        `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
        { method: "GET" },
      );
      if (!res.ok) return { short: url };
      const text = (await res.text()).trim();
      if (/^https?:\/\//i.test(text) && text.length < url.length) return { short: text };
      return { short: url };
    } catch {
      return { short: url };
    }
  });