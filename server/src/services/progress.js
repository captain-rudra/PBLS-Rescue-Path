import Level from "../models/Level.js";
import Attempt from "../models/Attempt.js";
import { STATUS } from "../../../shared/constants.js";
import { computeLevelProgress, filterAttemptsByLevelResets } from "./scoring.js";

// Shared by GET /play/levels, POST /play/attempts's loadProgressFor, and
// POST /play/levels/reset-progress's "has every level been mastered" check — one
// place that loads the servable levels + this participant's submitted
// attempts and applies any level resets (Participant.levelResets) before
// computeLevelProgress, so all three always agree on what "current
// progress" means.
export const loadFullProgress = async participant => {
  const levels = await Level.find({ deletedAt: null, status: { $in: [STATUS.PUBLISHED, STATUS.LOCKED] } }).sort({ order: 1 });

  const attempts = await Attempt.find({
    participantId: participant._id,
    isPractice: false,
    status: STATUS.SUBMITTED,
    levelId: { $in: levels.map(l => l._id) }
  });

  const attemptsByLevelId = new Map();
  for (const attempt of attempts) {
    const key = String(attempt.levelId);
    if (!attemptsByLevelId.has(key)) attemptsByLevelId.set(key, []);
    attemptsByLevelId.get(key).push(attempt);
  }

  const filtered = filterAttemptsByLevelResets(attemptsByLevelId, participant.levelResets);
  const progress = computeLevelProgress(levels, filtered);
  return { levels, progress };
};
