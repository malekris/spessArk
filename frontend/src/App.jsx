// src/App.jsx
import { Routes, Route } from "react-router-dom";

import LoginPage from "./pages/LoginPage";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherDashboard from "./pages/TeacherDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import TeacherSignup from "./pages/TeacherSignup"; // ✅ NEW

function App() {
  return (
    <Routes>
      {/* Main entry (Admin login) */}
      <Route path="/" element={<LoginPage />} />

      {/* Teacher auth */}
      <Route path="/teacher-login" element={<TeacherLogin />} />
      <Route path="/teacher-signup" element={<TeacherSignup />} />

      {/* Dashboards */}
      <Route path="/teacher" element={<TeacherDashboard />} />
      <Route path="/admin" element={<AdminDashboard />} />
    </Routes>
  );
}

export default App;
