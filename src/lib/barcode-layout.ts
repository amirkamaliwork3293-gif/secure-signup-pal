/**
 * barcode-layout.ts — چیدمان چاپ بارکد (بدون DOM / bwip / jsPDF)
 *
 * این ماژول جداست تا:
 *   ۱) تعداد ستون و ردیف دقیقاً همان‌طور که کاربر می‌خواهد در HTML/PDF اعمال شود
 *   ۲) منطق صفحه/شبکه با تست واحد قابل بررسی باشد
 *   ۳) صفحات سبک مجبور نباشند کتابخانه‌های رندر لیبل را بار کنند
 */

function escapeAttr(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export type SheetPaper = "A4" | "A5" | "Letter";

export type PrintLayout = {
  /** a4 = چاپ روی برگه — label = چاپ روی رول/برچسب لیبل‌زن */
  mode?: "a4" | "label";
  /** اندازه کاغذ در حالت برگه (لیبل‌زن از اندازه برچسب صفحه می‌سازد) */
  paper?: SheetPaper;
  cols: number;
  rows: number;
  copies: number;
  labelWidthMm: number;
  labelHeightMm: number;
  showName?: boolean;
  showPrice?: boolean;
  showCode?: boolean;
  /** فاصله بین لیبل‌ها (mm) */
  gapMm?: number;
  /** جابه‌جایی ریز برای کالیبراسیون پرینتر لیبل‌زن (mm) */
  offsetXMm?: number;
  offsetYMm?: number;
  /** پررنگی میله‌ها برای پرینتر حرارتی */
  boldness?: number;
};

export type LabelPreset = {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
  cols: number;
  rows?: number;
  gapMm: number;
};

export const SHEET_PAPERS: {
  id: SheetPaper;
  label: string;
  wMm: number;
  hMm: number;
  css: string;
}[] = [
  { id: "A4", label: "A4 — ۲۱۰×۲۹۷ میلی‌متر", wMm: 210, hMm: 297, css: "A4" },
  { id: "A5", label: "A5 — ۱۴۸×۲۱۰ میلی‌متر", wMm: 148, hMm: 210, css: "A5" },
  { id: "Letter", label: "Letter — ۲۱۶×۲۷۹ میلی‌متر", wMm: 215.9, hMm: 279.4, css: "letter" },
];

export const LABEL_PRESETS: LabelPreset[] = [
  { id: "50x30", label: "۵۰×۳۰ تک‌ردیفه", widthMm: 50, heightMm: 30, cols: 1, rows: 1, gapMm: 2 },
  { id: "50x30x2", label: "۵۰×۳۰ دوردیفه", widthMm: 50, heightMm: 30, cols: 2, rows: 1, gapMm: 2 },
  { id: "40x30", label: "۴۰×۳۰ تک‌ردیفه", widthMm: 40, heightMm: 30, cols: 1, rows: 1, gapMm: 2 },
  { id: "40x30x2", label: "۴۰×۳۰ دوردیفه", widthMm: 40, heightMm: 30, cols: 2, rows: 1, gapMm: 2 },
  { id: "38x25x2", label: "۳۸×۲۵ دوردیفه", widthMm: 38, heightMm: 25, cols: 2, rows: 1, gapMm: 2 },
  { id: "60x40", label: "۶۰×۴۰ تک‌ردیفه", widthMm: 60, heightMm: 40, cols: 1, rows: 1, gapMm: 2 },
  {
    id: "100x50",
    label: "۱۰۰×۵۰ تک‌ردیفه",
    widthMm: 100,
    heightMm: 50,
    cols: 1,
    rows: 1,
    gapMm: 2,
  },
  { id: "30x20x3", label: "۳۰×۲۰ سه‌ردیفه", widthMm: 30, heightMm: 20, cols: 3, rows: 1, gapMm: 2 },
];

export const LAYOUT_LIMITS = {
  cols: { min: 1, max: 12 },
  rows: { min: 1, max: 24 },
  copies: { min: 1, max: 99 },
  labelWidthMm: { min: 15, max: 216 },
  labelHeightMm: { min: 10, max: 300 },
  gapMm: { min: 0, max: 20 },
  offsetMm: { min: -20, max: 20 },
} as const;

export const DEFAULT_LAYOUT: PrintLayout = {
  mode: "a4",
  paper: "A4",
  cols: 3,
  rows: 8,
  copies: 1,
  labelWidthMm: 60,
  labelHeightMm: 35,
  showName: true,
  showPrice: true,
  showCode: true,
  gapMm: 2,
  offsetXMm: 0,
  offsetYMm: 0,
  boldness: 1,
};

export const DEFAULT_LABEL_LAYOUT: PrintLayout = {
  mode: "label",
  paper: "A4",
  cols: 1,
  rows: 1,
  copies: 1,
  labelWidthMm: 50,
  labelHeightMm: 30,
  showName: true,
  showPrice: true,
  showCode: true,
  gapMm: 2,
  offsetXMm: 0,
  offsetYMm: 0,
  boldness: 1,
};

const LAYOUT_KEY = "kamix_barcode_layout_v1";
const BOLDNESS = new Set([0.75, 1, 1.5]);

export function parseFaNumber(s: string): number {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  let out = "";
  for (const ch of String(s)) {
    const fi = fa.indexOf(ch);
    const ai = ar.indexOf(ch);
    if (fi >= 0) out += String(fi);
    else if (ai >= 0) out += String(ai);
    else if ((ch >= "0" && ch <= "9") || ch === "." || ch === "-" || ch === "/") {
      out += ch === "/" ? "." : ch;
    }
  }
  if (!out || out === "-" || out === ".") return NaN;
  const n = parseFloat(out);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * ثبت عدد پس از اتمام تایپ (blur). هنگام تایپ نباید صدا زده شود؛
 * در غیر این صورت خالی کردن فیلد به «۱» تبدیل می‌شود و رقم بعدی می‌شود ۱۲.
 */
export function commitBoundedNumber(
  raw: string,
  min: number,
  max: number,
  fallback: number,
  integer = true,
): number {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return clampNum(fallback, min, max, integer);
  const n = parseFaNumber(trimmed);
  if (!Number.isFinite(n)) return clampNum(fallback, min, max, integer);
  return clampNum(n, min, max, integer);
}

export function clampNum(n: number, min: number, max: number, integer = false): number {
  if (!Number.isFinite(n)) return min;
  const v = integer ? Math.round(n) : Math.round(n * 100) / 100;
  return Math.min(max, Math.max(min, v));
}

export function sanitizeLayout(raw?: Partial<PrintLayout> | null): PrintLayout {
  const mode = raw?.mode === "label" ? "label" : "a4";
  const base = mode === "label" ? DEFAULT_LABEL_LAYOUT : DEFAULT_LAYOUT;
  const merged: PrintLayout = { ...base, ...raw, mode };
  const paper: SheetPaper =
    merged.paper === "A5" || merged.paper === "Letter" ? merged.paper : "A4";
  const boldness = BOLDNESS.has(Number(merged.boldness)) ? Number(merged.boldness) : 1;
  return {
    ...merged,
    paper,
    cols: clampNum(Number(merged.cols), LAYOUT_LIMITS.cols.min, LAYOUT_LIMITS.cols.max, true),
    rows: clampNum(Number(merged.rows), LAYOUT_LIMITS.rows.min, LAYOUT_LIMITS.rows.max, true),
    copies: clampNum(
      Number(merged.copies),
      LAYOUT_LIMITS.copies.min,
      LAYOUT_LIMITS.copies.max,
      true,
    ),
    labelWidthMm: clampNum(
      Number(merged.labelWidthMm),
      LAYOUT_LIMITS.labelWidthMm.min,
      LAYOUT_LIMITS.labelWidthMm.max,
    ),
    labelHeightMm: clampNum(
      Number(merged.labelHeightMm),
      LAYOUT_LIMITS.labelHeightMm.min,
      LAYOUT_LIMITS.labelHeightMm.max,
    ),
    gapMm: clampNum(Number(merged.gapMm ?? 2), LAYOUT_LIMITS.gapMm.min, LAYOUT_LIMITS.gapMm.max),
    offsetXMm: clampNum(
      Number(merged.offsetXMm ?? 0),
      LAYOUT_LIMITS.offsetMm.min,
      LAYOUT_LIMITS.offsetMm.max,
    ),
    offsetYMm: clampNum(
      Number(merged.offsetYMm ?? 0),
      LAYOUT_LIMITS.offsetMm.min,
      LAYOUT_LIMITS.offsetMm.max,
    ),
    boldness,
    showName: merged.showName !== false,
    showPrice: merged.showPrice !== false,
    showCode: merged.showCode !== false,
  };
}

export function loadPrintLayout(): PrintLayout {
  if (typeof localStorage === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    return sanitizeLayout(JSON.parse(raw) as PrintLayout);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function savePrintLayout(l: PrintLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(sanitizeLayout(l)));
  } catch {
    /* ignore */
  }
}

export function paperSpec(layout: PrintLayout): {
  id: SheetPaper;
  wMm: number;
  hMm: number;
  css: string;
} {
  const id: SheetPaper = layout.paper === "A5" || layout.paper === "Letter" ? layout.paper : "A4";
  return SHEET_PAPERS.find((p) => p.id === id) ?? SHEET_PAPERS[0];
}

export type GridMetrics = {
  mode: "a4" | "label";
  cols: number;
  rows: number;
  gap: number;
  labelW: number;
  labelH: number;
  pageW: number;
  pageH: number;
  pageCss: string;
  perPage: number;
  totalW: number;
  totalH: number;
  marginX: number;
  marginY: number;
  offsetX: number;
  offsetY: number;
  fits: boolean;
  overflowX: number;
  overflowY: number;
};

export function mm(n: number): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0mm";
  return `${Math.round(x * 100) / 100}mm`;
}

export function gridMetrics(layout: PrintLayout): GridMetrics {
  const s = sanitizeLayout(layout);
  const gap = Math.max(0, s.gapMm ?? 2);
  const cols = s.cols;
  const rows = s.rows;
  const labelW = s.labelWidthMm;
  const labelH = s.labelHeightMm;
  const totalW = cols * labelW + (cols - 1) * gap;
  const totalH = rows * labelH + (rows - 1) * gap;
  const offsetX = s.offsetXMm ?? 0;
  const offsetY = s.offsetYMm ?? 0;

  if (s.mode === "label") {
    return {
      mode: "label",
      cols,
      rows,
      gap,
      labelW,
      labelH,
      pageW: Math.max(1, totalW),
      pageH: Math.max(1, totalH),
      pageCss: `${mm(totalW).replace("mm", "")}mm ${mm(totalH).replace("mm", "")}mm`,
      perPage: cols * rows,
      totalW,
      totalH,
      marginX: 0,
      marginY: 0,
      offsetX,
      offsetY,
      fits: true,
      overflowX: 0,
      overflowY: 0,
    };
  }

  const paper = paperSpec(s);
  const overflowX = Math.max(0, Math.round((totalW - paper.wMm) * 100) / 100);
  const overflowY = Math.max(0, Math.round((totalH - paper.hMm) * 100) / 100);
  const fits = overflowX <= 0.05 && overflowY <= 0.05;
  const marginX = Math.max(0, Math.round(((paper.wMm - totalW) / 2) * 100) / 100);
  const marginY = Math.max(0, Math.round(((paper.hMm - totalH) / 2) * 100) / 100);

  return {
    mode: "a4",
    cols,
    rows,
    gap,
    labelW,
    labelH,
    pageW: paper.wMm,
    pageH: paper.hMm,
    pageCss: `${paper.css} portrait`,
    perPage: cols * rows,
    totalW,
    totalH,
    marginX: Math.round(marginX * 100) / 100,
    marginY: Math.round(marginY * 100) / 100,
    offsetX,
    offsetY,
    fits,
    overflowX,
    overflowY,
  };
}

export function cellPosition(
  indexOnPage: number,
  m: GridMetrics,
): { col: number; row: number; x: number; y: number } {
  const col = indexOnPage % m.cols;
  const row = Math.floor(indexOnPage / m.cols);
  return {
    col,
    row,
    x: m.offsetX + m.marginX + col * (m.labelW + m.gap),
    y: m.offsetY + m.marginY + row * (m.labelH + m.gap),
  };
}

export function pageSlices(count: number, perPage: number): { start: number; end: number }[] {
  const n = Math.max(0, count);
  const size = Math.max(1, perPage);
  const pages: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i += size) pages.push({ start: i, end: Math.min(n, i + size) });
  return pages;
}

