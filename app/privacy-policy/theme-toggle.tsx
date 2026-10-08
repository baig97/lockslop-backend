"use client";

import { useEffect } from "react";
import styles from "./privacy-policy.module.css";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      const saved = localStorage.getItem("lockslop-privacy-theme");
      if (saved !== "light" && saved !== "dark") {
        applyTheme(query.matches ? "dark" : "light");
      }
    };

    query.addEventListener("change", followSystem);
    return () => query.removeEventListener("change", followSystem);
  }, []);

  function toggleTheme() {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next: Theme = current === "dark" ? "light" : "dark";
    localStorage.setItem("lockslop-privacy-theme", next);
    applyTheme(next);
  }

  return (
    <button
      className={styles.themeToggle}
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle light and dark theme"
      title="Toggle light and dark theme"
    >
      <svg className={styles.sunIcon} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
      </svg>
      <svg className={styles.moonIcon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" />
      </svg>
      <span>Theme</span>
    </button>
  );
}
