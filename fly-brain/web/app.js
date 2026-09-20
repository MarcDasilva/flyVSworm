"use strict";
// Fly brain trader: draws the live stream from server.py. No libraries, no build step.

const $ = (id) => document.getElementById(id);
const MAX_BARS = 300;       // bars kept for the market chart
const RASTER_TICKS = 3000;  // ticks of history in the spike raster
const FLASH_TICKS = 80;     // a synapse stays lit this many ticks after its presynaptic spike
const RATE_FULL = 150;      // Hz at which a neuron's fill is fully saturated
const POPS = ["EPG", "PEN_L", "PEN_R", "D7"];
const POP_VAR = { EPG: "--epg", PEN_L: "--penl", PEN_R: "--penr", D7: "--d7" };
const POP_ROLE = { EPG: "heading", PEN_L: "turns counterclockwise", PEN_R: "turns clockwise", D7: "inhibition" };

const S = { net: null, frame: null, seed: null, t: 0, bars: [], spikes: [], lastSpike: null,
            layout: null, hover: -1, seriesX: null, ws: null };
let C = readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { C = readColors(); buildLegend(); });

function readColors() {
  const s = getComputedStyle(document.documentElement);
  const g = (n) => s.getPropertyValue(n).trim();
  const pop = {};
  for (const p of POPS) pop[p] = g(POP_VAR[p]);
  return { card: g("--card"), ink: g("--ink"), ink2: g("--ink-2"), ink3: g("--ink-3"), grid: g("--grid"),
           pop, long: g("--long"), short: g("--short") };
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Size a canvas to its CSS box at device resolution; returns a context in CSS pixels.
function fit(canvas) {
  const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, w: r.width, h: r.height };
}

// ------------------------------------------------------------------ network --

function prepNetwork(net) {
  net.N = net.neurons.length;
  net.out = Array.from({ length: net.N }, () => []);
  for (const [a, b, w] of net.synapses) net.out[a].push([b, w]);
  const seen = {};
  for (const nr of net.neurons) nr.k = seen[nr.pop] = (seen[nr.pop] ?? -1) + 1;
  net.popSize = {};
  net.popStart = {};
  for (const p of POPS) net.popSize[p] = (seen[p] ?? -1) + 1;
  for (const nr of net.neurons) if (!(nr.pop in net.popStart)) net.popStart[nr.pop] = nr.id;
  net.epg = net.neurons.filter((n) => n.pop === "EPG").sort((a, b) => a.wedge - b.wedge).map((n) => n.id);
  // slot of each neuron among those sharing its population and wedge (several per wedge in the hemibrain)
  const groups = {};
  for (const nr of net.neurons) (groups[`${nr.pop}:${nr.wedge}`] ??= []).push(nr);
  for (const g of Object.values(groups)) g.forEach((nr, i) => { nr.slot = i; nr.slots = g.length; });
  net.big = net.N > 80;
  S.lastSpike = new Float64Array(net.N).fill(-1e9);
  const what = { hemibrain: "hemibrain v1.2.1 (measured)", hemibrain_averaged: "hemibrain v1.2.1 (rotation-averaged)",
                 hemibrain_blend: "hemibrain v1.2.1 (averaged + measured blend)" }[net.source]
    ?? "procedural (idealized)";
  $("circuitMeta").textContent = `${what} · ${net.N} neurons · ${net.synapses.length} synapses`;
  $("raster").parentElement.style.height = `${Math.max(260, net.N * 2.2 + 16)}px`;
}

