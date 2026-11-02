package dev.noreclient.util;

import dev.noreclient.api.Platform;
import dev.noreclient.api.TargetInfo;

/** Remembers the last entity the player hit (used by the Target HUD). */
public final class CombatTracker {
    private static Object lastTarget;
    private static long lastHit;

    private CombatTracker() {}

    public static void onAttack(Object entityHandle) {
        lastTarget = entityHandle;
        lastHit = System.currentTimeMillis();
    }

    public static TargetInfo getTarget(long timeoutMs) {
        if (lastTarget == null || System.currentTimeMillis() - lastHit > timeoutMs) return null;
        TargetInfo t = Platform.game().describe(lastTarget);
        if (t == null) lastTarget = null;
        return t;
    }
}
