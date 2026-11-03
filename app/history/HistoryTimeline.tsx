"use client";

import { CardTitle, SectionTitle, Field, Button, FieldList, Input, SectionHeading, Surface } from "@/app/components/ui";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { TranslationKey } from "@/app/i18n/translate";
import { useI18n } from "@/app/i18n/client";
import type { Locale } from "@/app/i18n/config";

export type EvidenceTone = "formal" | "reviewed" | "reproduced" | "announced" | "corrected";

export type HistoryMilestone = {
  number: string;
  date: string;
  title: string;
  system: string;
  summary: string;
  summaryKey?: TranslationKey;
  aiRole: string;
  humanRole: string;
  evidence: string;
  evidenceKey?: TranslationKey;
  evidenceTone: EvidenceTone;
  significance: string;
  sources: Array<{ label: string; href: string }>;
  reproduction?: {
    label: string;
    detail: string;
    href: string;
    workspaceHref?: string;
    workspaceLabel?: string;
    command?: string;
  };
  frontier?: boolean;
  boundary?: string;
  latest?: boolean;
  special?: "jacobian" | "openai-ten" | "riemann";
  shortTitle: string;
  shortTitleKey?: TranslationKey;
  timelineDate: string;
  timelineLane: "above" | "below";
};

export function HistoryTimeline({ milestones }: { milestones: HistoryMilestone[] }) {
  const { t, locale } = useI18n();
  const dateLabel = (item: HistoryMilestone) => formatMilestoneDate(item, locale);
  const [activeNumber, setActiveNumber] = useState(milestones.at(-1)?.number ?? milestones[0]?.number);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(1120);
  const centerRef = useRef(.5);
  const wheelZoomRef = useRef({ zoom: 1, time: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; scrollLeft: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const canvasWidth = Math.max(viewportWidth, 1) * zoom;
  const layout = distributeTimelineLabels(milestones, canvasWidth);
  const compact = zoom < 4;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setViewportWidth(viewport.clientWidth));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = centerRef.current * canvasWidth - viewport.clientWidth / 2;
  }, [canvasWidth]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function onWheel(event: WheelEvent) {
      if (!viewport || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if ((zoom === 1 && event.deltaY > 0) || (zoom === 32 && event.deltaY < 0)) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      const previous = wheelZoomRef.current;
      const baseZoom = event.timeStamp - previous.time < 180 ? previous.zoom : zoom;
      const targetZoom = Math.max(1, Math.min(32, baseZoom * Math.exp(-delta * .0025)));
      wheelZoomRef.current = { zoom: targetZoom, time: event.timeStamp };
      const nextZoom = Math.round(targetZoom * 4) / 4;
      if (nextZoom === zoom) return;
      const pointerX = Math.max(0, Math.min(viewport.clientWidth, event.clientX - viewport.getBoundingClientRect().left));
      const position = (viewport.scrollLeft + pointerX) / canvasWidth;
      const nextWidth = viewport.clientWidth * nextZoom;
      centerRef.current = position + (viewport.clientWidth / 2 - pointerX) / nextWidth;
      setZoom(nextZoom);
    }
    // A non-passive listener keeps wheel zoom from also scrolling the page.
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [canvasWidth, zoom]);

  function changeZoom(value: number, center?: number) {
    const viewport = viewportRef.current;
    centerRef.current = center ?? (viewport ? (viewport.scrollLeft + viewport.clientWidth / 2) / canvasWidth : centerRef.current);
    const nextZoom = Math.max(1, Math.min(32, Number.isFinite(value) ? value : 1));
    wheelZoomRef.current = { zoom: nextZoom, time: 0 };
    setZoom(nextZoom);
    if (nextZoom === zoom && viewport) viewport.scrollLeft = centerRef.current * canvasWidth - viewport.clientWidth / 2;
  }

  function recentDays() {
    changeZoom(16, timelinePosition(milestones.at(-1)?.timelineDate ?? "2026-09-01") / 100);
  }
  const tracksIn = (lane: HistoryMilestone["timelineLane"]) => compact ? 1 : Math.max(2, ...layout.filter(({ item }) => item.timelineLane === lane).map(({ timelineTrack }) => timelineTrack + 1));
  const aboveTracks = tracksIn("above");
  const belowTracks = tracksIn("below");
  const nodeClearance = Math.max(0, ...layout.map(({ timelineNodeOffset }) => Math.abs(timelineNodeOffset)));

  function focusTab(index: number) {
    const nextIndex = (index + milestones.length) % milestones.length;
    const next = milestones[nextIndex];
    if (!next) return;
    setActiveNumber(next.number);
    const tab = tabRefs.current[nextIndex];
    tab?.focus({ preventScroll: true });
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = timelinePosition(next.timelineDate) / 100 * canvasWidth - viewport.clientWidth / 2;
  }

  return (
    <section className="history-timeline" id="timeline" aria-labelledby="timeline-title">
      <SectionHeading as="div" className="history-timeline-heading">
        <div>
          <p className="eyebrow">{t("history.timeline.eyebrow", { count: milestones.length })}</p>
          <SectionTitle id="timeline-title">{t("history.timeline.title")}</SectionTitle>
        </div>
        <p>{t("history.timeline.instructions")}</p>
      </SectionHeading>

      <div className="history-timeline-controls" aria-label={t("history.timeline.controlsAria")}>
        <div className="history-timeline-presets">
          <Button type="button" aria-pressed={zoom === 1} onClick={() => changeZoom(1, .5)}>{t("history.timeline.fullRecord")}</Button>
          <Button type="button" onClick={recentDays}>{t("history.timeline.recentDays")}</Button>
        </div>
        <div className="history-timeline-zoom">
          <Button type="button" aria-label={t("history.timeline.zoomOut")} disabled={zoom === 1} onClick={() => changeZoom(Math.max(1, Math.round(zoom / 1.5)))}>−</Button>
          <label htmlFor="history-zoom">{t("history.timeline.spacing")}</label>
          <Input id="history-zoom" type="range" min="1" max="32" step="0.25" value={zoom} aria-valuetext={t("history.timeline.zoomValue", { zoom })} onChange={(event) => changeZoom(Number(event.target.value))} />
          <output htmlFor="history-zoom">{zoom}×</output>
          <Button type="button" aria-label={t("history.timeline.zoomIn")} disabled={zoom === 32} onClick={() => changeZoom(Math.min(32, Math.ceil(zoom * 1.5)))}>+</Button>
        </div>
        <div className="history-timeline-pan" style={{ flexWrap: "wrap", maxWidth: "100%" }}>
          <Button type="button" onClick={() => focusTab(0)}>{t("history.timeline.firstEntry")}</Button>
          <Button type="button" onClick={() => focusTab(milestones.length - 1)}>{t("history.timeline.latestEntry")}</Button>
          <Button type="button" aria-label={t("history.timeline.earlier")} onClick={() => viewportRef.current?.scrollBy({ left: -viewportWidth * .7 })}>←</Button>
          <Button type="button" aria-label={t("history.timeline.later")} onClick={() => viewportRef.current?.scrollBy({ left: viewportWidth * .7 })}>→</Button>
        </div>
      </div>
      <div
        className={`history-timeline-viewport${dragging ? " is-dragging" : ""}`}
        ref={viewportRef}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId || event.buttons !== 1) return;
          const distance = event.clientX - drag.x;
          if (!drag.moved && Math.abs(distance) < 5) return;
          drag.moved = true;
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.scrollLeft = drag.scrollLeft - distance;
        }}
        onPointerUp={() => { setDragging(false); }}
        onPointerCancel={() => { dragRef.current = null; setDragging(false); }}
        onLostPointerCapture={() => setDragging(false)}
        onClickCapture={(event) => {
          if (event.detail !== 0 && dragRef.current?.moved) { event.preventDefault(); event.stopPropagation(); }
          dragRef.current = null;
        }}
        onScroll={(event) => { centerRef.current = (event.currentTarget.scrollLeft + event.currentTarget.clientWidth / 2) / canvasWidth; }}
      >
        <div className="history-time-visual" role="tablist" aria-label={t("history.timeline.tablistAria")} style={{ width: `${canvasWidth}px`, "--timeline-axis-y": `${84 + nodeClearance + aboveTracks * 80}px`, "--timeline-node-clearance": `${nodeClearance}px`, height: `${168 + 2 * nodeClearance + (aboveTracks + belowTracks) * 80}px` } as CSSProperties}>
          <div className="history-time-axis" aria-hidden="true">{timelineTicks(zoom, locale).map(({ label, date }) => <span key={date} style={{ left: `${timelinePosition(date)}%` }}>{label}</span>)}</div>
          {layout.map(({ item, timelineTrack, timelineNodeOffset }, index) => {
              const isActive = item.number === activeNumber;
              const position = timelinePosition(item.timelineDate);
              const edgeClass = position >= 94 ? " is-edge-end" : position <= 6 ? " is-edge-start" : "";
              const nodeClass = timelineNodeOffset < 0 ? " is-node-above" : timelineNodeOffset > 0 ? " is-node-below" : "";
              return (
                <Button
                  aria-controls={`history-panel-${item.number}`}
                  aria-label={`${dateLabel(item)}: ${item.title}. ${item.evidence}`}
                  title={`${dateLabel(item)}: ${item.title}`}
                  aria-selected={isActive}
                  className={`history-timepoint is-${item.timelineLane} tone-${item.evidenceTone}${isActive ? " is-active" : ""}${item.latest ? " is-latest" : ""}${edgeClass}${nodeClass}`}
                  id={`history-tab-${item.number}`}
                  key={item.number}
                  onClick={() => setActiveNumber(item.number)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                      event.preventDefault();
                      focusTab(index + 1);
                    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                      event.preventDefault();
                      focusTab(index - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      focusTab(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      focusTab(milestones.length - 1);
                    }
                  }}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  role="tab"
                  style={{
                    "--timeline-label-track": compact ? 0 : timelineTrack,
                    "--timeline-node-bridge": `${Math.max(Math.abs(timelineNodeOffset) - 18, 0)}px`,
                    "--timeline-node-offset": `${timelineNodeOffset}px`,
                    left: `${position}%`,
                  } as CSSProperties}
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                >
                  <span className="history-timepoint-copy" style={compact && !isActive ? { display: "none" } : undefined}><time dateTime={item.timelineDate}>{dateLabel(item)}</time><strong>{item.shortTitle}</strong>{item.latest ? <em>{t("history.timeline.latestBadge")}</em> : null}</span>
                  <span className="history-timepoint-node"><b>{item.number}</b></span>
                </Button>
              );
            })}
        </div>
      </div>

      <div className="history-panels">
          {milestones.map((item) => {
            const isActive = item.number === activeNumber;
            return (
              <Surface as="article"
                aria-labelledby={`history-tab-${item.number}`}
                className={`history-panel${item.frontier ? " is-frontier" : ""}`}
                hidden={!isActive}
                id={`history-panel-${item.number}`}
                key={item.number}
                role="tabpanel"
                tabIndex={0}
              >
                <header>
                  <div><p className="history-system">{item.system}</p><CardTitle>{item.title}</CardTitle></div>
                  <span className={`history-state is-${item.evidenceTone}`}>{item.evidence}</span>
                </header>
                <p className="history-entry-summary">{item.summary}</p>

                {item.special === "jacobian" ? <>
                  <div className="history-jacobian-proof"><div><span>{t("history.timeline.jacobian.constant")}</span><strong>det JF = −2</strong></div><div><span>{t("history.timeline.jacobian.noninjective")}</span><strong>3 inputs → (−¼, 0, 0)</strong></div></div>
                  <details className="history-jacobian-formula"><summary>{t("history.timeline.jacobian.inspect")} <span aria-hidden="true">+</span></summary><div><code>F₁ = (1 + xy)³z + y²(1 + xy)(4 + 3xy)</code><code>F₂ = y + 3x(1 + xy)²z + 3xy²(4 + 3xy)</code><code>F₃ = 2x − 3x²y − x³z</code><p><strong>{t("history.timeline.jacobian.collision")}</strong> {t("history.timeline.jacobian.collisionDetail")}</p></div></details>
                </> : item.special === "openai-ten" ? <div className="history-ten-proofs"><div><span>{t("history.timeline.ten.portfolio")}</span><strong>{t("history.timeline.ten.results")}</strong></div><div><span>{t("history.timeline.ten.publicArtifact")}</span><strong>{t("history.timeline.ten.modules")}</strong></div><details><summary>{t("history.timeline.ten.showAreas")} <span aria-hidden="true">+</span></summary><ol><li>{t("history.timeline.ten.area.spherePacking")}</li><li>{t("history.timeline.ten.area.codes")}</li><li>{t("history.timeline.ten.area.nonSofic")}</li><li>{t("history.timeline.ten.area.connes")}</li><li>{t("history.timeline.ten.area.circuit")}</li><li>{t("history.timeline.ten.area.quantum")}</li><li>{t("history.timeline.ten.area.cvp")}</li><li>{t("history.timeline.ten.area.ehrhart")}</li><li>{t("history.timeline.ten.area.ramsey")}</li><li>{t("history.timeline.ten.area.extremal")}</li></ol></details></div> : item.special === "riemann" ? <div className="history-riemann-proof"><div><span>{t("history.timeline.riemann.known")}</span><strong>41.6% → 67.2%</strong></div><div><span>{t("history.timeline.riemann.itself")}</span><strong>{t("history.timeline.riemann.notProved")}</strong></div></div> : null}

                {item.reproduction ? <div className="history-reproduction-inline"><div><span className="history-reproduction-label">{t("history.timeline.replayPath")}</span><strong>{item.reproduction.label}</strong><p>{item.reproduction.detail}</p>{item.reproduction.command ? <code>{item.reproduction.command}</code> : null}</div><div className="history-reproduction-links"><a href={item.reproduction.href} rel="noreferrer" target="_blank">{t("history.timeline.openArtifact")} <span aria-hidden="true">↗</span></a>{item.reproduction.workspaceHref && item.reproduction.workspaceLabel ? <a href={item.reproduction.workspaceHref}>{item.reproduction.workspaceLabel} <span aria-hidden="true">→</span></a> : null}</div></div> : null}

                <FieldList layout="stacked" className="history-role-grid"><Field label={t("history.timeline.aiContribution")}>{item.aiRole}</Field><Field label={t("history.timeline.humanContribution")}>{item.humanRole}</Field><Field label={<>{item.frontier ? t("history.timeline.evidenceToday") : t("history.timeline.whyMattered")}</>}> {item.significance}</Field></FieldList>

                {item.frontier ? <div className="history-frontier-boundary"><strong>{t("history.timeline.boundaryTitle")}</strong><p>{item.boundary ?? (item.special === "riemann" ? t("history.timeline.boundaryRiemann") : t("history.timeline.boundaryDefault"))}</p></div> : null}

                <footer>{item.sources.map((source) => <a href={source.href} key={source.href} rel="noreferrer" target="_blank">{source.label} <span aria-hidden="true">↗</span></a>)}</footer>
              </Surface>
            );
          })}
      </div>
    </section>
  );
}

