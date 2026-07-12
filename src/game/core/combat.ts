import type { MonsterDef, PlayerState } from "./types";

// Damage formulas. The min-1 floor guarantees combat always resolves — no
// infinite stalemate — which is the classic roguelike rule.

export function playerAttackDamage(
  player: PlayerState,
  target: MonsterDef
): number {
  return Math.max(1, player.weaponPower - target.armor);
}

export function monsterAttackDamage(
  attacker: MonsterDef,
  player: PlayerState
): number {
  // Some attackers (wraith) pierce part of the player's armor.
  const effectiveArmor = Math.max(
    0,
    player.armorReduction - (attacker.armorPierce ?? 0)
  );
  return Math.max(1, attacker.dmg - effectiveArmor);
}
