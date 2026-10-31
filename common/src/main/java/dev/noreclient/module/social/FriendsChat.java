package dev.noreclient.module.social;

import dev.noreclient.api.Keys;
import dev.noreclient.gui.menu.FriendsScreen;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.LauncherChat;

/**
 * Friends and the Nore chat inside the game: the merged friends window on Y (people, write /
 * read) and notifications about new messages, invitations and friends coming online. The chat
 * needs the game started by Nore Launcher; nick friends work everywhere.
 */
public class FriendsChat extends Module {
    public final BooleanSetting notifyMessages = add(new BooleanSetting("Messages", "Powiadomienie o nowej wiadomości", true));
    public final BooleanSetting notifyOnline = add(new BooleanSetting("Online", "Powiadomienie, gdy znajomy wejdzie do launchera / gry", true));

    public FriendsChat() {
        super("Friends Chat", "Znajomi i czat Nore w grze (klawisz Y)", Category.CLIENT, Keys.Y);
    }

    /** Called every tick by FriendsModule (always active), so notifications work without this window. */
    public void poll() {
        LauncherChat.start();
        LauncherChat.drain(e -> {
            if ("message".equals(e.type) && notifyMessages.isOn() && !FriendsScreen.isOpen()) {
                String text = e.text.length() > 60 ? e.text.substring(0, 57) + "..." : e.text;
                NotificationManager.push(e.name, text + "  [Y – odpisz]", NotificationManager.Type.INFO);
            } else if ("online".equals(e.type) && notifyOnline.isOn()) {
                NotificationManager.push("Znajomy online", e.name + (e.text.isEmpty() ? " jest w launcherze" : " gra: " + e.text), NotificationManager.Type.SUCCESS);
            } else if ("request".equals(e.type) && notifyMessages.isOn()) {
                NotificationManager.push("Zaproszenie do czatu", e.name + " chce pisać z Tobą  [Y]", NotificationManager.Type.INFO);
            }
        });
    }

    @Override
    protected void onEnable() {
        setEnabled(false);
        if (!game().screenOpen()) game().openScreen(new FriendsScreen(null, FriendsScreen.LAST));
    }

    @Override
    protected boolean showsToggleNotification() { return false; }

    @Override
    public boolean persistsEnabled() { return false; }

    @Override
    public boolean isToggleable() { return false; }
}
