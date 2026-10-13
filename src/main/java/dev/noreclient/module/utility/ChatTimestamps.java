package dev.noreclient.module.utility;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import net.minecraft.text.MutableText;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

public class ChatTimestamps extends Module {
    public final BooleanSetting seconds = add(new BooleanSetting("Seconds", "Pokazuj sekundy", false));

    public ChatTimestamps() {
        super("Chat Timestamps", "Godzina przy każdej wiadomości na czacie", Category.UTILITY);
    }

    public Text decorate(Text message) {
        String t = LocalTime.now().format(DateTimeFormatter.ofPattern(seconds.isOn() ? "HH:mm:ss" : "HH:mm"));
        MutableText prefix = Text.literal("[" + t + "] ").formatted(Formatting.DARK_GRAY);
        return prefix.append(message);
    }
}
