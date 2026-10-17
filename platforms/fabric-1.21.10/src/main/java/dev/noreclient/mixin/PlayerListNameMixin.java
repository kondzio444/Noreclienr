package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Friends get a green star in the tab list. */
@Mixin(PlayerListHud.class)
public abstract class PlayerListNameMixin {
    @Inject(method = "getPlayerName", at = @At("RETURN"), cancellable = true)
    private void noreclient$friend(PlayerListEntry entry, CallbackInfoReturnable<Text> cir) {
        if (!NoreClient.isFriendHighlighted(entry.getProfile().name())) return;
        cir.setReturnValue(Text.literal("★ ").formatted(Formatting.GREEN).append(cir.getReturnValue()));
    }
}
