/* ============================================================
   BasitWFM AI – ILA Decision Engine
   script.js  |  by Abdul Basit
   All calculations run 100% in browser – no backend required
   ============================================================ */

'use strict';

/* ── State ────────────────────────────────────────────────── */
const State = {
  theme: 'dark',
  currentPanel: 'dashboard',
  config: {
    intervalMin: 30,
    startTime: '08:00',
    endTime: '22:00',
    totalForecast: 5000,
    weights: { w5: 0.10, w4: 0.15, w3: 0.20, w2: 0.25, w1: 0.30 }
  },
  rawData: [],
  calcData: [],
  latestSummary: null,
  decisionSummary: null,
  simulatorDecisionText: '',
  charts: {},
  chatHistory: []
};
const STATE = State;

/* ── Utility ──────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);
const qsa = sel => [...document.querySelectorAll(sel)];
const fmt = n => isFinite(n) ? (+n).toFixed(2) : '—';
const fmtPct = n => isFinite(n) ? (+n).toFixed(1) + '%' : '—';
const fmtNum = n => isFinite(n) ? Math.round(n).toLocaleString() : '—';

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: '💡' };
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${msg}`;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showLoading(show) {
  $('loading-overlay').classList.toggle('show', show);
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function minutesToTime(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function formatIntervalRange(intervals) {
  if (!intervals.length) return 'N/A';
  return `${intervals[0].interval}–${intervals[intervals.length - 1].interval}`;
}

/* ── Interval Generator ───────────────────────────────────── */
function generateIntervals(startTime, endTime, intervalMin) {
  const intervals = [];
  let cur = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  while (cur < end) {
    intervals.push(minutesToTime(cur));
    cur += intervalMin;
  }
  return intervals;
}

/* ── Sample Dataset Generator ────────────────────────────── */
function generateSampleData() {
  const cfg = State.config;
  const intervals = generateIntervals(cfg.startTime, cfg.endTime, cfg.intervalMin);
  // Simulate realistic call volume distribution (bell-curve-ish with afternoon peak)
  const n = intervals.length;
  const data = intervals.map((t, i) => {
    const x = i / n;
    // Two peaks: morning 10-11 and afternoon 13-15
    const vol = Math.max(5,
      Math.round(
        120 * Math.exp(-((x - 0.3) ** 2) / 0.015) +
        200 * Math.exp(-((x - 0.55) ** 2) / 0.012) +
        80  * Math.exp(-((x - 0.75) ** 2) / 0.02)  +
        30  + (Math.random() - 0.5) * 20
      )
    );
    const noise = () => 1 + (Math.random() - 0.5) * 0.25;
    return {
      interval: t,
      w5: Math.round(vol * noise()),
      w4: Math.round(vol * noise()),
      w3: Math.round(vol * noise()),
      w2: Math.round(vol * noise()),
      w1: Math.round(vol * noise()),
      actual: Math.round(vol * noise()),
      baseline: Math.round(vol * (1 + (Math.random() - 0.5) * 0.4))
    };
  });
  return data;
}

/* ── Core Calculation Engine ──────────────────────────────── */
function calculate(rawData, totalForecast, weights) {
  const w = weights;

  // Totals per week
  const totals = {
    w5: rawData.reduce((s,r) => s + r.w5, 0),
    w4: rawData.reduce((s,r) => s + r.w4, 0),
    w3: rawData.reduce((s,r) => s + r.w3, 0),
    w2: rawData.reduce((s,r) => s + r.w2, 0),
    w1: rawData.reduce((s,r) => s + r.w1, 0)
  };

  return rawData.map(row => {
    // 1. Distribution %
    const dist5 = totals.w5 > 0 ? row.w5 / totals.w5 : 0;
    const dist4 = totals.w4 > 0 ? row.w4 / totals.w4 : 0;
    const dist3 = totals.w3 > 0 ? row.w3 / totals.w3 : 0;
    const dist2 = totals.w2 > 0 ? row.w2 / totals.w2 : 0;
    const dist1 = totals.w1 > 0 ? row.w1 / totals.w1 : 0;

    // 2. Weighted distribution
    const wDist = w.w5*dist5 + w.w4*dist4 + w.w3*dist3 + w.w2*dist2 + w.w1*dist1;

    // 3. Forecast split
    const forecast = totalForecast * wDist;
    const forecastAHT = 360; // 6 minutes baseline

    // 4. Accuracy
    const actual = row.actual;
    const volumeShift = forecast > 0 ? (actual - forecast) / forecast : 0;
    const actualAHT = Math.max(280, forecastAHT + volumeShift * 80);
    const requiredFTE = (actual * actualAHT) / 1800 / 0.85;
    const staffedFTE = (forecast * forecastAHT) / 1800 / 0.85;
    const gap = staffedFTE - requiredFTE;
    const baseline = row.baseline;
    const yourErr = actual > 0 ? Math.abs(actual - forecast) / actual * 100 : 0;
    const baseErr = actual > 0 ? Math.abs(actual - baseline) / actual * 100 : 0;
    const improvement = baseErr - yourErr;

    // Flags
    let flag = 'OK';
    if (yourErr > 20) flag = 'HIGH RISK';
    else if (yourErr > 10) flag = 'PEAK';
    else if (forecast > actual * 1.15) flag = 'OVER';
    else if (forecast < actual * 0.85) flag = 'UNDER';

    return {
      interval: row.interval,
      wDist: wDist * 100, // %
      forecast,
      actual,
      baseline,
      yourErr,
      baseErr,
      improvement,
      flag,
      dist5: dist5*100, dist4: dist4*100, dist3: dist3*100,
      dist2: dist2*100, dist1: dist1*100,
      forecastAHT,
      actualAHT,
      requiredFTE,
      staffedFTE,
      gap
    };
  });
}

function summarizeOperationalMetrics(intervals) {
  if (!intervals.length) return null;
  const totalActual = intervals.reduce((s, r) => s + r.actual, 0);
  const totalForecast = intervals.reduce((s, r) => s + r.forecast, 0);
  const totalVariance = totalActual - totalForecast;
  const volumeVariancePct = totalForecast > 0 ? totalVariance / totalForecast * 100 : 0;
  const avgAHTDiff = intervals.reduce((s, r) => s + (r.actualAHT - r.forecastAHT), 0) / intervals.length;
  const avgGap = intervals.reduce((s, r) => s + r.gap, 0) / intervals.length;
  const totalGap = intervals.reduce((s, r) => s + r.gap, 0);
  const worstIntervals = [...intervals].sort((a, b) => a.gap - b.gap).slice(0, 3);
  const backlogRisk = Math.max(0, Math.round(worstIntervals.reduce((s, r) => s + Math.abs(Math.min(0, r.gap)) * 8, 0)));
  return {
    totalActual,
    totalForecast,
    totalVariance,
    volumeVariancePct,
    avgAHTDiff,
    avgGap,
    totalGap,
    worstIntervals,
    backlogRisk
  };
}

