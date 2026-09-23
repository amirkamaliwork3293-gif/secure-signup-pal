/**
 * کلاینت جعلی سوپابیس برای تست همگام‌سازی store.ts — فقط همان چیزهایی که store.ts صدا می‌زند.
 * RLS شبیه‌سازی می‌شود: هر درخواست با کاربرِ نشستِ لحظهٔ شروع درخواست اجرا می‌شود.
 * با hold() همهٔ درخواست‌های شبکه تا release() معطل می‌مانند (شبکهٔ کند).
 */
type Row = Record<string, unknown>;

export const fake = {
  rows: new Map<string, Row>(),
  sessionUser: null as string | null,
  upserts: [] as { asUser: string | null; payload: Row; ok: boolean }[],
  gate: null as Promise<void> | null,
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((r) => (release = r));
    return () => {
      this.gate = null;
      release();
    };
  },
};

async function network<T>(run: (asUser: string | null) => T): Promise<T> {
  const asUser = fake.sessionUser;
  if (fake.gate) await fake.gate;
  return run(asUser);
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
            if (name !== "user_data" || !asUser || asUser !== id) return { data: null, error: null };
            const row = fake.rows.get(id);
            if (!row) return { data: null, error: null };
            if (cols === "*") return { data: structuredClone(row), error: null };
            const out: Row = {};
            for (const c of cols.split(",")) out[c] = structuredClone(row[c]);
            return { data: out, error: null };
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
          return {
            error: { code: "42501", message: "new row violates row-level security policy" },
          };
        }
        fake.upserts.push({ asUser, payload: structuredClone(payload), ok: true });
        fake.rows.set(id, { ...(fake.rows.get(id) ?? {}), ...structuredClone(payload) });
        return { error: null };
      });
    },
  };
}

export const supabase = {
  from: table,
  auth: {
    async refreshSession() {
      return fake.sessionUser ? { data: {}, error: null } : { data: {}, error: { message: "no session" } };
    },
    async getSession() {
      return {
        data: {
          session: fake.sessionUser ? { access_token: `tok-${fake.sessionUser}`, user: { id: fake.sessionUser } } : null,
        },
      };
    },
  },
};
