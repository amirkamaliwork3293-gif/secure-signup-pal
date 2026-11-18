import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clientIp,
  enforceRateLimit,
  isPaymentPending,
  PAYMENT_PENDING_FEATURE_MESSAGE,
  requireActiveSubscription,
  tryConsumeRateLimit,
} from "@/lib/rate-limit.server";
import { sanitizeScanResult, type RawScanResult } from "@/lib/invoice-scan";

/**
 * اسکن فاکتور خرید با هوش مصنوعی (سمت سرور).
 *
 * سرویس‌ها به ترتیب امتحان می‌شوند — هر کدام کلیدش روی هاست تنظیم شده باشد:
 *   ۱) Google Gemini           → GEMINI_API_KEY      (مدل: GEMINI_MODEL)
 *   ۲) Anthropic Claude        → ANTHROPIC_API_KEY   (مدل: ANTHROPIC_VISION_MODEL)
 *   ۳) هر سرویس سازگار با OpenAI (OpenRouter، Groq، ...)
 *                              → VISION_API_KEY + VISION_API_BASE_URL + VISION_MODEL
 * اگر یکی خطای «در دسترس نیست / سهمیه / پرداخت» داد، سراغ بعدی می‌رود.
 *
 * سهمیه (قابل تنظیم با متغیر محیطی، بدون تغییر کد):
 *   INVOICE_SCAN_DAILY_PER_USER  (پیش‌فرض ۲)   — اسکن موفق هر کاربر در ۲۴ ساعت
 *   INVOICE_SCAN_DAILY_GLOBAL    (پیش‌فرض ۴۸۰) — اسکن موفق کل برنامه در ۲۴ ساعت
 * فقط اسکن «موفق» از سهمیه کم می‌شود؛ تلاش‌های ناموفق سقف جداگانه‌ی ضدسوءاستفاده دارند.
 *
 * این تابع هیچ داده‌ای از کاربر ذخیره نمی‌کند — عکس فقط برای خواندن فرستاده می‌شود.
 */

const DAY = 86_400;
const userLimit = () => clampInt(process.env.INVOICE_SCAN_DAILY_PER_USER, 2, 0, 1000);
const globalLimit = () => clampInt(process.env.INVOICE_SCAN_DAILY_GLOBAL, 480, 0, 1_000_000);

