import type { ReactNode } from "react";
import type { HowCase } from "@/lib/how-case";

/**
 * One screen of the explainer.
 *
 * `measured` is the field that matters. Most of Phase 2 is drawn from a real
 * screening this pipeline actually processed, and says so. A handful of Phase
 * 1 steps cannot be — the model's internal vector and its attention weights
 * are not in the evidence packet — so those are drawn as diagrams and labelled
 * as diagrams.
 *
 * Marking them is not modesty. It is the same rule the analyser itself works
 * by: a thing that was not measured must never be shown as though it was.
 */
export interface Chapter {
  id: string;
  phase: "one" | "two";
  /** The short name in the rail down the side. */
  short: string;
  title: string;
  /** True when what is on screen came out of the real case data. */
  measured: boolean;
  Stage: (props: { data: HowCase }) => ReactNode;
  Body: (props: { data: HowCase }) => ReactNode;
}