export function expandCopies<T>(items: T[], copies: number): T[] {
  const n = Math.max(1, Math.round(copies) || 1);
  if (n === 1) return items.slice();
  const out: T[] = [];
  for (const it of items) for (let i = 0; i < n; i++) out.push(it);
  return out;
}

export function layoutFitMessage(m: GridMetrics): string | null {
  if (m.mode === "label" || m.fits) return null;
  const bits: string[] = [];
  if (m.overflowX > 0) {
    bits.push(`عرض شبکه (${m.totalW}mm) از کاغذ (${m.pageW}mm) بیشتر است`);
  }
  if (m.overflowY > 0) {
    bits.push(`ارتفاع شبکه (${m.totalH}mm) از کاغذ (${m.pageH}mm) بیشتر است`);
  }
  return `${bits.join(" و ")}. تعداد ستون/ردیف یا اندازه لیبل را کم کنید تا دقیقاً روی کاغذ جا شود.`;
}

export function jsPdfSheetFormat(layout: PrintLayout): "a4" | "a5" | "letter" {
  const paper = paperSpec(layout);
  if (paper.id === "A5") return "a5";
  if (paper.id === "Letter") return "letter";
  return "a4";
}

/** ساخت HTML چاپ — ستون و ردیف با CSS Grid ثابت می‌شوند، نه با flex-wrap. */
export function buildLabelsPrintHTML(dataUrls: string[], layout: PrintLayout): string {
  const m = gridMetrics(layout);
  if (m.mode === "label") return buildLabelRollHTML(dataUrls, m);
  return buildSheetPrintHTML(dataUrls, m);
}

