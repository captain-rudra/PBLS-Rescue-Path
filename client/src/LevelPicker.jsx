import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLevels } from "./lib/api.js";

// Not the dashboard (that's 2c) — just enough of an index to reach the
// question engine for a given level while manually testing.
export const LevelPicker = () => {
  const [levels, setLevels] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getLevels()
      .then(response => setLevels(response.levels))
      .catch(err => setError(err.message));
  }, []);

  return (
    <div className="mx-auto max-w-md px-4 py-10 text-[#16243D]">
      <h1 className="text-lg font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>PBLS Rescue Path — Step 2b</h1>
      <p className="mt-1 text-[12px] text-slate-500">Question engine only. Pick a level to start an attempt.</p>

      {error && <p className="mt-4 text-sm text-[#FF6B5B]">{error}</p>}
      {!levels && !error && <p className="mt-4 text-sm">Loading levels…</p>}

      {levels && (
        <ul className="mt-4 flex flex-col gap-2">
          {levels.map(level => (
            <li key={level.key} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span>
                {level.title} <span className="text-slate-400">({level.questionCount} questions, {level.state})</span>
              </span>
              {level.state === "locked" ? (
                <span className="text-xs text-slate-400">locked</span>
              ) : (
                <Link to={`/play/${level.key}`} className="text-xs font-semibold text-[#34D399] underline">
                  {level.state === "failed" ? "retry" : "play"}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
