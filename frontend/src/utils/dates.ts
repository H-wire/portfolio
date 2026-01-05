export function todayString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

export function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function shiftDate(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function startOfYearString() {
  const date = new Date();
  date.setMonth(0, 1);
  return date.toISOString().slice(0, 10);
}
