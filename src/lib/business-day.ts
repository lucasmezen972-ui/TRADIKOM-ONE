export type BusinessDayPeriod = {
  dayStartedAt: string;
  dayEndsAt: string;
};

export function getBusinessDayPeriod(
  now: Date,
  timeZone: string,
): BusinessDayPeriod {
  const local = dateParts(now, timeZone);
  const dayStartedAt = zonedDateTimeToUtc(local, timeZone).toISOString();
  const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  const dayEndsAt = zonedDateTimeToUtc(
    {
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
    },
    timeZone,
  ).toISOString();
  return { dayStartedAt, dayEndsAt };
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function zonedDateTimeToUtc(
  input: { year: number; month: number; day: number },
  timeZone: string,
) {
  const expected = Date.UTC(input.year, input.month - 1, input.day);
  let candidate = expected;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = dateTimeParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate += expected - represented;
  }
  return new Date(candidate);
}

function dateParts(value: Date, timeZone: string) {
  const parts = dateTimeParts(value, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function dateTimeParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}
