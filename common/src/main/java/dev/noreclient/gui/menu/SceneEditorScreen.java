package dev.noreclient.gui.menu;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.module.client.ClientSettings;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.NoreScene;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.List;

/**
 * Scene editor for the "Scena Nore" menu background: the scene fills the screen, a glass panel on the
 * left sets the time of day (slider or real time), the trees (they grow again when changed) and the
 * camera shot (a smooth flight). Dragging the scene turns the camera.
 */
public class SceneEditorScreen extends NoreScreen {
    private static final class Hit {
        final float x, y, w, h;
        final Runnable r;

        Hit(float x, float y, float w, float h, Runnable r) { this.x = x; this.y = y; this.w = w; this.h = h; this.r = r; }
    }

    private final long opened = System.currentTimeMillis();
    private final List<Hit> hits = new ArrayList<Hit>();
    private final Animation panelIn = new Animation(0, 8);
    private boolean draggingTime, draggingScene;
    private double lastX;
    private float sliderX, sliderW;
    /** Which background is edited: 0 = Wiśniowy staw (real Minecraft scene), 1 = voxel island. */
    private int style = NoreClient.get().modules().get(ClientSettings.class).menuBackground.get().startsWith("Scena") ? 1 : 0;

    public SceneEditorScreen(Object parent) {
        super(parent);
        panelIn.target(1);
    }

    private ClientSettings cs() { return NoreClient.get().modules().get(ClientSettings.class); }

    @Override
    public Background background() { return Background.NONE; }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        hits.clear();
        ClientSettings s = cs();
        if (draggingTime) setTimeFromMouse(mx);
        if (draggingScene) { NoreScene.addYaw((float) (mx - lastX) * 0.01f); lastX = mx; }
        if (style == 0 ? !dev.noreclient.util.MenuPanorama.render(g, width, height, s.sceneMinutes(), mx) : true) {
            NoreScene.render(g, width, height, s.sceneMinutes(), 0.5f + 107f / Math.max(1, width));
        }

        float p = Animation.easeOutCubic(panelIn.update());
        float pw = 200, px = 14 - (1 - p) * (pw + 20), py = 14, ph = height - 28;
        g.setAlpha(p);
        Render2D.shadow(g, px, py, pw, ph, 12, 12, 0x90000000);
        Render2D.roundedRect(g, px, py, pw, ph, 12, 0xD80E0A1A);
        Render2D.roundedOutline(g, px, py, pw, ph, 12, 1, ColorUtil.withAlpha(Theme.accent(), 90));
        float x = px + 14, y = py + 14, w = pw - 28;
        Render2D.gradientText(g, "EDYTOR SCEN", x, y, 1.2f, Theme.accent2(), Theme.accent(), true);
        y += 15;
        Render2D.scaledText(g, "Tło menu głównego Nore", x, y, 0.7f, Theme.TEXT_MUTED, false);
        y += 20;

        // ---- style
        label(g, "STYL TŁA", x, y);
        y += 11;
        float hw = (w - 6) / 2f;
        chip(g, mx, my, x, y, hw, 18, "Wiśniowy staw", style == 0, () -> style = 0);
        chip(g, mx, my, x + hw + 6, y, hw, 18, "Wyspa", style == 1, () -> style = 1);
        y += 28;

        // ---- time of day
        float minutes = s.sceneMinutes();
        label(g, "PORA DNIA", x, y);
        String clock = String.format("%02d:%02d", (int) minutes / 60, (int) minutes % 60);
        Render2D.scaledText(g, clock, x + w - Render2D.textWidth(clock) * 0.9f, y - 1, 0.9f, Theme.TEXT, false);
        y += 12;
        sliderX = x; sliderW = w;
        int[] stops = {0xFF120A2A, 0xFFFF9A5A, 0xFF8FD8FF, 0xFFFF8A6A, 0xFF120A2A};
        for (int i = 0; i < 4; i++) Render2D.quadGradient(g, x + w * i / 4f, y, w / 4f, 6, stops[i], stops[i + 1], stops[i + 1], stops[i]);
        float kx = x + w * minutes / 1440f;
        Render2D.roundedRect(g, kx - 5, y - 4, 10, 14, 3, 0xFFFFFFFF);
        Render2D.roundedOutline(g, kx - 5, y - 4, 10, 14, 3, 1.5f, Theme.accent());
        hits.add(new Hit(x - 4, y - 6, w + 8, 18, () -> { draggingTime = true; s.sceneRealTime.set(false); }));
        y += 18;
        chip(g, mx, my, x, y, w, 16, "Prawdziwa pora dnia", s.sceneRealTime.isOn(), () -> { s.sceneRealTime.set(!s.sceneRealTime.isOn()); save(); });
        y += 28;

