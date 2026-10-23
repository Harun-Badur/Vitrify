import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAppStore } from '../store/useAppStore';
import { WARDROBE_CUTOUT_V2_ENABLED } from '../lib/wardrobeCutoutV2Gate';
import { observeWardrobeV2Hints } from '../services/wardrobeCutoutV2Realtime';
import { captureOwnerPublication } from '../lib/accountDeviceWork';

/** Mounted once at the app root: navigation never detaches foreground recovery. */
export function useWardrobeCutoutResume(enabled = true): void {
  const resume = useAppStore((state) => state.resumeWardrobeCutouts);
  const owner=useAppStore(state=>state.sessionUserId);
  const available=useAppStore(state=>state.wardrobeCutoutV2Available);
  useEffect(()=>{
    if(!enabled||!WARDROBE_CUTOUT_V2_ENABLED||!owner||!available)return;
    let stopped=false,dispose:(()=>void)|undefined;const live=captureOwnerPublication(owner);
    void import('../lib/supabase').then(({getSupabaseClient})=>{
      if(stopped||!live())return;
      const client=getSupabaseClient();if(!client)return;
      dispose=observeWardrobeV2Hints(owner,receive=>{
        const channel=client.channel('wardrobe-cutout-v2').on('postgres_changes',{event:'UPDATE',schema:'public',table:'wardrobe_cutout_jobs',filter:`owner_id=eq.${owner}`},payload=>receive(payload.new)).subscribe();
        return async()=>await client.removeChannel(channel)==='ok';
      },(id,version,job)=>useAppStore.getState().observeWardrobeCutoutV2Hint(id,version,job));
    }).catch(()=>{});
    return()=>{stopped=true;dispose?.();};
  },[enabled,owner,available]);
  useEffect(() => {
      if (!enabled) return;
      let listening = true;
      let previous = AppState.currentState;
      resume?.();
      const subscription = AppState?.addEventListener('change', (next) => {
        const returning = next === 'active' && previous !== 'active';
        previous = next;
        if (!listening || !returning) return;
        const state = useAppStore.getState();
        // One existing reconciliation on foreground when the cloud save is pending.
        // refreshWardrobe resumes eligible jobs after applying its verified result.
        if (state.wardrobeStatus === 'ready' && state.wardrobeSync?.state === 'pending')
          void state.refreshWardrobe().catch(() => {});
        else resume?.();
      });
      return () => {
        listening = false;
        subscription?.remove();
      };
    }, [enabled, resume]);
}
