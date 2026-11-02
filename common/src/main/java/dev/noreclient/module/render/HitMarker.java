package dev.noreclient.module.render;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;

/** Short "X" around the crosshair when your hit lands, like in shooters. */
public class HitMarker extends Module {
    public final ColorSetting color = add(new ColorSetting("Color", "Kolor znacznika", 0xFFFFFFFF));
    public final ColorSetting critColor = add(new ColorSetting("Critical Color", "Kolor przy trafieniu w powietrzu (krytyk)", 0xFFFFC447));
    public final NumberSetting size = add(new NumberSetting("Size", "Długość ramion", 4, 2, 10, 0.5));
    public final NumberSetting duration = add(new NumberSetting("Duration", "Jak długo widać znacznik", 300, 100, 1000, 50, " ms"));
    public final BooleanSetting sound = add(new BooleanSetting("Sound", "Cichy dźwięk trafienia", false));

    private long hitAt;
    private boolean crit;

    public HitMarker() {
        super("Hit Marker", "Znacznik „X” przy celowniku, gdy trafisz przeciwnika", Category.RENDER);
    }

    public void onHit() {
        hitAt = System.currentTimeMillis();
        // a critical hit needs a falling, non-flying player (vanilla rule, approximated client side)
        crit = game().velocityY() < -0.08 && !game().flying() && !game().swimming() && !game().fallFlying();
        if (sound.isOn()) game().playClick(1.9f);
    }

    @Override
    public void onRenderOverlay(Gfx g, float tickDelta) {
        long age = System.currentTimeMillis() - hitAt;
        float d = duration.floatValue();
        if (age > d || game().hudHidden()) return;
        float t = age / d;
        float a = 1 - t * t;
        float cx = g.width() / 2f, cy = g.height() / 2f;
        float gap = 3 + t * 2.5f, len = size.floatValue() * (1 - 0.25f * t);
        int c = ColorUtil.withAlpha(crit ? critColor.getColor() : color.getColor(), (int) (255 * a));
        int shadow = ColorUtil.withAlpha(0xFF000000, (int) (120 * a));
        float k = 0.7071f;
        for (int i = 0; i < 4; i++) {
            float sx = (i == 0 || i == 3) ? -1 : 1, sy = i < 2 ? -1 : 1;
            float x1 = cx + sx * gap * k, y1 = cy + sy * gap * k, x2 = cx + sx * (gap + len) * k, y2 = cy + sy * (gap + len) * k;
            Render2D.line(g, x1, y1 + 0.6f, x2, y2 + 0.6f, 2.2f, shadow);
            Render2D.line(g, x1, y1, x2, y2, 1.5f, c);
        }
    }
}
