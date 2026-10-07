package com.kamali.inventory;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;

/**
 * ویجت «یادآوری‌های امروز». فقط نمایش است؛ تنها نوشتن، صف «انجام شد» همان نوتیف است
 * (ReminderScheduler.pendingDoneFor) که برنامه با takeCompleted اعمالش می‌کند.
 * داده در SharedPreferences جداگانه نگه داشته می‌شود و به کلیدهای زنگ‌ها دست نمی‌زند.
 */
public final class ReminderWidget {
    private ReminderWidget() {
    }

    public static final String PREFS = "kamali_reminder_widget";
    private static final String KEY_PAYLOAD = "payload_json";
    /** یادآوری‌هایی که از ویجت/نوتیف «انجام شد» خورده‌اند و هنوز برنامه اعمالشان نکرده. */
    private static final String KEY_HIDDEN = "hidden_json";
    private static final String KEY_OPEN_ROUTE_AT = "open_route_at";
    public static final String OPEN_ROUTE = "/reminders";
    private static final long OPEN_ROUTE_TTL_MS = 2 * 60_000L;
    /**
     * تیک محلی فقط پل کوتاهی است تا برنامه «انجام شد» را بگیرد و دوباره بفرستد (صف «انجام شد» خودش
     * تا باز شدن برنامه می‌ماند). کوتاه است تا اگر کاربر در برنامه تیک را برداشت، ویجت هم زود درست شود.
     */
    private static final long HIDDEN_TTL_MS = 10 * 60_000L;
    private static final int MAX_ITEMS = 300;
    private static final int MAX_ROWS = 6;
    public static final String ACTION_REFRESH = "com.kamali.inventory.REMINDER_WIDGET_REFRESH";

    private static final int[] ROW_IDS = {
            R.id.kamix_widget_row1, R.id.kamix_widget_row2, R.id.kamix_widget_row3,
            R.id.kamix_widget_row4, R.id.kamix_widget_row5, R.id.kamix_widget_row6
    };
    private static final int[] CHECK_AREA_IDS = {
            R.id.kamix_widget_check_area1, R.id.kamix_widget_check_area2, R.id.kamix_widget_check_area3,
            R.id.kamix_widget_check_area4, R.id.kamix_widget_check_area5, R.id.kamix_widget_check_area6
    };
    private static final int[] CHECK_IDS = {
            R.id.kamix_widget_check1, R.id.kamix_widget_check2, R.id.kamix_widget_check3,
            R.id.kamix_widget_check4, R.id.kamix_widget_check5, R.id.kamix_widget_check6
    };
    private static final int[] TITLE_IDS = {
            R.id.kamix_widget_title1, R.id.kamix_widget_title2, R.id.kamix_widget_title3,
            R.id.kamix_widget_title4, R.id.kamix_widget_title5, R.id.kamix_widget_title6
    };
    private static final int[] CUSTOMER_IDS = {
            R.id.kamix_widget_customer1, R.id.kamix_widget_customer2, R.id.kamix_widget_customer3,
            R.id.kamix_widget_customer4, R.id.kamix_widget_customer5, R.id.kamix_widget_customer6
    };
    private static final int[] TIME_IDS = {
            R.id.kamix_widget_time1, R.id.kamix_widget_time2, R.id.kamix_widget_time3,
            R.id.kamix_widget_time4, R.id.kamix_widget_time5, R.id.kamix_widget_time6
    };

    private static final class Stored {
        boolean known;
        boolean enabled;
        long savedAt;
        List<ReminderWidgetModel.Item> items = new ArrayList<>();
    }

    // ─── داده از برنامهٔ وب ────────────────────────────────────────────────

    /** از پل JS صدا زده می‌شود. JSON نامعتبر نادیده گرفته می‌شود و دادهٔ قبلی می‌ماند. */
    public static void saveFromJson(Context context, String json) {
        if (storePayload(context, json)) refreshAll(context);
    }

