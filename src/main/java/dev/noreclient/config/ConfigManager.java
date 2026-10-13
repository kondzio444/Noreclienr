package dev.noreclient.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.noreclient.NoreClient;
import dev.noreclient.module.HudModule;
import dev.noreclient.module.Module;
import dev.noreclient.module.ModuleManager;
import dev.noreclient.setting.Setting;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

/**
 * Stores every module (enabled state, keybind, settings, HUD position) as JSON in
 * {@code .minecraft/config/noreclient}. Named profiles live in the {@code profiles} sub-folder.
 */
public class ConfigManager {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private final ModuleManager modules;
    private final Path dir;
    private final Path profilesDir;
    private String activeProfile = "default";

    public ConfigManager(ModuleManager modules) {
        this.modules = modules;
        this.dir = FabricLoader.getInstance().getConfigDir().resolve(NoreClient.MOD_ID);
        this.profilesDir = dir.resolve("profiles");
    }

    private Path mainFile() { return dir.resolve("config.json"); }

    public String getActiveProfile() { return activeProfile; }

    public void load() {
        try {
            Files.createDirectories(profilesDir);
            Path f = mainFile();
            if (!Files.exists(f)) return;
            JsonObject root = read(f);
            if (root.has("activeProfile")) activeProfile = root.get("activeProfile").getAsString();
            apply(root);
        } catch (Exception e) {
            NoreClient.LOGGER.error("Failed to load config", e);
        }
    }

    public void save() {
        try {
            Files.createDirectories(profilesDir);
            JsonObject root = serialize();
            root.addProperty("activeProfile", activeProfile);
            write(mainFile(), root);
        } catch (Exception e) {
            NoreClient.LOGGER.error("Failed to save config", e);
        }
    }

    // ---------------------------------------------------------------- profiles

    public List<String> listProfiles() {
        List<String> out = new ArrayList<>();
        try {
            Files.createDirectories(profilesDir);
            try (Stream<Path> s = Files.list(profilesDir)) {
                s.filter(p -> p.toString().endsWith(".json")).sorted().forEach(p -> {
                    String n = p.getFileName().toString();
                    out.add(n.substring(0, n.length() - 5));
                });
            }
        } catch (IOException e) {
            NoreClient.LOGGER.error("Failed to list profiles", e);
        }
        return out;
    }

    public static String sanitize(String name) {
        return name.trim().replaceAll("[^A-Za-z0-9_\\- ]", "").replace(' ', '_');
    }

    public boolean saveProfile(String name) {
        name = sanitize(name);
        if (name.isEmpty()) return false;
        try {
            write(profilesDir.resolve(name + ".json"), serialize());
            activeProfile = name;
            save();
            return true;
        } catch (IOException e) {
            NoreClient.LOGGER.error("Failed to save profile", e);
            return false;
        }
    }

    public boolean loadProfile(String name) {
        Path f = profilesDir.resolve(sanitize(name) + ".json");
        if (!Files.exists(f)) return false;
        try {
            apply(read(f));
            activeProfile = sanitize(name);
            save();
            return true;
        } catch (Exception e) {
            NoreClient.LOGGER.error("Failed to load profile", e);
            return false;
        }
    }

    public boolean deleteProfile(String name) {
        try {
            return Files.deleteIfExists(profilesDir.resolve(sanitize(name) + ".json"));
        } catch (IOException e) {
            return false;
        }
    }

    /** Resets every module to its defaults. */
    public void resetAll() {
        for (Module m : modules.getModules()) {
            for (Setting<?> s : m.getSettings()) s.reset();
            m.getKeybind().reset();
        }
    }

    // ---------------------------------------------------------------- (de)serialisation

    private JsonObject serialize() {
        JsonObject root = new JsonObject();
        root.addProperty("version", NoreClient.VERSION);
        JsonObject mods = new JsonObject();
        for (Module m : modules.getModules()) {
            JsonObject o = new JsonObject();
            if (m.persistsEnabled()) o.addProperty("enabled", m.isEnabled());
            o.add("key", m.getKeybind().toJson());
            JsonObject settings = new JsonObject();
            for (Setting<?> s : m.getSettings()) settings.add(s.getName(), s.toJson());
            o.add("settings", settings);
            if (m instanceof HudModule h) {
                JsonObject pos = new JsonObject();
                pos.addProperty("x", h.getRelX());
                pos.addProperty("y", h.getRelY());
                o.add("position", pos);
            }
            mods.add(m.getName(), o);
        }
        root.add("modules", mods);
        return root;
    }

    private void apply(JsonObject root) {
        if (!root.has("modules")) return;
        JsonObject mods = root.getAsJsonObject("modules");
        for (Module m : modules.getModules()) {
            if (!mods.has(m.getName())) continue;
            JsonObject o = mods.getAsJsonObject(m.getName());
            if (o.has("settings")) {
                JsonObject settings = o.getAsJsonObject("settings");
                for (Setting<?> s : m.getSettings()) {
                    JsonElement e = settings.get(s.getName());
                    if (e != null) {
                        try {
                            s.fromJson(e);
                        } catch (Exception ex) {
                            NoreClient.LOGGER.warn("Bad value for {}.{}", m.getName(), s.getName());
                        }
                    }
                }
            }
            if (o.has("key")) m.getKeybind().fromJson(o.get("key"));
            if (m instanceof HudModule h && o.has("position")) {
                JsonObject pos = o.getAsJsonObject("position");
                h.setRel(pos.get("x").getAsFloat(), pos.get("y").getAsFloat());
            }
            if (m.persistsEnabled() && o.has("enabled")) m.setEnabled(o.get("enabled").getAsBoolean());
        }
    }

    private static JsonObject read(Path f) throws IOException {
        try (Reader r = Files.newBufferedReader(f, StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(r).getAsJsonObject();
        }
    }

    private static void write(Path f, JsonObject o) throws IOException {
        Path tmp = f.resolveSibling(f.getFileName() + ".tmp");
        try (Writer w = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
            GSON.toJson(o, w);
        }
        Files.move(tmp, f, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }
}
