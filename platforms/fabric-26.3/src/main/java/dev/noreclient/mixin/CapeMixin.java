package dev.noreclient.mixin;

import dev.noreclient.platform.GameImpl;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.core.ClientAsset;
import net.minecraft.world.entity.player.PlayerSkin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Nore cape (Cosmetics module) on the local player, also used for the elytra. */
@Mixin(AbstractClientPlayer.class)
public abstract class CapeMixin {
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true)
    private void noreclient$cape(CallbackInfoReturnable<PlayerSkin> cir) {
        if (GameImpl.localCape == null || (Object) this != Minecraft.getInstance().player) return;
        PlayerSkin s = cir.getReturnValue();
        ClientAsset.ResourceTexture cape = new ClientAsset.ResourceTexture(GameImpl.localCape, GameImpl.localCape);
        cir.setReturnValue(new PlayerSkin(s.body(), cape, cape, s.model(), s.secure()));
    }
}
