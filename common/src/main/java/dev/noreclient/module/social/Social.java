package dev.noreclient.module.social;

import dev.noreclient.NoreClient;
import dev.noreclient.api.Game;
import dev.noreclient.api.Platform;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.util.Friends;
import dev.noreclient.util.LauncherChat;
import dev.noreclient.util.NoreHub;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * One social system for the mod: nick friends (friends.json, shared with the launcher) and Nore
 * chat contacts (launcher bridge) merged into people, the tab list snapshot that feeds Nore Hub,
 * and the actions used by the player menu and the friends screen.
 */
public final class Social {
    /** A person in the friends list: a nick friend and/or a Nore chat contact. */
    public static final class Person {
        /** Minecraft nick (or the chat name when they are only a chat contact). */
        public final String name;
        public final boolean friend;
        public final LauncherChat.Contact contact;
        public final NoreHub.Entry hub;
        public final boolean onServer;

        Person(String name, boolean friend, LauncherChat.Contact contact, NoreHub.Entry hub, boolean onServer) {
            this.name = name; this.friend = friend; this.contact = contact; this.hub = hub; this.onServer = onServer;
        }

        /** Stable key for selection: the chat id when there is one, otherwise the nick. */
        public String key() { return contact != null ? "c:" + contact.hex : "n:" + name.toLowerCase(Locale.ROOT); }

        public boolean nore() { return hub != null || contact != null; }

        public boolean onlineInNore() { return contact != null ? contact.online : hub != null && hub.online; }

        /** 2 = on this server, 1 = online in Nore, 0 = offline / unknown. */
        public int state() { return onServer ? 2 : onlineInNore() ? 1 : 0; }

        public int unread() { return contact == null ? 0 : contact.unread; }
    }

    private static volatile List<String> tab = Collections.emptyList();
    private static volatile Set<String> tabLower = Collections.emptySet();
    private static int timer;
    /** Nicks added by hand: once Nore Hub knows them they get a chat invitation too. */
    private static final Map<String, Long> INVITE = new HashMap<String, Long>();

    private Social() {}

    private static Game game() { return Platform.game(); }

    /** Every client tick (NoreClient.onTick): refreshes the tab snapshot and feeds Nore Hub. */
    public static void tick() {
        if (timer-- > 0) return;
        timer = 40;
        Game g = game();
        Friends.refresh();
        if (!g.inWorld()) {
            tab = Collections.emptyList();
            tabLower = Collections.emptySet();
            NoreHub.scope(NoreHub.SCOPE_NONE, g.username());
        } else if (g.singleplayer()) {
            tab = Collections.emptyList();
            tabLower = Collections.emptySet();
            NoreHub.scope(NoreHub.SCOPE_LOCAL, g.username());
            NoreHub.observe(Collections.singletonList(g.username()));
        } else {
            List<String> names = new ArrayList<String>(g.tabPlayerNames());
            Set<String> lower = new HashSet<String>();
            for (String n : names) lower.add(n.toLowerCase(Locale.ROOT));
            tab = Collections.unmodifiableList(names);
            tabLower = lower;
            NoreHub.scope(NoreHub.SCOPE_ALL, g.username());
            List<String> watch = new ArrayList<String>(names);
            watch.addAll(Friends.list()); // "online in Nore" for friends elsewhere
            NoreHub.observe(watch);
        }
        invites();
    }

    /** Names in the tab list (snapshot, refreshed every 2 s; empty outside multiplayer). */
    public static List<String> tabNames() { return tab; }

    public static boolean onServer(String name) {
        return name != null && tabLower.contains(name.toLowerCase(Locale.ROOT));
    }

    public static boolean isMe(String name) {
        return name != null && name.equalsIgnoreCase(game().username());
    }

    // ------------------------------------------------------------------ people

    /** Chat contact for a nick: by the hub's Nore ID first, then by name. */
    public static LauncherChat.Contact contactFor(String name) {
        NoreHub.Entry e = NoreHub.get(name);
        LauncherChat.Contact c = e == null ? null : LauncherChat.contact(e.hex);
        return c != null ? c : LauncherChat.contactByName(name);
    }

    public static Person person(String name) {
        LauncherChat.Contact c = contactFor(name);
        return new Person(name, Friends.isFriend(name), c, NoreHub.get(name), onServer(name));
    }

    /** Everyone in the merged list: on this server first, then online in Nore, then the rest. */
    public static List<Person> people() {
        Map<String, Person> out = new LinkedHashMap<String, Person>();
        Set<String> contactsUsed = new HashSet<String>();
        for (String n : Friends.list()) {
            LauncherChat.Contact c = contactFor(n);
            if (c != null) contactsUsed.add(c.hex);
            out.put(n.toLowerCase(Locale.ROOT), new Person(n, true, c, NoreHub.get(n), onServer(n)));
        }
        for (LauncherChat.Contact c : LauncherChat.contacts()) {
            if (contactsUsed.contains(c.hex)) continue;
            String n = c.name.isEmpty() ? "Znajomy" : c.name;
            String k = n.toLowerCase(Locale.ROOT);
            if (out.containsKey(k)) k = "#" + c.hex; // two contacts with one name
            out.put(k, new Person(n, false, c, NoreHub.get(n), onServer(n)));
        }
        List<Person> list = new ArrayList<Person>(out.values());
        Collections.sort(list, (a, b) -> a.state() != b.state() ? b.state() - a.state() : a.name.compareToIgnoreCase(b.name));
        return list;
    }

