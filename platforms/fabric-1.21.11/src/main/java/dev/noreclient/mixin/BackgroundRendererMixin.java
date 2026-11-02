package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.FogControl;
import net.minecraft.client.Camera;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.fog.FogRenderer;
import net.minecraft.world.level.material.FogType;
import org.joml.Vector4f;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyArgs;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import org.spongepowered.asm.mixin.injection.invoke.arg.Args;

/** Fog Control on the 1.21.6+ fog renderer: edits the distances before they are uploaded. */
@Mixin(FogRenderer.class)
public abstract class BackgroundRendererMixin {
    @Unique private FogType noreclient$sub = FogType.NONE;
    @Unique private boolean noreclient$thick;

    @Inject(method = "setupFog(Lnet/minecraft/client/Camera;ILnet/minecraft/client/DeltaTracker;FLnet/minecraft/client/multiplayer/ClientLevel;)Lorg/joml/Vector4f;", at = @At("HEAD"))
    private void noreclient$camera(Camera camera, int viewDistance, DeltaTracker tickCounter, float skyDarkness, ClientLevel world,
                                   CallbackInfoReturnable<Vector4f> cir) {
        noreclient$sub = camera.getFluidInCamera();
        noreclient$thick = false; // 1.21.11+: thick fog is a fog modifier, the camera type decides
    }

    @ModifyArgs(method = "setupFog(Lnet/minecraft/client/Camera;ILnet/minecraft/client/DeltaTracker;FLnet/minecraft/client/multiplayer/ClientLevel;)Lorg/joml/Vector4f;",
            at = @At(value = "INVOKE", target = "Lnet/minecraft/client/renderer/fog/FogRenderer;updateBuffer(Ljava/nio/ByteBuffer;ILorg/joml/Vector4f;FFFFFF)V"))
    private void noreclient$fog(Args args) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        FogControl f = c.modules().get(FogControl.class);
        if (!f.isActive()) return;
        float rdEnd = args.get(6);
        FogType sub = noreclient$sub;
        if (sub == FogType.WATER) {
            if (f.waterFog.isOn()) { args.set(3, -8f); args.set(4, rdEnd * 0.9f); }
        } else if (sub == FogType.LAVA) {
            if (f.lavaFog.isOn()) { args.set(3, 0f); args.set(4, 24f); }
        } else if (sub == FogType.POWDER_SNOW) {
            if (f.snowFog.isOn()) { args.set(3, 0f); args.set(4, 24f); }
        } else if (!noreclient$thick) {
            if (f.worldFog.isOn()) {
                args.set(3, rdEnd * 4f); args.set(4, rdEnd * 5f);
                args.set(5, rdEnd * 4f); args.set(6, rdEnd * 5f);
            } else {
                float m = f.distance.floatValue() / 100f;
                for (int i = 3; i <= 6; i++) args.set(i, (float) args.get(i) * m);
            }
        }
    }
}
