import { createClient } from 'jsr:@supabase/supabase-js@2';
import { accountStorageUploadHandler, UPLOAD_HANDLER_DEADLINE_MS } from '../_shared/accountStorageUploadHandler.ts';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
if (!url || !serviceKey || !anonKey) throw new Error('Upload configuration missing');
const optionsFor = (signal?: AbortSignal) => ({ auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init,
    signal: signal ?? AbortSignal.timeout(UPLOAD_HANDLER_DEADLINE_MS) }) } });
const options = optionsFor();
const admin = createClient(url, serviceKey, options);
Deno.serve(accountStorageUploadHandler(admin, (jwt, signal) => {
  const scoped = optionsFor(signal);
  return createClient(url, anonKey, { ...scoped, global: { ...scoped.global, headers: { Authorization: `Bearer ${jwt}` } } });
}, signal => createClient(url, serviceKey, optionsFor(signal))));
