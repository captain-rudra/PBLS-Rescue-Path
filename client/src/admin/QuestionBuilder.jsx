import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation, Link } from "react-router-dom";
import { getLevels, getQuestion, createQuestion, updateQuestion } from "../lib/adminApi.js";
import { QUESTION_TYPES } from "../../../shared/constants.js";
import { QuestionPreview } from "./QuestionPreview.jsx";

const TYPE_LABELS = {
  mcq: "Multiple choice",
  video_mcq: "Video + multiple choice",
  animation_mcq: "Animated scenario",
  drag_drop: "Drag and drop",
  sequence: "Put in order",
  split_screen: "Compare two clips",
  hotspot_video: "Spot it in the video",
  interlude: "Interlude (mandatory viewing, unscored)"
};

const usesOptions = type => ["mcq", "video_mcq", "animation_mcq", "split_screen", "hotspot_video"].includes(type);
const usesMedia = type => ["video_mcq", "animation_mcq", "split_screen", "hotspot_video", "interlude"].includes(type);

const emptyForm = (levelKey = "") => ({
  levelKey,
  type: "mcq",
  title: "",
  objective: "",
  scenario: "",
  prompt: "",
  points: 120,
  feedback: { text: "", videoUrl: "", videoUrlB: "", imageUrl: "" },
  authoringNote: "",
  fallbackText: "",
  media: { videoUrl: "", videoUrlB: "", imageUrl: "", posterUrl: "", riveSrc: "", loop: true, gateOnFirstPlay: false, durationSeconds: "" },
  options: [{ key: "A", text: "" }, { key: "B", text: "" }],
  correct: "",
  items: [],
  correctOrder: [],
  buckets: [],
  hotspots: [],
  sides: [{ label: "Side A", parameters: [] }, { label: "Side B", parameters: [] }]
});

const questionToForm = q => ({
  levelKey: q.levelKey,
  type: q.type,
  title: q.title || "",
  objective: q.objective || "",
  scenario: q.scenario || "",
  prompt: q.prompt || "",
  points: q.points ?? 120,
  feedback: { text: q.feedback?.text || "", videoUrl: q.feedback?.videoUrl || "", videoUrlB: q.feedback?.videoUrlB || "", imageUrl: q.feedback?.imageUrl || "" },
  authoringNote: q.authoringNote || "",
  fallbackText: q.fallbackText || "",
  media: {
    videoUrl: q.media?.videoUrl || "",
    videoUrlB: q.media?.videoUrlB || "",
    imageUrl: q.media?.imageUrl || "",
    posterUrl: q.media?.posterUrl || "",
    riveSrc: q.media?.riveSrc || "",
    loop: q.media?.loop ?? true,
    gateOnFirstPlay: q.media?.gateOnFirstPlay ?? false,
    durationSeconds: q.media?.durationSeconds ?? ""
  },
  options: q.options?.length ? q.options : [{ key: "A", text: "" }, { key: "B", text: "" }],
  correct: q.correct || "",
  items: q.items || [],
  correctOrder: q.correctOrder || [],
  buckets: q.buckets || [],
  hotspots: q.hotspots || [],
  sides: q.sides?.length ? q.sides : [{ label: "Side A", parameters: [] }, { label: "Side B", parameters: [] }]
});

const nextOptionKey = options => "ABCDEFGH"[options.length] || String(options.length + 1);

