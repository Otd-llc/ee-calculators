// Pure, unit-testable math behind the One Thousand Drones Academy EE calculators
// (https://academy.onethousanddrones.com/tools).
//
// Each function takes scalars and returns a number, throwing on physically
// meaningless input (a non-positive current/resistance/capacity, an out-of-range
// percentage, a supply below the LED forward voltage, an input below the LDO
// output) so a bad value never surfaces as Infinity/NaN or a negative quantity.
// The one informative exception is ldoHeadroomV, whose negative result ("short by
// X volts") is the answer.

// WS2812/NeoPixel full-white draw, per pixel, at 5 V. One pixel = three ~20 mA
// channels driven together, so ~60 mA is the datasheet worst case (XINGLIGHT
// XL-5050RGBC-WS2812B / Adafruit NeoPixel, "60 mA at full white").
export const WS2812_FULL_WHITE_MA = 60;

export function lipoRuntimeHours(input: {
  capacityMah: number;
  averageCurrentMa: number;
  usablePct: number;
}): number {
  if (input.averageCurrentMa <= 0) {
    throw new Error("averageCurrentMa must be greater than 0");
  }
  if (input.capacityMah <= 0) {
    throw new Error("capacityMah must be greater than 0");
  }
  if (input.usablePct < 0 || input.usablePct > 100) {
    throw new Error("usablePct must be between 0 and 100");
  }
  const usableMah = input.capacityMah * (input.usablePct / 100);
  return usableMah / input.averageCurrentMa;
}

export function ws2812SupplyMilliamps(input: {
  pixelCount: number;
  perPixelMa?: number;
  controllerMa?: number;
}): number {
  if (input.pixelCount < 0) {
    throw new Error("pixelCount must be 0 or greater");
  }
  const perPixel = input.perPixelMa ?? WS2812_FULL_WHITE_MA;
  const controller = input.controllerMa ?? 0;
  return input.pixelCount * perPixel + controller;
}

export function ws2812RecommendedSupplyAmps(
  input: { pixelCount: number; perPixelMa?: number; controllerMa?: number },
  headroomPct = 20,
): number {
  const milliamps = ws2812SupplyMilliamps(input);
  return (milliamps * (1 + headroomPct / 100)) / 1000;
}

// Render a duration in hours as "H h M m" (minutes floored). Used by the LiPo
// runtime island so the result reads in human units, not a raw decimal.
export function formatRuntime(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error("hours must be a finite, non-negative number");
  }
  const whole = Math.floor(hours);
  const minutes = Math.floor((hours - whole) * 60);
  return `${whole} h ${minutes} m`;
}

// ── LED series resistor ──────────────────────────────────────────────────────
// The resistor that sets an LED's current from a supply rail: R = (Vsupply − Vf)
// / I, the LED's forward drop subtracted first. Vf is a datasheet value (varies
// by colour + part), so it's an input, never a constant.

export function ledSeriesResistorOhms(input: {
  supplyV: number;
  ledVf: number;
  currentMa: number;
}): number {
  if (input.supplyV <= input.ledVf) {
    throw new Error("supplyV must exceed the LED forward voltage (ledVf)");
  }
  if (input.currentMa <= 0) {
    throw new Error("currentMa must be greater than 0");
  }
  return (input.supplyV - input.ledVf) / (input.currentMa / 1000);
}

// Power burned in the series resistor (mW) = voltage across it × current. Pick a
// resistor rated for at least ~2x this.
export function ledResistorPowerMw(input: {
  supplyV: number;
  ledVf: number;
  currentMa: number;
}): number {
  if (input.supplyV <= input.ledVf) {
    throw new Error("supplyV must exceed the LED forward voltage (ledVf)");
  }
  if (input.currentMa <= 0) {
    throw new Error("currentMa must be greater than 0");
  }
  return (input.supplyV - input.ledVf) * input.currentMa;
}

// E24 (IEC 60063) significands — the standard 5% resistor values per decade.
const E24 = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3,
  4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
];

// Smallest E24 standard value >= the target. Rounding UP gives a touch LESS
// current than asked — the safe direction for an LED.
export function nextE24Up(ohms: number): number {
  if (ohms <= 0) return E24[0];
  const decade = Math.floor(Math.log10(ohms));
  for (let d = decade; d <= decade + 1; d++) {
    const scale = Math.pow(10, d);
    for (const v of E24) {
      const candidate = v * scale;
      if (candidate >= ohms - 1e-9) return Number(candidate.toPrecision(2));
    }
  }
  return ohms;
}

// ── Voltage divider ──────────────────────────────────────────────────────────
// Vout = Vin × R2 / (R1 + R2), with R2 to ground and the tap between the two. The
// divider also draws a quiescent current Vin / (R1 + R2) — bigger legs waste less.

export function voltageDividerOut(input: {
  vinV: number;
  r1Ohms: number;
  r2Ohms: number;
}): number {
  if (input.r1Ohms < 0 || input.r2Ohms < 0) {
    throw new Error("R1 and R2 must each be 0 or greater");
  }
  const total = input.r1Ohms + input.r2Ohms;
  if (total <= 0) {
    throw new Error("R1 + R2 must be greater than 0");
  }
  return (input.vinV * input.r2Ohms) / total;
}

