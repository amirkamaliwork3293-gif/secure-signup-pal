/**
 * نسخهٔ پشتیبان PDF — سند چاپی فارسی چندصفحه‌ای.
 *
 * مسیر اصلی «چاپ → ذخیره به‌صورت PDF» است (همان مسیر فاکتور). داخل وب‌ویو اپ
 * دانلود فایل صفحه را عوض می‌کند؛ دیالوگ چاپ اندروید/مرورگر گزینهٔ ذخیره PDF دارد.
 * داده‌ها فقط خوانده می‌شوند و هیچ تغییری در استور ایجاد نمی‌شود.
 *
 * متن کاربر پیش از درج در HTML از escapeHtml می‌گذرد. لوگوی خارجی فقط http(s)
 * یا data:image پذیرفته می‌شود تا src خطرناک وارد سند نشود.
 */
import {
  settings,
  formatJalaliDateTime,
  formatAmount,
  formatNumber,
  currencyLabel,
} from "@/lib/store";
import { escapeHtml } from "@/lib/html-escape";
import { printHtml, isAppShell } from "@/lib/print";
import {
  buildBackupSheets,
  collectBackupSnapshot,
  backupHeaderIsCode,
  backupHeaderIsMoney,
  backupHeaderIsPercent,
  type BackupRow,
  type BackupSectionKey,
} from "@/lib/backup-export";

export type BackupPdfMeta = {
  shopName: string;
  shopAddress?: string;
  shopPhone?: string;
  logoUrl?: string;
  generatedAtLabel: string;
  currency: string;
};

export type BackupPdfCell = {
  text: string;
  kind: "money" | "count" | "percent" | "code" | "text";
};

const BRAND = "KAMIX";
const BRAND_FA = "کامیکس";

export function collectBackupPdfMeta(): BackupPdfMeta {
  const s = settings.get();
  const phones = (s.storePhones ?? []).map((p) => String(p).trim()).filter(Boolean);
  return {
    shopName: (s.shopName || "فروشگاه من").trim() || "فروشگاه من",
    shopAddress: s.storeAddress?.trim() || undefined,
    shopPhone: phones.join("، ") || undefined,
    logoUrl: s.logoUrl,
    generatedAtLabel: formatJalaliDateTime(Date.now()),
    currency: currencyLabel(),
  };
}

/** فقط تصویر امن برای <img src> — javascript: و data غیرتصویری رد می‌شوند. */
export function safeBackupLogoUrl(url?: string | null): string | null {
  if (!url) return null;
  const s = url.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return s;
  return null;
}

export function formatBackupPdfCell(header: string, value: string | number): BackupPdfCell {
  if (value === "" || value == null) return { text: "—", kind: "text" };

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { text: "—", kind: "text" };
    if (backupHeaderIsPercent(header)) {
      return { text: `${formatNumber(value)}٪`, kind: "percent" };
    }
    if (backupHeaderIsMoney(header)) {
      return { text: formatAmount(value), kind: "money" };
    }
    return { text: formatNumber(value), kind: "count" };
  }

  if (backupHeaderIsCode(header)) {
    return { text: formatNumber(value), kind: "code" };
  }
  return { text: value, kind: "text" };
}

function cellClass(kind: BackupPdfCell["kind"]): string {
  return kind === "text" ? "t" : `n ${kind}`;
}

