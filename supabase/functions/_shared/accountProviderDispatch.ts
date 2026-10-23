export interface ProviderDispatchOperation { operation: string; lease: string; owner: string; provider: string; request: string }
export interface ProviderDispatchPort {
  admit(owner: string, provider: string, request: string): Promise<ProviderDispatchOperation>;
  start(operation: ProviderDispatchOperation): Promise<boolean>;
  observe(operation: ProviderDispatchOperation, prediction: string): Promise<void>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export async function beginProviderDispatch(port: ProviderDispatchPort, owner: string, provider: string, request: string) {
  const op = await port.admit(owner, provider, request);
  if (!op || op.owner !== owner || op.provider !== provider || op.request !== request || !uuid.test(op.operation) || !uuid.test(op.lease)) {
    throw new Error('Provider admission identity unverified');
  }
  if (await port.start(op) !== true) throw new Error('Provider dispatch denied');
  // UNKNOWN is durable before network dispatch. Expiry/abort must not settle it.
  return op;
}
export function providerDispatchRpcPort(client: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: unknown }> }): ProviderDispatchPort {
  const args = (op: ProviderDispatchOperation) => ({ p_operation: op.operation, p_lease: op.lease, p_subject: op.owner, p_provider: op.provider, p_request: op.request });
  return {
    admit: async (owner, provider, request) => {
      const value = await client.rpc('provider_dispatch_admit', { p_subject: owner, p_provider: provider, p_request: request });
      if (value.error) throw new Error('Provider admission unavailable'); return value.data;
    },
    start: async op => {
      const value = await client.rpc('provider_dispatch_start', args(op));
      if (value.error) throw new Error('Provider checkpoint unavailable'); return value.data === true;
    },
    observe: async (op, prediction) => {
      if (!prediction.trim() || prediction.length > 200) throw new Error('Provider observation invalid');
      const value = await client.rpc('provider_dispatch_observe', { ...args(op), p_prediction: prediction });
      if (value.error || value.data !== true) throw new Error('Provider observation unavailable');
      // OBSERVED is not a deletion/retention proof or a provider drain certificate.
    },
  };
}
