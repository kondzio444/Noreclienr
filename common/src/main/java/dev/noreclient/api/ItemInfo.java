package dev.noreclient.api;

/** Version independent view of an item stack. {@code handle} is the platform's own stack object. */
public final class ItemInfo {
    public final Object handle;
    public final String id;
    public final int count;
    public final int damage;
    public final int maxDamage;

    public ItemInfo(Object handle, String id, int count, int damage, int maxDamage) {
        this.handle = handle;
        this.id = id;
        this.count = count;
        this.damage = damage;
        this.maxDamage = maxDamage;
    }

    public boolean damageable() { return maxDamage > 0; }

    public int durabilityLeft() { return maxDamage - damage; }
}
