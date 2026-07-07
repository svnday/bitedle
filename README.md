# Bitedle 💣✓

A daily game of nerve, Wordle-style. Somewhere on a 5×5 board hides **one green
check mark** — find it in as few clicks as you can. But 3 to 5 **bombs** are
hiding too, and one wrong click ends your day.

## Rules

- Click a tile to reveal it:
  - **✗ (red X)** — a safe miss, keep going.
  - **💣 (bomb)** — game over, counts as a loss.
  - **✓ (check mark)** — you win!
- Your score is the number of clicks it took to find the check. Lower is
  better; 1 is perfection.
- There is exactly **one** check mark and **3–5 bombs** (the exact count is
  hidden) — every other tile is a miss.
- A new board is generated every day at midnight. Everyone plays the **same
  board**, and each player gets **one game per day**.
- No sign-in: play immediately, and after your first game pick a display
  name for the leaderboard (rename anytime from the header chip). Skipping
  the name keeps your results **off the leaderboards** until you pick one —
  personal stats still work. Everything follows you via an anonymous browser
  cookie.

## Running it

```bash
npm install
npm run dev        # development, http://localhost:3000
```

or for production:

```bash
npm run build
npm start
```

## How it works

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4.**
- The daily board is derived from a **secret + the date**
  ([src/lib/game.ts](src/lib/game.ts)), and the API only reveals the cells you
  have clicked — so the layout can't be peeked at from the client. The secret
  comes from the `BITEDLE_SECRET` env var (a fixed dev value is used locally).
- The day flips at **midnight in `BITEDLE_TZ`** (default `America/New_York`)
  for everyone, regardless of where the player or server is
  ([src/lib/time.ts](src/lib/time.ts)); the API tells the client exactly when
  the next board drops.
- Storage is behind a small interface ([src/lib/store.ts](src/lib/store.ts)):
  **Neon/Postgres** when `DATABASE_URL` is set (tables are auto-created on
  first request), otherwise a local JSON file at `data/db.json` for
  zero-setup development.
- API routes ([src/app/api/](src/app/api/)): `state`, `click`, `name`,
  `stats`, `leaderboard`. Identity is an anonymous id in an httpOnly cookie,
  auto-created on first visit ([src/lib/identity.ts](src/lib/identity.ts));
  the display name is just a label, so duplicates are allowed and the
  leaderboard marks your own rows server-side. Clearing cookies (or switching
  browsers) starts a fresh player — streaks don't follow you across devices.

