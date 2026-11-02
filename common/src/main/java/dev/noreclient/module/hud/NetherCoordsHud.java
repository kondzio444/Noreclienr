package dev.noreclient.module.hud;

/** Where you would be in the other dimension (overworld ÷ 8 = nether), for building portals. */
public class NetherCoordsHud extends TextHudModule {
    public NetherCoordsHud() {
        super("Nether Coords", "Odpowiadające koordynaty w Netherze / Overworldzie (portale)", 0.0f, 0.4f);
    }

    private boolean inNether() { return "the_nether".equals(game().dimension()); }

    @Override
    protected String label() {
        return inGame() && inNether() ? "Overworld" : "Nether";
    }

    @Override
    protected String value() {
        String dim = game().dimension();
        if (!"overworld".equals(dim) && !"the_nether".equals(dim)) return "—";
        double f = inNether() ? 8 : 1 / 8.0;
        return (int) Math.floor(game().x() * f) + ", " + (int) Math.floor(game().z() * f);
    }

    @Override
    protected String previewValue() { return "125, -40"; }
}
