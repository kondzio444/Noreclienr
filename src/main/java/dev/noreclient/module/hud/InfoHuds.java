package dev.noreclient.module.hud;

import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.ModeSetting;
import dev.noreclient.setting.NumberSetting;
import com.mojang.blaze3d.platform.GlDebugInfo;
import net.minecraft.block.BlockState;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.MathHelper;
import net.minecraft.world.LightType;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * A collection of small, single-value information overlays. Each one inherits the full
 * {@link TextHudModule} styling options (style, brackets, background, colours, shadow, scale).
 */
public final class InfoHuds {
    private InfoHuds() {}

    static String cap(String s) {
        if (s == null || s.isEmpty()) return "";
        s = s.replace('_', ' ');
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    public static final class DayCounter extends TextHudModule {
        public DayCounter() { super("Day Counter", "Który to dzień w świecie", 0.0f, 0.45f); }
        @Override protected String label() { return "Dzień"; }
        @Override protected String value() { return String.valueOf(mc.world == null ? 0 : mc.world.getTimeOfDay() / 24000L); }
        @Override protected String previewValue() { return "42"; }
    }

    public static final class LightLevel extends TextHudModule {
        public final ModeSetting mode = add(new ModeSetting("Light Source", "Rodzaj światła", "Combined", "Combined", "Block", "Sky"));
        public final BooleanSetting warn = add(new BooleanSetting("Spawn Warning", "Czerwony kolor gdy mogą spawnić się moby (0)", true));
        public LightLevel() { super("Light Level", "Poziom światła w miejscu gracza", 0.0f, 0.5f); }
        @Override protected String label() { return "Światło"; }
        @Override protected String value() {
            if (mc.world == null || mc.player == null) return "15";
            BlockPos p = mc.player.getBlockPos();
            int v = switch (mode.get()) {
                case "Block" -> mc.world.getLightLevel(LightType.BLOCK, p);
                case "Sky" -> mc.world.getLightLevel(LightType.SKY, p);
                default -> mc.world.getLightLevel(p);
            };
            return (warn.isOn() && mc.world.getLightLevel(LightType.BLOCK, p) == 0 ? "§c" : "") + v;
        }
    }

    public static final class EntityCount extends TextHudModule {
        public final ModeSetting mode = add(new ModeSetting("Count", "Co liczyć", "All", "All", "Players"));
        public EntityCount() { super("Entity Count", "Liczba bytów w zasięgu", 0.0f, 0.55f); }
        @Override protected String label() { return mode.is("Players") ? "Gracze" : "Byty"; }
        @Override protected String value() {
            if (mc.world == null) return "0";
            return String.valueOf(mode.is("Players") ? mc.world.getPlayers().size() : mc.world.getRegularEntityCount());
        }
        @Override protected String previewValue() { return "128"; }
    }

    public static final class Saturation extends TextHudModule {
        public final BooleanSetting showHunger = add(new BooleanSetting("Show Hunger", "Pokazuj też głód", true));
        public Saturation() { super("Saturation", "Nasycenie i głód", 0.0f, 0.6f); }
        @Override protected String label() { return "Nasycenie"; }
        @Override protected String value() {
            if (mc.player == null) return "5.0";
            String sat = String.format(Locale.ROOT, "%.1f", mc.player.getHungerManager().getSaturationLevel());
            return showHunger.isOn() ? mc.player.getHungerManager().getFoodLevel() + " / " + sat : sat;
        }
    }

    public static final class Health extends TextHudModule {
        public final BooleanSetting absorption = add(new BooleanSetting("Absorption", "Doliczaj absorpcję", true));
        public final BooleanSetting hearts = add(new BooleanSetting("As Hearts", "Pokazuj w serduszkach zamiast punktów", false));
        public Health() { super("Health", "Dokładne zdrowie gracza", 0.0f, 0.65f); }
        @Override protected String label() { return "HP"; }
        @Override protected String value() {
            if (mc.player == null) return "20";
            float hp = mc.player.getHealth() + (absorption.isOn() ? mc.player.getAbsorptionAmount() : 0);
            if (hearts.isOn()) hp /= 2f;
            return String.format(Locale.ROOT, "%.1f", hp) + (hearts.isOn() ? " ❤" : "");
        }
    }

    public static final class Experience extends TextHudModule {
        public final BooleanSetting progress = add(new BooleanSetting("Progress", "Postęp do następnego poziomu", true));
        public Experience() { super("Experience", "Poziom doświadczenia", 0.0f, 0.7f); }
        @Override protected String label() { return "XP"; }
        @Override protected String value() {
            if (mc.player == null) return "30 (45%)";
            return mc.player.experienceLevel + (progress.isOn() ? " (" + Math.round(mc.player.experienceProgress * 100) + "%)" : "");
        }
    }

    /** Counts an item in the whole inventory. */
    public static class ItemCounter extends TextHudModule {
        private final Item item;
        private final String labelText;
        public final BooleanSetting hideZero = add(new BooleanSetting("Hide When Zero", "Ukryj, gdy nie masz przedmiotu", false));
        public final NumberSetting lowAmount = add(new NumberSetting("Low Warning", "Czerwony kolor poniżej tej liczby", 0, 0, 64, 1));

        protected ItemCounter(String name, String desc, String label, Item item, float y) {
            super(name, desc, 1.0f, y);
            this.item = item;
            this.labelText = label;
        }

        int count() {
            if (mc.player == null) return 0;
            int n = 0;
            var inv = mc.player.getInventory();
            for (int i = 0; i < inv.size(); i++) {
                ItemStack s = inv.getStack(i);
                if (s.isOf(item)) n += s.getCount();
            }
            return n;
        }

        @Override public boolean shouldRender() { return !hideZero.isOn() || count() > 0; }
        @Override protected String label() { return labelText; }
        @Override protected String value() {
            int c = count();
            return (c < lowAmount.intValue() ? "§c" : "") + c;
        }
        @Override protected String previewValue() { return "16"; }
    }

    public static final class ArrowCounter extends ItemCounter {
        public ArrowCounter() { super("Arrow Counter", "Liczba strzał w ekwipunku", "Strzały", Items.ARROW, 0.25f); }
    }

    public static final class TotemCounter extends ItemCounter {
        public TotemCounter() { super("Totem Counter", "Liczba totemów nieśmiertelności", "Totemy", Items.TOTEM_OF_UNDYING, 0.3f); }
    }

    public static final class PearlCounter extends ItemCounter {
        public PearlCounter() { super("Pearl Counter", "Liczba pereł kresu", "Perły", Items.ENDER_PEARL, 0.35f); }
    }

    public static final class GappleCounter extends ItemCounter {
        public GappleCounter() { super("Golden Apple Counter", "Liczba złotych jabłek", "Jabłka", Items.GOLDEN_APPLE, 0.4f); }
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
        @Override protected String value() {
            return LocalDate.now().format(DateTimeFormatter.ofPattern(format.get(), Locale.forLanguageTag("pl-PL")));
        }
    }

    public static final class Weather extends TextHudModule {
        public Weather() { super("Weather", "Aktualna pogoda w świecie", 1.0f, 0.3f); }
        @Override protected String label() { return "Pogoda"; }
        @Override protected String value() {
            if (mc.world == null) return "Słonecznie";
            if (mc.world.isThundering()) return "Burza";
            if (mc.world.isRaining()) return "Deszcz";
            return "Słonecznie";
        }
    }

    public static final class GameTime extends TextHudModule {
        public final ModeSetting format = add(new ModeSetting("Format", "Format zegara", "24h", "24h", "12h", "Ticks"));
        public GameTime() { super("Game Time", "Godzina w świecie Minecraft", 1.0f, 0.35f); }
        @Override protected String label() { return "Czas MC"; }
        @Override protected String value() {
            long t = mc.world == null ? 6000 : mc.world.getTimeOfDay() % 24000;
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
            float yaw = mc.player == null ? 0 : mc.player.getYaw(), pitch = mc.player == null ? 0 : mc.player.getPitch();
            if (wrapYaw.isOn()) yaw = MathHelper.wrapDegrees(yaw);
            String f = decimals.isOn() ? "%.1f" : "%.0f";
            return String.format(Locale.ROOT, f + " / " + f, yaw, pitch);
        }
    }

    public static final class VerticalSpeed extends TextHudModule {
        public VerticalSpeed() { super("Vertical Speed", "Prędkość w pionie (b/s)", 0.0f, 0.8f); }
        @Override protected String label() { return "Pion"; }
        @Override protected String value() {
            if (mc.player == null) return "0.00 b/s";
            return String.format(Locale.ROOT, "%+.2f b/s", (mc.player.getY() - mc.player.prevY) * 20);
        }
    }

    public static final class DistanceTraveled extends TextHudModule {
        public final ModeSetting unit = add(new ModeSetting("Unit", "Jednostka", "Blocks", "Blocks", "Km"));
        private double distance;
        private double lx, lz;
        private boolean init;
        public DistanceTraveled() { super("Distance Traveled", "Przebyty dystans w tej sesji", 0.0f, 0.85f); }
        @Override public void onTick() {
            if (mc.player == null) { init = false; return; }
            double x = mc.player.getX(), z = mc.player.getZ();
            if (init) {
                double d = Math.sqrt((x - lx) * (x - lx) + (z - lz) * (z - lz));
                if (d < 50) distance += d; // ignore teleports
            }
            lx = x; lz = z; init = true;
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
            if (mc.player == null) return;
            boolean dead = mc.player.isDead();
            if (dead && !wasDead) deaths++;
            wasDead = dead;
        }
        @Override protected String label() { return "Śmierci"; }
        @Override protected String value() { return String.valueOf(deaths); }
    }

    public static final class BlockInfo extends TextHudModule {
        public final BooleanSetting showId = add(new BooleanSetting("Show ID", "Pokazuj identyfikator bloku", false));
        public BlockInfo() { super("Block Info", "Nazwa bloku, na który patrzysz", 0.5f, 0.05f); }
        @Override public boolean shouldRender() { return mc.crosshairTarget instanceof BlockHitResult b && b.getType() == HitResult.Type.BLOCK; }
        @Override protected String label() { return "Blok"; }
        @Override protected String value() {
            if (mc.world == null || !(mc.crosshairTarget instanceof BlockHitResult b)) return "Kamień";
            BlockState st = mc.world.getBlockState(b.getBlockPos());
            return showId.isOn() ? st.getBlock().getTranslationKey().replace("block.minecraft.", "") : st.getBlock().getName().getString();
        }
    }

    public static final class ChunkInfo extends TextHudModule {
        public final BooleanSetting local = add(new BooleanSetting("Position In Chunk", "Pozycja wewnątrz chunka", true));
        public ChunkInfo() { super("Chunk Info", "Współrzędne chunka", 0.0f, 0.95f); }
        @Override protected String label() { return "Chunk"; }
        @Override protected String value() {
            if (mc.player == null) return "8, -16";
            BlockPos p = mc.player.getBlockPos();
            return (p.getX() >> 4) + ", " + (p.getZ() >> 4) + (local.isOn() ? " [" + (p.getX() & 15) + ", " + (p.getZ() & 15) + "]" : "");
        }
    }

    public static final class Dimension extends TextHudModule {
        public Dimension() { super("Dimension", "Wymiar, w którym jesteś", 1.0f, 0.45f); }
        @Override protected String label() { return "Wymiar"; }
        @Override protected String value() {
            if (mc.world == null) return "Overworld";
            String id = mc.world.getRegistryKey().getValue().getPath();
            return switch (id) {
                case "overworld" -> "Overworld";
                case "the_nether" -> "Nether";
                case "the_end" -> "End";
                default -> cap(id);
            };
        }
    }

    public static final class PlayerCount extends TextHudModule {
        public PlayerCount() { super("Player Count", "Liczba graczy na serwerze (tab)", 1.0f, 0.5f); }
        @Override protected String label() { return "Online"; }
        @Override protected String value() {
            return mc.getNetworkHandler() == null ? "1" : String.valueOf(mc.getNetworkHandler().getPlayerList().size());
        }
    }

    public static final class FrameTime extends TextHudModule {
        public FrameTime() { super("Frame Time", "Czas renderowania klatki", 1.0f, 0.55f); }
        @Override protected String label() { return "Klatka"; }
        @Override protected String value() {
            return String.format(Locale.ROOT, "%.1f ms", 1000.0 / Math.max(1, mc.getCurrentFps()));
        }
    }

    public static final class ServerBrand extends TextHudModule {
        public ServerBrand() { super("Server Brand", "Silnik serwera (Paper, Fabric...)", 1.0f, 0.6f); }
        @Override protected String label() { return "Silnik"; }
        @Override protected String value() {
            if (mc.isInSingleplayer()) return "Zintegrowany";
            String b = mc.getNetworkHandler() == null ? null : mc.getNetworkHandler().getBrand();
            return b == null ? "?" : b;
        }
        @Override protected String previewValue() { return "Paper"; }
    }

    public static final class MovementState extends TextHudModule {
        public MovementState() { super("Movement State", "Sprint, skradanie, pływanie, latanie", 0.5f, 0.85f); }
        @Override protected String label() { return "Ruch"; }
        @Override protected String value() {
            PlayerEntity p = mc.player;
            if (p == null) return "Sprint";
            if (p.isFallFlying()) return "Elytra";
            if (p.getAbilities().flying) return "Latanie";
            if (p.isSwimming()) return "Pływanie";
            if (p.isSneaking()) return "Skradanie";
            if (p.isSprinting()) return "Sprint";
            return p.getVelocity().horizontalLengthSquared() > 1e-4 ? "Chód" : "Stoi";
        }
    }

    public static final class TargetDistance extends TextHudModule {
        public TargetDistance() { super("Target Distance", "Odległość do celu pod celownikiem", 0.5f, 0.55f); }
        @Override public boolean shouldRender() { return mc.crosshairTarget != null && mc.crosshairTarget.getType() != HitResult.Type.MISS; }
        @Override protected String label() { return "Cel"; }
        @Override protected String value() {
            if (mc.player == null || mc.crosshairTarget == null) return "3.2 m";
            var pos = mc.crosshairTarget instanceof EntityHitResult e ? e.getEntity().getPos() : mc.crosshairTarget.getPos();
            return String.format(Locale.ROOT, "%.1f m", mc.player.getEyePos().distanceTo(pos));
        }
    }

    public static final class ResourcePacks extends TextHudModule {
        public ResourcePacks() { super("Resource Packs", "Liczba aktywnych paczek zasobów", 1.0f, 0.65f); }
        @Override protected String label() { return "Paczki"; }
        @Override protected String value() {
            long n = mc.getResourcePackManager().getEnabledIds().stream().filter(id -> id.startsWith("file/")).count();
            return String.valueOf(n);
        }
    }

    public static final class SystemInfo extends TextHudModule {
        public final ModeSetting show = add(new ModeSetting("Show", "Co pokazywać", "GPU", "GPU", "CPU", "Java"));
        public SystemInfo() { super("System Info", "Karta graficzna, procesor lub wersja Javy", 1.0f, 0.75f); }
        @Override protected String label() { return show.get(); }
        @Override protected String value() {
            String v = switch (show.get()) {
                case "CPU" -> GlDebugInfo.getCpuInfo();
                case "Java" -> System.getProperty("java.version");
                default -> GlDebugInfo.getRenderer();
            };
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
        @Override protected String value() {
            if (mc.world == null || mc.player == null) return "Plains";
            return cap(mc.world.getBiome(mc.player.getBlockPos()).getKey().map(k -> k.getValue().getPath()).orElse("?"));
        }
    }

    public static final class ElytraInfo extends TextHudModule {
        public ElytraInfo() { super("Elytra Info", "Wytrzymałość elytry i prędkość lotu", 0.5f, 0.7f); }
        @Override public boolean shouldRender() { return mc.player != null && mc.player.getEquippedStack(net.minecraft.entity.EquipmentSlot.CHEST).isOf(Items.ELYTRA); }
        @Override protected String label() { return "Elytra"; }
        @Override protected String value() {
            if (mc.player == null) return "92% • 34 b/s";
            ItemStack e = mc.player.getEquippedStack(net.minecraft.entity.EquipmentSlot.CHEST);
            int pct = e.isDamageable() ? (e.getMaxDamage() - e.getDamage()) * 100 / e.getMaxDamage() : 100;
            double v = mc.player.getVelocity().length() * 20;
            return pct + "% • " + String.format(Locale.ROOT, "%.0f b/s", v);
        }
    }

    public static final class TimeToDay extends TextHudModule {
        public TimeToDay() { super("Time Until Night", "Ile zostało do nocy / do dnia", 1.0f, 0.85f); }
        @Override protected String label() { return mc.world != null && (mc.world.getTimeOfDay() % 24000) >= 12542 ? "Do dnia" : "Do nocy"; }
        @Override protected String value() {
            long t = mc.world == null ? 6000 : mc.world.getTimeOfDay() % 24000;
            long left = t < 12542 ? 12542 - t : 24000 - t;
            long s = left / 20;
            return String.format("%d:%02d", s / 60, s % 60);
        }
    }
}
