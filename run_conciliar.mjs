import { conciliarPeriodo } from './src/lib/conciliar.ts';
const cid = 'cd04b7c6-7ec3-4f59-849c-6730fc8ac9b9';
const r = await conciliarPeriodo(cid, '2026-05');
console.log(r);
