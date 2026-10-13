package dev.noreclient.module.hud;

import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

/** Shows the distance of your last hit (eye → closest point of the target's hitbox). */
public class ReachHud extends TextHudModule {
    private double lastReach;
    private long lastHit;

    public ReachHud() {
        super("Reach Display", "Dystans ostatniego uderzenia", 0.5f, 0.8f);
    }

    public void onHit(PlayerEntity player, Entity target) {
        Vec3d eye = player.getEyePos();
        Box box = target.getBoundingBox();
        double cx = Math.max(box.minX, Math.min(eye.x, box.maxX));
        double cy = Math.max(box.minY, Math.min(eye.y, box.maxY));
        double cz = Math.max(box.minZ, Math.min(eye.z, box.maxZ));
        lastReach = eye.distanceTo(new Vec3d(cx, cy, cz));
        lastHit = System.currentTimeMillis();
    }

    @Override protected String label() { return "Reach"; }

    @Override
    protected String value() {
        if (System.currentTimeMillis() - lastHit > 3000) return "-";
        return String.format("%.2f", lastReach);
    }

    @Override protected String previewValue() { return "2.87"; }
}
