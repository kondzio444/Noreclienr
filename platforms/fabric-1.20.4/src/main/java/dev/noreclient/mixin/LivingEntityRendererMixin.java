package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.SelfNametag;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.entity.LivingEntityRenderer;
import net.minecraft.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(LivingEntityRenderer.class)
public abstract class LivingEntityRendererMixin {
    @Inject(method = "hasLabel(Lnet/minecraft/entity/LivingEntity;)Z", at = @At("HEAD"), cancellable = true)
    private void noreclient$selfLabel(LivingEntity entity, CallbackInfoReturnable<Boolean> cir) {
        MinecraftClient mc = MinecraftClient.getInstance();
        NoreClient c = NoreClient.get();
        if (c == null || entity != mc.player || mc.options.hudHidden) return;
        if (c.modules().get(SelfNametag.class).isActive() && !mc.options.getPerspective().isFirstPerson()) cir.setReturnValue(true);
    }
}