function humanTime(seconds) {
  const h = seconds / 3600;
  if (h < 1) return `${Math.max(1, Math.round(seconds / 60))} min`;
  return h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(1)} days`;
}

// The brain on Thru: one transaction per synapse, pushed by the backend while it runs.
let chainShown = 0;

async function pollChain() {
  try {
    const c = await (await fetch("/api/chain")).json();
    const note = $("chainNote");
    const counter = $("chainCount");
    if (c.available && c.transactions !== undefined) {
      counter.hidden = false;
      if (c.transactions !== chainShown) {      // flash on each new synapse, then fade back
        chainShown = c.transactions;
        $("chainCountValue").textContent = chainShown.toLocaleString();
        counter.classList.add("tick");
        setTimeout(() => counter.classList.remove("tick"), 120);
      }
    } else {
      counter.hidden = true;
    }
    if (c.available && c.transactions !== undefined) {
      const n = (x) => Number(x).toLocaleString();
      const eta = c.eta_seconds ? `, ~${humanTime(c.eta_seconds)} left` : "";
      const trouble = c.error ? ` · stalled: ${c.error}` : c.note ? ` · ${c.note}` : "";
      note.textContent = `On Thru (${c.network ?? "chain"}): ${n(c.transactions)} transactions — `
        + `${c.neurons} neuron wallets, ${c.synapses} synapses`
        + (c.pending ? ` · ${n(c.pending)} to go${c.sending ? `, sending${eta}` : ""}` : " · complete")
        + trouble;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  } catch (e) {
    /* the chain view is optional: the fly runs with or without it */
  }
  setTimeout(pollChain, 1000);      // the count is served from memory, so a 1 s tick is cheap
}

function buildLegend() {
  if (!S.net) return;
  $("popLegend").innerHTML = POPS.map((p) =>
    `<span><i style="background:${C.pop[p]}"></i>${p} ×${S.net.popSize[p]} · ${POP_ROLE[p]}</span>`).join("");
}

// Ring layout: EPG outer ring at their wedge; PEN_L nudged counterclockwise and PEN_R clockwise
// of their wedge (the direction each pushes the bump); D7 in the centre.
function layout(w, h) {
  const net = S.net, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.34, step = (2 * Math.PI) / net.n_wedges;
  const spread = (nr, width) => (nr.slots > 1 ? ((nr.slot + 0.5) / nr.slots - 0.5) * width : 0);
  const pts = net.neurons.map((nr) => {
    let a, r;
    if (nr.pop === "EPG") { a = (nr.wedge + spread(nr, 0.8)) * step; r = R; }
    else if (nr.pop === "PEN_L") { a = (nr.wedge + 0.3) * step; r = (0.74 - 0.07 * nr.slot) * R; }
    else if (nr.pop === "PEN_R") { a = (nr.wedge - 0.3) * step; r = (0.74 - 0.07 * nr.slot) * R; }
    else {  // D7 in the centre: one ring, or two interleaved rings when there are many
      const two = net.popSize[nr.pop] > 16, per = two ? Math.ceil(net.popSize[nr.pop] / 2) : net.popSize[nr.pop];
      a = ((nr.k % per) * 2 * Math.PI) / per + step / 2 + (two && nr.k >= per ? Math.PI / per : 0);
      r = (two && nr.k >= per ? 0.34 : 0.24) * R;
    }
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a), a };
  });
  return { cx, cy, R, step, pts };
}

function synPath(ctx, L, a, b) {
  const p = L.pts[a], q = L.pts[b];
  ctx.moveTo(p.x, p.y);
  if (S.net.neurons[a].pop === "EPG" && S.net.neurons[b].pop === "EPG") {  // bow outward along the ring
    let da = q.a - p.a;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const m = p.a + da / 2, r = L.R * (1.1 + (0.05 * Math.abs(da)) / L.step);
    ctx.quadraticCurveTo(L.cx + r * Math.cos(m), L.cy - r * Math.sin(m), q.x, q.y);
  } else {
    ctx.lineTo(q.x, q.y);
  }
}

function neuronName(i) {
  const nr = S.net.neurons[i];
  if (nr.pop === "D7") return `D7 ${nr.k}`;
  return nr.slots > 1 ? `${nr.pop} ${nr.wedge}.${nr.slot + 1}` : `${nr.pop} ${nr.wedge}`;
}

function neuronInfo(i) {
  const net = S.net, rate = S.frame ? S.frame.rates[i] : 0, targets = {};
  for (const [b] of net.out[i]) {
    const t = net.neurons[b];
    (targets[t.pop] ??= []).push(t.pop === "D7" ? t.k : t.wedge);
  }
  const lines = Object.entries(targets).map(([p, ws]) => (ws.length > 6 ? `${p} ×${ws.length}` : `${p} ${ws.join(", ")}`));
  const verb = net.out[i].length && net.out[i][0][1] < 0 ? "inhibits" : "excites";
  return `<b>${neuronName(i)}</b> · ${rate.toFixed(0)} Hz<br><span class="k">${verb}</span> ${lines.join(" · ")}`;
}

// ------------------------------------------------------------------- panels --

function drawCircuit() {
  const { ctx, w, h } = fit($("circuit"));
  const net = S.net, L = (S.layout = layout(w, h)), f = S.frame;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.ink3;
  for (let i = 0; i < net.n_wedges; i++) {
    const a = i * L.step, r = L.R * 1.3;
    ctx.fillText(String(i), L.cx + r * Math.cos(a), L.cy - r * Math.sin(a));
  }
  if (f && f.landmark) {  // boot: the landmark that places the first bump
    const a = (net.n_wedges / 4) * L.step, r = L.R * 1.42;
    ctx.fillStyle = C.ink;
    ctx.fillText("☀ landmark", L.cx + r * Math.cos(a), L.cy - r * Math.sin(a));
  }

  // every synapse, faint: drawn once into a cached layer and redrawn only on resize or theme change
  const key = `${w}x${h}x${window.devicePixelRatio}x${C.ink3}`;
  if (S.baseKey !== key) {
    const d = window.devicePixelRatio || 1, off = (S.base ??= document.createElement("canvas"));
    off.width = Math.round(w * d); off.height = Math.round(h * d);
    const o = off.getContext("2d");
    o.setTransform(d, 0, 0, d, 0, 0);
    o.lineWidth = net.big ? 0.6 : 1;
    o.strokeStyle = rgba(C.ink3, net.big ? 0.07 : 0.13);
    o.beginPath();
    for (const [a, b] of net.synapses) synPath(o, L, a, b);
    o.stroke();
    S.baseKey = key;
  }
  ctx.drawImage(S.base, 0, 0, w, h);

  for (let i = 0; i < net.N; i++) {  // synapses lit by recent presynaptic spikes
    const age = S.t - S.lastSpike[i];
    if (age > FLASH_TICKS) continue;
    const k = 1 - age / FLASH_TICKS, col = C.pop[net.neurons[i].pop];
    // the all-to-all EPG<->D7 wiring is drawn faint so the ring's own wiring stays readable
    const ring = [], global = [];
    for (const [b] of net.out[i]) (net.neurons[i].pop === "D7" || net.neurons[b].pop === "D7" ? global : ring).push(b);
    ctx.strokeStyle = rgba(col, (net.big ? 0.08 : 0.15) + (net.big ? 0.4 : 0.7) * k);
    ctx.lineWidth = (net.big ? 0.6 : 1) + (net.big ? 0.6 : 1.2) * k;
    ctx.beginPath();
    for (const b of ring) synPath(ctx, L, i, b);
    ctx.stroke();
    ctx.strokeStyle = rgba(col, 0.04 + 0.14 * k);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const b of global) synPath(ctx, L, i, b);
    ctx.stroke();
  }
  if (S.hover >= 0) {
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [b] of net.out[S.hover]) synPath(ctx, L, S.hover, b);
    ctx.stroke();
  }

  for (let i = 0; i < net.N; i++) {
    const nr = net.neurons[i], p = L.pts[i], col = C.pop[nr.pop];
    const fill = Math.min(1, (f ? f.rates[i] : 0) / RATE_FULL);
    const rad = (nr.pop === "EPG" ? 8 : 6) * (net.big ? 0.6 : 1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, 2 * Math.PI);
    ctx.fillStyle = C.card;
    ctx.fill();
    ctx.fillStyle = rgba(col, 0.1 + 0.9 * fill);
    ctx.fill();
    ctx.lineWidth = S.t - S.lastSpike[i] < 15 ? 2.6 : 1.2;
    ctx.strokeStyle = i === S.hover ? C.ink : col;
    ctx.stroke();
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = C.ink2;
  ctx.fillText("↺ counterclockwise = price rising", 4, 4);
}

function drawCompass() {
  const { ctx, w, h } = fit($("compass"));
  const f = S.frame, net = S.net;
  if (!f) return;
  const nw = net.n_wedges, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.4, step = (2 * Math.PI) / nw;
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (const k of [1 / 3, 2 / 3, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, 2 * Math.PI); ctx.stroke(); }
  const epg = f.wedge_rates ?? net.epg.map((i) => f.rates[i]);  // mean over the EPG in each wedge
  const top = Math.max(RATE_FULL, ...epg);
  ctx.fillStyle = C.pop.EPG;
  epg.forEach((v, i) => {  // one sector per wedge, radius = firing rate
    if (v <= 0) return;
    const a = i * step, r = (R * v) / top;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -(a + step * 0.42), -(a - step * 0.42));
    ctx.closePath();
    ctx.fill();
  });
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (f.bumps === 1) {
    const a = f.heading * step;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * 1.05 * Math.cos(a), cy - R * 1.05 * Math.sin(a));
    ctx.stroke();
    if (Math.abs(f.speed) >= 0.5) {  // turning arrow: length grows with speed
      const sweep = Math.min(Math.PI / 2, (Math.abs(f.speed) / 10) * (Math.PI / 2)) * Math.sign(f.speed);
      const r = R * 1.16, end = a + sweep;
      ctx.strokeStyle = f.speed > 0 ? C.long : C.short;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -a, -end, f.speed > 0);
      ctx.stroke();
      const tip = { x: cx + r * Math.cos(end), y: cy - r * Math.sin(end) };
      const dir = end + Math.sign(f.speed) * (Math.PI / 2);  // tangent at the arrow tip
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(tip.x + 7 * Math.cos(dir), tip.y - 7 * Math.sin(dir));
      ctx.lineTo(tip.x + 5 * Math.cos(dir + 2.3), tip.y - 5 * Math.sin(dir + 2.3));
      ctx.lineTo(tip.x + 5 * Math.cos(dir - 2.3), tip.y - 5 * Math.sin(dir - 2.3));
      ctx.fill();
    }
  } else {
    ctx.fillStyle = C.ink2;
    ctx.fillText(f.phase === "boot" ? "forming bump…" : "no single bump", cx, cy);
  }
}

function drawSeries() {
  const cv = $("series"), tip = $("seriesTip");
  const { ctx, w, h } = fit(cv);
  const bars = S.bars;
  ctx.font = "11px system-ui, sans-serif";
  if (bars.length < 2) {
    tip.hidden = true;
    ctx.fillStyle = C.ink3;
    ctx.fillText(S.frame && S.frame.phase === "boot" ? "Forming the heading bump…" : "Waiting for the first bars…", 8, 18);
    return;
  }
  const x0 = 6, x1 = w - 58, gap = 10;
  const xAt = (i) => x0 + ((x1 - x0) * (i + MAX_BARS - bars.length)) / (MAX_BARS - 1);
  const panels = [
    { label: "Price", frac: 0.34, lines: [{ v: bars.map((b) => b.price), col: C.ink }] },
    { label: "Push-pull drive (× threshold current)", frac: 0.22, zero: true, range: [-1.5, 1.5],
      lines: [{ v: bars.map((b) => b.level), col: C.pop.PEN_L, name: "PEN_L" },
              { v: bars.map((b) => -b.level), col: C.pop.PEN_R, name: "PEN_R" }] },
    { label: "Position (long + / short −)", frac: 0.22, zero: true, range: [-1, 1], bars: bars.map((b) => b.position) },
    { label: "P&L %", frac: 0.22, zero: true, lines: [{ v: bars.map((b) => (b.equity - 1) * 100), col: C.ink }] },
  ];
  const H = h - gap * (panels.length - 1), labelH = 15;
  let y = 0;
  for (const P of panels) {
    const band = y, top = y + labelH, bot = y + H * P.frac;  // label strip above each plot, never on the data
    y = bot + gap;
    const all = P.bars ? P.bars : P.lines.flatMap((l) => l.v);
    let [lo, hi] = P.range ?? [Math.min(...all), Math.max(...all)];
    if (P.zero && !P.range) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08;
    const yAt = (v) => bot - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (bot - top);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, bot + 0.5); ctx.lineTo(x1, bot + 0.5);
    if (P.zero) { ctx.moveTo(x0, yAt(0)); ctx.lineTo(x1, yAt(0)); }
    ctx.stroke();
    if (P.bars) {
      const bw = Math.max(1, (x1 - x0) / MAX_BARS - 0.5);
      P.bars.forEach((v, i) => {
        if (!v) return;
        ctx.fillStyle = v > 0 ? C.long : C.short;
        const ya = yAt(0), yb = yAt(v);
        ctx.fillRect(xAt(i) - bw / 2, Math.min(ya, yb), bw, Math.abs(yb - ya));
      });
    }
    for (const l of P.lines ?? []) {
      ctx.strokeStyle = l.col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      l.v.forEach((v, i) => (i ? ctx.lineTo(xAt(i), yAt(v)) : ctx.moveTo(xAt(i), yAt(v))));
      ctx.stroke();
    }
    ctx.fillStyle = C.ink2;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(P.label, x0 + 2, band + 1);
    ctx.fillStyle = C.ink3;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
    ctx.fillText(fmt(hi), x1 + 6, yAt(hi));
    ctx.fillText(fmt(lo), x1 + 6, yAt(lo));
  }
  if (S.seriesX === null) { tip.hidden = true; return; }
  const i = Math.max(0, Math.min(bars.length - 1,
    Math.round(((S.seriesX - x0) / (x1 - x0)) * (MAX_BARS - 1)) - (MAX_BARS - bars.length)));
  const b = bars[i], x = xAt(i);
  ctx.strokeStyle = C.ink3;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  tip.innerHTML = `<b>${((b.t - S.net.boot_ticks) / 1000).toFixed(1)} s</b><br>` +
    `<span class="k">price</span> ${b.price.toFixed(2)}<br>` +
    `<span class="k">drive</span> ${b.level >= 0 ? "+" : ""}${b.level.toFixed(2)}× (PEN_L ${b.level >= 0 ? "+" : "−"}, PEN_R ${b.level >= 0 ? "−" : "+"})<br>` +
    `<span class="k">position</span> ${b.position >= 0 ? "+" : ""}${b.position.toFixed(2)}<br>` +
    `<span class="k">P&amp;L</span> ${((b.equity - 1) * 100).toFixed(2)}%`;
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 12, w - tip.offsetWidth - 4)}px`;
  tip.style.top = "8px";
}

