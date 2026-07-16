import { randomInt } from "node:crypto";
import type { AutomationRandomSource } from "../../application/automation-random-source.js";

const UINT32_RANGE = 2 ** 32;

type RandomInteger = (max: number) => number;

export class NodeAutomationRandomSource implements AutomationRandomSource {
  constructor(private readonly randomInteger: RandomInteger = randomInt) {}

  next(): number {
    return this.randomInteger(UINT32_RANGE) / UINT32_RANGE;
  }
}
