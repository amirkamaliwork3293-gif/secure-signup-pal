# KAMIX landing page redesign — report

Branch: `landing-page-redesign` (created from `claude/magical-shannon-v86oqc` @ `2f20fe4`) · Date: 2026-10-04

## 1. What was built, and why

The landing page (`src/components/LandingPage.tsx`, shown by `AuthGuard` to signed-out web visitors) was rebuilt from scratch. KAMIX has no free trial, so the page is designed to do what a trial would: **show the product working** and **remove every reason to hesitate before paying**.

**Visual identity.** The brand colours come straight from the KAMIX app mark (blue `#4f8cff` → indigo `#5a5bff` → violet `#7a4dff`). They are used as the gradient accent on a deep-navy "night" surface, alternating with clean white and tinted sections. Typography uses the fonts the page already had: Estedad (self-hosted) for display, Vazirmatn for body text. The logo SVG is the same artwork. The result reads as a premium fintech product without dropping the existing identity.

**Page structure (persuasion order):**

1. **Hero** (dark, aurora + grid): one clear promise — «فاکتور را بگو، بارکد را نشان بده، حساب را بپرس.» Primary CTA → `/register`, secondary "see how it works" anchor, "already have an account? log in" → `/login`, plus real proof chips (2,000+ active businesses, Android + web, Jalali dates/Toman). The animated product visual (dashboard window, phone, floating result chips) is pure CSS and server-rendered.
2. **Module marquee** listing real app sections.
3. **Signature trio**: three cards linking to…
4. **Voice invoice showcase**: a self-playing waveform → transcript → invoice that builds line by line → "saved, stock reduced".
5. **Camera scan showcase**: a phone with a camera view, scanner beam, lock-on reticle, "added to invoice" toast, and a running invoice.
6. **Smart assistant showcase**: a chat with real commands (profit today, record a customer debt, low-stock items, a cheque reminder) and answer cards.
7. Admin-managed **stories and videos** (still driven by `landing_content`, as before).
8. **Everything else**: a feature grid (bento) of real modules.
9. **"Why KAMIX"**: KAMIX compared with *paper ledger and Excel* only (no claims about named competitors).
10. **Security and data safety**: only verified facts (see §2).
11. **How to start**: the real four-step flow (sign up → card-to-card payment and receipt → approval → first invoice).
12. **Pricing**: the real plans and prices from public settings, with the same discount and recommended-plan rules as before. Per-month equivalents are shown only when they really are a saving.
13. **FAQ** (10 purchase objections), also emitted as `FAQPage` JSON-LD.
14. **Closing CTA**, active-business counter, and a **footer** with the admin-configured support channels and the APK link.
15. On mobile, a **sticky CTA bar** appears after the hero. The support button is kept (it appears when a phone or WhatsApp number is configured).

## 2. Real features showcased — and how each was verified

