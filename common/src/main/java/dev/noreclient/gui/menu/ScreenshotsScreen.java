package dev.noreclient.gui.menu;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.api.TextureRef;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.gui.widget.Widgets;
import dev.noreclient.module.utility.Screenshots;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.CurrentGfx;
import dev.noreclient.util.MenuBackground;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;
import dev.noreclient.util.Thumbnails;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Screenshot gallery: thumbnail grid, full view with previous / next, open, folder and delete. */
public class ScreenshotsScreen extends NoreScreen {
    private static final SimpleDateFormat DATE = new SimpleDateFormat("d MMM yyyy, HH:mm", new Locale("pl", "PL"));

    private File[] files = new File[0];
    private final Map<String, Animation> hover = new HashMap<String, Animation>();
    private final Animation scroll = new Animation(0, 14);
    private final Animation viewAnim = new Animation(0, 12);
    private final long opened = System.currentTimeMillis();
    private float scrollTarget, contentH;
    private int viewing = -1;
    private long deleteArmed;
    // last frame layout
    private float gx, gy, gw, gh, cell, cellH;
    private int cols;
    private float[][] buttons = new float[0][];

    public ScreenshotsScreen(Object parent) {
        super(parent);
    }

    @Override
    protected void init() {
        files = Screenshots.list();
        if (viewing >= files.length) viewing = files.length - 1;
    }

    @Override
    public Background background() { return game().inWorld() ? Background.DIM_WORLD : Background.NONE; }

    private Animation anim(String k) {
        Animation a = hover.get(k);
        if (a == null) hover.put(k, a = new Animation(0, 16));
        return a;
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        CurrentGfx.set(g);
        if (!game().inWorld()) MenuBackground.render(g, width, height, mx, my);
        Render2D.rect(g, 0, 0, width, height, 0x90080605);
        float in = Animation.easeOutCubic((System.currentTimeMillis() - opened) / 400f);

        // header
        float pad = 16;
        Render2D.gradientText(g, "ZRZUTY EKRANU", pad, 14, 1.5f, Theme.accent2(), Theme.accent(), true);
        Render2D.scaledText(g, files.length + " zdjęć • F2 robi nowy zrzut • kliknij, aby powiększyć", pad, 30, 0.72f, Theme.TEXT_MUTED, false);
        float bx = width - pad - 84;
        buttons = new float[][]{{bx, 14, 84, 18, 0}, {bx - 64, 14, 60, 18, 1}};
        headerButton(g, mx, my, buttons[0], "Otwórz folder");
        headerButton(g, mx, my, buttons[1], "Wróć");

        // grid
        gx = pad; gy = 44; gw = width - pad * 2; gh = height - gy - 10;
        cols = Math.max(2, (int) (gw / 150));
        cell = (gw - (cols - 1) * 8) / cols;
        cellH = cell * 9 / 16f + 18;
        int rows = (files.length + cols - 1) / cols;
        contentH = rows * (cellH + 8);
        scrollTarget = Math.max(0, Math.min(scrollTarget, contentH - gh));
        float sc = scroll.target(scrollTarget).update();
        g.setAlpha(in);
        if (files.length == 0) {
            Icons.download(g, width / 2f, height / 2f - 10, 18, ColorUtil.withAlpha(Theme.accent(), 160));
            Render2D.centeredText(g, "Nie masz jeszcze zrzutów ekranu – naciśnij F2 w grze", width / 2f, height / 2f + 10, Theme.TEXT_MUTED, false);
        }
        g.scissor((int) gx - 4, (int) gy - 2, (int) (gx + gw + 4), (int) (gy + gh));
        boolean gridActive = viewing < 0;
        for (int i = 0; i < files.length; i++) {
            int c = i % cols, r = i / cols;
            float x = gx + c * (cell + 8), y = gy + r * (cellH + 8) - sc;
            if (y + cellH < gy || y > gy + gh) continue;
            float st = Animation.easeOutCubic((System.currentTimeMillis() - opened - Math.min(i, 16) * 25) / 350f);
            y += (1 - Math.max(0, st)) * 12;
            boolean hov = gridActive && Render2D.hovered(mx, my, x, y, cell, cellH) && my >= gy && my <= gy + gh;
            float h = anim(files[i].getName()).target(hov ? 1 : 0).update();
            float r2 = Theme.radius();
            if (h > 0.01f) Render2D.shadow(g, x, y, cell, cellH, r2, 5, ColorUtil.withAlpha(Theme.accent(), (int) (70 * h)));
            Render2D.roundedRect(g, x, y, cell, cellH, r2, ColorUtil.lerp(0xC0120E0B, 0xE01A1410, h));
            Render2D.roundedOutline(g, x, y, cell, cellH, r2, 1, ColorUtil.lerp(0x26FFFFFF, ColorUtil.withAlpha(Theme.accent(), 170), h));
            TextureRef t = Thumbnails.get(files[i], 256);
            float iw = cell - 6, ih = iw * 9 / 16f;
            if (t != null) Render2D.texture(g, t, x + 3, y + 3, iw, ih, 1f);
            else Render2D.roundedRect(g, x + 3, y + 3, iw, ih, 3, 0x20FFFFFF);
            Render2D.scaledText(g, DATE.format(new Date(files[i].lastModified())), x + 5, y + ih + 7, 0.66f, h > 0.5f ? Theme.TEXT : Theme.TEXT_DIM, false);
            String size = String.format(Locale.ROOT, "%.1f MB", files[i].length() / 1048576.0);
            Render2D.scaledText(g, size, x + cell - 5 - Render2D.textWidth(size) * 0.6f, y + ih + 7.5f, 0.6f, Theme.TEXT_MUTED, false);
        }
        g.endScissor();
        if (contentH > gh) {
            float th = Math.max(20, gh * gh / contentH), ty = gy + (gh - th) * (sc / (contentH - gh));
            Render2D.roundedRect(g, width - 6, ty, 2.5f, th, 1.2f, ColorUtil.withAlpha(Theme.accent(), 140));
        }
        g.setAlpha(1);

        // full view
        float v = viewAnim.target(viewing >= 0 ? 1 : 0).update();
        if (v > 0.01f && files.length > 0) renderViewer(g, mx, my, Math.max(0, Math.min(files.length - 1, Math.max(viewing, 0))), v);
    }

