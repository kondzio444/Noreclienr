package dev.noreclient.cosmetic;

import java.util.ArrayList;
import java.util.List;

/**
 * Textured quads in Minecraft model space: units are model pixels (1/16 block), y points down and
 * the front of the player is -z (+x is the player's left). Built with a small transform stack, then
 * drawn by the platform (attached to the head or body part of the player model) and by the wardrobe
 * previews.
 */
public final class Mesh {
    /** Four corners in drawing order, with texture coordinates 0..1, a unit normal and an ARGB tint. */
    public static final class Quad {
        public final float[] x = new float[4], y = new float[4], z = new float[4], u = new float[4], v = new float[4];
        public float nx, ny, nz;
        public int color = -1;

        Quad copy() {
            Quad q = new Quad();
            System.arraycopy(x, 0, q.x, 0, 4);
            System.arraycopy(y, 0, q.y, 0, 4);
            System.arraycopy(z, 0, q.z, 0, 4);
            System.arraycopy(u, 0, q.u, 0, 4);
            System.arraycopy(v, 0, q.v, 0, 4);
            q.nx = nx; q.ny = ny; q.nz = nz; q.color = color;
            return q;
        }
    }

    public final List<Quad> quads = new ArrayList<Quad>();
    private float[] m = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0};
    private final List<float[]> stack = new ArrayList<float[]>();
    private int color = -1;

    public Mesh push() { stack.add(m.clone()); return this; }

    public Mesh pop() { m = stack.remove(stack.size() - 1); return this; }

    /** Tint (ARGB) of the quads added from now on. */
    public Mesh color(int argb) { color = argb; return this; }

    private void mul(float[] b) {
        float[] a = m, r = new float[12];
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 4; j++) {
                r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + (j == 3 ? a[i * 4 + 3] : 0);
            }
        }
        m = r;
    }

    public Mesh translate(float x, float y, float z) { mul(new float[]{1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z}); return this; }

    public Mesh scale(float x, float y, float z) { mul(new float[]{x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0}); return this; }

    public Mesh scale(float s) { return scale(s, s, s); }

    /** Positive angles tip something pointing up (-y) towards the front (-z). */
    public Mesh rotateX(float deg) {
        float c = (float) Math.cos(Math.toRadians(deg)), s = (float) Math.sin(Math.toRadians(deg));
        mul(new float[]{1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0});
        return this;
    }

    public Mesh rotateY(float deg) {
        float c = (float) Math.cos(Math.toRadians(deg)), s = (float) Math.sin(Math.toRadians(deg));
        mul(new float[]{c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0});
        return this;
    }

    /** Positive angles tip something pointing up (-y) towards +x. */
    public Mesh rotateZ(float deg) {
        float c = (float) Math.cos(Math.toRadians(deg)), s = (float) Math.sin(Math.toRadians(deg));
        mul(new float[]{c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0});
        return this;
    }

    /** Point through the current transform. */
    public float[] apply(float x, float y, float z) {
        return new float[]{m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]};
    }

    /** Adds a quad (points p[i] = {x, y, z}, uv[i] = {u, v}) through the current transform. */
    public Mesh quad(float[][] p, float[][] uv) {
        Quad q = new Quad();
        // a mirroring transform (scale(-1, ...)) flips the winding; walk the corners backwards to keep it
        float det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
        for (int k = 0; k < 4; k++) {
            int i = det < 0 ? (4 - k) % 4 : k;
            float[] a = p[k];
            q.x[i] = m[0] * a[0] + m[1] * a[1] + m[2] * a[2] + m[3];
            q.y[i] = m[4] * a[0] + m[5] * a[1] + m[6] * a[2] + m[7];
            q.z[i] = m[8] * a[0] + m[9] * a[1] + m[10] * a[2] + m[11];
            q.u[i] = uv[k][0];
            q.v[i] = uv[k][1];
        }
        // normal from the two diagonals (robust for slightly non-planar quads)
        float ax = q.x[2] - q.x[0], ay = q.y[2] - q.y[0], az = q.z[2] - q.z[0];
        float bx = q.x[3] - q.x[1], by = q.y[3] - q.y[1], bz = q.z[3] - q.z[1];
        float nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        float len = (float) Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-6f) { nx = 0; ny = -1; nz = 0; len = 1; }
        q.nx = nx / len; q.ny = ny / len; q.nz = nz / len;
        q.color = color;
        quads.add(q);
        return this;
    }

    /** Flat rectangle in the local XY plane (z = 0) from (x0, y0) to (x1, y1), texture region u0..u1, v0..v1. */
    public Mesh plane(float x0, float y0, float x1, float y1, float u0, float v0, float u1, float v1) {
        return quad(new float[][]{{x0, y0, 0}, {x0, y1, 0}, {x1, y1, 0}, {x1, y0, 0}},
                new float[][]{{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}});
    }

    /**
     * Box from (x0, y0, z0) to (x1, y1, z1); every face samples the same texture region (u0, v0)..(u1, v1),
     * which suits small details (buckles, bones) painted in one colour scheme.
     */
    public Mesh box(float x0, float y0, float z0, float x1, float y1, float z1, float u0, float v0, float u1, float v1) {
        float[][] uv = {{u0, v0}, {u0, v1}, {u1, v1}, {u1, v0}};
        quad(new float[][]{{x0, y0, z0}, {x0, y1, z0}, {x1, y1, z0}, {x1, y0, z0}}, uv); // front (-z)
        quad(new float[][]{{x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}, {x0, y0, z1}}, uv); // back
        quad(new float[][]{{x0, y0, z1}, {x0, y1, z1}, {x0, y1, z0}, {x0, y0, z0}}, uv); // -x
        quad(new float[][]{{x1, y0, z0}, {x1, y1, z0}, {x1, y1, z1}, {x1, y0, z1}}, uv); // +x
        quad(new float[][]{{x0, y0, z1}, {x0, y0, z0}, {x1, y0, z0}, {x1, y0, z1}}, uv); // top (-y)
        quad(new float[][]{{x0, y1, z0}, {x0, y1, z1}, {x1, y1, z1}, {x1, y1, z0}}, uv); // bottom
        return this;
    }

    /**
     * Tube along a spine (points {x, y, z} in local space) with a radius per point; u goes around
     * (u0..u1), v along the spine (v0 at the first point). Frames are parallel-transported so the
     * tube does not twist on curved spines. Ends are left open (close them with {@link #cap}).
     */
    public Mesh tube(float[][] spine, float[] radius, int sides, float u0, float v0, float u1, float v1) {
        int n = spine.length;
        float[][] tan = new float[n][];
        for (int i = 0; i < n; i++) {
            float[] a = spine[Math.max(0, i - 1)], b = spine[Math.min(n - 1, i + 1)];
            tan[i] = norm(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        }
        // first normal: anything perpendicular to the first tangent
        float[] t0 = tan[0];
        float[] ref = Math.abs(t0[1]) < 0.9f ? new float[]{0, 1, 0} : new float[]{1, 0, 0};
        float[] nrm = norm(cross(ref, t0));
        float[][] ns = new float[n][], bs = new float[n][];
        for (int i = 0; i < n; i++) {
            if (i > 0) {
                // project the previous normal onto the plane of this tangent
                float d = dot(nrm, tan[i]);
                nrm = norm(nrm[0] - tan[i][0] * d, nrm[1] - tan[i][1] * d, nrm[2] - tan[i][2] * d);
            }
            ns[i] = nrm;
            bs[i] = cross(tan[i], nrm);
        }
        float[][][] ring = new float[n][sides + 1][];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j <= sides; j++) {
                double a = j * Math.PI * 2 / sides;
                float c = (float) Math.cos(a) * radius[i], s = (float) Math.sin(a) * radius[i];
                ring[i][j] = new float[]{spine[i][0] + ns[i][0] * c + bs[i][0] * s, spine[i][1] + ns[i][1] * c + bs[i][1] * s, spine[i][2] + ns[i][2] * c + bs[i][2] * s};
            }
        }
        for (int i = 0; i < n - 1; i++) {
            float va = v0 + (v1 - v0) * i / (n - 1f), vb = v0 + (v1 - v0) * (i + 1) / (n - 1f);
            for (int j = 0; j < sides; j++) {
                float ua = u0 + (u1 - u0) * j / sides, ub = u0 + (u1 - u0) * (j + 1) / sides;
                quad(new float[][]{ring[i][j], ring[i][j + 1], ring[i + 1][j + 1], ring[i + 1][j]},
                        new float[][]{{ua, va}, {ub, va}, {ub, vb}, {ua, vb}});
            }
        }
        return this;
    }

    /** Closes a tube end at point c with a flat fan (as quads with a repeated centre); dir is the outward normal. */
    public Mesh cap(float[] c, float[] dir, float r, int sides, float u, float v) {
        float[] t = norm(dir[0], dir[1], dir[2]);
        float[] ref = Math.abs(t[1]) < 0.9f ? new float[]{0, 1, 0} : new float[]{1, 0, 0};
        float[] n = norm(cross(ref, t)), b = cross(t, n);
        for (int j = 0; j < sides; j++) {
            double a0 = j * Math.PI * 2 / sides, a1 = (j + 1) * Math.PI * 2 / sides;
            float[] p0 = {c[0] + (n[0] * (float) Math.cos(a0) + b[0] * (float) Math.sin(a0)) * r, c[1] + (n[1] * (float) Math.cos(a0) + b[1] * (float) Math.sin(a0)) * r, c[2] + (n[2] * (float) Math.cos(a0) + b[2] * (float) Math.sin(a0)) * r};
            float[] p1 = {c[0] + (n[0] * (float) Math.cos(a1) + b[0] * (float) Math.sin(a1)) * r, c[1] + (n[1] * (float) Math.cos(a1) + b[1] * (float) Math.sin(a1)) * r, c[2] + (n[2] * (float) Math.cos(a1) + b[2] * (float) Math.sin(a1)) * r};
            quad(new float[][]{c, p0, p1, c}, new float[][]{{u, v}, {u, v}, {u, v}, {u, v}});
        }
        return this;
    }

    /**
     * UV sphere (or ellipsoid with rx, ry, rz) centred at (cx, cy, cz); u around, v from top to bottom
     * inside the given texture region.
     */
    public Mesh sphere(float cx, float cy, float cz, float rx, float ry, float rz, int rings, int sides, float u0, float v0, float u1, float v1) {
        for (int i = 0; i < rings; i++) {
            double t0 = Math.PI * i / rings, t1 = Math.PI * (i + 1) / rings;
            for (int j = 0; j < sides; j++) {
                double p0 = Math.PI * 2 * j / sides, p1 = Math.PI * 2 * (j + 1) / sides;
                float[] a = sp(cx, cy, cz, rx, ry, rz, t0, p0), b = sp(cx, cy, cz, rx, ry, rz, t1, p0);
                float[] c = sp(cx, cy, cz, rx, ry, rz, t1, p1), d = sp(cx, cy, cz, rx, ry, rz, t0, p1);
                float ua = u0 + (u1 - u0) * j / sides, ub = u0 + (u1 - u0) * (j + 1) / sides;
                float va = v0 + (v1 - v0) * i / rings, vb = v0 + (v1 - v0) * (i + 1) / rings;
                quad(new float[][]{a, b, c, d}, new float[][]{{ua, va}, {ua, vb}, {ub, vb}, {ub, va}});
            }
        }
        return this;
    }

    private static float[] sp(float cx, float cy, float cz, float rx, float ry, float rz, double theta, double phi) {
        return new float[]{cx + rx * (float) (Math.sin(theta) * Math.cos(phi)), cy - ry * (float) Math.cos(theta), cz + rz * (float) (Math.sin(theta) * Math.sin(phi))};
    }

    /** Two crossed planes (XY and ZY) centred at the origin, size w x h – sprites seen from any side. */
    public Mesh cross(float w, float h, float u0, float v0, float u1, float v1) {
        plane(-w / 2, -h / 2, w / 2, h / 2, u0, v0, u1, v1);
        push().rotateY(90);
        plane(-w / 2, -h / 2, w / 2, h / 2, u0, v0, u1, v1);
        pop();
        return this;
    }

    /** Three crossed planes (XY, ZY, XZ): a sprite that reads from every angle, also from above. */
    public Mesh star3(float s, float u0, float v0, float u1, float v1) {
        cross(s, s, u0, v0, u1, v1);
        push().rotateX(90);
        plane(-s / 2, -s / 2, s / 2, s / 2, u0, v0, u1, v1);
        pop();
        return this;
    }

    /** Copies every quad of another mesh (already transformed) into this one, remapping v and tinting. */
    void addAll(List<Quad> src, float vScale, float vOffset, int tint) {
        for (Quad q : src) {
            Quad c = q.copy();
            for (int i = 0; i < 4; i++) c.v[i] = c.v[i] * vScale + vOffset;
            if (tint != -1) c.color = mulColor(c.color, tint);
            quads.add(c);
        }
    }

    static int mulColor(int a, int b) {
        int aa = (a >>> 24) * (b >>> 24) / 255, r = ((a >> 16) & 255) * ((b >> 16) & 255) / 255;
        int g = ((a >> 8) & 255) * ((b >> 8) & 255) / 255, bb = (a & 255) * (b & 255) / 255;
        return aa << 24 | r << 16 | g << 8 | bb;
    }

    static float[] norm(float[] v) { return norm(v[0], v[1], v[2]); }

    static float[] norm(float x, float y, float z) {
        float l = (float) Math.sqrt(x * x + y * y + z * z);
        if (l < 1e-6f) return new float[]{0, -1, 0};
        return new float[]{x / l, y / l, z / l};
    }

    static float[] cross(float[] a, float[] b) {
        return new float[]{a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]};
    }

    static float dot(float[] a, float[] b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
}
