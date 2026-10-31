package dev.noreclient.module;

public enum Category {
    HUD("HUD", "Nakładki ekranowe", 0xFFFF8A1F),
    RENDER("Render", "Wygląd i kamera", 0xFFFFC447),
    PLAYER("Gracz", "Ruch i gracz", 0xFF34D399),
    UTILITY("Narzędzia", "Narzędzia i czat", 0xFF5EC8FF),
    CLIENT("Klient", "Ustawienia klienta", 0xFFFF6B8B);

    public final String displayName;
    public final String subtitle;
    public final int color;

    Category(String displayName, String subtitle, int color) {
        this.displayName = displayName;
        this.subtitle = subtitle;
        this.color = color;
    }
}
