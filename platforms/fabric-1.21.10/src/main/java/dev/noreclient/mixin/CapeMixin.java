package dev.noreclient.mixin;

import dev.noreclient.platform.GameImpl;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.util.AssetInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Nore cape (Cosmetics module) on the local player, also used for the elytra. */
@Mixin(AbstractClientPlayerEntity.class)
public abstract class CapeMixin {
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true)
    private void noreclient$cape(CallbackInfoReturnable<SkinTextures> cir) {
        if (GameImpl.localCape == null || (Object) this != MinecraftClient.getInstance().player) return;
        SkinTextures s = cir.getReturnValue();
        AssetInfo.TextureAssetInfo cape = new AssetInfo.TextureAssetInfo(GameImpl.localCape, GameImpl.localCape);
        cir.setReturnValue(new SkinTextures(s.body(), cape, cape, s.model(), s.secure()));
    }
}
