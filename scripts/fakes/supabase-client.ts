/**
 * کلاینت جعلی سوپابیس برای تست همگام‌سازی store.ts — فقط همان چیزهایی که store.ts صدا می‌زند.
 * RLS شبیه‌سازی می‌شود: هر درخواست با کاربرِ نشستِ لحظهٔ شروع درخواست اجرا می‌شود.
 * با hold() همهٔ درخواست‌های شبکه تا release() معطل می‌مانند (شبکهٔ کند).
 *
 * مثل سرور واقعی: updated_at را خود سرور می‌زند و با هر نوشتن عوض می‌شود؛
 * update(...).eq(...).select() فقط ردیف‌های مطابق فیلتر را برمی‌گرداند (compare-and-swap)
 * و insert روی ردیف موجود خطای 23505 می‌دهد. هر نوشتن (upsert/update/insert) در
 * fake.upserts ثبت می‌شود. با fake.serverMerge یک تابع ادغام سمت سرور (مثل تریگر
 * user_data_protect_catalog) روی هر نوشتن اعمال می‌شود.
 */
import { AsyncResource } from "node:async_hooks";

type Row = Record<string, unknown>;

/** کانال‌های realtime فعال — هر نوشتن روی user_data سیگنال (user_id, updated_at) می‌فرستد */
type FakeChannel = {
  userFilter: string | null;
  cb: ((payload: { new: Row }) => void) | null;
  removed: boolean;
};
const channels = new Set<FakeChannel>();

let clock = Date.UTC(2026, 0, 1);
function serverNow(): string {
  clock += 1;
  return new Date(clock).toISOString().replace("Z", "+00:00");
}

export const fake = {
  rows: new Map<string, Row>(),
  sessionUser: null as string | null,
  upserts: [] as { asUser: string | null; payload: Row; ok: boolean }[],
  gate: null as Promise<void> | null,
  /** ادغام سمت سرور (old, incoming) → مقداری که ذخیره می‌شود؛ پیش‌فرض: بازنویسی کور */
  serverMerge: null as null | ((oldRow: Row, incoming: Row) => Row),
  /** اجرای یک بار تابع قبل از اعمال هر نوشتن (برای شبیه‌سازی نوشتن هم‌زمان دستگاه دیگر) */
  beforeWrite: null as null | (() => void),
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((r) => (release = r));
    return () => {
      this.gate = null;
      release();
    };
  },
  /** سیگنال realtime فعال باشد (پیش‌فرض خاموش؛ مثل وقتی مهاجرت سیگنال اجرا نشده) */
  realtime: false,
  /** نوشتن مستقیم دستگاه دیگر روی سرور (مثل اپ قدیمی با upsert کور) */
  externalWrite(userId: string, patch: Row) {
    applyWrite(userId, patch);
  },
};

function applyWrite(id: string, payload: Row): Row {
  const old = fake.rows.get(id) ?? {};
  const incoming = structuredClone(payload);
  const merged = fake.serverMerge ? fake.serverMerge(old, incoming) : { ...old, ...incoming };
  const next = { ...merged, user_id: id, updated_at: serverNow() };
  fake.rows.set(id, next);
  if (fake.realtime) {
    for (const ch of channels) {
      if (ch.removed || !ch.cb || (ch.userFilter && ch.userFilter !== id)) continue;
      const cb = ch.cb;
      setTimeout(() => cb({ new: { user_id: id, updated_at: next.updated_at } }), 50);
    }
  }
  return next;
}

async function network<T>(run: (asUser: string | null) => T): Promise<T> {
  const asUser = fake.sessionUser;
  if (fake.gate) await fake.gate;
  return run(asUser);
}

const rlsError = { code: "42501", message: "new row violates row-level security policy" };

function pickCols(row: Row, cols: string): Row {
  if (cols === "*") return structuredClone(row);
  const out: Row = {};
  for (const c of cols.split(",")) out[c.trim()] = structuredClone(row[c.trim()]);
  return out;
}

