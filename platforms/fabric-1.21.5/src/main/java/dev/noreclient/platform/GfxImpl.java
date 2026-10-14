package dev.noreclient.platform;

import dev.noreclient.api.EffectInfo;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.TextureRef;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.BufferBuilder;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.util.BufferAllocator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.render.VertexFormats;
import net.minecraft.client.texture.Sprite;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Identifier;
import org.joml.Matrix4f;

/**
 * Gfx on top of the 1.21.5 DrawContext (render pipelines: no shader colour, alpha is baked into vertices).
 *
 * <p>Performance: all shapes are converted to triangles (already transformed by the current
 * matrix, alpha baked into the vertex colour) and collected in one buffer, which is drawn in a
 * single call only when something else has to be drawn on top (text, textures, items), when the
 * scissor changes, or at {@link #finish()}. Text is queued in the DrawContext's own batch. A HUD
 * or menu that used to issue hundreds of draw calls per frame now issues a handful.
 */
public final class GfxImpl implements Gfx {
    private static final BufferAllocator ALLOCATOR = new BufferAllocator(1 << 18);

    private final DrawContext ctx;
    private float alpha = 1f;
    private BufferBuilder batch;
    private int batched;

    public GfxImpl(DrawContext ctx) {
        this.ctx = ctx;
    }

    @Override public void push() { ctx.getMatrices().push(); }
    @Override public void pop() { ctx.getMatrices().pop(); }
    @Override public void translate(float x, float y) { ctx.getMatrices().translate(x, y, 0); }
    @Override public void scale(float sx, float sy) { ctx.getMatrices().scale(sx, sy, 1); }

    private static VertexFormat.DrawMode mode(int m) {
        switch (m) {
            case TRIANGLE_FAN: return VertexFormat.DrawMode.TRIANGLE_FAN;
            case TRIANGLE_STRIP: return VertexFormat.DrawMode.TRIANGLE_STRIP;
            case TRIANGLES: return VertexFormat.DrawMode.TRIANGLES;
            default: return VertexFormat.DrawMode.QUADS;
        }
    }

    private int tint(int c) {
        if (alpha >= 1f) return c;
        return (c & 0x00FFFFFF) | (Math.round(((c >>> 24) & 0xFF) * alpha) << 24);
    }

    private void vertex(Matrix4f m, float[] xy, int[] colors, int i) {
        batch.vertex(m, xy[i * 2], xy[i * 2 + 1], 0).color(tint(colors[i]));
        batched++;
    }

    /** The GUI pipeline draws quads: a triangle is sent as a quad with its last corner repeated. */
    private void tri(Matrix4f m, float[] xy, int[] colors, int a, int b, int c) {
        // the pipeline culls back faces: keep every triangle in the GUI's winding order
        if (cross(xy, a, b, c) > 0) { int t = b; b = c; c = t; }
        vertex(m, xy, colors, a); vertex(m, xy, colors, b); vertex(m, xy, colors, c); vertex(m, xy, colors, c);
    }

    private static float cross(float[] xy, int a, int b, int c) {
        return (xy[b * 2] - xy[a * 2]) * (xy[c * 2 + 1] - xy[a * 2 + 1]) - (xy[b * 2 + 1] - xy[a * 2 + 1]) * (xy[c * 2] - xy[a * 2]);
    }

    @Override
    public void mesh(int mode, float[] xy, int[] colors, int n) {
        if (n < 3) return;
        if (batch == null) batch = new BufferBuilder(ALLOCATOR, VertexFormat.DrawMode.QUADS, VertexFormats.POSITION_COLOR);
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        switch (mode) {
            case TRIANGLE_FAN:
                for (int i = 1; i + 1 < n; i++) tri(m, xy, colors, 0, i, i + 1);
                break;
            case TRIANGLE_STRIP:
                for (int i = 0; i + 2 < n; i++) {
                    if ((i & 1) == 0) tri(m, xy, colors, i, i + 1, i + 2);
                    else tri(m, xy, colors, i + 1, i, i + 2);
                }
                break;
            case TRIANGLES:
                for (int i = 0; i + 2 < n; i += 3) tri(m, xy, colors, i, i + 1, i + 2);
                break;
            default: // quads
                for (int i = 0; i + 3 < n; i += 4) {
                    if (cross(xy, i, i + 1, i + 2) > 0) { vertex(m, xy, colors, i); vertex(m, xy, colors, i + 3); vertex(m, xy, colors, i + 2); vertex(m, xy, colors, i + 1); }
                    else { vertex(m, xy, colors, i); vertex(m, xy, colors, i + 1); vertex(m, xy, colors, i + 2); vertex(m, xy, colors, i + 3); }
                }
                break;
        }
    }

