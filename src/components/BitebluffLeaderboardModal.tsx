import type { BitebluffLeaderboard } from "@/lib/bitebluff-types";

export default function BitebluffLeaderboardModal({
  leaderboard,
  loading,
  error,
  onClose,
}: {
  leaderboard: BitebluffLeaderboard | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <div
      className="bitebluff-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="bitebluff-leaderboard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bitebluff-leaderboard-title"
      >
        <div className="bitebluff-leaderboard-modal-heading">
          <div>
            <span>Overall leaderboard</span>
            <h2 id="bitebluff-leaderboard-title">
              {leaderboard?.title ?? "Active bankroll"}
            </h2>
            <small>
              {leaderboard?.activeWindowDays ?? 7}-day activity window
            </small>
          </div>
          <button type="button" onClick={onClose} aria-label="Close leaderboard">
            ×
          </button>
        </div>

        <div className="bitebluff-leaderboard-scroll">
          {loading ? (
            <p className="bitebluff-modal-status">Loading bankrolls…</p>
          ) : error ? (
            <p className="bitebluff-error">{error}</p>
          ) : leaderboard?.entries.length ? (
            leaderboard.entries.map((entry) => (
              <div
                key={entry.userId}
                className={`bitebluff-leaderboard-row ${
                  entry.active ? "" : "bitebluff-inactive"
                } ${entry.me ? "bitebluff-leaderboard-me" : ""}`}
              >
                <b className="bitebluff-leaderboard-rank">
                  {entry.rank ?? "—"}
                </b>
                {entry.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={entry.avatarUrl} alt="" />
                ) : (
                  <span className="bitebluff-player-fallback" aria-hidden="true">
                    {entry.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <div>
                  <strong>{entry.me ? "You" : entry.displayName}</strong>
                  <small>{entry.active ? "Ranked" : "Inactive · unranked"}</small>
                </div>
                <b>{entry.bankroll.toLocaleString()} Bites</b>
              </div>
            ))
          ) : (
            <p className="bitebluff-modal-status">
              No Bitebluff bankrolls have been created yet.
            </p>
          )}
        </div>

        <p className="bitebluff-leaderboard-note">
          Rankings update from settled rounds. Bankrolls remain owned during
          inactivity, but players must settle an entry within seven days to be
          ranked.
        </p>
      </section>
    </div>
  );
}