    private void headerButton(Gfx g, int mx, int my, float[] b, String label) {
        boolean hov = viewing < 0 && Render2D.hovered(mx, my, b[0], b[1], b[2], b[3]);
        Widgets.glowBox(g, b[0], b[1], b[2], b[3], Theme.radius(), Theme.accent(), anim("hb" + label).target(hov ? 1 : 0).update(), b[4] == 0 ? 1f : 0.5f);
        Render2D.centeredText(g, label, b[0] + b[2] / 2f, b[1] + 5, Widgets.glowText(Theme.accent(), 0.3f), false);
    }

    private float[][] viewerButtons = new float[0][];

    private void renderViewer(Gfx g, int mx, int my, int idx, float v) {
        Render2D.rect(g, 0, 0, width, height, ColorUtil.withAlpha(0xFF050403, (int) (225 * v)));
        g.setAlpha(v);
        File f = files[idx];
        TextureRef t = Thumbnails.get(f, 1280);
        if (t == null) t = Thumbnails.get(f, 256);
        float maxW = width - 80, maxH = height - 70;
        float iw = maxW, ih = iw * 9 / 16f;
        if (t != null) { ih = iw * t.height / (float) t.width; }
        if (ih > maxH) { iw *= maxH / ih; ih = maxH; }
        float s = 0.94f + 0.06f * v;
        iw *= s; ih *= s;
        float ix = (width - iw) / 2f, iy = 16 + (maxH - ih) / 2f;
        Render2D.shadow(g, ix, iy, iw, ih, 4, 10, 0xA0000000);
        if (t != null) Render2D.texture(g, t, ix, iy, iw, ih, 1f);
        else Render2D.roundedRect(g, ix, iy, iw, ih, 4, 0x30FFFFFF);
        Render2D.roundedOutline(g, ix, iy, iw, ih, 3, 1, ColorUtil.withAlpha(Theme.accent(), 120));
        // arrows
        float ay = iy + ih / 2f - 12;
        arrow(g, mx, my, 10, ay, false, idx > 0);
        arrow(g, mx, my, width - 34, ay, true, idx < files.length - 1);
        // info + buttons
        float by = height - 36;
        Render2D.text(g, f.getName(), 20, by + 2, Theme.TEXT, false);
        Render2D.scaledText(g, DATE.format(new Date(f.lastModified())) + "  •  " + String.format(Locale.ROOT, "%.1f MB", f.length() / 1048576.0) + "  •  " + (idx + 1) + "/" + files.length,
                20, by + 13, 0.7f, Theme.TEXT_MUTED, false);
        boolean armed = System.currentTimeMillis() - deleteArmed < 2500;
        String[] labels = {"Otwórz", "Folder", armed ? "Na pewno?" : "Usuń", "Zamknij"};
        float x = width - 20;
        viewerButtons = new float[labels.length][];
        for (int i = labels.length - 1; i >= 0; i--) {
            float w = Render2D.textWidth(labels[i]) + 18;
            x -= w;
            viewerButtons[i] = new float[]{x, by, w, 18};
            boolean hov = Render2D.hovered(mx, my, x, by, w, 18);
            int col = i == 2 ? 0xFFFF5C5C : Theme.accent();
            Widgets.glowBox(g, x, by, w, 18, Theme.radius(), col, anim("vb" + i).target(hov ? 1 : 0).update(), i == 0 ? 1f : 0.55f);
            Render2D.centeredText(g, labels[i], x + w / 2f, by + 5, Widgets.glowText(col, 0.3f), false);
            x -= 6;
        }
        g.setAlpha(1);
    }

