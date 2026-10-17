package dev.noreclient.cosmetic;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Game;
import dev.noreclient.api.Platform;
import dev.noreclient.api.TextureRef;
import dev.noreclient.module.social.Cosmetics;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The wardrobe ("Szatnia"): wings and hats worn by the local player next to the Nore cape.
 * Platforms draw {@link #local(boolean)} from a player feature renderer: every piece is attached to
 * the head or body part of the player model, uses its own texture and an entity cutout (no cull)
 * render type.
 */
public final class Wardrobe {
    public enum Part { HEAD, BODY }

    public static final String NONE = "Brak";
    public static final String[] WINGS = {NONE, "Skrzydła Nietoperza"};
    public static final String[] HATS = {NONE, "Kapelusz Wiedźmy"};

    /** Quads of one worn item for this frame. */
    public static final class Piece {
        public final Part part;
        public final TextureRef texture;
        public final List<Mesh.Quad> quads;

        Piece(Part part, TextureRef texture, List<Mesh.Quad> quads) { this.part = part; this.texture = texture; this.quads = quads; }
    }

    private static TextureRef hatTex, wingTex;
    private static boolean hatFailed, wingFailed;
    private static long last;
    private static float flight, motion;

    private Wardrobe() {}

    private static Cosmetics module() {
        NoreClient c = NoreClient.get();
        return c == null ? null : c.modules().get(Cosmetics.class);
    }

    public static String wings() {
        Cosmetics m = module();
        return m == null || !m.isEnabled() ? NONE : m.wings.get();
    }

    public static String hat() {
        Cosmetics m = module();
        return m == null || !m.isEnabled() ? NONE : m.hat.get();
    }

    /** True when the local player wears wings or a hat (cheap check before {@link #local}). */
    public static boolean active() { return !NONE.equals(wings()) || !NONE.equals(hat()); }

    /** Seconds since start, for the animations. */
    static float time() { return (System.nanoTime() / 1_000_000L % 3_600_000L) / 1000f; }

    /** Smooths how much the player is flying (wing beat) and moving (hat sway) – called once per frame. */
    private static void track() {
        long now = System.nanoTime();
        float dt = last == 0 ? 0 : Math.min(0.25f, (now - last) / 1e9f);
        last = now;
        float wantFlight = 0, wantMotion = 0;
        try {
            Game g = Platform.game();
            if (g.flying() || g.fallFlying() || g.velocityY() < -0.55) wantFlight = 1;
            double h = Math.sqrt(g.velocityX() * g.velocityX() + g.velocityZ() * g.velocityZ());
            wantMotion = (float) Math.min(1, h / 0.28);
        } catch (Throwable ignored) { /* no player */ }
        flight += (wantFlight - flight) * Math.min(1, dt * 3.5f);
        motion += (wantMotion - motion) * Math.min(1, dt * 4f);
    }

    /** Items worn by the local player this frame (render thread). helmet: something is on the head slot. */
    public static List<Piece> local(boolean helmet) {
        String w = wings(), h = hat();
        if (NONE.equals(w) && NONE.equals(h)) return Collections.emptyList();
        track();
        List<Piece> out = new ArrayList<Piece>(2);
        float t = time();
        if (!NONE.equals(h) && !helmet) {
            TextureRef tex = hatTexture();
            if (tex != null) {
                Mesh m = new Mesh();
                WitchHat.build(m, t, motion);
                out.add(new Piece(Part.HEAD, tex, m.quads));
            }
        }
        if (!NONE.equals(w)) {
            TextureRef tex = wingTexture();
            if (tex != null) {
                Mesh m = new Mesh();
                BatWings.build(m, t, flight);
                out.add(new Piece(Part.BODY, tex, m.quads));
            }
        }
        return out;
    }

    static TextureRef hatTexture() {
        if (hatTex == null && !hatFailed) {
            hatTex = Platform.game().loadTexture("wardrobe/witch_hat", png(hatImage()));
            hatFailed = hatTex == null;
        }
        return hatTex;
    }

    static TextureRef wingTexture() {
        if (wingTex == null && !wingFailed) {
            wingTex = Platform.game().loadTexture("wardrobe/bat_wings", png(wingImage()));
            wingFailed = wingTex == null;
        }
        return wingTex;
    }

    private static BufferedImage hatImg, wingImg;

    static synchronized BufferedImage hatImage() {
        if (hatImg == null) hatImg = WitchHat.texture();
        return hatImg;
    }

    static synchronized BufferedImage wingImage() {
        if (wingImg == null) wingImg = BatWings.texture();
        return wingImg;
    }

    /** Builds the hat for the wardrobe preview. */
    static List<Mesh.Quad> hatMesh(float time, float motion) {
        Mesh m = new Mesh();
        WitchHat.build(m, time, motion);
        return m.quads;
    }

    static List<Mesh.Quad> wingMesh(float time, float flight) {
        Mesh m = new Mesh();
        BatWings.build(m, time, flight);
        return m.quads;
    }

    static byte[] png(BufferedImage img) {
        try {
            System.setProperty("java.awt.headless", "true");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            javax.imageio.ImageIO.write(img, "png", out);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }
}
