/**
 * کش فقط‌خواندنی داده‌ی نمایشی کسب‌وکار برای اپ Capacitor.
 *
 * خودِ داده در localStorage اسکوپ‌شده‌ی store.ts است (acc.*:userId).
 * اینجا فقط مُهر زمان آخرین خواندن موفق از ابر و پاک‌سازی per-user
 * هنگام خروج را نگه می‌داریم. JWT / کلید سرویس / رمز هرگز اینجا ذخیره نمی‌شود.
 */

export const OFFLINE_META_PREFIX = "kamix.offline.meta.v1:";
export const AUTH_PROFILE_PREFIX = "auth_profile:";
export const LAST_USER_SCOPE_KEY = "kamali.auth.lastScope.v1";

/** کلیدهایی که ممکن است توکن/رمز باشند — هرگز به‌عنوان کش نمایشی پاک/کپی نمی‌شوند. */
export const SENSITIVE_STORAGE_KEY_RE =
  /(auth-token|refresh-token|access-token|jwt|service[_-]?role|apikey|password|sb-.*-auth)/i;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function offlineMetaKey(userId: string): string {
  return `${OFFLINE_META_PREFIX}${userId}`;
}

export function rememberCloudRead(
  userId: string,
  at = Date.now(),
  storage: StorageLike | null = typeof window !== "undefined" ? localStorage : null,
): void {
  if (!userId || !storage) return;
  try {
    storage.setItem(offlineMetaKey(userId), JSON.stringify({ lastSyncedAt: at }));
  } catch {
    /* quota / private mode */
  }
}

export function readCloudReadAt(
  userId: string,
  storage: StorageLike | null = typeof window !== "undefined" ? localStorage : null,
): number | null {
  if (!userId || !storage) return null;
  try {
    const raw = storage.getItem(offlineMetaKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lastSyncedAt?: unknown };
    const n = Number(parsed?.lastSyncedAt);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * کلیدهای کش نمایشی همان کاربر — بدون توکن/رمز.
 * کلید store.ts برابر است با `${baseKey}:${userId}`.
 */
export function listUserDisplayCacheKeys(userId: string, keys: string[]): string[] {
  if (!userId) return [];
  const suffix = `:${userId}`;
  const profile = `${AUTH_PROFILE_PREFIX}${userId}`;
  const meta = offlineMetaKey(userId);
  return keys.filter((k) => {
    if (!k || SENSITIVE_STORAGE_KEY_RE.test(k)) return false;
    return k.endsWith(suffix) || k === profile || k === meta;
  });
}

export function clearUserOfflineCache(
  userId: string,
  storage:
    | (StorageLike & { length?: number; key?: (i: number) => string | null })
    | null = typeof window !== "undefined" ? localStorage : null,
): string[] {
  if (!userId || !storage) return [];
  const keys: string[] = [];
  if (typeof storage.length === "number" && typeof storage.key === "function") {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k) keys.push(k);
    }
  }
  const removed = listUserDisplayCacheKeys(userId, keys);
  for (const k of removed) {
    try {
      storage.removeItem(k);
    } catch {
      /* noop */
    }
  }
  try {
    if (storage.getItem(LAST_USER_SCOPE_KEY) === userId) {
      storage.removeItem(LAST_USER_SCOPE_KEY);
      removed.push(LAST_USER_SCOPE_KEY);
    }
  } catch {
    /* noop */
  }
  return removed;
}
