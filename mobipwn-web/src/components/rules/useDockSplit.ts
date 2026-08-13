import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "mobipwn-rules-editor-split";
const DEFAULT_DOCK_FR = 6;
const DEFAULT_TABLE_FR = 1;
const MIN_TABLE_FR = 0.6;
const MAX_TABLE_FR = 2.5;
const MIN_DOCK_FR = 2;

function loadSplit(): { tableFr: number; dockFr: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tableFr?: number; dockFr?: number };
      const dockFr = parsed.dockFr ?? DEFAULT_DOCK_FR;
      const tableFr = parsed.tableFr ?? DEFAULT_TABLE_FR;
      if (dockFr >= MIN_DOCK_FR && tableFr >= MIN_TABLE_FR) {
        return { tableFr, dockFr };
      }
    }
  } catch {
    /* ignore */
  }
  return { tableFr: DEFAULT_TABLE_FR, dockFr: DEFAULT_DOCK_FR };
}

export function useDockSplit(enabled: boolean) {
  const [{ tableFr, dockFr }, setSplit] = useState(loadSplit);
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startTableFr = useRef(DEFAULT_TABLE_FR);

  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tableFr, dockFr }));
    } catch {
      /* ignore */
    }
  }, [tableFr, dockFr, enabled]);

  const onResizeStart = useCallback(
    (clientY: number) => {
      if (collapsed || fullscreen) return;
      dragging.current = true;
      startY.current = clientY;
      startTableFr.current = tableFr;
    },
    [collapsed, fullscreen, tableFr]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const deltaPx = e.clientY - startY.current;
      const step = deltaPx / 48;
      const nextTable = Math.min(
        MAX_TABLE_FR,
        Math.max(MIN_TABLE_FR, startTableFr.current + step)
      );
      setSplit({ tableFr: nextTable, dockFr: Math.max(MIN_DOCK_FR, DEFAULT_DOCK_FR) });
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  const toggleFullscreen = useCallback(() => setFullscreen((f) => !f), []);

  const gridRows = fullscreen
    ? "0fr 1fr"
    : collapsed
      ? "1fr auto"
      : `${tableFr}fr ${dockFr}fr`;

  return {
    gridRows,
    collapsed,
    fullscreen,
    onResizeStart,
    toggleCollapsed,
    toggleFullscreen,
  };
}
