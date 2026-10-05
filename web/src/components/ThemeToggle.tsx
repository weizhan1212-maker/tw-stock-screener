"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const getTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => null);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:text-ink"
      aria-label={theme === "dark" ? "切換成淺色" : "切換成深色"}
    >
      {theme === "dark" ? "淺色" : theme === "light" ? "深色" : "\u3000\u3000"}
    </button>
  );
}
