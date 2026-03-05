"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngLiteral } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

type Ratings = {
  note1: number;
  note2: number;
  note3: number;
  note4: number;

  hasToiletPaper: boolean;
  soapPresent: boolean;
  dryingPresent: boolean;
  visibleWcDirtPenalty: 0 | 1 | 2 | 3;
  majorFunctionKO: boolean;

  airDrying: boolean;
  singlePlyPaper: boolean;
  contactlessCleaningPossible: boolean;
  seatCleanerAvailable: boolean;
  backgroundMusic: boolean;
};

type Spot = {
  id: string;
  name: string;
  comment: string;
  lat: number;
  lng: number;
  ratings: Ratings;
  score: number;
  createdAt?: any;
};

const defaultCenter: [number, number] = [48.765, 11.423];

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function computeScore(r: Ratings) {
  if (!r.hasToiletPaper) return { score: 0, reason: "Kein Toilettenpapier → 0" };

  let base =
    (clamp(r.note1, 1, 10) +
      clamp(r.note2, 1, 10) +
      clamp(r.note3, 1, 10) +
      clamp(r.note4, 1, 10)) /
    4;

  base -= clamp(r.visibleWcDirtPenalty, 0, 3);

  if (r.airDrying) base -= 1;
  if (r.singlePlyPaper) base -= 1;
  if (r.contactlessCleaningPossible) base += 1;
  if (r.seatCleanerAvailable) base += 1;
  if (r.backgroundMusic) base += 1;

  let score = clamp(base, 0, 10);

  if (!r.soapPresent || !r.dryingPresent) score = Math.min(score, 5);
  if (r.majorFunctionKO) score = Math.min(score, 4);

  return { score: round1(clamp(score, 0, 10)) };
}

const defaultRatings: Ratings = {
  note1: 7,
  note2: 7,
  note3: 7,
  note4: 7,
  hasToiletPaper: true,
  soapPresent: true,
  dryingPresent: true,
  visibleWcDirtPenalty: 0,
  majorFunctionKO: false,
  airDrying: false,
  singlePlyPaper: false,
  contactlessCleaningPossible: false,
  seatCleanerAvailable: false,
  backgroundMusic: false,
};

// ✅ Leaflet-Components dynamisch laden (verhindert SSR/Build Crash)
const LeafletMap = dynamic(async () => {
  const mod = await import("react-leaflet");
  const { MapContainer, TileLayer, Marker, Popup, useMapEvents } = mod;

  function ClickToDraft({ onDraft }: { onDraft: (p: LatLngLiteral) => void }) {
    useMapEvents({
      click(e) {
        onDraft(e.latlng);
      },
    });
    return null;
  }

  return function LeafletMapInner(props: {
    spots: Spot[];
    draft: LatLngLiteral | null;
    onDraft: (p: LatLngLiteral) => void;
  }) {
    return (
      <MapContainer center={defaultCenter} zoom={13} style={{ height: "70vh", width: "100%" }}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickToDraft onDraft={props.onDraft} />

        {props.spots.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={markerIcon}>
            <Popup>
              <b>{s.name}</b>
              <div>Score: {s.score}/10</div>
              {s.comment ? <div>{s.comment}</div> : null}
            </Popup>
          </Marker>
        ))}

        {props.draft ? (
          <Marker position={[props.draft.lat, props.draft.lng]} icon={markerIcon}>
            <Popup>Neuer Spot</Popup>
          </Marker>
        ) : null}
      </MapContainer>
    );
  };
}, { ssr: false });

