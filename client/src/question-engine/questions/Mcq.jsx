import { useState } from "react";
import { OptionsList } from "../OptionsList.jsx";

// Plain mcq: no media panel, question centred, options in one wide column.
export const Mcq = ({ question, onFirstInteraction, onCommit, result }) => {
  const [chosenKey, setChosenKey] = useState(null);

  return (
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
  );
};
