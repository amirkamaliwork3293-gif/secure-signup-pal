import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase, PLAN_LABEL, type SignupRequest, type UserProfile, type SubscriptionPlan } from "@/lib/supabase";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/lib/AuthContext";
import {
  approveSignupRequest, rejectSignupRequest, updateCardSettings,
  extendUserSubscription, deleteUserAccount, updatePlanPrices, getReceiptSignedUrl,
  updatePlanConfigs, adminResetUserPassword, adminGetRequestsWithPhone,
} from "@/lib/auth.functions";
import {
  DEFAULT_PLANS, normalizePlans, type PlansConfig, type PlanConfig,
} from "@/lib/plans";
import {
  ShieldCheck, Users, RefreshCw, LogOut, Loader2, Check, X,
  CreditCard, Save, Trash2, CalendarClock, Inbox, Image as ImageIcon, Eye,
  Package, Power, Percent, Timer, Search, KeyRound,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "پنل ادمین | کمالی" }] }),
  component: () => (
    <AuthGuard adminOnly>
      <AdminPage />
    </AuthGuard>
  ),
});

type Tab = "requests" | "users" | "plans" | "settings";

function AdminPage() {
  const { state, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("requests");
  const [requests, setRequests] = useState<SignupRequest[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const approve = useServerFn(approveSignupRequest);
  const reject = useServerFn(rejectSignupRequest);
  const extend = useServerFn(extendUserSubscription);
  const delUser = useServerFn(deleteUserAccount);
  const resetPwd = useServerFn(adminResetUserPassword);
  const getRequests = useServerFn(adminGetRequestsWithPhone);

  const fetchAll = async () => {
    if (state.status !== "authenticated" || !state.isAdmin) {
      setRequests([]);
      setUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [requestsData, u] = await Promise.all([
      getRequests(),
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
    ]);

    if (u.error) throw new Error(u.error.message);

    setRequests((requestsData as unknown as SignupRequest[]) || []);
    setUsers((u.data as UserProfile[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    void fetchAll().catch((e: any) => {
      alert(e?.message || "خطا در دریافت اطلاعات ادمین.");
      setLoading(false);
    });
  }, [state.status, state.status === "authenticated" ? state.profile.id : "anon", state.status === "authenticated" ? state.isAdmin : false]);

  const handleApprove = async (id: string) => {
    setActing(id);
    try { await approve({ data: { id } }); await fetchAll(); }
    catch (e: any) { alert(e?.message); }
    setActing(null);
  };
  const handleReject = async (id: string) => {
    if (!confirm("درخواست رد شود؟")) return;
    setActing(id);
    try { await reject({ data: { id } }); await fetchAll(); }
    catch (e: any) { alert(e?.message); }
    setActing(null);
  };
  const handleExtend = async (user: UserProfile, plan: SubscriptionPlan) => {
    setActing(user.id);
    try { await extend({ data: { user_id: user.id, plan } }); await fetchAll(); }
    catch (e: any) { alert(e?.message); }
    setActing(null);
  };
  const handleDelete = async (user: UserProfile) => {
    if (!confirm(`کاربر «${user.username}» حذف شود؟`)) return;
    setActing(user.id);
    try { await delUser({ data: { user_id: user.id } }); await fetchAll(); }
    catch (e: any) { alert(e?.message); }
    setActing(null);
  };

  const handleResetPassword = async (user: UserProfile, newPassword: string) => {
    setActing(user.id);
    try { await resetPwd({ data: { user_id: user.id, new_password: newPassword } }); }
    catch (e: any) { alert(e?.message); }
    setActing(null);
  };

  const pending = requests.filter((r) => r.status === "pending");
  const activeUsers = users.filter((u) => u.status === "active");
  const expiredUsers = users.filter((u) => u.status === "expired");

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold kamali-brand">پنل ادمین کمالی</div>
              <div className="text-[10px] text-muted-foreground">مدیریت کاربران و درخواست‌ها</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchAll}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card hover:bg-accent"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              <LogOut className="h-3.5 w-3.5" />
              خروج
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {/* Stats */}
        <div className="mb-4 grid grid-cols-4 gap-2">
          <Stat label="در انتظار" value={pending.length} color="text-amber-600" />
          <Stat label="فعال" value={activeUsers.length} color="text-green-600" />
          <Stat label="منقضی" value={expiredUsers.length} color="text-destructive" />
          <Stat label="کل" value={users.length} color="text-foreground" />
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1">
          {([
            { id: "requests" as Tab, label: `درخواست‌ها (${pending.length})`, icon: Inbox },
            { id: "users" as Tab, label: "کاربران", icon: Users },
            { id: "plans" as Tab, label: "پلن‌ها", icon: Package },
            { id: "settings" as Tab, label: "تنظیمات", icon: CreditCard },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-1 min-w-fit items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
                tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {tab === "requests" && (
              <RequestsTab
                requests={requests}
                acting={acting}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            )}
            {tab === "users" && (
              <UsersTab
                users={users}
                acting={acting}
                onExtend={handleExtend}
                onDelete={handleDelete}
                onResetPassword={handleResetPassword}
              />
            )}
            {tab === "plans" && <PlansTab />}
            {tab === "settings" && <SettingsTab />}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function RequestsTab({
  requests, acting, onApprove, onReject,
}: {
  requests: SignupRequest[];
  acting: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        <Inbox className="mx-auto mb-2 h-8 w-8 opacity-30" />
        درخواستی ثبت نشده
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {requests.map((r) => {
        const isActing = acting === r.id;
        return (
          <li key={r.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="font-medium">
                  {r.first_name} {r.last_name}
                  <span dir="ltr" className="ml-2 text-xs text-muted-foreground">@{r.username}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                    {PLAN_LABEL[r.plan]}
                  </span>
                  {r.payment_confirmed && (
                    <span className="rounded bg-green-500/10 px-2 py-0.5 font-medium text-green-700 dark:text-green-400">
                      پرداخت ✅
                    </span>
                  )}
                  {(r as any).phone && (
                    <span dir="ltr" className="rounded bg-secondary px-2 py-0.5">{(r as any).phone}</span>
                  )}
                  <span>{new Date(r.created_at).toLocaleString("fa-IR")}</span>
                </div>
              </div>
              <StatusBadge status={r.status} />
            </div>

            {(r as any).receipt_url && (
              <ReceiptThumb path={(r as any).receipt_url as string} />
            )}

            {r.status === "pending" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => onApprove(r.id)}
                  disabled={isActing}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  تایید کاربر
                </button>
                <button
                  onClick={() => onReject(r.id)}
                  disabled={isActing}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-destructive/10 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" />
                  رد درخواست
                </button>
              </div>
            )}
            {r.status === "approved" && !r.password_set && (
              <div className="mt-2 text-xs text-amber-600">
                ⏳ منتظر تنظیم رمز توسط کاربر (ثبت‌نام قدیمی)
              </div>
            )}
            {r.status === "approved" && r.password_set && (
              <div className="mt-2 text-xs text-green-600">
                ✅ حساب فعال است — کاربر می‌تواند وارد شود
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReceiptThumb({ path }: { path: string }) {
  const getUrl = useServerFn(getReceiptSignedUrl);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (url) { setOpen(true); return; }
    setLoading(true);
    try {
      const { url: signed } = await getUrl({ data: { path } });
      setUrl(signed);
      setOpen(true);
    } catch (e: any) {
      alert(e?.message || "خطا در دریافت رسید.");
    }
    setLoading(false);
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={load}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
        مشاهده رسید پرداخت
      </button>
      {open && url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/70 p-4"
          onClick={() => setOpen(false)}
        >
          <img src={url} alt="رسید پرداخت" className="max-h-[90vh] max-w-full rounded-xl border border-border" />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "در انتظار", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
    approved: { label: "تایید شده", cls: "bg-green-500/10 text-green-700 dark:text-green-400" },
    rejected: { label: "رد شده", cls: "bg-destructive/10 text-destructive" },
    active: { label: "فعال", cls: "bg-green-500/10 text-green-700 dark:text-green-400" },
    expired: { label: "منقضی", cls: "bg-destructive/10 text-destructive" },
  };
  const m = map[status] || { label: status, cls: "bg-muted text-muted-foreground" };
  return <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

function UsersTab({
  users, acting, onExtend, onDelete, onResetPassword,
}: {
  users: UserProfile[];
  acting: string | null;
  onExtend: (u: UserProfile, plan: SubscriptionPlan) => void;
  onDelete: (u: UserProfile) => void;
  onResetPassword: (u: UserProfile, newPassword: string) => void;
}) {
  const [searchQ, setSearchQ] = useState("");
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);

  const filtered = searchQ.trim()
    ? users.filter((u) =>
        u.username?.includes(searchQ) ||
        u.first_name?.includes(searchQ) ||
        u.last_name?.includes(searchQ),
      )
    : users;

  const handlePwdReset = async () => {
    if (!resetTarget || newPwd.length < 6) return;
    setPwdSaving(true);
    await onResetPassword(resetTarget, newPwd);
    setPwdSaving(false);
    setResetTarget(null);
    setNewPwd("");
    alert("رمز عبور با موفقیت تغییر کرد.");
  };

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="جستجوی نام یا یوزرنیم..."
          className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
        />
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-8 w-8 opacity-30" />
          {users.length === 0 ? "کاربری ثبت نشده" : "کاربری یافت نشد"}
        </div>
      )}

      <ul className="space-y-2">
        {filtered.map((u) => {
          const isActing = acting === u.id;
          const daysLeft = u.end_date
            ? Math.max(0, Math.ceil((new Date(u.end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
            : null;
          return (
            <li key={u.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="font-medium">
                    {u.first_name || "—"} {u.last_name || ""}
                    <span dir="ltr" className="ml-2 text-xs text-muted-foreground">@{u.username}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {u.plan && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">{PLAN_LABEL[u.plan]}</span>
                    )}
                    {u.end_date && (
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        تا {new Date(u.end_date).toLocaleDateString("fa-IR")}
                        {daysLeft !== null && (
                          <span className={daysLeft < 7 ? "text-destructive" : ""}>
                            {" "}({daysLeft} روز)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <StatusBadge status={u.status} />
              </div>

              {u.username !== "amirkamali" && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <span className="text-[11px] text-muted-foreground">تمدید:</span>
                    {(["1month", "3month", "6month", "12month"] as SubscriptionPlan[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => onExtend(u, p)}
                        disabled={isActing}
                        className="rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-60"
                      >
                        {PLAN_LABEL[p]}
                      </button>
                    ))}
                    <button
                      onClick={() => onDelete(u)}
                      disabled={isActing}
                      className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <button
                    onClick={() => { setResetTarget(u); setNewPwd(""); }}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
                  >
                    <KeyRound className="h-3 w-3" />
                    تغییر رمز عبور
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Password reset modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) { setResetTarget(null); setNewPwd(""); } }}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-elegant">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                تغییر رمز — {resetTarget.username}
              </h3>
              <button onClick={() => { setResetTarget(null); setNewPwd(""); }} className="grid h-7 w-7 place-items-center rounded-lg hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">رمز عبور جدید (حداقل ۶ کاراکتر)</label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              dir="ltr"
              autoFocus
              placeholder="••••••••"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={handlePwdReset}
              disabled={pwdSaving || newPwd.length < 6}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {pwdSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              ذخیره رمز جدید
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const [cardNumber, setCardNumber] = useState("");
  const [cardHolder, setCardHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [p1, setP1] = useState("100000");
  const [p3, setP3] = useState("280000");
  const [p6, setP6] = useState("500000");
  const [p12, setP12] = useState("1500000");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingPrices, setSavingPrices] = useState(false);
  const [savedPrices, setSavedPrices] = useState(false);
  const update = useServerFn(updateCardSettings);
  const updatePrices = useServerFn(updatePlanPrices);

  useEffect(() => {
    supabase.from("app_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      if (data) {
        setCardNumber((data as any).card_number || "");
        setCardHolder((data as any).card_holder || "");
        setBankName((data as any).bank_name || "");
        setP1(String((data as any).price_1month ?? 100000));
        setP3(String((data as any).price_3month ?? 280000));
        setP6(String((data as any).price_6month ?? 500000));
        setP12(String((data as any).price_12month ?? 1500000));
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    try {
      await update({ data: { card_number: cardNumber, card_holder: cardHolder, bank_name: bankName } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { alert(e?.message); }
    setSaving(false);
  };

  const handleSavePrices = async () => {
    setSavingPrices(true); setSavedPrices(false);
    try {
      await updatePrices({ data: {
        price_1month: Number(p1.replace(/[^\d]/g, "")) || 0,
        price_3month: Number(p3.replace(/[^\d]/g, "")) || 0,
        price_6month: Number(p6.replace(/[^\d]/g, "")) || 0,
        price_12month: Number(p12.replace(/[^\d]/g, "")) || 0,
      }});
      setSavedPrices(true);
      setTimeout(() => setSavedPrices(false), 2000);
    } catch (e: any) { alert(e?.message); }
    setSavingPrices(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">شماره کارت برای واریز کاربران</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">شماره کارت</label>
            <input
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              dir="ltr"
              placeholder="6037-9975-XXXX-XXXX"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">به نام</label>
              <input
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value)}
                placeholder="امیر کمالی"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">بانک</label>
              <input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="بانک ملی"
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? "ذخیره شد" : "ذخیره تنظیمات"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">قیمت پلن‌های اشتراک (تومان)</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">یک ماهه</label>
            <input value={p1} onChange={(e) => setP1(e.target.value)} inputMode="numeric" dir="ltr"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">سه ماهه</label>
            <input value={p3} onChange={(e) => setP3(e.target.value)} inputMode="numeric" dir="ltr"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">شش ماهه</label>
            <input value={p6} onChange={(e) => setP6(e.target.value)} inputMode="numeric" dir="ltr"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">یک ساله</label>
            <input value={p12} onChange={(e) => setP12(e.target.value)} inputMode="numeric" dir="ltr"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">نسخه تست رایگان و ۱ ساعت اعتبار دارد — قیمت ندارد.</p>
        <button
          onClick={handleSavePrices}
          disabled={savingPrices}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {savingPrices ? <Loader2 className="h-4 w-4 animate-spin" /> : savedPrices ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {savedPrices ? "قیمت‌ها ذخیره شدند" : "ذخیره قیمت‌ها"}
        </button>
      </div>
    </div>
  );
}

// ─── Plans management tab ──────────────────────────────────────────────────

const PLAN_KEYS: SubscriptionPlan[] = ["trial", "1month", "3month", "6month", "12month"];
const PLAN_TITLE: Record<SubscriptionPlan, string> = {
  trial: "نسخه تست",
  "1month": "یک ماهه",
  "3month": "سه ماهه",
  "6month": "شش ماهه",
  "12month": "یک ساله",
};

function toLocalDatetimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PlansTab() {
  const [cfg, setCfg] = useState<PlansConfig>(DEFAULT_PLANS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useServerFn(updatePlanConfigs);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("app_settings").select("plans").eq("id", 1).maybeSingle();
    setCfg(normalizePlans((data as any)?.plans));
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const update = (plan: SubscriptionPlan, patch: Partial<PlanConfig>) => {
    setCfg((prev) => ({ ...prev, [plan]: { ...prev[plan], ...patch } }));
  };

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    try {
      await save({ data: { plans: cfg } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { alert(e?.message || "خطا در ذخیره."); }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
        💡 پلن‌های غیرفعال در صفحه ثبت‌نام به کاربران جدید نمایش داده نمی‌شوند.
        غیرفعال‌سازی یک پلن هیچ تاثیری روی اشتراک کاربران فعلی ندارد.
      </div>

      {PLAN_KEYS.map((p) => (
        <PlanCard key={p} plan={p} cfg={cfg[p]} onChange={(patch) => update(p, patch)} />
      ))}

      <button
        onClick={handleSave}
        disabled={saving}
        className="sticky bottom-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {saved ? "ذخیره شد ✓" : "ذخیره همه پلن‌ها"}
      </button>
    </div>
  );
}

function PlanCard({
  plan, cfg, onChange,
}: { plan: SubscriptionPlan; cfg: PlanConfig; onChange: (patch: Partial<PlanConfig>) => void }) {
  const isTrial = plan === "trial";
  return (
    <div className={`rounded-2xl border bg-card p-4 transition ${cfg.enabled ? "border-border" : "border-dashed border-muted-foreground/30 opacity-70"}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Package className={`h-4 w-4 ${isTrial ? "text-amber-600" : "text-primary"}`} />
          <h3 className="text-sm font-bold">{PLAN_TITLE[plan]}</h3>
          {!cfg.enabled && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">غیرفعال</span>}
        </div>
        <button
          type="button"
          onClick={() => onChange({ enabled: !cfg.enabled })}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
            cfg.enabled ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground"
          }`}
        >
          <Power className="h-3 w-3" />
          {cfg.enabled ? "فعال" : "غیرفعال"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">قیمت (تومان)</label>
          <input
            type="number"
            min={0}
            value={cfg.price}
            disabled={isTrial}
            onChange={(e) => onChange({ price: Math.max(0, Number(e.target.value) || 0) })}
            dir="ltr"
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          {isTrial && <p className="mt-1 text-[10px] text-muted-foreground">نسخه تست همیشه رایگان است.</p>}
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground flex items-center gap-1">
            <Timer className="h-3 w-3" /> مدت ({isTrial ? "دقیقه" : "روز"})
          </label>
          <input
            type="number"
            min={1}
            value={isTrial ? cfg.duration_minutes : Math.round(cfg.duration_minutes / (60 * 24))}
            onChange={(e) => {
              const v = Math.max(1, Number(e.target.value) || 1);
              onChange({ duration_minutes: isTrial ? v : v * 60 * 24 });
            }}
            dir="ltr"
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      {!isTrial && (
        <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-400">
            <Percent className="h-3 w-3" /> تخفیف زمان‌دار
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">درصد تخفیف (٪)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={cfg.discount_percent}
                onChange={(e) => onChange({ discount_percent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                dir="ltr"
                className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">پایان تخفیف</label>
              <input
                type="datetime-local"
                value={toLocalDatetimeInput(cfg.discount_until)}
                onChange={(e) => onChange({ discount_until: e.target.value ? new Date(e.target.value).toISOString() : null })}
                className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          {cfg.discount_percent > 0 && (
            <p className="mt-2 text-[10px] text-rose-600">
              قیمت نهایی: {new Intl.NumberFormat("fa-IR").format(Math.floor(cfg.price * (100 - cfg.discount_percent) / 100))} تومان
              {cfg.discount_until && ` — تا ${new Date(cfg.discount_until).toLocaleString("fa-IR")}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
