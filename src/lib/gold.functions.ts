import { createServerFn } from "@tanstack/react-start";

/**
 * نرخ لحظه‌ای طلا/سکه/ارز از سرویس BrsApi.ir
 * کلید باید در متغیرهای محیطی سرور با نام GOLD_API_KEY تنظیم شود
 * (در Vercel: Project → Settings → Environment Variables).
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
  | { ok: true; items: GoldQuote[]; updatedAt: string }
  | { ok: false; error: string };

type BrsRow = {
  symbol?: string;
  name?: string;
  name_en?: string;
  price?: number | string;
  unit?: string;
  change_percent?: number | string;
  date?: string;
  time?: string;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function mapRows(rows: BrsRow[] | undefined, group: GoldQuote["group"]): GoldQuote[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r, i) => ({
      key: String(r.symbol ?? r.name_en ?? `${group}-${i}`),
      name: String(r.name ?? r.symbol ?? "—"),
      price: num(r.price),
      unit: String(r.unit ?? "تومان"),
      changePercent: r.change_percent === undefined ? null : num(r.change_percent),
      group,
    }))
    .filter((q) => q.price > 0);
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

/** منبع ۱: BrsApi.ir (نیازمند کلید) — آدرس صحیح: https://Api.BrsApi.ir/Market/ */
async function fromBrsApi(key: string): Promise<GoldQuote[]> {
  const json = (await fetchJson(
    `https://Api.BrsApi.ir/Market/Gold_Currency.php?key=${encodeURIComponent(key)}`,
  )) as { gold?: BrsRow[]; currency?: BrsRow[]; error?: string };
  if (json?.error) throw new Error(String(json.error));
  const goldRows = mapRows(json.gold, "gold");
  const coinRows = mapRows(json.gold, "coin").filter((r) =>
    /سکه|coin|نیم|ربع|گرمی|امامی|آزادی/i.test(r.name),
  );
  return [
    ...goldRows.filter((r) => !coinRows.includes(r)),
    ...coinRows,
    ...mapRows(json.currency, "currency").filter((c) =>
      ["USD", "EUR", "AED", "GBP", "TRY", "CHF", "CAD", "AUD", "CNY"].includes(
        c.key.toUpperCase(),
      ),
    ),
  ];
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

export const getGoldPrices = createServerFn({ method: "GET" }).handler(
  async (): Promise<GoldPricesResult> => {
    if (cache && cache.expiresAt > Date.now()) {
      return { ok: true, items: cache.items, updatedAt: cache.updatedAt };
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
          return { ok: true, items, updatedAt };
        }
        errors.push(`${s.label}: داده‌ای برنگشت`);
      } catch (e) {
        errors.push(`${s.label}: ${String((e as Error)?.message ?? e)}`);
      }
    }

    return {
      ok: false,
      error:
        "دریافت نرخ لحظه‌ای از هیچ‌کدام از سرویس‌ها ممکن نشد. می‌توانید نرخ هر گرم طلای ۱۸ را دستی وارد کنید و ماشین‌حساب فاکتور را استفاده کنید.\n" +
        `جزئیات: ${errors.join(" | ")}`,
    };
  },
);
