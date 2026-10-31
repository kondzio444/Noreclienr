package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.FogControl;
import net.minecraft.block.enums.CameraSubmersionType;
import net.minecraft.client.render.BackgroundRenderer;
import net.minecraft.client.render.Camera;
import net.minecraft.client.render.Fog;
import org.joml.Vector4f;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(BackgroundRenderer.class)
public abstract class BackgroundRendererMixin {
    @Inject(method = "applyFog", at = @At("RETURN"), cancellable = true)
    private static void noreclient$fog(Camera camera, BackgroundRenderer.FogType fogType, Vector4f color, float viewDistance, boolean thickFog, float tickDelta,
                                       CallbackInfoReturnable<Fog> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        FogControl f = c.modules().get(FogControl.class);
        if (!f.isActive()) return;
        Fog fog = cir.getReturnValue();
        if (fog == Fog.DUMMY) return;
        CameraSubmersionType sub = camera.getSubmersionType();
        float start = fog.start(), end = fog.end();
        if (sub == CameraSubmersionType.WATER) {
            if (!f.waterFog.isOn()) return;
            start = -8f; end = viewDistance * 0.9f;
        } else if (sub == CameraSubmersionType.LAVA) {
            if (!f.lavaFog.isOn()) return;
            start = 0f; end = 24f;
        } else if (sub == CameraSubmersionType.POWDER_SNOW) {
            if (!f.snowFog.isOn()) return;
            start = 0f; end = 24f;
        } else if (fogType == BackgroundRenderer.FogType.FOG_TERRAIN && !thickFog) {
            if (f.worldFog.isOn()) { start = viewDistance * 4f; end = viewDistance * 5f; }
            else { float m = f.distance.floatValue() / 100f; start *= m; end *= m; }
        } else {
            return;
        }
        cir.setReturnValue(new Fog(start, end, fog.shape(), fog.red(), fog.green(), fog.blue(), fog.alpha()));
    }
}
