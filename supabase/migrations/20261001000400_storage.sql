-- AptoCAD Finance — private storage bucket for receipts, invoices and bills.
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments_read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_member());

create policy "attachments_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.auth_role() in ('admin', 'bookkeeper', 'director'));

create policy "attachments_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (public.is_admin() or owner_id = auth.uid()::text));
