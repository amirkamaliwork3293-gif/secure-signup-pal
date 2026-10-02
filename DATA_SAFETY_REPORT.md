# KAMIX — Data Safety & Multi-Device Sync Report

Branch: `claude/loving-mayer-m6czn0` · Date: 2026-10-02

## 1. Summary

**Root cause of "data entered on one device does not appear on another":**
every upload replaced whole JSON columns on the server.

- The app keeps each user's data in **one row of `user_data`**, with one JSONB array per entity (`products`, `invoices`, `customers`, …).
- Each device keeps a full copy in `localStorage` and uploaded **the whole array** with a blind `upsert`.
- So the device that saved last replaced what the other device had just saved.

The server trigger added on 2026-09-02 only partly protected against this:
- It covered 6 of the 12 columns.
- It used an O(n²) loop that takes **27–47 s** on a heavy account (measured below). That is far beyond Supabase's default 8 s statement timeout, so busy shops' saves could fail outright.
- Customer ledgers (debt/payment transactions inside a customer) were still lost whenever two devices touched the same customer.

**What changed:**

- **Uploads are now compare-and-swap.**
  - A device writes only if the server is still at the version it last saw.
  - Otherwise it reads the newest row, merges by row id (never deleting), and retries.
- **The database itself never loses a row**, whatever any device (including an old cached app) sends:
  - every array column is union-merged by id;
  - customer transactions and student payments are merged per entry;
  - delete markers can't be forgotten;
  - `updated_at` is owned by the server.
- **Nothing is hard-deleted any more without a recoverable copy:**
  - the expired-trial cron no longer deletes accounts;
  - any deleted `user_data` row is archived;
  - every user delete is logged together with the deleted content.
- **Other devices update instantly** through a tiny Realtime signal (polling remains as a fallback). They also refresh on focus, resume and reconnect.
- **Sign-out no longer throws away unsaved edits.** Before, the Android app wiped them.
- **A full device storage no longer breaks saving.**

**Verification:**

- Local PostgreSQL 16 with the existing production schema, tested as the `authenticated` role through RLS: trigger behaviour, idempotency, rollback, performance.
- A two-device simulation: 12 scenarios × 2 server modes.
- A **real two-browser end-to-end test**: two Chromium instances, the real app, real supabase-js, and an emulated Supabase.
- The new tests reproduce the reported bugs on the old code and pass on the new code.
- Build, typecheck and lint are unchanged from baseline, and all pre-existing tests still pass.

## 2. Findings and fixes (ranked)

### Critical

| # | Finding | Fix | Where |
|---|---|---|---|
| C1 | **Blind overwrite on every upload.** `runFlushCloudPush` upserted whole arrays. Device B, holding an older copy, removed device A's new invoices/products/customers from the server. They came back only when A opened the app again, and were gone for good if A's storage was cleared. This is the reported multi-device bug. | Compare-and-swap on `updated_at`: `update … eq(updated_at, lastSeen)`, or `insert` for a first device. On conflict, read the full row, merge it into local data via `applyCloudRow` (union by id), and retry. Columns missing on the server are no longer marked as synced. | `src/lib/store.ts:1371` `runFlushCloudPush`, `:1475` `compareAndSwapUserData`, `:1525` `mergeLatestServerRow` |
| C2 | **The server safety net was partial and too slow.** `protect_user_data_catalog` union-merged only 6 columns: `students`, `reminders`, `accounts`, `account_txs`, `production` and `manual_ledger` were overwritten blindly. Its plpgsql loop (`seen text[]`, array concatenation) was O(n²): **47 s / 27 s** for a 10k-invoice / 2k-customer account locally, so heavy users' saves exceeded the statement timeout. | New trigger: set-based union for **all 12 columns** (~1 s for the same account); merge of nested ledgers; tombstone union; server-owned, strictly increasing `updated_at`; the vandalism guards are kept. | `supabase/migrations/20261002120000_data_safety_never_lose_rows.sql` |
| C3 | **Customer debt/payment transactions were lost.** A customer row was last-write-wins as a whole, so a payment recorded on one phone and a debt on another kept only one of them. A customer edit form opened before a payment arrived also erased that payment on save (`customers.update({...staleCustomer})`). | `txs` (and `students[].payments`) are merged per entry on the client (`mergeNestedLedger`) and on the server. Deleting a tx is the explicit `customers.removeTx` and is synced as tombstone `customers.txs`. `customers.update`, `students.update` and list saves keep entries and paid installments that a stale object lacks. | `src/lib/catalog-integrity.ts:576`, `:607`; `src/lib/store.ts:861`, `:1057`, `:2896`, `:3222`; `src/routes/customers.tsx:890` |
| C4 | **Sign-out on the Android app destroyed unsaved edits.** `signOut` dropped the upload queue (`stopCloudSync`) without sending it, then `clearUserOfflineCache` deleted every `*:userId` key, including the dirty markers and the unsynced data. Anything typed in the last ~0.6 s, or while offline / with a failing upload, was gone. | `signOut` first calls `flushPendingCloudWrites()` (up to 8 s). If something is still unsaved, the user is asked. If they confirm, the data stays on the device (account-scoped) and is uploaded at the next sign-in. The local cache is only cleared when everything is on the server. | `src/lib/AuthContext.tsx:375`, `src/lib/store.ts:1240` |
| C5 | **Expired-trial accounts were hard-deleted every 5 minutes.** `cleanup_expired_trials` (pg_cron) deleted `user_data`, the profile and the auth user, with no backup: the snapshot trigger only fires on UPDATE. A user who renewed a day late lost everything. Any other `user_data` delete (admin delete cascade, or the `users_delete_own_data` policy) was also unrecoverable. | The cron job is unscheduled and the function is now a no-op. A `BEFORE DELETE` trigger archives the whole row into `user_data_backups`, which has no FK and therefore survives account deletion. The 40-snapshot pruning never removes these archives. | `supabase/migrations/20261002120100_data_safety_archive_deletes.sql` |

