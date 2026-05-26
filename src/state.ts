import type { Server } from 'socket.io';
import { MBRoom } from './types';
import { canRoll, isSpeedLimited } from './game';

export function buildStateFor(room: MBRoom, viewerId: string | null) {
    const current = room.players[room.currentPlayerIndex];

    const players = room.players.map(p => ({
        userId: p.userId,
        username: p.username,
        distance: p.distance,
        battleTop: p.battleTop,
        speedLimited: isSpeedLimited(p),
        safeties: p.safeties,
        handCount: p.hand.length,
        canRoll: canRoll(p),
        alive: p.alive,
        finished: p.finished,
        exitReason: p.exitReason ?? null,
        team: p.team,
        coupsFourres: p.coupsFourres,
        // Only the viewer sees their own hand.
        ...(p.userId === viewerId ? { hand: p.hand } : {}),
    }));

    // Coup fourré window only surfaced to the concerned player.
    const coupFourre = room.coupFourre && room.coupFourre.userId === viewerId
        ? room.coupFourre
        : null;

    return {
        code: room.code,
        phase: room.phase,
        target: room.target,
        currentPlayerIndex: room.currentPlayerIndex,
        currentUserId: current?.userId ?? null,
        drawCount: room.drawPile.length,
        lastDiscard: room.lastDiscard,
        coupFourre,
        turnStartedAt: room.turnStartedAt,
        turnDuration: room.turnDuration,
        winnerUserId: room.winnerUserId,
        teamMode: room.teamMode,
        teamDistance: room.teamDistance,
        winningTeam: room.winningTeam,
        log: room.log.slice(-10),
        players,
        spectator: viewerId ? !room.players.some(p => p.userId === viewerId) : true,
    };
}

export function emitState(io: Server, room: MBRoom): void {
    const sockets = io.sockets.adapter.rooms.get(room.code);
    if (!sockets) return;
    for (const sid of sockets) {
        const s = io.sockets.sockets.get(sid);
        if (!s) continue;
        const viewerId = (s.data?.userId as string | undefined) ?? null;
        s.emit('mb:state', buildStateFor(room, viewerId));
    }
}
