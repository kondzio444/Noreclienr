package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.gui.NoreScreen;
import dev.noreclient.platform.ScreenAdapter;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Minecraft.class)
public abstract class MinecraftClientMixin {
    @Inject(method = "tick", at = @At("HEAD"))
    private void noreclient$tick(CallbackInfo ci) {
        NoreClient.onTick();
    }

    @Inject(method = "close", at = @At("HEAD"))
    private void noreclient$stop(CallbackInfo ci) {
        NoreClient.onShutdown();
    }
}
