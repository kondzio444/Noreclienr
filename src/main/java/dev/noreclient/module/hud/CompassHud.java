package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.util.math.MathHelper;

/** Horizontal compass bar like in modern shooters. */
public class CompassHud extends HudModule {
    public final NumberSetting barWidth = add(new NumberSetting("Width", "Szerokość paska", 180, 100, 320, 5, "px"));
    public final BooleanSetting degrees = add(new BooleanSetting("Degrees", "Pokazuj stopnie", true));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło", true));

    private static final String[] NAMES = {"S", "SW", "W", "NW", "N", "NE", "E", "SE"};

    public CompassHud() {
        super("Compass", "Kompas w formie paska", 0.5f, 0.0f);
    }

    @Override
    public void render(DrawContext ctx, float tickDelta, boolean editor) {
        width = barWidth.floatValue();
        height = degrees.isOn() ? 26 : 16;
        float yaw = mc.player != null ? MathHelper.wrapDegrees(mc.player.getYaw(tickDelta)) : 0;
        if (background.isOn()) Render2D.roundedRect(ctx, 0, 0, width, 16, Theme.radius() * 0.6f, 0x90140F0C);
        float pxPerDeg = 1.4f;
        float center = width / 2f;
        for (int deg = -180; deg < 540; deg += 15) {
            float diff = MathHelper.wrapDegrees(deg - yaw);
            float x = center + diff * pxPerDeg;
            if (x < 4 || x > width - 4 || deg >= 360 || deg < 0) continue;
            float edge = 1f - Math.abs(diff * pxPerDeg) / (width / 2f);
            int alpha = (int) (255 * Math.max(0, Math.min(1, edge * 1.6f)));
            if (deg % 45 == 0) {
                String n = NAMES[(deg / 45) % 8];
                boolean cardinal = n.length() == 1;
                int c = cardinal ? (n.equals("N") ? 0xFFFF5566 : 0xFFFFFFFF) : 0xFFB0B4C8;
                Render2D.centeredText(ctx, n, x, 4, ColorUtil.withAlpha(c, alpha), true);
            } else {
                Render2D.rect(ctx, x - 0.5f, 6, 1, 4, ColorUtil.withAlpha(0xFF9095AB, alpha));
            }
        }
        Render2D.roundedRect(ctx, center - 1, 12, 2, 4, 1, Theme.accent());
        if (degrees.isOn()) {
            String d = String.valueOf(Math.round((yaw + 360) % 360));
            Render2D.centeredText(ctx, d, center, 17, Theme.accent(), true);
        }
    }
}
