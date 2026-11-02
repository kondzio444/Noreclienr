package dev.noreclient.mixin;

import dev.noreclient.module.render.SkyStyle;
import net.minecraft.client.Camera;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.SkyRenderer;
import net.minecraft.client.renderer.state.level.SkyRenderState;
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
        org.joml.Vector3fc sky = state.skyColor;
        double[] c = s.sky(sky.x(), sky.y(), sky.z());
        state.skyColor = new org.joml.Vector3f((float) c[0], (float) c[1], (float) c[2]);
        state.starBrightness = s.stars(state.starBrightness);
        org.joml.Vector4fc glow = state.sunriseAndSunsetColor;
        int g = s.sunset(dev.noreclient.util.ColorUtil.argb(255, (int) (glow.x() * 255), (int) (glow.y() * 255), (int) (glow.z() * 255)));
        state.sunriseAndSunsetColor = new org.joml.Vector4f(((g >> 16) & 0xFF) / 255f, ((g >> 8) & 0xFF) / 255f, (g & 0xFF) / 255f, glow.w());
    }
}