| Feature on the page | Evidence in the codebase |
|---|---|
| **Voice invoice entry** | `src/routes/voice.tsx`, `src/lib/voice/speech.ts` (Web Speech API on web, Android `SpeechRecognizer` in the APK, server transcription fallback in `stt.functions.ts`), `persian-nlu.ts` matches spoken names against the user's product list. Typing fallback exists. Voice product entry: `src/routes/voice-products.tsx`. |
| **Camera barcode / QR scanning** | `src/features/scanner/*` (zxing-wasm + native), `src/routes/scan.tsx` calls `tryAddProductToInvoice` → `invoice.save`. Label printing: `BarcodePrintModal.tsx`. Quick add: `src/routes/quick-add.tsx`. |
| **Smart assistant** | `src/components/SmartAssistant.tsx` + `src/lib/voice/assistant-nlu.ts` / `assistant-queries.ts`. Intents: profit, sales, expenses, most-profitable, top-selling, best customers, debtors/creditors, customer status, low stock, customer debt, expense, reminder, price edit, product add, open invoice. Every demo sentence is from `assistant-checklist.md` or matches its regexes. **Described honestly**: it is a deterministic Persian command parser computing answers from the user's own data, *not* an LLM chatbot ("یک چت‌بات همه‌چیزدان نیست"). |
| Sales/purchase invoices, discounts, cheques, invoice designer, receipt print, PDF/share | `routes/invoices.tsx`, `purchases.tsx`, `invoice-design.tsx`, `ChequeEditor.tsx`, `lib/invoice-pdf.ts`, `lib/receipt.ts`, `InvoiceMessageDialog.tsx` |
| Customers, debtors/creditors, due reminders, SMS/WhatsApp message text | `routes/customers.tsx`, `DueAlertsDialog.tsx`, `lib/sms-templates.ts` |
| Inventory, low stock, bulk import from Excel, bulk price change | `routes/inventory.tsx`, `lib/stock-moves.ts`, `BulkImportModal.tsx`, `BulkPriceChangeModal.tsx` |
| Profit/sales reports (Jalali day/week/month) | `routes/reports.tsx` |
| Excel / PDF / full JSON backup export | `routes/backup.tsx`, `lib/backup-export.ts`, `lib/backup-pdf.ts`, `lib/full-backup.ts` |
| Store page + digital menu with QR | `routes/store.$storeId.tsx`, `store-qr.tsx`, `menu.tsx`, `menu-qr.tsx` |
| Weekly schedule and reminders | `routes/reminders.tsx` |
| Global search + invoice history | `GlobalSearch.tsx`, `routes/history.tsx` |
| Gold/coin live rates, students and tuition, production and formulas | `routes/gold.tsx` + `lib/gold.functions.ts` (TGJU), `routes/students.tsx`, `routes/production.tsx` |
| Multi-device sync that never deletes rows | `DATA_SAFETY_REPORT.md`, `lib/store-merge.ts`, `lib/realtime-sync.ts` |
| Per-account data isolation | Supabase RLS (see `DATA_SAFETY_REPORT.md`) and `lib/account-isolation.ts` |
| Offline: saved data viewable in the Android app | `lib/offline-cache.ts`, `lib/online-status.ts` (`isCapacitorOfflineReadOnly`) |
| Expired subscription keeps data (read-only) | `RequireActiveSubscription.tsx`, `SubscriptionAccess.tsx` (`readOnly` mode), `routes/renew.tsx` |
| Android app + web | `public/kamali-accounting.apk` (`ApkDownloadButton.APK_DOWNLOAD_URL`), Capacitor detection in `__root.tsx` |
| Payment flow | `routes/register.tsx`: plan, card-to-card, receipt or tracking code, then admin approval |

**Deliberately not claimed:** no free trial (a trial server function exists, but there is no public trial UI, and you said there is no trial). No refund or guarantee. No device-count limit. No uptime or encryption claims beyond what the code shows. No named-competitor claims. The voice engine is not described as "on-device", because web speech recognition can use the browser vendor's service.

**Removed from the old page:** `ActiveUsersBadge` showed a **fabricated** live count (a random number between 5,000 and 6,000 that ticked up on a timer). It was replaced by the real figure from config (2,000+, as you provided), with a one-time count-up animation.

## 3. Placeholders that need your real data

All of these live in **`src/components/landing/config.ts`**. Anything empty is simply not rendered.

| Key | Current value | What to provide |
|---|---|---|
| `activeBusinesses` | `2000` (from your brief) | Keep it current. Set `0` to hide it everywhere. |
| `testimonials` | `[]` → section hidden | Real quotes with the customer's permission: `{ name, business, quote }`. |
| `guarantee` | `null` → hidden | Only if you adopt a real refund/satisfaction policy: `{ title, body }`. |
| `supportHours` | `""` → hidden | Support hours text shown above the contact links. |
| Contact channels | from admin panel (`landing_content.contact`) | Phone/WhatsApp/Telegram/Instagram/email in Admin → landing editor. With none set, the footer contact column and the floating support button stay hidden. |

