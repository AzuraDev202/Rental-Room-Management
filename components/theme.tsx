"use client";
import { createContext, useContext, useEffect, useState } from "react";
const ThemeContext = createContext({ dark: false, toggle: () => {} });
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      setDark(localStorage.getItem("hh-home-theme") === "dark");
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const toggle = () =>
    setDark((previous) => {
      const next = !previous;
      try {
        localStorage.setItem("hh-home-theme", next ? "dark" : "light");
      } catch {}
      return next;
    });
  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeSwitch() {
  const { dark, toggle } = useContext(ThemeContext);
  return (
    <section className="panel operations-panel">
      <div className="panel-heading">
        <h2>Giao diện</h2>
      </div>
      <button
        className="secondary"
        type="button"
        role="switch"
        aria-checked={dark}
        onClick={toggle}
      >
        Chế độ tối
      </button>
    </section>
  );
}
