package dev.noreclient.util;

import dev.noreclient.api.Gfx;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.List;

/**
 * The "Scena Nore" menu background: a small voxel island drawn in perspective with the 2D mesh API,
 * so it works the same on every Minecraft version. Time of day changes the sky, sun/moon, stars and
 * lighting; the chosen trees grow block by block with a springy canopy; the camera glides between
 * three shots and drifts slowly.
 */
public final class NoreScene {
    public static final String[] TREES = {"Dąb", "Brzoza", "Świerk", "Wiśnia"};
    public static final String[] CAMERAS = {"Ujęcie 1", "Ujęcie 2", "Ujęcie 3"};
    private static final float[][] CAMS = {{0.78f, 0.62f, 1f}, {2.3f, 0.42f, 1.32f}, {-0.9f, 0.95f, 0.86f}};
    private static final int N = 11;
    private static final int[][] HEIGHT = new int[N][N];
    private static final int[][] SPOTS = {{3, 4}, {6, 2}, {7, 7}, {3, 8}, {8, 4}};

    static {
        for (int x = 0; x < N; x++) {
            for (int z = 0; z < N; z++) {
                double d = Math.hypot(x - (N - 1) / 2.0, z - (N - 1) / 2.0);
                HEIGHT[x][z] = d > 5.2 ? -1 : (int) Math.max(0, Math.round(2.4 - d * 0.42 + Math.sin(x * 1.3) * 0.6 + Math.cos(z * 1.1) * 0.5));
            }
        }
    }

    // ---- state (shared by the editor and the menu background)
    private static String tree = TREES[0];
    private static long treeBorn = System.currentTimeMillis();
    private static int cam = 0;
    private static float[] camFrom = CAMS[0].clone(), camNow = CAMS[0].clone();
    private static long camStart;
    private static float extraYaw;

    private NoreScene() {}

    /** Plants new trees (they grow from the ground again). */
    public static void setTree(String t) {
        if (t.equals(tree)) return;
        tree = t;
        treeBorn = System.currentTimeMillis();
    }

    public static String tree() { return tree; }

    /** Starts a smooth camera flight to one of the shots. */
    public static void setCamera(int i) {
        i = Math.max(0, Math.min(CAMS.length - 1, i));
        if (i == cam && extraYaw == 0) return;
        camFrom = camNow.clone();
        cam = i;
        extraYaw = 0;
        camStart = System.currentTimeMillis();
    }

    public static int camera() { return cam; }

    /** Extra yaw from dragging in the editor. */
    public static void addYaw(float d) { extraYaw += d; }

    /** Real local time as minutes after midnight. */
    public static int realMinutes() {
        Calendar c = Calendar.getInstance();
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
    }

    // ------------------------------------------------------------------ colours

    private static final int[][] SKY = {
            {0, 0x0B0820, 0x1B1240}, {330, 0x120C30, 0x2B1850}, {390, 0xFF9A6A, 0x6A4FB0}, {480, 0x8FD0FF, 0xD8F0FF},
            {1020, 0x7FC4FF, 0xCFEAFF}, {1110, 0xFF8A6A, 0x7A4FB0}, {1170, 0x2A1550, 0x5A2F7A}, {1260, 0x0B0820, 0x1B1240}, {1440, 0x0B0820, 0x1B1240}};

    private static int[] sky(float min) {
        for (int i = 0; i < SKY.length - 1; i++) {
            if (min >= SKY[i][0] && min <= SKY[i + 1][0]) {
                float t = (min - SKY[i][0]) / Math.max(1f, SKY[i + 1][0] - SKY[i][0]);
                return new int[]{ColorUtil.lerp(0xFF000000 | SKY[i][1], 0xFF000000 | SKY[i + 1][1], t), ColorUtil.lerp(0xFF000000 | SKY[i][2], 0xFF000000 | SKY[i + 1][2], t)};
            }
        }
        return new int[]{0xFF0B0820, 0xFF1B1240};
    }

    private static int shade(int c, float k) {
        int r = (int) Math.min(255, ((c >> 16) & 255) * k), g = (int) Math.min(255, ((c >> 8) & 255) * k), b = (int) Math.min(255, (c & 255) * k);
        return 0xFF000000 | r << 16 | g << 8 | b;
    }

    private static int[] treeColors(String t) {
        // log side, log top, leaf
        if ("Brzoza".equals(t)) return new int[]{0xE8E2D4, 0xC9C2B2, 0x79B04C};
        if ("Świerk".equals(t)) return new int[]{0x4E3820, 0x5F452A, 0x2F5E3A};
        if ("Wiśnia".equals(t)) return new int[]{0x5A2F3C, 0x6B3A48, 0xF3A6CF};
        return new int[]{0x7A5A36, 0x8C6A42, 0x4F9A3A};
    }

    private static int treeHeight(String t) { return "Świerk".equals(t) ? 6 : "Brzoza".equals(t) ? 5 : 4; }

    // ------------------------------------------------------------------ render

    private static final class Block {
        final float x, y, z, s;
        final int top, side;
        float depth;

