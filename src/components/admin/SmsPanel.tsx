/**
 * تب «پیامک» در پنل ادمین.
 * مدیر می‌تواند یک متن دلخواه به یک کاربر، چند کاربر یا همه‌ی کاربران فعال بفرستد،
 * و همچنین یادآوری انقضای اشتراک را دستی اجرا کند.
 *
 * دسترسی: این کامپوننت فقط داخل /admin رندر می‌شود که با <AuthGuard adminOnly>
 * محافظت شده، و خود server function ها هم دوباره assertAdmin می‌کنند.
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { UserProfile } from "@/lib/supabase";
import { adminSendCustomSms, adminRunExpiryReminders } from "@/lib/sms.functions";
import { MESSAGE_TEMPLATES, type MessageTemplateId } from "@/lib/sms-templates";
import { Loader2, Send, Search, MessageSquare, BellRing, CheckCircle2, AlertTriangle, Phone } from "lucide-react";

// برای ارسال گروهی، قالب‌هایی که نیاز به رمز عبور شخصی هر کاربر دارند (خوش‌آمدگویی)
// معنا ندارند — چون یک متن یکسان برای همه گیرنده‌ها فرستاده می‌شود. فقط قالب‌های عمومی نمایش داده می‌شوند.
const BULK_TEMPLATES = MESSAGE_TEMPLATES.filter((t) => !t.needsPassword);

const SMS_MAX_LEN = 280;
/** هر پیامک فارسی (UCS-2) ۷۰ کاراکتر است. */
const PER_PART = 70;

