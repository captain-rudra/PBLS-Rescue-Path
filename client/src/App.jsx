import { Routes, Route } from "react-router-dom";
import { LevelPicker } from "./LevelPicker.jsx";
import { QuestionEnginePage } from "./question-engine/QuestionEnginePage.jsx";

export const App = () => (
  <Routes>
    <Route path="/" element={<LevelPicker />} />
    <Route path="/play/:levelKey" element={<QuestionEnginePage />} />
  </Routes>
);
