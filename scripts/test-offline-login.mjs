/**
 * ورود بدون اینترنت اپ اندروید: اثر رمز، تطبیق، انقضا و تشخیص خطای شبکه.
 * اجرا: node --experimental-strip-types scripts/test-offline-login.mjs
 */
import assert from "node:assert/strict";
import {
  OFFLINE_LOGIN_KEY,
  OFFLINE_LOGIN_MAX_AGE_MS,
  forgetOfflineLogin,
  forgetOfflineLoginForUser,
  hasOfflineLoginFor,
  hasOfflineLoginForUsername,
  isInvalidCredentialsError,
  isUnreachableAuthError,
  rememberOfflineLogin,
  usernameToAuthEmail,
  verifyOfflineLogin,
} from "../src/lib/offline-login.ts";

function memStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const fast = { iterations: 1000 };

// ذخیره و تطبیق؛ خود رمز هرگز ذخیره نمی‌شود
{
  const storage = memStorage();
  assert.equal(await rememberOfflineLogin(" Ali123 ", "s3cret!", "uid-1", { storage, ...fast }), true);
  const raw = storage.getItem(OFFLINE_LOGIN_KEY);
  assert.ok(raw && !raw.includes("s3cret!"), "رمز خام ذخیره نشده");
  assert.equal(await verifyOfflineLogin("ali123", "s3cret!", { storage }), "uid-1");
  assert.equal(await verifyOfflineLogin("ALI123", "s3cret!", { storage }), "uid-1");
  assert.equal(await verifyOfflineLogin("ali123", "wrong", { storage }), null);
  assert.equal(await verifyOfflineLogin("ali123", "", { storage }), null);
  assert.equal(await verifyOfflineLogin("other", "s3cret!", { storage }), null);
  assert.equal(hasOfflineLoginFor("uid-1", storage), true);
  assert.equal(hasOfflineLoginFor("uid-2", storage), false);
  assert.equal(hasOfflineLoginForUsername("Ali123", storage), true);
}

// نمک تصادفی: دو بار ذخیرهٔ یک رمز، اثر متفاوت
{
  const a = memStorage();
  const b = memStorage();
  await rememberOfflineLogin("u", "p", "id", { storage: a, ...fast });
  await rememberOfflineLogin("u", "p", "id", { storage: b, ...fast });
  assert.notEqual(a.getItem(OFFLINE_LOGIN_KEY), b.getItem(OFFLINE_LOGIN_KEY));
}

// انقضا بعد از ۹۰ روز بدون ورود آنلاین
{
  const storage = memStorage();
  const t0 = 1_700_000_000_000;
  await rememberOfflineLogin("u", "p", "id", { storage, now: t0, ...fast });
  assert.equal(await verifyOfflineLogin("u", "p", { storage, now: t0 + OFFLINE_LOGIN_MAX_AGE_MS - 1 }), "id");
  assert.equal(await verifyOfflineLogin("u", "p", { storage, now: t0 + OFFLINE_LOGIN_MAX_AGE_MS + 1 }), null);
}

// رمز عوض شد → رمز جدید؛ رمز قدیمی دیگر کار نمی‌کند
{
  const storage = memStorage();
  await rememberOfflineLogin("u", "old", "id", { storage, ...fast });
  await rememberOfflineLogin("u", "new", "id", { storage, ...fast });
  assert.equal(await verifyOfflineLogin("u", "old", { storage }), null);
  assert.equal(await verifyOfflineLogin("u", "new", { storage }), "id");
}

// یوزرنیم کاربر عوض شد → فقط یک اثر برای هر کاربر
{
  const storage = memStorage();
  await rememberOfflineLogin("old-name", "p", "id", { storage, ...fast });
  await rememberOfflineLogin("new-name", "p", "id", { storage, ...fast });
  assert.equal(await verifyOfflineLogin("old-name", "p", { storage }), null);
  assert.equal(await verifyOfflineLogin("new-name", "p", { storage }), "id");
}

// حذف
{
  const storage = memStorage();
  await rememberOfflineLogin("u", "p", "id", { storage, ...fast });
  await rememberOfflineLogin("v", "p", "id2", { storage, ...fast });
  forgetOfflineLogin(" U ", storage);
  assert.equal(await verifyOfflineLogin("u", "p", { storage }), null);
  assert.equal(await verifyOfflineLogin("v", "p", { storage }), "id2");
  forgetOfflineLoginForUser("id2", storage);
  assert.equal(storage.getItem(OFFLINE_LOGIN_KEY), null);
}

// دادهٔ خراب / بدون حافظه: خطا بیرون نمی‌زند
{
  const storage = memStorage();
  storage.setItem(OFFLINE_LOGIN_KEY, "{not json");
  assert.equal(await verifyOfflineLogin("u", "p", { storage }), null);
  storage.setItem(OFFLINE_LOGIN_KEY, JSON.stringify({ u: { u: "id", s: "!!", h: "!!", i: 1, t: Date.now() } }));
  assert.equal(await verifyOfflineLogin("u", "p", { storage }), null);
  assert.equal(await rememberOfflineLogin("u", "p", "id", { storage: null }), false);
  assert.equal(await verifyOfflineLogin("u", "p", { storage: null }), null);
  assert.equal(await rememberOfflineLogin("", "p", "id", { storage, ...fast }), false);
}

// سقف تعداد حساب‌های یک گوشی
{
  const storage = memStorage();
  for (let i = 0; i < 12; i++) {
    await rememberOfflineLogin(`u${i}`, "p", `id${i}`, { storage, now: 1000 + i, ...fast });
  }
  const names = Object.keys(JSON.parse(storage.getItem(OFFLINE_LOGIN_KEY)));
  assert.equal(names.length, 8);
  assert.ok(names.includes("u11") && !names.includes("u0"), "قدیمی‌ترین‌ها حذف می‌شوند");
}

// فقط قطعی شبکه/سرور به ورود آفلاین می‌رسد؛ رمز اشتباه هرگز
{
  assert.equal(isUnreachableAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }), true);
  assert.equal(isUnreachableAuthError(new TypeError("Failed to fetch")), true);
  assert.equal(isUnreachableAuthError({ message: "NetworkError when attempting to fetch resource." }), true);
  assert.equal(isUnreachableAuthError({ status: 502, message: "Bad gateway" }), true);
  assert.equal(isUnreachableAuthError({ status: 504, message: "" }), true);
  assert.equal(isUnreachableAuthError({ status: 400, message: "Invalid login credentials" }), false);
  assert.equal(isUnreachableAuthError({ status: 429, message: "Request rate limit reached" }), false);
  assert.equal(isUnreachableAuthError({ status: 400, message: "Email not confirmed" }), false);
  assert.equal(isUnreachableAuthError(null), false);
  assert.equal(isInvalidCredentialsError({ message: "Invalid login credentials" }), true);
  assert.equal(isInvalidCredentialsError({ message: "Failed to fetch" }), false);
}

assert.equal(usernameToAuthEmail(" Ali "), "ali@kamali.local");

console.log("offline-login: all checks passed");
