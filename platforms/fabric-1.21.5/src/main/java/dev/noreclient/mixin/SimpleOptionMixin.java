package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.Fullbright;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.SimpleOption;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Fullbright: report a boosted gamma value while the module is on, without saving it. */
@Mixin(SimpleOption.class)
public abstract class SimpleOptionMixin<T> {
    @SuppressWarnings("unchecked")
    @Inject(method = "getValue", at = @At("HEAD"), cancellable = true)
    private void noreclient$gamma(CallbackInfoReturnable<T> cir) {
        NoreClient c = NoreClient.get();
        if (c == null || c.modules() == null) return;
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc == null || mc.options == null || (Object) this != mc.options.getGamma()) return;
        Fullbright fb = c.modules().get(Fullbright.class);
        if (fb.isActive() && mc.world != null) cir.setReturnValue((T) Double.valueOf(fb.getGamma()));
    }
}
