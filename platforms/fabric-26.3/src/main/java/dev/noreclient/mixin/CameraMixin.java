package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.CameraTweaks;
import dev.noreclient.module.render.Freelook;
import net.minecraft.client.Camera;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Camera.class)
public abstract class CameraMixin {
    @Shadow
    protected abstract void setRotation(float yaw, float pitch);

    // 26.1: the camera aligns itself with the entity in alignWithEntity (one setRotation per branch)
    @Inject(method = "alignWithEntity", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Camera;setRotation(FF)V", ordinal = 0, shift = At.Shift.AFTER))
    private void noreclient$freelook(float partialTicks, CallbackInfo ci) {
        noreclient$look();
    }

    @Inject(method = "alignWithEntity", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Camera;setRotation(FF)V", ordinal = 1, shift = At.Shift.AFTER))
    private void noreclient$freelook2(float partialTicks, CallbackInfo ci) {
        noreclient$look();
    }

    @org.spongepowered.asm.mixin.Unique
    private void noreclient$look() {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        Freelook f = c.modules().get(Freelook.class);
        if (f.isLooking()) setRotation(f.getYaw(), f.getPitch());
    }

    /** Zoom and FOV changer: the view FOV is computed by the camera since 26.1. */
    @Inject(method = "calculateFov", at = @At("RETURN"), cancellable = true)
    private void noreclient$zoom(float partialTicks, CallbackInfoReturnable<Float> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        double fov = cir.getReturnValue();
        dev.noreclient.module.render.FovChanger f = c.modules().get(dev.noreclient.module.render.FovChanger.class);
        if (f.isActive()) {
            int base = net.minecraft.client.Minecraft.getInstance().options.fov().get();
            fov = f.staticFov.isOn() ? f.fov.get() : fov * f.fov.get() / Math.max(1, base);
        }
        double divisor = c.modules().get(dev.noreclient.module.render.Zoom.class).getCurrentDivisor();
        if (divisor != 1.0 || fov != cir.getReturnValue()) cir.setReturnValue((float) (fov / divisor));
    }

    @Inject(method = "getMaxZoom", at = @At("HEAD"), cancellable = true)
    private void noreclient$noClip(float desired, CallbackInfoReturnable<Float> cir) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        CameraTweaks t = c.modules().get(CameraTweaks.class);
        if (t.isActive() && t.noClip.isOn()) cir.setReturnValue(desired / 4f * t.distance.floatValue());
    }

    @ModifyVariable(method = "getMaxZoom", at = @At("HEAD"), argsOnly = true)
    private float noreclient$distance(float desired) {
        NoreClient c = NoreClient.get();
        if (c == null) return desired;
        CameraTweaks t = c.modules().get(CameraTweaks.class);
        return t.isActive() && !t.noClip.isOn() ? desired / 4f * t.distance.floatValue() : desired;
    }
}
