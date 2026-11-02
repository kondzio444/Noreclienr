package dev.noreclient.mixin;

import dev.noreclient.module.render.SkyStyle;
import dev.noreclient.util.ColorUtil;
import net.minecraft.client.render.DimensionEffects;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Sky Style: tints the sunrise/sunset glow. */
@Mixin(DimensionEffects.class)
public abstract class DimensionEffectsMixin {
    @Inject(method = "getFogColorOverride", at = @At("RETURN"), cancellable = true)
    private void noreclient$sunset(float skyAngle, float tickDelta, CallbackInfoReturnable<float[]> cir) {
        SkyStyle s = SkyStyle.active();
        float[] c = cir.getReturnValue();
        if (s == null || c == null || c.length < 4) return;
        int t = s.sunset(ColorUtil.argb(255, (int) (c[0] * 255), (int) (c[1] * 255), (int) (c[2] * 255)));
        cir.setReturnValue(new float[]{ColorUtil.red(t) / 255f, ColorUtil.green(t) / 255f, ColorUtil.blue(t) / 255f, c[3]});
    }
}
