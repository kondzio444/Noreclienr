package dev.noreclient.mixin;

import dev.noreclient.NoreClient;
import dev.noreclient.module.utility.ChatTimestamps;
import dev.noreclient.module.utility.ChatTweaks;
import net.minecraft.client.gui.hud.ChatHud;
import net.minecraft.client.gui.hud.MessageIndicator;
import net.minecraft.network.message.MessageSignatureData;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Constant;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyConstant;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

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

    @ModifyConstant(method = {"addVisibleMessage", "addMessage(Lnet/minecraft/client/gui/hud/ChatHudLine;)V"}, constant = @Constant(intValue = 100))
    private int noreclient$history(int original) {
        NoreClient c = NoreClient.get();
        if (c == null) return original;
        ChatTweaks t = c.modules().get(ChatTweaks.class);
        return t.isEnabled() ? t.history.intValue() : original;
    }

    @Inject(method = "clear", at = @At("HEAD"), cancellable = true)
    private void noreclient$keep(boolean clearHistory, CallbackInfo ci) {
        NoreClient c = NoreClient.get();
        if (c == null) return;
        ChatTweaks t = c.modules().get(ChatTweaks.class);
        if (t.isEnabled() && t.keepHistory.isOn() && clearHistory) ci.cancel();
    }
}
