import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { getMigrationIds } from "../src/lib/db";

it("garde les contrôles et leur RLS identiques aux miroirs SQL et sans élargissement SECURITY DEFINER", () => {
  const runtime = readFileSync(new URL("../src/lib/db.ts", import.meta.url), "utf8");
  for (const [file, name] of [["0119_goal_watch_controls.sql", "goalWatchControlsMigrationSql"], ["0120_goal_watch_controls_rls.sql", "goalWatchControlsRlsMigrationSql"]]) {
    const mirror = readFileSync(new URL(`../src/db/migrations/${file}`, import.meta.url), "utf8");
    const start = runtime.indexOf(`const ${name} = \``) + `const ${name} = \``.length;
    expect(runtime.slice(start, runtime.indexOf("`;", start)).trim()).toBe(mirror.trim());
    expect(mirror).not.toMatch(/security\s+definer/i);
  }
  expect(getMigrationIds()).toContain("125_goal_watch_controls");
  expect(getMigrationIds(true)).toContain("126_goal_watch_controls_rls");
});
