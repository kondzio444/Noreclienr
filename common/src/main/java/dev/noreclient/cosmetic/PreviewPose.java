package dev.noreclient.cosmetic;

/**
 * Part angles (radians) and pivots of the player model for the wardrobe preview, computed like the
 * vanilla biped model does from limb swing, head rotation and sneaking (plus a relaxed hover pose
 * for flying). Platforms that render the preview model by hand copy these into the model parts.
 */
public final class PreviewPose {
    public float headPitch, headYaw, bodyPitch;
    public float rightArmPitch, rightArmRoll, leftArmPitch, leftArmRoll, rightLegPitch, leftLegPitch;
    public float headY, bodyY, armY, legY, legZ;
    /** Vertical offset of the whole model in blocks (hovering while flying). */
    public float lift;
    public boolean sneaking;

    public static PreviewPose of(WearerState s, float age) {
        PreviewPose p = new PreviewPose();
        float f = s.limbSwing, g = s.limbAmount;
        p.headYaw = (float) Math.toRadians(s.headYaw);
        p.headPitch = (float) Math.toRadians(s.headPitch);
        p.rightArmPitch = (float) Math.cos(f * 0.6662f + Math.PI) * 2 * g * 0.5f;
        p.leftArmPitch = (float) Math.cos(f * 0.6662f) * 2 * g * 0.5f;
        p.rightLegPitch = (float) Math.cos(f * 0.6662f) * 1.4f * g;
        p.leftLegPitch = (float) Math.cos(f * 0.6662f + Math.PI) * 1.4f * g;
        // idle arm sway
        p.rightArmRoll = (float) (Math.cos(age * 0.09f) * 0.05f + 0.05f);
        p.leftArmRoll = -p.rightArmRoll;
        p.rightArmPitch += (float) Math.sin(age * 0.067f) * 0.05f;
        p.leftArmPitch -= (float) Math.sin(age * 0.067f) * 0.05f;
        if (s.flying) {
            p.rightArmRoll += 0.22f;
            p.leftArmRoll -= 0.22f;
            p.rightLegPitch = 0.12f + (float) Math.sin(age * 0.11f) * 0.06f;
            p.leftLegPitch = 0.08f - (float) Math.sin(age * 0.11f) * 0.06f;
            p.lift = 0.12f + (float) Math.sin(age * 0.08f) * 0.06f;
        }
        p.sneaking = s.sneaking;
        if (s.sneaking) {
            p.bodyPitch = 0.5f;
            p.rightArmPitch += 0.4f;
            p.leftArmPitch += 0.4f;
            p.legZ = 4f;
            p.legY = 12.2f;
            p.headY = 4.2f;
            p.bodyY = 3.2f;
            p.armY = 5.2f;
        } else {
            p.legY = 12f;
            p.armY = 2f;
        }
        return p;
    }
}
