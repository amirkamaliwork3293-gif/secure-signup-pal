/**
 * ادغام فاکتور محلی/ابر بدون حذف ثبت‌شده‌ها.
 * اجرا: node --experimental-strip-types scripts/test-store-merge.mjs
 */
import assert from "node:assert/strict";
import {
  unionMergeById,
  mergeOpenInvoiceBoard,
  historyIds,
  pickRicherRow,
} from "../src/lib/store-merge.ts";

const inv = (id, items, createdAt = 1) => ({
  id,
  createdAt,
  items: items.map((name) => ({ productId: name, name, price: 1, quantity: 1 })),
  total: items.length,
});

{
  const local = [inv("a", ["نان"])];
  const cloud = [inv("b", ["شیر"])];
  const merged = unionMergeById(local, cloud);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "a");
  assert.equal(merged[1].id, "b");
}

{
  const local = [inv("a", ["نان", "پنیر"], 200)];
  const cloud = [inv("a", ["نان"], 100)];
  const merged = unionMergeById(local, cloud);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].items.length, 2, "نسخهٔ کامل‌تر محلی بماند");
}

{
  const local = [inv("a", ["نان"])];
  const cloud = [inv("a", ["نان"]), inv("b", ["شیر"])];
  const merged = unionMergeById(local, cloud, new Set(["b"]));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "a");
}

{
  const richer = pickRicherRow(inv("x", ["a"]), inv("x", ["a", "b"]));
  assert.equal(richer.items.length, 2);
}

{
  const local = { open: [inv("draft", ["نان"])], activeId: "draft" };
  const cloud = { open: [inv("old", ["شیر"])], activeId: "old" };
  const board = mergeOpenInvoiceBoard(local, cloud, new Set());
  assert.equal(board.open.length, 2);
  assert.ok(board.open.some((i) => i.id === "draft"));
  assert.ok(board.open.some((i) => i.id === "old"));
  assert.equal(board.activeId, "draft");
}

{
  const local = { open: [inv("fresh", [])], activeId: "fresh" };
  const cloud = { open: [inv("sold", ["نان", "شیر"])], activeId: "sold" };
  const board = mergeOpenInvoiceBoard(local, cloud, historyIds([inv("sold", ["نان", "شیر"])]));
  assert.equal(
    board.open.some((i) => i.id === "sold"),
    false,
    "فاکتور ثبت‌شده نباید دوباره باز شود",
  );
  assert.equal(board.open.length, 1);
  assert.equal(board.open[0].id, "fresh");
}

{
  const local = { open: [inv("sold", ["نان"])], activeId: "sold" };
  const cloud = { open: [inv("sold", ["نان"])], activeId: "sold" };
  const board = mergeOpenInvoiceBoard(local, cloud, new Set(["sold"]));
  assert.equal(board.open.length, 0);
  assert.equal(board.activeId, "");
}

console.log("ok: store-merge invoice persist");
