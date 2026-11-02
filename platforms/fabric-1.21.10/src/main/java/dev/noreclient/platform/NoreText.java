package dev.noreclient.platform;

import dev.noreclient.NoreClient;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.resource.DirectoryResourcePack;
import net.minecraft.resource.ResourcePack;
import net.minecraft.text.MutableText;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.Identifier;

import java.nio.file.Path;

/**
 * Marks in front of player names (tab list and name tags): the Nore icon for Nore users (a glyph
 * of the noreclient:icons font) and the friend star. Also serves the mod's own assets (that font)
 * to the game when no mod resource loader (Fabric API) does it.
 */
public final class NoreText {
    private static final Style ICON = Style.EMPTY.withFont(new net.minecraft.text.StyleSpriteSource.Font(Identifier.of("noreclient", "icons")));
    private static volatile boolean fontReady;

    private NoreText() {}

    /** Tab list name (the whole Text is the player's display name). */
    public static Text decorate(String name, Text text) {
        return mark(name, text, false);
    }

    /** Name tag above the head; the score line below the name is left alone. */
    public static Text label(String name, Text text) {
        if (text == null || name == null || !text.getString().contains(name)) return text;
        return mark(name, text, true);
    }

    private static Text mark(String name, Text text, boolean nametag) {
        if (text == null) return null;
        int m = NoreClient.nameMarks(name, nametag);
        if (m == 0) return text;
        MutableText out = Text.empty();
        if ((m & NoreClient.MARK_NORE) != 0) {
            Formatting col = (m & NoreClient.MARK_VERIFIED) != 0 ? Formatting.WHITE : Formatting.GRAY;
            if (fontReady) out.append(Text.literal("\uE100").setStyle(ICON.withColor(col)));
            else out.append(Text.literal("\u25C6").formatted((m & NoreClient.MARK_VERIFIED) != 0 ? Formatting.GOLD : Formatting.YELLOW));
            out.append(Text.literal(" "));
        }
        if ((m & NoreClient.MARK_FRIEND) != 0) out.append(Text.literal("\u2605 ").formatted(Formatting.GREEN));
        return out.append(text);
    }

    /** The mod jar as a resource pack for the client's resource reload (null when not needed). */
    public static ResourcePack pack(Object manager) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc == null || manager != mc.getResourcePackManager()) return null;
        if (FabricLoader.getInstance().isModLoaded("fabric-resource-loader-v0")) { fontReady = true; return null; }
        Path root = FabricLoader.getInstance().getModContainer("noreclient").map(c -> c.getRootPaths().get(0)).orElse(null);
        if (root == null) return null;
        try {
            ResourcePack pack = new DirectoryResourcePack(new net.minecraft.resource.ResourcePackInfo("noreclient", Text.literal("Nore Client"), net.minecraft.resource.ResourcePackSource.BUILTIN, java.util.Optional.empty()), root);
            fontReady = true;
            return pack;
        } catch (Throwable t) {
            return null;
        }
    }
}
