package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.utility.ChatTimestamps;
import dev.noreclient.module.utility.ChatTweaks;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Constant;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyConstant;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ChatComponent.class)
public abstract class ChatHudMixin {
    @ModifyVariable(method = "addMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/multiplayer/chat/GuiMessageSource;Lnet/minecraft/client/multiplayer/chat/GuiMessageTag;)V",
            at = @At("HEAD"), argsOnly = true)
    private Component noreclient$timestamp(Component message) {
        NoreClient c = NoreClient.get();
        if (c == null) return message;
        NoreClient.onChatMessage(message.getString());
        ChatTimestamps m = c.modules().get(ChatTimestamps.class);
        return m.isActive() ? Component.literal(m.prefix()).append(message) : message;
    }

    @ModifyConstant(method = {"addMessageToDisplayQueue", "addMessageToQueue"}, constant = @Constant(intValue = 100))
    private int noreclient$history(int original) {
        NoreClient c = NoreClient.get();
        if (c == null) return original;
        ChatTweaks t = c.modules().get(ChatTweaks.class);
        return t.isActive() ? t.history.intValue() : original;
    }

    @Inject(method = "clearMessages", at = @At("HEAD"), cancellable = true)
    private void noreclient$keep(boolean clearHistory, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        ChatTweaks t = c.modules().get(ChatTweaks.class);
        if (t.isActive() && t.keepHistory.isOn() && clearHistory) ci.cancel();
    }
}
