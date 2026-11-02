package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.KeyboardHandler;
import net.minecraft.client.Minecraft;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(KeyboardHandler.class)
public abstract class KeyboardMixin {
    @Inject(method = "keyPress", at = @At("HEAD"))
    private void noreclient$onKey(long window, int action, net.minecraft.client.input.KeyEvent input, CallbackInfo ci) {
        int key = input.key();
        Minecraft mc = Minecraft.getInstance();
        if (key == GLFW.GLFW_KEY_UNKNOWN || window != mc.getWindow().handle()) return;
        NoreClient.onKey(key, action, mc.screen == null && mc.player != null);
    }
}
