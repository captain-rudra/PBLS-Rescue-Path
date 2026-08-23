import { useState } from "react";
import Rive, { Layout, Fit } from "@rive-app/react-canvas";
import { OptionsList } from "../OptionsList.jsx";

// Looping Rive scene, no gate — options live immediately (SPEC table 3).
export const AnimationMcq = ({ question, onFirstInteraction, onCommit, result }) => {
  const [chosenKey, setChosenKey] = useState(null);
  const riveSrc = question.media?.riveSrc;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {riveSrc ? (
        <div className="h-40 w-full overflow-hidden rounded-lg bg-[#FFF7ED]">
          <Rive src={riveSrc} layout={new Layout({ fit: Fit.Contain })} className="h-full w-full" />
        </div>
      ) : (
        <div className="flex min-h-[160px] w-full items-center justify-center rounded-lg border border-dashed border-[#3A4A63] bg-[#1E3050] p-4 text-center">
          <p className="text-[13px] text-slate-200">{question.fallbackText}</p>
        </div>
      )}
      <OptionsList
        options={question.options}
        disabled={false}
        pendingKey={chosenKey}
        result={result}
        onSelect={key => {
          if (chosenKey || result) return;
          onFirstInteraction();
          setChosenKey(key);
          onCommit({ selected: key }).catch(() => setChosenKey(null));
        }}
      />
    </div>
  );
};
