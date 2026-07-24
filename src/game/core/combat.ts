import type { MonsterDef, PlayerState } from "./types";
import { CONFIG } from "@/content/config";
import { classDef } from "@/content/classes";

// Damage formulas. The min-1 floor guarantees combat always resolves — no
// infinite stalemate — which is the classic roguelike rule.

export function playerAttackDamage(
  player: PlayerState,
  target: MonsterDef,
): number {
  const might = (player.effects.might ?? 0) > 0 ? CONFIG.mightBonus : 0;
  return Math.max(
    1,
    player.weaponPower + player.weaponBonus + might - target.armor,
  );
}

/** Reduce incoming damage while the Ward effect is active (halve, min 1). */
export function wardMitigate(player: PlayerState, dmg: number): number {
  return (player.effects.ward ?? 0) > 0 ? Math.max(1, Math.ceil(dmg / 2)) : dmg;
}

/** The choke point for damage from an enemy ATTACK (melee/bolt): class damage
 * reduction (e.g. the Warrior's Stalwart) first, then Ward. Min-1 floor kept.
 * Environmental hazards (traps/fire/DoT) stay on wardMitigate only. */
export function mitigate(player: PlayerState, dmg: number): number {
  const dr = classDef(player.classId).damageReduction ?? 0;
  return wardMitigate(player, Math.max(1, dmg - dr));
}

export function monsterAttackDamage(
  attacker: MonsterDef,
  player: PlayerState,
  dmgBonus = 0,
): number {
  // Some attackers (wraith) pierce part of the player's armor.
  const effectiveArmor = Math.max(
    0,
    player.armorReduction - (attacker.armorPierce ?? 0),
  );
  const base = Math.max(1, attacker.dmg + dmgBonus - effectiveArmor);
  return mitigate(player, base);
}
