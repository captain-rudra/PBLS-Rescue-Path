import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  getLevels,
  getQuestions,
  lockLevel,
  unlockLevel,
  archiveQuestion,
  hardDeleteQuestion,
  deleteLevel,
  hardDeleteLevel,
  reorderQuestions,
  getMe
} from "../lib/adminApi.js";
import { QUESTION_TYPES, STATUS } from "../../../shared/constants.js";
import { confirmTwice } from "../lib/confirmTwice.js";

const STATUS_STYLE = {
  draft: { bg: "#3A4A63", text: "#FFF7ED" },
  published: { bg: "#34D399", text: "#16243D" },
  locked: { bg: "#FFC94A", text: "#16243D" },
  archived: { bg: "#FF6B5B", text: "#16243D" }
};

const StatusBadge = ({ status }) => {
  const style = STATUS_STYLE[status] || STATUS_STYLE.draft;
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ backgroundColor: style.bg, color: style.text }}>
      {status}
    </span>
  );
};

const MediaState = ({ mediaStatus }) => {
  if (!mediaStatus || mediaStatus.required.length === 0) return <span className="text-[11px] text-slate-400">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {mediaStatus.required.map(field => {
        const present = mediaStatus.present.includes(field);
        return (
          <span
            key={field}
            title={`${field}: ${present ? "present" : "missing"}`}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: present ? "#34D399" : "#FF6B5B", color: "#16243D" }}
          >
            {present ? "✓" : "✕"} {field}
          </span>
        );
      })}
    </span>
  );
};

const RowContent = ({ question, canDelete, onArchive, onHardDelete, dragHandle }) => (
  <>
    {dragHandle}
    <span className="w-6 text-[11px] text-slate-400">{question.sequence}</span>
    <span className="w-28 truncate text-[11px] uppercase tracking-wide text-slate-500">{question.type}</span>
    <span className="flex-1 truncate font-medium">{question.title}</span>
    <span className="w-16 text-[11px] text-slate-500">v{question.version}</span>
    <MediaState mediaStatus={question.mediaStatus} />
    <StatusBadge status={question.status} />
    <Link to={`/admin/edit-question/${question.questionId}`} data-testid={`edit-${question.questionId}`} className="text-[11px] font-semibold text-[#34D399] underline">
      Edit
    </Link>
    {canDelete && question.status !== "archived" && (
      <button type="button" onClick={() => onArchive(question)} className="text-[11px] font-semibold text-[#FF6B5B] underline">
        Archive
      </button>
    )}
    {canDelete && question.status === "archived" && (
      <button type="button" onClick={() => onHardDelete(question)} className="text-[11px] font-semibold text-[#FF6B5B] underline">
        Hard delete
      </button>
    )}
  </>
);

// Sortable only inside an active DndContext (SortableRow) — a filtered,
// partial view of the level can't legally reorder (the API always wants
// the WHOLE level's order), so that view renders StaticRow instead, which
// never calls useSortable at all rather than calling it with dragging
// disabled — keeps the two rendering paths honest about what's actually
// interactive.
const SortableRow = ({ question, canDelete, onArchive, onHardDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.questionId });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid={`question-row-${question.questionId}`}
      className={`flex items-center gap-3 rounded-md border border-[#3A4A63]/20 bg-white/60 px-3 py-2 text-[13px] ${isDragging ? "opacity-60" : ""}`}
    >
      <RowContent
        question={question}
        canDelete={canDelete}
        onArchive={onArchive}
        onHardDelete={onHardDelete}
        dragHandle={
          <button type="button" {...attributes} {...listeners} className="cursor-grab text-slate-400" aria-label="Drag to reorder" title="Drag to reorder">
            ⠿
          </button>
        }
      />
    </li>
  );
};

const StaticRow = ({ question, canDelete, onArchive, onHardDelete }) => (
  <li data-testid={`question-row-${question.questionId}`} className="flex items-center gap-3 rounded-md border border-[#3A4A63]/20 bg-white/60 px-3 py-2 text-[13px]">
    <RowContent question={question} canDelete={canDelete} onArchive={onArchive} onHardDelete={onHardDelete} dragHandle={<span className="w-4 text-slate-300">⠿</span>} />
  </li>
);

