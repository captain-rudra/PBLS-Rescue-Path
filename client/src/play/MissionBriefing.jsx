import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { getLevels } from "../lib/api.js";
import { MuteToggle } from "../components/MuteToggle.jsx";
import { useMute } from "../hooks/useMute.js";

const FORMAT_LABELS = {
  mcq: "Multiple choice",
  video_mcq: "Video + multiple choice",
  animation_mcq: "Animated scenario",
  drag_drop: "Drag and drop",
  sequence: "Put in order",
  split_screen: "Compare two clips",
  hotspot_video: "Spot it in the video"
};

// A level document has no authored narrative line yet (see docs/SPEC.md
// §13, "content still to be written"). Rather than invent clinical framing
// that would need faculty review, this synthesizes a short scene-setting
// sentence purely from the role/scene fields that already exist.
const scenarioLineFor = level => `As the ${level.role}, you're needed at ${level.scene.replace(/^The /, "the ")}.`;

// Determines which attempt kind "Begin rescue" should start, per the
// server's rules in server/src/routes/play/attempts.js (SPEC 2.3): below
// the pass mark restarts the WHOLE level (kind "first", the full question
// set again); at-or-above the pass mark but short of 100% owes another
// remediation round over just what's still missed. If an in_progress
// attempt already exists, POST /play/attempts is idempotent and hands it
// back regardless of which kind is requested here.
const kindFor = state => (state === "remediating" ? "remediation" : "first");

export const MissionBriefing = () => {
  const { levelKey } = useParams();
  const navigate = useNavigate();
  const [muted, toggleMuted] = useMute();
  const [levels, setLevels] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getLevels()
      .then(response => setLevels(response.levels))
      .catch(err => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center text-[#16243D]">
        <p className="text-sm text-[#FF6B5B]">{error}</p>
        <Link to="/" className="mt-3 inline-block text-xs underline">Back to the path</Link>
      </div>
    );
  }
  if (!levels) return <p className="px-4 py-10 text-center text-sm text-slate-500">Loading briefing…</p>;

  const index = levels.findIndex(l => l.key === levelKey);
  const level = levels[index];
  if (!level) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center text-[#16243D]">
        <p className="text-sm text-[#FF6B5B]">No such level.</p>
        <Link to="/" className="mt-3 inline-block text-xs underline">Back to the path</Link>
      </div>
    );
  }

  const previousLevel = index > 0 ? levels[index - 1] : null;
  const locked = level.state === "locked";
  const complete = level.state === "complete";

  return (
    <div className="min-h-screen bg-[#FFF7ED] text-[#16243D]">
      <header className="flex items-center justify-between border-b border-[#3A4A63]/20 px-4 py-3">
        <Link to="/" className="text-xs underline">← The rescue path</Link>
        <MuteToggle muted={muted} onToggle={toggleMuted} />
      </header>

      <div className="mx-auto max-w-lg px-4 py-8">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">{level.scene}</p>
        <h1 className="mt-1 text-2xl font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
          {level.title}
        </h1>
        <p className="mt-2 text-[13px] italic text-slate-500">{scenarioLineFor(level)}</p>

        {locked && (
          <div className="mt-6 rounded-md border border-[#3A4A63] bg-white/60 px-4 py-3 text-sm">
            <p className="text-[#16243D]">🔒 This level isn't open yet.</p>
            <p className="mt-1 text-[12px] text-slate-500">
              {previousLevel ? `Master "${previousLevel.title}" at 100% to unlock it.` : "It will unlock as you progress."}
            </p>
          </div>
        )}

        {complete && (
          <div className="mt-6 rounded-md border border-[#34D399]/40 bg-[#34D399]/10 px-4 py-3 text-sm">
            <p className="text-[#16243D]">✓ Mastered at 100%.</p>
            <p className="mt-1 text-[12px] text-slate-500">
              First-attempt score: {level.headline?.accuracy}% ({level.starsAwarded} star{level.starsAwarded === 1 ? "" : "s"}) · restarts: {level.restartCount} · remediation rounds: {level.remediationCount}
            </p>
            {level.headline?.attemptId && (
              <button
                type="button"
                data-testid="briefing-review"
                onClick={() => navigate(`/review/${level.headline.attemptId}`)}
                className="mt-3 w-full rounded-md border border-[#3A4A63]/40 bg-white/60 px-4 py-2.5 text-[13px] font-semibold text-[#16243D] transition hover:bg-white"
              >
                Review answers
              </button>
            )}
          </div>
        )}

        {!locked && !complete && (
          <>
            <section className="mt-6">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Objectives</h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {level.objectives.map(objective => (
                  <li key={objective} className="flex items-start gap-2 text-[13px]">
                    <span className="mt-0.5 text-[#34D399]" aria-hidden="true">•</span>
                    {objective}
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-6 grid grid-cols-2 gap-3 rounded-md border border-[#3A4A63]/30 bg-white/60 p-4 text-[12px]">
              <div>
                <p className="text-slate-500">Questions</p>
                <p className="font-semibold">{level.questionCount}</p>
              </div>
              <div>
                <p className="text-slate-500">Pass mark</p>
                <p className="font-semibold">{level.passMark}%</p>
              </div>
              <div>
                <p className="text-slate-500">Badge on mastery</p>
                <p className="font-semibold">{level.badge}</p>
              </div>
              <div>
                <p className="text-slate-500">Formats</p>
                <p className="font-semibold">{level.formats.map(f => FORMAT_LABELS[f] || f).join(", ") || "—"}</p>
              </div>
            </section>

            {level.state === "failed" && (
              <p className="mt-4 text-[12px] text-[#FF6B5B]">
                Below the pass mark last time — this round restarts the whole level from question 1.
              </p>
            )}
            {level.state === "remediating" && (
              <p className="mt-4 text-[12px] text-[#FFC94A]">
                Cleared the pass mark last time, but not yet at 100% — this round covers only what's still missed.
              </p>
            )}

            <button
              type="button"
              data-testid="begin-rescue"
              onClick={() => navigate(`/play/${level.key}?kind=${kindFor(level.state)}`)}
              className="mt-6 w-full rounded-md bg-[#34D399] px-4 py-3 text-sm font-semibold text-[#16243D] transition hover:brightness-95"
            >
              Begin rescue
            </button>

            {level.headline?.attemptId && (
              <button
                type="button"
                data-testid="briefing-review"
                onClick={() => navigate(`/review/${level.headline.attemptId}`)}
                className="mt-2 w-full rounded-md border border-[#3A4A63]/40 bg-white/60 px-4 py-2.5 text-[13px] font-semibold text-[#16243D] transition hover:bg-white"
              >
                Review answers
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
