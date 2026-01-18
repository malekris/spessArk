export default function ContactSection() {
    return (
      <section id="contact" style={styles.section}>
        <h2>Contact Us</h2>
  
        <div style={styles.embed}>
          <iframe
            src="https://www.youtube.com/embed/YOUR_VIDEO_ID"
            allowFullScreen
          />
        </div>
  
        <div style={styles.embed}>
          <iframe
            src="https://www.google.com/maps?q=St+Phillips+Equatorial+Secondary+School&output=embed"
            loading="lazy"
          />
        </div>
      </section>
    );
  }
  
  const styles = {
    section: {
      minHeight: "100vh",
      padding: "2rem 1rem",
    },
    embed: {
      marginTop: "1rem",
      aspectRatio: "16 / 9",
    },
  };
  