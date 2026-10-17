package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundSetTimePacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPacketListener.class)
public abstract class ClientPlayNetworkHandlerMixin {
    @Inject(method = "handleSetTime", at = @At("HEAD"))
    private void noreclient$time(ClientboundSetTimePacket packet, CallbackInfo ci) {
        // the handler runs once on the network thread (and re-schedules itself); count only the main-thread call
        if (Minecraft.getInstance().isSameThread()) NoreClient.onServerTime(packet.gameTime());
    }
}
