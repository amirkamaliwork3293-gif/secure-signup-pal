/**
 * ثبت‌نام نباید رمز حساب موجود را عوض کند و خطای داخلی را لو ندهد.
 * اجرا: node scripts/test-signup-errors.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIGNUP_RETRY_LATER,
  SIGNUP_USERNAME_TAKEN,
  isAuthUserAlreadyRegistered,
  publicSignupCreateUserError,
  publicSignupProfileError,
  shouldRetrySignupWithoutOptionalColumns,
} from "../src/lib/signup-errors.ts";
import { settleQuery } from "../src/lib/settle-query.ts";

assert.equal(isAuthUserAlreadyRegistered("User already registered"), true);
assert.equal(publicSignupCreateUserError("User already registered"), SIGNUP_USERNAME_TAKEN);
assert.equal(publicSignupCreateUserError("duplicate key value"), SIGNUP_USERNAME_TAKEN);
assert.equal(publicSignupCreateUserError("JWT expired in schema xyz"), SIGNUP_RETRY_LATER);
assert.ok(!publicSignupCreateUserError("column profiles.secret does not exist").includes("column"));
assert.equal(publicSignupProfileError("duplicate key"), SIGNUP_USERNAME_TAKEN);
assert.equal(shouldRetrySignupWithoutOptionalColumns("Could not find the 'phone' column"), true);
assert.equal(shouldRetrySignupWithoutOptionalColumns("over quota"), false);

const thenableNoCatch = {
  then(onFulfilled, onRejected) {
    return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
  },
};
assert.equal(typeof thenableNoCatch.catch, "undefined");
assert.throws(
  () => thenableNoCatch.catch(() => {}),
  TypeError,
);
await settleQuery(thenableNoCatch);

const rejectingThenable = {
  then(_onFulfilled, onRejected) {
    return Promise.reject(new Error("builder failed")).then(_onFulfilled, onRejected);
  },
};
await settleQuery(rejectingThenable);

const authSrc = readFileSync(new URL("../src/lib/auth.functions.ts", import.meta.url), "utf8");

const signupHandler = authSrc.slice(
  authSrc.indexOf("export const submitSignupRequest"),
  authSrc.indexOf("export const checkRequestStatus"),
);
assert.doesNotMatch(
  signupHandler,
  /\.insert\([\s\S]{0,120}\)\.catch/,
  "insert().catch روی کوئری PostgREST ثبت‌نام را می‌شکند",
);
assert.doesNotMatch(
  signupHandler,
  /\.delete\(\)[\s\S]{0,80}\.catch/,
  "delete().catch روی کوئری PostgREST cleanup ثبت‌نام را می‌شکند",
);
assert.match(signupHandler, /settleQuery/);
assert.equal(
  signupHandler.includes("updateUserById"),
  false,
  "ثبت‌نام نباید رمز کاربر موجود را با updateUserById عوض کند",
);

const pwUpdates = [...authSrc.matchAll(/updateUserById/g)];
assert.equal(
  pwUpdates.length,
  2,
  `فقط ورود ادمین (رمز تصادفی نشست) و ریست دستی ادمین باید رمز را عوض کنند، got ${pwUpdates.length}`,
);
assert.match(authSrc, /adminResetUserPassword/);
assert.match(authSrc, /sessionPass/);

console.log("signup-errors + password mutation audit ok");
