import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getMe, getSessions, getParticipants, generateCodes, resetParticipantPin, updateParticipant } from "../lib/adminApi.js";

// Backend stateOf() values (server/src/routes/admin/participants.js).
const STATE_STYLE = {
  "no pin yet": "#94a3b8",
  "pin set": "#7FB8E8",
  "signed in": "#34D399",
  locked: "#FFC94A",
  excluded: "#FF6B5B"
};

const StateBadge = ({ state }) => (
  <span
    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
    style={{ backgroundColor: `${STATE_STYLE[state] || "#3A4A63"}22`, color: STATE_STYLE[state] || "#3A4A63" }}
  >
    {state}
  </span>
);

const Filters = ({ filters, setFilters, sessions }) => (
  <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#3A4A63]/20 bg-white/60 px-3 py-2 text-[12px]">
    <label className="flex items-center gap-1.5">
      <span className="font-semibold uppercase tracking-wide text-slate-500">Session</span>
      <select
        data-testid="filter-session"
        value={filters.sessionId || ""}
        onChange={e => setFilters(f => ({ ...f, sessionId: e.target.value || null }))}
        className="rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1"
      >
        <option value="">All sessions</option>
        {sessions.map(s => (
          <option key={s.sessionId} value={s.sessionId}>
            {s.mode} · {s.status} · {s.participantCount}p · {new Date(s.createdAt).toISOString().slice(0, 10)}
          </option>
        ))}
      </select>
    </label>
    <label className="flex items-center gap-1.5">
      <span className="font-semibold uppercase tracking-wide text-slate-500">Arm</span>
      <select
        data-testid="filter-arm"
        value={filters.arm || ""}
        onChange={e => setFilters(f => ({ ...f, arm: e.target.value || null }))}
        className="rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1"
      >
        <option value="">Both</option>
        <option value="E">E (intervention)</option>
        <option value="C">C (control)</option>
      </select>
    </label>
  </div>
);

