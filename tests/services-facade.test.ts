import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("legacy services facade", () => {
  it("does not contain direct business SQL", async () => {
    const source = await readFile(
      new URL("../src/lib/services.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain(".query(");
    expect(source).not.toMatch(/\binsert\s+into\b/i);
    expect(source).not.toMatch(/\bdelete\s+from\b/i);
    expect(source).not.toMatch(/\bselect\b[\s\S]{0,120}\bfrom\b/i);
    expect(source).not.toMatch(/\bupdate\b[\s\S]{0,120}\bset\b/i);
  });
});
