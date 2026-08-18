import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase, PLAN_LABEL, PLAN_DURATION_LABEL, type SignupRequest, type UserProfile, type SubscriptionPlan } from "@/lib/supabase";
import { formatJalaliDate, formatJalaliDateTime } from "@/lib/store";
import { filterAndRankSearch, namesReferToSamePerson, personNameSearchFields } from "@/lib/search";
import { openExternal, toIntlPhone } from "@/lib/openExternal";
import { AuthGuard } from "@/components/AuthGuard";
import { LandingEditor } from "@/components/admin/LandingEditor";
import { useAuth } from "@/lib/AuthContext";
import {
  approveSignupRequest, rejectSignupRequest, updateCardSettings,
  extendUserSubscription, deleteUserAccount, updatePlanPrices, getReceiptSignedUrl,
  updatePlanConfigs, adminResetUserPassword, adminGetRequestsWithPhone, adminGetUserPhones,
  adminClearSignupTempPassword,
  adminListPasswordResetRequests, adminAckPasswordReset,
  type PasswordResetRequestRow,
} from "@/lib/auth.functions";
import {
  DEFAULT_PLANS, normalizePlans, effectivePrice, isDiscountActive, type PlansConfig, type PlanConfig,
} from "@/lib/plans";
import { MESSAGE_TEMPLATES, type MessageTemplateId } from "@/lib/sms-templates";
import {
  ShieldCheck, Users, RefreshCw, LogOut, Loader2, Check, X,
  CreditCard, Save, Trash2, CalendarClock, Inbox, Image as ImageIcon, Eye,
  Package, Power, Percent, Timer, Search, KeyRound, BellRing, Phone, MessageSquare,
  Copy,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "پنل ادمین | KAMIX" }] }),
  component: () => (
    <AuthGuard adminOnly>
      <AdminPage />
    </AuthGuard>
  ),
});

type Tab = "requests" | "users" | "renewals" | "customers" | "plans" | "settings" | "landing" | "resets";

