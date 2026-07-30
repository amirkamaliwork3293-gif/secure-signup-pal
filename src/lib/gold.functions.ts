import { createServerFn } from "@tanstack/react-start";

/**
 * نرخ لحظه‌ای طلا/سکه/ارز از سرویس TGJU (رایگان و بدون کلید)
 * نتیجه در کش مشترک دیتابیس ذخیره می‌شود تا همه‌ی کاربران از یک درخواست استفاده کنند.
 */

export type GoldQuote = {
  key: string;
  name: string;
  price: number;
  unit: string;
  changePercent: number | null;
  group: "gold" | "coin" | "currency";
};

export type GoldPricesResult =
  | { ok: true; items: GoldQuote[]; updatedAt: string; source: string }
  | { ok: false; error: string };

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function fetchJson(url: string, ms = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

type TgjuCell = { p?: string; dp?: number | string; d?: number | string };

const TGJU_MAP: Array<{ id: string; name: string; group: GoldQuote["group"] }> = [
  { id: "geram18", name: "طلای ۱۸ عیار (هر گرم)", group: "gold" },
  { id: "geram24", name: "طلای ۲۴ عیار (هر گرم)", group: "gold" },
  { id: "mesghal", name: "مثقال طلا", group: "gold" },
  { id: "sekee", name: "سکه امامی", group: "coin" },
  { id: "sekeb", name: "سکه بهار آزادی", group: "coin" },
  { id: "nim", name: "نیم سکه", group: "coin" },
  { id: "rob", name: "ربع سکه", group: "coin" },
  { id: "gerami", name: "سکه گرمی", group: "coin" },
  { id: "price_dollar_rl", name: "دلار آمریکا", group: "currency" },
  { id: "price_eur", name: "یورو", group: "currency" },
  { id: "price_aed_dubai", name: "درهم امارات", group: "currency" },
];

/** منبع ۲ و ۳: TGJU (رایگان و بدون کلید) — قیمت‌ها به ریال هستند */
async function fromTgju(url: string): Promise<GoldQuote[]> {
  const json = (await fetchJson(url)) as { current?: Record<string, TgjuCell> };
  const cur = json?.current;
  if (!cur) throw new Error("ساختار پاسخ نامعتبر است");
  return TGJU_MAP.map(({ id, name, group }) => {
    const cell = cur[id];
    if (!cell) return null;
    const rial = num(cell.p);
    if (!rial) return null;
    return {
      key: id,
      name,
      price: Math.round(rial / 10), // ریال → تومان
      unit: "تومان",
      changePercent: cell.dp === undefined ? null : num(cell.dp),
      group,
    } satisfies GoldQuote;
  }).filter((q): q is GoldQuote => q !== null);
}

let cache: { items: GoldQuote[]; updatedAt: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // ۵ دقیقه

/** کش مشترک در دیتابیس تا همه‌ی کاربران فقط از یک درخواست استفاده کنند */
async function readSharedCache(): Promise<{ items: GoldQuote[]; updatedAt: string; source: string } | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("gold_rate_cache")
      .select("payload, source, updated_at")
      .eq("id", "latest")
      .maybeSingle();
    if (!data) return null;
    const items = (data.payload as unknown as GoldQuote[]) ?? [];
    if (!Array.isArray(items) || items.length === 0) return null;
    return { items, updatedAt: String(data.updated_at), source: String(data.source) };
  } catch {
    return null;
  }
}

async function writeSharedCache(items: GoldQuote[], source: string, updatedAt: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("gold_rate_cache")
      .upsert({ id: "latest", payload: items as unknown as never, source, updated_at: updatedAt });
  } catch {
    /* کش اختیاری است */
  }
}

export const getGoldPrices = createServerFn({ method: "GET" }).handler(
  async (): Promise<GoldPricesResult> => {
    if (cache && cache.expiresAt > Date.now()) {
      return { ok: true, items: cache.items, updatedAt: cache.updatedAt, source: "cache" };
    }

    // کش مشترک دیتابیس (بین همه‌ی سرورها و کاربران)
    const shared = await readSharedCache();
    if (shared && Date.now() - new Date(shared.updatedAt).getTime() < CACHE_TTL_MS) {
      cache = {
        items: shared.items,
        updatedAt: shared.updatedAt,
        expiresAt: new Date(shared.updatedAt).getTime() + CACHE_TTL_MS,
      };
      return { ok: true, items: shared.items, updatedAt: shared.updatedAt, source: shared.source };
    }

    const key = process.env.GOLD_API_KEY || process.env.BRSAPI_KEY;
    const errors: string[] = [];

    const sources: Array<{ label: string; run: () => Promise<GoldQuote[]> }> = [
      { label: "tgju", run: () => fromTgju("https://call3.tgju.org/ajax.json") },
      { label: "tgju2", run: () => fromTgju("https://call1.tgju.org/ajax.json") },
    ];
    if (key) {
      sources.unshift({ label: "brsapi", run: () => fromBrsApi(key) });
    } else {
      errors.push("brsapi: کلید API تنظیم نشده (GOLD_API_KEY یا BRSAPI_KEY)");
    }

    for (const s of sources) {
      try {
        const items = await s.run();
        if (items.length > 0) {
          const updatedAt = new Date().toISOString();
          cache = { items, updatedAt, expiresAt: Date.now() + CACHE_TTL_MS };
          await writeSharedCache(items, s.label, updatedAt);
          return { ok: true, items, updatedAt, source: s.label };
        }
        errors.push(`${s.label}: داده‌ای برنگشت`);
      } catch (e) {
        errors.push(`${s.label}: ${String((e as Error)?.message ?? e)}`);
      }
    }

    // اگر همه‌ی منابع خطا دادند، آخرین نرخ ذخیره‌شده را نشان بده
    if (shared) {
      return { ok: true, items: shared.items, updatedAt: shared.updatedAt, source: "cache" };
    }

    return {
      ok: false,
      error:
        "دریافت نرخ لحظه‌ای از هیچ‌کدام از سرویس‌ها ممکن نشد. می‌توانید نرخ هر گرم طلای ۱۸ را دستی وارد کنید و ماشین‌حساب فاکتور را استفاده کنید.\n" +
        `جزئیات: ${errors.join(" | ")}`,
    };
  },
);
