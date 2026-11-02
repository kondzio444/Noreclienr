package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.hud.PotionEffectsHud;
import dev.noreclient.module.utility.ScoreboardTweaks;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Hud;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Hud.class)
public abstract class InGameHudMixin {
    @Inject(method = "extractRenderState", at = @At("TAIL"))
    private void noreclient$hud(GuiGraphicsExtractor context, DeltaTracker tickCounter, CallbackInfo ci) {
        if (Minecraft.getInstance().gui.hud.isHidden()) return;
        GfxImpl g = new GfxImpl(context);
        NoreClient.onRenderHud(g, tickCounter.getGameTimeDeltaPartialTick(true));
        g.finish();
    }

    @Inject(method = "extractCrosshair", at = @At("HEAD"), cancellable = true)
    private void noreclient$crosshair(GuiGraphicsExtractor context, DeltaTracker tickCounter, CallbackInfo ci) {
        if (Minecraft.getInstance().getDebugOverlay().showDebugScreen()) return;
        GfxImpl g = new GfxImpl(context);
        if (NoreClient.onRenderCrosshair(g)) ci.cancel();
        g.finish();
    }

    @Inject(method = "extractEffects", at = @At("HEAD"), cancellable = true)
    private void noreclient$effects(GuiGraphicsExtractor context, DeltaTracker tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        PotionEffectsHud p = c.modules().get(PotionEffectsHud.class);
        if (p.isActive() && p.hideVanilla.isOn()) ci.cancel();
    }

    @Inject(method = "extractScoreboardSidebar(Lnet/minecraft/client/gui/GuiGraphicsExtractor;Lnet/minecraft/client/DeltaTracker;)V", at = @At("HEAD"), cancellable = true)
    private void noreclient$scoreboard(GuiGraphicsExtractor context, DeltaTracker tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c != null && c.modules().get(ScoreboardTweaks.class).isActive()) ci.cancel();
    }
}
