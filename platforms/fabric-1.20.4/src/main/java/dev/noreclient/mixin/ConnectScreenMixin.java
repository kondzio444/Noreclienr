package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.platform.GfxImpl;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.multiplayer.ConnectScreen;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** "Connecting" screen shows the target server: icon, MOTD, players, flag. */
@Mixin(ConnectScreen.class)
public abstract class ConnectScreenMixin {
    @Inject(method = "connect(Lnet/minecraft/client/gui/screen/Screen;Lnet/minecraft/client/MinecraftClient;Lnet/minecraft/client/network/ServerAddress;Lnet/minecraft/client/network/ServerInfo;Z)V", at = @At("HEAD"))
    private static void noreclient$target(Screen screen, MinecraftClient client, ServerAddress address, ServerInfo info, boolean quickPlay, CallbackInfo ci) {
        NoreClient.onConnecting(info != null ? info.name : address.getAddress(), info != null ? info.address : address.getAddress() + (address.getPort() == 25565 ? "" : ":" + address.getPort()));
    }

    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$card(DrawContext context, int mouseX, int mouseY, float delta, CallbackInfo ci) {
        GfxImpl g = new GfxImpl(context);
        NoreClient.renderConnecting(g, context.getScaledWindowWidth(), context.getScaledWindowHeight());
        g.finish();
    }
}
