const mockPurchase=jest.fn();
jest.mock('react-native',()=>({Platform:{OS:'ios'},Linking:{openURL:jest.fn()}}));
jest.mock('expo-constants',()=>({__esModule:true,default:{appOwnership:'standalone'}}));
jest.mock('../lib/supabase',()=>({getSupabaseClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'fixture'}},error:null})}})}));
jest.mock('react-native-purchases',()=>({__esModule:true,default:{setLogHandler:jest.fn(),isConfigured:async()=>false,configure:jest.fn(),getAppUserID:async()=> 'opaque',getCustomerInfo:async()=>({originalAppUserId:'foreign-original-owner'}),getOfferings:async()=>({current:{availablePackages:[{identifier:'pack',packageType:'MONTHLY',product:{identifier:'product',priceString:'store-fixture',subscriptionPeriod:'P1M',introPrice:null,defaultOption:null}}]}}),purchasePackage:mockPurchase}}));
it('PA1-04 refuses a known foreign store identity before starting a new native purchase',async()=>{
 const names=['EXPO_PUBLIC_PREMIUM_ENABLED','EXPO_PUBLIC_REVENUECAT_IOS_KEY','EXPO_PUBLIC_PREMIUM_TERMS_URL','EXPO_PUBLIC_PREMIUM_SUPPORT_URL','EXPO_PUBLIC_SUPABASE_URL'];
 const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));const original=global.fetch;
 try{
  process.env.EXPO_PUBLIC_PREMIUM_ENABLED='true';process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY='appl_fixture';process.env.EXPO_PUBLIC_PREMIUM_TERMS_URL='https://fixture.invalid/terms';process.env.EXPO_PUBLIC_PREMIUM_SUPPORT_URL='https://fixture.invalid/support';process.env.EXPO_PUBLIC_SUPABASE_URL='https://abcdefghijklmnopqrst.supabase.co';
  global.fetch=jest.fn(async(url:any)=>new Response(JSON.stringify(String(url).endsWith('/identity')?{appUserId:'opaque',sdkAllowed:true}:String(url).endsWith('/admit')?{admitted:true}:{tier:'free',checkedAtMs:Date.now(),quotaPolicyActive:true,vtonDailyLimit:3,vtonMinuteLimit:3,storeProducts:{app_store:['product'],play_store:[]}}),{status:200})) as any;
  const {premiumClient}=jest.requireActual('../services/revenueCatMobile') as typeof import('../services/revenueCatMobile');
  await premiumClient.setOwner('owner');expect(premiumClient.getSnapshot().packages).toHaveLength(1);
  await premiumClient.purchase('pack');expect(mockPurchase).not.toHaveBeenCalled();expect(premiumClient.getSnapshot().membership).toBeNull();
 }finally{global.fetch=original;for(const k of names){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
});
