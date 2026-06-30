import { describe, expect, it } from "vitest";
import {
  lipoRuntimeHours,
  ws2812SupplyMilliamps,
  ws2812RecommendedSupplyAmps,
  formatRuntime,
  WS2812_FULL_WHITE_MA,
  ledSeriesResistorOhms,
  ledResistorPowerMw,
  nextE24Up,
  voltageDividerOut,
  voltageDividerCurrentMa,
  ldoHeadroomV,
  ldoHolds,
  ldoDissipationW,
  rcCutoffHz,
  ipc2221TraceWidthMil,
  milToMm,
  resistorPowerW,
  recommendResistorWattage,
  cellWh,
  packWh,
  packVoltage,
  packCapacityMah,
} from "../src/calculators";

describe("lipoRuntimeHours", () => {
  it("computes ideal runtime as usable capacity over average draw", () => {
    // 2000 mAh at 100 mA average, 100% usable = 20 h
    expect(lipoRuntimeHours({ capacityMah: 2000, averageCurrentMa: 100, usablePct: 100 })).toBe(20);
  });

  it("applies the usable-capacity derating", () => {
    // 80% usable knocks 20 h down to 16 h
    expect(lipoRuntimeHours({ capacityMah: 2000, averageCurrentMa: 100, usablePct: 80 })).toBe(16);
  });

  it("throws on a non-positive average current (divide-by-zero guard)", () => {
    expect(() => lipoRuntimeHours({ capacityMah: 2000, averageCurrentMa: 0, usablePct: 80 })).toThrow();
    expect(() => lipoRuntimeHours({ capacityMah: 2000, averageCurrentMa: -5, usablePct: 80 })).toThrow();
  });

  it("throws on a non-positive capacity", () => {
    expect(() => lipoRuntimeHours({ capacityMah: 0, averageCurrentMa: 100, usablePct: 80 })).toThrow();
  });
});

describe("ws2812SupplyMilliamps", () => {
  it("sums per-pixel full-white draw plus controller overhead", () => {
    // 30 px * 60 mA + 0 controller = 1800 mA
    expect(ws2812SupplyMilliamps({ pixelCount: 30, perPixelMa: 60, controllerMa: 0 })).toBe(1800);
  });

  it("adds the controller overhead", () => {
    expect(ws2812SupplyMilliamps({ pixelCount: 30, perPixelMa: 60, controllerMa: 220 })).toBe(2020);
  });

  it("defaults the per-pixel draw to the WS2812 full-white max", () => {
    expect(WS2812_FULL_WHITE_MA).toBe(60);
    expect(ws2812SupplyMilliamps({ pixelCount: 10 })).toBe(600);
  });

  it("throws on a negative pixel count", () => {
    expect(() => ws2812SupplyMilliamps({ pixelCount: -1 })).toThrow();
  });
});

describe("ws2812RecommendedSupplyAmps", () => {
  it("adds a headroom margin and returns amps", () => {
    // 1800 mA + 20% = 2160 mA = 2.16 A
    expect(ws2812RecommendedSupplyAmps({ pixelCount: 30, perPixelMa: 60, controllerMa: 0 }, 20)).toBeCloseTo(2.16, 5);
  });

  it("defaults to a 20% headroom", () => {
    expect(ws2812RecommendedSupplyAmps({ pixelCount: 30 })).toBeCloseTo(2.16, 5);
  });
});

describe("formatRuntime", () => {
  it("renders whole and fractional hours as h/m", () => {
    expect(formatRuntime(20)).toBe("20 h 0 m");
    expect(formatRuntime(16.5)).toBe("16 h 30 m");
    expect(formatRuntime(0.25)).toBe("0 h 15 m");
  });
});

