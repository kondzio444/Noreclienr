package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import net.minecraft.ChatFormatting;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Friends' name tags get a green star (the label text is taken into the render state since 1.21.2). */
@Mixin(EntityRenderer.class)
public abstract class EntityLabelMixin {
    @Inject(method = "getNameTag", at = @At("RETURN"), cancellable = true)
    private void noreclient$friendLabel(Entity entity, CallbackInfoReturnable<Component> cir) {
        Component text = cir.getReturnValue();
        if (text != null && entity instanceof Player p && NoreClient.isFriendHighlighted(p.getGameProfile().name())) {
            cir.setReturnValue(Component.literal("★ ").withStyle(ChatFormatting.GREEN).append(text));
        }
    }
}
