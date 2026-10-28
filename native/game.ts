// Typed facade over the browser build's pure modules (src/rules.js,
// src/storage.js, src/i18n.js), which the engine client imports unchanged and
// the Node tests and tools/generate-levels.mjs share.
import * as rulesJs from "../src/rules.js";
import * as storageJs from "../src/storage.js";
import * as i18nJs from "../src/i18n.js";

export type Dir = "U" | "D" | "L" | "R";
export interface Level { id: string; world: string; w: number; h: number; rows: string[]; start: [number, number]; par: number; solution: string }
export interface Board { w: number; h: number; floor: Int16Array; cells: number[]; start: number }
export interface State { pos: number; painted: Uint8Array; remaining: number; moves: number }
export interface RollResult { state: State; path: number[]; newly: number[] }
export interface Profile {
  v: 2;
  progress: Record<string, { best: number; stars: number }>;
  current: null | { id: string; dirs: string };
  tutorialSeen: Record<string, unknown>;
}

export const rules = rulesJs as unknown as {
  DIRS: Record<Dir, [number, number]>;
  DIR_KEYS: Dir[];
  parseLevel(level: Level): Board;
  createState(board: Board): State;
  rollPath(board: Board, pos: number, dir: Dir): number[];
  legalDirs(board: Board, state: State): Dir[];
  roll(board: Board, state: State, dir: Dir): RollResult | null;
  isComplete(state: State): boolean;
  starsFor(moves: number, par: number): number;
  solve(board: Board, state: State, cap?: number): string | null;
};

export const storage = storageJs as unknown as {
  emptyProfile(): Profile;
  recordResult(profile: Profile, id: string, moves: number, stars: number): boolean;
  cloudDoc(profile: Profile): Profile;
  readDoc(doc: unknown): Profile;
  readForeign(text: string | null): Profile | null;
  mergeDocs(local: unknown, remote: unknown): Profile;
  sameDoc(a: unknown, b: unknown): boolean;
};

export const i18n = i18nJs as unknown as {
  LOCALES: string[];
  matchLocale(tag: string): string;
  setLocale(loc: string): void;
  getLocale(): string;
  t(key: string, vars?: Record<string, string | number>): string;
};
