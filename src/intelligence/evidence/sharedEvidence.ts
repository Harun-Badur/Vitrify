import { isGarmentCategory } from '../../../types/product';
import { STYLE_TAGS } from '../../../types/profile';
import type { ProductSignal } from '../../../types/productIntelligence';
import type { CommonProductEvidence, CommonProductEvidenceInput, CommonUserEvidenceInput, CommonUserEvidence,
  EvidenceField, EvidenceDimension, EvidenceAnalysis, EvidenceCount, UserEvidenceRecord,
  BackendProfileSnapshotEvidence, BackendProfileComparison,
  PreferenceEvidenceEvent, PreferenceActionEvidence } from '../../../types/sharedStyleEvidence';
import { buildProductIntelligence, type ProductSemanticAttributeRow } from '../product/productIntelligence';
import { buildUserSnapshot, MIN_BEHAVIOR_INTERACTIONS, MIN_DIMENSION_EVIDENCE, MIN_VALUE_EVIDENCE } from '../user/userSnapshot';
import type { WardrobeItem, SavedOutfit } from '../../../types/wardrobe';
const dimensions: readonly EvidenceDimension[] = ['category','colors','styleTags'];
const compare = (a: string,b: string) => a < b ? -1 : a > b ? 1 : 0;
const record = (value: unknown): value is Record<string,unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : null;
const unknown = (status: EvidenceField['status']): EvidenceField => ({status,values:[]});

/** Local projection of the existing service's confirmed snapshot, not an event writer.
 * Pending/conflict rows cannot prove ownership. Deletions are reflected by absence
 * in the next confirmed snapshot; no historical remove action is fabricated.
 */
export function buildWardrobeOwnershipEvidence(userId:string|null,sourceOwnerId:string|null,data:{
  wardrobeItems:readonly WardrobeItem[];savedOutfits:readonly SavedOutfit[];
  wardrobeSync?:{state:'synced'|'pending'|'conflict';pending:number};
}):CommonUserEvidence {
  const confirmed=data.wardrobeSync?.state==='synced' && data.wardrobeSync.pending===0;
  const evidence=buildUserEvidence({userId,sourceOwnerId,likes:[],passes:[],profile:null,
    owned:confirmed?data.wardrobeItems:[],outfits:confirmed?data.savedOutfits:[]});
  return !confirmed && evidence.status==='available' ? {...evidence,status:'unavailable',missing:[...evidence.missing,'wardrobe_cloud_commit_unverified']} : evidence;
}

export function buildProductEvidence(input: CommonProductEvidenceInput): CommonProductEvidence {
  const { product } = input;
  const issues: string[] = [];
  const raw = record(input.attributes) ? input.attributes : undefined;
  const invalid = input.attributes != null && (!raw || raw.product_id !== product.id);
  if (invalid) issues.push(raw ? 'metadata_identity_mismatch' : 'invalid_metadata_row');
  const metadataStatus = invalid ? 'invalid' : input.metadataStatus ?? (raw ? 'loaded' : 'absent');
  const semanticColumns = input.semanticColumns ?? 'unverified';
  if (!isGarmentCategory(product.category) || typeof product.title !== 'string' || typeof product.brand !== 'string') {
    return { version:1,productId:product.id,intelligence:null,metadataStatus,semanticColumns,
      fields:{category:unknown('invalid'),colors:unknown('unavailable'),styleTags:unknown('unsupported')},issues:['invalid_product_record',...issues] };
  }
  const allowed = !invalid && metadataStatus !== 'error' ? raw : undefined;
  for(const key of ['gender','fit','subcategory','brand_slug','price_band','outfit_role','material','season','occasion']) {
    if(allowed?.[key] != null && typeof allowed[key] !== 'string') issues.push(`invalid_${key}`);
  }
  const attributes: ProductSemanticAttributeRow | undefined = allowed ? {
    product_id:product.id, gender:text(allowed.gender), colors:allowed.colors,
    fit:text(allowed.fit),subcategory:text(allowed.subcategory),brand_slug:text(allowed.brand_slug),price_band:text(allowed.price_band),
    outfit_role:text(allowed.outfit_role), material:text(allowed.material), season:text(allowed.season), occasion:text(allowed.occasion),
    style_tags:semanticColumns === 'unavailable' ? undefined : allowed.style_tags,
  } : undefined;
  const variantsValid = product.colors === undefined || (Array.isArray(product.colors)
    && product.colors.every(color => typeof color?.name === 'string' && typeof color?.hex === 'string'));
  const intelligence = buildProductIntelligence({product:variantsValid ? product : {...product,colors:undefined},attributes});
  const colorsInvalid = !variantsValid || (allowed?.colors != null && (!Array.isArray(allowed.colors)
    || allowed.colors.some(value => typeof value !== 'string')));
  const colorConflicts = intelligence.conflicts.some(conflict => conflict.field === 'colors');
  const tags = intelligence.styleTags;
  const tagsInvalid = allowed?.style_tags != null && (!Array.isArray(allowed.style_tags)
    || allowed.style_tags.some(tag => typeof tag !== 'string' || !STYLE_TAGS.some(known => known.value === tag.trim().toLowerCase())));
  const fieldState = invalid ? 'invalid' : metadataStatus === 'error' ? 'unavailable' : null;
  if (colorsInvalid) issues.push('invalid_colors');
  if (tagsInvalid) issues.push('invalid_style_tags');
  const category: ProductSignal<string> = {value:product.category,source:'product_snapshot',origin:'declared',confidence:'unknown'};
  return {version:1,productId:product.id,intelligence,metadataStatus,semanticColumns,issues,
    fields:{ category:{status:'known',values:[category]},
      colors:fieldState ? unknown(fieldState) : colorsInvalid ? unknown('invalid') : {
        status:colorConflicts ? 'conflicted' : intelligence.colors.length ? 'known' : 'missing',values:intelligence.colors },
      styleTags:fieldState ? unknown(fieldState) : tagsInvalid ? unknown('invalid') : {
        status:tags.length ? 'known' : 'unsupported',values:tags.map(tag=>({...tag,value:tag.value?.trim().toLowerCase() ?? null})) },
    } };
}

