export default function ActivitiesSection() {
    const images = Array.from({ length: 20 }, (_, i) => `/image${i + 1}.jpg`);
  
    return (
      <section id="activities" style={styles.section}>
        <h2>School Activities</h2>
  
        <div style={styles.grid}>
          {images.map((src, i) => (
            <img key={i} src={src} alt="" style={styles.img} />
          ))}
        </div>
      </section>
    );
  }
  
  const styles = {
    section: {
      minHeight: "100vh",
      padding: "2rem 1rem",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
      gap: "0.7rem",
    },
    img: {
      width: "100%",
      borderRadius: "0.6rem",
      objectFit: "cover",
    },
  };
  