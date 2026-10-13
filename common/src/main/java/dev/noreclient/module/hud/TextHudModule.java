package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/** Simple "Label: value" overlay with a shared, highly customisable look. */
public abstract class TextHudModule extends HudModule {
    public final ModeSetting style = add(new ModeSetting("Style", "Wygląd ramki", "Modern", "Modern", "Classic", "Minimal"));
    public final BooleanSetting showLabel = add(new BooleanSetting("Show Label", "Pokazuj etykietę", true));
    public final ModeSetting brackets = add(new ModeSetting("Brackets", "Nawiasy wokół tekstu", "None", "None", "[ ]", "( )", "< >"));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło za tekstem", true));
    public final ColorSetting backgroundColor = add(new ColorSetting("Background Color", "Kolor tła", 0x90140F0C));
    public final BooleanSetting accentLabel = add(new BooleanSetting("Accent Label", "Etykieta w kolorze motywu", true));
    public final ColorSetting labelColor = add(new ColorSetting("Label Color", "Kolor etykiety", 0xFFFFC08A));
    public final ColorSetting valueColor = add(new ColorSetting("Value Color", "Kolor wartości", 0xFFFFFFFF));
    public final BooleanSetting shadow = add(new BooleanSetting("Text Shadow", "Cień tekstu", true));

    protected TextHudModule(String name, String description, float relX, float relY) {
        super(name, description, relX, relY);
        labelColor.visibleWhen(new java.util.function.BooleanSupplier() {
            @Override public boolean getAsBoolean() { return !accentLabel.isOn(); }
        });
    }

    protected abstract String label();

    protected abstract String value();

    protected String previewValue() { return value(); }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        String v = inGame() ? value() : previewValue();
        String l = showLabel.isOn() ? label() : "";
        String open = "", close = "";
        if (brackets.is("[ ]")) { open = "["; close = "]"; }
        else if (brackets.is("( )")) { open = "("; close = ")"; }
        else if (brackets.is("< >")) { open = "<"; close = ">"; }
        String lText = l.isEmpty() ? "" : l + (style.is("Minimal") ? " " : ": ");
        int lw = Render2D.textWidth(open + lText);
        int vw = Render2D.textWidth(v + close);
        int pad = style.is("Minimal") ? 2 : 5;
        width = lw + vw + pad * 2 + (style.is("Modern") ? 3 : 0);
        height = style.is("Minimal") ? 12 : 17;
        float r = style.is("Classic") ? 0 : Theme.radius() * 0.6f;
        if (background.isOn()) Render2D.roundedRect(g, 0, 0, width, height, r, backgroundColor.getColor());
        float tx = pad;
        if (style.is("Modern")) {
            Render2D.roundedRect(g, 0, 3, 2, height - 6, 1, Theme.accent());
            tx += 3;
        }
        int lc = accentLabel.isOn() ? Theme.accent() : labelColor.getColor();
        float ty = (height - 8) / 2f + 0.5f;
        Render2D.text(g, open + lText, tx, ty, lc, shadow.isOn());
        Render2D.text(g, v + close, tx + lw, ty, valueColor.getColor(), shadow.isOn());
    }

    protected static int dim(int c) { return ColorUtil.fade(c, 0.6f); }
}
