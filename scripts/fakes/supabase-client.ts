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
  // با fake.realClock ساعت سرور همان ساعت تست است (همیشه رو به جلو)، مثل سرور واقعی
  clock = fake.realClock ? Math.max(clock + 1, Date.now()) : clock + 1;
  return new Date(clock).toISOString().replace("Z", "+00:00");
}

export const fake = {
  rows: new Map<string, Row>(),
  /** بعد از هر نوشتن روی سرور صدا زده می‌شود (شبیه‌سازی سیگنال لحظه‌ای در سطح تست) */
  afterWrite: null as null | ((row: Row) => void),
  /** ساعت سرور = ساعت تست (پیش‌فرض: ساعت ثابتِ جدا، یک میلی‌ثانیه با هر نوشتن) */
  realClock: false,
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
  /**
   * مهاجرت 20261115120000 نصب است: ستون sync_seq، ثبت ردیف‌های تغییرکرده با هر نوشتن
   * و توابع kamix_sync_push / kamix_sync_pull. خاموش = سرور قبل از این مهاجرت.
   */
  delta: false,
  /** فراخوانی‌های RPC (برای سنجش حجم رفت و برگشت) */
  rpcCalls: [] as { name: string; args: Row; result: unknown }[],
  /** خواندن‌های مستقیم جدول (select) — ستون‌های درخواست‌شده */
  selects: [] as string[],
  /** اگر مقدار داشته باشد، RPC با همین خطا جواب می‌دهد (شبیه‌سازی باگ/نبود تابع) */
  rpcError: null as null | { code?: string; message: string },
  /** ثبت تغییر ردیف‌ها: user → "field\u0000rowId" → seq */
  rowSeq: new Map<string, Map<string, number>>(),
  minSeq: 1_700_000_000_000,
};

// ─── شبیه‌سازی مهاجرت 20261115120000 (همان قواعد توابع SQL) ─────────────────
const DELTA_ARRAY_COLS = [
  "products",
  "categories",
  "invoices",
  "customers",
  "students",
  "purchases",
  "expenses",
  "reminders",
  "accounts",
  "account_txs",
  "production",
  "manual_ledger",
];
let seqCounter = 1_700_000_000_000;

/** Postgres jsonb کلیدهای هر شیء را مرتب می‌کند (اول طول، بعد حروف) */
function jsonbKeyOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(jsonbKeyOrder);
  if (!v || typeof v !== "object") return v;
  const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const out: Row = {};
  for (const k of keys) out[k] = jsonbKeyOrder((v as Row)[k]);
  return out;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(jsonbKeyOrder(a ?? null)) === JSON.stringify(jsonbKeyOrder(b ?? null));

function sqlRowId(x: unknown): string | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const id = (x as Row).id;
  return typeof id === "string" && id ? id : null;
}
function sqlRowTs(x: unknown): number {
  if (!x || typeof x !== "object") return 0;
  for (const k of ["updatedAt", "createdAt", "at", "date", "paidAt"]) {
    const n = (x as Row)[k];
    if (typeof n === "number" && n > 0) return n;
  }
  return 0;
}
function sqlMergeRow(winner: unknown, other: unknown, nestedKey: string | null, gone: unknown) {
  const w = winner as Row;
  if (!nestedKey || !w || typeof w !== "object" || !Array.isArray(w[nestedKey])) return winner;
  const goneIds = new Set(Array.isArray(gone) ? (gone as string[]) : []);
  const mine = w[nestedKey] as unknown[];
  const kept = mine.filter((e) => {
    const id = sqlRowId(e);
    return !id || !goneIds.has(id);
  });
  const have = new Set(mine.map(sqlRowId).filter(Boolean));
  const theirs =
    other && typeof other === "object" && Array.isArray((other as Row)[nestedKey])
      ? ((other as Row)[nestedKey] as unknown[])
      : [];
  const extra: unknown[] = [];
  for (const e of theirs) {
    const id = sqlRowId(e);
    if (!id || goneIds.has(id) || have.has(id)) continue;
    have.add(id);
    extra.push(e);
  }
  if (extra.length === 0 && kept.length === mine.length) return winner;
  const merged = [...kept, ...extra];
  const at = (e: unknown) => (typeof (e as Row)?.at === "number" ? ((e as Row).at as number) : 0);
  if (extra.length) merged.sort((a, b) => at(b) - at(a));
  return { ...w, [nestedKey]: merged };
}
function sqlMergeRows(live: unknown, incoming: unknown, nestedKey: string | null, gone: unknown) {
  const liv = Array.isArray(live) ? live : [];
  const incAll = Array.isArray(incoming) ? incoming : [];
  const inc = new Map<string, unknown>();
  for (const x of incAll) {
    const id = sqlRowId(x);
    if (id && !inc.has(id)) inc.set(id, x);
  }
  const liveIds = new Set(liv.map(sqlRowId).filter(Boolean));
  const fresh: unknown[] = [];
  for (const x of incAll) {
    const id = sqlRowId(x);
    if (id) {
      if (inc.get(id) === x && !liveIds.has(id)) fresh.push(sqlMergeRow(x, null, nestedKey, gone));
    } else if (!liv.some((l) => !sqlRowId(l) && same(l, x))) {
      fresh.push(x);
    }
  }
  const body = liv.map((l) => {
    const id = sqlRowId(l);
    const i = id ? inc.get(id) : undefined;
    if (i === undefined) return l;
    return sqlRowTs(l) > sqlRowTs(i) + 1000
      ? sqlMergeRow(l, i, nestedKey, gone)
      : sqlMergeRow(i, l, nestedKey, gone);
  });
  return [...fresh, ...body];
}
function tombMap(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, ids] of Object.entries(v as Row)) {
    if (Array.isArray(ids)) out[k] = ids.filter((x): x is string => typeof x === "string" && !!x);
  }
  return out;
}
function unionTombs(a: unknown, b: unknown): Record<string, string[]> | null {
  const out: Record<string, string[]> = {};
  for (const m of [tombMap(a), tombMap(b)]) {
    for (const [k, ids] of Object.entries(m)) {
      if (ids.length) out[k] = [...new Set([...(out[k] ?? []), ...ids])].sort();
    }
  }
  return Object.keys(out).length ? out : null;
}

