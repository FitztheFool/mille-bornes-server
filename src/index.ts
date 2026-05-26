import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { setupSocketAuth, corsConfig, connectToLobby } from '@kwizar/shared';

import {
    drawCard, validatePlay, applyPlay, discardCard, findPlayer, findPlayerIndex,
    coupFourreCard, applyCoupFourre, nextAliveIndex, aliveCount, hasHumanAlive,
    computeScores, pushLog, HAZARD_LABEL, REMEDY_LABEL, SAFETY_LABEL,
    HAND_SIZE, DEFAULT_TARGET,
} from './game';
import { Card, HazardType } from './types';
import { rooms, createRoom } from './rooms';
import { startTimer, clearTimer, timerCallbacks, TURN_DURATION } from './timer';
import { decideBotAction, isBot } from './bot';
import { saveMilleBornesResults } from './api';
import { emitState } from './state';

dotenv.config();

const app = express();
app.get('/health', (_req, res) => { res.set('Access-Control-Allow-Origin', '*'); res.status(200).send('ok'); });
const server = http.createServer(app);
const io = new Server(server, { cors: corsConfig, maxHttpBufferSize: 1e5 });
setupSocketAuth(io, new TextEncoder().encode((process.env.SOCKET_USER_SECRET ?? process.env.INTERNAL_API_KEY)!));
const lobbySocket = connectToLobby('mille-bornes-server', 'mille_bornes');

// Track abandons/AFK per room for final scoring.
const surrendered: Record<string, Set<string>> = {};
const afk: Record<string, Set<string>> = {};
const mark = (rec: Record<string, Set<string>>, code: string, id: string) => { (rec[code] ??= new Set()).add(id); };

// ── Configure from lobby ──────────────────────────────────────────────────────

lobbySocket.on('mille_bornes:configure', ({ lobbyId: code, players, options }: {
    lobbyId: string; players: any[]; options?: { target?: number };
}, ack?: () => void) => {
    const room = createRoom(code, players, options?.target ?? DEFAULT_TARGET);
    surrendered[code] = new Set();
    afk[code] = new Set();
    console.log(`[MilleBornes] Room ${code} (${players.length}j, cible ${room.target})`);
    emitState(io, room);
    startTimer(io, code);
    setTimeout(() => beginTurn(code, false), 1000);
    if (typeof ack === 'function') ack();
});

// ── Turn flow ──────────────────────────────────────────────────────────────────

/** Start the current player's turn: draw a card, then let them act (bot auto-plays). */
function beginTurn(code: string, alreadyDrew: boolean): void {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    const p = room.players[room.currentPlayerIndex];
    if (!p?.alive || p.finished) { advanceTurn(code); return; }

    if (!alreadyDrew && p.hand.length < HAND_SIZE + 1) {
        const c = drawCard(room);
        if (c) p.hand.push(c);
    }
    // Dead end: no card to draw and empty hand → end by score.
    if (p.hand.length === 0 && room.drawPile.length === 0) { finishGame(code); return; }

    emitState(io, room);
    startTimer(io, code);
    if (isBot(p.userId)) setTimeout(() => doBotTurn(code), 1100);
}

function advanceTurn(code: string): void {
    const room = rooms[code];
    if (!room || room.phase !== 'playing') return;
    if (aliveCount(room) <= 1 || !hasHumanAlive(room)) { finishGame(code); return; }
    room.currentPlayerIndex = nextAliveIndex(room, room.currentPlayerIndex);
    beginTurn(code, false);
}

function doBotTurn(code: string): void {
    const room = rooms[code];
    if (!room || room.phase !== 'playing' || room.coupFourre) return;
    const p = room.players[room.currentPlayerIndex];
    if (!p?.alive || !isBot(p.userId)) return;

    const decision = decideBotAction(room, p);
    const card = p.hand.find(c => c.id === decision.cardId);
    if (!card) { discardFallback(code, p.userId); return; }
    if (decision.type === 'discard') { doDiscard(code, p.userId, card.id); return; }
    doPlay(code, p.userId, card.id, decision.targetUserId);
}

function discardFallback(code: string, userId: string): void {
    const room = rooms[code];
    const p = room && findPlayer(room, userId);
    if (p && p.hand[0]) doDiscard(code, userId, p.hand[0].id);
}

/** Describe a (just-applied) play in the action feed. */
function logPlay(room: typeof rooms[string], player: any, card: Card, target?: any): void {
    switch (card.kind) {
        case 'distance':
            pushLog(room, 'move', `${player.username} roule ${card.km} km (${player.distance} km)`);
            break;
        case 'remedy':
            pushLog(room, 'defend', card.remedy === 'go'
                ? `${player.username} repart (feu vert)`
                : `${player.username} : ${REMEDY_LABEL[card.remedy!]}`);
            break;
        case 'safety':
            pushLog(room, 'safety', `${player.username} pose une botte : ${SAFETY_LABEL[card.safety!]}`);
            break;
        case 'hazard':
            pushLog(room, 'attack', `${player.username} attaque ${target?.username ?? '?'} : ${HAZARD_LABEL[card.hazard!]}`);
            break;
    }
}

