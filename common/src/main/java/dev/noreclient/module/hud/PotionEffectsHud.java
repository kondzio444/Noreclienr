package dev.noreclient.module.hud;

import dev.noreclient.api.EffectInfo;
import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

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

    private static String duration(EffectInfo e) {
        if (e.infinite) return "∞";
        int secs = e.durationTicks / 20;
        return String.format("%d:%02d", secs / 60, secs % 60);
    }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        List<EffectInfo> effects = new ArrayList<EffectInfo>();
        if (inGame()) effects.addAll(game().effects());
        if (effects.isEmpty() && editor) effects.addAll(game().previewEffects());
        int iconW = icons.isOn() ? 20 : 0;
        int maxW = 0;
        for (EffectInfo e : effects) {
            maxW = Math.max(maxW, Math.max(Render2D.textWidth(e.name + roman(e.amplifier + 1)), Render2D.textWidth(duration(e))));
        }
        width = Math.max(60, iconW + maxW + 10);
        float y = 0;
        for (EffectInfo e : effects) {
            String name = e.name + roman(e.amplifier + 1);
            float alpha = 1f;
            if (blink.isOn() && !e.infinite && e.durationTicks < 200) {
                alpha = 0.45f + 0.55f * (float) Math.abs(Math.sin(System.currentTimeMillis() / 200.0));
            }
            if (background.isOn()) Render2D.roundedRect(g, 0, y, width, 22, Theme.radius() * 0.6f, 0x90160F26);
            Render2D.rect(g, 0, y + 4, 2, 14, ColorUtil.withAlpha(e.color, 255));
            if (icons.isOn()) g.effectIcon(e, 4, y + 2, 18, alpha);
            Render2D.text(g, name, iconW + 5, y + 3, ColorUtil.fade(0xFFFFFFFF, alpha), true);
            Render2D.text(g, duration(e), iconW + 5, y + 12, ColorUtil.fade(0xFFA0A4B8, alpha), true);
            y += 24;
        }
        height = Math.max(22, y - 2);
    }

    @Override
    public boolean shouldRender() {
        return inGame() && !game().effects().isEmpty();
    }
}
