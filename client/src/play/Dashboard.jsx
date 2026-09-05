import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getLevels, getAchievements } from "../lib/api.js";
import { PathNode } from "./PathNode.jsx";
import { BadgeShelf } from "./BadgeShelf.jsx";
import { MuteToggle } from "../components/MuteToggle.jsx";
import { useMute } from "../hooks/useMute.js";

// SPEC 2.6: "a winding path with one node per level." Nodes zigzag
// left/right down the screen; the connecting route is drawn in vital green
// up to the last completed node and dead slate beyond it.
const SEGMENT_HEIGHT = 190;
const NODE_TOP_OFFSET = 60;
const AMPLITUDE = 26; // percent either side of center

export const Dashboard = () => {
  const [levels, setLevels] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [error, setError] = useState(null);
  const [muted, toggleMuted] = useMute();
  const navigate = useNavigate();
  const location = useLocation();
  const justUnlockedLevelKey = location.state?.justUnlockedLevelKey ?? null;

  const resizeObserverRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    getLevels()
      .then(response => setLevels(response.levels))
      .catch(err => setError(err.message));
    // The shelf is secondary — if it fails, the path still renders.
    getAchievements()
      .then(response => setAchievements(response.achievements))
      .catch(() => setAchievements([]));
  }, []);

  // A callback ref, not a plain ref + effect: the measured div only mounts
  // once `levels` has loaded, which happens well after the component's
  // first render — an effect with an empty dependency array would run
  // before that div exists and never fire again once it does.
  const containerRef = useCallback(node => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    resizeObserverRef.current = new ResizeObserver(update);
    resizeObserverRef.current.observe(node);
  }, []);

  // Clears the "just unlocked" nav state after the unlock animation has had
  // a chance to play, so a later refresh or Back doesn't replay it.
  useEffect(() => {
    if (!justUnlockedLevelKey) return undefined;
    const timer = setTimeout(() => navigate(".", { replace: true, state: {} }), 1500);
    return () => clearTimeout(timer);
  }, [justUnlockedLevelKey, navigate]);

  const positions = useMemo(() => {
    if (!levels) return [];
    return levels.map((level, index) => ({
      level,
      xPercent: 50 + (index % 2 === 0 ? -AMPLITUDE : AMPLITUDE),
      y: NODE_TOP_OFFSET + index * SEGMENT_HEIGHT
    }));
  }, [levels]);

  const totalHeight = positions.length ? positions[positions.length - 1].y + 140 : 0;

  const handleSelect = level => navigate(`/briefing/${level.key}`);
  // Persistent review entry point (SPEC 2.6): straight to the level's
  // frozen first attempt, bypassing the briefing entirely. Only rendered by
  // PathNode when `level.headline` exists, so this is never reachable for a
  // locked or never-attempted level.
  const handleReview = level => navigate(`/review/${level.headline.attemptId}`);

  return (
    <div className="min-h-screen bg-[#FFF7ED]">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#3A4A63]/20 bg-[#FFF7ED]/95 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold text-[#16243D]" style={{ fontFamily: "Fredoka, sans-serif" }}>
            The rescue path
          </h1>
          <p className="text-[11px] text-slate-500">Master a level at 100% to move on — the pass mark just avoids a full restart.</p>
        </div>
        <MuteToggle muted={muted} onToggle={toggleMuted} />
      </header>

      {levels && <BadgeShelf levels={levels} achievements={achievements} />}

      {error && <p className="px-4 py-6 text-sm text-[#FF6B5B]">{error}</p>}
      {!levels && !error && <p className="px-4 py-6 text-sm text-slate-500">Loading the path…</p>}

      {levels && (
        <div ref={containerRef} className="relative mx-auto max-w-md" style={{ height: totalHeight }}>
          {width > 0 && (
            <svg className="absolute inset-0" width={width} height={totalHeight} viewBox={`0 0 ${width} ${totalHeight}`}>
              {positions.slice(1).map((point, i) => {
                const prev = positions[i];
                const traveled = prev.level.state === "complete";
                const isNewSegment = justUnlockedLevelKey && point.level.key === justUnlockedLevelKey;
                const x1 = (prev.xPercent / 100) * width;
                const x2 = (point.xPercent / 100) * width;
                const midY = (prev.y + point.y) / 2;
                const d = `M ${x1} ${prev.y} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${point.y}`;
                return (
                  <motion.path
                    key={point.level.key}
                    d={d}
                    fill="none"
                    stroke={traveled ? "#34D399" : "#3A4A63"}
                    strokeWidth={4}
                    strokeLinecap="round"
                    initial={isNewSegment ? { pathLength: 0 } : false}
                    animate={{ pathLength: 1 }}
                    transition={isNewSegment ? { duration: 0.9, ease: "easeOut" } : { duration: 0 }}
                  />
                );
              })}
            </svg>
          )}

          {positions.map(({ level, xPercent, y }) => (
            <PathNode key={level.key} level={level} x={xPercent} y={y} justUnlocked={justUnlockedLevelKey === level.key} onSelect={handleSelect} onReview={handleReview} />
          ))}
        </div>
      )}
    </div>
  );
};
