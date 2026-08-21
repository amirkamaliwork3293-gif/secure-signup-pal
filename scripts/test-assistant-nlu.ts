/**
 * تست محلی نیت‌های دستیار هوشمند — بدون شبکه.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-assistant-nlu.ts
 * (alias @ از tsconfig خوانده می‌شود اگر tsx آن را بفهمد؛ در غیر این صورت vite-node)
 */

import { parseAssistantCommand, type AssistantContext } from "../src/lib/voice/assistant-nlu";
import type { Customer, Expense, Invoice, Product } from "../src/lib/store";

const now = Date.parse("2026-08-21T12:00:00+03:30");

const bread: Product = {
  id: "p-bread",
  name: "نون",
  price: 10000,
  buyPrice: 6000,
  category: "نان",
  code: "1",
  stock: 50,
};

const shirt: Product = {
  id: "p-shirt",
  name: "تیشرت مشکی",
  price: 45000,
  buyPrice: 20000,
  category: "پوشاک",
  code: "2",
  stock: 10,
};

const kamali: Customer = {
  id: "c-kamali",
  firstName: "امیر",
  lastName: "کمالی",
  createdAt: now - 86400000,
  txs: [{ id: "t1", type: "debt", amount: 150000, at: now - 86400000 }],
};

const shahriari: Customer = {
  id: "c-shahriari",
  firstName: "علی",
  lastName: "شهریاری",
  createdAt: now - 86400000,
  txs: [],
};

const todayInvoice: Invoice = {
  id: "inv-today",
  createdAt: now - 3600000,
  items: [{ productId: "p-shirt", name: "تیشرت مشکی", price: 45000, quantity: 2, buyPrice: 20000 }],
  total: 90000,
};

const monthExpense: Expense = {
  id: "e1",
  title: "اجاره",
  amount: 5_000_000,
  category: "اجاره",
  at: now - 86400000,
  createdAt: now - 86400000,
};

const ctx: AssistantContext = {
  products: [bread, shirt],
  customers: [kamali, shahriari],
  invoices: [todayInvoice],
  expenses: [monthExpense],
  now,
};

type Expect =
  | { kind: string; queryKind?: string; nameIncludes?: string; notKind?: string }
  | { kind: string; role?: string };

const cases: { input: string; expect: Expect }[] = [
  { input: "امروز چقدر سود داشتم", expect: { kind: "query", queryKind: "profit" } },
  { input: "این ماه چقدر سود کردم", expect: { kind: "query", queryKind: "profit" } },
  { input: "سود امروز", expect: { kind: "query", queryKind: "profit" } },
  { input: "فروش امروز", expect: { kind: "query", queryKind: "sales" } },
  { input: "این ماه چقدر فروختم", expect: { kind: "query", queryKind: "sales" } },
  { input: "چقدر فروش داشتم", expect: { kind: "query", queryKind: "sales" } },
  { input: "چقدر هزینه کردم", expect: { kind: "query", queryKind: "expenses" } },
  { input: "هزینه این ماه", expect: { kind: "query", queryKind: "expenses" } },
  { input: "پرسودترین کالای من چیه", expect: { kind: "query", queryKind: "most_profitable" } },
  { input: "بهترین مشتری من کیه", expect: { kind: "query", queryKind: "best_customers" } },
  { input: "چند تا بدهکار دارم", expect: { kind: "query", queryKind: "debtors" } },
  { input: "آقای کمالی چقدر بدهکاره", expect: { kind: "query", queryKind: "customer_status" } },
  { input: "وضعیت حساب آقای کمالی", expect: { kind: "query", queryKind: "customer_status" } },
  { input: "گزارش امروز", expect: { kind: "query", queryKind: "snapshot" } },
  { input: "سود خالص این ماه", expect: { kind: "query", queryKind: "net_profit" } },
  { input: "چند تا فاکتور زدم امروز", expect: { kind: "query", queryKind: "invoice_count" } },
  { input: "هوا امروز خیلی خوبه", expect: { kind: "unknown" } },
  { input: "نون", expect: { kind: "invoice_item" } },
  { input: "۲ تا نون", expect: { kind: "invoice_item" } },
  { input: "فاکتور آقای کمالی چیه", expect: { kind: "open_invoice" } },
  { input: "الارم فردا ساعت ۱۰", expect: { kind: "reminder" } },
  { input: "دو تا نون", expect: { kind: "invoice_item" } },
  {
    input: "آقای شهریاری ۲۵۰ هزار تومان بدهکار است",
    expect: { kind: "customer_debt", role: "debtor" },
  },
  {
    input: "آقای شهریاری ۲۵۰ هزار تومان طلبکار است",
    expect: { kind: "customer_debt", role: "creditor" },
  },
  { input: "ماهانه ۴۵ میلیون هزینه اجاره خانه است", expect: { kind: "expense" } },
  { input: "تیشرت مشکی ویرایش قیمت ۴۵ هزار تومان", expect: { kind: "product_price_edit" } },
  {
    input: "۱۵۰ عدد پیراهن با قیمت ۲۰۰ هزار تومان اضافه شود",
    expect: { kind: "product_add" },
  },
  { input: "فاکتور آقای کمالی را باز کن", expect: { kind: "open_invoice" } },
  { input: "یادآوری پرداخت بدهی ساعت ۱۳:۳۰ تاریخ ۴/۴/۱۴۰۵", expect: { kind: "reminder" } },
];

let failed = 0;
for (const c of cases) {
  const intent = parseAssistantCommand(c.input, ctx);
  const okKind = intent.kind === c.expect.kind;
  const okQuery =
    !c.expect.queryKind || (intent.kind === "query" && intent.queryKind === c.expect.queryKind);
  const okRole =
    !c.expect.role || (intent.kind === "customer_debt" && intent.role === c.expect.role);
  const pass = okKind && okQuery && okRole;
  if (!pass) {
    failed++;
    const extra =
      intent.kind === "query"
        ? ` queryKind=${intent.queryKind}`
        : intent.kind === "customer_debt"
          ? ` role=${intent.role}`
          : intent.kind === "unknown"
            ? ` reason=${intent.reason}`
            : "";
    console.error(`FAIL: «${c.input}» → ${intent.kind}${extra} (expected ${JSON.stringify(c.expect)})`);
  } else {
    console.log(`ok: «${c.input}» → ${intent.kind}${intent.kind === "query" ? "/" + intent.queryKind : ""}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\nall ${cases.length} cases passed`);

const profit = parseAssistantCommand("امروز چقدر سود داشتم", ctx);
if (profit.kind !== "query" || !profit.answer.includes("سود")) {
  console.error("profit answer missing", profit);
  process.exit(1);
}
const status = parseAssistantCommand("آقای کمالی چقدر بدهکاره", ctx);
if (status.kind !== "query" || !status.answer.includes("بدهکار") || !status.answer.includes("کمالی")) {
  console.error("customer_status answer missing", status);
  process.exit(1);
}
const chatter = parseAssistantCommand("هوا امروز خیلی خوبه", ctx);
if (chatter.kind !== "unknown" || /کالا/.test(chatter.reason)) {
  console.error("chatter should not look like a missing product", chatter);
  process.exit(1);
}
console.log("answer checks passed");
