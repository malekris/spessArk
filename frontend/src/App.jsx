// src/App.jsx
import { Suspense, lazy, useEffect } from "react";
import { socket } from "./socket";
import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import TeacherLogin from "./pages/TeacherLogin";
import TeacherForgotPassword from "./pages/TeacherForgotPassword";
import TeacherSignup from "./pages/TeacherSignup";
import LandingPage from "./components/LandingPage";
import ArkLayout from "./components/ArkLayout";
// vine imports
import VineLogin from "./modules/vine/pages/VineLogin";
import VineRegister from "./modules/vine/pages/VineRegister";
import VineProtectedRoute from "./modules/vine/components/VineProtectedRoute";
import VineRouteErrorBoundary from "./modules/vine/components/VineRouteErrorBoundary";
import {
  clearVineAuth,
  getRemainingVineSessionMs,
  getVineToken,
  getVineUser,
  isVineTokenExpired,
} from "./modules/vine/utils/vineAuth";

const TeacherDashboard = lazy(() => import("./pages/TeacherDashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const ALevelDashboard = lazy(() => import("./modules/alevel/pages/ALevelDashboard"));
const ALevelLearners = lazy(() => import("./modules/alevel/pages/ALevelLearners"));
const ALevelAssignSubjects = lazy(() => import("./modules/alevel/pages/ALevelAssignSubjects"));
const ALevelDownloads = lazy(() => import("./modules/alevel/pages/ALevelDownloads"));
const ALevelReports = lazy(() => import("./modules/alevel/pages/ALevelReports"));
const BoardingLogin = lazy(() => import("./modules/boarding/pages/BoardingLogin"));
const BoardingDashboard = lazy(() => import("./modules/boarding/pages/BoardingDashboard"));
const BoardingLearners = lazy(() => import("./modules/boarding/pages/BoardingLearners"));
const BoardingMarks = lazy(() => import("./modules/boarding/pages/BoardingMarks"));
const BoardingReports = lazy(() => import("./modules/boarding/pages/BoardingReports"));
const VineFeed = lazy(() => import("./modules/vine/pages/VineFeed"));
const VineProfile = lazy(() => import("./modules/vine/pages/VineProfile"));
const VineSettings = lazy(() => import("./modules/vine/pages/VineSettings"));
const VineForgotPassword = lazy(() => import("./modules/vine/pages/VineForgotPassword"));
const VineResetPassword = lazy(() => import("./modules/vine/pages/VineResetPassword"));
const VineBirthdayRequired = lazy(() => import("./modules/vine/pages/VineBirthdayRequired"));
const VineFollowers = lazy(() => import("./modules/vine/pages/VineFollowers"));
const VineFollowing = lazy(() => import("./modules/vine/pages/VineFollowing"));
const VineNotifications = lazy(() => import("./modules/vine/pages/VineNotifications"));
const ConversationList = lazy(() => import("./components/dms/ConversationList"));
const ChatWindow = lazy(() => import("./components/dms/ChatWindow"));
const DmsPage = lazy(() => import("./components/dms/DmsPage"));
const VineSuggestions = lazy(() => import("./modules/vine/pages/VineSuggestions"));
const VineSearch = lazy(() => import("./modules/vine/pages/VineSearch"));
const VineVerifyEmail = lazy(() => import("./modules/vine/pages/VineVerifyEmail"));
const VineGuardianAnalytics = lazy(() => import("./modules/vine/pages/VineGuardianAnalytics"));
const VineGuardianModeration = lazy(() => import("./modules/vine/pages/VineGuardianModeration"));
const VineHelpCenter = lazy(() => import("./modules/vine/pages/VineHelpCenter"));
const VineCommunities = lazy(() => import("./modules/vine/pages/VineCommunities"));
const VineLegalPage = lazy(() => import("./modules/vine/pages/VineLegalPage"));
const VinePublicPost = lazy(() => import("./modules/vine/pages/VinePublicPost"));
const VinePublicProfile = lazy(() => import("./modules/vine/pages/VinePublicProfile"));
const VineEntrySplash = lazy(() => import("./modules/vine/pages/VineEntrySplash"));

function RouteLoadingScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background:
          "radial-gradient(circle at top, rgba(16,185,129,0.12), transparent 34%), linear-gradient(180deg, #eefbf2 0%, #f8fdf9 100%)",
      }}
    >
      <div
        style={{
          minWidth: "220px",
          padding: "18px 22px",
          borderRadius: "24px",
          background: "rgba(255,255,255,0.96)",
          border: "1px solid rgba(16,185,129,0.12)",
          boxShadow: "0 20px 48px rgba(15,23,42,0.12)",
          color: "#14532d",
          fontWeight: 900,
          textAlign: "center",
        }}
      >
        Loading SPESS…
      </div>
    </div>
  );
}


