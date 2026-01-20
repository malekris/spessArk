// src/App.jsx
import { Routes, Route } from "react-router-dom";

import LoginPage from "./pages/LoginPage";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherDashboard from "./pages/TeacherDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import TeacherSignup from "./pages/TeacherSignup";

import LandingPage from "./components/LandingPage";
import ArkLayout from "./components/ArkLayout";
// A-Level pages (new imports)
import ALevelDashboard from "./modules/alevel/pages/ALevelDashboard";
import ALevelLearners from "./modules/alevel/pages/ALevelLearners";
import ALevelAssignSubjects from "./modules/alevel/pages/ALevelAssignSubjects";
import ALevelDownloads from "./modules/alevel/pages/ALevelDownloads";
import ALevelReports from "./modules/alevel/pages/ALevelReports";

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
   <Route path="/ark/admin/alevel" element={<ArkLayout><ALevelDashboard /></ArkLayout>} />
<Route path="/ark/admin/alevel/learners" element={<ArkLayout><ALevelLearners /></ArkLayout>} />
<Route path="/ark/admin/alevel/assign" element={<ArkLayout><ALevelAssignSubjects /></ArkLayout>} />
<Route path="/ark/admin/alevel/downloads" element={<ArkLayout><ALevelDownloads /></ArkLayout>} />
<Route path="/ark/admin/alevel/reports" element={<ArkLayout><ALevelReports /></ArkLayout>} />


  </Routes>
  
  );
}

export default App;
