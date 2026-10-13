package dev.noreclient.mixin;

import com.mojang.blaze3d.systems.RenderSystem;
import dev.noreclient.NoreClient;
import dev.noreclient.module.render.FogControl;
import net.minecraft.client.render.BackgroundRenderer;
import net.minecraft.client.render.Camera;
import net.minecraft.block.enums.CameraSubmersionType;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(BackgroundRenderer.class)
public abstract class BackgroundRendererMixin {
    @Inject(method = "applyFog", at = @At("TAIL"))
    private static void noreclient$fog(Camera camera, BackgroundRenderer.FogType fogType, float viewDistance, boolean thickFog, float tickDelta, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        FogControl f = c.modules().get(FogControl.class);
        if (!f.isEnabled()) return;
        CameraSubmersionType sub = camera.getSubmersionType();
        if (sub == CameraSubmersionType.WATER) {
            if (f.waterFog.isOn()) { RenderSystem.setShaderFogStart(-8f); RenderSystem.setShaderFogEnd(viewDistance * 0.9f); }
        } else if (sub == CameraSubmersionType.LAVA) {
            if (f.lavaFog.isOn()) { RenderSystem.setShaderFogStart(0f); RenderSystem.setShaderFogEnd(24f); }
        } else if (sub == CameraSubmersionType.POWDER_SNOW) {
            if (f.snowFog.isOn()) { RenderSystem.setShaderFogStart(0f); RenderSystem.setShaderFogEnd(24f); }
        } else if (fogType == BackgroundRenderer.FogType.FOG_TERRAIN && !thickFog) {
            if (f.worldFog.isOn()) {
                RenderSystem.setShaderFogStart(viewDistance * 4f);
                RenderSystem.setShaderFogEnd(viewDistance * 5f);
            } else {
                float m = f.distance.floatValue() / 100f;
                RenderSystem.setShaderFogStart(RenderSystem.getShaderFogStart() * m);
                RenderSystem.setShaderFogEnd(RenderSystem.getShaderFogEnd() * m);
            }
        }
    }
}