Copy you may want to review: the FAQ answers (`src/components/landing/faq.ts`), especially "why no free trial" and "payment/activation" (no activation time is promised).

## 4. Files changed

| File | Change |
|---|---|
| `src/components/LandingPage.tsx` | Rewritten (same export, same props: none). |
| `src/components/landing/landing.css` | **New.** Page-scoped stylesheet (`.kx` scope), loaded only when the landing renders. |
| `src/components/landing/HeroVisual.tsx` | **New.** CSS-animated hero mockup, part of SSR. |
| `src/components/landing/demos.tsx` | **New.** Voice / scan / assistant demos. **Lazy chunk.** |
| `src/components/landing/Pricing.tsx`, `pricing-utils.ts` | **New.** Plan cards and recommended-plan logic (ported from the old page). |
| `src/components/landing/hooks.ts`, `KamixMark.tsx` | **New.** In-view / reduced-motion / step-loop hooks, logo mark. |
| `src/components/landing/config.ts`, `faq.ts` | **New.** Trust facts, placeholders, FAQ. |
| `src/components/LiveFeatureShowcase.tsx` | **Deleted.** Landing-only, now replaced. It was not imported anywhere else. |
| `src/styles.css` | Removed ~1,430 lines of landing-only CSS (`.lp-*` and `.lfs-*`), so **every in-app page now downloads less CSS**. Kept: `.landing-page` base rules, the critical `html[data-app="1"] .landing-page { display:none }` rule, and the `lp-fade-up` keyframes (still referenced by `.sg-stagger`). |
| `docs/landing-redesign/*.jpg` | Screenshots. |
| `LANDING_REDESIGN_REPORT.md` | This report. |

**Not touched:** `AuthGuard`, `AuthContext`, routing, `routes/index.tsx` (meta and caching unchanged), Supabase code, SQL, store/sync, payment/subscription logic, `localStorage`/IndexedDB keys, and in-app screens. The new code reads data only through the same two calls the old page used: `loadLandingContent()` and `getPublicSettings()`. It writes nothing, anywhere.

## 5. Performance (production `vite build`, before → after)

| Asset | Before | After | Who downloads it |
|---|---|---|---|
| Global `styles.css` | 202.4 kB / **33.6 kB gz** | 166.6 kB / **27.4 kB gz** | Everyone, including logged-in users and the Android app (**−6.2 kB gz**) |
| `AuthGuard` chunk (contains the landing) | 52.1 kB / 15.7 kB gz | 61.3 kB / 18.5 kB gz | Every route (+2.8 kB gz: new copy, FAQ, hero visual) |
| `landing.css` (new) | — | 50.5 kB / 10.9 kB gz | Only when the landing renders (React-hoisted `<link>`) |
| `demos` chunk (new) | — | 9.3 kB / 3.4 kB gz | Lazy: only when a visitor scrolls within 600 px of a demo |
| New npm dependencies | — | **none** | — |

- **Layout stability:** measured CLS **0.016** at 390 px over a full scroll (PerformanceObserver), well under the 0.1 "good" threshold. Demo slots reserve their size, so lazy mounting causes no shift.
- **First paint:** the hero (copy, CTAs, product visual) is server-rendered with CSS-only entrance animation. The landing stylesheet is hoisted into `<head>` in the SSR HTML (verified), so there is no unstyled flash. No images are needed for the hero.
- **Runtime cost:** animations use `transform`/`opacity` only. The demos pause when off-screen or when the tab is hidden (verified: no state change over 5 s while scrolled away). The scroll handler is rAF-throttled and passive. Pointer parallax runs only on fine-pointer devices and is off under reduced motion.
- Lighthouse could not be run in this sandbox (no Lighthouse install, and external fonts and Supabase are blocked by the network policy). Treat the numbers above as bundle and layout measurements, not field Core Web Vitals.

