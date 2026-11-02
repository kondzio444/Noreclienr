package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.hud.PotionEffectsHud;
import dev.noreclient.module.utility.ScoreboardTweaks;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.client.render.RenderTickCounter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(InGameHud.class)
public abstract class InGameHudMixin {
    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$hud(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        if (MinecraftClient.getInstance().options.hudHidden) return;
        GfxImpl g = new GfxImpl(context);
        NoreClient.onRenderHud(g, tickCounter.getTickProgress(true));
        g.finish();
    }

    @Inject(method = "renderCrosshair", at = @At("HEAD"), cancellable = true)
    private void noreclient$crosshair(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        if (MinecraftClient.getInstance().getDebugHud().shouldShowDebugHud()) return;
        GfxImpl g = new GfxImpl(context);
        if (NoreClient.onRenderCrosshair(g)) ci.cancel();
        g.finish();
    }

    @Inject(method = "renderStatusEffectOverlay", at = @At("HEAD"), cancellable = true)
    private void noreclient$effects(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        PotionEffectsHud p = c.modules().get(PotionEffectsHud.class);
        if (p.isActive() && p.hideVanilla.isOn()) ci.cancel();
    }

    @Inject(method = "renderScoreboardSidebar(Lnet/minecraft/client/gui/DrawContext;Lnet/minecraft/client/render/RenderTickCounter;)V", at = @At("HEAD"), cancellable = true)
    private void noreclient$scoreboard(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c != null && c.modules().get(ScoreboardTweaks.class).isActive()) ci.cancel();
    }
}