function generateDecisionEngine(intervals, summary) {
  if (!intervals.length || !summary) {
    return { rootCause: 'No data available', impact: 'No impact calculated', actions: [] };
  }

  const causes = [];
  if (summary.volumeVariancePct > 10) causes.push('Volume spike');
  if (summary.avgAHTDiff > 15) causes.push('AHT increase');
  if (summary.avgGap < -3) causes.push('Understaffing');
  if (!causes.length) causes.push('Demand-capacity balance stable');

  let rootCause = causes.join(' + ');
  if (causes.length > 1 && causes.includes('Understaffing')) {
    const nonGap = causes.filter(c => c !== 'Understaffing');
    rootCause = nonGap.length ? `${nonGap.join(' + ')} causing understaffing` : rootCause;
  }

  const worstRange = formatIntervalRange([...summary.worstIntervals].sort((a, b) => timeToMinutes(a.interval) - timeToMinutes(b.interval)));
  const impact = `Understaffed by ${fmtNum(Math.abs(summary.totalGap))} FTE across peak intervals (${worstRange}), backlog risk ~${fmtNum(summary.backlogRisk)} calls`;

  const actions = [];
  if (summary.totalGap < -10) {
    actions.push(`Add ${Math.ceil(Math.abs(summary.totalGap) / 2)} agents via OT`);
  }
  if (summary.worstIntervals.length) {
    actions.push('Shift agents from low-volume intervals');
  }
  if (summary.avgAHTDiff > 15) {
    actions.push('Add buffer staffing due to longer handling time');
  }
  if (summary.avgGap > 2 || summary.totalGap > 5) {
    actions.push('Offer VTO or reduce staffing');
  }
  if (!actions.length) actions.push('Maintain current plan and monitor next intraday refresh');

  return { rootCause, impact, actions };
}

function generateSimulatorDecisionOutput(summary) {
  if (!summary) return '';
  const currentGap = Math.round(summary.totalGap);
  const improvedGap = Math.round(currentGap * 0.25);
  const reduction = Math.max(10, Math.min(70, Math.round((1 - Math.abs(improvedGap) / Math.max(1, Math.abs(currentGap))) * 50)));
  return `If applied: Gap improves from ${currentGap} → ${improvedGap}. SLA risk reduces significantly (~${reduction}%).`;
}

function renderDecisionSummary() {
  const root = $('decision-root-cause');
  const impact = $('decision-impact');
  const actions = $('decision-actions');
  const sim = $('decision-simulator-output');
  if (!root || !impact || !actions || !sim) return;

  const decision = State.decisionSummary;
  if (!decision) {
    root.textContent = 'Load data to detect root cause.';
    impact.textContent = 'Impact will appear after calculation.';
    actions.innerHTML = '<li>No recommended actions yet.</li>';
    sim.textContent = '';
    return;
  }

  root.textContent = decision.rootCause;
  impact.textContent = decision.impact;
  actions.innerHTML = decision.actions.map(a => `<li>${a}</li>`).join('');
  sim.textContent = State.simulatorDecisionText;
}

/* ── 4-Hour Rolling Window ────────────────────────────────── */
function calcRollingWindows(calcData, intervalMin) {
  const windowSize = 240; // 4 hours in minutes
  const stepSize   = 60;  // shift 1 hour
  const n = calcData.length;
  const intStart = timeToMinutes(calcData[0].interval);
  const windows = [];

  for (let ws = intStart; ws < intStart + n*intervalMin - windowSize + 1; ws += stepSize) {
    const we = ws + windowSize;
    const rows = calcData.filter(r => {
      const t = timeToMinutes(r.interval);
      return t >= ws && t < we;
    });
    if (rows.length === 0) continue;
    const totalWDist = rows.reduce((s,r) => s + r.wDist, 0);
    const totalForecast = rows.reduce((s,r) => s + r.forecast, 0);
    const totalActual = rows.reduce((s,r) => s + r.actual, 0);
    windows.push({
      label: `${minutesToTime(ws)}–${minutesToTime(Math.min(we, intStart + n*intervalMin))}`,
      startMin: ws,
      totalWDist,
      totalForecast: Math.round(totalForecast),
      totalActual,
      count: rows.length
    });
  }
  return windows;
}

/* ── AI Insight Engine ────────────────────────────────────── */
function generateInsights(calcData, windows) {
  if (!calcData.length) return [];
  const insights = [];

  // Total volume
  const totalActual = calcData.reduce((s,r) => s + r.actual, 0);

  // Top 3 error intervals
  const sorted = [...calcData].sort((a,b) => b.yourErr - a.yourErr);
  const top3Risk = sorted.slice(0,3);

  // Best performing
  const top3Best = [...calcData].sort((a,b) => a.yourErr - b.yourErr).slice(0,3);

  // Peak window
  if (windows.length) {
    const peakWin = windows.reduce((a,b) => b.totalWDist > a.totalWDist ? b : a);
    insights.push({
      type: 'info',
      icon: '📊',
      text: `<strong>Peak load window:</strong> ${peakWin.label} contributing <strong>${fmtPct(peakWin.totalWDist)}</strong> of weighted volume with ${fmtNum(peakWin.totalActual)} actual contacts.`
    });
  }

  // Overall accuracy improvement
  const avgImprove = calcData.reduce((s,r) => s + r.improvement, 0) / calcData.length;
  if (avgImprove > 0) {
    insights.push({
      type: 'good',
      icon: '✅',
      text: `<strong>Model outperforms baseline:</strong> Average ILA improvement of <strong>${fmtPct(avgImprove)}</strong> across all intervals.`
    });
  } else {
    insights.push({
      type: 'warn',
      icon: '⚠️',
      text: `<strong>Baseline outperforms model:</strong> Average deviation of <strong>${fmtPct(Math.abs(avgImprove))}</strong>. Review weighting strategy.`
    });
  }

  // High-risk intervals
  const riskCount = calcData.filter(r => r.flag === 'HIGH RISK').length;
  if (riskCount > 0) {
    insights.push({
      type: 'risk',
      icon: '🔴',
      text: `<strong>${riskCount} high-risk intervals detected</strong> with error >20%. Earliest risk at <strong>${top3Risk[0].interval}</strong> (error: ${fmtPct(top3Risk[0].yourErr)}).`
    });
  }

  // Under-forecast pattern
  const underCount = calcData.filter(r => r.forecast < r.actual * 0.9).length;
  if (underCount > calcData.length * 0.3) {
    insights.push({
      type: 'risk',
      icon: '📉',
      text: `<strong>Systematic under-forecasting detected</strong> in ${underCount} of ${calcData.length} intervals. Consider increasing total forecast volume.`
    });
  }

  // Over-forecast pattern
  const overCount = calcData.filter(r => r.forecast > r.actual * 1.15).length;
  if (overCount > calcData.length * 0.3) {
    insights.push({
      type: 'warn',
      icon: '📈',
      text: `<strong>Over-forecasting pattern detected</strong> in ${overCount} intervals — potential overstaffing risk in low-load periods.`
    });
  }

  // Best interval
  insights.push({
    type: 'good',
    icon: '🏆',
    text: `<strong>Best accuracy at ${top3Best[0].interval}</strong> with only ${fmtPct(top3Best[0].yourErr)} error. W-1 distribution: ${fmtPct(top3Best[0].dist1)}.`
  });

  return insights;
}

