/**
 * invoice-template.ts — «طراح فاکتور»
 * ─────────────────────────────────────────────────────────────────────────────
 * کاربر می‌تواند ساختار فاکتور چاپی خود را بچیند: بلوک‌های اطلاعاتی (فروشنده،
 * خریدار، …) به‌صورت جدولی/اکسل‌گونه، ستون‌های جدول کالاها، امضا و مهر و پانویس.
 * اگر طراحی سفارشی فعال نباشد، فاکتور رسمی پیش‌فرض برنامه چاپ می‌شود.
 */
import {
  formatAmount,
  currencyLabel,
  formatJalaliDate,
  formatJalaliDateTime,
  PAYMENT_LABEL,
  COUNT_UNIT,
  invoiceDocumentTitle,
  type Invoice,
} from "@/lib/store";
import { invoiceTotals, lineTotal } from "@/lib/invoice-math";
import { type PaperSize } from "@/lib/print";
import { escapeHtml, safeCssColor } from "@/lib/html-escape";
import {
  wrapInvoiceHtml,
  invoiceAmountLines,
  invoiceBaseFontSize,
  DEFAULT_INVOICE_ACCENT,
  buildDefaultInvoiceHTML,
  type InvoiceHtmlMode,
} from "@/lib/invoice-document";

// ─── مدل داده ───────────────────────────────────────────────────────────────

export type TplFieldKey =
  | "static"
  | "blank"
  | "invoice.id"
  | "invoice.date"
  | "invoice.datetime"
  | "invoice.payment"
  | "invoice.notes"
  | "invoice.total"
  | "invoice.paid"
  | "invoice.remaining"
  | "invoice.itemsCount"
  | "shop.name"
  | "shop.address"
  | "shop.phone"
  | "customer.name"
  | "customer.phone";

export type TplField = {
  id: string;
  /** برچسب سمت راست خانه (مثلاً «کد ملی») */
  label: string;
  /** منبع مقدار */
  key: TplFieldKey;
  /** مقدار ثابت — فقط وقتی key === "static" */
  value?: string;
  /**
   * اگر true باشد، این خانه هنگام ثبت فاکتور در خود برنامه از کاربر پرسیده
   * می‌شود (مثل نام مشتری) و مقدار واردشده روی همان فاکتور ذخیره می‌شود.
   * فقط برای فیلدهای «خانه خالی» و «متن ثابت» معنا دارد.
   */
  askAtCheckout?: boolean;
};

export type TplBlock = {
  id: string;
  /** عنوان بلوک (مثلاً «مشخصات فروشنده») — خالی یعنی بدون عنوان */
  title?: string;
  /** تعداد ستون‌های خانه‌ها در این بلوک */
  columns: 1 | 2 | 3;
  fields: TplField[];
};

export type TplColumnKey = "index" | "name" | "unit" | "qty" | "price" | "discount" | "total";

export type TplColumn = { key: TplColumnKey; label: string; enabled: boolean };

export type InvoiceTemplate = {
  /** اگر false باشد، فاکتور پیش‌فرض چاپ می‌شود */
  enabled: boolean;
  /** عنوان بالای فاکتور */
  title: string;
  /** زیرعنوان کوچک زیر نام فروشگاه */
  subtitle?: string;
  showLogo: boolean;
  /** رنگ تم فاکتور (hex) */
  accent: string;
  blocks: TplBlock[];
  columns: TplColumn[];
  /** نمایش جعبه جمع‌بندی مبالغ */
  showTotals: boolean;
  /** نمایش جای مهر و امضا */
  showSignatures: boolean;
  sellerSignLabel: string;
  buyerSignLabel: string;
  /** یادداشت/شرایط پایین فاکتور */
  footerNote: string;
};

export const FIELD_CATALOG: { key: TplFieldKey; label: string; group: string }[] = [
  { key: "shop.name", label: "نام فروشگاه", group: "فروشنده" },
  { key: "shop.address", label: "نشانی فروشگاه", group: "فروشنده" },
  { key: "shop.phone", label: "تلفن فروشگاه", group: "فروشنده" },
  { key: "customer.name", label: "نام خریدار", group: "خریدار" },
  { key: "customer.phone", label: "تلفن خریدار", group: "خریدار" },
  { key: "invoice.id", label: "شماره فاکتور", group: "فاکتور" },
  { key: "invoice.date", label: "تاریخ", group: "فاکتور" },
  { key: "invoice.datetime", label: "تاریخ و ساعت", group: "فاکتور" },
  { key: "invoice.payment", label: "روش پرداخت", group: "فاکتور" },
  { key: "invoice.notes", label: "توضیحات فاکتور", group: "فاکتور" },
  { key: "invoice.itemsCount", label: "تعداد اقلام", group: "فاکتور" },
  { key: "invoice.total", label: "جمع کل", group: "مبالغ" },
  { key: "invoice.paid", label: "پرداخت‌شده", group: "مبالغ" },
  { key: "invoice.remaining", label: "مانده", group: "مبالغ" },
  { key: "static", label: "متن ثابت (خودم می‌نویسم)", group: "دلخواه" },
  { key: "blank", label: "خانه خالی (دستی پر می‌شود)", group: "دلخواه" },
];

