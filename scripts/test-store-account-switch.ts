/**
 * جداسازی اکانت در صف همگام‌سازی store.ts (باگ نشت دادهٔ اکانت A به اکانت B).
 * اجرا: npx --yes tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-store-account-switch.ts
 *
 * سناریو ۱: آپلود A در راه است، A خارج می‌شود، آپلود رد می‌شود، B وارد می‌شود.
 * سناریو ۲: آپلود A در راه است و B بدون خروج A مستقیم وارد می‌شود.
 * در هر دو: هیچ دادهٔ A نباید به ردیف ابری یا حافظهٔ محلی B برسد و دادهٔ A نباید گم شود.
 */
import assert from "node:assert/strict";

const { localStorage, timers, flush, advance } = await import("./fakes/browser-env.ts");
const { fake } = await import("./fakes/supabase-client.ts");
const store = await import("../src/lib/store.ts");
const { products, hydrateFromCloud, stopCloudSync, setStorageScope, beginUserScope } = store;

const A = "user-a";
const B = "user-b";
const ids = (list: unknown) =>
  Array.isArray(list) ? list.map((r) => (r as { id: string }).id).sort() : [];
const localIds = (user: string) =>
  ids(JSON.parse(localStorage.getItem(`acc.products.v2:${user}`) ?? "[]"));
const product = (id: string) => ({ id, name: id, price: 1000, category: "", code: "", stock: 5 });

function reset() {
  localStorage.clear();
  timers.clear();
  fake.rows.clear();
  fake.upserts.length = 0;
  fake.gate = null;
  stopCloudSync();
  fake.rows.set(A, { user_id: A, products: [product("a1")], settings: { shopName: "shop A" } });
  fake.rows.set(B, { user_id: B, products: [product("b1")], settings: { shopName: "shop B" } });
}

/** مثل AuthContext.loadState */
async function signIn(user: string) {
  fake.sessionUser = user;
  setStorageScope(user); // optimistic scope در syncSession
  beginUserScope(user);
  await hydrateFromCloud(user);
  await flush();
}

/** مثل AuthContext.signOut */
function signOut() {
  stopCloudSync();
  fake.sessionUser = null;
  setStorageScope(null);
}

function assertBClean(label: string) {
  for (const u of fake.upserts) {
    if (u.payload.user_id !== B) continue;
    assert.deepEqual(
      ids(u.payload.products ?? []).filter((id) => id.startsWith("a")),
      [],
      `${label}: A product pushed to B row`,
    );
    const shop = (u.payload.settings as { shopName?: string } | undefined)?.shopName;
    if (shop !== undefined) assert.equal(shop, "shop B", `${label}: A settings pushed to B row`);
  }
  assert.deepEqual(ids(fake.rows.get(B)!.products), ["b1"], `${label}: B cloud row contaminated`);
  assert.deepEqual(localIds(B), ["b1"], `${label}: B local storage contaminated`);
}

async function assertANotLost(label: string) {
  assert.ok(
    localIds(A).includes("a2"),
    `${label}: A's unsynced product vanished from A's device storage`,
  );
  signOut();
  await advance(1000);
  await signIn(A);
  await advance(10_000);
  assert.deepEqual(
    ids(fake.rows.get(A)!.products),
    ["a1", "a2"],
    `${label}: A's edit never reached A's row`,
  );
  assert.deepEqual(localIds(A), ["a1", "a2"]);
}

// ─── سناریو ۱: خروج در میانهٔ آپلود ─────────────────────────────────────────
reset();
await signIn(A);
assert.deepEqual(localIds(A), ["a1"]);
products.save([...products.getAll(), product("a2")]);
let release = fake.hold();
await advance(600); // آپلود A شروع شد و روی شبکه معطل است
signOut();
release(); // آپلود A حالا بدون نشست اجرا و با RLS رد می‌شود
await advance(1000);
await signIn(B);
await advance(30_000); // retry و flushهای بعدی
assert.ok(fake.upserts.length > 0, "fake supabase client was not used");
assertBClean("logout-during-upload");
await assertANotLost("logout-during-upload");

// ─── سناریو ۲: ورود مستقیم B بدون خروج A ────────────────────────────────────
reset();
await signIn(A);
products.save([...products.getAll(), product("a2")]);
release = fake.hold();
await advance(600);
const bLogin = signIn(B); // نشست B جایگزین می‌شود؛ hydrate B هم پشت همان شبکه معطل است
await flush();
release();
await bLogin;
await advance(30_000);
assertBClean("direct-switch");
await assertANotLost("direct-switch");

// ─── سناریو ۳: تب دیگرِ همین مرورگر با B وارد شد ولی این تب هنوز A است ─────
reset();
await signIn(A);
localStorage.setItem("kamali.auth.scope.v1", B); // تب دیگر اسکوپ مشترک را B کرد
assert.equal(products.save([product("a1"), product("a3")]), false, "stale tab must not write");
assert.equal(localStorage.getItem(`acc.products.v2:${B}`), null, "stale tab wrote into B storage");
await advance(30_000);
assert.deepEqual(ids(fake.rows.get(B)!.products), ["b1"], "stale-tab: B cloud row contaminated");
assert.ok(!fake.upserts.some((u) => u.payload.user_id === B), "stale-tab: pushed to B row");

console.log("store account-switch isolation tests passed");
