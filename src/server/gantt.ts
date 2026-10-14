export interface PlanningTask {
  id: string;
  title: string;
  number: number;
  status: string;
  start_date: string | null;
  due_date: string | null;
  assignee_name?: string | null;
}
export type Zoom = 'days' | 'weeks' | 'months';
const dayMs = 86400000;
export function todayDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Atlantic/Canary',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function dayNumber(date: string) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / dayMs);
}
export function addDays(date: string, days: number) {
  return new Date((dayNumber(date) + days) * dayMs).toISOString().slice(0, 10);
}
export function calendarWindow(tasks: PlanningTask[], zoom: Zoom, at?: string) {
  const dates = tasks
    .flatMap((t) => [t.start_date, t.due_date])
    .filter((value): value is string => Boolean(value))
    .sort();
  let start =
    at ||
    dates.find((date) => date >= '1900-01-01' && date <= '2200-12-31') ||
    todayDate();
  const initial = new Date(`${start}T00:00:00Z`);
  if (zoom === 'months') start = start.slice(0, 7) + '-01';
  else start = addDays(start, -((initial.getUTCDay() + 6) % 7));
  const ticks: {
    date: string;
    label: string;
    offset: number;
    width: number;
    weekend: boolean;
  }[] = [];
  let days = zoom === 'days' ? 42 : 84;
  if (zoom === 'months') {
    const date = new Date(`${start}T00:00:00Z`);
    const end = new Date(
      Date.UTC(date.getUTCFullYear() + 1, date.getUTCMonth(), 1),
    )
      .toISOString()
      .slice(0, 10);
    days = dayNumber(end) - dayNumber(start);
    for (let i = 0; i < 12; i++) {
      const from = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + i, 1),
      )
        .toISOString()
        .slice(0, 10);
      const to = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + i + 1, 1),
      )
        .toISOString()
        .slice(0, 10);
      ticks.push({
        date: from,
        label: new Intl.DateTimeFormat('es', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${from}T00:00:00Z`)),
        offset: dayNumber(from) - dayNumber(start),
        width: dayNumber(to) - dayNumber(from),
        weekend: false,
      });
    }
  } else {
    const step = zoom === 'days' ? 1 : 7;
    for (let i = 0; i < days; i += step) {
      const date = addDays(start, i);
      ticks.push({
        date,
        label: new Intl.DateTimeFormat('es', {
          day: 'numeric',
          month: zoom === 'days' ? undefined : 'short',
          timeZone: 'UTC',
        }).format(new Date(`${date}T00:00:00Z`)),
        offset: i,
        width: step,
        weekend: i % 7 >= 5,
      });
    }
  }
  return {
    start,
    end: addDays(start, days - 1),
    days,
    ticks,
    previous:
      zoom === 'months'
        ? new Date(
            Date.UTC(
              Number(start.slice(0, 4)) - 1,
              Number(start.slice(5, 7)) - 1,
              1,
            ),
          )
            .toISOString()
            .slice(0, 10)
        : addDays(start, -days),
    next: addDays(start, days),
  };
}
export function taskPlacement(task: PlanningTask, start: string, days: number) {
  if (!task.due_date) return null;
  const end = dayNumber(task.due_date) - dayNumber(start);
  const begin = dayNumber(task.start_date || task.due_date) - dayNumber(start);
  if (end < 0 || begin >= days) return null;
  const left = Math.max(0, begin),
    right = Math.min(days - 1, end);
  return {
    offset: left,
    width: right - left + 1,
    milestone: !task.start_date,
    clippedStart: begin < 0,
    clippedEnd: end >= days,
  };
}
