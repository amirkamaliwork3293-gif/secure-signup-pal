/**
 * ادغام فهرست ادمین: پروفایل‌ها + حساب‌های auth بدون پروفایل + ردپای حذف.
 *
 * سقف پیش‌فرض PostgREST حدود ۱۰۰۰ ردیف است؛ بدون پیمایش، کاربران قدیمی‌تر
 * (مثل m.soleimani) در تب کاربران پنل دیده نمی‌شوند.
 */
import { normalizeSearchText } from "@/lib/search";

export type AdminListedUser = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  plan: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  missing_profile?: boolean;
};

export type AuthListUser = {
  id: string;
  email?: string | null;
  created_at?: string;
  user_metadata?: Record<string, unknown> | null;
};

export type AccountTrace = {
  source:
    | "profiles"
    | "auth"
    | "signup_requests"
    | "password_reset"
    | "audit_deleted"
    | "user_data"
    | "user_data_backups";
  title: string;
  detail: string;
  user_id?: string | null;
  username?: string | null;
  created_at?: string | null;
};

const KAMALI_SUFFIX = "@kamali.local";

export function sanitizeAdminSearch(query: string): string {
  return String(query ?? "")
    .replace(/[%_,()]/g, " ")
    .replace(/[^\p{L}\p{N} .@+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** ی/ك عربی ↔ فارسی تا «مصطفي» همان «مصطفی» را پیدا کند. */
export function persianSearchVariants(s: string): string[] {
  const raw = String(s ?? "").trim();
  if (!raw) return [];
  const n = normalizeSearchText(raw);
  const arabic = n.replace(/ی/g, "ي").replace(/ک/g, "ك");
  return [...new Set([raw, n, arabic].filter(Boolean))];
}

export function usernameCandidates(query: string): string[] {
  const s = sanitizeAdminSearch(query).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(s)) return [];
  return [...new Set([s, s.replace(/\./g, "_"), s.replace(/[._-]/g, "")])];
}

/** مقدار را داخل گیومه می‌گذاریم تا نقطهٔ یوزرنیم فیلتر PostgREST را نشکند. */
export function postgrestQuotedIlike(column: string, value: string): string {
  const v = sanitizeAdminSearch(value).replace(/\s+/g, "%").replace(/"/g, "");
  if (!v) return "";
  return `${column}.ilike."%${v}%"`;
}

export function usernameFromAuthUser(u: AuthListUser): string {
  const md = String(u.user_metadata?.username ?? "").trim();
  if (md) return md.toLowerCase();
  const email = String(u.email ?? "").trim().toLowerCase();
  if (email.endsWith(KAMALI_SUFFIX)) return email.slice(0, -KAMALI_SUFFIX.length);
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export function phoneFromAuthUser(u: AuthListUser): string | null {
  const p = u.user_metadata?.phone;
  if (typeof p !== "string") return null;
  const t = p.trim();
  return t || null;
}

export function nameFromAuthUser(u: AuthListUser): { first_name: string | null; last_name: string | null } {
  const md = u.user_metadata ?? {};
  const first = typeof md.first_name === "string" ? md.first_name.trim() : "";
  const last = typeof md.last_name === "string" ? md.last_name.trim() : "";
  return { first_name: first || null, last_name: last || null };
}

export function syntheticProfileFromAuth(u: AuthListUser): AdminListedUser {
  const names = nameFromAuthUser(u);
  return {
    id: u.id,
    username: usernameFromAuthUser(u) || `user-${u.id.slice(0, 8)}`,
    first_name: names.first_name,
    last_name: names.last_name,
    plan: null,
    status: "pending",
    start_date: null,
    end_date: null,
    created_at: u.created_at || new Date(0).toISOString(),
    missing_profile: true,
  };
}

export function dataOnlyStubUser(userId: string): AdminListedUser {
  return {
    id: userId,
    username: `data-${userId.slice(0, 8)}`,
    first_name: "داده بدون حساب ورود",
    last_name: null,
    plan: null,
    status: "pending",
    start_date: null,
    end_date: null,
    created_at: new Date(0).toISOString(),
    missing_profile: true,
  };
}

function fillNamesFromAuth(profile: AdminListedUser, auth: AuthListUser): void {
  const names = nameFromAuthUser(auth);
  if (!profile.first_name && names.first_name) profile.first_name = names.first_name;
  if (!profile.last_name && names.last_name) profile.last_name = names.last_name;
}

export function mergeAdminUsers(
  profiles: AdminListedUser[],
  authUsers: AuthListUser[],
  dataOwnerIds: string[] = [],
): { users: AdminListedUser[]; phones: Record<string, string | null> } {
  const byId = new Map<string, AdminListedUser>();
  for (const p of profiles) {
    if (!p?.id) continue;
    byId.set(p.id, { ...p, missing_profile: false });
  }

  const phones: Record<string, string | null> = {};
  for (const u of authUsers) {
    if (!u?.id) continue;
    const uname = usernameFromAuthUser(u);
    const phone = phoneFromAuthUser(u);
    if (uname && phone && !phones[uname]) phones[uname] = phone;
    const existing = byId.get(u.id);
    if (existing) {
      fillNamesFromAuth(existing, u);
      continue;
    }
    byId.set(u.id, syntheticProfileFromAuth(u));
  }

  for (const id of dataOwnerIds) {
    if (!id || byId.has(id)) continue;
    byId.set(id, dataOnlyStubUser(id));
  }

  const users = [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a.created_at) || 0;
    const tb = Date.parse(b.created_at) || 0;
    return tb - ta;
  });
  return { users, phones };
}

/** اگر جستجو یوزرنیم دقیق را پیدا نکرد، این کاربر را به فهرست اضافه می‌کند. */
export function upsertListedUser(
  listed: { users: AdminListedUser[]; phones: Record<string, string | null> },
  user: AdminListedUser,
  phone?: string | null,
): { users: AdminListedUser[]; phones: Record<string, string | null> } {
  const users = listed.users.filter((u) => u.id !== user.id);
  users.unshift(user);
  const phones = { ...listed.phones };
  const uname = user.username?.toLowerCase();
  if (uname && phone && !phones[uname]) phones[uname] = phone;
  return { users, phones };
}

export function traceMatchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const q = normalizeSearchText(query);
  if (!q) return false;
  const tokens = q.split(" ").filter((t) => t.length >= 2);
  const hay = normalizeSearchText(fields.filter(Boolean).join(" "));
  if (!hay) return false;
  if (hay.includes(q)) return true;
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}
