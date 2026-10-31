package dev.noreclient.cosmetic;

/**
 * What the platform knows about one player this frame, filled by the wardrobe feature renderer
 * (or the wardrobe preview) before {@link Wardrobe#pieces} builds that player's items. Angles in
 * degrees, positions in blocks. Unknown values may stay at their defaults.
 */
public final class WearerState {
    public String name = "";
    /** World position (interpolated for this frame); velocity is derived from it when vx is NaN. */
    public double x, y, z;
    /** Velocity in blocks per tick when known (NaN = derive from positions). */
    public double vx = Double.NaN, vy = Double.NaN, vz = Double.NaN;
    public float bodyYaw;
    /** Head yaw relative to the body, and head pitch (positive = looking down). */
    public float headYaw, headPitch;
    public float limbSwing, limbAmount;
    public boolean onGround = true, sneaking, sprinting, flying, gliding, swimming;
    /** Ticks left of the red hurt flash (0..10). */
    public int hurtTime;
    /** Something is worn on the head / an elytra on the chest. */
    public boolean helmet, elytra;

    public WearerState reset(String name) {
        this.name = name == null ? "" : name;
        x = y = z = 0;
        vx = vy = vz = Double.NaN;
        bodyYaw = headYaw = headPitch = limbSwing = limbAmount = 0;
        onGround = true;
        sneaking = sprinting = flying = gliding = swimming = helmet = elytra = false;
        hurtTime = 0;
        return this;
    }
}
