package dev.noreclient.platform;

import dev.noreclient.api.TextureRef;
import dev.noreclient.cosmetic.Mesh;
import dev.noreclient.cosmetic.PreviewPose;
import dev.noreclient.cosmetic.Wardrobe;
import dev.noreclient.cosmetic.WearerState;
import dev.noreclient.util.Capes;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.DiffuseLighting;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.util.SkinTextures;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.item.Items;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.RotationAxis;
import net.minecraft.util.math.Vec3d;

import java.util.List;

/**
 * Wardrobe items (Nore Client cosmetics) on every player: the local player wears the saved look,
 * other Nore players the look from the Nore Hub. Also draws the wardrobe screen's preview model.
 */
public class WardrobeFeature extends FeatureRenderer<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> {
    private static final PlayerEntityRenderer[] RENDERERS = new PlayerEntityRenderer[2];
    private static final WearerState STATE = new WearerState();
    private static final int FULL_BRIGHT = 0xF000F0;

    public WardrobeFeature(FeatureRendererContext<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> context) {
        super(context);
    }

    /** Called by the player renderer mixin for both models (wide / slim): used by the preview. */
    public static void register(PlayerEntityRenderer renderer, boolean slim) { RENDERERS[slim ? 1 : 0] = renderer; }

    @Override
    public void render(MatrixStack matrices, VertexConsumerProvider buffers, int light, AbstractClientPlayerEntity player,
                       float limbAngle, float limbDistance, float tickDelta, float animationProgress, float headYaw, float headPitch) {
        if (player.isInvisible()) return;
        MinecraftClient mc = MinecraftClient.getInstance();
        boolean local = player == mc.player;
        String name = player.getGameProfile().getName();
        int who = local ? Wardrobe.LOCAL : Wardrobe.OTHER;
        if (!Wardrobe.wears(who, name)) return;
        WearerState s = STATE.reset(name);
        s.x = MathHelper.lerp(tickDelta, player.prevX, player.getX());
        s.y = MathHelper.lerp(tickDelta, player.prevY, player.getY());
        s.z = MathHelper.lerp(tickDelta, player.prevZ, player.getZ());
        if (local) {
            Vec3d v = player.getVelocity();
            s.vx = v.x;
            s.vy = player.isOnGround() ? 0 : v.y;
            s.vz = v.z;
        }
        s.bodyYaw = MathHelper.lerpAngleDegrees(tickDelta, player.prevBodyYaw, player.bodyYaw);
        s.headYaw = headYaw;
        s.headPitch = headPitch;
        s.limbSwing = limbAngle;
        s.limbAmount = limbDistance;
        s.onGround = player.isOnGround();
        s.sneaking = player.isInSneakingPose();
        s.sprinting = player.isSprinting();
        s.flying = player.getAbilities().flying;
        s.gliding = player.isFallFlying();
        s.swimming = player.isInSwimmingPose();
        s.hurtTime = player.hurtTime;
        s.helmet = !player.getEquippedStack(EquipmentSlot.HEAD).isEmpty();
        s.elytra = player.getEquippedStack(EquipmentSlot.CHEST).isOf(Items.ELYTRA);
        draw(matrices, buffers, light, getContextModel(), Wardrobe.pieces(who, s));
    }

    /** Draws the pieces attached to the head / body parts of the model. */
    static void draw(MatrixStack matrices, VertexConsumerProvider buffers, int light, PlayerEntityModel<?> model, List<Wardrobe.Piece> pieces) {
        for (Wardrobe.Piece piece : pieces) {
            ModelPart part = piece.part == Wardrobe.Part.HEAD ? model.head : model.body;
            matrices.push();
            part.rotate(matrices);
            Identifier tex = (Identifier) piece.texture.handle;
            VertexConsumer vc = buffers.getBuffer(piece.glow() ? RenderLayer.getEyes(tex) : RenderLayer.getEntityCutoutNoCull(tex));
            int l = piece.glow() ? FULL_BRIGHT : light;
            MatrixStack.Entry e = matrices.peek();
            for (Mesh.Quad q : piece.quads) {
                for (int i = 0; i < 4; i++) {
                    vc.vertex(e.getPositionMatrix(), q.x[i] / 16f, q.y[i] / 16f, q.z[i] / 16f).color(q.color).texture(q.u[i], q.v[i])
                            .overlay(OverlayTexture.DEFAULT_UV).light(l).normal(e, q.nx, q.ny, q.nz);
                }
            }
            matrices.pop();
        }
    }

