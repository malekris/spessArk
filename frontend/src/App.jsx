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
// vine imports 
import VineLogin from "./modules/vine/pages/VineLogin";
import VineRegister from "./modules/vine/pages/VineRegister";
import VineFeed from "./modules/vine/pages/VineFeed";
import VineProfile from "./modules/vine/pages/VineProfile";
import VineForgotPassword from "./modules/vine/pages/VineForgotPassword";
import VineResetPassword from "./modules/vine/pages/VineResetPassword";
import VineFollowers from "./modules/vine/pages/VineFollowers";
import VineFollowing from "./modules/vine/pages/VineFollowing";

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

{/* 🌱 SPESS VINE */}
<Route path="/vine/login" element={<VineLogin />} />
<Route path="/vine/register" element={<VineRegister />} />
<Route path="/vine/feed" element={<VineFeed />} />
<Route path="/vine/profile/:username" element={<VineProfile />} />
<Route path="/vine/forgot-password" element={<VineForgotPassword />} />
<Route path="/vine/reset-password" element={<VineResetPassword />} />
<Route path="/vine/:username/followers" element={<VineFollowers />} />
<Route path="/vine/:username/following" element={<VineFollowing />} />

  </Routes>
  
  );
}

export default App;
