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
        if (GameImpl.localCape == null || (Object) this != MinecraftClient.getInstance().player) return;
        cir.setReturnValue(GameImpl.localCape);
    }
}
