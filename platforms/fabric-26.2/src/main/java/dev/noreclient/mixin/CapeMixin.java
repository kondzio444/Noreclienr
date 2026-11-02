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

/** Nore capes on the local player (Cosmetics module) and on other Nore players (Nore Hub), also used for the elytra. */
@Mixin(AbstractClientPlayer.class)
public abstract class CapeMixin {
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true)
    private void noreclient$cape(CallbackInfoReturnable<PlayerSkin> cir) {
        // the local player wears the cape from the Cosmetics module, other Nore players the one from the Nore Hub
        net.minecraft.resources.Identifier capeId;
        if ((Object) this == Minecraft.getInstance().player) capeId = GameImpl.localCape;
        else {
            dev.noreclient.api.TextureRef t = dev.noreclient.cosmetic.Wardrobe.capeOf(((net.minecraft.world.entity.player.Player) (Object) this).getGameProfile().name(),
                    (int) (System.currentTimeMillis() / 150 % dev.noreclient.util.Capes.FRAMES));
            capeId = t == null ? null : (net.minecraft.resources.Identifier) t.handle;
        }
        if (capeId == null) return;
        PlayerSkin s = cir.getReturnValue();
        ClientAsset.ResourceTexture cape = new ClientAsset.ResourceTexture(capeId, capeId);
        cir.setReturnValue(new PlayerSkin(s.body(), cape, cape, s.model(), s.secure()));
    }
}
