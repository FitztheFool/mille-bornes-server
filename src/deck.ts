import { randomUUID } from 'crypto';
import { Card, HazardType, RemedyType, SafetyType, Km } from './types';

// Standard Mille Bornes deck composition (≈106 cards).
const DISTANCE_COUNTS: Record<Km, number> = { 25: 10, 50: 10, 75: 10, 100: 12, 200: 4 };
const HAZARD_COUNTS: Record<HazardType, number> = {
    stop: 5, speedLimit: 4, accident: 3, outOfGas: 3, flatTire: 3,
};
const REMEDY_COUNTS: Record<RemedyType, number> = {
    go: 14, endLimit: 6, repairs: 3, gas: 3, spareTire: 3,
};
const SAFETIES: SafetyType[] = ['rightOfWay', 'drivingAce', 'fuelTank', 'punctureProof'];

export function buildDeck(): Card[] {
    const deck: Card[] = [];
    const add = (c: Omit<Card, 'id'>) => deck.push({ id: randomUUID(), ...c });

    (Object.keys(DISTANCE_COUNTS) as unknown as Km[]).forEach(km => {
        const n = DISTANCE_COUNTS[km];
        for (let i = 0; i < n; i++) add({ kind: 'distance', km: Number(km) as Km });
    });
    (Object.keys(HAZARD_COUNTS) as HazardType[]).forEach(h => {
        for (let i = 0; i < HAZARD_COUNTS[h]; i++) add({ kind: 'hazard', hazard: h });
    });
    (Object.keys(REMEDY_COUNTS) as RemedyType[]).forEach(r => {
        for (let i = 0; i < REMEDY_COUNTS[r]; i++) add({ kind: 'remedy', remedy: r });
    });
    SAFETIES.forEach(s => add({ kind: 'safety', safety: s }));

    return shuffle(deck);
}

export function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
