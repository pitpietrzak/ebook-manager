-- Enable net extension for HTTP calls from PostgreSQL triggers
create extension if not exists "http" with schema extensions;

-- Create a comment explaining this is needed for push notifications
comment on extension http is 'HTTP client for making requests from PostgreSQL functions';
