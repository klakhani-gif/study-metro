import { AppState, Station } from "./model.js";

export const MAP_WIDTH = 900;
export const MAP_LEFT = 95;
export const MAP_RIGHT = 805;
export const MAP_TOP = 120;
export const LINE_GAP = 155;

export function mapHeight(lineCount: number): number {
  return Math.max(360, MAP_TOP + Math.max(0, lineCount - 1) * LINE_GAP + 120);
}

export function relayoutStations(state: AppState): AppState {
  const positionById = new Map<string, { x: number; y: number }>();

  state.lines.forEach((line, lineIndex) => {
    const count = line.stationIds.length;
    const usable = MAP_RIGHT - MAP_LEFT;
    const gap = count <= 1 ? 0 : usable / (count - 1);
    const y = MAP_TOP + lineIndex * LINE_GAP;

    line.stationIds.forEach((stationId, stationIndex) => {
      const x = count <= 1 ? MAP_LEFT + usable / 2 : MAP_LEFT + stationIndex * gap;
      positionById.set(stationId, { x: Math.round(x), y });
    });
  });

  const stations = state.stations
    .filter((station) => positionById.has(station.id))
    .map((station): Station => {
      const position = positionById.get(station.id)!;
      return { ...station, x: position.x, y: position.y };
    });

  return { ...state, stations };
}
