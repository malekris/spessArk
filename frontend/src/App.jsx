import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherDashboard from "./pages/TeacherDashboard";
import AdminDashboard from "./pages/AdminDashboard";

function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/teacher-login" element={<TeacherLogin />} />
      <Route path="/teacher" element={<TeacherDashboard />} />
      <Route path="/admin" element={<AdminDashboard />} />
    </Routes>
  );
}

export default App;
