package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import dev.noreclient.api.Gfx;

import java.util.Calendar;

/** Round analog clock showing real time or in-game time. */
public class AnalogClockHud extends HudModule {
    public final NumberSetting size = add(new NumberSetting("Size", "Średnica tarczy", 44, 24, 100, 2, "px"));
    public final ModeSetting source = add(new ModeSetting("Time Source", "Czas rzeczywisty czy w grze", "Real", "Real", "Game"));
    public final BooleanSetting seconds = add(new BooleanSetting("Second Hand", "Wskazówka sekundowa", true));
    public final BooleanSetting ticks = add(new BooleanSetting("Hour Marks", "Kreski godzin", true));
    public final BooleanSetting glow = add(new BooleanSetting("Glow", "Poświata wokół tarczy", true));

    public AnalogClockHud() {
        super("Analog Clock", "Zegar analogowy z wskazówkami", 1.0f, 0.12f);
    }

    @Override
    public void render(Gfx ctx, float tickDelta, boolean editor) {
        float d = size.floatValue(), r = d / 2f;
        width = d;
        height = d;
        double h, m, s;
        if (source.is("Game") && game().inWorld()) {
            long t = (game().timeOfDay() + 6000) % 24000;
            h = t / 1000.0;
            m = (t % 1000) * 60 / 1000.0;
            s = 0;
        } else {
            Calendar now = Calendar.getInstance();
            s = now.get(Calendar.SECOND) + now.get(Calendar.MILLISECOND) / 1000.0;
            m = now.get(Calendar.MINUTE) + s / 60.0;
            h = now.get(Calendar.HOUR_OF_DAY) + m / 60.0;
        }
        if (glow.isOn()) Render2D.radial(ctx, r, r, r * 1.35f, ColorUtil.withAlpha(Theme.accent(), 60), 0);
        Render2D.circle(ctx, r, r, r, 0xD0160F26);
        Render2D.ring(ctx, r, r, r, 1.2f, 0, 360, ColorUtil.withAlpha(Theme.accent(), 200));
        if (ticks.isOn()) {
            for (int i = 0; i < 12; i++) {
                double a = Math.toRadians(i * 30 - 90);
                float len = i % 3 == 0 ? r * 0.18f : r * 0.1f;
                Render2D.line(ctx, r + (float) Math.cos(a) * (r - 3), r + (float) Math.sin(a) * (r - 3),
                        r + (float) Math.cos(a) * (r - 3 - len), r + (float) Math.sin(a) * (r - 3 - len), i % 3 == 0 ? 1.4f : 0.8f, 0xC0FFFFFF);
            }
        }
        hand(ctx, r, (h % 12) * 30, r * 0.5f, 2f, 0xFFFFFFFF);
        hand(ctx, r, m * 6, r * 0.75f, 1.4f, 0xFFE8DED6);
        if (seconds.isOn() && source.is("Real")) hand(ctx, r, s * 6, r * 0.82f, 0.8f, Theme.accent());
        Render2D.circle(ctx, r, r, 1.8f, Theme.accent());
    }

    private void hand(Gfx ctx, float r, double deg, float len, float w, int col) {
        double a = Math.toRadians(deg - 90);
        Render2D.line(ctx, r, r, r + (float) Math.cos(a) * len, r + (float) Math.sin(a) * len, w, col);
    }
}
