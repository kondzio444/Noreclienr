package dev.noreclient.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.noreclient.NoreClient;
import dev.noreclient.module.render.HandCustomizer;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.renderer.ItemInHandRenderer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.HumanoidArm;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ItemInHandRenderer.class)
public abstract class HeldItemRendererMixin {
    @Unique
    private static HandCustomizer noreclient$hand() {
        NoreClient c = NoreClient.get();
        if (c == null) return null;
        HandCustomizer h = c.modules().get(HandCustomizer.class);
        return h.isActive() ? h : null;
    }

    @Inject(method = "submitArmWithItem", at = @At("HEAD"))
    private void noreclient$push(AbstractClientPlayer player, float tickDelta, float pitch, InteractionHand hand, float swingProgress, ItemStack item,
                                 float equipProgress, PoseStack matrices, net.minecraft.client.renderer.SubmitNodeCollector queue, int light, CallbackInfo ci) {
        matrices.pushPose();
        HandCustomizer h = noreclient$hand();
        if (h == null) return;
        boolean main = hand == InteractionHand.MAIN_HAND;
        boolean right = main == (player.getMainArm() == HumanoidArm.RIGHT);
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

    @Inject(method = "submitArmWithItem", at = @At("RETURN"))
    private void noreclient$pop(AbstractClientPlayer player, float tickDelta, float pitch, InteractionHand hand, float swingProgress, ItemStack item,
                                float equipProgress, PoseStack matrices, net.minecraft.client.renderer.SubmitNodeCollector queue, int light, CallbackInfo ci) {
        matrices.popPose();
    }

    @ModifyVariable(method = "submitArmWithItem", at = @At("HEAD"), argsOnly = true, ordinal = 2)
    private float noreclient$swing(float swingProgress) {
        HandCustomizer h = noreclient$hand();
        return h == null ? swingProgress : swingProgress * h.swingSpeed.floatValue() / 100f;
    }

    @ModifyVariable(method = "submitArmWithItem", at = @At("HEAD"), argsOnly = true, ordinal = 3)
    private float noreclient$equip(float equipProgress) {
        HandCustomizer h = noreclient$hand();
        return h != null && h.noEquip.isOn() ? 0f : equipProgress;
    }
}
