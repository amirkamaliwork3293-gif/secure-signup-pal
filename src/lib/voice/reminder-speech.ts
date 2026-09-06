/**
 * متنی که باید بلند خوانده شود — خالص و بدون DOM تا در تست Node هم اجرا شود.
 */

export type DueAlertSpeechInput =
  | {
      type: "reminder";
      title: string;
      overdue: boolean;
      note?: string;
    }
  | {
      type: "settlement";
      customerName: string;
      when: "overdue" | "today" | "tomorrow";
    };

export function dueAlertSpeechText(item: DueAlertSpeechInput): string {
  if (item.type === "settlement") {
    const name = item.customerName.trim() || "مشتری";
    if (item.when === "tomorrow") return `فردا موعد تسویه ${name} است.`;
    if (item.when === "overdue") return `موعد تسویه ${name} گذشته است.`;
    return `امروز موعد تسویه ${name} است.`;
  }
  const title = item.title.trim() || "یک یادآوری";
  const prefix = item.overdue ? "یادآوری عقب‌افتاده" : "یادآوری امروز";
  const note = item.note?.trim();
  if (note && note.length <= 80 && note !== title) return `${prefix}: ${title}. ${note}`;
  return `${prefix}: ${title}`;
}
