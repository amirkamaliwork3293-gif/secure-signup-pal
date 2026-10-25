/**
 * مسیر جایگزین سوپابیس (fallback-fetch + proxy.server) بدون شبکهٔ واقعی.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-supabase-fallback.ts
 */
import assert from "node:assert/strict";
import {
  createFallbackFetch,
  PROXY_STICKY_MS,
  PROXY_UNTIL_KEY,
} from "../src/integrations/supabase/fallback-fetch.ts";
import {
  isSupabaseProxyPath,
  proxySupabaseRequest,
} from "../src/integrations/supabase/proxy.server.ts";

const SB = "https://abc.supabase.co";
const PROXY = "https://kamixapp.ir/sb";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

type Call = { url: string; init?: RequestInit };

function fakeFetch(behave: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return behave(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const failDirect = (url: string) =>
  url.startsWith(SB)
    ? Promise.reject(new TypeError("Failed to fetch"))
    : Promise.resolve(new Response("via-proxy"));

// ۱) مسیر مستقیم سالم → اصلاً سراغ پروکسی نمی‌رود
{
  const { fn, calls } = fakeFetch(async () => new Response("direct"));
  const storage = memoryStorage();
  const f = createFallbackFetch({
    supabaseUrl: SB,
    proxyBase: () => PROXY,
    baseFetch: fn,
    storage,
  });
  const res = await f(`${SB}/rest/v1/user_data?select=*`, { method: "GET" });
  assert.equal(await res.text(), "direct");
  assert.equal(calls.length, 1);
  assert.equal(storage.m.size, 0);
}

// ۲) مستقیم «Failed to fetch» → همان درخواست (با بدنه و هدرها) از پروکسی، و حالت پروکسی ذخیره می‌شود
{
  const { fn, calls } = fakeFetch(failDirect);
  const storage = memoryStorage();
  let t = 1_000;
  const f = createFallbackFetch({
    supabaseUrl: SB,
    proxyBase: () => PROXY,
    baseFetch: fn,
    storage,
    now: () => t,
  });
  const body = JSON.stringify({ email: "a@kamali.local", password: "x" });
  const res = await f(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    body,
    headers: { apikey: "k" },
  });
  assert.equal(await res.text(), "via-proxy");
  assert.equal(calls[1].url, `${PROXY}/auth/v1/token?grant_type=password`);
  assert.equal(calls[1].init?.body, body);
  assert.equal(calls[1].init?.method, "POST");
  assert.equal(storage.getItem(PROXY_UNTIL_KEY), String(1_000 + PROXY_STICKY_MS));

  // درخواست بعدی مستقیم امتحان نمی‌شود
  calls.length = 0;
  await f(`${SB}/rest/v1/user_data`);
  assert.deepEqual(
    calls.map((c) => c.url),
    [`${PROXY}/rest/v1/user_data`],
  );

  // بعد از مهلت دوباره مستقیم
  t += PROXY_STICKY_MS + 1;
  calls.length = 0;
  await f(`${SB}/rest/v1/user_data`);
  assert.equal(calls[0].url, `${SB}/rest/v1/user_data`);
}

// ۳) مستقیم معلق → بعد از مهلت از پروکسی
{
  const { fn, calls } = fakeFetch((url, init) =>
    url.startsWith(SB)
      ? new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        )
      : Promise.resolve(new Response("via-proxy")),
  );
  const f = createFallbackFetch({
    supabaseUrl: SB,
    proxyBase: () => PROXY,
    baseFetch: fn,
    storage: memoryStorage(),
    directTimeoutMs: 20,
  });
  const res = await f(`${SB}/rest/v1/x`);
  assert.equal(await res.text(), "via-proxy");
  assert.equal(calls.length, 2);
}

// ۴) هر دو مسیر قطع (واقعاً آفلاین) → همان خطای اصلی، حالت پروکسی ذخیره نمی‌شود
{
  const { fn } = fakeFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  const storage = memoryStorage();
  const f = createFallbackFetch({
    supabaseUrl: SB,
    proxyBase: () => PROXY,
    baseFetch: fn,
    storage,
  });
  await assert.rejects(f(`${SB}/rest/v1/x`), /Failed to fetch/);
  assert.equal(storage.m.size, 0);
}

