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
- No sign-in: just type a display name (or skip it and play as `Player-xxxx`
  — you can rename anytime from the header chip). Stats (win %, streaks,
  score distribution) and the daily/all-time leaderboards follow you via an
  anonymous browser cookie.

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
- The daily board is derived from a **server secret + the date**
  ([src/lib/game.ts](src/lib/game.ts)), and the API only reveals the cells you
  have clicked — so the layout can't be peeked at from the client.
- Users, games, and the secret persist in a JSON file at `data/db.json`
  ([src/lib/db.ts](src/lib/db.ts)). Delete the file to reset everything.
  Because storage is on the local filesystem, deploy it somewhere with a
  persistent disk (a VPS, Railway, Fly.io…) — serverless platforms would lose
  the file between invocations.
- API routes ([src/app/api/](src/app/api/)): `state`, `click`, `name`,
  `stats`, `leaderboard`. Identity is an anonymous id in an httpOnly cookie,
  auto-created on first visit ([src/lib/identity.ts](src/lib/identity.ts));
  the display name is just a label, so duplicates are allowed and the
  leaderboard marks your own rows server-side. Clearing cookies (or switching
  browsers) starts a fresh player — streaks don't follow you across devices.
