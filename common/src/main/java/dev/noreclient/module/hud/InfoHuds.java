package dev.noreclient.module.hud;

import dev.noreclient.api.ItemInfo;
import dev.noreclient.api.TargetInfo;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * A collection of small, single-value information overlays. Each one inherits the full
 * {@link TextHudModule} styling options (style, brackets, background, colours, shadow, scale).
 */
public final class InfoHuds {
    private InfoHuds() {}

    static String cap(String s) { return CoordinatesHud.cap(s); }

    public static final class DayCounter extends TextHudModule {
        public DayCounter() { super("Day Counter", "Który to dzień w świecie", 0.0f, 0.45f); }
        @Override protected String label() { return "Dzień"; }
        @Override protected String value() { return String.valueOf(game().timeOfDay() / 24000L); }
        @Override protected String previewValue() { return "42"; }
    }

    public static final class LightLevel extends TextHudModule {
        public final ModeSetting mode = add(new ModeSetting("Light Source", "Rodzaj światła", "Combined", "Combined", "Block", "Sky"));
        public final BooleanSetting warn = add(new BooleanSetting("Spawn Warning", "Czerwony kolor gdy mogą spawnić się moby (0)", true));
        public LightLevel() { super("Light Level", "Poziom światła w miejscu gracza", 0.0f, 0.5f); }
        @Override protected String label() { return "Światło"; }
        @Override protected String value() {
            int v = game().lightLevel(mode.is("Block") ? 1 : mode.is("Sky") ? 2 : 0);
            return (warn.isOn() && game().lightLevel(1) == 0 ? "§c" : "") + v;
        }
        @Override protected String previewValue() { return "15"; }
    }

    public static final class EntityCount extends TextHudModule {
        public final ModeSetting mode = add(new ModeSetting("Count", "Co liczyć", "All", "All", "Players"));
        public EntityCount() { super("Entity Count", "Liczba bytów w zasięgu", 0.0f, 0.55f); }
        @Override protected String label() { return mode.is("Players") ? "Gracze" : "Byty"; }
        @Override protected String value() { return String.valueOf(mode.is("Players") ? game().worldPlayerCount() : game().entityCount()); }
        @Override protected String previewValue() { return "128"; }
    }

    public static final class Saturation extends TextHudModule {
        public final BooleanSetting showHunger = add(new BooleanSetting("Show Hunger", "Pokazuj też głód", true));
        public Saturation() { super("Saturation", "Nasycenie i głód", 0.0f, 0.6f); }
        @Override protected String label() { return "Nasycenie"; }
        @Override protected String value() {
            String sat = String.format(Locale.ROOT, "%.1f", game().saturation());
            return showHunger.isOn() ? game().food() + " / " + sat : sat;
        }
        @Override protected String previewValue() { return "20 / 5.0"; }
    }

    public static final class Health extends TextHudModule {
        public final BooleanSetting absorption = add(new BooleanSetting("Absorption", "Doliczaj absorpcję", true));
        public final BooleanSetting hearts = add(new BooleanSetting("As Hearts", "Pokazuj w serduszkach zamiast punktów", false));
        public Health() { super("Health", "Dokładne zdrowie gracza", 0.0f, 0.65f); }
        @Override protected String label() { return "HP"; }
        @Override protected String value() {
            float hp = game().health() + (absorption.isOn() ? game().absorption() : 0);
            if (hearts.isOn()) hp /= 2f;
            return String.format(Locale.ROOT, "%.1f", hp) + (hearts.isOn() ? " ❤" : "");
        }
        @Override protected String previewValue() { return "20.0"; }
    }

    public static final class Experience extends TextHudModule {
        public final BooleanSetting progress = add(new BooleanSetting("Progress", "Postęp do następnego poziomu", true));
        public Experience() { super("Experience", "Poziom doświadczenia", 0.0f, 0.7f); }
        @Override protected String label() { return "XP"; }
        @Override protected String value() {
            return game().xpLevel() + (progress.isOn() ? " (" + Math.round(game().xpProgress() * 100) + "%)" : "");
        }
        @Override protected String previewValue() { return "30 (45%)"; }
    }

    /** Counts an item in the whole inventory. */
    public static class ItemCounter extends TextHudModule {
        private final String item;
        private final String labelText;
        public final BooleanSetting hideZero = add(new BooleanSetting("Hide When Zero", "Ukryj, gdy nie masz przedmiotu", false));
        public final NumberSetting lowAmount = add(new NumberSetting("Low Warning", "Czerwony kolor poniżej tej liczby", 0, 0, 64, 1));

        protected ItemCounter(String name, String desc, String label, String itemId, float y) {
            super(name, desc, 1.0f, y);
            this.item = itemId;
            this.labelText = label;
        }

