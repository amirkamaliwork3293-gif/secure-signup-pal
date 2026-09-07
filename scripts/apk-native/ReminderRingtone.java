package com.kamali.inventory;

import android.content.Context;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

/**
 * یک‌بار زنگ واقعی پخش می‌کند. نوتیف سیستم روی خیلی از گوشی‌ها صدا نمی‌دهد.
 */
public class ReminderRingtone {
    private static final long MAX_MS = 12_000;
    private static final Handler HANDLER = new Handler(Looper.getMainLooper());
    private static Ringtone ringtone;
    private static PowerManager.WakeLock wakeLock;

    public static void play(final Context context) {
        HANDLER.post(() -> start(context.getApplicationContext()));
    }

    public static void stop() {
        HANDLER.post(ReminderRingtone::stopNow);
    }

    private static void start(Context app) {
        stopNow();
        Uri uri = soundUri();
        if (uri == null) return;
        Ringtone next = RingtoneManager.getRingtone(app, uri);
        if (next == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                next.setLooping(false);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                next.setAudioAttributes(ReminderScheduler.alarmAttrs());
            } else {
                next.setStreamType(AudioManager.STREAM_ALARM);
            }
            AudioManager audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
            if (audio != null) {
                audio.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            }
            acquireWakeLock(app);
            next.play();
            ringtone = next;
            HANDLER.postDelayed(ReminderRingtone::stopNow, MAX_MS);
        } catch (Exception ignored) {
            stopNow();
        }
    }

    private static void stopNow() {
        HANDLER.removeCallbacksAndMessages(null);
        try {
            if (ringtone != null && ringtone.isPlaying()) {
                ringtone.stop();
            }
        } catch (Exception ignored) {
        }
        ringtone = null;
        releaseWakeLock();
    }

    private static Uri soundUri() {
        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return uri;
    }

    private static void acquireWakeLock(Context app) {
        try {
            PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kamali:reminder-ring");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(MAX_MS + 1500);
        } catch (Exception ignored) {
        }
    }

    private static void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
        wakeLock = null;
    }
}
