package dev.noreclient.mixin;

import dev.noreclient.module.render.SkyStyle;
import net.minecraft.client.renderer.CloudRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/** Sky Style: tints the clouds. */
@Mixin(CloudRenderer.class)
public abstract class CloudRendererMixin {
    @ModifyVariable(method = "render", at = @At("HEAD"), argsOnly = true, ordinal = 0)
    private int noreclient$clouds(int color) {
        SkyStyle s = SkyStyle.active();
        return s == null ? color : s.clouds(color);
    }
}
