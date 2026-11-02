package dev.noreclient.util;

import dev.noreclient.api.Gfx;

/** Remembers the last Gfx so text can be measured outside of a draw call (font metrics). */
public final class CurrentGfx {
    private static Gfx current;

    private CurrentGfx() {}

    public static void set(Gfx g) { current = g; }

    public static Gfx get() { return current; }

    public static int width(String s) {
        return current == null ? s.length() * 6 : current.textWidth(s);
    }
}
