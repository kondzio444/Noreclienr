package dev.noreclient.platform;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.noreclient.api.EffectInfo;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.TextureRef;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.BufferBuilder;
import net.minecraft.client.render.BufferRenderer;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.render.Tessellator;
import net.minecraft.client.render.VertexFormat;
import net.minecraft.client.render.VertexFormats;
import net.minecraft.client.texture.Sprite;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Identifier;
import org.joml.Matrix4f;

/** Gfx on top of 1.20–1.21.1 DrawContext + immediate mode buffers. */
public final class GfxImpl implements Gfx {
    private final DrawContext ctx;
    private float alpha = 1f;

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

    @Override
    public void mesh(int mode, float[] xy, int[] colors, int n) {
        if (n == 0) return;
        Matrix4f m = ctx.getMatrices().peek().getPositionMatrix();
        ctx.draw();
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        RenderSystem.disableCull();
        RenderSystem.disableDepthTest();
        RenderSystem.setShader(GameRenderer::getPositionColorProgram);
        BufferBuilder b = Tessellator.getInstance().begin(mode(mode), VertexFormats.POSITION_COLOR);
        for (int i = 0; i < n; i++) b.vertex(m, xy[i * 2], xy[i * 2 + 1], 0).color(colors[i]);
        BufferRenderer.drawWithGlobalProgram(b.end());
        RenderSystem.enableDepthTest();
        RenderSystem.enableCull();
        RenderSystem.disableBlend();
    }

    @Override
    public void text(String s, float x, float y, int color, boolean shadow) {
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.drawText(MinecraftClient.getInstance().textRenderer, s, 0, 0, color, shadow);
        ctx.getMatrices().pop();
    }

    @Override public int textWidth(String s) { return MinecraftClient.getInstance().textRenderer.getWidth(s); }
    @Override public int fontHeight() { return MinecraftClient.getInstance().textRenderer.fontHeight; }
    @Override public void scissor(int x1, int y1, int x2, int y2) { ctx.enableScissor(x1, y1, x2, y2); }
    @Override public void endScissor() { ctx.disableScissor(); }

    @Override
    public void texture(TextureRef tex, float x, float y, float w, float h, float a) {
        Identifier id = (Identifier) tex.handle;
        MinecraftClient.getInstance().getTextureManager().getTexture(id).setFilter(true, false);
        ctx.draw();
        RenderSystem.enableBlend();
        RenderSystem.setShaderColor(1, 1, 1, alpha * a);
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.getMatrices().scale(w / tex.width, h / tex.height, 1);
        ctx.drawTexture(id, 0, 0, tex.width, tex.height, 0, 0, tex.width, tex.height, tex.width, tex.height);
        ctx.getMatrices().pop();
        ctx.draw();
        RenderSystem.setShaderColor(1, 1, 1, alpha);
    }

    @Override
    public void item(ItemInfo item, int x, int y, boolean overlay) {
        ItemStack s = (ItemStack) item.handle;
        ctx.drawItem(s, x, y);
        if (overlay) ctx.drawItemInSlot(MinecraftClient.getInstance().textRenderer, s, x, y);
    }

    @Override
    public void effectIcon(EffectInfo effect, float x, float y, float size, float a) {
        StatusEffectInstance inst = (StatusEffectInstance) effect.handle;
        Sprite sprite = MinecraftClient.getInstance().getStatusEffectSpriteManager().getSprite(inst.getEffectType());
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.getMatrices().scale(size / 18f, size / 18f, 1);
        ctx.drawSprite(0, 0, 0, 18, 18, sprite, 1f, 1f, 1f, a * alpha);
        ctx.getMatrices().pop();
    }

    @Override
    public void setAlpha(float a) {
        alpha = a;
        ctx.draw();
        RenderSystem.setShaderColor(1, 1, 1, a);
    }

    @Override public float getAlpha() { return alpha; }
    @Override public int width() { return ctx.getScaledWindowWidth(); }
    @Override public int height() { return ctx.getScaledWindowHeight(); }

    /** Restores render state after core drawing. */
    public void finish() {
        ctx.draw();
        RenderSystem.setShaderColor(1, 1, 1, 1);
    }
}
