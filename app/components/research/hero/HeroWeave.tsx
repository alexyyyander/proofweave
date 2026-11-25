"use client";

import { useEffect, useRef, useState } from "react";
import { weaveRenderer } from "./weave-scene";

export function HeroWeave({ pauseLabel, playLabel }: { pauseLabel: string; playLabel: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const playing = useRef(true);
  const sync = useRef<() => void>(() => { });
  useEffect(() => {
    playing.current = !paused;
    sync.current();
  }, [paused]);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const scene = weaveRenderer(canvas, context);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false, frame = 0, last = 0, time = 0;
    let yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0;
    const tick = (now: number) => {
      const elapsed = last ? (now - last) / 1000 : 0;
      if (!last || elapsed >= 1 / 30) {
        time += Math.min(elapsed, .08);
        last = now;
        yaw += (targetYaw - yaw) * .12;
        pitch += (targetPitch - pitch) * .12;
        scene.draw(time, yaw, pitch);
      }
      frame = requestAnimationFrame(tick);
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (visible && !document.hidden && !reduced.matches && playing.current) frame = requestAnimationFrame(tick);
    };
    const resize = () => { scene.resize(); scene.draw(time, yaw, pitch); };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const box = canvas.getBoundingClientRect();
      targetYaw = ((event.clientX - box.left) / box.width - .5) * .65;
      targetPitch = ((event.clientY - box.top) / box.height - .5) * .36;
    };
    const leave = () => { targetYaw = 0; targetPitch = 0; };
    const size = new ResizeObserver(resize);
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); });
    size.observe(canvas);
    visibility.observe(canvas);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    reduced.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    sync.current = refresh;
    resize();
    setReady(true);
    return () => {
      cancelAnimationFrame(frame);
      sync.current = () => { };
      size.disconnect(); visibility.disconnect();
      reduced.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, []);
  return <div className="rh-weave">
    <canvas ref={ref} aria-hidden="true" className={ready ? "is-ready" : undefined} />
    {ready && <button type="button" className="rh-motion-toggle" aria-label={paused ? playLabel : pauseLabel}
      title={paused ? playLabel : pauseLabel} onClick={() => setPaused(!paused)}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
        {paused ? <path d="M5 3 13 8 5 13Z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}
      </svg>
    </button>}
  </div>;
}
