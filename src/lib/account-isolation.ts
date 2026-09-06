/**
 * جداسازی اکانت‌ها روی یک دستگاه: دادهٔ کاربر A هرگز به ابر یا حافظهٔ کاربر B نرود.
 */

export function canFlushCloudPush(opts: {
  cloudUserId: string | null;
  cloudHydrated: boolean;
  storageScope: string | null;
}): boolean {
  const uid = opts.cloudUserId;
  const scope = opts.storageScope;
  if (!uid || !opts.cloudHydrated) return false;
  if (!scope || scope === "anon") return false;
  return uid === scope;
}

export function shouldAbortHydrate(opts: {
  requestedUserId: string;
  cloudUserId: string | null;
  storageScope: string | null;
  epoch: number;
  currentEpoch: number;
}): boolean {
  if (opts.epoch !== opts.currentEpoch) return true;
  if (!opts.requestedUserId || opts.cloudUserId !== opts.requestedUserId) return true;
  if (opts.storageScope !== opts.requestedUserId) return true;
  return false;
}

/** پنل ادمین: اگر نقش زنده نیست، فرم ورود ادمین بیاید — نه «دسترسی ممنوع». */
export function shouldShowAdminLogin(opts: {
  adminOnly: boolean;
  status: string;
  isAdmin: boolean;
}): boolean {
  if (!opts.adminOnly) return false;
  if (opts.status === "loading") return false;
  return !(opts.status === "authenticated" && opts.isAdmin);
}

/** نقش ادمین را فقط با پاسخ زنده کم می‌کنیم؛ خطای شبکه نقش را نمی‌گیرد. */
export function keepLiveAdminRole(opts: {
  sameUser: boolean;
  previousIsAdmin: boolean;
  roleQuerySucceeded: boolean;
  liveIsAdmin: boolean;
}): boolean {
  if (opts.roleQuerySucceeded) return opts.liveIsAdmin;
  if (opts.sameUser) return opts.previousIsAdmin;
  return false;
}
