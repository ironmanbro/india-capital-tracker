create table if not exists public.fpi_flows (
  flow_date date not null, category text not null,
  gross_buy_cr numeric, gross_sell_cr numeric, net_cr numeric,
  primary key (flow_date, category)
);
alter table public.fpi_flows enable row level security;
create policy "fpi_flows are public" on public.fpi_flows for select using (true);
revoke all on table fpi_flows from anon, authenticated;
grant select on table fpi_flows to anon, authenticated;
