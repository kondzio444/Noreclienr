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
import java.util.Locale;

/**
 * The Nore menu (Right Shift): a two-ring orbit.
 * <ul>
 *   <li>Inner ring – eight sectors: the module categories plus quick actions (wardrobe, scene,
 *   HUD editor).</li>
 *   <li>Outer ring – the modules of the pointed category unfold around it as tiles: click
 *   toggles, right click opens the settings, Shift + click marks a favourite. Long categories
 *   page with the mouse wheel.</li>
 *   <li>Hub – a live readout of whatever the cursor points at; clicking it opens the full list.</li>
 *   <li>Typing searches every module; the results fill the outer ring.</li>
 * </ul>
 * The whole orbit leans a few degrees towards the cursor (perspective, no extruded walls) and
 * every part animates in with a stagger.
 */
public class RadialMenuScreen extends NoreScreen {
    private interface Icon { void draw(Gfx g, float cx, float cy, float s, int color); }

    private static final class Sector {
        final String name, sub;
        final Category category;
        final Icon icon;
        final Runnable action;
        final Animation lift = new Animation(0, 16);

        Sector(String name, String sub, Category category, Icon icon, Runnable action) {
            this.name = name; this.sub = sub; this.category = category; this.icon = icon; this.action = action;
        }
    }

    private static final float FOCAL = 760;
    private static final int PAGE = 12;

    private final List<Sector> sectors = new ArrayList<Sector>();
    private final long opened = System.currentTimeMillis();
    private final Animation tiltX = new Animation(0, 6), tiltY = new Animation(0, 6);
    private final Animation pointer = new Animation(-90, 18), pointerAlpha = new Animation(0, 10);
    private final Animation outerIn = new Animation(0, 9), hubPulse = new Animation(0, 8);
    private final List<Animation> tileLift = new ArrayList<Animation>();

    private int hoverSector = -1, hoverTile = -1, focusTile = -1;
    private int activeSector = -1;
    private boolean hubHover;
    private int page;
    private String query = "";
    private List<Module> mods = new ArrayList<Module>();
    private float runCenter = -90;

    public RadialMenuScreen(Object parent) {
        super(parent);
        final RadialMenuScreen self = this;
        sectors.add(new Sector("HUD", "Nakładki na ekranie", Category.HUD, Icons::hud, null));
        sectors.add(new Sector("Render", "Wygląd, niebo i kamera", Category.RENDER, Icons::eye, null));
        sectors.add(new Sector("Gracz", "Ruch i gracz", Category.PLAYER, Icons::person, null));
        sectors.add(new Sector("Narzędzia", "Czat, alerty, zrzuty", Category.UTILITY, Icons::wrench, null));
        sectors.add(new Sector("Szatnia", "Peleryny, skrzydła, czapki", null, Icons::bag, () -> game().openScreen(new CosmeticsScreen(self))));
        sectors.add(new Sector("Scena", "Tło menu i pora dnia", null, Icons::globe, () -> game().openScreen(new SceneEditorScreen(self))));
        sectors.add(new Sector("Edytor HUD", "Układaj elementy HUD", null, Icons::grid, () -> game().openScreen(new HudEditorScreen(self))));
        sectors.add(new Sector("Klient", "Motyw i ustawienia", Category.CLIENT, Icons::gear, null));
    }

    @Override
    public Background background() { return game().inWorld() ? Background.DIM_WORLD : Background.NONE; }

    // ------------------------------------------------------------------ geometry

    private float size() { return Math.min(width, height); }
    private float cx() { return width / 2f; }
    private float cy() { return height / 2f + 4; }
    private float hubR() { return size() * 0.14f; }
    private float in0() { return size() * 0.163f; }
    private float in1() { return size() * 0.268f; }
    private float out0() { return size() * 0.287f; }
    private float out1() { return size() * 0.43f; }

    private float sectorAngle(int i) { return -90 + i * 360f / sectors.size(); }

