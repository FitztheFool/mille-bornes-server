import { MBRoom, ConfiguredPlayer } from './types';
import { buildDeck, createPlayer, DEFAULT_TARGET } from './game';
import { TURN_DURATION } from './timer';

export const rooms: Record<string, MBRoom> = {};

export function createRoom(code: string, players: ConfiguredPlayer[], target?: number): MBRoom {
    const t = target === 700 ? 700 : DEFAULT_TARGET;
    const drawPile = buildDeck();
    const mbPlayers = players.map(p => createPlayer(p, drawPile));
    rooms[code] = {
        code,
        players: mbPlayers,
        currentPlayerIndex: Math.floor(Math.random() * mbPlayers.length),
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
    };
    return rooms[code];
}