/* ── Action Engine ────────────────────────────────────────── */
function generateActions(calcData, windows) {
  if (!calcData.length) return [];
  const actions = [];

  if (windows.length >= 2) {
    const sorted = [...windows].sort((a,b) => b.totalWDist - a.totalWDist);
    const peak = sorted[0];
    const low  = sorted[sorted.length - 1];
    actions.push(`Move 4–6 agents from <strong>${low.label}</strong> to <strong>${peak.label}</strong> to cover peak demand.`);
  }

  const overIntervals = calcData.filter(r => r.flag === 'OVER').slice(0,2);
  if (overIntervals.length) {
    actions.push(`Reduce scheduled headcount by 2–3 agents during <strong>${overIntervals.map(r=>r.interval).join(', ')}</strong> to eliminate overstaffing.`);
  }

  const highRisk = calcData.filter(r => r.flag === 'HIGH RISK').slice(0,2);
  if (highRisk.length) {
    actions.push(`Add 2-hour OT for 5 agents covering <strong>${highRisk.map(r=>r.interval).join(', ')}</strong> — error >20% indicates under-coverage.`);
  }

  const peakBlock = calcData.filter(r => r.wDist > 4).slice(0,3);
  if (peakBlock.length) {
    actions.push(`Pre-position lunch breaks <strong>before</strong> ${peakBlock[0].interval} to ensure full staffing at peak.`);
  }

  actions.push(`Review W-1 distribution weight — increase to 35% if last-week trend closely mirrors current day pattern.`);
  actions.push(`Enable intraday re-forecasting at 12:00 using actual-to-forecast variance to adjust PM staffing.`);

  return actions;
}

/* ── Charts ───────────────────────────────────────────────── */
function initCharts() {
  // Only draw if canvas exists
  drawLineChart();
  drawWindowChart();
  drawHeatmap();
}

function getChartColors() {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
    label: dark ? '#606879' : '#9ca3af',
    forecast: '#4f9cf9',
    actual: '#22d3a0',
    baseline: '#f59e0b'
  };
}

function drawLineChart() {
  const canvas = $('line-chart');
  if (!canvas || !State.calcData.length) return;
  const ctx = canvas.getContext('2d');
  const data = State.calcData;
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);

  const C = getChartColors();
  const labels = data.map(r => r.interval);
  const forecasts = data.map(r => r.forecast);
  const actuals = data.map(r => r.actual);
  const baselines = data.map(r => r.baseline);
  const allVals = [...forecasts, ...actuals, ...baselines];
  const maxV = Math.max(...allVals) * 1.1;
  const minV = 0;

  const pad = { top:30, right:20, bottom:45, left:55 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  function xPos(i) { return pad.left + (i / (data.length - 1)) * pw; }
  function yPos(v) { return pad.top + (1 - (v - minV)/(maxV - minV)) * ph; }

  // Grid
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 5; g++) {
    const y = pad.top + g * ph / 5;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    const val = Math.round(maxV - g * (maxV - minV) / 5);
    ctx.fillStyle = C.label; ctx.font = '10px DM Mono, monospace'; ctx.textAlign = 'right';
    ctx.fillText(val.toLocaleString(), pad.left - 6, y + 3);
  }

  // X labels (every nth)
  const step = Math.max(1, Math.floor(data.length / 12));
  ctx.fillStyle = C.label; ctx.font = '10px DM Mono, monospace'; ctx.textAlign = 'center';
  labels.forEach((l, i) => {
    if (i % step !== 0) return;
    ctx.fillText(l, xPos(i), H - pad.bottom + 16);
  });

  // Draw line
  function drawLine(vals, color, dash=[]) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    vals.forEach((v,i) => {
      if (i === 0) ctx.moveTo(xPos(i), yPos(v));
      else ctx.lineTo(xPos(i), yPos(v));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Area fill for forecast
  ctx.beginPath();
  forecasts.forEach((v,i) => {
    if (i === 0) ctx.moveTo(xPos(i), yPos(v));
    else ctx.lineTo(xPos(i), yPos(v));
  });
  ctx.lineTo(xPos(data.length-1), yPos(0));
  ctx.lineTo(xPos(0), yPos(0));
  ctx.closePath();
  ctx.fillStyle = 'rgba(79,156,249,0.07)';
  ctx.fill();

  drawLine(baselines, C.baseline, [5,4]);
  drawLine(actuals, C.actual);
  drawLine(forecasts, C.forecast);

  // Legend
  const legend = [{c:C.forecast,l:'Forecast'},{c:C.actual,l:'Actual'},{c:C.baseline,l:'Baseline',dash:true}];
  let lx = pad.left;
  legend.forEach(({c,l,dash}) => {
    ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.setLineDash(dash ? [5,4] : []);
    ctx.beginPath(); ctx.moveTo(lx, 14); ctx.lineTo(lx+22, 14); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.label; ctx.font = '11px DM Sans, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(l, lx + 27, 18);
    lx += 90;
  });
}

function drawWindowChart() {
  const canvas = $('window-chart');
  if (!canvas) return;
  const windows = calcRollingWindows(State.calcData, State.config.intervalMin);
  if (!windows.length) return;

  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);

  const C = getChartColors();
  const pad = { top:20, right:20, bottom:55, left:55 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;
  const bw = Math.max(8, pw / windows.length - 6);
  const maxV = Math.max(...windows.map(w => w.totalWDist)) * 1.15;

  // Grid
  for (let g=0; g<=4; g++) {
    const y = pad.top + g * ph / 4;
    ctx.strokeStyle = C.grid; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
    const val = (maxV - g*(maxV/4)).toFixed(1)+'%';
    ctx.fillStyle = C.label; ctx.font='10px DM Mono, monospace'; ctx.textAlign='right';
    ctx.fillText(val, pad.left-5, y+3);
  }

  windows.forEach((w,i) => {
    const x = pad.left + (i / windows.length) * pw + (pw/windows.length - bw)/2;
    const barH = (w.totalWDist / maxV) * ph;
    const y = pad.top + ph - barH;
    // Color by intensity
    const pct = w.totalWDist / maxV;
    const r = Math.round(79  + (240-79)  * pct);
    const g2= Math.round(156 + (86-156)  * pct);
    const b = Math.round(249 + (90-249)  * pct);
    ctx.fillStyle = `rgba(${r},${g2},${b},0.85)`;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, bw, barH, 4) : ctx.rect(x, y, bw, barH);
    ctx.fill();

    // Label
    ctx.fillStyle = C.label; ctx.font='9px DM Mono, monospace'; ctx.textAlign='center';
    const lbl = w.label.split('–')[0];
    ctx.save(); ctx.translate(x+bw/2, pad.top+ph+14); ctx.rotate(-0.5);
    ctx.fillText(lbl, 0, 0); ctx.restore();

    // Value on bar
    if (barH > 20) {
      ctx.fillStyle = '#fff'; ctx.font='9px DM Mono, monospace'; ctx.textAlign='center';
      ctx.fillText(fmtPct(w.totalWDist), x+bw/2, y+12);
    }
  });
}