        int count() { return inGame() ? game().countItem(item) : 0; }

        @Override public boolean shouldRender() { return !hideZero.isOn() || count() > 0; }
        @Override protected String label() { return labelText; }
        @Override protected String value() {
            int c = count();
            return (c < lowAmount.intValue() ? "§c" : "") + c;
        }
        @Override protected String previewValue() { return "16"; }
    }

    public static final class ArrowCounter extends ItemCounter {
        public ArrowCounter() { super("Arrow Counter", "Liczba strzał w ekwipunku", "Strzały", "minecraft:arrow", 0.25f); }
    }

    public static final class TotemCounter extends ItemCounter {
        public TotemCounter() { super("Totem Counter", "Liczba totemów nieśmiertelności", "Totemy", "minecraft:totem_of_undying", 0.3f); }
    }

    public static final class PearlCounter extends ItemCounter {
        public PearlCounter() { super("Pearl Counter", "Liczba pereł kresu", "Perły", "minecraft:ender_pearl", 0.35f); }
    }

    public static final class GappleCounter extends ItemCounter {
        public GappleCounter() { super("Golden Apple Counter", "Liczba złotych jabłek", "Jabłka", "minecraft:golden_apple", 0.4f); }
    }

    public static final class SessionTime extends TextHudModule {
        private static final long START = System.currentTimeMillis();
        public final BooleanSetting seconds = add(new BooleanSetting("Seconds", "Pokazuj sekundy", true));
        public SessionTime() { super("Session Time", "Czas od uruchomienia gry", 1.0f, 0.2f); }
        @Override protected String label() { return "Sesja"; }
        @Override protected String value() {
            long s = (System.currentTimeMillis() - START) / 1000;
            return seconds.isOn() ? String.format("%d:%02d:%02d", s / 3600, (s / 60) % 60, s % 60) : String.format("%d h %02d min", s / 3600, (s / 60) % 60);
        }
    }

    public static final class DateDisplay extends TextHudModule {
        public final ModeSetting format = add(new ModeSetting("Format", "Format daty", "dd.MM.yyyy", "dd.MM.yyyy", "yyyy-MM-dd", "dd MMM", "EEEE"));
        public DateDisplay() { super("Date", "Dzisiejsza data", 1.0f, 0.25f); }
        @Override protected String label() { return "Data"; }
        @Override protected String value() { return new SimpleDateFormat(format.get(), new Locale("pl", "PL")).format(new Date()); }
    }

    public static final class Weather extends TextHudModule {
        public Weather() { super("Weather", "Aktualna pogoda w świecie", 1.0f, 0.3f); }
        @Override protected String label() { return "Pogoda"; }
        @Override protected String value() {
            if (game().thundering()) return "Burza";
            if (game().raining()) return "Deszcz";
            return "Słonecznie";
        }
        @Override protected String previewValue() { return "Słonecznie"; }
    }

    public static final class GameTime extends TextHudModule {
        public final ModeSetting format = add(new ModeSetting("Format", "Format zegara", "24h", "24h", "12h", "Ticks"));
        public GameTime() { super("Game Time", "Godzina w świecie Minecraft", 1.0f, 0.35f); }
        @Override protected String label() { return "Czas MC"; }
        @Override protected String value() {
            long t = (inGame() ? game().timeOfDay() : 6000) % 24000;
            if (format.is("Ticks")) return String.valueOf(t);
            int hours = (int) ((t / 1000 + 6) % 24), minutes = (int) (t % 1000 * 60 / 1000);
            if (format.is("12h")) return String.format("%d:%02d %s", hours % 12 == 0 ? 12 : hours % 12, minutes, hours < 12 ? "AM" : "PM");
            return String.format("%02d:%02d", hours, minutes);
        }
    }

    public static final class Rotation extends TextHudModule {
        public final BooleanSetting decimals = add(new BooleanSetting("Decimals", "Dokładne wartości", true));
        public final BooleanSetting wrapYaw = add(new BooleanSetting("Wrap Yaw", "Yaw w zakresie -180..180", true));
        public Rotation() { super("Rotation", "Yaw i pitch kamery", 0.0f, 0.75f); }
        @Override protected String label() { return "Obrót"; }
        @Override protected String value() {
            float yaw = inGame() ? game().yaw(1) : 0, pitch = inGame() ? game().pitch() : 0;
            if (wrapYaw.isOn()) yaw = CompassHud.wrap(yaw);
            String f = decimals.isOn() ? "%.1f" : "%.0f";
            return String.format(Locale.ROOT, f + " / " + f, yaw, pitch);
        }
    }

