/**
 * کلاینت واقعی supabase-js رو به PostgREST محلی (scripts/e2e/run-real-server.sh).
 * فقط برای آزمون سرتاسری؛ توکن با همان کلید محرمانهٔ آزمایشی PostgREST امضا می‌شود.
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const USER_ID = process.env.E2E_USER_ID ?? "00000000-0000-0000-0000-0000000000e2";
const SECRET = process.env.E2E_JWT_SECRET ?? "kamix-local-test-secret-kamix-local-test-secret";
const URL = process.env.E2E_REST_URL ?? "http://127.0.0.1:54330";

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function jwt(claims: Record<string, unknown>): string {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
const token = jwt({
  role: "authenticated",
  sub: USER_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
});

/** شمارش و حجم درخواست‌ها */
export const wire = { calls: [] as { method: string; path: string; sent: number; got: number }[] };

const real = createClient("http://unused.invalid", "anon", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    // PostgREST بدون پیشوند /rest/v1 سرویس می‌دهد
    fetch: async (input, init) => {
      const u = String(input).replace("http://unused.invalid/rest/v1", URL);
      const res = await fetch(u, init);
      const copy = res.clone();
      const text = await copy.text();
      wire.calls.push({
        method: init?.method ?? "GET",
        path: u.slice(URL.length).split("?")[0],
        sent: typeof init?.body === "string" ? init.body.length : 0,
        got: text.length,
      });
      return res;
    },
    headers: { Authorization: `Bearer ${token}` },
  },
});

export const supabase = {
  from: real.from.bind(real),
  rpc: real.rpc.bind(real),
  // realtime در این آزمون نیست: برنامه باید بدون آن هم کامل کار کند
  auth: {
    async refreshSession() {
      return { data: {}, error: null };
    },
    async getSession() {
      return { data: { session: { access_token: token, user: { id: USER_ID } } } };
    },
  },
};
