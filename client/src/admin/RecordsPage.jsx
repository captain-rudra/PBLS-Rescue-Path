import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getMe, getSessions, getRecordsParticipants, getItemAnalysis, getRecordsTrail, downloadExport } from "../lib/adminApi.js";

const fmtMs = ms => {
  if (ms === null || ms === undefined) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const fmtDifficulty = p => (p === null || p === undefined ? "—" : `${Math.round(p * 100)}%`);
const fmtR = r => (r === null || r === undefined ? "—" : r.toFixed(2));
const fmtTs = ts => (ts ? new Date(ts).toISOString().replace("T", " ").replace(".000Z", "Z") : "—");

const STATE_STYLE = {
  excluded: "#FF6B5B",
  finished: "#34D399",
  "in progress": "#FFC94A",
  active: "#7FB8E8",
  "not started": "#3A4A63"
};

const ScopeBar = ({ scope, setScope, sessions }) => (
  <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#3A4A63]/20 bg-white/60 px-3 py-2 text-[12px]">
    <label className="flex items-center gap-1.5">
      <span className="font-semibold uppercase tracking-wide text-slate-500">Session</span>
      <select
        data-testid="scope-session"
        value={scope.sessionId || ""}
        onChange={e => setScope(s => ({ ...s, sessionId: e.target.value || null }))}
        className="rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1"
      >
        <option value="">All sessions</option>
        {sessions.map(sess => (
          <option key={sess.sessionId} value={sess.sessionId}>
            {sess.mode} · {sess.status} · {sess.participantCount}p / {sess.attemptCount}a · {new Date(sess.createdAt).toISOString().slice(0, 10)}
          </option>
        ))}
      </select>
    </label>
    <label className="flex items-center gap-1.5">
      <span className="font-semibold uppercase tracking-wide text-slate-500">Arm</span>
      <select
        data-testid="scope-arm"
        value={scope.arm || ""}
        onChange={e => setScope(s => ({ ...s, arm: e.target.value || null }))}
        className="rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1"
      >
        <option value="">Both</option>
        <option value="E">E (intervention)</option>
        <option value="C">C (control)</option>
      </select>
    </label>
    <label className="flex items-center gap-1.5">
      <input type="checkbox" data-testid="scope-excluded" checked={scope.includeExcluded} onChange={e => setScope(s => ({ ...s, includeExcluded: e.target.checked }))} />
      Include excluded
    </label>
    <label className="flex items-center gap-1.5">
      <input type="checkbox" data-testid="scope-practice" checked={scope.includePractice} onChange={e => setScope(s => ({ ...s, includePractice: e.target.checked }))} />
      Include practice
    </label>
  </div>
);

const Trail = ({ participantId, levelKey }) => {
  const [trail, setTrail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getRecordsTrail(participantId, levelKey)
      .then(setTrail)
      .catch(e => setError(e.message));
  }, [participantId, levelKey]);

  if (error) return <p className="text-[11px] text-[#FF6B5B]">{error}</p>;
  if (!trail) return <p className="text-[11px] text-slate-400">Loading trail…</p>;

  return (
    <div className="mt-2 flex flex-col gap-3">
      {trail.attempts.map(a => (
        <div key={a.attemptId} className="rounded border border-[#3A4A63]/20 bg-white/50 p-2">
          <p className="text-[11px] font-semibold text-[#16243D]">
            Attempt {a.attemptNo} · {a.kind}
            {a.remediationRound > 0 ? ` (round ${a.remediationRound})` : ""} · {a.status}
            {a.outcome ? ` · ${a.outcome}` : ""} · {a.accuracy ?? "—"}%
          </p>
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead className="text-slate-400">
                <tr className="text-left">
                  <th className="pr-2">#</th>
                  <th className="pr-2">item</th>
                  <th className="pr-2">v</th>
                  <th className="pr-2">✓</th>
                  <th className="pr-2">retry</th>
                  <th className="pr-2">shownAt</th>
                  <th className="pr-2">firstInteraction</th>
                  <th className="pr-2">answeredAt</th>
                  <th className="pr-2">hiddenMs</th>
                </tr>
              </thead>
              <tbody>
                {a.responses.map(r => (
                  <tr key={r.responseId} className={r.isCorrect ? "" : "text-[#FF6B5B]"}>
                    <td className="pr-2">{r.sequence ?? "—"}</td>
                    <td className="max-w-[16ch] truncate pr-2">{r.questionTitle ?? r.questionId}</td>
                    <td className="pr-2">{r.questionVersion}</td>
                    <td className="pr-2">{r.isCorrect ? "✓" : "✕"}</td>
                    <td className="pr-2">{r.isRetry ? "retry" : ""}</td>
                    <td className="pr-2 tabular-nums">{fmtTs(r.shownAt)}</td>
                    <td className="pr-2 tabular-nums">{fmtTs(r.firstInteractionAt)}</td>
                    <td className="pr-2 tabular-nums">{fmtTs(r.answeredAt)}</td>
                    <td className="pr-2 tabular-nums">{r.hiddenMs}</td>
                  </tr>
                ))}
                {a.responses.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-slate-400">
                      No responses recorded for this attempt.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

const ParticipantRow = ({ participant }) => {
  const [open, setOpen] = useState(false);
  const [trailFor, setTrailFor] = useState(null); // levelKey

  return (
    <>
      <tr
        data-testid={`participant-${participant.code}`}
        onClick={() => setOpen(o => !o)}
        className="cursor-pointer border-t border-[#3A4A63]/10 hover:bg-white/60"
      >
        <td className="py-1.5 pr-3 font-medium">{participant.code}</td>
        <td className="pr-3">{participant.arm}</td>
        <td className="pr-3">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ backgroundColor: `${STATE_STYLE[participant.state] || "#3A4A63"}22`, color: STATE_STYLE[participant.state] || "#3A4A63" }}>
            {participant.state}
          </span>
        </td>
        <td className="pr-3 tabular-nums">{participant.attemptCount}</td>
        <td className="pr-3 tabular-nums">{participant.wrongCount}</td>
        <td className="pr-3 tabular-nums">{participant.retryCount}</td>
        <td className="pr-3 tabular-nums">{fmtMs(participant.activeMs)}</td>
        <td className="pr-3 tabular-nums">{fmtMs(participant.hiddenMs)}</td>
        <td className="pr-3 tabular-nums">{participant.bestScore}</td>
        <td className="pr-3 tabular-nums">
          {participant.levelsMastered}/{participant.levelsPlayed}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} className="bg-[#FFF7ED] px-3 pb-3">
            {participant.levels.length === 0 && <p className="text-[12px] text-slate-400">No level attempts.</p>}
            {participant.levels.map(level => (
              <div key={level.levelKey} className="mt-2 rounded-md border border-[#3A4A63]/20 bg-white/60 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-[#16243D]">
                    {level.levelTitle} <span className="text-slate-400">({level.levelKey}, pass {level.passMark}%)</span>
                  </p>
                  <button
                    type="button"
                    data-testid={`trail-${participant.code}-${level.levelKey}`}
                    onClick={() => setTrailFor(t => (t === level.levelKey ? null : level.levelKey))}
                    className="text-[11px] font-semibold text-[#34D399] underline"
                  >
                    {trailFor === level.levelKey ? "hide trail" : "full trail"}
                  </button>
                </div>
                <table className="mt-1 w-full text-[11px]">
                  <thead className="text-left text-slate-400">
                    <tr>
                      <th className="pr-2">#</th>
                      <th className="pr-2">kind</th>
                      <th className="pr-2">accuracy</th>
                      <th className="pr-2">active</th>
                      <th className="pr-2">hidden</th>
                      <th className="pr-2">stars</th>
                      <th className="pr-2">missed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {level.attempts.map(a => (
                      <tr key={a.attemptId}>
                        <td className="pr-2">{a.attemptNo}</td>
                        <td className="pr-2">
                          {a.kind}
                          {a.remediationRound > 0 ? ` r${a.remediationRound}` : ""}
                        </td>
                        <td className="pr-2 tabular-nums">{a.accuracy ?? "—"}%</td>
                        <td className="pr-2 tabular-nums">{fmtMs(a.activeMs)}</td>
                        <td className="pr-2 tabular-nums">{fmtMs(a.hiddenMs)}</td>
                        <td className="pr-2 tabular-nums">{"★".repeat(a.starsAwarded)}{"☆".repeat(3 - a.starsAwarded)}</td>
                        <td className="pr-2">{a.missedItems.length === 0 ? "—" : a.missedItems.map(m => m.title || m.questionId).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {trailFor === level.levelKey && <Trail participantId={participant.participantId} levelKey={level.levelKey} />}
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
};

const ParticipantsTab = ({ scope, sessions }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setData(null);
    setError(null);
    getRecordsParticipants(scope)
      .then(setData)
      .catch(e => setError(e.message));
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="text-[12px] text-[#FF6B5B]">{error}</p>;
  if (!data) return <p className="text-[12px] text-slate-400">Loading…</p>;

  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-[11px] text-slate-500">
        {data.participants.length} participant{data.participants.length === 1 ? "" : "s"} · click a row to expand
      </p>
      <table className="w-full text-[12px]">
        <thead className="text-left text-slate-400">
          <tr>
            <th className="pb-1 pr-3">Code</th>
            <th className="pb-1 pr-3">Arm</th>
            <th className="pb-1 pr-3">State</th>
            <th className="pb-1 pr-3">Attempts</th>
            <th className="pb-1 pr-3">Wrong</th>
            <th className="pb-1 pr-3">Retries</th>
            <th className="pb-1 pr-3">Active</th>
            <th className="pb-1 pr-3">Hidden</th>
            <th className="pb-1 pr-3">Best</th>
            <th className="pb-1 pr-3">Mastered</th>
          </tr>
        </thead>
        <tbody>
          {data.participants.map(p => (
            <ParticipantRow key={p.participantId} participant={p} />
          ))}
        </tbody>
      </table>
      {data.participants.length === 0 && <p className="mt-3 text-[12px] text-slate-400">No participants match this scope.</p>}
    </div>
  );
};

const ItemAnalysisTab = ({ scope }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ key: "difficulty", dir: "asc" });

  useEffect(() => {
    setData(null);
    setError(null);
    getItemAnalysis(scope)
      .then(setData)
      .catch(e => setError(e.message));
  }, [scope]);

  const sorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data.items];
    const { key, dir } = sort;
    rows.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === null || av === undefined) return 1; // nulls last
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return dir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [data, sort]);

  if (error) return <p className="text-[12px] text-[#FF6B5B]">{error}</p>;
  if (!data) return <p className="text-[12px] text-slate-400">Loading…</p>;

  const th = (label, key) => (
    <th
      className="cursor-pointer select-none pb-1 pr-3"
      onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))}
    >
      {label} {sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
    </th>
  );

  const flagged = data.items.filter(i => i.needsReview).length;

  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] text-slate-500">
        {data.items.length} items · {flagged} flagged for review (hard <em>and</em> non-discriminating). Formulas: SPEC §11.
      </p>
      <p className="mb-2 text-[11px] text-[#FF6B5B]">
        Indicative, not definitive: with ~40 participants each per-item <span className="font-mono">n</span> is far below the 100+ CTT normally wants
        for a stable discrimination index. Treat these as a wording-review screen; weight each row by its <span className="font-mono">n</span>.
      </p>
      <table className="w-full text-[12px]">
        <thead className="text-left text-slate-400">
          <tr>
            {th("Level", "levelKey")}
            {th("Seq", "sequence")}
            <th className="pb-1 pr-3">Type</th>
            <th className="pb-1 pr-3">Objective</th>
            {th("n", "n")}
            {th("Difficulty", "difficulty")}
            {th("Discrimination", "discrimination")}
            <th className="pb-1 pr-3">Reading</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(item => (
            <tr
              key={item.questionId}
              data-testid={`item-${item.questionId}`}
              className="border-t border-[#3A4A63]/10 align-top"
              style={item.needsReview ? { borderLeft: "3px solid #FF6B5B" } : undefined}
            >
              <td className="py-1.5 pr-3">{item.levelKey}</td>
              <td className="pr-3 tabular-nums">{item.sequence}</td>
              <td className="pr-3">{item.type}</td>
              <td className="max-w-[22ch] truncate pr-3" title={item.objective}>
                {item.objective}
              </td>
              <td className="pr-3 tabular-nums">{item.n}</td>
              <td className="pr-3 tabular-nums">{fmtDifficulty(item.difficulty)}</td>
              <td className="pr-3 tabular-nums">{fmtR(item.discrimination)}</td>
              <td className="pr-3 text-[11px] text-slate-600">
                {item.needsReview && <span className="mr-1 rounded bg-[#FF6B5B] px-1 py-0.5 text-[9px] font-bold uppercase text-white">review</span>}
                {item.reading}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const EXPORT_FILES = [
  { file: "participants", label: "participants.csv", note: "one per code — arm, totals, state" },
  { file: "attempts", label: "attempts.csv", note: "one per level run — kind, accuracy, times, stars" },
  { file: "responses", label: "responses.csv", note: "one per answer — item, version, correctness, four timestamps" },
  { file: "items", label: "items.csv", note: "difficulty and discrimination per question" }
];

const ExportsTab = ({ scope, isSuperAdmin }) => {
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);

  const run = async file => {
    setBusy(file);
    setError(null);
    setDone(null);
    try {
      const filename = await downloadExport(file, scope);
      setDone(filename);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {!isSuperAdmin && (
        <p className="mb-3 rounded-md bg-[#FFC94A]/15 px-3 py-2 text-[12px] text-[#16243D]">Raw CSV export is available to super_admins only (SPEC 4.1).</p>
      )}
      <p className="mb-2 text-[11px] text-slate-500">
        The current scope (excluded {scope.includeExcluded ? "in" : "out"}, practice {scope.includePractice ? "in" : "out"}
        {scope.arm ? `, arm ${scope.arm}` : ""}
        {scope.sessionId ? ", one session" : ""}) is written into every filename so two exports can never be confused.
      </p>
      <div className="flex flex-col gap-2">
        {EXPORT_FILES.map(({ file, label, note }) => (
          <button
            key={file}
            type="button"
            data-testid={`export-${file}`}
            disabled={!isSuperAdmin || busy === file}
            onClick={() => run(file)}
            className="flex items-center justify-between rounded-md border border-[#3A4A63]/40 bg-white/60 px-3 py-2 text-left text-[13px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>
              <span className="font-semibold text-[#16243D]">{busy === file ? "Preparing…" : label}</span>
              <span className="ml-2 text-[11px] text-slate-500">{note}</span>
            </span>
            <span className="text-[11px] text-[#34D399]">download ↓</span>
          </button>
        ))}
      </div>
      {done && <p className="mt-3 text-[12px] text-[#16243D]">Saved <span className="font-mono">{done}</span></p>}
      {error && <p className="mt-3 text-[12px] text-[#FF6B5B]">{error}</p>}
    </div>
  );
};

export const RecordsPage = () => {
  const [tab, setTab] = useState("participants");
  const [scope, setScope] = useState({ includeExcluded: false, includePractice: false, sessionId: null, arm: null });
  const [sessions, setSessions] = useState([]);
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    getMe().then(res => setAdmin(res.admin)).catch(() => {});
    getSessions().then(res => setSessions(res.sessions)).catch(() => setSessions([]));
  }, []);

  const isSuperAdmin = admin?.role === "super_admin";

  const TABS = [
    { key: "participants", label: "Participants" },
    { key: "items", label: "Item analysis" },
    { key: "exports", label: "Exports" }
  ];

  return (
    <div className="min-h-screen bg-[#FFF7ED] text-[#16243D]">
      <header className="sticky top-0 z-10 border-b border-[#3A4A63]/20 bg-[#FFF7ED]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <Link to="/admin" className="text-[11px] underline">
              ← Question bank
            </Link>
            <h1 className="text-lg font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
              Records &amp; analytics
            </h1>
          </div>
          <div className="flex gap-1">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                data-testid={`tab-${t.key}`}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${tab === t.key ? "bg-[#34D399] text-[#16243D]" : "text-slate-500 hover:bg-white/60"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-5">
        <div className="mb-4">
          <ScopeBar scope={scope} setScope={setScope} sessions={sessions} />
        </div>
        {tab === "participants" && <ParticipantsTab scope={scope} sessions={sessions} />}
        {tab === "items" && <ItemAnalysisTab scope={scope} />}
        {tab === "exports" && <ExportsTab scope={scope} isSuperAdmin={isSuperAdmin} />}
      </div>
    </div>
  );
};
