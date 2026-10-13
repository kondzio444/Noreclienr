package dev.noreclient.util;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

/** Rounded rectangles, circles, rings, gradients, glows and text helpers on top of {@link Gfx}. */
public final class Render2D {
    private Render2D() {}

    private static float[] xy = new float[512];
    private static int[] col = new int[256];
    private static int n;

    private static void reset() { n = 0; }

    private static void v(float x, float y, int c) {
        if (n * 2 + 2 > xy.length) {
            float[] nx = new float[xy.length * 2];
            System.arraycopy(xy, 0, nx, 0, xy.length);
            xy = nx;
            int[] nc = new int[col.length * 2];
            System.arraycopy(col, 0, nc, 0, col.length);
            col = nc;
        }
        xy[n * 2] = x;
        xy[n * 2 + 1] = y;
        col[n] = c;
        n++;
    }

    private static void flush(Gfx g, int mode) {
        if (n > 0) g.mesh(mode, xy, col, n);
        n = 0;
    }

    private static int segments(float r) {
        return Math.max(3, Math.min(16, (int) (r * 1.5f)));
    }

    public static void rect(Gfx g, float x, float y, float w, float h, int color) {
        if (w <= 0 || h <= 0 || ColorUtil.alpha(color) == 0) return;
        reset();
        v(x, y, color);
        v(x, y + h, color);
        v(x + w, y + h, color);
        v(x + w, y, color);
        flush(g, Gfx.QUADS);
    }

    public static void roundedRect(Gfx g, float x, float y, float w, float h, float r, int color) {
        roundedGradient(g, x, y, w, h, r, color, color, false);
    }

    public static void roundedGradient(Gfx g, float x, float y, float w, float h, float r, int c1, int c2, boolean vertical) {
        if (w <= 0 || h <= 0 || (ColorUtil.alpha(c1) == 0 && ColorUtil.alpha(c2) == 0)) return;
        r = Math.max(0, Math.min(r, Math.min(w, h) / 2f));
        if (r < 0.5f) {
            reset();
            if (vertical) { v(x, y, c1); v(x, y + h, c2); v(x + w, y + h, c2); v(x + w, y, c1); }
            else { v(x, y, c1); v(x, y + h, c1); v(x + w, y + h, c2); v(x + w, y, c2); }
            flush(g, Gfx.QUADS);
            return;
        }
        reset();
        v(x + w / 2f, y + h / 2f, ColorUtil.lerp(c1, c2, 0.5f));
        float[][] centers = {{x + r, y + r}, {x + w - r, y + r}, {x + w - r, y + h - r}, {x + r, y + h - r}};
        int seg = segments(r);
        float fx = 0, fy = 0;
        boolean first = true;
        for (int corner = 0; corner < 4; corner++) {
            double start = Math.toRadians(180 + corner * 90);
            for (int i = 0; i <= seg; i++) {
                double a = start + Math.PI / 2 * (i / (double) seg);
                float px = centers[corner][0] + (float) Math.cos(a) * r;
                float py = centers[corner][1] + (float) Math.sin(a) * r;
                float t = vertical ? (py - y) / h : (px - x) / w;
                v(px, py, ColorUtil.lerp(c1, c2, t));
                if (first) { fx = px; fy = py; first = false; }
            }
        }
        float t = vertical ? (fy - y) / h : (fx - x) / w;
        v(fx, fy, ColorUtil.lerp(c1, c2, t));
        flush(g, Gfx.TRIANGLE_FAN);
    }

    public static void roundedOutline(Gfx g, float x, float y, float w, float h, float r, float thickness, int color) {
        if (w <= 0 || h <= 0 || ColorUtil.alpha(color) == 0) return;
        r = Math.min(r, Math.min(w, h) / 2f);
        if (r < thickness) {
            rect(g, x, y, w, thickness, color);
            rect(g, x, y + h - thickness, w, thickness, color);
            rect(g, x, y + thickness, thickness, h - thickness * 2, color);
            rect(g, x + w - thickness, y + thickness, thickness, h - thickness * 2, color);
            return;
        }
        float ir = r - thickness;
        reset();
        float[][] centers = {{x + r, y + r}, {x + w - r, y + r}, {x + w - r, y + h - r}, {x + r, y + h - r}};
        int seg = segments(r);
        for (int corner = 0; corner < 4; corner++) {
            double start = Math.toRadians(180 + corner * 90);
            for (int i = 0; i <= seg; i++) {
                double a = start + Math.PI / 2 * (i / (double) seg);
                float cos = (float) Math.cos(a), sin = (float) Math.sin(a);
                v(centers[corner][0] + cos * r, centers[corner][1] + sin * r, color);
                v(centers[corner][0] + cos * ir, centers[corner][1] + sin * ir, color);
            }
        }
        v(centers[0][0] - r, centers[0][1], color);
        v(centers[0][0] - ir, centers[0][1], color);
        flush(g, Gfx.TRIANGLE_STRIP);
    }

    public static void circle(Gfx g, float cx, float cy, float radius, int color) {
        roundedRect(g, cx - radius, cy - radius, radius * 2, radius * 2, radius, color);
    }

