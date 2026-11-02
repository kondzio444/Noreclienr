package dev.noreclient.mixin;

import dev.noreclient.platform.GfxImpl;
import dev.noreclient.util.Render2D;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.multiplayer.MultiplayerServerListWidget;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Country flag (from the server's IP) in the bottom-right corner of every saved server. */
@Mixin(MultiplayerServerListWidget.ServerEntry.class)
public abstract class ServerEntryMixin {
    @Shadow @Final private net.minecraft.client.network.ServerInfo server;

    @Inject(method = "render", at = @At("TAIL"))
    private void noreclient$flag(DrawContext context, int index, int y, int x, int entryWidth, int entryHeight, int mouseX, int mouseY,
                                 boolean hovered, float tickDelta, CallbackInfo ci) {
        dev.noreclient.util.ServerInfo.Info info = dev.noreclient.util.ServerInfo.get(server.address);
        if (info == null || info.countryCode == null) return;
        GfxImpl g = new GfxImpl(context);
        float fx = x + entryWidth - 19, fy = y + entryHeight - 12;
        dev.noreclient.util.ServerInfo.drawFlag(g, info, fx, fy, 8);
        if (hovered && info.country != null) {
            String where = info.country + (info.city != null && !info.city.isEmpty() ? ", " + info.city : "");
            Render2D.scaledText(g, where, fx - 3 - Render2D.textWidth(where) * 0.6f, fy + 2, 0.6f, 0xFFB8AFA6, true);
        }
        g.finish();
    }
}