export default function Map() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [draft, setDraft] = useState<LatLngLiteral | null>(null);

  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState<Ratings>({ ...defaultRatings });

  const preview = useMemo(() => computeScore(ratings), [ratings]);

  // ✅ Live aus Firestore laden
  useEffect(() => {
    const q = query(collection(db, "spots"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Spot[];
      setSpots(list);
    });
  }, []);

  async function saveSpot() {
    if (!draft) return alert("Klick erst auf die Karte.");
    const cleanName = name.trim();
    if (!cleanName) return alert("Bitte Ort/Name eingeben.");

    const { score } = computeScore(ratings);

    await addDoc(collection(db, "spots"), {
      name: cleanName,
      comment: comment.trim(),
      lat: draft.lat,
      lng: draft.lng,
      ratings,
      score,
      createdAt: serverTimestamp(),
    });

    setName("");
    setComment("");
    setRatings({ ...defaultRatings });
    setDraft(null);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
      <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
        <LeafletMap spots={spots} draft={draft} onDraft={setDraft} />
      </div>

      <div style={{ padding: 14, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Neuen Spot eintragen</div>

        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ort/Name" style={inputStyle} />
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Kommentar (optional)" style={inputStyle} />

        <div style={sectionTitle}>4 Noten (1–10)</div>
        <NumberRow label="1. Erster Eindruck" value={ratings.note1} onChange={(v) => setRatings({ ...ratings, note1: v })} />
        <NumberRow label="2. Waschbereich" value={ratings.note2} onChange={(v) => setRatings({ ...ratings, note2: v })} />
        <NumberRow label="3. WC-Kabine" value={ratings.note3} onChange={(v) => setRatings({ ...ratings, note3: v })} />
        <NumberRow label="4. Raumklima & Komfort" value={ratings.note4} onChange={(v) => setRatings({ ...ratings, note4: v })} />

        <div style={sectionTitle}>Harte Regeln / K.O.</div>
        <ToggleRow label="Toilettenpapier vorhanden?" checked={ratings.hasToiletPaper} onChange={(c) => setRatings({ ...ratings, hasToiletPaper: c })} />
        <ToggleRow label="Seife vorhanden?" checked={ratings.soapPresent} onChange={(c) => setRatings({ ...ratings, soapPresent: c })} />
        <ToggleRow label="Trocknung vorhanden?" checked={ratings.dryingPresent} onChange={(c) => setRatings({ ...ratings, dryingPresent: c })} />
        <SelectRow label="Sichtbare WC-Verschmutzung" value={ratings.visibleWcDirtPenalty} onChange={(v) => setRatings({ ...ratings, visibleWcDirtPenalty: v })} />
        <ToggleRow label="Funktions-K.O." checked={ratings.majorFunctionKO} onChange={(c) => setRatings({ ...ratings, majorFunctionKO: c })} />

        <div style={sectionTitle}>Bedingungen</div>
        <ToggleRow label="Lufttrocknung (−1)" checked={ratings.airDrying} onChange={(c) => setRatings({ ...ratings, airDrying: c })} />
        <ToggleRow label="Einlagiges Papier (−1)" checked={ratings.singlePlyPaper} onChange={(c) => setRatings({ ...ratings, singlePlyPaper: c })} />
        <ToggleRow label="Kontaktlos reinigen (+1)" checked={ratings.contactlessCleaningPossible} onChange={(c) => setRatings({ ...ratings, contactlessCleaningPossible: c })} />
        <ToggleRow label="Klobrillen-Reiniger (+1)" checked={ratings.seatCleanerAvailable} onChange={(c) => setRatings({ ...ratings, seatCleanerAvailable: c })} />
        <ToggleRow label="Musik (+1)" checked={ratings.backgroundMusic} onChange={(c) => setRatings({ ...ratings, backgroundMusic: c })} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>Vorschau: {preview.score}/10</div>
          <button onClick={saveSpot} style={buttonStyle}>Spot speichern</button>
        </div>
      </div>
    </div>
  );
}

function NumberRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 13, opacity: 0.9 }}>{label}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input type="range" min={1} max={10} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%" }} />
        <div style={{ width: 34, textAlign: "right", fontWeight: 900 }}>{value}</div>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 13, opacity: 0.9 }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function SelectRow({ label, value, onChange }: { label: string; value: 0 | 1 | 2 | 3; onChange: (v: 0 | 1 | 2 | 3) => void }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 13, opacity: 0.9 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value) as any)} style={{ ...inputStyle, cursor: "pointer" }}>
        <option value={0}>Keine</option>
        <option value={1}>-1 Punkt</option>
        <option value={2}>-2 Punkte</option>
        <option value={3}>-3 Punkte</option>
      </select>
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.25)",
  color: "white",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "white",
  color: "black",
  fontWeight: 900,
  cursor: "pointer",
};

const sectionTitle: React.CSSProperties = {
  marginTop: 6,
  fontWeight: 900,
  fontSize: 13,
  opacity: 0.95,
};