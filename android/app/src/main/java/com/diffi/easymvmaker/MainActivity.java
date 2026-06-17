package com.diffi.easymvmaker;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.widget.TextView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Bridge;

public class MainActivity extends BridgeActivity {
    private volatile boolean pageFinished = false;
    private final StringBuilder lastErrors = new StringBuilder();
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Enable remote debugging (chrome://inspect) to diagnose white-screen issues.
        WebView.setWebContentsDebuggingEnabled(true);

        try {
            final Bridge b = getBridge();
            if (b == null) {
                showNativeError("Bridge is null (WebView init failed).");
                return;
            }
            final WebView wv = b.getWebView();
            if (wv == null) {
                showNativeError("WebView is null (missing WebView implementation?).");
                return;
            }

            // Preserve Capacitor behavior, but capture console errors for diagnosis.
            wv.setWebChromeClient(new DebugChromeClient(b));
            b.setWebViewClient(new DebugBridgeWebViewClient(b));

            // If we never reach onPageFinished, show the last known error instead of a blank screen.
            handler.postDelayed(() -> {
                if (!pageFinished) {
                    final String url = wv.getUrl();
                    final String serverUrl = b.getServerUrl();
                    showNativeError(
                        "WebView did not finish loading.\n\n" +
                        "serverUrl=" + serverUrl + "\n" +
                        "webViewUrl=" + url + "\n\n" +
                        "errors:\n" + lastErrors.toString()
                    );
                }
            }, 4000);
        } catch (Throwable t) {
            showNativeError("MainActivity init failed: " + t);
        }
    }

    private void appendError(String s) {
        if (s == null) return;
        // Keep it short to avoid huge memory usage.
        if (lastErrors.length() > 6000) return;
        lastErrors.append(s).append("\n");
    }

    private void showNativeError(final String msg) {
        handler.post(() -> {
            try {
                TextView tv = new TextView(this);
                tv.setText(msg == null ? "(unknown error)" : msg);
                tv.setTextSize(12);
                tv.setTextColor(0xFFE5E7EB);
                tv.setBackgroundColor(0xFF0B0B12);
                tv.setPadding(24, 24, 24, 24);
                tv.setGravity(Gravity.TOP | Gravity.START);
                setContentView(tv, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            } catch (Throwable ignored) { }
        });
    }

    private class DebugChromeClient extends BridgeWebChromeClient {
        DebugChromeClient(Bridge bridge) { super(bridge); }

        @Override
        public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
            if (consoleMessage != null) {
                String m = consoleMessage.message();
                if (m != null && (consoleMessage.messageLevel() == ConsoleMessage.MessageLevel.ERROR || m.contains("Uncaught") || m.contains("TypeError"))) {
                    appendError("console(" + consoleMessage.messageLevel() + "): " + m + " @ " + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber());
                }
            }
            return super.onConsoleMessage(consoleMessage);
        }
    }

    private class DebugBridgeWebViewClient extends BridgeWebViewClient {
        DebugBridgeWebViewClient(Bridge bridge) { super(bridge); }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageFinished = true;
            appendError("pageFinished: " + url);
            super.onPageFinished(view, url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            try {
                boolean main = request != null && request.isForMainFrame();
                String u = request != null ? String.valueOf(request.getUrl()) : "(no url)";
                String e = error != null ? String.valueOf(error.getDescription()) : "(no error)";
                appendError("onReceivedError main=" + main + " url=" + u + " err=" + e);
            } catch (Throwable ignored) { }
            super.onReceivedError(view, request, error);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            try {
                boolean main = request != null && request.isForMainFrame();
                String u = request != null ? String.valueOf(request.getUrl()) : "(no url)";
                int status = errorResponse != null ? errorResponse.getStatusCode() : -1;
                appendError("onReceivedHttpError main=" + main + " url=" + u + " status=" + status);
            } catch (Throwable ignored) { }
            super.onReceivedHttpError(view, request, errorResponse);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            appendError("onRenderProcessGone: " + detail);
            return super.onRenderProcessGone(view, detail);
        }
    }
}
