import { useEffect } from "react";
import Navbar from "../components/Navbar";
import HomeSection from "./HomeSection";
import SchoolUpdatesSection from "./SchoolUpdatesSection";
import ActivitiesSection from "../components/ActivitiesSection";
import ContactSection from "../components/ContactSection";
import {
  HomepageFaq,
  HomepageStorySections,
  MobileQuickActions,
} from "./HomepageExperience";

export default function LandingPage() {
  useEffect(() => {
    document.title = "St. Phillip’s Equatorial SS";
  }, []);

  return (
    <div className="landing-page" style={{ scrollBehavior: "smooth" }}>
      <Navbar />
      <HomeSection />
      <HomepageStorySections />
      <SchoolUpdatesSection />
      <ActivitiesSection />
      <HomepageFaq />
      <ContactSection />
      <MobileQuickActions />
    </div>
  );
}
