"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
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
  author?: string;
  lat: number;
  lng: number;
  ratings: Ratings;
  score: number;
  createdAt?: any;
  updatedAt?: any;
};

type NotificationItem = {
  id: string;
  title: string;
  lat: number;
  lng: number;
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

function isPremiumSpot(score: number) {
  return score >= 9;
}

function makeScoreIcon(score: number) {
  if (isPremiumSpot(score)) {
    return L.divIcon({
      className: "gold-pin",
      html: `
        <div style="
          width:48px;
          height:48px;
          display:flex;
          align-items:center;
          justify-content:center;
          border-radius:14px;
          background: linear-gradient(135deg, #ffe082, #ffc107 40%, #ffb300 70%, #ffd54f);
          border: 2px solid rgba(255,245,176,0.95);
          box-shadow:
            0 10px 24px rgba(0,0,0,0.38),
            inset 0 1px 8px rgba(255,255,255,0.7);
          font-size: 24px;
          transform: rotate(-6deg);
        ">
          🏆
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
      popupAnchor: [0, -18],
    });
  }

  const c = scoreColor(score);

  return L.divIcon({
    className: "poop-pin",
    html: `
      <div style="
        width:42px;
        height:42px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:28px;
        line-height:1;
        filter: drop-shadow(0 6px 12px rgba(0,0,0,0.35));
      ">
        <span style="
          display:inline-block;
          transform: translateY(-1px);
          text-shadow:
            0 0 0 ${c},
            0 0 8px rgba(0,0,0,0.18);
        ">💩</span>
      </div>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -18],
  });
}

function makeDraftIcon() {
  return L.divIcon({
    className: "draft-pin",
    html: `
      <div style="
        width:44px;
        height:44px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:28px;
        line-height:1;
        border-radius:999px;
        background: rgba(255,255,255,0.10);
        border: 2px dashed rgba(255,255,255,0.82);
        box-shadow: 0 8px 20px rgba(0,0,0,0.28);
      ">
        📍
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -18],
  });
}

function formatFirestoreDate(value: any) {
  if (!value) return "—";

  try {
    if (typeof value.toDate === "function") {
      return value.toDate().toLocaleString("de-DE");
    }

    if (value.seconds) {
      return new Date(value.seconds * 1000).toLocaleString("de-DE");
    }

    return "—";
  } catch {
    return "—";
  }
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
    map.flyTo([flyTo.lat, flyTo.lng], Math.max(map.getZoom(), 16), {
      duration: 0.6,
    });
  }, [flyTo, map]);

  return null;
}

export default function MapClient() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [draft, setDraft] = useState<LatLngLiteral | null>(null);
  const [flyTo, setFlyTo] = useState<LatLngLiteral | null>(null);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isBellOpen, setIsBellOpen] = useState(false);

  const [editingSpotId, setEditingSpotId] = useState<string | null>(null);

  const [author, setAuthor] = useState("");
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState<Ratings>({ ...defaultRatings });

  const [searchText, setSearchText] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const preview = useMemo(() => computeScore(ratings), [ratings]);

  const firstLoadRef = useRef(true);
  const knownSpotIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const qy = query(collection(db, "spots"), orderBy("createdAt", "desc"));

    return onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Spot[];
      setSpots(list);

      const currentIds = new Set(list.map((s) => s.id));

      if (firstLoadRef.current) {
        knownSpotIdsRef.current = currentIds;
        firstLoadRef.current = false;
        return;
      }

      const newOnes = list.filter((spot) => !knownSpotIdsRef.current.has(spot.id));

      if (newOnes.length > 0) {
        const freshNotifications: NotificationItem[] = newOnes.map((spot) => ({
          id: spot.id,
          title: `${spot.author || "Jemand"} hat ${spot.name} eingetragen`,
          lat: spot.lat,
          lng: spot.lng,
        }));

        setNotifications((prev) => [...freshNotifications, ...prev]);
      }

      knownSpotIdsRef.current = currentIds;
    });
  }, []);

  function resetForm() {
    setEditingSpotId(null);
    setAuthor("");
    setName("");
    setComment("");
    setRatings({ ...defaultRatings });
  }

  function openCreateSheet() {
    if (!draft) {
      alert("Klick erst auf die Karte oder nutz die Suche.");
      return;
    }
    resetForm();
    setIsSheetOpen(true);
  }

  function openEditSheet(spot: Spot) {
    setEditingSpotId(spot.id);
    setDraft({ lat: spot.lat, lng: spot.lng });
    setFlyTo({ lat: spot.lat, lng: spot.lng });

    setAuthor(spot.author ?? "");
    setName(spot.name ?? "");
    setComment(spot.comment ?? "");
    setRatings(spot.ratings ?? { ...defaultRatings });

    setIsBellOpen(false);
    setIsSheetOpen(true);
  }

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

    const cleanAuthor = author.trim();
    const cleanName = name.trim();

    if (!cleanAuthor) {
      alert("Bitte Autor eingeben.");
      return;
    }

    if (!cleanName) {
      alert("Bitte Ort/Name eingeben.");
      return;
    }

    const { score } = computeScore(ratings);

    if (editingSpotId) {
      await updateDoc(doc(db, "spots", editingSpotId), {
        author: cleanAuthor,
        name: cleanName,
        comment: comment.trim(),
        lat: draft.lat,
        lng: draft.lng,
        ratings,
        score,
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, "spots"), {
        author: cleanAuthor,
        name: cleanName,
        comment: comment.trim(),
        lat: draft.lat,
        lng: draft.lng,
        ratings,
        score,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    resetForm();
    setDraft(null);
    setIsSheetOpen(false);
  }

  function openNotification(item: NotificationItem) {
    setFlyTo({ lat: item.lat, lng: item.lng });
    setIsBellOpen(false);
  }

  function clearNotifications() {
    setNotifications([]);
    setIsBellOpen(false);
  }

  return (
    <>
      <style jsx global>{`
        .mobileMapLayout {
          display: grid;
          gap: 12px;
        }

        .topBar {
          position: sticky;
          top: 0;
          z-index: 500;
          display: grid;
          gap: 10px;
          padding: 10px;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(15, 15, 15, 0.92);
          backdrop-filter: blur(14px);
        }

        .topBarHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .brandTitle {
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 0.2px;
        }

        .searchRow {
          display: flex;
          gap: 8px;
        }

        .mapWrap {
          border-radius: 20px;
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
          max-height: 84vh;
          overflow: auto;
          border-top-left-radius: 24px;
          border-top-right-radius: 24px;
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

        .popupMeta {
          font-size: 12px;
          opacity: 0.75;
          display: grid;
          gap: 2px;
          margin-top: 4px;
        }

        .premiumBadge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          background: linear-gradient(135deg, #ffe082, #ffca28);
          color: #1a1200;
          font-weight: 900;
          font-size: 12px;
          border: 1px solid rgba(255, 245, 176, 0.95);
        }

        .bellWrap {
          position: relative;
        }

        .bellButton {
          position: relative;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(0,0,0,0.25);
          color: white;
          font-size: 20px;
          cursor: pointer;
        }

        .bellBadge {
          position: absolute;
          top: -6px;
          right: -6px;
          min-width: 22px;
          height: 22px;
          padding: 0 6px;
          border-radius: 999px;
          background: #ff4d4d;
          color: white;
          font-size: 12px;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #111;
        }

        .bellDropdown {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: min(340px, 88vw);
          max-height: 320px;
          overflow: auto;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.12);
          background: #111;
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
          padding: 10px;
          display: grid;
          gap: 8px;
          z-index: 900;
        }

        .notificationItem {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
          color: white;
          text-align: left;
          cursor: pointer;
        }

        .notificationEmpty {
          padding: 10px 12px;
          opacity: 0.7;
          font-size: 13px;
        }

        .miniText {
          font-size: 12px;
          opacity: 0.72;
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
        <div className="topBar">
          <div className="topBarHeader">
            <div>
              <div className="brandTitle">💩 Shit With Me</div>
              <div className="miniText">Finde, bewerte und update eure Spots</div>
            </div>

            <div className="bellWrap">
              <button className="bellButton" onClick={() => setIsBellOpen((v) => !v)}>
                🔔
                {notifications.length > 0 ? (
                  <span className="bellBadge">{notifications.length}</span>
                ) : null}
              </button>

              {isBellOpen ? (
                <div className="bellDropdown">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ fontWeight: 900 }}>Benachrichtigungen</div>
                    {notifications.length > 0 ? (
                      <button onClick={clearNotifications} style={{ ...buttonGhostStyle, padding: "8px 10px" }}>
                        Leeren
                      </button>
                    ) : null}
                  </div>

                  {notifications.length === 0 ? (
                    <div className="notificationEmpty">Keine neuen Benachrichtigungen.</div>
                  ) : (
                    notifications.map((item) => (
                      <button
                        key={item.id}
                        className="notificationItem"
                        onClick={() => openNotification(item)}
                      >
                        {item.title}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>

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
                  <div style={{ display: "grid", gap: 8, minWidth: 200 }}>
                    <div>
                      <b style={{ fontSize: 15 }}>{s.name}</b>
                      <div style={{ opacity: 0.85 }}>
                        Score: <b>{s.score}/10</b>
                      </div>
                    </div>

                    {isPremiumSpot(s.score) ? (
                      <div className="premiumBadge">🏆 Premium Spot / Goldbarren</div>
                    ) : null}

                    {s.comment ? <div style={{ opacity: 0.92 }}>{s.comment}</div> : null}

                    <div className="popupMeta">
                      <div>
                        von: <b>{s.author || "Unbekannt"}</b>
                      </div>
                      <div>erstellt: {formatFirestoreDate(s.createdAt)}</div>
                      <div>geändert: {formatFirestoreDate(s.updatedAt)}</div>
                    </div>

                    <button
                      onClick={() => openEditSheet(s)}
                      style={{ ...buttonGhostStyle, marginTop: 4 }}
                    >
                      Bearbeiten
                    </button>
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
            onClick={openCreateSheet}
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
              <div style={{ fontWeight: 900, fontSize: 18 }}>
                {editingSpotId ? "Spot bearbeiten" : "Spot bewerten"}
              </div>
              <button onClick={() => setIsSheetOpen(false)} style={buttonGhostStyle}>
                Schließen
              </button>
            </div>

            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Autor / Wer war hier?"
              style={inputStyle}
            />

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
                {editingSpotId ? "Update speichern" : "Speichern"}
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
        <input
          type="range"
          min={1}
          max={10}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ width: "100%" }}
        />
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
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as 0 | 1 | 2 | 3)}
        style={{ ...inputStyle, cursor: "pointer" }}
      >
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