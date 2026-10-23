import { readFileSync } from 'node:fs';
import { withFashnTrial } from '../supabase/functions/_shared/fashnTrial';

const sql = () => readFileSync('supabase/proposals/fashn_test_trial.sql', 'utf8');

test('all existing accounts are excluded without requiring historical usage evidence', () => {
  expect(sql()).toMatch(/insert into public\.fashn_test_prior_users\s+select id from auth\.users\s*;/);
});

test('eligibility is derived from Auth and an immutable private server cutover, strictly after equality', () => {
  const source = sql();
  expect(source).toContain('create table public.fashn_test_policy');
  expect(source).toContain("clock_timestamp() + interval '30 minutes'");
  expect(source).toContain('u.created_at > cutoff');
  expect(source).toContain('u.created_at <= checked_at');
  expect(source).toContain('checked_at > cutoff');
  expect(source).toContain('from public.fashn_test_policy where singleton');
  expect(source).toContain('from public,anon,authenticated,service_role;');
  expect(source).not.toMatch(/p_created_at|p_activation_at|update public\.fashn_test_policy/i);
});

test('ineligible account denial never enters work, dispatch or reservation release', async () => {
  const rpc = jest.fn(async () => ({ data: { allowed: false, reason: 'trial_ineligible', state: 'ineligible' }, error: null }));
  const work = jest.fn();
  const response = await withFashnTrial({ rpc }, true, 'owner', 'request', 'hash', work);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: 'trial_ineligible', detail: 'Bu test yalnız aktivasyondan sonra oluşturulan yeni hesaplara açık.' });
  expect(work).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('fashn_trial_gate', {
    p_owner: 'owner', p_request: 'request', p_hash: 'hash', p_action: 'reserve',
  });
});
