package dev.noreclient.module.utility;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Keys;
import dev.noreclient.module.Category;
import dev.noreclient.module.Hooks;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.setting.StringSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Theme;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Many waypoints per world and dimension, drawn as markers in the world (with distance) and on the
 * Compass bar. A waypoint is added with a key; a "Śmierć" waypoint appears where you died.
 */
public class Waypoints extends Module {
    public final KeybindSetting addKey = add(new KeybindSetting("Add Key", "Dodaje punkt w miejscu, w którym stoisz", Keys.N));
    public final KeybindSetting removeKey = add(new KeybindSetting("Remove Key", "Usuwa najbliższy punkt", Keys.UNKNOWN));
    public final BooleanSetting deathPoint = add(new BooleanSetting("Death Waypoint", "Punkt w miejscu śmierci", true));
    public final BooleanSetting clearDeath = add(new BooleanSetting("Clear Death On Arrival", "Usuń punkt śmierci, gdy do niego dojdziesz", true));
    public final BooleanSetting distance = add(new BooleanSetting("Show Distance", "Odległość pod nazwą punktu", true));
    public final BooleanSetting edgeArrows = add(new BooleanSetting("Edge Arrows", "Strzałki przy krawędzi ekranu dla punktów poza widokiem", true));
    public final BooleanSetting compass = add(new BooleanSetting("On Compass", "Znaczniki punktów na pasku kompasu", true));
    public final NumberSetting maxDistance = add(new NumberSetting("Max Distance", "Ukryj dalsze punkty (0 = bez limitu)", 0, 0, 10000, 100, " m"));
    public final NumberSetting markerScale = add(new NumberSetting("Marker Size", "Rozmiar znaczników", 1, 0.6, 2, 0.1, "x"));
    /** name|x|y|z|dimension|world|color|death ; ... (edited with the keys, not by hand). */
    public final StringSetting data = add(new StringSetting("Data", "Zapisane punkty", "", 16000));

    private static final int[] PALETTE = {0xFF5EC8FF, 0xFF34D399, 0xFFFFC447, 0xFFFF6B8B, 0xFFB57BFF, 0xFFFF8A1F};
    private static final int DEATH_COLOR = 0xFFFF4D5E;

    public static final class Point {
        public String name, dimension, world;
        public int x, y, z, color;
        public boolean death;

        double dx(double px) { return x + 0.5 - px; }
        double dz(double pz) { return z + 0.5 - pz; }
    }

    private final List<Point> points = new ArrayList<Point>();
    private String parsed;
    private boolean wasDead;

    public Waypoints() {
        super("Waypoints", "Wiele punktów nawigacyjnych w świecie, punkt śmierci i znaczniki na kompasie", Category.UTILITY);
        data.visibleWhen(() -> false);
        setEnabled(true);
    }

    // ------------------------------------------------------------------ storage

    private List<Point> all() {
        String d = data.get();
        if (!d.equals(parsed)) {
            parsed = d;
            points.clear();
            for (String e : d.split(";")) {
                String[] p = e.split("\\|", -1);
                if (p.length < 8) continue;
                try {
                    Point w = new Point();
                    w.name = p[0];
                    w.x = Integer.parseInt(p[1]);
                    w.y = Integer.parseInt(p[2]);
                    w.z = Integer.parseInt(p[3]);
                    w.dimension = p[4];
                    w.world = p[5];
                    w.color = (int) Long.parseLong(p[6], 16);
                    w.death = "1".equals(p[7]);
                    points.add(w);
                } catch (NumberFormatException ignored) {
                }
            }
        }
        return points;
    }

    private void save() {
        StringBuilder b = new StringBuilder();
        for (Point w : points) {
            if (b.length() > 0) b.append(';');
            b.append(w.name.replace('|', '/').replace(';', ',')).append('|').append(w.x).append('|').append(w.y).append('|').append(w.z)
                    .append('|').append(w.dimension).append('|').append(w.world).append('|').append(Integer.toHexString(w.color)).append('|').append(w.death ? 1 : 0);
        }
        data.set(b.toString());
        parsed = data.get();
    }

    /** Server address or singleplayer world folder, so every world keeps its own points. */
    private static String worldKey() {
        if (game().singleplayer()) {
            File d = game().datapackDir();
            return "sp:" + (d != null && d.getParentFile() != null ? d.getParentFile().getName() : "?").replace('|', '/').replace(';', ',');
        }
        String a = game().serverAddress();
        return "mp:" + (a == null ? "?" : a.toLowerCase(Locale.ROOT)).replace('|', '/').replace(';', ',');
    }