// ۵) لغو توسط خود برنامه → تلاش دوباره از پروکسی نیست
{
  const { fn, calls } = fakeFetch(
    (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      ),
  );
  const f = createFallbackFetch({
    supabaseUrl: SB,
    proxyBase: () => PROXY,
    baseFetch: fn,
    storage: memoryStorage(),
  });
  const ctrl = new AbortController();
  const p = f(`${SB}/rest/v1/x`, { signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p);
  assert.equal(calls.length, 1);
}

// ۶) بدون مسیر جایگزین (سرور) یا آدرس دیگر → دست‌نخورده
{
  const { fn, calls } = fakeFetch(failDirect);
  const f = createFallbackFetch({
    supabaseUrl: SB,
    proxyBase: () => null,
    baseFetch: fn,
    storage: memoryStorage(),
  });
  await assert.rejects(f(`${SB}/rest/v1/x`), /Failed to fetch/);
  assert.equal(calls.length, 1);
  const g = createFallbackFetch({
    supabaseUrl: SB,
    proxyBase: () => PROXY,
    baseFetch: fn,
    storage: memoryStorage(),
  });
  await g("https://kamixapp.ir/favicon.ico");
  assert.equal(calls.length, 2);
}

// ۷) حالت پروکسی ولی سایت در دسترس نیست → مستقیم، و برگشت به حالت عادی
{
  const { fn } = fakeFetch((url) =>
    url.startsWith(PROXY)
      ? Promise.reject(new TypeError("Failed to fetch"))
      : Promise.resolve(new Response("direct")),
  );
  const storage = memoryStorage();
  storage.setItem(PROXY_UNTIL_KEY, String(Date.now() + 60_000));
  const f = createFallbackFetch({
    supabaseUrl: SB,
    proxyBase: () => PROXY,
    baseFetch: fn,
    storage,
  });
  assert.equal(await (await f(`${SB}/rest/v1/x`)).text(), "direct");
  assert.equal(storage.m.size, 0);
}

// ─── proxy.server ─────────────────────────────────────────────────────────────
assert.equal(isSupabaseProxyPath("/sb/auth/v1/token"), true);
assert.equal(isSupabaseProxyPath("/sbx"), false);
assert.equal(isSupabaseProxyPath("/login"), false);

{
  const { fn, calls } = fakeFetch(
    async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "set-cookie": "a=b",
        },
      }),
  );
  const req = new Request("https://kamixapp.ir/sb/rest/v1/user_data?select=id", {
    method: "PATCH",
    body: '{"a":1}',
    headers: {
      apikey: "k",
      authorization: "Bearer t",
      prefer: "return=representation",
      cookie: "secret=1",
      "x-forwarded-for": "1.2.3.4",
      "content-type": "application/json",
    },
  });
  const res = await proxySupabaseRequest(req, SB, fn);
  assert.equal(calls[0].url, `${SB}/rest/v1/user_data?select=id`);
  const h = new Headers(calls[0].init?.headers);
  assert.equal(h.get("apikey"), "k");
  assert.equal(h.get("authorization"), "Bearer t");
  assert.equal(h.get("prefer"), "return=representation");
  assert.equal(h.get("cookie"), null);
  assert.equal(h.get("x-forwarded-for"), null);
  assert.equal(new TextDecoder().decode(calls[0].init?.body as ArrayBuffer), '{"a":1}');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-encoding"), null);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(await res.text(), '{"ok":true}');
}

// فقط APIهای سوپابیس؛ مسیر دیگر یا پیمایش پوشه رد می‌شود
for (const path of ["/sb/", "/sb/pg/query", "/sb/../admin", "/sb/realtime/v1/websocket"]) {
  const { fn, calls } = fakeFetch(async () => new Response("x"));
  const res = await proxySupabaseRequest(new Request(`https://kamixapp.ir${path}`), SB, fn);
  assert.equal(res.status, 404, path);
  assert.equal(calls.length, 0, path);
}

// سوپابیس در دسترس سرور نیست → 502 (کلاینت آن را پاسخ می‌بیند، نه قطعی)
{
  const { fn } = fakeFetch(async () => {
    throw new Error("down");
  });
  const origError = console.error;
  console.error = () => {};
  const res = await proxySupabaseRequest(
    new Request("https://kamixapp.ir/sb/auth/v1/health"),
    SB,
    fn,
  );
  console.error = origError;
  assert.equal(res.status, 502);
}

console.log("test-supabase-fallback: ok");
