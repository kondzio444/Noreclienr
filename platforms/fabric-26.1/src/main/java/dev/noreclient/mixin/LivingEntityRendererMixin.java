package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.SelfNametag;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(LivingEntityRenderer.class)
public abstract class LivingEntityRendererMixin {
    @Inject(method = "shouldShowName(Lnet/minecraft/world/entity/LivingEntity;D)Z", at = @At("HEAD"), cancellable = true)
    private void noreclient$selfLabel(LivingEntity entity, double distance, CallbackInfoReturnable<Boolean> cir) {
        Minecraft mc = Minecraft.getInstance();
        NoreClient c = NoreClient.get();
        if (c == null || entity != mc.player || mc.options.hideGui) return;
        if (c.modules().get(SelfNametag.class).isActive() && !mc.options.getCameraType().isFirstPerson()) cir.setReturnValue(true);
    }
}