describe("ledSeriesResistorOhms", () => {
  it("is (Vsupply - Vf) / I — Ohm's law over the resistor", () => {
    // 3.3 V rail, red LED Vf 1.8 V, 5 mA → (3.3-1.8)/0.005 = 300 Ω
    expect(ledSeriesResistorOhms({ supplyV: 3.3, ledVf: 1.8, currentMa: 5 })).toBeCloseTo(300, 6);
    // 5 V, Vf 2.0, 20 mA → 3/0.02 = 150 Ω
    expect(ledSeriesResistorOhms({ supplyV: 5, ledVf: 2, currentMa: 20 })).toBeCloseTo(150, 6);
  });
  it("throws when the supply can't exceed the LED forward voltage", () => {
    expect(() => ledSeriesResistorOhms({ supplyV: 1.8, ledVf: 2.0, currentMa: 5 })).toThrow();
    expect(() => ledSeriesResistorOhms({ supplyV: 3.3, ledVf: 3.3, currentMa: 5 })).toThrow();
  });
  it("throws on non-positive current", () => {
    expect(() => ledSeriesResistorOhms({ supplyV: 5, ledVf: 2, currentMa: 0 })).toThrow();
  });
});

describe("ledResistorPowerMw", () => {
  it("is the voltage across the resistor times the current, in mW", () => {
    // (3.3-1.8) V × 5 mA = 7.5 mW
    expect(ledResistorPowerMw({ supplyV: 3.3, ledVf: 1.8, currentMa: 5 })).toBeCloseTo(7.5, 6);
    // (5-2) × 20 = 60 mW
    expect(ledResistorPowerMw({ supplyV: 5, ledVf: 2, currentMa: 20 })).toBeCloseTo(60, 6);
  });
});

describe("nextE24Up", () => {
  it("rounds up to the next E24 standard value (safe: a bit less current)", () => {
    expect(nextE24Up(300)).toBe(300); // exact E24
    expect(nextE24Up(290)).toBe(300);
    expect(nextE24Up(301)).toBe(330); // next E24 above 300 is 330
    expect(nextE24Up(150)).toBe(150);
    expect(nextE24Up(1234)).toBe(1300);
    expect(nextE24Up(47)).toBe(47);
  });
});

describe("voltageDividerOut", () => {
  it("is Vin * R2 / (R1 + R2)", () => {
    // 5 V, R1 10k, R2 20k → 5*20/30 = 3.333 V
    expect(voltageDividerOut({ vinV: 5, r1Ohms: 10000, r2Ohms: 20000 })).toBeCloseTo(3.3333, 4);
    // equal legs halve it
    expect(voltageDividerOut({ vinV: 3.3, r1Ohms: 1000, r2Ohms: 1000 })).toBeCloseTo(1.65, 6);
  });
  it("throws when both resistors are zero", () => {
    expect(() => voltageDividerOut({ vinV: 5, r1Ohms: 0, r2Ohms: 0 })).toThrow();
  });
});

describe("voltageDividerCurrentMa", () => {
  it("is Vin / (R1 + R2), in mA", () => {
    // 5 V / 30k = 0.1667 mA
    expect(voltageDividerCurrentMa({ vinV: 5, r1Ohms: 10000, r2Ohms: 20000 })).toBeCloseTo(0.16667, 4);
  });
});

describe("ldoHeadroomV", () => {
  it("is Vin - Vout", () => {
    expect(ldoHeadroomV({ vinV: 5, voutV: 3.3 })).toBeCloseTo(1.7, 6);
  });
});

describe("ldoHolds", () => {
  it("holds only when headroom is at least the dropout", () => {
    expect(ldoHolds({ vinV: 5, voutV: 3.3, dropoutV: 0.3 })).toBe(true);
    expect(ldoHolds({ vinV: 3.4, voutV: 3.3, dropoutV: 0.3 })).toBe(false);
    expect(ldoHolds({ vinV: 3.6, voutV: 3.3, dropoutV: 0.3 })).toBe(true); // exactly at the edge
  });
  it("holds at the exact dropout edge despite float dust (epsilon)", () => {
    // 5.0 - 4.7 = 0.2999999999999998 < 0.3 in raw float; the epsilon keeps it holding
    expect(ldoHolds({ vinV: 5.0, voutV: 4.7, dropoutV: 0.3 })).toBe(true);
  });
});

