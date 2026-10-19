// A made-up home for the tests and the README images: peak and off-peak electricity, gas, water, four devices.
import { createHass, mount } from "./mock-ha.js";

const HOUR = 3600000;
const PRICES = { "sensor.energy_peak": 0.27, "sensor.energy_off_peak": 0.21, "sensor.gas_meter": 1.15, "sensor.water_meter": 4.2 };

// Use per hour, shaped like a real day: off-peak at night, peaks in the morning and the evening
const perHour = (stat, t) => {
  const d = new Date(t), h = d.getHours(), day = Math.floor(t / (24 * HOUR));
  const wave = 1 + 0.18 * Math.sin(day * 1.7);
  const winter = 1 + 0.5 * Math.cos(((d.getMonth() + 0.5) / 12) * 2 * Math.PI);
  const busy = (h >= 7 && h <= 9) || (h >= 18 && h <= 22);
  const off = h < 6 || h >= 22;
  switch (stat) {
    case "sensor.energy_peak": return off ? 0 : (busy ? 1.3 : 0.55) * wave;
    case "sensor.energy_off_peak": return off ? 0.75 * wave : 0;
    case "sensor.gas_meter": return (busy ? 0.32 : 0.06) * wave * winter;
    case "sensor.water_meter": return busy ? 0.018 * wave : 0.002;
    case "sensor.fridge_energy": return 0.04;
    case "sensor.dishwasher_energy": return h === 20 ? 1.1 : 0;
    case "sensor.washing_machine_energy": return h === 10 && day % 2 ? 0.9 : 0;
    case "sensor.server_energy": return 0.06;
    default: return 0;
  }
};

const total = (stat, start, end) => {
  let sum = 0;
  for (let t = Math.floor(start / HOUR) * HOUR; t < end; t += HOUR) sum += perHour(stat, t);
  return sum;
};

const binStart = (t, period) => {
  const d = new Date(t);
  if (period === "hour") return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
  if (period === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

const series = ({ start_time, end_time, statistic_ids, period, types }) => {
  const start = Date.parse(start_time), end = Math.min(Date.parse(end_time), Date.now());
  const out = {};
  for (const id of statistic_ids) {
    const bins = new Map();
    for (let t = start; t < end; t += HOUR) {
      const key = binStart(t, period);
      const b = bins.get(key) ?? { start: key, change: 0, values: [] };
      b.change += perHour(id, t);
      const h = new Date(t).getHours();
      if (id === "sensor.outdoor_temperature") b.values.push(9 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + 3 * Math.cos(t / (30 * 24 * HOUR)));
      if (id === "sensor.power") b.values.push(perHour("sensor.energy_peak", t) * 1000 + perHour("sensor.energy_off_peak", t) * 1000 + 180);
      bins.set(key, b);
    }
    out[id] = [...bins.values()].map((b) => {
      if (!types.includes("mean")) return { start: b.start, change: b.change };
      const v = b.values;
      return { start: b.start, mean: v.reduce((a, x) => a + x, 0) / v.length, min: Math.min(...v), max: Math.max(...v) };
    });
  }
  return out;
};

const ws = {
  "energy/get_prefs": {
    energy_sources: [
      { type: "grid", flow_from: [
        { stat_energy_from: "sensor.energy_peak", number_energy_price: PRICES["sensor.energy_peak"] },
        { stat_energy_from: "sensor.energy_off_peak", number_energy_price: PRICES["sensor.energy_off_peak"] },
      ] },
      { type: "gas", stat_energy_from: "sensor.gas_meter", number_energy_price: PRICES["sensor.gas_meter"] },
      { type: "water", stat_energy_from: "sensor.water_meter", number_energy_price: PRICES["sensor.water_meter"] },
    ],
    device_consumption: ["fridge", "dishwasher", "washing_machine", "server"].map((d) => ({ stat_consumption: `sensor.${d}_energy` })),
  },
  "recorder/statistic_during_period": ({ statistic_id, fixed_period }) => ({
    change: total(statistic_id, Date.parse(fixed_period.start_time), Math.min(Date.parse(fixed_period.end_time), Date.now())),
  }),
  "recorder/statistics_during_period": series,
};

const states = {
  "sensor.power": { state: "1240", attributes: { unit_of_measurement: "W" } },
  "binary_sensor.off_peak": "off",
  "sensor.outdoor_temperature": { state: "11.5", attributes: { unit_of_measurement: "°C" } },
  "sensor.fridge_energy": { state: "0", attributes: { friendly_name: "Fridge" } },
  "sensor.dishwasher_energy": { state: "0", attributes: { friendly_name: "Dishwasher" } },
  "sensor.washing_machine_energy": { state: "0", attributes: { friendly_name: "Washing machine" } },
  "sensor.server_energy": { state: "0", attributes: { friendly_name: "Server" } },
};

const BASE = { type: "custom:origami-energy", power: "sensor.power", power_max: 9000, offpeak: "binary_sensor.off_peak",
               temperature: "sensor.outdoor_temperature", navigation_path: "#energy" };

export async function show(name, params, column) {
  const hass = createHass({ states, ws, language: params.get("lang") ?? "en" });
  hass.config = { currency: params.get("currency") ?? "EUR" };
  if (params.get("error")) hass.callWS = () => Promise.reject(new Error(params.get("error")));
  const add = (layout, extra) => mount("origami-energy", { ...BASE, layout, ...extra }, hass, column);
  if (name === "home") {
    await add("summary");
    await add("banner");
    return add("tiles");
  }
  // The details card in a pop-up sheet like the Bubble Card pop-ups of the Origami dashboard
  if (name === "popup") {
    column.style.background = "color-mix(in srgb, var(--primary-background-color) 55%, #8a8780)";
    column.style.paddingTop = "48px";
    const sheet = document.createElement("div");
    sheet.style.cssText = "background: var(--primary-background-color); border-radius: 32px 32px 0 0; padding: 22px 16px 24px;"
      + "margin: 0 -16px -16px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12)";
    sheet.innerHTML = `<div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 4px">
      <span style="font-size: 28px; font-weight: 700">Energy</span><ha-icon icon="mdi:close" style="--mdc-icon-size: 26px; opacity: 0.6"></ha-icon></div>`;
    column.append(sheet);
    return mount("origami-energy", { ...BASE, layout: "details" }, hass, sheet);
  }
  if (name === "details") {
    if (params.get("src") || params.get("per")) {
      window.__origamiEnergyView = { per: params.get("per") ?? "day", src: params.get("src"), at: Date.now() };
    }
    return add("details", { devices: { "sensor.server_energy": { name: "Home server", icon: "mdi:server" } } });
  }
  return add(name === "default" ? "summary" : name);
}
