package dev.noreclient.platform;

import dev.noreclient.cosmetic.Mesh;
import dev.noreclient.cosmetic.Wardrobe;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.util.Identifier;

/** Wardrobe wings and hat (Nore Client cosmetics) on the local player. */
public class WardrobeFeature extends FeatureRenderer<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> {
    public WardrobeFeature(FeatureRendererContext<AbstractClientPlayerEntity, PlayerEntityModel<AbstractClientPlayerEntity>> context) {
        super(context);
    }

    @Override
    public void render(MatrixStack matrices, VertexConsumerProvider buffers, int light, AbstractClientPlayerEntity player,
                       float limbAngle, float limbDistance, float tickDelta, float animationProgress, float headYaw, float headPitch) {
        if (player != MinecraftClient.getInstance().player || player.isInvisible() || !Wardrobe.active()) return;
        boolean helmet = !player.getEquippedStack(EquipmentSlot.HEAD).isEmpty();
        for (Wardrobe.Piece piece : Wardrobe.local(helmet)) {
            ModelPart part = piece.part == Wardrobe.Part.HEAD ? getContextModel().head : getContextModel().body;
            matrices.push();
            part.rotate(matrices);
            VertexConsumer vc = buffers.getBuffer(RenderLayer.getEntityCutoutNoCull((Identifier) piece.texture.handle));
            MatrixStack.Entry e = matrices.peek();
            for (Mesh.Quad q : piece.quads) {
                for (int i = 0; i < 4; i++) {
                    vc.vertex(e.getPositionMatrix(), q.x[i] / 16f, q.y[i] / 16f, q.z[i] / 16f).color(-1).texture(q.u[i], q.v[i])
                            .overlay(OverlayTexture.DEFAULT_UV).light(light).normal(e, q.nx, q.ny, q.nz);
                }
            }
            matrices.pop();
        }
    }
}
