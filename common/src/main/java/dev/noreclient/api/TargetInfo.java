package dev.noreclient.api;

/** A living entity (last hit or under the crosshair). */
public final class TargetInfo {
    public final Object handle;
    public final String name;
    public final float health;
    public final float maxHealth;
    public final int armor;
    public final double distance;
    public final boolean player;

    public TargetInfo(Object handle, String name, float health, float maxHealth, int armor, double distance, boolean player) {
        this.handle = handle;
        this.name = name;
        this.health = health;
        this.maxHealth = maxHealth;
        this.armor = armor;
        this.distance = distance;
        this.player = player;
    }
}
