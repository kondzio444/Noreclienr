package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.TargetInfo;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CombatTracker;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.Locale;

/** Shows name, health and armour of the entity you last hit or are looking at. */
public class TargetHud extends HudModule {
    public final NumberSetting timeout = add(new NumberSetting("Timeout", "Jak długo pokazywać cel po uderzeniu", 4, 1, 15, 0.5, "s"));
    public final BooleanSetting lookTarget = add(new BooleanSetting("Look Target", "Pokazuj też byt, na który patrzysz", true));
    public final BooleanSetting showDistance = add(new BooleanSetting("Distance", "Pokazuj odległość", true));

    private final Animation health = new Animation(1, 8);

    public TargetHud() {
        super("Target HUD", "Informacje o przeciwniku", 0.55f, 0.6f);
    }

    private TargetInfo target() {
        TargetInfo t = CombatTracker.getTarget((long) (timeout.get() * 1000));
        if (t == null && lookTarget.isOn() && inGame()) t = game().lookEntity();
        return t;
    }

    @Override
    public boolean shouldRender() { return target() != null; }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        TargetInfo t = target();
        String name = t != null ? t.name : "Przeciwnik";
        float hp = t != null ? t.health : 14, max = t != null ? t.maxHealth : 20;
        float frac = Math.max(0, Math.min(1, hp / Math.max(1, max)));
        health.target(frac);
        float anim = health.update();
        width = Math.max(120, Render2D.textWidth(name) + 44);
        height = 38;
        float r = Theme.radius();
        Render2D.shadow(g, 0, 0, width, height, r, 4, 0x60000000);
        Render2D.roundedRect(g, 0, 0, width, height, r, 0xE0140F0C);
        Render2D.roundedGradient(g, 5, 5, 28, 28, r * 0.8f, Theme.accent(), Theme.accent2(), true);
        Render2D.centeredText(g, name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase(), 19, 15, 0xFFFFFFFF, true);
        Render2D.text(g, name, 38, 6, 0xFFFFFFFF, true);
        String info = String.format(Locale.ROOT, "%.1f ❤", hp);
        if (showDistance.isOn() && t != null) info += String.format(Locale.ROOT, "  %.1fm", t.distance);
        if (t != null && t.player && t.armor > 0) info += "  ⛨" + t.armor;
        Render2D.text(g, info, 38, 16, 0xFFB0B4C8, false);
        float bw = width - 43;
        Render2D.roundedRect(g, 38, 27, bw, 5, 2.5f, 0x40FFFFFF);
        int hc = ColorUtil.lerp(0xFFFF4D5E, 0xFF4ADE80, frac);
        Render2D.roundedGradient(g, 38, 27, Math.max(5, bw * anim), 5, 2.5f, ColorUtil.darken(hc, 0.2f), hc, false);
    }
}
