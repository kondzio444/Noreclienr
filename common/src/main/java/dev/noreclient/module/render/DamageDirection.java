package dev.noreclient.module.render;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;

/** Red arc around the crosshair pointing to where a hit came from. */
public class DamageDirection extends Module {
    public final ColorSetting color = add(new ColorSetting("Color", "Kolor wskaźnika", 0xE0FF3B3B));
    public final NumberSetting radius = add(new NumberSetting("Radius", "Odległość od celownika", 34, 16, 90, 2, " px"));
    public final NumberSetting duration = add(new NumberSetting("Duration", "Czas widoczności", 1.5, 0.5, 4, 0.1, " s"));

    private float lastTilt = Float.NaN, shownAngle;
    private long shownAt;

    public DamageDirection() {
        super("Damage Direction", "Pokazuje, z której strony otrzymałeś obrażenia", Category.RENDER);
    }

    @Override
    public void onTick() {
        if (!inGame()) { lastTilt = Float.NaN; return; }
        float tilt = game().hurtDirection();
        int hurt = game().hurtTime();
        if (hurt == 0 && Float.isNaN(lastTilt)) { lastTilt = tilt; return; }
        // the server only sends a direction for hits with a source (mobs, players, arrows);
        // fall or fire damage keeps the old value, so show the arc only when it changes
        if (!Float.isNaN(lastTilt) && tilt != lastTilt && hurt > 0) {
            shownAngle = tilt - 90;
            shownAt = System.currentTimeMillis();
        }
        lastTilt = tilt;
    }

    @Override
    public void onRenderOverlay(Gfx g, float tickDelta) {
        long age = System.currentTimeMillis() - shownAt;
        float d = duration.floatValue() * 1000;
        if (age > d || game().hudHidden() || !inGame()) return;
        float a = 1 - age / d;
        a = a * a * (3 - 2 * a);
        float cx = g.width() / 2f, cy = g.height() / 2f, r = radius.floatValue();
        // screen angle: 0 = up, clockwise; Render2D.ring uses 0 = right
        float center = shownAngle - 90;
        int c = color.getColor();
        Render2D.ring(g, cx, cy, r + 3, 6, center - 26, center + 26, ColorUtil.withAlpha(c, (int) (ColorUtil.alpha(c) * a * 0.35f)));
        Render2D.ring(g, cx, cy, r + 1.5f, 3, center - 20, center + 20, ColorUtil.withAlpha(c, (int) (ColorUtil.alpha(c) * a)));
        double rad = Math.toRadians(center);
        float tx = cx + (float) Math.cos(rad) * (r + 6), ty = cy + (float) Math.sin(rad) * (r + 6);
        float bx = cx + (float) Math.cos(rad) * (r + 1), by = cy + (float) Math.sin(rad) * (r + 1);
        float nx = -(float) Math.sin(rad) * 3.5f, ny = (float) Math.cos(rad) * 3.5f;
        int arrow = ColorUtil.withAlpha(c, (int) (ColorUtil.alpha(c) * a));
        Render2D.line(g, bx + nx, by + ny, tx, ty, 1.6f, arrow);
        Render2D.line(g, bx - nx, by - ny, tx, ty, 1.6f, arrow);
    }
}
