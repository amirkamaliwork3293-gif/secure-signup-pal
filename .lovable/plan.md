# برنامه پیاده‌سازی

## ۰) رفع باگ ویس در APK (پیش‌نیاز کوچک)
در `src/routes/voice.tsx` بعد از تشخیص، بنر «محصول پیدا نشد / محصول اضافه شد» در WebView نمایش داده نمی‌شود. علت: state پس از STT در حالت native ست نمی‌شود یا toast/banner داخل شرط وب فقط رندر می‌شود. منطق نمایش نتیجه (پیدا شد/پیدا نشد + دکمه «افزودن محصول جدید») را به مسیر مشترک منتقل می‌کنم تا در APK و سایت یکسان کار کند.

## ۱) منوی دیجیتال + کیوآرکد

### دیتابیس (migration)
- جدول `menu_categories` (id, user_id, name, sort_order, created_at) با RLS + GRANT
- جدول `menu_items` (id, user_id, category_id, name, price, description, image_url, sort_order, is_available, created_at) با RLS + GRANT
- سیاست SELECT برای `anon` (نمایش عمومی منو با user_id در URL)
- باکت `menu-images` (public read)

### فایل‌ها
- `src/routes/menu.tsx` — داشبورد ادمین کاربر: CRUD دسته و آیتم، آپلود عکس، drag-to-sort
- `src/routes/menu.qr.tsx` — پیش‌نمایش QR + اسلایدر اندازه (سانتی‌متر) + دکمه پرینت + دانلود PNG/PDF، با قالب «نام کافه + اسکن کنید»
- `src/routes/m.$userId.tsx` — صفحه عمومی منو (بدون لاگین، SSR-friendly با server publishable client + `TO anon` policy)، تب‌بندی دسته‌ها، کارت عکس‌محور، انیمیشن نرم، هماهنگ با تم فعلی
- لینک «منوی دیجیتال» در `Layout.tsx`

### چاپ
استفاده از همان منطق `src/lib/print.ts` و `BarcodePrintModal` برای حس یکدست. QR با کتابخانه `qrcode` (در پروژه استفاده‌شده) تولید می‌شود.

## ۲) تمدید طرح (Renewal flow)

### رفتار
- داده‌ها هرگز پاک نمی‌شوند (وضعیت `expired` فقط دسترسی را قطع می‌کند — همین الان هم همینطور است).
- در `AuthGuard.tsx` حالت `expired`: دکمه «تمدید اشتراک» به‌جای `/register` به مسیر جدید `/renew` می‌رود.
- `src/routes/renew.tsx`: کاربر در همین حساب لاگین است؛ فقط انتخاب پلن + آپلود رسید. در `signup_requests` رکوردی با `type='renewal'` و `user_id` فعلی ایجاد می‌شود (ستون `request_type` و `target_user_id` اضافه می‌شود).
- در `admin.tsx` بعد از تایید درخواست renewal: `end_date` پروفایل کاربر تمدید و `status='active'` می‌شود (بدون ساخت کاربر جدید).

### پنل ادمین
- تب جدید «کاربران منقضی» در `admin.tsx` با لیست `profiles where status='expired' or end_date<now()`، دکمه‌های ارسال پیامک/واتساپ/تمدید دستی.

### migration
- `ALTER TABLE signup_requests ADD COLUMN request_type text DEFAULT 'signup', ADD COLUMN target_user_id uuid REFERENCES auth.users(id)`

## ۳) اجباری‌کردن شماره موبایل در ثبت‌نام
در `src/routes/register.tsx` فیلد موبایل را `required` کنم + اعتبارسنجی فرمت ایرانی (09xxxxxxxxx یا +98) با پیام خطای فارسی، مشابه بقیه فیلدها.

## تست نهایی
1. ثبت‌نام جدید بدون موبایل → خطا. با موبایل معتبر → ساخته می‌شود.
2. ورود کاربر فعال موجود → هیچ ریدایرکتی به `/renew` نمی‌خورد.
3. کاربر expired → صفحه تمدید با همان حساب، پس از تایید ادمین داده‌ها سالم برمی‌گردند.
4. `/m/<userId>` بدون لاگین در مرورگر incognito باز شود.
5. ویس در APK: نتیجه «محصول پیدا نشد + دکمه افزودن» نمایش داده شود.

## تخمین
حدود ۸–۱۰ فایل جدید، ۲ migration، ۴–۵ فایل ویرایشی. می‌توانم بلافاصله بعد از تایید شما شروع کنم.

آیا تایید می‌کنید با همین رویکرد جلو بروم؟ یا تغییر/اولویتی مدنظرتان هست؟
