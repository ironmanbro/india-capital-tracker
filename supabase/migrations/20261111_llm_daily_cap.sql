-- Tracks when a story was last classified by the LLM, so the ingest function can enforce a daily cap.
alter table public.events add column if not exists llm_at timestamptz;
create index if not exists events_llm_at_idx on public.events (llm_at) where llm_at is not null;
