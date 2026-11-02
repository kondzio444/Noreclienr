package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.module.utility.TabPing;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

/** Ping over the last minute as a small graph, with average and worst value. */
public class PingGraphHud extends HudModule {
    public final NumberSetting seconds = add(new NumberSetting("History", "Ile sekund historii", 60, 20, 120, 10, " s"));

    private final int[] samples = new int[120];
    private int count, head, tick;

    public PingGraphHud() {
        super("Ping Graph", "Wykres pingu z ostatniej minuty (średnia i skoki)", 1.0f, 0.62f);
        width = 110;
        height = 38;
    }

    @Override
    public void onTick() {
        if (!inGame() || game().singleplayer()) { count = 0; return; }
        if (++tick % 20 != 0) return;
        samples[head] = game().ping();
        head = (head + 1) % samples.length;
        count = Math.min(samples.length, count + 1);
    }

    @Override
    public boolean shouldRender() { return inGame() && !game().singleplayer(); }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        int n = Math.min(count, seconds.intValue());
        int[] v = new int[Math.max(n, 2)];
        boolean demo = n < 2;
        if (demo) {
            v = new int[40];
            for (int i = 0; i < v.length; i++) v[i] = 40 + (int) (12 * Math.sin(i * 0.5)) + (i == 27 ? 90 : 0);
            n = v.length;
        } else {
            for (int i = 0; i < n; i++) v[i] = samples[(head - n + i + samples.length) % samples.length];
        }
        int max = 1, sum = 0;
        for (int i = 0; i < n; i++) { max = Math.max(max, v[i]); sum += v[i]; }
        int avg = sum / n, last = v[n - 1];
        width = 110;
        height = 38;
        Render2D.roundedRect(g, 0, 0, width, height, Theme.radius() * 0.8f, 0x90160F26);
        Render2D.text(g, "Ping", 5, 4, Theme.accent(), true);
        String cur = last + " ms";
        Render2D.text(g, cur, width - 5 - Render2D.textWidth(cur), 4, TabPing.color(last), true);
        String stats = "śr. " + avg + " · max " + max;
        Render2D.scaledText(g, stats, 5, 30, 0.6f, Theme.TEXT_DIM, false);
        float gx = 5, gy = 14, gw = width - 10, gh = 14;
        float top = Math.max(100, max * 1.15f);
        float step = gw / (n - 1);
        int c = Theme.accent();
        for (int i = 1; i < n; i++) {
            float x1 = gx + (i - 1) * step, x2 = gx + i * step;
            float y1 = gy + gh - gh * v[i - 1] / top, y2 = gy + gh - gh * v[i] / top;
            Render2D.quadGradient(g, x1, Math.min(y1, y2), x2 - x1, gy + gh - Math.min(y1, y2), ColorUtil.withAlpha(c, 60), ColorUtil.withAlpha(c, 60), ColorUtil.withAlpha(c, 0), ColorUtil.withAlpha(c, 0));
            Render2D.line(g, x1, y1, x2, y2, 1, v[i] > avg * 2 && v[i] > 80 ? 0xFFFF5C5C : c);
        }
    }
}
