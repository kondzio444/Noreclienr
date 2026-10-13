package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.client.Keyboard;
import net.minecraft.client.MinecraftClient;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Keyboard.class)
public abstract class KeyboardMixin {
    @Inject(method = "onKey", at = @At("HEAD"))
    private void noreclient$onKey(long window, int key, int scancode, int action, int modifiers, CallbackInfo ci) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (action != GLFW.GLFW_PRESS || key == GLFW.GLFW_KEY_UNKNOWN) return;
        if (window != mc.getWindow().getHandle() || mc.currentScreen != null || mc.player == null) return;
        NoreClient c = NoreClient.get();
        if (c != null) c.modules().onKey(key);
    }
}
