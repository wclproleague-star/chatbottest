-- What a document is, in one or two sentences.
--
-- A chunk retrieved out of a hundred-page rulebook arrives at the model with
-- no idea what it was cut out of: the same paragraph means one thing in the
-- official rules and another in a draft somebody pasted for discussion. The
-- note says which, so the answer can read the piece the way the document is
-- meant to be read. An owner may write it; otherwise it is worked out once,
-- when the document is read in, and never again.
alter table public.documents
  add column if not exists summary text;

comment on column public.documents.summary is
  'One or two sentences saying what this document is and what it covers. Shown to the model with every chunk retrieved from it.';