function App() {

  useEffect(() => {
    const user = getVineUser();
    const token = getVineToken();
    if (!token || isVineTokenExpired(token) || !user?.id || getRemainingVineSessionMs() <= 0) {
      clearVineAuth();
      socket.disconnect();
      return;
    }
  
    socket.connect();
  
    const handleConnect = () => {
      console.log("🟢 Socket connected:", socket.id);
      socket.emit("register", user.id);
    };
  
    const handleDisconnect = () => {
      console.log("🔴 Socket disconnected");
    };
  
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
  
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);
  

  
  return (
    <Suspense fallback={<RouteLoadingScreen />}>
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
      path="/ark/teacher-forgot"
      element={
        <ArkLayout>
          <TeacherForgotPassword />
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
    <Route path="/ark/boarding-login" element={<ArkLayout><BoardingLogin /></ArkLayout>} />
    <Route path="/ark/boarding" element={<ArkLayout><BoardingDashboard /></ArkLayout>} />
    <Route path="/ark/boarding/learners" element={<ArkLayout><BoardingLearners /></ArkLayout>} />
    <Route path="/ark/boarding/marks" element={<ArkLayout><BoardingMarks /></ArkLayout>} />
    <Route path="/ark/boarding/reports" element={<ArkLayout><BoardingReports /></ArkLayout>} />

{/* 🌱 SPESS VINE */}
<Route path="/vine/enter" element={<VineRouteErrorBoundary><VineEntrySplash /></VineRouteErrorBoundary>} />
<Route path="/vine/login" element={<VineRouteErrorBoundary><VineLogin /></VineRouteErrorBoundary>} />
<Route path="/vine/register" element={<VineRouteErrorBoundary><VineRegister /></VineRouteErrorBoundary>} />
<Route path="/vine/forgot-password" element={<VineRouteErrorBoundary><VineForgotPassword /></VineRouteErrorBoundary>} />
<Route path="/vine/reset-password" element={<VineRouteErrorBoundary><VineResetPassword /></VineRouteErrorBoundary>} />
<Route path="/vine/verify-email" element={<VineRouteErrorBoundary><VineVerifyEmail /></VineRouteErrorBoundary>} />
<Route path="/vine/post/:id" element={<VineRouteErrorBoundary><VinePublicPost /></VineRouteErrorBoundary>} />
<Route path="/vine/u/:username" element={<VineRouteErrorBoundary><VinePublicProfile /></VineRouteErrorBoundary>} />
<Route element={<VineRouteErrorBoundary><VineProtectedRoute /></VineRouteErrorBoundary>}>
  <Route path="/vine/birthday-required" element={<VineBirthdayRequired />} />
  <Route path="/vine/feed" element={<VineFeed />} />
  <Route path="/vine/profile/:username" element={<VineProfile />} />
  <Route path="/vine/settings" element={<VineSettings />} />
  <Route path="/vine/:username/followers" element={<VineFollowers />} />
  <Route path="/vine/:username/following" element={<VineFollowing />} />
  <Route path="/vine/notifications" element={<VineNotifications />} />
  <Route path="/vine/dms" element={<ConversationList />} />
  <Route path="/vine/dms" element={<DmsPage />} />
  <Route path="/vine/dms/new/:userId" element={<ChatWindow />} />
  <Route path="/vine/dms/:conversationId" element={<ChatWindow />} />
  <Route path="/vine/suggestions" element={<VineSuggestions />} />
  <Route path="/vine/search" element={<VineSearch />} />
  <Route path="/vine/guardian/analytics" element={<VineGuardianAnalytics />} />
  <Route path="/vine/guardian/moderation" element={<VineGuardianModeration />} />
  <Route path="/vine/help" element={<VineHelpCenter />} />
  <Route path="/vine/legal/:page" element={<VineLegalPage />} />
  <Route path="/vine/communities" element={<VineCommunities />} />
  <Route path="/vine/communities/:slug" element={<VineCommunities />} />
</Route>


  </Routes>
  </Suspense>
  
  );
}

export default App;
