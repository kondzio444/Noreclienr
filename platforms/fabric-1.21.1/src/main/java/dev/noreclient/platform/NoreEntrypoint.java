package dev.noreclient.platform;

import dev.noreclient.NoreClient;
import net.fabricmc.api.ClientModInitializer;

public class NoreEntrypoint implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        if (!NoreMixinPlugin.allowed()) return; // not started by Nore Launcher
        NoreClient.start(new GameImpl(), "fabric-1.21.1", "*");
    }
}
