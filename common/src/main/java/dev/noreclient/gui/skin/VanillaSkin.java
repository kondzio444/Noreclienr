package dev.noreclient.gui.skin;

import dev.noreclient.api.Gfx;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.Map;
import java.util.WeakHashMap;

/**
 * Nore look for the screens Minecraft still owns (options, world list, server list, world
 * creation...). Platforms route the vanilla widget textures here, so there is no vanilla-styled
 * UI left: buttons, sliders, text fields, lists and backgrounds all use the client theme.
 */
public final class VanillaSkin {
    private static final Map<Object, Animation> HOVER = new WeakHashMap<Object, Animation>();

    private VanillaSkin() {}

    private static float hover(Object widget, boolean hovered) {
        Animation a = HOVER.get(widget);
        if (a == null) {
            a = new Animation(hovered ? 1 : 0, 14);
            HOVER.put(widget, a);
        }
        return a.target(hovered ? 1 : 0).update();
    }

    /** Button frame (the label is drawn by the game on top). */
    public static void button(Gfx g, Object widget, float x, float y, float w, float h, boolean hovered, boolean active) {
        CurrentGfx.set(g);
        float r = Math.min(Theme.radius(), h / 2f);
        if (!active) {
            Render2D.roundedRect(g, x, y, w, h, r, 0x90100D0B);
            Render2D.roundedOutline(g, x, y, w, h, r, 1, 0x14FFFFFF);
            return;
        }
        float hv = hover(widget, hovered);
        Render2D.roundedRect(g, x, y, w, h, r, 0xC8140F0C);
        Render2D.roundedOutline(g, x, y, w, h, r, 1, 0x2AFFFFFF);
        if (hv > 0.01f) Widgets.glowBox(g, x, y, w, h, r, Theme.accent(), hv * 0.85f, hv);
        if (hv > 0.01f) Render2D.roundedRect(g, x + 3, y + h / 2f - 4 * hv, 2, 8 * hv, 1, Theme.accent());
    }

    /** Slider track with the filled part up to {@code value} (0..1). */
    public static void sliderTrack(Gfx g, Object widget, float x, float y, float w, float h, double value, boolean hovered, boolean active) {
        CurrentGfx.set(g);
        float r = Math.min(Theme.radius(), h / 2f);
        float hv = hover(widget, hovered && active);
        Render2D.roundedRect(g, x, y, w, h, r, 0xC8140F0C);
        float fill = (float) Math.max(0, Math.min(1, value)) * w;
        if (fill > 1 && active) {
            Render2D.roundedGradient(g, x, y, Math.max(r * 2, fill), h, r,
                    ColorUtil.withAlpha(Theme.accent(), (int) (70 + 40 * hv)), ColorUtil.withAlpha(Theme.accent2(), (int) (40 + 30 * hv)), false);
        }
        Render2D.roundedOutline(g, x, y, w, h, r, 1, ColorUtil.lerp(0x2AFFFFFF, ColorUtil.withAlpha(Theme.accent(), 200), hv));
    }

    /** Slider knob drawn where vanilla draws its handle. */
    public static void sliderHandle(Gfx g, float x, float y, float w, float h, boolean active) {
        CurrentGfx.set(g);
        float cx = x + w / 2f, cy = y + h / 2f;
        if (active) Render2D.shadow(g, cx - 3, y + 3, 6, h - 6, 3, 4, ColorUtil.withAlpha(Theme.accent(), 120));
        Render2D.roundedRect(g, cx - 2.5f, y + 3, 5, h - 6, 2.5f, active ? 0xFFFFFFFF : 0xFF8A7F76);
    }

    public static void textField(Gfx g, float x, float y, float w, float h, boolean focused) {
        CurrentGfx.set(g);
        float r = Math.min(Theme.radius() * 0.8f, h / 2f);
        Render2D.roundedRect(g, x, y, w, h, r, 0xE00D0A08);
        if (focused) Render2D.shadow(g, x, y, w, h, r, 4, ColorUtil.withAlpha(Theme.accent(), 90));
        Render2D.roundedOutline(g, x, y, w, h, r, 1, focused ? Theme.accent() : 0x30FFFFFF);
    }

    /** Replaces the panorama behind menus opened outside a world. */
    public static void menuBackground(Gfx g, int width, int height) {
        CurrentGfx.set(g);
        MenuBackground.render(g, width, height, width / 2, height / 2);
    }

    /** Replaces the dark "menu background" texture vanilla lays over screens and lists. */
    public static void darkening(Gfx g, float x, float y, float w, float h) {
        Render2D.rect(g, x, y, w, h, 0x7A08060A);
    }

    /** Background of scrolling lists (worlds, servers, packs, controls...). */
    public static void listBackground(Gfx g, float x, float y, float w, float h) {
        Render2D.rect(g, x, y, w, h, 0x8C0B0908);
    }

    /** Accent separators above and below a scrolling list. */
    public static void listSeparators(Gfx g, float x, float top, float bottom, float w) {
        Render2D.quadGradient(g, x, top - 1, w / 2f, 1, 0x00FFFFFF, Theme.accent(), Theme.accent(), 0x00FFFFFF);
        Render2D.quadGradient(g, x + w / 2f, top - 1, w / 2f, 1, Theme.accent(), 0x00FFFFFF, 0x00FFFFFF, Theme.accent());
        Render2D.rect(g, x, bottom, w, 1, 0x30FFFFFF);
    }

    /** Selected row in a list. */
    public static void selection(Gfx g, float x, float y, float w, float h, boolean focused) {
        float r = Theme.radius() * 0.8f;
        Render2D.roundedRect(g, x, y, w, h, r, ColorUtil.withAlpha(Theme.accent(), focused ? 46 : 30));
        Render2D.roundedOutline(g, x, y, w, h, r, 1, ColorUtil.withAlpha(Theme.accent(), focused ? 230 : 140));
    }
}
