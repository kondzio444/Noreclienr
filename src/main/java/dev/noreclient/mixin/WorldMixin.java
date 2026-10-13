package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.ClearWeather;
import net.minecraft.world.World;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(World.class)
public abstract class WorldMixin {
    @Shadow
    public abstract boolean isClient();

    private boolean noreclient$clear() {
        NoreClient c = NoreClient.get();
        return isClient() && c != null && c.modules().get(ClearWeather.class).isEnabled();
    }

    @Inject(method = "getRainGradient", at = @At("HEAD"), cancellable = true)
    private void noreclient$rain(float delta, CallbackInfoReturnable<Float> cir) {
        if (noreclient$clear()) cir.setReturnValue(0f);
    }

    @Inject(method = "getThunderGradient", at = @At("HEAD"), cancellable = true)
    private void noreclient$thunder(float delta, CallbackInfoReturnable<Float> cir) {
        if (noreclient$clear()) cir.setReturnValue(0f);
    }
}
