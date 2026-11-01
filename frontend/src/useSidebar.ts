import { useCallback, useEffect, useRef, useState } from "react";

/** Shared responsive sidebar state. Each portal remembers its own collapsed mode. */
export function useSidebar(storageKey: string) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem(storageKey) === "true"; }
    catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    // Restore keyboard focus when a drawer closes by navigation or backdrop.
    if (window.innerWidth <= 900) {
      window.requestAnimationFrame(() => toggleRef.current?.focus());
    }
  }, []);
  const toggleMobile = useCallback(() => setMobileOpen(value => !value), []);
  const toggleCollapsed = useCallback(() => setCollapsed(value => {
    const next = !value;
    try { window.localStorage.setItem(storageKey, String(next)); }
    catch { /* Storage can be unavailable in private mode. */ }
    return next;
  }), [storageKey]);

  useEffect(() => {
    if (!mobileOpen) return;
    const isSmall = window.matchMedia("(max-width: 900px)").matches;
    const previous = document.body.style.overflow;
    if (isSmall) {
      document.body.style.overflow = "hidden";
      drawerRef.current?.querySelector<HTMLButtonElement>(".sidebar-close")?.focus();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { closeMobile(); toggleRef.current?.focus(); return; }
      if (event.key !== "Tab" || !isSmall) return;
      const elements = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      } else if (!drawerRef.current?.contains(document.activeElement)) {
        event.preventDefault(); first.focus();
      }
    }
    function onResize() { if (window.innerWidth > 900) closeMobile(); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [mobileOpen, closeMobile]);

  return {
    collapsed, mobileOpen, drawerRef, toggleRef,
    toggleCollapsed, toggleMobile, closeMobile
  };
}
