alter table public.jobs
  add column if not exists pattern_analysis jsonb;

comment on column public.jobs.pattern_analysis is
  'Latest evidence-linked Pattern Engine analysis for this job. Stored remotely with the workspace.';
