/**
 * Copy only the fields a request actually sent.
 *
 * A validated DTO is a class instance, and under `target: ES2023` every field
 * declared on the class exists on that instance — as `undefined` when the
 * request left it out. `Object.assign(entity, dto)` therefore overwrote real
 * columns with `undefined`: a PUT that changed nothing but the doctor's
 * conclusion came back with no `eye`, no `patientName` and no `date`, and the
 * screen that rendered the reply crashed on the missing values.
 *
 * TypeORM ignores `undefined` when it saves, so the database survived it. The
 * reply did not.
 */
export function applyChanges<T extends object>(entity: T, changes: object): T {
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) (entity as Record<string, unknown>)[key] = value;
  }
  return entity;
}
