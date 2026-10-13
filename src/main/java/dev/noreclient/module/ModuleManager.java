package dev.noreclient.module;

import dev.noreclient.module.client.ClickGuiModule;
import dev.noreclient.module.client.ClientSettings;
import dev.noreclient.module.hud.*;
import dev.noreclient.module.player.ToggleSprint;
import dev.noreclient.module.render.*;
import dev.noreclient.module.utility.ChatTimestamps;
import dev.noreclient.module.utility.ScoreboardTweaks;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.stream.Collectors;

public class ModuleManager {
    private final List<Module> modules = new ArrayList<>();

    public void init() {
        // HUD
        add(new WatermarkHud());
        add(new ModuleListHud());
        add(new FpsHud());
        add(new CpsHud());
        add(new KeystrokesHud());
        add(new CoordinatesHud());
        add(new ArmorStatusHud());
        add(new PotionEffectsHud());
        add(new PingHud());
        add(new SpeedHud());
        add(new ClockHud());
        add(new MemoryHud());
        add(new ServerAddressHud());
        add(new CompassHud());
        add(new ComboHud());
        add(new ReachHud());
        add(new TargetHud());
        // Render
        add(new Fullbright());
        add(new Zoom());
        add(new Freelook());
        add(new CustomCrosshair());
        add(new NoHurtCam());
        add(new LowFire());
        add(new TimeChanger());
        add(new ClearWeather());
        // Player
        add(new ToggleSprint());
        // Utility
        add(new ChatTimestamps());
        add(new ScoreboardTweaks());
        // Client
        add(new ClientSettings());
        add(new ClickGuiModule());

        modules.sort(Comparator.comparing(Module::getName));
    }

    private void add(Module module) {
        modules.add(module);
    }

    public List<Module> getModules() { return modules; }

    public List<Module> getModules(Category category) {
        return modules.stream().filter(m -> m.getCategory() == category).collect(Collectors.toList());
    }

    public List<HudModule> getHudModules() {
        return modules.stream().filter(m -> m instanceof HudModule).map(m -> (HudModule) m).collect(Collectors.toList());
    }

    public List<Module> search(String query) {
        String q = query.toLowerCase(Locale.ROOT).trim();
        return modules.stream().filter(m -> m.getName().toLowerCase(Locale.ROOT).contains(q)
                || m.getDescription().toLowerCase(Locale.ROOT).contains(q)).collect(Collectors.toList());
    }

    @SuppressWarnings("unchecked")
    public <T extends Module> T get(Class<T> type) {
        for (Module m : modules) if (type.isInstance(m)) return (T) m;
        throw new IllegalArgumentException("No module " + type.getSimpleName());
    }

    public Optional<Module> byName(String name) {
        return modules.stream().filter(m -> m.getName().equalsIgnoreCase(name)).findFirst();
    }

    public void onTick() {
        for (Module m : modules) if (m.isEnabled()) m.onTick();
    }

    public void onKey(int key) {
        for (Module m : modules) {
            if (m.getKeybind().isBound() && m.getKeybind().get() == key) m.toggleWithFeedback();
        }
    }
}
