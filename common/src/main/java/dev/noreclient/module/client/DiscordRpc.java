package dev.noreclient.module.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.noreclient.NoreClient;
import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.StringSetting;
import dev.noreclient.util.DiscordIpc;

/**
 * Discord Rich Presence: shows Nore Client, the Minecraft version, what you are doing and for
 * how long. The Discord application id comes from this setting or from the launcher
 * (-Dnoreclient.discordAppId).
 */
public class DiscordRpc extends Module {
    public final StringSetting appId = add(new StringSetting("Application ID", "ID aplikacji z discord.com/developers (puste = z launchera)", "", 24));
    public final BooleanSetting showServer = add(new BooleanSetting("Show Server", "Pokazuj adres serwera", true));
    public final BooleanSetting showDimension = add(new BooleanSetting("Show Dimension", "Pokazuj wymiar (Overworld/Nether/End)", true));
    public final BooleanSetting showTime = add(new BooleanSetting("Show Time", "Pokazuj czas gry", true));
    public final BooleanSetting showButton = add(new BooleanSetting("Button", "Przycisk z linkiem do Nore Client", true));

    private final long start = System.currentTimeMillis() / 1000;
    private int timer;

    public DiscordRpc() {
        super("Discord RPC", "Status gry w Discordzie (Rich Presence)", Category.CLIENT);
        setEnabled(true);
    }

    private String id() {
        String s = appId.get().trim();
        if (s.isEmpty()) s = System.getProperty("noreclient.discordAppId", "").trim();
        return s;
    }

    @Override
    public void onTick() {
        if (timer-- > 0) return;
        timer = 40;
        String id = id();
        if (id.isEmpty()) return;
        DiscordIpc.update(id, activity());
    }

    @Override
    protected void onDisable() {
        String id = id();
        if (!id.isEmpty()) DiscordIpc.update(id, null);
    }

    private JsonObject activity() {
        String details, state;
        if (!game().inWorld()) {
            details = "W menu głównym";
            state = "Minecraft " + game().minecraftVersion();
        } else if (game().singleplayer()) {
            details = "Gra jednoosobowa";
            state = dimension();
        } else {
            String addr = game().serverAddress();
            details = showServer.isOn() && addr != null ? "Gra na " + addr : "Gra wieloosobowa";
            state = dimension();
            if (state == null) state = game().tabPlayerCount() + " graczy online";
        }
        JsonObject a = new JsonObject();
        a.addProperty("details", details);
        if (state != null) a.addProperty("state", state);
        if (showTime.isOn()) {
            JsonObject ts = new JsonObject();
            ts.addProperty("start", start);
            a.add("timestamps", ts);
        }
        JsonObject assets = new JsonObject();
        assets.addProperty("large_image", "logo");
        assets.addProperty("large_text", NoreClient.NAME + " " + NoreClient.VERSION);
        assets.addProperty("small_image", "minecraft");
        assets.addProperty("small_text", "Minecraft " + game().minecraftVersion());
        a.add("assets", assets);
        if (showButton.isOn()) {
            JsonArray buttons = new JsonArray();
            JsonObject b = new JsonObject();
            b.addProperty("label", "Nore Client");
            b.addProperty("url", "https://github.com/kondzio444/Noreclienr");
            buttons.add(b);
            a.add("buttons", buttons);
        }
        return a;
    }

    private String dimension() {
        if (!showDimension.isOn()) return null;
        String d = game().dimension();
        if ("overworld".equals(d)) return "Overworld";
        if ("the_nether".equals(d)) return "Nether";
        if ("the_end".equals(d)) return "End";
        return d;
    }

    @Override
    public boolean persistsEnabled() { return true; }
}
