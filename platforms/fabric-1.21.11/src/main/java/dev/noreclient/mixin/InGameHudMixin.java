package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.hud.PotionEffectsHud;
import dev.noreclient.module.utility.ScoreboardTweaks;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Gui.class)
public abstract class InGameHudMixin {
    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$hud(GuiGraphics context, DeltaTracker tickCounter, CallbackInfo ci) {
        if (Minecraft.getInstance().options.hideGui) return;
        GfxImpl g = new GfxImpl(context);
        NoreClient.onRenderHud(g, tickCounter.getGameTimeDeltaPartialTick(true));
        g.finish();
    }

    @Inject(method = "renderCrosshair", at = @At("HEAD"), cancellable = true)
    private void noreclient$crosshair(GuiGraphics context, DeltaTracker tickCounter, CallbackInfo ci) {
        if (Minecraft.getInstance().getDebugOverlay().showDebugScreen()) return;
        GfxImpl g = new GfxImpl(context);
        if (NoreClient.onRenderCrosshair(g)) ci.cancel();
        g.finish();
    }

    @Inject(method = "renderEffects", at = @At("HEAD"), cancellable = true)
    private void noreclient$effects(GuiGraphics context, DeltaTracker tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        PotionEffectsHud p = c.modules().get(PotionEffectsHud.class);
        if (p.isActive() && p.hideVanilla.isOn()) ci.cancel();
    }

    @Inject(method = "renderScoreboardSidebar(Lnet/minecraft/client/gui/GuiGraphics;Lnet/minecraft/client/DeltaTracker;)V", at = @At("HEAD"), cancellable = true)
    private void noreclient$scoreboard(GuiGraphics context, DeltaTracker tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c != null && c.modules().get(ScoreboardTweaks.class).isActive()) ci.cancel();
    }
}
