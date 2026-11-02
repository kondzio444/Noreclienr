package dev.noreclient.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.noreclient.NoreClient;
import dev.noreclient.module.render.FovChanger;
import dev.noreclient.module.render.NoHurtCam;
import dev.noreclient.module.render.Zoom;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
    @Inject(method = "bobHurt", at = @At("HEAD"), cancellable = true)
    private void noreclient$noHurtCam(net.minecraft.client.renderer.state.level.CameraRenderState cameraState, PoseStack matrices, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c != null && c.modules().get(NoHurtCam.class).isActive()) ci.cancel();
    }
}
