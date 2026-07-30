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

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
];

function pickUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

async function fetchJson(url: string, ms = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json,text/plain,*/*",
        "accept-language": "fa-IR,fa;q=0.9,en;q=0.8",
        referer: "https://www.tgju.org/",
        "user-agent": pickUA(),
        "cache-control": "no-cache",
      },
    });
    if (res.status === 403 || res.status === 429) throw new Error(`BLOCKED_${res.status}`);
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

/** حداقل فاصله بین دو بروزرسانی دستی کاربر */
const FORCE_MIN_AGE_MS = 30 * 1000;

/** وقتی منبعی بلاک/خطا بدهد، مدتی کنار گذاشته می‌شود (circuit breaker) */
const cooldown: Record<string, number> = {};
const COOLDOWN_MS = 10 * 60 * 1000;

/** حداکثر عمر کش اضطراری وقتی همه‌ی منابع از کار افتاده‌اند (۱۲ ساعت) */
const STALE_MAX_MS = 12 * 60 * 60 * 1000;

export const getGoldPrices = createServerFn({ method: "GET" })
  .inputValidator((data: { force?: boolean } | undefined) => ({ force: !!data?.force }))
  .handler(async ({ data }): Promise<GoldPricesResult> => {
    const force = data.force;
    const ttl = force ? FORCE_MIN_AGE_MS : CACHE_TTL_MS;

    if (cache && Date.now() < cache.expiresAt - (CACHE_TTL_MS - ttl)) {
      return { ok: true, items: cache.items, updatedAt: cache.updatedAt, source: "cache" };
    }

    // کش مشترک دیتابیس (بین همه‌ی سرورها و کاربران)
    const shared = await readSharedCache();
    if (shared && Date.now() - new Date(shared.updatedAt).getTime() < ttl) {
      cache = {
        items: shared.items,
        updatedAt: shared.updatedAt,
        expiresAt: new Date(shared.updatedAt).getTime() + CACHE_TTL_MS,
      };
      return { ok: true, items: shared.items, updatedAt: shared.updatedAt, source: shared.source };
    }

    const errors: string[] = [];

    const allSources: Array<{ label: string; run: () => Promise<GoldQuote[]> }> = [
      { label: "tgju", run: () => fromTgju("https://call3.tgju.org/ajax.json") },
      { label: "tgju2", run: () => fromTgju("https://call1.tgju.org/ajax.json") },
      { label: "tgju4", run: () => fromTgju("https://call4.tgju.org/ajax.json") },
      { label: "tgju5", run: () => fromTgju("https://call5.tgju.org/ajax.json") },
      { label: "tgju-api", run: () => fromTgju("https://api.tgju.online/v1/data/sana/json") },
    ];

    const now = Date.now();
    // منابعی که اخیراً بلاک شده‌اند را فعلاً کنار بگذار (اما اگر همه در cooldown بودند، همه را امتحان کن)
    const ready = allSources.filter((s) => !cooldown[s.label] || cooldown[s.label] < now);
    const sources = ready.length ? ready : allSources;

    for (const s of sources) {
      try {
        const items = await s.run();
        if (items.length > 0) {
          const updatedAt = new Date().toISOString();
          cache = { items, updatedAt, expiresAt: Date.now() + CACHE_TTL_MS };
          delete cooldown[s.label];
          await writeSharedCache(items, s.label, updatedAt);
          return { ok: true, items, updatedAt, source: s.label };
        }
        errors.push(`${s.label}: داده‌ای برنگشت`);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (msg.startsWith("BLOCKED_")) cooldown[s.label] = Date.now() + COOLDOWN_MS;
        errors.push(`${s.label}: ${msg}`);
        // مکث کوتاه تصادفی تا الگوی درخواست‌ها شبیه ربات نباشد
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
      }
    }

    // اگر همه‌ی منابع خطا دادند، آخرین نرخ ذخیره‌شده را نشان بده
    if (shared && Date.now() - new Date(shared.updatedAt).getTime() < STALE_MAX_MS) {
      return { ok: true, items: shared.items, updatedAt: shared.updatedAt, source: "cache" };
    }
    if (shared) {
      return { ok: true, items: shared.items, updatedAt: shared.updatedAt, source: "cache-stale" };
    }

    return {
      ok: false,
      error:
        "دریافت نرخ لحظه‌ای از هیچ‌کدام از سرویس‌ها ممکن نشد. می‌توانید نرخ هر گرم طلای ۱۸ را دستی وارد کنید و ماشین‌حساب فاکتور را استفاده کنید.\n" +
        `جزئیات: ${errors.join(" | ")}`,
    };
  });
