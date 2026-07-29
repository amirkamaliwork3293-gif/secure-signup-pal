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

export const getGoldPrices = createServerFn({ method: "GET" }).handler(
  async (): Promise<GoldPricesResult> => {
    const key = process.env.GOLD_API_KEY || process.env.BRSAPI_KEY;
    if (!key) {
      return {
        ok: false,
        error:
          "کلید سرویس نرخ طلا تنظیم نشده است. در تنظیمات هاست (Vercel ← Environment Variables) متغیری با نام GOLD_API_KEY بسازید و مقدار کلید BrsApi.ir را در آن بگذارید، سپس پروژه را دوباره Deploy کنید.",
      };
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(
        `https://BrsApi.ir/Api/Market/Gold_Currency.php?key=${encodeURIComponent(key)}`,
        { signal: ctrl.signal, headers: { accept: "application/json" } },
      ).finally(() => clearTimeout(timer));

      if (!res.ok) {
        return { ok: false, error: `سرویس نرخ پاسخ نداد (کد ${res.status}).` };
      }
      const json = (await res.json()) as {
        gold?: BrsRow[];
        currency?: BrsRow[];
        error?: string;
      };
      if (json?.error) return { ok: false, error: String(json.error) };

      const goldRows = mapRows(json.gold, "gold");
      // سکه‌ها در همان آرایه‌ی gold با نام «سکه ...» می‌آیند
      const items = [
        ...goldRows.map((g) => (g.name.includes("سکه") ? { ...g, group: "coin" as const } : g)),
        ...mapRows(json.currency, "currency").filter((c) =>
          ["USD", "EUR", "AED"].includes(c.key.toUpperCase()),
        ),
      ];
      if (items.length === 0) return { ok: false, error: "داده‌ای از سرویس نرخ دریافت نشد." };
      return { ok: true, items, updatedAt: new Date().toISOString() };
    } catch (e) {
      return {
        ok: false,
        error: `ارتباط با سرویس نرخ برقرار نشد: ${String((e as Error)?.message ?? e)}`,
      };
    }
  },
);
