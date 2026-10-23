/** Review-only reference model for the proposed SQL ledger. No production consumer.
 * Actions must come from an authoritative transactional ledger, never client payload.
 */
export interface CommittedStyleAction {
  owner: string; id: string; productId: string;
  kind: 'favorite' | 'pass' | 'wardrobe' | 'unlike' | 'undo_pass' | 'wardrobe_remove';
  at: string; eventIds: readonly string[]; revokes: readonly string[];
}
export interface HistoricalStyleEvent {
  owner: string; id: string; productId: string | null; type: string; at: string;
  payload: Readonly<Record<string, unknown>>;
}
export type LegacyStylePolicy = 'preserve_v1' | 'exclude_with_approval';
export function canonicalPreferenceHistory(owner: string, actions: readonly CommittedStyleAction[],
  events: readonly HistoricalStyleEvent[], policy: LegacyStylePolicy, limit: number,
  eventWeights: Readonly<Record<string,number>>) {
  if (!owner || !['preserve_v1','exclude_with_approval'].includes(policy) || !Number.isInteger(limit) || limit < 1) throw Error('INVALID_POLICY');
  const ledger = new Map<string,CommittedStyleAction>();
  const knownEvents = new Set<string>();
  const sorted = (ids: readonly string[]) => [...new Set(ids)].sort();
  for (const action of actions.filter(row=>row.owner===owner)) {
    if (!action.id || !action.productId || !Number.isFinite(Date.parse(action.at)) || !action.eventIds.length
      || new Set(action.eventIds).size!==action.eventIds.length) throw Error('INVALID_LEDGER');
    const previous=ledger.get(action.id);
    if(previous && JSON.stringify(previous)!==JSON.stringify(action)) throw Error('INVALID_LEDGER');
    if(previous) continue;
    if(action.eventIds.some(id=>knownEvents.has(id))) throw Error('INVALID_LEDGER');
    action.eventIds.forEach(id=>knownEvents.add(id)); ledger.set(action.id,action);
  }
  const revoked=new Set<string>();
  for(const action of ledger.values()) {
    const expected=action.kind==='favorite'||action.kind==='undo_pass' ? 'pass'
      :action.kind==='unlike' ? 'favorite':action.kind==='wardrobe_remove' ? 'wardrobe':null;
    if(action.revokes.length && !expected) throw Error('INVALID_LEDGER');
    for(const id of sorted(action.revokes)) {
      const target=ledger.get(id);
      if(!target||target.id===action.id||target.productId!==action.productId||target.kind!==expected) throw Error('INVALID_LEDGER');
      revoked.add(id);
    }
  }
  const source=new Map<string,HistoricalStyleEvent>();
  for(const event of events.filter(row=>row.owner===owner)) {
    if(!Number.isFinite(Date.parse(event.at))) throw Error('INVALID_EVENTS');
    const previous=source.get(event.id);
    if(previous && JSON.stringify(previous)!==JSON.stringify(event)) throw Error('INVALID_EVENTS');
    source.set(event.id,event);
  }
  // Re-sent client copies of a registered action never add another contribution.
  const legacy=[...source.values()].filter(row=>!knownEvents.has(row.id)
    && !(typeof row.payload.action_id==='string' && ledger.has(row.payload.action_id)));
  const rows:Array<HistoricalStyleEvent & {actionId:string|null;authority:'ledger'|'legacy_unverified'}>=[];
  for(const action of ledger.values()) if(!revoked.has(action.id) && ['favorite','pass'].includes(action.kind)) {
    rows.push({owner,id:action.eventIds[0],productId:action.productId,type:action.kind==='favorite'?'like':'pass',at:action.at,
      payload:{action_id:action.id},actionId:action.id,authority:'ledger'});
  }
  if(policy==='preserve_v1') rows.push(...legacy.map(row=>({...row,actionId:null,authority:'legacy_unverified' as const})));
  const eligible=rows.filter(row=>Number.isFinite(eventWeights[row.type]) && Math.abs(eventWeights[row.type])>=0.5);
  eligible.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||(a.id<b.id?1:a.id>b.id?-1:0));
  return {events:eligible.slice(0,limit),unverifiedEventCount:legacy.length,
    ownedActionIds:[...ledger.values()].filter(row=>row.kind==='wardrobe'&&!revoked.has(row.id)).map(row=>row.id).sort()};
}