const OptionsEditor = ({ form, setForm }) => (
  <div className="flex flex-col gap-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Options</p>
    {form.options.map((option, index) => (
      <div key={index} className="flex items-center gap-2">
        <input
          type="radio"
          name="correct"
          checked={form.correct === option.key}
          onChange={() => setForm(f => ({ ...f, correct: option.key }))}
          title="Mark as correct"
        />
        <input
          value={option.key}
          onChange={e => setForm(f => ({ ...f, options: f.options.map((o, i) => (i === index ? { ...o, key: e.target.value } : o)) }))}
          className="w-10 rounded border border-[#3A4A63]/40 px-1.5 py-1 text-[12px]"
        />
        <input
          value={option.text}
          onChange={e => setForm(f => ({ ...f, options: f.options.map((o, i) => (i === index ? { ...o, text: e.target.value } : o)) }))}
          placeholder="Option text"
          className="flex-1 rounded border border-[#3A4A63]/40 px-2 py-1 text-[12px]"
        />
        <button type="button" onClick={() => setForm(f => ({ ...f, options: f.options.filter((_, i) => i !== index) }))} className="text-[11px] text-[#FF6B5B]">
          Remove
        </button>
      </div>
    ))}
    <button
      type="button"
      onClick={() => setForm(f => ({ ...f, options: [...f.options, { key: nextOptionKey(f.options), text: "" }] }))}
      className="self-start text-[11px] font-semibold text-[#34D399] underline"
    >
      + Add option
    </button>
  </div>
);

const MediaFieldsEditor = ({ form, setForm }) => {
  const { type } = form;
  const set = (key, value) => setForm(f => ({ ...f, media: { ...f.media, [key]: value } }));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[#3A4A63]/20 bg-white/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Media (paste a link — upload is Phase 3)</p>
      {(type === "video_mcq" || type === "hotspot_video") && (
        <>
          <LabeledInput label="Video URL" value={form.media.videoUrl} onChange={v => set("videoUrl", v)} />
          <LabeledInput label="Poster URL" value={form.media.posterUrl} onChange={v => set("posterUrl", v)} />
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={form.media.gateOnFirstPlay} onChange={e => set("gateOnFirstPlay", e.target.checked)} />
            Gate options until the video plays through once
          </label>
        </>
      )}
      {type === "hotspot_video" && <LabeledInput label="Clip duration (seconds)" type="number" value={form.media.durationSeconds} onChange={v => set("durationSeconds", v)} />}
      {type === "animation_mcq" && (
        <>
          <LabeledInput label="Rive scene URL" value={form.media.riveSrc} onChange={v => set("riveSrc", v)} />
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={form.media.loop} onChange={e => set("loop", e.target.checked)} />
            Loop
          </label>
        </>
      )}
      {type === "split_screen" && (
        <>
          <LabeledInput label="Video URL (side A)" value={form.media.videoUrl} onChange={v => set("videoUrl", v)} />
          <LabeledInput label="Video URL (side B)" value={form.media.videoUrlB} onChange={v => set("videoUrlB", v)} />
          <LabeledInput label="Poster URL" value={form.media.posterUrl} onChange={v => set("posterUrl", v)} />
          <p className="text-[11px] text-slate-500">Each side plays independently with its own controls. Both must be watched through once before the answer options unlock.</p>
        </>
      )}
      {type === "interlude" && (
        <>
          <LabeledInput label="Video URL (1st clip)" value={form.media.videoUrl} onChange={v => set("videoUrl", v)} />
          <LabeledInput label="Video URL (2nd clip)" value={form.media.videoUrlB} onChange={v => set("videoUrlB", v)} />
          <LabeledInput label="Photo URL (optional)" value={form.media.imageUrl} onChange={v => set("imageUrl", v)} />
          <p className="text-[11px] text-slate-500">
            No options, not scored. Each clip plays independently; both are mandatory — Done stays disabled until both have played through once, then unlimited
            replays. Use Prompt/Scenario above for the narrative text.
          </p>
        </>
      )}
      <LabeledInput label="Fallback text (shown if media fails or is missing)" value={form.fallbackText} onChange={v => setForm(f => ({ ...f, fallbackText: v }))} textarea />
    </div>
  );
};

const LabeledInput = ({ label, value, onChange, type = "text", textarea = false, disabled = false }) => (
  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
    {label}
    {textarea ? (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        disabled={disabled}
        className="rounded border border-[#3A4A63]/40 px-2 py-1 text-[12px] font-normal normal-case text-[#16243D] disabled:bg-slate-100 disabled:text-slate-400"
      />
    ) : (
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="rounded border border-[#3A4A63]/40 px-2 py-1 text-[12px] font-normal normal-case text-[#16243D] disabled:bg-slate-100 disabled:text-slate-400"
      />
    )}
  </label>
);

