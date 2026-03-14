import { useEffect } from "react";
import Navbar from "../components/Navbar";
import HomeSection from "./HomeSection";
import ActivitiesSection from "../components/ActivitiesSection";
import ContactSection from "../components/ContactSection";

export default function LandingPage() {
  useEffect(() => {
    document.title = "St. Phillip’s Equatorial SS";
  }, []);

  return (
    <div style={{ scrollBehavior: "smooth" }}>
      <Navbar />
      <HomeSection />
      <ActivitiesSection />
      <ContactSection />
    </div>
  );
}
