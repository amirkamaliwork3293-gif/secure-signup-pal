import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  customers,
  customerBalance,
  customerFullName,
  invoicesOfCustomer,
  formatToman,
  formatNumber,
  parseNumberInput,
  cryptoId,
  settings,
  storePublicUrl,
  formatJalaliDateTime,
  invoice,
  products,
  recalc,
  emptyInvoice,
  addProductToInvoice,
  applyProductDiscount,
  PAYMENT_LABEL,
  isWeightUnit,
  toJalaliInputDate,
  formatJalaliYmd,
  jalaliDaysFromToday,
  settlementAlertKind,
  type Customer,
  type CustomerTx,
  type Product,
  type PaymentMethod,
} from "@/lib/store";
import { useAuth } from "@/lib/AuthContext";
import { authUserId } from "@/lib/subscription-access";
import { useSubscriptionAccess } from "@/components/SubscriptionAccess";
import { requireOnlineWrite } from "@/lib/online-status";
import { invoiceTotals } from "@/lib/invoice-math";
import { filterAndRankSearch, personNameSearchFields } from "@/lib/search";
import { openExternal, shareText, toIntlPhone, telHref } from "@/lib/openExternal";
import { isWebView } from "@/lib/isWebView";
import { JalaliDateSelect } from "@/components/JalaliPickers";
import { DebtContactDialog } from "@/components/DebtContactDialog";
import { InvoiceActions } from "@/components/InvoiceActions";
import { QuantityStepper } from "@/components/QuantityStepper";
import {
  Users,
  Plus,
  X,
  Search,
  Phone,
  Trash2,
  Pencil,
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
  Wallet,
  MessageCircle,
  Send,
  Megaphone,
  Check,
  Link2,
  Share2,
  Receipt,
  Package,
  NotebookPen,
  Contact,
  FileUp,
  ShoppingCart,
  CalendarClock,
} from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/customers")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "مشتریان و بدهکاران | KAMIX" },
      { name: "description", content: "مدیریت حساب مشتریان، بدهی‌ها و پرداخت‌ها." },
    ],
  }),
  component: CustomersPage,
});

type Filter = "all" | "debtor" | "creditor" | "settled";

/** نمایش‌های تحلیلی کنار جستجو */
type SortBy = "default" | "topBuyer" | "lowBuyer" | "mostInvoices" | "recent" | "stale" | "newest";

const SORT_LABEL: Record<SortBy, string> = {
  default: "نمایش پیش‌فرض",
  topBuyer: "پرخریدترین مشتری‌ها",
  lowBuyer: "کم‌خریدترین مشتری‌ها",
  mostInvoices: "بیشترین تعداد فاکتور",
  recent: "تازه‌ترین خرید",
  stale: "قدیمی‌ترین خرید (بی‌تحرک)",
  newest: "تازه‌ترین مشتری‌ها",
};

const inputCls =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

