package dev.noreclient.module.utility;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.setting.StringSetting;

import java.util.Locale;

/** Writes "gg" after a game ends (Hypixel, Minemen, Polish minigame servers...). */
public class AutoGG extends Module {
    public final StringSetting message = add(new StringSetting("Message", "Wiadomość po zakończeniu gry", "gg", 64));
    public final NumberSetting delay = add(new NumberSetting("Delay", "Opóźnienie wysłania", 1.0, 0.0, 5.0, 0.5, " s"));

    private static final String[] TRIGGERS = {
            "1st killer", "winner:", "winners:", "won the game", "victory!", "#1 ", "you won", "game over", "zwycięzca", "wygrał grę",
            "wygrali grę", "koniec gry", "you died! want to play again", "reward summary", "the game has ended"};
    private long lastSent, pendingAt = -1;

    public AutoGG() {
        super("Auto GG", "Automatyczne \"gg\" po zakończeniu gry", Category.UTILITY);
    }

    public void onChat(String text) {
        String t = text.toLowerCase(Locale.ROOT);
        for (String trig : TRIGGERS) {
            if (t.contains(trig) && System.currentTimeMillis() - lastSent > 10_000 && pendingAt < 0) {
                pendingAt = System.currentTimeMillis() + (long) (delay.get() * 1000);
                return;
            }
        }
    }

    @Override
    public void onTick() {
        if (pendingAt < 0 || System.currentTimeMillis() < pendingAt) return;
        pendingAt = -1;
        lastSent = System.currentTimeMillis();
        if (inGame() && !game().singleplayer() && !message.get().trim().isEmpty()) game().sendChat(message.get().trim());
    }
}
