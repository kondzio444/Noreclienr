package dev.noreclient.gui.widget;

import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.api.Platform;

/** Minimal single-line text input drawn with the client theme. */
public class TextBox {
    /** Pass as icon to draw a vector magnifier glass. */
    public static final String SEARCH_ICON = "\u0000search";

    private String text = "";
    private final String placeholder;
    private final int maxLength;
    private boolean focused;
    private final dev.noreclient.util.Animation focusAnim = new dev.noreclient.util.Animation(0, 14);

    public TextBox(String placeholder, int maxLength) {
        this.placeholder = placeholder;
        this.maxLength = maxLength;
    }

    public String getText() { return text; }
    public void setText(String t) { text = t.length() > maxLength ? t.substring(0, maxLength) : t; }
    public boolean isFocused() { return focused; }
    public void setFocused(boolean f) { focused = f; }

    public void render(Gfx ctx, float x, float y, float w, float h, String icon) {
        focusAnim.target(focused ? 1 : 0);
        float f = focusAnim.update();
        // Album input: a recessed slot well, focus = accent ring
        float r = Math.min(3, h / 2f);
        Render2D.roundedRect(ctx, x, y, w, h, r, Theme.SLOT);
        if (f > 0.01f) Render2D.roundedOutline(ctx, x - 1, y - 1, w + 2, h + 2, r + 1, 1, ColorUtil.withAlpha(Theme.accent(), (int) (255 * f)));
        float tx = x + 7;
        if (SEARCH_ICON.equals(icon)) {
            int ic = ColorUtil.lerp(Theme.TEXT_MUTED, Theme.accent(), f);
            float cy = y + h / 2f - 1;
            Render2D.ring(ctx, tx + 3.5f, cy, 3.5f, 1.2f, 0, 360, ic);
            Render2D.line(ctx, tx + 6, cy + 2.5f, tx + 8.5f, cy + 5, 1.4f, ic);
            tx += 14;
        } else if (icon != null) {
            Render2D.text(ctx, icon, tx, y + (h - 8) / 2f, Theme.TEXT_MUTED, false);
            tx += Render2D.textWidth(icon) + 5;
        }
        float maxW = x + w - 6 - tx;
        String shown = text;
        while (Render2D.textWidth(shown) > maxW && !shown.isEmpty()) shown = shown.substring(1);
        if (text.isEmpty() && !focused) {
            Render2D.text(ctx, Render2D.trim(placeholder, (int) maxW), tx, y + (h - 8) / 2f, Theme.TEXT_MUTED, false);
        } else {
            Render2D.text(ctx, shown, tx, y + (h - 8) / 2f, Theme.TEXT, false);
        }
        if (focused && (System.currentTimeMillis() / 500) % 2 == 0) {
            Render2D.rect(ctx, tx + Render2D.textWidth(shown) + 1, y + (h - 10) / 2f, 1, 10, Theme.accentLight());
        }
    }

    public boolean charTyped(char chr) {
        if (!focused) return false;
        if (chr >= 32 && chr != 127 && text.length() < maxLength) text += chr;
        return true;
    }

    public boolean keyPressed(int key) {
        if (!focused) return false;
        if (key == Keys.BACKSPACE && !text.isEmpty()) {
            if (Platform.game().controlDown()) {
                String t = text.replaceAll("\\s+$", "");
                int i = t.lastIndexOf(' ');
                text = i < 0 ? "" : t.substring(0, i + 1);
            } else {
                text = text.substring(0, text.length() - 1);
            }
            return true;
        }
        if (key == Keys.V && Platform.game().controlDown()) {
            String clip = Platform.game().clipboard().replaceAll("[\\r\\n]", "");
            setText(text + clip);
            return true;
        }
        if (key == Keys.A && Platform.game().controlDown()) {
            text = "";
            return true;
        }
        return key != Keys.ESCAPE && key != Keys.ENTER;
    }
}