const DragDropEditor = ({ form, setForm }) => {
  const addBucket = () => setForm(f => ({ ...f, buckets: [...f.buckets, { key: `b${f.buckets.length + 1}`, label: "" }] }));
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { id: `i${f.items.length + 1}`, text: "", bucket: f.buckets[0]?.key || "" }] }));
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Buckets</p>
        {form.buckets.map((bucket, index) => (
          <div key={index} className="mt-1 flex items-center gap-2">
            <input value={bucket.key} onChange={e => setForm(f => ({ ...f, buckets: f.buckets.map((b, i) => (i === index ? { ...b, key: e.target.value } : b)) }))} className="w-16 rounded border border-[#3A4A63]/40 px-1.5 py-1 text-[12px]" />
            <input
              value={bucket.label}
              onChange={e => setForm(f => ({ ...f, buckets: f.buckets.map((b, i) => (i === index ? { ...b, label: e.target.value } : b)) }))}
              placeholder="Bucket label"
              className="flex-1 rounded border border-[#3A4A63]/40 px-2 py-1 text-[12px]"
            />
            <button type="button" onClick={() => setForm(f => ({ ...f, buckets: f.buckets.filter((_, i) => i !== index) }))} className="text-[11px] text-[#FF6B5B]">
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addBucket} className="mt-1 text-[11px] font-semibold text-[#34D399] underline">
          + Add bucket
        </button>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Items</p>
        {form.items.map((item, index) => (
          <div key={index} className="mt-1 flex items-center gap-2">
            <input value={item.text} onChange={e => setForm(f => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, text: e.target.value } : it)) }))} placeholder="Item text" className="flex-1 rounded border border-[#3A4A63]/40 px-2 py-1 text-[12px]" />
            <select value={item.bucket} onChange={e => setForm(f => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, bucket: e.target.value } : it)) }))} className="rounded border border-[#3A4A63]/40 px-1.5 py-1 text-[12px]">
              <option value="">— bucket —</option>
              {form.buckets.map(b => (
                <option key={b.key} value={b.key}>
                  {b.label || b.key}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== index) }))} className="text-[11px] text-[#FF6B5B]">
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addItem} className="mt-1 text-[11px] font-semibold text-[#34D399] underline">
          + Add item
        </button>
      </div>
    </div>
  );
};

// SPEC 3.3: items[] is authored already in the correct order — the player
// shuffles it before first render. correctOrder is derived from item order
// here rather than edited separately, matching how the seed itself works.
const SequenceEditor = ({ form, setForm }) => {
  const move = (index, delta) =>
    setForm(f => {
      const items = [...f.items];
      const target = index + delta;
      if (target < 0 || target >= items.length) return f;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...f, items, correctOrder: items.map(i => i.id) };
    });
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { id: `s${f.items.length + 1}`, text: "" }], correctOrder: [...f.items.map(i => i.id), `s${f.items.length + 1}`] }));
  const removeItem = index =>
    setForm(f => {
      const items = f.items.filter((_, i) => i !== index);
      return { ...f, items, correctOrder: items.map(i => i.id) };
    });

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Steps, already in the correct order</p>
      {form.items.map((item, index) => (
        <div key={index} className="mt-1 flex items-center gap-2">
          <span className="w-5 text-[11px] text-slate-400">{index + 1}</span>
          <input
            value={item.text}
            onChange={e => setForm(f => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, text: e.target.value } : it)) }))}
            placeholder="Step text"
            className="flex-1 rounded border border-[#3A4A63]/40 px-2 py-1 text-[12px]"
          />
          <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="text-[11px] disabled:opacity-30">
            ↑
          </button>
          <button type="button" onClick={() => move(index, 1)} disabled={index === form.items.length - 1} className="text-[11px] disabled:opacity-30">
            ↓
          </button>
          <button type="button" onClick={() => removeItem(index)} className="text-[11px] text-[#FF6B5B]">
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={addItem} className="mt-1 text-[11px] font-semibold text-[#34D399] underline">
        + Add step
      </button>
    </div>
  );
};

