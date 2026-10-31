package dev.noreclient.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.noreclient.NoreClient;
import dev.noreclient.module.render.LowFire;
import net.minecraft.client.renderer.ScreenEffectRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ScreenEffectRenderer.class)
public abstract class InGameOverlayRendererMixin {
    @Inject(method = "renderFire", at = @At("HEAD"))
    private static void noreclient$lowFirePush(PoseStack matrices, net.minecraft.client.renderer.MultiBufferSource consumers, net.minecraft.client.renderer.texture.TextureAtlasSprite sprite, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        matrices.pushPose();
        if (c != null) {
            LowFire lf = c.modules().get(LowFire.class);
            if (lf.isActive()) matrices.translate(0, -lf.height.get(), 0);
        }
    }

    @Inject(method = "renderFire", at = @At("RETURN"))
    private static void noreclient$lowFirePop(PoseStack matrices, net.minecraft.client.renderer.MultiBufferSource consumers, net.minecraft.client.renderer.texture.TextureAtlasSprite sprite, CallbackInfo ci) {
        matrices.popPose();
    }
}