function table(name: string) {
  return {
    select(cols: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        maybeSingle() {
          return network((asUser) => {
            const id = String(filters.user_id ?? "");
            if (name !== "user_data" || !asUser || asUser !== id)
              return { data: null, error: null };
            const row = fake.rows.get(id);
            if (!row) return { data: null, error: null };
            // ستون updated_at در دیتابیس واقعی NOT NULL DEFAULT now() است
            if (!row.updated_at) row.updated_at = serverNow();
            return { data: pickCols(row, cols), error: null };
          });
        },
      };
      return builder;
    },
    upsert(payload: Row) {
      return network((asUser) => {
        const id = String(payload.user_id ?? "");
        if (!asUser || asUser !== id) {
          fake.upserts.push({ asUser, payload: structuredClone(payload), ok: false });
          return { error: rlsError };
        }
        fake.beforeWrite?.();
        fake.upserts.push({ asUser, payload: structuredClone(payload), ok: true });
        applyWrite(id, payload);
        return { error: null };
      });
    },
    update(payload: Row) {
      const filters: Record<string, unknown> = {};
      const builder = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        select(cols: string) {
          return network((asUser) => {
            const id = String(filters.user_id ?? "");
            const record = { ...structuredClone(payload), user_id: id };
            if (!asUser || asUser !== id) {
              fake.upserts.push({ asUser, payload: record, ok: false });
              return { data: [], error: null }; // RLS: no visible row
            }
            fake.beforeWrite?.();
            const row = fake.rows.get(id);
            if (row && !row.updated_at) row.updated_at = serverNow();
            const matches =
              !!row &&
              Object.entries(filters).every(([k, v]) => String(row[k] ?? "") === String(v ?? ""));
            if (!matches) return { data: [], error: null };
            fake.upserts.push({ asUser, payload: record, ok: true });
            return { data: [pickCols(applyWrite(id, payload), cols)], error: null };
          });
        },
      };
      return builder;
    },
    insert(payload: Row) {
      return {
        select(cols: string) {
          return network((asUser) => {
            const id = String(payload.user_id ?? "");
            if (!asUser || asUser !== id) {
              fake.upserts.push({ asUser, payload: structuredClone(payload), ok: false });
              return { data: null, error: rlsError };
            }
            fake.beforeWrite?.();
            if (fake.rows.has(id)) {
              return {
                data: null,
                error: { code: "23505", message: "duplicate key value violates unique constraint" },
              };
            }
            fake.upserts.push({ asUser, payload: structuredClone(payload), ok: true });
            return { data: [pickCols(applyWrite(id, payload), cols)], error: null };
          });
        },
      };
    },
  };
}

function channel(_name: string) {
  const ch: FakeChannel = { userFilter: null, cb: null, removed: false };
  const api = {
    on(_type: string, opts: { filter?: string }, cb: (payload: { new: Row }) => void) {
      ch.userFilter = opts.filter?.replace(/^user_id=eq\./, "") ?? null;
      // کال‌بک در «دستگاهی» که کانال را ساخته اجرا می‌شود
      ch.cb = AsyncResource.bind(cb);
      return api;
    },
    subscribe(statusCb?: (status: string) => void) {
      if (!fake.realtime) {
        if (statusCb)
          setTimeout(
            AsyncResource.bind(() => statusCb("CHANNEL_ERROR")),
            10,
          );
        return api;
      }
      channels.add(ch);
      if (statusCb)
        setTimeout(
          AsyncResource.bind(() => statusCb("SUBSCRIBED")),
          10,
        );
      return api;
    },
    _ch: ch,
  };
  return api;
}

export const supabase = {
  from: table,
  channel,
  removeChannel(api: { _ch: FakeChannel }) {
    api._ch.removed = true;
    channels.delete(api._ch);
    return Promise.resolve("ok");
  },
  auth: {
    async refreshSession() {
      return fake.sessionUser
        ? { data: {}, error: null }
        : { data: {}, error: { message: "no session" } };
    },
    async getSession() {
      return {
        data: {
          session: fake.sessionUser
            ? { access_token: `tok-${fake.sessionUser}`, user: { id: fake.sessionUser } }
            : null,
        },
      };
    },
  },
};
