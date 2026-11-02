package dev.noreclient.module.utility;

import dev.noreclient.api.EffectInfo;
import dev.noreclient.api.Gfx;
import dev.noreclient.api.ItemInfo;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.notification.NotificationManager;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ColorSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ColorUtil;
import dev.noreclient.util.Render2D;
import dev.noreclient.util.Sounds;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Warnings and small helpers added in 2.1. */
public final class Alerts {
    private Alerts() {}

    private static String pretty(String id) {
        String s = id.substring(id.indexOf(':') + 1).replace('_', ' ');
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    /** Warns when the held item or armour is about to break. */
    public static final class DurabilityAlert extends Module {
        public final NumberSetting threshold = add(new NumberSetting("Threshold", "Ostrzegaj poniżej tej wytrzymałości", 10, 1, 50, 1, "%"));
        public final BooleanSetting armor = add(new BooleanSetting("Armor", "Sprawdzaj też zbroję", true));
        public final BooleanSetting sound = add(new BooleanSetting("Sound", "Dźwięk ostrzeżenia", true));
        private final Set<String> warned = new HashSet<String>();
        private int timer;

        public DurabilityAlert() {
            super("Durability Alert", "Ostrzeżenie, zanim narzędzie lub zbroja się zniszczy", Category.UTILITY);
        }

        @Override
        public void onTick() {
            if (!inGame() || timer-- > 0) return;
            timer = 10;
            List<ItemInfo> items = new ArrayList<ItemInfo>();
            ItemInfo hand = game().mainHand();
            if (hand != null) items.add(hand);
            if (armor.isOn()) items.addAll(game().armor());
            Set<String> low = new HashSet<String>();
            for (ItemInfo it : items) {
                if (it == null || !it.damageable()) continue;
                float pct = it.durabilityLeft() * 100f / it.maxDamage;
                if (pct > threshold.get()) continue;
                String key = it.id + "#" + it.maxDamage;
                low.add(key);
                if (warned.add(key)) {
                    NotificationManager.push("Wytrzymałość", pretty(it.id) + ": " + it.durabilityLeft() + "/" + it.maxDamage, NotificationManager.Type.WARNING);
                    if (sound.isOn()) game().playClick(0.6f);
                }
            }
            warned.retainAll(low);
        }
    }

    /** Red pulsing vignette when health is low. */
    public static final class LowHealthAlert extends Module {
        public final NumberSetting hearts = add(new NumberSetting("Hearts", "Próg w serduszkach", 4, 1, 10, 0.5));
        public final ColorSetting color = add(new ColorSetting("Color", "Kolor winiety", 0xC0FF2020));
        public final BooleanSetting pulse = add(new BooleanSetting("Pulse", "Pulsowanie w rytm serca", true));

        public LowHealthAlert() {
            super("Low Health Alert", "Czerwona winieta przy małej ilości życia", Category.UTILITY);
        }

        @Override
        public void onRenderOverlay(Gfx g, float tickDelta) {
            if (!inGame() || game().dead()) return;
            float hp = game().health() + game().absorption();
            float limit = hearts.floatValue() * 2;
            if (hp > limit) return;
            float strength = 1 - hp / Math.max(1, limit) * 0.6f;
            if (pulse.isOn()) strength *= 0.7f + 0.3f * (float) Math.abs(Math.sin(System.currentTimeMillis() / 300.0));
            int c = color.getColor();
            int edge = ColorUtil.withAlpha(c, (int) (ColorUtil.alpha(c) * Math.min(1, strength)));
            int none = ColorUtil.withAlpha(c, 0);
            float w = g.width(), h = g.height();
            float bw = w * 0.22f, bh = h * 0.25f;
            Render2D.quadGradient(g, 0, 0, bw, h, edge, none, none, edge);
            Render2D.quadGradient(g, w - bw, 0, bw, h, none, edge, edge, none);
            Render2D.quadGradient(g, 0, 0, w, bh, edge, edge, none, none);
            Render2D.quadGradient(g, 0, h - bh, w, bh, none, none, edge, edge);
        }
    }

    /** Notification shortly before a potion effect runs out. */
    public static final class EffectAlert extends Module {
        public final NumberSetting seconds = add(new NumberSetting("Seconds", "Ile sekund przed końcem ostrzec", 10, 3, 60, 1, "s"));
        private final Set<String> warned = new HashSet<String>();

        public EffectAlert() {
            super("Effect Alert", "Ostrzeżenie, gdy efekt mikstury się kończy", Category.UTILITY);
        }

        @Override
        public void onTick() {
            if (!inGame()) return;
            Set<String> current = new HashSet<String>();
            for (EffectInfo e : game().effects()) {
                if (e.infinite) continue;
                current.add(e.name);
                if (e.durationTicks <= seconds.get() * 20 && e.durationTicks > 0 && warned.add(e.name)) {
                    NotificationManager.push("Efekt się kończy", e.name + " – " + (e.durationTicks / 20) + " s", NotificationManager.Type.WARNING);
                }
                if (e.durationTicks > seconds.get() * 20 + 40) warned.remove(e.name);
            }
            warned.retainAll(current);
        }
    }

    /** Reminds you to take a break every so often. */
    public static final class BreakReminder extends Module {
        public final NumberSetting minutes = add(new NumberSetting("Interval", "Co ile minut przypominać", 60, 10, 240, 5, "min"));
        private long last = System.currentTimeMillis();
        private final long start = System.currentTimeMillis();

        public BreakReminder() {
            super("Break Reminder", "Przypomnienie o przerwie co jakiś czas", Category.UTILITY);
        }

        @Override
        protected void onEnable() { last = System.currentTimeMillis(); }

        @Override
        public void onTick() {
            long now = System.currentTimeMillis();
            if (now - last < minutes.get() * 60000) return;
            last = now;
            long played = (now - start) / 60000;
            NotificationManager.push("Czas na przerwę", "Grasz już " + (played / 60 > 0 ? played / 60 + " h " : "") + played % 60 + " min", NotificationManager.Type.INFO);
            game().playClick(1.4f);
        }
    }

    /** Copies (or sends) your coordinates with one key. */
    public static final class CoordsShare extends Module {
        public final ModeSetting target = add(new ModeSetting("Target", "Gdzie wysłać koordynaty", "Clipboard", "Clipboard", "Chat", "Both"));
        public final ModeSetting format = add(new ModeSetting("Format", "Format tekstu", "X Y Z", "X Y Z", "X, Y, Z", "Full"));

        public CoordsShare() {
            super("Coords Share", "Kopiuje lub wysyła Twoje koordynaty pod klawiszem", Category.UTILITY);
        }

        @Override
        protected boolean showsToggleNotification() { return false; }

        @Override
        protected void onEnable() {
            if (inGame()) {
                int x = (int) Math.floor(game().x()), y = (int) Math.floor(game().y()), z = (int) Math.floor(game().z());
                String text;
                if (format.is("X, Y, Z")) text = x + ", " + y + ", " + z;
                else if (format.is("Full")) text = "X: " + x + " Y: " + y + " Z: " + z + " (" + game().dimension().replace("the_", "") + ")";
                else text = x + " " + y + " " + z;
                if (!target.is("Chat")) game().setClipboard(text);
                if (!target.is("Clipboard")) game().sendChat(text);
                NotificationManager.push("Koordynaty", (target.is("Chat") ? "Wysłano: " : "Skopiowano: ") + text, NotificationManager.Type.SUCCESS);
            }
            setEnabled(false);
        }
    }

    /** Respawns automatically after death. */
    public static final class AutoRespawn extends Module {
        public final NumberSetting delay = add(new NumberSetting("Delay", "Opóźnienie odrodzenia", 1, 0, 5, 0.5, "s"));
        private int deadTicks;

        public AutoRespawn() {
            super("Auto Respawn", "Automatyczne odrodzenie po śmierci", Category.PLAYER);
        }

        @Override
        public void onTick() {
            if (!inGame() || !game().dead()) {
                deadTicks = 0;
                return;
            }
            if (++deadTicks == Math.max(1, (int) (delay.get() * 20))) game().respawn();
        }
    }

    static String lower(String s) { return s.toLowerCase(Locale.ROOT); }
}
