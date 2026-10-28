-- Investors worth searching for private (unlisted) funding rounds: the most-reported typed investors.
create or replace function private_deal_investors(n int default 120)
returns table(name text) language sql stable as $$
  select investor from events
  where investor is not null and investor_type in ('pe_vc','sovereign','family_office','asset_manager','hedge_fund','pension')
  group by investor order by count(*) desc, investor limit n
$$;
grant execute on function private_deal_investors(int) to service_role;
