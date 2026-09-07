package com.kamali.inventory;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

public class ReminderAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            ReminderScheduler.ensureChannel(context);
            String id = intent != null ? intent.getStringExtra(ReminderScheduler.EXTRA_ID) : null;
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
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setContentIntent(content);

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                int notifyId = requestCode == 0 ? (int) System.currentTimeMillis() : requestCode;
                manager.notify(notifyId, builder.build());
            }
        } catch (Exception ignored) {
        }
    }
}