## 6. Verification performed

- **Typecheck** (`tsc --noEmit`): 1 error before, 1 after. It is the same pre-existing error in `src/routes/register.tsx:548`, which I did not touch.
- **Lint** (`eslint .`): 2,574 errors before → 2,408 after. The removed old landing code accounts for the drop. **All new and changed landing files lint clean** (0 errors, 0 warnings).
- **Build** (`vite build`): passes.
- **Tests** (all `scripts/test-*` and `src/lib/*.test.ts`): 36 pass, as at baseline.
  - `test-bulk-import.mjs` fails both before and after. That is a local environment issue: the sandbox could not download the pinned sheetjs tarball, so `xlsx@0.18.5` was used locally.
  - The four store/sync tests time out under `bun` on the untouched baseline too. With their documented runner (`npx tsx --tsconfig scripts/tsconfig.sync-test.json …`), all four **pass** on this branch.
- **Headless Chromium** at 360, 390, 768, 1280 and 1920:
  - no horizontal scroll (`scrollWidth == clientWidth`) and no broken images;
  - no console errors from the page. The only errors are the sandbox blocking the jsDelivr Vazirmatn font and the dummy local Supabase URL.
  - The same checks pass with `prefers-reduced-motion: reduce`: demos park on a complete frame (the voice invoice shows all three rows), the marquee is static, and reveals show immediately.
- **CTAs:** every link on the page points to `/register` (13 links), `/login` (5), the APK (2) or in-page anchors. Clicking the hero CTA, the "log in" link and a plan card navigated to `/register`, `/login` and `/register`, and the register form rendered normally.
- **Smoke test, signed out:** `/login` renders, and a protected route (`/products`) still shows the landing.
- **Signed-in users:** I could not log in from the sandbox (no Supabase keys). Behaviour is unchanged by construction: `AuthGuard` and `AuthContext` are untouched, `LandingPage` keeps the same export, and the in-app `data-app` hiding rule is preserved. See the manual checklist below.
- **Mobile menu:** opens, and closes on Escape. A skip link is provided, focus rings are visible, and the FAQ uses native `<details>`, so it works with the keyboard and without JS.

## 7. Preview locally

```bash
git checkout landing-page-redesign
bun install            # or npm install
# .env.local needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (same as production)
bun run dev            # open http://localhost:8080/ (or the port Vite prints) in a private window
```

To test reduced motion: Chrome DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce".

## 8. Deploy

The branch has been pushed but **not merged**. When you are happy:

1. Open a PR from `landing-page-redesign` into your connected/production branch and review the screenshots in `docs/landing-redesign/`.
2. Merge with a normal merge commit (no force-push or rebase, so Lovable keeps its history).
3. Lovable / your existing pipeline builds and deploys as usual. No env vars, SQL or config changes are required.
4. Optional: fill in the placeholders in `src/components/landing/config.ts`.

## 9. Manual test checklist (5 minutes)

- [ ] Signed out, desktop: open `/`. The hero animates, the demos play as you scroll, and nothing overlaps.
- [ ] Signed out, phone: open `/`. No sideways scrolling, the menu button works, and the sticky "شروع با KAMIX" bar appears after the hero.
- [ ] Click «همین الان شروع کن», any plan card and the closing CTA. Each opens the **register** page.
- [ ] Click «ورود» (header) and «وارد شو» (hero). Each opens the **login** page.
- [ ] Prices and any discount badge match what is configured in Admin → plans.
- [ ] Contact channels set in Admin → landing editor appear in the footer, and the floating support button calls/opens WhatsApp.
- [ ] Stories and videos added in Admin → landing editor appear between the assistant demo and the feature grid.
- [ ] Signed in on the web: open `/`. You land in the app (invoice workspace) as before, and in-app pages look unchanged.
- [ ] Android app: open it. The landing never flashes, and the login/app screens behave as before.
- [ ] Log out from the app on the web. The landing shows again.