    /** The wardrobe preview: the local player's model posed by hand, with the preview cape and items. */
    public static boolean drawPreview(DrawContext ctx, int x1, int y1, int x2, int y2, float size, float yaw, float pitch) {
        MinecraftClient mc = MinecraftClient.getInstance();
        SkinTextures skin = mc.player != null ? mc.player.getSkinTextures() : mc.getSkinProvider().getSkinTextures(mc.getGameProfile());
        PlayerEntityRenderer r = RENDERERS[skin.model() == SkinTextures.Model.SLIM ? 1 : 0];
        if (r == null) return false;
        PlayerEntityModel<AbstractClientPlayerEntity> model = r.getModel();
        WearerState s = Wardrobe.previewState();
        float age = Wardrobe.time() * 20;
        PreviewPose p = PreviewPose.of(s, age);
        pose(model, p);
        ctx.enableScissor(x1, y1, x2, y2);
        MatrixStack ms = ctx.getMatrices();
        ms.push();
        ms.translate((x1 + x2) / 2f, y2 - size * 0.1f - p.lift * size, 150);
        ms.scale(size, size, -size);
        ms.multiply(RotationAxis.POSITIVE_Z.rotationDegrees(180));
        ms.multiply(RotationAxis.POSITIVE_X.rotationDegrees(-pitch));
        ms.multiply(RotationAxis.POSITIVE_Y.rotationDegrees(-yaw));
        ms.scale(-1, -1, 1);
        ms.scale(0.9375f, 0.9375f, 0.9375f);
        ms.translate(0, -1.501f, 0);
        DiffuseLighting.method_34742();
        VertexConsumerProvider.Immediate vcp = ctx.getVertexConsumers();
        int light = FULL_BRIGHT;
        model.render(ms, vcp.getBuffer(model.getLayer(skin.texture())), light, OverlayTexture.DEFAULT_UV, -1);
        String cape = Wardrobe.previewCape();
        TextureRef capeTex = cape == null ? null : Capes.texture(cape, Wardrobe.capeFrame(Wardrobe.previewLook.get(dev.noreclient.cosmetic.Slot.CAPE)));
        if (capeTex != null) {
            ms.push();
            model.body.rotate(ms);
            ms.translate(0, 0, 0.125f);
            float lift = 4 + s.limbAmount * 22 + (s.flying ? 28 : 0) + 3 * (float) Math.sin(age * 0.05f);
            if (p.sneaking) {
                lift += 25;
                ms.translate(0, 0.15f, 0);
            }
            ms.multiply(RotationAxis.POSITIVE_X.rotationDegrees(6 + lift));
            ms.multiply(RotationAxis.POSITIVE_Y.rotationDegrees(180));
            model.renderCape(ms, vcp.getBuffer(RenderLayer.getEntitySolid((Identifier) capeTex.handle)), light, OverlayTexture.DEFAULT_UV);
            ms.pop();
        }
        draw(ms, vcp, light, model, Wardrobe.pieces(Wardrobe.PREVIEW, s));
        ctx.draw();
        ms.pop();
        DiffuseLighting.enableGuiDepthLighting();
        ctx.disableScissor();
        return true;
    }

    private static void pose(PlayerEntityModel<?> m, PreviewPose p) {
        m.setVisible(true);
        m.head.setAngles(p.headPitch, p.headYaw, 0);
        m.head.setPivot(0, p.headY, 0);
        m.body.setAngles(p.bodyPitch, 0, 0);
        m.body.setPivot(0, p.bodyY, 0);
        m.rightArm.setAngles(p.rightArmPitch, 0, p.rightArmRoll);
        m.rightArm.setPivot(-5, p.armY, 0);
        m.leftArm.setAngles(p.leftArmPitch, 0, p.leftArmRoll);
        m.leftArm.setPivot(5, p.armY, 0);
        m.rightLeg.setAngles(p.rightLegPitch, 0, 0);
        m.rightLeg.setPivot(-1.9f, p.legY, p.sneaking ? p.legZ : 0.1f);
        m.leftLeg.setAngles(p.leftLegPitch, 0, 0);
        m.leftLeg.setPivot(1.9f, p.legY, p.sneaking ? p.legZ : 0.1f);
        m.hat.copyTransform(m.head);
        m.jacket.copyTransform(m.body);
        m.rightSleeve.copyTransform(m.rightArm);
        m.leftSleeve.copyTransform(m.leftArm);
        m.rightPants.copyTransform(m.rightLeg);
        m.leftPants.copyTransform(m.leftLeg);
    }
}
