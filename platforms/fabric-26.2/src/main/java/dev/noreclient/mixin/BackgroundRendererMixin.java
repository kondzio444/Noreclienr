package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.FogControl;
import net.minecraft.client.Camera;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.fog.FogData;
import net.minecraft.client.renderer.fog.FogRenderer;
import net.minecraft.world.level.material.FogType;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Fog Control on the 26.1 fog renderer: setupFog returns the distances as FogData. */
@Mixin(FogRenderer.class)
public abstract class BackgroundRendererMixin {
    @Inject(method = "setupFog", at = @At("RETURN"))
    private void noreclient$fog(Camera camera, int renderDistance, DeltaTracker deltaTracker, float darken, ClientLevel level,
                                CallbackInfoReturnable<FogData> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        FogControl f = c.modules().get(FogControl.class);
        if (!f.isActive()) return;
        FogData fog = cir.getReturnValue();
        float rdEnd = fog.renderDistanceEnd;
        FogType sub = camera.getFluidInCamera();
        if (sub == FogType.WATER) {
            if (f.waterFog.isOn()) { fog.environmentalStart = -8f; fog.environmentalEnd = rdEnd * 0.9f; }
        } else if (sub == FogType.LAVA) {
            if (f.lavaFog.isOn()) { fog.environmentalStart = 0f; fog.environmentalEnd = 24f; }
        } else if (sub == FogType.POWDER_SNOW) {
            if (f.snowFog.isOn()) { fog.environmentalStart = 0f; fog.environmentalEnd = 24f; }
        } else if (f.worldFog.isOn()) {
            fog.environmentalStart = rdEnd * 4f; fog.environmentalEnd = rdEnd * 5f;
            fog.renderDistanceStart = rdEnd * 4f; fog.renderDistanceEnd = rdEnd * 5f;
        } else {
            float m = f.distance.floatValue() / 100f;
            fog.environmentalStart *= m; fog.environmentalEnd *= m; fog.renderDistanceStart *= m; fog.renderDistanceEnd *= m;
        }
    }
}
