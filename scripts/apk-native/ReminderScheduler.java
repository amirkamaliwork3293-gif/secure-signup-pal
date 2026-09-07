package com.kamali.inventory;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class ReminderScheduler {
    public static final String CHANNEL_ID = "kamali_reminders";
    public static final String PREFS = "kamali_reminder_alarms";
    public static final String KEY_JSON = "items_json";
    public static final String EXTRA_ID = "reminder_id";
    public static final String EXTRA_TITLE = "reminder_title";
    public static final String EXTRA_BODY = "reminder_body";

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "یادآوری‌ها",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("یادآوری سررسیدهای ثبت‌شده در کامیکس");
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    public static void syncFromJson(Context context, String json) {
        try {
            JSONArray array = (json == null || json.trim().isEmpty())
                    ? new JSONArray()
                    : new JSONArray(json);
            List<Item> next = new ArrayList<>();
            long now = System.currentTimeMillis();
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.getJSONObject(i);
                String id = obj.optString("id", "");
                long at = obj.optLong("at", 0);
                if (id.isEmpty() || at <= now + 3000) continue;
                Item item = new Item();
                item.id = id;
                item.title = obj.optString("title", "یادآوری");
                item.body = obj.optString("body", "زمان این یادآوری رسیده است.");
                item.at = at;
                next.add(item);
            }
            replaceAll(context, next);
        } catch (Exception ignored) {
        }
    }

    public static void rescheduleAll(Context context) {
        List<Item> items = load(context);
        scheduleAll(context, items);
    }

    private static void replaceAll(Context context, List<Item> next) {
        List<Item> previous = load(context);
        cancelAll(context, previous);
        save(context, next);
        scheduleAll(context, next);
    }

    private static void scheduleAll(Context context, List<Item> items) {
        ensureChannel(context);
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        long now = System.currentTimeMillis();
        for (Item item : items) {
            if (item.at <= now + 3000) continue;
            PendingIntent pending = pendingFor(context, item);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (alarmManager.canScheduleExactAlarms()) {
                        alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, pending);
                    } else {
                        long delay = Math.max(0, item.at - now);
                        alarmManager.setAndAllowWhileIdle(
                                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                                SystemClock.elapsedRealtime() + delay,
                                pending
                        );
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, pending);
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, item.at, pending);
                }
            } catch (SecurityException ignored) {
                try {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, item.at, pending);
                } catch (Exception ignored2) {
                }
            } catch (Exception ignored) {
            }
        }
    }

    private static void cancelAll(Context context, List<Item> items) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;
        for (Item item : items) {
            try {
                alarmManager.cancel(pendingFor(context, item));
            } catch (Exception ignored) {
            }
        }
    }

    private static PendingIntent pendingFor(Context context, Item item) {
        Intent intent = new Intent(context, ReminderAlarmReceiver.class);
        intent.setAction("com.kamali.inventory.REMINDER_DUE." + item.id);
        intent.putExtra(EXTRA_ID, item.id);
        intent.putExtra(EXTRA_TITLE, item.title);
        intent.putExtra(EXTRA_BODY, item.body);
        int requestCode = item.id.hashCode();
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    private static void save(Context context, List<Item> items) {
        JSONArray array = new JSONArray();
        try {
            for (Item item : items) {
                JSONObject obj = new JSONObject();
                obj.put("id", item.id);
                obj.put("title", item.title);
                obj.put("body", item.body);
                obj.put("at", item.at);
                array.put(obj);
            }
        } catch (Exception ignored) {
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_JSON, array.toString())
                .apply();
    }

    private static List<Item> load(Context context) {
        List<Item> items = new ArrayList<>();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_JSON, "[]");
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.getJSONObject(i);
                Item item = new Item();
                item.id = obj.optString("id", "");
                item.title = obj.optString("title", "یادآوری");
                item.body = obj.optString("body", "");
                item.at = obj.optLong("at", 0);
                if (!item.id.isEmpty() && item.at > 0) items.add(item);
            }
        } catch (Exception ignored) {
        }
        return items;
    }

    private static class Item {
        String id;
        String title;
        String body;
        long at;
    }
}
