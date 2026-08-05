import { AuthGuard } from "@/components/AuthGuard";
import { createFileRoute } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { BackupSection } from "@/components/BackupDialog";
import { DatabaseBackup, ShieldCheck, FileSpreadsheet, FileJson } from "lucide-react";

export const Route = createFileRoute("/backup")({
  head: () => ({
    meta: [
      { title: "پشتیبان‌گیری اطلاعات | KAMIX" },
      { name: "description", content: "از محصولات، مشتریان، فاکتورها و سایر داده‌های کسب‌وکار خود خروجی اکسل یا فایل کامل بگیرید." },
      { property: "og:title", content: "پشتیبان‌گیری اطلاعات | KAMIX" },
      { property: "og:description", content: "خروجی اکسل و فایل پشتیبان کامل از تمام داده‌های کسب‌وکار شما در KAMIX." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BackupPage,
});

function BackupPage() {
  return (
    <AuthGuard>
      <Layout>
        <div className="mb-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground">
              <DatabaseBackup className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold">پشتیبان‌گیری از اطلاعات</h1>
              <p className="text-[11px] text-muted-foreground">یک نسخه امن از داده‌های کسب‌وکارتان روی دستگاه خودتان</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            در این بخش می‌توانید از بخش‌هایی که انتخاب می‌کنید (محصولات، مشتریان، فاکتورها، خریدها،
            هزینه‌ها، یادآوری‌ها، هنرجویان و حساب‌ها) یک نسخه پشتیبان تهیه کنید. این کار فقط اطلاعات را
            می‌خوانَد و هیچ داده‌ای را تغییر نمی‌دهد یا پاک نمی‌کند.
          </p>
          <ul className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
              خروجی اکسل: مناسب مرور، چاپ و کار با داده‌ها در رایانه
            </li>
            <li className="flex items-center gap-1.5">
              <FileJson className="h-3.5 w-3.5 text-primary" />
              فایل کامل (JSON): مناسب نگهداری بلندمدت و بازیابی کامل
            </li>
            <li className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              پیشنهاد می‌کنیم هفته‌ای یک‌بار پشتیبان بگیرید
            </li>
          </ul>
        </div>

        <BackupSection />
      </Layout>
    </AuthGuard>
  );
}