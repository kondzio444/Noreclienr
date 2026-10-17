package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.ChatFormatting;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Friends get a green star in the tab list. */
@Mixin(PlayerTabOverlay.class)
public abstract class PlayerListNameMixin {
    @Inject(method = "getNameForDisplay", at = @At("RETURN"), cancellable = true)
    private void noreclient$friend(PlayerInfo entry, CallbackInfoReturnable<Component> cir) {
        if (!NoreClient.isFriendHighlighted(entry.getProfile().name())) return;
        cir.setReturnValue(Component.literal("★ ").withStyle(ChatFormatting.GREEN).append(cir.getReturnValue()));
    }
}
