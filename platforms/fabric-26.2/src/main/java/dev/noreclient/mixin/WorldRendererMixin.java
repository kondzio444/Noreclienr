package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.render.BlockOutline;
import net.minecraft.client.renderer.LevelRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(LevelRenderer.class)
public abstract class WorldRendererMixin {
    /** Block outline colour: 26.2 submits the outline with its colour as an argument. */
    @ModifyVariable(method = "submitHitOutline", at = @At("HEAD"), argsOnly = true, ordinal = 0)
    private int noreclient$outlineColor(int color) {
        NoreClient c = NoreClient.get();
        if (c == null) return color;
        BlockOutline b = c.modules().get(BlockOutline.class);
        return b.isActive() ? b.color.getColor() : color;
    }
}
