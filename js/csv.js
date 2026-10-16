// تصدير CSV بترميز UTF-8 مع BOM (ليظهر النص العربي صحيحًا في Excel)
// وحماية من حقن الصيغ: أي قيمة تبدأ بـ = + - @ أو Tab/CR تُسبق بعلامة ' فلا تُنفَّذ كصيغة.

const FORMULA_START = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** @param {Array<{key:string,label:string,format?:(v:any,row:any)=>any}>} columns */
export function toCsv(rows, columns) {
  const header = columns.map((c) => sanitizeCsvCell(c.label)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => sanitizeCsvCell(c.format ? c.format(row[c.key], row) : row[c.key])).join(','));
  return '﻿' + [header, ...body].join('\r\n') + '\r\n';
}