// ── Actions ────────────────────────────────────────────────────────────────────

function doPlay(code: string, userId: string, cardId: string, targetUserId?: string): void {
    const room = rooms[code];
    if (!room || room.phase !== 'playing' || room.coupFourre) return;
    const idx = room.currentPlayerIndex;
    const player = room.players[idx];
    if (!player || player.userId !== userId) return;

    const card = player.hand.find(c => c.id === cardId);
    if (!card) return;
    const target = targetUserId ? findPlayer(room, targetUserId) : undefined;
    const v = validatePlay(room, player, card, target);
    if (!v.ok) { console.log(`[MilleBornes] invalid play ${userId}:`, card, v.reason); return; }

    room.afkStrikes[userId] = 0;
    const isSafety = card.kind === 'safety';
    const isHazard = card.kind === 'hazard';
    const { reachedTarget } = applyPlay(room, player, card, target);
    logPlay(room, player, card, target);

    if (reachedTarget) {
        room.winnerUserId = player.userId;
        pushLog(room, 'coup', `${player.username} atteint ${room.target} km — arrivée !`);
        finishGame(code);
        return;
    }

    // Hazard → maybe a coup fourré from the target.
    if (isHazard && target) {
        const cf = coupFourreCard(target, card.hazard!);
        if (cf) {
            if (isBot(target.userId)) {
                applyCoupFourre(room, target, cf, card.hazard!);
                pushLog(room, 'coup', `${target.username} — COUP FOURRÉ ! (${SAFETY_LABEL[cf.safety!]})`);
                io.to(code).emit('mb:coupFourre', { userId: target.userId, hazard: card.hazard });
                clearTimer(code);
                room.currentPlayerIndex = findPlayerIndex(room, target.userId);
                beginTurn(code, false);
                return;
            }
            // Human: open a response window; pause until they accept/decline/timeout.
            clearTimer(code);
            room.coupFourre = {
                userId: target.userId, safety: cf.safety!, hazard: card.hazard! as HazardType,
                fromUserId: player.userId, deadline: Date.now() + 12_000,
            };
            emitState(io, room);
            io.to(code).emit('mb:coupFourreOffer', { userId: target.userId, hazard: card.hazard });
            setTimeout(() => resolveCoupFourreTimeout(code, target.userId), 12_500);
            return;
        }
    }

    // Safety grants an extra turn (re-draw + play again).
    if (isSafety) { clearTimer(code); beginTurn(code, false); return; }

    clearTimer(code);
    advanceTurn(code);
}

function doDiscard(code: string, userId: string, cardId: string): void {
    const room = rooms[code];
    if (!room || room.phase !== 'playing' || room.coupFourre) return;
    const player = room.players[room.currentPlayerIndex];
    if (!player || player.userId !== userId) return;
    const card = player.hand.find(c => c.id === cardId);
    if (!card) return;
    room.afkStrikes[userId] = 0;
    discardCard(room, player, card);
    pushLog(room, 'system', `${player.username} défausse`);
    clearTimer(code);
    advanceTurn(code);
}

function resolveCoupFourreTimeout(code: string, userId: string): void {
    const room = rooms[code];
    if (!room || !room.coupFourre || room.coupFourre.userId !== userId) return;
    // Declined by timeout: hazard stays, advance from the attacker.
    room.coupFourre = null;
    advanceTurn(code);
}

// ── End game ────────────────────────────────────────────────────────────────────

function finishGame(code: string): void {
    const room = rooms[code];
    if (!room) return;
    clearTimer(code);
    room.phase = 'ended';
    if (!room.winnerUserId) {
        // No exact finisher: highest distance among alive wins.
        const ranked = [...room.players].filter(p => p.alive).sort((a, b) => b.distance - a.distance);
        room.winnerUserId = ranked[0]?.userId ?? null;
    }
    const gameId = crypto.randomUUID();
    emitState(io, room);
    io.to(code).emit('mb:finished', {
        winnerUserId: room.winnerUserId,
        scores: computeScores(room),
        gameId,
    });
    saveMilleBornesResults(room, gameId, surrendered[code] ?? new Set(), afk[code] ?? new Set());
    delete rooms[code];
    delete surrendered[code];
    delete afk[code];
}

// ── Timer (AFK) ──────────────────────────────────────────────────────────────────

timerCallbacks.onTimeout = (code: string) => {
    const room = rooms[code];
    if (!room || room.phase !== 'playing' || room.coupFourre) return;
    const p = room.players[room.currentPlayerIndex];
    if (!p?.alive) return;
    if (isBot(p.userId)) { doBotTurn(code); return; }

    // Kick the AFK human.
    mark(afk, code, p.userId);
    p.alive = false;
    p.hand = [];
    pushLog(room, 'system', `${p.username} exclu (inactivité)`);
    io.to(code).emit('mb:playerKicked', { userId: p.userId, username: p.username, reason: 'inactivity' });
    if (aliveCount(room) <= 1 || !hasHumanAlive(room)) { finishGame(code); return; }
    advanceTurn(code);
};

