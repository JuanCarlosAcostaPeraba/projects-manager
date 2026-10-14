import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarWindow,
  taskPlacement,
  addDays,
  type PlanningTask,
} from '../src/server/gantt';
const task = (start: string | null, end: string | null): PlanningTask => ({
  id: 'test',
  title: 'Plan',
  number: 1,
  status: 'todo',
  start_date: start,
  due_date: end,
});
test('Gantt dates remain calendar dates across DST and leap days', () => {
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
});
test('Gantt clips long tasks and includes both first and last day', () => {
  assert.deepEqual(
    taskPlacement(task('2026-10-01', '2026-12-30'), '2026-10-12', 42),
    {
      offset: 0,
      width: 42,
      milestone: false,
      clippedStart: true,
      clippedEnd: true,
    },
  );
  assert.deepEqual(
    taskPlacement(task('2026-10-14', '2026-10-14'), '2026-10-12', 42),
    {
      offset: 2,
      width: 1,
      milestone: false,
      clippedStart: false,
      clippedEnd: false,
    },
  );
  assert.equal(
    taskPlacement(task('2026-01-01', '2026-01-04'), '2026-10-12', 42),
    null,
  );
});
test('deadline-only tasks are milestones and unscheduled tasks do not invent dates', () => {
  assert.equal(
    taskPlacement(task(null, '2026-10-14'), '2026-10-12', 42)?.milestone,
    true,
  );
  assert.equal(taskPlacement(task('2026-10-14', null), '2026-10-12', 42), null);
});
test('Gantt month scale handles leap years and moves exactly one year back', () => {
  const leap = calendarWindow([], 'months', '2024-01-15');
  assert.equal(leap.start, '2024-01-01');
  assert.equal(leap.end, '2024-12-31');
  assert.equal(leap.days, 366);
  assert.equal(leap.previous, '2023-01-01');
  assert.equal(leap.next, '2025-01-01');
  assert.equal(leap.ticks[1].width, 29);
});
