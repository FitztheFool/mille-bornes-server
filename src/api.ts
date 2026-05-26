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

    // Placement: in 2v2 the whole winning team places 1st; otherwise rank by total points.
    const finishers = scores.filter(s => !surrenderUserIds.has(s.userId) && !afkUserIds.has(s.userId));
    const sorted = [...finishers].sort((a, b) => b.total - a.total);
    const placementOf = (s: typeof scores[number]): number => {
        if (room.teamMode === '2v2' && room.winningTeam != null) {
            return s.team === room.winningTeam ? 1 : 2;
        }
        return sorted.findIndex(x => x.userId === s.userId) + 1;
    };

    const entries: ScoreEntry[] = scores.map(s => {
        const abandon = surrenderUserIds.has(s.userId);
        const afk = afkUserIds.has(s.userId);
        const placement = abandon || afk ? null : placementOf(s);
        return {
            userId: s.userId,
            username: s.username,
            score: s.total,
            placement,
            team: s.team,
            abandon,
            afk,
        };
    });

    saveAttempts('MILLE_BORNES', gameId, entries, vsBot);
}
