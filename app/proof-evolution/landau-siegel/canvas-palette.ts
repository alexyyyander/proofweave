/** Canvas paint styles accept concrete colors. Source data can also supply a literal. */
export function canvasPalette(canvas: HTMLCanvasElement) {
  const styles = getComputedStyle(canvas);
  const colors = new Map<string, string>();

  return (paint: string): string => {
    if (!paint.startsWith("var(--")) return paint;
    const cached = colors.get(paint);
    if (cached) return cached;
    const color = styles.getPropertyValue(paint.slice(4, -1)).trim();
    colors.set(paint, color);
    return color;
  };
}
