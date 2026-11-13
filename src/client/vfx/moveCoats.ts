/**
 * The coats contact moves wear (the hex battle's, shared with the side-on fighter): which priority dashes are coated head
 * to toe, which moves punch, and the aura a move coats its user in.
 */
import type { AuraOptions } from './UnitFx.ts';

/** Priority strikes whose user dashes coated head to toe in the move's element. */
export const QUICK_COATED = new Set(['Zippy Zap', 'Aqua Jet', 'Grassy Glide', 'Flame Charge', 'Aerial Ace']);
/** A punching move (Mach Punch, Bullet Punch, Fire Punch, Hammer Arm…): thrown with an arm, never a kick. */
export const isPunch = (name: string): boolean => /Punch|Fist|Hammer Arm|Uppercut/.test(name);
/**
 * Moves whose coat is not their type's plain aura: Sky Attack's Flying aura
 * (and its sphere) in gold; Brave Bird's is Flare Blitz's fire aura, in its
 * usual colours, with its fire sphere in blue flame.
 */
export const MOVE_AURA: Record<string, Partial<AuraOptions> & { element: string }> = {
  'Sky Attack': { element: 'Gold' },
  'Brave Bird': { element: 'Fire', noiseElement: 'BlueFire' },
};
/** The aura a move coats its user in (whole body): its own (MOVE_AURA), or its type's. */
export const coatOf = (moveName: string | null | undefined, type: string): AuraOptions =>
  ({ element: type, edge: 'tongues', reach: 'body', ...(moveName ? MOVE_AURA[moveName] : undefined) });
