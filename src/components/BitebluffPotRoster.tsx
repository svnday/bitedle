import type { BitebluffPotParticipant } from "@/lib/bitebluff-types";

export default function BitebluffPotRoster({
  participants,
}: {
  participants: BitebluffPotParticipant[];
}) {
  return (
    <aside className="bitebluff-pot-roster" aria-label="Current Bitebluff wagers">
      <div className="bitebluff-pot-roster-heading">
        <div>
          <span>In the pot</span>
          <h2>Locked wagers</h2>
        </div>
        <b>{participants.length}</b>
      </div>
      <div className="bitebluff-pot-roster-list">
        {participants.map((participant) => (
          <div
            key={participant.userId}
            className={participant.me ? "bitebluff-pot-player-me" : ""}
          >
            {participant.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={participant.avatarUrl} alt="" />
            ) : (
              <span className="bitebluff-player-fallback" aria-hidden="true">
                {participant.displayName.charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <strong>{participant.me ? "You" : participant.displayName}</strong>
              <small>Hand sealed</small>
            </div>
            <b>{participant.wager.toLocaleString()} B</b>
          </div>
        ))}
      </div>
      <p>
        Burn &amp; Draw fees increase the sealed pool but stay anonymous until
        the reveal.
      </p>
    </aside>
  );
}
