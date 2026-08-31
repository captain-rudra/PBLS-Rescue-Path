import { useMemo, useRef, useState } from "react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { seededShuffle } from "../../lib/seededShuffle.js";

const Row = ({ id, text, index, locked, tone }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: locked });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`row-${id}`}
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#34D399] ${tone} ${
        isDragging ? "opacity-60" : ""
      } ${locked ? "cursor-default" : "cursor-grab"}`}
    >
      <span className="w-4 text-[10px] font-semibold text-current/70">{index + 1}</span>
      {text}
    </li>
  );
};

// Draggable ordered rows. On confirm, correctly positioned rows lock green
// and misplaced rows stay flagged coral (SPEC 3.3) — the server tells us
// which is which via result.correctOrder, the client never knows in advance.
export const Sequence = ({ question, attemptId, onFirstInteraction, onCommit, result }) => {
  // Seeded items[] is already authored in correctOrder for every question in
  // the current seed — without shuffling, the item is trivial (confirm with
  // no rearrangement needed). Seeded by (attemptId, questionId), not
  // Math.random(), so a mid-question refresh reproduces this same
  // arrangement instead of reshuffling it.
  // Captured once, separately from `order` below: two participants can see
  // the same sequence item pre-shuffled into different starting
  // arrangements, so the response record must carry what THIS participant
  // was shown, not just what they finally submitted — otherwise a wrong
  // answer can't later be told apart from "never touched it" versus
  // "rearranged into a different wrong order" (SPEC 3.3).
  const shownOrderRef = useRef(null);
  const [order, setOrder] = useState(() => {
    const shuffled = seededShuffle(question.items, `${attemptId}:${question.questionId}`).map(item => item.id);
    shownOrderRef.current = shuffled;
    return shuffled;
  });
  const locked = Boolean(result);
  const textById = useMemo(() => Object.fromEntries(question.items.map(item => [item.id, item.text])), [question.items]);
  const correctOrder = result?.correctOrder;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = ({ active, over }) => {
    if (locked || !over || active.id === over.id) return;
    setOrder(prev => arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id)));
  };

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onFirstInteraction} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-1.5">
            {order.map((id, index) => {
              // Toned rows sit on a light 15%-opacity tint, so they need
              // dark text; the untoned row keeps the dark card + light text.
              let tone = "border-[#3A4A63] bg-[#1E3050] text-[#FFF7ED]";
              if (correctOrder) {
                tone =
                  correctOrder[index] === id
                    ? "border-[#34D399] bg-[#34D399]/15 text-[#16243D]"
                    : "border-[#FF6B5B] bg-[#FF6B5B]/15 text-[#16243D]";
              }
              return <Row key={id} id={id} text={textById[id]} index={index} locked={locked} tone={tone} />;
            })}
          </ol>
        </SortableContext>
      </DndContext>

      {!locked && (
        <button
          type="button"
          data-testid="confirm-sequence"
          onClick={() => onCommit({ order, shownOrder: shownOrderRef.current }).catch(() => {})}
          className="mt-3 rounded-md bg-[#34D399] px-4 py-2 text-sm font-semibold text-[#16243D]"
        >
          Confirm order
        </button>
      )}
    </div>
  );
};
