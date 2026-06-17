import pg from 'pg';
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const cid = 'cd04b7c6-7ec3-4f59-849c-6730fc8ac9b9';

const res = await client.query(
  `select status, count(*) qtd from banco_lancamentos where cliente_id=$1 and periodo=$2 and tipo='entrada' group by status`,
  [cid, '2026-05']
);
console.log(res.rows);

const total = await client.query(
  `select count(*) qtd from banco_lancamentos where cliente_id=$1 and periodo=$2 and tipo='entrada'`,
  [cid, '2026-05']
);
console.log('total entradas:', total.rows[0]);
await client.end();