function CustomersPageInner() {
  const { q: incomingQuery } = Route.useSearch();
  const [list, setList] = customers.useAll();
  const [searchQ, setSearchQ] = useState(incomingQuery ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [txTarget, setTxTarget] = useState<{ customer: Customer; type: "debt" | "payment" } | null>(
    null,
  );
  const [reminderTarget, setReminderTarget] = useState<Customer | null>(null);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showDebtFollowup, setShowDebtFollowup] = useState(false);
  const [detailTarget, setDetailTarget] = useState<Customer | null>(null);
  const [invoiceTarget, setInvoiceTarget] = useState<Customer | null>(null);
  const [contactsBusy, setContactsBusy] = useState(false);
  const [contactsMsg, setContactsMsg] = useState<string | null>(null);
  // ثبت سریع: "debt" = مشتری به ما بدهکار شد (طلب ما)، "payment" = ما به مشتری بدهکاریم (طلب مشتری)
  const [quickEntry, setQuickEntry] = useState<"debt" | "payment" | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);

  useEffect(() => {
    if (incomingQuery != null) setSearchQ(incomingQuery);
  }, [incomingQuery]);

  const [history] = invoice.useHistory();

  /** آمار خرید هر مشتری از روی فاکتورهای آرشیوشده */
  const buyStats = useMemo(() => {
    const m = new Map<string, { total: number; count: number; lastAt: number }>();
    for (const c of list) {
      const invs = invoicesOfCustomer(c, history);
      m.set(c.id, {
        total: invs.reduce((s, i) => s + (i.total || 0), 0),
        count: invs.length,
        lastAt: invs.reduce((s, i) => Math.max(s, i.createdAt), 0),
      });
    }
    return m;
  }, [list, history]);

  const totals = useMemo(() => {
    let receivable = 0; // مجموع طلب ما از بدهکارها
    let debtors = 0;
    let payable = 0; // مجموع طلب مشتریان از ما (طلبکاران)
    let creditors = 0;
    for (const c of list) {
      const b = customerBalance(c);
      if (b > 0) {
        receivable += b;
        debtors++;
      } else if (b < 0) {
        payable += -b;
        creditors++;
      }
    }
    return { receivable, debtors, payable, creditors };
  }, [list]);

  const filtered = useMemo(() => {
    const q = searchQ.trim();
    const statusFiltered = list
      .filter((c) => {
        const b = customerBalance(c);
        if (filter === "debtor") return b > 0;
        if (filter === "creditor") return b < 0;
        if (filter === "settled") return b === 0;
        return true;
      })
      .sort((a, b) => customerBalance(b) - customerBalance(a));
    return q
      ? filterAndRankSearch(statusFiltered, q, (c) => [...personNameSearchFields(c), c.phone])
      : statusFiltered;
  }, [list, searchQ, filter]);

  /** اعمال نمایش انتخابی (پرخریدترین، کم‌خریدترین و…) */
  const ordered = useMemo(() => {
    if (sortBy === "default") return filtered;
    const st = (c: Customer) => buyStats.get(c.id) ?? { total: 0, count: 0, lastAt: 0 };
    const arr = [...filtered];
    switch (sortBy) {
      case "topBuyer":
        return arr.sort((a, b) => st(b).total - st(a).total);
      case "lowBuyer":
        return arr.sort((a, b) => st(a).total - st(b).total);
      case "mostInvoices":
        return arr.sort((a, b) => st(b).count - st(a).count);
      case "recent":
        return arr.sort((a, b) => st(b).lastAt - st(a).lastAt);
      case "stale":
        return arr.sort((a, b) => st(a).lastAt - st(b).lastAt);
      case "newest":
        return arr.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      default:
        return arr;
    }
  }, [filtered, sortBy, buyStats]);

  // در حالت «همه» (بدون جستجو) فهرست به سه گروه مجزا تقسیم می‌شود تا طلب و بدهی قاطی نشوند
  const grouped = useMemo(() => {
    if (filter !== "all" || searchQ.trim() || sortBy !== "default") return null;
    const debtors: Customer[] = [];
    const creditors: Customer[] = [];
    const settled: Customer[] = [];
    for (const c of filtered) {
      const b = customerBalance(c);
      (b > 0 ? debtors : b < 0 ? creditors : settled).push(c);
    }
    // طلبکاران: بزرگ‌ترین بدهی ما اول
    creditors.sort((a, b) => customerBalance(a) - customerBalance(b));
    return { debtors, creditors, settled };
  }, [filtered, filter, searchQ, sortBy]);

  const removeCustomer = (c: Customer) => {
    if (!confirm(`حساب «${customerFullName(c)}» حذف شود؟ تمام سوابق بدهی و پرداخت پاک می‌شود.`))
      return;
    customers.remove(c.id);
  };

  // افزودن مشتری از مخاطبین گوشی. توجه: Contact Picker API فقط در مرورگر (عمدتاً
  // کروم اندروید) پشتیبانی می‌شود و داخل اپلیکیشن اندروید (WebView) در دسترس
  // نیست چون آن یک قابلیت مرورگری است، نه یک API عمومی اندروید — برای در دسترس
  // بودنش داخل اپ باید یک پلاگین Capacitor به پروژه‌ی native اضافه شود (خارج از
  // این ریپوی وب). به‌جای آن، وقتی API مرورگری در دسترس نباشد، به‌طور خودکار به
  // «وارد کردن فایل مخاطبین (VCF)» سوییچ می‌کنیم — راهی که همه‌جا (وب و اپ) کار
  // می‌کند، چون فقط یک فایل معمولی می‌خواند.
  const vcfInputRef = useRef<HTMLInputElement>(null);

  const importFromContacts = async () => {
    setContactsMsg(null);

    // داخل اپلیکیشن اندروید: چون هیچ‌کدام از مسیرهای مرورگری (Contact Picker
    // API / انتخاب فایل VCF) به‌طور کاملاً قابل‌اعتماد در WebView کار نمی‌کنند،
    // به‌جای تلاش و نمایش خطاهای گیج‌کننده، مستقیم کاربر را به نسخه‌ی وب/سایت
    // ارجاع می‌دهیم؛ آنجا این قابلیت با مرورگر واقعی بدون مشکل کار می‌کند.
    if (isWebView()) {
      setContactsMsg(
        "افزودن مستقیم از مخاطبین گوشی در نسخه‌ی اپلیکیشن در دسترس نیست. لطفاً از طریق مرورگر (سایت) وارد حساب‌تان شوید و از همان‌جا مخاطبین را اضافه کنید.",
      );
      return;
    }

    const nav = navigator as Navigator & {
      contacts?: {
        select: (
          props: string[],
          opts?: { multiple?: boolean },
        ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
      };
    };
    if (!nav.contacts || typeof nav.contacts.select !== "function") {
      setContactsMsg(
        "انتخاب مستقیم مخاطبین در این نسخه پشتیبانی نمی‌شود — در عوض فایل مخاطبین (VCF) را انتخاب کنید. (در اپ مخاطبین گوشی: مخاطبین موردنظر ← اشتراک‌گذاری/Export ← ذخیره به‌عنوان VCF/vCard)",
      );
      vcfInputRef.current?.click();
      return;
    }
    try {
      setContactsBusy(true);
      const picked = await nav.contacts.select(["name", "tel"], { multiple: true });
      let added = 0;
      for (const person of picked) {
        const fullName = (person.name?.[0] ?? "").trim();
        const phone = (person.tel?.[0] ?? "").trim();
        if (!fullName && !phone) continue;
        const [firstName, ...rest] = fullName ? fullName.split(/\s+/) : ["مخاطب"];
        const existing = customers.findOrCreate({
          firstName: firstName || "مخاطب",
          lastName: rest.join(" ") || undefined,
          phone: phone || undefined,
        });
        if (existing) added++;
      }
      setContactsMsg(
        added > 0
          ? `${added.toLocaleString("fa-IR")} مخاطب به مشتریان اضافه/همگام‌سازی شد.`
          : "مخاطبی انتخاب نشد.",
      );
    } catch (e) {
      // کاربر انتخاب را لغو کرده — نیازی به پیام خطا نیست
      if (e instanceof DOMException && e.name === "AbortError") {
        // silent
      } else {
        // نکته‌ی مهم: داخل WebView اپ اندروید، navigator.contacts.select ممکن است
        // به‌عنوان تابع «وجود داشته باشد» (تشخیص بالا رد می‌شود) اما در لحظه‌ی
        // اجرا واقعاً پیاده‌سازی/پنجره‌ی انتخاب مخاطب نداشته باشد و خطا بدهد —
        // این دقیقاً همان چیزی است که باعث می‌شد کاربر با پیام بن‌بست «دسترسی
        // ممکن نشد» بماند. به‌جای آن، مثل حالت «اصلاً پشتیبانی نمی‌شود»، به
        // انتخاب فایل VCF (که در وب و اپ هر دو کار می‌کند) سوییچ می‌کنیم.
        setContactsMsg(
          "انتخاب مستقیم مخاطبین در این دستگاه/اپلیکیشن ممکن نشد — در عوض فایل مخاطبین (VCF) را انتخاب کنید. (در اپ مخاطبین گوشی: مخاطبین موردنظر ← اشتراک‌گذاری/Export ← ذخیره به‌عنوان VCF/vCard)",
        );
        vcfInputRef.current?.click();
      }
    } finally {
      setContactsBusy(false);
    }
  };

  // پارس ساده‌ی فایل VCF/vCard (خروجی استاندارد اپ مخاطبین اندروید/آیفون/جیمیل)
  const parseVCards = (text: string): Array<{ name: string; phone?: string }> => {
    const cards = text.split(/BEGIN:VCARD/i).slice(1);
    const results: Array<{ name: string; phone?: string }> = [];
    for (const raw of cards) {
      const block = raw.split(/END:VCARD/i)[0];
      // خطوط تاشده (که با فاصله/تب شروع می‌شوند) را به خط قبلی می‌چسبانیم
      const unfolded = block.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
      const lines = unfolded.split(/\r\n|\n/);
      let fn = "";
      let n = "";
      let tel = "";
      for (const line of lines) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const key = line.slice(0, idx).split(";")[0].toUpperCase();
        const value = line.slice(idx + 1).trim();
        if (key === "FN" && !fn) fn = value;
        else if (key === "N" && !n) n = value;
        else if (key === "TEL" && !tel) tel = value.replace(/[^\d+]/g, "");
      }
      let name = fn;
      if (!name && n) {
        const parts = n.split(";").filter(Boolean);
        name = [parts[1], parts[0]].filter(Boolean).join(" ");
      }
      if (name || tel) results.push({ name: name || "مخاطب", phone: tel || undefined });
    }
    return results;
  };

  const handleVcfFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setContactsMsg(null);
    setContactsBusy(true);
    try {
      let added = 0;
      for (const file of Array.from(files)) {
        const text = await file.text();
        const people = parseVCards(text);
        for (const person of people) {
          const [firstName, ...rest] = person.name.split(/\s+/);
          const existing = customers.findOrCreate({
            firstName: firstName || "مخاطب",
            lastName: rest.join(" ") || undefined,
            phone: person.phone || undefined,
          });
          if (existing) added++;
        }
      }
      setContactsMsg(
        added > 0
          ? `${added.toLocaleString("fa-IR")} مخاطب از فایل VCF اضافه/همگام‌سازی شد.`
          : "مخاطب معتبری در فایل انتخاب‌شده پیدا نشد.",
      );
    } catch {
      setContactsMsg("خواندن فایل VCF ممکن نشد. مطمئن شوید فایل خروجی استاندارد vCard است.");
    } finally {
      setContactsBusy(false);
      if (vcfInputRef.current) vcfInputRef.current.value = "";
    }
  };

  const renderCards = (items: Customer[]) => (
    <ul className="space-y-2">
      {items.map((c) => (
        <CustomerCard
          key={c.id}
          customer={c}
          onOpenDetail={() => setDetailTarget(c)}
          onDebt={() => setTxTarget({ customer: c, type: "debt" })}
          onPayment={() => setTxTarget({ customer: c, type: "payment" })}
          onEdit={() => setEditTarget(c)}
          onDelete={() => removeCustomer(c)}
          onRemind={() => setReminderTarget(c)}
        />
      ))}
    </ul>
  );

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <Users className="h-5 w-5 text-primary" />
            مشتریان و بدهکاران
          </h1>
          <p className="text-xs text-muted-foreground">{formatNumber(list.length)} مشتری ثبت شده</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={importFromContacts}
            disabled={contactsBusy}
            className="inline-flex items-center gap-1 rounded-xl border border-dashed border-primary/50 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            <Contact className="h-3.5 w-3.5" />
            {contactsBusy ? "در حال دریافت..." : "از مخاطبین"}
          </button>
          <button
            onClick={() => vcfInputRef.current?.click()}
            disabled={contactsBusy}
            title="وارد کردن فایل مخاطبین VCF/vCard"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-dashed border-primary/50 text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            <FileUp className="h-3.5 w-3.5" />
          </button>
          <input
            ref={vcfInputRef}
            type="file"
            accept=".vcf,text/vcard,text/x-vcard"
            multiple
            className="hidden"
            onChange={(e) => handleVcfFiles(e.target.files)}
          />
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-elegant"
          >
            <Plus className="h-3.5 w-3.5" />
            مشتری جدید
          </button>
          {list.length > 0 && (
            <button
              onClick={() => setShowDeleteAll(true)}
              title="حذف همه مشتریان"
              aria-label="حذف همه مشتریان"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {showDeleteAll && (
        <DeleteAllCustomersDialog
          count={list.length}
          onCancel={() => setShowDeleteAll(false)}
          onConfirm={() => {
            customers.removeAll();
            setShowDeleteAll(false);
            setDetailTarget(null);
            setEditTarget(null);
            setTxTarget(null);
          }}
        />
      )}

      {contactsMsg && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          <span>{contactsMsg}</span>
          <button
            onClick={() => setContactsMsg(null)}
            className="shrink-0 text-primary/70 hover:text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* پنل پیامکی — ارسال گروهی */}
      <button
        onClick={() => setShowCampaign(true)}
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/10"
      >
        <Megaphone className="h-4 w-4" />
        پنل پیامکی — ارسال جشنواره / تخفیف / تبلیغ
      </button>

      {/* پیگیری نیمه‌دستی بدهکاران — پیامک آماده + تماس */}
      {totals.debtors > 0 && (
        <button
          onClick={() => setShowDebtFollowup(true)}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-destructive/40 bg-destructive/5 px-4 py-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
        >
          <Send className="h-4 w-4" />
          پیگیری بدهکاران — پیامک آماده و تماس ({formatNumber(totals.debtors)} نفر)
        </button>
      )}

      {/* دو بخش کاملاً مجزا: «طلب شما» و «بدهی شما» — هر کدام با دکمه ثبت مخصوص خودش */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* طلب شما — مشتریانی که به شما بدهکارند */}
        <section
          className={`overflow-hidden rounded-2xl bg-gradient-primary text-primary-foreground shadow-elegant transition ${
            filter === "debtor" ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => setFilter((f) => (f === "debtor" ? "all" : "debtor"))}
            className="block w-full p-4 text-right"
            title={filter === "debtor" ? "نمایش همه" : "فقط نمایش بدهکاران"}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold">طلب شما</div>
                <div className="text-[10px] opacity-80">مشتریانی که به شما بدهکارند</div>
                <div className="mt-1 text-xl font-bold">{formatToman(totals.receivable)}</div>
                <div className="mt-0.5 text-[11px] opacity-80">
                  {formatNumber(totals.debtors)} بدهکار · برای فیلتر لمس کنید
                </div>
              </div>
              <Wallet className="h-9 w-9 opacity-80" />
            </div>
          </button>
          <button
            type="button"
            onClick={() => setQuickEntry("debt")}
            className="flex w-full items-center justify-center gap-1.5 bg-background/15 px-3 py-2.5 text-xs font-bold backdrop-blur transition hover:bg-background/25"
          >
            <Plus className="h-4 w-4" />
            ثبت طلب جدید (مشتری بدهکار شد)
          </button>
        </section>

        {/* بدهی شما — مشتریانی که از شما طلب دارند */}
        <section
          className={`overflow-hidden rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-800 shadow-card transition dark:text-sky-300 ${
            filter === "creditor" ? "ring-2 ring-sky-500 ring-offset-2 ring-offset-background" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => setFilter((f) => (f === "creditor" ? "all" : "creditor"))}
            className="block w-full p-4 text-right"
            title={filter === "creditor" ? "نمایش همه" : "فقط نمایش طلبکاران"}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold">بدهی شما</div>
                <div className="text-[10px] opacity-80">مشتریانی که از شما طلب دارند</div>
                <div className="mt-1 text-xl font-bold">{formatToman(totals.payable)}</div>
                <div className="mt-0.5 text-[11px] opacity-80">
                  {formatNumber(totals.creditors)} طلبکار · برای فیلتر لمس کنید
                </div>
              </div>
              <ArrowDownCircle className="h-9 w-9 opacity-80" />
            </div>
          </button>
          <button
            type="button"
            onClick={() => setQuickEntry("payment")}
            className="flex w-full items-center justify-center gap-1.5 bg-sky-500/20 px-3 py-2.5 text-xs font-bold transition hover:bg-sky-500/30"
          >
            <Plus className="h-4 w-4" />
            ثبت بدهی جدید (شما بدهکار شدید)
          </button>
        </section>
      </div>

      {/* جستجو و فیلتر */}
      <div className="mb-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="جستجوی نام یا تلفن..."
              className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            title="نحوه نمایش مشتریان"
            className={`w-40 shrink-0 rounded-xl border bg-background px-2 py-2 text-xs outline-none focus:border-primary ${
              sortBy === "default"
                ? "border-input text-muted-foreground"
                : "border-primary text-primary"
            }`}
          >
            {(Object.keys(SORT_LABEL) as SortBy[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              { v: "all", l: "همه" },
              { v: "debtor", l: "بدهکاران" },
              { v: "creditor", l: "طلبکاران" },
              { v: "settled", l: "تسویه" },
            ] as { v: Filter; l: string }[]
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setFilter(o.v)}
              className={`rounded-xl border px-2 py-1.5 text-xs font-medium transition ${
                filter === o.v
                  ? o.v === "creditor"
                    ? "border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                    : o.v === "debtor"
                      ? "border-destructive bg-destructive/10 text-destructive"
                      : "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-accent"
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {sortBy !== "default" && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          نمایش بر اساس «{SORT_LABEL[sortBy]}» — مبلغ خرید هر مشتری از روی فاکتورهای ثبت‌شده محاسبه
          می‌شود.
        </p>
      )}

      {ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <Users className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {list.length === 0
              ? "هنوز مشتری‌ای ثبت نکرده‌اید. فاکتورهای نسیه به‌صورت خودکار اینجا ثبت می‌شوند."
              : "مشتری‌ای با این مشخصات یافت نشد."}
          </p>
        </div>
      ) : grouped ? (
        <div className="space-y-5">
          {grouped.debtors.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-destructive">
                <ArrowUpCircle className="h-4 w-4" />
                به شما بدهکارند — طلب شما ({formatNumber(grouped.debtors.length)})
              </h2>
              {renderCards(grouped.debtors)}
            </section>
          )}
          {grouped.creditors.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-sky-700 dark:text-sky-400">
                <ArrowDownCircle className="h-4 w-4" />
                از شما طلب دارند — بدهی شما ({formatNumber(grouped.creditors.length)})
              </h2>
              {renderCards(grouped.creditors)}
            </section>
          )}
          {grouped.settled.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <Check className="h-4 w-4" />
                تسویه‌شده ({formatNumber(grouped.settled.length)})
              </h2>
              {renderCards(grouped.settled)}
            </section>
          )}
        </div>
      ) : (
        renderCards(ordered)
      )}

      {showAdd && (
        <CustomerModal
          onClose={() => setShowAdd(false)}
          onSave={(c) => {
            setList([{ ...c, id: cryptoId(), createdAt: Date.now(), txs: [] }, ...list]);
            setShowAdd(false);
          }}
        />
      )}

      {editTarget && (
        <CustomerModal
          initial={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={(c) => {
            customers.update({ ...editTarget, ...c });
            setEditTarget(null);
          }}
        />
      )}

      {txTarget && (
        <TxModal
          customer={txTarget.customer}
          type={txTarget.type}
          onClose={() => setTxTarget(null)}
        />
      )}

      {quickEntry && (
        <QuickEntryModal type={quickEntry} list={list} onClose={() => setQuickEntry(null)} />
      )}

      {reminderTarget && (
        <DebtContactDialog customer={reminderTarget} onClose={() => setReminderTarget(null)} />
      )}

      {showCampaign && <SmsCampaignModal customers={list} onClose={() => setShowCampaign(false)} />}

      {showDebtFollowup && (
        <DebtFollowupModal
          customers={list}
          onClose={() => setShowDebtFollowup(false)}
          onRemind={(c) => {
            setShowDebtFollowup(false);
            setReminderTarget(c);
          }}
        />
      )}

      {detailTarget && (
        <CustomerDetailModal
          customer={list.find((c) => c.id === detailTarget.id) ?? detailTarget}
          onClose={() => setDetailTarget(null)}
          onDebt={() => {
            setTxTarget({ customer: detailTarget, type: "debt" });
            setDetailTarget(null);
          }}
          onPayment={() => {
            setTxTarget({ customer: detailTarget, type: "payment" });
            setDetailTarget(null);
          }}
          onEdit={() => {
            setEditTarget(detailTarget);
            setDetailTarget(null);
          }}
          onDelete={() => {
            removeCustomer(detailTarget);
            setDetailTarget(null);
          }}
          onRemind={() => {
            setReminderTarget(detailTarget);
            setDetailTarget(null);
          }}
          onNewInvoice={() => {
            setInvoiceTarget(detailTarget);
            setDetailTarget(null);
          }}
        />
      )}

      {invoiceTarget && (
        <CustomerInvoiceModal customer={invoiceTarget} onClose={() => setInvoiceTarget(null)} />
      )}
    </Layout>
  );
}

// ─── کارت مشتری ──────────────────────────────────────────────────────────────

function CustomerCard({
  customer,
  onOpenDetail,
  onRemind,
}: {
  customer: Customer;
  onOpenDetail: () => void;
  onDebt: () => void;
  onPayment: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemind: () => void;
}) {
  const balance = customerBalance(customer);
  const dueKind = settlementAlertKind(customer);
  const daysToDue = jalaliDaysFromToday(customer.settlementDate);
  const canContact = !!customer.phone?.trim();

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <button
        onClick={onOpenDetail}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right active:bg-accent"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate font-medium">{customerFullName(customer)}</span>
            {balance > 0 ? (
              <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                بدهکار
              </span>
            ) : balance < 0 ? (
              <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-400">
                طلبکار
              </span>
            ) : (
              <span className="rounded-md bg-green-500/10 px-1.5 py-0.5 text-[10px] font-bold text-green-600">
                تسویه
              </span>
            )}
            {dueKind && (
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                  dueKind === "overdue"
                    ? "bg-destructive text-destructive-foreground"
                    : dueKind === "today"
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                      : "bg-primary/10 text-primary"
                }`}
              >
                {dueKind === "overdue"
                  ? "موعد گذشته"
                  : dueKind === "today"
                    ? "موعد امروز"
                    : "موعد فردا"}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span
              className={`font-semibold ${
                balance > 0
                  ? "text-destructive"
                  : balance < 0
                    ? "text-sky-700 dark:text-sky-400"
                    : "text-green-600"
              }`}
            >
              {balance > 0
                ? `بدهی: ${formatToman(balance)}`
                : balance < 0
                  ? `طلب مشتری: ${formatToman(-balance)}`
                  : "بدون بدهی"}
            </span>
            {customer.phone && (
              <span className="flex items-center gap-1" dir="ltr">
                <Phone className="h-3 w-3" />
                {customer.phone}
              </span>
            )}
            {customer.settlementDate && balance > 0 && (
              <span className="flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                تسویه {formatJalaliYmd(customer.settlementDate)}
                {daysToDue != null && daysToDue > 1 ? ` (${formatNumber(daysToDue)} روز)` : ""}
              </span>
            )}
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 -rotate-90 text-muted-foreground" />
      </button>
      {balance > 0 && (
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border">
          <button
            type="button"
            onClick={onRemind}
            className="inline-flex items-center justify-center gap-1.5 bg-card px-3 py-2 text-[11px] font-semibold text-primary hover:bg-primary/5"
          >
            <Send className="h-3.5 w-3.5" />
            پیامک بدهی
          </button>
          <button
            type="button"
            disabled={!canContact}
            onClick={() => {
              const href = telHref(customer.phone || "");
              if (href) openExternal(href);
            }}
            className="inline-flex items-center justify-center gap-1.5 bg-card px-3 py-2 text-[11px] font-semibold text-sky-700 hover:bg-sky-500/10 disabled:opacity-40 dark:text-sky-400"
          >
            <Phone className="h-3.5 w-3.5" />
            تماس
          </button>
        </div>
      )}
    </li>
  );
}

function TxRow({ tx, customer }: { tx: CustomerTx; customer: Customer }) {
  const isDebt = tx.type === "debt";
  const removeTx = () => {
    if (!confirm("این تراکنش حذف شود؟")) return;
    customers.update({ ...customer, txs: customer.txs.filter((t) => t.id !== tx.id) });
  };
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs">
      {isDebt ? (
        <ArrowUpCircle className="h-4 w-4 shrink-0 text-destructive" />
      ) : (
        <ArrowDownCircle className="h-4 w-4 shrink-0 text-green-600" />
      )}
      <div className="min-w-0 flex-1">
        <div className={`font-semibold ${isDebt ? "text-destructive" : "text-green-600"}`}>
          {isDebt ? "بدهی" : "پرداخت"} — {formatToman(tx.amount)}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatJalaliDateTime(tx.at)}
          {tx.note && ` · ${tx.note}`}
        </div>
      </div>
      <button
        onClick={removeTx}
        className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// ─── مودال مشتری ─────────────────────────────────────────────────────────────

function CustomerModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: Customer;
  onClose: () => void;
  onSave: (
    c: Pick<Customer, "firstName" | "lastName" | "phone" | "note" | "settlementDate">,
  ) => void;
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [hasSettlement, setHasSettlement] = useState(!!initial?.settlementDate);
  const [settlementDate, setSettlementDate] = useState(
    initial?.settlementDate || toJalaliInputDate(Date.now()),
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) {
      alert("نام مشتری الزامی است.");
      return;
    }
    onSave({
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      phone: phone.trim() || undefined,
      note: note.trim() || undefined,
      settlementDate: hasSettlement ? settlementDate : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">{initial ? "ویرایش مشتری" : "مشتری جدید"}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="نام *"
              className={inputCls}
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="نام خانوادگی"
              className={inputCls}
            />
          </div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="شماره تلفن"
            inputMode="tel"
            dir="ltr"
            className={inputCls}
          />
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="یادداشت (اختیاری)"
            className={`${inputCls} resize-none`}
          />
          <div className="rounded-xl border border-border bg-background p-3">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={hasSettlement}
                onChange={(e) => setHasSettlement(e.target.checked)}
                className="h-4 w-4"
              />
              <CalendarClock className="h-3.5 w-3.5 text-primary" />
              تاریخ تسویه (اختیاری)
            </label>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              اگر مشخص شود، یک روز قبل و در همان روز یک پاپ‌آپ یادآوری با پیامک و تماس باز می‌شود.
            </p>
            {hasSettlement && (
              <div className="mt-2">
                <JalaliDateSelect
                  value={settlementDate}
                  onChange={setSettlementDate}
                  yearsBack={1}
                  yearsForward={2}
                />
              </div>
            )}
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            ذخیره
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── مودال ثبت بدهی / پرداخت ────────────────────────────────────────────────

function TxModal({
  customer,
  type,
  onClose,
}: {
  customer: Customer;
  type: "debt" | "payment";
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [hasSettlement, setHasSettlement] = useState(!!customer.settlementDate);
  const [settlementDate, setSettlementDate] = useState(
    customer.settlementDate || toJalaliInputDate(Date.now()),
  );
  const isDebt = type === "debt";
  const balance = customerBalance(customer);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseNumberInput(amount);
    if (!n || n <= 0) {
      alert("مبلغ معتبر وارد کنید.");
      return;
    }
    customers.addTx(customer.id, { type, amount: n, note: note.trim() || undefined });
    if (isDebt) {
      const latest = customers.getAll().find((c) => c.id === customer.id);
      if (latest) {
        customers.update({
          ...latest,
          settlementDate: hasSettlement ? settlementDate : undefined,
        });
      }
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-1 flex items-center justify-between">
          <h3 className={`text-base font-bold ${isDebt ? "text-destructive" : "text-green-600"}`}>
            {isDebt ? "ثبت بدهی جدید" : "ثبت پرداخت / تسویه"}
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {customerFullName(customer)}
          {balance > 0 && (
            <>
              {" "}
              — بدهی فعلی: <strong className="text-destructive">{formatToman(balance)}</strong>
            </>
          )}
          {balance < 0 && (
            <>
              {" "}
              — طلب مشتری از شما:{" "}
              <strong className="text-sky-700 dark:text-sky-400">{formatToman(-balance)}</strong>
            </>
          )}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              مبلغ (تومان)
            </label>
            <input
              value={amount ? formatNumber(parseNumberInput(amount)) : ""}
              onChange={(e) => {
                const n = parseNumberInput(e.target.value);
                setAmount(n ? String(n) : "");
              }}
              inputMode="numeric"
              autoFocus
              placeholder="۱۰۰٬۰۰۰"
              className={inputCls}
            />
          </div>
          {!isDebt && balance > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(balance))}
              className="w-full rounded-xl border border-dashed border-green-500/50 px-3 py-2 text-xs text-green-700 dark:text-green-400 hover:bg-green-500/10"
            >
              تسویه کامل — {formatToman(balance)}
            </button>
          )}
          {isDebt && balance < 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(-balance))}
              className="w-full rounded-xl border border-dashed border-sky-500/50 px-3 py-2 text-xs text-sky-700 dark:text-sky-400 hover:bg-sky-500/10"
            >
              تسویه طلب مشتری — {formatToman(-balance)}
            </button>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="بابت... (اختیاری)"
            className={inputCls}
          />
          {isDebt && (
            <div className="rounded-xl border border-border bg-background p-3">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={hasSettlement}
                  onChange={(e) => setHasSettlement(e.target.checked)}
                  className="h-4 w-4"
                />
                <CalendarClock className="h-3.5 w-3.5 text-primary" />
                تاریخ تسویه این بدهی (اختیاری)
              </label>
              {hasSettlement && (
                <div className="mt-2">
                  <JalaliDateSelect
                    value={settlementDate}
                    onChange={setSettlementDate}
                    yearsBack={1}
                    yearsForward={2}
                  />
                </div>
              )}
            </div>
          )}
          <button
            type="submit"
            className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${isDebt ? "bg-destructive" : "bg-green-600"}`}
          >
            ثبت
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── مودال ثبت سریع طلب/بدهی (انتخاب یا ساخت مشتری + مبلغ، همه در یک مرحله) ──

function QuickEntryModal({
  type,
  list,
  onClose,
}: {
  /** debt = مشتری به ما بدهکار شد (طلب ما) · payment = ما به مشتری بدهکار شدیم (طلب مشتری) */
  type: "debt" | "payment";
  list: Customer[];
  onClose: () => void;
}) {
  const isDebt = type === "debt";
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const matches =
    query.trim() && !selected
      ? filterAndRankSearch(list, query, (c) => [...personNameSearchFields(c), c.phone]).slice(0, 6)
      : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseNumberInput(amount);
    if (!n || n <= 0) {
      alert("مبلغ معتبر وارد کنید.");
      return;
    }
    let target = selected;
    if (!target) {
      const name = query.trim();
      if (!name) {
        alert("نام مشتری را بنویسید یا از فهرست انتخاب کنید.");
        return;
      }
      target = customers.add({ firstName: name, phone: phone.trim() || undefined });
    }
    customers.addTx(target.id, {
      type,
      amount: n,
      note: note.trim() || (isDebt ? "ثبت طلب" : "بدهی ما به مشتری"),
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-elegant sm:rounded-3xl">
        <div className="mb-1 flex items-center justify-between">
          <h3
            className={`flex items-center gap-1.5 text-base font-bold ${
              isDebt ? "text-destructive" : "text-sky-700 dark:text-sky-400"
            }`}
          >
            {isDebt ? (
              <ArrowUpCircle className="h-5 w-5" />
            ) : (
              <ArrowDownCircle className="h-5 w-5" />
            )}
            {isDebt ? "ثبت طلب جدید" : "ثبت بدهی شما به مشتری"}
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs leading-5 text-muted-foreground">
          {isDebt
            ? "وقتی مشتری جنس برده یا پول قرض گرفته و به شما بدهکار شده است."
            : "وقتی از مشتری جنس یا پول گرفته‌اید و به او بدهکار شده‌اید؛ حساب او «طلبکار» می‌شود."}
        </p>
        <form onSubmit={submit} className="space-y-3">
          {selected ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{customerFullName(selected)}</div>
                <div className="text-[11px] text-muted-foreground">
                  {customerBalance(selected) > 0
                    ? `بدهی فعلی: ${formatToman(customerBalance(selected))}`
                    : customerBalance(selected) < 0
                      ? `طلب فعلی مشتری: ${formatToman(-customerBalance(selected))}`
                      : "حساب تسویه است"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                title="تغییر مشتری"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                نام مشتری *
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                placeholder="جستجو یا نام مشتری جدید..."
                className={inputCls}
              />
              {matches.length > 0 && (
                <div className="mt-1 overflow-hidden rounded-xl border border-border bg-background">
                  {matches.map((c) => {
                    const b = customerBalance(c);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelected(c)}
                        className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-right text-xs last:border-0 hover:bg-accent"
                      >
                        <span className="truncate font-medium">{customerFullName(c)}</span>
                        <span
                          className={`shrink-0 text-[10px] font-semibold ${
                            b > 0
                              ? "text-destructive"
                              : b < 0
                                ? "text-sky-700 dark:text-sky-400"
                                : "text-green-600"
                          }`}
                        >
                          {b > 0
                            ? `بدهکار ${formatToman(b)}`
                            : b < 0
                              ? `طلبکار ${formatToman(-b)}`
                              : "تسویه"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {query.trim() && matches.length === 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  مشتری‌ای با این نام نیست — با ثبت، مشتری جدیدی با همین نام ساخته می‌شود.
                </p>
              )}
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="شماره تلفن (اختیاری — برای مشتری جدید)"
                inputMode="tel"
                dir="ltr"
                className={`${inputCls} mt-2`}
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              مبلغ (تومان) *
            </label>
            <input
              value={amount ? formatNumber(parseNumberInput(amount)) : ""}
              onChange={(e) => {
                const n = parseNumberInput(e.target.value);
                setAmount(n ? String(n) : "");
              }}
              inputMode="numeric"
              placeholder="۱۰۰٬۰۰۰"
              className={inputCls}
            />
          </div>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="بابت... (اختیاری)"
            className={inputCls}
          />

          <button
            type="submit"
            className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white ${
              isDebt ? "bg-destructive" : "bg-sky-600"
            }`}
          >
            {isDebt ? "ثبت طلب" : "ثبت بدهی"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CustomersPage() {
  return (
    <AuthGuard>
      <CustomersPageInner />
    </AuthGuard>
  );
}

// ─── پیگیری بدهکاران (پیامک نیمه‌دستی + تماس) ────────────────────────────────

function DebtFollowupModal({
  customers: list,
  onClose,
  onRemind,
}: {
  customers: Customer[];
  onClose: () => void;
  onRemind: (c: Customer) => void;
}) {
  const debtors = useMemo(
    () =>
      list
        .filter((c) => customerBalance(c) > 0)
        .sort((a, b) => customerBalance(b) - customerBalance(a)),
    [list],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-card shadow-elegant sm:rounded-3xl">
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold">
              <Send className="h-4 w-4 text-primary" />
              پیگیری بدهکاران
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              متن آماده را بفرستید یا تماس بگیرید — ارسال نیمه‌دستی از گوشی شماست.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {debtors.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">بدهکاری ثبت نشده است.</p>
          ) : (
            <ul className="space-y-2">
              {debtors.map((c) => {
                const dueKind = settlementAlertKind(c);
                const phone = c.phone?.trim();
                return (
                  <li key={c.id} className="rounded-2xl border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{customerFullName(c)}</div>
                        <div className="mt-0.5 text-xs font-semibold text-destructive">
                          {formatToman(customerBalance(c))}
                        </div>
                        {c.settlementDate && (
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <CalendarClock className="h-3 w-3" />
                            موعد {formatJalaliYmd(c.settlementDate)}
                            {dueKind === "overdue"
                              ? " · گذشته"
                              : dueKind === "today"
                                ? " · امروز"
                                : dueKind === "tomorrow"
                                  ? " · فردا"
                                  : ""}
                          </div>
                        )}
                        {phone ? (
                          <div className="mt-0.5 text-[11px] text-muted-foreground" dir="ltr">
                            {phone}
                          </div>
                        ) : (
                          <div className="mt-0.5 text-[11px] text-destructive">بدون شماره تلفن</div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onRemind(c)}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-primary py-2 text-[11px] font-semibold text-primary-foreground"
                      >
                        <Send className="h-3.5 w-3.5" />
                        پیامک آماده
                      </button>
                      <button
                        type="button"
                        disabled={!phone}
                        onClick={() => phone && openExternal(telHref(phone))}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-sky-600 py-2 text-[11px] font-semibold text-white disabled:opacity-40"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        تماس
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── پنل پیامکی (ارسال گروهی) ──────────────────────────────────────────────

type Audience = "all" | "debtors" | "creditors" | "settled";

const TEMPLATES: { id: string; label: string; body: (shop: string) => string }[] = [
  {
    id: "debt",
    label: "💰 یادآور بدهی",
    body: (shop) =>
      `مشتری گرامی،\nیادآور بدهی شما به ${shop}.\nلطفاً در اولین فرصت نسبت به تسویه حساب اقدام بفرمایید.\nبا تشکر.`,
  },
  {
    id: "festival",
    label: "🎉 جشنواره",
    body: (shop) =>
      `مشتری گرامی،\n${shop} با افتخار جشنواره ویژه‌ای برگزار می‌کند.\nبا تخفیف‌های شگفت‌انگیز در انتظار شما هستیم.\nمنتظر دیدارتان هستیم 🌹`,
  },
  {
    id: "discount",
    label: "🏷️ تخفیف",
    body: (shop) =>
      `سلام،\nتخفیف ویژه ${shop} فعال شد!\nفرصت را از دست ندهید و همین حالا از محصولات منتخب با قیمت استثنایی بهره‌مند شوید.`,
  },
  {
    id: "promo",
    label: "📣 تبلیغ",
    body: (shop) =>
      `با سلام،\nمحصولات جدید ${shop} رسید!\nبرای مشاهده تازه‌ترین کالاها به فروشگاه ما سر بزنید.\nبا تشکر از همراهی شما.`,
  },
  {
    id: "thanks",
    label: "🙏 تشکر",
    body: (shop) =>
      `مشتری گرامی،\nاز اینکه ${shop} را انتخاب کرده‌اید سپاسگزاریم.\nهمیشه در خدمت شما هستیم.`,
  },
];

// هنگام ارسال انبوه، گیرندگان به گروه‌های ۱۰ نفره تقسیم می‌شوند تا اپ پیامک
// گوشی با تعداد زیاد گیرنده دچار مشکل نشود. شماره‌های ارسال‌شده در همین نشست
// نگه‌داری می‌شوند تا با بستن/بازکردن دوباره‌ی پنل هم مشخص بماند.
const SMS_GROUP_SIZE = 10;
const SMS_SENT_KEY = "acc.sms.sentPhones.v1";

function readSentPhones(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SMS_SENT_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeSentPhones(set: Set<string>) {
  try {
    sessionStorage.setItem(SMS_SENT_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function SmsCampaignModal({
  customers: list,
  onClose,
}: {
  customers: Customer[];
  onClose: () => void;
}) {
  const shopName = settings.get().shopName || "فروشگاه ما";
  const { state: authState } = useAuth();
  const userId = authUserId(authState);
  const [audience, setAudience] = useState<Audience>("all");
  const [text, setText] = useState(TEMPLATES[0].body(shopName));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [customMode, setCustomMode] = useState(false);
  const [includeLink, setIncludeLink] = useState(true);
  const [sentPhones, setSentPhones] = useState<Set<string>>(() => readSentPhones());
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  const audienceList = useMemo(() => {
    return list.filter((c) => {
      if (!c.phone) return false;
      const b = customerBalance(c);
      if (audience === "debtors") return b > 0;
      if (audience === "creditors") return b < 0;
      if (audience === "settled") return b === 0;
      return true;
    });
  }, [list, audience]);

  const finalList = useMemo(
    () => (customMode ? audienceList.filter((c) => selectedIds.has(c.id)) : audienceList),
    [customMode, audienceList, selectedIds],
  );

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // لینک عمومی صفحه فروشگاه؛ در صورت فعال بودن سوییچ «افزودن لینک»، هم به پیامک
  // و هم به متن اشتراک‌گذاری افزوده می‌شود.
  const storeLink = userId && includeLink ? storePublicUrl(userId) : "";
  // حذف کاراکترهای نامرئی جهت متن (RLM/LRM/RLE/PDF/...) که گاهی توسط ادیتور یا
  // مرورگر هنگام ترکیب متن فارسی + لینک انگلیسی به‌صورت خودکار تزریق می‌شوند و
  // باعث می‌شوند برخی اپ‌های پیامک اندرویدی URL را خراب تفسیر کنند.
  const stripBidi = (s: string) =>
    s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  const shareFinalText = stripBidi(storeLink ? `${text}\n${storeLink}` : text);
  const smsText = shareFinalText;

  const markSent = (phones: string[]) =>
    setSentPhones((prev) => {
      const next = new Set(prev);
      phones.forEach((p) => next.add(p));
      writeSentPhones(next);
      return next;
    });

  // تقسیم گیرندگان به گروه‌های ۱۰ نفره
  const groups = useMemo(() => {
    const out: Customer[][] = [];
    for (let i = 0; i < finalList.length; i += SMS_GROUP_SIZE)
      out.push(finalList.slice(i, i + SMS_GROUP_SIZE));
    return out;
  }, [finalList]);

  const groupSent = (group: Customer[]) =>
    group.length > 0 && group.every((c) => sentPhones.has((c.phone ?? "").trim()));

  // ارسال پیامک به یک گروه (چند گیرنده در یک لینک sms:)
  const sendSmsGroup = (group: Customer[]) => {
    const numbers = group.map((c) => (c.phone ?? "").trim()).filter(Boolean);
    if (numbers.length === 0) {
      alert("هیچ گیرنده‌ای انتخاب نشده.");
      return;
    }
    window.location.href = `sms:${numbers.join(",")}?body=${encodeURIComponent(smsText)}`;
    markSent(numbers);
  };

  const sendWhatsAppOne = (c: Customer) => {
    const intl = toIntlPhone(c.phone ?? "");
    if (!intl) return;
    let personal = text.replace(/\{name\}/g, customerFullName(c));
    if (storeLink) personal = `${personal}\n${storeLink}`;
    const url = `https://wa.me/${intl}?text=${encodeURIComponent(personal)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    markSent([(c.phone ?? "").trim()]);
  };

  const shareForApps = async (message: string, sentPhonesToMark: string[] = []) => {
    const result = await shareText({ title: shopName, text: message });
    if (sentPhonesToMark.length) markSent(sentPhonesToMark);
    setShareNotice(
      result === "shared"
        ? "پنجره اشتراک باز شد؛ روبیکا، بله یا ایتا را انتخاب کنید. اگر متن نیامد، متن کپی شده و Paste کنید."
        : "متن پیام کپی شد؛ وارد روبیکا، بله یا ایتا شوید و Paste کنید.",
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card shadow-elegant sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <Megaphone className="h-4 w-4 text-primary" />
            پنل پیامکی
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          {/* قالب آماده */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              قالب آماده
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setText(t.body(shopName))}
                  className="rounded-xl border border-border bg-background px-2 py-2 text-xs font-medium hover:bg-accent"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* متن پیام */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              متن پیام{" "}
              <span className="text-[10px] opacity-70">
                (در واتساپ، {"{name}"} با نام مشتری جایگزین می‌شود)
              </span>
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className={`${inputCls} resize-none leading-6`}
              placeholder="متن پیام جشنواره/تخفیف..."
            />
            <div className="mt-1 text-[10px] text-muted-foreground text-left">
              {text.length} کاراکتر
            </div>
          </div>

          {/* گیرندگان */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              گیرندگان
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { v: "all", l: "همه" },
                  { v: "debtors", l: "بدهکاران" },
                  { v: "creditors", l: "طلبکاران" },
                  { v: "settled", l: "تسویه‌شده" },
                ] as { v: Audience; l: string }[]
              ).map((o) => (
                <button
                  key={o.v}
                  onClick={() => {
                    setAudience(o.v);
                    setSelectedIds(new Set());
                  }}
                  className={`rounded-xl border px-2 py-2 text-xs font-medium ${audience === o.v ? "border-primary bg-primary/10 text-primary" : "border-border bg-background"}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={customMode}
                onChange={(e) => setCustomMode(e.target.checked)}
                className="h-4 w-4"
              />
              انتخاب دستی مشتریان
            </label>
          </div>

          {/* لیست گیرندگان */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {customMode ? "انتخاب کنید" : "پیش‌نمایش گیرندگان"}
              </span>
              <span className="text-[11px] font-semibold text-primary">
                {formatNumber(finalList.length)} نفر
              </span>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-background">
              {audienceList.length === 0 ? (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  مشتری دارای شماره تلفن در این گروه نیست.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {audienceList.map((c) => {
                    const checked = customMode ? selectedIds.has(c.id) : true;
                    return (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                        {customMode ? (
                          <button
                            onClick={() => toggle(c.id)}
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                          >
                            {checked && <Check className="h-3 w-3" />}
                          </button>
                        ) : (
                          <Check className="h-4 w-4 shrink-0 text-green-600" />
                        )}
                        <span className="flex-1 truncate">{customerFullName(c)}</span>
                        <span className="text-muted-foreground" dir="ltr">
                          {c.phone}
                        </span>
                        <button
                          onClick={() => sendWhatsAppOne(c)}
                          title="ارسال واتساپ به این مشتری"
                          className="grid h-7 w-7 place-items-center rounded-lg text-green-600 hover:bg-green-500/10"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            const personal = text.replace(/\{name\}/g, customerFullName(c));
                            const msg = storeLink ? `${personal}\n${storeLink}` : personal;
                            await shareForApps(msg, [(c.phone ?? "").trim()].filter(Boolean));
                          }}
                          title="اشتراک‌گذاری (روبیکا/بله/ایتا/...)"
                          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-primary hover:bg-primary/10"
                        >
                          <Share2 className="h-3.5 w-3.5" />
                          <span className="text-[10px] font-semibold">اشتراک</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-accent/50 p-2.5 text-[11px] leading-5 text-muted-foreground">
            💡 اگر سوییچ «افزودن لینک صفحه فروشگاه» را روشن کنید، لینک عمومی فروشگاه هم به پیامک و
            هم به متن اشتراک‌گذاری اضافه می‌شود. اگر می‌خواهید پیامک کوتاه‌تر باشد یا نگران خرابی
            لینک در برخی اپراتورها/گوشی‌ها هستید، این سوییچ را خاموش بگذارید.
          </div>
        </div>

        <div className="space-y-3 border-t border-border p-4">
          {/* افزودن لینک صفحه فروشگاه؛ روی پیامک و اشتراک‌گذاری هر دو اثر دارد */}
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
            <span className="flex items-center gap-2 text-xs">
              <Link2 className="h-4 w-4 text-primary" />
              افزودن لینک صفحه فروشگاه به پیامک و اشتراک‌گذاری
            </span>
            <input
              type="checkbox"
              checked={includeLink}
              onChange={(e) => setIncludeLink(e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>
          {includeLink && !userId && (
            <p className="text-[10px] text-amber-600">برای افزودن لینک باید وارد حساب باشید.</p>
          )}

          <button
            type="button"
            onClick={() => shareForApps(shareFinalText)}
            disabled={!shareFinalText.trim()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
          >
            <Share2 className="h-4 w-4" />
            اشتراک در روبیکا / بله / ایتا
          </button>
          {shareNotice && (
            <p className="text-center text-[11px] leading-5 text-primary">{shareNotice}</p>
          )}

          {finalList.length === 0 ? (
            <button
              disabled
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground opacity-50"
            >
              <Send className="h-4 w-4" />
              ارسال پیامک
            </button>
          ) : finalList.length <= SMS_GROUP_SIZE ? (
            <button
              onClick={() => sendSmsGroup(finalList)}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                groupSent(finalList)
                  ? "bg-green-600 text-white"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {groupSent(finalList) ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {groupSent(finalList)
                ? "ارسال شد"
                : `ارسال پیامک به ${formatNumber(finalList.length)} نفر`}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] leading-5 text-muted-foreground">
                به‌دلیل تعداد زیاد، گیرندگان به گروه‌های ۱۰ نفره تقسیم شدند. هر گروه را جداگانه و با
                کمی فاصله بفرستید.
              </p>
              <div className="max-h-44 space-y-1.5 overflow-y-auto">
                {groups.map((group, i) => {
                  const isSent = groupSent(group);
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2"
                    >
                      <span className="text-sm font-medium">
                        گروه {formatNumber(i + 1)} ({formatNumber(group.length)} نفر)
                      </span>
                      <button
                        onClick={() => sendSmsGroup(group)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                          isSent ? "bg-green-600 text-white" : "bg-primary text-primary-foreground"
                        }`}
                      >
                        {isSent ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {isSent ? "ارسال شد" : "ارسال"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── پنجره‌ی کامل مشتری (نمایش، تراکنش‌ها، فاکتورهای فروش، اقدامات) ───────────

function CustomerDetailModal({
  customer,
  onClose,
  onDebt,
  onPayment,
  onEdit,
  onDelete,
  onRemind,
  onNewInvoice,
}: {
  customer: Customer;
  onClose: () => void;
  onDebt: () => void;
  onPayment: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemind: () => void;
  onNewInvoice: () => void;
}) {
  const [salesHistory] = invoice.useHistory();
  const [appSettings] = settings.useAll();
  const balance = customerBalance(customer);
  const dueKind = settlementAlertKind(customer);
  const myInvoices = useMemo(
    () => invoicesOfCustomer(customer, salesHistory),
    [customer, salesHistory],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-card shadow-elegant sm:rounded-3xl">
        {/* هدر */}
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold">{customerFullName(customer)}</h3>
            {customer.phone && (
              <span
                className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"
                dir="ltr"
              >
                <Phone className="h-3 w-3" />
                {customer.phone}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* خلاصه‌ی مانده حساب */}
          <div
            className={`mb-4 rounded-2xl p-4 text-center ${
              balance > 0
                ? "bg-destructive/10 text-destructive"
                : balance < 0
                  ? "bg-sky-500/10 text-sky-700 dark:text-sky-400"
                  : "bg-green-500/10 text-green-600"
            }`}
          >
            <div className="text-[11px] opacity-80">
              {balance > 0 ? "بدهکار به شما" : balance < 0 ? "طلبکار از شما" : "وضعیت حساب"}
            </div>
            <div className="mt-1 text-xl font-bold">
              {balance === 0 ? "تسویه است" : formatToman(Math.abs(balance))}
            </div>
            {customer.settlementDate && balance > 0 && (
              <div className="mt-1 flex items-center justify-center gap-1 text-[11px] opacity-80">
                <CalendarClock className="h-3 w-3" />
                موعد تسویه: {formatJalaliYmd(customer.settlementDate)}
                {dueKind === "overdue"
                  ? " · گذشته"
                  : dueKind === "today"
                    ? " · امروز"
                    : dueKind === "tomorrow"
                      ? " · فردا"
                      : ""}
              </div>
            )}
          </div>

          {/* اقدامات سریع */}
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button
              onClick={onNewInvoice}
              className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground shadow-elegant"
            >
              <ShoppingCart className="h-4 w-4" />
              فاکتور فروش جدید برای این مشتری
            </button>
            <button
              onClick={onDebt}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
            >
              <ArrowUpCircle className="h-3.5 w-3.5" />
              ثبت بدهی
            </button>
            <button
              onClick={onPayment}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 px-3 py-2 text-xs font-semibold text-green-700 dark:text-green-400"
            >
              <ArrowDownCircle className="h-3.5 w-3.5" />
              ثبت پرداخت
            </button>
            {balance > 0 && (
              <>
                <button
                  onClick={onRemind}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
                >
                  <Send className="h-3.5 w-3.5" />
                  پیامک بدهی
                </button>
                <button
                  type="button"
                  disabled={!customer.phone}
                  onClick={() => {
                    const href = telHref(customer.phone || "");
                    if (href) openExternal(href);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-500/20 disabled:opacity-40 dark:text-sky-400"
                >
                  <Phone className="h-3.5 w-3.5" />
                  تماس
                </button>
              </>
            )}
          </div>

          {customer.note && (
            <div className="mb-4 rounded-lg bg-accent px-3 py-2 text-xs text-muted-foreground">
              {customer.note}
            </div>
          )}

          {/* فاکتورهای فروش این مشتری */}
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" />
            فاکتورهای فروش ({formatNumber(myInvoices.length)})
          </h4>
          {myInvoices.length === 0 ? (
            <p className="mb-4 py-2 text-center text-xs text-muted-foreground">
              هنوز فاکتور فروشی برای این مشتری ثبت نشده است.
            </p>
          ) : (
            <ul className="mb-4 space-y-1.5 max-h-52 overflow-y-auto">
              {myInvoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-primary">{formatToman(inv.total)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatJalaliDateTime(inv.createdAt)}
                      {inv.paymentMethod && ` · ${PAYMENT_LABEL[inv.paymentMethod]}`}
                    </div>
                  </div>
                  <InvoiceActions
                    inv={{ ...inv, shopLogoUrl: inv.shopLogoUrl || appSettings.logoUrl }}
                    size="sm"
                    showLabels={false}
                  />
                </li>
              ))}
            </ul>
          )}

          {/* تراکنش‌های بدهی/پرداخت */}
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" />
            تراکنش‌های بدهی/پرداخت ({formatNumber(customer.txs.length)})
          </h4>
          {customer.txs.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">تراکنشی ثبت نشده است.</p>
          ) : (
            <ul className="space-y-1.5 max-h-52 overflow-y-auto">
              {customer.txs.map((t) => (
                <TxRow key={t.id} tx={t} customer={customer} />
              ))}
            </ul>
          )}
        </div>

        {/* پایین: ویرایش/حذف */}
        <div className="flex justify-end gap-1 border-t border-border p-3">
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10"
          >
            <Pencil className="h-3.5 w-3.5" />
            ویرایش
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            حذف مشتری
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── حذف همه‌ی مشتریان (عملیات برگشت‌ناپذیر) ─────────────────────────────────

/**
 * دیالوگ تایید حذف کامل فهرست مشتریان. عمداً سخت‌گیرانه است: کاربر باید کلمه‌ی
 * «حذف» را تایپ کند، و دقیقاً نوشته شده چه چیزی پاک می‌شود و چه چیزی نمی‌شود.
 */
function DeleteAllCustomersDialog({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === "حذف";
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl border border-destructive/40 bg-card p-5 shadow-elegant">
        <h3 className="mb-2 flex items-center gap-2 text-base font-bold text-destructive">
          <Trash2 className="h-4 w-4" />
          حذف همه‌ی مشتریان
        </h3>
        <div className="space-y-2 text-xs leading-6 text-muted-foreground">
          <p>
            با این کار <b className="text-foreground">{formatNumber(count)} مشتری</b> و{" "}
            <b className="text-foreground">تمام سوابق بدهی و پرداخت آن‌ها</b> برای همیشه پاک می‌شود.
            این عمل قابل بازگشت نیست.
          </p>
          <p className="rounded-xl border border-border bg-background p-2.5">
            ✅ فاکتورهای فروش، هزینه‌ها، محصولات و بقیه‌ی اطلاعات شما دست‌نخورده باقی می‌ماند. فقط
            فهرست مشتریان و دفتر بدهی‌شان حذف می‌شود.
          </p>
          <p>پیشنهاد می‌کنیم قبل از ادامه، از «تنظیمات ← پشتیبان‌گیری» یک نسخه پشتیبان بگیرید.</p>
          <p className="text-foreground">برای تایید، کلمه‌ی «حذف» را بنویسید:</p>
        </div>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="حذف"
          className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-destructive"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!ok}
            className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-40"
          >
            حذف همه
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-accent"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── فاکتور فروش سریع برای یک مشتری مشخص (از داخل صفحه مشتریان) ───────────────

function CustomerInvoiceModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { requireActive } = useSubscriptionAccess();
  const [appSettings] = settings.useAll();
  const [allProducts] = products.useAll();
  const [cartInv, setCartInv] = useState(() => emptyInvoice());
  const [searchQ, setSearchQ] = useState("");
  const [showManualItem, setShowManualItem] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paidAmount, setPaidAmount] = useState("");

  const matches = searchQ.trim()
    ? filterAndRankSearch(allProducts, searchQ, (p) => [p.name, p.code]).slice(0, 8)
    : [];

  const addFromSearch = (p: Product) => {
    setCartInv((prev) => addProductToInvoice(prev, p));
    setSearchQ("");
  };

  const setQty = (productId: string, quantity: number) => {
    setCartInv((prev) => {
      const items = prev.items
        .map((i) => (i.productId === productId ? { ...i, quantity } : i))
        .filter((i) => i.quantity > 0);
      return recalc({ ...prev, items });
    });
  };

  const removeItem = (productId: string) => {
    setCartInv((prev) =>
      recalc({ ...prev, items: prev.items.filter((i) => i.productId !== productId) }),
    );
  };

  const addManualItem = () => {
    const price = parseNumberInput(manualPrice);
    const qty = parseNumberInput(manualQty) || 1;
    if (!manualName.trim() || price <= 0 || qty <= 0) {
      alert("نام کالا، قیمت و تعداد معتبر وارد کنید.");
      return;
    }
    setCartInv((prev) =>
      recalc({
        ...prev,
        items: [
          ...prev.items,
          {
            productId: `manual-${cryptoId()}`,
            name: manualName.trim(),
            price,
            quantity: qty,
            unit: "عدد",
          },
        ],
      }),
    );
    setManualName("");
    setManualPrice("");
    setManualQty("1");
    setShowManualItem(false);
  };

  // مبالغ از منبع واحد invoice-math خوانده می‌شوند تا با فاکتور چاپی یکی باشند
  const cartTotals = invoiceTotals({
    ...cartInv,
    paymentMethod,
    paidAmount: parseNumberInput(paidAmount),
  });
  const paid = paymentMethod === "credit" ? cartTotals.paid : cartTotals.total;
  const debt = paymentMethod === "credit" ? cartTotals.remaining : 0;

  const submit = () => {
    if (!requireActive()) return;
    if (!requireOnlineWrite()) return;
    if (cartInv.items.length === 0) {
      alert("حداقل یک کالا به فاکتور اضافه کنید.");
      return;
    }
    const customerInfo = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
    };
    const finalInv = recalc({
      ...cartInv,
      customer: customerInfo,
      shopName: appSettings.shopName,
      shopLogoUrl: appSettings.logoUrl || undefined,
      paymentMethod,
      paidAmount: paymentMethod === "credit" ? paid : undefined,
    });
    invoice.archive(finalInv);
    if (paymentMethod === "credit" && debt > 0) {
      customers.recordInvoiceDebt(customerInfo, finalInv, { amount: debt, note: "فاکتور نسیه" });
    } else {
      customers.findOrCreate(customerInfo);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-card shadow-elegant sm:rounded-3xl">
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <ShoppingCart className="h-4 w-4 text-primary" />
            فاکتور فروش برای {customerFullName(customer)}
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* جستجوی کالا */}
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="جستجوی محصول..."
              className="w-full rounded-xl border border-input bg-background py-2 pr-9 pl-3 text-sm outline-none focus:border-primary"
            />
            {matches.length > 0 && (
              <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
                {matches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addFromSearch(p)}
                    className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-right text-xs last:border-0 hover:bg-accent"
                  >
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatToman(applyProductDiscount(p))}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {searchQ.trim() && matches.length === 0 && (
              <div className="absolute inset-x-0 top-full z-40 mt-1 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground shadow-lg">
                محصولی یافت نشد
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowManualItem((v) => !v)}
            className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            <NotebookPen className="h-3 w-3" />
            افزودن کالای دستی (خارج از انبار)
          </button>

          {showManualItem && (
            <div className="mb-3 space-y-2 rounded-xl border border-border bg-background p-3">
              <input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="نام کالا"
                className={inputCls}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  placeholder="قیمت واحد"
                  inputMode="numeric"
                  dir="ltr"
                  className={inputCls}
                />
                <input
                  value={manualQty}
                  onChange={(e) => setManualQty(e.target.value)}
                  placeholder="تعداد"
                  inputMode="decimal"
                  dir="ltr"
                  className={inputCls}
                />
              </div>
              <button
                type="button"
                onClick={addManualItem}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                افزودن به فاکتور
              </button>
            </div>
          )}

          {/* اقلام فاکتور */}
          {cartInv.items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
              <Package className="mx-auto mb-1 h-6 w-6" />
              هنوز کالایی اضافه نشده
            </div>
          ) : (
            <ul className="space-y-1.5">
              {cartInv.items.map((item) => (
                <li
                  key={item.productId}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatToman(item.price)} × {formatNumber(item.quantity)}
                    </div>
                  </div>
                  <QuantityStepper
                    value={item.quantity}
                    min={0}
                    step={isWeightUnit(item.unit) ? 0.1 : 1}
                    allowDecimal={isWeightUnit(item.unit)}
                    onChange={(q) => setQty(item.productId, q)}
                    className="bg-background"
                  />
                  <button
                    onClick={() => removeItem(item.productId)}
                    className="grid h-7 w-7 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* روش پرداخت */}
          <div className="mt-4">
            <h4 className="mb-2 text-xs font-semibold text-muted-foreground">روش پرداخت</h4>
            <div className="grid grid-cols-3 gap-2">
              {(["cash", "card", "credit"] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`rounded-xl py-2 text-xs font-semibold ${
                    paymentMethod === m
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {PAYMENT_LABEL[m]}
                </button>
              ))}
            </div>
            {paymentMethod === "credit" && (
              <div className="mt-2">
                <input
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="مبلغ پرداخت نقدی (اختیاری)"
                  inputMode="numeric"
                  dir="ltr"
                  className={inputCls}
                />
                {debt > 0 && (
                  <p className="mt-1 text-[11px] text-destructive">
                    باقیمانده به‌عنوان بدهی مشتری ثبت می‌شود: {formatToman(debt)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">جمع فاکتور</span>
            <span className="text-base font-bold text-primary">{formatToman(cartInv.total)}</span>
          </div>
          <button
            onClick={submit}
            disabled={cartInv.items.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-elegant disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            ثبت فاکتور
          </button>
        </div>
      </div>
    </div>
  );
}
