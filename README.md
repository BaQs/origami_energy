<img alt="The summary, the banner and the tiles of Origami Energy in light and dark mode" src="https://raw.githubusercontent.com/BaQs/origami_energy/main/images/hero.png">

Origami Energy shows today's energy cost and use on a dashboard, in the style of [Origami](https://github.com/hazymorning/origami). It reads the Home Assistant energy dashboard, so it uses the sources, prices and devices you already set up there. A details view compares today with yesterday and the last 7 days, and a week, a month or a year with the same period last year.

## Installation

[![Open your Home Assistant instance and open this repository inside HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=BaQs&repository=origami_energy&category=plugin)

Download Origami Energy in HACS. If HACS asks you to add the repository, select **Add**. HACS adds the card to the dashboard resources. You need Home Assistant 2026.9 or newer and a configured energy dashboard.

<details>
<summary><b>Manual installation</b></summary>

<br>

Download `origami-energy.js` from the [latest release](https://github.com/BaQs/origami_energy/releases/latest) into `config/www/` and add `/local/origami-energy.js?v=0.5.0` as a JavaScript module in **Settings** > **Dashboards** > **Resources**. Change the version after each update, otherwise your browser keeps using the old file.

</details>

## Usage

```yaml
type: custom:origami-energy
layout: summary
navigation_path: "#energy"
```

The summary shows electricity, gas and water side by side, with today's cost and use. Tapping one opens `navigation_path`, for example a [Bubble Card](https://github.com/Clooos/Bubble-Card) pop-up with the details layout, which then opens on that energy.

<img alt="The details layout in a pop-up, in light and dark mode" src="https://raw.githubusercontent.com/BaQs/origami_energy/main/images/popup.png">

<details>
<summary><b>Layouts</b></summary>

<br>

| Layout | Shows |
| --- | --- |
| `summary` | Electricity, gas and water side by side, with today's cost and use |
| `banner` | Today's total cost, the tariff, the current power and the cost per energy |
| `tiles` | One tile for the total and one for each energy |
| `details` | The full view for a pop-up, described below |

Each layout only shows the energies that the energy dashboard has.

</details>

<details>
<summary><b>Details view</b></summary>

<br>

The details view has an overview and one view per energy, and four periods. A day is compared with yesterday and with the average of the last 7 days. A week, a month and a year are compared with the same period last year, at the same point in time, and the card projects the end of the period from there. Last year's use is priced at today's rates, so the comparison shows a change in use and not a change in prices.

<img alt="The electricity view of a month, in light and dark mode" src="https://raw.githubusercontent.com/BaQs/origami_energy/main/images/electricity.png">

The overview adds the cost per hour, day or month, with the outdoor temperature when `temperature` is set, a live section with the current power, and the devices of the energy dashboard. This pop-up opens from the summary in the example above:

```yaml
type: vertical-stack
cards:
  - type: custom:bubble-card
    card_type: pop-up
    hash: "#energy"
    name: Energy
  - type: custom:origami-energy
    layout: details
    power: sensor.power
    power_max: 9000
    offpeak: binary_sensor.off_peak
    temperature: sensor.outdoor_temperature
```

</details>

<details>
<summary><b>Options</b></summary>

<br>

| Option | Default | Description |
| --- | --- | --- |
| `layout` | `banner` | `summary`, `banner`, `tiles` or `details` |
| `navigation_path` | | Opened on tap by `summary`, `banner` and `tiles` |
| `power` | | A sensor with the current power, in W or VA |
| `power_max` | | The contracted power, for the gauge in the live section |
| `offpeak` | | A binary sensor that is on during off-peak hours |
| `temperature` | | An outdoor temperature sensor, drawn on the charts of the details view |
| `devices` | | Names and icons for devices of the energy dashboard, by statistic id |
| `breakdown` | `true` | The cost per energy on the right of the banner |

```yaml
devices:
  sensor.server_energy:
    name: Home server
    icon: mdi:server
```

</details>

<details>
<summary><b>How it works</b></summary>

<br>

The card reads the energy dashboard settings and the long-term statistics of its sources, so the numbers match the energy dashboard. Prices come from the energy dashboard too, either a fixed price or a price entity. An electricity source counts as off-peak when its statistic id contains `hc`, `off_peak` or `offpeak`, and as peak when it contains `hp` or `peak`. Amounts use the currency of Home Assistant, and the texts follow its language, in English or French.

</details>

<sub>The screenshots use the Origami theme with made-up data.</sub>

<sub>AI is used as a tool in this project.</sub>
