"use client";

import { useEffect, useRef, useState } from "react";

/** Viewport-aware, finite playback. Manual selection always pauses. */
export function useStepPlayback(count: number, interval = 6500) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(true);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(media.matches);
      if (media.matches) setIsPlaying(false);
    };
    const updateVisibility = () => setIsTabVisible(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.intersectionRatio >= 0.3), { threshold: 0.3 });
    if (sectionRef.current) observer.observe(sectionRef.current);
    update();
    updateVisibility();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  const currentIndex = Math.max(0, Math.min(activeIndex, count - 1));
  const running = count > 1 && isPlaying && isVisible && isTabVisible && !reducedMotion;
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      const next = Math.min(currentIndex + 1, count - 1);
      setActiveIndex(next);
      if (next === count - 1) setIsPlaying(false);
    }, interval);
    return () => window.clearTimeout(timer);
  }, [currentIndex, running, count, interval]);

  const select = (index: number) => {
    setActiveIndex(Math.max(0, Math.min(index, count - 1)));
    setIsPlaying(false);
  };
  const toggle = () => {
    if (reducedMotion || count < 2) return;
    if (currentIndex === count - 1) setActiveIndex(0);
    setIsPlaying((value) => !value);
  };
  return { activeIndex: currentIndex, isPlaying, reducedMotion, sectionRef, select, toggle };
}
