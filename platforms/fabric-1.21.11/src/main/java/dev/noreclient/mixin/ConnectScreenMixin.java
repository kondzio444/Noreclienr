package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.TransferState;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** "Connecting" screen shows the target server: icon, MOTD, players, flag. */
@Mixin(ConnectScreen.class)
public abstract class ConnectScreenMixin {
    @Inject(method = "startConnecting(Lnet/minecraft/client/gui/screens/Screen;Lnet/minecraft/client/Minecraft;Lnet/minecraft/client/multiplayer/resolver/ServerAddress;Lnet/minecraft/client/multiplayer/ServerData;ZLnet/minecraft/client/multiplayer/TransferState;)V", at = @At("HEAD"))
    private static void noreclient$target(Screen screen, Minecraft client, ServerAddress address, ServerData info, boolean quickPlay, TransferState cookies, CallbackInfo ci) {
        NoreClient.onConnecting(info != null ? info.name : address.getHost(), info != null ? info.ip : address.getHost() + (address.getPort() == 25565 ? "" : ":" + address.getPort()));
    }

    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$card(GuiGraphics context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        GfxImpl g = new GfxImpl(context);
        NoreClient.renderConnecting(g, context.guiWidth(), context.guiHeight());
        g.finish();
    }
}
