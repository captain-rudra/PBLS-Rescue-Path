import { Badge } from "../components/Badge.jsx";
import { LEVEL_BADGE_META, ACHIEVEMENT_BADGE_META } from "./badges.jsx";

// SPEC 2.6 — the dashboard's badge shelf. Every badge the path can award
// is shown: earned ones in full colour, the rest visible but locked so the
// player can see what is ahead.
//
// The prelevel has no badge (null, per the corrected source document), so
// it simply contributes no tile — `levels.filter(l => l.badge)` leaves no
// gap and no empty slot where a prelevel badge would otherwise sit.
export const BadgeShelf = ({ levels = [], achievements = [] }) => {
  const levelBadges = levels
    .filter(level => level.badge && LEVEL_BADGE_META[level.key])
    .map(level => ({
      ...LEVEL_BADGE_META[level.key],
      name: level.badge,
      earned: level.state === "complete",
      subtitle: level.state === "complete" ? "Level mastered" : `Master ${level.title}`
    }));

  const achievementBadges = achievements
    .filter(achievement => ACHIEVEMENT_BADGE_META[achievement.key])
    .map(achievement => ({
      ...ACHIEVEMENT_BADGE_META[achievement.key],
      name: achievement.name,
      earned: achievement.earned,
      subtitle: achievement.earned ? "Achievement unlocked" : achievement.criterion
    }));

  const all = [...levelBadges, ...achievementBadges];
  if (all.length === 0) return null;
  const earnedCount = all.filter(badge => badge.earned).length;

  return (
    <section className="mx-auto mt-3 max-w-md rounded-lg border border-[#3A4A63]/20 bg-white/60 px-3 py-3" data-testid="badge-shelf">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Badge shelf</h2>
        <span className="text-[11px] text-slate-400">
          {earnedCount}/{all.length} earned
        </span>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-2 gap-y-3">
        {all.map(badge => (
          <Badge key={badge.key} badgeKey={badge.key} name={badge.name} accent={badge.accent} Icon={badge.Icon} earned={badge.earned} subtitle={badge.subtitle} size={72} />
        ))}
      </div>
    </section>
  );
};
