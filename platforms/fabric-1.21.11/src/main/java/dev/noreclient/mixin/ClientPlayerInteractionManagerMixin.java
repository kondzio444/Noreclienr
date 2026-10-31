package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.platform.GameImpl;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MultiPlayerGameMode.class)
public abstract class ClientPlayerInteractionManagerMixin {
    @Inject(method = "attack", at = @At("HEAD"))
    private void noreclient$attack(Player player, Entity target, CallbackInfo ci) {
        NoreClient.onAttack(target, GameImpl.reach(player, target));
    }
}
