'use strict';
// Utilidades compartidas: formato de números en castellano, escape HTML y el marcador en R.
const nf = (x, dg) => isFinite(x) ? x.toLocaleString('es-ES', { minimumFractionDigits: dg, maximumFractionDigits: dg }) : '–';
const sgn = (x, dg) => isFinite(x) ? (x > 0 ? '+' : x < 0 ? '−' : '') + nf(Math.abs(x), dg) : '–';
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const REG = { alcista: 'tendencia alcista', bajista: 'tendencia bajista', lateral: 'mercado lateral', volatil: 'mercado volátil', transicion: 'transición' };
const SIDE = { long: 'solo largos', short: 'solo cortos', both: 'largos y cortos', none: 'banquillo' };
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fdate = t => { const d = new Date(t); return d.getUTCDate() + ' ' + MES[d.getUTCMonth()] + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
const fday = t => { const d = new Date(t); return d.getUTCDate() + ' ' + MES[d.getUTCMonth()]; };
// marcador en R, como en el probador: cada gol es 1 R ganado; los del Mercado, R perdidos
function goals(trades) {
  let pos = 0, neg = 0;
  for (const x of trades) if (x.r > 0) pos += x.r; else neg -= x.r;
  const f = Math.round(pos), net = Math.round(pos - neg);
  return { pos, neg, f, a: Math.max(0, f - net) };
}
module.exports = { nf, sgn, esc, REG, SIDE, MES, fdate, fday, goals };