function renderTable(name: string, rows: BackupRow[]): string {
  const headers = Object.keys(rows[0] ?? {});
  if (!headers.length) return "";
  const wide = headers.length >= 8 ? " wide" : headers.length >= 6 ? " mid" : "";
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map((row, i) => {
      const tds = headers
        .map((h) => {
          const cell = formatBackupPdfCell(h, row[h] ?? "");
          const dir = cell.kind === "text" ? "" : ' dir="ltr"';
          return `<td class="${cellClass(cell.kind)}"${dir}>${escapeHtml(cell.text)}</td>`;
        })
        .join("");
      return `<tr class="${i % 2 ? "z" : ""}">${tds}</tr>`;
    })
    .join("");
  return `<section class="chapter">
  <div class="chap-head">
    <h2>${escapeHtml(name)}</h2>
    <span class="count">${escapeHtml(formatNumber(rows.length))} ردیف</span>
  </div>
  <table class="grid${wide}">
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

function coverKpis(sheets: { name: string; rows: BackupRow[] }[]): string {
  const summary = sheets.find((s) => s.name === "خلاصه");
  if (!summary) return "";
  const cards = summary.rows
    .filter((r) => r["بخش"] && r["بخش"] !== "تاریخ تهیه نسخه پشتیبان")
    .map((r) => {
      const title = String(r["بخش"] ?? "");
      const hint = String(r["شرح مبلغ"] ?? "");
      const amount = r["مبلغ"];
      const count = r["تعداد رکورد"];
      const amountText =
        typeof amount === "number" && Number.isFinite(amount)
          ? formatAmount(amount)
          : amount === "" || amount == null
            ? "—"
            : String(amount);
      const countText =
        typeof count === "number" && Number.isFinite(count) ? formatNumber(count) : "";
      return `<article class="kpi">
        <div class="kpi-k">${escapeHtml(title)}</div>
        <div class="kpi-v" dir="ltr">${escapeHtml(amountText)}</div>
        <div class="kpi-h">${escapeHtml(hint)}${countText ? ` · ${escapeHtml(countText)} رکورد` : ""}</div>
      </article>`;
    })
    .join("");
  return cards ? `<div class="kpis">${cards}</div>` : "";
}

function contentsList(sheets: { name: string; rows: BackupRow[] }[]): string {
  const items = sheets
    .filter((s) => s.name !== "خلاصه")
    .map(
      (s) =>
        `<li><span>${escapeHtml(s.name)}</span><span dir="ltr">${escapeHtml(formatNumber(s.rows.length))}</span></li>`,
    )
    .join("");
  return items ? `<div class="toc"><h3>فهرست بخش‌ها</h3><ol>${items}</ol></div>` : "";
}

function printCss(): string {
  return `
  @page { size: A4 landscape; margin: 10mm 8mm 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; }
  body {
    font-family: Vazirmatn, Tahoma, "Noto Naskh Arabic", "Segoe UI", sans-serif;
    color: #1a2332;
    direction: rtl;
    font-size: 10.5px;
    line-height: 1.55;
    padding: 0;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    a { color: inherit; text-decoration: none; }
  }
  .cover {
    border: 1px solid #d5e0ea;
    border-radius: 14px;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
  .hero {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px 22px;
    background: linear-gradient(135deg, #0b3d5c 0%, #145a86 52%, #0e7490 100%);
    color: #fff;
  }
  .hero .logo {
    width: 58px; height: 58px; object-fit: contain;
    border-radius: 12px; background: #fff; padding: 4px; flex-shrink: 0;
  }
  .hero .mark {
    width: 58px; height: 58px; flex-shrink: 0;
    border-radius: 12px;
    background: rgba(255,255,255,.12);
    border: 1px solid rgba(255,255,255,.28);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; letter-spacing: .04em; font-size: 13px; color: #f3d48b;
  }
  .hero .who { flex: 1; min-width: 0; }
  .hero .brand {
    font-size: 11px; letter-spacing: .14em; opacity: .78;
    font-weight: 600;
  }
  .hero h1 {
    font-size: 22px; font-weight: 800; line-height: 1.25;
    margin-top: 2px; word-break: break-word;
  }
  .hero .sub { font-size: 12px; opacity: .9; margin-top: 4px; word-break: break-word; }
  .hero .badge {
    flex-shrink: 0; text-align: center;
    background: rgba(255,255,255,.12);
    border: 1px solid rgba(255,255,255,.28);
    border-radius: 12px; padding: 10px 14px; min-width: 128px;
  }
  .hero .badge .k { font-size: 10px; opacity: .8; }
  .hero .badge .v { font-size: 13px; font-weight: 800; margin-top: 3px; color: #f3d48b; }
  .meta {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    background: #f4f8fb;
    border-bottom: 1px solid #e4ebf2;
  }
  .meta .cell { padding: 10px 16px; border-left: 1px solid #e4ebf2; min-width: 0; }
  .meta .k { display: block; font-size: 10px; color: #6b7c8f; margin-bottom: 2px; }
  .meta .v { font-weight: 700; font-size: 12px; word-break: break-word; }
  .body { padding: 16px 18px 18px; }
  .lead {
    font-size: 12.5px; color: #334155; margin-bottom: 14px; line-height: 1.8;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  .kpi {
    border: 1px solid #dce7ef;
    border-radius: 10px;
    padding: 10px 12px;
    background: linear-gradient(180deg, #fff, #f7fbfd);
  }
  .kpi-k { font-size: 10.5px; color: #5b6b7c; font-weight: 600; }
  .kpi-v { font-size: 15px; font-weight: 800; color: #0b3d5c; margin: 4px 0 2px; }
  .kpi-h { font-size: 10px; color: #7b8b9a; line-height: 1.5; }
  .toc h3 { font-size: 12px; color: #0b3d5c; margin-bottom: 6px; }
  .toc ol { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .toc li {
    display: flex; justify-content: space-between; gap: 12px;
    padding: 5px 0; border-bottom: 1px dashed #e4ebf2; font-size: 11.5px;
  }
  .toc li span:last-child { color: #5b6b7c; font-weight: 700; }
  .note {
    margin-top: 16px;
    padding: 10px 12px;
    background: #fff8e8;
    border: 1px solid #f0e2b8;
    border-radius: 10px;
    color: #5c4a12;
    font-size: 11px;
    line-height: 1.7;
  }
  .chapter { margin-top: 6px; break-inside: auto; }
  .chap-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; margin: 8px 0 6px;
    break-after: avoid; page-break-after: avoid;
  }
  .chap-head h2 {
    font-size: 14px; color: #0b3d5c; font-weight: 800;
    padding-right: 10px; border-right: 3px solid #c4a35a;
  }
  .chap-head .count { font-size: 10.5px; color: #6b7c8f; }
  table.grid {
    width: 100%;
    border-collapse: collapse;
    table-layout: auto;
    break-inside: auto;
  }
  table.grid thead { display: table-header-group; }
  table.grid tbody { display: table-row-group; }
  table.grid th {
    background: #0b3d5c;
    color: #fff;
    font-weight: 700;
    padding: 6px 7px;
    font-size: 9.5px;
    text-align: center;
    border: 1px solid #0b3d5c;
  }
  table.grid td {
    padding: 5px 7px;
    border: 1px solid #e4ebf2;
    font-size: 9.5px;
    text-align: right;
    vertical-align: top;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  table.grid tr { break-inside: avoid; page-break-inside: avoid; }
  table.grid tr.z td { background: #f7fafc; }
  table.grid td.n { text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.grid td.money { font-weight: 700; color: #0b3d5c; }
  table.grid.mid td, table.grid.mid th { font-size: 8.7px; padding: 4px 5px; }
  table.grid.wide td, table.grid.wide th { font-size: 8px; padding: 3px 4px; }
  .end {
    margin-top: 18px;
    text-align: center;
    color: #8a97a6;
    font-size: 10px;
    padding: 10px 0 2px;
  }
  @media print {
    .cover { border-radius: 0; }
  }
  `;
}

export function buildBackupPrintHtml(
  sheets: { name: string; rows: BackupRow[] }[],
  meta: BackupPdfMeta,
): string {
  const logo = safeBackupLogoUrl(meta.logoUrl);
  const shopBits: string[] = [];
  if (meta.shopAddress) shopBits.push(escapeHtml(meta.shopAddress));
  if (meta.shopPhone) {
    shopBits.push(`تلفن: <span dir="ltr">${escapeHtml(meta.shopPhone)}</span>`);
  }
  const shopLineHtml = shopBits.join("  ·  ") || escapeHtml("گزارش کامل اطلاعات کسب‌وکار");
  const chapters = sheets.map((s) => renderTable(s.name, s.rows)).join("\n");
  const title = `نسخه پشتیبان اطلاعات — ${meta.shopName}`;

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>${printCss()}</style>
</head>
<body>
<div id="print-root">
  <section class="cover">
    <div class="hero">
      ${
        logo
          ? `<img class="logo" src="${escapeHtml(logo)}" alt=""/>`
          : `<div class="mark">${escapeHtml(BRAND)}</div>`
      }
      <div class="who">
        <div class="brand">${escapeHtml(BRAND)} · ${escapeHtml(BRAND_FA)}</div>
        <h1>${escapeHtml(meta.shopName)}</h1>
        <div class="sub">${shopLineHtml}</div>
      </div>
      <div class="badge">
        <div class="k">نسخه پشتیبان</div>
        <div class="v">${escapeHtml(meta.generatedAtLabel)}</div>
      </div>
    </div>
    <div class="meta">
      <div class="cell"><span class="k">واحد مبالغ</span><span class="v">${escapeHtml(meta.currency)}</span></div>
      <div class="cell"><span class="k">تعداد برگه‌ها</span><span class="v">${escapeHtml(formatNumber(sheets.length))}</span></div>
      <div class="cell"><span class="k">تهیه‌شده با</span><span class="v">${escapeHtml(BRAND_FA)}</span></div>
    </div>
    <div class="body">
      <p class="lead">
        این پرونده یک تصویر خوانا از داده‌های انتخاب‌شدهٔ فروشگاه است؛ برای مرور، بایگانی
        و چاپ. بازیابی کامل نرم‌افزار با فایل JSON انجام می‌شود. هیچ تغییری در اطلاعات
        اصلی فروشگاه ایجاد نشده است.
      </p>
      ${coverKpis(sheets)}
      ${contentsList(sheets)}
      <div class="note">
        این سند محرمانه است و فقط برای صاحب کسب‌وکار تهیه شده. در پنجرهٔ چاپ، مقصد را
        «ذخیره به‌صورت PDF» یا چاپگر انتخاب کنید.
      </div>
    </div>
  </section>
  ${chapters}
  <div class="end">پایان گزارش پشتیبان — ${escapeHtml(meta.shopName)} — ${escapeHtml(BRAND)}</div>
</div>
</body>
</html>`;
}

export async function exportBackupPdf(
  selected: Record<BackupSectionKey, boolean>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sheets = buildBackupSheets(collectBackupSnapshot(), selected);
    if (!sheets.length) {
      return { ok: false, error: "در بخش‌های انتخاب‌شده داده‌ای برای پشتیبان‌گیری وجود ندارد." };
    }
    const meta = collectBackupPdfMeta();
    const html = buildBackupPrintHtml(sheets, meta);
    const ok = await printHtml(html, `پشتیبان ${meta.shopName}`);
    if (!ok) {
      return {
        ok: false,
        error: isAppShell()
          ? "چاپ سیستم باز نشد. لطفاً دوباره تلاش کنید."
          : "پنجره چاپ باز نشد. اگر پاپ‌آپ مسدود است آن را مجاز کنید و دوباره تلاش کنید.",
      };
    }
    return { ok: true };
  } catch (e) {
    console.error("[backup] pdf export failed", e);
    return { ok: false, error: "ساخت پرونده PDF ناموفق بود. لطفاً دوباره تلاش کنید." };
  }
}