export function buildUserEvidence(input: CommonUserEvidenceInput): CommonUserEvidence {
  const ownedSession = Boolean(input.userId && input.userId === input.sourceOwnerId);
  const profile = ownedSession && input.profile?.userId === input.userId ? input.profile : null;
  const declaredSnapshot = buildUserSnapshot({userId:input.userId,profile,likedProducts:[],passedProductIds:[],passedProducts:[]});
  const missing = new Set<string>();
  const limitations = new Set(['event_order_not_recorded','encounter_history_not_recorded','metadata_time_unverified',
    'counts_are_not_style_identity','wardrobe_semantics_unavailable']);
  const conflicts: Array<{code:string;productId:string}> = [];
  if (!profile) missing.add(input.profile && ownedSession ? 'declared_profile_owner_mismatch' : 'declared_profile_unavailable');
  const likes = ownedSession ? input.likes : [];
  const passes = ownedSession ? input.passes : [];
  const owned = ownedSession ? input.owned : [];
  const outfits = ownedSession ? input.outfits : [];
  const publicCatalog = input.catalog ?? [];
  const evidenceCopies = new Map<string,CommonProductEvidence[]>();
  const add = (entry: CommonProductEvidence) => evidenceCopies.set(entry.productId,[...(evidenceCopies.get(entry.productId) ?? []),entry]);
  [...likes,...publicCatalog].forEach(add);
  passes.forEach(pass=>{if (pass.evidence) {
    if(pass.evidence.productId === pass.productId) add(pass.evidence);
    else {missing.add('pass_metadata_identity_mismatch');conflicts.push({code:'pass_metadata_identity_mismatch',productId:pass.productId});}
  }});
  const evidence = new Map<string,CommonProductEvidence>();
  for(const [id,copies] of evidenceCopies) {
    if(new Set(copies.map(copy=>JSON.stringify(copy))).size>1) conflicts.push({code:'metadata_versions_disagree',productId:id});
    else evidence.set(id,copies[0]);
  }
  const entries = new Map<string,UserEvidenceRecord>();
  const get = (id:string,entity:UserEvidenceRecord['entity']):UserEvidenceRecord => {
    const key=`${entity}:${id}`;
    let entry=entries.get(key);
    if(!entry) {entry={productId:id,entity,liked:false,passed:false,owned:false,used:false,outfitIds:[],order:'unknown',passMetadata:'not_applicable'};entries.set(key,entry);}
    return entry;
  };
  likes.forEach(like=>{get(like.productId,'catalog').liked=true;});
  const passEvidence = new Map<string,CommonProductEvidence>();
  passes.forEach(pass=>{
    const entry=get(pass.productId,'catalog');entry.passed=true;
    if(pass.evidence?.productId===pass.productId && evidence.has(pass.productId)) {
      passEvidence.set(pass.productId,pass.evidence);entry.passMetadata='snapshot_time_unverified';
    }
  });
  const clothing = new Map<string,Set<string>>();
  owned.forEach(item=>{
    get(item.id,'wardrobe').owned=true;
    const categories=clothing.get(item.id) ?? new Set<string>();categories.add(item.category);clothing.set(item.id,categories);
  });
  for(const [id,categories] of clothing) if(categories.size>1) conflicts.push({code:'metadata_versions_disagree',productId:id});
  const outfitCopies = new Map<string,Set<string>>();
  outfits.forEach(outfit=>{
    const signature=JSON.stringify([[...new Set(outfit.wardrobeItemIds)].sort(compare),[...new Set(outfit.catalogProductIds)].sort(compare)]);
    const copies=outfitCopies.get(outfit.id) ?? new Set<string>();copies.add(signature);outfitCopies.set(outfit.id,copies);
  });
  let validOutfits=0;
  for(const [id,copies] of outfitCopies) {
    if(copies.size!==1) {missing.add('outfit_versions_disagree');continue;}
    const selected=outfits.find(outfit=>outfit.id===id)!;
    if(selected.wardrobeItemIds.some(key=>!clothing.has(key)) || selected.catalogProductIds.some(key=>!evidenceCopies.has(key))
      || selected.wardrobeItemIds.length+selected.catalogProductIds.length===0) {missing.add('outfit_reference_unresolved');continue;}
    validOutfits++;
    const use=(key:string,entity:UserEvidenceRecord['entity'])=>{const entry=get(key,entity);entry.used=true;entry.outfitIds=[...new Set([...entry.outfitIds,id])].sort(compare);};
    selected.wardrobeItemIds.forEach(key=>use(key,'wardrobe')); selected.catalogProductIds.forEach(key=>use(key,'catalog'));
  }
  const records=[...entries.values()].sort((a,b)=>compare(`${a.entity}:${a.productId}`,`${b.entity}:${b.productId}`));
  records.forEach(entry=>{
    if(entry.liked && entry.passed) conflicts.push({code:'liked_and_passed',productId:entry.productId});
    if(entry.passed) {
      const copies=passes.filter(pass=>pass.productId===entry.productId);
      if(copies.some(pass=>pass.evidence && pass.evidence.productId!==pass.productId)) {
        entry.passMetadata='identity_mismatch';passEvidence.delete(entry.productId);
      } else if(copies.some(pass=>pass.evidence) && !passEvidence.has(entry.productId)) {
        entry.passMetadata='conflicted';missing.add('pass_metadata_conflicted');
      } else if(!passEvidence.has(entry.productId)) {
        entry.passMetadata='not_recorded';missing.add('pass_metadata_not_recorded');
      }
    }
  });
  const categoryCoverage=new Set(publicCatalog.flatMap(item=>item.fields.category.values.flatMap(value=>value.value ? [value.value] : [])));
  if(categoryCoverage.size===1) limitations.add('single_category_catalog');
  if(!categoryCoverage.size) limitations.add('catalog_coverage_unknown');
  const attributedRatings=records.filter(item=>item.entity==='catalog' && !(item.liked&&item.passed)
    && ((item.liked&&evidence.has(item.productId)) || (item.passed&&passEvidence.has(item.productId)))).length;
  const summarize=(dimension:EvidenceDimension):EvidenceAnalysis=>{
    const values=new Map<string,EvidenceCount>();let missingCount=0,samples=0,documented=0,uncertain=0,reliableRatings=0;
    for(const entry of records) {
      let field:EvidenceField|undefined;
      if(entry.entity==='wardrobe') {
        const category=clothing.get(entry.productId);
        field=dimension==='category' && category?.size===1 && isGarmentCategory([...category][0])
          ? {status:'known',values:[{value:[...category][0],source:'product_snapshot',origin:'declared',confidence:'unknown'}]} : undefined;
      } else if(entry.passed && !entry.liked && !entry.used) field=passEvidence.get(entry.productId)?.fields[dimension];
      else field=evidence.get(entry.productId)?.fields[dimension];
      if(!field?.values.length) {missingCount++;continue;}
      samples++;
      // Category is a validated record label, not a claim about personal affinity.
      const itemReliable=field.status==='known' && field.values.every(value=>dimension==='category'
        || (value.origin==='declared' && (value.confidence==='high'||value.confidence==='medium')));
      if(itemReliable) documented++;else uncertain++;
      if(itemReliable && entry.entity==='catalog' && !(entry.liked&&entry.passed)
        && (entry.liked || (entry.passed&&passEvidence.has(entry.productId)))) reliableRatings++;
      for(const value of new Set(field.values.flatMap(value=>value.value ? [value.value] : []))) {
        const count=values.get(value) ?? {value,likeCount:0,passCount:0,reliableLikeCount:0,reliablePassCount:0,
          ownedCount:0,usedCount:0,ambiguousCount:0,uncertainCount:0,sources:{}};
        if(entry.liked&&entry.passed) count.ambiguousCount++;
        else {if(entry.liked)count.likeCount++;if(entry.passed&&passEvidence.has(entry.productId))count.passCount++;}
        if(itemReliable && !(entry.liked&&entry.passed)) {
          if(entry.liked)count.reliableLikeCount++;
          if(entry.passed&&passEvidence.has(entry.productId))count.reliablePassCount++;
        }
        for(const source of new Set(field.values.filter(signal=>signal.value===value).map(signal=>signal.source))) {
          count.sources[source]=(count.sources[source] ?? 0)+1;
        }
        if(entry.owned)count.ownedCount++;if(entry.used)count.usedCount++;
        if(!itemReliable)count.uncertainCount++;
        values.set(value,count);
      }
    }
    const sorted=[...values.values()].sort((a,b)=>compare(a.value,b.value));
    const observed=attributedRatings>=MIN_BEHAVIOR_INTERACTIONS && reliableRatings>=MIN_DIMENSION_EVIDENCE
      && sorted.some(value=>value.reliableLikeCount+value.reliablePassCount>=MIN_VALUE_EVIDENCE);
    return {status:dimension==='styleTags' && samples===0 ? 'unsupported' : observed ? 'observed_pattern':'insufficient_data',
      reliability:!samples?'none':documented&&uncertain?'mixed':documented?'documented':'uncertain',sampleCount:samples,missingCount,values:sorted};
  };
  return {version:1,userId:input.userId,status:!input.userId?'unavailable':ownedSession?'available':'owner_mismatch',
    declared:declaredSnapshot.declared,declaredConflicts:declaredSnapshot.conflicts,
    declaredFreshness:'unverified',records,
    counts:{liked:records.filter(item=>item.liked).length,passed:records.filter(item=>item.passed).length,
      owned:records.filter(item=>item.owned).length,used:records.filter(item=>item.used).length,outfits:validOutfits},
    dimensions:{category:summarize('category'),colors:summarize('colors'),styleTags:summarize('styleTags')},
    conflicts:conflicts.sort((a,b)=>compare(`${a.code}:${a.productId}`,`${b.code}:${b.productId}`)),
    missing:[...missing].sort(compare),limitations:[...limitations].sort(compare)};
}

