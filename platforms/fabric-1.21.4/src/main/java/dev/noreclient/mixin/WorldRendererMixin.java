package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.BlockOutline;
import net.minecraft.client.render.WorldRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

@Mixin(WorldRenderer.class)
public abstract class WorldRendererMixin {
    @ModifyArg(method = "drawBlockOutline", index = 6, at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/render/VertexRendering;drawOutline(Lnet/minecraft/client/util/math/MatrixStack;Lnet/minecraft/client/render/VertexConsumer;Lnet/minecraft/util/shape/VoxelShape;DDDI)V"))
    private int noreclient$outlineColor(int color) {
        NoreClient c = NoreClient.get();
        if (c == null) return color;
        BlockOutline b = c.modules().get(BlockOutline.class);
        return b.isActive() ? b.color.getColor() : color;
    }
}
