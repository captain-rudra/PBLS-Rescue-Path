import { Routes, Route } from "react-router-dom";
import { Dashboard } from "./play/Dashboard.jsx";
import { MissionBriefing } from "./play/MissionBriefing.jsx";
import { QuestionEnginePage } from "./question-engine/QuestionEnginePage.jsx";

export const App = () => (
  <Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/briefing/:levelKey" element={<MissionBriefing />} />
    <Route path="/play/:levelKey" element={<QuestionEnginePage />} />
  </Routes>
);
