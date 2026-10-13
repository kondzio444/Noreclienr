package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.utility.ChatTimestamps;
import net.minecraft.client.gui.hud.ChatHud;
import net.minecraft.client.gui.hud.MessageIndicator;
import net.minecraft.network.message.MessageSignatureData;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(ChatHud.class)
public abstract class ChatHudMixin {
    @ModifyVariable(method = "addMessage(Lnet/minecraft/text/Text;Lnet/minecraft/network/message/MessageSignatureData;Lnet/minecraft/client/gui/hud/MessageIndicator;)V",
            at = @At("HEAD"), argsOnly = true)
    private Text noreclient$timestamp(Text message) {
        NoreClient c = NoreClient.get();
        if (c == null) return message;
        ChatTimestamps m = c.modules().get(ChatTimestamps.class);
        return m.isEnabled() ? m.decorate(message) : message;
    }
}