function drawHeatmap() {
  const container = $('heatmap-container');
  if (!container || !State.calcData.length) return;
  container.innerHTML = '';

  const data = State.calcData;
  const errors = data.map(r => r.yourErr);
  const maxErr = Math.max(...errors, 1);

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';
  grid.style.gridTemplateColumns = `80px 1fr`;

  data.forEach(row => {
    // Label
    const lbl = document.createElement('div');
    lbl.className = 'hm-label-row';
    lbl.textContent = row.interval;
    grid.appendChild(lbl);

    // Cell
    const cell = document.createElement('div');
    cell.className = 'hm-cell';
    const t = row.yourErr / maxErr;
    // Green → Amber → Red gradient
    let r, g, b;
    if (t < 0.5) {
      r = Math.round(34  + (245-34)  * (t*2));
      g = Math.round(211 + (158-211) * (t*2));
      b = Math.round(160 + (11-160)  * (t*2));
    } else {
      r = Math.round(245 + (240-245) * ((t-0.5)*2));
      g = Math.round(158 + (86-158)  * ((t-0.5)*2));
      b = Math.round(11  + (90-11)   * ((t-0.5)*2));
    }
    cell.style.background = `rgba(${r},${g},${b},0.75)`;
    cell.style.flex = '1';
    cell.textContent = fmtPct(row.yourErr);
    cell.style.color = t > 0.6 ? '#fff' : 'rgba(0,0,0,0.7)';
    cell.title = `${row.interval}: ${fmtPct(row.yourErr)} error | ${fmtPct(row.baseErr)} baseline | ${fmtPct(row.improvement)} improvement`;
    grid.appendChild(cell);
  });
  container.appendChild(grid);
}

/* ── Table Renderer ───────────────────────────────────────── */
function renderTable() {
  const tbody = $('results-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!State.calcData.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="padding:2.5rem;">No data loaded. Configure settings and load data first.</td></tr>`;
    return;
  }

  State.calcData.forEach((row, idx) => {
    const tr = document.createElement('tr');

    // Row highlight
    if (row.flag === 'HIGH RISK') tr.className = 'row-risk';
    else if (row.flag === 'PEAK')  tr.className = 'row-peak';
    else if (row.improvement > 3) tr.className = 'row-top';

    const impClass = row.improvement > 1 ? 'pos' : row.improvement < -1 ? 'neg' : 'neu';
    const flagClass = {
      'HIGH RISK': 'flag-risk',
      'PEAK':      'flag-peak',
      'OK':        'flag-ok',
      'OVER':      'flag-over',
      'UNDER':     'flag-risk'
    }[row.flag] || 'flag-ok';

    const insight = generateRowInsight(row);
    const action  = generateRowAction(row);

    tr.innerHTML = `
      <td class="td-label">${row.interval}</td>
      <td data-tip="5-week weighted distribution prioritizing recent trends. W-1 carries 30% weight.">${fmtPct(row.wDist)}</td>
      <td>${fmtNum(row.forecast)}</td>
      <td>${fmtNum(row.actual)}</td>
      <td data-tip="Your forecast error: abs(Actual − Forecast) ÷ Actual × 100">${fmtPct(row.yourErr)}</td>
      <td data-tip="Baseline forecast error for comparison">${fmtPct(row.baseErr)}</td>
      <td class="td-improve ${impClass}" data-tip="ILA Improvement = Baseline Error − Your Error. Positive = you win.">${row.improvement > 0 ? '+' : ''}${fmtPct(row.improvement)}</td>
      <td><span class="td-flag ${flagClass}">${row.flag}</span></td>
      <td class="td-insight">${insight}</td>
      <td class="td-action">${action}</td>
    `;
    tbody.appendChild(tr);
  });
}

function generateRowInsight(row) {
  if (row.flag === 'HIGH RISK') return `⚠ Under-forecast by ${fmtPct(row.yourErr)} — major staffing gap`;
  if (row.flag === 'OVER')      return `Surplus volume; ${fmtPct(Math.abs(row.improvement))} over-allocation`;
  if (row.flag === 'PEAK')      return `Moderate risk; W-1 dist ${fmtPct(row.dist1)}`;
  if (row.improvement > 5)      return `Strong accuracy gain vs baseline (+${fmtPct(row.improvement)})`;
  if (row.improvement < -5)     return `Baseline beats model here — review W-weights`;
  return `Stable. Error within acceptable range.`;
}

function generateRowAction(row) {
  if (row.flag === 'HIGH RISK') return `⚡ Add 3–5 agents or OT immediately`;
  if (row.flag === 'OVER')      return `Move surplus agents to high-need intervals`;
  if (row.flag === 'PEAK')      return `Monitor closely; pre-position flexible agents`;
  if (row.improvement > 5)      return `Maintain current schedule`;
  if (row.improvement < -5)     return `Increase W-1 weight for this interval`;
  return `No immediate action needed`;
}

