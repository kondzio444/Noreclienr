package dev.noreclient.module.hud;

import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import dev.noreclient.util.ClickTracker;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** The classic single-value overlays (FPS, CPS, ping, speed, clock, memory, server, combo, reach). */
public final class BasicHuds {
    private BasicHuds() {}

    public static final class Fps extends TextHudModule {
        public Fps() { super("FPS", "Wyświetla liczbę klatek na sekundę", 0.0f, 0.105f); setEnabled(true); }
        @Override protected String label() { return "FPS"; }
        @Override protected String value() { return String.valueOf(game().fps()); }
    }

    public static final class Cps extends TextHudModule {
        public final BooleanSetting showRight = add(new BooleanSetting("Right Click", "Pokazuj także prawy przycisk", true));
        public Cps() { super("CPS", "Kliknięcia na sekundę (LPM | PPM)", 0.0f, 0.19f); }
        @Override protected String label() { return "CPS"; }
        @Override protected String value() {
            return showRight.isOn() ? ClickTracker.left() + " | " + ClickTracker.right() : String.valueOf(ClickTracker.left());
        }
    }

    public static final class Ping extends TextHudModule {
        public Ping() { super("Ping", "Opóźnienie połączenia z serwerem", 0.0f, 0.26f); }
        @Override protected String label() { return "Ping"; }
        @Override protected String value() { return game().ping() + "ms"; }
        @Override protected String previewValue() { return "24ms"; }
    }

    public static final class Speed extends TextHudModule {
        public final ModeSetting unit = add(new ModeSetting("Unit", "Jednostka prędkości", "b/s", "b/s", "km/h"));
        public Speed() { super("Speed", "Aktualna prędkość poruszania się", 0.0f, 0.33f); }
        @Override protected String label() { return "Speed"; }
        @Override protected String value() {
            if (!inGame()) return "0.00 " + unit.get();
            double dx = game().x() - game().prevX(), dz = game().z() - game().prevZ();
            double bps = Math.sqrt(dx * dx + dz * dz) * 20.0;
            if (unit.is("km/h")) return String.format(Locale.ROOT, "%.1f km/h", bps * 3.6);
            return String.format(Locale.ROOT, "%.2f b/s", bps);
        }
    }

    public static final class Clock extends TextHudModule {
        public final ModeSetting format = add(new ModeSetting("Format", "Format godziny", "24h", "24h", "12h"));
        public final BooleanSetting seconds = add(new BooleanSetting("Seconds", "Pokazuj sekundy", false));
        public Clock() { super("Clock", "Aktualna godzina", 1.0f, 0.0f); }
        @Override protected String label() { return "Time"; }
        @Override protected String value() {
            String pattern = format.is("24h") ? (seconds.isOn() ? "HH:mm:ss" : "HH:mm") : (seconds.isOn() ? "hh:mm:ss a" : "hh:mm a");
            return new SimpleDateFormat(pattern, Locale.ROOT).format(new Date());
        }
    }

    public static final class Memory extends TextHudModule {
        public final ModeSetting mode = add(new ModeSetting("Mode", "Format wyświetlania", "Percent", "Percent", "MB"));
        public Memory() { super("Memory", "Użycie pamięci RAM przez grę", 1.0f, 0.07f); }
        @Override protected String label() { return "RAM"; }
        @Override protected String value() {
            Runtime rt = Runtime.getRuntime();
            long used = (rt.totalMemory() - rt.freeMemory()) / 1048576L, max = rt.maxMemory() / 1048576L;
            return mode.is("Percent") ? (used * 100 / Math.max(1, max)) + "%" : used + "/" + max + "MB";
        }
    }

    public static final class ServerAddress extends TextHudModule {
        public ServerAddress() { super("Server Address", "Adres serwera, na którym grasz", 1.0f, 0.14f); }
        @Override protected String label() { return "IP"; }
        @Override protected String value() {
            if (game().singleplayer()) return "Singleplayer";
            String a = game().serverAddress();
            return a == null ? "-" : a;
        }
        @Override protected String previewValue() { return "play.server.pl"; }
    }

    public static final class Combo extends TextHudModule {
        public final NumberSetting resetTime = add(new NumberSetting("Reset Time", "Po ilu sekundach zerować combo", 3, 1, 10, 0.5, "s"));
        private int combo, lastHurtTime;
        private long lastHit;
        public Combo() { super("Combo", "Licznik combo w walce", 0.5f, 0.75f); }
        public void onHit() { combo++; lastHit = System.currentTimeMillis(); }
        @Override public void onTick() {
            if (!inGame()) return;
            int ht = game().hurtTime();
            if (ht > 0 && lastHurtTime == 0) combo = 0;
            lastHurtTime = ht;
            if (System.currentTimeMillis() - lastHit > resetTime.get() * 1000) combo = 0;
        }
        @Override protected String label() { return "Combo"; }
        @Override protected String value() { return String.valueOf(combo); }
    }

    public static final class Reach extends TextHudModule {
        private double lastReach;
        private long lastHit;
        public Reach() { super("Reach Display", "Dystans ostatniego uderzenia", 0.5f, 0.8f); }
        public void onHit(double distance) { lastReach = distance; lastHit = System.currentTimeMillis(); }
        @Override protected String label() { return "Reach"; }
        @Override protected String value() {
            if (System.currentTimeMillis() - lastHit > 3000) return "-";
            return String.format(Locale.ROOT, "%.2f", lastReach);
        }
        @Override protected String previewValue() { return "2.87"; }
    }
}