### High

| # | Finding | Fix | Where |
|---|---|---|---|
| H1 | **Endless re-upload ping-pong.** Postgres `jsonb` reorders object keys, and the local/cloud comparison used plain `JSON.stringify`. So after every refresh every column looked "changed", got re-uploaded, and the other device then did the same. Proven in a test: idle devices re-uploaded `products+customers+current_invoice` on every refresh. That is constant egress and extra overwrite windows. | Key-order-insensitive comparison (`stableStringify`). | `src/lib/catalog-integrity.ts:738` |
| H2 | **`localStorage` full** (≈5 MB, which busy shops reach) made `setItem` throw inside `write()`. The change was half-applied and never queued for the cloud. | Writes that the device refuses are kept in memory, read back by the app and uploaded, and a red banner explains the situation. | `src/lib/store.ts:710`, `src/components/Layout.tsx:192` |
| H3 | **Deleted rows came back.** Delete markers live in `settings.catalogTombstones`. A device uploading older settings could drop them, so deleted items reappeared on devices that had not seen the delete. | The client merges before uploading (C1), and the server trigger unions tombstones on every write. | migration 1; `store.ts` |
| H4 | **No real-time propagation.** Other devices only polled every 40 s while visible. The `updated_at` check compared a client-made string with the server format, so it never matched and every poll downloaded the full row. | `user_data_sync_signal` table (only `user_id`, `updated_at`; RLS-scoped) in the `supabase_realtime` publication, plus a client subscription with backoff and catch-up. Also refresh on focus, bfcache restore, resume and reconnect. CAS stores the server's own `updated_at`, so the cheap check now works. | `supabase/migrations/20261002120200_sync_realtime_signal.sql`, `src/lib/realtime-sync.ts`, `store.ts:967` |
| H5 | **Columns missing on the server were reported as saved.** When a column was missing (migration not applied), the upload silently dropped it but still cleared its "unsaved" marker. | The skipped columns stay dirty and the error is surfaced. | `store.ts:1371` |
| H6 | **Student payments and paid installments were lost.** A student form opened before a payment arrived erased that payment on save. | `students.update` keeps payments and paid state; un-paying stays explicit. | `store.ts:3222` |

### Medium

| # | Finding | Status |
|---|---|---|
| M1 | **Wrong phone clock.** Row conflicts are decided by `updatedAt`. A phone with a slow clock always lost, so its edits "did not save". | **Mitigated.** The server sets `updated_at`, and the client learns its clock offset from each save and stamps rows with corrected time (`store.ts:782`). |
| M2 | **Spurious "changed" stamps.** A row re-saved unchanged by a form got a new `updatedAt` purely because of key order, and could then beat a real edit made on another device. | **Fixed** (`store.ts:803`). |
| M3 | **Category delete had no confirmation.** All other deletes already asked. | **Fixed** (`src/routes/products.tsx:1331`). |
| M4 | **Delete audit log only partly existed.** It was only a manual script (`scripts/DELETE-LOG.sql`), it did not keep the deleted content, and a logging error blocked the save. | **Fixed.** Now part of migration 2: it keeps `row_data` (including deleted customer txs) and never blocks a save. Support restore: `scripts/RESTORE-DELETED-ROW.sql`. |
| M5 | **Concurrent stock changes for the same product on two devices.** Stock is an absolute number on the product row, so one decrement can be lost if two devices sell the same product within the same sync window. | **Not changed.** See §3. |
| M6 | **The Android app is read-only while offline.** Writes are blocked with a message, and there is no offline queue in the APK. | **Not changed.** This is an explicit, visible product decision; no silent loss. |