function clampInt(v: string | undefined, def: number, min: number, max: number): number {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

const userBucket = (userId: string) => `inv-scan:${userId}`.slice(0, 200);
const GLOBAL_BUCKET = "inv-scan-global:all";

// ─── ورودی ───────────────────────────────────────────────────────────────────

/** Vercel بدنهٔ درخواست را تا ~۴٫۵ مگابایت قبول می‌کند؛ کلاینت عکس‌ها را کوچک می‌کند. */
const MAX_TOTAL_BASE64 = 4_000_000;

const ImageSchema = z.object({
  data: z
    .string()
    .min(2_000)
    .max(MAX_TOTAL_BASE64)
    .regex(/^[A-Za-z0-9+/=]+$/, "invalid image"),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

const InputSchema = z
  .object({ images: z.array(ImageSchema).min(1).max(4) })
  .refine((v) => v.images.reduce((s, i) => s + i.data.length, 0) <= MAX_TOTAL_BASE64, {
    message: "حجم عکس‌ها زیاد است",
  });

type ScanImage = z.infer<typeof ImageSchema>;

export type InvoiceScanErrorCode =
  | "not_configured"
  | "unavailable"
  | "quota_user"
  | "quota_global"
  | "not_invoice"
  | "failed"
  | "payment_pending";

export type InvoiceScanResponse =
  | { ok: true; result: RawScanResult; remaining: number; limit: number }
  | { ok: false; code: InvoiceScanErrorCode; error: string };

export type InvoiceScanQuota = {
  configured: boolean;
  limit: number;
  used: number;
  remaining: number;
};

// ─── شمارش سهمیه (فقط خواندن) ───────────────────────────────────────────────

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** مصرف فعلی یک سطل در پنجرهٔ ۲۴ ساعته — بدون مصرف سهمیه. خطا = پر (سمت امن). */
async function peekUsage(admin: Admin, bucket: string): Promise<number> {
  const { data, error } = await admin
    .from("rate_limits")
    .select("count, window_start")
    .eq("bucket", bucket)
    .maybeSingle();
  if (error) {
    console.error("[invoice-scan] quota read failed", error);
    return Number.POSITIVE_INFINITY;
  }
  if (!data) return 0;
  const started = Date.parse(String(data.window_start));
  if (!Number.isFinite(started) || started < Date.now() - DAY * 1000) return 0;
  return Number(data.count) || 0;
}

// ─── سرویس‌دهنده‌ها ──────────────────────────────────────────────────────────

type ProviderResult =
  | { kind: "ok"; json: unknown }
  | { kind: "unavailable"; detail: string }
  | { kind: "error"; detail: string };

type Provider = { name: string; run: (images: ScanImage[]) => Promise<ProviderResult> };

/** سرویسی که «پرداخت لازم است/در دسترس نیست» گفت، تا ۱۰ دقیقه دوباره صدا زده نمی‌شود. */
const cooldownUntil = new Map<string, number>();
const COOLDOWN_MS = 10 * 60 * 1000;

const SYSTEM_PROMPT = `You read photos of Iranian purchase invoices (فاکتور خرید) for a shop's inventory app.
The photos may be several pages of ONE invoice. Text is usually Persian; numbers may be Persian digits.
Extract EVERY product line in order. Rules:
- name: the product description exactly as written (Persian), without the row number.
- code: product code/barcode/SKU column if present, else null. Never invent codes.
- quantity: number of units bought (the تعداد/مقدار column).
- unit: unit as written (عدد، کیلو، کارتن، بسته...) or null.
- unitPrice: price per unit (فی / قیمت واحد) as a plain number, no separators.
- lineTotal: row total (مبلغ کل ردیف) as a plain number.
- If a value is unreadable, use null. Do NOT guess numbers.
- Skip summary rows (جمع، تخفیف، مالیات، ارزش افزوده، قابل پرداخت) — they are not items.
- confidence: "high" if clearly readable, "medium", or "low" if blurry/handwritten-uncertain.
- currency: "rial" if amounts are in ریال, "toman" if تومان, else "unknown".
- supplierName / supplierPhone: the SELLER (فروشنده) on the invoice, else null.
- discount: invoice-level discount amount, total: final payable total; null if absent.
- If the image is not an invoice, return items: [] and explain briefly in notes (Persian).
Return ONLY JSON matching this shape:
{"supplierName":null,"supplierPhone":null,"invoiceNumber":null,"invoiceDate":null,"currency":"unknown","items":[{"name":"","code":null,"quantity":0,"unit":null,"unitPrice":0,"lineTotal":0,"confidence":"high"}],"discount":null,"total":null,"notes":null}`;

const USER_PROMPT = "اقلام این فاکتور خرید را استخراج کن و فقط JSON برگردان.";

function extractJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/** خطای HTTP سرویس → «در دسترس نیست» (برو سراغ بعدی) یا خطای واقعی */
function classifyHttp(status: number, body: string): ProviderResult {
  const detail = `${status}: ${body.slice(0, 300)}`;
  if ([401, 402, 403, 404, 408, 429, 500, 502, 503, 504, 529].includes(status)) {
    return { kind: "unavailable", detail };
  }
  return { kind: "error", detail };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55_000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    supplierName: { type: "STRING", nullable: true },
    supplierPhone: { type: "STRING", nullable: true },
    invoiceNumber: { type: "STRING", nullable: true },
    invoiceDate: { type: "STRING", nullable: true },
    currency: { type: "STRING", enum: ["rial", "toman", "unknown"] },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          code: { type: "STRING", nullable: true },
          quantity: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", nullable: true },
          unitPrice: { type: "NUMBER", nullable: true },
          lineTotal: { type: "NUMBER", nullable: true },
          confidence: { type: "STRING", enum: ["high", "medium", "low"] },
        },
        required: ["name", "confidence"],
      },
    },
    discount: { type: "NUMBER", nullable: true },
    total: { type: "NUMBER", nullable: true },
    notes: { type: "STRING", nullable: true },
  },
  required: ["currency", "items"],
};

