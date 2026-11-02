package dev.noreclient.mixin;

import dev.noreclient.module.render.SkyStyle;
import net.minecraft.client.Camera;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.SkyRenderer;
import net.minecraft.client.renderer.state.SkyRenderState;
import net.minecraft.world.level.dimension.DimensionType;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Sky Style: recolours the overworld sky, stars and sunrise glow after vanilla extracted them. */
@Mixin(SkyRenderer.class)
public abstract class SkyRendererMixin {
    @Inject(method = "extractRenderState", at = @At("TAIL"))
    private void noreclient$sky(ClientLevel level, float partialTicks, Camera camera, SkyRenderState state, CallbackInfo ci) {
        SkyStyle s = SkyStyle.active();
        if (s == null || state.skybox != DimensionType.Skybox.OVERWORLD) return;
        state.skyColor = s.sky(state.skyColor);
        state.starBrightness = s.stars(state.starBrightness);
        state.sunriseAndSunsetColor = s.sunset(state.sunriseAndSunsetColor);
    }
}
