import {
    MBRoom, MBPlayer, Card, HazardType, RemedyType, SafetyType, ConfiguredPlayer, LogTone,
    HAZARD_REMEDY, HAZARD_SAFETY,
} from './types';
import { buildDeck, shuffle } from './deck';

export const HAND_SIZE = 6;
export const DEFAULT_TARGET = 1000;

// ── French labels (for the action feed) ─────────────────────────────────────
export const HAZARD_LABEL: Record<HazardType, string> = {
    stop: 'Feu rouge', speedLimit: 'Limite 50', accident: 'Accident',
    outOfGas: "Panne d'essence", flatTire: 'Crevaison',
};
export const REMEDY_LABEL: Record<RemedyType, string> = {
    go: 'Feu vert', endLimit: 'Fin de limite', repairs: 'Réparations',
    gas: 'Essence', spareTire: 'Roue de secours',
};
export const SAFETY_LABEL: Record<SafetyType, string> = {
    rightOfWay: 'Prioritaire', drivingAce: 'As du volant',
    fuelTank: 'Citerne', punctureProof: 'Increvable',
};

const LOG_MAX = 30;

/** Append an entry to the room's action feed (capped). */
export function pushLog(room: MBRoom, tone: LogTone, text: string): void {
    room.log.push({ id: ++room.logSeq, tone, text });
    if (room.log.length > LOG_MAX) room.log.splice(0, room.log.length - LOG_MAX);
}

// ── Players ─────────────────────────────────────────────────────────────────

export function createPlayer(raw: ConfiguredPlayer, drawPile: Card[]): MBPlayer {
    const hand = drawPile.splice(0, HAND_SIZE);
    return {
        userId: raw.userId ?? raw.id ?? '',
        username: raw.username ?? raw.name ?? 'Joueur',
        hand,
        distance: 0,
        distance200Count: 0,
        battleTop: null,
        speedLimited: false,
        safeties: [],
        coupsFourres: 0,
        alive: true,
        finished: false,
    };
}

export function hasSafety(p: MBPlayer, s: SafetyType): boolean {
    return p.safeties.includes(s);
}

/** A player can play a distance card right now. */
export function canRoll(p: MBPlayer): boolean {
    if (p.battleTop === 'stop' || p.battleTop === 'accident' || p.battleTop === 'outOfGas' || p.battleTop === 'flatTire') {
        return false; // active hazard not yet remedied
    }
    return p.battleTop === 'go' || hasSafety(p, 'rightOfWay');
}

export function isSpeedLimited(p: MBPlayer): boolean {
    return p.speedLimited && !hasSafety(p, 'rightOfWay');
}

// ── Draw / discard ────────────────────────────────────────────────────────────

export function drawCard(room: MBRoom): Card | null {
    if (room.drawPile.length === 0) {
        // Reshuffle the discard pile (keep the very top as the visible discard).
        if (room.discardPile.length <= 1) return null;
        const top = room.discardPile.pop()!;
        room.drawPile = shuffle(room.discardPile);
        room.discardPile = [top];
    }
    return room.drawPile.shift() ?? null;
}

// ── Validation ──────────────────────────────────────────────────────────────

export function findPlayer(room: MBRoom, userId: string): MBPlayer | undefined {
    return room.players.find(p => p.userId === userId);
}
export function findPlayerIndex(room: MBRoom, userId: string): number {
    return room.players.findIndex(p => p.userId === userId);
}

/** Can `attacker` legally drop `hazard` on `target`? */
export function canAttack(target: MBPlayer, hazard: HazardType): boolean {
    if (!target.alive || target.finished) return false;
    if (hasSafety(target, HAZARD_SAFETY[hazard])) return false;
    if (hazard === 'speedLimit') return !target.speedLimited;
    // battle hazards (stop/accident/outOfGas/flatTire): target must be rolling.
    return canRoll(target);
}

export interface PlayValidation {
    ok: boolean;
    reason?: string;
}

/** Validate playing `card` from `player` (optionally targeting `target`). */
export function validatePlay(
    room: MBRoom, player: MBPlayer, card: Card, target?: MBPlayer,
): PlayValidation {
    switch (card.kind) {
        case 'distance': {
            if (!canRoll(player)) return { ok: false, reason: 'not_rolling' };
            const km = card.km!;
            if (isSpeedLimited(player) && km > 50) return { ok: false, reason: 'speed_limited' };
            if (km === 200 && player.distance200Count >= 2) return { ok: false, reason: 'too_many_200' };
            if (player.distance + km > room.target) return { ok: false, reason: 'overshoot' };
            return { ok: true };
        }
        case 'remedy': {
            const r = card.remedy!;
            if (r === 'go') {
                if (player.battleTop === 'go') return { ok: false, reason: 'already_go' };
                if (player.battleTop === 'accident' || player.battleTop === 'outOfGas' || player.battleTop === 'flatTire')
                    return { ok: false, reason: 'fix_hazard_first' };
                return { ok: true };
            }
            if (r === 'endLimit') return player.speedLimited ? { ok: true } : { ok: false, reason: 'not_limited' };
            if (r === 'repairs') return player.battleTop === 'accident' ? { ok: true } : { ok: false, reason: 'no_accident' };
            if (r === 'gas') return player.battleTop === 'outOfGas' ? { ok: true } : { ok: false, reason: 'no_gas' };
            if (r === 'spareTire') return player.battleTop === 'flatTire' ? { ok: true } : { ok: false, reason: 'no_flat' };
            return { ok: false, reason: 'bad_remedy' };
        }
        case 'safety':
            return { ok: true };
        case 'hazard': {
            if (!target) return { ok: false, reason: 'no_target' };
            if (target.userId === player.userId) return { ok: false, reason: 'self_target' };
            return canAttack(target, card.hazard!) ? { ok: true } : { ok: false, reason: 'cannot_attack' };
        }
        default:
            return { ok: false, reason: 'unknown' };
    }
}

