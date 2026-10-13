package dev.noreclient.module;

import dev.noreclient.module.client.ClickGuiModule;
import dev.noreclient.module.client.ClientSettings;
import dev.noreclient.module.hud.AnalogClockHud;
import dev.noreclient.module.hud.ArmorStatusHud;
import dev.noreclient.module.hud.BasicHuds;
import dev.noreclient.module.hud.CompassHud;
import dev.noreclient.module.hud.CooldownHud;
import dev.noreclient.module.hud.CoordinatesHud;
import dev.noreclient.module.hud.FpsGraphHud;
import dev.noreclient.module.hud.InfoHuds;
import dev.noreclient.module.hud.KeystrokesHud;
import dev.noreclient.module.hud.ModuleListHud;
import dev.noreclient.module.hud.PotionEffectsHud;
import dev.noreclient.module.hud.TargetHud;
import dev.noreclient.module.hud.WatermarkHud;
import dev.noreclient.module.player.ToggleSprint;
import dev.noreclient.module.render.BlockOutline;
import dev.noreclient.module.render.CameraTweaks;
import dev.noreclient.module.render.ClearWeather;
import dev.noreclient.module.render.CustomCrosshair;
import dev.noreclient.module.render.FogControl;
import dev.noreclient.module.render.FovChanger;
import dev.noreclient.module.render.Freelook;
import dev.noreclient.module.render.Fullbright;
import dev.noreclient.module.render.HandCustomizer;
import dev.noreclient.module.render.LowFire;
import dev.noreclient.module.render.NoHurtCam;
import dev.noreclient.module.render.Particles;
import dev.noreclient.module.render.SelfNametag;
import dev.noreclient.module.render.TimeChanger;
import dev.noreclient.module.render.Zoom;
import dev.noreclient.module.utility.ChatMacros;
import dev.noreclient.module.utility.ChatTimestamps;
import dev.noreclient.module.utility.ChatTweaks;
import dev.noreclient.module.utility.ScoreboardTweaks;
import dev.noreclient.module.utility.TabPing;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

public class ModuleManager {
    /** Every module, including ones the running version does not support. */
    private final List<Module> all = new ArrayList<Module>();
    /** Modules available on this Minecraft version (shown in the GUI). */
    private final List<Module> modules = new ArrayList<Module>();

    public void init() {
        add(new WatermarkHud());
        add(new ModuleListHud());
        add(new BasicHuds.Fps());
        add(new BasicHuds.Cps());
        add(new KeystrokesHud());
        add(new CoordinatesHud());
        add(new ArmorStatusHud());
        add(new PotionEffectsHud());
        add(new BasicHuds.Ping());
        add(new BasicHuds.Speed());
        add(new BasicHuds.Clock());
        add(new BasicHuds.Memory());
        add(new BasicHuds.ServerAddress());
        add(new CompassHud());
        add(new BasicHuds.Combo());
        add(new BasicHuds.Reach());
        add(new TargetHud());
        add(new FpsGraphHud());
        add(new AnalogClockHud());
        add(new CooldownHud());
        add(new InfoHuds.DayCounter());
        add(new InfoHuds.LightLevel());
        add(new InfoHuds.EntityCount());
        add(new InfoHuds.Saturation());
        add(new InfoHuds.Health());
        add(new InfoHuds.Experience());
        add(new InfoHuds.ArrowCounter());
        add(new InfoHuds.TotemCounter());
        add(new InfoHuds.PearlCounter());
        add(new InfoHuds.GappleCounter());
        add(new InfoHuds.SessionTime());
        add(new InfoHuds.DateDisplay());
        add(new InfoHuds.Weather());
        add(new InfoHuds.GameTime());
        add(new InfoHuds.Rotation());
        add(new InfoHuds.VerticalSpeed());
        add(new InfoHuds.DistanceTraveled());
        add(new InfoHuds.DeathCounter());
        add(new InfoHuds.BlockInfo());
        add(new InfoHuds.ChunkInfo());
        add(new InfoHuds.Dimension());
        add(new InfoHuds.PlayerCount());
        add(new InfoHuds.FrameTime());
        add(new InfoHuds.ServerBrand());
        add(new InfoHuds.MovementState());
        add(new InfoHuds.TargetDistance());
        add(new InfoHuds.ResourcePacks());
        add(new InfoHuds.SystemInfo());
        add(new InfoHuds.HitCounter());
        add(new InfoHuds.BiomeDisplay());
        add(new InfoHuds.ElytraInfo());
        add(new InfoHuds.TimeToDay());
        add(new Fullbright());
        add(new Zoom());
        add(new Freelook());
        add(new CustomCrosshair());
        add(new NoHurtCam());
        add(new LowFire());
        add(new TimeChanger());
        add(new ClearWeather());
        add(new Particles());
        add(new FogControl());
        add(new HandCustomizer());
        add(new CameraTweaks());
        add(new SelfNametag());
        add(new FovChanger());
        add(new BlockOutline());
        add(new ToggleSprint());
        add(new ChatTimestamps());
        add(new ScoreboardTweaks());
        add(new TabPing());
        add(new ChatTweaks());
        add(new ChatMacros());
        add(new ClientSettings());
        add(new ClickGuiModule());
        dev.noreclient.module.ExtraModules.register(this);

        Comparator<Module> byName = new Comparator<Module>() {
            @Override public int compare(Module a, Module b) { return a.getName().compareTo(b.getName()); }
        };
        Collections.sort(all, byName);
        for (Module m : all) if (m.isSupported()) modules.add(m);
    }

    void add(Module module) {
        all.add(module);
    }

    public List<Module> getAll() { return all; }

    public List<Module> getModules() { return modules; }

    public List<Module> getModules(Category category) {
        List<Module> out = new ArrayList<Module>();
        for (Module m : modules) if (m.getCategory() == category) out.add(m);
        return out;
    }

    public List<HudModule> getHudModules() {
        List<HudModule> out = new ArrayList<HudModule>();
        for (Module m : modules) if (m instanceof HudModule) out.add((HudModule) m);
        return out;
    }

    public List<Module> search(String query) {
        String q = query.toLowerCase(Locale.ROOT).trim();
        List<Module> out = new ArrayList<Module>();
        for (Module m : modules) {
            if (m.getName().toLowerCase(Locale.ROOT).contains(q) || m.getDescription().toLowerCase(Locale.ROOT).contains(q)) out.add(m);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    public <T extends Module> T get(Class<T> type) {
        for (Module m : all) if (type.isInstance(m)) return (T) m;
        throw new IllegalArgumentException("No module " + type.getSimpleName());
    }

    public Module byName(String name) {
        for (Module m : all) if (m.getName().equalsIgnoreCase(name)) return m;
        return null;
    }

    public int optionCount() {
        int n = 0;
        for (Module m : modules) n += m.getSettings().size() + 1;
        return n;
    }

    public void onTick() {
        for (Module m : modules) if (m.isEnabled()) m.onTick();
    }

    public void renderOverlays(dev.noreclient.api.Gfx g, float tickDelta) {
        for (Module m : modules) if (m.isActive()) m.onRenderOverlay(g, tickDelta);
    }

    public void onKey(int key) {
        get(ChatMacros.class).onKey(key);
        for (Module m : modules) if (m.isActive()) m.onKeyPressed(key);
        for (Module m : modules) {
            if (m.getKeybind().isBound() && m.getKeybind().get() == key) m.toggleWithFeedback();
        }
    }
}
