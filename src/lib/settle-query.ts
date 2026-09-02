/**
 * Query builders in `@supabase/supabase-js` are thenable (they have `.then`)
 * but they are not Promises — they do not implement `.catch` / `.finally`.
 *
 * `await supabase.from("…").insert(…).catch(() => {})` therefore throws
 * `insert(...).catch is not a function` and aborts signup before the request
 * is saved. Await the builder, or wrap it with this helper.
 */
export async function settleQuery(query: PromiseLike<unknown>): Promise<void> {
  try {
    await query;
  } catch {
    // optional write / best-effort cleanup
  }
}
