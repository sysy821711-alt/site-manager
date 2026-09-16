const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadModule(file, name, extra = {}) {
  const context = vm.createContext({ console, Set, Map, Date, ...extra });
  const source = `${fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8')}\n;globalThis.result = ${name};`;
  new vm.Script(source).runInContext(context);
  return context.result;
}

test('出勤統計會把同一天重複姓名去重', () => {
  const attendance = loadModule('attendance.js', 'Attendance');
  const result = attendance.buildStats([
    { date: '2026-09-01', personnel: ['阿明', ' 阿明 '] },
    { date: '2026-09-02', personnel: ['阿明', '阿華'] }
  ]);
  assert.equal(result[0].name, '阿明');
  assert.equal(result[0].count, 2);
});

test('已完成工地不會被判定為落後', () => {
  const gantt = loadModule('gantt.js', 'Gantt', { DB: { STATUS: { DONE: 'done' } }, window: { devicePixelRatio: 1 } });
  assert.equal(gantt.isBehindSchedule({ project: { status: 'done', plannedEnd: '2020-01-01' }, actualDates: new Set() }), false);
});
