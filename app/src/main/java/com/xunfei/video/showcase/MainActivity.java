package com.xunfei.video.showcase;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.io.InputStream;
import java.util.List;

public class MainActivity extends Activity {
    private static final String TAG = "ShowcaseScript";
    private static final String EXTRA_SCRIPT = "script";
    private static final String EXTRA_SCRIPT_BASE64 = "scriptBase64";
    private static final String ACTION_STATUS = "com.xunfei.video.showcase.SCRIPT_STATUS";
    private static final int GREEN = Color.rgb(149, 236, 105);
    private static final int PAGE_BG = Color.rgb(237, 237, 237);
    private static final int BAR_BG = Color.rgb(247, 247, 247);
    private static final int TEXT = Color.rgb(18, 18, 18);
    private static final int AVATAR_SIZE_DP = 40;
    private static final int BUBBLE_TAIL_CENTER_DP = AVATAR_SIZE_DP / 2;
    private static final int REQ_CONTACT_AVATAR = 1001;
    private static final int REQ_MINE_AVATAR = 1002;
    private static final int REQ_CHAT_BACKGROUND = 1003;
    private static final String PREFS = "showcase_settings";
    private static final String KEY_CONTACT_NAME = "contact_name";
    private static final String KEY_CONTACT_AVATAR_URI = "contact_avatar_uri";
    private static final String KEY_MINE_AVATAR_URI = "mine_avatar_uri";
    private static final String KEY_CHAT_BACKGROUND_URI = "chat_background_uri";