// The roster label is on the session document, never the participant, and
// is stripped from every export (SPEC 6.2). It is surfaced here read-only
// as a facilitation aid, visually set apart so it never reads as a field
// of the participant.
const GeneratePanel = ({ sessions, onGenerated }) => {
  const [count, setCount] = useState(10);
  const [arm, setArm] = useState("E");
  const [prefix, setPrefix] = useState("PBLS");
  const [sessionId, setSessionId] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const labelLines = labelsText
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
  const usingLabels = labelLines.length > 0;

  const submit = async e => {
    e.preventDefault();
    setError(null);

    if (!Number.isInteger(count) || count < 1 || count > 500) return setError("Count must be a whole number between 1 and 500.");
    if (!/^[A-Za-z0-9]{2,12}$/.test(prefix)) return setError("Prefix must be 2–12 letters or digits, no hyphen.");
    if (usingLabels && !sessionId) return setError("Roster labels can only be attached to a session — pick one, or clear the labels.");
    if (usingLabels && labelLines.length !== count) return setError(`You gave ${labelLines.length} label${labelLines.length === 1 ? "" : "s"} for ${count} code${count === 1 ? "" : "s"} — they must match exactly (one label per line), or leave the box empty.`);

    setBusy(true);
    try {
      const res = await generateCodes({
        arm,
        count,
        prefix: prefix.toUpperCase(),
        sessionId: sessionId || undefined,
        labels: usingLabels ? labelLines : undefined
      });
      setLabelsText("");
      onGenerated(res, { sessionId: sessionId || null, arm });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} data-testid="generate-panel" className="rounded-md border border-[#3A4A63]/20 bg-white/60 p-3">
      <h2 className="mb-2 text-[13px] font-semibold text-[#16243D]">Generate codes</h2>
      <div className="flex flex-wrap gap-3 text-[12px]">
        <label className="flex flex-col gap-1">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Count</span>
          <input
            type="number"
            min={1}
            max={500}
            data-testid="gen-count"
            value={count}
            onChange={e => setCount(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-20 rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Arm</span>
          <select data-testid="gen-arm" value={arm} onChange={e => setArm(e.target.value)} className="rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1">
            <option value="E">E (intervention)</option>
            <option value="C">C (control)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Prefix</span>
          <input
            type="text"
            data-testid="gen-prefix"
            value={prefix}
            onChange={e => setPrefix(e.target.value)}
            className="w-28 rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1 font-mono uppercase"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Session (optional)</span>
          <select data-testid="gen-session" value={sessionId} onChange={e => setSessionId(e.target.value)} className="rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1">
            <option value="">None — codes only</option>
            {sessions.map(s => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.mode} · {s.status} · {new Date(s.createdAt).toISOString().slice(0, 10)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1 text-[12px]">
        <span className="font-semibold uppercase tracking-wide text-slate-500">
          Roster labels (optional) <span className="normal-case text-slate-400">— one per line, e.g. “Roll 21”. Stored on the session roster only, never on the code and never in an export.</span>
        </span>
        <textarea
          data-testid="gen-labels"
          value={labelsText}
          onChange={e => setLabelsText(e.target.value)}
          rows={3}
          disabled={!sessionId}
          placeholder={sessionId ? "Roll 21\nRoll 22\nRoll 23" : "Pick a session first to attach roster labels"}
          className="rounded border border-[#3A4A63]/40 bg-white px-1.5 py-1 font-mono text-[12px] disabled:bg-slate-100 disabled:text-slate-400"
        />
        {usingLabels && (
          <span className={labelLines.length === count ? "text-[11px] text-[#34D399]" : "text-[11px] text-[#FF6B5B]"}>
            {labelLines.length} label{labelLines.length === 1 ? "" : "s"} for {count || 0} code{count === 1 ? "" : "s"}
          </span>
        )}
      </label>

      {error && <p className="mt-2 rounded bg-[#FF6B5B]/10 px-2 py-1 text-[12px] text-[#FF6B5B]">{error}</p>}

      <button
        type="submit"
        data-testid="gen-submit"
        disabled={busy}
        className="mt-3 rounded-md bg-[#34D399] px-3 py-1.5 text-[13px] font-semibold text-[#16243D] disabled:opacity-50"
      >
        {busy ? "Generating…" : `Generate ${count || 0} code${count === 1 ? "" : "s"}`}
      </button>
    </form>
  );
};

const NoteCell = ({ participant, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(participant.adminNote || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(participant.adminNote || "");
  }, [participant.adminNote, editing]);

  if (!editing) {
    return (
      <button
        type="button"
        data-testid={`note-${participant.code}`}
        onClick={() => setEditing(true)}
        className="max-w-[24ch] truncate text-left text-[12px] text-slate-600 hover:underline"
        title={participant.adminNote || "Add a note"}
      >
        {participant.adminNote || <span className="text-slate-300">add note</span>}
      </button>
    );
  }

  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft.trim() ? draft.trim() : null);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        data-testid={`note-input-${participant.code}`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-40 rounded border border-[#3A4A63]/40 bg-white px-1 py-0.5 text-[12px]"
      />
      <button type="button" disabled={busy} onClick={save} className="text-[11px] font-semibold text-[#34D399] underline">
        save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-[11px] text-slate-400 underline">
        cancel
      </button>
    </span>
  );
};

const ParticipantRow = ({ participant, onPatch, onResetPin }) => {
  const [busy, setBusy] = useState(false);

  const run = async fn => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const toggleExcluded = () => {
    if (participant.excluded) {
      if (!window.confirm(`Bring ${participant.code} back into the study? Their exclusion reason (“${participant.excludeReason || "—"}”) will be cleared — the history stays in the audit log.`)) return;
      return run(() => onPatch(participant, { excluded: false }));
    }
    const reason = window.prompt(`Exclude ${participant.code} from the study. Reason (required — it goes in the audit log):`);
    if (reason == null) return;
    if (!reason.trim()) return window.alert("A reason is required to exclude a participant.");
    return run(() => onPatch(participant, { excluded: true, excludeReason: reason.trim() }));
  };

  const resetPin = () => {
    if (!window.confirm(`Reset the PIN for ${participant.code}? They will choose a new one on their next sign-in, and any device currently signed in as this code is signed out.`)) return;
    return run(() => onResetPin(participant));
  };

  return (
    <tr data-testid={`participant-${participant.code}`} className="border-t border-[#3A4A63]/10 align-top">
      <td className="py-1.5 pr-3 font-mono font-medium">{participant.code}</td>
      <td className="pr-3">{participant.arm}</td>
      <td className="pr-3">
        {participant.pinSet ? (
          <span className="text-[11px] font-semibold text-[#34D399]">set</span>
        ) : (
          <span className="text-[11px] text-slate-400">not set</span>
        )}
      </td>
      <td className="pr-3">
        <StateBadge state={participant.state} />
      </td>
      <td className="pr-3">
        {participant.sessionLabel ? (
          <span className="rounded bg-[#3A4A63]/10 px-1.5 py-0.5 text-[10px] text-slate-500" title="Session roster label — not part of the participant record or any export">
            {participant.sessionLabel}
          </span>
        ) : (
          <span className="text-[11px] text-slate-300">—</span>
        )}
      </td>
      <td className="pr-3">
        <NoteCell participant={participant} onSave={note => onPatch(participant, { adminNote: note })} />
      </td>
      <td className="pr-3">
        {participant.excluded ? (
          <span className="text-[11px] text-[#FF6B5B]" title={participant.excludeReason || ""}>
            excluded{participant.excludeReason ? ` — ${participant.excludeReason}` : ""}
          </span>
        ) : (
          <span className="text-[11px] text-slate-300">included</span>
        )}
      </td>
      <td className="whitespace-nowrap pr-3 text-right">
        <button
          type="button"
          data-testid={`reset-pin-${participant.code}`}
          disabled={busy || !participant.pinSet}
          onClick={resetPin}
          className="mr-2 text-[11px] font-semibold text-[#7FB8E8] underline disabled:text-slate-300 disabled:no-underline"
          title={participant.pinSet ? "" : "No PIN has been set yet"}
        >
          Reset PIN
        </button>
        <button
          type="button"
          data-testid={`toggle-excluded-${participant.code}`}
          disabled={busy}
          onClick={toggleExcluded}
          className={`text-[11px] font-semibold underline ${participant.excluded ? "text-[#34D399]" : "text-[#FF6B5B]"} disabled:opacity-50`}
        >
          {participant.excluded ? "Include" : "Exclude"}
        </button>
      </td>
    </tr>
  );
};

export const PeoplePage = () => {
  const [filters, setFilters] = useState({ sessionId: null, arm: null });
  const [sessions, setSessions] = useState([]);
  const [participants, setParticipants] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setError(null);
    getParticipants(filters)
      .then(res => setParticipants(res.participants))
      .catch(e => setError(e.message));
  }, [filters]);

  useEffect(() => {
    getSessions()
      .then(res => setSessions(res.sessions))
      .catch(() => setSessions([]));
    getMe().catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerated = (res, ctx) => {
    const withLabels = res.participants.filter(p => p.label).length;
    setNotice(
      `Generated ${res.participants.length} code${res.participants.length === 1 ? "" : "s"} (${res.prefix}-${res.participants[0].arm}-…)` +
        (withLabels ? `, ${withLabels} with a roster label on the session` : "")
    );
    // Jump the filters to the freshly generated cohort so the new rows are in view.
    setFilters({ sessionId: ctx.sessionId, arm: ctx.arm });
  };

  // The reset-pin and PATCH routes return the participant row WITHOUT the
  // roster label — that lives on the session, is joined in only by the
  // list route, and never rides along on a participant response (SPEC
  // 6.2). So carry the label we already hold in state across the swap.
  const mergeRow = (prev, id, next) => prev.map(p => (p.participantId === id ? { ...next, sessionLabel: p.sessionLabel } : p));

  const handlePatch = async (participant, patch) => {
    try {
      const res = await updateParticipant(participant.participantId, patch);
      setParticipants(prev => mergeRow(prev, participant.participantId, res.participant));
      setNotice(`Updated ${participant.code}.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleResetPin = async participant => {
    try {
      const res = await resetParticipantPin(participant.participantId);
      setParticipants(prev => mergeRow(prev, participant.participantId, res.participant));
      setNotice(`PIN reset for ${participant.code} — they set a new one on next sign-in.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const slipsHref = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.sessionId) params.set("sessionId", filters.sessionId);
    if (filters.arm) params.set("arm", filters.arm);
    const q = params.toString();
    return `/admin/slips${q ? `?${q}` : ""}`;
  }, [filters]);

  return (
    <div className="min-h-screen bg-[#FFF7ED] text-[#16243D]">
      <header className="sticky top-0 z-10 border-b border-[#3A4A63]/20 bg-[#FFF7ED]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <span className="text-[11px]">
              <Link to="/admin" className="underline">
                ← Question bank
              </Link>
              <span className="mx-1.5 text-slate-400">·</span>
              <Link to="/admin/records" className="underline">
                Records &amp; analytics
              </Link>
            </span>
            <h1 className="text-lg font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
              Participants
            </h1>
          </div>
          <Link
            to={slipsHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="print-slips"
            className="rounded-md border border-[#3A4A63]/40 px-3 py-1.5 text-[13px] font-semibold text-[#16243D] hover:bg-white"
          >
            Print slips ↗
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-5">
        {error && <p className="mb-3 rounded-md bg-[#FF6B5B]/10 px-3 py-2 text-[12px] text-[#FF6B5B]">{error}</p>}
        {notice && <p className="mb-3 rounded-md bg-[#34D399]/10 px-3 py-2 text-[12px] text-[#16243D]">{notice}</p>}

        <div className="mb-4">
          <GeneratePanel sessions={sessions} onGenerated={handleGenerated} />
        </div>

        <div className="mb-3">
          <Filters filters={filters} setFilters={setFilters} sessions={sessions} />
        </div>

        {!participants && !error && <p className="text-[12px] text-slate-400">Loading…</p>}

        {participants && (
          <div className="overflow-x-auto">
            <p className="mb-2 text-[11px] text-slate-500">
              {participants.length} participant{participants.length === 1 ? "" : "s"} in scope
            </p>
            <table className="w-full text-[12px]">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="pb-1 pr-3">Code</th>
                  <th className="pb-1 pr-3">Arm</th>
                  <th className="pb-1 pr-3">PIN</th>
                  <th className="pb-1 pr-3">State</th>
                  <th className="pb-1 pr-3">Roster label</th>
                  <th className="pb-1 pr-3">Admin note</th>
                  <th className="pb-1 pr-3">Excluded</th>
                  <th className="pb-1 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {participants.map(p => (
                  <ParticipantRow key={p.participantId} participant={p} onPatch={handlePatch} onResetPin={handleResetPin} />
                ))}
              </tbody>
            </table>
            {participants.length === 0 && <p className="mt-3 text-[12px] text-slate-400">No participants match this filter. Generate a batch above.</p>}
          </div>
        )}
      </div>
    </div>
  );
};