### Low

| # | Finding | Status |
|---|---|---|
| L1 | IDs come from `Math.random` + time. The collision chance across devices is negligible. | Not changed |
| L2 | The flush on tab close / backgrounding can be cut off by the OS. | Acceptable: the dirty marker persists and the change is re-sent on the next start (tested). |
| L3 | Deleted rows stay in the server arrays as a soft delete, so arrays only grow. | Intended (recoverability). The size is small in practice. |
| L4 | `user_data_backups` keeps 40 snapshots at 6 h spacing (~10 days). | Not changed (storage cost). Archives from deletes are excluded from pruning. |
| L5 | The Supabase 1,000-row limit. | Not applicable: one row per user, and the admin listing already pages. |
| L6 | RLS on `user_data`. | Verified correct (own row only; admins read). New tables are RLS-scoped. |
| L7 | Service workers. | Checked: `sw.js` self-destructs; the Capacitor worker is network-first and only caches the shell. No user data is in Cache Storage and nothing clears `localStorage` on update. |

## 3. Deliberately not changed (and why)

- **Stock as a movement ledger (M5).** The correct fix is to derive stock from a ledger of movements: sales, purchases, production and manual adjustments, each with an id. Concurrent movements then merge like customer txs. This changes the product model and every place that reads `stock` (inventory, reports, production, invoice stock checks). It is too broad to do safely in this pass. The window is small: two devices selling the same product within seconds of each other, and now the server and client always converge to one value. Recommended as the next project.
- **In-app trash/restore UI.** Deleted rows already stay on the server and are logged with their content. However, a delete is a tombstone that every device unions forever, so a reliable "undo" needs timestamped delete/restore markers in a new format. Instead, `scripts/RESTORE-DELETED-ROW.sql` lets support restore any logged delete within minutes, as a copy with a new id that every device shows again.
- **Moving local data from `localStorage` to IndexedDB.** Every store API is synchronous; switching is a large, risky refactor. The quota case is now handled safely (H2).
- **Normalising `user_data` into per-row tables** (one table per entity with `updated_at` / `deleted_at` per row). This is the long-term architecture, but it requires a data migration for 2,000 live users. The merge semantics implemented now are exactly what such a migration would preserve.
- **Revoking `DELETE` on `user_data` from `authenticated`.** The archive trigger makes any delete recoverable without changing privileges.
- **Offline writing in the Android app (M6).** This is a product decision.

## 4. SQL to run on production — in this order

All three are **additive, idempotent and safe to run live**, in the Supabase SQL Editor. They are **compatible with app versions still cached on devices**: an old client's blind `upsert` was tested through RLS as the `authenticated` role. The new client also works **before** they are applied (tested as "blind server"), so the deploy order is flexible. Running SQL first is recommended.

| Order | Migration | What it does | Rollback |
|---|---|---|---|
| 1 | `supabase/migrations/20261002120000_data_safety_never_lose_rows.sql` | Union-by-id for all columns, nested ledger merge, tombstone union, server `updated_at` (C2, C3, H3, M1) | `supabase/rollbacks/20261002120000_data_safety_never_lose_rows.rollback.sql` (restores the 2026-09-02 functions exactly) |
| 2 | `supabase/migrations/20261002120100_data_safety_archive_deletes.sql` | Stops trial deletion, archives deleted rows, delete log with content (C5, M4) | `supabase/rollbacks/20261002120100_data_safety_archive_deletes.rollback.sql` (does **not** re-enable the trial-deletion cron) |
| 3 | `supabase/migrations/20261002120200_sync_realtime_signal.sql` | Realtime sync signal (H4) | `supabase/rollbacks/20261002120200_sync_realtime_signal.rollback.sql` |

Notes:
- `scripts/DELETE-LOG.sql` is superseded by migration 2; there is no need to run it. If it was already run, migration 2 upgrades it in place.
- Maintenance escape hatch (SQL Editor only): `BEGIN; SET LOCAL kamix.allow_row_removal = 'on'; …; COMMIT;` lets an admin really remove rows in that transaction.
- Rollbacks keep every table and column that holds user data.

## 5. Deployment plan

1. **Before:** take a Supabase backup (Dashboard → Database → Backups). Then run `scripts/INTEGRITY-SNAPSHOT.sql` sections A and B with label `'before'`.
2. **Run migrations 1 → 2 → 3** (§4). After each, check:
   - `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.user_data'::regclass AND NOT tgisinternal;` should list `user_data_protect_catalog`, `user_data_snapshot`, `user_data_touch_updated_at`, `user_data_archive_on_delete`, `user_data_log_deletes` and `user_data_sync_signal`.
   - Edit something in the live app and confirm it saves (no red banner).
