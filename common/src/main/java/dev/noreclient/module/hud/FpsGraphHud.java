package dev.noreclient.module.hud;

import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;
import dev.noreclient.api.Gfx;

/** Live line graph of FPS history with min/avg/max. */
public class FpsGraphHud extends HudModule {
    public final NumberSetting graphWidth = add(new NumberSetting("Width", "Szerokość wykresu", 120, 60, 240, 5, "px"));
    public final NumberSetting graphHeight = add(new NumberSetting("Height", "Wysokość wykresu", 36, 20, 90, 2, "px"));
    public final NumberSetting history = add(new NumberSetting("History", "Ile sekund historii", 10, 3, 30, 1, "s"));
    public final BooleanSetting stats = add(new BooleanSetting("Stats", "Pokazuj min / śr. / max", true));
    public final BooleanSetting accentLine = add(new BooleanSetting("Accent Line", "Linia w kolorze motywu", true));
    public final ColorSetting lineColor = add(new ColorSetting("Line Color", "Kolor linii", 0xFF3DDC97));
    public final BooleanSetting fill = add(new BooleanSetting("Fill", "Wypełnienie pod linią", true));
    public final BooleanSetting background = add(new BooleanSetting("Background", "Tło", true));

    private final float[] samples = new float[300];
    private int head, count;
    private long lastSample;

    public FpsGraphHud() {
        super("FPS Graph", "Wykres liczby klatek na żywo", 1.0f, 0.95f);
        lineColor.visibleWhen(() -> !accentLine.isOn());
    }

    @Override
    public void render(Gfx ctx, float tickDelta, boolean editor) {
        long now = System.currentTimeMillis();
        long interval = (long) (history.get() * 1000 / 60);
        if (now - lastSample >= interval) {
            lastSample = now;
            samples[head] = game().fps();
            head = (head + 1) % samples.length;
            count = Math.min(count + 1, samples.length);
        }
        int n = Math.min(count, 60);
        float w = graphWidth.floatValue(), h = graphHeight.floatValue();
        float top = stats.isOn() ? 11 : 0;
        width = w;
        height = h + top;
        if (background.isOn()) Render2D.roundedRect(ctx, 0, 0, w, height, Theme.radius() * 0.6f, 0x90160F26);
        float min = Float.MAX_VALUE, max = 0, sum = 0;
        for (int i = 0; i < n; i++) {
            float v = samples[(head - 1 - i + samples.length) % samples.length];
            min = Math.min(min, v); max = Math.max(max, v); sum += v;
        }
        if (n == 0) { min = 0; max = 60; }
        float range = Math.max(10, max * 1.15f);
        int col = accentLine.isOn() ? Theme.accent() : lineColor.getColor();
        if (stats.isOn()) {
            String s = String.format("min %.0f  •  śr %.0f  •  max %.0f", min, n == 0 ? 0 : sum / n, max);
            Render2D.scaledText(ctx, s, 4, 3, 0.7f, Theme.TEXT_DIM, false);
        }
        float px = 0, py = 0;
        for (int i = 0; i < n; i++) {
            float v = samples[(head - n + i + samples.length) % samples.length];
            float x = 3 + (w - 6) * (n <= 1 ? 1 : i / (float) (n - 1));
            float y = top + h - 3 - (h - 6) * (v / range);
            if (fill.isOn()) Render2D.rect(ctx, x, y, Math.max(1, (w - 6) / Math.max(1, n - 1)), top + h - 3 - y, ColorUtil.withAlpha(col, 40));
            if (i > 0) Render2D.line(ctx, px, py, x, y, 1.2f, col);
            px = x; py = y;
        }
    }
}
