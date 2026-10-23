package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.platform.ScreenAdapter;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MinecraftClient.class)
public abstract class MinecraftClientMixin {
    @Inject(method = "tick", at = @At("HEAD"))
    private void noreclient$tick(CallbackInfo ci) {
        NoreClient.onTick();
    }

    @Inject(method = "stop", at = @At("HEAD"))
    private void noreclient$stop(CallbackInfo ci) {
        NoreClient.onShutdown();
    }

    @ModifyVariable(method = "setScreen", at = @At("HEAD"), argsOnly = true)
    private Screen noreclient$replaceMenus(Screen screen) {
        NoreScreen replacement = null;
        if (screen instanceof TitleScreen) replacement = NoreClient.titleScreen();
        else if (screen instanceof GameMenuScreen && ((GameMenuScreen) screen).shouldShowMenu()) replacement = NoreClient.pauseScreen();
        else if (screen instanceof net.minecraft.client.gui.screen.multiplayer.MultiplayerScreen && !dev.noreclient.platform.ScreenRouting.keepVanilla(screen)) {
            replacement = NoreClient.multiplayerScreen();
        }
        Screen shown = replacement != null ? new ScreenAdapter(replacement) : screen;
        dev.noreclient.platform.ScreenRouting.shown(shown);
        return shown;
    }
}
