package dev.noreclient.util;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.BufferBuilder;
import net.minecraft.client.render.BufferRenderer;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.render.Tessellator;
import net.minecraft.client.render.VertexFormat;
import net.minecraft.client.render.VertexFormats;
import org.joml.Matrix4f;

/** Anti-aliased-looking 2D primitives (rounded rectangles, circles, outlines, gradients). */
public final class Render2D {
    private Render2D() {}

    private static void begin(DrawContext ctx) {
        ctx.draw();
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        RenderSystem.disableCull();
        RenderSystem.disableDepthTest();
        RenderSystem.setShader(GameRenderer::getPositionColorProgram);
    }

    private static void end() {
        RenderSystem.enableDepthTest();
        RenderSystem.enableCull();
        RenderSystem.disableBlend();
    }

    private static int segments(float r) {
        return Math.max(3, Math.min(16, (int) (r * 1.5f)));
    }

    public static void rect(DrawContext ctx, float x, float y, float w, float h, int color) {
        roundedRect(ctx, x, y, w, h, 0, color);
    }

    public static void roundedRect(DrawContext ctx, float x, float y, float w, float h, float r, int color) {
        roundedGradient(ctx, x, y, w, h, r, color, color, false);
    }

    /**
     * Rounded rectangle with a two-colour gradient. {@code vertical} selects top→bottom, otherwise
     * left→right.
     */
    public static void roundedGradient(DrawContext ctx, float x, float y, float w, float h, float r,
                                       int c1, int c2, boolean vertical) {
        if (w <= 0 || h <= 0 || (ColorUtil.alpha(c1) == 0 && ColorUtil.alpha(c2) == 0)) return;
        r = Math.max(0, Math.min(r, Math.min(w, h) / 2f));
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        begin(ctx);
        BufferBuilder b = Tessellator.getInstance().begin(VertexFormat.DrawMode.TRIANGLE_FAN, VertexFormats.POSITION_COLOR);
        float cx = x + w / 2f, cy = y + h / 2f;
        b.vertex(m, cx, cy, 0).color(ColorUtil.lerp(c1, c2, 0.5f));
        float[][] centers = {{x + r, y + r}, {x + w - r, y + r}, {x + w - r, y + h - r}, {x + r, y + h - r}};
        int seg = r > 0 ? segments(r) : 0;
        float firstX = 0, firstY = 0;
        boolean first = true;
        for (int corner = 0; corner < 4; corner++) {
            float start = (float) Math.toRadians(180 + corner * 90);
            for (int i = 0; i <= seg; i++) {
                float a = start + (float) (Math.PI / 2) * (seg == 0 ? 0 : i / (float) seg);
                float px = centers[corner][0] + (float) Math.cos(a) * r;
                float py = centers[corner][1] + (float) Math.sin(a) * r;
                float t = vertical ? (py - y) / h : (px - x) / w;
                b.vertex(m, px, py, 0).color(ColorUtil.lerp(c1, c2, t));
                if (first) { firstX = px; firstY = py; first = false; }
            }
        }
        float t = vertical ? (firstY - y) / h : (firstX - x) / w;
        b.vertex(m, firstX, firstY, 0).color(ColorUtil.lerp(c1, c2, t));
        BufferRenderer.drawWithGlobalProgram(b.end());
        end();
    }

