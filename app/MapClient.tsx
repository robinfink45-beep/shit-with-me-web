"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
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

  const [searchText, setSearchText] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

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

        .hintCard {
          padding: 12px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.03);
          font-size: 13px;
          opacity: 0.9;
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

        <div className="hintCard">
          <div style={{ fontWeight: 900, marginBottom: 6 }}>So nutzt du die Karte</div>
          <div>1. Ort oben suchen oder direkt auf die Karte tippen.</div>
          <div>2. Dann wird ein neuer Spot markiert.</div>
          <div>3. Im nächsten Schritt bauen wir das Bewertungsfenster, das sich erst dann öffnet.</div>
        </div>

        <div className="bottomActionBar">
          <button
            style={{
              ...buttonStyle,
              opacity: draft ? 1 : 0.5,
              cursor: draft ? "pointer" : "not-allowed",
            }}
            disabled={!draft}
            onClick={() => {
              alert("Im nächsten Schritt öffnet hier das Bewertungsfenster.");
            }}
          >
            Spot bewerten
          </button>
        </div>
      </div>
    </>
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