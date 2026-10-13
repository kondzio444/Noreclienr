package dev.noreclient.module.hud;

import dev.noreclient.setting.ModeSetting;

public class MemoryHud extends TextHudModule {
    public final ModeSetting mode = add(new ModeSetting("Mode", "Format wyświetlania", "Percent", "Percent", "MB"));

    public MemoryHud() {
        super("Memory", "Użycie pamięci RAM przez grę", 1.0f, 0.07f);
    }

    @Override protected String label() { return "RAM"; }

    @Override
    protected String value() {
        Runtime rt = Runtime.getRuntime();
        long used = (rt.totalMemory() - rt.freeMemory()) / 1048576L;
        long max = rt.maxMemory() / 1048576L;
        return mode.is("Percent") ? (used * 100 / Math.max(1, max)) + "%" : used + "/" + max + "MB";
    }
}
