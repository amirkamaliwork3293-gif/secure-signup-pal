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
  /** دلیل در دسترس نبودن (فقط برای عیب‌یابی) */
  reason?: string;
};

function toToman(rialOrToman: number): number {
  // برخی سرویس‌ها نرخ را به ریال می‌دهند؛ اگر عدد خیلی بزرگ بود (بیش از حد معمول تومان)، به تومان تبدیل می‌کنیم.
  return rialOrToman > 100_000_000 ? Math.round(rialOrToman / 10) : Math.round(rialOrToman);
}

/** جست‌وجوی یک آیتم بر اساس symbol دقیق یا کلیدواژه‌های نام */
function findByHints(items: unknown[], hints: string[], symbols: string[] = []): number | null {
  const priceOf = (item: Record<string, unknown>) => {
    const raw = item.price ?? item.value ?? item.close ?? item.sell ?? item.rate;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // اول تطبیق دقیق symbol (پایدارترین کلید در پاسخ BrsApi)
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const sym = String(item.symbol ?? "").toUpperCase();
    if (sym && symbols.includes(sym)) {
      const p = priceOf(item);
      if (p) return p;
    }
  }
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const name = String(item.name ?? item.name_fa ?? item.symbol ?? item.title ?? "").toLowerCase();
    if (hints.some((h) => name.includes(h.toLowerCase()))) {
      const p = priceOf(item);
      if (p) return p;
    }
  }
  return null;
}

export const fetchGoldLivePrice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<GoldLivePrice> => {
    const apiKey = process.env.GOLD_API_KEY;
    if (!apiKey) return { available: false, reason: "GOLD_API_KEY تنظیم نشده است" };

    // آدرس درست سرویس /Api/Market/... است؛ نسخه‌ی بدون /Api هم به‌عنوان جایگزین تست می‌شود.
    const endpoints = [
      `https://BrsApi.ir/Api/Market/Gold_Currency.php?key=${encodeURIComponent(apiKey)}`,
      `https://BrsApi.ir/Market/Gold_Currency.php?key=${encodeURIComponent(apiKey)}`,
    ];

    let json: unknown = null;
    let lastReason = "";
    for (const url of endpoints) {
      try {
        // brsapi.ir صراحتاً هشدار داده که User-Agent پیش‌فرض ران‌تایم‌ها را مسدود می‌کند،
        // پس هدر مرورگر واقعی می‌فرستیم.
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "application/json,text/plain,*/*",
          },
        });
        const text = await res.text();
        if (!res.ok) {
          lastReason = `HTTP ${res.status}: ${text.slice(0, 120)}`;
          continue;
        }
        try {
          json = JSON.parse(text);
        } catch {
          lastReason = `پاسخ JSON نبود: ${text.slice(0, 120)}`;
          continue;
        }
        break;
      } catch (e) {
        lastReason = e instanceof Error ? e.message : "خطای شبکه";
      }
    }
    if (json === null) return { available: false, reason: lastReason || "عدم دسترسی به سرویس" };

    try {
      // پاسخ ممکن است شیء با چند آرایه (gold/currency/coin) یا یک آرایه‌ی تخت باشد — هر دو را پوشش می‌دهیم
      const buckets: unknown[] = [];
      if (Array.isArray(json)) {
        buckets.push(...json);
      } else if (json && typeof json === "object") {
        for (const v of Object.values(json as Record<string, unknown>)) {
          if (Array.isArray(v)) buckets.push(...v);
        }
      }
      if (buckets.length === 0) return { available: false, reason: "ساختار پاسخ سرویس ناشناخته است" };

      const gram18 = findByHints(
        buckets,
        ["18 عیار", "طلای 18", "طلا 18", "gold_18", "gold18", "geram18", "۱۸ عیار"],
        ["IR_GOLD_18K"],
      );
      if (!gram18) return { available: false, reason: "نرخ طلای ۱۸ عیار در پاسخ سرویس یافت نشد" };

      const coinPrices: GoldLivePrice["coinPrices"] = {};
      const emami = findByHints(buckets, ["امامی", "emami"], ["IR_COIN_EMAMI"]);
      const bahar = findByHints(buckets, ["بهار", "bahar"], ["IR_COIN_BAHAR"]);
      const half = findByHints(buckets, ["نیم سکه", "half"], ["IR_COIN_HALF"]);
      const quarter = findByHints(buckets, ["ربع سکه", "quarter"], ["IR_COIN_QUARTER"]);
      const gerami = findByHints(buckets, ["گرمی", "gerami"], ["IR_COIN_1G"]);
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
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : "خطای پردازش پاسخ" };
    }
  });