function distributeTimelineLabels(milestones: HistoryMilestone[], width: number) {
  const lastPositions: Record<HistoryMilestone["timelineLane"], number[]> = { above: [], below: [] };
  const lastNodePositions: number[] = [];
  const minimumGap = 188 / width * 100;
  const minimumNodeGap = 48 / width * 100;

  return milestones.map((item) => {
    const position = timelinePosition(item.timelineDate);
    const tracks = lastPositions[item.timelineLane];
    let timelineTrack = tracks.findIndex((lastPosition) => position - lastPosition >= minimumGap);
    if (timelineTrack === -1) timelineTrack = tracks.length;
    tracks[timelineTrack] = position;
    let nodeTrack = lastNodePositions.findIndex((lastPosition) => position - lastPosition >= minimumNodeGap);
    if (nodeTrack === -1) nodeTrack = lastNodePositions.length;
    lastNodePositions[nodeTrack] = position;
    const timelineNodeOffset = nodeTrack === 0 ? 0 : nodeTrack % 2 === 1 ? -48 * Math.ceil(nodeTrack / 2) : 48 * Math.ceil(nodeTrack / 2);
    return { item, timelineNodeOffset, timelineTrack };
  });
}

function formatMilestoneDate(item: HistoryMilestone, locale: Locale): string {
  if (locale === "en") return item.date;
  const parsed = new Date(`${item.timelineDate}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(parsed)
    : item.date;
}

function timelinePosition(date: string) {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const end = Date.parse("2026-10-31T00:00:00Z");
  return 2 + 96 * (Date.parse(`${date}T00:00:00Z`) - start) / (end - start);
}

function timelineTicks(zoom: number, locale: Locale) {
  const ticks: Array<{ date: string; label: string }> = [];
  const step = zoom >= 12 ? 1 : zoom >= 4 ? 7 : 0;
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", ...(step ? { day: "numeric" } as const : {}), timeZone: "UTC" });
  for (let day = new Date("2026-01-01T00:00:00Z"); day <= new Date("2026-10-31T00:00:00Z");) {
    const label = formatter.format(day);
    ticks.push({ date: day.toISOString().slice(0, 10), label: locale === "en" ? label.toUpperCase() : label });
    if (step) day.setUTCDate(day.getUTCDate() + step);
    else day.setUTCMonth(day.getUTCMonth() + 1);
  }
  return ticks;
}
