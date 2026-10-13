package dev.noreclient.module.hud;

import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

public class ClockHud extends TextHudModule {
    public final ModeSetting format = add(new ModeSetting("Format", "Format godziny", "24h", "24h", "12h"));
    public final BooleanSetting seconds = add(new BooleanSetting("Seconds", "Pokazuj sekundy", false));

    public ClockHud() {
        super("Clock", "Aktualna godzina", 1.0f, 0.0f);
    }

    @Override protected String label() { return "Time"; }

    @Override
    protected String value() {
        String pattern = format.is("24h") ? (seconds.isOn() ? "HH:mm:ss" : "HH:mm") : (seconds.isOn() ? "hh:mm:ss a" : "hh:mm a");
        return LocalTime.now().format(DateTimeFormatter.ofPattern(pattern));
    }
}
