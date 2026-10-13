package dev.noreclient.module.social;

import dev.noreclient.api.TargetInfo;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.util.Friends;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Friends: star in the tab list and above heads, notice when a friend is on the same server, middle click to add. */
public class FriendsModule extends Module {
    public final BooleanSetting highlight = add(new BooleanSetting("Highlight", "Gwiazdka przy znajomych w tabie i nad głową", true));
    public final BooleanSetting notify = add(new BooleanSetting("Join Notice", "Powiadomienie, gdy znajomy jest na serwerze", true));
    public final BooleanSetting middleClick = add(new BooleanSetting("Middle Click", "Środkowy przycisk na graczu dodaje / usuwa znajomego", true));

    private final Set<String> seen = new HashSet<String>();
    private int timer;

    public FriendsModule() {
        super("Friends", "Znajomi: wyróżnienie, powiadomienia, dodawanie środkowym przyciskiem", Category.CLIENT);
        setEnabled(true);
    }

    @Override
    public void onTick() {
        if (timer-- > 0) return;
        timer = 40;
        Friends.refresh();
        if (!inGame() || game().singleplayer()) { seen.clear(); return; }
        List<String> tab = game().tabPlayerNames();
        Set<String> now = new HashSet<String>();
        for (String n : tab) {
            if (!Friends.isFriend(n) || n.equalsIgnoreCase(game().username())) continue;
            now.add(n);
            if (notify.isOn() && !seen.contains(n)) NotificationManager.push("Znajomy online", n + " jest na tym serwerze", NotificationManager.Type.SUCCESS);
        }
        seen.clear();
        seen.addAll(now);
    }

    /** Middle mouse button in game. */
    public void onMiddleClick() {
        if (!middleClick.isOn()) return;
        TargetInfo t = game().lookEntity();
        if (t == null || !t.player || t.name == null) return;
        if (Friends.isFriend(t.name)) {
            Friends.remove(t.name);
            NotificationManager.push("Znajomi", "Usunięto " + t.name, NotificationManager.Type.INFO);
        } else if (Friends.add(t.name)) {
            NotificationManager.push("Znajomi", "Dodano " + t.name, NotificationManager.Type.SUCCESS);
        }
    }

    @Override
    public boolean persistsEnabled() { return true; }
}