    /** Projects a point of the orbit plane (x right, y down, z away from the viewer). */
    private float[] project(float x, float y, float z) {
        double ax = Math.toRadians(tiltX.get()), ay = Math.toRadians(tiltY.get());
        float y1 = (float) (y * Math.cos(ax) - z * Math.sin(ax));
        float z1 = (float) (y * Math.sin(ax) + z * Math.cos(ax));
        float x2 = (float) (x * Math.cos(ay) + z1 * Math.sin(ay));
        float z2 = (float) (-x * Math.sin(ay) + z1 * Math.cos(ay));
        float k = FOCAL / (FOCAL + z2);
        return new float[]{cx() + x2 * k, cy() + y1 * k, k};
    }

    private float[] polar(float deg, float r, float z) {
        double a = Math.toRadians(deg);
        return project((float) Math.cos(a) * r, (float) Math.sin(a) * r, z);
    }

    private static float wrapDeg(float a) {
        a %= 360;
        if (a < -180) a += 360;
        if (a >= 180) a -= 360;
        return a;
    }

    private float elapsed() { return (System.currentTimeMillis() - opened) / 1000f; }

    // ------------------------------------------------------------------ content

    private Sector active() { return activeSector >= 0 ? sectors.get(activeSector) : null; }

    private boolean searching() { return !query.isEmpty(); }

    private void rebuild() {
        List<Module> list = new ArrayList<Module>();
        if (searching()) {
            String q = query.toLowerCase(Locale.ROOT);
            for (Module m : NoreClient.get().modules().getModules()) {
                if (m.getName().toLowerCase(Locale.ROOT).contains(q) || String.valueOf(m.getDescription()).toLowerCase(Locale.ROOT).contains(q)) list.add(m);
            }
            runCenter = -90;
        } else if (active() != null && active().category != null) {
            list.addAll(NoreClient.get().modules().getModules(active().category));
            runCenter = sectorAngle(activeSector);
        }
        mods = list;
        page = Math.max(0, Math.min(page, pages() - 1));
        focusTile = -1;
        outerIn.set(0);
        outerIn.target(1);
    }

    private int pages() { return Math.max(1, (mods.size() + PAGE - 1) / PAGE); }

    private List<Module> pageMods() {
        int from = page * PAGE;
        return mods.subList(Math.min(from, mods.size()), Math.min(from + PAGE, mods.size()));
    }

    /** Angular width of one tile and the start angle of the run for the current page. */
    private float[] run(int count) {
        float step = Math.min(30f, 360f / Math.max(1, count));
        if (count >= PAGE) step = 360f / count;
        float start = runCenter - step * count / 2f;
        return new float[]{start, step};
    }

    private void selectSector(int i) {
        if (i == activeSector && !searching()) return;
        Sector s = sectors.get(i);
        if (s.category == null) return;
        activeSector = i;
        page = 0;
        query = "";
        rebuild();
        Sounds.click();
    }

    private static int countOn(List<Module> list) {
        int on = 0;
        for (Module m : list) if (m.isEnabled()) on++;
        return on;
    }

    // ------------------------------------------------------------------ render

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        float t = elapsed();
        float fade = Animation.easeOutCubic(t / 0.35f);
        float nx = (mx - cx()) / (width / 2f), ny = (my - cy()) / (height / 2f);
        tiltY.target(nx * 7).update();
        tiltX.target(-ny * 5).update();
        outerIn.update();
        hubPulse.update();

