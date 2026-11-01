import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "wbot-theme";
/** Colour of the browser chrome (mobile address bar) for each theme. */
const CHROME_COLOR: Record<Theme, string> = { light: "#f5f6fa", dark: "#0a0c16" };

function readStored(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch { return null; }
}

function systemQuery(): MediaQueryList | null {
  try { return window.matchMedia("(prefers-color-scheme: dark)"); }
  catch { return null; }
}

/**
 * Light/dark appearance for both portals. Follows the operating-system setting
 * until the person picks a theme; that explicit choice is remembered per browser.
 * Purely presentational: it only sets a `data-theme` attribute that the CSS reads.
 */
export function useTheme() {
  const [stored, setStored] = useState<Theme | null>(readStored);
  const [system, setSystem] = useState<Theme>(() => systemQuery()?.matches ? "dark" : "light");
  const theme: Theme = stored ?? system;

  useEffect(() => {
    const query = systemQuery();
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (stored) root.setAttribute("data-theme", stored);
    else root.removeAttribute("data-theme");
    const color = CHROME_COLOR[theme];
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute("content", color));
  }, [stored, theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStored(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); }
    catch { /* Storage can be unavailable in private mode; the choice still applies this session. */ }
  }, [theme]);

  return { theme, toggle };
}
