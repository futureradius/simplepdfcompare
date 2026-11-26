// The Time direction as "Öffnen" asks for it: down ("senkrecht") or to the right ("waagerecht").

export type Direction = "down" | "right";

export const DIRECTION_LABEL: Record<Direction, string> = { down: "senkrecht", right: "waagerecht" };

/** Preselected from the Old Plan's page shape: tall runs down, wide (or square) to the right. */
export const preselectedDirection = (widthMm: number, heightMm: number): Direction => (heightMm > widthMm ? "down" : "right");
