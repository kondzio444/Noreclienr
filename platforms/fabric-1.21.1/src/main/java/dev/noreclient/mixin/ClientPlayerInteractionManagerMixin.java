package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.platform.GameImpl;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPlayerInteractionManager.class)
public abstract class ClientPlayerInteractionManagerMixin {
    @Inject(method = "attackEntity", at = @At("HEAD"))
    private void noreclient$attack(PlayerEntity player, Entity target, CallbackInfo ci) {
        NoreClient.onAttack(target, GameImpl.reach(player, target));
    }
}