export function voltageDividerCurrentMa(input: {
  vinV: number;
  r1Ohms: number;
  r2Ohms: number;
}): number {
  if (input.r1Ohms < 0 || input.r2Ohms < 0) {
    throw new Error("R1 and R2 must each be 0 or greater");
  }
  const total = input.r1Ohms + input.r2Ohms;
  if (total <= 0) {
    throw new Error("R1 + R2 must be greater than 0");
  }
  return (input.vinV / total) * 1000;
}

// ── Linear LDO headroom + dissipation ────────────────────────────────────────
// A linear regulator holds Vout only while its input stays at least a dropout
// voltage above Vout. The voltage it drops (Vin − Vout) becomes heat at the load
// current (Iin ≈ Iout for a linear LDO) — the real thermal limit.

export function ldoHeadroomV(input: { vinV: number; voutV: number }): number {
  return input.vinV - input.voutV;
}

export function ldoHolds(input: {
  vinV: number;
  voutV: number;
  dropoutV: number;
}): boolean {
  // Epsilon so the exact-dropout edge isn't decided by floating-point dust.
  return input.vinV - input.voutV - input.dropoutV >= -1e-9;
}

export function ldoDissipationW(input: {
  vinV: number;
  voutV: number;
  currentMa: number;
}): number {
  if (input.vinV < input.voutV) {
    throw new Error("vinV must be at least voutV (a linear LDO can't boost)");
  }
  if (input.currentMa < 0) {
    throw new Error("currentMa must be 0 or greater");
  }
  return (input.vinV - input.voutV) * (input.currentMa / 1000);
}

// ── First-order RC cutoff ────────────────────────────────────────────────────
// The −3 dB corner of an RC low/high-pass: fc = 1 / (2π R C). C is in farads.

export function rcCutoffHz(input: { rOhms: number; cFarads: number }): number {
  if (input.rOhms <= 0 || input.cFarads <= 0) {
    throw new Error("R and C must both be greater than 0");
  }
  return 1 / (2 * Math.PI * input.rOhms * input.cFarads);
}

// ── IPC-2221 trace width ──────────────────────────────────────────────────────
// Minimum trace width for a current at a chosen temperature rise, from the
// IPC-2221 curve fit: I = k · ΔT^0.44 · A^0.725, A = width × thickness in mil².
// k = 0.048 external (cooled by air) / 0.024 internal (buried, no convection).
// Solve for the cross-section, then divide by the copper thickness for a width.
// 1 oz/ft² of copper ≈ 1.378 mil thick. (Sources: IPC-2221; DigiKey calculator.)
const OZ_TO_MIL = 1.378;

export function ipc2221TraceWidthMil(input: {
  currentA: number;
  tempRiseC: number;
  copperOz: number;
  layer?: "external" | "internal";
}): number {
  if (input.currentA <= 0 || input.tempRiseC <= 0 || input.copperOz <= 0) {
    throw new Error("current, temperature rise, and copper weight must be > 0");
  }
  // External (outer, air-cooled) traces carry more current than internal
  // (buried) ones, so k is larger. Default to the conservative external case.
  const k = (input.layer ?? "external") === "external" ? 0.048 : 0.024;
  const areaMil2 = Math.pow(
    input.currentA / (k * Math.pow(input.tempRiseC, 0.44)),
    1 / 0.725,
  );
  const thicknessMil = input.copperOz * OZ_TO_MIL;
  return areaMil2 / thicknessMil;
}

// Thousandths of an inch (mil) to millimetres.
export function milToMm(mil: number): number {
  return mil * 0.0254;
}

// ── Resistor power + wattage rating ──────────────────────────────────────────
// What a resistor burns: P = I²R (equivalently V×I or V²/R). Then pick a part
// rated above it with margin, since a resistor at its rating runs near its max.

export function resistorPowerW(input: {
  currentMa: number;
  rOhms: number;
}): number {
  if (input.rOhms < 0 || input.currentMa < 0) {
    throw new Error("current and resistance must be >= 0");
  }
  const i = input.currentMa / 1000;
  return i * i * input.rOhms;
}

// Standard resistor power ratings (W).
const RESISTOR_WATTAGES = [0.0625, 0.1, 0.125, 0.25, 0.5, 1, 2, 3, 5, 10];

// Smallest standard rating at least `derating`× the dissipation (default 2x — a
// resistor run at its rating sits near its maximum temperature).
export function recommendResistorWattage(powerW: number, derating = 2): number {
  if (powerW < 0) {
    throw new Error("powerW must be 0 or greater");
  }
  const need = powerW * derating;
  for (const w of RESISTOR_WATTAGES) {
    if (w >= need - 1e-12) return w;
  }
  return RESISTOR_WATTAGES[RESISTOR_WATTAGES.length - 1];
}

// ── Battery pack energy ──────────────────────────────────────────────────────
// Watt-hours = (capacity in Ah) × nominal voltage. A pack multiplies voltage by
// the series count and capacity by the parallel count.

export function cellWh(input: {
  capacityMah: number;
  nominalV: number;
}): number {
  return (input.capacityMah / 1000) * input.nominalV;
}

export function packWh(input: {
  capacityMah: number;
  nominalV: number;
  series: number;
  parallel: number;
}): number {
  return cellWh(input) * input.series * input.parallel;
}

export function packVoltage(input: {
  nominalV: number;
  series: number;
}): number {
  return input.nominalV * input.series;
}

export function packCapacityMah(input: {
  capacityMah: number;
  parallel: number;
}): number {
  return input.capacityMah * input.parallel;
}