function drawRaster() {
  const { ctx, w, h } = fit($("raster"));
  const net = S.net, padL = 62, axisH = 16, rowH = (h - axisH) / net.N, t0 = S.t - RASTER_TICKS;
  const xAt = (t) => padL + ((w - padL) * (t - t0)) / RASTER_TICKS;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  for (const p of POPS) {
    const a = net.popStart[p], n = net.popSize[p];
    ctx.fillStyle = C.pop[p];
    ctx.fillRect(0, a * rowH, 4, n * rowH - 1);
    ctx.fillStyle = C.ink2;
    ctx.textAlign = "left";
    ctx.fillText(p, 9, (a + n / 2) * rowH);
    ctx.strokeStyle = C.grid;
    ctx.beginPath(); ctx.moveTo(padL, a * rowH + 0.5); ctx.lineTo(w, a * rowH + 0.5); ctx.stroke();
  }
  for (const p of POPS) {
    ctx.fillStyle = C.pop[p];
    const a = net.popStart[p], z = a + net.popSize[p];
    for (const [t, i] of S.spikes) {
      if (i >= a && i < z) ctx.fillRect(xAt(t), i * rowH + rowH * 0.1, 1.6, Math.max(1, rowH * 0.8));
    }
  }
  ctx.fillStyle = C.ink3;
  ctx.textAlign = "left";
  ctx.fillText(`−${RASTER_TICKS / 1000} s`, padL, h - axisH / 2);
  ctx.textAlign = "right";
  ctx.fillText("now", w - 2, h - axisH / 2);
}

