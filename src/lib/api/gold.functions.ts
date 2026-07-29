import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// نرخ لحظه‌ای طلا برای «محاسبه‌گر طلا».
//
// این تابع فقط زمانی نرخ زنده برمی‌گرداند که متغیر محیطی GOLD_API_KEY روی سرور
// تنظیم شده باشد (کلید رایگان از brsapi.ir — بخش «Api رایگان طلا و ارز»). اگر کلید
// تنظیم نشده باشد یا درخواست با خطا مواجه شود، تابع بی‌سروصدا `{ available: false }`
// برمی‌گرداند و کاربر در رابط کاربری نرخ روز را دستی وارد می‌کند — دقیقاً همان الگوی
// جایگزین محلی که در voice.functions.ts استفاده شده، تا هیچ‌وقت صفحه خراب نشود.
//
// روی Cloudflare Workers مقدار env در زمان درخواست بایند می‌شود، پس کلید داخل
// هندلر خوانده می‌شود (نه در سطح ماژول) — مطابق راهنمای config.server.ts.

export type GoldLivePrice = {
  available: boolean;
  /** نرخ هر گرم طلای ۱۸ عیار (تومان) */
  pricePerGram18?: number;
  /** نرخ سکه‌ها (تومان) در صورت موجود بودن در پاسخ سرویس */
  coinPrices?: Partial<Record<"emami" | "bahar" | "half" | "quarter" | "gerami", number>>;
  updatedAt?: string;
};

function toToman(rialOrToman: number): number {
  // برخی سرویس‌ها نرخ را به ریال می‌دهند؛ اگر عدد خیلی بزرگ بود (بیش از حد معمول تومان)، به تومان تبدیل می‌کنیم.
  return rialOrToman > 100_000_000 ? Math.round(rialOrToman / 10) : Math.round(rialOrToman);
}

/** جست‌وجوی یک آیتم در پاسخ JSON سرویس بر اساس چند نام/کلیدواژه‌ی احتمالی (چون ساختار دقیق پاسخ بدون کلید واقعی قابل تایید نبود) */
function findByHints(items: unknown[], hints: string[]): number | null {
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const name = String(item.name ?? item.name_fa ?? item.symbol ?? item.title ?? "").toLowerCase();
    if (hints.some((h) => name.includes(h))) {
      const priceRaw = item.price ?? item.value ?? item.close ?? item.sell ?? item.rate;
      const price = Number(priceRaw);
      if (Number.isFinite(price) && price > 0) return price;
    }
  }
  return null;
}

export const fetchGoldLivePrice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<GoldLivePrice> => {
    const apiKey = process.env.GOLD_API_KEY;
    if (!apiKey) return { available: false };

    try {
      // brsapi.ir صراحتاً هشدار داده که User-Agent پیش‌فرض ران‌تایم‌ها (Node/Python/Go و...) را
      // مسدود می‌کند و IP سرور را می‌بندد؛ به همین دلیل هدر User-Agent مرورگر واقعی می‌فرستیم.
      const res = await fetch(`https://BrsApi.ir/Market/Gold_Currency.php?key=${encodeURIComponent(apiKey)}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
        },
      });
      if (!res.ok) return { available: false };
      const json = (await res.json()) as unknown;

      // پاسخ ممکن است شیء با چند آرایه (gold/currency/coin) یا یک آرایه‌ی تخت باشد — هر دو را پوشش می‌دهیم
      const buckets: unknown[] = [];
      if (Array.isArray(json)) {
        buckets.push(...json);
      } else if (json && typeof json === "object") {
        for (const v of Object.values(json as Record<string, unknown>)) {
          if (Array.isArray(v)) buckets.push(...v);
        }
      }
      if (buckets.length === 0) return { available: false };

      const gram18 = findByHints(buckets, ["18", "طلای 18", "طلا 18", "gold_18", "gold18", "geram18"]);
      if (!gram18) return { available: false };

      const coinPrices: GoldLivePrice["coinPrices"] = {};
      const emami = findByHints(buckets, ["امامی", "emami"]);
      const bahar = findByHints(buckets, ["بهار", "bahar"]);
      const half = findByHints(buckets, ["نیم سکه", "sekee_half", "half"]);
      const quarter = findByHints(buckets, ["ربع سکه", "sekee_quarter", "quarter"]);
      const gerami = findByHints(buckets, ["گرمی", "gerami"]);
      if (emami) coinPrices.emami = toToman(emami);
      if (bahar) coinPrices.bahar = toToman(bahar);
      if (half) coinPrices.half = toToman(half);
      if (quarter) coinPrices.quarter = toToman(quarter);
      if (gerami) coinPrices.gerami = toToman(gerami);

      return {
        available: true,
        pricePerGram18: toToman(gram18),
        coinPrices,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return { available: false };
    }
  });
