package dev.noreclient.platform;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.noreclient.cosmetic.Mesh;
import dev.noreclient.cosmetic.Wardrobe;
import net.minecraft.client.Minecraft;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.RenderLayerParent;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.Identifier;

import java.util.List;

/** Wardrobe wings and hat (Nore Client cosmetics) on the local player, submitted as custom geometry. */
public class WardrobeLayer extends RenderLayer<AvatarRenderState, PlayerModel> {
    public WardrobeLayer(RenderLayerParent<AvatarRenderState, PlayerModel> parent) {
        super(parent);
    }

    @Override
    public void submit(PoseStack pose, SubmitNodeCollector collector, int light, AvatarRenderState state, float yRot, float xRot) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || state.id != mc.player.getId() || state.isInvisible || !Wardrobe.active()) return;
        for (Wardrobe.Piece piece : Wardrobe.local(!state.headEquipment.isEmpty())) {
            ModelPart part = piece.part == Wardrobe.Part.HEAD ? getParentModel().head : getParentModel().body;
            pose.pushPose();
            part.translateAndRotate(pose);
            final List<Mesh.Quad> quads = piece.quads;
            collector.submitCustomGeometry(pose, RenderTypes.entityCutout((Identifier) piece.texture.handle), (p, vc) -> {
                for (Mesh.Quad q : quads) {
                    for (int i = 0; i < 4; i++) {
                        vc.addVertex(p, q.x[i] / 16f, q.y[i] / 16f, q.z[i] / 16f).setColor(-1).setUv(q.u[i], q.v[i])
                                .setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(p, q.nx, q.ny, q.nz);
                    }
                }
            });
            pose.popPose();
        }
    }
}