/* ── Dashboard Stats ──────────────────────────────────────── */
function updateDashboardStats() {
  const d = State.calcData;
  if (!d.length) return;

  const avgYourErr  = d.reduce((s,r) => s + r.yourErr, 0)  / d.length;
  const avgBaseErr  = d.reduce((s,r) => s + r.baseErr, 0)  / d.length;
  const avgImprove  = d.reduce((s,r) => s + r.improvement, 0) / d.length;
  const totalActual = d.reduce((s,r) => s + r.actual, 0);
  const riskCount   = d.filter(r => r.flag === 'HIGH RISK').length;
  const ila = 100 - avgYourErr;

  setText('stat-ila',     fmtPct(ila));
  setText('stat-improve', (avgImprove>0?'+':'')+fmtPct(avgImprove));
  setText('stat-risk',    riskCount + ' intervals');
  setText('stat-volume',  fmtNum(totalActual));
  setText('stat-base-err', fmtPct(avgBaseErr));
  setText('stat-intervals', d.length + ' slots');

  const el = $('stat-improve');
  if (el) el.style.color = avgImprove > 0 ? 'var(--green)' : 'var(--red)';
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

/* ── Rolling Window Stats ─────────────────────────────────── */
function renderWindowStats() {
  const container = $('window-stats');
  if (!container) return;
  const windows = calcRollingWindows(State.calcData, State.config.intervalMin);
  if (!windows.length) {
    container.innerHTML = '<p class="text-muted text-sm">No data loaded.</p>';
    return;
  }
  const maxV = Math.max(...windows.map(w=>w.totalWDist));
  container.innerHTML = windows.map(w => {
    const pct = w.totalWDist / maxV;
    const cls = pct > 0.75 ? 'high' : pct > 0.45 ? 'mid' : 'low';
    return `
      <div class="flex gap-12 mb-8" style="align-items:center;">
        <div style="width:120px;font-family:var(--font-mono);font-size:.78rem;color:var(--text2);">${w.label}</div>
        <div class="flex-1">
          <div class="progress-bar-wrap">
            <div class="progress-bar ${cls==='high'?'red':cls==='mid'?'amber':'green'}" style="width:${(w.totalWDist/maxV*100).toFixed(1)}%"></div>
          </div>
        </div>
        <span class="window-badge ${cls}">${fmtPct(w.totalWDist)}</span>
        <span style="font-size:.75rem;color:var(--text3);font-family:var(--font-mono);">${fmtNum(w.totalActual)} calls</span>
      </div>
    `;
  }).join('');
}

/* ── Insights Panel ───────────────────────────────────────── */
function renderInsights() {
  const container = $('insights-list');
  const actContainer = $('actions-list');
  if (!container) return;

  const windows = calcRollingWindows(State.calcData, State.config.intervalMin);
  const insights = generateInsights(State.calcData, windows);
  const actions  = generateActions(State.calcData, windows);

  if (!insights.length) {
    container.innerHTML = '<div class="empty-state"><div class="es-icon">🧠</div><h3>No insights yet</h3><p>Load data to generate AI insights.</p></div>';
    return;
  }

  container.innerHTML = insights.map(ins => `
    <div class="insight-item ${ins.type}">
      <span class="insight-icon">${ins.icon}</span>
      <span class="insight-text">${ins.text}</span>
    </div>
  `).join('');

  if (actContainer) {
    actContainer.innerHTML = actions.map((a,i) => `
      <div class="action-item">
        <span class="action-num">${i+1}</span>
        <span>${a}</span>
      </div>
    `).join('');
  }
}

/* ── Email Generator ──────────────────────────────────────── */
function generateEmail(type = 'daily') {
  if (!State.calcData.length) { toast('Load data first to generate email', 'error'); return; }

  const windows = calcRollingWindows(State.calcData, State.config.intervalMin);
  const d = State.calcData;
  const avgImp = d.reduce((s,r)=>s+r.improvement,0)/d.length;
  const peakWin = windows.length ? windows.reduce((a,b)=>b.totalWDist>a.totalWDist?b:a) : null;
  const riskIntervals = d.filter(r=>r.flag==='HIGH RISK').map(r=>r.interval);
  const totalActual = d.reduce((s,r)=>s+r.actual,0);
  const totalForecast = d.reduce((s,r)=>s+r.forecast,0);

  const today = new Date().toLocaleDateString('en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

  const subjects = {
    daily: `[WFM Daily Brief] Volume Forecast & Staffing Plan – ${today}`,
    alert: `⚠️ [WFM ALERT] High-Risk Intervals Detected – Immediate Action Required`,
    summary: `[WFM Weekly Summary] ILA Performance Report by Abdul Basit WFM`
  };

  const eodLeadershipSummary = generateEODSummary();
  const bodies = {
    daily: `Hi Team,

Please find below today's intraday volume forecast and staffing recommendations powered by BasitWFM AI.

📊 KEY METRICS
──────────────────────────────
• Total Forecast Volume: ${fmtNum(totalForecast)}
• Total Actual Volume: ${fmtNum(totalActual)}
• ILA Improvement vs Baseline: ${avgImp>0?'+':''}${fmtPct(avgImp)}
• High-Risk Intervals: ${riskIntervals.length}

📈 PEAK LOAD WINDOW
──────────────────────────────
${peakWin ? `Peak activity is concentrated between ${peakWin.label}, contributing ${fmtPct(peakWin.totalWDist)} of total weighted volume with an estimated ${fmtNum(peakWin.totalActual)} contacts.` : 'No peak window data available.'}

⚠️ RISK ALERT
──────────────────────────────
${riskIntervals.length > 0
  ? `Under-forecasting detected at: ${riskIntervals.slice(0,5).join(', ')}. Recommend adding OT or flexible agents.`
  : 'No critical risk intervals identified today.'}

✅ RECOMMENDED ACTIONS
──────────────────────────────
1. Pre-position maximum agents at peak window start.
2. Approve discretionary OT for high-risk intervals.
3. Reduce scheduled breaks during ${peakWin ? peakWin.label.split('–')[0] : 'peak hours'}.
4. Run 30-minute intraday refresh at 12:00.

Report generated by BasitWFM AI | Abdul Basit WFM
For questions contact your WFM planning team.`,

    alert: `⚠️ URGENT WFM ALERT – ${today}

BasitWFM AI has detected ${riskIntervals.length} high-risk intervals with forecast error exceeding 20%.

🔴 AFFECTED INTERVALS: ${riskIntervals.join(', ') || 'N/A'}

IMPACT ASSESSMENT:
• Service level risk: HIGH
• Estimated understaffing: ${riskIntervals.length * 3}–${riskIntervals.length * 5} agent-hours
• SLA impact without action: Moderate to Severe

IMMEDIATE ACTIONS REQUIRED:
1. Activate standby OT agents NOW for affected intervals.
2. Reduce AHT target by 5% for ${riskIntervals[0] || 'peak'} interval.
3. Alert supervisor team to extend available hours.
4. Notify WFM Manager for sign-off on OT approval.

Sent automatically by BasitWFM AI | Abdul Basit WFM
Do not reply to this message.`,

    summary: `EXECUTIVE EOD REPORT
Generated by BasitWFM AI | Abdul Basit WFM

DATE: ${today}

${eodLeadershipSummary}

Leadership Note:
Please validate OT deployment before 11:00 and confirm tomorrow's shrinkage assumptions in the planning huddle.`
  };

  const preview = $('email-preview');
  if (preview) {
    preview.querySelector('.email-subject').textContent = subjects[type];
    preview.querySelector('.email-body').textContent = bodies[type];
  }
  $('email-copy-btn').style.display = 'inline-flex';
  toast('Email generated successfully!', 'success');
}

function generateEODSummary() {
  if (!State.calcData.length || !State.latestSummary || !State.decisionSummary) {
    return 'No EOD summary available. Run the engine first.';
  }
  const d = State.calcData;
  const avgErr = d.reduce((s, r) => s + r.yourErr, 0) / d.length;
  const issue = State.latestSummary.totalGap < -10 ? 'Staffing deficit across peak intervals' : 'No major operational issue';
  return [
    '1) Performance Summary',
    `ILA ${fmtPct(100 - avgErr)} | Actual ${fmtNum(State.latestSummary.totalActual)} vs Forecast ${fmtNum(State.latestSummary.totalForecast)}`,
    '2) Key Issue',
    issue,
    '3) Root Cause',
    State.decisionSummary.rootCause,
    '4) Actions Taken',
    State.decisionSummary.actions.map((a, i) => `${i + 1}. ${a}`).join(' | '),
    '5) Tomorrow Plan',
    'Run intraday refresh by 10:00, protect peak coverage, and review AHT driver trends with operations leads.'
  ].join('\n');
}

/* ── WFM Copilot Chat ─────────────────────────────────────── */
const CHAT_KB = {
  'sla': 'SLA drops when actual volume exceeds forecasted volume, causing insufficient staffing. Based on current data, peak intervals with >20% error are your biggest risk. Review the high-risk intervals table and pre-position agents.',
  'agent': 'Based on current volume patterns, I recommend shifting agents from low-load early morning intervals to peak windows. The 4-hour rolling window analysis shows where demand concentration is highest.',
  'forecast': 'Your forecast accuracy (ILA) is calculated as: ILA = 100% − |Actual − Forecast| / Actual × 100. Your model outperforms/lags baseline depending on the improvement column — positive values mean you win.',
  'accuracy': 'Forecast accuracy = 100 − error%. The weighted distribution model prioritizes recent weeks (W-1 = 30%, W-2 = 25%) to capture the latest trends. Accuracy improves when historical patterns are stable.',
  'ila': 'ILA (Interval Level Accuracy) measures how accurately the forecast matches actual volume at each time interval. Formula: ILA = 1 − abs(Actual − Forecast) / Actual. Target >90% for SLA-critical operations.',
  'peak': 'Peak intervals are identified from 4-hour rolling windows. The window with highest weighted distribution % is your primary peak. Pre-position maximum headcount before this window starts.',
  'baseline': 'Baseline forecast is your previous/standard forecast used for comparison. The Improvement column shows how much better (or worse) the BasitWFM AI weighted model performs vs baseline.',
  'weight': 'Weights reflect recency bias: W-1 (last week) = 30%, W-2 = 25%, W-3 = 20%, W-4 = 15%, W-5 = 10%. You can adjust these in Settings. If patterns are volatile, increasing W-1 helps.',
  'overtime': 'Approve OT for intervals flagged as HIGH RISK (>20% error). The Action Engine recommends specific intervals. Coordinate with scheduling team 24–48 hours in advance when possible.',
  'move': 'To move agents: identify surplus intervals (OVER flag) and deficit intervals (HIGH RISK). Use the Action Recommendations panel for specific suggestions based on your data.',
  'rolling': '4-hour rolling windows aggregate volume across overlapping 4-hour blocks, shifting every 1 hour. This reveals which parts of the day carry the heaviest load and require maximum coverage.',
  'distribution': 'Distribution % shows what proportion of daily volume lands in each interval. Weighted distribution blends the last 5 weeks using recency weights to produce the most accurate pattern.',
  'wfm': 'BasitWFM AI is a Workforce Management decision engine built by Abdul Basit. It uses interval-level accuracy (ILA), weighted historical distributions, and rolling window analysis to optimize staffing decisions.',
  'hello': `Hi! I'm the WFM Copilot powered by BasitWFM AI. Ask me about SLA, forecasting accuracy, agent movements, peak windows, or any WFM concept. Try: "Why is SLA dropping?" or "Where should I move agents?"`,
  'help': 'I can help with: SLA analysis, forecast accuracy, agent movement recommendations, ILA explanation, peak window detection, weight tuning, overtime justification, and baseline comparison. What do you need?',
};

function askCopilot(query) {
  const lower = query.toLowerCase();
  const needsDecision = ['why', 'sla', 'what should i do'].some(k => lower.includes(k));
  if (needsDecision && State.decisionSummary) {
    return [
      '🚨 SLA Risk Detected',
      `Root Cause: ${State.decisionSummary.rootCause}`,
      `Impact: ${State.decisionSummary.impact}`,
      'Actions:',
      ...State.decisionSummary.actions.map(a => `• ${a}`)
    ].join('\n');
  }

  for (const [key, answer] of Object.entries(CHAT_KB)) {
    if (lower.includes(key)) {
      return enrichChatAnswer(answer);
    }
  }
  // Fallback with data context
  if (State.calcData.length) {
    const d = State.calcData;
    const avgErr = d.reduce((s,r)=>s+r.yourErr,0)/d.length;
    const riskCount = d.filter(r=>r.flag==='HIGH RISK').length;
    return `Based on your loaded data (${d.length} intervals, avg error: ${fmtPct(avgErr)}, ${riskCount} risk intervals), I don't have a direct rule for that query. 

Try asking about: SLA, agents, forecast accuracy, peak window, ILA, overtime, weights, rolling window, or baseline comparison.`;
  }
  return `I don't have a specific answer for that yet. Try loading data first, then ask about: SLA, forecast accuracy, agent movement, peak windows, ILA, or overtime recommendations.`;
}

function enrichChatAnswer(answer) {
  if (!State.calcData.length) return answer;
  const d = State.calcData;
  const topPeak = d.reduce((a,b)=>b.wDist>a.wDist?b:a);
  const topRisk = d.filter(r=>r.flag==='HIGH RISK')[0];
  let extra = `\n\n📊 From your data: Peak at ${topPeak.interval} (${fmtPct(topPeak.wDist)} weighted dist).`;
  if (topRisk) extra += ` Highest risk: ${topRisk.interval} (${fmtPct(topRisk.yourErr)} error).`;
  return answer + extra;
}

function addChatMessage(text, role = 'user') {
  const messages = $('chat-messages');
  if (!messages) return;
  const div = document.createElement('div');
  div.className = `chat-bubble ${role} anim-fade`;
  if (role === 'ai') {
    div.innerHTML = `<div class="ai-label">🤖 WFM Copilot</div>${text.replace(/\n/g,'<br>')}`;
  } else {
    div.textContent = text;
  }
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  State.chatHistory.push({ role, text });
}

function showTyping() {
  const messages = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-bubble ai';
  div.id = 'typing-bubble';
  div.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function removeTyping() {
  const el = $('typing-bubble');
  if (el) el.remove();
}

function sendChatMessage(text) {
  if (!text.trim()) return;
  addChatMessage(text, 'user');
  showTyping();
  setTimeout(() => {
    removeTyping();
    const response = askCopilot(text);
    addChatMessage(response, 'ai');
  }, 800 + Math.random() * 600);
}

/* ── CSV Parser ───────────────────────────────────────────── */
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l=>l.trim());
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/\s+/g,'_').replace(/-/g,'_'));
  const rows = [];
  for (let i=1; i<lines.length; i++) {
    const cells = lines[i].split(',').map(c=>c.trim());
    const obj = {};
    headers.forEach((h,idx) => obj[h] = cells[idx] || '0');
    rows.push(obj);
  }
  return { headers, rows };
}

