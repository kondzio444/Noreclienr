package dev.noreclient.platform;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import dev.noreclient.api.EffectInfo;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.TextureRef;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.RenderPipelines;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.ScreenRect;
import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.client.gui.render.state.SimpleGuiElementRenderState;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.texture.TextureSetup;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Identifier;
import org.jetbrains.annotations.Nullable;
import org.joml.Matrix3x2f;
import org.joml.Vector2f;

/**
 * Gfx on top of the 1.21.6+ deferred GUI renderer.
 *
 * <p>Nothing is drawn immediately any more: every mesh becomes one GUI element (already
 * transformed to screen space, alpha baked into the vertex colours) that the game batches
 * together with its own quads, text and items in submission order.
 */
public final class GfxImpl implements Gfx {
    private final DrawContext ctx;
    private float alpha = 1f;

    public GfxImpl(DrawContext ctx) {
        this.ctx = ctx;
    }

    @Override public void push() { ctx.getMatrices().pushMatrix(); }
    @Override public void pop() { ctx.getMatrices().popMatrix(); }
    @Override public void translate(float x, float y) { ctx.getMatrices().translate(x, y); }
    @Override public void scale(float sx, float sy) { ctx.getMatrices().scale(sx, sy); }

    private int tint(int c) {
        if (alpha >= 1f) return c;
        return (c & 0x00FFFFFF) | (Math.round(((c >>> 24) & 0xFF) * alpha) << 24);
    }

    /** A coloured triangle list in screen space, drawn as GUI-pipeline quads (last corner repeated). */
    private record Mesh(float[] xy, int[] colors, int count, @Nullable ScreenRect scissorArea, @Nullable ScreenRect bounds)
            implements SimpleGuiElementRenderState {
        @Override
        public void setupVertices(VertexConsumer vertices, float depth) {
            for (int i = 0; i < count; i += 3) {
                int a = i, b = i + 1, c = i + 2;
                // the GUI pipeline culls back faces: keep every triangle in the GUI's winding order
                if ((xy[b * 2] - xy[a * 2]) * (xy[c * 2 + 1] - xy[a * 2 + 1]) - (xy[b * 2 + 1] - xy[a * 2 + 1]) * (xy[c * 2] - xy[a * 2]) > 0) {
                    int t = b; b = c; c = t;
                }
                put(vertices, a, depth); put(vertices, b, depth); put(vertices, c, depth); put(vertices, c, depth);
            }
        }

        private void put(VertexConsumer v, int i, float depth) {
            v.vertex(xy[i * 2], xy[i * 2 + 1], depth).color(colors[i]);
        }

        @Override public RenderPipeline pipeline() { return RenderPipelines.GUI; }
        @Override public TextureSetup textureSetup() { return TextureSetup.empty(); }
    }