    public static final class VerticalSpeed extends TextHudModule {
        public VerticalSpeed() { super("Vertical Speed", "Prędkość w pionie (b/s)", 0.0f, 0.8f); }
        @Override protected String label() { return "Pion"; }
        @Override protected String value() {
            return inGame() ? String.format(Locale.ROOT, "%+.2f b/s", (game().y() - game().prevY()) * 20) : "0.00 b/s";
        }
    }

    public static final class DistanceTraveled extends TextHudModule {
        public final ModeSetting unit = add(new ModeSetting("Unit", "Jednostka", "Blocks", "Blocks", "Km"));
        private double distance, lx, lz;
        private boolean init;
        public DistanceTraveled() { super("Distance Traveled", "Przebyty dystans w tej sesji", 0.0f, 0.85f); }
        @Override public void onTick() {
            if (!inGame()) { init = false; return; }
            double x = game().x(), z = game().z();
            if (init) {
                double d = Math.sqrt((x - lx) * (x - lx) + (z - lz) * (z - lz));
                if (d < 50) distance += d;
            }
            lx = x;
            lz = z;
            init = true;
        }
        @Override protected String label() { return "Dystans"; }
        @Override protected String value() {
            return unit.is("Km") ? String.format(Locale.ROOT, "%.2f km", distance / 1000) : String.format(Locale.ROOT, "%.0f bl", distance);
        }
    }

    public static final class DeathCounter extends TextHudModule {
        private int deaths;
        private boolean wasDead;
        public DeathCounter() { super("Death Counter", "Liczba śmierci w tej sesji", 0.0f, 0.9f); }
        @Override public void onTick() {
            if (!inGame()) return;
            boolean dead = game().dead();
            if (dead && !wasDead) deaths++;
            wasDead = dead;
        }
        @Override protected String label() { return "Śmierci"; }
        @Override protected String value() { return String.valueOf(deaths); }
    }

    public static final class BlockInfo extends TextHudModule {
        public final BooleanSetting showId = add(new BooleanSetting("Show ID", "Pokazuj identyfikator bloku", false));
        public BlockInfo() { super("Block Info", "Nazwa bloku, na który patrzysz", 0.5f, 0.05f); }
        @Override public boolean shouldRender() { return inGame() && game().lookBlock(false) != null; }
        @Override protected String label() { return "Blok"; }
        @Override protected String value() {
            String b = game().lookBlock(showId.isOn());
            return b == null ? "-" : b;
        }
        @Override protected String previewValue() { return "Kamień"; }
    }

    public static final class ChunkInfo extends TextHudModule {
        public final BooleanSetting local = add(new BooleanSetting("Position In Chunk", "Pozycja wewnątrz chunka", true));
        public ChunkInfo() { super("Chunk Info", "Współrzędne chunka", 0.0f, 0.95f); }
        @Override protected String label() { return "Chunk"; }
        @Override protected String value() {
            int x = (int) Math.floor(game().x()), z = (int) Math.floor(game().z());
            return (x >> 4) + ", " + (z >> 4) + (local.isOn() ? " [" + (x & 15) + ", " + (z & 15) + "]" : "");
        }
        @Override protected String previewValue() { return "8, -16"; }
    }

    public static final class Dimension extends TextHudModule {
        public Dimension() { super("Dimension", "Wymiar, w którym jesteś", 1.0f, 0.45f); }
        @Override protected String label() { return "Wymiar"; }
        @Override protected String value() {
            String id = game().dimension();
            if ("overworld".equals(id)) return "Overworld";
            if ("the_nether".equals(id)) return "Nether";
            if ("the_end".equals(id)) return "End";
            return cap(id);
        }
        @Override protected String previewValue() { return "Overworld"; }
    }

    public static final class PlayerCount extends TextHudModule {
        public PlayerCount() { super("Player Count", "Liczba graczy na serwerze (tab)", 1.0f, 0.5f); }
        @Override protected String label() { return "Online"; }
        @Override protected String value() { return String.valueOf(game().tabPlayerCount()); }
        @Override protected String previewValue() { return "1"; }
    }

    public static final class FrameTime extends TextHudModule {
        public FrameTime() { super("Frame Time", "Czas renderowania klatki", 1.0f, 0.55f); }
        @Override protected String label() { return "Klatka"; }
        @Override protected String value() { return String.format(Locale.ROOT, "%.1f ms", 1000.0 / Math.max(1, game().fps())); }
    }

    public static final class ServerBrand extends TextHudModule {
        public ServerBrand() { super("Server Brand", "Silnik serwera (Paper, Fabric...)", 1.0f, 0.6f); }
        @Override protected String label() { return "Silnik"; }
        @Override protected String value() {
            if (game().singleplayer()) return "Zintegrowany";
            String b = game().serverBrand();
            return b == null ? "?" : b;
        }
        @Override protected String previewValue() { return "Paper"; }
    }

