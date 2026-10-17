package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.BlockOutline;
import net.minecraft.client.renderer.LevelRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

@Mixin(LevelRenderer.class)
public abstract class WorldRendererMixin {
    @ModifyArg(method = "renderHitOutline", index = 6, at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/renderer/ShapeRenderer;renderShape(Lcom/mojang/blaze3d/vertex/PoseStack;Lcom/mojang/blaze3d/vertex/VertexConsumer;Lnet/minecraft/world/phys/shapes/VoxelShape;DDDIF)V"))
    private int noreclient$outlineColor(int color) {
        NoreClient c = NoreClient.get();
        if (c == null) return color;
        BlockOutline b = c.modules().get(BlockOutline.class);
        return b.isActive() ? b.color.getColor() : color;
    }
}
