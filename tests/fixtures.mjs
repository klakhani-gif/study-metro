export function createDemoState() {
  return {
    schemaVersion: 3,
    exams: [],
    selectedExamId: null,
    profile: {
      studyArea: "Medicine",
      periodName: "Semester 4",
      createdAt: Date.now()
    },
    lines: [
      { id: "anatomy", name: "ANATOMY", color: "#E4572E", stationIds: ["thorax", "abdomen", "pelvis", "perineum", "head-neck"] },
      { id: "physiology", name: "PHYSIOLOGY", color: "#2E6F95", stationIds: ["cardio", "resp", "renal", "gi", "endocrine"] },
      { id: "biochem", name: "BIOCHEMISTRY", color: "#6A4C93", stationIds: ["enzymes", "fed-fast", "hormones", "kidney-biochem"] }
    ],
    stations: [
      { id: "thorax", lineId: "anatomy", name: "Thorax", x: 110, y: 150, status: "completed", estimatedMinutes: 45 },
      { id: "abdomen", lineId: "anatomy", name: "Abdomen", x: 245, y: 150, status: "completed", estimatedMinutes: 50 },
      { id: "pelvis", lineId: "anatomy", name: "Pelvis", x: 380, y: 150, status: "studying", estimatedMinutes: 50 },
      { id: "perineum", lineId: "anatomy", name: "Perineum", x: 515, y: 150, status: "not_started", estimatedMinutes: 45 },
      { id: "head-neck", lineId: "anatomy", name: "Head & Neck", x: 650, y: 150, status: "not_started", estimatedMinutes: 60 },
      { id: "cardio", lineId: "physiology", name: "Cardio", x: 110, y: 320, status: "completed", estimatedMinutes: 50 },
      { id: "resp", lineId: "physiology", name: "Respiratory", x: 245, y: 320, status: "completed", estimatedMinutes: 45 },
      { id: "renal", lineId: "physiology", name: "Renal", x: 380, y: 320, status: "studying", estimatedMinutes: 50 },
      { id: "gi", lineId: "physiology", name: "GI", x: 515, y: 320, status: "not_started", estimatedMinutes: 45 },
      { id: "endocrine", lineId: "physiology", name: "Endocrine", x: 650, y: 320, status: "not_started", estimatedMinutes: 50 },
      { id: "enzymes", lineId: "biochem", name: "Enzymes", x: 245, y: 490, status: "completed", estimatedMinutes: 40 },
      { id: "fed-fast", lineId: "biochem", name: "Fed / Fast", x: 380, y: 490, status: "completed", estimatedMinutes: 50 },
      { id: "hormones", lineId: "biochem", name: "Hormones", x: 515, y: 490, status: "studying", estimatedMinutes: 50 },
      { id: "kidney-biochem", lineId: "biochem", name: "Kidney", x: 650, y: 490, status: "not_started", estimatedMinutes: 45 }
    ],
    history: [],
    selectedStationId: "renal",
    preferredDuration: 50,
    activeJourney: null,
    premiumUntil: null,
    isPaidPremium: false
  };
}