// ── Apply ─────────────────────────────────────────────────────────────────────

/** Apply a (already-validated) play. Returns true if the player reached the target. */
export function applyPlay(
    room: MBRoom, player: MBPlayer, card: Card, target?: MBPlayer,
): { reachedTarget: boolean } {
    removeFromHand(player, card.id);

    switch (card.kind) {
        case 'distance': {
            player.distance += card.km!;
            if (card.km === 200) player.distance200Count++;
            if (player.distance >= room.target) {
                player.finished = true;
                return { reachedTarget: true };
            }
            break;
        }
        case 'remedy': {
            const r = card.remedy!;
            if (r === 'go') player.battleTop = 'go';
            else if (r === 'endLimit') player.speedLimited = false;
            else if (r === 'repairs') player.battleTop = 'repairs';
            else if (r === 'gas') player.battleTop = 'gas';
            else if (r === 'spareTire') player.battleTop = 'spareTire';
            room.discardPile.push(card);
            room.lastDiscard = card;
            break;
        }
        case 'safety': {
            const s = card.safety!;
            if (!player.safeties.includes(s)) player.safeties.push(s);
            // Clear a currently active matching condition and resume.
            if (s === 'rightOfWay') {
                if (player.battleTop === 'stop') player.battleTop = 'go';
                player.speedLimited = false;
            } else if (s === 'drivingAce' && player.battleTop === 'accident') player.battleTop = 'go';
            else if (s === 'fuelTank' && player.battleTop === 'outOfGas') player.battleTop = 'go';
            else if (s === 'punctureProof' && player.battleTop === 'flatTire') player.battleTop = 'go';
            break;
        }
        case 'hazard': {
            const h = card.hazard!;
            if (h === 'speedLimit') target!.speedLimited = true;
            else target!.battleTop = h;
            room.discardPile.push(card);
            room.lastDiscard = card;
            break;
        }
    }
    return { reachedTarget: false };
}

export function discardCard(room: MBRoom, player: MBPlayer, card: Card): void {
    removeFromHand(player, card.id);
    room.discardPile.push(card);
    room.lastDiscard = card;
}

function removeFromHand(player: MBPlayer, cardId: string): void {
    const i = player.hand.findIndex(c => c.id === cardId);
    if (i >= 0) player.hand.splice(i, 1);
}

// ── Coup fourré ────────────────────────────────────────────────────────────────

/** The safety in `target`'s hand that would counter `hazard`, if any. */
export function coupFourreCard(target: MBPlayer, hazard: HazardType): Card | undefined {
    const needed = HAZARD_SAFETY[hazard];
    return target.hand.find(c => c.kind === 'safety' && c.safety === needed);
}

/** Apply a coup fourré: cancel the hazard, lay the safety, +bonus, target keeps the turn. */
export function applyCoupFourre(room: MBRoom, player: MBPlayer, card: Card, hazard: HazardType): void {
    removeFromHand(player, card.id);
    const s = card.safety!;
    if (!player.safeties.includes(s)) player.safeties.push(s);
    // Undo the hazard.
    if (hazard === 'speedLimit') player.speedLimited = false;
    else player.battleTop = 'go';
    player.coupsFourres++;
}

// ── Turn flow ──────────────────────────────────────────────────────────────────

export function aliveCount(room: MBRoom): number {
    return room.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
}
export function hasHumanAlive(room: MBRoom): boolean {
    return room.players.some(p => p.alive && !p.userId.startsWith('bot-'));
}
export function nextAliveIndex(room: MBRoom, from: number): number {
    const len = room.players.length;
    for (let i = 1; i <= len; i++) {
        const idx = (from + i) % len;
        if (room.players[idx].alive && !room.players[idx].finished) return idx;
    }
    return from;
}

// ── Scoring ────────────────────────────────────────────────────────────────────

export interface MBScore {
    userId: string;
    username: string;
    distance: number;
    safetyPts: number;
    coupFourrePts: number;
    arrivalPts: number;
    total: number;
}

export function computeScores(room: MBRoom): MBScore[] {
    return room.players.map(p => {
        const safetyPts = p.safeties.length * 100 + (p.safeties.length === 4 ? 300 : 0);
        const coupFourrePts = p.coupsFourres * 300;
        const arrivalPts = p.finished ? 400 : 0;
        const total = p.distance + safetyPts + coupFourrePts + arrivalPts;
        return {
            userId: p.userId, username: p.username,
            distance: p.distance, safetyPts, coupFourrePts, arrivalPts, total,
        };
    });
}

export { buildDeck };