    private LinearLayout messages;
    private ScrollView scrollView;
    private EditText input;
    private TextView titleView;
    private ImageView inputMikeIcon;
    private ImageView addButton;
    private TextView sendButton;
    private FrameLayout actionSlot;
    private boolean sendMode;
    private LinearLayout rootLayout;
    private View profilePanel;
    private int lastKeyboardHeight;
    private String contactName = "\u5b9d";
    private int contactAvatarStyle;
    private Uri contactAvatarUri;
    private Uri mineAvatarUri;
    private Uri chatBackgroundUri;
    private Bitmap contactAvatarBitmap;
    private Bitmap mineAvatarBitmap;
    private Bitmap chatBackgroundBitmap;
    private final Handler scriptHandler = new Handler(Looper.getMainLooper());
    private final List<Runnable> pendingScriptSteps = new ArrayList<>();
    private boolean scriptRunning;
    private int scriptRunId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(true);
        }
        window.setStatusBarColor(BAR_BG);
        window.setNavigationBarColor(BAR_BG);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        loadSettings();

        rootLayout = new LinearLayout(this);
        rootLayout.setOrientation(LinearLayout.VERTICAL);
        rootLayout.setBackgroundColor(PAGE_BG);
        setContentView(rootLayout);

        rootLayout.addView(createTopBar());
        rootLayout.addView(createMessageArea(), new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        rootLayout.addView(createInputBar());
        installKeyboardResizeFallback();

        clearMessages();
        rootLayout.postDelayed(() -> runScriptFromIntent(getIntent()), 300);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        runScriptFromIntent(intent);
    }

    private View createTopBar() {
        FrameLayout bar = new FrameLayout(this);
        bar.setBackgroundColor(BAR_BG);
        bar.setPadding(dp(8), 0, dp(8), 0);
        bar.setMinimumHeight(dp(50));

        LinearLayout left = new LinearLayout(this);
        left.setOrientation(LinearLayout.HORIZONTAL);
        left.setGravity(Gravity.CENTER_VERTICAL);

        left.addView(icon(R.drawable.ic_weui_back, dp(4)),
                new LinearLayout.LayoutParams(dp(36), dp(50)));

        FrameLayout.LayoutParams leftLp = new FrameLayout.LayoutParams(
                dp(72), dp(50), Gravity.LEFT | Gravity.CENTER_VERTICAL);
        bar.addView(left, leftLp);

        titleView = new TextView(this);
        titleView.setText(contactName);
        titleView.setTextColor(Color.BLACK);
        setTextDp(titleView, 18);
        titleView.setTypeface(Typeface.DEFAULT, Typeface.NORMAL);
        titleView.setGravity(Gravity.CENTER);
        bar.addView(titleView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, dp(50), Gravity.CENTER));

        ImageView more = icon(R.drawable.ic_weui_more, dp(12));
        more.setOnClickListener(v -> showProfileDialog());
        FrameLayout.LayoutParams moreLp = new FrameLayout.LayoutParams(
                dp(58), dp(50), Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        bar.addView(more, moreLp);

        View line = new View(this);
        line.setBackgroundColor(Color.rgb(224, 224, 224));
        FrameLayout.LayoutParams lineLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, dp(1), Gravity.BOTTOM);
        bar.addView(line, lineLp);

        return bar;
    }

    private View createMessageArea() {
        scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        updateChatBackground();
        scrollView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        messages = new LinearLayout(this);
        messages.setOrientation(LinearLayout.VERTICAL);
        messages.setPadding(dp(14), dp(10), dp(14), dp(14));
        scrollView.addView(messages, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
        return scrollView;
    }

    private View createInputBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(10), dp(6), dp(9), dp(6));
        bar.setBackgroundColor(BAR_BG);
        bar.setMinimumHeight(dp(52));

        bar.addView(icon(R.drawable.ic_weui_voice, 0),
                new LinearLayout.LayoutParams(dp(35), dp(35)));

        input = new EditText(this);
        input.setSingleLine(false);
        input.setMaxLines(3);
        setTextDp(input, 16);
        input.setTextColor(TEXT);
        input.setHint("");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        input.setBackgroundColor(Color.TRANSPARENT);
        input.setPadding(dp(10), 0, dp(34), 0);

        FrameLayout inputBox = new FrameLayout(this);
        inputBox.setBackground(roundRect(Color.WHITE, dp(3), 0, 0));
        inputBox.addView(input, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        inputMikeIcon = icon(R.drawable.ic_weui_mike_gray, dp(4), Color.rgb(120, 120, 120), 0.45f);
        FrameLayout.LayoutParams mikeLp = new FrameLayout.LayoutParams(dp(20), dp(20),
                Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        mikeLp.rightMargin = dp(5);
        inputBox.addView(inputMikeIcon, mikeLp);

        LinearLayout.LayoutParams inputLp = new LinearLayout.LayoutParams(0, dp(38), 1f);
        inputLp.leftMargin = dp(9);
        inputLp.rightMargin = dp(9);
        bar.addView(inputBox, inputLp);

        bar.addView(icon(R.drawable.ic_weui_sticker, 0),
                new LinearLayout.LayoutParams(dp(35), dp(35)));

        actionSlot = new FrameLayout(this);
        addButton = icon(R.drawable.ic_weui_add2, 0);
        actionSlot.addView(addButton, new FrameLayout.LayoutParams(dp(35), dp(35),
                Gravity.RIGHT | Gravity.CENTER_VERTICAL));

        sendButton = new TextView(this);
        sendButton.setText("\u53d1\u9001");
        setTextDp(sendButton, 14);
        sendButton.setTextColor(Color.WHITE);
        sendButton.setGravity(Gravity.CENTER);
        sendButton.setBackground(roundRect(Color.rgb(7, 193, 96), dp(4), 0, 0));
        sendButton.setVisibility(View.GONE);
        sendButton.setAlpha(0f);
        sendButton.setTranslationX(dp(18));
        sendButton.setOnClickListener(v -> sendCurrentInput());
        actionSlot.addView(sendButton, new FrameLayout.LayoutParams(dp(54), dp(34),
                Gravity.RIGHT | Gravity.CENTER_VERTICAL));

        LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(dp(35), dp(35));
        actionLp.leftMargin = dp(7);
        bar.addView(actionSlot, actionLp);

        input.setOnFocusChangeListener((v, hasFocus) -> {
            if (hasFocus) showKeyboard();
        });
        input.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                setSendMode(s.toString().trim().length() > 0);
            }

            @Override
            public void afterTextChanged(Editable s) {
            }
        });
        return bar;
    }

    private void seedMessages() {
        addMessage("\u8fd8\u6709\u4e94\u4e2a\u6ca1\u7a7f", false);
        addMessage("\u4e0d\u77e5\u9053", false);
        addMessage("\u5dee\u4e0d\u591a", false);
        addMessage("\u6211\u6d17\u597d\u4f60\u80fd\u5f04\u5b8c\u5417", true);
        addMessage("\u90a3\u4f60\u628a\u5f04\u5b8c\u7684\u6ca1\u4f20\u7684\u5148\u53d1\u6211\u5427", true);
        addMessage("\u4f60\u5148\u6d17\u5427", false);
        addTime("\u6628\u5929 04:42");
        addMessage("\u4f60\u526a\u5b8c\u4e86\u5c31\u53d1\u6211\u5427", true);
        addTime("\u6628\u5929 04:50");
        addMessage("\u6211\u641e", false);
        addMessage("\u4f60\u7761\u5427", false);
        addTime("\u6628\u5929 04:56");
        addMessage("\u7b49\u4f60\u5457", true);
        addMessage("\u6ca1\u4e8b", true);
        scrollView.post(() -> scrollView.fullScroll(View.FOCUS_DOWN));
    }

    private void addTime(String text) {
        TextView time = new TextView(this);
        time.setText(text);
        setTextDp(time, 13);
        time.setTextColor(Color.rgb(135, 135, 135));
        time.setGravity(Gravity.CENTER);
        time.setTypeface(Typeface.DEFAULT);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(42));
        lp.topMargin = dp(10);
        lp.bottomMargin = dp(6);
        messages.addView(time, lp);
    }

    private void sendCurrentInput() {
        String text = input.getText().toString().trim();
        if (text.isEmpty()) return;
        input.setText("");
        addMessage(text, true);
    }

    private void clearMessages() {
        messages.removeAllViews();
    }

    private void runScriptFromIntent(Intent intent) {
        String scriptJson = getScriptJson(intent);
        if (scriptJson == null || scriptJson.trim().isEmpty()) return;

        try {
            JSONObject script = new JSONObject(scriptJson);
            applyScriptMeta(script);
            List<ScriptAction> actions = parseActions(script);
            if (actions.isEmpty()) {
                reportScriptStatus("failed", "script has no actions");
                return;
            }
            startScript(actions);
        } catch (JSONException e) {
            reportScriptStatus("failed", "invalid script json: " + e.getMessage());
        }
    }

    private String getScriptJson(Intent intent) {
        if (intent == null) return null;
        String base64 = intent.getStringExtra(EXTRA_SCRIPT_BASE64);
        if (base64 == null) {
            base64 = intent.getStringExtra("script_base64");
        }
        if (base64 != null && !base64.trim().isEmpty()) {
            try {
                byte[] bytes = Base64.decode(base64.trim(), Base64.DEFAULT);
                return new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                reportScriptStatus("failed", "invalid script base64: " + e.getMessage());
                return null;
            }
        }
        return intent.getStringExtra(EXTRA_SCRIPT);
    }

    private void applyScriptMeta(JSONObject script) {
        JSONObject contact = script.optJSONObject("contact");
        if (contact == null) return;

        String name = contact.optString("name", "").trim();
        if (name.isEmpty()) return;

        contactName = name;
        titleView.setText(contactName);
        invalidateAvatarViews(messages);
    }

    private List<ScriptAction> parseActions(JSONObject script) throws JSONException {
        List<ScriptAction> actions = new ArrayList<>();
        JSONArray array = script.optJSONArray("actions");
        if (array == null) return actions;

        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.getJSONObject(i);
            ScriptAction action = new ScriptAction();
            action.type = item.optString("type", "").trim();
            action.text = item.optString("text", "");
            action.speed = Math.max(20, item.optInt("speed", 120));
            action.duration = Math.max(0, item.optInt("duration", 0));
            action.count = Math.max(1, item.optInt("count", 1));
            action.mine = item.optBoolean("mine", true);
            String side = item.optString("side", "");
            if ("other".equalsIgnoreCase(side) || "left".equalsIgnoreCase(side)) {
                action.mine = false;
            }
            actions.add(action);
        }
        return actions;
    }

    private void startScript(List<ScriptAction> actions) {
        cancelScript();
        int runId = ++scriptRunId;
        scriptRunning = true;
        reportScriptStatus("running", "actions=" + actions.size());
        focusInput();
        executeScriptAction(actions, 0, runId);
    }

    private void executeScriptAction(List<ScriptAction> actions, int index, int runId) {
        if (runId != scriptRunId) return;
        if (index >= actions.size()) {
            input.setText("");
            scriptRunning = false;
            reportScriptStatus("completed", "actions=" + actions.size());
            return;
        }

        ScriptAction action = actions.get(index);
        reportScriptStatus("action", index + ":" + action.type);
        switch (action.type) {
            case "clear":
                clearMessages();
                scheduleScriptStep(() -> executeScriptAction(actions, index + 1, runId), 200);
                break;
            case "focusInput":
                focusInput();
                scheduleScriptStep(() -> executeScriptAction(actions, index + 1, runId), 350);
                break;
            case "input":
                focusInput();
                typeText(action.text, action.speed, () -> executeScriptAction(actions, index + 1, runId));
                break;
            case "commitText":
                focusInput();
                commitText(action.text);
                scheduleScriptStep(() -> executeScriptAction(actions, index + 1, runId), 180);
                break;
            case "delete":
                deleteInputText(action.count, action.speed, () -> executeScriptAction(actions, index + 1, runId));
                break;
            case "send":
                sendCurrentInput();
                scheduleScriptStep(() -> executeScriptAction(actions, index + 1, runId), 350);
                break;
            case "wait":
                scheduleScriptStep(() -> executeScriptAction(actions, index + 1, runId), action.duration);
                break;
            case "message":
                addMessage(action.text, action.mine);
                scheduleScriptStep(() -> executeScriptAction(actions, index + 1, runId), 300);
                break;
            case "time":
                addTime(action.text);
                scheduleScriptStep(() -> executeScriptAction(actions, index + 1, runId), 200);
                break;
            case "scrollBottom":
                scrollView.post(() -> scrollView.fullScroll(View.FOCUS_DOWN));
                scheduleScriptStep(() -> executeScriptAction(actions, index + 1, runId), 200);
                break;
            default:
                reportScriptStatus("failed", "unknown action type: " + action.type);
                scriptRunning = false;
                break;
        }
    }

    private void typeText(String text, int speed, Runnable afterTyped) {
        input.setText("");
        if (text == null || text.isEmpty()) {
            scheduleScriptStep(afterTyped, 100);
            return;
        }
        typeTextChar(text, 0, speed, afterTyped);
    }

    private void typeTextChar(String text, int index, int speed, Runnable afterTyped) {
        if (index >= text.length()) {
            scheduleScriptStep(afterTyped, 250);
            return;
        }
        input.getText().append(String.valueOf(text.charAt(index)));
        scheduleScriptStep(() -> typeTextChar(text, index + 1, speed, afterTyped), speed);
    }

    private void commitText(String text) {
        input.setText(text == null ? "" : text);
        input.setSelection(input.length());
    }

    private void deleteInputText(int count, int speed, Runnable afterDeleted) {
        if (count <= 0 || input.length() == 0) {
            scheduleScriptStep(afterDeleted, 100);
            return;
        }
        int end = input.length();
        input.getText().delete(end - 1, end);
        scheduleScriptStep(() -> deleteInputText(count - 1, speed, afterDeleted), speed);
    }

    private void focusInput() {
        input.requestFocus();
        showKeyboard();
    }

    private void scheduleScriptStep(Runnable step, long delayMs) {
        final Runnable[] holder = new Runnable[1];
        holder[0] = () -> {
            pendingScriptSteps.remove(holder[0]);
            step.run();
        };
        pendingScriptSteps.add(holder[0]);
        scriptHandler.postDelayed(holder[0], Math.max(0, delayMs));
    }

    private void cancelScript() {
        for (Runnable step : pendingScriptSteps) {
            scriptHandler.removeCallbacks(step);
        }
        pendingScriptSteps.clear();
        if (scriptRunning) {
            reportScriptStatus("cancelled", "new script received");
        }
        scriptRunning = false;
    }

    private void reportScriptStatus(String status, String detail) {
        Log.i(TAG, status + " " + detail);
        Intent statusIntent = new Intent(ACTION_STATUS);
        statusIntent.putExtra("status", status);
        statusIntent.putExtra("detail", detail);
        sendBroadcast(statusIntent);
    }

    private void setSendMode(boolean enabled) {
        if (sendMode == enabled) return;
        sendMode = enabled;

        LinearLayout.LayoutParams actionLp = (LinearLayout.LayoutParams) actionSlot.getLayoutParams();
        actionLp.width = dp(enabled ? 58 : 35);
        actionSlot.setLayoutParams(actionLp);

        inputMikeIcon.animate().alpha(enabled ? 0f : 0.45f).setDuration(120).start();
        addButton.animate().alpha(enabled ? 0f : 1f).setDuration(120).start();
        addButton.setVisibility(enabled ? View.INVISIBLE : View.VISIBLE);

        if (enabled) {
            sendButton.setVisibility(View.VISIBLE);
            sendButton.setTranslationX(dp(18));
            sendButton.setAlpha(0f);
            sendButton.animate().translationX(0f).alpha(1f).setDuration(160).start();
        } else {
            sendButton.animate().translationX(dp(18)).alpha(0f).setDuration(120)
                    .withEndAction(() -> sendButton.setVisibility(View.GONE))
                    .start();
        }
    }

    private void showProfileDialog() {
        Dialog dialog = new Dialog(this);
        LinearLayout panel = new LinearLayout(this);
        profilePanel = panel;
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(22), dp(20), dp(22), dp(16));
        panel.setBackground(roundRect(Color.WHITE, dp(8), 0, 0));

        TextView title = new TextView(this);
        title.setText("\u804a\u5929\u8bbe\u7f6e");
        setTextDp(title, 18);
        title.setTextColor(TEXT);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        panel.addView(title, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(30)));

        TextView remarkLabel = label("\u5907\u6ce8");
        LinearLayout.LayoutParams labelLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(30));
        labelLp.topMargin = dp(12);
        panel.addView(remarkLabel, labelLp);

        EditText remark = new EditText(this);
        remark.setSingleLine(true);
        remark.setText(contactName);
        setTextDp(remark, 16);
        remark.setTextColor(TEXT);
        remark.setPadding(dp(10), 0, dp(10), 0);
        remark.setBackground(roundRect(Color.rgb(247, 247, 247), dp(4), Color.rgb(225, 225, 225), 1));
        panel.addView(remark, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(42)));

        TextView avatarLabel = label("\u5934\u50cf");
        LinearLayout.LayoutParams avatarLabelLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(30));
        avatarLabelLp.topMargin = dp(12);
        panel.addView(avatarLabel, avatarLabelLp);

        panel.addView(avatarSettingRow("\u5bf9\u65b9\u5934\u50cf", false), new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(54)));
        LinearLayout.LayoutParams mineAvatarLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(54));
        mineAvatarLp.topMargin = dp(8);
        panel.addView(avatarSettingRow("\u6211\u7684\u5934\u50cf", true), mineAvatarLp);

        TextView bgLabel = label("\u804a\u5929\u80cc\u666f");
        LinearLayout.LayoutParams bgLabelLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(30));
        bgLabelLp.topMargin = dp(12);
        panel.addView(bgLabel, bgLabelLp);
        panel.addView(backgroundSettingRow(), new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(54)));

        TextView contentLabel = label("\u5bf9\u65b9\u804a\u5929\u5185\u5bb9");
        LinearLayout.LayoutParams contentLabelLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(30));
        contentLabelLp.topMargin = dp(12);
        panel.addView(contentLabel, contentLabelLp);

        EditText otherMessage = new EditText(this);
        otherMessage.setSingleLine(true);
        otherMessage.setHint("\u8f93\u5165\u5bf9\u65b9\u8981\u53d1\u7684\u6d88\u606f");
        setTextDp(otherMessage, 15);
        otherMessage.setTextColor(TEXT);
        otherMessage.setPadding(dp(10), 0, dp(10), 0);
        otherMessage.setBackground(roundRect(Color.rgb(247, 247, 247), dp(4), Color.rgb(225, 225, 225), 1));
        panel.addView(otherMessage, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(42)));

        LinearLayout contentActions = new LinearLayout(this);
        contentActions.setOrientation(LinearLayout.HORIZONTAL);
        contentActions.setGravity(Gravity.CENTER_VERTICAL);
        TextView clear = dialogButton("\u6e05\u7a7a\u804a\u5929\u8bb0\u5f55", Color.rgb(230, 72, 65), Color.TRANSPARENT);
        clear.setOnClickListener(v -> clearMessages());
        contentActions.addView(clear, new LinearLayout.LayoutParams(0, dp(38), 1f));

        TextView addOther = dialogButton("\u6dfb\u52a0\u5bf9\u65b9\u6d88\u606f", Color.WHITE, Color.rgb(7, 193, 96));
        LinearLayout.LayoutParams addOtherLp = new LinearLayout.LayoutParams(dp(128), dp(38));
        addOtherLp.leftMargin = dp(8);
        contentActions.addView(addOther, addOtherLp);
        addOther.setOnClickListener(v -> {
            String text = otherMessage.getText().toString().trim();
            if (text.isEmpty()) return;
            otherMessage.setText("");
            addMessage(text, false);
        });
        LinearLayout.LayoutParams contentActionsLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(42));
        contentActionsLp.topMargin = dp(8);
        panel.addView(contentActions, contentActionsLp);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        buttons.setOrientation(LinearLayout.HORIZONTAL);

        TextView cancel = dialogButton("\u53d6\u6d88", Color.rgb(80, 80, 80), Color.TRANSPARENT);
        cancel.setOnClickListener(v -> dialog.dismiss());
        buttons.addView(cancel, new LinearLayout.LayoutParams(dp(70), dp(38)));

        TextView save = dialogButton("\u4fdd\u5b58", Color.WHITE, Color.rgb(7, 193, 96));
        LinearLayout.LayoutParams saveLp = new LinearLayout.LayoutParams(dp(76), dp(38));
        saveLp.leftMargin = dp(8);
        buttons.addView(save, saveLp);
        save.setOnClickListener(v -> {
            String name = remark.getText().toString().trim();
            contactName = name.isEmpty() ? "\u5b9d" : name;
            titleView.setText(contactName);
            saveString(KEY_CONTACT_NAME, contactName);
            invalidateAvatarViews(messages);
            dialog.dismiss();
        });

        LinearLayout.LayoutParams buttonsLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(44));
        buttonsLp.topMargin = dp(18);
        panel.addView(buttons, buttonsLp);

        dialog.setContentView(panel);
        dialog.setOnDismissListener(d -> profilePanel = null);
        dialog.setOnShowListener(d -> {
            Window w = dialog.getWindow();
            if (w != null) {
                w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
                WindowManager.LayoutParams lp = new WindowManager.LayoutParams();
                lp.copyFrom(w.getAttributes());
                lp.width = Math.min(getResources().getDisplayMetrics().widthPixels - dp(40), dp(360));
                lp.height = WindowManager.LayoutParams.WRAP_CONTENT;
                w.setAttributes(lp);
            }
        });
        dialog.show();
    }

    private TextView label(String text) {
        TextView label = new TextView(this);
        label.setText(text);
        setTextDp(label, 14);
        label.setTextColor(Color.rgb(120, 120, 120));
        label.setGravity(Gravity.CENTER_VERTICAL);
        return label;
    }

    private TextView dialogButton(String text, int textColor, int bgColor) {
        TextView button = new TextView(this);
        button.setText(text);
        setTextDp(button, 15);
        button.setTextColor(textColor);
        button.setGravity(Gravity.CENTER);
        if (bgColor != Color.TRANSPARENT) {
            button.setBackground(roundRect(bgColor, dp(4), 0, 0));
        }
        return button;
    }

    private LinearLayout avatarSettingRow(String label, boolean mine) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        AvatarView preview = new AvatarView(this, mine);
        row.addView(preview, new LinearLayout.LayoutParams(dp(42), dp(42)));

        TextView name = new TextView(this);
        name.setText(label);
        setTextDp(name, 15);
        name.setTextColor(TEXT);
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(0, dp(42), 1f);
        nameLp.leftMargin = dp(10);
        row.addView(name, nameLp);

        TextView choose = dialogButton("\u9009\u62e9\u56fe\u7247", Color.rgb(7, 193, 96), Color.TRANSPARENT);
        choose.setOnClickListener(v -> pickAvatarImage(mine));
        row.addView(choose, new LinearLayout.LayoutParams(dp(88), dp(38)));

        TextView reset = dialogButton("\u9ed8\u8ba4", Color.rgb(120, 120, 120), Color.TRANSPARENT);
        reset.setOnClickListener(v -> {
            if (mine) {
                mineAvatarUri = null;
                mineAvatarBitmap = null;
                removeSetting(KEY_MINE_AVATAR_URI);
            } else {
                contactAvatarUri = null;
                contactAvatarBitmap = null;
                removeSetting(KEY_CONTACT_AVATAR_URI);
            }
            preview.invalidate();
            invalidateAvatarViews(messages);
        });
        row.addView(reset, new LinearLayout.LayoutParams(dp(54), dp(38)));
        return row;
    }

    private LinearLayout backgroundSettingRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        BackgroundPreviewView preview = new BackgroundPreviewView(this);
        row.addView(preview, new LinearLayout.LayoutParams(dp(42), dp(42)));

        TextView name = new TextView(this);
        name.setText("\u804a\u5929\u80cc\u666f");
        setTextDp(name, 15);
        name.setTextColor(TEXT);
        LinearLayout.LayoutParams nameLp = new LinearLayout.LayoutParams(0, dp(42), 1f);
        nameLp.leftMargin = dp(10);
        row.addView(name, nameLp);

        TextView choose = dialogButton("\u9009\u62e9\u56fe\u7247", Color.rgb(7, 193, 96), Color.TRANSPARENT);
        choose.setOnClickListener(v -> pickChatBackground());
        row.addView(choose, new LinearLayout.LayoutParams(dp(88), dp(38)));

        TextView reset = dialogButton("\u9ed8\u8ba4", Color.rgb(120, 120, 120), Color.TRANSPARENT);
        reset.setOnClickListener(v -> {
            chatBackgroundUri = null;
            chatBackgroundBitmap = null;
            removeSetting(KEY_CHAT_BACKGROUND_URI);
            updateChatBackground();
            preview.invalidate();
        });
        row.addView(reset, new LinearLayout.LayoutParams(dp(54), dp(38)));
        return row;
    }

    private void pickAvatarImage(boolean mine) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, mine ? REQ_MINE_AVATAR : REQ_CONTACT_AVATAR);
    }

    private void pickChatBackground() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, REQ_CHAT_BACKGROUND);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;

        Uri uri = data.getData();
        try {
            final int flags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            if (flags != 0) getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (SecurityException ignored) {
        }

        Bitmap bitmap = decodeBitmap(uri, requestCode == REQ_CHAT_BACKGROUND ? 1600 : 512);
        if (bitmap == null) return;

        if (requestCode == REQ_MINE_AVATAR) {
            mineAvatarUri = uri;
            mineAvatarBitmap = bitmap;
            saveString(KEY_MINE_AVATAR_URI, uri.toString());
        } else if (requestCode == REQ_CONTACT_AVATAR) {
            contactAvatarUri = uri;
            contactAvatarBitmap = bitmap;
            saveString(KEY_CONTACT_AVATAR_URI, uri.toString());
        } else if (requestCode == REQ_CHAT_BACKGROUND) {
            chatBackgroundUri = uri;
            chatBackgroundBitmap = bitmap;
            saveString(KEY_CHAT_BACKGROUND_URI, uri.toString());
            updateChatBackground();
        }
        invalidateAvatarViews(rootLayout);
        if (profilePanel != null) {
            invalidateAvatarViews(profilePanel);
        }
    }

    private Bitmap decodeBitmap(Uri uri, int targetMaxSide) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                BitmapFactory.decodeStream(in, null, bounds);
            }

            int sample = 1;
            int maxSide = Math.max(bounds.outWidth, bounds.outHeight);
            while (maxSide / sample > targetMaxSide) {
                sample *= 2;
            }

            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                return BitmapFactory.decodeStream(in, null, options);
            }
        } catch (Exception ignored) {
            return null;
        }
    }

    private void loadSettings() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        contactName = prefs.getString(KEY_CONTACT_NAME, contactName);

        contactAvatarUri = uriFromPrefs(prefs, KEY_CONTACT_AVATAR_URI);
        if (contactAvatarUri != null) {
            contactAvatarBitmap = decodeBitmap(contactAvatarUri, 512);
        }

        mineAvatarUri = uriFromPrefs(prefs, KEY_MINE_AVATAR_URI);
        if (mineAvatarUri != null) {
            mineAvatarBitmap = decodeBitmap(mineAvatarUri, 512);
        }

        chatBackgroundUri = uriFromPrefs(prefs, KEY_CHAT_BACKGROUND_URI);
        if (chatBackgroundUri != null) {
            chatBackgroundBitmap = decodeBitmap(chatBackgroundUri, 1600);
        }
    }

    private Uri uriFromPrefs(SharedPreferences prefs, String key) {
        String value = prefs.getString(key, null);
        if (value == null || value.isEmpty()) return null;
        return Uri.parse(value);
    }

    private void saveString(String key, String value) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(key, value).apply();
    }

    private void removeSetting(String key) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(key).apply();
    }

    private void invalidateAvatarViews(View view) {
        if (view instanceof AvatarView || view instanceof BackgroundPreviewView) {
            view.invalidate();
        }
        if (view instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                invalidateAvatarViews(group.getChildAt(i));
            }
        }
    }

    private void addMessage(String text, boolean mine) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(mine ? Gravity.RIGHT : Gravity.LEFT);
        row.setPadding(0, dp(4), 0, dp(8));

        if (!mine) {
            row.addView(new AvatarView(this, false), new LinearLayout.LayoutParams(dp(AVATAR_SIZE_DP), dp(AVATAR_SIZE_DP)));
        }

        TextView bubble = new TextView(this);
        bubble.setText(text);
        setTextDp(bubble, 17);
        bubble.setTextColor(TEXT);
        bubble.setGravity(Gravity.CENTER_VERTICAL);
        bubble.setTypeface(Typeface.DEFAULT);
        bubble.setLineSpacing(dp(1), 1f);
        bubble.setPadding(mine ? dp(12) : dp(15), dp(7), mine ? dp(15) : dp(12), dp(7));
        bubble.setMinHeight(dp(AVATAR_SIZE_DP));
        bubble.setMaxWidth(getResources().getDisplayMetrics().widthPixels - dp(150));
        bubble.setBackground(new BubbleDrawable(mine ? GREEN : Color.WHITE, mine));

        LinearLayout.LayoutParams bubbleLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        bubbleLp.leftMargin = mine ? dp(76) : dp(9);
        bubbleLp.rightMargin = mine ? dp(9) : dp(76);
        row.addView(bubble, bubbleLp);

        if (mine) {
            row.addView(new AvatarView(this, true), new LinearLayout.LayoutParams(dp(AVATAR_SIZE_DP), dp(AVATAR_SIZE_DP)));
        }

        messages.addView(row, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        scrollView.post(() -> scrollView.fullScroll(View.FOCUS_DOWN));
    }

    private void showKeyboard() {
        input.postDelayed(() -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
        }, 120);
    }

    private void installKeyboardResizeFallback() {
        rootLayout.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            Rect visible = new Rect();
            rootLayout.getWindowVisibleDisplayFrame(visible);
            int screenHeight = rootLayout.getRootView().getHeight();
            int hiddenHeight = screenHeight - visible.bottom;
            int keyboardThreshold = dp(120);
            int keyboardHeight = hiddenHeight > keyboardThreshold ? hiddenHeight : 0;
            if (keyboardHeight == lastKeyboardHeight) return;

            lastKeyboardHeight = keyboardHeight;
            scrollView.post(() -> scrollView.fullScroll(View.FOCUS_DOWN));
        });
    }

    private GradientDrawable roundRect(int color, int radius, int strokeColor, int strokeWidth) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.RECTANGLE);
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        if (strokeWidth > 0) drawable.setStroke(dp(strokeWidth), strokeColor);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void setTextDp(TextView view, float value) {
        view.setTextSize(TypedValue.COMPLEX_UNIT_DIP, value);
        view.setIncludeFontPadding(false);
    }

    private ImageView icon(int resId, int padding) {
        return icon(resId, padding, Color.BLACK, 1f);
    }

    private ImageView icon(int resId, int padding, int color, float alpha) {
        ImageView view = new ImageView(this);
        view.setImageResource(resId);
        view.setScaleType(ImageView.ScaleType.CENTER);
        view.setColorFilter(color);
        view.setAlpha(alpha);
        view.setPadding(padding, padding, padding, padding);
        return view;
    }

    private void updateChatBackground() {
        if (scrollView == null) return;
        if (chatBackgroundBitmap == null) {
            scrollView.setBackgroundColor(PAGE_BG);
        } else {
            scrollView.setBackground(new ChatBackgroundDrawable());
        }
    }

    private static class ScriptAction {
        String type;
        String text;
        int speed;
        int duration;
        int count;
        boolean mine;
    }

    private class BubbleDrawable extends Drawable {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final boolean mine;
        private final float radius = dp(6);

        BubbleDrawable(int color, boolean mine) {
            this.mine = mine;
            paint.setColor(color);
        }

        @Override
        public void draw(Canvas canvas) {
            RectF bounds = new RectF(getBounds());
            float tailWidth = dp(5);
            float tailHeight = dp(12);
            float overlap = dp(2);
            Path tailPath = new Path();

            if (mine) {
                bounds.right -= tailWidth;
                canvas.drawRoundRect(bounds, radius, radius, paint);
                float centerY = bounds.top + dp(BUBBLE_TAIL_CENTER_DP);
                tailPath.moveTo(bounds.right - overlap, centerY - tailHeight / 2f);
                tailPath.lineTo(bounds.right + tailWidth, centerY);
                tailPath.lineTo(bounds.right - overlap, centerY + tailHeight / 2f);
                tailPath.close();
            } else {
                bounds.left += tailWidth;
                canvas.drawRoundRect(bounds, radius, radius, paint);
                float centerY = bounds.top + dp(BUBBLE_TAIL_CENTER_DP);
                tailPath.moveTo(bounds.left + overlap, centerY - tailHeight / 2f);
                tailPath.lineTo(bounds.left - tailWidth, centerY);
                tailPath.lineTo(bounds.left + overlap, centerY + tailHeight / 2f);
                tailPath.close();
            }
            canvas.drawPath(tailPath, paint);
        }

        @Override
        public void setAlpha(int alpha) {
            paint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(android.graphics.ColorFilter colorFilter) {
            paint.setColorFilter(colorFilter);
        }

        @Override
        public int getOpacity() {
            return android.graphics.PixelFormat.TRANSLUCENT;
        }
    }

    private class AvatarView extends View {
        private final boolean mine;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        AvatarView(Context context, boolean mine) {
            super(context);
            this.mine = mine;
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            Bitmap bitmap = mine ? mineAvatarBitmap : contactAvatarBitmap;
            if (bitmap != null) {
                drawBitmapAvatar(canvas, bitmap, getWidth(), getHeight(), paint);
            } else {
                drawAvatar(canvas, getWidth(), getHeight(), mine ? 10 : contactAvatarStyle, paint);
            }
        }
    }

    private class BackgroundPreviewView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        BackgroundPreviewView(Context context) {
            super(context);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            RectF dst = new RectF(0, 0, getWidth(), getHeight());
            if (chatBackgroundBitmap == null) {
                paint.setStyle(Paint.Style.FILL);
                paint.setColor(PAGE_BG);
                canvas.drawRoundRect(dst, dp(4), dp(4), paint);
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(dp(1));
                paint.setColor(Color.rgb(210, 210, 210));
                canvas.drawRoundRect(dst, dp(4), dp(4), paint);
            } else {
                drawBitmapCover(canvas, chatBackgroundBitmap, dst, dp(4), paint);
            }
        }
    }

    private class ChatBackgroundDrawable extends Drawable {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        @Override
        public void draw(Canvas canvas) {
            if (chatBackgroundBitmap == null) {
                canvas.drawColor(PAGE_BG);
                return;
            }
            drawBitmapCover(canvas, chatBackgroundBitmap, new RectF(getBounds()), 0, paint);
        }

        @Override
        public void setAlpha(int alpha) {
            paint.setAlpha(alpha);
        }

        @Override
        public void setColorFilter(android.graphics.ColorFilter colorFilter) {
            paint.setColorFilter(colorFilter);
        }

        @Override
        public int getOpacity() {
            return android.graphics.PixelFormat.OPAQUE;
        }
    }

    private class AvatarChoiceView extends View {
        private final int style;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private boolean selectedStyle;

        AvatarChoiceView(Context context, int style) {
            super(context);
            this.style = style;
        }

        void setSelectedStyle(boolean selectedStyle) {
            this.selectedStyle = selectedStyle;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (selectedStyle) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(dp(2));
                paint.setColor(Color.rgb(7, 193, 96));
                canvas.drawRoundRect(new RectF(dp(1), dp(1), getWidth() - dp(1), getHeight() - dp(1)),
                        dp(7), dp(7), paint);
            }
            canvas.save();
            canvas.translate(dp(5), dp(5));
            drawAvatar(canvas, getWidth() - dp(10), getHeight() - dp(10), style, paint);
            canvas.restore();
        }
    }

    private void drawAvatar(Canvas canvas, int width, int height, int style, Paint paint) {
        paint.setStyle(Paint.Style.FILL);
        float r = dp(4);
        RectF rect = new RectF(0, 0, width, height);

        if (style == 10) {
            paint.setColor(Color.rgb(237, 228, 213));
            canvas.drawRoundRect(rect, r, r, paint);
            paint.setColor(Color.rgb(160, 107, 55));
            canvas.drawCircle(width * 0.48f, height * 0.42f, width * 0.22f, paint);
            paint.setColor(Color.WHITE);
            canvas.drawCircle(width * 0.35f, height * 0.32f, width * 0.12f, paint);
            canvas.drawCircle(width * 0.63f, height * 0.32f, width * 0.12f, paint);
            paint.setColor(Color.rgb(55, 55, 55));
            canvas.drawCircle(width * 0.48f, height * 0.50f, width * 0.045f, paint);
            return;
        }

        if (style == 1) {
            paint.setColor(Color.rgb(255, 226, 234));
            canvas.drawRoundRect(rect, r, r, paint);
            paint.setColor(Color.rgb(241, 152, 171));
            canvas.drawOval(new RectF(width * 0.23f, height * 0.04f, width * 0.38f, height * 0.46f), paint);
            canvas.drawOval(new RectF(width * 0.62f, height * 0.04f, width * 0.77f, height * 0.46f), paint);
            paint.setColor(Color.WHITE);
            canvas.drawCircle(width * 0.50f, height * 0.52f, width * 0.28f, paint);
            paint.setColor(Color.rgb(45, 45, 45));
            canvas.drawCircle(width * 0.40f, height * 0.48f, width * 0.035f, paint);
            canvas.drawCircle(width * 0.60f, height * 0.48f, width * 0.035f, paint);
            return;
        }

        if (style == 2) {
            paint.setColor(Color.rgb(218, 238, 255));
            canvas.drawRoundRect(rect, r, r, paint);
            paint.setColor(Color.rgb(71, 145, 210));
            canvas.drawCircle(width * 0.50f, height * 0.48f, width * 0.28f, paint);
            paint.setColor(Color.rgb(255, 218, 92));
            canvas.drawCircle(width * 0.34f, height * 0.35f, width * 0.10f, paint);
            canvas.drawCircle(width * 0.66f, height * 0.35f, width * 0.10f, paint);
            paint.setColor(Color.WHITE);
            canvas.drawRect(width * 0.30f, height * 0.64f, width * 0.70f, height * 0.70f, paint);
            return;
        }

        if (style == 3) {
            paint.setColor(Color.rgb(240, 232, 214));
            canvas.drawRoundRect(rect, r, r, paint);
            paint.setColor(Color.rgb(174, 112, 61));
            canvas.drawCircle(width * 0.50f, height * 0.50f, width * 0.26f, paint);
            paint.setColor(Color.WHITE);
            canvas.drawCircle(width * 0.38f, height * 0.42f, width * 0.12f, paint);
            canvas.drawCircle(width * 0.62f, height * 0.42f, width * 0.12f, paint);
            paint.setColor(Color.rgb(55, 55, 55));
            canvas.drawCircle(width * 0.50f, height * 0.56f, width * 0.045f, paint);
            return;
        }

        paint.setColor(Color.rgb(65, 52, 44));
        canvas.drawRoundRect(rect, r, r, paint);
        paint.setColor(Color.rgb(238, 186, 92));
        canvas.drawRect(width * 0.58f, height * 0.36f, width * 0.88f, height * 0.70f, paint);
        paint.setColor(Color.rgb(230, 196, 165));
        canvas.drawCircle(width * 0.42f, height * 0.39f, width * 0.20f, paint);
        paint.setColor(Color.rgb(43, 35, 32));
        canvas.drawRect(width * 0.15f, height * 0.62f, width * 0.75f, height * 0.95f, paint);
    }

    private void drawBitmapAvatar(Canvas canvas, Bitmap bitmap, int width, int height, Paint paint) {
        int side = Math.min(bitmap.getWidth(), bitmap.getHeight());
        int left = (bitmap.getWidth() - side) / 2;
        int top = (bitmap.getHeight() - side) / 2;
        Rect src = new Rect(left, top, left + side, top + side);
        RectF dst = new RectF(0, 0, width, height);

        Path clip = new Path();
        clip.addRoundRect(dst, dp(4), dp(4), Path.Direction.CW);
        canvas.save();
        canvas.clipPath(clip);
        paint.setStyle(Paint.Style.FILL);
        paint.setAlpha(255);
        canvas.drawBitmap(bitmap, src, dst, paint);
        canvas.restore();
    }

    private void drawBitmapCover(Canvas canvas, Bitmap bitmap, RectF dst, int radius, Paint paint) {
        float bitmapRatio = bitmap.getWidth() / (float) bitmap.getHeight();
        float dstRatio = dst.width() / dst.height();
        Rect src;
        if (bitmapRatio > dstRatio) {
            int srcWidth = Math.round(bitmap.getHeight() * dstRatio);
            int left = (bitmap.getWidth() - srcWidth) / 2;
            src = new Rect(left, 0, left + srcWidth, bitmap.getHeight());
        } else {
            int srcHeight = Math.round(bitmap.getWidth() / dstRatio);
            int top = (bitmap.getHeight() - srcHeight) / 2;
            src = new Rect(0, top, bitmap.getWidth(), top + srcHeight);
        }

        canvas.save();
        if (radius > 0) {
            Path clip = new Path();
            clip.addRoundRect(dst, radius, radius, Path.Direction.CW);
            canvas.clipPath(clip);
        }
        paint.setStyle(Paint.Style.FILL);
        paint.setAlpha(255);
        canvas.drawBitmap(bitmap, src, dst, paint);
        canvas.restore();
    }

}