/** تریگر user_data_sync_rows: ثبت این‌که کدام ردیف در این نسخه عوض شد */
function noteChanges(userId: string, old: Row | undefined, next: Row, seq: number) {
  let log = fake.rowSeq.get(userId);
  if (!log) fake.rowSeq.set(userId, (log = new Map()));
  const put = (field: string, rowId: string) => log!.set(`${field}\u0000${rowId}`, seq);
  if (!old) {
    put("*", "");
    return;
  }
  for (const col of DELTA_ARRAY_COLS) {
    if (same(old[col], next[col])) continue;
    const o = old[col];
    const n = next[col];
    if (!Array.isArray(o) || !Array.isArray(n)) {
      put(col, "");
      continue;
    }
    const nIds = n.map(sqlRowId);
    const oIds = o.map(sqlRowId);
    const whole =
      nIds.includes(null) ||
      oIds.includes(null) ||
      new Set(nIds).size !== nIds.length ||
      oIds.some((id) => !nIds.includes(id));
    if (whole) {
      put(col, "");
      continue;
    }
    for (const row of n) {
      const id = sqlRowId(row)!;
      const before = o.filter((x) => sqlRowId(x) === id);
      if (before.length === 0 || before.some((x) => !same(x, row))) put(col, id);
    }
  }
  if (!same(old.current_invoice, next.current_invoice)) put("current_invoice", "");
  if (!same(old.settings, next.settings)) {
    const strip = (s: unknown) => {
      const c = { ...((s ?? {}) as Row) };
      delete c.catalogTombstones;
      return c;
    };
    if (!same(strip(old.settings), strip(next.settings))) put("settings", "");
    const ot = tombMap((old.settings as Row | undefined)?.catalogTombstones);
    const nt = tombMap((next.settings as Row | undefined)?.catalogTombstones);
    for (const [k, ids] of Object.entries(nt)) {
      for (const id of ids) if (!(ot[k] ?? []).includes(id)) put(`tomb:${k}`, id);
    }
  }
}

function rpcPull(asUser: string | null, args: Row): { data: unknown; error: unknown } {
  if (!asUser) return { data: null, error: { code: "42501", message: "not authenticated" } };
  const row = fake.rows.get(asUser);
  if (!row) return { data: { exists: false, seq: 0, full: true }, error: null };
  const seq = Number(row.sync_seq ?? fake.minSeq);
  if (!row.updated_at) row.updated_at = serverNow();
  const since = args.p_since == null ? null : Number(args.p_since);
  const log = fake.rowSeq.get(asUser) ?? new Map<string, number>();
  const head = { exists: true, seq, updated_at: row.updated_at };
  if (since === null || since > seq || since < fake.minSeq || (log.get("*\u0000") ?? 0) > since) {
    return { data: { ...head, full: true }, error: null };
  }
  const byField = new Map<string, string[]>();
  for (const [key, s] of log) {
    if (s <= since) continue;
    const [field, rowId] = key.split("\u0000");
    byField.set(field, [...(byField.get(field) ?? []), rowId]);
  }
  const fields: Row = {};
  const tombstones: Row = {};
  for (const [field, ids] of byField) {
    if (field.startsWith("tomb:")) {
      tombstones[field.slice(5)] = ids;
    } else if (field === "settings") {
      const c = { ...((row.settings ?? {}) as Row) };
      delete c.catalogTombstones;
      fields.settings = { whole: c };
    } else if (field === "current_invoice") {
      fields.current_invoice = { whole: row.current_invoice ?? null };
    } else if (DELTA_ARRAY_COLS.includes(field)) {
      const col = row[field];
      if (ids.includes("") || !Array.isArray(col)) fields[field] = { whole: col };
      else fields[field] = { rows: col.filter((x) => ids.includes(sqlRowId(x) ?? "\u0001")) };
    }
  }
  return { data: structuredClone({ ...head, full: false, fields, tombstones }), error: null };
}