function buildSheetPrintHTML(dataUrls: string[], m: GridMetrics): string {
  const pages = pageSlices(dataUrls.length, m.perPage);
  const pageHtml = pages
    .map(({ start, end }) => {
      const cells = dataUrls
        .slice(start, end)
        .map((u) => `<div class="cell"><img src="${escapeAttr(u)}" alt="" /></div>`)
        .join("");
      return `<section class="page">${cells}</section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="fa">
<head>
<meta charset="utf-8"/>
<title>چاپ بارکد</title>
<style>
  @page { size: ${m.pageCss}; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    background: #fff;
    width: ${mm(m.pageW)};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: ${mm(m.pageW)};
    height: ${mm(m.pageH)};
    padding: ${mm(m.marginY)} ${mm(m.marginX)};
    display: grid;
    grid-template-columns: repeat(${m.cols}, ${mm(m.labelW)});
    grid-auto-rows: ${mm(m.labelH)};
    column-gap: ${mm(m.gap)};
    row-gap: ${mm(m.gap)};
    align-content: start;
    justify-content: start;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
  .page:last-child { break-after: auto; page-break-after: auto; }
  .cell, img {
    width: ${mm(m.labelW)};
    height: ${mm(m.labelH)};
    display: block;
    border: 0;
  }
  img { object-fit: fill; }
</style>
</head>
<body>${pageHtml}</body>
</html>`;
}

function buildLabelRollHTML(dataUrls: string[], m: GridMetrics): string {
  const pages = pageSlices(dataUrls.length, m.perPage);
  const pageHtml = pages
    .map(({ start, end }) => {
      const cells = dataUrls
        .slice(start, end)
        .map((u) => `<div class="cell"><img src="${escapeAttr(u)}" alt="" /></div>`)
        .join("");
      return `<section class="page"><div class="grid">${cells}</div></section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="fa">
<head>
<meta charset="utf-8"/>
<title>چاپ لیبل بارکد</title>
<style>
  @page { size: ${mm(m.pageW)} ${mm(m.pageH)}; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    background: #fff;
    width: ${mm(m.pageW)};
    height: ${mm(m.pageH)};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: ${mm(m.pageW)};
    height: ${mm(m.pageH)};
    position: relative;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
  .page:last-child { break-after: auto; page-break-after: auto; }
  .grid {
    position: absolute;
    left: ${mm(m.offsetX)};
    top: ${mm(m.offsetY)};
    display: grid;
    grid-template-columns: repeat(${m.cols}, ${mm(m.labelW)});
    grid-auto-rows: ${mm(m.labelH)};
    column-gap: ${mm(m.gap)};
    row-gap: ${mm(m.gap)};
  }
  .cell, img {
    width: ${mm(m.labelW)};
    height: ${mm(m.labelH)};
    display: block;
    border: 0;
  }
  img { object-fit: fill; }
  @media print { html, body { width: ${mm(m.pageW)}; height: ${mm(m.pageH)}; } }
</style>
</head>
<body>${pageHtml}</body>
</html>`;
}

export function hasProductBarcode(code?: string | null): boolean {
  return !!String(code ?? "").trim();
}