export function compareBackendProfile(common:CommonUserEvidence, backend:BackendProfileSnapshotEvidence|null, minimumComputedAt?:string):BackendProfileComparison {
  const differences=['event_weights_decay_and_normalization','backend_event_history_vs_retained_unique_items',
    'backend_current_attribute_join_vs_snapshot_time_unknown','backend_has_no_owned_or_outfit_usage_dimensions',
    'backend_category_weight_not_present','style_tag_weights_not_observed_product_tags','backend_lacks_per_signal_provenance'];
  const sharedDimensions=['colors','subtype','brand','fit','priceBand','declared_style_tags'];
  let status:BackendProfileComparison['status']=backend?'available':'missing';
  let freshness:BackendProfileComparison['freshness']='unverified';
  if(backend) {
    if(!common.userId||backend.snapshot.userId!==common.userId||common.status!=='available') status='owner_mismatch';
    else if([backend.snapshot.colorW,backend.snapshot.subcategoryW,backend.snapshot.brandW,backend.snapshot.fitW,
      backend.snapshot.priceBandW,backend.snapshot.styleTagWeights].some(map=>!record(map)||Object.values(map).some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0))) status='invalid';
    if(backend.computedAt!==undefined) {
      const computed=Date.parse(backend.computedAt),cutoff=minimumComputedAt===undefined?undefined:Date.parse(minimumComputedAt);
      freshness=!Number.isFinite(computed)||(cutoff!==undefined&&!Number.isFinite(cutoff)) ? 'invalid_timestamp'
        : cutoff===undefined?'unverified':computed<cutoff?'stale':'meets_explicit_cutoff';
    }
  }
  return {status,freshness,equivalence:'not_equivalent',sharedDimensions,differences};
}