        if (style == 1) {
        // ---- trees
        label(g, "DRZEWA", x, y);
        y += 11;
        float cw = (w - 6) / 2f;
        for (int i = 0; i < NoreScene.TREES.length; i++) {
            final String t = NoreScene.TREES[i];
            chip(g, mx, my, x + (i % 2) * (cw + 6), y + (i / 2) * 22f, cw, 18, t, t.equals(s.sceneTree.get()), () -> { s.sceneTree.set(t); NoreScene.setTree(t); save(); });
        }
        y += 50;

        // ---- camera
        label(g, "KAMERA", x, y);
        y += 11;
        float cw3 = (w - 8) / 3f;
        for (int i = 0; i < NoreScene.CAMERAS.length; i++) {
            final int idx = i;
            final String c = NoreScene.CAMERAS[i];
            chip(g, mx, my, x + i * (cw3 + 4), y, cw3, 18, String.valueOf(i + 1), c.equals(s.sceneCamera.get()), () -> { s.sceneCamera.set(c); NoreScene.setCamera(idx); save(); });
        }
        y += 24;
        Render2D.scaledText(g, "Przeciągnij scenę, aby obrócić kamerę", x, y, 0.62f, Theme.TEXT_MUTED, false);
        } else {
            for (String line : new String[]{"Prawdziwy świat Minecraft:", "wiśniowy gaj ze stawem.", "Kamera powoli się obraca,", "pora dnia przenika płynnie."}) {
                Render2D.scaledText(g, line, x, y, 0.68f, Theme.TEXT_DIM, false);
                y += 10;
            }
        }

        // ---- set as background / back
        final String target = style == 0 ? "Wiśniowy staw" : "Scena Nore";
        boolean active = s.menuBackground.get().equals(target);
        float by = py + ph - 52;
        button(g, mx, my, x, by, w, 18, active ? "✔ Ustawione jako tło menu" : "Ustaw jako tło menu", !active, () -> { s.menuBackground.set(target); save(); Sounds.click(); });
        button(g, mx, my, x, by + 24, w, 18, "Wróć", false, this::close);
        g.setAlpha(1);

        float intro = Math.min(1, (System.currentTimeMillis() - opened) / 900f);
        if (intro < 1) Render2D.rect(g, 0, 0, width, height, ColorUtil.withAlpha(0xFF05030A, (int) (255 * (1 - Animation.easeOutCubic(intro)))));
    }

    private static void label(Gfx g, String s, float x, float y) {
        Render2D.scaledText(g, s, x, y, 0.62f, Theme.TEXT_MUTED, false);
    }

    private void chip(Gfx g, int mx, int my, float x, float y, float w, float h, String text, boolean on, Runnable r) {
        boolean hov = Render2D.hovered(mx, my, x, y, w, h);
        Render2D.roundedRect(g, x, y, w, h, 5, on ? ColorUtil.withAlpha(Theme.accent(), 140) : hov ? 0x30FFFFFF : 0x18FFFFFF);
        Render2D.roundedOutline(g, x, y, w, h, 5, 1, on ? ColorUtil.withAlpha(Theme.accent2(), 220) : 0x22FFFFFF);
        float ts = 0.78f;
        String t = Render2D.trim(text, (int) ((w - 6) / ts));
        Render2D.scaledText(g, t, x + w / 2f - Render2D.textWidth(t) * ts / 2f, y + h / 2f - 3.5f, ts, on ? 0xFFFFFFFF : Theme.TEXT_DIM, false);
        hits.add(new Hit(x, y, w, h, r));
    }

    private void button(Gfx g, int mx, int my, float x, float y, float w, float h, String text, boolean primary, Runnable r) {
        boolean hov = Render2D.hovered(mx, my, x, y, w, h);
        if (primary) Render2D.roundedGradient(g, x, y, w, h, 6, ColorUtil.lerp(Theme.accent(), 0xFFFFFFFF, hov ? 0.15f : 0), Theme.accent(), true);
        else Render2D.roundedRect(g, x, y, w, h, 6, hov ? 0x30FFFFFF : 0x1CFFFFFF);
        float ts = 0.82f;
        Render2D.scaledText(g, text, x + w / 2f - Render2D.textWidth(text) * ts / 2f, y + h / 2f - 3.5f, ts, 0xFFFFFFFF, false);
        hits.add(new Hit(x, y, w, h, r));
    }

    private void setTimeFromMouse(double mx) {
        float t = (float) ((mx - sliderX) / sliderW);
        cs().sceneTime.set((double) Math.round(Math.max(0, Math.min(1435, t * 1440)) / 5f) * 5);
    }

    private void save() { NoreClient.get().config().save(); }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        for (int i = hits.size() - 1; i >= 0; i--) {
            Hit h = hits.get(i);
            if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) {
                h.r.run();
                if (draggingTime) setTimeFromMouse(mx);
                return true;
            }
        }
        if (mx > 220) { draggingScene = true; lastX = mx; }
        return true;
    }

    @Override
    public boolean mouseReleased(double mx, double my, int button) {
        if (draggingTime) save();
        draggingTime = false;
        draggingScene = false;
        return true;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        ClientSettings s = cs();
        s.sceneRealTime.set(false);
        s.sceneTime.set(Math.max(0, Math.min(1435, s.sceneTime.get() + Math.signum(amount) * 30)));
        return true;
    }
}
