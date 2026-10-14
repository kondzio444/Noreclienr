package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.network.packet.s2c.play.WorldTimeUpdateS2CPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPlayNetworkHandler.class)
public abstract class ClientPlayNetworkHandlerMixin {
    @Inject(method = "onWorldTimeUpdate", at = @At("HEAD"))
    private void noreclient$time(WorldTimeUpdateS2CPacket packet, CallbackInfo ci) {
        // the handler runs once on the network thread (and re-schedules itself); count only the main-thread call
        if (MinecraftClient.getInstance().isOnThread()) NoreClient.onServerTime(packet.time());
    }
}
