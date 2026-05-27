import type { GameLogEntry } from '@kwizar/shared';
export type { LogTone } from '@kwizar/shared';

// ── Card model ──────────────────────────────────────────────────────────────

export type HazardType = 'stop' | 'speedLimit' | 'accident' | 'outOfGas' | 'flatTire';
export type RemedyType = 'go' | 'endLimit' | 'repairs' | 'gas' | 'spareTire';
export type SafetyType = 'rightOfWay' | 'drivingAce' | 'fuelTank' | 'punctureProof';
export type Km = 25 | 50 | 75 | 100 | 200;

export type CardKind = 'distance' | 'hazard' | 'remedy' | 'safety';

export interface Card {
    id: string;            // unique instance id
    kind: CardKind;
    km?: Km;               // distance cards
    hazard?: HazardType;   // hazard cards
    remedy?: RemedyType;   // remedy cards
    safety?: SafetyType;   // safety cards (bottes)
}

// Hazard → remedy that clears it, and safety that grants immunity.
export const HAZARD_REMEDY: Record<HazardType, RemedyType> = {
    stop: 'go',
    speedLimit: 'endLimit',
    accident: 'repairs',
    outOfGas: 'gas',
    flatTire: 'spareTire',
};
export const HAZARD_SAFETY: Record<HazardType, SafetyType> = {
    stop: 'rightOfWay',
    speedLimit: 'rightOfWay',
    accident: 'drivingAce',
    outOfGas: 'fuelTank',
    flatTire: 'punctureProof',
};

// ── Player / room ─────────────────────────────────────────────────────────────

/** battleTop reflects the top of a player's battle pile (movement state). */
export type BattleTop = null | 'go' | 'stop' | 'accident' | 'outOfGas' | 'flatTire' | 'repairs' | 'gas' | 'spareTire';

export interface MBPlayer {
    userId: string;
    username: string;
    hand: Card[];
    distance: number;                 // km travelled
    distance200Count: number;         // max two 200-km cards
    battleTop: BattleTop;
    speedLimited: boolean;            // under a speed limit
    safeties: SafetyType[];           // bottes played (face up)
    coupsFourres: number;
    alive: boolean;                   // still in the running (not surrendered/kicked)
    finished: boolean;                // reached the target distance
    exitReason?: 'abandon' | 'afk' | null; // why the player left, if not alive
    team: 0 | 1 | null;               // 2v2 team, null in free-for-all
}

export type TeamMode = 'none' | '2v2';
export type TeamDistance = 'individual' | 'shared';

export type Phase = 'playing' | 'ended';

export interface CoupFourreWindow {
    userId: string;        // player who may respond
    safety: SafetyType;    // the safety they hold
    hazard: HazardType;    // the hazard played against them
    fromUserId: string;    // attacker
    deadline: number;
}

export interface MBRoom {
    code: string;
    players: MBPlayer[];
    currentPlayerIndex: number;
    phase: Phase;
    target: number;                   // 700 or 1000
    drawPile: Card[];
    discardPile: Card[];
    lastDiscard: Card | null;
    coupFourre: CoupFourreWindow | null;
    turnStartedAt: number | null;
    turnDuration: number;
    log: GameLogEntry[];
    logSeq: number;
    afkStrikes: Record<string, number>;
    socketIds: Map<string, string>;
    disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
    winnerUserId: string | null;
    teamMode: TeamMode;
    teamDistance: TeamDistance;       // how the target is reached in 2v2
    winningTeam: 0 | 1 | null;        // set at game end in 2v2
}

export interface ConfiguredPlayer {
    userId?: string;
    id?: string;
    username?: string;
    name?: string;
}

export interface MBOptions {
    target: number; // 700 | 1000
    teamMode?: TeamMode;
    teamDistance?: TeamDistance;
}
