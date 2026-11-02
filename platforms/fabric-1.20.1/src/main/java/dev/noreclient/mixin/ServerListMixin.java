package dev.noreclient.mixin;

import dev.noreclient.util.OfficialServer;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.option.ServerList;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Keeps the official Nore MC server in servers.dat: every time the list is read (Nore and vanilla
 * multiplayer screens, quick join), a missing entry is put back at the top. An entry the player
 * added by hand (any spelling of the address, with or without :25565) counts, so it is never doubled.
 */
@Mixin(ServerList.class)
public abstract class ServerListMixin {
    @Inject(method = "loadFile", at = @At("TAIL"))
    private void noreclient$official(CallbackInfo ci) {
        ServerList self = (ServerList) (Object) this;
        for (int i = 0; i < self.size(); i++) if (OfficialServer.matches(self.get(i).address)) return;
        // joined before through Direct Connection: reuse that hidden entry (keeps its resource pack choice)
        ServerInfo entry = null;
        for (String alias : OfficialServer.HIDDEN_ALIASES) if (entry == null) entry = self.tryUnhide(alias);
        if (entry != null) entry.name = OfficialServer.NAME;
        else self.add(entry = new ServerInfo(OfficialServer.NAME, OfficialServer.ADDRESS, false), false);
        // pinned at the top
        for (int i = self.size() - 1; i > 0; i--) self.set(i, self.get(i - 1));
        self.set(0, entry);
        self.saveFile();
    }
}
