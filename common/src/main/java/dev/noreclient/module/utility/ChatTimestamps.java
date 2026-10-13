package dev.noreclient.module.utility;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class ChatTimestamps extends Module {
    public final BooleanSetting seconds = add(new BooleanSetting("Seconds", "Pokazuj sekundy", false));

    public ChatTimestamps() {
        super("Chat Timestamps", "Godzina przy każdej wiadomości na czacie", Category.UTILITY);
    }

    /** Prefix (with formatting code) the platform prepends to chat messages. */
    public String prefix() {
        return "§8[" + new SimpleDateFormat(seconds.isOn() ? "HH:mm:ss" : "HH:mm", Locale.ROOT).format(new Date()) + "] §r";
    }

    @Override
    protected boolean needsHook() { return true; }
}