function csvToRawData(parsed) {
  const { headers, rows } = parsed;
  // Try to map common column names
  const map = {
    interval: headers.find(h=>h.includes('interval')||h.includes('time')) || headers[0],
    w5: headers.find(h=>h.includes('w5')||h.includes('w_5')||h.includes('week_5')) || headers[1],
    w4: headers.find(h=>h.includes('w4')||h.includes('w_4')||h.includes('week_4')) || headers[2],
    w3: headers.find(h=>h.includes('w3')||h.includes('w_3')||h.includes('week_3')) || headers[3],
    w2: headers.find(h=>h.includes('w2')||h.includes('w_2')||h.includes('week_2')) || headers[4],
    w1: headers.find(h=>h.includes('w1')||h.includes('w_1')||h.includes('week_1')) || headers[5],
    actual: headers.find(h=>h.includes('actual')) || headers[6],
    baseline: headers.find(h=>h.includes('baseline')) || headers[7]
  };
  return rows.map(r => ({
    interval: r[map.interval] || '',
    w5: parseFloat(r[map.w5]) || 0,
    w4: parseFloat(r[map.w4]) || 0,
    w3: parseFloat(r[map.w3]) || 0,
    w2: parseFloat(r[map.w2]) || 0,
    w1: parseFloat(r[map.w1]) || 0,
    actual: parseFloat(r[map.actual]) || 0,
    baseline: parseFloat(r[map.baseline]) || 0
  })).filter(r=>r.interval);
}

