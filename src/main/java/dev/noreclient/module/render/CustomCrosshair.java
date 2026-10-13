package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Render2D;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.entity.Entity;
import net.minecraft.util.hit.EntityHitResult;

public class CustomCrosshair extends Module {
    public final ModeSetting shape = add(new ModeSetting("Shape", "Kształt celownika", "Cross", "Cross", "Dot", "Circle", "Cross + Dot", "T-Shape"));
    public final NumberSetting length = add(new NumberSetting("Length", "Długość ramion", 4, 1, 12, 0.5));
    public final NumberSetting thickness = add(new NumberSetting("Thickness", "Grubość", 1, 0.5, 4, 0.5));
    public final NumberSetting gap = add(new NumberSetting("Gap", "Przerwa w środku", 2, 0, 8, 0.5));
    public final ColorSetting color = add(new ColorSetting("Color", "Kolor celownika", 0xFFFFFFFF));
    public final BooleanSetting outline = add(new BooleanSetting("Outline", "Czarny obrys", true));
    public final BooleanSetting entityColor = add(new BooleanSetting("Target Color", "Inny kolor po najechaniu na byt", true));
    public final ColorSetting targetColor = add(new ColorSetting("Target Color Value", "Kolor przy celowaniu w byt", 0xFFFF4D5E)).visibleWhen(entityColor::isOn);
    public final BooleanSetting dynamic = add(new BooleanSetting("Dynamic", "Rozszerzanie przy ruchu", false));

    public CustomCrosshair() {
        super("Crosshair", "Własny, w pełni konfigurowalny celownik", Category.RENDER);
    }

    public void render(DrawContext ctx, int sw, int sh) {
        if (!mc.options.getPerspective().isFirstPerson() || mc.options.hudHidden) return;
        float cx = sw / 2f, cy = sh / 2f;
        boolean onEntity = mc.crosshairTarget instanceof EntityHitResult ehr && ehr.getEntity() instanceof Entity;
        int col = entityColor.isOn() && onEntity ? targetColor.getColor() : color.getColor();
        float t = thickness.floatValue(), l = length.floatValue(), g = gap.floatValue();
        if (dynamic.isOn() && mc.player != null) {
            double v = mc.player.getVelocity().horizontalLength();
            g += (float) Math.min(6, v * 20);
        }
        boolean cross = shape.is("Cross") || shape.is("Cross + Dot") || shape.is("T-Shape");
        if (cross) {
            if (!shape.is("T-Shape")) bar(ctx, cx - t / 2, cy - g - l, t, l, col);
            bar(ctx, cx - t / 2, cy + g, t, l, col);
            bar(ctx, cx - g - l, cy - t / 2, l, t, col);
            bar(ctx, cx + g, cy - t / 2, l, t, col);
        }
        if (shape.is("Dot") || shape.is("Cross + Dot")) {
            if (outline.isOn()) Render2D.circle(ctx, cx, cy, t + 1, 0xC0000000);
            Render2D.circle(ctx, cx, cy, t, col);
        }
        if (shape.is("Circle")) {
            float r = g + l / 2 + 1;
            if (outline.isOn()) Render2D.ring(ctx, cx, cy, r + 0.5f, t + 1, 0, 360, 0xC0000000);
            Render2D.ring(ctx, cx, cy, r, t, 0, 360, col);
        }
    }

    private void bar(DrawContext ctx, float x, float y, float w, float h, int col) {
        if (outline.isOn()) Render2D.rect(ctx, x - 0.5f, y - 0.5f, w + 1, h + 1, 0xC0000000);
        Render2D.rect(ctx, x, y, w, h, col);
    }
}
