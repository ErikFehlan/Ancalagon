-- Preserve completed searches without deleting their candidates or hiring intelligence.
alter table public.jobs
  add column if not exists status text not null default 'active'
    check (status in ('active', 'closed')),
  add column if not exists close_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists hired_candidate_id uuid references public.candidates(id) on delete set null;

create index if not exists jobs_workspace_status_idx
  on public.jobs (workspace_id, status, updated_at desc);
