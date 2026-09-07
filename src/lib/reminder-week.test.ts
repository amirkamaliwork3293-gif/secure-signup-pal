import assert from "node:assert/strict";
import { saturdayOfWeek, weekDays, jalaliDayKey, isInWeek, weekStats } from "./reminder-week.ts";
import { toJalali, type Reminder } from "./store.ts";

const fridayNoon = Date.parse("2026-08-21T12:00:00+03:30");
const sat = saturdayOfWeek(fridayNoon);
const satJ = toJalali(sat);
assert.ok(satJ);
assert.equal(satJ.dow, 6, "week must start on Saturday");
assert.equal(satJ.h, 0);
assert.equal(satJ.min, 0);

const days = weekDays(fridayNoon);
assert.equal(days.length, 7);
assert.equal(days[0].dowSat, 0);
assert.equal(days[6].dowSat, 6);
assert.equal(days.filter((d) => d.isToday).length, 1);
assert.equal(days[days.findIndex((d) => d.isToday)].jd, toJalali(fridayNoon)?.jd);

assert.equal(isInWeek(fridayNoon, sat), true);
assert.equal(isInWeek(sat - 86_400_000, sat), false);

const list: Reminder[] = [
  {
    id: "a",
    title: "a",
    dueAt: fridayNoon,
    done: false,
    createdAt: 1,
  },
  {
    id: "b",
    title: "b",
    dueAt: fridayNoon,
    done: true,
    createdAt: 1,
  },
  {
    id: "c",
    title: "c",
    dueAt: sat - 86_400_000,
    done: false,
    createdAt: 1,
  },
];
const stats = weekStats(list, sat, fridayNoon);
assert.equal(stats.total, 2);
assert.equal(stats.done, 1);
assert.equal(stats.open, 1);
assert.ok(jalaliDayKey(fridayNoon).length > 0);

console.log("reminder-week tests passed");
