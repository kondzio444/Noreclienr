package dev.noreclient.module.social;

import dev.noreclient.api.TargetInfo;
import dev.noreclient.gui.menu.PlayerMenuScreen;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.Friends;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Friends and Nore players: star and Nore mark in the tab list and above heads, notice when a
 * friend is on the same server, middle click on a player opens the player menu.
 */
public class FriendsModule extends Module {
    public final BooleanSetting highlight = add(new BooleanSetting("Highlight", "Gwiazdka przy znajomych w tabie i nad głową", true));
    public final BooleanSetting noreTab = add(new BooleanSetting("Nore Mark", "Znak Nore przy graczach Nore w tabie", true));
    public final BooleanSetting noreNametag = add(new BooleanSetting("Nore Nametag", "Znak Nore nad głową graczy Nore", true));
    public final BooleanSetting notify = add(new BooleanSetting("Join Notice", "Powiadomienie, gdy znajomy jest na serwerze", true));
    public final BooleanSetting middleClick = add(new BooleanSetting("Middle Click", "Środkowy przycisk na graczu otwiera menu gracza", true));
    public final BooleanSetting quickToggle = add(new BooleanSetting("Quick Toggle", "Środkowy przycisk od razu dodaje / usuwa znajomego (bez menu)", false));

    private final Set<String> seen = new HashSet<String>();
    private int timer;

    public FriendsModule() {
        super("Friends", "Znajomi i gracze Nore: wyróżnienie, powiadomienia, menu gracza pod środkowym przyciskiem", Category.CLIENT);
        setEnabled(true);
    }

    @Override
    public void onTick() {
        dev.noreclient.NoreClient nc = dev.noreclient.NoreClient.get();
        if (nc != null) nc.modules().get(FriendsChat.class).poll();
        if (timer-- > 0) return;
        timer = 40;
        if (!inGame() || game().singleplayer()) { seen.clear(); return; }
        List<String> tab = Social.tabNames();
        Set<String> now = new HashSet<String>();
        for (String n : tab) {
            if (!Friends.isFriend(n) || n.equalsIgnoreCase(game().username())) continue;
            now.add(n);
            if (notify.isOn() && !seen.contains(n)) NotificationManager.push("Znajomy online", n + " jest na tym serwerze", NotificationManager.Type.SUCCESS);
        }
        seen.clear();
        seen.addAll(now);
    }

    /** Middle mouse button in game (next tick, no screen open). */
    public void onMiddleClick() {
        if (!middleClick.isOn() || game().screenOpen()) return;
        TargetInfo t = game().lookEntity();
        if (t == null || !t.player || t.name == null) return;
        if (quickToggle.isOn()) {
            Social.toggleFriend(t.name);
            return;
        }
        game().openScreen(new PlayerMenuScreen(t));
    }

    @Override
    public boolean persistsEnabled() { return true; }
}
