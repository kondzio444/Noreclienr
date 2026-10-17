package dev.noreclient.cosmetic;

import java.util.ArrayList;
import java.util.List;

/**
 * Textured quads in Minecraft model space: units are model pixels (1/16 block), y points down and
 * the front of the player is -z. Built with a small transform stack, then drawn by the platform
 * (attached to the head or body part of the player model) and by the wardrobe preview.
 */
public final class Mesh {
    /** Four corners in drawing order, with texture coordinates 0..1 and a unit normal. */
    public static final class Quad {
        public final float[] x = new float[4], y = new float[4], z = new float[4], u = new float[4], v = new float[4];
        public float nx, ny, nz;
    }

    public final List<Quad> quads = new ArrayList<Quad>();
    private float[] m = {1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0};
    private final List<float[]> stack = new ArrayList<float[]>();

    public Mesh push() { stack.add(m.clone()); return this; }

    public Mesh pop() { m = stack.remove(stack.size() - 1); return this; }

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

    public Mesh rotateZ(float deg) {
        float c = (float) Math.cos(Math.toRadians(deg)), s = (float) Math.sin(Math.toRadians(deg));
        mul(new float[]{c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0});
        return this;
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
}
