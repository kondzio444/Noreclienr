package dev.noreclient.mixin;

import dev.noreclient.platform.NoreText;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Nore users get the Nore icon and friends a green star in the tab list. */
@Mixin(PlayerListHud.class)
public abstract class PlayerListNameMixin {
    @Inject(method = "getPlayerName", at = @At("RETURN"), cancellable = true)
    private void noreclient$friend(PlayerListEntry entry, CallbackInfoReturnable<Text> cir) {
        cir.setReturnValue(NoreText.decorate(entry.getProfile().name(), cir.getReturnValue()));
    }
}