    // ------------------------------------------------------------------ actions

    private static void toast(final String title, final String text, final NotificationManager.Type type) {
        NoreClient.runNextTick(() -> NotificationManager.push(title, text, type));
    }

    /** "Napisz": Nore users get the Nore chat (added as a contact first), others a /msg in game chat. */
    public static void message(final String name, Object parent) {
        LauncherChat.Contact c = contactFor(name);
        final NoreHub.Entry e = NoreHub.get(name);
        if (c != null) {
            game().openScreen(new dev.noreclient.gui.menu.FriendsScreen(parent, c.hex));
        } else if (e != null && !e.hex.isEmpty() && LauncherChat.available()) {
            game().openScreen(new dev.noreclient.gui.menu.FriendsScreen(parent, e.hex));
            LauncherChat.addContact(e.hex, e.name, err -> {
                if (err != null) toast("Czat Nore", err, NotificationManager.Type.WARNING);
                else toast("Czat Nore", "Zaproszenie wysłane do " + e.name, NotificationManager.Type.SUCCESS);
            });
        } else {
            game().openChat("/msg " + name + " ");
        }
    }

    /** Adds a nick friend; Nore users also get a chat invitation. */
    public static boolean addFriend(String name) {
        if (!Friends.add(name)) return false;
        inviteToChat(name);
        return true;
    }

    /** Chat invitation for a nick: now when Nore Hub knows them, otherwise once it does. */
    public static void inviteToChat(final String name) {
        if (!LauncherChat.available() || contactFor(name) != null || isMe(name)) return;
        final NoreHub.Entry e = NoreHub.get(name);
        if (e != null && !e.hex.isEmpty()) {
            LauncherChat.addContact(e.hex, e.name, err -> {
                if (err != null) toast("Czat Nore", err, NotificationManager.Type.WARNING);
                else toast("Czat Nore", "Zaproszenie do czatu wysłane do " + e.name, NotificationManager.Type.SUCCESS);
            });
            return;
        }
        synchronized (INVITE) { INVITE.put(name.toLowerCase(Locale.ROOT), System.currentTimeMillis()); }
        NoreHub.request(name);
    }

    private static void invites() {
        List<String> ready = new ArrayList<String>();
        synchronized (INVITE) {
            long now = System.currentTimeMillis();
            for (java.util.Iterator<Map.Entry<String, Long>> it = INVITE.entrySet().iterator(); it.hasNext(); ) {
                Map.Entry<String, Long> en = it.next();
                if (now - en.getValue() > 120_000L) { it.remove(); continue; }
                if (NoreHub.get(en.getKey()) != null) { ready.add(en.getKey()); it.remove(); }
                else if (NoreHub.known(en.getKey())) it.remove(); // not a Nore user: the nick friend is enough
            }
        }
        for (String n : ready) inviteToChat(n);
    }

    public static void removeFriend(String name) {
        Friends.remove(name);
    }

    /** Toggles the friend state; returns true when they are a friend afterwards. */
    public static boolean toggleFriend(String name) {
        if (Friends.isFriend(name)) {
            Friends.remove(name);
            NotificationManager.push("Znajomi", "Usunięto " + name + " ze znajomych", NotificationManager.Type.INFO);
            return false;
        }
        if (addFriend(name)) NotificationManager.push("Znajomi", "Dodano " + name + " do znajomych", NotificationManager.Type.SUCCESS);
        return Friends.isFriend(name);
    }

    public static boolean toggleMute(String name) {
        boolean m = !Friends.isMuted(name);
        Friends.setMuted(name, m);
        NotificationManager.push("Czat", m ? "Wyciszono " + name + " – nie zobaczysz jego wiadomości" : "Odciszono " + name, NotificationManager.Type.INFO);
        return m;
    }

    public static void copyName(String name) {
        game().setClipboard(name);
        NotificationManager.push("Skopiowano", name, NotificationManager.Type.INFO);
    }

    /** Status line for a person, Polish. */
    public static String status(Person p) {
        if (p.onServer) return "Na tym serwerze";
        if (p.contact != null && p.contact.online) {
            if ("game".equals(p.contact.status)) return p.contact.detail.isEmpty() ? "Gra z Nore" : "Gra: " + p.contact.detail;
            return "Online w Nore Launcherze";
        }
        if (p.hub != null && p.hub.online) return "Online w Nore";
        return "Offline";
    }

    // ------------------------------------------------------------------ wardrobe names for the profile card

    /** Human name of a wardrobe slot. */
    public static String slotName(String slot) {
        if ("wings".equals(slot)) return "Skrzydła";
        if ("hat".equals(slot) || "head".equals(slot)) return "Nakrycie głowy";
        if ("cape".equals(slot)) return "Peleryna";
        if ("ears".equals(slot)) return "Uszy";
        if ("tail".equals(slot)) return "Ogon";
        if ("aura".equals(slot)) return "Aura";
        if ("pet".equals(slot)) return "Zwierzak";
        return pretty(slot);
    }

    /** "bat_wings" → "Bat wings". */
    public static String pretty(String id) {
        if (id == null || id.isEmpty()) return "";
        String s = id.replace('_', ' ');
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