function geminiProvider(apiKey: string): Provider {
  const model = (process.env.GEMINI_MODEL || "gemini-flash-lite-latest").replace(/[^\w.-]/g, "");
  return {
    name: "gemini",
    run: async (images) => {
      const res = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { "x-goog-api-key": apiKey },
        {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [
            {
              role: "user",
              parts: [
                ...images.map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } })),
                { text: USER_PROMPT },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
            responseSchema: GEMINI_SCHEMA,
          },
        },
      );
      if (!res.ok) return classifyHttp(res.status, await res.text().catch(() => ""));
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      const parsed = extractJson(text);
      return parsed ? { kind: "ok", json: parsed } : { kind: "error", detail: "bad json" };
    },
  };
}

function anthropicProvider(apiKey: string): Provider {
  const model = process.env.ANTHROPIC_VISION_MODEL || "claude-haiku-5-5";
  return {
    name: "anthropic",
    run: async (images) => {
      const res = await postJson(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: 8192,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                ...images.map((im) => ({
                  type: "image",
                  source: { type: "base64", media_type: im.mime, data: im.data },
                })),
                { type: "text", text: USER_PROMPT },
              ],
            },
          ],
        },
      );
      if (!res.ok) return classifyHttp(res.status, await res.text().catch(() => ""));
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = (json.content ?? [])
        .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
        .join("");
      const parsed = extractJson(text);
      return parsed ? { kind: "ok", json: parsed } : { kind: "error", detail: "bad json" };
    },
  };
}

function openAiCompatibleProvider(apiKey: string, baseUrl: string, model: string): Provider {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    name: "openai-compatible",
    run: async (images) => {
      const res = await postJson(
        `${base}/chat/completions`,
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          temperature: 0,
          max_tokens: 8192,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                ...images.map((im) => ({
                  type: "image_url",
                  image_url: { url: `data:${im.mime};base64,${im.data}` },
                })),
                { type: "text", text: USER_PROMPT },
              ],
            },
          ],
        },
      );
      if (!res.ok) return classifyHttp(res.status, await res.text().catch(() => ""));
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
      };
      const c = json.choices?.[0]?.message?.content;
      const text = typeof c === "string" ? c : (c ?? []).map((p) => p.text ?? "").join("");
      const parsed = extractJson(text);
      return parsed ? { kind: "ok", json: parsed } : { kind: "error", detail: "bad json" };
    },
  };
}

function configuredProviders(): Provider[] {
  const list: Provider[] = [];
  const gemini = process.env.GEMINI_API_KEY?.trim();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  const vKey = process.env.VISION_API_KEY?.trim();
  const vBase = process.env.VISION_API_BASE_URL?.trim();
  const vModel = process.env.VISION_MODEL?.trim();
  if (gemini) list.push(geminiProvider(gemini));
  if (anthropic) list.push(anthropicProvider(anthropic));
  if (vKey && vBase && vModel && /^https:\/\//.test(vBase)) {
    list.push(openAiCompatibleProvider(vKey, vBase, vModel));
  }
  return list;
}

function availableProviders(): Provider[] {
  const now = Date.now();
  return configuredProviders().filter((p) => (cooldownUntil.get(p.name) ?? 0) <= now);
}

// ─── توابع سرور ─────────────────────────────────────────────────────────────

/** سهمیهٔ باقی‌ماندهٔ امروز کاربر (برای نمایش در صفحه) */
export const getInvoiceScanQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InvoiceScanQuota> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const limit = userLimit();
    const configured = availableProviders().length > 0;
    const used = await peekUsage(supabaseAdmin, userBucket(context.userId));
    const safeUsed = Number.isFinite(used) ? used : limit;
    return { configured, limit, used: safeUsed, remaining: Math.max(0, limit - safeUsed) };
  });

