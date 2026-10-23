package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.LowFire;
import net.minecraft.client.gui.hud.InGameOverlayRenderer;
import net.minecraft.client.util.math.MatrixStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(InGameOverlayRenderer.class)
public abstract class InGameOverlayRendererMixin {
    @Inject(method = "renderFireOverlay", at = @At("HEAD"))
    private static void noreclient$lowFirePush(MatrixStack matrices, net.minecraft.client.render.VertexConsumerProvider consumers, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        matrices.push();
        if (c != null) {
            LowFire lf = c.modules().get(LowFire.class);
            if (lf.isActive()) matrices.translate(0, -lf.height.get(), 0);
        }
    }

    @Inject(method = "renderFireOverlay", at = @At("RETURN"))
    private static void noreclient$lowFirePop(MatrixStack matrices, net.minecraft.client.render.VertexConsumerProvider consumers, CallbackInfo ci) {
        matrices.pop();
    }
}
