import Map from "./Map";

export default function Home() {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0 }}>💩 Shit With Me</h1>
      <p style={{ marginTop: 6, opacity: 0.8 }}>Unsere gemeinsame Scheißkarte (privat)</p>
      <Map />
    </main>
  );
}