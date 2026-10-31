package dev.noreclient.module.utility;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.StringSetting;

import java.util.Locale;
import java.util.regex.Pattern;

/** Sound, notification and a flashing taskbar when someone writes your nick (or a keyword) in chat. */
public class ChatMentions extends Module {
    public final BooleanSetting ownName = add(new BooleanSetting("Own Name", "Reaguj na Twój nick", true));
    public final StringSetting keywords = add(new StringSetting("Keywords", "Dodatkowe słowa, oddzielone przecinkami", "", 160));
    public final BooleanSetting sound = add(new BooleanSetting("Sound", "Dźwięk przy wzmiance", true));
    public final BooleanSetting notify = add(new BooleanSetting("Notification", "Powiadomienie z treścią wiadomości", true));
    public final BooleanSetting flash = add(new BooleanSetting("Flash Window", "Miganie paska zadań, gdy gra jest w tle", true));

    private static final Pattern FORMAT = Pattern.compile("§.");
    private long lastAlert;
    private String cachedKeywords;
    private String[] keywordList = new String[0];

    public ChatMentions() {
        super("Chat Mentions", "Dźwięk i powiadomienie, gdy ktoś napisze Twój nick na czacie", Category.UTILITY);
    }

    private static String plain(String text) {
        return FORMAT.matcher(text == null ? "" : text).replaceAll("").toLowerCase(Locale.ROOT);
    }

    /** True for lines you sent yourself ("<nick> ...", "nick: ...", "nick » ..."). */
    private static boolean ownMessage(String plain, String me) {
        return plain.startsWith("<" + me + ">") || plain.startsWith(me + ":") || plain.startsWith(me + " »") || plain.startsWith(me + " >")
                || plain.contains("<" + me + "> ") && plain.indexOf("<" + me + "> ") < 24;
    }

    private static boolean containsWord(String text, String word) {
        if (word.isEmpty()) return false;
        int i = text.indexOf(word);
        while (i >= 0) {
            boolean before = i == 0 || !Character.isLetterOrDigit(text.charAt(i - 1)) && text.charAt(i - 1) != '_';
            int end = i + word.length();
            boolean after = end >= text.length() || !Character.isLetterOrDigit(text.charAt(end)) && text.charAt(end) != '_';
            if (before && after) return true;
            i = text.indexOf(word, i + 1);
        }
        return false;
    }

    /**
     * Your own nick in someone else's chat line. The nick has to come after the sender part
     * ("<Gracz> ", "Gracz: ", "Gracz » "), so command feedback and death messages that merely
     * contain your name ("Teleported Tester to ...") do not count.
     */
    public boolean isMentionOfMe(String text) {
        String me = game().username();
        if (me == null || me.isEmpty()) return false;
        me = me.toLowerCase(Locale.ROOT);
        String p = plain(text);
        if (ownMessage(p, me)) return false;
        int sep = -1;
        for (String s : new String[]{"> ", ": ", "» "}) {
            int i = p.indexOf(s);
            if (i > 0 && i < 48 && (sep < 0 || i < sep)) sep = i;
        }
        if (sep < 0 || containsWord(p.substring(0, sep), me)) return false;
        return containsWord(p.substring(sep), me);
    }

    public boolean isMention(String text) {
        if (!isActive() || !inGame()) return false;
        if (ownName.isOn() && isMentionOfMe(text)) return true;
        String k = keywords.get();
        if (!k.equals(cachedKeywords)) {
            cachedKeywords = k;
            keywordList = k.trim().isEmpty() ? new String[0] : k.toLowerCase(Locale.ROOT).split("\\s*,\\s*");
        }
        if (keywordList.length == 0) return false;
        String me = game().username() == null ? "" : game().username().toLowerCase(Locale.ROOT);
        String p = plain(text);
        if (!me.isEmpty() && ownMessage(p, me)) return false;
        for (String w : keywordList) if (containsWord(p, w.trim())) return true;
        return false;
    }

    public void onMention(String text) {
        long now = System.currentTimeMillis();
        if (now - lastAlert < 1500) return;
        lastAlert = now;
        if (sound.isOn()) game().playPing(1.5f);
        if (notify.isOn()) {
            String msg = FORMAT.matcher(text).replaceAll("");
            NotificationManager.push("Wzmianka na czacie", msg.length() > 70 ? msg.substring(0, 69) + "…" : msg, NotificationManager.Type.INFO);
        }
        if (flash.isOn() && !game().windowFocused()) game().requestAttention();
    }
}
