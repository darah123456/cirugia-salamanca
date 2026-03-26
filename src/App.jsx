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

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getMonthLabel(date) {
  return date.toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
}

function getCalendarDays(baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekDay = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();
  const days = [];

  for (let i = 0; i < startWeekDay; i++) days.push(null);

  for (let day = 1; day <= totalDays; day++) {
    const current = new Date(year, month, day);
    days.push(
      `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(
        current.getDate()
      )}`
    );
  }

  return days;
}

function getProfessionalLabel(id) {
  return PROFESSIONALS.find((p) => p.id === id)?.label || id;
}

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedProfessional, setSelectedProfessional] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showAdmin, setShowAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem("cs_unlocked") === "true";
  });

  const [sessionForm, setSessionForm] = useState({
    professionalId: "tocino",
    datesText: "",
    startTime: "19:00",
    endTime: "21:00",
    duration: 10,
  });

  const [patientForm, setPatientForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    insuranceCompany: "",
  });

  const [inlineEditingKey, setInlineEditingKey] = useState(null);

  useEffect(() => {
    const unsubSessions = onSnapshot(collection(db, "sessions"), (snapshot) => {
      const rows = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));
      setSessions(rows);
      setLoading(false);
    });

    const unsubAppointments = onSnapshot(
      collection(db, "appointments"),
      (snapshot) => {
        const rows = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
        setAppointments(rows);
      }
    );

    return () => {
      unsubSessions();
      unsubAppointments();
    };
  }, []);

  const professionalSessions = useMemo(() => {
    if (!selectedProfessional) return [];
    return sessions.filter((s) => s.professionalId === selectedProfessional);
  }, [sessions, selectedProfessional]);

  const sessionsForSelectedDay = useMemo(() => {
    return professionalSessions
      .filter((s) => s.date === selectedDate)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [professionalSessions, selectedDate]);

  const daySlots = useMemo(() => {
    return sessionsForSelectedDay.flatMap((session) => {
      const appointmentMap = new Map(
        appointments
          .filter((a) => a.sessionId === session.id)
          .map((a) => [a.slotStart, a])
      );

      return buildSlots(session.startTime, session.endTime, session.duration).map(
        (slot) => ({
          ...slot,
          sessionId: session.id,
          appointment: appointmentMap.get(slot.start) || null,
          occupied: appointmentMap.has(slot.start),
        })
      );
    });
  }, [sessionsForSelectedDay, appointments]);

  const dateStatusMap = useMemo(() => {
    const map = new Map();

    professionalSessions.forEach((session) => {
      const totalSlots = buildSlots(
        session.startTime,
        session.endTime,
        session.duration
      ).length;

      const occupiedCount = appointments.filter(
        (a) => a.sessionId === session.id
      ).length;

      const hasFree = occupiedCount < totalSlots;
      const previous = map.get(session.date);

      if (!previous) {
        map.set(session.date, hasFree ? "free" : "full");
      } else if (previous === "full" && hasFree) {
        map.set(session.date, "free");
      }
    });

    return map;
  }, [professionalSessions, appointments]);

  const calendarDays = useMemo(() => getCalendarDays(currentMonth), [currentMonth]);

  function parseDates(text) {
    return text
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => Number(d))
      .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 31);
  }

  async function createSessions() {
    if (
      !sessionForm.professionalId ||
      !sessionForm.datesText ||
      !sessionForm.startTime ||
      !sessionForm.endTime
    ) {
      return;
    }

    if (timeToMinutes(sessionForm.endTime) <= timeToMinutes(sessionForm.startTime)) {
      alert("La hora de fin debe ser mayor que la de inicio.");
      return;
    }

    const now = currentMonth;
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const days = parseDates(sessionForm.datesText);

    for (const day of days) {
      await addDoc(collection(db, "sessions"), {
        professionalId: sessionForm.professionalId,
        date: `${year}-${pad(month)}-${pad(day)}`,
        startTime: sessionForm.startTime,
        endTime: sessionForm.endTime,
        duration: Number(sessionForm.duration),
      });
    }

    if (days[0]) {
      setSelectedProfessional(sessionForm.professionalId);
      setSelectedDate(`${year}-${pad(month)}-${pad(days[0])}`);
    }

    setSessionForm((prev) => ({ ...prev, datesText: "" }));
  }

  async function occupySlot(slot) {
    const session = sessions.find((s) => s.id === slot.sessionId);
    if (!session) return;

    const exists = appointments.some(
      (a) => a.sessionId === slot.sessionId && a.slotStart === slot.start
    );
    if (exists) return;

    await addDoc(collection(db, "appointments"), {
      sessionId: slot.sessionId,
      professionalId: session.professionalId,
      date: session.date,
      slotStart: slot.start,
      slotEnd: slot.end,
      firstName: "",
      lastName: "",
      phone: "",
      insuranceCompany: "",
      status: "bloqueado",
    });
  }

  async function releaseSlot(slot) {
    if (!slot.appointment?.id) return;
    await deleteDoc(doc(db, "appointments", slot.appointment.id));

    if (inlineEditingKey === `${slot.sessionId}-${slot.start}`) {
      setInlineEditingKey(null);
      setPatientForm({
        firstName: "",
        lastName: "",
        phone: "",
        insuranceCompany: "",
      });
    }
  }

  function openInlinePatientForm(slot) {
    setInlineEditingKey(`${slot.sessionId}-${slot.start}`);
    setPatientForm({
      firstName: slot.appointment?.firstName || "",
      lastName: slot.appointment?.lastName || "",
      phone: slot.appointment?.phone || "",
      insuranceCompany: slot.appointment?.insuranceCompany || "",
    });
  }

  async function savePatient(slot) {
    const existing = appointments.find(
      (a) => a.sessionId === slot.sessionId && a.slotStart === slot.start
    );

    if (existing) {
      const ref = doc(db, "appointments", existing.id);
      await updateDoc(ref, {
        firstName: patientForm.firstName.trim(),
        lastName: patientForm.lastName.trim(),
        phone: patientForm.phone.trim(),
        insuranceCompany: patientForm.insuranceCompany.trim(),
        status: "paciente",
      });
    } else {
      const session = sessions.find((s) => s.id === slot.sessionId);
      if (!session) return;

      await addDoc(collection(db, "appointments"), {
        sessionId: slot.sessionId,
        professionalId: session.professionalId,
        date: session.date,
        slotStart: slot.start,
        slotEnd: slot.end,
        firstName: patientForm.firstName.trim(),
        lastName: patientForm.lastName.trim(),
        phone: patientForm.phone.trim(),
        insuranceCompany: patientForm.insuranceCompany.trim(),
        status: "paciente",
      });
    }

    setInlineEditingKey(null);
    setPatientForm({
      firstName: "",
      lastName: "",
      phone: "",
      insuranceCompany: "",
    });
  }

  function goPrevMonth() {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    );
  }

  function goNextMonth() {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    );
  }

  function goHome() {
    setSelectedProfessional(null);
    setInlineEditingKey(null);
  }

  function handlePinSubmit(e) {
    e.preventDefault();

    if (pinInput === ACCESS_PIN) {
      setIsUnlocked(true);
      setPinError("");
      sessionStorage.setItem("cs_unlocked", "true");
    } else {
      setPinError("Clave incorrecta");
      setPinInput("");
    }
  }

  function lockApp() {
    setIsUnlocked(false);
    setPinInput("");
    setPinError("");
    setSelectedProfessional(null);
    setInlineEditingKey(null);
    sessionStorage.removeItem("cs_unlocked");
  }

  function addPinDigit(digit) {
    if (pinInput.length >= 4) return;
    setPinInput((prev) => prev + digit);
    setPinError("");
  }

  function clearPin() {
    setPinInput("");
    setPinError("");
  }

  function deletePinDigit() {
    setPinInput((prev) => prev.slice(0, -1));
    setPinError("");
  }

  if (!isUnlocked) {
    return (
      <div className="app-shell">
        <div className="app-container">
          <section className="hero-card">
            <div>
              <div className="eyebrow">Cirugía Salamanca</div>
              <h1>Acceso</h1>
              <p>Introduce el PIN de 4 números para entrar.</p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Clave de acceso</h2>
              <span className="panel-note">Entrada protegida</span>
            </div>

            <form onSubmit={handlePinSubmit}>
              <div className="pin-display">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={`pin-dot ${pinInput[i] ? "filled" : ""}`}>
                    {pinInput[i] ? "•" : ""}
                  </div>
                ))}
              </div>

              {pinError ? <div className="config-help">{pinError}</div> : null}

              <div className="pin-pad">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="pin-key"
                    onClick={() => addPinDigit(String(n))}
                  >
                    {n}
                  </button>
                ))}
                <button type="button" className="pin-key pin-key-alt" onClick={clearPin}>
                  C
                </button>
                <button
                  type="button"
                  className="pin-key"
                  onClick={() => addPinDigit("0")}
                >
                  0
                </button>
                <button
                  type="button"
                  className="pin-key pin-key-alt"
                  onClick={deletePinDigit}
                >
                  ⌫
                </button>
              </div>

              <button className="primary-btn" type="submit" style={{ marginTop: 14 }}>
                Entrar
              </button>
            </form>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-container">
        <header className="hero-card">
          <div>
            <div className="eyebrow">Cirugía Salamanca</div>
            <h1>Cirugía Salamanca</h1>
            <p>
              Seleccione el médico. En verde verá días con huecos libres y en rojo
              días sin huecos disponibles.
            </p>
          </div>
        </header>

        {loading ? (
          <section className="panel">
            <div className="empty-state">Cargando agenda...</div>
          </section>
        ) : (
          <>
            <section className="panel">
              <div className="panel-header">
                <h2>Seleccione el médico</h2>
                <span className="panel-note">Pantalla principal</span>
              </div>

              <div className="doctor-list">
                {PROFESSIONALS.map((p) => (
                  <button
                    key={p.id}
                    className={`doctor-card ${
                      selectedProfessional === p.id ? "doctor-card-selected" : ""
                    }`}
                    onClick={() => setSelectedProfessional(p.id)}
                  >
                    <div className="doctor-name">{p.label}</div>
                    <div className="doctor-sub">Ver calendario</div>
                  </button>
                ))}
              </div>
            </section>

            {selectedProfessional && (
              <>
                <section className="panel">
                  <div className="calendar-top">
                    <div>
                      <div className="selected-label">Consulta seleccionada</div>
                      <h2>{getProfessionalLabel(selectedProfessional)}</h2>
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button className="ghost-btn" onClick={goHome}>
                        ← Volver a pantalla principal
                      </button>
                      <button className="ghost-btn" onClick={lockApp}>
                        Cerrar acceso
                      </button>
                    </div>
                  </div>

                  <div className="calendar-nav">
                    <button className="icon-btn" onClick={goPrevMonth}>
                      ←
                    </button>
                    <div className="month-title">{getMonthLabel(currentMonth)}</div>
                    <button className="icon-btn" onClick={goNextMonth}>
                      →
                    </button>
                  </div>

                  <div className="weekdays">
                    <div>L</div>
                    <div>M</div>
                    <div>X</div>
                    <div>J</div>
                    <div>V</div>
                    <div>S</div>
                    <div>D</div>
                  </div>

                  <div className="calendar-grid">
                    {calendarDays.map((dateValue, index) => {
                      if (!dateValue) {
                        return <div key={`empty-${index}`} className="day-cell empty"></div>;
                      }

                      const status = dateStatusMap.get(dateValue);
                      const isSelected = selectedDate === dateValue;
                      const dayNumber = Number(dateValue.slice(-2));

                      return (
                        <button
                          key={dateValue}
                          className={[
                            "day-cell",
                            status === "free" ? "free-day" : "",
                            status === "full" ? "full-day" : "",
                            !status ? "inactive-day" : "",
                            isSelected ? "selected-day" : "",
                          ].join(" ")}
                          onClick={() => status && setSelectedDate(dateValue)}
                          disabled={!status}
                        >
                          {dayNumber}
                        </button>
                      );
                    })}
                  </div>

                  <div className="legend-row">
                    <div className="legend-item">
                      <span className="legend-box free-box"></span>
                      Con huecos libres
                    </div>
                    <div className="legend-item">
                      <span className="legend-box full-box"></span>
                      Sin huecos libres
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-header">
                    <h2>Huecos del día</h2>
                    <span className="panel-note">
                      {selectedDate ? formatDate(selectedDate) : ""}
                    </span>
                  </div>

                  {sessionsForSelectedDay.length === 0 ? (
                    <div className="empty-state">
                      Seleccione un día verde o rojo del calendario.
                    </div>
                  ) : (
                    <div className="slots-list">
                      {daySlots.map((slot) => {
                        const patientName = `${slot.appointment?.firstName || ""} ${
                          slot.appointment?.lastName || ""
                        }`.trim();

                        const slotKey = `${slot.sessionId}-${slot.start}`;
                        const isInlineEditing = inlineEditingKey === slotKey;

                        return (
                          <div
                            key={slotKey}
                            className={`slot-card ${
                              slot.occupied ? "slot-card-occupied" : ""
                            }`}
                          >
                            <div className="slot-top-row">
                              <div>
                                <div className="slot-time">
                                  {slot.start} - {slot.end}
                                </div>
                                <div className="slot-status">
                                  {slot.occupied ? "Ocupado" : "Disponible"}
                                </div>
                                {patientName ? (
                                  <div className="patient-name">{patientName}</div>
                                ) : null}
                              </div>

                              <div className="slot-actions-inline">
                                {!slot.occupied ? (
                                  <button
                                    className="slot-btn"
                                    onClick={() => occupySlot(slot)}
                                  >
                                    Ocupar hueco
                                  </button>
                                ) : (
                                  <button
                                    className="slot-btn occupied-btn"
                                    onClick={() => releaseSlot(slot)}
                                  >
                                    Liberar hueco
                                  </button>
                                )}

                                <button
                                  className="secondary-slot-btn"
                                  onClick={() => openInlinePatientForm(slot)}
                                >
                                  {patientName ? "Editar paciente" : "Añadir paciente"}
                                </button>
                              </div>
                            </div>

                            {isInlineEditing && (
                              <div className="inline-patient-form">
                                <div className="form-grid">
                                  <label>
                                    <span>Nombre</span>
                                    <input
                                      value={patientForm.firstName}
                                      onChange={(e) =>
                                        setPatientForm((prev) => ({
                                          ...prev,
                                          firstName: e.target.value,
                                        }))
                                      }
                                    />
                                  </label>

                                  <label>
                                    <span>Apellidos</span>
                                    <input
                                      value={patientForm.lastName}
                                      onChange={(e) =>
                                        setPatientForm((prev) => ({
                                          ...prev,
                                          lastName: e.target.value,
                                        }))
                                      }
                                    />
                                  </label>

                                  <label>
                                    <span>Teléfono</span>
                                    <input
                                      value={patientForm.phone}
                                      onChange={(e) =>
                                        setPatientForm((prev) => ({
                                          ...prev,
                                          phone: e.target.value,
                                        }))
                                      }
                                    />
                                  </label>

                                  <label>
                                    <span>Compañía</span>
                                    <input
                                      value={patientForm.insuranceCompany}
                                      onChange={(e) =>
                                        setPatientForm((prev) => ({
                                          ...prev,
                                          insuranceCompany: e.target.value,
                                        }))
                                      }
                                    />
                                  </label>
                                </div>

                                <div className="form-actions">
                                  <button
                                    className="ghost-btn"
                                    onClick={() => setInlineEditingKey(null)}
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    className="primary-btn small-primary"
                                    onClick={() => savePatient(slot)}
                                  >
                                    Guardar paciente
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}

            <section className="panel admin-panel">
              <div className="panel-header">
                <h2>Configurar los días</h2>
                <button
                  className="ghost-btn"
                  onClick={() => setShowAdmin((p) => !p)}
                >
                  {showAdmin ? "Ocultar" : "Mostrar"}
                </button>
              </div>

              {showAdmin && (
                <>
                  <div className="config-help">
                    Escribe varios días separados por comas. Ejemplo: 1, 7, 8
                  </div>

                  <div className="form-grid">
                    <label>
                      <span>Médico</span>
                      <select
                        value={sessionForm.professionalId}
                        onChange={(e) =>
                          setSessionForm((prev) => ({
                            ...prev,
                            professionalId: e.target.value,
                          }))
                        }
                      >
                        {PROFESSIONALS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span>Días del mes</span>
                      <input
                        placeholder="Ej: 1, 7, 8"
                        value={sessionForm.datesText}
                        onChange={(e) =>
                          setSessionForm((prev) => ({
                            ...prev,
                            datesText: e.target.value,
                          }))
                        }
                      />
                    </label>

                    <label>
                      <span>Hora inicio</span>
                      <input
                        type="time"
                        value={sessionForm.startTime}
                        onChange={(e) =>
                          setSessionForm((prev) => ({
                            ...prev,
                            startTime: e.target.value,
                          }))
                        }
                      />
                    </label>

                    <label>
                      <span>Hora fin</span>
                      <input
                        type="time"
                        value={sessionForm.endTime}
                        onChange={(e) =>
                          setSessionForm((prev) => ({
                            ...prev,
                            endTime: e.target.value,
                          }))
                        }
                      />
                    </label>

                    <label>
                      <span>Duración de hueco</span>
                      <select
                        value={sessionForm.duration}
                        onChange={(e) =>
                          setSessionForm((prev) => ({
                            ...prev,
                            duration: Number(e.target.value),
                          }))
                        }
                      >
                        <option value={10}>10 minutos</option>
                        <option value={15}>15 minutos</option>
                        <option value={20}>20 minutos</option>
                        <option value={30}>30 minutos</option>
                      </select>
                    </label>
                  </div>

                  <button className="primary-btn" onClick={createSessions}>
                    Guardar días de consulta
                  </button>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}