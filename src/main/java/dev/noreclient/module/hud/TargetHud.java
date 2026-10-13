package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CombatTracker;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.hit.EntityHitResult;

/** Shows name, health and armour of the entity you last hit or are looking at. */
public class TargetHud extends HudModule {
    public final NumberSetting timeout = add(new NumberSetting("Timeout", "Jak długo pokazywać cel po uderzeniu", 4, 1, 15, 0.5, "s"));
    public final BooleanSetting lookTarget = add(new BooleanSetting("Look Target", "Pokazuj też byt, na który patrzysz", true));
    public final BooleanSetting showDistance = add(new BooleanSetting("Distance", "Pokazuj odległość", true));

    private final Animation health = new Animation(1, 8);

    public TargetHud() {
        super("Target HUD", "Informacje o przeciwniku", 0.55f, 0.6f);
    }

    private LivingEntity target() {
        LivingEntity t = CombatTracker.getTarget((long) (timeout.get() * 1000));
        if (t == null && lookTarget.isOn() && mc.crosshairTarget instanceof EntityHitResult ehr) {
            Entity e = ehr.getEntity();
            if (e instanceof LivingEntity le) t = le;
        }
        return t;
    }

    @Override
    public boolean shouldRender() { return target() != null; }

    @Override
    public void render(DrawContext ctx, float tickDelta, boolean editor) {
        LivingEntity t = target();
        String name = t != null ? t.getName().getString() : "Przeciwnik";
        float hp = t != null ? t.getHealth() : 14, max = t != null ? t.getMaxHealth() : 20;
        float frac = Math.max(0, Math.min(1, hp / Math.max(1, max)));
        health.target(frac);
        float anim = health.update();

        width = Math.max(120, Render2D.textWidth(name) + 44);
        height = 38;
        float r = Theme.radius();
        Render2D.shadow(ctx, 0, 0, width, height, r, 4, 0x60000000);
        Render2D.roundedRect(ctx, 0, 0, width, height, r, 0xE0140F0C);

        // avatar placeholder: initial in an accent circle
        Render2D.roundedGradient(ctx, 5, 5, 28, 28, r * 0.8f, Theme.accent(), Theme.accent2(), true);
        Render2D.centeredText(ctx, name.substring(0, 1).toUpperCase(), 19, 15, 0xFFFFFFFF, true);

        Render2D.text(ctx, name, 38, 6, 0xFFFFFFFF, true);
        String info = String.format("%.1f ❤", hp);
        if (showDistance.isOn() && t != null && mc.player != null) info += String.format("  %.1fm", mc.player.distanceTo(t));
        if (t instanceof PlayerEntity p && p.getArmor() > 0) info += "  ⛨" + p.getArmor();
        Render2D.text(ctx, info, 38, 16, 0xFFB0B4C8, false);

        float bw = width - 43;
        Render2D.roundedRect(ctx, 38, 27, bw, 5, 2.5f, 0x40FFFFFF);
        int hc = ColorUtil.lerp(0xFFFF4D5E, 0xFF4ADE80, frac);
        Render2D.roundedGradient(ctx, 38, 27, Math.max(5, bw * anim), 5, 2.5f, ColorUtil.darken(hc, 0.2f), hc, false);
    }
}
