package dev.noreclient.gui.click;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.gui.hud.HudEditorScreen;
import dev.noreclient.gui.menu.CosmeticsScreen;
import dev.noreclient.gui.menu.SceneEditorScreen;
import dev.noreclient.gui.widget.Icons;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.util.Animation;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;
import dev.noreclient.util.Theme;

import java.util.ArrayList;
import java.util.List;

/**
 * The Nore menu (Right Shift): a radial wheel in 3D. Sectors are extruded ring segments seen in
 * perspective; the wheel leans towards the mouse, the pointed sector lifts out of the ring, and a
 * category opens as a 3D carousel of module cards (wheel / drag to turn, click to toggle,
 * right click for settings). The classic list is one click away in the centre.
 */
public class RadialMenuScreen extends NoreScreen {
    private interface Icon { void draw(Gfx g, float cx, float cy, float s, int color); }

    private static final class Sector {
        final String name, sub;
        final Category category;
        final Icon icon;
        final Runnable open;
        final Animation lift = new Animation(0, 14);

        Sector(String name, String sub, Category category, Icon icon, Runnable open) {
            this.name = name; this.sub = sub; this.category = category; this.icon = icon; this.open = open;
        }
    }

    private static final float FOCAL = 620;
    private final List<Sector> sectors = new ArrayList<Sector>();
    private final long opened = System.currentTimeMillis();
    private final Animation tiltX = new Animation(16, 7), tiltY = new Animation(0, 7);
    private final Animation ringIn = new Animation(1, 9), carouselIn = new Animation(0, 9);
    private final Animation spin = new Animation(0, 10), pick = new Animation(0, 12);
    private int hover = -1;
    private Sector openCategory;
    private List<Module> mods = new ArrayList<Module>();
    private float carousel, carouselTarget;
    private int carouselHover = -1;
    private double dragX = Double.NaN;
    private float dragFrom;
    private boolean dragged;

    public RadialMenuScreen(Object parent) {
        super(parent);
        final RadialMenuScreen self = this;
        sectors.add(new Sector("HUD", "Nakładki na ekranie", Category.HUD, Icons::hud, null));
        sectors.add(new Sector("Render", "Wygląd i kamera", Category.RENDER, Icons::eye, null));
        sectors.add(new Sector("Gracz", "Ruch i gracz", Category.PLAYER, Icons::person, null));
        sectors.add(new Sector("Narzędzia", "Czat, alerty, zrzuty", Category.UTILITY, Icons::wrench, null));
        sectors.add(new Sector("Szatnia", "Peleryny, skrzydła, czapki", null, Icons::bag, () -> game().openScreen(new CosmeticsScreen(self))));
        sectors.add(new Sector("Scena", "Tło menu, pora dnia, niebo", null, Icons::globe, () -> game().openScreen(new SceneEditorScreen(self))));
        sectors.add(new Sector("Edytor HUD", "Układaj elementy HUD", null, Icons::grid, () -> game().openScreen(new HudEditorScreen(self))));
        sectors.add(new Sector("Klient", "Motyw i ustawienia", Category.CLIENT, Icons::gear, null));
        spin.set(-70);
        spin.target(0);
    }

    @Override
    public Background background() { return game().inWorld() ? Background.DIM_WORLD : Background.NONE; }

    // ------------------------------------------------------------------ 3D helpers

    private float cx() { return width / 2f; }

    private float cy() { return height / 2f + 6; }

    /** Projects a point of the wheel plane (x right, y down, z away from the viewer). */
    private float[] project(float x, float y, float z) {
        double ax = Math.toRadians(tiltX.get()), ay = Math.toRadians(tiltY.get());
        float y1 = (float) (y * Math.cos(ax) - z * Math.sin(ax));
        float z1 = (float) (y * Math.sin(ax) + z * Math.cos(ax));
        float x2 = (float) (x * Math.cos(ay) + z1 * Math.sin(ay));
        float z2 = (float) (-x * Math.sin(ay) + z1 * Math.cos(ay));
        float k = FOCAL / (FOCAL + z2);
        return new float[]{cx() + x2 * k, cy() + y1 * k, k, z2};
    }