    /** Waypoints of the current world and dimension. */
    public List<Point> visiblePoints() {
        if (!inGame()) return Collections.emptyList();
        String w = worldKey(), dim = game().dimension();
        List<Point> out = new ArrayList<Point>();
        double max = maxDistance.get();
        for (Point p : all()) {
            if (!p.world.equals(w) || !p.dimension.equals(dim)) continue;
            if (max > 0) {
                double dx = p.dx(game().x()), dz = p.dz(game().z());
                if (dx * dx + dz * dz > max * max) continue;
            }
            out.add(p);
        }
        return out;
    }

    private Point create(String name, int color, boolean death) {
        Point p = new Point();
        p.name = name;
        p.x = (int) Math.floor(game().x());
        p.y = (int) Math.floor(game().y());
        p.z = (int) Math.floor(game().z());
        p.dimension = game().dimension();
        p.world = worldKey();
        p.color = color;
        p.death = death;
        return p;
    }

    // ------------------------------------------------------------------ input / tick

    @Override
    public void onKeyPressed(int key) {
        if (!inGame()) return;
        if (addKey.isBound() && key == addKey.get()) {
            all();
            int n = 1;
            for (Point p : points) if (!p.death) n++;
            Point p = create("Punkt " + n, PALETTE[(n - 1) % PALETTE.length], false);
            points.add(p);
            save();
            NotificationManager.push("Waypoints", "Dodano " + p.name + " (" + p.x + " " + p.y + " " + p.z + ")", NotificationManager.Type.SUCCESS);
        } else if (removeKey.isBound() && key == removeKey.get()) {
            Point nearest = null;
            double best = Double.MAX_VALUE;
            for (Point p : visiblePoints()) {
                double dx = p.dx(game().x()), dz = p.dz(game().z()), d = dx * dx + dz * dz;
                if (d < best) { best = d; nearest = p; }
            }
            if (nearest == null) {
                NotificationManager.push("Waypoints", "Brak punktów w tym świecie", NotificationManager.Type.INFO);
                return;
            }
            points.remove(nearest);
            save();
            NotificationManager.push("Waypoints", "Usunięto " + nearest.name, NotificationManager.Type.ERROR);
        }
    }

    @Override
    public void onTick() {
        if (!inGame()) { wasDead = false; return; }
        boolean dead = game().dead();
        if (dead && !wasDead && deathPoint.isOn()) {
            all();
            String w = worldKey();
            for (int i = points.size() - 1; i >= 0; i--) if (points.get(i).death && points.get(i).world.equals(w)) points.remove(i);
            Point p = create("Śmierć", DEATH_COLOR, true);
            points.add(p);
            save();
        }
        wasDead = dead;
        if (clearDeath.isOn() && !dead) {
            for (Point p : visiblePoints()) {
                if (!p.death) continue;
                double dx = p.dx(game().x()), dz = p.dz(game().z()), dy = p.y - game().y();
                if (dx * dx + dz * dz + dy * dy < 9) {
                    points.remove(p);
                    save();
                    NotificationManager.push("Waypoints", "Dotarłeś do miejsca śmierci", NotificationManager.Type.SUCCESS);
                    break;
                }
            }
        }
    }

    // ------------------------------------------------------------------ markers

    @Override
    public void onRenderOverlay(Gfx g, float tickDelta) {
        if (!inGame() || game().screenOpen() && !game().chatOpen()) return;
        List<Point> list = visiblePoints();
        if (list.isEmpty()) return;
        double[] cam = game().camera();
        if (cam == null) return;
        float w = g.width(), h = g.height();
        double yaw = Math.toRadians(cam[3]), pitch = Math.toRadians(cam[4]);
        // camera basis (Minecraft: yaw 0 looks to +Z, positive pitch looks down)
        double fx = -Math.sin(yaw) * Math.cos(pitch), fy = -Math.sin(pitch), fz = Math.cos(yaw) * Math.cos(pitch);
        double rx = -Math.cos(yaw), rz = -Math.sin(yaw);
        // up = right x forward
        double ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
        double focal = (h / 2.0) / Math.tan(Math.toRadians(Math.max(1, Hooks.fov)) / 2.0);
        float s = markerScale.floatValue();
        for (Point p : list) {
            double dx = p.x + 0.5 - cam[0], dy = p.y + 1.0 - cam[1], dz = p.z + 0.5 - cam[2];
            double dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            double depth = dx * fx + dy * fy + dz * fz;
            double sx = dx * rx + dz * rz, sy = dx * ux + dy * uy + dz * uz;
            float px, py;
            boolean onScreen = false;
            if (depth > 0.05) {
                px = (float) (w / 2 + sx / depth * focal);
                py = (float) (h / 2 - sy / depth * focal);
                onScreen = px > 8 && px < w - 8 && py > 8 && py < h - 8;
            } else {
                px = (float) (w / 2 + sx * 1000);
                py = (float) (h / 2 - sy * 1000);
            }
            if (onScreen) {
                drawMarker(g, p, px, py, dist, s);
            } else if (edgeArrows.isOn()) {
                // direction on screen from the camera-space offset (also valid behind the camera)
                double ax = Math.abs(sx) < 0.001 && Math.abs(sy) < 0.001 ? 0.001 : sx;
                double ang = Math.atan2(-sy, ax);
                float ex = (float) (w / 2 + Math.cos(ang) * (w / 2 - 22)), ey = (float) (h / 2 + Math.sin(ang) * (h / 2 - 22));
                drawArrow(g, p, ex, ey, (float) ang, dist, s);
            }
        }
    }

