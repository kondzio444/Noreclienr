package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/** Horizontal compass bar like in modern shooters. */
public class CompassHud extends HudModule {
    public final NumberSetting barWidth = add(new NumberSetting("Width", "Szerokość paska", 180, 100, 320, 5, "px"));
    public final BooleanSetting degrees = add(new BooleanSetting("Degrees", "Pokazuj stopnie", true));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło", true));

    private static final String[] NAMES = {"S", "SW", "W", "NW", "N", "NE", "E", "SE"};

    public CompassHud() {
        super("Compass", "Kompas w formie paska", 0.5f, 0.0f);
    }

    static float wrap(float deg) {
        deg %= 360f;
        if (deg >= 180f) deg -= 360f;
        if (deg < -180f) deg += 360f;
        return deg;
    }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        width = barWidth.floatValue();
        height = degrees.isOn() ? 26 : 16;
        float yaw = inGame() ? wrap(game().yaw(tickDelta)) : 0;
        if (background.isOn()) Render2D.roundedRect(g, 0, 0, width, 16, Theme.radius() * 0.6f, 0x90160F26);
        float pxPerDeg = 1.4f, center = width / 2f;
        for (int deg = 0; deg < 360; deg += 15) {
            float diff = wrap(deg - yaw);
            float x = center + diff * pxPerDeg;
            if (x < 4 || x > width - 4) continue;
            float edge = 1f - Math.abs(diff * pxPerDeg) / (width / 2f);
            int alpha = (int) (255 * Math.max(0, Math.min(1, edge * 1.6f)));
            if (deg % 45 == 0) {
                String n = NAMES[(deg / 45) % 8];
                int c = n.length() == 1 ? ("N".equals(n) ? 0xFFFF5566 : 0xFFFFFFFF) : 0xFFB0B4C8;
                Render2D.centeredText(g, n, x, 4, ColorUtil.withAlpha(c, alpha), true);
            } else {
                Render2D.rect(g, x - 0.5f, 6, 1, 4, ColorUtil.withAlpha(0xFF9095AB, alpha));
            }
        }
        Render2D.roundedRect(g, center - 1, 12, 2, 4, 1, Theme.accent());
        if (degrees.isOn()) Render2D.centeredText(g, String.valueOf(Math.round((yaw + 360) % 360)), center, 17, Theme.accent(), true);
    }
}
