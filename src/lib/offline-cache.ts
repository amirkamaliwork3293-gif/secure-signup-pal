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
export const MENU_DISPLAY_PREFIX = "kamix.menu.display.v1:";
export const GOLD_DISPLAY_PREFIX = "kamix.gold.display.v1:";
export const SCOPE_KEY = "kamali.auth.scope.v1";

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
    return (
      k.endsWith(suffix) ||
      k === profile ||
      k === meta ||
      k === `${MENU_DISPLAY_PREFIX}${userId}` ||
      k === `${GOLD_DISPLAY_PREFIX}${userId}`
    );
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

export function readLastUserScope(
  storage: StorageLike | null = typeof window !== "undefined" ? localStorage : null,
): string | null {
  if (!storage) return null;
  try {
    const scope = storage.getItem(SCOPE_KEY);
    if (scope && scope !== "anon") return scope;
    const last = storage.getItem(LAST_USER_SCOPE_KEY);
    return last && last !== "anon" ? last : null;
  } catch {
    return null;
  }
}

export function writeDisplayJson(
  key: string,
  value: unknown,
  storage: StorageLike | null = typeof window !== "undefined" ? localStorage : null,
): void {
  if (!storage || !key || SENSITIVE_STORAGE_KEY_RE.test(key)) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

export function readDisplayJson<T>(
  key: string,
  storage: StorageLike | null = typeof window !== "undefined" ? localStorage : null,
): T | null {
  if (!storage || !key || SENSITIVE_STORAGE_KEY_RE.test(key)) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
