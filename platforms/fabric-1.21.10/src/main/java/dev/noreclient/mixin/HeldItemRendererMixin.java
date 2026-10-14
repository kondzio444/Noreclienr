package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.HandCustomizer;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.item.HeldItemRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Arm;
import net.minecraft.util.Hand;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(HeldItemRenderer.class)
public abstract class HeldItemRendererMixin {
    @Unique
    private static HandCustomizer noreclient$hand() {
        NoreClient c = NoreClient.get();
        if (c == null) return null;
        HandCustomizer h = c.modules().get(HandCustomizer.class);
        return h.isActive() ? h : null;
    }

    @Inject(method = "renderFirstPersonItem", at = @At("HEAD"))
    private void noreclient$push(AbstractClientPlayerEntity player, float tickDelta, float pitch, Hand hand, float swingProgress, ItemStack item,
                                 float equipProgress, MatrixStack matrices, net.minecraft.client.render.command.OrderedRenderCommandQueue queue, int light, CallbackInfo ci) {
        matrices.push();
        HandCustomizer h = noreclient$hand();
        if (h == null) return;
        boolean main = hand == Hand.MAIN_HAND;
        boolean right = main == (player.getMainArm() == Arm.RIGHT);
        float dir = right ? 1 : -1;
        if (main) {
            matrices.translate(h.mainX.get() * dir * 0.5, h.mainY.get() * 0.5, h.mainZ.get() * 0.5);
            float s = h.mainScale.floatValue();
            matrices.scale(s, s, s);
        } else {
            matrices.translate(h.offX.get() * dir * 0.5, h.offY.get() * 0.5, h.offZ.get() * 0.5);
            float s = h.offScale.floatValue();
            matrices.scale(s, s, s);
        }
    }

    @Inject(method = "renderFirstPersonItem", at = @At("RETURN"))
    private void noreclient$pop(AbstractClientPlayerEntity player, float tickDelta, float pitch, Hand hand, float swingProgress, ItemStack item,
                                float equipProgress, MatrixStack matrices, net.minecraft.client.render.command.OrderedRenderCommandQueue queue, int light, CallbackInfo ci) {
        matrices.pop();
    }

    @ModifyVariable(method = "renderFirstPersonItem", at = @At("HEAD"), argsOnly = true, ordinal = 2)
    private float noreclient$swing(float swingProgress) {
        HandCustomizer h = noreclient$hand();
        return h == null ? swingProgress : swingProgress * h.swingSpeed.floatValue() / 100f;
    }

    @ModifyVariable(method = "renderFirstPersonItem", at = @At("HEAD"), argsOnly = true, ordinal = 3)
    private float noreclient$equip(float equipProgress) {
        HandCustomizer h = noreclient$hand();
        return h != null && h.noEquip.isOn() ? 0f : equipProgress;
    }
}