export const COLUMN_LABELS: Record<TplColumnKey, string> = {
  index: "ردیف",
  name: "شرح کالا / خدمات",
  unit: "واحد",
  qty: "تعداد / مقدار",
  price: "مبلغ واحد",
  discount: "تخفیف",
  total: "مبلغ کل",
};

export function tplId(): string {
  return Math.random().toString(36).slice(2, 9);
}

/** فیلدهایی از قالب که کاربر خواسته هنگام ثبت فاکتور در برنامه پر شوند */
export function checkoutFields(
  t?: Partial<InvoiceTemplate> | null,
): { id: string; label: string; blockTitle?: string }[] {
  if (!t?.enabled || !Array.isArray(t.blocks)) return [];
  const out: { id: string; label: string; blockTitle?: string }[] = [];
  for (const b of t.blocks) {
    for (const f of b.fields ?? []) {
      if (f.askAtCheckout)
        out.push({ id: f.id, label: f.label || "بدون عنوان", blockTitle: b.title });
    }
  }
  return out;
}

export const DEFAULT_COLUMNS: TplColumn[] = (
  ["index", "name", "unit", "qty", "price", "discount", "total"] as TplColumnKey[]
).map((key) => ({ key, label: COLUMN_LABELS[key], enabled: key !== "discount" }));

/** قالب پیش‌فرض — ساده و شبیه فاکتور فعلی */
export function defaultTemplate(): InvoiceTemplate {
  return {
    enabled: false,
    title: "فاکتور فروش",
    subtitle: "",
    showLogo: true,
    accent: DEFAULT_INVOICE_ACCENT,
    blocks: [
      {
        id: tplId(),
        title: "مشخصات فروشنده",
        columns: 2,
        fields: [
          { id: tplId(), label: "نام فروشنده", key: "shop.name" },
          { id: tplId(), label: "تلفن", key: "shop.phone" },
          { id: tplId(), label: "نشانی", key: "shop.address" },
        ],
      },
      {
        id: tplId(),
        title: "مشخصات خریدار",
        columns: 2,
        fields: [
          { id: tplId(), label: "نام خریدار", key: "customer.name" },
          { id: tplId(), label: "تلفن", key: "customer.phone" },
        ],
      },
      {
        id: tplId(),
        title: "اطلاعات فاکتور",
        columns: 3,
        fields: [
          { id: tplId(), label: "شماره فاکتور", key: "invoice.id" },
          { id: tplId(), label: "تاریخ", key: "invoice.datetime" },
          { id: tplId(), label: "روش پرداخت", key: "invoice.payment" },
        ],
      },
    ],
    columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
    showTotals: true,
    showSignatures: false,
    sellerSignLabel: "مهر و امضای فروشنده",
    buyerSignLabel: "امضای خریدار",
    footerNote: "",
  };
}

/** قالب رسمی/شرکتی — با کد ملی، کد اقتصادی، امضا و مهر */
export function corporateTemplate(): InvoiceTemplate {
  const t = defaultTemplate();
  t.enabled = true;
  t.title = "صورتحساب فروش کالا و خدمات";
  t.blocks = [
    {
      id: tplId(),
      title: "مشخصات فروشنده",
      columns: 2,
      fields: [
        { id: tplId(), label: "نام شخص حقیقی/حقوقی", key: "shop.name" },
        { id: tplId(), label: "شماره اقتصادی", key: "static", value: "" },
        { id: tplId(), label: "شناسه ملی / کد ملی", key: "static", value: "" },
        { id: tplId(), label: "تلفن", key: "shop.phone" },
        { id: tplId(), label: "نشانی کامل", key: "shop.address" },
        { id: tplId(), label: "کد پستی", key: "static", value: "" },
      ],
    },
    {
      id: tplId(),
      title: "مشخصات خریدار",
      columns: 2,
      fields: [
        { id: tplId(), label: "نام شخص حقیقی/حقوقی", key: "customer.name" },
        { id: tplId(), label: "شماره اقتصادی", key: "blank" },
        { id: tplId(), label: "شناسه ملی / کد ملی", key: "blank" },
        { id: tplId(), label: "تلفن", key: "customer.phone" },
        { id: tplId(), label: "نشانی کامل", key: "blank" },
        { id: tplId(), label: "کد پستی", key: "blank" },
      ],
    },
    {
      id: tplId(),
      title: "اطلاعات صورتحساب",
      columns: 3,
      fields: [
        { id: tplId(), label: "شماره", key: "invoice.id" },
        { id: tplId(), label: "تاریخ", key: "invoice.date" },
        { id: tplId(), label: "روش پرداخت", key: "invoice.payment" },
      ],
    },
  ];
  t.columns = t.columns.map((c) => ({ ...c, enabled: true }));
  t.showSignatures = true;
  t.footerNote = "این صورتحساب پس از امضای طرفین معتبر است.";
  return t;
}