    private float radius() { return Math.min(width, height) * 0.36f; }

    // ------------------------------------------------------------------ render

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        float t = Math.min(1, (System.currentTimeMillis() - opened) / 520f);
        float open = Animation.easeOutBack(t);
        float fade = Animation.easeOutCubic(t);
        // the wheel leans towards the mouse
        float nx = (mx - cx()) / (width / 2f), ny = (my - cy()) / (height / 2f);
        tiltY.target(nx * 14).update();
        tiltX.target(16 - ny * 10).update();
        spin.update();
        float ring = ringIn.update(), car = carouselIn.update();
        pick.update();

        // backdrop: violet vignette
        Render2D.radial(g, cx(), cy(), Math.max(width, height) * 0.75f, ColorUtil.withAlpha(0xFF2A1458, (int) (150 * fade)), ColorUtil.withAlpha(0xFF05030A, (int) (200 * fade)));

        if (ring > 0.01f) {
            g.push();
            g.setAlpha(fade * ring);
            float scale = (0.55f + 0.45f * open) * (1 + (1 - ring) * 0.35f);
            renderWheel(g, mx, my, scale, ring);
            g.setAlpha(1);
            g.pop();
        }
        if (car > 0.01f && openCategory != null) {
            g.setAlpha(car);
            renderCarousel(g, mx, my, car);
            g.setAlpha(1);
        }
        // footer hint
        String hint = openCategory == null ? "Najedź i kliknij sektor  •  1–8 skróty  •  środek = pełna lista  •  Esc zamyka"
                : "Kółko / przeciągnij – obróć  •  LPM – włącz / wyłącz  •  PPM – ustawienia  •  Esc – wróć";
        float hs = 0.72f;
        Render2D.scaledText(g, hint, cx() - Render2D.textWidth(hint) * hs / 2f, height - 18, hs, ColorUtil.withAlpha(Theme.TEXT_MUTED, (int) (255 * fade)), false);
    }

    private void renderWheel(Gfx g, int mx, int my, float scale, float ring) {
        int n = sectors.size();
        float R = radius() * scale, r0 = R * 0.42f, r1 = R;
        // which sector does the mouse point at (by direction from the centre)
        float dx = mx - cx(), dy = my - cy();
        float dist = (float) Math.hypot(dx, dy);
        hover = -1;
        if (openCategory == null && dist > r0 * 0.55f && dist < R * 1.35f) {
            double a = Math.toDegrees(Math.atan2(dy, dx)) + 90 + 180.0 / n;
            hover = (int) Math.floor(((a % 360) + 360) % 360 / (360.0 / n));
        }
        float spinDeg = spin.get();
        float gap = 3.2f;
        float depth = 14 * scale;
        // back ring glow
        float[] c0 = project(0, 0, 0);
        Render2D.radial(g, c0[0], c0[1], R * 1.15f, ColorUtil.withAlpha(Theme.accent(), 60), ColorUtil.withAlpha(Theme.accent(), 0));
        // sectors: rims first (behind), then faces
        for (int pass = 0; pass < 2; pass++) {
            for (int i = 0; i < n; i++) {
                Sector s = sectors.get(i);
                float lift = s.lift.target(i == hover ? 1 : 0).update();
                float a0 = -90 - 180f / n + i * 360f / n + gap / 2 + spinDeg, a1 = a0 + 360f / n - gap;
                float z = -lift * 26 * scale;
                float ro = r1 + lift * 10 * scale;
                int base = ColorUtil.lerp(0xF0181030, ColorUtil.withAlpha(ColorUtil.lerp(Theme.accent(), 0xFF2A1458, 0.25f), 245), lift);
                int top = ColorUtil.lerp(0xF0261A48, ColorUtil.withAlpha(Theme.accent2(), 250), lift * 0.85f);
                if (pass == 0) rim(g, a0, a1, ro, z, z + depth, ColorUtil.lerp(0xFF0D0819, ColorUtil.withAlpha(Theme.accent(), 255), lift * 0.6f));
                else wedge(g, a0, a1, r0, ro, z, base, top, lift);
            }
        }
        // icons and labels
        for (int i = 0; i < n; i++) {
            Sector s = sectors.get(i);
            float lift = s.lift.get();
            double am = Math.toRadians(-90 + i * 360f / n + spinDeg);
            float rm = (r0 + r1) / 2f + lift * 6 * scale;
            float[] p = project((float) Math.cos(am) * rm, (float) Math.sin(am) * rm, -lift * 26 * scale);
            float k = p[2] * scale;
            int ic = ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, lift);
            s.icon.draw(g, p[0], p[1] - 7 * k, 7.5f * k, ic);
            float ts = 0.78f * k;
            Render2D.scaledText(g, s.name, p[0] - Render2D.textWidth(s.name) * ts / 2f, p[1] + 5 * k, ts, ic, false);
            String key = String.valueOf(i + 1);
            float ks = 0.55f * k;
            Render2D.scaledText(g, key, p[0] - Render2D.textWidth(key) * ks / 2f, p[1] + 15 * k, ks, ColorUtil.withAlpha(Theme.TEXT_MUTED, 200), false);
        }
        // centre disc
        float[] c = project(0, 0, -6);
        float cr = r0 * 0.86f * c[2];
        boolean centreHover = openCategory == null && dist < r0 * 0.55f;
        Render2D.circle(g, c[0], c[1], cr + 4, ColorUtil.withAlpha(Theme.accent(), centreHover ? 120 : 60));
        Render2D.radial(g, c[0], c[1], cr, 0xF0281656, 0xF0100A20);
        Render2D.ring(g, c[0], c[1], cr, 1.2f, 0, 360, ColorUtil.withAlpha(Theme.accent2(), 160));
        String title, sub;
        if (hover >= 0) { title = sectors.get(hover).name; sub = sectors.get(hover).sub; }
        else if (centreHover) { title = "Pełna lista"; sub = "Wszystkie moduły i ustawienia"; }
        else { title = "NORE"; sub = NoreClient.get().modules().getModules().size() + " modułów"; }
        Render2D.logo(g, c[0] - 9, c[1] - 26, 18, 1f);
        float ts = 1.05f;
        Render2D.scaledText(g, title, c[0] - Render2D.textWidth(title) * ts / 2f, c[1] - 3, ts, 0xFFFFFFFF, false);
        float ss = 0.62f;
        String subTrim = Render2D.trim(sub, (int) (cr * 1.8f / ss));
        Render2D.scaledText(g, subTrim, c[0] - Render2D.textWidth(subTrim) * ss / 2f, c[1] + 10, ss, Theme.TEXT_DIM, false);
        if (hover >= 0 && sectors.get(hover).category != null) {
            String cnt = countOn(sectors.get(hover).category);
            Render2D.scaledText(g, cnt, c[0] - Render2D.textWidth(cnt) * ss / 2f, c[1] + 19, ss, Theme.accent2(), false);
        }
    }

    private static String countOn(Category c) {
        int on = 0, all = 0;
        for (Module m : NoreClient.get().modules().getModules(c)) { all++; if (m.isEnabled()) on++; }
        return on + " / " + all + " włączone";
    }

    /** Ring segment face from angle a0 to a1 (degrees), radii r0..r1, at depth z, with a radial gradient. */
    private void wedge(Gfx g, float a0, float a1, float r0, float r1, float z, int inner, int outer, float lift) {
        int steps = 14;
        float[] xy = new float[(steps + 1) * 4];
        int[] col = new int[(steps + 1) * 2];
        for (int k = 0; k <= steps; k++) {
            double a = Math.toRadians(a0 + (a1 - a0) * k / steps);
            float[] pi = project((float) Math.cos(a) * r0, (float) Math.sin(a) * r0, z);
            float[] po = project((float) Math.cos(a) * r1, (float) Math.sin(a) * r1, z);
            xy[k * 4] = pi[0]; xy[k * 4 + 1] = pi[1]; xy[k * 4 + 2] = po[0]; xy[k * 4 + 3] = po[1];
            col[k * 2] = inner; col[k * 2 + 1] = outer;
        }
        g.mesh(Gfx.TRIANGLE_STRIP, xy, col, (steps + 1) * 2);
        // bright edge on the outer arc
        int edge = ColorUtil.lerp(0x50C7B2FF, 0xFFFFFFFF, lift);
        float[] prev = null;
        for (int k = 0; k <= steps; k++) {
            double a = Math.toRadians(a0 + (a1 - a0) * k / steps);
            float[] p = project((float) Math.cos(a) * r1, (float) Math.sin(a) * r1, z);
            if (prev != null) Render2D.line(g, prev[0], prev[1], p[0], p[1], 1f + lift, edge);
            prev = p;
        }
    }

    /** The outer side wall of an extruded segment, from depth z0 (front) to z1 (back). */
    private void rim(Gfx g, float a0, float a1, float r, float z0, float z1, int color) {
        int steps = 14;
        float[] xy = new float[(steps + 1) * 4];
        int[] col = new int[(steps + 1) * 2];
        for (int k = 0; k <= steps; k++) {
            double a = Math.toRadians(a0 + (a1 - a0) * k / steps);
            float[] p0 = project((float) Math.cos(a) * r, (float) Math.sin(a) * r, z0);
            float[] p1 = project((float) Math.cos(a) * r, (float) Math.sin(a) * r, z1);
            xy[k * 4] = p0[0]; xy[k * 4 + 1] = p0[1]; xy[k * 4 + 2] = p1[0]; xy[k * 4 + 3] = p1[1];
            col[k * 2] = color; col[k * 2 + 1] = ColorUtil.withAlpha(0xFF05030A, 230);
        }
        g.mesh(Gfx.TRIANGLE_STRIP, xy, col, (steps + 1) * 2);
    }

    // ------------------------------------------------------------------ carousel

    private void openSector(int i) {
        Sector s = sectors.get(i);
        Sounds.click();
        if (s.open != null) { s.open.run(); return; }
        openCategory = s;
        mods = new ArrayList<Module>(NoreClient.get().modules().getModules(s.category));
        carousel = 0;
        carouselTarget = 0;
        ringIn.target(0);
        carouselIn.set(0);
        carouselIn.target(1);
    }

    private void closeCategory() {
        openCategory = null;
        ringIn.target(1);
        carouselIn.target(0);
    }

    private static final float STEP = 31;

    private void renderCarousel(Gfx g, int mx, int my, float car) {
        mouseDragged(mx);
        carousel += (carouselTarget - carousel) * 0.18f;
        float R = Math.min(width, height) * 0.62f;
        float cw = Math.min(150, width * 0.24f), ch = cw * 1.12f;
        String head = openCategory.name.toUpperCase();
        Render2D.gradientText(g, head, cx() - Render2D.textWidth(head) * 1.6f / 2f, 24 + (1 - car) * -20, 1.6f, Theme.accent2(), Theme.accent(), true);
        String sub = countOn(openCategory.category);
        Render2D.scaledText(g, sub, cx() - Render2D.textWidth(sub) * 0.7f / 2f, 44, 0.7f, Theme.TEXT_DIM, false);
        // order cards back to front
        List<float[]> order = new ArrayList<float[]>();
        for (int i = 0; i < mods.size(); i++) {
            float ang = (i - carousel) * STEP;
            if (Math.abs(ang) > 110) continue;
            double a = Math.toRadians(ang);
            float x = (float) Math.sin(a) * R, z = R - (float) Math.cos(a) * R + (1 - car) * 300;
            order.add(new float[]{i, x, z, ang});
        }
        order.sort((p, q) -> Float.compare(q[2], p[2]));
        carouselHover = -1;
        for (float[] o : order) {
            float k = FOCAL / (FOCAL + o[2]);
            float w = cw * k, h = ch * k;
            float x = cx() + o[1] * k - w / 2f, y = cy() - h / 2f + 8;
            if (Render2D.hovered(mx, my, x, y, w, h)) carouselHover = (int) o[0];
        }
        for (float[] o : order) {
            int i = (int) o[0];
            Module m = mods.get(i);
            float k = FOCAL / (FOCAL + o[2]);
            float w = cw * k, h = ch * k;
            float x = cx() + o[1] * k - w / 2f, y = cy() - h / 2f + 8;
            float front = 1 - Math.min(1, Math.abs(o[3]) / 70f);
            boolean hov = i == carouselHover;
            int a = (int) (255 * (0.35f + 0.65f * front));
            Render2D.shadow(g, x, y, w, h, 10 * k, (int) (10 * k), ColorUtil.withAlpha(hov ? Theme.accent() : 0xFF000000, hov ? 120 : 90));
            Render2D.roundedGradient(g, x, y, w, h, 10 * k, ColorUtil.lerp(0xFF120B24, 0xFF241848, 0.4f + 0.6f * front), 0xFF0E091C, true);
            Render2D.roundedOutline(g, x, y, w, h, 10 * k, 1, m.isEnabled() ? ColorUtil.withAlpha(Theme.accent(), Math.min(255, a)) : ColorUtil.withAlpha(0xFFC7B2FF, (int) (60 * (0.4f + front))));
            if (m.isEnabled()) Render2D.radial(g, x + w / 2f, y + h * 0.3f, w * 0.55f, ColorUtil.withAlpha(Theme.accent(), (int) (70 * front)), ColorUtil.withAlpha(Theme.accent(), 0));
            Icons.category(g, m.getCategory(), x + w / 2f, y + h * 0.27f, 10 * k, ColorUtil.withAlpha(m.isEnabled() ? 0xFFFFFFFF : Theme.TEXT_DIM, a));
            float ts = 0.95f * k;
            String name = Render2D.trim(m.getName(), (int) ((w - 10 * k) / ts));
            Render2D.scaledText(g, name, x + w / 2f - Render2D.textWidth(name) * ts / 2f, y + h * 0.48f, ts, ColorUtil.withAlpha(Theme.TEXT, a), false);
            float ds = 0.6f * k;
            List<String> lines = wrap(m.getDescription(), (int) ((w - 14 * k) / ds));
            for (int l = 0; l < Math.min(3, lines.size()); l++) {
                String s = lines.get(l);
                Render2D.scaledText(g, s, x + w / 2f - Render2D.textWidth(s) * ds / 2f, y + h * 0.6f + l * 8.5f * k, ds, ColorUtil.withAlpha(Theme.TEXT_DIM, a), false);
            }
            // toggle pill
            float pw = 30 * k, ph = 13 * k, px = x + w / 2f - pw / 2f, py = y + h - ph - 9 * k;
            boolean on = m.isEnabled();
            Render2D.roundedRect(g, px, py, pw, ph, ph / 2f, on ? ColorUtil.withAlpha(Theme.accent(), a) : ColorUtil.withAlpha(0xFF3A3050, a));
            Render2D.circle(g, on ? px + pw - ph / 2f : px + ph / 2f, py + ph / 2f, ph / 2f - 2 * k, ColorUtil.withAlpha(0xFFFFFFFF, a));
        }
        if (mods.isEmpty()) Render2D.centeredText(g, "Brak modułów w tej kategorii", cx(), cy(), Theme.TEXT_MUTED, false);
    }

    private static List<String> wrap(String text, int max) {
        List<String> out = new ArrayList<String>();
        StringBuilder line = new StringBuilder();
        for (String word : String.valueOf(text).split(" ")) {
            String tryLine = line.length() == 0 ? word : line + " " + word;
            if (Render2D.textWidth(tryLine) > max && line.length() > 0) { out.add(line.toString()); line = new StringBuilder(word); }
            else line = new StringBuilder(tryLine);
        }
        if (line.length() > 0) out.add(line.toString());
        return out;
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (openCategory != null) {
            dragX = mx; dragFrom = carouselTarget; dragged = false;
            if (carouselHover >= 0) {
                Module m = mods.get(carouselHover);
                if (Math.abs(carouselHover - carouselTarget) > 0.5f && button == 0) { carouselTarget = carouselHover; Sounds.click(); return true; }
                if (button == 1) { Sounds.click(); game().openScreen(ClickGuiScreen.forModule(this, m)); return true; }
                return true; // toggled on release so a drag does not toggle
            }
            return true;
        }
        if (button != 0) return true;
        float dist = (float) Math.hypot(mx - cx(), my - cy());
        if (dist < radius() * 0.42f * 0.55f) { Sounds.click(); game().openScreen(new ClickGuiScreen(this)); return true; }
        if (hover >= 0) openSector(hover);
        return true;
    }

    @Override
    public boolean mouseReleased(double mx, double my, int button) {
        if (openCategory != null && button == 0 && !dragged && carouselHover >= 0 && Math.abs(carouselHover - carouselTarget) <= 0.5f) {
            Module m = mods.get(carouselHover);
            if (m.isToggleable()) { m.toggle(); Sounds.toggle(m.isEnabled()); NoreClient.get().config().save(); }
            else game().openScreen(ClickGuiScreen.forModule(this, m));
        }
        if (openCategory != null && dragged) carouselTarget = Math.max(0, Math.min(mods.size() - 1, Math.round(carouselTarget)));
        dragX = Double.NaN;
        return true;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        if (openCategory != null && !mods.isEmpty()) {
            carouselTarget = Math.max(0, Math.min(mods.size() - 1, carouselTarget - (float) Math.signum(amount)));
            return true;
        }
        spin.target(spin.getTarget() + (float) Math.signum(amount) * 45f / 2f);
        return true;
    }

    /** Turns the carousel while the mouse button is held (read every frame from the cursor position). */
    private void mouseDragged(double mx) {
        if (openCategory == null || Double.isNaN(dragX)) return;
        float d = (float) (mx - dragX);
        if (Math.abs(d) > 4) dragged = true;
        if (dragged) carouselTarget = Math.max(-0.4f, Math.min(mods.size() - 0.6f, dragFrom - d / 60f));
    }

    @Override
    public boolean keyPressed(int key, int modifiers) {
        if (key == Keys.ESCAPE && openCategory != null) { closeCategory(); return true; }
        if (openCategory == null && key >= 49 && key < 49 + sectors.size()) { openSector(key - 49); return true; }
        if (openCategory != null && (key == Keys.LEFT || key == Keys.A)) { carouselTarget = Math.max(0, carouselTarget - 1); return true; }
        if (openCategory != null && (key == Keys.RIGHT || key == Keys.D)) { carouselTarget = Math.min(mods.size() - 1, carouselTarget + 1); return true; }
        if (openCategory != null && (key == Keys.ENTER || key == Keys.SPACE) && !mods.isEmpty()) {
            Module m = mods.get(Math.round(carouselTarget));
            if (m.isToggleable()) { m.toggle(); Sounds.toggle(m.isEnabled()); NoreClient.get().config().save(); }
            return true;
        }
        return super.keyPressed(key, modifiers);
    }
}