function draw() {
  if (S.net) { drawCircuit(); drawCompass(); drawSeries(); drawRaster(); }
  requestAnimationFrame(draw);
}

// -------------------------------------------------------------- live stream --

function onFrame(f) {
  if (f.seed !== S.seed || f.t < S.t) {  // new fly: drop the old history
    S.bars = [];
    S.spikes = [];
    S.lastSpike.fill(-1e9);
  }
  S.seed = f.seed;
  S.frame = f;
  S.t = f.t;
  for (const s of f.spikes) { S.spikes.push(s); S.lastSpike[s[1]] = s[0]; }
  let k = 0;
  while (k < S.spikes.length && S.spikes[k][0] < S.t - RASTER_TICKS) k++;
  if (k) S.spikes.splice(0, k);
  if (f.bars.length) {
    S.bars.push(...f.bars);
    if (S.bars.length > MAX_BARS) S.bars.splice(0, S.bars.length - MAX_BARS);
  }
  updateStats(f);
}

function updateStats(f) {
  const nw = S.net.n_wedges, deg = 360 / nw;
  const bump = f.bumps === 1;
  $("sHeading").textContent = bump ? `wedge ${f.heading.toFixed(2)} · ${(f.heading * deg).toFixed(0)}°` : "no single bump";
  const turn = Math.abs(f.speed) < 0.5 ? "holding" : `${f.speed > 0 ? "↺" : "↻"} ${Math.abs(f.speed).toFixed(1)} wedges/s`;
  $("sSpeed").textContent = bump ? turn : "–";
  $("sStrength").textContent = f.strength.toFixed(2);
  $("sSignal").textContent = f.warming_up ? "warming up" : f.signal.toFixed(2);
  $("sDrive").textContent = f.level === 0 ? "none"
    : `${Math.abs(f.level).toFixed(2)}× · PEN_L ${f.level > 0 ? "+" : "−"} PEN_R ${f.level > 0 ? "−" : "+"}`;
  $("sPrice").textContent = f.price.toFixed(2);
  $("sPnl").textContent = `${f.equity >= 1 ? "+" : ""}${((f.equity - 1) * 100).toFixed(2)}%`;
  $("phase").textContent = f.phase === "boot" ? "forming the bump (landmark)" : f.warming_up ? "warming up" : "trading";
  const pos = f.position, fill = $("posFill");
  fill.style.background = pos >= 0 ? C.long : C.short;
  fill.style.left = `${50 + Math.min(0, pos) * 50}%`;
  fill.style.width = `${Math.abs(pos) * 50}%`;
  $("posText").textContent = Math.abs(pos) < 0.005 ? "flat" : `${pos > 0 ? "long" : "short"} ${Math.abs(pos).toFixed(2)}`;
  $("pause").textContent = f.paused ? "Resume" : "Pause";
  if (S.ws && S.ws.readyState === 1) setStatus(f.paused ? "paused" : "live", "ok");
}