/** قالب ساده — فقط نام و تلفن خریدار و شماره/تاریخ */
export function minimalTemplate(): InvoiceTemplate {
  const t = defaultTemplate();
  t.enabled = true;
  t.blocks = [
    {
      id: tplId(),
      title: "",
      columns: 2,
      fields: [
        { id: tplId(), label: "شماره فاکتور", key: "invoice.id" },
        { id: tplId(), label: "تاریخ", key: "invoice.datetime" },
        { id: tplId(), label: "مشتری", key: "customer.name" },
        { id: tplId(), label: "تلفن", key: "customer.phone" },
      ],
    },
  ];
  t.columns = t.columns.map((c) => ({ ...c, enabled: c.key !== "discount" }));
  return t;
}

export function normalizeTemplate(t?: Partial<InvoiceTemplate> | null): InvoiceTemplate {
  const base = defaultTemplate();
  if (!t) return base;
  const cols = Array.isArray(t.columns) && t.columns.length ? t.columns : base.columns;
  return {
    ...base,
    ...t,
    blocks: Array.isArray(t.blocks) ? t.blocks : base.blocks,
    columns: DEFAULT_COLUMNS.map((d) => {
      const found = cols.find((c) => c.key === d.key);
      return found ? { ...d, ...found } : { ...d };
    }),
  };
}

// ─── مقداردهی فیلدها ────────────────────────────────────────────────────────

// escaper مشترک — نسخه‌ی محلی قبلی نقل‌قول‌ها را رها می‌کرد و در جایگاه صفت ناامن بود.
const esc = escapeHtml;

export function resolveField(inv: Invoice, f: TplField): string {
  const c = inv.customer;
  const t = invoiceTotals(inv);
  // مقداری که کاربر هنگام ثبت فاکتور برای این خانه وارد کرده، بر همه‌چیز مقدم است
  const typed = inv.customFields?.[f.id];
  if (typed != null && String(typed).trim() !== "") return String(typed);
  switch (f.key) {
    case "static":
      return f.value || "";
    case "blank":
      return "";
    case "invoice.id":
      return inv.id.toUpperCase();
    case "invoice.date":
      return formatJalaliDate(inv.createdAt);
    case "invoice.datetime":
      return formatJalaliDateTime(inv.createdAt);
    case "invoice.payment":
      return inv.paymentMethod ? PAYMENT_LABEL[inv.paymentMethod] : "—";
    case "invoice.notes":
      return inv.notes || "";
    case "invoice.itemsCount":
      return inv.items.length.toLocaleString("fa-IR");
    case "invoice.total":
      return `${formatAmount(t.total)} ${currencyLabel()}`;
    case "invoice.paid":
      return `${formatAmount(t.paid)} ${currencyLabel()}`;
    case "invoice.remaining":
      return `${formatAmount(t.remaining)} ${currencyLabel()}`;
    case "shop.name":
      return inv.shopName || "";
    case "shop.address":
      return inv.shopAddress || "";
    case "shop.phone":
      return inv.shopPhone || "";
    case "customer.name":
      return c ? [c.firstName, c.lastName].filter(Boolean).join(" ") : "";
    case "customer.phone":
      return c?.phone || "";
    default:
      return "";
  }
}

/** واحد نمایشی هر ردیف — همان واحدی که کاربر برای محصول ساخته است */
export function itemUnitLabel(unit?: string): string {
  return (unit && unit.trim()) || COUNT_UNIT;
}

function cellValue(
  inv: Invoice,
  key: TplColumnKey,
  item: Invoice["items"][number],
  i: number,
): string {
  switch (key) {
    case "index":
      return (i + 1).toLocaleString("fa-IR");
    case "name":
      return esc(item.name);
    case "unit":
      return esc(itemUnitLabel(item.unit));
    case "qty":
      return item.quantity.toLocaleString("fa-IR");
    case "price":
      return item.originalPrice
        ? `<s style="color:#999">${formatAmount(item.originalPrice)}</s> ${formatAmount(item.price)}`
        : formatAmount(item.price);
    case "discount":
      return item.discountPercent ? `٪${item.discountPercent.toLocaleString("fa-IR")}` : "—";
    case "total":
      return formatAmount(lineTotal(item));
    default:
      return "";
  }
}