        float dx = mx - cx(), dy = my - cy();
        float dist = (float) Math.hypot(dx, dy);
        float ang = (float) Math.toDegrees(Math.atan2(dy, dx));
        hubHover = dist < hubR();
        hoverSector = -1;
        hoverTile = -1;
        int n = sectors.size();
        if (dist >= in0() * 0.92f && dist < in1() + 4) {
            hoverSector = Math.floorMod(Math.round(wrapDeg(ang + 90) / (360f / n)), n);
            Sector s = sectors.get(hoverSector);
            if (s.category != null && t > 0.25f && !searching()) selectSector(hoverSector);
        }
        List<Module> shown = pageMods();
        if (!shown.isEmpty() && dist >= out0() - 2 && dist < out1() + 10 && outerIn.get() > 0.5f) {
            float[] run = run(shown.size());
            float rel = wrapDeg(ang - run[0]);
            if (rel < 0) rel += 360;
            int idx = (int) (rel / run[1]);
            if (idx >= 0 && idx < shown.size()) hoverTile = idx;
        }
        while (tileLift.size() < PAGE) tileLift.add(new Animation(0, 18));

        // cursor pointer sweeps around the inner ring
        if (dist > hubR()) {
            float cur = pointer.get();
            pointer.target(cur + wrapDeg(ang - cur));
        }
        pointer.update();
        pointerAlpha.target(dist > hubR() && dist < out1() + 30 ? 1 : 0).update();

        // backdrop
        Render2D.radial(g, cx(), cy(), Math.max(width, height) * 0.8f, ColorUtil.withAlpha(0xFF241047, (int) (170 * fade)), ColorUtil.withAlpha(0xFF0A090C, (int) (215 * fade)));
        Render2D.radial(g, cx(), cy(), out1() * 1.5f, ColorUtil.withAlpha(Theme.accent(), (int) (46 * fade)), 0x00000000);

        g.setAlpha(fade);
        orbitTrack(g, t);
        outerRing(g, t);
        innerRing(g, t);
        pointerArc(g);
        hub(g, t);
        g.setAlpha(1);