const SidesEditor = ({ form, setForm }) => (
  <div>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sides (label + fallback parameter list, shown if the clip fails)</p>
    {form.sides.map((side, index) => (
      <div key={index} className="mt-2 rounded border border-[#3A4A63]/30 p-2">
        <input
          value={side.label}
          onChange={e => setForm(f => ({ ...f, sides: f.sides.map((s, i) => (i === index ? { ...s, label: e.target.value } : s)) }))}
          placeholder="Side label"
          className="mb-1 w-full rounded border border-[#3A4A63]/40 px-2 py-1 text-[12px] font-semibold"
        />
        <textarea
          value={(side.parameters || []).join("\n")}
          onChange={e => setForm(f => ({ ...f, sides: f.sides.map((s, i) => (i === index ? { ...s, parameters: e.target.value.split("\n") } : s)) }))}
          placeholder="One fallback parameter per line"
          rows={2}
          className="w-full rounded border border-[#3A4A63]/40 px-2 py-1 text-[12px]"
        />
      </div>
    ))}
  </div>
);

const HotspotsEditor = ({ form, setForm }) => {
  const addHotspot = () => setForm(f => ({ ...f, hotspots: [...f.hotspots, { tStart: 0, tEnd: 1, x: 0.5, y: 0.5, r: 0.1, isError: false, label: "" }] }));
  const update = (index, key, value) => setForm(f => ({ ...f, hotspots: f.hotspots.map((h, i) => (i === index ? { ...h, [key]: value } : h)) }));
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hotspots (x/y/r as a fraction of the frame, 0–1)</p>
      {form.hotspots.map((hotspot, index) => (
        <div key={index} className="mt-2 grid grid-cols-3 gap-1.5 rounded border border-[#3A4A63]/30 p-2 sm:grid-cols-6">
          <input value={hotspot.label} onChange={e => update(index, "label", e.target.value)} placeholder="label" className="col-span-2 rounded border border-[#3A4A63]/40 px-1.5 py-1 text-[11px] sm:col-span-1" />
          {["tStart", "tEnd", "x", "y", "r"].map(field => (
            <input
              key={field}
              type="number"
              step="any"
              value={hotspot[field]}
              onChange={e => update(index, field, Number(e.target.value))}
              placeholder={field}
              className="rounded border border-[#3A4A63]/40 px-1.5 py-1 text-[11px]"
            />
          ))}
          <button type="button" onClick={() => setForm(f => ({ ...f, hotspots: f.hotspots.filter((_, i) => i !== index) }))} className="col-span-3 text-[11px] text-[#FF6B5B] sm:col-span-6">
            Remove hotspot
          </button>
        </div>
      ))}
      <button type="button" onClick={addHotspot} className="mt-1 text-[11px] font-semibold text-[#34D399] underline">
        + Add hotspot
      </button>
    </div>
  );
};

