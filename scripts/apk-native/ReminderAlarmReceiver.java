package com.kamali.inventory;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

public class ReminderAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent != null ? intent.getStringExtra(ReminderScheduler.EXTRA_ID) : null;
        boolean markDone = intent != null && intent.getBooleanExtra(ReminderScheduler.EXTRA_MARK_DONE, false);
        if (markDone) {
            ReminderRingtone.stop();
            ReminderScheduler.completeFromNotification(context, id);
            return;
        }

        final PendingResult pending = goAsync();
        try {
            ReminderScheduler.ensureChannel(context);
            String title = intent != null ? intent.getStringExtra(ReminderScheduler.EXTRA_TITLE) : null;
            String body = intent != null ? intent.getStringExtra(ReminderScheduler.EXTRA_BODY) : null;
            if (title == null || title.trim().isEmpty()) title = "یادآوری";
            if (body == null) body = "زمان این یادآوری رسیده است.";

            Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (launch == null) {
                launch = new Intent(context, MainActivity.class);
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            int requestCode = id != null ? id.hashCode() : 0;
            PendingIntent content = PendingIntent.getActivity(context, requestCode, launch, flags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ReminderScheduler.CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setAutoCancel(true)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setVibrate(new long[]{0, 500, 250, 500, 250, 800})
                    .setContentIntent(content);

            if (id != null && !id.isEmpty()) {
                builder.addAction(
                        android.R.drawable.checkbox_on_background,
                        "انجام شد",
                        ReminderScheduler.pendingDoneFor(context, id)
                );
            }

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                int notifyId = requestCode == 0 ? (int) System.currentTimeMillis() : requestCode;
                manager.notify(notifyId, builder.build());
            }

            ReminderRingtone.play(context);
        } catch (Exception ignored) {
        } finally {
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    pending.finish();
                } catch (Exception ignored) {
                }
            }, 13_000);
        }
    }
}
