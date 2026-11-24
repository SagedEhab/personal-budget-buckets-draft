// Tiny canvas charts (no external chart library, so no third-party script runs on the page).
const Charts = {
  prepare(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px Segoe UI, sans-serif';
    return ctx;
  },
  empty(canvas, text = 'No data yet') {
    const ctx = this.prepare(canvas);
    ctx.fillStyle = '#64736d';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  },

  // Line chart of cumulative spending with an optional dashed budget line
  line(canvas, points, budget) {
    if (!points.length || points.every((p) => p.value === 0)) return this.empty(canvas);
    const ctx = this.prepare(canvas);
    const pad = { l: 56, r: 12, t: 12, b: 26 };
    const w = canvas.width - pad.l - pad.r;
    const h = canvas.height - pad.t - pad.b;
    const max = Math.max(...points.map((p) => p.value), budget || 0) * 1.1 || 1;
    const x = (i) => pad.l + (i / Math.max(points.length - 1, 1)) * w;
    const y = (v) => pad.t + h - (v / max) * h;
    ctx.strokeStyle = '#dfe5e1';
    ctx.fillStyle = '#64736d';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i += 1) {
      const v = (max / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(pad.l + w, y(v)); ctx.stroke();
      ctx.fillText(Math.round(v).toLocaleString(), pad.l - 6, y(v) + 4);
    }
    ctx.textAlign = 'center';
    points.forEach((p, i) => { if (i % 5 === 0 || i === points.length - 1) ctx.fillText(p.label, x(i), canvas.height - 8); });
    if (budget) {
      ctx.strokeStyle = '#c0392b'; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, y(budget)); ctx.lineTo(pad.l + w, y(budget)); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#c0392b'; ctx.textAlign = 'left';
      ctx.fillText('total budget', pad.l + 4, y(budget) - 4);
    }
    ctx.strokeStyle = '#2e7d6b'; ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.value)) : ctx.moveTo(x(i), y(p.value))));
    ctx.stroke();
    ctx.lineWidth = 1;
  },

  // Horizontal bars: [{ label, value, color }]
  bars(canvas, rows) {
    if (!rows.length || rows.every((r) => !r.value)) return this.empty(canvas);
    const ctx = this.prepare(canvas);
    const max = Math.max(...rows.map((r) => r.value)) || 1;
    const rowH = Math.min(30, (canvas.height - 10) / rows.length);
    const labelW = 120;
    const barW = canvas.width - labelW - 90;
    rows.forEach((r, i) => {
      const top = 6 + i * rowH;
      ctx.fillStyle = '#1d2a26'; ctx.textAlign = 'right';
      ctx.fillText(r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label, labelW - 8, top + rowH / 2 + 4);
      ctx.fillStyle = r.color || '#2e7d6b';
      ctx.fillRect(labelW, top + 4, Math.max(2, (r.value / max) * barW), rowH - 8);
      ctx.fillStyle = '#64736d'; ctx.textAlign = 'left';
      ctx.fillText(Math.round(r.value).toLocaleString(), labelW + (r.value / max) * barW + 6, top + rowH / 2 + 4);
    });
  },

  // Grouped columns: income vs expense per month
  columns(canvas, series) {
    if (!series.length || series.every((s) => !s.income && !s.expense)) return this.empty(canvas);
    const ctx = this.prepare(canvas);
    const pad = { l: 56, r: 10, t: 24, b: 26 };
    const w = canvas.width - pad.l - pad.r;
    const h = canvas.height - pad.t - pad.b;
    const max = Math.max(...series.map((s) => Math.max(s.income, s.expense))) * 1.1 || 1;
    const group = w / series.length;
    const bw = Math.min(22, group / 3);
    ctx.fillStyle = '#64736d'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(max).toLocaleString(), pad.l - 6, pad.t + 10);
    series.forEach((s, i) => {
      const cx = pad.l + group * i + group / 2;
      const hi = (s.income / max) * h;
      const he = (s.expense / max) * h;
      ctx.fillStyle = '#9cc9bd'; ctx.fillRect(cx - bw - 1, pad.t + h - hi, bw, hi);
      ctx.fillStyle = '#2e7d6b'; ctx.fillRect(cx + 1, pad.t + h - he, bw, he);
      ctx.fillStyle = '#64736d'; ctx.textAlign = 'center';
      ctx.fillText(s.month.slice(2), cx, canvas.height - 8);
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9cc9bd'; ctx.fillRect(pad.l + 4, 4, 10, 10);
    ctx.fillStyle = '#1d2a26'; ctx.fillText('income', pad.l + 18, 13);
    ctx.fillStyle = '#2e7d6b'; ctx.fillRect(pad.l + 74, 4, 10, 10);
    ctx.fillStyle = '#1d2a26'; ctx.fillText('expense', pad.l + 88, 13);
  }
};
