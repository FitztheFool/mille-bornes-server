import { MBRoom, MBPlayer, ConfiguredPlayer, TeamMode, TeamDistance } from './types';
import { buildDeck, createPlayer, DEFAULT_TARGET } from './game';
import { TURN_DURATION } from './timer';

export const rooms: Record<string, MBRoom> = {};

export interface CreateRoomOptions {
    target?: number;
    teamMode?: TeamMode;
    teamDistance?: TeamDistance;
    teams?: Record<string, 0 | 1> | null;
}

export function createRoom(code: string, players: ConfiguredPlayer[], opts: CreateRoomOptions = {}): MBRoom {
    const t = opts.target === 700 ? 700 : DEFAULT_TARGET;
    const teamMode: TeamMode = opts.teamMode === '2v2' ? '2v2' : 'none';
    const teamDistance: TeamDistance = opts.teamDistance === 'shared' ? 'shared' : 'individual';
    const drawPile = buildDeck();

    let mbPlayers = players.map(p => {
        const mp = createPlayer(p, drawPile);
        if (teamMode === '2v2' && opts.teams) mp.team = opts.teams[mp.userId] ?? null;
        return mp;
    });

    // In 2v2, seat opponents alternately (A-B-A-B) so turns alternate between teams.
    if (teamMode === '2v2') mbPlayers = interleaveTeams(mbPlayers);

    rooms[code] = {
        code,
        players: mbPlayers,
        currentPlayerIndex: teamMode === '2v2' ? 0 : Math.floor(Math.random() * mbPlayers.length),
        phase: 'playing',
        target: t,
        drawPile,
        discardPile: [],
        lastDiscard: null,
        coupFourre: null,
        turnStartedAt: null,
        turnDuration: TURN_DURATION,
        log: [],
        logSeq: 0,
        afkStrikes: {},
        socketIds: new Map(),
        disconnectTimers: new Map(),
        winnerUserId: null,
        teamMode,
        teamDistance,
        winningTeam: null,
    };
    return rooms[code];
}

/** Reorder [team0, team0, team1, team1] → [team0, team1, team0, team1]. */
function interleaveTeams(players: MBPlayer[]): MBPlayer[] {
    const t0 = players.filter(p => p.team === 0);
    const t1 = players.filter(p => p.team === 1);
    const ordered: MBPlayer[] = [];
    for (let i = 0; i < Math.max(t0.length, t1.length); i++) {
        if (t0[i]) ordered.push(t0[i]);
        if (t1[i]) ordered.push(t1[i]);
    }
    // Append any unassigned players (shouldn't happen with valid 2v2 lobbies).
    for (const p of players) if (!ordered.includes(p)) ordered.push(p);
    return ordered;
}
