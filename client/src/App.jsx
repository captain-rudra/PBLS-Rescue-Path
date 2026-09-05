import { useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Dashboard } from "./play/Dashboard.jsx";
import { MissionBriefing } from "./play/MissionBriefing.jsx";
import { LevelReview } from "./play/LevelReview.jsx";
import { QuestionEnginePage } from "./question-engine/QuestionEnginePage.jsx";
import { SignIn } from "./auth/SignIn.jsx";
import { AuthGate } from "./auth/AuthGate.jsx";
import { SIGNED_OUT_EVENT } from "./lib/auth.js";
import { AdminSignIn } from "./admin/AdminSignIn.jsx";
import { AdminAuthGate } from "./admin/AdminAuthGate.jsx";
import { QuestionBank } from "./admin/QuestionBank.jsx";
import { QuestionBuilder } from "./admin/QuestionBuilder.jsx";
import { ADMIN_SIGNED_OUT_EVENT } from "./lib/adminAuth.js";

export const App = () => {
  const navigate = useNavigate();

  // Fired by lib/api.js whenever an authenticated call comes back 401 —
  // token expired, or superseded by a sign-in on another device (SPEC
  // 6.3). Routes back to sign-in from wherever the participant happened
  // to be, rather than leaving them stuck on a screen that can no longer
  // load anything.
  useEffect(() => {
    const onSignedOut = event => {
      const supersededElsewhere = event.detail?.code === "SESSION_SUPERSEDED";
      navigate("/signin", { replace: true, state: { supersededElsewhere } });
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [navigate]);

  // Same mechanism, admin side.
  useEffect(() => {
    const onAdminSignedOut = () => navigate("/admin/signin", { replace: true, state: { supersededElsewhere: true } });
    window.addEventListener(ADMIN_SIGNED_OUT_EVENT, onAdminSignedOut);
    return () => window.removeEventListener(ADMIN_SIGNED_OUT_EVENT, onAdminSignedOut);
  }, [navigate]);

  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route element={<AuthGate />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/briefing/:levelKey" element={<MissionBriefing />} />
        <Route path="/play/:levelKey" element={<QuestionEnginePage />} />
        <Route path="/review/:attemptId" element={<LevelReview />} />
      </Route>

      <Route path="/admin/signin" element={<AdminSignIn />} />
      <Route element={<AdminAuthGate />}>
        <Route path="/admin" element={<QuestionBank />} />
        {/* Deliberately outside /admin/questions/* entirely — anything
            nested there would share a path prefix with the API's own
            /admin/questions and /admin/questions/:id in vite.config.js's
            proxy, the same class of collision the /play proxy comment
            already warns about (a direct navigation or refresh on the
            client route would get forwarded to Express and 404/mismatch
            instead of falling through to the SPA). */}
        <Route path="/admin/new-question" element={<QuestionBuilder />} />
        <Route path="/admin/edit-question/:id" element={<QuestionBuilder />} />
      </Route>
    </Routes>
  );
};