    private static synchronized boolean storePayload(Context context, String json) {
        try {
            if (json == null || json.trim().isEmpty()) return false;
            JSONObject root = new JSONObject(json);
            boolean enabled = root.optBoolean("enabled", false);
            JSONArray array = root.optJSONArray("items");
            JSONArray clean = new JSONArray();
            Set<String> present = new HashSet<>();
            if (enabled && array != null) {
                for (int i = 0; i < array.length() && clean.length() < MAX_ITEMS; i++) {
                    JSONObject obj = array.optJSONObject(i);
                    if (obj == null) continue;
                    String id = obj.optString("id", "");
                    long at = obj.optLong("at", 0);
                    if (id.isEmpty() || at <= 0) continue;
                    JSONObject out = new JSONObject();
                    out.put("id", id);
                    out.put("title", obj.optString("title", ""));
                    out.put("customer", obj.optString("customer", ""));
                    out.put("at", at);
                    boolean done = obj.optBoolean("done", false);
                    out.put("done", done);
                    clean.put(out);
                    // اگر برنامه خودش «انجام‌شده» فرستاده، تیک محلی دیگر لازم نیست.
                    if (!done) present.add(ReminderWidgetModel.doneKey(id, at));
                }
            }
            JSONObject stored = new JSONObject();
            stored.put("enabled", enabled);
            stored.put("savedAt", System.currentTimeMillis());
            stored.put("items", clean);
            SharedPreferences prefs = prefs(context);
            prefs.edit()
                    .putString(KEY_PAYLOAD, stored.toString())
                    .putString(KEY_HIDDEN, pruneHidden(prefs.getString(KEY_HIDDEN, "{}"), present).toString())
                    .apply();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** بعد از «انجام شد» (ویجت یا نوتیف) — ردیف فوراً تیک سبز و خط‌خورده می‌شود. */
    public static void onReminderDone(Context context, String id) {
        try {
            if (id == null || id.isEmpty()) return;
            synchronized (ReminderWidget.class) {
                Stored stored = load(context);
                SharedPreferences prefs = prefs(context);
                JSONObject hidden = parseObject(prefs.getString(KEY_HIDDEN, "{}"));
                long now = System.currentTimeMillis();
                for (ReminderWidgetModel.Item item : stored.items) {
                    if (id.equals(item.id)) hidden.put(ReminderWidgetModel.doneKey(item.id, item.at), now);
                }
                prefs.edit().putString(KEY_HIDDEN, hidden.toString()).apply();
            }
        } catch (Exception ignored) {
        }
        refreshAll(context);
    }

    // ─── باز کردن صفحهٔ یادآوری‌ها ─────────────────────────────────────────

    public static void markOpenRequested(Context context) {
        try {
            prefs(context).edit().putLong(KEY_OPEN_ROUTE_AT, System.currentTimeMillis()).apply();
        } catch (Exception ignored) {
        }
    }

    /** یک‌بار مصرف: اگر کاربر تازه روی ویجت زده، «/reminders» وگرنه رشتهٔ خالی. */
    public static synchronized String takeOpenRoute(Context context) {
        try {
            SharedPreferences prefs = prefs(context);
            long at = prefs.getLong(KEY_OPEN_ROUTE_AT, 0);
            if (at == 0) return "";
            prefs.edit().remove(KEY_OPEN_ROUTE_AT).apply();
            long age = System.currentTimeMillis() - at;
            return age >= 0 && age <= OPEN_ROUTE_TTL_MS ? OPEN_ROUTE : "";
        } catch (Exception ignored) {
            return "";
        }
    }

    // ─── رسم ویجت ──────────────────────────────────────────────────────────

    public static void refreshAll(Context context) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            if (manager == null) return;
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, ReminderWidgetProvider.class));
            if (ids == null || ids.length == 0) {
                cancelRefresh(context);
                return;
            }
            for (int id : ids) update(context, manager, id);
        } catch (Exception ignored) {
        }
    }

    public static void update(Context context, AppWidgetManager manager, int widgetId) {
        try {
            TimeZone tz = ReminderWidgetModel.appTimeZone();
            long now = System.currentTimeMillis();
            Stored stored = load(context);
            int heightDp = 0;
            int widthDp = 0;
            try {
                Bundle options = manager.getAppWidgetOptions(widgetId);
                if (options != null) {
                    // عمودی: ارتفاع واقعی = MAX_HEIGHT و عرض = MIN_WIDTH؛ افقی برعکس.
                    boolean landscape = context.getResources().getConfiguration().orientation
                            == Configuration.ORIENTATION_LANDSCAPE;
                    heightDp = options.getInt(landscape
                            ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT
                            : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                    widthDp = options.getInt(landscape
                            ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH
                            : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                }
            } catch (Exception ignored) {
            }
            int maxRows = Math.min(MAX_ROWS, ReminderWidgetModel.rowsForHeight(heightDp));
            boolean compact = widthDp > 0 && widthDp < 200;
            ReminderWidgetModel.View view = ReminderWidgetModel.build(
                    stored.items, localDoneKeys(context, stored), now, tz, maxRows);

            RemoteViews rv = new RemoteViews(context.getPackageName(), R.layout.kamix_widget_reminders);
            PendingIntent open = openAppIntent(context);
            rv.setOnClickPendingIntent(R.id.kamix_widget_root, open);
            rv.setTextViewText(R.id.kamix_widget_date, ReminderWidgetModel.dateLabel(now, tz));
            rv.setViewVisibility(R.id.kamix_widget_date, View.VISIBLE);

            boolean hasData = stored.known && stored.enabled
                    && ReminderWidgetModel.coversToday(stored.savedAt, now, tz);
            rv.setTextViewText(R.id.kamix_widget_count,
                    hasData ? ReminderWidgetModel.persianDigits(String.valueOf(view.total)) : "");
            rv.setTextColor(R.id.kamix_widget_count, color(context,
                    hasData && view.overdueCount > 0 ? R.color.kamix_widget_overdue : R.color.kamix_widget_primary));

            for (int i = 0; i < ROW_IDS.length; i++) {
                if (!hasData || i >= view.rows.size()) {
                    rv.setViewVisibility(ROW_IDS[i], View.GONE);
                    continue;
                }
                ReminderWidgetModel.Row row = view.rows.get(i);
                rv.setViewVisibility(ROW_IDS[i], View.VISIBLE);
                String title = row.item.title.isEmpty() ? "یادآوری" : row.item.title;
                rv.setTextViewText(TITLE_IDS[i], row.done ? struck(title) : title);
                rv.setTextColor(TITLE_IDS[i], color(context,
                        row.done ? R.color.kamix_widget_muted : R.color.kamix_widget_text));
                boolean showCustomer = !compact && !row.item.customer.isEmpty();
                rv.setViewVisibility(CUSTOMER_IDS[i], showCustomer ? View.VISIBLE : View.GONE);
                if (showCustomer) {
                    rv.setTextViewText(CUSTOMER_IDS[i], row.done ? struck(row.item.customer) : row.item.customer);
                }
                rv.setTextViewText(TIME_IDS[i], row.clock);
                rv.setTextColor(TIME_IDS[i], color(context,
                        row.overdue ? R.color.kamix_widget_overdue : R.color.kamix_widget_muted));
                rv.setImageViewResource(CHECK_IDS[i], row.done
                        ? R.drawable.kamix_widget_circle_done
                        : row.overdue ? R.drawable.kamix_widget_circle_overdue : R.drawable.kamix_widget_circle);
                rv.setOnClickPendingIntent(ROW_IDS[i], open);
                // همان PendingIntent دکمهٔ «انجام شد» نوتیف — مسیر نوشتن جدیدی ساخته نمی‌شود.
                // برداشتن تیک فقط داخل برنامه است (ویجت مسیر نوشتن دیگری ندارد).
                rv.setOnClickPendingIntent(CHECK_AREA_IDS[i],
                        row.done ? open : ReminderScheduler.pendingDoneFor(context, row.item.id));
            }

            if (hasData && view.more > 0) {
                rv.setViewVisibility(R.id.kamix_widget_more, View.VISIBLE);
                rv.setTextViewText(R.id.kamix_widget_more,
                        "+" + ReminderWidgetModel.persianDigits(String.valueOf(view.more)) + " یادآوری دیگر");
            } else {
                rv.setViewVisibility(R.id.kamix_widget_more, View.GONE);
            }

            if (!hasData) {
                rv.setViewVisibility(R.id.kamix_widget_empty, View.VISIBLE);
                rv.setTextViewText(R.id.kamix_widget_empty, "برای دیدن یادآوری‌ها، کامیکس را باز کنید");
            } else if (view.total == 0 && view.doneCount == 0) {
                rv.setViewVisibility(R.id.kamix_widget_empty, View.VISIBLE);
                rv.setTextViewText(R.id.kamix_widget_empty, "امروز یادآوری نداری 🎉");
            } else {
                rv.setViewVisibility(R.id.kamix_widget_empty, View.GONE);
            }

            manager.updateAppWidget(widgetId, rv);
            scheduleRefresh(context, stored.items, now, tz);
        } catch (Exception ignored) {
        }
    }

    private static PendingIntent openAppIntent(Context context) {
        Intent intent = new Intent(context, ReminderWidgetOpenActivity.class);
        intent.setAction("com.kamali.inventory.REMINDER_WIDGET_OPEN");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, 0x4b1d, intent, immutableFlags());
    }

    private static int immutableFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    @SuppressWarnings("deprecation")
    private static int color(Context context, int res) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) return context.getColor(res);
        return context.getResources().getColor(res);
    }

    // ─── تازه‌سازی کم‌مصرف: فقط در سررسید بعدی امروز یا نیمه‌شب (بدون بیدار کردن گوشی) ─────

    private static PendingIntent refreshIntent(Context context) {
        Intent intent = new Intent(context, ReminderWidgetProvider.class);
        intent.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 0x4b1e, intent, immutableFlags());
    }

    private static void scheduleRefresh(Context context, List<ReminderWidgetModel.Item> items, long now, TimeZone tz) {
        try {
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarms == null) return;
            // RTC (نه RTC_WAKEUP) و غیردقیق: گوشی را بیدار نمی‌کند و مجوز آلارم دقیق نمی‌خواهد.
            alarms.set(AlarmManager.RTC, ReminderWidgetModel.nextRefreshAt(items, now, tz), refreshIntent(context));
        } catch (Exception ignored) {
        }
    }

    public static void cancelRefresh(Context context) {
        try {
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarms != null) alarms.cancel(refreshIntent(context));
        } catch (Exception ignored) {
        }
    }

    // ─── ذخیره‌سازی ────────────────────────────────────────────────────────

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static Stored load(Context context) {
        Stored stored = new Stored();
        try {
            String json = prefs(context).getString(KEY_PAYLOAD, null);
            if (json == null) return stored;
            JSONObject root = new JSONObject(json);
            stored.known = true;
            stored.enabled = root.optBoolean("enabled", false);
            stored.savedAt = root.optLong("savedAt", 0);
            JSONArray array = root.optJSONArray("items");
            if (array == null) return stored;
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.optJSONObject(i);
                if (obj == null) continue;
                stored.items.add(new ReminderWidgetModel.Item(
                        obj.optString("id", ""),
                        obj.optString("title", ""),
                        obj.optString("customer", ""),
                        obj.optLong("at", 0),
                        obj.optBoolean("done", false)));
            }
        } catch (Exception ignored) {
        }
        return stored;
    }

    private static CharSequence struck(String text) {
        SpannableString out = new SpannableString(text);
        out.setSpan(new StrikethroughSpan(), 0, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return out;
    }

    private static Set<String> localDoneKeys(Context context, Stored stored) {
        Set<String> keys = new HashSet<>();
        try {
            JSONObject hidden = parseObject(prefs(context).getString(KEY_HIDDEN, "{}"));
            long now = System.currentTimeMillis();
            Iterator<String> it = hidden.keys();
            while (it.hasNext()) {
                String key = it.next();
                if (now - hidden.optLong(key, 0) <= HIDDEN_TTL_MS) keys.add(key);
            }
            // هر چیزی که هنوز در صف «انجام شد» منتظر برنامه است هم پنهان بماند.
            Set<String> pending = ReminderScheduler.pendingDoneIds(context);
            for (ReminderWidgetModel.Item item : stored.items) {
                if (pending.contains(item.id)) keys.add(ReminderWidgetModel.doneKey(item.id, item.at));
            }
        } catch (Exception ignored) {
        }
        return keys;
    }

    private static JSONObject pruneHidden(String json, Set<String> present) {
        JSONObject hidden = parseObject(json);
        JSONObject next = new JSONObject();
        long now = System.currentTimeMillis();
        Iterator<String> it = hidden.keys();
        while (it.hasNext()) {
            String key = it.next();
            long at = hidden.optLong(key, 0);
            if (present.contains(key) && now - at <= HIDDEN_TTL_MS) {
                try {
                    next.put(key, at);
                } catch (Exception ignored) {
                }
            }
        }
        return next;
    }

    private static JSONObject parseObject(String json) {
        try {
            return new JSONObject(json == null ? "{}" : json);
        } catch (Exception e) {
            return new JSONObject();
        }
    }
}
