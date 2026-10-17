package dev.noreclient.api;

/** Active status effect. {@code handle} is the platform's effect instance (used to draw the icon). */
public final class EffectInfo {
    public final Object handle;
    public final String name;
    public final int amplifier;
    public final int durationTicks;
    public final boolean infinite;
    public final int color;

    public EffectInfo(Object handle, String name, int amplifier, int durationTicks, boolean infinite, int color) {
        this.handle = handle;
        this.name = name;
        this.amplifier = amplifier;
        this.durationTicks = durationTicks;
        this.infinite = infinite;
        this.color = color;
    }
}
