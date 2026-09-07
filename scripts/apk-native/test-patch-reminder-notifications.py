#!/usr/bin/env python3
"""Sanity-check the reminder-notification Android patcher on both MainActivity shapes."""
from __future__ import annotations

from pathlib import Path
import tempfile

from importlib.machinery import SourceFileLoader

PATCHER = SourceFileLoader(
    "patch_reminder_notifications",
    str(Path(__file__).with_name("patch-reminder-notifications.py")),
).load_module()

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:label="کمالی">
        <activity android:name=".MainActivity" />
    </application>
</manifest>
"""

EMPTY_MAIN = """package com.kamali.inventory;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
"""

VOICE_MAIN = """package com.kamali.inventory;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = this.bridge.getWebView();
        webView.addJavascriptInterface(new KamaliVoiceBridge(), "KamaliVoice");
    }
}
"""


def run_case(label: str, main_src: str) -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        java = root / "app/src/main/java/com/kamali/inventory"
        java.mkdir(parents=True)
        (java / "MainActivity.java").write_text(main_src, encoding="utf-8")
        manifest = root / "app/src/main/AndroidManifest.xml"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(MANIFEST, encoding="utf-8")

        old_root = PATCHER.ANDROID_ROOT
        PATCHER.ANDROID_ROOT = root
        try:
            PATCHER.copy_java(java)
            PATCHER.patch_manifest(manifest)
            PATCHER.patch_main_activity(java / "MainActivity.java")
        finally:
            PATCHER.ANDROID_ROOT = old_root

        main = (java / "MainActivity.java").read_text(encoding="utf-8")
        man = manifest.read_text(encoding="utf-8")
        assert "KamaliReminders" in main, f"{label}: missing JS interface"
        assert (java / "ReminderScheduler.java").exists(), f"{label}: scheduler not copied"
        assert "POST_NOTIFICATIONS" in man, f"{label}: missing notify permission"
        assert "ReminderAlarmReceiver" in man, f"{label}: missing alarm receiver"
        assert "ReminderBootReceiver" in man, f"{label}: missing boot receiver"
        gradle = root / "app" / "build.gradle"
        gradle.write_text("dependencies {\n}\n", encoding="utf-8")
        PATCHER.patch_gradle(gradle)
        assert "androidx.core:core:1.13.1" in gradle.read_text(encoding="utf-8")
        print(f"ok {label}")


if __name__ == "__main__":
    run_case("empty", EMPTY_MAIN)
    run_case("voice", VOICE_MAIN)
