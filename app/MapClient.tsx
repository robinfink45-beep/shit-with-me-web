"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

type LatLngLiteral = {
  lat: number;
  lng: number;
};

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

function scoreColor(score: number) {
  if (score >= 8) return "#1fd17b";
  if (score >= 6) return "#7bdc3a";
  if (score >= 4) return "#f5c542";
  if (score >= 2) return "#f08c3c";
  return "#ff4d4d";
}

function makeScoreIcon(score: number) {
  const c = scoreColor(score);
  const s = Math.round(score);

  return L.divIcon({
    className: "score-pin",
    html: `
      <div style="
        width: 34px;
        height: 34px;
        border-radius: 999px;
        background: ${c};
        display:flex;
        align-items:center;
        justify-content:center;
        color:#0b0b0b;
        font-weight:900;
        font-size:14px;
        border:2px solid rgba(255,255,255,0.85);
        box-shadow:0 10px 25px rgba(0,0,0,0.35);
      ">${s}</div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function makeDraftIcon() {
  return L.divIcon({
    className: "draft-pin",
    html: `
      <div style="
        width: 34px;
        height: 34px;
        border-radius: 999px;
        background: rgba(255,255,255,0.15);
        display:flex;
        align-items:center;
        justify-content:center;
        color:white;
        font-weight:900;
        font-size:16px;
        border:2px dashed rgba(255,255,255,0.85);
      ">+</div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function ClickToDraft({ onDraft }: { onDraft: (p: LatLngLiteral) => void }) {
  useMapEvents({
    click(e) {
      onDraft({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FlyToController({ flyTo }: { flyTo: LatLngLiteral | null }) {
  const map = useMap();

  useEffect(() => {
    if (!flyTo) return;
    map.flyTo([flyTo.lat, flyTo.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
  }, [flyTo, map]);

  return null;
}

export default function MapClient() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [draft, setDraft] = useState<LatLngLiteral | null>(null);
  const [flyTo, setFlyTo] = useState<LatLngLiteral | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState<Ratings>({ ...defaultRatings });

  const [searchText, setSearchText] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const preview = useMemo(() => computeScore(ratings), [ratings]);

  useEffect(() => {
    const qy = query(collection(db, "spots"), orderBy("createdAt", "desc"));
    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Spot[];
      setSpots(list);
    });
  }, []);

  async function zoomToMyLocation() {
    if (!navigator.geolocation) {
      alert("Geolocation nicht verfügbar.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFlyTo({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      () => {
        alert("Standort konnte nicht abgerufen werden.");
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  async function searchAndZoom() {
    const q = searchText.trim();
    if (!q) return;

    setSearchBusy(true);
    setSearchError(null);

    try {
      const url =
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
        encodeURIComponent(q);

      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error("Suche fehlgeschlagen");

      const data = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (!data.length) {
        setSearchError("Nichts gefunden.");
        return;
      }

      const p = {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
      };

      setFlyTo(p);
      setDraft(p);
    } catch (e: any) {
      setSearchError(e?.message ?? "Fehler bei Suche");
    } finally {
      setSearchBusy(false);
    }
  }

  async function saveSpot() {
    if (!draft) {
      alert("Klick erst auf die Karte oder nutz die Suche.");
      return;
    }

    const cleanName = name.trim();
    if (!cleanName) {
      alert("Bitte Ort/Name eingeben.");
      return;
    }

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
    setIsSheetOpen(false);
  }

  return (
    <>
      <style jsx global>{`
        .mobileMapLayout {
          display: grid;
          gap: 12px;
        }

        .searchBarWrap {
          position: sticky;
          top: 0;
          z-index: 500;
          display: grid;
          gap: 8px;
          padding: 10px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(15, 15, 15, 0.92);
          backdrop-filter: blur(12px);
        }

        .searchRow {
          display: flex;
          gap: 8px;
        }

        .mapWrap {
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .mapCanvas {
          height: 72vh;
          width: 100%;
        }

        .bottomActionBar {
          display: flex;
          gap: 10px;
        }

        .sheetBackdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.45);
          z-index: 999;
        }

        .bottomSheet {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1000;
          max-height: 82vh;
          overflow: auto;
          border-top-left-radius: 22px;
          border-top-right-radius: 22px;
          border: 1px solid rgba(255,255,255,0.12);
          background: #111;
          padding: 16px;
          display: grid;
          gap: 10px;
          box-shadow: 0 -10px 40px rgba(0,0,0,0.45);
        }

        .sheetHandle {
          width: 46px;
          height: 5px;
          border-radius: 999px;
          background: rgba(255,255,255,0.3);
          margin: 0 auto 8px auto;
        }

        @media (max-width: 640px) {
          .mapCanvas {
            height: 78vh;
          }

          .searchRow,
          .bottomActionBar {
            flex-direction: column;
          }

          .searchRow button,
          .bottomActionBar button {
            width: 100%;
          }
        }
      `}</style>

      <div className="mobileMapLayout">
        <div className="searchBarWrap">
          <div className="searchRow">
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder='Ort suchen, z. B. "Aral Ingolstadt" oder Adresse'
              style={{ ...inputStyle, flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") searchAndZoom();
              }}
            />
            <button onClick={searchAndZoom} style={buttonStyle} disabled={searchBusy}>
              {searchBusy ? "..." : "Suchen"}
            </button>
          </div>

          <div className="bottomActionBar">
            <button onClick={zoomToMyLocation} style={buttonGhostStyle}>
              Zu meinem Standort
            </button>
            <button
              onClick={() => setFlyTo({ lat: defaultCenter[0], lng: defaultCenter[1] })}
              style={buttonGhostStyle}
            >
              Zurück zum Start
            </button>
          </div>

          {searchError ? <div style={{ color: "#ff8a8a", fontSize: 12 }}>{searchError}</div> : null}
        </div>

        <div className="mapWrap">
          <MapContainer center={defaultCenter} zoom={13} className="mapCanvas">
            <TileLayer
              attribution="&copy; OpenStreetMap"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToDraft onDraft={setDraft} />
            <FlyToController flyTo={flyTo} />

            {spots.map((s) => (
              <Marker key={s.id} position={[s.lat, s.lng]} icon={makeScoreIcon(s.score)}>
                <Popup>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div>
                      <b style={{ fontSize: 14 }}>{s.name}</b>
                      <div style={{ opacity: 0.85 }}>
                        Score: <b>{s.score}/10</b>
                      </div>
                    </div>
                    {s.comment ? <div style={{ opacity: 0.9 }}>{s.comment}</div> : null}
                  </div>
                </Popup>
              </Marker>
            ))}

            {draft ? (
              <Marker position={[draft.lat, draft.lng]} icon={makeDraftIcon()}>
                <Popup>Neuer Spot ausgewählt</Popup>
              </Marker>
            ) : null}
          </MapContainer>
        </div>

        <div className="bottomActionBar">
          <button
            style={{
              ...buttonStyle,
              opacity: draft ? 1 : 0.5,
              cursor: draft ? "pointer" : "not-allowed",
            }}
            disabled={!draft}
            onClick={() => setIsSheetOpen(true)}
          >
            Spot bewerten
          </button>
        </div>
      </div>

      {isSheetOpen ? (
        <>
          <div className="sheetBackdrop" onClick={() => setIsSheetOpen(false)} />
          <div className="bottomSheet">
            <div className="sheetHandle" />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Spot bewerten</div>
              <button onClick={() => setIsSheetOpen(false)} style={buttonGhostStyle}>
                Schließen
              </button>
            </div>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ort/Name"
              style={inputStyle}
            />
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Kommentar (optional)"
              style={inputStyle}
            />

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
              <button onClick={saveSpot} style={buttonStyle}>
                Speichern
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function NumberRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
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

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 13, opacity: 0.9 }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function SelectRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: 0 | 1 | 2 | 3;
  onChange: (v: 0 | 1 | 2 | 3) => void;
}) {
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
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.25)",
  color: "white",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "white",
  color: "black",
  fontWeight: 900,
  cursor: "pointer",
};

const buttonGhostStyle: React.CSSProperties = {
  padding: "12px 12px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(0,0,0,0.25)",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const sectionTitle: React.CSSProperties = {
  marginTop: 6,
  fontWeight: 900,
  fontSize: 13,
  opacity: 0.95,
};