export const scanPurchaseInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<InvoiceScanResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requireActiveSubscription(context.supabase, context.userId);
    if (await isPaymentPending(supabaseAdmin, context.userId, context.claims)) {
      return { ok: false, code: "payment_pending", error: PAYMENT_PENDING_FEATURE_MESSAGE };
    }

    const providers = availableProviders();
    if (providers.length === 0) {
      return {
        ok: false,
        code: configuredProviders().length ? "unavailable" : "not_configured",
        error: configuredProviders().length
          ? "سرویس خواندن فاکتور موقتاً در دسترس نیست. چند دقیقه‌ی دیگر امتحان کنید یا اقلام را دستی وارد کنید."
          : "قابلیت اسکن فاکتور هنوز روی سرور فعال نشده است. فعلاً اقلام را دستی وارد کنید.",
      };
    }

    const limit = userLimit();
    const gLimit = globalLimit();
    const used = await peekUsage(supabaseAdmin, userBucket(context.userId));
    if (used >= limit) {
      return {
        ok: false,
        code: "quota_user",
        error: `سهمیه‌ی اسکن امروز شما (${limit} فاکتور) تمام شده است. ۲۴ ساعت بعد از اولین اسکن دوباره فعال می‌شود — تا آن موقع می‌توانید اقلام را دستی وارد کنید.`,
      };
    }
    if ((await peekUsage(supabaseAdmin, GLOBAL_BUCKET)) >= gLimit) {
      return {
        ok: false,
        code: "quota_global",
        error:
          "ظرفیت اسکن فاکتور برای امروز پر شده است. لطفاً فردا امتحان کنید یا اقلام را دستی وارد کنید.",
      };
    }

    // ضدسوءاستفاده: تلاش‌ها (حتی ناموفق) هم سقف دارند
    await enforceRateLimit(
      supabaseAdmin,
      "inv-scan-try",
      context.userId,
      Math.max(6, limit * 4),
      DAY,
      "تعداد تلاش‌های اسکن امروز زیاد بوده است. لطفاً اقلام را دستی وارد کنید.",
    );
    await enforceRateLimit(supabaseAdmin, "inv-scan-ip", clientIp(), 60, DAY);

    let anyUnavailable = false;
    for (const p of providers) {
      let r: ProviderResult;
      try {
        r = await p.run(data.images);
      } catch (e) {
        r = { kind: "unavailable", detail: String((e as Error)?.message ?? e) };
      }
      if (r.kind === "ok") {
        const result = sanitizeScanResult(r.json);
        if (result.items.length === 0) {
          return {
            ok: false,
            code: "not_invoice",
            error:
              result.notes ||
              "در این عکس ردیف کالایی پیدا نشد. عکس را واضح‌تر، صاف و با نور کافی بگیرید.",
          };
        }
        // فقط اسکن موفق از سهمیه کم می‌شود
        await tryConsumeRateLimit(supabaseAdmin, "inv-scan", context.userId, limit, DAY);
        await tryConsumeRateLimit(supabaseAdmin, "inv-scan-global", "all", gLimit, DAY);
        return { ok: true, result, limit, remaining: Math.max(0, limit - used - 1) };
      }
      console.error(`[invoice-scan] provider ${p.name} failed (${r.kind})`, r.detail);
      if (r.kind === "unavailable") {
        anyUnavailable = true;
        // پرداخت/دسترسی (نه شلوغی لحظه‌ای) → چند دقیقه سراغش نرو
        if (/^(401|402|403|404):/.test(r.detail))
          cooldownUntil.set(p.name, Date.now() + COOLDOWN_MS);
      }
    }
    return {
      ok: false,
      code: anyUnavailable ? "unavailable" : "failed",
      error: anyUnavailable
        ? "سرویس خواندن فاکتور الان در دسترس نیست. چند دقیقه‌ی دیگر امتحان کنید یا اقلام را دستی وارد کنید."
        : "خواندن فاکتور ناموفق بود. یک عکس واضح‌تر بگیرید و دوباره امتحان کنید.",
    };
  });
