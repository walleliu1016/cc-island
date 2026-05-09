package com.ccisland.remote;

import android.os.Bundle;
import android.webkit.SslErrorHandler;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.net.http.SslError;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configure WebView for WebSocket support
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            // Allow mixed content (ws:// from https:// or file://)
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            // Allow file access
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            // Allow universal access from file URLs
            settings.setAllowUniversalAccessFromFileURLs(true);
            settings.setAllowFileAccessFromFileURLs(true);

            // Ignore SSL certificate errors (for self-signed certificates in internal network)
            webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override
                public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                    // Proceed anyway (ignore SSL certificate error)
                    // WARNING: This reduces security, only use for trusted internal networks
                    handler.proceed();
                }
            });
        }
    }
}