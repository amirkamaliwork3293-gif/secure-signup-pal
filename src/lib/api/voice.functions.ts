import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// جایگزین کمکی (fallback) برای تحلیل گفتار صوتی با مدل زبانی Claude.
//
// موتور اصلیِ «ثبت صوتی» یک تحلیل‌گر محلی و آفلاین است (lib/voice/persian-nlu).
// این تابع فقط زمانی استفاده می‌شود که اطمینان تحلیل محلی پایین باشد، دستگاه
// آنلاین باشد و کلید ANTHROPIC_API_KEY روی سرور تنظیم شده باشد. اگر کلید نباشد،
// تابع `{ available: false }` برمی‌گرداند و کلاینت بی‌سروصدا فقط محلی می‌ماند.
//
// روی Cloudflare Workers مقدار env در زمان درخواست بایند می‌شود، پس کلید داخل
// هندلر خوانده می‌شود (نه در سطح ماژول) — مطابق راهنمای config.server.ts.

const ParsedItemSchema = z.object({
  /** نام محصول همان‌طور که در فهرست انبار آمده (بهترین حدس) */
  productName: z.string(),
  /** مقدار عددی */
  quantity: z.number(),
  /** واحد: «عدد» یا «کیلوگرم» یا «گرم» */
  unit: z.string(),
});

export type LlmParsedItem = z.infer<typeof ParsedItemSchema>;

export type LlmParseResult =
  | { available: false }
  | {
      available: true;
      items: LlmParsedItem[];
      customerName?: string;
      paymentMethod?: "cash" | "card" | "credit";
    };

export const parseVoiceInvoiceLLM = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      transcript: z.string().min(1),
      // نام محصولات موجود در انبار تا مدل از همین‌ها انتخاب کند
      productNames: z.array(z.string()).max(2000),
    }),
  )
  .handler(async ({ data }): Promise<LlmParseResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { available: false };

    const system =
      "تو دستیار یک فروشگاه فارسی‌زبان هستی. جمله‌ی محاوره‌ای فروشنده را به آیتم‌های " +
      "ساختاریافته تبدیل کن. فقط محصولاتی را انتخاب کن که در «فهرست انبار» وجود دارند. " +
      "اعداد فارسی و کسرهای بازاری را به عدد و واحد استاندارد تبدیل کن: ربع=۰٫۲۵ کیلوگرم، " +
      "نیم=۰٫۵ کیلوگرم، سه‌چارک=۰٫۷۵، «دو ربع»=۰٫۵ و... . واحد باید یکی از «عدد»، «کیلوگرم» یا «گرم» باشد. " +
      "اگر تعداد گفته نشده باشد ۱ بگذار. چند آیتم با «و» جدا می‌شوند. " +
      "خروجی را فقط به‌صورت JSON معتبر بده، بدون توضیح اضافه، با این ساختار: " +
      '{"items":[{"productName":"...","quantity":0,"unit":"..."}],"customerName":null,"paymentMethod":null}. ' +
      "paymentMethod یکی از cash/card/credit یا null.";

    const user =
      `فهرست انبار: ${data.productNames.join("، ")}\n\n` + `جمله‌ی فروشنده: «${data.transcript}»`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) return { available: false };
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = json.content?.find((b) => b.type === "text")?.text ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return { available: false };
      const parsed = JSON.parse(match[0]) as unknown;
      const shape = z
        .object({
          items: z.array(ParsedItemSchema),
          customerName: z.string().nullish(),
          paymentMethod: z.enum(["cash", "card", "credit"]).nullish(),
        })
        .safeParse(parsed);
      if (!shape.success) return { available: false };
      return {
        available: true,
        items: shape.data.items,
        customerName: shape.data.customerName ?? undefined,
        paymentMethod: shape.data.paymentMethod ?? undefined,
      };
    } catch {
      return { available: false };
    }
  });
