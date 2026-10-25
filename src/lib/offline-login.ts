/**
 * ورود بدون اینترنت در اپ اندروید (Capacitor).
 *
 * بعد از هر ورود موفقِ آنلاین، یک «اثر» یک‌طرفه از رمز (PBKDF2-SHA256 با نمک
 * تصادفی) روی همان گوشی نگه داشته می‌شود — خود رمز هرگز ذخیره نمی‌شود. وقتی
 * سرور در دسترس نیست، همان یوزرنیم و رمز با این اثر مقایسه می‌شود و کاربر با
 * داده‌های ذخیره‌شدهٔ روی همان گوشی وارد می‌شود. ثبت‌ها در صف همگام‌سازی
 * می‌مانند تا بعد از وصل شدن (و یک ورود آنلاین) به سرور بروند.
 *
 * - فقط روی گوشی‌ای کار می‌کند که این کاربر قبلاً یک‌بار با اینترنت وارد شده.
 * - اگر سرور بگوید رمز اشتباه است (مثلاً رمز عوض شده) اثر همان یوزرنیم پاک می‌شود.
 * - اثر پس از OFFLINE_LOGIN_MAX_AGE_MS بدون ورود آنلاین منقضی می‌شود.
 * - ورود ادمین هرگز آفلاین نیست.
 */

export const OFFLINE_LOGIN_KEY = "kamix.offline.login.v1";
export const OFFLINE_LOGIN_ITERATIONS = 120_000;
/** ۹۰ روز بدون هیچ ورود آنلاین → ورود آفلاین دیگر پذیرفته نمی‌شود */
export const OFFLINE_LOGIN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 8;

export type OfflineLoginEntry = {
  /** شناسهٔ کاربر Supabase */
  u: string;
  /** نمک base64 */
  s: string;
  /** اثر رمز base64 */
  h: string;
  /** تعداد تکرار PBKDF2 */
  i: number;
  /** زمان آخرین ورود آنلاین موفق */
  t: number;
};

type Store = Record<string, OfflineLoginEntry>;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function normalizeOfflineUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** همان ایمیل داخلی صفحهٔ ورود: یوزرنیم + @kamali.local */
export function usernameToAuthEmail(username: string): string {
  return `${normalizeOfflineUsername(username)}@kamali.local`;
}

