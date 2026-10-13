package dev.noreclient.module.render;

import dev.noreclient.module.Category;
import dev.noreclient.module.Module;
import dev.noreclient.setting.BooleanSetting;
import dev.noreclient.setting.NumberSetting;

/** Moves / scales the first person items (e.g. lower shield, smaller sword). */
public class HandCustomizer extends Module {
    public final NumberSetting mainX = add(new NumberSetting("Main X", "Przesunięcie prawej ręki w poziomie", 0, -1, 1, 0.05));
    public final NumberSetting mainY = add(new NumberSetting("Main Y", "Przesunięcie prawej ręki w pionie", 0, -1, 1, 0.05));
    public final NumberSetting mainZ = add(new NumberSetting("Main Z", "Przesunięcie prawej ręki w głąb", 0, -1, 1, 0.05));
    public final NumberSetting mainScale = add(new NumberSetting("Main Scale", "Rozmiar przedmiotu w prawej ręce", 1, 0.3, 1.5, 0.05, "x"));
    public final NumberSetting offX = add(new NumberSetting("Offhand X", "Przesunięcie lewej ręki w poziomie", 0, -1, 1, 0.05));
    public final NumberSetting offY = add(new NumberSetting("Offhand Y", "Przesunięcie lewej ręki w pionie (np. niższa tarcza)", 0, -1, 1, 0.05));
    public final NumberSetting offZ = add(new NumberSetting("Offhand Z", "Przesunięcie lewej ręki w głąb", 0, -1, 1, 0.05));
    public final NumberSetting offScale = add(new NumberSetting("Offhand Scale", "Rozmiar przedmiotu w lewej ręce", 1, 0.3, 1.5, 0.05, "x"));
    public final NumberSetting swingSpeed = add(new NumberSetting("Swing Amount", "Siła animacji machnięcia", 100, 0, 100, 5, "%"));
    public final BooleanSetting noEquip = add(new BooleanSetting("No Equip Animation", "Bez animacji zmiany przedmiotu", false));

    public HandCustomizer() {
        super("Hand Customizer", "Pozycja i rozmiar przedmiotów w dłoni", Category.RENDER);
    }
}