function parsePastedData(text) {
  // Tab or comma separated; first row headers
  const sep = text.includes('\t') ? '\t' : ',';
  const lines = text.trim().split('\n').filter(l=>l.trim());
  if (lines.length < 2) return null;
  const headers = lines[0].split(sep).map(h=>h.trim().toLowerCase().replace(/\s+/g,'_'));
  const rows = lines.slice(1).map(l=>l.split(sep).map(c=>c.trim()));
  const obj = { headers, rows: rows.map(r=>{
    const o={}; headers.forEach((h,i)=>o[h]=r[i]||'0'); return o;
  })};
  return csvToRawData(obj);
}

/* ── Run Engine ───────────────────────────────────────────── */
function runEngine(rawData) {
  showLoading(true);
  setTimeout(() => {
    State.rawData = rawData;
    State.calcData = calculate(rawData, State.config.totalForecast, State.config.weights);
    State.latestSummary = summarizeOperationalMetrics(State.calcData);
    State.decisionSummary = generateDecisionEngine(State.calcData, State.latestSummary);
    STATE.decisionSummary = State.decisionSummary;
    State.simulatorDecisionText = generateSimulatorDecisionOutput(State.latestSummary);
    updateDashboardStats();
    renderDecisionSummary();
    renderTable();
    renderInsights();
    renderWindowStats();
    initCharts();
    toast(`Engine ran on ${rawData.length} intervals ✅`, 'success');
    showLoading(false);
  }, 300);
}

