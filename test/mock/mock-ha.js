// Stand-ins for the parts of the Home Assistant frontend the card relies on: ha-card, ha-icon with the
// Material Design Icons from @mdi/js, the hass object, loadCardHelpers and the events a card fires.
import * as mdi from "/node_modules/@mdi/js/mdi.js";

const events = (window.events = []);
for (const type of ["hass-action", "hass-more-info", "location-changed"]) {
  addEventListener(type, (ev) => events.push({ type, detail: ev.detail }));
}
window.calls = [];

// Same host styles as ha-card in the frontend, so the card's own rules on ha-card win as they do there.
customElements.define("ha-card", class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" }).innerHTML = `<style>
      :host { display: block; position: relative; color: var(--primary-text-color);
        background: var(--ha-card-background, var(--card-background-color, #fff));
        border-radius: var(--ha-card-border-radius, 12px); box-shadow: var(--ha-card-box-shadow, none);
        border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0)); }
    </style><slot></slot>`;
  }
});

const iconPath = (name) => {
  const key = "mdi" + String(name ?? "").replace(/^mdi:/, "").split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return mdi[key] ?? "";
};

customElements.define("ha-icon", class extends HTMLElement {
  static get observedAttributes() { return ["icon"]; }
  get icon() { return this.getAttribute("icon"); }
  set icon(value) { this.setAttribute("icon", value); }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { this.render(); }
  render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>
      :host { display: inline-flex; width: var(--mdc-icon-size, 24px); height: var(--mdc-icon-size, 24px); fill: currentColor; }
      svg { width: 100%; height: 100%; }
    </style><svg viewBox="0 0 24 24"><path d="${iconPath(this.icon)}"></path></svg>`;
  }
});

// The picture-entity card becomes a still image, so the live camera layout can be tested and shown.
window.loadCardHelpers = async () => ({
  createCardElement(config) {
    const el = document.createElement("div");
    el.className = "mock-picture-entity";
    el.dataset.entity = config.entity;
    el.innerHTML = `<img src="/test/mock/img/street.svg" alt="" style="display: block; width: 100%;
      aspect-ratio: ${String(config.aspect_ratio ?? "16:9").replace(":", " / ")}; object-fit: cover">`;
    return el;
  },
});

// states: { entity_id: "state" | { state, attributes, last_changed } }
// ws: { message_type: response | (message) => response }, answered in a microtask like the real connection
export function createHass({ states = {}, ws = {}, language = "en" } = {}) {
  const now = new Date().toISOString();
  const all = {};
  for (const [id, value] of Object.entries(states)) {
    const s = typeof value === "object" ? value : { state: value };
    all[id] = { entity_id: id, state: String(s.state), attributes: s.attributes ?? {},
                last_changed: s.last_changed ?? now, last_updated: s.last_updated ?? s.last_changed ?? now };
  }
  return {
    states: all,
    language,
    locale: { language, number_format: "language", time_format: "language" },
    user: { is_admin: true, name: "Demo" },
    callService(domain, service, data, target) {
      window.calls.push({ domain, service, data, target });
      return Promise.resolve({});
    },
    callWS(message) {
      window.calls.push({ ws: message.type, message });
      const answer = ws[message.type];
      if (answer === undefined) return Promise.reject(new Error(`No mock for ${message.type}`));
      return Promise.resolve().then(() => (typeof answer === "function" ? answer(message) : answer));
    },
    formatEntityState: (s) => s?.state ?? "",
  };
}

// Adds a card with its config and a hass object to a column as wide as a phone.
export async function mount(tag, config, hass, column = document.querySelector(".cards")) {
  await customElements.whenDefined(tag);
  const el = document.createElement(tag);
  el.setConfig(config);
  el.hass = hass;
  column.append(el);
  return el;
}
