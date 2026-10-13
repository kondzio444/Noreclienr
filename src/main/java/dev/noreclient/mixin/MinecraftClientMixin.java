package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.gui.menu.NoreMainMenu;
import dev.noreclient.gui.menu.NorePauseMenu;
import dev.noreclient.module.client.ClientSettings;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(MinecraftClient.class)
public abstract class MinecraftClientMixin {
    @ModifyVariable(method = "setScreen", at = @At("HEAD"), argsOnly = true)
    private Screen noreclient$replaceTitle(Screen screen) {
        if (screen instanceof TitleScreen && !NoreMainMenu.bypass) {
            NoreClient c = NoreClient.get();
            if (c != null && c.modules().get(ClientSettings.class).customMenu.isOn()) return new NoreMainMenu();
        }
        if (screen instanceof GameMenuScreen gm && gm.shouldShowMenu() && !NorePauseMenu.bypass) {
            NoreClient c = NoreClient.get();
            if (c != null && c.modules().get(ClientSettings.class).customPause.isOn()) return new NorePauseMenu();
        }
        NoreMainMenu.bypass = false;
        NorePauseMenu.bypass = false;
        return screen;
    }
}
