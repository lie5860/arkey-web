import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskLightState } from "./contracts.js";
import { profileDirectory } from "./profile.js";
import { EffectPrimitive, type EffectSpec } from "./protocol.js";

export type PrimitiveName = "off" | "solid" | "shallowBreath" | "breath" | "doublePulse" | "riseFade" | "pressFlash";

export interface SemanticEffectDefinition {
  hex: string;
  hue: number;
  saturation: number;
  value: number;
  basePrimitive: PrimitiveName;
  selectedPrimitive: PrimitiveName;
  entryPrimitive?: PrimitiveName;
  entryDurationMs?: number;
}

export interface VoiceEffectDefinition {
  hex: string;
  hue: number;
  saturation: number;
  value: number;
  primitive: PrimitiveName;
}

export interface EffectCatalog {
  version: 1;
  atmosphereMix: number;
  selectedPulsePeriodMs: number;
  primitives: Record<PrimitiveName, EffectPrimitive>;
  semantics: Record<TaskLightState, SemanticEffectDefinition>;
  voice: Record<"recording" | "processing" | "ready", VoiceEffectDefinition>;
  priority: string[];
}

const semanticNames: TaskLightState[] = ["unassigned", "idle", "working", "completeUnread", "requiresInput", "error", "offline"];
const primitiveNames: PrimitiveName[] = ["off", "solid", "shallowBreath", "breath", "doublePulse", "riseFade", "pressFlash"];

export function validateEffectCatalog(value: unknown): EffectCatalog {
  if (!value || typeof value !== "object") throw new Error("Effect catalog must be an object");
  const catalog = value as EffectCatalog;
  if (catalog.version !== 1 || !Number.isFinite(catalog.atmosphereMix) || catalog.atmosphereMix < 0 || catalog.atmosphereMix > 1) throw new Error("Effect catalog identity is invalid");
  if (!Number.isInteger(catalog.selectedPulsePeriodMs) || catalog.selectedPulsePeriodMs < 250) throw new Error("Effect pulse period is invalid");
  for (const [index, name] of primitiveNames.entries()) {
    if (catalog.primitives?.[name] !== index) throw new Error(`Effect primitive ${name} does not match firmware enum ${index}`);
  }
  for (const name of semanticNames) {
    const definition = catalog.semantics?.[name];
    if (!definition || !primitiveNames.includes(definition.basePrimitive) || !primitiveNames.includes(definition.selectedPrimitive)) throw new Error(`Semantic effect ${name} is invalid`);
    if (![definition.hue, definition.saturation, definition.value].every((number) => Number.isInteger(number) && number >= 0 && number <= 255)) throw new Error(`Semantic color ${name} is invalid`);
  }
  for (const name of ["recording", "processing", "ready"] as const) {
    const definition = catalog.voice?.[name];
    if (!definition || !primitiveNames.includes(definition.primitive)) throw new Error(`Voice effect ${name} is invalid`);
  }
  if (!Array.isArray(catalog.priority) || !catalog.priority.length) throw new Error("Effect priority list is missing");
  return catalog;
}

export const effectCatalog = validateEffectCatalog(
  JSON.parse(readFileSync(join(profileDirectory, "effects-v1.json"), "utf8")) as unknown,
);

export function semanticEffect(led: number, state: TaskLightState, selected: boolean): EffectSpec {
  const definition = effectCatalog.semantics[state];
  const primitive = selected ? definition.selectedPrimitive : definition.basePrimitive;
  return {
    led,
    effect: effectCatalog.primitives[primitive],
    hue: definition.hue,
    saturation: definition.saturation,
    value: definition.value,
    speed: selected && primitive !== "solid" && primitive !== "off"
      ? Math.max(1, Math.min(255, Math.round((3200 - effectCatalog.selectedPulsePeriodMs) / 10)))
      : 0,
    phase: 0,
    durationMs: 0,
    flags: 0,
  };
}
