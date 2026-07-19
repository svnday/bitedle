import crypto from "node:crypto";
import { boardSecret, mulberry32 } from "./game";
import { getStore } from "./store";
import { nextResetAt } from "./time";
import {
  MEGA_BOARD_COLS,
  MEGA_BOARD_SIZE,
  MEGA_BOMB_COUNT,
  type MegaCellResult,
  type MegaGameState,
} from "./types";

export function megaAllBombsFlagged(flags: number[], layout: MegaCellResult[]): boolean {
  return flags.length === MEGA_BOMB_COUNT && flags.every((index) => layout[index] === "bomb");
}

interface MegaDraw {
  checkIndex: number;
  bombIndices: number[];
}

function megaBoardDraw(date: string, boardSeed: string | null = null): MegaDraw {
  const digest = crypto
    .createHash("sha256")
    .update(`${boardSecret()}:mega:${boardSeed === null ? date : `${date}:${boardSeed}`}`)
    .digest();
  const rng = mulberry32(digest.readUInt32LE(0));
  const indices = Array.from({ length: MEGA_BOARD_SIZE }, (_, index) => index);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    checkIndex: indices[0],
    bombIndices: indices.slice(1, MEGA_BOMB_COUNT + 1),
  };
}

const finalMegaDrawMemo = new Map<string, MegaDraw>();

/**
 * V1 uses the raw deterministic draw. Future anti-repeat behavior belongs
 * here behind a cutoff such as MEGA_CHECK_MOVE_FROM so played boards never
 * change retroactively.
 */
function finalMegaDrawFor(date: string, boardSeed: string | null = null): MegaDraw {
  const key = `${date}:${boardSeed ?? "daily"}`;
  const cached = finalMegaDrawMemo.get(key);
  if (cached) return cached;
  const draw = megaBoardDraw(date, boardSeed);
  finalMegaDrawMemo.set(key, draw);
  return draw;
}

export function megaLayoutFor(date: string, boardSeed: string | null = null): MegaCellResult[] {
  const { checkIndex, bombIndices } = finalMegaDrawFor(date, boardSeed);
  const bombs = new Set(bombIndices);
  const occupied = new Set([checkIndex, ...bombIndices]);
  const cells: MegaCellResult[] = Array(MEGA_BOARD_SIZE).fill(0);
  cells[checkIndex] = "check";
  for (const bomb of bombs) cells[bomb] = "bomb";

  const rows = MEGA_BOARD_SIZE / MEGA_BOARD_COLS;
  for (let index = 0; index < MEGA_BOARD_SIZE; index++) {
    if (occupied.has(index)) continue;
    const row = Math.floor(index / MEGA_BOARD_COLS);
    const col = index % MEGA_BOARD_COLS;
    let adjacentBombs = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= rows || c < 0 || c >= MEGA_BOARD_COLS) continue;
        if (bombs.has(r * MEGA_BOARD_COLS + c)) adjacentBombs++;
      }
    }
    cells[index] = adjacentBombs;
  }
  return cells;
}

export async function megaStateFor(
  userId: string,
  date: string,
  timeZone?: string,
): Promise<MegaGameState> {
  const store = getStore();
  const [game, user] = await Promise.all([
    store.getMegaGame(date, userId),
    store.getUser(userId),
  ]);
  const status = game?.status ?? "playing";
  const state: MegaGameState = {
    date,
    username: user?.name ?? "Player",
    named: user?.named ?? false,
    status,
    score: game?.score ?? null,
    clicks: game?.clicks ?? [],
    flags: game?.flags ?? [],
    nextResetAt: nextResetAt(new Date(), timeZone),
  };
  if (status !== "playing") state.layout = megaLayoutFor(date, game?.boardSeed ?? null);
  return state;
}