function rpcPush(asUser: string | null, args: Row): { data: unknown; error: unknown } {
  if (!asUser) return { data: null, error: { code: "42501", message: "not authenticated" } };
  const p = structuredClone((args.p ?? {}) as Row);
  fake.beforeWrite?.();
  let row = fake.rows.get(asUser);
  let prevSeq: number | null = null;
  let prevAt: unknown = null;
  if (row) {
    if (!row.updated_at) row.updated_at = serverNow();
    prevSeq = Number(row.sync_seq ?? fake.minSeq);
    prevAt = row.updated_at;
  } else {
    row = applyWrite(asUser, { products: [], categories: [], invoices: [], settings: {} });
  }
  const patch: Row = {};
  const sp = p.settings && typeof p.settings === "object" ? (p.settings as Row) : null;
  const stored = { ...((row.settings ?? {}) as Row) };
  let tomb: unknown = stored.catalogTombstones ?? {};
  if (sp) {
    const next = { ...stored };
    for (const k of Array.isArray(sp.unset) ? (sp.unset as string[]) : []) {
      if (k !== "catalogTombstones") delete next[k];
    }
    for (const [k, v] of Object.entries((sp.set ?? {}) as Row)) {
      if (k !== "catalogTombstones") next[k] = v;
    }
    tomb = unionTombs(tomb, sp.tombstones) ?? {};
    if (Object.keys(tomb as Row).length) next.catalogTombstones = tomb;
    if (!same(next, stored)) patch.settings = next;
  }
  const rows = (p.rows && typeof p.rows === "object" ? p.rows : {}) as Row;
  for (const col of DELTA_ARRAY_COLS) {
    const inc = rows[col];
    if (!Array.isArray(inc) || inc.length === 0) continue;
    const nestedKey = col === "customers" ? "txs" : col === "students" ? "payments" : null;
    const gone = nestedKey ? (tomb as Row)[`${col}.${nestedKey}`] : null;
    patch[col] = sqlMergeRows(row[col], inc, nestedKey, gone);
  }
  if (p.current_invoice && typeof p.current_invoice === "object") {
    patch.current_invoice = p.current_invoice;
  }
  if (Object.keys(patch).length === 0) {
    return {
      data: {
        seq: Number(row.sync_seq ?? fake.minSeq),
        updated_at: row.updated_at,
        prev_seq: prevSeq,
        prev_updated_at: prevAt,
        noop: true,
      },
      error: null,
    };
  }
  fake.upserts.push({ asUser, payload: { ...structuredClone(p), user_id: asUser }, ok: true });
  const next = applyWrite(asUser, patch);
  return {
    data: {
      seq: next.sync_seq,
      updated_at: next.updated_at,
      prev_seq: prevSeq,
      prev_updated_at: prevAt,
    },
    error: null,
  };
}

function rpc(name: string, args: Row) {
  return network((asUser) => {
    let out: { data: unknown; error: unknown };
    if (!fake.delta) {
      out = {
        data: null,
        error: {
          code: "PGRST202",
          message: `Could not find the function public.${name} in the schema cache`,
        },
      };
    } else if (fake.rpcError) {
      out = { data: null, error: fake.rpcError };
    } else {
      out = name === "kamix_sync_pull" ? rpcPull(asUser, args) : rpcPush(asUser, args);
    }
    fake.rpcCalls.push({ name, args: structuredClone(args), result: structuredClone(out.data) });
    return out;
  });
}

function applyWrite(id: string, payload: Row): Row {
  const old = fake.rows.get(id) ?? {};
  const incoming = structuredClone(payload);
  let merged = fake.serverMerge ? fake.serverMerge(old, incoming) : { ...old, ...incoming };
  if (fake.delta) merged = jsonbKeyOrder(merged) as Row;
  const next: Row = { ...merged, user_id: id, updated_at: serverNow() };
  if (fake.delta) {
    // تریگرهای user_data_sync_seq و user_data_sync_rows
    next.sync_seq = ++seqCounter;
    noteChanges(id, fake.rows.has(id) ? old : undefined, next, seqCounter);
  }
  fake.rows.set(id, next);
  fake.afterWrite?.(next);
  if (fake.realtime) {
    for (const ch of channels) {
      if (ch.removed || !ch.cb || (ch.userFilter && ch.userFilter !== id)) continue;
      const cb = ch.cb;
      setTimeout(
        () => cb({ new: { user_id: id, updated_at: next.updated_at, seq: next.sync_seq } }),
        50,
      );
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
            fake.selects.push(cols);
            // ستون updated_at در دیتابیس واقعی NOT NULL DEFAULT now() است
            if (!row.updated_at) row.updated_at = serverNow();
            // ستون sync_seq بعد از مهاجرت برای همهٔ ردیف‌های موجود مقدار پیش‌فرض دارد
            if (fake.delta && row.sync_seq == null) row.sync_seq = fake.minSeq;
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
  rpc,
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
