package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.Fullbright;
import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Fullbright: report a boosted gamma value while the module is on, without saving it. */
@Mixin(OptionInstance.class)
public abstract class SimpleOptionMixin<T> {
    @SuppressWarnings("unchecked")
    @Inject(method = "get", at = @At("HEAD"), cancellable = true)
    private void noreclient$gamma(CallbackInfoReturnable<T> cir) {
        NoreClient c = NoreClient.get();
        if (c == null || c.modules() == null) return;
        Minecraft mc = Minecraft.getInstance();
        if (mc == null || mc.options == null || (Object) this != mc.options.gamma()) return;
        Fullbright fb = c.modules().get(Fullbright.class);
        if (fb.isActive() && mc.level != null) cir.setReturnValue((T) Double.valueOf(fb.getGamma()));
    }
}