    @Override
    public void mesh(int mode, float[] xy, int[] colors, int n) {
        if (n < 3) return;
        int tris = mode == QUADS ? (n / 4) * 2 : mode == TRIANGLES ? n / 3 : n - 2;
        if (tris <= 0) return;
        float[] out = new float[tris * 6];
        int[] col = new int[tris * 3];
        int[] k = {0};
        Matrix3x2f m = new Matrix3x2f(ctx.getMatrices());
        Vector2f tmp = new Vector2f();
        float[] box = {Float.MAX_VALUE, Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
        java.util.function.IntConsumer emit = i -> {
            m.transformPosition(xy[i * 2], xy[i * 2 + 1], tmp);
            int j = k[0]++;
            out[j * 2] = tmp.x;
            out[j * 2 + 1] = tmp.y;
            col[j] = tint(colors[i]);
            box[0] = Math.min(box[0], tmp.x); box[1] = Math.min(box[1], tmp.y);
            box[2] = Math.max(box[2], tmp.x); box[3] = Math.max(box[3], tmp.y);
        };
        switch (mode) {
            case TRIANGLE_FAN:
                for (int i = 1; i + 1 < n; i++) { emit.accept(0); emit.accept(i); emit.accept(i + 1); }
                break;
            case TRIANGLE_STRIP:
                for (int i = 0; i + 2 < n; i++) { emit.accept(i); emit.accept(i + 1); emit.accept(i + 2); }
                break;
            case TRIANGLES:
                for (int i = 0; i + 2 < n; i += 3) { emit.accept(i); emit.accept(i + 1); emit.accept(i + 2); }
                break;
            default:
                for (int i = 0; i + 3 < n; i += 4) {
                    emit.accept(i); emit.accept(i + 1); emit.accept(i + 2);
                    emit.accept(i); emit.accept(i + 2); emit.accept(i + 3);
                }
                break;
        }
        int x0 = (int) Math.floor(box[0]), y0 = (int) Math.floor(box[1]);
        ScreenRect bounds = new ScreenRect(x0, y0, Math.max(1, (int) Math.ceil(box[2]) - x0), Math.max(1, (int) Math.ceil(box[3]) - y0));
        ScreenRect scissor = ctx.scissorStack.peekLast();
        if (scissor != null) {
            bounds = scissor.intersection(bounds);
            if (bounds == null) return;
        }
        ctx.state.addSimpleElement(new Mesh(out, col, k[0], scissor, bounds));
    }

    /** Direct access to the context (nothing is batched here any more). */
    public DrawContext context() {
        return ctx;
    }

    @Override
    public void text(String s, float x, float y, int color, boolean shadow) {
        int c = tint(color);
        if ((c >>> 24) < 4) return; // the text renderer treats a near-zero alpha as opaque
        ctx.getMatrices().pushMatrix();
        ctx.getMatrices().translate(x, y);
        ctx.drawText(MinecraftClient.getInstance().textRenderer, s, 0, 0, c, shadow);
        ctx.getMatrices().popMatrix();
    }

    @Override public int textWidth(String s) { return MinecraftClient.getInstance().textRenderer.getWidth(s); }
    @Override public int fontHeight() { return MinecraftClient.getInstance().textRenderer.fontHeight; }

    @Override
    public void scissor(int x1, int y1, int x2, int y2) {
        // untransformed GUI coordinates, like the 1.21.1 DrawContext
        ctx.getMatrices().pushMatrix();
        ctx.getMatrices().identity();
        ctx.enableScissor(x1, y1, x2, y2);
        ctx.getMatrices().popMatrix();
    }

    @Override public void endScissor() { ctx.disableScissor(); }

    private int white(float a) {
        return (Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | 0xFFFFFF;
    }

    @Override
    public void texture(TextureRef tex, float x, float y, float w, float h, float a) {
        Identifier id = (Identifier) tex.handle;
        MinecraftClient.getInstance().getTextureManager().getTexture(id).setFilter(true, false);
        ctx.getMatrices().pushMatrix();
        ctx.getMatrices().translate(x, y);
        ctx.getMatrices().scale(w / tex.width, h / tex.height);
        ctx.drawTexture(RenderPipelines.GUI_TEXTURED, id, 0, 0, 0, 0, tex.width, tex.height, tex.width, tex.height, white(alpha * a));
        ctx.getMatrices().popMatrix();
    }

    @Override
    public void item(ItemInfo item, int x, int y, boolean overlay) {
        ItemStack s = (ItemStack) item.handle;
        ctx.drawItem(s, x, y);
        if (overlay) ctx.drawStackOverlay(MinecraftClient.getInstance().textRenderer, s, x, y);
    }

    @Override
    public void effectIcon(EffectInfo effect, float x, float y, float size, float a) {
        StatusEffectInstance inst = (StatusEffectInstance) effect.handle;
        ctx.getMatrices().pushMatrix();
        ctx.getMatrices().translate(x, y);
        ctx.getMatrices().scale(size / 18f, size / 18f);
        ctx.drawGuiTexture(RenderPipelines.GUI_TEXTURED, InGameHud.getEffectTexture(inst.getEffectType()), 0, 0, 18, 18, white(a * alpha));
        ctx.getMatrices().popMatrix();
    }

    @Override public void setAlpha(float a) { alpha = a; }
    @Override public float getAlpha() { return alpha; }
    @Override public int width() { return ctx.getScaledWindowWidth(); }
    @Override public int height() { return ctx.getScaledWindowHeight(); }

    /** Nothing to restore with the deferred renderer. */
    public void finish() {}
}
