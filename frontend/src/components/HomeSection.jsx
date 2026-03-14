import "./HomeSection.css";
import useScrollReveal from "../hooks/useScrollReveal";

export default function HomeSection() {
  useScrollReveal(); 

  return (
    <section id="home" className="home-section">
      {/* HERO SECTION */}
      <div className="hero">
        <div
          className="hero-bg hero-bg-static"
          style={{ backgroundImage: "url(/gravity.jpeg)" }}
        />

        <div className="hero-overlay" />

        <div className="hero-content">
          <h1>St. Phillip’s <span>Equatorial SS</span></h1>
          <p>Excellence in Academics, Discipline and Character</p>
          <div className="hero-divider" />
        </div>
      </div>

      {/* INSTITUTIONAL PROFILE & WELCOME */}
      <div className="welcome-container">
        <div className="home-content reveal">
          {/* Label Header */}
          <div className="profile-label">
            <span className="dot"></span>
            INSTITUTIONAL PROFILE
          </div>
          
          <h2 className="welcome-title">Welcome to Our School</h2>

          <div className="profile-body">
            <p className="lead-text">
              St. Phillip’s Equatorial Secondary School stands as a beacon of high-quality 
              education, fostering an environment where young minds are nurtured into 
              the leaders of tomorrow.
            </p>

            <div className="profile-details">
              <p>
                Founded on the pillars of rigorous academic standards and moral integrity, 
                our holistic approach combines cutting-edge technology with traditional values. 
                We ensure every student is equipped for the complexities of the modern world.
              </p>
              <p>
                Our campus provides a serene and disciplined atmosphere conducive to 
                discovery, innovation, and personal growth.
              </p>
            </div>
          </div>
        </div>
        <div className="vine-entry">
        <p className="vine-subtext">
            Find out what’s happening around St. Phillip’s
        </p>

          <a href="/vine/login" className="vine-btn-landing">
             🌱 Enter Vine
            </a>
</div>

      </div>
    </section>
  );
}
