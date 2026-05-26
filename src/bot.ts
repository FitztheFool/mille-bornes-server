import { MBRoom, MBPlayer, Card, HazardType } from './types';
import { canRoll, isSpeedLimited, canAttack, sameTeam } from './game';

const BOT_PREFIX = 'bot-';
export function isBot(userId: string): boolean {
    return userId.startsWith(BOT_PREFIX);
}

export interface BotDecision {
    type: 'play' | 'discard';
    cardId: string;
    targetUserId?: string;
}

export function decideBotAction(room: MBRoom, bot: MBPlayer): BotDecision {
    const hand = bot.hand;
    const find = (pred: (c: Card) => boolean) => hand.find(pred);

    // 1. Fix own blocking condition so we can roll.
    if (bot.battleTop === 'accident') { const c = find(c => c.remedy === 'repairs'); if (c) return play(c); }
    if (bot.battleTop === 'outOfGas') { const c = find(c => c.remedy === 'gas'); if (c) return play(c); }
    if (bot.battleTop === 'flatTire') { const c = find(c => c.remedy === 'spareTire'); if (c) return play(c); }
    // A green light only helps once any active hazard is cleared (can't play Go over an accident/panne/crevaison).
    const blockedByHazard = bot.battleTop === 'accident' || bot.battleTop === 'outOfGas' || bot.battleTop === 'flatTire';
    if (!canRoll(bot) && !blockedByHazard) { const c = find(c => c.remedy === 'go'); if (c) return play(c); }
    if (isSpeedLimited(bot)) { const c = find(c => c.remedy === 'endLimit'); if (c) return play(c); }

    // 2. Drive: play the largest distance that fits.
    if (canRoll(bot)) {
        const maxKm = isSpeedLimited(bot) ? 50 : 200;
        const distances = hand
            .filter(c => c.kind === 'distance' && c.km! <= maxKm
                && bot.distance + c.km! <= room.target
                && !(c.km === 200 && bot.distance200Count >= 2))
            .sort((a, b) => b.km! - a.km!);
        // Prefer an exact finish if available.
        const exact = distances.find(c => bot.distance + c.km! === room.target);
        if (exact) return play(exact);
        if (distances.length) return play(distances[0]);
    }

    // 3. Attack the current leader with a usable hazard.
    const hazards = hand.filter(c => c.kind === 'hazard');
    for (const c of hazards) {
        const target = bestTarget(room, bot, c.hazard!);
        if (target) return play(c, target.userId);
    }

    // 4. Lay a safety (immunity + points) if we hold one.
    const safety = find(c => c.kind === 'safety');
    if (safety) return play(safety);

    // 5. Discard the least useful card.
    const discard = pickDiscard(bot);
    return { type: 'discard', cardId: discard.id };

    function play(c: Card, targetUserId?: string): BotDecision {
        return { type: 'play', cardId: c.id, targetUserId };
    }
}

function bestTarget(room: MBRoom, bot: MBPlayer, hazard: HazardType): MBPlayer | null {
    const candidates = room.players.filter(p => p.userId !== bot.userId && !sameTeam(bot, p) && canAttack(p, hazard));
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => b.distance - a.distance)[0];
}

export function pickDiscard(bot: MBPlayer): Card {
    // Throw away a hazard first (least useful to keep), else the lowest distance, else first card.
    return bot.hand.find(c => c.kind === 'hazard')
        ?? [...bot.hand].filter(c => c.kind === 'distance').sort((a, b) => a.km! - b.km!)[0]
        ?? bot.hand[0];
}