    /** Rounded outline of the given thickness, drawn inside the bounds. */
    public static void roundedOutline(DrawContext ctx, float x, float y, float w, float h, float r, float thickness, int color) {
        if (w <= 0 || h <= 0 || ColorUtil.alpha(color) == 0) return;
        r = Math.min(r, Math.min(w, h) / 2f);
        if (r < thickness) {
            rect(ctx, x, y, w, thickness, color);
            rect(ctx, x, y + h - thickness, w, thickness, color);
            rect(ctx, x, y + thickness, thickness, h - thickness * 2, color);
            rect(ctx, x + w - thickness, y + thickness, thickness, h - thickness * 2, color);
            return;
        }
        float ir = r - thickness;
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        begin(ctx);
        BufferBuilder b = Tessellator.getInstance().begin(VertexFormat.DrawMode.TRIANGLE_STRIP, VertexFormats.POSITION_COLOR);
        float[][] centers = {{x + r, y + r}, {x + w - r, y + r}, {x + w - r, y + h - r}, {x + r, y + h - r}};
        int seg = segments(r);
        for (int corner = 0; corner < 4; corner++) {
            float start = (float) Math.toRadians(180 + corner * 90);
            for (int i = 0; i <= seg; i++) {
                float a = start + (float) (Math.PI / 2) * (i / (float) seg);
                float cos = (float) Math.cos(a), sin = (float) Math.sin(a);
                b.vertex(m, centers[corner][0] + cos * r, centers[corner][1] + sin * r, 0).color(color);
                b.vertex(m, centers[corner][0] + cos * ir, centers[corner][1] + sin * ir, 0).color(color);
            }
        }
        b.vertex(m, centers[0][0] - r, centers[0][1], 0).color(color);
        b.vertex(m, centers[0][0] - ir, centers[0][1], 0).color(color);
        BufferRenderer.drawWithGlobalProgram(b.end());
        end();
    }

    /** Soft radial gradient (inner colour in the centre fading to the outer colour). */
    public static void radial(DrawContext ctx, float cx, float cy, float radius, int inner, int outer) {
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        begin(ctx);
        BufferBuilder b = Tessellator.getInstance().begin(VertexFormat.DrawMode.TRIANGLE_FAN, VertexFormats.POSITION_COLOR);
        b.vertex(m, cx, cy, 0).color(inner);
        int seg = 48;
        for (int i = 0; i <= seg; i++) {
            double a = Math.PI * 2 * i / seg;
            b.vertex(m, cx + (float) Math.cos(a) * radius, cy + (float) Math.sin(a) * radius, 0).color(outer);
        }
        BufferRenderer.drawWithGlobalProgram(b.end());
        end();
    }

    public static void circle(DrawContext ctx, float cx, float cy, float radius, int color) {
        roundedRect(ctx, cx - radius, cy - radius, radius * 2, radius * 2, radius, color);
    }

    /** Arc ring segment, used e.g. for the circular crosshair and loading spinners. */
    public static void ring(DrawContext ctx, float cx, float cy, float radius, float thickness, float startDeg, float endDeg, int color) {
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        begin(ctx);
        BufferBuilder b = Tessellator.getInstance().begin(VertexFormat.DrawMode.TRIANGLE_STRIP, VertexFormats.POSITION_COLOR);
        int seg = Math.max(8, (int) (Math.abs(endDeg - startDeg) / 6));
        for (int i = 0; i <= seg; i++) {
            double a = Math.toRadians(startDeg + (endDeg - startDeg) * i / seg);
            float cos = (float) Math.cos(a), sin = (float) Math.sin(a);
            b.vertex(m, cx + cos * radius, cy + sin * radius, 0).color(color);
            b.vertex(m, cx + cos * (radius - thickness), cy + sin * (radius - thickness), 0).color(color);
        }
        BufferRenderer.drawWithGlobalProgram(b.end());
        end();
    }

    /** Soft drop shadow made from stacked translucent rounded rectangles. */
    public static void shadow(DrawContext ctx, float x, float y, float w, float h, float r, int size, int color) {
        int baseAlpha = ColorUtil.alpha(color);
        for (int i = size; i > 0; i--) {
            float f = 1f - i / (float) (size + 1);
            int a = Math.round(baseAlpha * f * f / size * 2.2f);
            roundedRect(ctx, x - i, y - i, w + i * 2, h + i * 2, r + i, ColorUtil.withAlpha(color, Math.min(255, a)));
        }
    }

