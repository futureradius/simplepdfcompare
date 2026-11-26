// The setups of the two Plans, one set per Time direction (ADR 0002): switching the direction
// away and back gives the earlier setup unchanged. A Plan that is replaced by another file or
// page takes its setups in both directions with it.

import type { Axis } from "../compare/objects";

type Role = "old" | "new";

export class SetupStore<T> {
  private readonly by: Record<Axis, Partial<Record<Role, T>>> = { x: {}, y: {} };
  private readonly plans: Partial<Record<Role, number>> = {};

  get(axis: Axis, role: Role): T | undefined {
    return this.by[axis][role];
  }

  put(axis: Axis, role: Role, setup: T): void {
    this.by[axis][role] = setup;
  }

  /** Tells which Plan a role holds now; true (and its setups forgotten) if it is not the one seen last. */
  syncPlan(role: Role, planId: number): boolean {
    if (this.plans[role] === planId) return false;
    this.plans[role] = planId;
    delete this.by.x[role];
    delete this.by.y[role];
    return true;
  }
}