    public static final class MovementState extends TextHudModule {
        public MovementState() { super("Movement State", "Sprint, skradanie, pływanie, latanie", 0.5f, 0.85f); }
        @Override protected String label() { return "Ruch"; }
        @Override protected String value() {
            if (!inGame()) return "Sprint";
            if (game().fallFlying()) return "Elytra";
            if (game().flying()) return "Latanie";
            if (game().swimming()) return "Pływanie";
            if (game().sneaking()) return "Skradanie";
            if (game().sprinting()) return "Sprint";
            double v = game().velocityX() * game().velocityX() + game().velocityZ() * game().velocityZ();
            return v > 1e-4 ? "Chód" : "Stoi";
        }
    }

    public static final class TargetDistance extends TextHudModule {
        public TargetDistance() { super("Target Distance", "Odległość do celu pod celownikiem", 0.5f, 0.55f); }
        @Override public boolean shouldRender() { return inGame() && game().lookDistance() >= 0; }
        @Override protected String label() { return "Cel"; }
        @Override protected String value() { return String.format(Locale.ROOT, "%.1f m", Math.max(0, game().lookDistance())); }
        @Override protected String previewValue() { return "3.2 m"; }
    }

    public static final class ResourcePacks extends TextHudModule {
        public ResourcePacks() { super("Resource Packs", "Liczba aktywnych paczek zasobów", 1.0f, 0.65f); }
        @Override protected String label() { return "Paczki"; }
        @Override protected String value() { return String.valueOf(game().activeResourcePacks()); }
    }

    public static final class SystemInfo extends TextHudModule {
        public final ModeSetting show = add(new ModeSetting("Show", "Co pokazywać", "GPU", "GPU", "CPU", "Java"));
        public SystemInfo() { super("System Info", "Karta graficzna, procesor lub wersja Javy", 1.0f, 0.75f); }
        @Override protected String label() { return show.get(); }
        @Override protected String value() {
            String v = show.is("CPU") ? game().cpu() : show.is("Java") ? System.getProperty("java.version") : game().gpu();
            if (v == null) v = "?";
            return v.length() > 40 ? v.substring(0, 40) + "..." : v;
        }
    }

    public static final class HitCounter extends TextHudModule {
        private int hits;
        public HitCounter() { super("Hit Counter", "Liczba uderzeń w tej sesji", 0.5f, 0.9f); }
        public void onHit() { hits++; }
        @Override protected String label() { return "Uderzenia"; }
        @Override protected String value() { return String.valueOf(hits); }
    }

    public static final class BiomeDisplay extends TextHudModule {
        public BiomeDisplay() { super("Biome", "Biom, w którym jesteś", 1.0f, 0.8f); }
        @Override protected String label() { return "Biom"; }
        @Override protected String value() { return cap(game().biome()); }
        @Override protected String previewValue() { return "Plains"; }
    }

    public static final class ElytraInfo extends TextHudModule {
        public ElytraInfo() { super("Elytra Info", "Wytrzymałość elytry i prędkość lotu", 0.5f, 0.7f); }
        private ItemInfo elytra() {
            ItemInfo c = inGame() ? game().chestItem() : null;
            return c != null && "minecraft:elytra".equals(c.id) ? c : null;
        }
        @Override public boolean shouldRender() { return elytra() != null; }
        @Override protected String label() { return "Elytra"; }
        @Override protected String value() {
            ItemInfo e = elytra();
            if (e == null) return "92% • 34 b/s";
            int pct = e.damageable() ? e.durabilityLeft() * 100 / e.maxDamage : 100;
            double v = Math.sqrt(game().velocityX() * game().velocityX() + game().velocityY() * game().velocityY() + game().velocityZ() * game().velocityZ()) * 20;
            return pct + "% • " + String.format(Locale.ROOT, "%.0f b/s", v);
        }
    }

    public static final class TimeToDay extends TextHudModule {
        public TimeToDay() { super("Time Until Night", "Ile zostało do nocy / do dnia", 1.0f, 0.85f); }
        @Override protected String label() { return (game().timeOfDay() % 24000) >= 12542 ? "Do dnia" : "Do nocy"; }
        @Override protected String value() {
            long t = (inGame() ? game().timeOfDay() : 6000) % 24000;
            long left = t < 12542 ? 12542 - t : 24000 - t;
            long s = left / 20;
            return String.format("%d:%02d", s / 60, s % 60);
        }
    }

    /** Unused helper kept for API symmetry. */
    static TargetInfo none() { return null; }
}