3. **Deploy the frontend:** merge this branch and publish in Lovable. The Android APK loads the live site (network-first), so **no APK rebuild is needed**; open apps pick up the new code on next launch or reload.
4. **After 1 hour and after 24 hours:**
   - Run section B with label `'after'`, then section C. **It must return no rows**; any row is a user whose count went down.
   - Check `SELECT field, count(*) FROM user_data_delete_log WHERE created_at > now() - interval '1 day' GROUP BY 1;` for plausible delete volumes.
   - Check `SELECT count(*) FROM cron.job WHERE jobname = 'cleanup-expired-trials';` returns 0.
5. **If anything misbehaves:**
   - Frontend: revert the merge in Lovable. The old app keeps working with the new SQL.
   - SQL: run the matching rollback. Rollbacks are live-safe and drop no user data.

## 6. Manual test checklist

**Two-device sync** (same account on phone A and browser B):
- [ ] On A add a product. On B (without reloading) it appears within ~2 s (Realtime), or on focus/return to the app.
- [ ] On A and B, within the same minute, add a different product each. Both end up on both.
- [ ] Record a payment for customer X on A and a debt for X on B at the same time. Both transactions show on both, and the balance is identical.
- [ ] On B open "edit customer X". On A record a payment for X. On B change the phone number and save. The payment is still there everywhere.
- [ ] Delete a product on A. It disappears on B and does not come back after B edits other products.
- [ ] Delete a transaction on A. It does not come back after B records another transaction for the same customer.
- [ ] Change shop settings on A. They appear on B.

**WebView / Android app:**
- [ ] Record an expense and immediately tap «خروج». No dialog appears, and the expense is on the website.
- [ ] Turn on airplane mode and tap «خروج». You are asked; tap «انصراف». Reconnect and sign out: no dialog.
- [ ] Clear the app's data in Android settings, open it and sign in. Everything comes back from the server.
- [ ] Put the app in the background for 10 minutes, change data on the website, then open the app. The change is there.

**Login / logout / sessions:**
- [ ] Sign out and in as another account on the same device. No data is mixed between accounts.
- [ ] Sign back in to the first account. Its data is intact.

**Core flows still work:**
- [ ] Create, edit and delete a sales invoice (with and without restocking).
- [ ] Credit invoice → the customer's debt appears.
- [ ] Purchase invoice → stock and the supplier's credit.
- [ ] Customers: add, edit, delete (with confirmation), delete all.
- [ ] Expenses, reminders, accounts, students.

**Data integrity:** §5 step 4 (before/after snapshot compare returns no rows).

## 7. Automated tests

| Test | Run | What it proves |
|---|---|---|
| `scripts/test-sync-two-devices.ts` | `npx tsx --tsconfig scripts/tsconfig.sync-test.json scripts/test-sync-two-devices.ts` | 12 scenarios with two independent app instances on one fake server, each against a blind server and a trigger-like server (jsonb key order). Covers concurrent adds, ledger merge, stale edit form, delete propagation, old-app concurrent write, wiped WebView storage, no idle ping-pong, sign-out flush, offline sign-out, full storage, and Realtime. On the previous code, scenarios 1, 2, 3, 5, 6 and 8 fail (`KEEP_GOING=1` lists them). |
| `scripts/e2e-two-browsers.mjs` | See the header of the file (needs `vite dev` and Playwright) | Two real Chromium browsers, the real app, real supabase-js. On the previous code the first check fails: the server keeps only `p1,pB`. |
| Existing store tests | `scripts/test-store-*.ts`, `scripts/test-stock-customers-purchases.ts` | Still pass. The fake server now speaks compare-and-swap, and every write is still checked for account isolation. |
| SQL | Applied to a local PostgreSQL 16 with the existing migrations, as `authenticated` through RLS | Union, nested ledgers, tombstone union, CAS, old-client upsert, empty-array uploads, idempotency (applied twice), rollback + re-apply, performance (1 s vs 47 s), delete log, archive on cascade delete, signal RLS. |

**Baseline comparison:**
- `tsc`: 1 pre-existing error, `src/routes/register.tsx:548`.
- `eslint`: 2,584 pre-existing problems; the count is unchanged and the changed files add none.
- `vite build`: passes.
- Three pre-existing test failures are unrelated to this work and failed before it too:
  - `test-invoice-html.ts` (invoice design);
  - `test-backup-pdf.mjs` (module runner);
  - `test-bulk-import.mjs` (requires xlsx 0.20 from the SheetJS CDN, which is blocked in this environment).