/** Analyze explicit committed action identities without modifying events or scoring.
 * Favorite's like + dolap_add remains intact but provides one preference action.
 * No time/session heuristic, fabricated commit status, or implicit ownership.
 */
export function analyzePreferenceEvents(userId: string | null, events: readonly PreferenceEvidenceEvent[]): PreferenceActionEvidence {
  const unresolved = new Set<string>();
  const groups = new Map<string, PreferenceEvidenceEvent[]>();
  const identities = new Map<string, PreferenceEvidenceEvent>();
  const invalidActions = new Set<string>();
  const failedActions = new Set<string>();
  const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort(compare);
  const signature = (event: PreferenceEvidenceEvent) => JSON.stringify([
    event.userId, event.productId, event.eventType, event.actionId, event.actionOrigin,
    event.outcome, sorted(event.revertsActionIds ?? []),
  ]);
  for (const event of events) {
    if (!userId || event.userId !== userId) continue;
    const previous = identities.get(event.eventId);
    if (previous && signature(previous) !== signature(event)) {
      if (previous.actionId) invalidActions.add(previous.actionId);
      if (event.actionId) invalidActions.add(event.actionId);
      unresolved.add(event.eventId);
    }
    identities.set(event.eventId, event);
    if (event.outcome === 'failed') {
      if (event.actionId) failedActions.add(event.actionId);
      continue;
    }
    if (!event.eventId.trim() || !event.productId.trim() || !event.actionId?.trim()
      || !event.actionOrigin || event.outcome !== 'committed') {
      unresolved.add(event.eventId);
      if (event.actionId) invalidActions.add(event.actionId);
      continue;
    }
    groups.set(event.actionId, [...(groups.get(event.actionId) ?? []), event]);
  }
  type Kind = 'positive' | 'negative' | 'owned';
  const actions = new Map<string, { productId: string; kind: Kind }>();
  const reversals: Array<{ events: PreferenceEvidenceEvent[]; kind: Kind }> = [];
  for (const [actionId, rows] of groups) {
    const first = rows[0];
    const types = new Set(rows.map(row => row.eventType));
    const consistent = !invalidActions.has(actionId) && !failedActions.has(actionId) && rows.every(row =>
      row.productId === first.productId && row.actionOrigin === first.actionOrigin
      && JSON.stringify(sorted(row.revertsActionIds ?? [])) === JSON.stringify(sorted(first.revertsActionIds ?? [])));
    let kind: Kind | undefined;
    let reversal: Kind | undefined;
    if (consistent) {
      if (first.actionOrigin === 'favorite') {
        if (types.has('like') && [...types].every(type => type === 'like' || type === 'dolap_add')) kind = 'positive';
        else if (types.size === 1 && types.has('unlike')) reversal = 'positive';
      } else if (first.actionOrigin === 'wardrobe') {
        if (types.size === 1 && types.has('dolap_add')) kind = 'owned';
        else if (types.size === 1 && types.has('dolap_remove')) reversal = 'owned';
      } else if (first.actionOrigin === 'pass') {
        if (types.size === 1 && types.has('pass')) kind = 'negative';
        else if (types.size === 1 && types.has('undo_pass')) reversal = 'negative';
      }
    }
    if (kind && !first.revertsActionIds?.length) actions.set(actionId, { productId: first.productId, kind });
    else if (reversal) reversals.push({ events: rows, kind: reversal });
    else rows.forEach(row => unresolved.add(row.eventId));
  }
  // Validate all references before applying any reversal; delivery order is irrelevant.
  const revoked = new Set<string>();
  for (const reversal of reversals) {
    const first = reversal.events[0];
    const targets = sorted(first.revertsActionIds ?? []);
    if (!targets.length || targets.some(id => {
      const target = actions.get(id);
      return !target || target.kind !== reversal.kind || target.productId !== first.productId;
    })) reversal.events.forEach(row => unresolved.add(row.eventId));
    else targets.forEach(id => revoked.add(id));
  }
  const active = [...actions].filter(([id]) => !revoked.has(id)).map(([, action]) => action);
  const positive = new Set(active.filter(action => action.kind === 'positive').map(action => action.productId));
  const negative = new Set(active.filter(action => action.kind === 'negative').map(action => action.productId));
  const ambiguous = new Set([...positive].filter(id => negative.has(id)));
  return {
    status: !userId ? 'unavailable' : unresolved.size || ambiguous.size ? 'incomplete' : 'ready',
    positiveActionCount: active.filter(action => action.kind === 'positive').length,
    negativeActionCount: active.filter(action => action.kind === 'negative').length,
    ownershipActionCount: active.filter(action => action.kind === 'owned').length,
    positiveProductIds: sorted([...positive].filter(id => !ambiguous.has(id))),
    negativeProductIds: sorted([...negative].filter(id => !ambiguous.has(id))),
    ownedProductIds: sorted(active.filter(action => action.kind === 'owned').map(action => action.productId)),
    ambiguousProductIds: sorted(ambiguous), unresolvedEventIds: sorted(unresolved),
  };
}
