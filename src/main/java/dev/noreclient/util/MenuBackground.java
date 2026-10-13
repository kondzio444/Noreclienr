package dev.noreclient.util;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.texture.AbstractTexture;
import net.minecraft.util.Identifier;

/**
 * Animated menu backdrop: the JWST "Cosmic Cliffs" photo (NASA/ESA/CSA/STScI, public domain)
 * with a slow Ken-Burns zoom, mouse parallax, twinkling stars and a themed colour grade.
 */
public final class MenuBackground {
    public static final Identifier TEXTURE = Identifier.of("noreclient", "textures/gui/background.png");
    private static final int TEX_W = 1600, TEX_H = 926;
    private static final long START = System.currentTimeMillis();
    private static float parX, parY;

    private MenuBackground() {}

    public static void render(DrawContext ctx, int width, int height, int mouseX, int mouseY) {
        MinecraftClient mc = MinecraftClient.getInstance();
        double t = (System.currentTimeMillis() - START) / 1000.0;

        // smooth parallax that follows the mouse
        float tx = (mouseX - width / 2f) / Math.max(1, width), ty = (mouseY - height / 2f) / Math.max(1, height);
        parX += (tx - parX) * 0.05f;
        parY += (ty - parY) * 0.05f;

        AbstractTexture tex = mc.getTextureManager().getTexture(TEXTURE);
        tex.setFilter(true, false);

        float cover = Math.max(width / (float) TEX_W, height / (float) TEX_H);
        float zoom = 1.12f + 0.05f * (float) Math.sin(t * 0.06);
        float s = cover * zoom;
        float dw = TEX_W * s, dh = TEX_H * s;
        float x = (width - dw) / 2f - parX * width * 0.04f + (float) Math.sin(t * 0.04) * width * 0.015f;
        float y = (height - dh) / 2f - parY * height * 0.04f;

        ctx.draw();
        RenderSystem.enableBlend();
        ctx.getMatrices().push();
        ctx.getMatrices().translate(x, y, 0);
        ctx.getMatrices().scale(s, s, 1);
        ctx.drawTexture(TEXTURE, 0, 0, TEX_W, TEX_H, 0, 0, TEX_W, TEX_H, TEX_W, TEX_H);
        ctx.getMatrices().pop();

        // colour grade: darken + themed tint, stronger at the bottom for readability
        Render2D.quadGradient(ctx, 0, 0, width, height, 0x99080812, 0x80080812, 0xE0050508, 0xE0050508);
        Render2D.quadGradient(ctx, 0, 0, width, height,
                ColorUtil.withAlpha(Theme.accent(), 45), 0x00000000,
                ColorUtil.withAlpha(Theme.accent2(), 40), 0x00000000);

        // twinkling stars drifting slowly
        for (int i = 0; i < 70; i++) {
            double px = ((i * 97.13 + t * (3 + i % 4)) % (width + 20)) - 10 - parX * (i % 3) * 8;
            double py = (i * 53.71 + Math.sin(t * 0.4 + i) * 4) % height - parY * (i % 4) * 6;
            float tw = 0.5f + 0.5f * (float) Math.sin(t * (1.2 + (i % 5) * 0.3) + i);
            float size = 0.5f + (i % 3) * 0.35f;
            Render2D.circle(ctx, (float) px, (float) py, size, ColorUtil.withAlpha(0xFFFFFFFF, (int) (30 + 120 * tw)));
        }
        // vignette
        Render2D.quadGradient(ctx, 0, height * 0.55f, width, height * 0.45f, 0x00000000, 0x00000000, 0xC0000000, 0xC0000000);
    }
}
