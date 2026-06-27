import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { AuthGuard } from "@/components/AuthGuard";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/AuthContext";
import { settings } from "@/lib/store";
import { printHtml, savePdf, saveBase64File } from "@/lib/print";
import { QrCode, Printer, Download, ArrowLeft, Loader2 } from "lucide-react";

export const Route = createFileRoute("/menu-qr")({
  head: () => ({ meta: [{ title: "QR منو | کمالی" }] }),
  component: () => (
    <AuthGuard>
      <QrPage />
    </AuthGuard>
  ),
});

function QrPage() {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.session.user.id : "";
  const [appSettings] = settings.useAll();
  const shopName = appSettings.shopName || "کمالی";
  const [sizeCm, setSizeCm] = useState(6);
  const [dataUrl, setDataUrl] = useState("");
  const [working, setWorking] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const url = typeof window !== "undefined" && userId
    ? `${window.location.origin}/m/${userId}`
    : "";

  useEffect(() => {
    if (!url || !canvasRef.current) return;
    // استفاده از کتابخانه‌ی qrcode با حالت پیش‌فرض byte mode و پیشوند صریح
    // https:// تا اسکنرهای موبایل (دوربین گوشی) آن را به‌عنوان لینک تشخیص
    // داده و گزینه‌ی "Open website" نشان دهند، نه "Copy text".
    QRCode.toCanvas(canvasRef.current, url, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 10,
      color: { dark: "#000000", light: "#ffffff" },
    }).then(() => {
      setDataUrl(canvasRef.current!.toDataURL("image/png"));
    }).catch(() => {});
  }, [url]);

  const buildHtml = () => {
    const sizeMm = sizeCm * 10;
    return `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8" />
      <title>${shopName} — QR منو</title>
      <style>
        @page { size: auto; margin: 10mm; }
        body { font-family: Tahoma, sans-serif; text-align: center; }
        .card { display: inline-block; padding: 8mm; border: 1px dashed #333; border-radius: 8px; }
        .name { font-size: 14pt; font-weight: bold; margin-bottom: 4mm; }
        .hint { font-size: 10pt; color: #555; margin-top: 4mm; }
        img { width: ${sizeMm}mm; height: ${sizeMm}mm; image-rendering: pixelated; }
      </style></head>
      <body><div class="card">
        <div class="name">${shopName}</div>
        <img src="${dataUrl}" alt="QR" />
        <div class="hint">برای دیدن منو، این کد را اسکن کنید</div>
      </div></body></html>`;
  };

  const doPrint = async () => {
    if (!dataUrl) return;
    setWorking(true);
    await printHtml(buildHtml(), `${shopName}-menu-qr`);
    setWorking(false);
  };

  const downloadPng = async () => {
    if (!dataUrl) return;
    await saveBase64File(dataUrl, `${shopName}-menu-qr.png`, "image/png");
  };

  const downloadPdf = async () => {
    if (!dataUrl) return;
    setWorking(true);
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const sizeMm = sizeCm * 10;
    const x = (pdf.internal.pageSize.getWidth() - sizeMm) / 2;
    pdf.addImage(dataUrl, "PNG", x, 40, sizeMm, sizeMm);
    pdf.setFontSize(10);
    pdf.text("Scan for menu", pdf.internal.pageSize.getWidth() / 2, 40 + sizeMm + 10, { align: "center" });
    await savePdf(pdf as any, `${shopName}-menu-qr.pdf`);
    setWorking(false);
  };

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <QrCode className="h-5 w-5 text-primary" />
          QR کد منوی دیجیتال
        </h1>
        <Link to="/menu" className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> بازگشت
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 text-xs text-muted-foreground">
          این QR کد را روی میز کافه/رستوران بچسبانید تا مشتری با اسکن آن، منوی شما را ببیند.
        </div>
        <div className="grid place-items-center rounded-xl border border-dashed border-border bg-background p-4">
          <canvas ref={canvasRef} style={{ width: `${sizeCm * 10}mm`, height: `${sizeCm * 10}mm`, maxWidth: "100%" }} />
        </div>
        <div className="mt-3 break-all rounded-lg bg-muted px-3 py-2 text-center text-[11px]" dir="ltr">
          {url || "—"}
        </div>

        <div className="mt-4">
          <label className="mb-2 flex items-center justify-between text-xs">
            <span>اندازه چاپ (سانتی‌متر):</span>
            <span className="font-bold">{sizeCm} cm</span>
          </label>
          <input
            type="range" min={3} max={20} step={0.5} value={sizeCm}
            onChange={(e) => setSizeCm(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button onClick={doPrint} disabled={working || !dataUrl}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">
            {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
            پرینت
          </button>
          <button onClick={downloadPng} disabled={!dataUrl}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2.5 text-xs">
            <Download className="h-3.5 w-3.5" /> PNG
          </button>
          <button onClick={downloadPdf} disabled={working || !dataUrl}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2.5 text-xs">
            <Download className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>
    </Layout>
  );
}