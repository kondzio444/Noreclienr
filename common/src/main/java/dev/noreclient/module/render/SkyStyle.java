package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;

/**
 * Sky appearance: tints the sky dome, clouds and the sunrise/sunset glow with a style, and changes how
 * the stars look. The platform only hands the vanilla values in and draws what comes back, so it works
 * the same on every version; brightness follows vanilla, so nights stay dark.
 */
public class SkyStyle extends Module {
    public final ModeSetting style = add(new ModeSetting("Style", "Wygląd nieba", "Nore Fiolet",
            "Nore Fiolet", "Zorza", "Zachód", "Kosmos", "Pastel", "Tęcza", "Własny"));
    public final ColorSetting color = add(new ColorSetting("Color", "Własny kolor nieba", 0xFF9D5CFF));
    public final NumberSetting intensity = add(new NumberSetting("Intensity", "Siła zabarwienia", 70, 10, 100, 5, "%"));
    public final BooleanSetting clouds = add(new BooleanSetting("Tinted Clouds", "Chmury w kolorze nieba", true));
    public final BooleanSetting sunset = add(new BooleanSetting("Tinted Sunset", "Wschód i zachód w kolorze stylu", true));
    public final ModeSetting stars = add(new ModeSetting("Stars", "Gwiazdy", "Jaśniejsze", "Vanilla", "Jaśniejsze", "Zawsze widoczne", "Brak"));

    public SkyStyle() {
        super("Sky Style", "Zmienia wygląd nieba: kolor, chmury i gwiazdy", Category.RENDER);
        color.visibleWhen(() -> style.is("Własny"));
    }

    /** The module when it is switched on, otherwise null (for the platform hooks). */
    public static SkyStyle active() {
        dev.noreclient.NoreClient c = dev.noreclient.NoreClient.get();
        if (c == null) return null;
        SkyStyle s = c.modules().get(SkyStyle.class);
        return s != null && s.isActive() ? s : null;
    }

    @Override
    public String getSuffix() { return style.get(); }

    @Override
    protected boolean needsHook() { return true; }

    /** The style colour right now (some styles drift over time). */
    public int target() {
        double t = System.currentTimeMillis() / 1000.0;
        switch (style.get()) {
            case "Zorza": {
                float k = (float) (0.5 + 0.5 * Math.sin(t * 0.25));
                return ColorUtil.lerp(0xFF2EE6A6, 0xFF7A4DFF, k);
            }
            case "Zachód": return 0xFFFF7A59;
            case "Kosmos": return 0xFF1A0F3D;
            case "Pastel": return 0xFFF7B6E0;
            case "Tęcza": return ColorUtil.hsb((float) ((t * 0.03) % 1.0), 0.55f, 1f, 255);
            case "Własny": return color.getColor();
            default: return 0xFF9D5CFF;
        }
    }

    private float amount() { return intensity.get().floatValue() / 100f; }

    /** Keeps the brightness of {@code vanilla} but takes the hue of the style. */
    private static int matchBrightness(int vanilla, int tint) {
        int vm = Math.max(ColorUtil.red(vanilla), Math.max(ColorUtil.green(vanilla), ColorUtil.blue(vanilla)));
        int tm = Math.max(1, Math.max(ColorUtil.red(tint), Math.max(ColorUtil.green(tint), ColorUtil.blue(tint))));
        float f = vm / (float) tm;
        return ColorUtil.argb(255, Math.min(255, (int) (ColorUtil.red(tint) * f)), Math.min(255, (int) (ColorUtil.green(tint) * f)), Math.min(255, (int) (ColorUtil.blue(tint) * f)));
    }

    /** Sky dome colour (RGB, alpha ignored and kept). */
    public int sky(int vanilla) {
        int a = vanilla & 0xFF000000;
        int v = vanilla | 0xFF000000;
        int out;
        if (style.is("Kosmos")) out = ColorUtil.lerp(v, target(), Math.min(1f, amount() * 1.3f));
        else out = ColorUtil.lerp(v, matchBrightness(v, target()), amount());
        return a | (out & 0xFFFFFF);
    }

    /** Cloud colour: a soft, light version of the style. */
    public int clouds(int vanilla) {
        if (!clouds.isOn()) return vanilla;
        int a = vanilla & 0xFF000000;
        int v = vanilla | 0xFF000000;
        int soft = matchBrightness(v, ColorUtil.lerp(target(), 0xFFFFFFFF, style.is("Kosmos") ? 0.35f : 0.6f));
        return a | (ColorUtil.lerp(v, soft, amount() * 0.6f) & 0xFFFFFF);
    }

    /** Sunrise/sunset glow (ARGB; the alpha carries the glow strength and is kept). */
    public int sunset(int vanilla) {
        if (!sunset.isOn()) return vanilla;
        int a = vanilla & 0xFF000000;
        int tint = ColorUtil.lerp(target(), 0xFFFF9A5A, 0.35f);
        return a | (ColorUtil.lerp(vanilla | 0xFF000000, tint, amount() * 0.8f) & 0xFFFFFF);
    }

    /** Star brightness (0..1). */
    public float stars(float vanilla) {
        switch (stars.get()) {
            case "Brak": return 0f;
            case "Jaśniejsze": return Math.min(1f, vanilla * 1.8f);
            case "Zawsze widoczne": return Math.max(style.is("Kosmos") ? 0.9f : 0.55f, Math.min(1f, vanilla * 1.8f));
            default: return style.is("Kosmos") ? Math.max(vanilla, 0.8f) : vanilla;
        }
    }

    /** Float RGB variant for versions that pass colours as vectors. */
    public double[] sky(double r, double g, double b) {
        int c = sky(ColorUtil.argb(255, (int) (r * 255), (int) (g * 255), (int) (b * 255)));
        return new double[]{ColorUtil.red(c) / 255.0, ColorUtil.green(c) / 255.0, ColorUtil.blue(c) / 255.0};
    }

    public double[] clouds(double r, double g, double b) {
        int c = clouds(ColorUtil.argb(255, (int) (r * 255), (int) (g * 255), (int) (b * 255)));
        return new double[]{ColorUtil.red(c) / 255.0, ColorUtil.green(c) / 255.0, ColorUtil.blue(c) / 255.0};
    }
}
