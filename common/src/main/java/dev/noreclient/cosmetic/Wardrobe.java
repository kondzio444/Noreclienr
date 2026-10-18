package dev.noreclient.cosmetic;

import com.google.gson.JsonObject;
import dev.noreclient.NoreClient;
import dev.noreclient.api.TextureRef;
import dev.noreclient.module.social.Cosmetics;
import dev.noreclient.util.Capes;
import dev.noreclient.util.NoreHub;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The wardrobe ("Szatnia"): capes, wings, hats, ears, tails and auras. Every player renderer asks
 * {@link #pieces} for the items one player wears this frame – the local player wears the look saved
 * in the config, other Nore players the look the Nore Hub reports for them, and the wardrobe preview
 * the look being edited. Each piece is attached to the head or body part of the player model and is
 * drawn with an entity cutout (no cull) render type, or additively and full bright for glow.
 */
public final class Wardrobe {
    public enum Part { HEAD, BODY }

    /** Piece modes: lit cutout, additive full-bright glow. */
    public static final int CUTOUT = 0, GLOW = 1;
    /** Who a render is for. */
    public static final int LOCAL = 0, OTHER = 1, PREVIEW = 2;
    /** Entity id the platforms give the wardrobe preview's fake player. */
    public static final int PREVIEW_ID = -0x4E0E;

    /** Quads of one worn item for this frame. */
    public static final class Piece {
        public final Part part;
        public final TextureRef texture;
        public final int mode;
        public final List<Mesh.Quad> quads;

        Piece(Part part, TextureRef texture, int mode, List<Mesh.Quad> quads) {
            this.part = part;
            this.texture = texture;
            this.mode = mode;
            this.quads = quads;
        }

        public boolean glow() { return mode == GLOW; }
    }

    private static Look local;
    private static String publishedJson;
    private static final Map<String, Wearer> WEARERS = new HashMap<String, Wearer>();
    private static final Map<String, Look> PARSED = new LinkedHashMap<String, Look>(16, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Look> e) { return size() > 128; }
    };
    private static long lastSweep;

    /** The look shown on the wardrobe preview (the one being edited). */
    public static volatile Look previewLook = Look.EMPTY;
    /** Preview pose: 0 standing, 1 walking, 2 flying, 3 sneaking. */
    public static volatile int previewPose;
    /** Platform-independent motion of the preview player (filled by {@link #previewState}). */
    private static final WearerState PREVIEW_STATE = new WearerState();
    private static final long START = System.nanoTime();

    private Wardrobe() {}

    // ------------------------------------------------------------------ the local look

    private static Cosmetics module() {
        NoreClient c = NoreClient.get();
        return c == null ? null : c.modules().get(Cosmetics.class);
    }

    /** The look saved for the local player (also when the cosmetics are switched off). */
    public static synchronized Look localLook() {
        if (local == null) {
            Cosmetics m = module();
            if (m == null) return Look.EMPTY;
            local = m.loadLook();
        }
        return local;
    }

    /** Saves the local look (config and Nore Hub). */
    public static void setLocalLook(Look look) { setLocalLook(look, true); }

    /**
     * Changes the local look; persist = false only updates it in memory (while a slider is being
     * dragged), a later call with persist = true writes the config and publishes it.
     */
    public static synchronized void setLocalLook(Look look, boolean persist) {
        local = look == null ? Look.EMPTY : look;
        Cosmetics m = module();
        if (m != null) {
            m.storeLook(local);
            if (persist) {
                if (!local.isEmpty() && !m.isEnabled()) m.setEnabled(true);
                NoreClient.get().config().save();
            }
        }
        if (persist) publish();
    }

    /** What others see of us: the look while the cosmetics are on, nothing when they are off. */
    public static JsonObject publishedLook() {
        Cosmetics m = module();
        Look l = m == null || !m.isEnabled() ? Look.EMPTY : localLook();
        Look visible = l;
        // the secret items stay private until found (the hub only carries what we really wear)
        for (Map.Entry<Slot, Worn> e : l.slots().entrySet()) {
            Item it = Items.get(e.getValue().id);
            if (it != null && it.secret && !SecretEars.unlocked()) visible = visible.with(e.getKey(), null);
        }
        return visible.toJson();
    }

    /** Publishes the local look through the Nore Hub when it changed since the last publish. */
    public static void publish() {
        if (NoreClient.get() == null) return;
        JsonObject o = publishedLook();
        String s = o.toString();
        if (s.equals(publishedJson)) return;
        publishedJson = s;
        try {
            NoreHub.publish(o);
        } catch (Throwable t) {
            NoreClient.LOGGER.warning("Nore Hub publish failed: " + t);
        }
    }

    /** Local player: the look while the cosmetics module is on. */
    private static Look activeLocal() {
        Cosmetics m = module();
        return m == null || !m.isEnabled() ? Look.EMPTY : localLook();
    }

    /** The look another player wears according to the Nore Hub (parsed once per JSON string). */
    public static Look lookOf(String name) {
        if (name == null) return Look.EMPTY;
        NoreHub.Entry e;
        try {
            e = NoreHub.get(name);
        } catch (Throwable t) {
            return Look.EMPTY;
        }
        if (e == null || e.cosmetics == null) return Look.EMPTY;
        String json = e.cosmetics.toString();
        synchronized (PARSED) {
            Look l = PARSED.get(json);
            if (l == null) PARSED.put(json, l = Look.parse(e.cosmetics));
            return l;
        }
    }

    /** Cape another player wears according to the Nore Hub, or null (for the platforms' cape hook). */
    public static TextureRef capeOf(String name, int frame) {
        Worn w = lookOf(name).get(Slot.CAPE);
        if (w == null) return null;
        String cape = Capes.byId(w.id);
        return cape == null ? null : Capes.texture(cape, w.anim ? frame : 0);
    }

    // ------------------------------------------------------------------ rendering

    /** True when the local player wears anything besides a cape (cheap check before {@link #pieces}). */
    public static boolean active() {
        Look l = activeLocal();
        for (Slot s : l.slots().keySet()) if (s != Slot.CAPE) return true;
        return false;
    }

    /** The look for a render: local player, another player, or the wardrobe preview. */
    public static Look lookFor(int who, String name) {
        return who == LOCAL ? activeLocal() : who == PREVIEW ? previewLook : lookOf(name);
    }

    /** True when the player wears something to draw (cheap, before filling a state). */
    public static boolean wears(int who, String name) {
        Look l = lookFor(who, name);
        for (Slot s : l.slots().keySet()) if (s != Slot.CAPE) return true;
        return false;
    }

    /** Items worn by one player this frame (render thread). */
    public static List<Piece> pieces(int who, WearerState s) {
        Look look = lookFor(who, s.name);
        if (look.isEmpty()) return Collections.emptyList();
        long now = System.nanoTime();
        String key = who == PREVIEW ? "\u0000preview" : who == LOCAL ? "\u0000local" : s.name.toLowerCase();
        Wearer w = WEARERS.get(key);
        if (w == null) WEARERS.put(key, w = new Wearer(key));
        w.update(s, now);
        if (now - lastSweep > 10_000_000_000L) {
            lastSweep = now;
            for (Iterator<Wearer> it = WEARERS.values().iterator(); it.hasNext(); ) if (now - it.next().seen > 30_000_000_000L) it.remove();
        }
        boolean secretOk = who != LOCAL || SecretEars.unlocked();
        List<Piece> out = new ArrayList<Piece>(4);
        for (Map.Entry<Slot, Worn> e : look.slots().entrySet()) {
            Slot slot = e.getKey();
            if (slot == Slot.CAPE) continue;
            Worn worn = e.getValue();
            Item item = Items.get(worn.id);
            if (item == null || (item.secret && !secretOk)) continue;
            if (s.helmet && (slot == Slot.HAT || slot == Slot.EARS)) continue;
            if (slot == Slot.EARS && look.get(Slot.HAT) != null) continue; // a hat squashes the ears
            if (s.elytra && slot == Slot.WINGS) continue;
            if (worn.anim) w.advance(slot, worn.speed);
            Textures.Atlas atlas = Textures.get(item, worn);
            if (atlas == null) continue;
            Item.Build b = build(item, worn, w, false);
            emit(out, item, b, atlas.tex);
        }
        return out;
    }

    /** Runs the item's builder with the right clock (frozen and at rest when its animation is off). */
    static Item.Build build(Item item, Worn worn, Wearer w, boolean preview) {
        Wearer src = worn.anim ? w : Wearer.REST;
        Item.Build b = new Item.Build(worn, src, worn.anim ? src.phase[item.slot.ordinal()] : 0, preview);
        try {
            item.build(b);
        } catch (Throwable t) {
            // a broken item must never take the player renderer down
        }
        return b;
    }

    private static void emit(List<Piece> out, Item item, Item.Build b, TextureRef tex) {
        boolean atlas = Textures.atlas(item);
        float vs = atlas ? 0.5f : 1f;
        emit(out, Part.HEAD, b.head, b.glowHead, tex, vs, atlas && b.glow());
        emit(out, Part.BODY, b.body, b.glowBody, tex, vs, atlas && b.glow());
    }

    private static void emit(List<Piece> out, Part part, Mesh base, Mesh extraGlow, TextureRef tex, float vs, boolean glow) {
        if (!base.quads.isEmpty()) {
            Mesh m = new Mesh();
            m.addAll(base.quads, vs, 0, -1);
            out.add(new Piece(part, tex, CUTOUT, m.quads));
        }
        if (glow) {
            Mesh g = new Mesh();
            g.addAll(base.quads, vs, 0.5f, -1);
            g.addAll(extraGlow.quads, vs, 0.5f, -1);
            if (!g.quads.isEmpty()) out.add(new Piece(part, tex, GLOW, g.quads));
        }
    }

    // ------------------------------------------------------------------ preview

    /** Seconds since start (preview clock). */
    public static float time() { return (System.nanoTime() - START) / 1e9f; }

    /**
     * Motion of the preview player for the selected pose; platforms copy it into their fake render
     * state (limb swing, sneaking) and pass it back to {@link #pieces} with {@link #PREVIEW}.
     */
    public static WearerState previewState() {
        WearerState s = PREVIEW_STATE;
        float t = time();
        int pose = previewPose;
        s.name = "\u0000preview";
        s.vx = s.vy = s.vz = 0;
        s.headYaw = (float) Math.sin(t * 0.7) * 12f;
        s.headPitch = (float) Math.sin(t * 0.45) * 6f;
        s.bodyYaw = 0;
        s.onGround = pose != 2;
        s.sneaking = pose == 3;
        s.flying = pose == 2;
        s.sprinting = false;
        s.gliding = false;
        s.hurtTime = 0;
        s.helmet = false;
        s.elytra = false;
        if (pose == 1 || pose == 3) {
            float v = pose == 1 ? 0.21f : 0.065f;
            s.vz = v; // walking forward (body yaw 0 faces +z)
            s.limbSwing = t * (pose == 1 ? 9.5f : 5f);
            s.limbAmount = pose == 1 ? 0.7f : 0.5f;
        } else if (pose == 2) {
            s.vz = 0.35f;
            s.vy = Math.sin(t * 1.6) * 0.03;
            s.limbSwing = t * 2f;
            s.limbAmount = 0.12f;
        } else {
            s.limbSwing = 0;
            s.limbAmount = 0;
        }
        return s;
    }

    /** Cape worn in the preview (null = none). */
    public static String previewCape() {
        Worn w = previewLook.get(Slot.CAPE);
        return w == null ? null : Capes.byId(w.id);
    }

    /** Animation frame for capes (the module's cape animation clock). */
    public static int capeFrame(Worn w) {
        if (w == null || !w.anim) return 0;
        return (int) (System.currentTimeMillis() / 150 % Capes.FRAMES);
    }

    // ------------------------------------------------------------------ small software previews

    /** Builds one item standing alone (grid icons). */
    static Item.Build buildAlone(Item item, Worn worn) {
        Wearer w = WEARERS.get("\u0000icons");
        if (w == null) WEARERS.put("\u0000icons", w = new Wearer("icons"));
        WearerState s = new WearerState();
        w.update(s, System.nanoTime());
        w.phase[item.slot.ordinal()] = time() * worn.speed;
        return build(item, worn, w, true);
    }
}
