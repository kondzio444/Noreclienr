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
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    private void noreclient$zoom(Camera camera, float tickDelta, boolean changingFov, CallbackInfoReturnable<Float> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        double fov = cir.getReturnValue();
        FovChanger f = c.modules().get(FovChanger.class);
        if (f.isActive() && changingFov) {
            int base = Minecraft.getInstance().options.fov().get();
            fov = f.staticFov.isOn() ? f.fov.get() : fov * f.fov.get() / Math.max(1, base);
        }
        double divisor = c.modules().get(Zoom.class).getCurrentDivisor();
        if (divisor != 1.0 || fov != cir.getReturnValue()) cir.setReturnValue((float) (fov / divisor));
    }

    @Inject(method = "bobHurt", at = @At("HEAD"), cancellable = true)
    private void noreclient$noHurtCam(PoseStack matrices, float tickDelta, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c != null && c.modules().get(NoHurtCam.class).isActive()) ci.cancel();
    }
}
