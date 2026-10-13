package dev.noreclient.module.hud;

public class FpsHud extends TextHudModule {
    public FpsHud() {
        super("FPS", "Wyświetla liczbę klatek na sekundę", 0.0f, 0.105f);
        setEnabled(true);
    }

    @Override protected String label() { return "FPS"; }
    @Override protected String value() { return String.valueOf(mc.getCurrentFps()); }
}
