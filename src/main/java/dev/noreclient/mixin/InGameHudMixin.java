package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.hud.PotionEffectsHud;
import dev.noreclient.module.render.CustomCrosshair;
import dev.noreclient.module.utility.ScoreboardTweaks;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.client.render.RenderTickCounter;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(InGameHud.class)
public abstract class InGameHudMixin {
    @Inject(method = "renderCrosshair", at = @At("HEAD"), cancellable = true)
    private void noreclient$crosshair(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        CustomCrosshair cc = c.modules().get(CustomCrosshair.class);
        if (cc.isEnabled()) {
            ci.cancel();
            if (!net.minecraft.client.MinecraftClient.getInstance().getDebugHud().shouldShowDebugHud()) {
                cc.render(context, context.getScaledWindowWidth(), context.getScaledWindowHeight());
            }
        }
    }

    @Inject(method = "renderStatusEffectOverlay", at = @At("HEAD"), cancellable = true)
    private void noreclient$effects(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        PotionEffectsHud p = c.modules().get(PotionEffectsHud.class);
        if (p.isEnabled() && p.hideVanilla.isOn()) ci.cancel();
    }

    @Inject(method = "renderScoreboardSidebar(Lnet/minecraft/client/gui/DrawContext;Lnet/minecraft/client/render/RenderTickCounter;)V", at = @At("HEAD"), cancellable = true)
    private void noreclient$scoreboard(DrawContext context, RenderTickCounter tickCounter, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c != null && c.modules().get(ScoreboardTweaks.class).isEnabled()) ci.cancel();
    }
}
