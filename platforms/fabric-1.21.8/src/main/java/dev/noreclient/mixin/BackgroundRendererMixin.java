package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.FogControl;
import net.minecraft.block.enums.CameraSubmersionType;
import net.minecraft.client.render.Camera;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.client.render.fog.FogRenderer;
import net.minecraft.client.world.ClientWorld;
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
    @Unique private CameraSubmersionType noreclient$sub = CameraSubmersionType.NONE;
    @Unique private boolean noreclient$thick;

    @Inject(method = "applyFog(Lnet/minecraft/client/render/Camera;IZLnet/minecraft/client/render/RenderTickCounter;FLnet/minecraft/client/world/ClientWorld;)Lorg/joml/Vector4f;", at = @At("HEAD"))
    private void noreclient$camera(Camera camera, int viewDistance, boolean thick, RenderTickCounter tickCounter, float skyDarkness, ClientWorld world,
                                   CallbackInfoReturnable<Vector4f> cir) {
        noreclient$sub = camera.getSubmersionType();
        noreclient$thick = thick;
    }

    @ModifyArgs(method = "applyFog(Lnet/minecraft/client/render/Camera;IZLnet/minecraft/client/render/RenderTickCounter;FLnet/minecraft/client/world/ClientWorld;)Lorg/joml/Vector4f;",
            at = @At(value = "INVOKE", target = "Lnet/minecraft/client/render/fog/FogRenderer;applyFog(Ljava/nio/ByteBuffer;ILorg/joml/Vector4f;FFFFFF)V"))
    private void noreclient$fog(Args args) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        FogControl f = c.modules().get(FogControl.class);
        if (!f.isActive()) return;
        float rdEnd = args.get(6);
        CameraSubmersionType sub = noreclient$sub;
        if (sub == CameraSubmersionType.WATER) {
            if (f.waterFog.isOn()) { args.set(3, -8f); args.set(4, rdEnd * 0.9f); }
        } else if (sub == CameraSubmersionType.LAVA) {
            if (f.lavaFog.isOn()) { args.set(3, 0f); args.set(4, 24f); }
        } else if (sub == CameraSubmersionType.POWDER_SNOW) {
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
