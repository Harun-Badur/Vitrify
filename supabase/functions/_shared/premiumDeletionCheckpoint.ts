interface CheckpointRpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: any; error: unknown }>;
}
/** Durable handoff only; remote provider availability is not an Auth deletion gate. */
export async function preparePremiumDeletion(
  port: CheckpointRpc,
  request: string,
  lease: string,
  retentionPolicy: string | null,
  project: string | null = null,
  environment: string | null = null,
): Promise<void> {
  const result = await port.rpc('premium_deletion_capture', {
    p_request: request,
    p_lease: lease,
    p_retention_policy: retentionPolicy,
    p_project: project,
    p_environment: environment,
  });
  if (result.error) throw new Error('PREMIUM_CHECKPOINT_UNAVAILABLE');
  if (result.data?.state === 'blocked_policy')
    throw new Error('PREMIUM_CLEANUP_POLICY_REQUIRED');
  if (!['none', 'pending_method', 'queued', 'awaiting_verification', 'retry_required', 'review_required'].includes(result.data?.state))
    throw new Error('PREMIUM_CHECKPOINT_UNVERIFIED');
}
