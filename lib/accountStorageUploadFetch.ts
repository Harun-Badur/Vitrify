// functions-js 2.4.1 drops body when invoke-level Content-Type is supplied.
// Carry MIME separately until the SDK has serialized binary and added auth.
export const accountStorageUploadMimeHeader = 'x-vitrify-upload-content-type';

export function accountStorageUploadFetch(supabaseUrl: string, transport: typeof fetch): typeof fetch {
  const uploadUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/account-storage-upload`;
  return (input, init) => {
    if (input === uploadUrl && init?.method === 'POST') {
      const headers = new Headers(init.headers);
      const mime = headers.get(accountStorageUploadMimeHeader);
      if (mime !== null) {
        headers.delete(accountStorageUploadMimeHeader);
        headers.set('Content-Type', mime);
        // Preserve the exact body, SDK credentials, request identity and signal.
        return transport(input, { ...init, headers });
      }
    }
    return transport(input, init);
  };
}
