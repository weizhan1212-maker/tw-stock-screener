"use client";
import { useEffect, useRef, useState } from "react";

/** 卡片：滑鼠移動時，聚光跟著游標 */
export function SpotCard({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`lp-card ${className}`}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}

/** 捲動到可視範圍才淡入上移，只播一次；沒有 JS 時照常顯示 */
export function Reveal({ delay = 0, className = "", children }: { delay?: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(true); return; }
    setArmed(true);
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { setShown(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`${armed ? "lp-reveal" : ""} ${shown ? "in" : ""} ${className}`} style={{ ["--d" as string]: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** 主視覺：往下捲時淡出、縮小、下移（視差） */
export function HeroParallax({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current; if (!el) return;
        const p = Math.min(1, Math.max(0, window.scrollY / (el.offsetHeight * 0.9)));
        el.style.opacity = String(1 - p * 0.9);
        el.style.transform = `translateY(${p * 100}px) scale(${1 - p * 0.05})`;
      });
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={ref} className="lp-hero-inner">{children}</div>;
}
