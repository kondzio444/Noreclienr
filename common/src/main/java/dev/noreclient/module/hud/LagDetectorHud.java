package dev.noreclient.module.hud;

import dev.noreclient.api.Gfx;
import dev.noreclient.module.HudModule;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.util.Locale;

/**
 * Warns when the server stops responding: it sends the world time every second, so a longer gap
 * means a lag spike or a dead connection (before the game itself notices).
 */
public class LagDetectorHud extends HudModule {
    public final NumberSetting threshold = add(new NumberSetting("Threshold", "Po ilu sekundach ciszy pokazać ostrzeżenie", 2.5, 1.5, 10, 0.5, " s"));
    public final BooleanSetting sound = add(new BooleanSetting("Sound", "Dźwięk, gdy serwer przestaje odpowiadać", false));

    private static volatile long lastPacket;
    private boolean warned;

    public LagDetectorHud() {
        super("Lag Detector", "Ostrzeżenie, gdy serwer przestaje odpowiadać (lag, zerwane połączenie)", 0.5f, 0.12f);
        width = 120;
        height = 17;
    }

    @Override
    protected boolean needsHook() { return true; }

    public static void onServerPacket() {
        lastPacket = System.nanoTime();
    }

    private float silence() {
        if (!inGame() || lastPacket == 0) return 0;
        // a paused singleplayer world sends nothing on purpose
        if (game().singleplayer() && game().screenOpen() && !game().chatOpen()) { lastPacket = System.nanoTime(); return 0; }
        return (System.nanoTime() - lastPacket) / 1e9f;
    }

    @Override
    public void onTick() {
        if (!inGame()) { lastPacket = 0; warned = false; return; }
        boolean lag = silence() > threshold.get();
        if (lag && !warned && sound.isOn()) game().playPing(0.6f);
        warned = lag;
    }

    @Override
    public boolean shouldRender() { return silence() > threshold.get(); }

    @Override
    public void render(Gfx g, float tickDelta, boolean editor) {
        float s = inGame() ? silence() : 3.4f;
        if (s <= threshold.get() && inGame()) s = 3.4f; // editor preview while playing
        String text = "Serwer nie odpowiada  " + String.format(Locale.ROOT, "%.1f s", s);
        width = Render2D.textWidth(text) + 20;
        height = 17;
        float pulse = 0.5f + 0.5f * (float) Math.sin(System.currentTimeMillis() / 180.0);
        Render2D.roundedRect(g, 0, 0, width, height, Theme.radius() * 0.8f, 0xC0260A0E);
        Render2D.roundedOutline(g, 0, 0, width, height, Theme.radius() * 0.8f, 1, ColorUtil.withAlpha(0xFFFF4D5E, (int) (90 + 120 * pulse)));
        Render2D.circle(g, 8, height / 2f, 2.6f, ColorUtil.withAlpha(0xFFFF4D5E, (int) (140 + 115 * pulse)));
        Render2D.text(g, text, 14, 5, 0xFFFFD9DC, true);
    }
}
