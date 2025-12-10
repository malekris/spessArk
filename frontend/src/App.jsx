// src/App.jsx
import React, { useState } from "react";
import SplashScreen from "./pages/SplashScreen";
import LoginPage from "./pages/LoginPage";
import AdminDashboard from "./pages/AdminDashboard";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherDashboard from "./pages/TeacherDashboard";

function App() {
  // "splash" → "login" → "admin" or "teacherLogin" → "teacherDashboard"
  const [screen, setScreen] = useState("splash");
  const [teacher, setTeacher] = useState(null); // logged-in teacher info

  // called when splash finishes its animation / timeout
  const handleSplashDone = () => {
    setScreen("login");
  };

  // called when the main login page decides which role we are
  // LoginPage should call onLogin("admin") or onLogin("teacher")
  const handleLogin = (role) => {
    if (role === "admin") {
      setScreen("admin");
    } else if (role === "teacher") {
      setScreen("teacherLogin");
    } else {
      alert("Unknown role. Please try again.");
    }
  };

  // called when teacher successfully logs in on TeacherLogin
  const handleTeacherLoginSuccess = (teacherData, token) => {
    setTeacher(teacherData);
    setScreen("teacherDashboard");
  };

  const handleAdminLogout = () => {
    setScreen("login");
  };

  const handleTeacherLogout = () => {
    // clear stored token/profile
    localStorage.removeItem("teacherToken");
    localStorage.removeItem("teacherProfile");
    setTeacher(null);
    setScreen("login");
  };

  // ---- screen routing ----

  if (screen === "splash") {
    return <SplashScreen onDone={handleSplashDone} />;
  }

  if (screen === "login") {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (screen === "admin") {
    return <AdminDashboard onLogout={handleAdminLogout} />;
  }

  if (screen === "teacherLogin") {
    return (
      <TeacherLogin
        onLoginSuccess={handleTeacherLoginSuccess}
        onBackToAdmin={() => setScreen("login")}
      />
    );
  }

  if (screen === "teacherDashboard") {
    return (
      <TeacherDashboard
        teacher={teacher}
        onLogout={handleTeacherLogout}
      />
    );
  }

  return null;
}

export default App;
