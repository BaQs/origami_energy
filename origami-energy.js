/*
 * Origami Energy: energy cards for Home Assistant in the Origami style. They read the energy dashboard
 * (sources, prices, devices) and its long-term statistics. See the README for the options.
 *
 * type: custom:origami-energy
 * layout: summary                            # summary, tiles, banner or details
 * power: sensor.power                        # current power, in W or VA
 * power_max: 9000                            # contracted power, for the gauge
 * offpeak: binary_sensor.off_peak            # on during off-peak hours
 * temperature: sensor.outdoor_temperature    # details: temperature curve on the charts
 * navigation_path: "#energy"                 # summary, tiles, banner: opened on tap, on the energy that was tapped
 */
const ORIGAMI_ENERGY_VERSION = "0.5.0";
const OE_DAY = 86400000;

// Energy dashboard sources by type, with their statistic and price
function energySources(prefs) {
  const out = { grid: [], gas: [], water: [] };
  for (const s of prefs?.energy_sources ?? []) {
    if (s.type === "grid") {
      const flows = s.flow_from ?? (s.stat_energy_from ? [s] : []);
      for (const f of flows) {
        if (f.stat_energy_from) out.grid.push({ stat: f.stat_energy_from, price: f.number_energy_price ?? null, priceEntity: f.entity_energy_price ?? null });
      }
    } else if ((s.type === "gas" || s.type === "water") && s.stat_energy_from) {
      out[s.type].push({ stat: s.stat_energy_from, price: s.number_energy_price ?? null, priceEntity: s.entity_energy_price ?? null });
    }
  }
  return out;
}

// Tariff of an electricity meter from its statistic id: off-peak (hc), peak (hp) or base
function tariffOf(stat) {
  const s = String(stat).toLowerCase();
  if (/(^|[._])hc([._]|$)|creuse|off_?peak/.test(s)) return "hc";
  if (/(^|[._])hp([._]|$)|pleine|peak/.test(s)) return "hp";
  return "base";
}

function oeAddDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function oeShiftYear(d, n) { return new Date(d.getFullYear() + n, d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()); }
function oeDaysIn(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

// Bounds of a period and of the same period last year
function periodRange(kind, now) {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end, startLY, endLY, step, count;
  if (kind === "day") {
    start = d0; end = oeAddDays(d0, 1); startLY = oeAddDays(d0, -364); endLY = oeAddDays(startLY, 1); step = "hour"; count = 24;
  } else if (kind === "week") {
    start = oeAddDays(d0, -((d0.getDay() + 6) % 7)); end = oeAddDays(start, 7);
    startLY = oeAddDays(start, -364); endLY = oeAddDays(startLY, 7); step = "day"; count = 7;
  } else if (kind === "month") {
    start = new Date(d0.getFullYear(), d0.getMonth(), 1); end = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
    startLY = new Date(d0.getFullYear() - 1, d0.getMonth(), 1); endLY = new Date(d0.getFullYear() - 1, d0.getMonth() + 1, 1);
    step = "day"; count = Math.max(oeDaysIn(start), oeDaysIn(startLY));
  } else {
    start = new Date(d0.getFullYear(), 0, 1); end = new Date(d0.getFullYear() + 1, 0, 1);
    startLY = new Date(d0.getFullYear() - 1, 0, 1); endLY = start; step = "month"; count = 12;
  }
  // Same moment last year: 52 weeks earlier for a day or a week, so weekdays match, the same date otherwise
  const nowLY = kind === "day" || kind === "week" ? new Date(now.getTime() - 364 * OE_DAY) : oeShiftYear(now, -1);
  return { kind, start, end, startLY, endLY, nowLY, step, count };
}

function binIndex(kind, start, t) {
  const d = new Date(t);
  if (kind === "year") return (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth();
  if (kind === "day") return Math.round((t - start.getTime()) / 3600000);
  return Math.round((oeAddDays(d, 0) - start) / OE_DAY);
}

function fmtNumber(v, digits, locale) {
  if (v == null || !isFinite(v)) return "–";
  return Number(v).toLocaleString(locale || "en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
// The currency of the Home Assistant configuration, set when hass arrives
let OE_CURRENCY = "EUR";
function fmtMoney(v, locale) {
  if (v == null || !isFinite(v)) return "–";
  const digits = Math.abs(v) >= 100 ? 0 : 2;
  return Number(v).toLocaleString(locale || "en", { style: "currency", currency: OE_CURRENCY, minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtQty(kind, v, locale) {
  if (v == null) return "–";
  if (kind === "water") { const l = v * 1000; return l < 10000 ? fmtNumber(l, 0, locale) + " L" : fmtNumber(v, 1, locale) + " m³"; }
  return fmtNumber(v, v >= 100 ? 0 : 1, locale) + (kind === "gas" ? " m³" : " kWh");
}
function deltaOf(n, o) {
  if (!o || n == null) return { txt: "–", up: null };
  const p = Math.round((n - o) / o * 100);
  return { txt: (p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p) + " %", up: p > 0 };
}
function powerRatio(value, max) {
  const v = Number(value), m = Number(max);
  if (!isFinite(v) || !isFinite(m) || m <= 0) return null;
  return Math.max(0, Math.min(1, v / m));
}
function oeEsc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

const OE_PERIODS = ["day", "week", "month", "year"];
const OE_SOURCES = { elec: ["mdi:flash", "elec"], gas: ["mdi:fire", "gas"], water: ["mdi:water", "water"] };
// Month, weekday and hour names come from the browser, in the language of Home Assistant
const oeMonth = (m, loc, style = "long") => new Date(2020, m, 1).toLocaleDateString(loc, { month: style });
const oeWeekday = (i, loc, style = "long") => new Date(2020, 0, 6 + i).toLocaleDateString(loc, { weekday: style });
const oeHour = (h, loc) => new Date(2020, 0, 1, h).toLocaleTimeString(loc, { hour: "numeric" });
const oeTime = (d, loc) => d.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" });

const OE_TEXT = {
  en: {
    day: "Day", week: "Week", month: "Month", year: "Year", elec: "Electricity", gas: "Gas", water: "Water",
    offpeak: "Off-peak hours", peak: "Peak hours", error: "Error", total: "Total", loading: "Loading…",
    today: "Today", thisWeek: "This week", at: "at ", toDate: "to date", yesterday: "yesterday",
    noteDay: "Today compared with yesterday and the average of the last 7 days.",
    notePeriod: "Last year's costs at today's prices, to compare consumption.", noteDevices: "Devices priced at the highest rate.",
    estimate: "estimate ", projection: "projection ", cost: "Cost", lastYear: "Last year, to date", wholeDay: "Whole day {y}",
    wholePeriod: "Whole period {y}", offpeakShare: "Off-peak electricity", perDay: "Average per day", evening: "Evening estimate",
    projectionT: "Projection", breakdown: "Breakdown", averageDay: "average day ", perHour: "per hour", yesterdayT: "Yesterday",
    week7: "Average of the last 7 days", elecYesterday: "Electricity yesterday", avg7: "7-day average", live: "Live",
    contract: "contract ", powerHour: "average power per hour", peakDay: "Peak of the day", night: "Night standby",
    nightSub: "lowest between midnight and 6 AM", rest: "Rest of the home", devices: "Devices", tracked: " tracked ›",
    overview: "Overview", consumption: "Consumption", topHour: "Busiest hour", topDay: "Busiest day", topMonth: "Busiest month",
    noGas: "No gas", noWater: "No water", hours: "hours", days: "days", months: "months", outOf: "out of {n} so far",
    avgTemp: "Average temperature", temp: "Temperature", tempShort: "Temp. ", hc: "off-peak", colon: ": ",
  },
  fr: {
    day: "Jour", week: "Semaine", month: "Mois", year: "Année", elec: "Électricité", gas: "Gaz", water: "Eau",
    offpeak: "Heures creuses", peak: "Heures pleines", error: "Erreur", total: "Total", loading: "Chargement…",
    today: "Aujourd'hui", thisWeek: "Cette semaine", at: "à ", toDate: "à date", yesterday: "hier",
    noteDay: "Aujourd'hui comparé à hier et à la moyenne des 7 derniers jours.",
    notePeriod: "Coûts de l'an dernier au tarif actuel, pour comparer les consommations.", noteDevices: "Appareils estimés au tarif le plus élevé.",
    estimate: "estimation ", projection: "projection ", cost: "Coût", lastYear: "L'an dernier, à date", wholeDay: "Journée {y} entière",
    wholePeriod: "Période {y} entière", offpeakShare: "Électricité en heures creuses", perDay: "Moyenne par jour", evening: "Estimation du soir",
    projectionT: "Projection", breakdown: "Répartition", averageDay: "journée moyenne ", perHour: "par heure", yesterdayT: "Hier",
    week7: "Moyenne des 7 derniers jours", elecYesterday: "Électricité hier", avg7: "moyenne 7 jours", live: "En direct",
    contract: "abonnement ", powerHour: "puissance moyenne par heure", peakDay: "Pic du jour", night: "Veille de nuit",
    nightSub: "minimum entre 0 h et 6 h", rest: "Reste de la maison", devices: "Appareils", tracked: " suivis ›",
    overview: "Global", consumption: "Consommation", topHour: "Heure la plus forte", topDay: "Jour le plus fort", topMonth: "Mois le plus fort",
    noGas: "Sans gaz", noWater: "Sans eau", hours: "heures", days: "jours", months: "mois", outOf: "sur {n} écoulés",
    avgTemp: "Température moyenne", temp: "Température", tempShort: "Temp. ", hc: "HC", colon: " : ",
  },
};

const OrigamiEnergyBase = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

class OrigamiEnergy extends OrigamiEnergyBase {
  setConfig(config) {
    this._config = { layout: "banner", ...(config ?? {}) };
    this._prefs = null;
    this._cache = {};
    this._view = this._view ?? { per: "day", src: null };
    this._sig = null;
    this._err = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => this._safe(() => this._onClick(ev)));
    }
  }

  // Bubble Card rebuilds a pop-up's content each time it opens, so the view a tile asks for stays valid for 15 s
  // for any details card, old or new
  connectedCallback() {
    if (this._config?.layout !== "details" || typeof window === "undefined") return;
    this._onView = this._onView ?? (() => this._safe(() => { if (this._takeView()) this._update(); }));
    window.addEventListener("origami-energy-view", this._onView);
    this._safe(() => { if (this._takeView()) this._update(); });
  }

  disconnectedCallback() {
    if (this._onView && typeof window !== "undefined") window.removeEventListener("origami-energy-view", this._onView);
  }

  _takeView() {
    const want = typeof window !== "undefined" ? window.__origamiEnergyView : null;
    if (!want || this._config?.layout !== "details") return false;
    if (want.at <= (this._viewAt ?? 0) || Date.now() - want.at > 15000) return false;
    this._viewAt = want.at;
    this._view = { per: want.per ?? "day", src: want.src ?? null };
    this._sig = null;
    return true;
  }

  getCardSize() { return { banner: 1, summary: 1, tiles: 2 }[this._config?.layout] ?? 12; }
  getGridOptions() { return { columns: 12, rows: "auto", min_rows: 1 }; }

  set hass(hass) {
    this._hass = hass;
    OE_CURRENCY = hass?.config?.currency ?? OE_CURRENCY;
    this._safe(() => this._update());
  }

  _safe(fn) { try { fn(); } catch (e) { this._fail(e); } }
  _loc() { return this._hass?.locale?.language ?? this._hass?.language ?? "en"; }
  _t() { return OE_TEXT[String(this._loc()).slice(0, 2)] ?? OE_TEXT.en; }

  _update() {
    if (!this._hass || !this._config) return;
    // After a failure, wait a minute before asking again, so an error does not turn into a stream of requests
    if (!this._prefs && !this._prefsPending && Date.now() - (this._prefsFailed ?? 0) > 60000) {
      this._prefsPending = true;
      this._hass.callWS({ type: "energy/get_prefs" })
        .then((p) => { this._prefs = p; this._groups = energySources(p); this._devices = (p.device_consumption ?? []).map((d) => ({ stat: d.stat_consumption, name: d.name ?? null })); })
        .catch((e) => { this._err = e?.message ?? String(e); this._prefsFailed = Date.now(); })
        .finally(() => { this._prefsPending = false; this._sig = null; this._safe(() => this._update()); });
    }
    this._takeView();
    if (this._prefs) {
      const details = this._config.layout === "details";
      const per = details ? this._view.per : "day";
      const c = this._cache[per];
      if ((!c || Date.now() - c.at > 5 * 60 * 1000) && !this._loading?.[per]) this._load(per, !details);
    }
    this._render();
  }

  _price(item) {
    if (item.price != null) return item.price;
    const v = item.priceEntity ? Number(this._hass.states[item.priceEntity]?.state) : NaN;
    return isFinite(v) ? v : null;
  }

  async _load(per, light) {
    this._loading = { ...(this._loading ?? {}), [per]: true };
    const hass = this._hass, cfg = this._config, g = this._groups;
    const now = new Date();
    const r = periodRange(per, now);
    const units = { energy: "kWh", volume: "m³" };
    const main = [...g.grid, ...g.gas, ...g.water].map((x) => x.stat);
    const one = (id, s, e) => hass.callWS({
      type: "recorder/statistic_during_period", statistic_id: id, types: ["change"], units,
      fixed_period: { start_time: s.toISOString(), end_time: e.toISOString() },
    }).then((x) => (typeof x?.change === "number" ? x.change : null)).catch(() => null);
    const series = (s, e, ids, types) => hass.callWS({
      type: "recorder/statistics_during_period", start_time: s.toISOString(), end_time: e.toISOString(),
      statistic_ids: ids, period: per === "day" ? "hour" : r.step, types: types ?? ["change"], units,
    }).catch(() => ({}));
    const d = { at: Date.now(), now, r, totN: {}, tot1: {}, full1: {}, week7: {}, yest: {}, binsN: {}, bins1: {}, power: null,
                tempN: [], tempC: [] };
    const day = per === "day";
    const jobs = [];
    for (const id of main) {
      jobs.push(one(id, r.start, now).then((v) => { d.totN[id] = v; }));
      if (light) continue;
      if (day) {
        jobs.push(one(id, oeAddDays(r.start, -7), r.start).then((v) => { d.week7[id] = v; }));
        jobs.push(one(id, oeAddDays(r.start, -1), r.start).then((v) => { d.yest[id] = v; }));
      } else {
        jobs.push(one(id, r.startLY, r.nowLY).then((v) => { d.tot1[id] = v; }));
        jobs.push(one(id, r.startLY, r.endLY).then((v) => { d.full1[id] = v; }));
      }
    }
    if (!light) {
      jobs.push(series(r.start, r.end, [...main, ...this._devices.map((x) => x.stat)]).then((x) => { d.binsN = x ?? {}; }));
      if (!day) jobs.push(series(r.startLY, r.endLY, main).then((x) => { d.bins1 = x ?? {}; }));
      if (cfg.temperature) {
        const t = cfg.temperature;
        jobs.push(series(r.start, now, [t], ["mean"]).then((x) => { d.tempN = x?.[t] ?? []; }));
        const [cs, ce] = day ? [oeAddDays(r.start, -1), r.start] : [r.startLY, r.endLY];
        jobs.push(series(cs, ce, [t], ["mean"]).then((x) => { d.tempC = x?.[t] ?? []; }));
      }
      if (per === "day" && cfg.power) {
        jobs.push(series(r.start, now, [cfg.power], ["mean", "min", "max"]).then((x) => { d.power = x?.[cfg.power] ?? []; }));
      }
    }
    try {
      await Promise.all(jobs);
      this._cache[per] = d;
      this._err = null;
    } catch (e) {
      this._err = e?.message ?? String(e);
    } finally {
      this._loading[per] = false;
      this._sig = null;
      this._safe(() => this._render());
    }
  }

  // Quantities and costs of a set of values { statistic: change }
  _sum(o) {
    const g = this._groups;
    const v = (id) => (typeof o?.[id] === "number" ? Math.max(0, o[id]) : 0);
    const has = (list) => list.some((x) => typeof o?.[x.stat] === "number");
    const s = { e: 0, hc: 0, hp: 0, ec: 0, g: 0, gc: 0, w: 0, wc: 0 };
    for (const x of g.grid) {
      const q = v(x.stat), p = this._price(x);
      s.e += q;
      if (tariffOf(x.stat) === "hc") s.hc += q; else s.hp += q;
      if (p != null) s.ec += q * p;
    }
    for (const x of g.gas) { const q = v(x.stat), p = this._price(x); s.g += q; if (p != null) s.gc += q * p; }
    for (const x of g.water) { const q = v(x.stat), p = this._price(x); s.w += q; if (p != null) s.wc += q * p; }
    s.cost = s.ec + s.gc + s.wc;
    s.hasE = has(g.grid);
    return s;
  }

  _scale(s, k) {
    const out = { ...s };
    for (const key of ["e", "hc", "hp", "ec", "g", "gc", "w", "wc", "cost"]) out[key] = s[key] * k;
    return out;
  }

  // Bins of a series, aligned on the start of the period
  _bins(series, start, count, kind) {
    const raw = Array.from({ length: count }, () => null);
    for (const [id, pts] of Object.entries(series ?? {})) {
      for (const p of pts ?? []) {
        const t = typeof p.start === "number" ? p.start : Date.parse(p.start);
        const i = binIndex(kind, start, t);
        if (i < 0 || i >= count) continue;
        raw[i] = raw[i] ?? {};
        raw[i][id] = (raw[i][id] ?? 0) + (p.change ?? 0);
      }
    }
    return raw.map((o) => (o ? this._sum(o) : null));
  }

  _tempBins(points, start, count, kind) {
    const out = Array.from({ length: count }, () => null);
    for (const p of points ?? []) {
      const i = binIndex(kind, start, typeof p.start === "number" ? p.start : Date.parse(p.start));
      if (i >= 0 && i < count && typeof p.mean === "number") out[i] = p.mean;
    }
    return out;
  }

  // Averages of the period and of the comparison over the same bins, to date
  _tempAvg(t) {
    const idx = t.n.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0 && t.c[i] != null);
    const avg = (arr, ids) => (ids.length ? ids.reduce((a, i) => a + arr[i], 0) / ids.length : null);
    const ownN = t.n.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    return { n: avg(t.n, ownN), c: avg(t.c, idx) };
  }

  _tempChip(t, loc) {
    if (!t || !t.n.some((v) => v != null)) return null;
    const a = this._tempAvg(t);
    return [this._t().avgTemp, fmtNumber(a.n, 1, loc) + "°", a.c == null ? "" : t.labelC + this._t().colon + fmtNumber(a.c, 1, loc) + "°"];
  }

  _maxGridPrice() {
    const p = this._groups.grid.map((x) => this._price(x)).filter((x) => x != null);
    return p.length ? Math.max(...p) : null;
  }

  _render() {
    const root = this.shadowRoot;
    if (!root || !this._hass) return;
    const cfg = this._config, hass = this._hass;
    const pw = cfg.power ? hass.states[cfg.power] : null;
    const off = cfg.offpeak ? hass.states[cfg.offpeak]?.state === "on" : null;
    const per = cfg.layout === "details" ? this._view.per : "day";
    const c = this._cache[per];
    const sig = JSON.stringify([cfg.layout, this._view, pw?.state, off, c?.at, this._err, !!this._prefs]);
    if (sig === this._sig) return;
    this._sig = sig;
    const html = cfg.layout === "details" ? this._details(c, pw, off) : cfg.layout === "tiles" ? this._tiles(c)
      : cfg.layout === "summary" ? this._summary(c) : this._banner(c, pw, off);
    root.innerHTML = `<style>${ORIGAMI_ENERGY_CSS}</style>${html}`;
  }

  _offLabel(off) { return off == null ? "" : off ? this._t().offpeak : this._t().peak; }

  _banner(c, pw, off) {
    const loc = this._loc();
    let cost = "…", sub = "";
    if (this._err) sub = this._t().error + this._t().colon + this._err;
    const N = c ? this._sum(c.totN) : null;
    if (N) cost = fmtMoney(N.cost, loc);
    const live = pw ? fmtNumber(Number(pw.state), 0, loc) + " " + (pw.attributes?.unit_of_measurement ?? "W") : "";
    sub = sub || [this._offLabel(off), live].filter(Boolean).join(" · ");
    // On the right, today's cost per energy, or a chevron when there is only one
    const g = this._groups ?? { grid: [1], gas: [], water: [] };
    const parts = [];
    if (g.grid.length) parts.push(["elec", "mdi:flash", N?.ec]);
    if (g.gas.length) parts.push(["gas", "mdi:fire", N?.gc]);
    if (g.water.length) parts.push(["water", "mdi:water", N?.wc]);
    const rep = N && parts.length > 1 && this._config.breakdown !== false
      ? `<div class="rep">${parts.map(([cls, icon, val]) => `<span class="${cls}"><ha-icon icon="${icon}"></ha-icon><span class="num">${oeEsc(fmtMoney(val ?? 0, loc))}</span></span>`).join("")}</div>`
      : `<ha-icon class="chev" icon="mdi:chevron-right"></ha-icon>`;
    return `<ha-card class="banner${this._config.navigation_path ? " link" : ""}" data-act="open" title="origami-energy v${ORIGAMI_ENERGY_VERSION}">
      <div class="sq elec"><ha-icon icon="mdi:home-lightning-bolt-outline"></ha-icon></div>
      <div class="txt"><span class="t1 num">${oeEsc(cost)}</span><span class="t2">${oeEsc(sub)}</span></div>
      ${rep}
    </ha-card>`;
  }

  _summary(c) {
    const loc = this._loc(), t = this._t(), N = c ? this._sum(c.totN) : null;
    const g = this._groups ?? { grid: [1], gas: [], water: [] };
    const cols = [];
    if (g.grid.length) cols.push(["elec", "mdi:flash", t.elec, N?.ec, N ? fmtQty("elec", N.e, loc) : ""]);
    if (g.gas.length) cols.push(["gas", "mdi:fire", t.gas, N?.gc, N ? fmtQty("gas", N.g, loc) : ""]);
    if (g.water.length) cols.push(["water", "mdi:water", t.water, N?.wc, N ? fmtQty("water", N.w, loc) : ""]);
    return `<ha-card class="summary" title="origami-energy v${ORIGAMI_ENERGY_VERSION}"><div class="vcols">${cols.map(([src, icon, label, cost, qty]) =>
      `<div class="vcol link" data-act="go" data-v="${src}">
        <span class="vlb"><span class="vic ${src}"><ha-icon icon="${icon}"></ha-icon></span>${oeEsc(label)}</span>
        <span class="vt1 num">${this._err ? "–" : N ? oeEsc(fmtMoney(cost ?? 0, loc)) : "…"}</span>
        <span class="vt2 num">${oeEsc(qty)}</span></div>`).join('<i class="vsep"></i>')}</div></ha-card>`;
  }

  _tiles(c) {
    const loc = this._loc(), t = this._t();
    const N = c ? this._sum(c.totN) : null;
    const v = (x) => (N ? fmtMoney(x, loc) : "…");
    const g = this._groups ?? { grid: [1], gas: [], water: [] };
    const list = [["", "mdi:home-lightning-bolt-outline", "white", N && N.cost, this._err ? t.error : t.total]];
    if (g.grid.length) list.push(["elec", "mdi:flash", "elec", N && N.ec, t.elec]);
    if (g.gas.length) list.push(["gas", "mdi:fire", "gas", N && N.gc, t.gas]);
    if (g.water.length) list.push(["water", "mdi:water", "water", N && N.wc, t.water]);
    return `<ha-card class="tiles" title="origami-energy v${ORIGAMI_ENERGY_VERSION}"><div class="grid">${list.map(([src, icon, cls, val, label]) =>
      `<div class="tile link" data-act="go" data-v="${src}"><div class="sq ${cls}"><ha-icon icon="${icon}"></ha-icon></div>
        <div class="txt"><span class="t1 num">${v(val)}</span><span class="t2">${oeEsc(label)}</span></div></div>`).join("")}</div></ha-card>`;
  }

  _details(c, pw, off) {
    const loc = this._loc(), t = this._t();
    const v = this._view;
    if (this._err && !c) return `<ha-card class="details"><div class="note err">${t.error}${t.colon}${oeEsc(this._err)}</div></ha-card>`;
    const periods = `<div class="seg">${OE_PERIODS.map((k) => `<button type="button" data-act="per" data-v="${k}" class="${k === v.per ? "on" : ""}">${t[k]}</button>`).join("")}</div>`;
    if (!c) return `<ha-card class="details">${this._srcChips()}${periods}<div class="hero"><div class="row"><div class="sq elec"><ha-icon icon="mdi:flash"></ha-icon></div><div class="txt"><span class="t1">${t.loading}</span></div></div></div></ha-card>`;
    const r = c.r;
    const N = this._sum(c.totN), O = this._sum(c.tot1), F = this._sum(c.full1);
    const W = this._scale(this._sum(c.week7), 1 / 7), Y = this._sum(c.yest);
    const binsN = this._bins(c.binsN, r.start, r.count, r.kind);
    const bins1 = this._bins(c.bins1, r.startLY, r.count, r.kind);
    const title = { day: t.today, week: t.thisWeek, month: oeMonth(r.start.getMonth(), loc).replace(/^./, (x) => x.toUpperCase()), year: String(r.start.getFullYear()) }[r.kind];
    const when = r.kind === "day" ? t.at + oeTime(c.now, loc) : t.toDate;
    const elapsedDays = (c.now - r.start) / OE_DAY;
    let temps = null;
    if (this._config.temperature && (c.tempN?.length || c.tempC?.length)) {
      const day = r.kind === "day";
      temps = { n: this._tempBins(c.tempN, r.start, r.count, r.kind),
                c: day ? this._tempBins(c.tempC, oeAddDays(r.start, -1), r.count, "day") : this._tempBins(c.tempC, r.startLY, r.count, r.kind),
                labelC: day ? t.yesterday : String(r.startLY.getFullYear()) };
    }
    const ctx = { c, r, N, O, F, W, Y, binsN, bins1, title, when, loc, elapsedDays, pw, off, temps };
    return `<ha-card class="details">${v.src ? this._sourceView(ctx, periods) : this._overview(ctx, periods)}
      <div class="note">${r.kind === "day" ? t.noteDay : t.notePeriod} ${t.noteDevices} · v${ORIGAMI_ENERGY_VERSION}</div>
    </ha-card>`;
  }

  _hero(icon, cls, title, sub, big, fill, goal) {
    return `<div class="hero">
      <div class="row"><div class="sq ${cls}"><ha-icon icon="${icon}"></ha-icon></div>
        <div class="txt"><span class="t1">${oeEsc(title)}</span><span class="t2">${oeEsc(sub)}</span></div>
        <span class="big num">${oeEsc(big)}</span></div>
      <div class="slider"><div class="fill" style="width:${fill}%"></div><div class="handle" style="left:${fill}%"></div><span class="${fill > 55 ? "in" : ""}">${oeEsc(goal)}</span></div>
    </div>`;
  }

  _head(title, right, dot) {
    return `<div class="head"><span class="h">${oeEsc(title)}</span><span class="t2 strong">${dot ? `<i class="dot ${dot}"></i>` : ""}${oeEsc(right)}</span></div>`;
  }

  _labels(r) {
    const loc = this._loc();
    return Array.from({ length: r.count }, (_, i) => {
      if (r.kind === "year") return oeMonth(i, loc, "narrow");
      if (r.kind === "month") return i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : "";
      if (r.kind === "week") return oeWeekday(i, loc, "short");
      return i % 6 === 0 ? oeHour(i, loc) : "";
    });
  }

  // Stacked bars: segs(b) gives [[value, class], ...] from the bottom up, ref(b) the value of last year
  _chart(r, binsN, bins1, segs, ref, legend, temps) {
    const tot = (b) => (b ? segs(b).reduce((a, [x]) => a + x, 0) : 0);
    const max = Math.max(1e-6, ...binsN.map(tot), ...bins1.map((b) => (b ? ref(b) : 0)));
    const H = 140, px = (x) => Math.round(x / max * H);
    const labels = this._labels(r);
    const cols = binsN.map((b, i) => {
      const o = bins1[i];
      if (!b) return `<div class="col">${o ? `<div class="ghost" style="height:${Math.max(3, px(ref(o)))}px"></div>` : ""}</div>`;
      const parts = segs(b).filter(([x]) => px(x) > 0);
      const stack = parts.map(([x, cls], j) => `<div class="seg-${cls}${j === parts.length - 1 ? " top" : ""}" style="height:${px(x)}px"></div>`).reverse().join("");
      return `<div class="col">${stack}${o ? `<div class="mark" style="bottom:${px(ref(o))}px"></div>` : ""}</div>`;
    }).join("");
    let courbes = "", legendeT = "";
    if (temps && (temps.n.some((v) => v != null) || temps.c.some((v) => v != null))) {
      const all = [...temps.n, ...temps.c].filter((v) => v != null);
      let lo = Math.min(...all), hi = Math.max(...all);
      if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
      const y = (t) => (100 - ((t - lo) / (hi - lo)) * 80 - 10).toFixed(1);
      const lignes = (arr, cls) => {
        const segsT = [];
        let cur = [];
        arr.forEach((v, i) => { if (v == null) { if (cur.length) segsT.push(cur); cur = []; } else cur.push(`${(i + 0.5).toFixed(2)},${y(v)}`); });
        if (cur.length) segsT.push(cur);
        return segsT.map((pts) => pts.length === 1
          ? `<circle class="${cls}" cx="${pts[0].split(",")[0]}" cy="${pts[0].split(",")[1]}" r="0.35"></circle>`
          : `<polyline class="${cls}" points="${pts.join(" ")}" vector-effect="non-scaling-stroke"></polyline>`).join("");
      };
      courbes = `<svg class="temp" viewBox="0 0 ${r.count} 100" preserveAspectRatio="none" aria-hidden="true">${lignes(temps.c, "tc")}${lignes(temps.n, "tn")}</svg>
        <span class="tmax">${fmtNumber(hi, 0)}°</span><span class="tmin">${fmtNumber(lo, 0)}°</span>`;
      legendeT = `<span><i class="tline"></i>${this._t().temp}</span><span><i class="tline dash"></i>${this._t().tempShort}${oeEsc(temps.labelC)}</span>`;
    }
    return `<div class="panel"><div class="bars">${cols}${courbes}</div>
      <div class="labels">${labels.map((l) => `<span>${l}</span>`).join("")}</div>
      <div class="legend">${legend.map(([cls, l]) => `<span><i class="dot seg-${cls}"></i>${oeEsc(l)}</span>`).join("")}${bins1.some(Boolean) ? `<span><i class="tick"></i>${r.startLY.getFullYear()}</span>` : ""}${legendeT}</div></div>`;
  }

  _chips(list) {
    return `<div class="chips">${list.map(([l, val, sub]) => `<div class="chip"><span class="t2">${oeEsc(l)}</span><span class="t1 num">${oeEsc(val)}</span>${sub ? `<span class="t2">${oeEsc(sub)}</span>` : ""}</div>`).join("")}</div>`;
  }

  _projection(n, o, full) { return o ? full * n / o : null; }

  _overview(x, periods) {
    if (x.r.kind === "day") return this._overviewDay(x, periods);
    const { c, r, N, O, F, binsN, bins1, title, when, loc, elapsedDays, pw, off, temps } = x;
    const t = this._t();
    const proj = this._projection(N.cost, O.cost, F.cost);
    const fill = proj ? Math.min(100, Math.round(N.cost / proj * 100)) : 0;
    const d = deltaOf(N.cost, O.cost);
    const goal = proj == null ? "" : (r.kind === "day" ? t.estimate : t.projection) + fmtMoney(proj, loc);
    let out = this._srcChips() + periods + this._hero("mdi:home-lightning-bolt-outline", "all", title, when, fmtMoney(N.cost, loc), fill, goal);
    out += this._head(t.cost, d.txt + " vs " + r.startLY.getFullYear(), d.up == null ? "" : d.up ? "up" : "down");
    out += this._chart(r, binsN, bins1, (b) => [[b.ec, "elec"], [b.gc, "gas"], [b.wc, "water"]], (b) => b.cost,
      [["elec", t.elec], ["gas", t.gas], ["water", t.water]], temps);
    out += this._chips([
      [t.lastYear, fmtMoney(O.cost, loc)],
      [(r.kind === "day" ? t.wholeDay : t.wholePeriod).replace("{y}", r.startLY.getFullYear()), fmtMoney(F.cost, loc)],
      r.kind === "day"
        ? [t.offpeakShare, N.e ? Math.round(N.hc / N.e * 100) + " %" : "–"]
        : [t.perDay, fmtMoney(N.cost / Math.max(elapsedDays, 1 / 24), loc)],
      [r.kind === "day" ? t.evening : t.projectionT, fmtMoney(proj, loc)],
      this._tempChip(temps, loc),
    ].filter(Boolean));
    out += this._head(t.breakdown, "vs " + r.startLY.getFullYear() + " ›");
    const rows = [
      ["elec", this._groups.grid.length, fmtQty("elec", N.e, loc) + (N.e ? ` · ${t.hc} ` + Math.round(N.hc / N.e * 100) + " %" : ""), N.ec, deltaOf(N.e, O.e)],
      ["gas", this._groups.gas.length, fmtQty("gas", N.g, loc), N.gc, deltaOf(N.g, O.g)],
      ["water", this._groups.water.length, fmtQty("water", N.w, loc), N.wc, deltaOf(N.w, O.w)],
    ].filter(([, show]) => show);
    out += rows.map(([k, , qty, cost, dd]) => `<div class="line link" data-act="src" data-v="${k}">
      <div class="sq sm ${OE_SOURCES[k][1]}"><ha-icon icon="${OE_SOURCES[k][0]}"></ha-icon></div>
      <div class="txt"><span class="t1">${t[k]}</span><span class="t2 ell">${oeEsc(qty)}</span></div>
      <div class="end"><span class="t1 num">${fmtMoney(cost, loc)}</span><span class="t2 strong">${dd.up == null ? "" : `<i class="dot ${dd.up ? "up" : "down"}"></i>`}${dd.txt}</span></div>
      <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon></div>`).join("");
    if (r.kind === "day" && pw) out += this._live(c, pw, off, loc);
    out += this._devicesBlock(c, N, loc, 6);
    return out;
  }

  _overviewDay(x, periods) {
    const { c, r, N, W, Y, binsN, bins1, title, when, loc, pw, off, temps } = x;
    const t = this._t();
    const fill = W.cost ? Math.min(100, Math.round(N.cost / W.cost * 100)) : 0;
    let out = this._srcChips() + periods + this._hero("mdi:home-lightning-bolt-outline", "all", title, when, fmtMoney(N.cost, loc), fill, W.cost ? t.averageDay + fmtMoney(W.cost, loc) : "");
    out += this._head(t.cost, t.perHour);
    out += this._chart(r, binsN, bins1, (b) => [[b.ec, "elec"], [b.gc, "gas"], [b.wc, "water"]], (b) => b.cost,
      [["elec", t.elec], ["gas", t.gas], ["water", t.water]], temps);
    out += this._chips([
      [t.yesterdayT, fmtMoney(Y.cost, loc)],
      [t.week7, fmtMoney(W.cost, loc)],
      [t.offpeakShare, N.e ? Math.round(N.hc / N.e * 100) + " %" : "–"],
      [t.elecYesterday, fmtQty("elec", Y.e, loc)],
      this._tempChip(temps, loc),
    ].filter(Boolean));
    out += this._head(t.breakdown, t.avg7);
    const rows = [
      ["elec", this._groups.grid.length, fmtQty("elec", N.e, loc) + (N.e ? ` · ${t.hc} ` + Math.round(N.hc / N.e * 100) + " %" : ""), N.ec, W.ec],
      ["gas", this._groups.gas.length, fmtQty("gas", N.g, loc), N.gc, W.gc],
      ["water", this._groups.water.length, fmtQty("water", N.w, loc), N.wc, W.wc],
    ].filter(([, show]) => show);
    out += rows.map(([k, , qty, cost, avg]) => `<div class="line link" data-act="src" data-v="${k}">
      <div class="sq sm ${OE_SOURCES[k][1]}"><ha-icon icon="${OE_SOURCES[k][0]}"></ha-icon></div>
      <div class="txt"><span class="t1">${t[k]}</span><span class="t2 ell">${oeEsc(qty)}</span></div>
      <div class="end"><span class="t1 num">${fmtMoney(cost, loc)}</span><span class="t2">${fmtMoney(avg, loc)}</span></div>
      <ha-icon class="chev" icon="mdi:chevron-right"></ha-icon></div>`).join("");
    if (pw) out += this._live(c, pw, off, loc);
    out += this._devicesBlock(c, N, loc, 6);
    return out;
  }

  _live(c, pw, off, loc) {
    const t = this._t();
    const unit = pw.attributes?.unit_of_measurement ?? "W";
    const val = Number(pw.state);
    const ratio = powerRatio(val, this._config.power_max);
    const tOf = (p) => new Date(typeof p.start === "number" ? p.start : Date.parse(p.start));
    const pts = (c.power ?? []).filter((p) => p.mean != null);
    const pmax = Math.max(1, ...pts.map((p) => p.mean));
    const peak = pts.reduce((a, p) => (p.max != null && (!a || p.max > a.max) ? p : a), null);
    const night = pts.filter((p) => tOf(p).getHours() < 6 && p.min != null);
    const base = night.length ? Math.min(...night.map((p) => p.min)) : null;
    const kva = this._config.power_max ? fmtNumber(this._config.power_max / 1000, 0, loc) + " kVA" : "";
    let out = this._head(t.live, this._offLabel(off), off == null ? "" : "amber");
    out += `<div class="panel">
      <div class="row"><div class="sq sm white"><ha-icon icon="mdi:gauge"></ha-icon></div>
        <div class="txt"><span class="t1 num">${fmtNumber(val, 0, loc)} ${oeEsc(unit)}</span><span class="t2">${kva ? t.contract + kva : ""}</span></div></div>
      ${ratio == null ? "" : `<div class="slider sm"><div class="fill" style="width:${(ratio * 100).toFixed(1)}%"></div><div class="handle" style="left:${(ratio * 100).toFixed(1)}%"></div><span>${Math.round(ratio * 100)} %</span></div>`}
      ${pts.length ? `<div class="spark">${pts.map((p) => `<i class="${peak && p === peak ? "hot" : ""}" style="height:${Math.max(4, Math.round(p.mean / pmax * 44))}px"></i>`).join("")}</div>
      <div class="labels three"><span>${oeHour(tOf(pts[0]).getHours(), loc)}</span><span>${t.powerHour}</span><span>${oeHour(tOf(pts[pts.length - 1]).getHours(), loc)}</span></div>` : ""}
    </div>`;
    const chips = [];
    if (peak) chips.push([t.peakDay, fmtNumber(peak.max, 0, loc) + " " + unit, t.at + oeHour(tOf(peak).getHours(), loc)]);
    if (base != null) chips.push([t.night, fmtNumber(base, 0, loc) + " " + unit, t.nightSub]);
    if (chips.length) out += this._chips(chips);
    return out;
  }

  _devicesBlock(c, N, loc, max) {
    if (!this._devices?.length || !N.e) return "";
    const price = this._maxGridPrice();
    const rows = this._devices.map((d) => {
      const kwh = (c.binsN?.[d.stat] ?? []).reduce((a, p) => a + Math.max(0, p.change ?? 0), 0);
      const st = this._hass.states[d.stat], own = this._config.devices?.[d.stat] ?? {};
      return { name: own.name ?? d.name ?? st?.attributes?.friendly_name ?? d.stat, icon: own.icon ?? "mdi:power-plug-outline", kwh };
    }).filter((x) => x.kwh >= 0.05).sort((a, b) => b.kwh - a.kwh);
    const tracked = rows.reduce((a, x) => a + x.kwh, 0);
    const shown = rows.slice(0, max);
    shown.push({ name: this._t().rest, icon: "mdi:home-outline", kwh: Math.max(0, N.e - tracked), rest: true });
    let out = this._head(this._t().devices, this._devices.length + this._t().tracked);
    out += `<div class="panel list">${shown.map((x) => `<div class="item">
      <div class="sq xs white${x.rest ? " muted" : ""}"><ha-icon icon="${oeEsc(x.icon)}"></ha-icon></div>
      <div class="txt"><span class="t1 sm">${oeEsc(x.name)}</span><span class="t2 sm">${fmtQty("elec", x.kwh, loc)} · ${Math.round(x.kwh / N.e * 100)} %</span></div>
      <span class="t1 sm num">${price == null ? "" : "≈ " + fmtMoney(x.kwh * price, loc)}</span></div>`).join("")}</div>`;
    return out;
  }

  _srcChips() {
    const v = this._view, t = this._t(), g = this._groups ?? { grid: [1], gas: [1], water: [1] };
    const list = [["", t.overview, "mdi:home-lightning-bolt-outline", "all"]];
    for (const [k, [icon, cls]] of Object.entries(OE_SOURCES)) {
      if ((k === "elec" ? g.grid : k === "gas" ? g.gas : g.water).length) list.push([k, t[k], icon, cls]);
    }
    return `<div class="srcs" style="grid-template-columns: repeat(${list.length}, minmax(0, 1fr))">${list.map(([k, l, icon, cls]) =>
      `<button type="button" class="srcchip ${(v.src ?? "") === k ? "on " + cls : ""}" data-act="src" data-v="${k}"><ha-icon class="ic-${cls}" icon="${icon}"></ha-icon><span>${l}</span></button>`).join("")}</div>`;
  }

  _sourceView(x, periods) {
    const { c, r, N, O, F, binsN, bins1, title, when, loc, elapsedDays, pw, temps } = x;
    const k = this._view.src, t = this._t();
    const [icon, cls] = OE_SOURCES[k];
    const label = t[k];
    const q = (s) => (k === "elec" ? s.e : k === "gas" ? s.g : s.w);
    const cost = (s) => (k === "elec" ? s.ec : k === "gas" ? s.gc : s.wc);
    const day = r.kind === "day", W = x.W, Y = x.Y;
    const proj = day ? q(W) : this._projection(q(N), q(O), q(F));
    const fill = proj ? Math.min(100, Math.round(q(N) / proj * 100)) : 0;
    const d = deltaOf(q(N), q(O));
    let out = this._srcChips() + periods;
    out += this._hero(icon, cls, label + " · " + title, fmtMoney(cost(N), loc) + " " + when, fmtQty(k, q(N), loc), fill,
      !proj ? "" : (day ? t.averageDay : t.projection) + fmtQty(k, proj, loc));
    out += day ? this._head(t.consumption, t.perHour)
      : this._head(t.consumption, d.txt + " vs " + r.startLY.getFullYear(), d.up == null ? "" : d.up ? "up" : "down");
    const segs = k === "elec" ? (b) => [[b.hc, "hc"], [b.hp, "elec"]] : (b) => [[q(b), cls]];
    const legend = k === "elec" ? [["elec", t.peak], ["hc", t.offpeak]] : [[cls, label]];
    out += this._chart(r, binsN, bins1, segs, q, legend, temps);
    const done = binsN.map((b, i) => (b ? { i, v: q(b) } : null)).filter(Boolean);
    const top = done.reduce((a, b) => (!a || b.v > a.v ? b : a), null);
    const name = (i) => (r.kind === "day" ? oeHour(i, loc) : r.kind === "week" ? oeWeekday(i, loc)
      : r.kind === "month" ? new Date(r.start.getFullYear(), r.start.getMonth(), i + 1).toLocaleDateString(loc, { day: "numeric", month: "long" }) : oeMonth(i, loc));
    const chips = day
      ? [[t.yesterdayT, fmtQty(k, q(Y), loc), fmtMoney(cost(Y), loc)], [t.week7, fmtQty(k, q(W), loc), fmtMoney(cost(W), loc)]]
      : [[t.lastYear, fmtQty(k, q(O), loc), fmtMoney(cost(O), loc)]];
    if (top) chips.push([{ day: t.topHour, week: t.topDay, month: t.topDay, year: t.topMonth }[r.kind], fmtQty(k, top.v, loc), name(top.i)]);
    if (r.kind !== "day") chips.push([t.perDay, fmtQty(k, q(N) / Math.max(elapsedDays, 1 / 24), loc), fmtMoney(cost(N) / Math.max(elapsedDays, 1 / 24), loc)]);
    if (k === "elec") {
      const hc = N.e ? Math.round(N.hc / N.e * 100) : 0;
      const pHC = this._groups.grid.find((g) => tariffOf(g.stat) === "hc"), pHP = this._groups.grid.find((g) => tariffOf(g.stat) !== "hc");
      const pc = (item, qty) => (item && this._price(item) != null ? " · " + fmtMoney(qty * this._price(item), loc) : "");
      chips.push([t.offpeak, fmtQty("elec", N.hc, loc), hc + " %" + pc(pHC, N.hc)]);
      chips.push([t.peak, fmtQty("elec", N.hp, loc), (100 - hc) + " %" + pc(pHP, N.hp)]);
    } else {
      const zero = done.filter((b) => b.v === 0).length;
      const what = { day: t.hours, week: t.days, month: t.days, year: t.months }[r.kind];
      chips.push([k === "gas" ? t.noGas : t.noWater, zero + " " + what, t.outOf.replace("{n}", done.length)]);
    }
    const tc = this._tempChip(temps, loc);
    if (tc) chips.push(tc);
    out += this._chips(chips);
    if (k === "elec") {
      if (r.kind === "day" && pw) out += this._live(c, pw, x.off, loc);
      out += this._devicesBlock(c, N, loc, 5);
    }
    return out;
  }

  _onClick(ev) {
    const el = ev.composedPath().find((n) => n?.dataset?.act);
    if (!el) return;
    const act = el.dataset.act;
    if (act === "open" || act === "go") {
      if (!this._config.navigation_path) return;
      window.__origamiEnergyView = { per: "day", src: el.dataset.v || null, at: Date.now() };
      window.dispatchEvent(new CustomEvent("origami-energy-view"));
      history.pushState(null, "", this._config.navigation_path);
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      return;
    }
    if (act === "per") this._view = { ...this._view, per: el.dataset.v };
    else if (act === "src") this._view = { ...this._view, src: el.dataset.v || null };
    else if (act === "back") this._view = { ...this._view, src: null };
    this._sig = null;
    this._update();
  }

  _fail(e) {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = '<ha-card style="padding:16px;color:var(--error-color,#c00)">origami-energy v'
      + ORIGAMI_ENERGY_VERSION + " : " + oeEsc(e?.message ?? e) + "</ha-card>";
    this._sig = null;
  }
}

const ORIGAMI_ENERGY_CSS = `
  :host { display: block;
    --oe-fill: var(--fill-subtle, #eae8e4); --oe-card: var(--ha-card-background, #ffffff);
    --oe-text: var(--primary-text-color, #4a4640); --oe-muted: var(--secondary-text-color, #77726a);
    --oe-dark: var(--toggle-on, #5e5a54); --oe-on-dark: var(--text-color-active, #ffffff);
    --oe-elec: var(--lamp-color, var(--amber-color, #e0a94a)); --oe-gas: var(--heat-color, var(--deep-orange-color, #c9785c));
    --oe-water: var(--water-color, var(--light-blue-color, #6f93ab)); --oe-ok: var(--ok-color, var(--green-color, #a3b899));
    --oe-elec-tint: var(--lamp-tint, #fbf0dc); --oe-gas-tint: var(--heat-tint, #f7e6df); --oe-water-tint: var(--water-tint, #e3eaf0);
    --oe-ghost: var(--fill-strong, #d9d5ce); --oe-shadow: var(--card-elevation-flat, 0 6px 18px rgba(74, 70, 64, 0.08));
    --oe-r: var(--ha-card-border-radius, 22px); --oe-ri: var(--radius-inner, 17px);
    --oe-temp: var(--purple-color, #8e7cc3);
    color: var(--oe-text); }
  * { box-sizing: border-box; }
  ha-card { color: var(--oe-text); }
  ha-icon { --mdc-icon-size: var(--icon-size-s, 20px); display: flex; }
  .num { font-variant-numeric: tabular-nums; }
  .t1 { font-size: var(--ha-font-size-l, 18px); font-weight: var(--ha-font-weight-bold, 700); line-height: 1.25; }
  .t2 { font-size: var(--ha-font-size-s, 14px); font-weight: var(--ha-font-weight-medium, 600); color: var(--oe-muted); line-height: 1.3; }
  .t1.sm { font-size: var(--ha-font-size-m, 16px); } .t2.sm { font-size: 13px; }
  .strong { font-weight: var(--ha-font-weight-bold, 700); display: flex; align-items: center; gap: 8px; white-space: nowrap; }
  .ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; align-items: center; gap: 14px; }
  .sq { flex: none; width: var(--tile-size, 48px); height: var(--tile-size, 48px); border-radius: var(--oe-ri); display: flex; align-items: center; justify-content: center; }
  .sq ha-icon { --mdc-icon-size: var(--icon-size-m, 24px); }
  .sq.sm { width: 44px; height: 44px; border-radius: 15px; } .sq.sm ha-icon { --mdc-icon-size: 22px; }
  .sq.xs { width: 40px; height: 40px; border-radius: 13px; } .sq.xs ha-icon { --mdc-icon-size: 20px; }
  .sq.elec { background: var(--oe-elec-tint); color: var(--oe-elec); }
  .sq.gas { background: var(--oe-gas-tint); color: var(--oe-gas); }
  .sq.water { background: var(--oe-water-tint); color: var(--oe-water); }
  .sq.white { background: var(--oe-card); box-shadow: var(--tile-chip-shadow, 0 2px 6px rgba(74, 70, 64, 0.08)); color: var(--oe-text); }
  .sq.muted { color: var(--oe-muted); }
  .chev { color: var(--oe-muted); --mdc-icon-size: 22px; flex: none; }
  .link { cursor: pointer; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; background: var(--oe-muted); }
  .dot.up { background: var(--oe-gas); } .dot.down { background: var(--oe-ok); } .dot.amber { background: var(--oe-elec); }

  /* Banner and summary */
  ha-card.banner { display: flex; align-items: center; gap: 14px; padding: 14px 16px 14px 14px; height: 92px; box-sizing: border-box;
    border-radius: 30px; border: 0; background: var(--oe-card); box-shadow: var(--oe-shadow); }
  ha-card.banner .sq { width: 64px; height: 64px; border-radius: 20px; }
  ha-card.banner .txt { flex: 1 1 auto; min-width: 0; }
  ha-card.summary { padding: 14px 6px; border-radius: 30px; border: 0; background: var(--oe-card); box-shadow: var(--oe-shadow); }
  .vcols { display: flex; align-items: stretch; }
  .vcol { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 2px 4px; cursor: pointer; }
  .vlb { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--oe-muted); white-space: nowrap; }
  .vic { width: 24px; height: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 15px; }
  .vic.elec { background: var(--oe-elec-tint); color: var(--oe-elec); }
  .vic.gas { background: var(--oe-gas-tint); color: var(--oe-gas); }
  .vic.water { background: var(--oe-water-tint); color: var(--oe-water); }
  .vt1 { font-size: 19px; font-weight: 700; margin-top: 4px; }
  .vt2 { font-size: 13px; font-weight: 600; color: var(--oe-muted); }
  .vsep { flex: none; width: 1px; margin: 4px 0; background: var(--oe-fill); }
  .rep { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; font-size: 13px; font-weight: 700;
    color: var(--oe-muted); --mdc-icon-size: 14px; }
  .rep > span { display: flex; align-items: center; gap: 5px; }
  .rep .elec ha-icon { color: var(--oe-elec); }
  .rep .gas ha-icon { color: var(--oe-gas); }
  .rep .water ha-icon { color: var(--oe-water); }
  ha-card.banner .t1 { font-size: 19px; }
  ha-card.banner .t2 { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Tiles */
  ha-card.tiles { background: none; box-shadow: none; border: 0; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ha-space-3, 12px); }
  .tile { min-height: 80px; border-radius: calc(var(--oe-r) + 4px); background: var(--oe-fill); padding: 16px; display: flex; align-items: center; gap: 14px; min-width: 0; }
  .tile .sq { box-shadow: var(--tile-chip-shadow, 0 2px 6px rgba(74, 70, 64, 0.08)); }
  .tile .t1 { font-size: var(--ha-font-size-l, 18px); white-space: nowrap; }
  .tile .t2 { font-size: var(--ha-font-size-m, 16px); font-weight: var(--ha-font-weight-bold, 700); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile:active { transform: scale(0.97); }

  /* Details */
  ha-card.details { background: none; box-shadow: none; border: 0; display: flex; flex-direction: column; gap: 14px; }
  .hero { background: var(--oe-card); border-radius: calc(var(--oe-r) + 6px); box-shadow: var(--oe-shadow); padding: 18px; display: flex; flex-direction: column; gap: 16px; }
  .hero .big { font-size: 26px; font-weight: 700; white-space: nowrap; }
  .slider { position: relative; height: 48px; border-radius: 16px; background: var(--oe-fill); overflow: hidden; }
  .slider.sm { height: 44px; border-radius: 15px; background: var(--primary-background-color, #f4f3f0); }
  .slider .fill { position: absolute; inset: 0 auto 0 0; background: var(--oe-ghost); }
  .slider .handle { position: absolute; top: 12px; bottom: 12px; width: 4px; margin-left: -10px; border-radius: 2px; background: var(--oe-dark); }
  .slider span { position: absolute; right: 16px; top: 0; bottom: 0; display: flex; align-items: center; font-size: 15px; font-weight: 600; color: var(--oe-muted); }
  .slider span.in { right: auto; left: 16px; color: var(--oe-text); }
  .seg { display: flex; gap: 4px; padding: 6px; border-radius: var(--oe-r); background: var(--oe-card); box-shadow: var(--oe-shadow); }
  .seg button { flex: 1 1 0; height: 46px; border: 0; border-radius: 16px; background: transparent; color: var(--oe-text); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
  .seg button.on { background: var(--oe-dark); color: var(--oe-on-dark); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 4px 0; }
  .head .h { font-size: var(--ha-font-size-xl, 22px); font-weight: 700; }
  .panel { background: var(--oe-fill); border-radius: calc(var(--oe-r) + 4px); padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .bars { position: relative; height: 140px; display: flex; align-items: flex-end; gap: 3px; }
  svg.temp { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  svg.temp polyline { fill: none; stroke: var(--oe-temp); stroke-width: 2.5px; stroke-linejoin: round; stroke-linecap: round; }
  svg.temp circle { fill: var(--oe-temp); }
  svg.temp .tc { stroke-dasharray: 4 4; opacity: 0.6; }
  .tmax, .tmin { position: absolute; right: -2px; font-size: 10px; font-weight: 700; color: var(--oe-temp); background: var(--oe-fill); padding: 0 3px; border-radius: 4px; }
  .tmax { top: 6px; } .tmin { bottom: 6px; }
  .tline { width: 16px; height: 0; border-top: 2.5px solid var(--oe-temp); display: inline-block; }
  .tline.dash { border-top-style: dashed; opacity: 0.6; }
  .col { position: relative; flex: 1 1 0; min-width: 0; height: 140px; display: flex; flex-direction: column; justify-content: flex-end; }
  .col .top { border-radius: 4px 4px 0 0; }
  .ghost { background: var(--oe-ghost); border-radius: 4px 4px 2px 2px; }
  .mark { position: absolute; left: 0; right: 0; height: 3px; border-radius: 2px; background: var(--oe-dark); opacity: 0.75; }
  .seg-elec { background: color-mix(in srgb, var(--oe-elec) 78%, var(--oe-card)); }
  .seg-gas { background: color-mix(in srgb, var(--oe-gas) 72%, var(--oe-card)); }
  .seg-water { background: color-mix(in srgb, var(--oe-water) 65%, var(--oe-card)); }
  .seg-hc { background: color-mix(in srgb, var(--oe-water) 38%, var(--oe-card)); }
  .labels { display: flex; gap: 3px; height: 14px; }
  .labels span { flex: 1 1 0; min-width: 0; overflow: visible; white-space: nowrap; font-size: 11px; font-weight: 600; color: var(--oe-muted); }
  .labels.three { justify-content: space-between; } .labels.three span { flex: none; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding-top: 4px; font-size: 13px; font-weight: 600; color: var(--oe-muted); }
  .legend span { display: flex; align-items: center; gap: 6px; }
  .legend .dot { width: 10px; height: 10px; }
  .tick { width: 14px; height: 3px; border-radius: 2px; background: var(--oe-dark); display: inline-block; }
  .chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .chips.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .chip { border-radius: 18px; background: var(--oe-fill); padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .chip .t1 { font-size: 17px; }
  .chip .t2 { font-size: 13px; }
  .pill { min-height: 52px; border-radius: 18px; background: var(--oe-fill); padding: 0 14px; display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; }
  .pill.amber { background: var(--oe-elec-tint); } .pill.amber ha-icon { color: var(--oe-elec); }
  .pill ha-icon { --mdc-icon-size: 18px; color: var(--oe-muted); }
  .line { border-radius: calc(var(--oe-r) + 2px); background: var(--oe-fill); padding: 12px 14px 12px 12px; display: flex; align-items: center; gap: 14px; }
  .line .end { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .line .t1 { font-size: 17px; }
  .line.back { background: none; padding: 0 4px; gap: 6px; } .line.back .t1 { font-size: 16px; color: var(--oe-muted); } .line.back ha-icon { color: var(--oe-muted); }
  .srcs { display: grid; gap: 8px; }
  .srcchip { height: 64px; min-width: 0; border: 0; border-radius: 18px; background: var(--oe-fill); color: var(--oe-text); font: inherit; font-size: 13px; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; padding: 0 4px; }
  .srcchip span { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .srcchip ha-icon { --mdc-icon-size: 20px; }
  .srcchip.on.all { background: var(--oe-card); box-shadow: var(--oe-shadow); }
  .ic-all { color: var(--oe-text); }
  .sq.all { background: var(--oe-card); box-shadow: var(--tile-chip-shadow, 0 2px 6px rgba(74, 70, 64, 0.08)); color: var(--oe-text); }
  .srcchip.on.elec { background: var(--oe-elec-tint); } .srcchip.on.gas { background: var(--oe-gas-tint); } .srcchip.on.water { background: var(--oe-water-tint); }
  .ic-elec { color: var(--oe-elec); } .ic-gas { color: var(--oe-gas); } .ic-water { color: var(--oe-water); }
  .spark { height: 44px; display: flex; align-items: flex-end; gap: 3px; }
  .spark i { flex: 1 1 0; border-radius: 3px 3px 1px 1px; background: var(--oe-ghost); }
  .spark i.hot { background: color-mix(in srgb, var(--oe-elec) 78%, var(--oe-card)); }
  .list { padding: 8px; gap: 0; }
  .item { display: flex; align-items: center; gap: 12px; padding: 8px; }
  .item > .num { white-space: nowrap; }
  .note { padding: 4px 4px 0; font-size: 12px; font-weight: 600; color: var(--oe-muted); }
  .note.err { color: var(--error-color, #c62828); }
  button:focus-visible, .link:focus-visible { outline: 2px solid var(--oe-text); outline-offset: 2px; }
`;

if (typeof customElements !== "undefined" && !customElements.get("origami-energy")) {
  customElements.define("origami-energy", OrigamiEnergy);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "origami-energy", name: "Origami Energy", description: "Today's energy cost and use from the energy dashboard, with a details view" });
}
