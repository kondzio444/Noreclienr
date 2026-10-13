package dev.noreclient.module;

public enum Category {
    HUD("HUD", "Nakładki ekranowe", 0xFF7C5CFF),
    RENDER("Render", "Wygląd i kamera", 0xFF38BDF8),
    PLAYER("Player", "Ruch i gracz", 0xFF34D399),
    UTILITY("Utility", "Narzędzia i czat", 0xFFFBBF24),
    CLIENT("Client", "Ustawienia klienta", 0xFFF472B6);

    public final String displayName;
    public final String subtitle;
    public final int color;

    Category(String displayName, String subtitle, int color) {
        this.displayName = displayName;
        this.subtitle = subtitle;
        this.color = color;
    }
}
