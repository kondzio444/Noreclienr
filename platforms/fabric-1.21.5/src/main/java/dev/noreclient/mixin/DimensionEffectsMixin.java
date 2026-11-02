package dev.noreclient.mixin;

import dev.noreclient.module.render.SkyStyle;
import net.minecraft.client.render.DimensionEffects;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Sky Style: tints the sunrise/sunset glow. */
@Mixin(DimensionEffects.class)
public abstract class DimensionEffectsMixin {
    @Inject(method = "getSkyColor(F)I", at = @At("RETURN"), cancellable = true)
    private void noreclient$sunset(float skyAngle, CallbackInfoReturnable<Integer> cir) {
        SkyStyle s = SkyStyle.active();
        if (s != null) cir.setReturnValue(s.sunset(cir.getReturnValueI()));
    }
}
