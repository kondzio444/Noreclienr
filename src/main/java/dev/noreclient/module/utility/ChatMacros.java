package dev.noreclient.module.utility;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.KeybindSetting;
import dev.noreclient.setting.StringSetting;
import org.lwjgl.glfw.GLFW;

/** Up to five key-bound chat messages or commands. */
public class ChatMacros extends Module {
    private final StringSetting[] texts = new StringSetting[5];
    private final KeybindSetting[] keys = new KeybindSetting[5];

    public ChatMacros() {
        super("Chat Macros", "Wiadomości i komendy pod klawiszem", Category.UTILITY);
        String[] defaults = {"gg", "/spawn", "", "", ""};
        for (int i = 0; i < 5; i++) {
            texts[i] = add(new StringSetting("Macro " + (i + 1), "Treść wiadomości lub komenda (/...)", defaults[i], 200));
            keys[i] = add(new KeybindSetting("Macro " + (i + 1) + " Key", "Klawisz makra " + (i + 1), GLFW.GLFW_KEY_UNKNOWN));
        }
    }

    /** Called for every key press in game while the module is enabled. */
    public boolean onKey(int key) {
        if (!isEnabled() || mc.player == null) return false;
        for (int i = 0; i < 5; i++) {
            if (keys[i].isBound() && keys[i].get() == key && !texts[i].get().isBlank()) {
                String msg = texts[i].get().trim();
                if (msg.startsWith("/")) mc.player.networkHandler.sendChatCommand(msg.substring(1));
                else mc.player.networkHandler.sendChatMessage(msg);
                NotificationManager.push("Makro " + (i + 1), msg, NotificationManager.Type.INFO);
                return true;
            }
        }
        return false;
    }
}
