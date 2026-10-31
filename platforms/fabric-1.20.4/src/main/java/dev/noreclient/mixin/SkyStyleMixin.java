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
    private void noreclient$sky(Vec3d cameraPos, float tickDelta, CallbackInfoReturnable<Vec3d> cir) {
        SkyStyle s = SkyStyle.active();
        if (s == null) return;
        Vec3d v = cir.getReturnValue();
        double[] o = s.sky(v.x, v.y, v.z);
        cir.setReturnValue(new Vec3d(o[0], o[1], o[2]));
    }

    @Inject(method = "getCloudsColor", at = @At("RETURN"), cancellable = true)
    private void noreclient$clouds(float tickDelta, CallbackInfoReturnable<Vec3d> cir) {
        SkyStyle s = SkyStyle.active();
        if (s == null) return;
        Vec3d v = cir.getReturnValue();
        double[] o = s.clouds(v.x, v.y, v.z);
        cir.setReturnValue(new Vec3d(o[0], o[1], o[2]));
    }

    @Inject(method = "method_23787", at = @At("RETURN"), cancellable = true)
    private void noreclient$stars(float tickDelta, CallbackInfoReturnable<Float> cir) {
        SkyStyle s = SkyStyle.active();
        if (s != null) cir.setReturnValue(s.stars(cir.getReturnValueF()));
    }
}
