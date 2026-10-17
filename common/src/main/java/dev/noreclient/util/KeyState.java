package dev.noreclient.util;

import java.util.HashSet;
import java.util.Set;

/** Keys currently held, fed by the platform's keyboard hook (GLFW codes). */
public final class KeyState {
    private static final Set<Integer> DOWN = new HashSet<Integer>();

    private KeyState() {}

    public static synchronized void set(int key, boolean down) {
        if (down) DOWN.add(key); else DOWN.remove(key);
    }

    public static synchronized boolean down(int key) {
        return key >= 0 && DOWN.contains(key);
    }

    public static synchronized void clear() { DOWN.clear(); }
}
