package dev.noreclient.module.hud;

public class ServerAddressHud extends TextHudModule {
    public ServerAddressHud() {
        super("Server Address", "Adres serwera, na którym grasz", 1.0f, 0.14f);
    }

    @Override protected String label() { return "IP"; }

    @Override
    protected String value() {
        if (mc.isInSingleplayer()) return "Singleplayer";
        return mc.getCurrentServerEntry() != null ? mc.getCurrentServerEntry().address : "-";
    }

    @Override protected String previewValue() { return "play.server.pl"; }
}