function downloadRun(run) {
  const blob = new Blob([JSON.stringify(run, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fly-run-seed${run.seed}-t${run.t}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = `pill ${cls}`;
}

function send(msg) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  S.ws = ws;
  setStatus("connecting…", "");
  ws.onopen = () => {  // the page's controls are the source of truth after a reconnect
    send({ type: "market", trend: +$("trend").value, volatility: +$("vol").value });
    send({ type: "speed", speed: +$("speed").value });
  };
  ws.onmessage = (ev) => {
    const f = JSON.parse(ev.data);
    if (f.type === "frame") onFrame(f);
    else if (f.type === "export") downloadRun(f.run);
  };
  ws.onclose = () => {
    setStatus("disconnected · retrying", "bad");
    setTimeout(connect, 1500);
  };
}

function bindControls() {
  const trend = $("trend"), vol = $("vol");
  const showTrend = () => { const v = +trend.value; $("trendVal").textContent = `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} σ/bar`; };
  const showVol = () => { $("volVal").textContent = `${(+vol.value * 100).toFixed(2)} %/bar`; };
  trend.addEventListener("input", () => { showTrend(); send({ type: "market", trend: +trend.value }); });
  vol.addEventListener("input", () => { showVol(); send({ type: "market", volatility: +vol.value }); });
  $("pump").onclick = () => send({ type: "shock", direction: 1 });
  $("dump").onclick = () => send({ type: "shock", direction: -1 });
  $("pause").onclick = () => send({ type: "pause", paused: !(S.frame && S.frame.paused) });
  $("speed").onchange = (e) => send({ type: "speed", speed: +e.target.value });
  $("reset").onclick = () => send({ type: "reset", seed: (S.seed ?? 0) + 1 });
  $("save").onclick = () => send({ type: "export" });
  showTrend();
  showVol();

  const circuit = $("circuit"), tip = $("tip");
  circuit.addEventListener("mousemove", (e) => {
    if (!S.layout) return;
    const r = circuit.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 14 * 14;
    S.layout.pts.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
    S.hover = best;
    if (best < 0) { tip.hidden = true; return; }
    tip.innerHTML = neuronInfo(best);
    tip.hidden = false;
    tip.style.left = `${Math.min(x + 14, r.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${Math.min(y + 14, r.height - tip.offsetHeight - 4)}px`;
  });
  circuit.addEventListener("mouseleave", () => { S.hover = -1; tip.hidden = true; });
  const series = $("series");
  series.addEventListener("mousemove", (e) => { S.seriesX = e.clientX - series.getBoundingClientRect().left; });
  series.addEventListener("mouseleave", () => { S.seriesX = null; });
}

async function init() {
  try {
    S.net = await (await fetch("/api/network")).json();
  } catch (e) {
    setStatus("server not reachable", "bad");
    return;
  }
  prepNetwork(S.net);
  // the explainer's trading numbers come from the server, so they follow DriveParams / ReadoutParams
  for (const el of document.querySelectorAll("[data-trading]")) {
    const v = S.net.trading?.[el.dataset.trading];
    if (v !== undefined) el.textContent = String(v);
  }
  buildLegend();
  pollChain();
  bindControls();
  connect();
  requestAnimationFrame(draw);
}

init();
