package dev.noreclient.mixin;

import dev.noreclient.gui.NoreSplash;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.SplashOverlay;
import net.minecraft.util.Util;
import net.minecraft.util.math.MathHelper;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Nore loading screen on top of the Mojang one, with the same fade in / fade out. */
@Mixin(SplashOverlay.class)
public abstract class SplashOverlayMixin {
    @Shadow @Final private boolean reloading;
    @Shadow private float progress;
    @Shadow private long reloadCompleteTime;
    @Shadow private long reloadStartTime;

    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$splash(DrawContext context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        long now = Util.getMeasuringTimeMs();
        float done = reloadCompleteTime > -1L ? (now - reloadCompleteTime) / 1000f : -1f;
        float started = reloadStartTime > -1L ? (now - reloadStartTime) / 500f : -1f;
        float alpha = done >= 1f ? 1f - MathHelper.clamp(done - 1f, 0f, 1f) : reloading ? MathHelper.clamp(started, 0f, 1f) : 1f;
        if (alpha <= 0.01f) return;
        context.getMatrices().push();
        context.getMatrices().translate(0, 0, 500);
        GfxImpl g = new GfxImpl(context);
        NoreSplash.render(g, context.getScaledWindowWidth(), context.getScaledWindowHeight(), progress, alpha);
        g.finish();
        context.getMatrices().pop();
    }
}
