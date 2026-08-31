import { motion } from "framer-motion";
import { Badge } from "../components/Badge.jsx";
import { LEVEL_BADGE_META, ACHIEVEMENT_BADGE_META } from "./badges.jsx";

const formatDuration = ms => {
  const totalSeconds = Math.round((ms ?? 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const MetricTile = ({ label, value }) => (
  <div className="rounded-md border border-[#3A4A63]/20 bg-white/60 px-3 py-2 text-center">
    <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-0.5 text-base font-semibold text-[#16243D]">{value}</p>
  </div>
);

const ObjectiveRow = ({ objective, applicable, met }) => {
  const icon = !applicable ? "–" : met ? "✓" : "✕";
  const color = !applicable ? "#94a3b8" : met ? "#34D399" : "#FF6B5B";
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <span className="mt-0.5 font-bold" style={{ color }} aria-hidden="true">{icon}</span>
      <span className={applicable ? "text-[#16243D]" : "text-slate-400"}>{objective}</span>
    </li>
  );
};

// SPEC 2.6 result card: stars, four metric tiles, the objectives list
// marked against performance, missed items, and a continue action. Only
// ever reached on a MASTERED submit (the level is complete). Everything
// performance-related here — accuracy, stars, objectives, missed items —
// is the level's FROZEN first attempt (SPEC 2.3), not this final round
// (which, being mastered, is trivially 100% correct and would show
// nothing useful). `activeMs`/`bestStreak` are the only exceptions: those
// describe this specific round, since "time on this playthrough" and
// "best streak reached" are about what just happened, not the record.
// SPEC 2.6: the badge is revealed on the result card at the moment it is
// earned. The level badge lands on every mastered submit that has one —
// the prelevel has no badge (null), so `levelBadgeMeta` is undefined there
// and the block simply doesn't render, leaving no empty slot. A newly
// earned global achievement (BLS Expert) reveals just below it.
const BadgeReveal = ({ levelKey, levelBadge, newAchievements = [] }) => {
  const levelBadgeMeta = levelBadge ? LEVEL_BADGE_META[levelKey] : null;
  const achievements = newAchievements.filter(a => ACHIEVEMENT_BADGE_META[a.key]);
  if (!levelBadgeMeta && achievements.length === 0) return null;

  return (
    <section className="mt-6 flex flex-col items-center gap-4" data-testid="result-badges">
      {levelBadgeMeta && (
        <div className="flex flex-col items-center gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#FFC94A]">Badge earned</p>
          <Badge badgeKey={levelBadgeMeta.key} name={levelBadge} accent={levelBadgeMeta.accent} Icon={levelBadgeMeta.Icon} earned reveal size={116} />
        </div>
      )}
      {achievements.map(achievement => {
        const meta = ACHIEVEMENT_BADGE_META[achievement.key];
        return (
          <div key={achievement.key} className="flex flex-col items-center gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#FFC94A]">Achievement unlocked</p>
            <Badge badgeKey={meta.key} name={achievement.name} accent={meta.accent} Icon={meta.Icon} earned reveal size={116} subtitle={achievement.description} />
          </div>
        );
      })}
    </section>
  );
};

export const ResultCard = ({ result, levelTitle, levelKey, levelBadge, bestStreak, onContinue }) => {
  const { attempt, headline, restartCount, remediationCount, unlockedNextLevelKey, newAchievements } = result;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="min-h-screen bg-[#FFF7ED] px-4 py-8 text-[#16243D]"
    >
      <div className="mx-auto max-w-lg">
        <p className="text-center text-[11px] uppercase tracking-wide text-slate-500">{levelTitle}</p>
        <h1 className="mt-1 text-center text-xl font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
          Patient stabilised
        </h1>
        <p className="mt-1 text-center text-[11px] text-slate-400">Mastered at 100% — figures below are your first attempt</p>

        <div className="mt-3 flex justify-center gap-1" aria-label={`${headline.starsAwarded} of 3 stars`}>
          {[1, 2, 3].map(n => (
            <span key={n} className="text-3xl" style={{ color: n <= headline.starsAwarded ? "#FFC94A" : "#3A4A63" }}>★</span>
          ))}
        </div>

        <BadgeReveal levelKey={levelKey} levelBadge={levelBadge} newAchievements={newAchievements} />

        <div className="mt-6 grid grid-cols-4 gap-2">
          <MetricTile label="First-attempt accuracy" value={`${headline.accuracy}%`} />
          <MetricTile label="Time (this round)" value={formatDuration(attempt.activeMs)} />
          <MetricTile label="Best streak" value={bestStreak} />
          <MetricTile label="First-attempt points" value={headline.score} />
        </div>

        <div className="mt-3 flex justify-center gap-4 text-[11px] text-slate-500">
          <span data-testid="restart-count">Restarts: <span className="font-semibold text-[#16243D]">{restartCount}</span></span>
          <span data-testid="remediation-count">Remediation rounds: <span className="font-semibold text-[#16243D]">{remediationCount}</span></span>
        </div>

        <section className="mt-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Objectives (first attempt)</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {headline.objectives.map(o => (
              <ObjectiveRow key={o.objective} {...o} />
            ))}
          </ul>
        </section>

        {headline.missedItems.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Missed on first attempt</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {headline.missedItems.map(item => (
                <li key={item.questionId} className="rounded-md border border-[#FF6B5B]/30 bg-[#FF6B5B]/5 px-3 py-2 text-[12px]">
                  <p className="font-medium text-[#16243D]">{item.title}</p>
                  <p className="text-slate-500">{item.objective}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {unlockedNextLevelKey && (
          <p className="mt-6 text-center text-[12px] text-[#34D399]">Next level unlocked.</p>
        )}

        <div className="mt-8">
          <button
            type="button"
            data-testid="result-continue"
            onClick={onContinue}
            className="w-full rounded-md bg-[#34D399] px-4 py-3 text-sm font-semibold text-[#16243D] transition hover:brightness-95"
          >
            Continue
          </button>
        </div>
      </div>
    </motion.div>
  );
};
