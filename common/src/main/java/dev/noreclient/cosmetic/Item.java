package dev.noreclient.cosmetic;

import java.awt.image.BufferedImage;

/**
 * One wardrobe item: a procedural texture (painted with java.awt in the chosen colour and variant)
 * and geometry rebuilt every frame from the wearer's animation state. Items with a glow option also
 * paint a glow mask (black = no glow) that is drawn additively, full bright, over the same quads.
 */
public abstract class Item {
    public final String id, name, description;
    public final Slot slot;
    public int defaultColor = 0xFFFFFF;
    /** Suggested colours (RGB) shown as swatches. */
    public int[] palette = new int[0];
    public String[] variants = new String[0], variantNames = new String[0];
    public boolean colorOption = true, glowOption, glowDefault, animOption = true, speedOption = true, scaleOption = true;
    /** Locked until the secret is found (see {@link SecretEars}). */
    public boolean secret;
    /** Texture size of the base image (the glow mask has the same size, stacked below it). */
    public int texW = 256, texH = 256;

    protected Item(String id, String name, Slot slot, String description) {
        this.id = id;
        this.name = name;
        this.slot = slot;
        this.description = description;
    }

    public boolean hasVariant(String v) {
        for (String s : variants) if (s.equals(v)) return true;
        return false;
    }

    public String variantName(String v) {
        for (int i = 0; i < variants.length; i++) if (variants[i].equals(v)) return variantNames[i];
        return v;
    }

    /** Base texture, texW x texH. */
    protected abstract BufferedImage paint(int color, String variant);

    /** Glow mask (same size, black where nothing glows), or null without a glow option. */
    protected BufferedImage paintGlow(int color, String variant) { return null; }

    /** Adds this frame's geometry. */
    protected abstract void build(Build b);

    /** Highest point of a hat (model pixels, head space, y up is negative), for things floating above it. */
    protected float topY(Worn w) { return -8; }

    /** Extra vertical room for the item in the small grid preview (model pixels), and its centre. */
    protected float[] previewFrame() { return new float[]{0, -4, 0, 12}; }

    /** Geometry sink for one item and one frame. */
    public static final class Build {
        public final Worn worn;
        public final Wearer w;
        /** Animation clock in seconds (already scaled by the speed option; 0 when the animation is off). */
        public final float t;
        /** Size option. */
        public final float s;
        /** Previews (grid icons) have no player: items may skip parts hidden by the head. */
        public final boolean preview;
        /** Top of whatever is on the head (the head itself or the hat worn with it), for a halo to float above. */
        public float headTop = -8;
        final Mesh head = new Mesh(), body = new Mesh(), glowHead = new Mesh(), glowBody = new Mesh();

        Build(Worn worn, Wearer w, float t, boolean preview) {
            this.worn = worn;
            this.w = w;
            this.t = t;
            this.s = worn.scale;
            this.preview = preview;
        }

        /** Geometry attached to the head (origin at the neck, the head spans y -8..0, x/z -4..4). */
        public Mesh head() { return head; }

        /** Geometry attached to the body (origin at the neck, the body spans y 0..12, x -4..4, z -2..2; the back is +z). */
        public Mesh body() { return body; }

        /** Always additive and full bright, sampling the glow mask (halo bloom, sparkles); only drawn with glow on. */
        public Mesh glowHead() { return glowHead; }

        public Mesh glowBody() { return glowBody; }

        public boolean glow() { return worn.glow; }

        public int color() { return worn.color; }

        public String variant() { return worn.variant; }
    }
}