function readAll(storage: StorageLike | null): Store {
  if (!storage) return {};
  try {
    const raw = storage.getItem(OFFLINE_LOGIN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeAll(store: Store, storage: StorageLike | null): void {
  if (!storage) return;
  try {
    if (Object.keys(store).length === 0) storage.removeItem(OFFLINE_LOGIN_KEY);
    else storage.setItem(OFFLINE_LOGIN_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — ورود آفلاین فقط در دسترس نخواهد بود */
  }
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto | null {
  try {
    return globalThis.crypto?.subtle ?? null;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const s = subtle();
  if (!s) throw new Error("webcrypto unavailable");
  const key = await s.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await s.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** بعد از ورود آنلاین موفق: اثر رمز همین گوشی را تازه می‌کند. خطا هرگز بیرون نمی‌زند. */
export async function rememberOfflineLogin(
  username: string,
  password: string,
  userId: string,
  opts?: { storage?: StorageLike | null; now?: number; iterations?: number },
): Promise<boolean> {
  const storage = opts?.storage === undefined ? defaultStorage() : opts.storage;
  const name = normalizeOfflineUsername(username);
  if (!storage || !name || !password || !userId) return false;
  try {
    const iterations = opts?.iterations ?? OFFLINE_LOGIN_ITERATIONS;
    const salt = new Uint8Array(16);
    globalThis.crypto.getRandomValues(salt);
    const hash = await derive(password, salt, iterations);
    const store = readAll(storage);
    // یک شناسهٔ کاربر فقط یک اثر دارد (اگر یوزرنیم عوض شده باشد، قدیمی حذف می‌شود)
    for (const [k, v] of Object.entries(store)) {
      if (v?.u === userId && k !== name) delete store[k];
    }
    store[name] = {
      u: userId,
      s: toB64(salt),
      h: toB64(hash),
      i: iterations,
      t: opts?.now ?? Date.now(),
    };
    const names = Object.keys(store);
    if (names.length > MAX_ENTRIES) {
      names
        .sort((a, b) => (store[a].t || 0) - (store[b].t || 0))
        .slice(0, names.length - MAX_ENTRIES)
        .forEach((k) => delete store[k]);
    }
    writeAll(store, storage);
    return true;
  } catch {
    return false;
  }
}

/** شناسهٔ کاربر اگر یوزرنیم/رمز با اثر ذخیره‌شده بخواند؛ وگرنه null. */
export async function verifyOfflineLogin(
  username: string,
  password: string,
  opts?: { storage?: StorageLike | null; now?: number },
): Promise<string | null> {
  const storage = opts?.storage === undefined ? defaultStorage() : opts.storage;
  const name = normalizeOfflineUsername(username);
  if (!storage || !name || !password) return null;
  const entry = readAll(storage)[name];
  if (!entry || typeof entry.u !== "string" || !entry.u) return null;
  const now = opts?.now ?? Date.now();
  if (!Number.isFinite(entry.t) || now - entry.t > OFFLINE_LOGIN_MAX_AGE_MS) return null;
  try {
    const hash = await derive(password, fromB64(entry.s), entry.i || OFFLINE_LOGIN_ITERATIONS);
    return sameBytes(hash, fromB64(entry.h)) ? entry.u : null;
  } catch {
    return null;
  }
}

/** آیا این گوشی برای این کاربر ورود آفلاین دارد؟ */
export function hasOfflineLoginFor(
  userId: string,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!userId) return false;
  return Object.values(readAll(storage)).some((e) => e?.u === userId);
}

/** آیا برای این یوزرنیم روی این گوشی ورود آفلاین ذخیره شده است؟ */
export function hasOfflineLoginForUsername(
  username: string,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const name = normalizeOfflineUsername(username);
  return Boolean(name && readAll(storage)[name]);
}

/** سرور گفت رمز اشتباه است → رمز قدیمی دیگر نباید آفلاین کار کند. */
export function forgetOfflineLogin(
  username: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  const name = normalizeOfflineUsername(username);
  if (!name) return;
  const store = readAll(storage);
  if (!(name in store)) return;
  delete store[name];
  writeAll(store, storage);
}

export function forgetOfflineLoginForUser(
  userId: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!userId) return;
  const store = readAll(storage);
  let changed = false;
  for (const [k, v] of Object.entries(store)) {
    if (v?.u === userId) {
      delete store[k];
      changed = true;
    }
  }
  if (changed) writeAll(store, storage);
}

/**
 * خطای ورود از نوع «سرور در دسترس نیست» است (نه رمز اشتباه)؟
 * فقط در این حالت سراغ ورود آفلاین می‌رویم.
 */
export function isUnreachableAuthError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: unknown; status?: unknown; message?: unknown; code?: unknown };
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message : "";
  const status = typeof e.status === "number" ? e.status : undefined;
  if (/invalid login|invalid credentials|email not confirmed/i.test(message)) return false;
  if (name === "AuthRetryableFetchError") return true;
  if (status === 0) return true;
  if (status !== undefined && status >= 500) return true;
  if (status === 408 || status === 429) return false;
  return /failed to fetch|network|load failed|timeout|timed out|fetch failed|aborted/i.test(
    message,
  );
}

/** رمز اشتباه از سمت سرور (نه قطعی شبکه) */
export function isInvalidCredentialsError(err: unknown): boolean {
  const message =
    typeof (err as { message?: unknown })?.message === "string"
      ? (err as { message: string }).message
      : "";
  return /invalid login credentials/i.test(message);
}
