package dev.noreclient.platform;

import dev.noreclient.cosmetic.Mesh;
import dev.noreclient.cosmetic.Wardrobe;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Identifier;

import java.util.List;

/** Wardrobe wings and hat (Nore Client cosmetics) on the local player, submitted as custom geometry. */
public class WardrobeFeature extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
    public WardrobeFeature(FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) {
        super(context);
    }

    @Override
    public void render(MatrixStack matrices, OrderedRenderCommandQueue queue, int light, PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc.player == null || state.id != mc.player.getId() || state.invisible || !Wardrobe.active()) return;
        for (Wardrobe.Piece piece : Wardrobe.local(!state.equippedHeadStack.isEmpty())) {
            ModelPart part = piece.part == Wardrobe.Part.HEAD ? getContextModel().head : getContextModel().body;
            matrices.push();
            part.applyTransform(matrices);
            final List<Mesh.Quad> quads = piece.quads;
            queue.submitCustom(matrices, RenderLayer.getEntityCutoutNoCull((Identifier) piece.texture.handle), (entry, vc) -> {
                for (Mesh.Quad q : quads) {
                    for (int i = 0; i < 4; i++) {
                        vc.vertex(entry.getPositionMatrix(), q.x[i] / 16f, q.y[i] / 16f, q.z[i] / 16f).color(-1).texture(q.u[i], q.v[i])
                                .overlay(OverlayTexture.DEFAULT_UV).light(light).normal(entry, q.nx, q.ny, q.nz);
                    }
                }
            });
            matrices.pop();
        }
    }
}
