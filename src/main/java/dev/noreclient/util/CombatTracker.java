package dev.noreclient.util;

import net.minecraft.client.MinecraftClient;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;

/** Remembers the last entity the player hit (used by Target HUD). */
public final class CombatTracker {
    private static LivingEntity lastTarget;
    private static long lastHit;

    private CombatTracker() {}

    public static void onAttack(Entity entity) {
        if (entity instanceof LivingEntity living) {
            lastTarget = living;
            lastHit = System.currentTimeMillis();
        }
    }

    public static void tick() {
        if (lastTarget != null && (lastTarget.isRemoved() || MinecraftClient.getInstance().world == null)) lastTarget = null;
    }

    public static LivingEntity getTarget(long timeoutMs) {
        if (lastTarget == null || System.currentTimeMillis() - lastHit > timeoutMs) return null;
        return lastTarget;
    }
}
