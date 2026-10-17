package dev.noreclient.mixin;

import dev.noreclient.module.render.SkyStyle;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.util.math.Vec3d;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Sky Style: recolours the sky and clouds and changes the stars. */
@Mixin(ClientWorld.class)
public abstract class SkyStyleMixin {
    @Inject(method = "getSkyColor", at = @At("RETURN"), cancellable = true)
    private void noreclient$sky(Vec3d cameraPos, float tickProgress, CallbackInfoReturnable<Integer> cir) {
        SkyStyle s = SkyStyle.active();
        if (s != null) cir.setReturnValue(s.sky(cir.getReturnValueI()));
    }

    @Inject(method = "getCloudsColor", at = @At("RETURN"), cancellable = true)
    private void noreclient$clouds(float tickProgress, CallbackInfoReturnable<Integer> cir) {
        SkyStyle s = SkyStyle.active();
        if (s != null) cir.setReturnValue(s.clouds(cir.getReturnValueI()));
    }

    @Inject(method = "getStarBrightness", at = @At("RETURN"), cancellable = true)
    private void noreclient$stars(float tickProgress, CallbackInfoReturnable<Float> cir) {
        SkyStyle s = SkyStyle.active();
        if (s != null) cir.setReturnValue(s.stars(cir.getReturnValueF()));
    }
}
