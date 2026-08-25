/**
 * تست مبلغ مرکب فارسی + افزودن محصول با جمله‌بندی آزاد + فاکتور آزاد.
 * اجرا: npx --yes tsx --tsconfig tsconfig.json scripts/test-fa-amount.ts
 */

import { collectAmountRuns, peelUnitPrice, tokenToNumber } from "../src/lib/voice/fa-amount";
import { normalizeFa, parseVoiceText } from "../src/lib/voice/persian-nlu";
import { parseProductVoiceText } from "../src/lib/voice/product-nlu";
import { parseAssistantCommand, type AssistantContext } from "../src/lib/voice/assistant-nlu";
import type { Product } from "../src/lib/store";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("ok:", label);
  else {
    failed++;
    console.error("FAIL:", label, detail ?? "");
  }
}

function tokens(s: string) {
  return normalizeFa(s).split(" ").filter(Boolean);
}

{
  const runs = collectAmountRuns(tokens("یک میلیون و پانصد هزار تومان"));
  check("compound 1.5M is one run", runs.length === 1 && runs[0].amount === 1_500_000, runs);
}

{
  const runs = collectAmountRuns(tokens("1 میلیون"));
  check("digit میلیون", runs.length === 1 && runs[0].amount === 1_000_000, runs);
}

{
  const runs = collectAmountRuns(tokens("یک میلیون"));
  check("word میلیون", runs.length === 1 && runs[0].amount === 1_000_000, runs);
}

{
  const peeled = peelUnitPrice(tokens("20 تا دمپایی هر عدد یک میلیون و پانصد هزار تومان"));
  check("peel unit price 1.5M", peeled.unitPrice === 1_500_000, peeled);
  check(
    "qty tokens remain",
    peeled.rest.join(" ").includes("20") && peeled.rest.join(" ").includes("دمپایی"),
    peeled.rest,
  );
}

{
  const r = parseProductVoiceText("20 تا شلوار هر عدد 1 میلیون تومان");
  check("product add canonical", r.items.length === 1 && r.items[0].name.includes("شلوار"), r.items);
  check("product add price 1M", r.items[0]?.price === 1_000_000, r.items[0]);
  check("product add stock 20", r.items[0]?.stock === 20, r.items[0]);
}

{
  const r = parseProductVoiceText("20 تا سوار هر عدد یک میلیون تومان");
  check("product add spoken یک میلیون", r.items[0]?.price === 1_000_000, r.items[0]);
  check("product add does not split 500k", r.items.length === 1, r.items);
}

{
  const r = parseProductVoiceText("شلوار هر عدد یک میلیون و پانصد هزار تومان");
  check("product add compound price", r.items[0]?.price === 1_500_000, r.items[0]);
  check("product add compound not split", r.items.length === 1, r.items);
}

const emptyCtx: AssistantContext = {
  products: [],
  customers: [],
  invoices: [],
  expenses: [],
  now: Date.parse("2026-08-21T12:00:00+03:30"),
};

{
  const intent = parseAssistantCommand(
    "20 تا سوار هر عدد یک میلیون تومان به محصولاتم اضافه کن",
    emptyCtx,
  );
  check("flex phrasing is product_add", intent.kind === "product_add", intent);
  if (intent.kind === "product_add") {
    check("flex name سوار", intent.items[0]?.name.includes("سوار"), intent.items);
    check("flex price 1M", intent.items[0]?.price === 1_000_000, intent.items);
    check("flex qty 20", intent.items[0]?.stock === 20, intent.items);
  }
}

{
  const intent = parseAssistantCommand("20 تا شلوار هر عدد 1 میلیون تومان اضافه به محصولات", emptyCtx);
  check("canonical still product_add", intent.kind === "product_add", intent);
}

{
  const intent = parseAssistantCommand(
    "۱۵۰ عدد پیراهن با قیمت ۲۰۰ هزار تومان اضافه شود",
    emptyCtx,
  );
  check("اضافه شود still product_add", intent.kind === "product_add", intent);
}

{
  const intent = parseAssistantCommand("20 تا دمپایی هر عدد یک میلیون و پانصد هزار تومان", emptyCtx);
  check("free invoice intent", intent.kind === "invoice_item", intent);
  if (intent.kind === "invoice_item") {
    const item = intent.result.items[0];
    check("free invoice name", item?.productPhrase.includes("دمپایی"), item);
    check("free invoice qty 20", item?.quantity === 20, item);
    check("free invoice unit price 1.5M", item?.unitPrice === 1_500_000, item);
    check("free invoice no catalog", item?.confidence === "none", item);
  }
}

{
  const shirt: Product = {
    id: "p-shirt",
    name: "تیشرت",
    price: 200000,
    category: "پوشاک",
    code: "1",
    stock: 20,
  };
  const r = parseVoiceText("۲ تا تیشرت هر عدد یک میلیون و پانصد هزار تومان", [shirt]);
  check("catalog + custom price", r.items[0]?.unitPrice === 1_500_000, r.items[0]);
  check("catalog still matched", r.items[0]?.confidence === "high", r.items[0]);
}

check("tokenToNumber یک", tokenToNumber("یک") === 1);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall fa-amount / free-invoice checks passed");