function AdminPage() {
  const { state, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("requests");
  const [requests, setRequests] = useState<SignupRequest[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [phones, setPhones] = useState<Record<string, string | null>>({});
  const [resetRequests, setResetRequests] = useState<PasswordResetRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const approve = useServerFn(approveSignupRequest);
  const reject = useServerFn(rejectSignupRequest);
  const extend = useServerFn(extendUserSubscription);
  const delUser = useServerFn(deleteUserAccount);
  const resetPwd = useServerFn(adminResetUserPassword);
  const getRequests = useServerFn(adminGetRequestsWithPhone);
  const getPhones = useServerFn(adminGetUserPhones);
  const getResetReqs = useServerFn(adminListPasswordResetRequests);

  const fetchAll = async () => {
    if (state.status !== "authenticated" || !state.isAdmin) {
      setRequests([]);
      setUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [requestsData, u, phoneMap, resets] = await Promise.all([
      getRequests(),
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      getPhones().catch(() => ({} as Record<string, string | null>)),
      getResetReqs().catch(() => [] as PasswordResetRequestRow[]),
    ]);

    if (u.error) throw new Error(u.error.message);

    setRequests((requestsData as unknown as SignupRequest[]) || []);
    setUsers((u.data as UserProfile[]) || []);
    setPhones((phoneMap as Record<string, string | null>) || {});
    setResetRequests((resets as PasswordResetRequestRow[]) || []);
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

  const handleResetPassword = async (user: UserProfile, newPassword: string): Promise<boolean> => {
    setActing(user.id);
    try {
      await resetPwd({ data: { user_id: user.id, new_password: newPassword } });
      return true;
    } catch (e: any) {
      alert(e?.message);
      return false;
    } finally {
      setActing(null);
    }
  };

  const pending = requests.filter((r) => r.status === "pending");
  const activeUsers = users.filter((u) => u.status === "active");
  const expiredUsers = users.filter((u) => u.status === "expired");
  const pendingResets = resetRequests.filter((r) => r.status === "pending");

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold kamali-brand">پنل ادمین KAMIX</div>
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
            { id: "resets" as Tab, label: `بازیابی رمز (${pendingResets.length})`, icon: KeyRound },
            { id: "renewals" as Tab, label: "تمدید‌ها", icon: BellRing },
            { id: "customers" as Tab, label: "مشتریان", icon: CalendarClock },
            { id: "users" as Tab, label: "کاربران", icon: Users },
            { id: "plans" as Tab, label: "پلن‌ها", icon: Package },
            { id: "settings" as Tab, label: "تنظیمات", icon: CreditCard },
            { id: "landing" as Tab, label: "معرفی", icon: ImageIcon },
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
                phones={phones}
              />
            )}
            {tab === "resets" && (
              <PasswordResetsTab
                requests={resetRequests}
                users={users}
                phones={phones}
                signupRequests={requests}
                onResetPassword={handleResetPassword}
                onRefresh={() => void fetchAll()}
              />
            )}
            {tab === "users" && (
              <UsersTab
                users={users}
                phones={phones}
                acting={acting}
                onExtend={handleExtend}
                onDelete={handleDelete}
                onResetPassword={handleResetPassword}
              />
            )}
            {tab === "renewals" && (
              <RenewalsTab users={users} phones={phones} requests={requests} />
            )}
            {tab === "customers" && (
              <CustomersTab requests={requests} users={users} phones={phones} />
            )}
            {tab === "plans" && <PlansTab />}
            {tab === "settings" && <SettingsTab />}
            {tab === "landing" && <LandingEditor />}
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
  requests, acting, onApprove, onReject, phones,
}: {
  requests: SignupRequest[];
  acting: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  phones: Record<string, string | null>;
}) {
  const [messageTarget, setMessageTarget] = useState<SignupRequest | null>(null);
  const clearTempPwd = useServerFn(adminClearSignupTempPassword);
  const [plansCfg, setPlansCfg] = useState<PlansConfig>(DEFAULT_PLANS);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("plans")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => setPlansCfg(normalizePlans((data as any)?.plans)));
  }, []);

  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        <Inbox className="mx-auto mb-2 h-8 w-8 opacity-30" />
        درخواستی ثبت نشده
      </div>
    );
  }
  return (
    <>
    <ul className="space-y-2">
      {requests.map((r) => {
        const isActing = acting === r.id;
        const cfg = plansCfg[r.plan];
        const price = cfg ? effectivePrice(cfg, Date.now()) : 0;
        const isRenewal = (r as any).request_type === "renewal";
        return (
          <li key={r.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="font-medium">
                  {r.first_name} {r.last_name}
                  <span dir="ltr" className="ml-2 text-xs text-muted-foreground">@{r.username}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {isRenewal && (
                    <span className="rounded bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                      تمدید اشتراک
                    </span>
                  )}
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
                  <span>{formatJalaliDateTime(r.created_at)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-[11px]">
                  <span className="text-muted-foreground">مدت اشتراک:</span>
                  <strong>{PLAN_DURATION_LABEL[r.plan]}</strong>
                  <span className="text-muted-foreground">— مبلغ قابل پرداخت:</span>
                  <strong className="text-primary">
                    {new Intl.NumberFormat("fa-IR").format(price)} تومان
                  </strong>
                  {cfg && isDiscountActive(cfg, Date.now()) && (
                    <span className="text-rose-600">
                      (با {cfg.discount_percent.toLocaleString("fa-IR")}٪ تخفیف — قیمت اصلی{" "}
                      {new Intl.NumberFormat("fa-IR").format(cfg.price)})
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  ⚠️ قبل از تایید، مبلغ رسید را با مبلغ پلن انتخابی مقایسه کنید.
                </div>
              </div>
              <StatusBadge status={r.status} />
            </div>

            {(r as any).receipt_url && (
              <ReceiptThumb path={(r as any).receipt_url as string} />
            )}

            {/* رسید دستی: کاربر عکس نفرستاده و کد پیگیری/تاریخ واریز را تایپ کرده است */}
            {(r as any).receipt_note && (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-6">
                <div className="mb-1 font-semibold text-amber-700 dark:text-amber-400">
                  رسید دستی (بدون عکس)
                </div>
                <div className="text-foreground">{(r as any).receipt_note as string}</div>
              </div>
            )}

            {!(r as any).receipt_url && !(r as any).receipt_note && r.status === "pending" && (
              <div className="mt-3 text-[11px] text-muted-foreground">
                رسیدی ثبت نشده است.
              </div>
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
            {r.status === "approved" && (
              <div className="mt-3">
                <button
                  onClick={() => setMessageTarget(r)}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/5"
                >
                  <MessageSquare className="h-3 w-3" />
                  {isRenewal ? "پیام تایید تمدید به کاربر" : "پیام خوش‌آمدگویی به کاربر"}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>

    {messageTarget && (
      <MessageUserModal
        user={messageTarget}
        phone={(messageTarget as any).phone || phones[messageTarget.username?.toLowerCase()] || null}
        password={messageTarget.temp_password || null}
        defaultTemplate={
          (messageTarget as any).request_type === "renewal"
            ? "renewal_done"
            : messageTarget.temp_password
              ? "welcome"
              : "thanks"
        }
        onSent={() => {
          if (messageTarget.temp_password) {
            void clearTempPwd({ data: { id: messageTarget.id } }).catch(() => {});
          }
        }}
        onClose={() => setMessageTarget(null)}
      />
    )}
    </>
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
    resolved: { label: "انجام شد", cls: "bg-green-500/10 text-green-700 dark:text-green-400" },
    active: { label: "فعال", cls: "bg-green-500/10 text-green-700 dark:text-green-400" },
    expired: { label: "منقضی", cls: "bg-destructive/10 text-destructive" },
  };
  const m = map[status] || { label: status, cls: "bg-muted text-muted-foreground" };
  return <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

function UsersTab({
  users, phones, acting, onExtend, onDelete, onResetPassword,
}: {
  users: UserProfile[];
  phones: Record<string, string | null>;
  acting: string | null;
  onExtend: (u: UserProfile, plan: SubscriptionPlan) => void;
  onDelete: (u: UserProfile) => void;
  onResetPassword: (u: UserProfile, newPassword: string) => Promise<boolean>;
}) {
  const [searchQ, setSearchQ] = useState("");
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [messageTarget, setMessageTarget] = useState<UserProfile | null>(null);

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
    const ok = await onResetPassword(resetTarget, newPwd);
    setPwdSaving(false);
    if (!ok) return;
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
                        تا {formatJalaliDate(u.end_date)}
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

              <div className="mt-3">
                <button
                  onClick={() => setMessageTarget(u)}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/5"
                >
                  <MessageSquare className="h-3 w-3" />
                  ارسال پیام به این کاربر
                </button>
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
      {/* Message modal — ارسال پیام به هر کاربر ثبت‌نامی (نه فقط تمدیدی‌ها) */}
      {messageTarget && (
        <MessageUserModal
          user={messageTarget}
          phone={phones[messageTarget.username?.toLowerCase()] || null}
          onClose={() => setMessageTarget(null)}
        />
      )}
    </div>
  );
}

// ─── پیام به یک کاربر (تماس/پیامک/واتساپ) ─────────────────────────────────
function MessageUserModal({
  user,
  phone,
  password,
  defaultTemplate = "thanks",
  onSent,
  onClose,
}: {
  user: { username: string; first_name?: string | null; last_name?: string | null };
  phone: string | null;
  /** رمز عبور کاربر — فقط برای قالب «خوش‌آمدگویی» لازم است (مثلاً بعد از تایید ثبت‌نام) */
  password?: string | null;
  defaultTemplate?: MessageTemplateId;
  /** بعد از باز کردن لینک پیامک/واتساپ فراخوانی می‌شود (مثلاً برای پاک کردن رمز موقت از دیتابیس) */
  onSent?: () => void;
  onClose: () => void;
}) {
  const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.username;
  const availableTemplates = MESSAGE_TEMPLATES.filter((t) => !t.needsPassword || !!password);
  const [templateId, setTemplateId] = useState<MessageTemplateId>(
    availableTemplates.some((t) => t.id === defaultTemplate) ? defaultTemplate : (availableTemplates[0]?.id ?? "custom"),
  );
  const [includeLink, setIncludeLink] = useState(true);
  const [copied, setCopied] = useState(false);
  const buildText = (id: MessageTemplateId, withLink: boolean) =>
    (MESSAGE_TEMPLATES.find((t) => t.id === id) ?? MESSAGE_TEMPLATES[0]).build({
      name, username: user.username, password, includeLink: withLink,
    });
  const [text, setText] = useState(() => buildText(
    availableTemplates.some((t) => t.id === defaultTemplate) ? defaultTemplate : (availableTemplates[0]?.id ?? "custom"),
    true,
  ));
  const localPhone = phone ? phone.replace(/[^\d+]/g, "") : "";
  const currentTemplate = MESSAGE_TEMPLATES.find((t) => t.id === templateId);

  const applyTemplate = (id: MessageTemplateId) => {
    setTemplateId(id);
    setText(buildText(id, includeLink));
  };
  const toggleIncludeLink = (checked: boolean) => {
    setIncludeLink(checked);
    setText(buildText(templateId, checked));
  };
  const copyText = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            پیام به {name}
          </h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {localPhone ? (
          <span dir="ltr" className="mb-3 inline-block rounded bg-secondary px-2 py-0.5 text-xs">{localPhone}</span>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">شماره تماسی برای این کاربر ثبت نشده است.</p>
        )}

        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">دسته پیام آماده</label>
        <select
          value={templateId}
          onChange={(e) => applyTemplate(e.target.value as MessageTemplateId)}
          className="mb-3 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        >
          {availableTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>

        {currentTemplate?.hasLink && (
          <label className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeLink}
              onChange={(e) => toggleIncludeLink(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            لینک در متن پیام درج شود
          </label>
        )}

        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">متن پیام (قابل ویرایش)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none focus:border-primary"
        />

        {localPhone && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => openExternal(`tel:${localPhone}`)}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
            >
              <Phone className="h-3.5 w-3.5" />
              تماس
            </button>
            <button
              type="button"
              onClick={() => {
                openExternal(`sms:${localPhone}?body=${encodeURIComponent(text)}`);
                onSent?.();
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-500/10 py-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-500/20"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              پیامک
            </button>
            <button
              type="button"
              onClick={() => {
                openExternal(`https://wa.me/${toIntlPhone(localPhone)}?text=${encodeURIComponent(text)}`);
                onSent?.();
              }}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-green-500/10 py-2 text-xs font-semibold text-green-700 dark:text-green-400 hover:bg-green-500/20"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              واتساپ
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => void copyText()}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium hover:bg-accent"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "متن کپی شد" : "کپی متن پیام"}
        </button>
        {!localPhone && password && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            چون شماره‌ای ثبت نشده، متن بالا را کپی کنید و از راه دیگری (مثلاً تلگرام) برای کاربر بفرستید.
          </p>
        )}
      </div>
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

const PLAN_KEYS: SubscriptionPlan[] = ["1month", "3month", "6month", "12month"];
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
              {cfg.discount_until && ` — تا ${formatJalaliDateTime(cfg.discount_until)}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Renewals tab ────────────────────────────────────────────────────────────
function RenewalsTab({
  users, phones, requests,
}: {
  users: UserProfile[];
  phones: Record<string, string | null>;
  requests: SignupRequest[];
}) {
  const [subTab, setSubTab] = useState<"expiring" | "history">("expiring");
  const [detailTarget, setDetailTarget] = useState<SignupRequest | null>(null);
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  type Row = { u: UserProfile; end: number; daysLeft: number; phone: string | null };
  const rows: Row[] = users
    .filter((u) => u.end_date)
    .map((u) => {
      const end = new Date(u.end_date!).getTime();
      const daysLeft = Math.ceil((end - now) / DAY);
      const phone = phones[u.username?.toLowerCase()] || null;
      return { u, end, daysLeft, phone };
    })
    .filter((r) => r.daysLeft <= 7) // منقضی + نزدیک به انقضا (≤۷ روز)
    .sort((a, b) => a.end - b.end);

  const renewalRequests = requests
    .filter((r) => (r as any).request_type === "renewal")
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const subTabSwitcher = (
    <div className="mb-3 flex gap-1 rounded-xl bg-muted p-1">
      {([
        { id: "expiring" as const, label: "نزدیک به انقضا / منقضی" },
        { id: "history" as const, label: `تاریخچه تمدیدها (${renewalRequests.length})` },
      ]).map(({ id, label }) => (
        <button
          key={id}
          onClick={() => setSubTab(id)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
            subTab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (subTab === "history") {
    return (
      <div className="space-y-3">
        {subTabSwitcher}
        {renewalRequests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            <BellRing className="mx-auto mb-2 h-8 w-8 opacity-30" />
            هنوز هیچ تمدیدی ثبت نشده است.
          </div>
        ) : (
          <ul className="space-y-2">
            {renewalRequests.map((r) => (
              <li
                key={r.id}
                onClick={() => setDetailTarget(r)}
                className="cursor-pointer rounded-2xl border border-border bg-card p-4 hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-medium">
                      {r.first_name} {r.last_name}
                      <span dir="ltr" className="ml-2 text-xs text-muted-foreground">@{r.username}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                        تمدید
                      </span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {PLAN_LABEL[r.plan]}
                      </span>
                      <span>{formatJalaliDateTime(r.created_at)}</span>
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {detailTarget && (
          <CustomerDetailDialog target={detailTarget} requests={requests} onClose={() => setDetailTarget(null)} />
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {subTabSwitcher}
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <BellRing className="mx-auto mb-2 h-8 w-8 opacity-30" />
          فعلا کاربری در آستانه تمدید یا منقضی وجود ندارد.
        </div>
      </div>
    );
  }

  const buildMsg = (u: UserProfile, daysLeft: number) => {
    const name = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username;
    if (daysLeft <= 0) {
      return `سلام ${name} عزیز،\nاشتراک شما در برنامه کمالی (KAMIX) منقضی شده است. لطفاً برای ادامه استفاده، از بخش «تمدید» اقدام بفرمایید.\nبا تشکر 🌹`;
    }
    return `سلام ${name} عزیز،\nاشتراک شما در برنامه کمالی (KAMIX) تا ${daysLeft} روز دیگر به پایان می‌رسد. لطفاً پیش از انقضا نسبت به تمدید اقدام کنید.\nبا تشکر 🌹`;
  };

  const normalizePhone = (p: string) => p.replace(/[^\d+]/g, "");

  return (
    <div className="space-y-3">
      {subTabSwitcher}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
        نمایش کاربرانی که اشتراکشان تا ۷ روز آینده تمام می‌شود یا منقضی شده — جهت یادآوری تمدید.
      </div>
      <ul className="space-y-2">
        {rows.map(({ u, daysLeft, phone }) => {
          const expired = daysLeft <= 0;
          const msg = buildMsg(u, daysLeft);
          const encoded = encodeURIComponent(msg);
          const localPhone = phone ? normalizePhone(phone) : "";
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
                    <span className={`flex items-center gap-1 rounded px-2 py-0.5 ${expired ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                      <CalendarClock className="h-3 w-3" />
                      {expired ? "منقضی شده" : `${daysLeft} روز مانده`}
                    </span>
                    {u.end_date && <span>{formatJalaliDate(u.end_date)}</span>}
                    {phone ? (
                      <span dir="ltr" className="rounded bg-secondary px-2 py-0.5">{phone}</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">بدون شماره تماس</span>
                    )}
                  </div>
                </div>
              </div>

              {localPhone ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <a
                    href={`tel:${localPhone}`}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    تماس
                  </a>
                  <a
                    href={`sms:${localPhone}?body=${encoded}`}
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-500/10 py-2 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-500/20"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    پیامک
                  </a>
                  <a
                    href={`https://wa.me/${localPhone.replace(/^0/, "98").replace(/^\+/, "")}?text=${encoded}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded-lg bg-green-500/10 py-2 text-xs font-semibold text-green-700 dark:text-green-400 hover:bg-green-500/20"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    واتساپ
                  </a>
                </div>
              ) : (
                <div className="mt-3 text-[11px] text-muted-foreground">
                  شماره تماسی برای این کاربر ثبت نشده است.
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Customers tab — date/time range filter across signups + renewals ────────
function CustomersTab({
  requests, users, phones,
}: {
  requests: SignupRequest[];
  users: UserProfile[];
  phones: Record<string, string | null>;
}) {
  const defaultFrom = toLocalDatetimeInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  const defaultTo = toLocalDatetimeInput(new Date().toISOString());
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [detailTarget, setDetailTarget] = useState<SignupRequest | null>(null);

  const fromMs = from ? new Date(from).getTime() : -Infinity;
  const toMs = to ? new Date(to).getTime() : Infinity;

  const rows = requests
    .filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= fromMs && t <= toMs;
    })
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const profileByUsername = new Map(users.map((u) => [u.username?.toLowerCase(), u]));

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-primary" />
          فیلتر بازه ثبت‌نام / تمدید
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">از تاریخ/ساعت</label>
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">تا تاریخ/ساعت</label>
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <Search className="mx-auto mb-2 h-8 w-8 opacity-30" />
          موردی در این بازه یافت نشد.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const isRenewal = (r as any).request_type === "renewal";
            const profile = profileByUsername.get(r.username?.toLowerCase());
            const phone = (r as any).phone || phones[r.username?.toLowerCase()] || null;
            return (
              <li
                key={r.id}
                onClick={() => setDetailTarget(r)}
                className="cursor-pointer rounded-2xl border border-border bg-card p-4 hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-medium">
                      {r.first_name} {r.last_name}
                      <span dir="ltr" className="ml-2 text-xs text-muted-foreground">@{r.username}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className={`rounded px-2 py-0.5 font-medium ${
                          isRenewal
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                        }`}
                      >
                        {isRenewal ? "تمدید" : "ثبت‌نام"}
                      </span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        {PLAN_LABEL[r.plan]}
                      </span>
                      <span>{formatJalaliDateTime(r.created_at)}</span>
                      {phone && <span dir="ltr" className="rounded bg-secondary px-2 py-0.5">{phone}</span>}
                      {profile && <StatusBadge status={profile.status} />}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {detailTarget && (
        <CustomerDetailDialog target={detailTarget} requests={requests} onClose={() => setDetailTarget(null)} />
      )}
    </div>
  );
}

// ─── Customer detail dialog — full renewal history for a given username ──────
function CustomerDetailDialog({
  target, requests, onClose,
}: {
  target: SignupRequest;
  requests: SignupRequest[];
  onClose: () => void;
}) {
  const history = requests
    .filter((r) => (r as any).request_type === "renewal" && r.username?.toLowerCase() === target.username?.toLowerCase())
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const signupReq = requests.find(
    (r) => (r as any).request_type !== "renewal" && r.username?.toLowerCase() === target.username?.toLowerCase(),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold">
            {target.first_name} {target.last_name}
            <span dir="ltr" className="mr-2 text-xs font-normal text-muted-foreground">@{target.username}</span>
          </h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {signupReq && (
          <div className="mb-3 rounded-xl bg-secondary/50 px-3 py-2 text-xs">
            <span className="text-muted-foreground">تاریخ ثبت‌نام: </span>
            <strong>{formatJalaliDateTime(signupReq.created_at)}</strong>
            <span className="text-muted-foreground"> — پلن اولیه: </span>
            <strong>{PLAN_LABEL[signupReq.plan]}</strong>
          </div>
        )}

        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <BellRing className="h-4 w-4 text-primary" />
          تاریخچه تمدیدها ({history.length.toLocaleString("fa-IR")} بار)
        </div>

        {history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            این کاربر تاکنون تمدید نکرده است.
          </p>
        ) : (
          <ul className="space-y-2">
            {history.map((r, i) => (
              <li key={r.id} className="rounded-xl border border-border bg-background p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">تمدید #{(i + 1).toLocaleString("fa-IR")}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span>{formatJalaliDateTime(r.created_at)}</span>
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">{PLAN_LABEL[r.plan]}</span>
                  <span>({PLAN_DURATION_LABEL[r.plan]})</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function normalizeIranPhoneClient(p: string | null | undefined): string {
  return (p || "").replace(/\s+/g, "").replace(/^\+98/, "0").replace(/^98/, "0");
}

function generateSimplePassword() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function userSearchFields(u: UserProfile, phone: string | null | undefined) {
  return [
    u.username,
    u.first_name,
    u.last_name,
    `${u.first_name || ""} ${u.last_name || ""}`.trim(),
    phone || "",
    ...personNameSearchFields({ firstName: u.first_name || "", lastName: u.last_name || "" }),
  ];
}

function PasswordResetsTab({
  requests,
  users,
  phones,
  signupRequests,
  onResetPassword,
  onRefresh,
}: {
  requests: PasswordResetRequestRow[];
  users: UserProfile[];
  phones: Record<string, string | null>;
  signupRequests: SignupRequest[];
  onResetPassword: (u: UserProfile, newPassword: string) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = filterAndRankSearch(requests, query, (r) => [
    r.first_name,
    r.last_name,
    `${r.first_name} ${r.last_name}`,
    r.phone,
  ]);
  const pending = filtered.filter((r) => r.status === "pending");
  const done = filtered.filter((r) => r.status !== "pending");

  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        <KeyRound className="mx-auto mb-2 h-8 w-8 opacity-30" />
        درخواست بازیابی رمزی ثبت نشده
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-border bg-card px-3 py-2 text-[11px] leading-6 text-muted-foreground">
        کاربر را با نام یا شماره پیدا کنید، یوزرنیم را ببینید، رمز جدید بگذارید و با پیامک نیمه‌دستی برایش بفرستید. رمز قبلی به‌خاطر امنیت قابل نمایش نیست.
      </p>
      <div className="relative">
        <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجوی درخواست: نام، نام خانوادگی یا شماره..."
          className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
        />
      </div>
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          درخواستی با این مشخصات پیدا نشد
        </div>
      )}
      {pending.length > 0 && (
        <ul className="space-y-2">
          {pending.map((r) => (
            <PasswordResetCard
              key={r.id}
              r={r}
              users={users}
              phones={phones}
              signupRequests={signupRequests}
              onResetPassword={onResetPassword}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">سوابق</div>
          <ul className="space-y-2">
            {done.map((r) => (
              <PasswordResetCard
                key={r.id}
                r={r}
                users={users}
                phones={phones}
                signupRequests={signupRequests}
                onResetPassword={onResetPassword}
                onRefresh={onRefresh}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PasswordResetCard({
  r,
  users,
  phones,
  signupRequests,
  onResetPassword,
  onRefresh,
}: {
  r: PasswordResetRequestRow;
  users: UserProfile[];
  phones: Record<string, string | null>;
  signupRequests: SignupRequest[];
  onResetPassword: (u: UserProfile, newPassword: string) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const ackFn = useServerFn(adminAckPasswordReset);
  const [picked, setPicked] = useState<UserProfile | null>(null);
  const [userQ, setUserQ] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [shownPwd, setShownPwd] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [copied, setCopied] = useState("");

  const phoneOf = (u: UserProfile) => phones[u.username?.toLowerCase()] || null;

  const phoneMatches = users.filter(
    (u) => normalizeIranPhoneClient(phoneOf(u)) === normalizeIranPhoneClient(r.phone) && normalizeIranPhoneClient(r.phone),
  );
  const nameMatches = users.filter((u) =>
    namesReferToSamePerson(
      { firstName: r.first_name, lastName: r.last_name },
      { firstName: u.first_name || "", lastName: u.last_name || "" },
    ),
  );
  const suggested = [
    ...phoneMatches,
    ...nameMatches.filter((u) => !phoneMatches.some((p) => p.id === u.id)),
  ].slice(0, 6);

  const autoMatchId = phoneMatches.length === 1 ? phoneMatches[0].id : null;
  useEffect(() => {
    if (picked || !autoMatchId) return;
    const u = users.find((x) => x.id === autoMatchId);
    if (u) setPicked(u);
  }, [picked, autoMatchId, users]);

  const searched = userQ.trim()
    ? filterAndRankSearch(users, userQ, (u) => userSearchFields(u, phoneOf(u))).slice(0, 8)
    : [];

  const tempPassword =
    picked
      ? signupRequests.find(
          (s) => s.username?.toLowerCase() === picked.username.toLowerCase() && s.temp_password,
        )?.temp_password || null
      : null;
  const passwordToShow = shownPwd || tempPassword;
  const smsPhone = picked ? phoneOf(picked) || r.phone : r.phone;

  const copyValue = async (label: string, value: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    }
  };

  const applyPassword = async () => {
    if (!picked || newPwd.length < 6) {
      alert("کاربر را انتخاب کنید و رمز جدید حداقل ۶ کاراکتر باشد.");
      return;
    }
    if (picked.username === "amirkamali") {
      alert("رمز این حساب از اینجا عوض نمی‌شود.");
      return;
    }
    setBusy(true);
    const ok = await onResetPassword(picked, newPwd);
    setBusy(false);
    if (!ok) return;
    setShownPwd(newPwd);
  };

  const markDone = async () => {
    setBusy(true);
    try {
      await ackFn({ data: { id: r.id } });
      onRefresh();
    } catch (e: unknown) {
      alert((e as { message?: string })?.message || "خطا");
    }
    setBusy(false);
  };

  const Row = ({ label, value, copyKey, ltr }: { label: string; value: string; copyKey?: string; ltr?: boolean }) => (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className="w-24 shrink-0">{label}</span>
      <span dir={ltr ? "ltr" : undefined} className="min-w-0 flex-1 font-medium text-foreground">{value}</span>
      {copyKey && (
        <button
          type="button"
          onClick={() => void copyValue(copyKey, value)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border hover:bg-accent"
          title="کپی"
        >
          {copied === copyKey ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
    </div>
  );

  const UserChip = ({ u, reason }: { u: UserProfile; reason?: string }) => (
    <button
      type="button"
      onClick={() => { setPicked(u); setShownPwd(null); }}
      className={`w-full rounded-xl border px-3 py-2 text-right text-xs hover:bg-accent ${
        picked?.id === u.id ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <div className="font-medium text-foreground">
        {u.first_name || "—"} {u.last_name || ""}
        <span dir="ltr" className="mr-2 text-muted-foreground">@{u.username}</span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">
        {phoneOf(u) ? <span dir="ltr">{phoneOf(u)}</span> : "بدون شماره"}
        {reason ? ` — ${reason}` : ""}
      </div>
    </button>
  );

  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {r.first_name} {r.last_name}
          </div>
          <div className="mt-2 grid gap-1.5 text-xs">
            <Row label="نام" value={r.first_name} />
            <Row label="نام خانوادگی" value={r.last_name} />
            <Row label="شماره تلفن" value={r.phone} copyKey="req-phone" ltr />
            <Row label="زمان ارسال" value={formatJalaliDateTime(r.created_at)} />
          </div>
        </div>
        <StatusBadge status={r.status} />
      </div>

      {r.status === "pending" && (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <div className="text-xs font-semibold">پیدا کردن حساب کاربر</div>
          {suggested.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted-foreground">پیشنهاد بر اساس شماره یا نام</div>
              {suggested.map((u) => (
                <UserChip
                  key={u.id}
                  u={u}
                  reason={phoneMatches.some((p) => p.id === u.id) ? "تطبیق شماره" : "تطبیق نام"}
                />
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="absolute right-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={userQ}
              onChange={(e) => setUserQ(e.target.value)}
              placeholder="جستجوی یوزرنیم، نام یا شماره در کاربران..."
              className="w-full rounded-xl border border-input bg-background py-2 pr-8 pl-3 text-xs outline-none focus:border-primary"
            />
          </div>
          {searched.length > 0 && (
            <div className="space-y-1.5">
              {searched.map((u) => (
                <UserChip key={u.id} u={u} />
              ))}
            </div>
          )}
          {userQ.trim() && searched.length === 0 && (
            <div className="text-[11px] text-muted-foreground">کاربری با این جستجو پیدا نشد.</div>
          )}

          {picked && (
            <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="text-xs font-semibold text-primary">حساب پیدا شد</div>
              <div className="grid gap-1.5 text-xs">
                <Row label="یوزرنیم" value={picked.username} copyKey="username" ltr />
                <Row label="نام حساب" value={`${picked.first_name || ""} ${picked.last_name || ""}`.trim() || "—"} />
                <Row label="شماره حساب" value={phoneOf(picked) || "ثبت نشده"} copyKey="user-phone" ltr />
                {tempPassword && !shownPwd && (
                  <Row label="رمز ثبت‌نام" value={tempPassword} copyKey="temp-pwd" ltr />
                )}
                {shownPwd && (
                  <Row label="رمز جدید" value={shownPwd} copyKey="new-pwd" ltr />
                )}
              </div>
              {passwordToShow && (
                <button
                  type="button"
                  onClick={() => void copyValue("both", `یوزرنیم: ${picked.username}\nرمز عبور: ${passwordToShow}`)}
                  className="w-full rounded-lg border border-border bg-background py-1.5 text-[11px] font-medium hover:bg-accent"
                >
                  {copied === "both" ? "کپی شد" : "کپی یوزرنیم و رمز"}
                </button>
              )}
              {!shownPwd && (
                <p className="text-[11px] leading-5 text-muted-foreground">
                  رمز قبلی ذخیره نمی‌شود. یک رمز جدید بگذارید تا بتوانید آن را ببینید و پیامک کنید.
                </p>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  dir="ltr"
                  placeholder="رمز جدید (حداقل ۶ کاراکتر)"
                  className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setNewPwd(generateSimplePassword())}
                  className="shrink-0 rounded-xl border border-border px-2.5 text-[11px] hover:bg-accent"
                >
                  تولید
                </button>
              </div>
              <button
                type="button"
                disabled={busy || newPwd.length < 6}
                onClick={() => void applyPassword()}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                اعمال رمز و نمایش
              </button>
              {passwordToShow && (
                <button
                  type="button"
                  onClick={() => setSmsOpen(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 py-2 text-xs font-semibold text-primary hover:bg-primary/5"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  پیامک نیمه‌دستی یوزرنیم و رمز
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void markDone()}
            className="w-full rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-60"
          >
            {busy ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : "انجام شد"}
          </button>
        </div>
      )}

      {smsOpen && picked && passwordToShow && (
        <MessageUserModal
          user={picked}
          phone={smsPhone}
          password={passwordToShow}
          defaultTemplate="password_reset"
          onClose={() => setSmsOpen(false)}
        />
      )}
    </li>
  );
}

