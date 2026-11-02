package dev.noreclient.mixin;

import dev.noreclient.gui.NoreSplash;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.util.Util;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.LoadingOverlay;
import net.minecraft.util.Mth;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Nore loading screen on top of the Mojang one, with the same fade in / fade out. */
@Mixin(LoadingOverlay.class)
public abstract class SplashOverlayMixin {
    @Shadow @Final private boolean fadeIn;
    @Shadow private float currentProgress;
    @Shadow private long fadeOutStart;
    @Shadow private long fadeInStart;

    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$splash(GuiGraphics context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        long now = Util.getMillis();
        float done = fadeOutStart > -1L ? (now - fadeOutStart) / 1000f : -1f;
        float started = fadeInStart > -1L ? (now - fadeInStart) / 500f : -1f;
        float alpha = done >= 1f ? 1f - Mth.clamp(done - 1f, 0f, 1f) : fadeIn ? Mth.clamp(started, 0f, 1f) : 1f;
        if (alpha <= 0.01f) return;
        context.nextStratum(); // above the items / vanilla splash
        GfxImpl g = new GfxImpl(context);
        NoreSplash.render(g, context.guiWidth(), context.guiHeight(), currentProgress, alpha);
        g.finish();
    }
}