export const QuestionBuilder = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const location = useLocation();

  const [levels, setLevels] = useState(null);
  const [form, setForm] = useState(emptyForm(searchParams.get("levelKey") || ""));
  const [existingStatus, setExistingStatus] = useState(null);
  const [error, setError] = useState(null);
  const [failures, setFailures] = useState(null);
  // A save that creates or forks navigates to a NEW url (a fresh id) —
  // this component instance unmounts right then, so a notice set right
  // before that navigate would never actually paint. Reading it back out
  // of location.state on the far side is what makes it visible at all —
  // the same fix as auth/SignIn.jsx's "signed out elsewhere" notice, EXCEPT
  // a fork's navigate() goes from /admin/edit-question/:id to the same
  // route pattern with a new :id — React Router reuses this component
  // instance rather than remounting it, so a useState lazy initializer
  // (which only ever runs on first mount) misses it. An effect keyed on
  // `id` catches it on every navigation, first-mount or not.
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (location.state?.notice) setNotice(location.state.notice);
  }, [id, location.state]);

  useEffect(() => {
    getLevels().then(res => setLevels(res.levels)).catch(err => setError(err.message));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    getQuestion(id)
      .then(res => {
        setForm(questionToForm(res.question));
        setExistingStatus(res.question.status);
      })
      .catch(err => setError(err.message));
  }, [id, isEdit]);

  const level = useMemo(() => levels?.find(l => l.key === form.levelKey), [levels, form.levelKey]);
  const isLocked = existingStatus === "locked";

  const buildPayload = status => {
    const payload = { ...form, status };
    if (!usesMedia(form.type)) {
      delete payload.media;
      delete payload.fallbackText;
    } else {
      payload.media = { ...payload.media, durationSeconds: payload.media.durationSeconds === "" ? null : Number(payload.media.durationSeconds) };
    }
    if (!usesOptions(form.type)) {
      delete payload.options;
      delete payload.correct;
    }
    return payload;
  };

  const save = async status => {
    setError(null);
    setFailures(null);
    setNotice(null);

    if (isLocked) {
      const confirmed = window.confirm(
        "This question is LOCKED — the study is currently running on it.\n\nSaving will NOT overwrite it. It will create a new version (forked from this one) and leave the current version exactly as it is, still referenced by every response already recorded against it.\n\nContinue?"
      );
      if (!confirmed) return;
    }

    setBusy(true);
    try {
      const payload = buildPayload(status);
      if (isEdit) {
        const res = await updateQuestion(id, payload);
        if (res.forked) {
          const forkNotice = `Saved as a new version (forked from the locked question) — now editing v${res.question.version}.`;
          navigate(`/admin/edit-question/${res.question.questionId}`, { replace: true, state: { notice: forkNotice } });
        } else {
          setNotice(status === "published" ? "Published." : "Saved as draft.");
          setExistingStatus(res.question.status);
        }
      } else {
        const res = await createQuestion(payload);
        const createNotice = status === "published" ? "Created and published." : "Created as draft.";
        navigate(`/admin/edit-question/${res.question.questionId}`, { replace: true, state: { notice: createNotice } });
      }
    } catch (err) {
      if (err.code === "VALIDATION_FAILED") {
        try {
          setFailures(JSON.parse(err.message));
        } catch {
          setError(err.message);
        }
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFF7ED] text-[#16243D]">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#3A4A63]/20 bg-[#FFF7ED]/95 px-4 py-3 backdrop-blur">
        <div>
          <Link to="/admin" className="text-[11px] underline">
            ← Question bank
          </Link>
          <h1 className="text-lg font-semibold" style={{ fontFamily: "Fredoka, sans-serif" }}>
            {isEdit ? "Edit question" : "New question"}
          </h1>
        </div>
        <button type="button" onClick={() => setShowPreview(true)} data-testid="preview-as-player" className="rounded-md border border-[#3A4A63]/40 px-3 py-1.5 text-[13px] font-semibold text-[#16243D] hover:bg-white">
          Preview as player
        </button>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6">
        {isLocked && (
          <p className="mb-4 rounded-md border border-[#FFC94A] bg-[#FFC94A]/10 px-3 py-2 text-[12px] text-[#16243D]">
            🔒 Locked — the study is running on this question. Saving will fork a new version rather than overwrite it.
          </p>
        )}
        {error && <p className="mb-4 rounded-md bg-[#FF6B5B]/10 px-3 py-2 text-[12px] text-[#FF6B5B]">{error}</p>}
        {notice && <p className="mb-4 rounded-md bg-[#34D399]/10 px-3 py-2 text-[12px] text-[#16243D]">{notice}</p>}
        {failures && (
          <div className="mb-4 rounded-md border border-[#FF6B5B] bg-[#FF6B5B]/10 px-3 py-2 text-[12px] text-[#16243D]" data-testid="validation-failures">
            <p className="font-semibold text-[#FF6B5B]">Cannot publish — {failures.length} check{failures.length === 1 ? "" : "s"} failed:</p>
            <ul className="mt-1 list-disc pl-4">
              {failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Top block — never changes with type (SPEC 4.5). */}
        <div className="flex flex-col gap-3 rounded-md border border-[#3A4A63]/20 bg-white/60 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Level
              <select data-testid="field-levelKey" value={form.levelKey} disabled={isEdit} onChange={e => setForm(f => ({ ...f, levelKey: e.target.value, objective: "" }))} className="rounded border border-[#3A4A63]/40 px-2 py-1.5 text-[12px] font-normal normal-case text-[#16243D] disabled:opacity-60">
                <option value="">— choose a level —</option>
                {(levels || []).map(l => (
                  <option key={l.key} value={l.key}>
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Type
              <select data-testid="field-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="rounded border border-[#3A4A63]/40 px-2 py-1.5 text-[12px] font-normal normal-case text-[#16243D]">
                {QUESTION_TYPES.map(t => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Objective
            <select data-testid="field-objective" value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} className="rounded border border-[#3A4A63]/40 px-2 py-1.5 text-[12px] font-normal normal-case text-[#16243D]">
              <option value="">— choose an objective from this level —</option>
              {(level?.objectives || []).map(o => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>

          <LabeledInput label="Title" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} />
          <LabeledInput label="Scenario (optional)" value={form.scenario} onChange={v => setForm(f => ({ ...f, scenario: v }))} textarea />
          <LabeledInput label="Prompt" value={form.prompt} onChange={v => setForm(f => ({ ...f, prompt: v }))} textarea />
          <LabeledInput
            label={form.type === "interlude" ? "Points (always 0 — interlude is unscored)" : "Points"}
            type="number"
            value={form.type === "interlude" ? 0 : form.points}
            onChange={v => setForm(f => ({ ...f, points: Number(v) }))}
            disabled={form.type === "interlude"}
          />
        </div>

        {/* Middle block — swaps by type, but nothing above ever moves. */}
        <div className="mt-4 flex flex-col gap-4 rounded-md border border-[#3A4A63]/20 bg-white/60 p-3">
          {usesMedia(form.type) && <MediaFieldsEditor form={form} setForm={setForm} />}
          {form.type === "drag_drop" && <DragDropEditor form={form} setForm={setForm} />}
          {form.type === "sequence" && <SequenceEditor form={form} setForm={setForm} />}
          {form.type === "split_screen" && <SidesEditor form={form} setForm={setForm} />}
          {form.type === "hotspot_video" && <HotspotsEditor form={form} setForm={setForm} />}
          {usesOptions(form.type) && <OptionsEditor form={form} setForm={setForm} />}
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-md border border-[#3A4A63]/20 bg-white/60 p-3">
          <LabeledInput label="Feedback text" value={form.feedback.text} onChange={v => setForm(f => ({ ...f, feedback: { ...f.feedback, text: v } }))} textarea />
          <LabeledInput label="Feedback video URL (optional)" value={form.feedback.videoUrl} onChange={v => setForm(f => ({ ...f, feedback: { ...f.feedback, videoUrl: v } }))} />
          <LabeledInput
            label="Feedback video URL (side B, optional — shown side by side with the one above)"
            value={form.feedback.videoUrlB}
            onChange={v => setForm(f => ({ ...f, feedback: { ...f.feedback, videoUrlB: v } }))}
          />
          <LabeledInput label="Feedback image URL (optional)" value={form.feedback.imageUrl} onChange={v => setForm(f => ({ ...f, feedback: { ...f.feedback, imageUrl: v } }))} />
          <LabeledInput label="Authoring note (optional, internal)" value={form.authoringNote} onChange={v => setForm(f => ({ ...f, authoringNote: v }))} textarea />
        </div>

        <div className="mt-6 flex gap-2">
          <button type="button" data-testid="save-draft" disabled={busy || !form.levelKey} onClick={() => save("draft")} className="flex-1 rounded-md border border-[#3A4A63]/40 px-4 py-2.5 text-sm font-semibold text-[#16243D] disabled:opacity-50">
            Save as draft
          </button>
          <button type="button" data-testid="publish" disabled={busy || !form.levelKey} onClick={() => save("published")} className="flex-1 rounded-md bg-[#34D399] px-4 py-2.5 text-sm font-semibold text-[#16243D] disabled:opacity-50">
            {isLocked ? "Save (forks a version)" : "Publish"}
          </button>
        </div>
      </div>

      {showPreview && <QuestionPreview form={form} onClose={() => setShowPreview(false)} />}
    </div>
  );
};
