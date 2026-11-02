package dev.noreclient.platform;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import com.mojang.blaze3d.vertex.VertexConsumer;
import dev.noreclient.api.EffectInfo;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.TextureRef;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.navigation.ScreenRectangle;
import net.minecraft.client.gui.render.TextureSetup;
import net.minecraft.client.renderer.state.gui.GuiElementRenderState;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.Identifier;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.ItemStack;
import org.jetbrains.annotations.Nullable;
import org.joml.Matrix3x2f;
import org.joml.Vector2f;

/**
 * Gfx on top of the 1.21.9+ deferred GUI renderer.
 *
 * <p>Nothing is drawn immediately any more: every mesh becomes one GUI element (already
 * transformed to screen space, alpha baked into the vertex colours) that the game batches
 * together with its own quads, text and items in submission order.
 */
public final class GfxImpl implements Gfx {
    private final GuiGraphicsExtractor ctx;
    private float alpha = 1f;

    public GfxImpl(GuiGraphicsExtractor ctx) {
        this.ctx = ctx;
    }

    @Override public void push() { ctx.pose().pushMatrix(); }
    @Override public void pop() { ctx.pose().popMatrix(); }
    @Override public void translate(float x, float y) { ctx.pose().translate(x, y); }
    @Override public void scale(float sx, float sy) { ctx.pose().scale(sx, sy); }

    private int tint(int c) {
        if (alpha >= 1f) return c;
        return (c & 0x00FFFFFF) | (Math.round(((c >>> 24) & 0xFF) * alpha) << 24);
    }

    /** A coloured triangle list in screen space, drawn as GUI-pipeline quads (last corner repeated). */
    private record Mesh(float[] xy, int[] colors, int count, @Nullable ScreenRectangle scissorArea, @Nullable ScreenRectangle bounds)
            implements GuiElementRenderState {
        @Override
        public void buildVertices(VertexConsumer vertices) {
            for (int i = 0; i < count; i += 3) {
                int a = i, b = i + 1, c = i + 2;
                // the GUI pipeline culls back faces: keep every triangle in the GUI's winding order
                if ((xy[b * 2] - xy[a * 2]) * (xy[c * 2 + 1] - xy[a * 2 + 1]) - (xy[b * 2 + 1] - xy[a * 2 + 1]) * (xy[c * 2] - xy[a * 2]) > 0) {
                    int t = b; b = c; c = t;
                }
                put(vertices, a); put(vertices, b); put(vertices, c); put(vertices, c);
            }
        }

        private void put(VertexConsumer v, int i) {
            v.addVertex(xy[i * 2], xy[i * 2 + 1], 0).setColor(colors[i]);
        }

        @Override public RenderPipeline pipeline() { return RenderPipelines.GUI; }
        @Override public TextureSetup textureSetup() { return TextureSetup.noTexture(); }
    }

    @Override
    public void mesh(int mode, float[] xy, int[] colors, int n) {
        if (n < 3) return;
        int tris = mode == QUADS ? (n / 4) * 2 : mode == TRIANGLES ? n / 3 : n - 2;
        if (tris <= 0) return;
        float[] out = new float[tris * 6];
        int[] col = new int[tris * 3];
        int[] k = {0};
        Matrix3x2f m = new Matrix3x2f(ctx.pose());
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
        ScreenRectangle bounds = new ScreenRectangle(x0, y0, Math.max(1, (int) Math.ceil(box[2]) - x0), Math.max(1, (int) Math.ceil(box[3]) - y0));
        ScreenRectangle scissor = ctx.scissorStack.peek();
        if (scissor != null) {
            bounds = scissor.intersection(bounds);
            if (bounds == null) return;
        }
        ctx.guiRenderState.addGuiElement(new Mesh(out, col, k[0], scissor, bounds));
    }

    /** Direct access to the context (nothing is batched here any more). */
    public GuiGraphicsExtractor context() {
        return ctx;
    }

    @Override
    public void text(String s, float x, float y, int color, boolean shadow) {
        int c = tint(color);
        if ((c >>> 24) < 4) return; // the text renderer treats a near-zero alpha as opaque
        ctx.pose().pushMatrix();
        ctx.pose().translate(x, y);
        ctx.text(Minecraft.getInstance().font, s, 0, 0, c, shadow);
        ctx.pose().popMatrix();
    }

    @Override public int textWidth(String s) { return Minecraft.getInstance().font.width(s); }
    @Override public int fontHeight() { return Minecraft.getInstance().font.lineHeight; }

    @Override
    public void scissor(int x1, int y1, int x2, int y2) {
        // untransformed GUI coordinates, like the 1.21.1 DrawContext
        ctx.pose().pushMatrix();
        ctx.pose().identity();
        ctx.enableScissor(x1, y1, x2, y2);
        ctx.pose().popMatrix();
    }

    @Override public void endScissor() { ctx.disableScissor(); }

    private int white(float a) {
        return (Math.round(Math.max(0, Math.min(1, a)) * 255) << 24) | 0xFFFFFF;
    }

    @Override
    public void texture(TextureRef tex, float x, float y, float w, float h, float a) {
        Identifier id = (Identifier) tex.handle;
        ctx.pose().pushMatrix();
        ctx.pose().translate(x, y);
        ctx.pose().scale(w / tex.width, h / tex.height);
        ctx.blit(RenderPipelines.GUI_TEXTURED, id, 0, 0, 0, 0, tex.width, tex.height, tex.width, tex.height, white(alpha * a));
        ctx.pose().popMatrix();
    }

    @Override
    public void item(ItemInfo item, int x, int y, boolean overlay) {
        ItemStack s = (ItemStack) item.handle;
        ctx.item(s, x, y);
        if (overlay) ctx.itemDecorations(Minecraft.getInstance().font, s, x, y);
    }

    @Override
    public void effectIcon(EffectInfo effect, float x, float y, float size, float a) {
        MobEffectInstance inst = (MobEffectInstance) effect.handle;
        ctx.pose().pushMatrix();
        ctx.pose().translate(x, y);
        ctx.pose().scale(size / 18f, size / 18f);
        ctx.blitSprite(RenderPipelines.GUI_TEXTURED, Gui.getMobEffectSprite(inst.getEffect()), 0, 0, 18, 18, white(a * alpha));
        ctx.pose().popMatrix();
    }

    @Override public void setAlpha(float a) { alpha = a; }
    @Override public float getAlpha() { return alpha; }
    @Override public int width() { return ctx.guiWidth(); }
    @Override public int height() { return ctx.guiHeight(); }

    /** Nothing to restore with the deferred renderer. */
    public void finish() {}
}
