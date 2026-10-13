package dev.noreclient.module.utility;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;

public class ChatTweaks extends Module {
    public final NumberSetting history = add(new NumberSetting("History Length", "Ile wiadomości przechowywać", 1000, 100, 5000, 100));
    public final BooleanSetting keepHistory = add(new BooleanSetting("Keep On Disconnect", "Nie czyść czatu przy zmianie serwera", true));

    public ChatTweaks() {
        super("Chat Tweaks", "Dłuższa historia czatu i zachowanie jej między serwerami", Category.UTILITY);
        setEnabled(true);
    }
}
