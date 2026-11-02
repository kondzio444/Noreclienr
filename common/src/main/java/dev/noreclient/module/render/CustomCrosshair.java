package dev.noreclient.module.render;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Render2D;

public class CustomCrosshair extends Module {
    public final ModeSetting shape = add(new ModeSetting("Shape", "Kształt celownika", "Cross", "Cross", "Dot", "Circle", "Cross + Dot", "T-Shape"));
    public final NumberSetting length = add(new NumberSetting("Length", "Długość ramion", 4, 1, 12, 0.5));
    public final NumberSetting thickness = add(new NumberSetting("Thickness", "Grubość", 1, 0.5, 4, 0.5));
    public final NumberSetting gap = add(new NumberSetting("Gap", "Przerwa w środku", 2, 0, 8, 0.5));
    public final ColorSetting color = add(new ColorSetting("Color", "Kolor celownika", 0xFFFFFFFF));
    public final BooleanSetting outline = add(new BooleanSetting("Outline", "Czarny obrys", true));
    public final BooleanSetting entityColor = add(new BooleanSetting("Target Color", "Inny kolor po najechaniu na byt", true));
    public final ColorSetting targetColor = add(new ColorSetting("Target Color Value", "Kolor przy celowaniu w byt", 0xFFFF4D5E));
    public final BooleanSetting dynamic = add(new BooleanSetting("Dynamic", "Rozszerzanie przy ruchu", false));

    public CustomCrosshair() {
        super("Crosshair", "Własny, w pełni konfigurowalny celownik", Category.RENDER);
        targetColor.visibleWhen(() -> entityColor.isOn());
    }

    public void render(Gfx g, int sw, int sh) {
        if (game().perspective() != 0 || game().hudHidden() || game().debugScreen()) return;
        float cx = sw / 2f, cy = sh / 2f;
        boolean onEntity = game().lookEntity() != null;
        int col = entityColor.isOn() && onEntity ? targetColor.getColor() : color.getColor();
        float t = thickness.floatValue(), l = length.floatValue(), gp = gap.floatValue();
        if (dynamic.isOn()) {
            double v = Math.sqrt(game().velocityX() * game().velocityX() + game().velocityZ() * game().velocityZ());
            gp += (float) Math.min(6, v * 20);
        }
        boolean cross = shape.is("Cross") || shape.is("Cross + Dot") || shape.is("T-Shape");
        if (cross) {
            if (!shape.is("T-Shape")) bar(g, cx - t / 2, cy - gp - l, t, l, col);
            bar(g, cx - t / 2, cy + gp, t, l, col);
            bar(g, cx - gp - l, cy - t / 2, l, t, col);
            bar(g, cx + gp, cy - t / 2, l, t, col);
        }
        if (shape.is("Dot") || shape.is("Cross + Dot")) {
            if (outline.isOn()) Render2D.circle(g, cx, cy, t + 1, 0xC0000000);
            Render2D.circle(g, cx, cy, t, col);
        }
        if (shape.is("Circle")) {
            float r = gp + l / 2 + 1;
            if (outline.isOn()) Render2D.ring(g, cx, cy, r + 0.5f, t + 1, 0, 360, 0xC0000000);
            Render2D.ring(g, cx, cy, r, t, 0, 360, col);
        }
    }

    private void bar(Gfx g, float x, float y, float w, float h, int col) {
        if (outline.isOn()) Render2D.rect(g, x - 0.5f, y - 0.5f, w + 1, h + 1, 0xC0000000);
        Render2D.rect(g, x, y, w, h, col);
    }

    @Override
    protected boolean needsHook() { return true; }
}
