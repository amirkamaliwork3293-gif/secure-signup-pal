import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ReportInsightsSummary = {
  range: "today" | "month" | "year" | "all";
  rangeLabel: string;
  totalRevenue: number;
  invoiceCount: number;
  profit: number;
  missingCostCount: number;
  byPayment: { cash: number; card: number; credit: number };
  topProducts: { name: string; qty: number; revenue: number; profit: number | null }[];
  stagnantProducts: { name: string; stock: number }[];
  debtors: { totalReceivable: number; debtorCount: number };
  last7Days: { label: string; total: number }[];
};

const MAX_SUMMARY_JSON_LENGTH = 6000;
const MAX_QUESTION_LENGTH = 300;

export const askReportAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { question: string; summary: ReportInsightsSummary }) => {
    if (!d?.question?.trim()) throw new Error("سؤال خود را وارد کنید.");
    if (d.question.length > MAX_QUESTION_LENGTH) {
      throw new Error("سؤال خیلی طولانی است — لطفاً کوتاه‌تر بپرسید.");
    }
    if (!d.summary || typeof d.summary !== "object") {
      throw new Error("خلاصه‌ی گزارش در دسترس نیست.");
    }
    const serialized = JSON.stringify(d.summary);
    if (serialized.length > MAX_SUMMARY_JSON_LENGTH) {
      throw new Error("داده‌ی گزارش خیلی بزرگ است.");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "دستیار هوشمند هنوز فعال نشده — کلید ANTHROPIC_API_KEY روی سرور تنظیم نشده است.",
      );
    }

    const system = `تو دستیار مالی داخل یک اپ حسابداری فروشگاهی فارسی به نام «کمالی حسابداری» هستی.
فقط بر اساس داده‌های JSON زیر (که خلاصه‌ی فروش واقعی فروشگاه کاربر است) به سؤال او پاسخ بده.
قوانین:
- همیشه به فارسی و خیلی کوتاه (حداکثر ۴-۵ جمله) پاسخ بده، مگر اینکه کاربر فهرست خواسته باشد.
- اعداد پول را با جداکننده هزارگان و واحد «تومان» بنویس.
- اگر داده‌ای برای پاسخ دقیق کافی نیست (مثلاً missingCostCount بالاست)، صادقانه بگو و توصیه‌ی کوتاه بده (مثلاً «قیمت خرید محصولات را وارد کنید»).
- هیچ‌وقت عددی را که در داده نیست از خودت نساز.
- لحن دوستانه و حرفه‌ای، مثل یک حسابدار باتجربه که سریع جواب می‌دهد.`;

    const userMessage = `داده‌های خلاصه‌ی فروش (بازه: ${data.summary.rangeLabel}):
${JSON.stringify(data.summary, null, 0)}

سؤال صاحب فروشگاه: ${data.question.trim()}`;

    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 500,
          system,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
    } catch {
      throw new Error("اتصال به دستیار هوشمند برقرار نشد. اتصال اینترنت را بررسی کنید.");
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[insights] Anthropic API error", response.status, errText);
      throw new Error("دستیار هوشمند موقتاً پاسخگو نیست. کمی بعد دوباره تلاش کنید.");
    }

    const payload = (await response.json()) as {
      content?: { type: string; text?: string }[];
    };

    const answer = (payload.content ?? [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!answer) throw new Error("دستیار هوشمند پاسخی برنگرداند. دوباره تلاش کنید.");

    return { answer };
  });