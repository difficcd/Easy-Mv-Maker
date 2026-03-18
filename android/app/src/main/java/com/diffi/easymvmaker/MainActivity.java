package com.diffi.easymvmaker;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Enable remote debugging (chrome://inspect) to diagnose white-screen issues.
        WebView.setWebContentsDebuggingEnabled(true);
    }
}
