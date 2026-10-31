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

/** Nore capes on the local player (Cosmetics module) and on other Nore players (Nore Hub), also used for the elytra. */
@Mixin(AbstractClientPlayerEntity.class)
public abstract class CapeMixin {
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true)
    private void noreclient$cape(CallbackInfoReturnable<SkinTextures> cir) {
        // the local player wears the cape from the Cosmetics module, other Nore players the one from the Nore Hub
        net.minecraft.util.Identifier capeId;
        if ((Object) this == MinecraftClient.getInstance().player) capeId = GameImpl.localCape;
        else {
            dev.noreclient.api.TextureRef t = dev.noreclient.cosmetic.Wardrobe.capeOf(((net.minecraft.entity.player.PlayerEntity) (Object) this).getGameProfile().name(),
                    (int) (System.currentTimeMillis() / 150 % dev.noreclient.util.Capes.FRAMES));
            capeId = t == null ? null : (net.minecraft.util.Identifier) t.handle;
        }
        if (capeId == null) return;
        SkinTextures s = cir.getReturnValue();
        AssetInfo.TextureAssetInfo cape = new AssetInfo.TextureAssetInfo(capeId, capeId);
        cir.setReturnValue(new SkinTextures(s.body(), cape, cape, s.model(), s.secure()));
    }
}