    public static void line(DrawContext ctx, float x1, float y1, float x2, float y2, float width, int color) {
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        float dx = x2 - x1, dy = y2 - y1;
        float len = (float) Math.sqrt(dx * dx + dy * dy);
        if (len == 0) return;
        float nx = -dy / len * width / 2, ny = dx / len * width / 2;
        begin(ctx);
        BufferBuilder b = Tessellator.getInstance().begin(VertexFormat.DrawMode.QUADS, VertexFormats.POSITION_COLOR);
        b.vertex(m, x1 + nx, y1 + ny, 0).color(color);
        b.vertex(m, x2 + nx, y2 + ny, 0).color(color);
        b.vertex(m, x2 - nx, y2 - ny, 0).color(color);
        b.vertex(m, x1 - nx, y1 - ny, 0).color(color);
        BufferRenderer.drawWithGlobalProgram(b.end());
        end();
    }

    /** Four-corner gradient quad (used by the colour picker's saturation/brightness square). */
    public static void quadGradient(DrawContext ctx, float x, float y, float w, float h, int tl, int tr, int br, int bl) {
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        begin(ctx);
        BufferBuilder b = Tessellator.getInstance().begin(VertexFormat.DrawMode.QUADS, VertexFormats.POSITION_COLOR);
        b.vertex(m, x, y, 0).color(tl);
        b.vertex(m, x, y + h, 0).color(bl);
        b.vertex(m, x + w, y + h, 0).color(br);
        b.vertex(m, x + w, y, 0).color(tr);
        BufferRenderer.drawWithGlobalProgram(b.end());
        end();
    }

    // ------------------------------------------------------------------ text

    public static TextRenderer font() {
        return MinecraftClient.getInstance().textRenderer;
    }

    public static int textWidth(String s) {
        return font().getWidth(s);
    }

    public static void text(DrawContext ctx, String s, float x, float y, int color, boolean shadow) {
        if (ColorUtil.alpha(color) < 5) return;
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.drawText(font(), s, 0, 0, color, shadow);
        ctx.getMatrices().pop();
    }

    public static void text(DrawContext ctx, String s, float x, float y, int color) {
        text(ctx, s, x, y, color, false);
    }

    public static void scaledText(DrawContext ctx, String s, float x, float y, float scale, int color, boolean shadow) {
        if (ColorUtil.alpha(color) < 5) return;
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.getMatrices().scale(scale, scale, 1);
        ctx.drawText(font(), s, 0, 0, color, shadow);
        ctx.getMatrices().pop();
    }

    public static void centeredText(DrawContext ctx, String s, float cx, float y, int color, boolean shadow) {
        text(ctx, s, cx - textWidth(s) / 2f, y, color, shadow);
    }

    /** Draws each character with a colour taken from a moving gradient between two colours. */
    public static void gradientText(DrawContext ctx, String s, float x, float y, float scale, int c1, int c2, boolean shadow) {
        float cx = 0;
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.getMatrices().scale(scale, scale, 1);
        for (int i = 0; i < s.length(); i++) {
            String ch = String.valueOf(s.charAt(i));
            int col = ColorUtil.wave(c1, c2, -i * 300L, 1f);
            ctx.getMatrices().push();
            ctx.getMatrices().translate(cx, 0, 0);
            ctx.drawText(font(), ch, 0, 0, col, shadow);
            ctx.getMatrices().pop();
            cx += textWidth(ch);
        }
        ctx.getMatrices().pop();
    }

    public static String trim(String s, int maxWidth) {
        if (textWidth(s) <= maxWidth) return s;
        String dots = "...";
        while (!s.isEmpty() && textWidth(s + dots) > maxWidth) s = s.substring(0, s.length() - 1);
        return s + dots;
    }

    public static boolean hovered(double mx, double my, float x, float y, float w, float h) {
        return mx >= x && my >= y && mx < x + w && my < y + h;
    }
}
