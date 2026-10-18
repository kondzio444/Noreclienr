package dev.noreclient.platform;

import dev.noreclient.NoreClient;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.Identifier;
import net.minecraft.server.packs.PackLocationInfo;
import net.minecraft.server.packs.PackResources;
import net.minecraft.server.packs.PathPackResources;
import net.minecraft.server.packs.repository.PackSource;

import java.nio.file.Path;
import java.util.Optional;

/**
 * Marks in front of player names (tab list and name tags): the Nore icon for Nore users (a glyph
 * of the noreclient:icons font) and the friend star. Also serves the mod's own assets (that font)
 * to the game when no mod resource loader (Fabric API) does it.
 */
public final class NoreText {
    private static final Style ICON = Style.EMPTY.withFont(new FontDescription.Resource(Identifier.fromNamespaceAndPath("noreclient", "icons")));
    private static volatile boolean fontReady;

    private NoreText() {}

    /** Tab list name (the whole component is the player's display name). */
    public static Component decorate(String name, Component text) {
        return mark(name, text, false);
    }

    /** Name tag above the head; the score line below the name is left alone. */
    public static Component label(String name, Component text) {
        if (text == null || name == null || !text.getString().contains(name)) return text;
        return mark(name, text, true);
    }

    private static Component mark(String name, Component text, boolean nametag) {
        if (text == null) return null;
        int m = NoreClient.nameMarks(name, nametag);
        if (m == 0) return text;
        MutableComponent out = Component.empty();
        if ((m & NoreClient.MARK_NORE) != 0) {
            ChatFormatting col = (m & NoreClient.MARK_VERIFIED) != 0 ? ChatFormatting.WHITE : ChatFormatting.GRAY;
            if (fontReady) out.append(Component.literal("\uE100").setStyle(ICON.withColor(col)));
            else out.append(Component.literal("\u25C6").withStyle((m & NoreClient.MARK_VERIFIED) != 0 ? ChatFormatting.GOLD : ChatFormatting.YELLOW));
            out.append(Component.literal(" "));
        }
        if ((m & NoreClient.MARK_FRIEND) != 0) out.append(Component.literal("\u2605 ").withStyle(ChatFormatting.GREEN));
        return out.append(text);
    }

    /** The mod jar as a resource pack for the client's resource reload (null when not needed). */
    public static PackResources pack(Object repository) {
        Minecraft mc = Minecraft.getInstance();
        if (mc == null || repository != mc.getResourcePackRepository()) return null;
        if (FabricLoader.getInstance().isModLoaded("fabric-resource-loader-v0")) { fontReady = true; return null; }
        Path root = FabricLoader.getInstance().getModContainer("noreclient").map(c -> c.getRootPaths().get(0)).orElse(null);
        if (root == null) return null;
        try {
            PackResources pack = new PathPackResources(new PackLocationInfo("noreclient", Component.literal("Nore Client"), PackSource.BUILT_IN, Optional.empty()), root);
            fontReady = true;
            return pack;
        } catch (Throwable t) {
            return null;
        }
    }
}
