// A (2, 3) torus knot, matching the winding of the BP cover.
type Point = [number, number, number];
const turn = Math.PI * 2;
const sections = 112;
const strands = 12;

function center(t: number): Point {
  const r = 2 + 0.68 * Math.cos(3 * t);
  return [r * Math.cos(2 * t), r * Math.sin(2 * t), 0.92 * Math.sin(3 * t)];
}

function unit(v: Point): Point {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Point, b: Point): Point {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const vertices: Point[] = [];
const faces: number[][] = [];
for (let i = 0; i < sections; i++) {
  const t = turn * i / sections;
  const c = center(t);
  const next = center(t + .001);
  const tangent = unit([next[0] - c[0], next[1] - c[1], next[2] - c[2]]);
  const n = unit(cross(tangent, [0, 0, 1]));
  const b = cross(tangent, n);
  for (let j = 0; j < strands; j++) {
    const angle = turn * j / strands;
    const u = .40 * Math.cos(angle), v = .40 * Math.sin(angle);
    vertices.push([c[0] + u * n[0] + v * b[0], c[1] + u * n[1] + v * b[1], c[2] + u * n[2] + v * b[2]]);
    const k = (i + 1) % sections, h = (j + 1) % strands;
    faces.push([i * strands + j, k * strands + j, k * strands + h, i * strands + h]);
  }
}

export function weaveRenderer(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const styles = getComputedStyle(canvas);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  const palette = {
    surface: color("--navy-surface"), wire: color("--indigo"),
    light: color("--indigo-ice"), node: color("--on-navy"), gold: color("--amber-ice"),
  };
  let width = 0, height = 0, ratio = 1;
  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  function draw(time: number, yaw: number, pitch: number) {
    if (!width || !height) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scale = Math.min(width / 7.8, height / 6.1);
    const ax = .54 + pitch + .12 * Math.sin(time * .24), ay = -.28 + yaw + .23 * Math.sin(time * .18);
    const az = -.27 + time * .080;
    const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
    const cz = Math.cos(az), sz = Math.sin(az);
    function project([x, y, z]: Point): Point {
      const rx = cz * x - sz * y, ry = sz * x + cz * y;
      const yy = cx * ry - sx * z, zz = sx * ry + cx * z;
      const depth = cy * zz - sy * rx;
      const k = scale * 12 / (12 - depth);
      return [width * .5 + k * (cy * rx + sy * zz), height * .5 - k * yy, depth];
    }
    // Draw the orbital guides first so they recede behind the fabric.
    for (const [a, b, tilt, ink] of [[3.50, 1.22, -.25, palette.light], [3.31, 2.48, .65, palette.gold]] as const) {
      ctx.beginPath();
      ctx.ellipse(width / 2, height / 2, scale * a, scale * b, tilt + yaw * .32 + .05 * Math.sin(time * .25), 0, turn);
      ctx.strokeStyle = ink; ctx.lineWidth = .8; ctx.globalAlpha = .30; ctx.stroke();
    }
    // An illuminated antiprism sits inside the knot, behind its woven surface.
    const coreRadius = .27 + .016 * Math.sin(time * 1.3);
    const coreRing = (upper: boolean) => Array.from({ length: 5 }, (_, i) => {
      const angle = turn * (i + (upper ? .5 : 0)) / 5 - time * .24;
      return project([coreRadius * Math.cos(angle), upper ? .16 : -.16, coreRadius * Math.sin(angle)]);
    });
    const top = coreRing(true), bottom = coreRing(false);
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = .9;
    ctx.globalAlpha = .75;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const next = (i + 1) % 5;
      ctx.moveTo(top[i][0], top[i][1]);
      ctx.lineTo(top[next][0], top[next][1]);
      ctx.moveTo(bottom[i][0], bottom[i][1]);
      ctx.lineTo(bottom[next][0], bottom[next][1]);
      ctx.lineTo(top[i][0], top[i][1]);
      ctx.lineTo(bottom[i][0], bottom[i][1]);
    }
    ctx.stroke();
    const projected = vertices.map(project);
    const sorted = faces.map((face) => ({ face, z: (projected[face[0]][2] + projected[face[2]][2]) * .5 }));
    sorted.sort((a, b) => a.z - b.z);
    ctx.lineJoin = "round";
    for (const { face, z } of sorted) {
      const depth = Math.max(0, Math.min(1, (z + 2.2) / 4.4));
      ctx.beginPath();
      const a = projected[face[0]];
      ctx.moveTo(a[0], a[1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(projected[face[i]][0], projected[face[i]][1]);
      ctx.closePath();
      ctx.fillStyle = palette.surface; ctx.globalAlpha = .79; ctx.fill();
      ctx.strokeStyle = depth > .60 ? palette.light : palette.wire;
      ctx.lineWidth = .55 + depth * .23; ctx.globalAlpha = .43 + depth * .47; ctx.stroke();
    }
    // Mark just the near-facing half of the tube so the points keep their depth.
    for (let i = 7; i < projected.length; i += 19) {
      const [x, y, z] = projected[i];
      if (z < .55) continue;
      const bright = i % 4 === 0;
      ctx.fillStyle = bright ? palette.gold : palette.node;
      ctx.globalAlpha = bright ? .96 : .76;
      ctx.beginPath();
      ctx.arc(x, y, bright ? 1.9 : 1.15, 0, turn);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  return { resize, draw };
}
