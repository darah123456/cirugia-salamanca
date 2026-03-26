import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  updateDoc,
  doc,
  deleteDoc,
} from "firebase/firestore";

const PROFESSIONALS = [
  { id: "tocino", label: "Doctor Tocino" },
  { id: "castillo", label: "Doctor del Castillo" },
  { id: "zamora", label: "Consulta Zamora" },
];

const ACCESS_PIN = "1111";

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeToMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${pad(h)}:${pad(m)}`;
}

function buildSlots(startTime, endTime, duration) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const slots = [];

  for (let current = start; current + duration <= end; current += duration) {
    slots.push({
      start: minutesToTime(current),
      end: minutesToTime(current + duration),
    });
  }

  return slots;
}

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [appointments, setAppointments] = useState([]);

  const [selectedProfessional, setSelectedProfessional] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayISO());

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showAdmin, setShowAdmin] = useState(false);

  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [inlineEditingKey, setInlineEditingKey] = useState(null);

  const [patientForm, setPatientForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    insuranceCompany: "",
  });

  const [sessionForm, setSessionForm] = useState({
    professionalId: "tocino",
    datesText: "",
    startTime: "19:00",
    endTime: "21:00",
    duration: 10,
  });

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, "sessions"), (snap) => {
      setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsub2 = onSnapshot(collection(db, "appointments"), (snap) => {
      setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const sessionsForDay = sessions.filter(
    (s) =>
      s.professionalId === selectedProfessional && s.date === selectedDate
  );

  const daySlots = sessionsForDay.flatMap((session) => {
    const map = new Map(
      appointments
        .filter((a) => a.sessionId === session.id)
        .map((a) => [a.slotStart, a])
    );

    return buildSlots(
      session.startTime,
      session.endTime,
      session.duration
    ).map((slot) => ({
      ...slot,
      sessionId: session.id,
      appointment: map.get(slot.start),
      occupied: map.has(slot.start),
    }));
  });

  function handlePinSubmit(e) {
    e.preventDefault();

    if (pinInput === ACCESS_PIN) {
      setIsUnlocked(true);
      setPinError("");
    } else {
      setPinError("Clave incorrecta");
      setPinInput("");
    }
  }

  function addPinDigit(d) {
    if (pinInput.length < 4) setPinInput((p) => p + d);
  }

  function deletePinDigit() {
    setPinInput((p) => p.slice(0, -1));
  }

  function clearPin() {
    setPinInput("");
  }

  async function occupySlot(slot) {
    await addDoc(collection(db, "appointments"), {
      sessionId: slot.sessionId,
      slotStart: slot.start,
      slotEnd: slot.end,
    });
  }

  async function releaseSlot(slot) {
    if (!slot.appointment) return;
    await deleteDoc(doc(db, "appointments", slot.appointment.id));
  }

  function openForm(slot) {
    setInlineEditingKey(slot.sessionId + slot.start);
  }

  async function savePatient(slot) {
    const existing = appointments.find(
      (a) =>
        a.sessionId === slot.sessionId && a.slotStart === slot.start
    );

    if (existing) {
      await updateDoc(doc(db, "appointments", existing.id), patientForm);
    }

    setInlineEditingKey(null);
  }

  if (!isUnlocked) {
    return (
      <div className="pin-screen">
        <div className="pin-card">
          <h1>Cirugía Salamanca</h1>

          <div className="pin-display">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="pin-dot">
                {pinInput[i] ? "•" : ""}
              </div>
            ))}
          </div>

          {pinError && <div className="pin-error">{pinError}</div>}

          <div className="pin-pad">
            {[1,2,3,4,5,6,7,8,9].map(n => (
              <button key={n} onClick={() => addPinDigit(String(n))}>{n}</button>
            ))}
            <button onClick={clearPin}>C</button>
            <button onClick={() => addPinDigit("0")}>0</button>
            <button onClick={deletePinDigit}>⌫</button>
          </div>

          <button className="primary-btn" onClick={handlePinSubmit}>
            Entrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <h1>Cirugía Salamanca</h1>

      {!selectedProfessional && (
        <div>
          {PROFESSIONALS.map((p) => (
            <button key={p.id} onClick={() => setSelectedProfessional(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {selectedProfessional && (
        <>
          <button onClick={() => setSelectedProfessional(null)}>
            ← Volver
          </button>

          {daySlots.map((slot) => {
            const key = slot.sessionId + slot.start;
            const editing = inlineEditingKey === key;

            return (
              <div key={key}>
                {slot.start} - {slot.end}

                {!slot.occupied ? (
                  <button onClick={() => occupySlot(slot)}>Ocupar</button>
                ) : (
                  <button onClick={() => releaseSlot(slot)}>Liberar</button>
                )}

                <button onClick={() => openForm(slot)}>
                  Añadir paciente
                </button>

                {editing && (
                  <div>
                    <input
                      placeholder="Nombre"
                      onChange={(e) =>
                        setPatientForm({ ...patientForm, firstName: e.target.value })
                      }
                    />
                    <input
                      placeholder="Apellidos"
                      onChange={(e) =>
                        setPatientForm({ ...patientForm, lastName: e.target.value })
                      }
                    />
                    <button onClick={() => savePatient(slot)}>
                      Guardar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}