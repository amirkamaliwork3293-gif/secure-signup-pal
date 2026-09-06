/**
 * اجرا: npx tsx --tsconfig tsconfig.json scripts/test-reminder-speech.ts
 */
import { dueAlertSpeechText } from "../src/lib/voice/reminder-speech";

function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) {
    console.error("FAIL", name, extra ?? "");
    process.exit(1);
  }
  console.log("ok", name);
}

check(
  "today reminder title",
  dueAlertSpeechText({ type: "reminder", title: "سررسید اجاره مغازه شماست", overdue: false }) ===
    "یادآوری امروز: سررسید اجاره مغازه شماست",
);

check(
  "overdue reminder",
  dueAlertSpeechText({ type: "reminder", title: "تماس با آقای رضایی", overdue: true }) ===
    "یادآوری عقب‌افتاده: تماس با آقای رضایی",
);

check(
  "short note appended",
  dueAlertSpeechText({
    type: "reminder",
    title: "اجاره",
    overdue: false,
    note: "مبلغ دو میلیون",
  }) === "یادآوری امروز: اجاره. مبلغ دو میلیون",
);

check(
  "settlement today",
  dueAlertSpeechText({ type: "settlement", customerName: "امیر کمالی", when: "today" }) ===
    "امروز موعد تسویه امیر کمالی است.",
);

check(
  "settlement overdue",
  dueAlertSpeechText({ type: "settlement", customerName: "علی", when: "overdue" }) ===
    "موعد تسویه علی گذشته است.",
);

check(
  "empty title fallback",
  dueAlertSpeechText({ type: "reminder", title: "   ", overdue: false }) ===
    "یادآوری امروز: یک یادآوری",
);

console.log("\nall reminder-speech checks passed");
