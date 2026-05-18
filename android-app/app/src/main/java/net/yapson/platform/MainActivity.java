package net.yapson.platform;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class MainActivity extends Activity {

    private WebView       webView;
    private ProgressBar   progressBar;
    private SharedPreferences prefs;

    private static final String APP_URL   = "https://yapson-platform-production.up.railway.app/";
    private static final String PREF_ZOOM = "textZoom";
    private static final int    ZOOM_MIN  = 75;
    private static final int    ZOOM_MAX  = 175;
    private static final int    ZOOM_STEP = 10;
    private static final int    ZOOM_DEF  = 110;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().setStatusBarColor(Color.parseColor("#080b10"));
        getWindow().setNavigationBarColor(Color.parseColor("#080b10"));

        prefs = getSharedPreferences("yapson_prefs", Context.MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#080b10"));

        // Progress bar
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setVisibility(View.GONE);
        FrameLayout.LayoutParams pbp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, 8
        );
        pbp.gravity = Gravity.TOP;

        // WebView
        webView = new WebView(this);
        FrameLayout.LayoutParams wvp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        );

        // Zoom bar
        LinearLayout zoomBar = buildZoomBar();
        FrameLayout.LayoutParams zbp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        zbp.gravity = Gravity.BOTTOM | Gravity.END;
        zbp.setMargins(0, 0, 20, 72);

        root.addView(webView, wvp);
        root.addView(progressBar, pbp);
        root.addView(zoomBar, zbp);
        setContentView(root);

        setupWebView();
        applyZoom(prefs.getInt(PREF_ZOOM, ZOOM_DEF));

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    private LinearLayout buildZoomBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);

        android.graphics.drawable.GradientDrawable bg =
            new android.graphics.drawable.GradientDrawable();
        bg.setColor(0xCC1a1f2e);
        bg.setCornerRadius(40f);
        bar.setBackground(bg);
        bar.setPadding(8, 4, 8, 4);

        bar.addView(makeBtn("A-", -1));
        bar.addView(makeSep());
        bar.addView(makeBtn("A", 0));
        bar.addView(makeSep());
        bar.addView(makeBtn("A+", 1));
        return bar;
    }

    private View makeSep() {
        View sep = new View(this);
        sep.setBackgroundColor(0x4400e5a0);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(1, 
            LinearLayout.LayoutParams.MATCH_PARENT);
        p.setMargins(0, 6, 0, 6);
        sep.setLayoutParams(p);
        return sep;
    }

    private TextView makeBtn(final String label, final int dir) {
        final TextView btn = new TextView(this);
        btn.setText(label);
        btn.setTextColor(0xFF00e5a0);
        btn.setTextSize(dir == 0 ? 13f : 15f);
        btn.setTypeface(Typeface.DEFAULT_BOLD);
        btn.setPadding(20, 12, 20, 12);
        btn.setGravity(Gravity.CENTER);
        btn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                int cur = prefs.getInt(PREF_ZOOM, ZOOM_DEF);
                int next;
                if (dir == 0) {
                    next = ZOOM_DEF;
                } else {
                    next = cur + dir * ZOOM_STEP;
                    if (next < ZOOM_MIN) next = ZOOM_MIN;
                    if (next > ZOOM_MAX) next = ZOOM_MAX;
                }
                applyZoom(next);
                prefs.edit().putInt(PREF_ZOOM, next).apply();
                btn.setTextColor(0xFFFFFFFF);
                btn.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        btn.setTextColor(0xFF00e5a0);
                    }
                }, 150);
            }
        });
        return btn;
    }

    private void applyZoom(int zoom) {
        webView.getSettings().setTextZoom(zoom);
    }

    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // setInitialScale sur WebView, pas WebSettings

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (!url.contains("yapson-platform-production.up.railway.app")
                 && !url.contains("yapson.net")) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return true;
                }
                return false;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                progressBar.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
                progressBar.setProgress(p);
            }
        });

        webView.setBackgroundColor(Color.parseColor("#080b10"));
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        webView.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (webView != null) webView.destroy();
    }
}