    /** Draws whatever is queued: first the DrawContext's own batch (earlier text), then our shapes. */
    /** Draws everything batched so far and gives direct access to the context. */
    public DrawContext context() {
        flush();
        return ctx;
    }

    private void flush() {
        ctx.draw();
        if (batch == null) return;
        BufferBuilder b = batch;
        batch = null;
        if (batched == 0) {
            b.endNullable();
            return;
        }
        batched = 0;
        // endNullable: a nested frame (e.g. "Preparing for world creation") may have reset the shared allocator
        net.minecraft.client.render.BuiltBuffer built = b.endNullable();
        if (built != null) RenderLayer.getGui().draw(built);
    }

    @Override
    public void text(String s, float x, float y, int color, boolean shadow) {
        if (batched > 0) flush();
        // queued in the DrawContext's batch (drawn together with neighbouring text)
        int c = tint(color);
        if ((c >>> 24) < 4) return; // the text renderer treats a near-zero alpha as opaque
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        ctx.draw(vc -> MinecraftClient.getInstance().textRenderer.draw(s, x, y, c, shadow, m, vc, TextRenderer.TextLayerType.NORMAL, 0, 0xF000F0));
    }

    @Override public int textWidth(String s) { return MinecraftClient.getInstance().textRenderer.getWidth(s); }
    @Override public int fontHeight() { return MinecraftClient.getInstance().textRenderer.fontHeight; }
    @Override public void scissor(int x1, int y1, int x2, int y2) { flush(); ctx.enableScissor(x1, y1, x2, y2); }
    @Override public void endScissor() { flush(); ctx.disableScissor(); }

    @Override
    public void texture(TextureRef tex, float x, float y, float w, float h, float a) {
        flush();
        Identifier id = (Identifier) tex.handle;
        MinecraftClient.getInstance().getTextureManager().getTexture(id).setFilter(true, false);
        int col = (Math.round(Math.max(0, Math.min(1, alpha * a)) * 255) << 24) | 0xFFFFFF;
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.getMatrices().scale(w / tex.width, h / tex.height, 1);
        ctx.drawTexture(RenderLayer::getGuiTextured, id, 0, 0, 0, 0, tex.width, tex.height, tex.width, tex.height, tex.width, tex.height, col);
        ctx.getMatrices().pop();
        ctx.draw();
    }

    @Override
    public void item(ItemInfo item, int x, int y, boolean overlay) {
        flush();
        ItemStack s = (ItemStack) item.handle;
        ctx.drawItem(s, x, y);
        if (overlay) ctx.drawStackOverlay(MinecraftClient.getInstance().textRenderer, s, x, y);
    }

    @Override
    public void effectIcon(EffectInfo effect, float x, float y, float size, float a) {
        flush();
        StatusEffectInstance inst = (StatusEffectInstance) effect.handle;
        Sprite sprite = MinecraftClient.getInstance().getStatusEffectSpriteManager().getSprite(inst.getEffectType());
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.getMatrices().scale(size / 18f, size / 18f, 1);
        ctx.drawSpriteStretched(RenderLayer::getGuiTextured, sprite, 0, 0, 18, 18, (Math.round(Math.max(0, Math.min(1, a * alpha)) * 255) << 24) | 0xFFFFFF);
        ctx.getMatrices().pop();
    }

    @Override
    public void setAlpha(float a) {
        if (a == alpha) return;
        // queued text uses the shader colour at draw time, so draw it with the old alpha first
        flush();
        alpha = a;
    }

    @Override public float getAlpha() { return alpha; }
    @Override public int width() { return ctx.getScaledWindowWidth(); }
    @Override public int height() { return ctx.getScaledWindowHeight(); }

    /** Restores render state after core drawing. */
    public void finish() {
        flush();
    }
}
