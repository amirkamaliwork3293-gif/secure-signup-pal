/**
 * E2E: دو مرورگر واقعی (Chromium) با یک حساب، روی برنامهٔ واقعی (vite dev) و
 * supabase-js واقعی. سرور سوپابیس با page.route شبیه‌سازی می‌شود (PostgREST +
 * auth، نوشتن «کور» بدون تریگر) تا ثابت شود خود برنامه داده را بین دستگاه‌ها
 * گم نمی‌کند.
 *
 * اجرا (playwright جزو وابستگی‌های پروژه نیست):
 *   VITE_SUPABASE_URL=http://fake-supabase.test VITE_SUPABASE_PUBLISHABLE_KEY=x \
 *     npx vite dev --port 5180 --host 127.0.0.1 &
 *   npm i --no-save playwright   # یا از هر جای دیگری که نصب است
 *   APP_URL=http://127.0.0.1:5180 node scripts/e2e-two-browsers.mjs
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const APP = process.env.APP_URL || "http://127.0.0.1:5180";
const SB = "http://fake-supabase.test";
const U = "0b9f6c2e-1111-4a5b-9c3d-000000000001";

// ─── سرور جعلی (حافظهٔ مشترک بین دو مرورگر) ────────────────────────────────
let tick = Date.UTC(2026, 9, 1);
const now = () => new Date((tick += 1)).toISOString().replace("Z", "+00:00");
const db = {
  user_data: new Map([
    [
      U,
      {
        user_id: U,
        products: [{ id: "p1", name: "چای", price: 1000, category: "", code: "", stock: 5 }],
        customers: [
          {
            id: "c1",
            firstName: "رضا",
            createdAt: 1,
            txs: [{ id: "t0", type: "debt", amount: 1000, at: 1 }],
          },
        ],
        settings: { shopName: "فروشگاه آزمایشی" },
        updated_at: now(),
      },
    ],
  ]),
};
const writes = [];

function filtersOf(url) {
  const f = {};
  for (const [k, v] of url.searchParams) if (v.startsWith("eq.")) f[k] = v.slice(3);
  return f;
}
function pick(row, select) {
  if (!select || select === "*") return structuredClone(row);
  const out = {};
  for (const c of select.split(",")) out[c] = structuredClone(row[c]);
  return out;
}
function json(route, status, body) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    },
    body: body === undefined ? "" : JSON.stringify(body),
  });
}

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  if (method === "OPTIONS") return json(route, 200, {});
  const wantsObject = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  const path = url.pathname;

  if (path.startsWith("/auth/v1/user"))
    return json(route, 200, { id: U, aud: "authenticated", role: "authenticated" });
  if (path.startsWith("/auth/v1/")) return json(route, 200, {});

  const table = path.replace("/rest/v1/", "");
  const f = filtersOf(url);
  if (table === "profiles") {
    const p = {
      id: U,
      username: "tester",
      status: "approved",
      plan: "12month",
      end_date: "2030-01-01T00:00:00Z",
    };
    return json(route, 200, wantsObject ? p : [p]);
  }
  if (table !== "user_data")
    return wantsObject ? json(route, 406, { message: "0 rows" }) : json(route, 200, []);

  const row = db.user_data.get(f.user_id);
  const select = url.searchParams.get("select");
  if (method === "GET") {
    if (!row)
      return wantsObject
        ? json(route, 406, { code: "PGRST116", message: "0 rows" })
        : json(route, 200, []);
    return json(route, 200, wantsObject ? pick(row, select) : [pick(row, select)]);
  }
  const body = JSON.parse(req.postData() || "{}");
  if (method === "PATCH") {
    const ok = row && Object.entries(f).every(([k, v]) => String(row[k]) === v);
    if (!ok) return json(route, 200, []);
    const next = { ...row, ...body, updated_at: now() };
    db.user_data.set(f.user_id, next);
    writes.push(Object.keys(body));
    return json(route, 200, [pick(next, select)]);
  }
  if (method === "POST" && (req.headers()["prefer"] || "").includes("merge-duplicates")) {
    // upsert نسخه‌های قدیمی برنامه: ستون‌ها کور جایگزین می‌شوند
    const next = { ...(db.user_data.get(body.user_id) || {}), ...body, updated_at: now() };
    db.user_data.set(body.user_id, next);
    writes.push(Object.keys(body));
    return json(route, 201, []);
  }
  if (method === "POST") {
    if (db.user_data.has(body.user_id))
      return json(route, 409, { code: "23505", message: "duplicate key value" });
    const next = { ...body, updated_at: now() };
    db.user_data.set(body.user_id, next);
    writes.push(Object.keys(body));
    return json(route, 201, [pick(next, select)]);
  }
  return json(route, 405, { message: "unsupported" });
}

// ─── دستگاه‌ها ───────────────────────────────────────────────────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: U, role: "authenticated", exp: 4102444800 })}.sig`;
const session = {
  access_token: jwt,
  refresh_token: "r",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  user: { id: U, aud: "authenticated", role: "authenticated", email: "tester@kamix.local" },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
});
async function device(name) {
  const ctx = await browser.newContext();
  await ctx.route(`${SB}/**`, handle);
  await ctx.addInitScript((s) => {
    localStorage.setItem("sb-fake-supabase-auth-token", JSON.stringify(s));
  }, session);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}/products`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("چای"), null, {
    timeout: 60_000,
  });
  return { name, page, errors };
}
const store = (d, fn, arg) =>
  d.page.evaluate(
    async ([src, a]) => {
      const s = await import("/src/lib/store.ts");
      return new Function("s", "a", `return (${src})(s, a)`)(s, a);
    },
    [fn.toString(), arg],
  );
const refresh = async (d) => {
  await d.page.waitForTimeout(2200);
  await d.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await d.page.waitForTimeout(1500);
};

const A = await device("A");
const B = await device("B");

// ۱) هر دو دستگاه کالا اضافه می‌کنند؛ B از نسخهٔ قدیمی — هیچ‌کدام گم نمی‌شود
await store(A, (s) =>
  s.products.save([
    ...s.products.getAll(),
    { id: "pA", name: "قهوه-آ", price: 1, category: "", code: "", stock: 1 },
  ]),
);
await A.page.waitForTimeout(1500);
await store(B, (s) =>
  s.products.save([
    ...s.products.getAll(),
    { id: "pB", name: "شکر-ب", price: 1, category: "", code: "", stock: 1 },
  ]),
);
await B.page.waitForTimeout(1500);
const serverIds = db.user_data
  .get(U)
  .products.map((p) => p.id)
  .sort();
assert.deepEqual(serverIds, ["p1", "pA", "pB"], `server products: ${serverIds}`);
await refresh(A);
await refresh(B);
for (const d of [A, B]) {
  const text = await d.page.evaluate(() => document.body.innerText);
  assert.ok(text.includes("قهوه-آ") && text.includes("شکر-ب"), `${d.name} UI is missing a product`);
}
console.log("✓ products added on both browsers appear on both (UI)");

// ۲) پرداخت هم‌زمان برای یک مشتری روی دو مرورگر
await store(A, (s) => s.customers.addTx("c1", { type: "payment", amount: 300 }));
await A.page.waitForTimeout(1500);
await store(B, (s) => s.customers.addTx("c1", { type: "debt", amount: 500 }));
await B.page.waitForTimeout(1500);
await refresh(A);
for (const d of [A, B]) {
  const n = await store(d, (s) => s.customers.getAll().find((c) => c.id === "c1").txs.length);
  assert.equal(n, 3, `${d.name} has ${n} customer txs`);
}
assert.equal(db.user_data.get(U).customers[0].txs.length, 3, "server customer txs");
console.log("✓ concurrent customer payments on two browsers are all kept");

// ۳) حذف روی A روی B هم حذف می‌شود و برنمی‌گردد
await store(A, (s) => s.products.remove(["p1"]));
await A.page.waitForTimeout(1500);
await refresh(B);
await refresh(A);
for (const d of [A, B]) {
  const ids = await store(d, (s) =>
    s.products
      .getAll()
      .map((p) => p.id)
      .sort(),
  );
  assert.deepEqual(ids, ["pA", "pB"], `${d.name} products after delete: ${ids}`);
}
console.log("✓ delete on one browser reaches the other and stays deleted");

// ۴) بیکار: بدون رفت‌وبرگشت آپلود
const before = writes.length;
for (let i = 0; i < 3; i++) {
  await refresh(A);
  await refresh(B);
}
assert.equal(writes.length, before, `idle browsers uploaded ${writes.length - before} times`);
console.log("✓ idle browsers do not re-upload");

// ۵) ثبت و بلافاصله زدن دکمهٔ «خروج»: ثبت آخر قبل از خروج به سرور می‌رسد
let dialogs = 0;
A.page.on("dialog", (d) => {
  dialogs += 1;
  void d.dismiss();
});
await store(A, (s) =>
  s.expenses.add({ ...s.emptyExpense(), id: "e-last", title: "قبض", amount: 50 }),
);
await A.page.$eval('button[title="خروج"]', (b) => b.click()); // مودال یادآور پشتیبان روی صفحه است
await A.page.waitForTimeout(2500);
const exp = (db.user_data.get(U).expenses || []).map((e) => e.id);
assert.ok(exp.includes("e-last"), `last expense before sign-out did not reach the server: ${exp}`);
assert.equal(dialogs, 0, "sign-out asked for confirmation although everything was saved");
console.log("✓ change made right before pressing «خروج» is saved");

const pageErrors = [...A.errors, ...B.errors];
assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
await browser.close();
console.log("✓ e2e two-browser sync passed");
