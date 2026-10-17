package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.platform.ScreenAdapter;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** 26.2 moved the screen stack from Minecraft into Gui: the Nore menus replace the vanilla ones here. */
@Mixin(Gui.class)
public abstract class GuiScreenMixin {
    @ModifyVariable(method = "setScreen", at = @At("HEAD"), argsOnly = true)
    private Screen noreclient$replaceMenus(Screen screen) {
        NoreScreen replacement = null;
        if (screen instanceof TitleScreen) replacement = NoreClient.titleScreen();
        else if (screen instanceof PauseScreen && ((PauseScreen) screen).showsPauseMenu()) replacement = NoreClient.pauseScreen();
        else if (screen instanceof net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen && !dev.noreclient.platform.ScreenRouting.consumeVanilla()) {
            replacement = NoreClient.multiplayerScreen();
        }
        return replacement != null ? new ScreenAdapter(replacement) : screen;
    }
}
