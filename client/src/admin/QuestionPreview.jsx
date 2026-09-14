import { useState } from "react";
import { QUESTION_COMPONENTS } from "../question-engine/questions/index.js";

// SPEC 4.5: "Preview as player" opens the REAL game component with the
// current draft — the same components client/src/question-engine renders
// during live play, fed this draft instead of a served attempt question.
// This is what actually catches a scenario overrunning the panel or a
// hotspot placed off-frame; a bespoke preview renderer could look right
// and still not match what a participant would really see.
//
// Nothing here calls the API. `onCommit` is stubbed to compute
// correct/incorrect locally against the draft's own answer key and hand
// the type component a `result` object shaped exactly like the real
// server's response.feedback (see server/src/routes/play/responses.js),
// so the same correct/wrong rendering the live game uses lights up here.
const scoreLocally = (form, given) => {
  if (form.type === "drag_drop") {
    const correctPlacements = Object.fromEntries(form.items.map(item => [item.id, item.bucket]));
    const isCorrect = form.items.every(item => given.placements[item.id] === item.bucket);
    return { isCorrect, correctPlacements };
  }
  if (form.type === "sequence") {
    const correctOrder = form.items.map(item => item.id);
    const isCorrect = correctOrder.length === given.order.length && correctOrder.every((id, index) => given.order[index] === id);
    return { isCorrect, correctOrder };
  }
  return { isCorrect: given.selected === form.correct, correct: form.correct };
};

const formToPreviewQuestion = form => ({
  questionId: "preview",
  levelKey: form.levelKey,
  type: form.type,
  title: form.title,
  objective: form.objective,
  scenario: form.scenario || null,
  prompt: form.prompt,
  media: form.media,
  fallbackText: form.fallbackText,
  options: form.options,
  buckets: form.buckets,
  items: form.items,
  hotspots: form.hotspots,
  sides: form.sides,
  points: form.points
});

export const QuestionPreview = ({ form, onClose }) => {
  const [result, setResult] = useState(null);
  const TypeComponent = QUESTION_COMPONENTS[form.type];
  const question = formToPreviewQuestion(form);

  const onCommit = given => {
    const scored = scoreLocally(form, given);
    setResult({ given, ...scored, text: form.feedback.text, videoUrl: form.feedback.videoUrl || null, imageUrl: form.feedback.imageUrl || null });
    return Promise.resolve({ isCorrect: scored.isCorrect, partialScore: 0, feedback: { text: form.feedback.text } });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="mt-8 w-full max-w-3xl rounded-lg bg-[#FFF7ED] p-4 text-[#16243D]" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Preview as player — nothing here is saved or scored</p>
          <button type="button" onClick={onClose} data-testid="close-preview" className="rounded-md bg-[#34D399] px-3 py-1 text-[12px] font-semibold text-[#16243D]">
            Close
          </button>
        </div>

        <p className="text-[10px] uppercase tracking-wide text-slate-400">{form.title || "(untitled)"}</p>
        {form.scenario && <p className="mt-1 text-[12px] italic text-slate-500">{form.scenario}</p>}
        <h2 className="mt-1 text-[15px] font-semibold">{form.prompt || "(no prompt yet)"}</h2>

        <div className="mt-4">
          {TypeComponent ? (
            <TypeComponent question={question} attemptId="preview" onFirstInteraction={() => {}} onCommit={onCommit} result={result} />
          ) : (
            <p className="text-sm text-[#FF6B5B]">Unsupported type: {form.type}</p>
          )}
        </div>

        {result && (
          <div className="mt-4 rounded-md bg-[#1E3050]/10 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Feedback</p>
            <p className="mt-0.5 text-[12px] leading-relaxed">{form.feedback.text || "(no feedback text yet)"}</p>
            {form.feedback.imageUrl && (
              <img data-testid="preview-feedback-image" src={form.feedback.imageUrl} alt="Feedback illustration" className="mt-2 max-h-56 w-full rounded-md bg-black object-contain" />
            )}
            {form.feedback.videoUrl && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video data-testid="preview-feedback-video" src={form.feedback.videoUrl} controls className="mt-2 max-h-56 w-full rounded-md bg-black" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
