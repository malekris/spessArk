import Navbar from "../components/Navbar";
import HomeSection from "./HomeSection";
import ActivitiesSection from "../components/ActivitiesSection";
import ContactSection from "../components/ContactSection";

export default function LandingPage() {
  return (
    <div style={{ scrollBehavior: "smooth" }}>
      <Navbar />
      <HomeSection />
      <ActivitiesSection />
      <ContactSection />
    </div>
  );
}
