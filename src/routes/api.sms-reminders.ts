/**
 * نقطه‌ی ورود زمان‌بندی‌شده برای یادآوری انقضای اشتراک.
 * توسط GitHub Actions (فایل .github/workflows/sms-reminders.yml) روزی یک بار
 * صدا زده می‌شود و با هدر x-cron-secret محافظت شده است.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const Route = createFileRoute("/api/sms-reminders")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const expected = (process.env.CRON_SECRET || "").trim();
        const provided = (request.headers.get("x-cron-secret") || "").trim();
        if (!expected || !provided || !ctEqual(provided, expected)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        try {
          const { runExpiryReminders } = await import("@/lib/sms.server");
          const result = await runExpiryReminders();
          console.log("[sms] یادآوری انقضا اجرا شد", result);
          return Response.json(result);
        } catch (e: any) {
          console.error("[sms] اجرای یادآوری انقضا شکست خورد", e?.message);
          return Response.json({ error: e?.message || "failed" }, { status: 500 });
        }
      },
    },
  },
});