describe("ldoDissipationW", () => {
  it("is (Vin - Vout) * Iload", () => {
    // (5-3.3) V * 0.55 A = 0.935 W
    expect(ldoDissipationW({ vinV: 5, voutV: 3.3, currentMa: 550 })).toBeCloseTo(0.935, 6);
    expect(ldoDissipationW({ vinV: 5, voutV: 3.3, currentMa: 0 })).toBe(0);
  });
  it("throws when Vin is below Vout or current is negative", () => {
    expect(() => ldoDissipationW({ vinV: 3.3, voutV: 5, currentMa: 100 })).toThrow();
    expect(() => ldoDissipationW({ vinV: 5, voutV: 3.3, currentMa: -1 })).toThrow();
  });
});

describe("rcCutoffHz", () => {
  it("is 1 / (2*pi*R*C)", () => {
    expect(rcCutoffHz({ rOhms: 10000, cFarads: 100e-9 })).toBeCloseTo(159.15, 1);
    expect(rcCutoffHz({ rOhms: 1000, cFarads: 10e-9 })).toBeCloseTo(15915, 0);
  });
  it("throws on non-positive R or C", () => {
    expect(() => rcCutoffHz({ rOhms: 0, cFarads: 1e-9 })).toThrow();
    expect(() => rcCutoffHz({ rOhms: 1000, cFarads: 0 })).toThrow();
  });
});

describe("ipc2221TraceWidthMil", () => {
  it("matches the IPC-2221 external curve for a known case", () => {
    // 1 A, 10 °C rise, 1 oz, external ≈ 11.8 mil (per the IPC-2221 curve fit)
    expect(
      ipc2221TraceWidthMil({ currentA: 1, tempRiseC: 10, copperOz: 1, layer: "external" }),
    ).toBeCloseTo(11.8, 0);
  });
  it("defaults to the external (conservative) layer", () => {
    expect(ipc2221TraceWidthMil({ currentA: 1, tempRiseC: 10, copperOz: 1 })).toBeCloseTo(11.8, 0);
  });
  it("needs a wider trace on an internal layer (k halved)", () => {
    const ext = ipc2221TraceWidthMil({ currentA: 2, tempRiseC: 10, copperOz: 1, layer: "external" });
    const int = ipc2221TraceWidthMil({ currentA: 2, tempRiseC: 10, copperOz: 1, layer: "internal" });
    expect(int).toBeGreaterThan(ext);
  });
  it("throws on non-positive inputs (including copper weight)", () => {
    expect(() => ipc2221TraceWidthMil({ currentA: 0, tempRiseC: 10, copperOz: 1, layer: "external" })).toThrow();
    expect(() => ipc2221TraceWidthMil({ currentA: 1, tempRiseC: 0, copperOz: 1, layer: "external" })).toThrow();
    expect(() => ipc2221TraceWidthMil({ currentA: 1, tempRiseC: 10, copperOz: 0, layer: "external" })).toThrow();
  });
});

describe("milToMm", () => {
  it("converts thousandths of an inch to mm", () => {
    expect(milToMm(100)).toBeCloseTo(2.54, 5);
    expect(milToMm(11.8)).toBeCloseTo(0.2997, 3);
  });
});

describe("resistorPowerW", () => {
  it("is I^2 * R", () => {
    expect(resistorPowerW({ currentMa: 1000, rOhms: 0.1 })).toBeCloseTo(0.1, 6); // 1 A, 0.1 Ω
    expect(resistorPowerW({ currentMa: 20, rOhms: 150 })).toBeCloseTo(0.06, 6); // 20 mA, 150 Ω
  });
});

describe("recommendResistorWattage", () => {
  it("picks the smallest standard rating at 2x the power", () => {
    expect(recommendResistorWattage(0.1)).toBe(0.25); // 0.2 -> 0.25
    expect(recommendResistorWattage(0.06)).toBe(0.125); // 0.12 -> 0.125
    expect(recommendResistorWattage(0.5)).toBe(1); // 1.0 -> 1
  });
});

