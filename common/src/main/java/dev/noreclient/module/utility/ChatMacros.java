package dev.noreclient.module.utility;

import dev.noreclient.api.Keys;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.StringSetting;

/** Up to five key-bound chat messages or commands. */
public class ChatMacros extends Module {
    private final StringSetting[] texts = new StringSetting[5];
    private final KeybindSetting[] keys = new KeybindSetting[5];

    public ChatMacros() {
        super("Chat Macros", "Wiadomości i komendy pod klawiszem", Category.UTILITY);
        String[] defaults = {"gg", "/spawn", "", "", ""};
        for (int i = 0; i < 5; i++) {
            texts[i] = add(new StringSetting("Macro " + (i + 1), "Treść wiadomości lub komenda (/...)", defaults[i], 200));
            keys[i] = add(new KeybindSetting("Macro " + (i + 1) + " Key", "Klawisz makra " + (i + 1), Keys.UNKNOWN));
        }
    }

    public boolean onKey(int key) {
        if (!isEnabled() || !inGame()) return false;
        for (int i = 0; i < 5; i++) {
            if (keys[i].isBound() && keys[i].get() == key && !texts[i].get().trim().isEmpty()) {
                String msg = texts[i].get().trim();
                game().sendChat(msg);
                NotificationManager.push("Makro " + (i + 1), msg, NotificationManager.Type.INFO);
                return true;
            }
        }
        return false;
    }
}
