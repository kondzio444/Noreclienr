package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.Locale;

/** Analog speed gauge with a needle, the current value and the recent peak. */
public class SpeedometerHud extends HudModule {
    public final ModeSetting unit = add(new ModeSetting("Unit", "Jednostka", "b/s", "b/s", "km/h"));
    public final NumberSetting max = add(new NumberSetting("Max Speed", "Wartość na końcu skali (b/s)", 20, 8, 100, 1, " b/s"));
    public final BooleanSetting vertical = add(new BooleanSetting("Include Vertical", "Licz także ruch w pionie (elytra, spadanie)", false));
    public final BooleanSetting peak = add(new BooleanSetting("Peak", "Znacznik najwyższej prędkości z ostatnich sekund", true));

    private final Animation needle = new Animation(0, 10);
    private float speed, peakValue;
    private long peakAt;

    public SpeedometerHud() {
        super("Speedometer", "Prędkościomierz ze wskazówką i rekordem chwilowym", 0.97f, 0.82f);
        width = 76;
        height = 50;
    }

    @Override
    public void onTick() {
        if (!inGame()) { speed = 0; return; }
        double dx = game().x() - game().prevX(), dz = game().z() - game().prevZ(), dy = vertical.isOn() ? game().y() - game().prevY() : 0;
        speed = (float) (Math.sqrt(dx * dx + dy * dy + dz * dz) * 20);
        long now = System.currentTimeMillis();
        if (speed >= peakValue || now - peakAt > 3000) {
            peakValue = speed;
            peakAt = now;
        }
    }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        width = 76;
        height = 50;
        float v = inGame() ? speed : 5.6f;
        float scale = max.floatValue();
        float shown = needle.target(Math.min(v, scale * 1.05f)).update();
        boolean kmh = unit.is("km/h");
        Render2D.roundedRect(g, 0, 0, width, height, Theme.radius() * 0.8f, 0x90160F26);
        float cx = width / 2f, cy = 32, r = 26;
        // dial: 210° arc from bottom-left to bottom-right
        float start = 165, sweep = 210;
        Render2D.ring(g, cx, cy, r, 3, start, start + sweep, 0x40FFFFFF);
        float p = Math.max(0, Math.min(1, shown / scale));
        int c1 = Theme.accent2(), c2 = Theme.accent();
        Render2D.ring(g, cx, cy, r, 3, start, start + sweep * p, ColorUtil.lerp(c1, c2, p));
        for (int i = 0; i <= 10; i++) {
            double a = Math.toRadians(start + sweep * i / 10f);
            float len = i % 5 == 0 ? 4 : 2;
            float x1 = cx + (float) Math.cos(a) * (r - 5), y1 = cy + (float) Math.sin(a) * (r - 5);
            float x2 = cx + (float) Math.cos(a) * (r - 5 - len), y2 = cy + (float) Math.sin(a) * (r - 5 - len);
            Render2D.line(g, x1, y1, x2, y2, i % 5 == 0 ? 1.2f : 0.8f, i % 5 == 0 ? 0xC0FFFFFF : 0x70FFFFFF);
        }
        if (peak.isOn() && inGame() && peakValue > 0.5f) {
            double a = Math.toRadians(start + sweep * Math.min(1, peakValue / scale));
            Render2D.circle(g, cx + (float) Math.cos(a) * (r - 1.5f), cy + (float) Math.sin(a) * (r - 1.5f), 1.8f, 0xFFFF5C5C);
        }
        double na = Math.toRadians(start + sweep * Math.min(1.03f, shown / scale));
        Render2D.line(g, cx, cy, cx + (float) Math.cos(na) * (r - 7), cy + (float) Math.sin(na) * (r - 7), 1.6f, 0xFFFFFFFF);
        Render2D.circle(g, cx, cy, 2.4f, Theme.accent());
        float value = kmh ? v * 3.6f : v;
        String text = kmh ? String.valueOf(Math.round(value)) : String.format(Locale.ROOT, "%.1f", value);
        Render2D.centeredText(g, text, cx, cy + 6, 0xFFFFFFFF, true);
        String u = unit.get();
        Render2D.scaledText(g, u, cx - Render2D.textWidth(u) * 0.3f, cy + 15, 0.6f, Theme.TEXT_DIM, false);
    }
}
