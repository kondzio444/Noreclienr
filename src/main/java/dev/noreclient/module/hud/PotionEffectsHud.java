package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.texture.Sprite;
import net.minecraft.entity.effect.StatusEffect;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.registry.entry.RegistryEntry;

import java.util.ArrayList;
import java.util.List;

public class PotionEffectsHud extends HudModule {
    public final BooleanSetting icons = add(new BooleanSetting("Icons", "Ikony efektów", true));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło", true));
    public final BooleanSetting hideVanilla = add(new BooleanSetting("Hide Vanilla", "Ukryj domyślne ikony efektów", true));
    public final BooleanSetting blink = add(new BooleanSetting("Blink When Ending", "Mruganie gdy efekt się kończy", true));

    public PotionEffectsHud() {
        super("Potion Effects", "Aktywne efekty mikstur z czasem", 1.0f, 0.4f);
        setEnabled(true);
    }

    private static String roman(int n) {
        String[] r = {"", "", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"};
        return n < r.length ? r[n] : " " + n;
    }

    private static String duration(StatusEffectInstance e) {
        if (e.isInfinite()) return "∞";
        int secs = e.getDuration() / 20;
        return String.format("%d:%02d", secs / 60, secs % 60);
    }

    @Override
    public void render(DrawContext ctx, float tickDelta, boolean editor) {
        List<StatusEffectInstance> effects = new ArrayList<>();
        if (mc.player != null) effects.addAll(mc.player.getStatusEffects());
        if (effects.isEmpty() && editor) {
            effects.add(new StatusEffectInstance(StatusEffects.SPEED, 20 * 95, 1));
            effects.add(new StatusEffectInstance(StatusEffects.FIRE_RESISTANCE, 20 * 300, 0));
        }
        int iconW = icons.isOn() ? 20 : 0;
        int maxW = 0;
        for (StatusEffectInstance e : effects) {
            String name = e.getEffectType().value().getName().getString() + roman(e.getAmplifier() + 1);
            maxW = Math.max(maxW, Math.max(Render2D.textWidth(name), Render2D.textWidth(duration(e))));
        }
        width = Math.max(60, iconW + maxW + 10);
        float y = 0;
        for (StatusEffectInstance e : effects) {
            RegistryEntry<StatusEffect> type = e.getEffectType();
            String name = type.value().getName().getString() + roman(e.getAmplifier() + 1);
            float alpha = 1f;
            if (blink.isOn() && !e.isInfinite() && e.getDuration() < 200) {
                alpha = 0.45f + 0.55f * (float) Math.abs(Math.sin(System.currentTimeMillis() / 200.0));
            }
            if (background.isOn()) Render2D.roundedRect(ctx, 0, y, width, 22, Theme.radius() * 0.6f, 0x90140F0C);
            Render2D.rect(ctx, 0, y + 4, 2, 14, ColorUtil.withAlpha(type.value().getColor(), 255));
            if (icons.isOn()) {
                Sprite sprite = mc.getStatusEffectSpriteManager().getSprite(type);
                ctx.drawSprite(4, (int) y + 2, 0, 18, 18, sprite, 1f, 1f, 1f, alpha);
            }
            Render2D.text(ctx, name, iconW + 5, y + 3, ColorUtil.fade(0xFFFFFFFF, alpha), true);
            Render2D.text(ctx, duration(e), iconW + 5, y + 12, ColorUtil.fade(0xFFA0A4B8, alpha), true);
            y += 24;
        }
        height = Math.max(22, y - 2);
    }

    @Override
    public boolean shouldRender() {
        return mc.player != null && !mc.player.getStatusEffects().isEmpty();
    }
}
