// src/App.jsx
import { Routes, Route } from "react-router-dom";

import LoginPage from "./pages/LoginPage";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherDashboard from "./pages/TeacherDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import TeacherSignup from "./pages/TeacherSignup";

import LandingPage from "./components/LandingPage";
import ArkLayout from "./components/ArkLayout";

function App() {
  return (
    <Routes>
    {/* 🌍 Public website */}
    <Route path="/" element={<LandingPage />} />
  
    {/* 🔐 ARK system */}
    <Route
      path="/ark"
      element={
        <ArkLayout>
          <LoginPage />
        </ArkLayout>
      }
    />
  
    <Route
      path="/ark/teacher-login"
      element={
        <ArkLayout>
          <TeacherLogin />
        </ArkLayout>
      }
    />
  
    <Route
      path="/ark/teacher-signup"
      element={
        <ArkLayout>
          <TeacherSignup />
        </ArkLayout>
      }
    />
  
    <Route
      path="/ark/teacher"
      element={
        <ArkLayout>
          <TeacherDashboard />
        </ArkLayout>
      }
    />
  
    <Route
      path="/ark/admin"
      element={
        <ArkLayout>
          <AdminDashboard />
        </ArkLayout>
      }
    />
  </Routes>
  
  );
}

export default App;
