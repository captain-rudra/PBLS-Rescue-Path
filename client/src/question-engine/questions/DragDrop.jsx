import { useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";

const TRAY_ID = "__tray__";

const Token = ({ id, text, disabled }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      type="button"
      data-testid={`token-${id}`}
      className={`touch-none select-none rounded-md border border-[#3A4A63] bg-[#1E3050] px-3 py-2 text-[12px] text-[#FFF7ED] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#34D399] ${
        isDragging ? "opacity-50" : ""
      } ${disabled ? "cursor-default opacity-70" : "cursor-grab"}`}
    >
      {text}
    </button>
  );
};

// Always rendered on the light 15%-opacity correct/wrong tint (never the
// dark default), so it needs dark text, not the near-white used elsewhere.
const StaticToken = ({ text, tone }) => (
  <div className={`rounded-md border px-2.5 py-1.5 text-[12px] text-[#16243D] ${tone}`}>{text}</div>
);

const Bucket = ({ id, label, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-testid={`bucket-${id}`}
      className={`min-h-[96px] rounded-lg border-2 border-dashed p-2 transition ${
        isOver ? "border-[#34D399] bg-[#34D399]/10" : "border-[#3A4A63] bg-[#1E3050]"
      }`}
    >
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
};

// Token tray plus labelled buckets. Scoring is per token, not all-or-nothing
// (SPEC 3.2) — the server tells us that back via result.correctPlacements.
export const DragDrop = ({ question, onFirstInteraction, onCommit, result }) => {
  const [placements, setPlacements] = useState({});
  const locked = Boolean(result);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  const itemsByBucket = useMemo(() => {
    const map = { [TRAY_ID]: [] };
    for (const bucket of question.buckets) map[bucket.key] = [];
    for (const item of question.items) {
      const bucketKey = placements[item.id] || TRAY_ID;
      (map[bucketKey] ||= []).push(item);
    }
    return map;
  }, [placements, question.buckets, question.items]);

  const allPlaced = question.items.every(item => placements[item.id]);
  const correctPlacements = result?.correctPlacements;

  const handleDragEnd = ({ active, over }) => {
    if (locked || !over) return;
    const bucketKey = over.id === TRAY_ID ? undefined : String(over.id);
    setPlacements(prev => {
      const next = { ...prev };
      if (bucketKey) next[active.id] = bucketKey;
      else delete next[active.id];
      return next;
    });
  };

  const renderBucketItem = (item, bucketKey) => {
    if (!locked) return <Token key={item.id} id={item.id} text={item.text} disabled={false} />;
    const isCorrect = correctPlacements[item.id] === bucketKey;
    const correctLabel = question.buckets.find(b => b.key === correctPlacements[item.id])?.label;
    return (
      <div key={item.id}>
        <StaticToken text={item.text} tone={isCorrect ? "border-[#34D399] bg-[#34D399]/15" : "border-[#FF6B5B] bg-[#FF6B5B]/15"} />
        {!isCorrect && <p className="mt-0.5 text-[10px] text-slate-600">belongs in {correctLabel}</p>}
      </div>
    );
  };

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onFirstInteraction} onDragEnd={handleDragEnd}>
        <Bucket id={TRAY_ID} label="Unplaced">
          {itemsByBucket[TRAY_ID].map(item => (
            <Token key={item.id} id={item.id} text={item.text} disabled={locked} />
          ))}
        </Bucket>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {question.buckets.map(bucket => (
            <Bucket key={bucket.key} id={bucket.key} label={bucket.label}>
              {itemsByBucket[bucket.key].map(item => renderBucketItem(item, bucket.key))}
            </Bucket>
          ))}
        </div>
      </DndContext>

      {!locked && (
        <button
          type="button"
          data-testid="confirm-drag"
          disabled={!allPlaced}
          onClick={() => onCommit({ placements }).catch(() => {})}
          className="mt-3 rounded-md bg-[#34D399] px-4 py-2 text-sm font-semibold text-[#16243D] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Confirm placement
        </button>
      )}
    </div>
  );
};