const LevelGroup = ({ level, questions, admin, reorderDisabled, onReorder, onLock, onUnlock, onArchive, onHardDeleteQuestion, onDeleteLevel, onHardDeleteLevel }) => {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = questions.map(q => q.questionId);
  const isSuperAdmin = admin?.role === "super_admin";

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    onReorder(level.key, arrayMove(ids, oldIndex, newIndex));
  };

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-[#16243D]">
            {level.title} {level.deletedAt && <span className="ml-1 rounded-full bg-[#FF6B5B]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#FF6B5B]">Deleted</span>}
          </h2>
          <p className="text-[11px] text-slate-500">
            {level.key} · <StatusBadgeInline status={level.status} /> · {questions.length} question{questions.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!level.deletedAt && (
            <Link to={`/admin/new-question?levelKey=${level.key}`} data-testid={`new-question-${level.key}`} className="rounded-md border border-[#3A4A63]/40 px-2.5 py-1 text-[11px] font-semibold text-[#16243D] hover:bg-white">
              + New question
            </Link>
          )}
          {isSuperAdmin && !level.deletedAt && level.status !== "locked" && (
            <button type="button" onClick={() => onLock(level)} data-testid={`lock-${level.key}`} className="rounded-md border border-[#FFC94A] px-2.5 py-1 text-[11px] font-semibold text-[#16243D] hover:bg-[#FFC94A]/10">
              Lock level
            </button>
          )}
          {isSuperAdmin && !level.deletedAt && level.status === "locked" && (
            <button type="button" onClick={() => onUnlock(level)} data-testid={`unlock-${level.key}`} className="rounded-md border border-[#34D399] px-2.5 py-1 text-[11px] font-semibold text-[#16243D] hover:bg-[#34D399]/10">
              Unlock level
            </button>
          )}
          {isSuperAdmin && !level.deletedAt && (
            <button type="button" onClick={() => onDeleteLevel(level)} data-testid={`delete-level-${level.key}`} className="rounded-md border border-[#FF6B5B] px-2.5 py-1 text-[11px] font-semibold text-[#FF6B5B] hover:bg-[#FF6B5B]/10">
              Delete level
            </button>
          )}
          {isSuperAdmin && level.deletedAt && (
            <button type="button" onClick={() => onHardDeleteLevel(level)} data-testid={`hard-delete-level-${level.key}`} className="rounded-md border border-[#FF6B5B] bg-[#FF6B5B]/10 px-2.5 py-1 text-[11px] font-semibold text-[#FF6B5B]">
              Hard delete level
            </button>
          )}
        </div>
      </div>

      {questions.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#3A4A63]/30 px-3 py-4 text-center text-[12px] text-slate-400">No questions match the current filters.</p>
      ) : reorderDisabled ? (
        <>
          <p className="mb-1.5 text-[10px] text-slate-400">Clear the type/status filter to drag-reorder — reordering rewrites the whole level's sequence at once.</p>
          <ol className="flex flex-col gap-1.5">
            {questions.map(question => (
              <StaticRow key={question.questionId} question={question} canDelete={isSuperAdmin} onArchive={onArchive} onHardDelete={onHardDeleteQuestion} />
            ))}
          </ol>
        </>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="flex flex-col gap-1.5">
              {questions.map(question => (
                <SortableRow key={question.questionId} question={question} canDelete={isSuperAdmin} onArchive={onArchive} onHardDelete={onHardDeleteQuestion} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
};

const StatusBadgeInline = ({ status }) => {
  const style = STATUS_STYLE[status] || STATUS_STYLE.draft;
  return (
    <span className="font-semibold" style={{ color: status === "draft" ? "#94a3b8" : style.bg }}>
      {status}
    </span>
  );
};

export const QuestionBank = () => {
  const navigate = useNavigate();
  const [levels, setLevels] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [counts, setCounts] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [filters, setFilters] = useState({ levelKey: "", type: "", status: "" });
  const [showDeletedLevels, setShowDeletedLevels] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      const [levelsRes, questionsRes, meRes] = await Promise.all([
        getLevels({ includeDeleted: showDeletedLevels }),
        getQuestions(filters),
        getMe()
      ]);
      setLevels(levelsRes.levels);
      setQuestions(questionsRes.questions);
      setCounts(questionsRes.counts);
      setAdmin(meRes.admin);
    } catch (err) {
      setError(err.message);
    }
  }, [filters, showDeletedLevels]);

  useEffect(() => {
    load();
  }, [load]);

  const questionsByLevel = useMemo(() => {
    const map = new Map();
    for (const q of questions || []) {
      if (!map.has(q.levelKey)) map.set(q.levelKey, []);
      map.get(q.levelKey).push(q);
    }
    for (const list of map.values()) list.sort((a, b) => a.sequence - b.sequence);
    return map;
  }, [questions]);

  const visibleLevels = useMemo(() => {
    if (!levels) return [];
    return filters.levelKey ? levels.filter(l => l.key === filters.levelKey) : levels;
  }, [levels, filters.levelKey]);

  const handleReorder = async (levelKey, orderedQuestionIds) => {
    setQuestions(prev => {
      const next = [...prev];
      orderedQuestionIds.forEach((id, index) => {
        const item = next.find(q => q.questionId === id);
        if (item) item.sequence = index + 1;
      });
      return next;
    });
    try {
      await reorderQuestions(levelKey, orderedQuestionIds);
      setNotice(`Reordered ${levelKey}.`);
    } catch (err) {
      setError(err.message);
      load();
    }
  };

  const handleLock = async level => {
    try {
      await lockLevel(level.levelId);
      setNotice(`${level.title} locked.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const handleUnlock = async level => {
    try {
      await unlockLevel(level.levelId);
      setNotice(`${level.title} unlocked.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const handleArchive = async question => {
    if (!window.confirm(`Archive "${question.title}"? This retires it — it can no longer be served or edited, but is kept for any responses that reference it.`)) return;
    try {
      await archiveQuestion(question.questionId);
      setNotice(`Archived "${question.title}".`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const handleHardDeleteQuestion = async question => {
    const reason = confirmTwice({
      reasonPrompt: `Permanently delete "${question.title}"? This cannot be undone — it only works because it's archived and was never served to a real attempt. Reason (required, goes in the audit log):`,
      retypeLabel: "Title",
      retypeValue: question.title
    });
    if (reason === null) return;
    try {
      await hardDeleteQuestion(question.questionId, reason);
      setNotice(`Permanently deleted "${question.title}".`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const handleDeleteLevel = async level => {
    const reason = confirmTwice({
      reasonPrompt: `Delete "${level.title}"? This removes it from every picker and stops it being served — the record is kept, never hard-deleted. Reason (required):`,
      retypeLabel: "Level key",
      retypeValue: level.key
    });
    if (reason === null) return;
    try {
      await deleteLevel(level.levelId, reason);
      setNotice(`Deleted "${level.title}".`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const handleHardDeleteLevel = async level => {
    const reason = confirmTwice({
      reasonPrompt: `Permanently delete "${level.title}"? This cannot be undone — it only works because it's already deleted and was never played. Reason (required):`,
      retypeLabel: "Level key",
      retypeValue: level.key
    });
    if (reason === null) return;
    try {
      await hardDeleteLevel(level.levelId, reason);
      setNotice(`Permanently deleted "${level.title}".`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF7ED] text-[#16243D]">
      <header className="sticky top-0 z-10 border-b border-[#3A4A63]/20 bg-[#FFF7ED]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
              Question bank
            </h1>
            <p className="text-[11px] text-slate-500">{counts ? `${counts.total} question${counts.total === 1 ? "" : "s"} in scope` : "Loading…"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/admin/people" data-testid="nav-people" className="rounded-md border border-[#3A4A63]/40 px-3 py-1.5 text-[13px] font-semibold text-[#16243D] hover:bg-white">
              Participants
            </Link>
            <Link to="/admin/records" data-testid="nav-records" className="rounded-md border border-[#3A4A63]/40 px-3 py-1.5 text-[13px] font-semibold text-[#16243D] hover:bg-white">
              Records &amp; analytics
            </Link>
            <button type="button" onClick={() => navigate("/admin/new-question")} data-testid="new-question" className="rounded-md bg-[#34D399] px-3 py-1.5 text-[13px] font-semibold text-[#16243D]">
              + New question
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {error && <p className="mb-3 rounded-md bg-[#FF6B5B]/10 px-3 py-2 text-[12px] text-[#FF6B5B]">{error}</p>}
        {notice && <p className="mb-3 rounded-md bg-[#34D399]/10 px-3 py-2 text-[12px] text-[#16243D]">{notice}</p>}

        <div className="mb-6 flex flex-wrap gap-3">
          <select data-testid="filter-level" value={filters.levelKey} onChange={e => setFilters(f => ({ ...f, levelKey: e.target.value }))} className="rounded-md border border-[#3A4A63]/40 bg-white px-2 py-1.5 text-[12px]">
            <option value="">All levels</option>
            {(levels || []).map(l => (
              <option key={l.key} value={l.key}>
                {l.title} {counts?.byLevel?.[l.key] ? `(${counts.byLevel[l.key]})` : ""}
              </option>
            ))}
          </select>
          <select data-testid="filter-type" value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} className="rounded-md border border-[#3A4A63]/40 bg-white px-2 py-1.5 text-[12px]">
            <option value="">All types</option>
            {QUESTION_TYPES.map(t => (
              <option key={t} value={t}>
                {t} {counts?.byType?.[t] ? `(${counts.byType[t]})` : ""}
              </option>
            ))}
          </select>
          <select data-testid="filter-status" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="rounded-md border border-[#3A4A63]/40 bg-white px-2 py-1.5 text-[12px]">
            <option value="">All statuses</option>
            {Object.values(STATUS)
              .filter(s => ["draft", "published", "locked", "archived"].includes(s))
              .map(s => (
                <option key={s} value={s}>
                  {s} {counts?.byStatus?.[s] ? `(${counts.byStatus[s]})` : ""}
                </option>
              ))}
          </select>
          {admin?.role === "super_admin" && (
            <label className="flex items-center gap-1.5 text-[12px] text-slate-500">
              <input type="checkbox" checked={showDeletedLevels} onChange={e => setShowDeletedLevels(e.target.checked)} />
              Show deleted levels
            </label>
          )}
        </div>

        {!questions && !error && <p className="text-sm text-slate-500">Loading…</p>}

        {questions &&
          visibleLevels.map(level => (
            <LevelGroup
              key={level.key}
              level={level}
              questions={questionsByLevel.get(level.key) || []}
              admin={admin}
              reorderDisabled={Boolean(filters.type || filters.status)}
              onReorder={handleReorder}
              onLock={handleLock}
              onUnlock={handleUnlock}
              onArchive={handleArchive}
              onHardDeleteQuestion={handleHardDeleteQuestion}
              onDeleteLevel={handleDeleteLevel}
              onHardDeleteLevel={handleHardDeleteLevel}
            />
          ))}
      </div>
    </div>
  );
};