    private void arrow(Gfx g, int mx, int my, float x, float y, boolean right, boolean enabled) {
        if (!enabled) return;
        boolean hov = Render2D.hovered(mx, my, x, y, 24, 24);
        float h = anim(right ? "ar" : "al").target(hov ? 1 : 0).update();
        Render2D.circle(g, x + 12, y + 12, 12, ColorUtil.withAlpha(0xFF000000, (int) (120 + 60 * h)));
        Render2D.ring(g, x + 12, y + 12, 12, 1, 0, 360, ColorUtil.withAlpha(Theme.accent(), (int) (100 + 120 * h)));
        float cx = x + 12, cy = y + 12, d = right ? 1 : -1;
        Render2D.line(g, cx - 2 * d, cy - 5, cx + 3 * d, cy, 1.6f, 0xFFFFFFFF);
        Render2D.line(g, cx + 3 * d, cy, cx - 2 * d, cy + 5, 1.6f, 0xFFFFFFFF);
    }

    private void step(int d) {
        if (viewing < 0) return;
        int n = Math.max(0, Math.min(files.length - 1, viewing + d));
        if (n != viewing) { viewing = n; deleteArmed = 0; Sounds.click(); }
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (viewing >= 0) {
            for (int i = 0; i < viewerButtons.length; i++) {
                float[] b = viewerButtons[i];
                if (b != null && Render2D.hovered(mx, my, b[0], b[1], b[2], b[3])) {
                    File f = files[viewing];
                    Sounds.click();
                    if (i == 0) game().openUrl(f.toURI().toString());
                    else if (i == 1) game().openUrl(Screenshots.folder().toURI().toString());
                    else if (i == 2) {
                        if (System.currentTimeMillis() - deleteArmed < 2500) {
                            f.delete();
                            deleteArmed = 0;
                            files = Screenshots.list();
                            if (files.length == 0) viewing = -1;
                            else viewing = Math.min(viewing, files.length - 1);
                        } else deleteArmed = System.currentTimeMillis();
                    } else viewing = -1;
                    return true;
                }
            }
            if (mx < 40) { step(-1); return true; }
            if (mx > width - 40) { step(1); return true; }
            if (button == 1) { viewing = -1; return true; }
            return true;
        }
        for (float[] b : buttons) {
            if (Render2D.hovered(mx, my, b[0], b[1], b[2], b[3])) {
                Sounds.click();
                if (b[4] == 0) game().openUrl(Screenshots.folder().toURI().toString());
                else close();
                return true;
            }
        }
        if (my < gy || my > gy + gh) return false;
        float sc = scroll.get();
        for (int i = 0; i < files.length; i++) {
            int c = i % cols, r = i / cols;
            float x = gx + c * (cell + 8), y = gy + r * (cellH + 8) - sc;
            if (Render2D.hovered(mx, my, x, y, cell, cellH)) {
                Sounds.click();
                if (button == 1) game().openUrl(files[i].toURI().toString());
                else viewing = i;
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        if (viewing >= 0) { step(amount > 0 ? -1 : 1); return true; }
        scrollTarget = (float) Math.max(0, Math.min(contentH - gh, scrollTarget - amount * 40));
        return true;
    }

    @Override
    public boolean keyPressed(int key, int modifiers) {
        if (viewing >= 0) {
            if (key == Keys.ESCAPE) { viewing = -1; return true; }
            if (key == Keys.LEFT) { step(-1); return true; }
            if (key == Keys.RIGHT) { step(1); return true; }
            if (key == Keys.DELETE) { deleteArmed = System.currentTimeMillis(); return true; }
            return true;
        }
        return super.keyPressed(key, modifiers);
    }
}
