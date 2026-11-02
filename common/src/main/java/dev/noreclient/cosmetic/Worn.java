package dev.noreclient.cosmetic;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

/** One worn item with its options (colour, variant, animation, speed, size, glow). Immutable. */
public final class Worn {
    public static final float MIN_SPEED = 0.25f, MAX_SPEED = 2.5f, MIN_SCALE = 0.6f, MAX_SCALE = 1.4f;

    public final String id;
    /** RGB 0..0xFFFFFF. */
    public final int color;
    public final String variant;
    public final boolean anim, glow;
    public final float speed, scale;

    public Worn(String id, int color, String variant, boolean anim, float speed, float scale, boolean glow) {
        this.id = id;
        this.color = color & 0xFFFFFF;
        this.variant = variant == null ? "" : variant;
        this.anim = anim;
        this.speed = clamp(speed, MIN_SPEED, MAX_SPEED);
        this.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
        this.glow = glow;
    }

    /** The item with its default options. */
    public static Worn of(Item item) {
        return new Worn(item.id, item.defaultColor, item.variants.length > 0 ? item.variants[0] : "", true, 1f, 1f, item.glowOption && item.glowDefault);
    }

    public Worn withColor(int c) { return new Worn(id, c, variant, anim, speed, scale, glow); }

    public Worn withVariant(String v) { return new Worn(id, color, v, anim, speed, scale, glow); }

    public Worn withAnim(boolean a) { return new Worn(id, color, variant, a, speed, scale, glow); }

    public Worn withSpeed(float s) { return new Worn(id, color, variant, anim, s, scale, glow); }

    public Worn withScale(float s) { return new Worn(id, color, variant, anim, speed, s, glow); }

    public Worn withGlow(boolean g) { return new Worn(id, color, variant, anim, speed, scale, g); }

    private static float clamp(float v, float lo, float hi) {
        if (Float.isNaN(v)) return 1f;
        return Math.max(lo, Math.min(hi, v));
    }

    private static float round2(float v) { return Math.round(v * 100) / 100f; }

    JsonObject toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("id", id);
        o.addProperty("color", color);
        if (!variant.isEmpty()) o.addProperty("variant", variant);
        JsonObject opts = new JsonObject();
        opts.addProperty("anim", anim);
        opts.addProperty("speed", round2(speed));
        opts.addProperty("scale", round2(scale));
        opts.addProperty("glow", glow);
        o.add("opts", opts);
        return o;
    }

    /** Parses one slot entry for the given item; anything unknown or malformed falls back to the default. */
    static Worn fromJson(Item item, JsonObject o) {
        Worn d = of(item);
        int color = d.color;
        String variant = d.variant;
        boolean anim = d.anim, glow = d.glow;
        float speed = 1f, scale = 1f;
        JsonElement c = o.get("color");
        if (isNumber(c)) {
            long v = c.getAsLong();
            if (v >= 0 && v <= 0xFFFFFF) color = (int) v;
        }
        JsonElement v = o.get("variant");
        if (v != null && v.isJsonPrimitive() && item.hasVariant(v.getAsString())) variant = v.getAsString();
        JsonElement oe = o.get("opts");
        if (oe != null && oe.isJsonObject()) {
            JsonObject opts = oe.getAsJsonObject();
            anim = bool(opts.get("anim"), anim);
            glow = item.glowOption && bool(opts.get("glow"), glow);
            JsonElement s = opts.get("speed");
            if (isNumber(s)) speed = s.getAsFloat();
            JsonElement k = opts.get("scale");
            if (isNumber(k)) scale = k.getAsFloat();
        }
        return new Worn(item.id, color, variant, anim, speed, scale, glow);
    }

    private static boolean isNumber(JsonElement e) {
        return e != null && e.isJsonPrimitive() && ((JsonPrimitive) e).isNumber();
    }

    private static boolean bool(JsonElement e, boolean def) {
        return e != null && e.isJsonPrimitive() && ((JsonPrimitive) e).isBoolean() ? e.getAsBoolean() : def;
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Worn)) return false;
        Worn w = (Worn) o;
        return id.equals(w.id) && color == w.color && variant.equals(w.variant) && anim == w.anim && glow == w.glow
                && Float.compare(speed, w.speed) == 0 && Float.compare(scale, w.scale) == 0;
    }

    @Override
    public int hashCode() { return id.hashCode() * 31 + color; }
}
