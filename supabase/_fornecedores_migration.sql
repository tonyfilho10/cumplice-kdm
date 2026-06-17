-- ============================================================
-- MIGRAÇÃO: Fornecedores e Contas a Pagar
-- ============================================================

-- Cadastro de fornecedores (importado do ERP/PDF)
create table if not exists fornecedores_cadastro (
  id          uuid primary key default uuid_generate_v4(),
  cliente_id  uuid references clientes(id) on delete cascade,
  cnpj        text not null,
  codigo_erp  text,
  nome        text not null,
  created_at  timestamptz default now(),
  unique (cliente_id, cnpj)
);

-- Contas a pagar (importado do ERP/PDF)
create table if not exists contas_pagar (
  id                   uuid primary key default uuid_generate_v4(),
  cliente_id           uuid references clientes(id) on delete cascade,
  fornecedor_codigo    text not null,
  fornecedor_nome      text not null,
  documento            text not null,
  emissao              date,
  entrada              date,
  vencimento           date,
  valor_parcela        numeric not null default 0,
  valor_pago           numeric not null default 0,
  saldo                numeric generated always as (valor_parcela - valor_pago) stored,
  situacao             text default 'Aberta',   -- Aberta | Pago | Parcial
  banco_lancamento_id  uuid references banco_lancamentos(id),
  observacao           text,
  created_at           timestamptz default now()
);

-- RLS
alter table fornecedores_cadastro enable row level security;
alter table contas_pagar enable row level security;

create policy "fornecedores_cadastro_acesso" on fornecedores_cadastro
  using (cliente_id in (
    select cliente_id from usuario_clientes where usuario_id = auth.uid()
  ));

create policy "contas_pagar_acesso" on contas_pagar
  using (cliente_id in (
    select cliente_id from usuario_clientes where usuario_id = auth.uid()
  ));

-- Índices
create index if not exists idx_fornecedores_cadastro_cliente on fornecedores_cadastro(cliente_id);
create index if not exists idx_contas_pagar_cliente on contas_pagar(cliente_id);
create index if not exists idx_contas_pagar_vencimento on contas_pagar(cliente_id, vencimento);
create index if not exists idx_contas_pagar_situacao on contas_pagar(cliente_id, situacao);
