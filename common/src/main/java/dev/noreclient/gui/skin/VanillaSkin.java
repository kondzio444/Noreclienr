package dev.noreclient.gui.skin;

import dev.noreclient.api.Gfx;
import dev.noreclient.gui.widget.Album;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import dev.noreclient.util.ThemeTokens;

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

    /** Button frame (the label is drawn by the game on top, in white): page-raised-2, an accent-deep sticker on hover. */
    public static void button(Gfx g, Object widget, float x, float y, float w, float h, boolean hovered, boolean active) {
        CurrentGfx.set(g);
        float r = Math.min(ThemeTokens.RADIUS_STICKER, h / 2f);
        if (!active) {
            Render2D.roundedRect(g, x, y, w, h, r, Theme.SLOT);
            Album.dashed(g, x + 2, y + 2, w - 4, h - 4, Theme.GHOST);
            return;
        }
        float hv = hover(widget, hovered);
        if (hv > 0.01f) {
            Album.sticker(g, x, y, w, h, r, ColorUtil.lerp(Theme.RAISED_2, Theme.accentDeep(), hv), 0);
        } else {
            Render2D.roundedRect(g, x, y, w, h, r, Theme.RAISED_2);
        }
    }

    /** Slider track: slot well with the exact-length accent fill up to {@code value} (0..1). */
    public static void sliderTrack(Gfx g, Object widget, float x, float y, float w, float h, double value, boolean hovered, boolean active) {
        CurrentGfx.set(g);
        float r = Math.min(ThemeTokens.RADIUS_STICKER, h / 2f);
        float hv = hover(widget, hovered && active);
        Render2D.roundedRect(g, x, y, w, h, r, Theme.SLOT);
        float fill = (float) Math.max(0, Math.min(1, value)) * w;
        if (fill > 1 && active) {
            Render2D.roundedRect(g, x, y, Math.max(r * 2, fill), h, r, ColorUtil.lerp(Theme.accentDeep(), Theme.accent(), hv));
        }
    }

    /** Slider knob: a white vinyl tab with an accent centre. */
    public static void sliderHandle(Gfx g, float x, float y, float w, float h, boolean active) {
        CurrentGfx.set(g);
        float cx = x + w / 2f;
        Render2D.roundedRect(g, cx - 3.5f, y + 1, 7, h - 2, 2.5f, active ? Theme.VINYL : 0xFF8A8287);
        if (active) Render2D.roundedRect(g, cx - 1, y + h / 2f - 3, 2, 6, 1, Theme.accent());
    }

    /** Text field: recessed slot, accent ring when focused. */
    public static void textField(Gfx g, float x, float y, float w, float h, boolean focused) {
        CurrentGfx.set(g);
        float r = Math.min(3, h / 2f);
        Render2D.roundedRect(g, x, y, w, h, r, Theme.SLOT);
        if (focused) Render2D.roundedOutline(g, x - 1, y - 1, w + 2, h + 2, r + 1, 1, Theme.accent());
    }

    /** Replaces the panorama behind menus opened outside a world. */
    public static void menuBackground(Gfx g, int width, int height) {
        CurrentGfx.set(g);
        MenuBackground.render(g, width, height, width / 2, height / 2);
    }

    /** Replaces the dark "menu background" texture vanilla lays over screens and lists: the album page. */
    public static void darkening(Gfx g, float x, float y, float w, float h) {
        Render2D.rect(g, x, y, w, h, ColorUtil.withAlpha(Theme.page(), 0x9C));
    }

    /** Background of scrolling lists (worlds, servers, packs, controls...). */
    public static void listBackground(Gfx g, float x, float y, float w, float h) {
        Render2D.rect(g, x, y, w, h, ColorUtil.withAlpha(Theme.page(), 0xB0));
    }

    /** Edges of a scrolling list: a tone step (no glowing lines). */
    public static void listSeparators(Gfx g, float x, float top, float bottom, float w) {
        Render2D.rect(g, x, top - 1, w, 1, 0x40000000);
        Render2D.rect(g, x, bottom, w, 1, 0x14FFFFFF);
    }

    /** Selected row in a list: an accent-deep sticker face (the game draws white text on it). */
    public static void selection(Gfx g, float x, float y, float w, float h, boolean focused) {
        float r = ThemeTokens.RADIUS_MD;
        Render2D.roundedRect(g, x - 1, y - 1, w + 2, h + 2, r + 1, ColorUtil.withAlpha(Theme.VINYL, focused ? 0xE0 : 0x70));
        Render2D.roundedRect(g, x, y, w, h, r, ColorUtil.withAlpha(Theme.accentDeep(), focused ? 0xF0 : 0xB0));
    }
}
