package dev.noreclient.mixin;

import dev.noreclient.platform.GameImpl;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Nore cape (Cosmetics module) on the local player, also used for the elytra (1.20–1.20.1: no SkinTextures yet). */
@Mixin(AbstractClientPlayerEntity.class)
public abstract class CapeMixin {
    @Inject(method = {"getCapeTexture", "getElytraTexture"}, at = @At("RETURN"), cancellable = true)
    private void noreclient$cape(CallbackInfoReturnable<Identifier> cir) {
        // the local player wears the cape from the Cosmetics module, other Nore players the one from the Nore Hub
        net.minecraft.util.Identifier capeId;
        if ((Object) this == MinecraftClient.getInstance().player) capeId = GameImpl.localCape;
        else {
            dev.noreclient.api.TextureRef t = dev.noreclient.cosmetic.Wardrobe.capeOf(((net.minecraft.entity.player.PlayerEntity) (Object) this).getGameProfile().getName(),
                    (int) (System.currentTimeMillis() / 150 % dev.noreclient.util.Capes.FRAMES));
            capeId = t == null ? null : (net.minecraft.util.Identifier) t.handle;
        }
        if (capeId == null) return;
        cir.setReturnValue(capeId);
    }
}
