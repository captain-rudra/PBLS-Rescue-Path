import { useState } from "react";
import { MediaFrame } from "../MediaFrame.jsx";
import { OptionsList } from "../OptionsList.jsx";
import { useMediaGate } from "../../hooks/useMediaGate.js";

// Gated player left, options right. Replay allowed after the gate opens.
export const VideoMcq = ({ question, onFirstInteraction, onCommit, result }) => {
  const gate = useMediaGate(question.media);
  const [chosenKey, setChosenKey] = useState(null);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MediaFrame media={question.media || {}} fallbackText={question.fallbackText} gate={gate} onInteract={onFirstInteraction} />
      <OptionsList
        options={question.options}
        disabled={!gate.satisfied}
        pendingKey={chosenKey}
        result={result}
        onSelect={key => {
          if (!gate.satisfied || chosenKey || result) return;
          onFirstInteraction();
          setChosenKey(key);
          onCommit({ selected: key }, { mediaReplays: gate.replays }).catch(() => setChosenKey(null));
        }}
      />
    </div>
  );
};
