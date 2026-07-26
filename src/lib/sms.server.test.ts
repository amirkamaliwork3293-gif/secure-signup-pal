/**
 * self-check ماژول پیامک — بدون فریم‌ورک تست.
 *   node --experimental-strip-types src/lib/sms.server.test.ts
 * فقط منطق خالص (نرمال‌سازی شماره، ماسک، قالب متن‌ها و کوتاهی پیامک) را می‌سنجد؛
 * ارسال واقعی و دیتابیس اینجا تست نمی‌شوند.
 */
import assert from "node:assert/strict";
import { normalizePhone, maskPhone, smsTemplates, SMS_MAX_LEN } from "./sms.server.ts";

// ── نرمال‌سازی شماره ─────────────────────────────────────────────────────────
for (const input of ["09121234567", "+989121234567", "989121234567", "9121234567", "0912 123 4567", "0912-123-4567"]) {
  assert.equal(normalizePhone(input), "09121234567", `normalizePhone(${input})`);
}
for (const bad of [null, undefined, "", "12345", "08121234567", "abc"]) {
  assert.equal(normalizePhone(bad), null, `normalizePhone(${bad}) باید null باشد`);
}

// ── ماسک ─────────────────────────────────────────────────────────────────────
assert.equal(maskPhone("09121234567"), "0912***4567");
assert.equal(maskPhone("123"), "***");

// ── قالب‌ها: باید کوتاه بمانند و محتوای درست داشته باشند ─────────────────────
const welcome = smsTemplates.welcome("ali123", "S3cretPass");
assert.ok(welcome.includes("ali123") && welcome.includes("S3cretPass"));
assert.ok(welcome.length <= SMS_MAX_LEN, "پیامک خوش‌آمدگویی طولانی است");

const otp = smsTemplates.otp("4821");
assert.ok(otp.includes("4821"));
assert.ok(otp.length <= SMS_MAX_LEN, "پیامک کد تایید طولانی است");

const expiry = smsTemplates.expiry(3, "https://kamixapp.ir/renew");
assert.ok(expiry.includes("3") && expiry.includes("https://kamixapp.ir/renew"));
assert.ok(expiry.length <= SMS_MAX_LEN, "پیامک یادآوری طولانی است");

// ── ارسال بدون گیرنده‌ی معتبر نباید throw کند ────────────────────────────────
const { sendSms } = await import("./sms.server.ts");
const res = await sendSms(["bad", null], "سلام");
assert.equal(res.ok, false);
assert.equal(res.sent, 0);

console.log("✓ sms.server self-check passed");