        Block(float x, float y, float z, float s, int top, int side) { this.x = x; this.y = y; this.z = z; this.s = s; this.top = top; this.side = side; }
    }

    /** Draws the scene filling (0,0)-(w,h); minutes = time of day (0..1440). */
    public static void render(Gfx g, float w, float h, float minutes) { render(g, w, h, minutes, 0.5f); }

    /** As {@link #render(Gfx, float, float, float)} with the island centred at focusX (0..1 of the width). */
    public static void render(Gfx g, float w, float h, float minutes, float focusX) {
        long now = System.currentTimeMillis();
        float day = clamp((float) Math.sin((minutes - 360) / 1440.0 * Math.PI * 2) * 1.4f + 0.35f, 0.16f, 1f);
        // camera flight (ease out quart) with a slow idle drift
        float ct = clamp((now - camStart) / 1400f, 0, 1), ce = 1 - (float) Math.pow(1 - ct, 4);
        float[] to = CAMS[cam];
        for (int i = 0; i < 3; i++) camNow[i] = camFrom[i] + (to[i] - camFrom[i]) * ce;
        float yaw = camNow[0] + extraYaw + (float) Math.sin(now / 5000.0) * 0.07f, pitch = camNow[1], zoom = camNow[2];

        int[] sk = sky(minutes);
        Render2D.quadGradient(g, 0, 0, w, h, sk[0], sk[0], sk[1], sk[1]);
        // stars and the Nore violet haze at night
        if (day < 0.55f) {
            float a = (0.55f - day) / 0.55f;
            for (int i = 0; i < 90; i++) {
                float sx = (float) ((i * 97.31) % 1.0) * w, sy = (float) ((i * 57.17) % 1.0) * h * 0.62f;
                float tw = 0.5f + 0.5f * (float) Math.sin(now / 600.0 + i);
                Render2D.rect(g, sx, sy, 1.2f, 1.2f, ColorUtil.withAlpha(0xFFFFFFFF, (int) (220 * a * tw)));
            }
            Render2D.radial(g, w * 0.7f, h * 0.25f, w * 0.5f, ColorUtil.withAlpha(Theme.accent(), (int) (60 * a)), 0);
        }
        // sun and moon on an arc
        double ang = (minutes - 360) / 720.0 * Math.PI;
        float sx = w * 0.5f - (float) Math.cos(ang) * w * 0.42f, sy = h * 0.66f - (float) Math.sin(ang) * h * 0.52f;
        float mx = w * 0.5f + (float) Math.cos(ang) * w * 0.42f, my = h * 0.66f + (float) Math.sin(ang) * h * 0.52f;
        if (minutes > 330 && minutes < 1170) {
            Render2D.rect(g, sx - 22, sy - 22, 44, 44, 0x40FFDC8C);
            Render2D.rect(g, sx - 12, sy - 12, 24, 24, 0xFFFFE7A0);
        } else {
            Render2D.rect(g, mx - 17, my - 17, 34, 34, 0x30DCDCFF);
            Render2D.rect(g, mx - 9, my - 9, 18, 18, 0xFFE8E6FF);
            Render2D.rect(g, mx - 3, my - 5, 4, 4, 0xFFC9C6EE);
        }
        // clouds drifting
        for (int i = 0; i < 5; i++) {
            float cx = (float) (((i * 0.23 + now / 90000.0) % 1.2) - 0.1) * w, cy = h * (0.12f + (i % 3) * 0.07f);
            Render2D.rect(g, cx, cy, 46 + i * 6, 8, ColorUtil.withAlpha(ColorUtil.lerp(0xFF6A5A9A, 0xFFFFFFFF, day), 120));
            Render2D.rect(g, cx + 10, cy - 6, 24, 6, ColorUtil.withAlpha(ColorUtil.lerp(0xFF6A5A9A, 0xFFFFFFFF, day), 120));
        }

        // ---- voxels
        List<Block> blocks = new ArrayList<Block>();
        for (int x = 0; x < N; x++) {
            for (int z = 0; z < N; z++) {
                int hh = HEIGHT[x][z];
                if (hh < 0) continue;
                for (int y = 0; y <= hh; y++) blocks.add(new Block(x, y, z, 1, y == hh ? 0x5FAE45 : 0x7A5A36, 0x6B4F30));
            }
        }
        for (int x = -2; x <= N + 1; x++) {
            for (int z = -2; z <= N + 1; z++) {
                if (x >= 0 && z >= 0 && x < N && z < N && HEIGHT[x][z] >= 0) continue;
                if (Math.hypot(x - (N - 1) / 2.0, z - (N - 1) / 2.0) < 7.2) blocks.add(new Block(x, -0.25f, z, 1, 0x3A6FD8, 0x2D58B0));
            }
        }
        int[] tc = treeColors(tree);
        int th = treeHeight(tree);
        float age = (now - treeBorn) / 1000f;
        for (int i = 0; i < SPOTS.length; i++) {
            int tx = SPOTS[i][0], tz = SPOTS[i][1];
            int base = HEIGHT[tx][tz] + 1;
            float local = age - i * 0.22f;
            int trunk = (int) clamp((float) Math.floor(local * 6), 0, th);
            for (int y = 0; y < trunk; y++) blocks.add(new Block(tx, base + y, tz, 1, tc[1], tc[0]));
            float lt = clamp((local - th / 6f) / 0.7f, 0, 1);
            if (lt <= 0) continue;
            float sc = Animation.easeOutBack(lt);
            int top = base + th;
            for (int[] l : canopy(tree)) blocks.add(new Block(tx + l[0] * sc, top + l[1] * sc, tz + l[2] * sc, sc, tc[2], shade(0xFF000000 | tc[2], 0.8f) & 0xFFFFFF));
        }
        float S = Math.min(w, h) / 25f * zoom;
        float cy = (float) Math.cos(yaw), sy2 = (float) Math.sin(yaw), cp = (float) Math.cos(pitch), sp = (float) Math.sin(pitch);
        for (Block b : blocks) {
            float x = b.x - (N - 1) / 2f, z = b.z - (N - 1) / 2f;
            float rz = x * sy2 + z * cy;
            b.depth = rz * cp + b.y * sp;
        }
        blocks.sort((p, q) -> Float.compare(p.depth, q.depth));
        float light = 0.35f + day * 0.65f;
        float[] xy = new float[blocks.size() * 3 * 8];
        int[] col = new int[blocks.size() * 3 * 4];
        int v = 0;
        float[][] corner = new float[8][];
        for (Block b : blocks) {
            float s = 0.5f * b.s;
            for (int k = 0; k < 8; k++) {
                float px = b.x + ((k & 1) == 0 ? -s : s) - (N - 1) / 2f;
                float py = b.y + ((k & 2) == 0 ? -s : s);
                float pz = b.z + ((k & 4) == 0 ? -s : s) - (N - 1) / 2f;
                float rx = px * cy - pz * sy2, rz = px * sy2 + pz * cy;
                corner[k] = new float[]{w * focusX + rx * S, h * 0.6f - py * S * cp + rz * S * sp, rz * cp + py * sp};
            }
            // top face + the two side faces that look at the camera
            int[] xf = corner[0][2] + corner[6][2] > corner[1][2] + corner[7][2] ? new int[]{0, 2, 6, 4} : new int[]{1, 3, 7, 5};
            int[] zf = corner[0][2] + corner[3][2] > corner[4][2] + corner[7][2] ? new int[]{0, 1, 3, 2} : new int[]{4, 5, 7, 6};
            int[][] faces = {{2, 3, 7, 6}, xf, zf};
            float[] k = {1f, 0.78f, 0.64f};
            for (int f = 0; f < 3; f++) {
                int c = shade(0xFF000000 | (f == 0 ? b.top : b.side), k[f] * light);
                for (int q = 0; q < 4; q++) {
                    float[] p = corner[faces[f][q]];
                    xy[v * 2] = p[0];
                    xy[v * 2 + 1] = p[1];
                    col[v] = c;
                    v++;
                }
            }
        }
        if (v > 0) g.mesh(Gfx.QUADS, Arrays.copyOf(xy, v * 2), Arrays.copyOf(col, v), v);
        // fireflies at night, petals for the cherry trees
        if (day < 0.5f || "Wiśnia".equals(tree)) {
            boolean petals = "Wiśnia".equals(tree);
            for (int i = 0; i < 24; i++) {
                float fx = (float) (((i * 0.137 + now / (petals ? 14000.0 : 40000.0) * (0.5 + i % 3 * 0.2)) % 1.0)) * w;
                float fy = h * (0.3f + ((i * 0.611f) % 0.5f)) + (float) Math.sin(now / 700.0 + i) * 8 + (petals ? (float) ((now / 30.0 + i * 37) % (h * 0.5)) * 0.4f : 0);
                int c = petals ? 0xFFFFC4E1 : ColorUtil.withAlpha(0xFFFFE680, (int) (160 + 90 * Math.sin(now / 300.0 + i)));
                Render2D.rect(g, fx, fy, petals ? 2.2f : 1.6f, petals ? 1.6f : 1.6f, c);
            }
        }
    }

    private static List<int[]> canopy(String t) {
        List<int[]> l = new ArrayList<int[]>();
        if ("Świerk".equals(t)) {
            for (int ly = -4; ly <= 1; ly++) {
                int r = ly <= -2 ? 1 : 0;
                for (int x = -r; x <= r; x++) for (int z = -r; z <= r; z++) if (ly != -3 || Math.abs(x) + Math.abs(z) <= 1) l.add(new int[]{x, ly, z});
            }
        } else {
            for (int ly = -1; ly <= 1; ly++) {
                int r = ly == 1 ? 0 : 1;
                for (int x = -r; x <= r; x++) for (int z = -r; z <= r; z++) if (!(ly == 0 && Math.abs(x) + Math.abs(z) == 2)) l.add(new int[]{x, ly, z});
            }
        }
        return l;
    }

    private static float clamp(float v, float a, float b) { return Math.max(a, Math.min(b, v)); }
}