    private void drawMarker(Gfx g, Point p, float x, float y, double dist, float s) {
        // close to the crosshair the label is fully visible, further out it is a bit dimmer
        float cdx = x - g.width() / 2f, cdy = y - g.height() / 2f;
        float focus = (float) Math.max(0, 1 - Math.sqrt(cdx * cdx + cdy * cdy) / 160f);
        float alpha = 0.7f + 0.3f * focus;
        g.push();
        g.translate(x, y);
        g.scale(s, s);
        int c = p.color;
        // pin: soft glow, ring and a diamond
        Render2D.radial(g, 0, 0, 9, ColorUtil.withAlpha(c, (int) (70 * alpha)), 0);
        float r = 4.2f;
        Render2D.line(g, 0, -r, r, 0, 2.2f, ColorUtil.withAlpha(c, (int) (255 * alpha)));
        Render2D.line(g, r, 0, 0, r, 2.2f, ColorUtil.withAlpha(c, (int) (255 * alpha)));
        Render2D.line(g, 0, r, -r, 0, 2.2f, ColorUtil.withAlpha(c, (int) (255 * alpha)));
        Render2D.line(g, -r, 0, 0, -r, 2.2f, ColorUtil.withAlpha(c, (int) (255 * alpha)));
        Render2D.circle(g, 0, 0, 1.6f, ColorUtil.withAlpha(0xFFFFFFFF, (int) (255 * alpha)));
        String label = p.name;
        String sub = distance.isOn() ? formatDistance(dist) : null;
        int lw = Render2D.textWidth(label);
        float bw = Math.max(lw, sub == null ? 0 : Render2D.textWidth(sub) * 0.75f) + 8;
        float bh = sub == null ? 11 : 18;
        float by = -r - 5 - bh;
        Render2D.roundedRect(g, -bw / 2f, by, bw, bh, 3, ColorUtil.withAlpha(0xFF0E0A16, (int) (170 * alpha)));
        Render2D.roundedRect(g, -bw / 2f + 2, by + bh - 1.2f, bw - 4, 1.2f, 0.6f, ColorUtil.withAlpha(c, (int) (200 * alpha)));
        Render2D.text(g, label, -lw / 2f, by + 2, ColorUtil.withAlpha(0xFFFFFFFF, (int) (255 * alpha)), true);
        if (sub != null) {
            Render2D.scaledText(g, sub, -Render2D.textWidth(sub) * 0.375f, by + 10.5f, 0.75f, ColorUtil.withAlpha(Theme.TEXT_DIM, (int) (255 * alpha)), false);
        }
        g.pop();
    }

    private void drawArrow(Gfx g, Point p, float x, float y, float ang, double dist, float s) {
        g.push();
        g.translate(x, y);
        g.scale(s, s);
        float cos = (float) Math.cos(ang), sin = (float) Math.sin(ang);
        float tipX = cos * 7, tipY = sin * 7, bx = -cos * 3, by = -sin * 3, nx = -sin * 4.5f, ny = cos * 4.5f;
        int c = ColorUtil.withAlpha(p.color, 220);
        Render2D.line(g, tipX, tipY, bx + nx, by + ny, 2, c);
        Render2D.line(g, tipX, tipY, bx - nx, by - ny, 2, c);
        String t = p.name + (distance.isOn() ? " " + formatDistance(dist) : "");
        float tx = -cos * 12 - (cos > 0.3f ? Render2D.textWidth(t) * 0.75f : cos < -0.3f ? 0 : Render2D.textWidth(t) * 0.375f);
        float ty = -sin * 12 - 3;
        Render2D.scaledText(g, t, tx, ty, 0.75f, 0xE0FFFFFF, true);
        g.pop();
    }

    static String formatDistance(double d) {
        return d >= 1000 ? String.format(Locale.ROOT, "%.1f km", d / 1000) : (int) d + " m";
    }

    @Override
    public String getSuffix() {
        return String.valueOf(inGame() ? visiblePoints().size() : all().size());
    }
}
