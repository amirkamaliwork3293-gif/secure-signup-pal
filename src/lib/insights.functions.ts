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
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "دستیار هوشمند هنوز فعال نشده — کلید LOVABLE_API_KEY روی سرور تنظیم نشده است.",
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
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          max_tokens: 500,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMessage },
          ],
        }),
      });
    } catch {
      throw new Error("اتصال به دستیار هوشمند برقرار نشد. اتصال اینترنت را بررسی کنید.");
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[insights] AI Gateway error", response.status, errText);
      if (response.status === 429) {
        throw new Error("درخواست‌ها زیاد شده — کمی صبر کنید و دوباره تلاش کنید.");
      }
      if (response.status === 402) {
        throw new Error("اعتبار دستیار هوشمند تمام شده — لطفاً پلن خود را ارتقا دهید.");
      }
      throw new Error("دستیار هوشمند موقتاً پاسخگو نیست. کمی بعد دوباره تلاش کنید.");
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const answer = (payload.choices?.[0]?.message?.content ?? "").trim();

    if (!answer) throw new Error("دستیار هوشمند پاسخی برنگرداند. دوباره تلاش کنید.");

    return { answer };
  });