package dev.noreclient.module.utility;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.TextureRef;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;
import dev.noreclient.util.Thumbnails;

import java.io.File;

/**
 * Nore screenshot system: after F2 a card with a preview of the shot slides in (with the file
 * name and a hint where the gallery is). The gallery itself is in the main and pause menus.
 */
public class Screenshots extends Module {
    public final BooleanSetting preview = add(new BooleanSetting("Preview", "Podgląd zrzutu w rogu ekranu", true));
    public final NumberSetting seconds = add(new NumberSetting("Duration", "Jak długo widać podgląd", 4, 2, 10, 0.5, " s"));
    public final BooleanSetting sound = add(new BooleanSetting("Sound", "Dźwięk po zrobieniu zrzutu", true));

    private long lastSeen = System.currentTimeMillis();
    private int timer;
    private File shown;
    private long shownAt;
    private final Animation slide = new Animation(0, 9);

    public Screenshots() {
        super("Screenshots", "Podgląd zrzutów ekranu i galeria w menu", Category.UTILITY);
        setEnabled(true);
    }

    public static File folder() {
        return new File(game().gameDir(), "screenshots");
    }

    /** Screenshots, newest first. */
    public static File[] list() {
        File[] files = folder().listFiles((d, n) -> n.toLowerCase().endsWith(".png"));
        if (files == null) return new File[0];
        java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        return files;
    }

    @Override
    public void onTick() {
        if (timer-- > 0) return;
        timer = 5;
        File[] files = folder().listFiles((d, n) -> n.toLowerCase().endsWith(".png"));
        if (files == null) return;
        File newest = null;
        for (File f : files) if (f.lastModified() > lastSeen && (newest == null || f.lastModified() > newest.lastModified())) newest = f;
        if (newest == null) return;
        lastSeen = newest.lastModified();
        shown = newest;
        shownAt = System.currentTimeMillis();
        if (sound.isOn()) Sounds.toggle(true);
        Thumbnails.get(newest, 256); // start loading right away
    }

    @Override
    public void onRenderOverlay(Gfx g, float tickDelta) {
        if (shown == null || !preview.isOn()) return;
        long age = System.currentTimeMillis() - shownAt;
        boolean out = age > seconds.get() * 1000;
        float p = slide.target(out ? 0 : 1).update();
        if (out && p < 0.01f) { shown = null; return; }
        float w = 150, h = 108, x = g.width() - (w + 10) * Animation.easeOutCubic(p), y = g.height() - h - 40;
        float r = Theme.radius();
        g.setAlpha(Math.min(1, p * 1.5f));
        Render2D.shadow(g, x, y, w, h, r, 6, 0x80000000);
        Render2D.roundedRect(g, x, y, w, h, r, 0xE8120E0B);
        Render2D.roundedOutline(g, x, y, w, h, r, 1, ColorUtil.withAlpha(Theme.accent(), 140));
        TextureRef t = Thumbnails.get(shown, 256);
        float iw = w - 10, ih = iw * 9 / 16f;
        if (t != null) {
            ih = Math.min(ih, iw * t.height / (float) t.width);
            Render2D.texture(g, t, x + 5, y + 5, iw, ih, 1f);
        } else {
            Render2D.roundedRect(g, x + 5, y + 5, iw, ih, 3, 0x30FFFFFF);
        }
        // white flash right after the shot
        float flash = Math.max(0, 1 - age / 350f);
        if (flash > 0) Render2D.rect(g, x + 5, y + 5, iw, ih, ColorUtil.withAlpha(0xFFFFFFFF, (int) (200 * flash)));
        Render2D.circle(g, x + 9, y + h - 21, 2.2f, Theme.SUCCESS);
        Render2D.text(g, "Zrzut zapisany", x + 14, y + h - 25, Theme.TEXT, false);
        Render2D.scaledText(g, Render2D.trim(shown.getName(), (int) ((w - 12) / 0.62f)), x + 6, y + h - 14, 0.62f, Theme.TEXT_MUTED, false);
        Render2D.scaledText(g, "Galeria: menu → Zrzuty ekranu", x + 6, y + h - 7.5f, 0.58f, ColorUtil.brighten(Theme.accent(), 0.3f), false);
        // progress line
        float left = 1 - Math.min(1, age / (float) (seconds.get() * 1000));
        Render2D.rect(g, x + r, y + h - 1.5f, (w - 2 * r) * left, 1.5f, Theme.accent());
        g.setAlpha(1);
    }
}