        footer(g, fade);
    }

    private void orbitTrack(Gfx g, float t) {
        // faint orbit with slowly travelling dashes outside the module ring
        float r = out1() + size() * 0.03f;
        int dashes = 36;
        float spin = t * 6;
        for (int i = 0; i < dashes; i++) {
            float a0 = spin + i * 360f / dashes;
            arc(g, a0, a0 + 3.2f, r, r + 1.2f, 4, ColorUtil.withAlpha(Theme.accent2(), 46), ColorUtil.withAlpha(Theme.accent2(), 46));
        }
        float[] p = polar(-90 + t * 40, r + 0.6f, 4);
        Render2D.circle(g, p[0], p[1], 1.8f * p[2], ColorUtil.withAlpha(Theme.accent2(), 200));
    }

    private void innerRing(Gfx g, float t) {
        int n = sectors.size();
        float span = 360f / n, gap = 2.6f;
        for (int i = 0; i < n; i++) {
            Sector s = sectors.get(i);
            float e = Animation.easeOutCubic((t - 0.04f * i) / 0.32f);
            if (e <= 0) continue;
            boolean act = i == activeSector && !searching();
            float lift = s.lift.target(i == hoverSector ? 1 : act ? 0.55f : 0).update();
            float mid = sectorAngle(i);
            float half = (span - gap) / 2f * e;
            float r0 = in0(), r1 = in1() + lift * size() * 0.012f;
            float z = -lift * 12;
            int cIn = act ? ColorUtil.withAlpha(ColorUtil.lerp(Theme.accent(), 0xFF1E1B21, 0.35f), 240) : ColorUtil.lerp(0xE8141216, 0xF02A1A52, lift);
            int cOut = act ? ColorUtil.withAlpha(Theme.accent(), 250) : ColorUtil.lerp(0xE81E1B21, ColorUtil.withAlpha(Theme.accent(), 235), lift * 0.75f);
            arc(g, mid - half, mid + half, r0, r1, z, cIn, cOut);
            arc(g, mid - half, mid + half, r1 - 1.2f, r1, z, ColorUtil.withAlpha(0xFFE9DEFF, (int) (70 + 150 * lift)), ColorUtil.withAlpha(0xFFE9DEFF, (int) (70 + 150 * lift)));
            // icon + name
            float[] p = polar(mid, (r0 + r1) / 2f, z);
            float k = p[2] * (0.9f + 0.1f * e);
            int col = ColorUtil.withAlpha(ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, Math.max(lift, act ? 1 : 0)), (int) (255 * e));
            s.icon.draw(g, p[0], p[1] - 6 * k, 6.5f * k, col);
            float ts = 0.68f * k;
            String name = Render2D.trim(s.name, (int) ((r1 - r0) * 1.9f / ts));
            Render2D.scaledText(g, name, p[0] - Render2D.textWidth(name) * ts / 2f, p[1] + 4 * k, ts, col, false);
        }
    }

    private void outerRing(Gfx g, float t) {
        List<Module> shown = pageMods();
        float oe = outerIn.get();
        if (shown.isEmpty()) {
            if (searching() && oe > 0.1f) {
                String s = "Brak wyników dla „" + query + "”";
                float[] p = polar(-90, (out0() + out1()) / 2f, 0);
                Render2D.scaledText(g, s, p[0] - Render2D.textWidth(s) * 0.7f / 2f, p[1] - 3, 0.7f, ColorUtil.withAlpha(Theme.TEXT_MUTED, (int) (255 * oe)), false);
            }
            return;
        }
        float[] run = run(shown.size());
        float gap = Math.min(1.8f, run[1] * 0.12f);
        for (int j = 0; j < shown.size(); j++) {
            Module m = shown.get(j);
            // unfold from the middle of the run
            float order = Math.abs(j - (shown.size() - 1) / 2f) / Math.max(1, shown.size() / 2f);
            float e = Animation.easeOutCubic(Math.max(0, Math.min(1, (oe - order * 0.35f) / 0.65f)));
            if (e <= 0.01f) continue;
            boolean hov = j == hoverTile || j == focusTile;
            float lift = tileLift.get(j).target(hov ? 1 : 0).update();
            float a0 = run[0] + j * run[1] + gap / 2f, a1 = run[0] + (j + 1) * run[1] - gap / 2f;
            float mid = (a0 + a1) / 2f, half = (a1 - a0) / 2f * e;
            float r0 = out0() + (1 - e) * 10, r1 = out1() + lift * size() * 0.014f;
            float z = -lift * 10;
            boolean on = m.isEnabled(), ok = m.isSupported();
            int cIn, cOut;
            if (on) { cIn = ColorUtil.withAlpha(ColorUtil.lerp(Theme.accent(), 0xFF140A2C, 0.45f), 235); cOut = ColorUtil.withAlpha(ColorUtil.lerp(Theme.accent(), Theme.accent2(), lift * 0.5f), 245); }
            else { cIn = ColorUtil.lerp(0xE2120B22, 0xEE221640, lift); cOut = ColorUtil.lerp(0xE21A1230, 0xF2342452, lift); }
            if (!ok) { cIn = ColorUtil.fade(cIn, 0.55f); cOut = ColorUtil.fade(cOut, 0.55f); }
            arc(g, mid - half, mid + half, r0, r1, z, cIn, cOut);
            int edge = on ? ColorUtil.withAlpha(0xFFFFFFFF, (int) (120 + 120 * lift)) : ColorUtil.withAlpha(0xFFC7B2FF, (int) (40 + 140 * lift));
            arc(g, mid - half, mid + half, r1 - 1.1f, r1, z, edge, edge);
            // state dot near the outer edge
            float[] d = polar(mid, r1 - 4.5f, z);
            Render2D.circle(g, d[0], d[1], 1.7f * d[2], on ? 0xFFFFFFFF : ColorUtil.withAlpha(Theme.TEXT_MUTED, 200));
            if (m.isFavorite()) Icons.star(g, polar(mid + half - 4, r1 - 5, z)[0], polar(mid + half - 4, r1 - 5, z)[1], 2.4f, 0xFFFFD166, true);
            // label (one or two lines, fitted to the tile)
            float[] p = polar(mid, (r0 + r1) / 2f - 1, z);
            float arcLen = (float) Math.toRadians(a1 - a0) * (r0 + r1) / 2f;
            float ts = 0.62f * p[2] * (1 + lift * 0.06f);
            int maxW = (int) (arcLen * 0.9f / ts);
            List<String> lines = wrap(m.getName(), maxW);
            if (lines.size() > 2) { lines = lines.subList(0, 2); lines.set(1, Render2D.trim(lines.get(1) + "…", maxW)); }
            int tc = ColorUtil.withAlpha(on ? 0xFFFFFFFF : ColorUtil.lerp(Theme.TEXT_DIM, 0xFFFFFFFF, lift), (int) (255 * e));
            float lh = 9.5f * ts;
            float y0 = p[1] - lines.size() * lh / 2f;
            for (int l = 0; l < lines.size(); l++) {
                String s = Render2D.trim(lines.get(l), maxW);
                Render2D.scaledText(g, s, p[0] - Render2D.textWidth(s) * ts / 2f, y0 + l * lh, ts, tc, false);
            }
        }
        // page indicator
        if (pages() > 1) {
            float[] p = polar(runCenter + 180, out1() + size() * 0.07f, 0);
            for (int i = 0; i < pages(); i++) {
                float x = p[0] + (i - (pages() - 1) / 2f) * 7;
                Render2D.circle(g, x, p[1], i == page ? 2.4f : 1.6f, i == page ? Theme.accent2() : ColorUtil.withAlpha(Theme.TEXT_MUTED, 180));
            }
        }
    }

    private void pointerArc(Gfx g) {
        float a = pointerAlpha.get();
        if (a < 0.02f) return;
        float c = pointer.get();
        float r = in0() - 3;
        arc(g, c - 14, c + 14, r - 1.6f, r, -2, ColorUtil.withAlpha(Theme.accent2(), (int) (90 * a)), ColorUtil.withAlpha(Theme.accent2(), (int) (230 * a)));
    }

    private void hub(Gfx g, float t) {
        float e = Animation.easeOutBack(t / 0.42f);
        float[] c = project(0, 0, -4);
        float r = hubR() * Math.max(0.01f, e) * c[2] * (hubHover ? 1.04f : 1f);
        Render2D.circle(g, c[0], c[1], r + 3, ColorUtil.withAlpha(Theme.accent(), hubHover ? 110 : 55));
        Render2D.radial(g, c[0], c[1], r, 0xF628242C, 0xF60C0B0E);
        Render2D.ring(g, c[0], c[1], r, 1.1f, 0, 360, ColorUtil.withAlpha(Theme.accent2(), 150));
        if (e < 0.6f) return;
        float w = r * 1.75f;

        Module m = null;
        List<Module> shown = pageMods();
        if (hoverTile >= 0 && hoverTile < shown.size()) m = shown.get(hoverTile);
        else if (focusTile >= 0 && focusTile < shown.size()) m = shown.get(focusTile);

        if (m != null) {
            String cat = m.getCategory().displayName.toUpperCase(Locale.ROOT);
            Render2D.scaledText(g, cat, c[0] - Render2D.textWidth(cat) * 0.5f / 2f, c[1] - r * 0.62f, 0.5f, Theme.accent2(), false);
            float ts = 0.9f;
            String name = Render2D.trim(m.getName(), (int) (w / ts));
            Render2D.scaledText(g, name, c[0] - Render2D.textWidth(name) * ts / 2f, c[1] - r * 0.44f, ts, 0xFFFFFFFF, false);
            float ds = 0.55f;
            List<String> lines = wrap(m.getDescription(), (int) (w * 0.95f / ds));
            for (int l = 0; l < Math.min(3, lines.size()); l++) {
                String s = lines.get(l);
                Render2D.scaledText(g, s, c[0] - Render2D.textWidth(s) * ds / 2f, c[1] - r * 0.12f + l * 6.4f, ds, Theme.TEXT_DIM, false);
            }
            String state = !m.isSupported() ? "Niedostępny w tej wersji" : m.isEnabled() ? "● Włączony" : "○ Wyłączony";
            int sc = !m.isSupported() ? Theme.WARNING : m.isEnabled() ? Theme.SUCCESS : Theme.TEXT_MUTED;
            Render2D.scaledText(g, state, c[0] - Render2D.textWidth(state) * 0.58f / 2f, c[1] + r * 0.5f, 0.58f, sc, false);
            return;
        }
        String title, sub, extra = null;
        if (hubHover) { title = "Pełna lista"; sub = "Wszystkie moduły i ustawienia"; }
        else if (searching()) { title = "„" + query + "”"; sub = mods.size() + " wyników"; }
        else if (hoverSector >= 0) {
            Sector s = sectors.get(hoverSector);
            title = s.name; sub = s.sub;
            if (s.category != null) extra = countOn(NoreClient.get().modules().getModules(s.category)) + " / " + NoreClient.get().modules().getModules(s.category).size() + " włączone";
            else extra = "Kliknij, aby otworzyć";
        } else if (active() != null) {
            title = active().name; sub = active().sub;
            extra = countOn(mods) + " / " + mods.size() + " włączone";
        } else {
            title = "NORE"; sub = NoreClient.get().modules().getModules().size() + " modułów";
        }
        Render2D.logo(g, c[0] - 8, c[1] - r * 0.62f, 16, 1f);
        float ts = 1.0f;
        String tt = Render2D.trim(title, (int) (w / ts));
        Render2D.scaledText(g, tt, c[0] - Render2D.textWidth(tt) * ts / 2f, c[1] - 1, ts, 0xFFFFFFFF, false);
        float ss = 0.56f;
        String st = Render2D.trim(sub, (int) (w / ss));
        Render2D.scaledText(g, st, c[0] - Render2D.textWidth(st) * ss / 2f, c[1] + 11, ss, Theme.TEXT_DIM, false);
        if (extra != null) Render2D.scaledText(g, extra, c[0] - Render2D.textWidth(extra) * ss / 2f, c[1] + 19, ss, Theme.accent2(), false);
    }

    private void footer(Gfx g, float fade) {
        String hint;
        if (searching()) hint = "Szukanie: pisz dalej  •  Backspace – popraw  •  Esc – wyczyść";
        else if (active() != null) hint = "LPM – włącz / wyłącz  •  PPM – ustawienia  •  Shift + LPM – ulubiony  •  kółko – strony  •  pisz, aby szukać";
        else hint = "Najedź na kategorię  •  1–8 skróty  •  środek – pełna lista  •  pisz, aby szukać";
        float hs = 0.62f;
        Render2D.scaledText(g, hint, cx() - Render2D.textWidth(hint) * hs / 2f, height - 14, hs, ColorUtil.withAlpha(Theme.TEXT_MUTED, (int) (255 * fade)), false);
        if (searching()) {
            String q = "Szukaj: " + query + ((System.currentTimeMillis() / 500) % 2 == 0 ? "_" : " ");
            float qs = 0.9f;
            Render2D.scaledText(g, q, cx() - Render2D.textWidth(q) * qs / 2f, 14, qs, Theme.accent2(), false);
        }
    }

    /** Ring segment from angle a0 to a1 (degrees), radii r0..r1 at depth z, inner→outer colour. */
    private void arc(Gfx g, float a0, float a1, float r0, float r1, float z, int inner, int outer) {
        if (a1 <= a0) return;
        int steps = Math.max(2, (int) ((a1 - a0) / 3.5f));
        float[] xy = new float[(steps + 1) * 4];
        int[] col = new int[(steps + 1) * 2];
        for (int k = 0; k <= steps; k++) {
            float a = a0 + (a1 - a0) * k / steps;
            float[] pi = polar(a, r0, z), po = polar(a, r1, z);
            xy[k * 4] = pi[0]; xy[k * 4 + 1] = pi[1]; xy[k * 4 + 2] = po[0]; xy[k * 4 + 3] = po[1];
            col[k * 2] = inner; col[k * 2 + 1] = outer;
        }
        g.mesh(Gfx.TRIANGLE_STRIP, xy, col, (steps + 1) * 2);
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

    private void activate(Module m, int button, boolean shift) {
        if (button == 1) { Sounds.click(); game().openScreen(ClickGuiScreen.forModule(this, m)); return; }
        if (shift) {
            m.setFavorite(!m.isFavorite());
            Sounds.click();
            NoreClient.get().config().save();
            return;
        }
        if (m.isToggleable()) {
            m.toggle();
            Sounds.toggle(m.isEnabled());
            NoreClient.get().config().save();
        } else {
            game().openScreen(ClickGuiScreen.forModule(this, m));
        }
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (hubHover && button == 0) { Sounds.click(); game().openScreen(new ClickGuiScreen(this)); return true; }
        List<Module> shown = pageMods();
        if (hoverTile >= 0 && hoverTile < shown.size()) { activate(shown.get(hoverTile), button, game().shiftDown()); return true; }
        if (hoverSector >= 0 && button == 0) {
            Sector s = sectors.get(hoverSector);
            Sounds.click();
            if (s.action != null) s.action.run();
            else selectSector(hoverSector);
            return true;
        }
        return true;
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double amount) {
        if (pages() > 1) {
            page = Math.floorMod(page - (int) Math.signum(amount), pages());
            focusTile = -1;
            outerIn.set(0.35f);
            outerIn.target(1);
            Sounds.click();
            return true;
        }
        // without pages the wheel walks through the categories
        int next = activeSector < 0 ? 0 : activeSector;
        for (int i = 0; i < sectors.size(); i++) {
            next = Math.floorMod(next - (int) Math.signum(amount), sectors.size());
            if (sectors.get(next).category != null) break;
        }
        selectSector(next);
        return true;
    }

    @Override
    public boolean keyPressed(int key, int modifiers) {
        if (key == Keys.ESCAPE) {
            if (searching()) { query = ""; rebuild(); return true; }
            return super.keyPressed(key, modifiers);
        }
        if (key == Keys.BACKSPACE && searching()) {
            query = query.substring(0, query.length() - 1);
            rebuild();
            return true;
        }
        if (!searching() && key >= Keys.N0 + 1 && key <= Keys.N0 + sectors.size()) {
            Sector s = sectors.get(key - Keys.N0 - 1);
            Sounds.click();
            if (s.action != null) s.action.run();
            else selectSector(key - Keys.N0 - 1);
            return true;
        }
        List<Module> shown = pageMods();
        if (!shown.isEmpty() && (key == Keys.RIGHT || key == Keys.DOWN)) { focusTile = (focusTile + 1) % shown.size(); Sounds.click(); return true; }
        if (!shown.isEmpty() && (key == Keys.LEFT || key == Keys.UP)) { focusTile = focusTile <= 0 ? shown.size() - 1 : focusTile - 1; Sounds.click(); return true; }
        if ((key == Keys.ENTER || key == Keys.KP_ENTER) && focusTile >= 0 && focusTile < shown.size()) {
            activate(shown.get(focusTile), 0, (modifiers & Keys.MOD_SHIFT) != 0);
            return true;
        }
        return super.keyPressed(key, modifiers);
    }

    @Override
    public boolean charTyped(char c) {
        if (Character.isDigit(c) && !searching()) return true; // 1–8 are shortcuts
        if (Character.isLetterOrDigit(c) || (c == ' ' && searching()) || c == '-') {
            if (query.length() < 24) {
                query += c;
                rebuild();
            }
            return true;
        }
        return false;
    }
}
