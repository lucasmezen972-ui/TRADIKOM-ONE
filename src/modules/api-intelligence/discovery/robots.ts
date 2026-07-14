type RobotsRule = { path: string; allow: boolean };

export function evaluateRobots(
  content: string,
  path: string,
  userAgent = "TradikomApiScout",
) {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let current: { agents: string[]; rules: RobotsRule[] } | undefined;
  let sawRule = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!current || sawRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRule = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current || (field !== "allow" && field !== "disallow")) continue;
    sawRule = true;
    if (value) current.rules.push({ path: value, allow: field === "allow" });
  }

  const normalizedAgent = userAgent.toLowerCase();
  const matching = groups.filter((group) =>
    group.agents.some(
      (agent) => agent === "*" || normalizedAgent.includes(agent),
    ),
  );
  const specific = matching.filter((group) => !group.agents.includes("*"));
  const rules = (specific.length > 0 ? specific : matching).flatMap(
    (group) => group.rules,
  );
  const matched = rules
    .filter((rule) => path.startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length)[0];
  return matched?.allow ?? true;
}

export function listSitemapsFromRobots(content: string) {
  const locations: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]!.trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== "sitemap") continue;
    const location = line.slice(separator + 1).trim();
    if (location && !locations.includes(location)) locations.push(location);
  }
  return locations;
}
