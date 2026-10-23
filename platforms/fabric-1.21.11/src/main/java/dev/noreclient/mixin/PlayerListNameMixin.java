package dev.noreclient.mixin;

import dev.noreclient.platform.NoreText;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Nore users get the Nore icon and friends a green star in the tab list. */
@Mixin(PlayerTabOverlay.class)
public abstract class PlayerListNameMixin {
    @Inject(method = "getNameForDisplay", at = @At("RETURN"), cancellable = true)
    private void noreclient$friend(PlayerInfo entry, CallbackInfoReturnable<Component> cir) {
        cir.setReturnValue(NoreText.decorate(entry.getProfile().name(), cir.getReturnValue()));
    }
}