export function SmsPanel({ users, phones }: { users: UserProfile[]; phones: Record<string, string | null> }) {
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState<MessageTemplateId | "">("");
  const [includeLink, setIncludeLink] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const send = useServerFn(adminSendCustomSms);
  const runReminders = useServerFn(adminRunExpiryReminders);

  const activeUsers = useMemo(() => users.filter((u) => u.status === "active"), [users]);
  const withPhone = useMemo(
    () => activeUsers.filter((u) => !!phones[u.username?.toLowerCase()]),
    [activeUsers, phones],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeUsers;
    return activeUsers.filter((u) =>
      [u.username, u.first_name, u.last_name].some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [activeUsers, query]);

  const parts = text.length ? Math.ceil(text.length / PER_PART) : 0;
  const tooLong = text.length > SMS_MAX_LEN;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () => setSelected(new Set(activeUsers.map((u) => u.id)));
  const clearAll = () => setSelected(new Set());

  const handleSend = async () => {
    setMsg(null);
    const body = text.trim();
    if (!body) return setMsg({ type: "err", text: "متن پیامک نمی‌تواند خالی باشد." });
    if (tooLong) return setMsg({ type: "err", text: `متن پیامک نباید بیشتر از ${SMS_MAX_LEN} کاراکتر باشد.` });
    if (!selected.size) return setMsg({ type: "err", text: "حداقل یک گیرنده انتخاب کنید." });
    if (!confirm(`پیامک به ${selected.size} کاربر ارسال شود؟`)) return;

    setSending(true);
    try {
      const res = await send({ data: { user_ids: [...selected], text: body } });
      const extra = [
        res.failed ? `${res.failed} ناموفق` : null,
        res.no_phone ? `${res.no_phone} بدون شماره` : null,
        res.not_active ? `${res.not_active} غیرفعال` : null,
      ].filter(Boolean).join(" — ");
      setMsg({
        type: res.ok ? "ok" : "err",
        text: `ارسال شد به ${res.sent} شماره${extra ? ` (${extra})` : ""}${res.error ? ` — ${res.error}` : ""}`,
      });
      if (res.ok) setText("");
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "ارسال پیامک ناموفق بود." });
    }
    setSending(false);
  };

  const handleReminders = async () => {
    setMsg(null);
    setReminding(true);
    try {
      const r = await runReminders();
      setMsg({
        type: "ok",
        text: `یادآوری اجرا شد — ${r.sent} ارسال، ${r.failed} ناموفق، ${r.skipped} رد شده (از ${r.checked} کاربر بررسی‌شده).`,
      });
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message || "اجرای یادآوری ناموفق بود." });
    }
    setReminding(false);
  };

  return (
    <div className="space-y-4">
      {/* متن پیامک */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-primary" />
          پیامک دلخواه
        </div>

        <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">دسته پیام آماده (اختیاری)</label>
        <select
          value={templateId}
          onChange={(e) => {
            const id = e.target.value as MessageTemplateId | "";
            setTemplateId(id);
            if (id) {
              const tpl = BULK_TEMPLATES.find((t) => t.id === id);
              if (tpl) setText(tpl.build({ name: "مشتری گرامی", includeLink }));
            }
          }}
          className="mb-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        >
          <option value="">— انتخاب از قالب‌های آماده —</option>
          {BULK_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>

        {templateId && BULK_TEMPLATES.find((t) => t.id === templateId)?.hasLink && (
          <label className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={includeLink}
              onChange={(e) => {
                setIncludeLink(e.target.checked);
                const tpl = BULK_TEMPLATES.find((t) => t.id === templateId);
                if (tpl) setText(tpl.build({ name: "مشتری گرامی", includeLink: e.target.checked }));
              }}
              className="h-4 w-4 rounded border-input"
            />
            لینک در متن پیام درج شود
          </label>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="متن پیامک را بنویسید، یا از قالب آماده بالا انتخاب کنید…"
          className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <div className="mt-1.5 flex items-center justify-between text-[11px]">
          <span className={tooLong ? "text-destructive" : "text-muted-foreground"}>
            {text.length} / {SMS_MAX_LEN} کاراکتر
          </span>
          <span className="text-muted-foreground">{parts ? `${parts} پیامک` : ""}</span>
        </div>

        <button
          onClick={handleSend}
          disabled={sending || !selected.size || !text.trim() || tooLong}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          ارسال به {selected.size} کاربر
        </button>

        {msg && (
          <div
            className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
              msg.type === "ok" ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-destructive/10 text-destructive"
            }`}
          >
            {msg.type === "ok" ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>{msg.text}</span>
          </div>
        )}
      </div>

      {/* انتخاب گیرندگان */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">گیرندگان ({activeUsers.length} کاربر فعال)</div>
          <div className="flex gap-1.5">
            <button
              onClick={selectAll}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              انتخاب همه
            </button>
            <button
              onClick={clearAll}
              className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              پاک کردن
            </button>
          </div>
        </div>

        <div className="relative mb-3">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجوی کاربر…"
            className="w-full rounded-xl border border-input bg-background py-2.5 pl-3 pr-9 text-sm outline-none focus:border-primary"
          />
        </div>

        {withPhone.length < activeUsers.length && (
          <div className="mb-3 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            {activeUsers.length - withPhone.length} کاربر فعال شماره موبایل ثبت‌شده ندارند و پیامک دریافت نمی‌کنند.
          </div>
        )}

        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
            کاربری یافت نشد.
          </div>
        ) : (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {visible.map((u) => {
              const phone = phones[u.username?.toLowerCase()];
              return (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2.5 hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={() => toggle(u.id)}
                      className="h-4 w-4 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {u.first_name} {u.last_name}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span dir="ltr">@{u.username}</span>
                        {phone ? (
                          <span dir="ltr" className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {phone}
                          </span>
                        ) : (
                          <span className="text-amber-600">بدون شماره</span>
                        )}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* یادآوری انقضا */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
          <BellRing className="h-4 w-4 text-primary" />
          یادآوری انقضای اشتراک
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          به‌صورت خودکار روزی یک بار اجرا می‌شود. برای هر دوره‌ی انقضا فقط یک پیامک فرستاده می‌شود.
        </p>
        <button
          onClick={handleReminders}
          disabled={reminding}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
        >
          {reminding ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
          اجرای دستی یادآوری‌ها
        </button>
      </div>
    </div>
  );
}