/* ── Navigation ───────────────────────────────────────────── */
function switchPanel(name) {
  qsa('.panel').forEach(p => p.classList.remove('active'));
  qsa('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = $('panel-' + name);
  const navEl = document.querySelector(`[data-nav="${name}"]`);
  if (panel) panel.classList.add('active');
  if (navEl) navEl.classList.add('active');
  State.currentPanel = name;

  // Redraw charts when switching to relevant panels
  if (name === 'charts') {
    setTimeout(() => {
      drawLineChart();
      drawWindowChart();
    }, 100);
  }
  if (name === 'heatmap') {
    setTimeout(() => drawHeatmap(), 100);
  }
}

/* ── Theme Toggle ─────────────────────────────────────────── */
function toggleTheme() {
  State.theme = State.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', State.theme === 'light' ? 'light' : '');
  const btn = $('theme-toggle-btn');
  if (btn) btn.textContent = State.theme === 'dark' ? '☀️' : '🌙';
  // Redraw charts
  setTimeout(() => {
    drawLineChart();
    drawWindowChart();
  }, 50);
}

/* ── CSV Export ───────────────────────────────────────────── */
function exportCSV() {
  if (!State.calcData.length) { toast('No data to export', 'error'); return; }
  const headers = ['Interval','Weighted%','Forecast','Actual','Error%','Baseline_Error%','Improvement','Flag','Insight'];
  const rows = State.calcData.map(r => [
    r.interval, fmt(r.wDist), fmt(r.forecast), r.actual, fmt(r.yourErr), fmt(r.baseErr), fmt(r.improvement), r.flag, generateRowInsight(r).replace(/[,<>]/g,'')
  ]);
  const csv = [headers, ...rows].map(r=>r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `BasitWFM_ILA_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  toast('CSV exported!', 'success');
}

/* ── Init ─────────────────────────────────────────────────── */
function initSampleData() {
  const rawData = generateSampleData();
  runEngine(rawData);
}

function showApp() {
  $('landing').style.display = 'none';
  $('app').style.display = 'block';
  document.body.style.overflow = '';
  // Init sample data on first load
  if (!State.calcData.length) initSampleData();
}

function showLanding() {
  $('app').style.display = 'none';
  $('landing').style.display = 'flex';
}

/* ── Config Update ────────────────────────────────────────── */
function applyConfig() {
  const intervalMin = parseInt($('cfg-interval').value) || 30;
  const startTime   = $('cfg-start').value   || '08:00';
  const endTime     = $('cfg-end').value     || '22:00';
  const totalForecast = parseFloat($('cfg-total').value) || 5000;
  const w1 = parseFloat($('cfg-w1').value)/100 || 0.30;
  const w2 = parseFloat($('cfg-w2').value)/100 || 0.25;
  const w3 = parseFloat($('cfg-w3').value)/100 || 0.20;
  const w4 = parseFloat($('cfg-w4').value)/100 || 0.15;
  const w5 = parseFloat($('cfg-w5').value)/100 || 0.10;
  const wTotal = w1+w2+w3+w4+w5;
  if (Math.abs(wTotal - 1.0) > 0.05) {
    toast(`Weights sum to ${fmtPct(wTotal*100)} — should be 100%`, 'error'); return;
  }
  State.config = { intervalMin, startTime, endTime, totalForecast, weights:{w5,w4,w3,w2,w1} };

  // Re-generate sample data with new intervals if using sample
  if (State.rawData.length) {
    runEngine(State.rawData);
    toast('Config applied & recalculated!', 'success');
  } else {
    toast('Config saved. Load data to recalculate.', 'info');
  }
}

/* ── DOM Ready ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Nav items ── */
  qsa('[data-nav]').forEach(el => {
    el.addEventListener('click', () => switchPanel(el.dataset.nav));
  });

  /* ── Theme ── */
  const themeBtn = $('theme-toggle-btn');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  const themeBtnTop = $('theme-toggle-top');
  if (themeBtnTop) themeBtnTop.addEventListener('click', toggleTheme);

  /* ── Landing CTA ── */
  qsa('[data-cta="launch"]').forEach(el => el.addEventListener('click', showApp));

  /* ── Sample Data button ── */
  const sampleBtn = $('load-sample-btn');
  if (sampleBtn) sampleBtn.addEventListener('click', () => { initSampleData(); switchPanel('dashboard'); });

  /* ── Config apply ── */
  const cfgApply = $('cfg-apply-btn');
  if (cfgApply) cfgApply.addEventListener('click', applyConfig);

  /* ── CSV Upload ── */
  const fileInput = $('csv-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const parsed = parseCSV(ev.target.result);
        if (!parsed) { toast('Could not parse CSV', 'error'); return; }
        const rawData = csvToRawData(parsed);
        if (!rawData.length) { toast('No valid rows found in CSV', 'error'); return; }
        runEngine(rawData);
        switchPanel('dashboard');
      };
      reader.readAsText(f);
    });
  }

  /* ── Drop zone ── */
  const dropZone = $('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('click', () => fileInput && fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragging'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragging');
      const f = e.dataTransfer.files[0];
      if (f && fileInput) { const dt = new DataTransfer(); dt.items.add(f); fileInput.files = dt.files; fileInput.dispatchEvent(new Event('change')); }
    });
  }

  /* ── Paste data ── */
  const pasteBtn = $('paste-apply-btn');
  if (pasteBtn) {
    pasteBtn.addEventListener('click', () => {
      const text = $('paste-area').value;
      if (!text.trim()) { toast('Paste data first', 'error'); return; }
      const rawData = parsePastedData(text);
      if (!rawData || !rawData.length) { toast('Could not parse pasted data', 'error'); return; }
      runEngine(rawData);
      switchPanel('dashboard');
    });
  }

  /* ── CSV Export ── */
  const exportBtn = $('export-csv-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportCSV);

  /* ── Chat ── */
  const chatInput = $('chat-input');
  const chatSend  = $('chat-send-btn');
  if (chatSend) {
    chatSend.addEventListener('click', () => {
      const t = chatInput.value.trim();
      chatInput.value = '';
      if (t) sendChatMessage(t);
    });
  }
  if (chatInput) {
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const t = chatInput.value.trim();
        chatInput.value = '';
        if (t) sendChatMessage(t);
      }
    });
  }
  qsa('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => sendChatMessage(btn.textContent));
  });

  /* ── Email generator ── */
  qsa('[data-email-type]').forEach(btn => {
    btn.addEventListener('click', () => generateEmail(btn.dataset.emailType));
  });

  const copyEmailBtn = $('email-copy-btn');
  if (copyEmailBtn) {
    copyEmailBtn.addEventListener('click', () => {
      const preview = $('email-preview');
      const text = `Subject: ${preview.querySelector('.email-subject').textContent}\n\n${preview.querySelector('.email-body').textContent}`;
      navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard!', 'success'));
    });
  }

  /* ── Tabs ── */
  qsa('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const group = tab.dataset.tabGroup;
      qsa(`.tab[data-tab-group="${group}"]`).forEach(t=>t.classList.remove('active'));
      qsa(`.tab-panel[data-tab-group="${group}"]`).forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      const target = $(`tab-${tab.dataset.tab}`);
      if (target) target.classList.add('active');
    });
  });

  /* ── Resize charts ── */
  window.addEventListener('resize', () => {
    if (State.calcData.length) {
      drawLineChart();
      drawWindowChart();
    }
  });

  /* ── Initial welcome chat msg ── */
  setTimeout(() => {
    addChatMessage("Hi! I'm your WFM Copilot 👋. I can help you interpret forecasts, understand ILA, and plan staffing actions. Try asking: \"Where should I move agents?\" or \"Why is SLA dropping?\"", 'ai');
  }, 500);

  /* ── Show landing first ── */
  $('app').style.display = 'none';
  $('landing').style.display = 'flex';
});
