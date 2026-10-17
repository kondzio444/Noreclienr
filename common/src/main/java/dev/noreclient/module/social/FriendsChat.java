package dev.noreclient.module.social;

import dev.noreclient.api.Keys;
import dev.noreclient.gui.menu.FriendsChatScreen;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.LauncherChat;

/**
 * Friends chat from Nore Launcher inside the game: a window on Y (write / read) and notifications
 * about new messages and friends coming online. Needs the game started by Nore Launcher.
 */
public class FriendsChat extends Module {
    public final BooleanSetting notifyMessages = add(new BooleanSetting("Messages", "Powiadomienie o nowej wiadomości", true));
    public final BooleanSetting notifyOnline = add(new BooleanSetting("Online", "Powiadomienie, gdy znajomy wejdzie do launchera / gry", true));

    public FriendsChat() {
        super("Friends Chat", "Czat i znajomi z Nore Launchera w grze (klawisz Y)", Category.CLIENT, Keys.Y);
    }

    /** Called every tick by FriendsModule (always active), so notifications work without this window. */
    public void poll() {
        LauncherChat.start();
        LauncherChat.drain(e -> {
            if ("message".equals(e.type) && notifyMessages.isOn() && !FriendsChatScreen.isOpen()) {
                String text = e.text.length() > 60 ? e.text.substring(0, 57) + "..." : e.text;
                NotificationManager.push(e.name, text + "  [Y – odpisz]", NotificationManager.Type.INFO);
            } else if ("online".equals(e.type) && notifyOnline.isOn()) {
                NotificationManager.push("Znajomy online", e.name + (e.text.isEmpty() ? " jest w launcherze" : " gra: " + e.text), NotificationManager.Type.SUCCESS);
            }
        });
    }

    @Override
    protected void onEnable() {
        setEnabled(false);
        if (!game().screenOpen()) game().openScreen(new FriendsChatScreen(null));
    }

    @Override
    protected boolean showsToggleNotification() { return false; }

    @Override
    public boolean persistsEnabled() { return false; }

    @Override
    public boolean isToggleable() { return false; }
}
