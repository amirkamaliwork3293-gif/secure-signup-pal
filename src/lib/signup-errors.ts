/**
 * پیام‌های عمومی ثبت‌نام — جزئیات دیتابیس/GoTrue به مرورگر نرود.
 * رمز کاربر موجود هرگز از روی خطای «تکراری» بازنویسی نمی‌شود.
 */

export const SIGNUP_USERNAME_TAKEN = "این یوزرنیم قبلاً ثبت شده است.";
export const SIGNUP_RETRY_LATER = "ثبت‌نام الان ممکن نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.";

export function isAuthUserAlreadyRegistered(message: string | null | undefined): boolean {
  return /already been registered|user already registered|already exists|duplicate key|unique constraint/i.test(
    String(message ?? ""),
  );
}

/** خطای ساخت حساب جدید — بدون بازنویسی رمز حساب موجود */
export function publicSignupCreateUserError(message: string | null | undefined): string {
  if (isAuthUserAlreadyRegistered(message)) return SIGNUP_USERNAME_TAKEN;
  if (/rate|too many|429/i.test(String(message ?? ""))) {
    return "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.";
  }
  return SIGNUP_RETRY_LATER;
}

export function publicSignupProfileError(message: string | null | undefined): string {
  if (isAuthUserAlreadyRegistered(message) || /duplicate|unique/i.test(String(message ?? ""))) {
    return SIGNUP_USERNAME_TAKEN;
  }
  return SIGNUP_RETRY_LATER;
}

export function shouldRetrySignupWithoutOptionalColumns(message: string | null | undefined): boolean {
  return /phone|receipt_note|client_ip|schema cache|column .* does not exist/i.test(
    String(message ?? ""),
  );
}