describe("battery pack energy", () => {
  it("cell Wh = Ah * V", () => {
    expect(cellWh({ capacityMah: 3000, nominalV: 3.7 })).toBeCloseTo(11.1, 6);
  });
  it("pack Wh scales by series * parallel", () => {
    // 3S2P of 3000 mAh / 3.7 V cells = 11.1 * 6 = 66.6 Wh
    expect(packWh({ capacityMah: 3000, nominalV: 3.7, series: 3, parallel: 2 })).toBeCloseTo(66.6, 4);
  });
  it("pack voltage = nominal * series; capacity = mAh * parallel", () => {
    expect(packVoltage({ nominalV: 3.7, series: 3 })).toBeCloseTo(11.1, 6);
    expect(packCapacityMah({ capacityMah: 3000, parallel: 2 })).toBe(6000);
  });
});

// Consistent guard policy: every function rejects physically meaningless input.
describe("input guards (consistency)", () => {
  it("lipoRuntimeHours rejects an out-of-range usable percentage", () => {
    expect(() => lipoRuntimeHours({ capacityMah: 2000, averageCurrentMa: 100, usablePct: -1 })).toThrow();
    expect(() => lipoRuntimeHours({ capacityMah: 2000, averageCurrentMa: 100, usablePct: 101 })).toThrow();
  });
  it("ledResistorPowerMw rejects a supply at/below Vf or non-positive current (matches its sibling)", () => {
    expect(() => ledResistorPowerMw({ supplyV: 1.8, ledVf: 2.0, currentMa: 5 })).toThrow();
    expect(() => ledResistorPowerMw({ supplyV: 5, ledVf: 2, currentMa: 0 })).toThrow();
  });
  it("both voltage-divider functions reject a negative resistor leg", () => {
    expect(() => voltageDividerOut({ vinV: 5, r1Ohms: -1000, r2Ohms: 2000 })).toThrow();
    expect(() => voltageDividerCurrentMa({ vinV: 5, r1Ohms: 1000, r2Ohms: -1 })).toThrow();
  });
  it("voltageDividerCurrentMa still rejects a zero sum", () => {
    expect(() => voltageDividerCurrentMa({ vinV: 5, r1Ohms: 0, r2Ohms: 0 })).toThrow();
  });
  it("recommendResistorWattage rejects negative power", () => {
    expect(() => recommendResistorWattage(-1)).toThrow();
  });
  it("formatRuntime rejects negative or non-finite input", () => {
    expect(() => formatRuntime(-0.5)).toThrow();
    expect(() => formatRuntime(NaN)).toThrow();
  });
  it("resistorPowerW rejects negatives but allows zero (guard is < 0)", () => {
    expect(() => resistorPowerW({ currentMa: -1, rOhms: 10 })).toThrow();
    expect(resistorPowerW({ currentMa: 0, rOhms: 0 })).toBe(0);
  });
});

// Edge branches and defaults previously unexercised.
describe("edge branches", () => {
  it("nextE24Up returns the smallest E24 value for non-positive input", () => {
    expect(nextE24Up(0)).toBe(1);
    expect(nextE24Up(-5)).toBe(1);
  });
  it("recommendResistorWattage honours a custom derating and clamps to the max", () => {
    expect(recommendResistorWattage(0.1, 3)).toBe(0.5); // need 0.3 -> 0.5
    expect(recommendResistorWattage(6)).toBe(10); // need 12 -> clamp to the 10 W max
  });
  it("ws2812RecommendedSupplyAmps applies a non-default headroom", () => {
    // 30 px * 60 mA = 1800 mA, +50% = 2700 mA = 2.7 A
    expect(ws2812RecommendedSupplyAmps({ pixelCount: 30 }, 50)).toBeCloseTo(2.7, 5);
  });
  it("ws2812SupplyMilliamps returns just the controller overhead at zero pixels", () => {
    expect(ws2812SupplyMilliamps({ pixelCount: 0, controllerMa: 220 })).toBe(220);
  });
  it("formatRuntime renders zero", () => {
    expect(formatRuntime(0)).toBe("0 h 0 m");
  });
});
