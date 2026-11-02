package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.BlockOutline;
import dev.noreclient.util.ColorUtil;
import net.minecraft.client.render.WorldRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArgs;
import org.spongepowered.asm.mixin.injection.invoke.arg.Args;

@Mixin(WorldRenderer.class)
public abstract class WorldRendererMixin {
    @ModifyArgs(method = "drawBlockOutline", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/render/WorldRenderer;drawCuboidShapeOutline(Lnet/minecraft/client/util/math/MatrixStack;Lnet/minecraft/client/render/VertexConsumer;Lnet/minecraft/util/shape/VoxelShape;DDDFFFF)V"))
    private void noreclient$outlineColor(Args args) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        BlockOutline b = c.modules().get(BlockOutline.class);
        if (!b.isActive()) return;
        int col = b.color.getColor();
        args.set(6, ColorUtil.red(col) / 255f);
        args.set(7, ColorUtil.green(col) / 255f);
        args.set(8, ColorUtil.blue(col) / 255f);
        args.set(9, ColorUtil.alpha(col) / 255f);
    }
}
