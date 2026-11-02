package dev.noreclient.setting;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.noreclient.util.ColorUtil;

/** ARGB colour with an optional animated "chroma" (rainbow) mode. */
public class ColorSetting extends Setting<Integer> {
    private boolean chroma;
    private float chromaSpeed = 1f;

    public ColorSetting(String name, String description, int defaultArgb) {
        super(name, description, defaultArgb);
    }

    /** The colour to actually render with (chroma aware). */
    public int getColor() {
        return getColor(0);
    }

    public int getColor(long offsetMs) {
        if (chroma) {
            float[] hsb = ColorUtil.toHsb(value);
            return ColorUtil.rainbow(offsetMs, chromaSpeed, Math.max(0.5f, hsb[1]), Math.max(0.8f, hsb[2]), ColorUtil.alpha(value));
        }
        return value;
    }

    public boolean isChroma() { return chroma; }
    public void setChroma(boolean chroma) { this.chroma = chroma; }
    public float getChromaSpeed() { return chromaSpeed; }
    public void setChromaSpeed(float s) { this.chromaSpeed = s; }

    @Override
    public void reset() {
        super.reset();
        chroma = false;
    }

    @Override
    public JsonElement toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("color", ColorUtil.toHex(value));
        o.addProperty("chroma", chroma);
        o.addProperty("chromaSpeed", chromaSpeed);
        return o;
    }

    @Override
    public void fromJson(JsonElement element) {
        if (!element.isJsonObject()) return;
        JsonObject o = element.getAsJsonObject();
        try {
            if (o.has("color")) value = (int) Long.parseLong(o.get("color").getAsString().replace("#", ""), 16);
        } catch (NumberFormatException ignored) {
        }
        if (o.has("chroma")) chroma = o.get("chroma").getAsBoolean();
        if (o.has("chromaSpeed")) chromaSpeed = o.get("chromaSpeed").getAsFloat();
    }
}
