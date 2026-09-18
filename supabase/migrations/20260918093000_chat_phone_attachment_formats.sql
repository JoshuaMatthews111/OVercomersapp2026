-- Preserve the private bucket and 50 MiB limit; accept common phone and document formats.
update storage.buckets
set allowed_mime_types = array(
  select distinct unnest(allowed_mime_types || array[
    'image/heic', 'image/heif', 'image/gif',
    'video/quicktime', 'video/x-m4v', 'video/webm',
    'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[])
)
where id = 'chat-attachments' and allowed_mime_types is not null;