    public static void radial(Gfx g, float cx, float cy, float radius, int inner, int outer) {
        reset();
        v(cx, cy, inner);
        int seg = 48;
        for (int i = 0; i <= seg; i++) {
            double a = Math.PI * 2 * i / seg;
            v(cx + (float) Math.cos(a) * radius, cy + (float) Math.sin(a) * radius, outer);
        }
        flush(g, Gfx.TRIANGLE_FAN);
    }

    public static void ring(Gfx g, float cx, float cy, float radius, float thickness, float startDeg, float endDeg, int color) {
        reset();
        int seg = Math.max(8, (int) (Math.abs(endDeg - startDeg) / 6));
        for (int i = 0; i <= seg; i++) {
            double a = Math.toRadians(startDeg + (endDeg - startDeg) * i / seg);
            float cos = (float) Math.cos(a), sin = (float) Math.sin(a);
            v(cx + cos * radius, cy + sin * radius, color);
            v(cx + cos * (radius - thickness), cy + sin * (radius - thickness), color);
        }
        flush(g, Gfx.TRIANGLE_STRIP);
    }

    public static void shadow(Gfx g, float x, float y, float w, float h, float r, int size, int color) {
        int baseAlpha = ColorUtil.alpha(color);
        for (int i = size; i > 0; i--) {
            float f = 1f - i / (float) (size + 1);
            int a = Math.round(baseAlpha * f * f / size * 2.2f);
            roundedRect(g, x - i, y - i, w + i * 2, h + i * 2, r + i, ColorUtil.withAlpha(color, Math.min(255, a)));
        }
    }

    public static void line(Gfx g, float x1, float y1, float x2, float y2, float width, int color) {
        float dx = x2 - x1, dy = y2 - y1;
        float len = (float) Math.sqrt(dx * dx + dy * dy);
        if (len == 0) return;
        float nx = -dy / len * width / 2, ny = dx / len * width / 2;
        reset();
        v(x1 + nx, y1 + ny, color);
        v(x2 + nx, y2 + ny, color);
        v(x2 - nx, y2 - ny, color);
        v(x1 - nx, y1 - ny, color);
        flush(g, Gfx.QUADS);
    }

    public static void quadGradient(Gfx g, float x, float y, float w, float h, int tl, int tr, int br, int bl) {
        reset();
        v(x, y, tl);
        v(x, y + h, bl);
        v(x + w, y + h, br);
        v(x + w, y, tr);
        flush(g, Gfx.QUADS);
    }

    public static void texture(Gfx g, TextureRef tex, float x, float y, float w, float h, float alpha) {
        if (tex != null) g.texture(tex, x, y, w, h, alpha);
    }

    /** The client logo with a soft pulsing glow behind it. */
    public static void logo(Gfx g, float x, float y, float size, float alpha) {
        float pulse = 0.75f + 0.25f * (float) Math.sin(System.currentTimeMillis() / 600.0);
        radial(g, x + size / 2f, y + size / 2f, size * 0.85f, ColorUtil.withAlpha(Theme.accent(), (int) (80 * pulse * alpha)), 0);
        texture(g, Platform.game().logo(), x, y, size, size, alpha);
    }

    // ------------------------------------------------------------------ text

    public static int textWidth(String s) {
        return CurrentGfx.width(s);
    }

    public static void text(Gfx g, String s, float x, float y, int color, boolean shadow) {
        if (ColorUtil.alpha(color) < 5 || s == null) return;
        g.text(s, x, y, color, shadow);
    }

    public static void text(Gfx g, String s, float x, float y, int color) {
        text(g, s, x, y, color, false);
    }

    public static void scaledText(Gfx g, String s, float x, float y, float scale, int color, boolean shadow) {
        if (ColorUtil.alpha(color) < 5) return;
        g.push();
        g.translate(x, y);
        g.scale(scale, scale);
        g.text(s, 0, 0, color, shadow);
        g.pop();
    }

    public static void centeredText(Gfx g, String s, float cx, float y, int color, boolean shadow) {
        text(g, s, cx - textWidth(s) / 2f, y, color, shadow);
    }

    public static void gradientText(Gfx g, String s, float x, float y, float scale, int c1, int c2, boolean shadow) {
        float cx = 0;
        g.push();
        g.translate(x, y);
        g.scale(scale, scale);
        for (int i = 0; i < s.length(); i++) {
            String ch = String.valueOf(s.charAt(i));
            g.text(ch, cx, 0, ColorUtil.wave(c1, c2, -i * 300L, 1f), shadow);
            cx += textWidth(ch);
        }
        g.pop();
    }

    public static String trim(String s, int maxWidth) {
        if (s == null) return "";
        if (textWidth(s) <= maxWidth) return s;
        String dots = "...";
        while (!s.isEmpty() && textWidth(s + dots) > maxWidth) s = s.substring(0, s.length() - 1);
        return s + dots;
    }

    public static boolean hovered(double mx, double my, float x, float y, float w, float h) {
        return mx >= x && my >= y && mx < x + w && my < y + h;
    }
}
