-- Applied on top of the original two-table schema, which had `service_slug` and assumed
-- every report arrived through the web form.
--
-- `service_slug` referenced a catalogue this component used to own. It no longer does —
-- the data source belongs to another component — so the column becomes free text, and a
-- `source` column records whether the agent filed the report mid-call or a human typed it.

alter table public.call_feedback
  add column if not exists source text not null default 'web';

alter table public.call_feedback
  drop constraint if exists call_feedback_source_check;

alter table public.call_feedback
  add constraint call_feedback_source_check check (source in ('voice', 'web'));

alter table public.call_feedback
  rename column service_slug to topic;
