package dev.noreclient.cosmetic;

import dev.noreclient.api.Gfx;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * A tiny software renderer for the wardrobe grid: the item's real (animated) geometry, projected
 * orthographically and drawn back to front as flat-shaded coloured quads through {@link Gfx#mesh}.
 * Big textured quads are split into small cells coloured from the texture and cut out where it is
 * transparent, so silhouettes (wing membranes, feathers) read correctly. Works on every platform.
 */
public final class Mini3D {
    private static final int MAX_CELLS = 7000;

    private Mini3D() {}

    private static final class Cell implements Comparable<Cell> {
        final float[] xy = new float[8];
        int color;
        float depth;

        public int compareTo(Cell o) { return Float.compare(o.depth, depth); }
    }

    /**
     * Draws the item in the box (x, y, w, h), turned by yaw (degrees, 0 = seen from the front,
     * 180 = from behind) and tilted by pitch. Returns false while its texture is still being painted.
     */
    public static boolean item(Gfx g, Item item, Worn worn, float x, float y, float w, float h, float yaw, float pitch, float alpha) {
        Textures.Atlas atlas = Textures.peek(item, worn);
        if (atlas == null || atlas.small == null) return false;
        Item.Build b = Wardrobe.buildAlone(item, worn);
        float[] frame = item.previewFrame();
        float scale = Math.min(w, h) / frame[3];
        float ox = x + w / 2f, oy = y + h / 2f;
        double yr = Math.toRadians(yaw), pr = Math.toRadians(pitch);
        float cy = (float) Math.cos(yr), sy = (float) Math.sin(yr), cp = (float) Math.cos(pr), sp = (float) Math.sin(pr);
        boolean two = Textures.atlas(item);
        List<Cell> cells = new ArrayList<Cell>();
        List<Mesh.Quad> all = new ArrayList<Mesh.Quad>(b.head.quads);
        all.addAll(b.body.quads);
        int base = all.size();
        if (worn.glow) {
            all.addAll(b.glowHead.quads);
            all.addAll(b.glowBody.quads);
        }
        float lx = -0.35f, ly = -0.75f, lz = -0.55f;
        int qi = 0;
        for (Mesh.Quad q : all) {
            boolean glow = qi++ >= base;
            float[] px = new float[4], py = new float[4], pz = new float[4];
            for (int i = 0; i < 4; i++) {
                float mx = q.x[i] - frame[0], my = q.y[i] - frame[1], mz = q.z[i] - frame[2];
                float rx = cy * mx + sy * mz, rz = -sy * mx + cy * mz;
                float ry = cp * my - sp * rz, rz2 = sp * my + cp * rz;
                px[i] = ox + rx * scale;
                py[i] = oy + ry * scale;
                pz[i] = rz2;
            }
            float nx = cy * q.nx + sy * q.nz, nz0 = -sy * q.nx + cy * q.nz;
            float ny = cp * q.ny - sp * nz0, nz = sp * q.ny + cp * nz0;
            float shade = glow ? 1.25f : 0.5f + 0.55f * Math.abs(nx * lx + ny * ly + nz * lz);
            float du = Math.max(Math.abs(q.u[2] - q.u[0]), Math.abs(q.u[1] - q.u[3])) * atlas.sw;
            float dv = Math.max(Math.abs(q.v[2] - q.v[0]), Math.abs(q.v[1] - q.v[3])) * atlas.sh * (two ? 0.5f : 1f);
            float screen = Math.max(dist(px[0], py[0], px[2], py[2]), dist(px[1], py[1], px[3], py[3]));
            int n = (int) Math.ceil(Math.min(Math.max(du, dv) / 2.5f, screen / 2.2f));
            n = Math.max(1, Math.min(14, n));
            for (int i = 0; i < n; i++) {
                for (int j = 0; j < n; j++) {
                    if (cells.size() >= MAX_CELLS) break;
                    float s0 = i / (float) n, s1 = (i + 1) / (float) n, t0 = j / (float) n, t1 = (j + 1) / (float) n;
                    float sc = (s0 + s1) / 2, tc = (t0 + t1) / 2;
                    float u = bil(q.u, sc, tc), v = bil(q.v, sc, tc);
                    if (two) v = glow ? 0.5f + v * 0.5f : v * 0.5f;
                    int tex = sample(atlas, u, v);
                    int a = tex >>> 24;
                    if (glow ? (tex & 0xFFFFFF) == 0 || a < 20 : a < 110) continue;
                    int qc = q.color;
                    int r = clamp((int) (((tex >> 16) & 255) * shade * ((qc >> 16) & 255) / 255f));
                    int gg = clamp((int) (((tex >> 8) & 255) * shade * ((qc >> 8) & 255) / 255f));
                    int bb = clamp((int) ((tex & 255) * shade * (qc & 255) / 255f));
                    int ca = glow ? (int) (Math.max(r, Math.max(gg, bb)) * 0.8f * ((qc >>> 24) / 255f)) : 255;
                    Cell c = new Cell();
                    float[][] corners = {{s0, t0}, {s0, t1}, {s1, t1}, {s1, t0}};
                    float d = 0;
                    for (int k = 0; k < 4; k++) {
                        c.xy[k * 2] = bil(px, corners[k][0], corners[k][1]);
                        c.xy[k * 2 + 1] = bil(py, corners[k][0], corners[k][1]);
                        d += bil(pz, corners[k][0], corners[k][1]);
                    }
                    c.depth = d / 4 - (glow ? 0.05f : 0);
                    c.color = ColorUtil.withAlpha(r << 16 | gg << 8 | bb, (int) (ca * alpha));
                    cells.add(c);
                }
            }
        }
        if (cells.isEmpty()) return true;
        Cell[] sorted = cells.toArray(new Cell[0]);
        Arrays.sort(sorted);
        float[] xy = new float[sorted.length * 8];
        int[] col = new int[sorted.length * 4];
        for (int i = 0; i < sorted.length; i++) {
            System.arraycopy(sorted[i].xy, 0, xy, i * 8, 8);
            for (int k = 0; k < 4; k++) col[i * 4 + k] = sorted[i].color;
        }
        g.mesh(Gfx.QUADS, xy, col, sorted.length * 4);
        return true;
    }

    /** A small spinner while an item texture is being painted. */
    public static void loading(Gfx g, float cx, float cy, float r, int color) {
        float a = (System.currentTimeMillis() % 1000) / 1000f * 360;
        Render2D.ring(g, cx, cy, r, 1.4f, a, a + 250, color);
    }

    private static float dist(float x0, float y0, float x1, float y1) { return (float) Math.hypot(x1 - x0, y1 - y0); }

    /** Bilinear value inside a quad (corner order 0 (0,0), 1 (0,1), 2 (1,1), 3 (1,0)). */
    private static float bil(float[] c, float s, float t) {
        float a = c[0] + (c[3] - c[0]) * s, b = c[1] + (c[2] - c[1]) * s;
        return a + (b - a) * t;
    }

    private static int sample(Textures.Atlas a, float u, float v) {
        int x = (int) (u * a.sw), y = (int) (v * a.sh);
        x = Math.max(0, Math.min(a.sw - 1, x));
        y = Math.max(0, Math.min(a.sh - 1, y));
        return a.small[y * a.sw + x];
    }

    private static int clamp(int v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
}
