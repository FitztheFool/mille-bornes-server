import { saveAttempts, ScoreEntry } from '@kwizar/shared';
import { MBRoom } from './types';
import { computeScores } from './game';

export function saveMilleBornesResults(
    room: MBRoom,
    gameId: string,
    surrenderUserIds: Set<string> = new Set(),
    afkUserIds: Set<string> = new Set(),
): void {
    const vsBot = room.players.some(p => p.userId.startsWith('bot-'));
    const scores = computeScores(room);

    // Ranking by total points among players who neither surrendered nor went AFK.
    const finishers = scores.filter(s => !surrenderUserIds.has(s.userId) && !afkUserIds.has(s.userId));
    const sorted = [...finishers].sort((a, b) => b.total - a.total);

    const entries: ScoreEntry[] = scores.map(s => {
        const abandon = surrenderUserIds.has(s.userId);
        const afk = afkUserIds.has(s.userId);
        const placement = abandon || afk ? null : sorted.findIndex(x => x.userId === s.userId) + 1;
        return {
            userId: s.userId,
            username: s.username,
            score: s.total,
            placement,
            abandon,
            afk,
        };
    });

    saveAttempts('MILLE_BORNES', gameId, entries, vsBot);
}
