package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.FovChanger;
import dev.noreclient.module.render.NoHurtCam;
import net.minecraft.client.MinecraftClient;
import dev.noreclient.module.render.Zoom;
import net.minecraft.client.render.Camera;
import net.minecraft.client.render.GameRenderer;
import net.minecraft.client.util.math.MatrixStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    private void noreclient$zoom(Camera camera, float tickDelta, boolean changingFov, CallbackInfoReturnable<Double> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        double fov = cir.getReturnValue();
        FovChanger f = c.modules().get(FovChanger.class);
        if (f.isActive() && changingFov) {
            int base = MinecraftClient.getInstance().options.getFov().getValue();
            fov = f.staticFov.isOn() ? f.fov.get() : fov * f.fov.get() / Math.max(1, base);
        }
        double divisor = c.modules().get(Zoom.class).getCurrentDivisor();
        if (divisor != 1.0 || fov != cir.getReturnValue()) cir.setReturnValue(fov / divisor);
    }

    @Inject(method = "tiltViewWhenHurt", at = @At("HEAD"), cancellable = true)
    private void noreclient$noHurtCam(MatrixStack matrices, float tickDelta, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c != null && c.modules().get(NoHurtCam.class).isActive()) ci.cancel();
    }
}
