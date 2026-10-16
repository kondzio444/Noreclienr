package dev.noreclient.util;

import dev.noreclient.api.Gfx;
import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;

/**
 * Animated menu backdrop: the JWST "Cosmic Cliffs" photo (NASA/ESA/CSA/STScI, public domain)
 * with a slow Ken-Burns zoom, mouse parallax, twinkling stars and a themed colour grade.
 */
public final class MenuBackground {
    private static final long START = System.currentTimeMillis();
    private static float parX, parY;

    private MenuBackground() {}

    private static String mode() {
        try {
            return dev.noreclient.NoreClient.get().modules().get(dev.noreclient.module.client.ClientSettings.class).menuBackground.get();
        } catch (Exception e) {
            return "Panorama";
        }
    }

    public static void render(Gfx g, int width, int height, int mouseX, int mouseY) {
        double t = (System.currentTimeMillis() - START) / 1000.0;
        float tx = (mouseX - width / 2f) / Math.max(1, width), ty = (mouseY - height / 2f) / Math.max(1, height);
        parX += (tx - parX) * 0.05f;
        parY += (ty - parY) * 0.05f;
        String mode = mode();
        if (mode.startsWith("Scena")) {
            dev.noreclient.module.client.ClientSettings cs = dev.noreclient.NoreClient.get().modules().get(dev.noreclient.module.client.ClientSettings.class);
            NoreScene.render(g, width, height, cs.sceneMinutes());
            Render2D.quadGradient(g, 0, 0, width, height, 0x700A0614, 0x200A0614, 0x200A0614, 0x700A0614);
            Render2D.quadGradient(g, 0, height * 0.62f, width, height * 0.38f, 0, 0, 0x90050308, 0x90050308);
            return;
        }
        if (mode.startsWith("Panorama")) {
            // Minecraft's own rotating panorama with the Nore colour grade
            Platform.game().renderPanorama(g, 1f);
            Render2D.quadGradient(g, 0, 0, width, height, 0x70080606, 0x30080606, 0x90050404, 0xC0050404);
            Render2D.quadGradient(g, 0, 0, width, height, ColorUtil.withAlpha(Theme.accent(), 38), 0, ColorUtil.withAlpha(Theme.accent2(), 30), 0);
            if (mode.endsWith("gwiazdy")) stars(g, width, height, t);
            Render2D.quadGradient(g, 0, height * 0.6f, width, height * 0.4f, 0, 0, 0xB0000000, 0xB0000000);
            return;
        }

        TextureRef tex = BundledTextures.background();
        if (tex != null) {
            float cover = Math.max(width / (float) tex.width, height / (float) tex.height);
            float zoom = 1.12f + 0.05f * (float) Math.sin(t * 0.06);
            float s = cover * zoom;
            float dw = tex.width * s, dh = tex.height * s;
            float x = (width - dw) / 2f - parX * width * 0.04f + (float) Math.sin(t * 0.04) * width * 0.015f;
            float y = (height - dh) / 2f - parY * height * 0.04f;
            g.texture(tex, x, y, dw, dh, 1f);
        } else {
            Render2D.rect(g, 0, 0, width, height, 0xFF0B0812);
        }
        Render2D.quadGradient(g, 0, 0, width, height, 0x99080812, 0x80080812, 0xE0050508, 0xE0050508);
        Render2D.quadGradient(g, 0, 0, width, height, ColorUtil.withAlpha(Theme.accent(), 45), 0, ColorUtil.withAlpha(Theme.accent2(), 40), 0);
        stars(g, width, height, t);
        Render2D.quadGradient(g, 0, height * 0.55f, width, height * 0.45f, 0, 0, 0xC0000000, 0xC0000000);
    }

    private static void stars(Gfx g, int width, int height, double t) {
        for (int i = 0; i < 70; i++) {
            double px = ((i * 97.13 + t * (3 + i % 4)) % (width + 20)) - 10 - parX * (i % 3) * 8;
            double py = (i * 53.71 + Math.sin(t * 0.4 + i) * 4) % height - parY * (i % 4) * 6;
            float tw = 0.5f + 0.5f * (float) Math.sin(t * (1.2 + (i % 5) * 0.3) + i);
            float size = 0.5f + (i % 3) * 0.35f;
            Render2D.circle(g, (float) px, (float) py, size, ColorUtil.withAlpha(0xFFFFFFFF, (int) (30 + 120 * tw)));
        }
    }
}