// ── Socket events ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
    socket.on('mb:join', ({ lobbyId: code }: { lobbyId: string }) => {
        const userId = socket.data?.userId as string;
        const room = rooms[code];
        if (!room) { socket.emit('notFound'); return; }
        if (!userId || !room.players.some(p => p.userId === userId)) { socket.emit('mb:accessDenied'); return; }
        socket.data.lobbyId = code;
        socket.join(code);
        room.socketIds.set(userId, socket.id);
        const t = room.disconnectTimers.get(userId);
        if (t) { clearTimeout(t); room.disconnectTimers.delete(userId); }
        emitState(io, room);
    });

    socket.on('mb:playCard', ({ lobbyId: code, cardId, targetUserId }: { lobbyId: string; cardId: string; targetUserId?: string }) => {
        const userId = socket.data?.userId as string;
        if (userId && code && cardId) doPlay(code, userId, cardId, targetUserId);
    });

    socket.on('mb:discard', ({ lobbyId: code, cardId }: { lobbyId: string; cardId: string }) => {
        const userId = socket.data?.userId as string;
        if (userId && code && cardId) doDiscard(code, userId, cardId);
    });

    socket.on('mb:coupFourre', ({ lobbyId: code, cardId }: { lobbyId: string; cardId?: string }) => {
        const userId = socket.data?.userId as string;
        const room = rooms[code];
        if (!room || !room.coupFourre || room.coupFourre.userId !== userId) return;
        const player = findPlayer(room, userId);
        if (!player) return;
        const card = cardId ? player.hand.find(c => c.id === cardId) : coupFourreCard(player, room.coupFourre.hazard);
        if (!card || card.kind !== 'safety' || card.safety !== room.coupFourre.safety) return;
        applyCoupFourre(room, player, card, room.coupFourre.hazard);
        pushLog(room, 'coup', `${player.username} — COUP FOURRÉ ! (${SAFETY_LABEL[room.coupFourre.safety]})`);
        io.to(code).emit('mb:coupFourre', { userId, hazard: room.coupFourre.hazard });
        room.coupFourre = null;
        room.currentPlayerIndex = findPlayerIndex(room, userId);
        beginTurn(code, false);
    });

    socket.on('mb:declineCoupFourre', ({ lobbyId: code }: { lobbyId: string }) => {
        const userId = socket.data?.userId as string;
        const room = rooms[code];
        if (!room || !room.coupFourre || room.coupFourre.userId !== userId) return;
        room.coupFourre = null;
        advanceTurn(code);
    });

    socket.on('mb:surrender', ({ lobbyId: code }: { lobbyId: string }) => {
        const userId = socket.data?.userId as string;
        const room = rooms[code];
        if (!room || room.phase !== 'playing' || !userId) return;
        const p = findPlayer(room, userId);
        if (!p?.alive) return;
        const wasCurrent = room.players[room.currentPlayerIndex]?.userId === userId;
        mark(surrendered, code, userId);
        p.alive = false;
        p.hand = [];
        pushLog(room, 'system', `${p.username} abandonne`);
        io.to(code).emit('mb:playerSurrendered', { userId, username: p.username });
        if (room.coupFourre?.userId === userId) room.coupFourre = null;
        if (aliveCount(room) <= 1 || !hasHumanAlive(room)) { finishGame(code); return; }
        if (wasCurrent) { clearTimer(code); advanceTurn(code); }
        else emitState(io, room);
    });

    socket.on('disconnect', () => {
        const userId = socket.data?.userId as string;
        const code = socket.data?.lobbyId as string;
        if (!userId || !code) return;
        const room = rooms[code];
        if (!room || room.phase === 'ended') return;
        const p = findPlayer(room, userId);
        if (!p?.alive) return;
        room.socketIds.delete(userId);
        io.to(code).emit('mb:inactivityWarning', { userId, username: p.username, secondsLeft: 60 });
        room.disconnectTimers.set(userId, setTimeout(() => {
            const r = rooms[code];
            if (!r || r.phase === 'ended') return;
            const pl = findPlayer(r, userId);
            if (!pl?.alive) return;
            const wasCurrent = r.players[r.currentPlayerIndex]?.userId === userId;
            mark(afk, code, userId);
            pl.alive = false;
            pl.hand = [];
            pushLog(r, 'system', `${pl.username} déconnecté`);
            io.to(code).emit('mb:playerKicked', { userId, username: pl.username, reason: 'inactivity' });
            if (r.coupFourre?.userId === userId) r.coupFourre = null;
            if (aliveCount(r) <= 1 || !hasHumanAlive(r)) { finishGame(code); return; }
            if (wasCurrent) { clearTimer(code); advanceTurn(code); }
            else emitState(io, r);
        }, 60_000));
    });
});

// ── Startup ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 10014;
server.listen(PORT, () => console.log('[MILLE_BORNES] listening on', PORT));
const shutdown = () => { io.close(() => server.close(() => process.exit(0))); setTimeout(() => process.exit(1), 3000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

void TURN_DURATION;