// ─── رندر HTML ──────────────────────────────────────────────────────────────

export function buildTemplatedInvoiceHTML(
  inv: Invoice,
  tpl: InvoiceTemplate,
  fontSize = 13,
  paper: PaperSize = "A4",
  mode: InvoiceHtmlMode = "print",
): string {
  const t = normalizeTemplate(tpl);
  const accent = safeCssColor(t.accent, DEFAULT_INVOICE_ACCENT);
  const cols = t.columns.filter((c) => c.enabled);
  const shopName = inv.shopName || "فروشگاه";
  const docTitle = inv.documentTitle?.trim() || t.title || invoiceDocumentTitle(inv);
  const fs = invoiceBaseFontSize(fontSize, mode);
  const compact = paper === "A5" && mode === "print";
  const date = formatJalaliDateTime(inv.createdAt);

  const blocksHtml = t.blocks
    .filter((b) => b.fields.length > 0)
    .map((b) => {
      const cells = b.fields
        .map((f) => {
          const v = resolveField(inv, f);
          return `<div class="cell"><span class="lbl">${esc(f.label)}</span><span class="val">${
            v ? esc(v) : "&nbsp;"
          }</span></div>`;
        })
        .join("");
      return `<section class="block">
        ${b.title ? `<h2>${esc(b.title)}</h2>` : ""}
        <div class="grid cols-${b.columns}">${cells}</div>
      </section>`;
    })
    .join("");

  const head = cols.map((c) => `<th>${esc(c.label)}</th>`).join("");
  const rows = inv.items
    .map(
      (item, i) =>
        `<tr>${cols.map((c) => `<td class="c-${c.key}">${cellValue(inv, c.key, item, i)}</td>`).join("")}</tr>`,
    )
    .join("");

  const totalsRows = invoiceAmountLines(inv)
    .map((l) => `<tr class="${l.kind}"><td>${esc(l.label)}</td><td>${esc(l.value)}</td></tr>`)
    .join("");

  const inner = `<div class="sheet"><div class="frame">
  <div class="gold-rule"></div>
  <header class="masthead">
    <div class="brand">
      ${t.showLogo && inv.shopLogoUrl ? `<img class="logo" src="${esc(inv.shopLogoUrl)}" alt="لوگو"/>` : ""}
      <div class="who">
        <h1>${esc(shopName)}</h1>
        ${t.subtitle ? `<div class="sub">${esc(t.subtitle)}</div>` : ""}
      </div>
    </div>
    <div class="doc-mark">
      <div class="k">${esc(docTitle)}</div>
      <div class="v">${esc(inv.id.toUpperCase())}</div>
      <div class="d">${esc(date)}</div>
    </div>
  </header>
  <div class="gold-rule"></div>
  ${blocksHtml}
  <div class="block"><table class="tpl"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
  ${t.showTotals ? `<div class="tpl-totals"><table>${totalsRows}</table></div>` : ""}
  ${inv.notes ? `<div class="tpl-note"><strong>توضیحات: </strong>${esc(inv.notes)}</div>` : ""}
  ${t.footerNote ? `<div class="tpl-note">${esc(t.footerNote)}</div>` : ""}
  ${
    t.showSignatures
      ? `<div class="tpl-signs"><div>${esc(t.sellerSignLabel)}</div><div>${esc(t.buyerSignLabel)}</div></div>`
      : ""
  }
  <div class="colophon">با تشکر از خرید شما — ${esc(shopName)}</div>
</div></div>`;

  return wrapInvoiceHtml({
    title: `${docTitle} ${inv.id.toUpperCase()}`,
    inner,
    paper,
    mode,
    fontSize: fs,
    accent,
    compact,
  });
}

/** سند کامل فاکتور — قالب سفارشی اگر فعال باشد، وگرنه فاکتور رسمی پیش‌فرض */
export function buildInvoiceHTML(
  inv: Invoice,
  fontSize: number = 13,
  template?: Partial<InvoiceTemplate> | null,
  paper: PaperSize = "A4",
  mode: InvoiceHtmlMode = "print",
): string {
  const tpl = normalizeTemplate(template);
  if (tpl.enabled) return buildTemplatedInvoiceHTML(inv, tpl, fontSize, paper, mode);
  return buildDefaultInvoiceHTML(inv, fontSize, paper, mode);
}
