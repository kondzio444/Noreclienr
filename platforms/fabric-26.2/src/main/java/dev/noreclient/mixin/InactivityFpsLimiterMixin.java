package dev.noreclient.mixin;

import com.mojang.blaze3d.platform.FramerateLimitTracker;
import dev.noreclient.NoreClient;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Dynamic FPS: the frame limit lives here since 1.21.2. */
@Mixin(FramerateLimitTracker.class)
public abstract class InactivityFpsLimiterMixin {
    @Inject(method = "getFramerateLimit", at = @At("RETURN"), cancellable = true)
    private void noreclient$dynamicFps(CallbackInfoReturnable<Integer> cir) {
        int limit = NoreClient.framerateLimit(cir.getReturnValue(), Minecraft.getInstance().isWindowActive());
        if (limit != cir.getReturnValue()) cir.setReturnValue(limit);
    }
}
