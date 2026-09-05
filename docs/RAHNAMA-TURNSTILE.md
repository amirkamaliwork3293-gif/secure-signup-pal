# کپچای Cloudflare روی سایت فعلی (Vercel)

سایت همان `kamixapp.ir` روی Vercel می‌ماند. **نام سرور DNS را عوض نکنید.**
Turnstile فقط دو کلید می‌خواهد؛ به پروکسی نارنجی Cloudflare نیاز ندارد.

---

## مرحله ۱ — ساخت ویجت در Cloudflare

1. وارد [https://dash.cloudflare.com](https://dash.cloudflare.com) شوید.
2. از منوی سمت چپ **Turnstile** را باز کنید (اگر دامنه را انتخاب کردید، Turnstile در همان حساب است — لازم نیست دامنه را به Cloudflare منتقل کنید).
3. **Add widget** / افزودن ویجت.
4. نام: `kamix-signup`
5. در Hostnames هر دو را بنویسید: `kamixapp.ir` و `www.kamixapp.ir`
   (اگر فقط دامنهٔ بدون www باشد، کسانی که با www وارد شوند کادر را نمی‌بینند.)
6. Widget Mode را **Managed** بگذارید.
7. Create / ساخت.

دو مقدار می‌دهد:

- **Site Key** (عمومی)
- **Secret Key** (محرمانه) — یک‌بار نشان داده می‌شود؛ همان لحظه کپی کنید.

---

## مرحله ۲ — چسباندن کلیدها در Vercel

1. [https://vercel.com](https://vercel.com) → تیم **kamali-hesab** → پروژه **secure-signup-pal**.
2. **Settings** → **Environment Variables**.
3. این دو را برای محیط **Production** اضافه کنید:

| نام | مقدار | نوع |
|---|---|---|
| `TURNSTILE_SITE_KEY` | همان Site Key | معمولی / Config — Secret هم اشکال ندارد |
| `TURNSTILE_SECRET_KEY` | همان Secret Key | Secret |

`VITE_` لازم نیست. اگر آموزش دیگری گفت `VITE_TURNSTILE_SITE_KEY`، همان را هم می‌توانید بگذارید؛ کد هر دو را می‌خواند. **Secret Key را هرگز با پیشوند `VITE_` نگذارید.**

4. ذخیره کنید.

---

## مرحله ۳ — یک‌بار Redeploy

در Vercel → **Deployments** → آخرین استقرار → منوی سه نقطه → **Redeploy**.
صبر کنید تا سبز شود.

---

## مرحله ۴ — تست

1. بروید به `https://kamixapp.ir/register`
2. پایین فرم، کادر Cloudflare («من ربات نیستم») باید دیده شود.
3. بدون زدن آن، ارسال باید خطا بدهد.
4. بعد از زدن کادر، ثبت‌نام عادی کار کند.

اگر کادر برای **همه** نیامد: دو متغیر را دوباره چک کنید، Redeploy را با rebuild بزنید، و همان صفحه را برایم بفرستید.

اگر کادر فقط برای **بعضی کاربران** نیامد (برای شما هست): مشکل کلید نیست.
معمولاً اسکریپت `challenges.cloudflare.com` روی خط اینترنت آن‌ها، مرورگر داخل تلگرام/اینستاگرام، یا مسدودکنندهٔ تبلیغات باز نمی‌شود. باید صفحه را در کروم/فایرفاکس باز کنند یا فیلترشکن روشن کنند.
