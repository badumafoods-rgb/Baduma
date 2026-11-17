// Credentials arrive only on stdin; never print tokens/passwords or write them to disk.
const {randomUUID}=require('node:crypto');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');let input='';
console.log('Ready for verification credentials on stdin (input hidden).');
process.stdin.on('data',async chunk=>{input+=chunk;if(!input.includes('\n'))return;process.stdin.removeAllListeners('data');if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{await run(JSON.parse(input));process.exit(0);}catch(e){console.error('Verification failed:',e.message);process.exit(1);}});
async function run(credentials){
 const base='https://mduiomtaykqeenoohaee.supabase.co',key='sb_publishable_msclttzX3_M30cNy5r0zGQ_Knw99_Yb';
 async function request(path,token,body,method){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const data=await r.json().catch(()=>null);return {status:r.status,ok:r.ok,data};}
 const login=async(email,password)=>{const r=await request('/auth/v1/token?grant_type=password',null,{email,password});if(!r.ok)throw Error('Login failed for '+email+' (HTTP '+r.status+')');return r.data;};
 const admin=await login('masteradmin@baduma.local',credentials.admin),customer=await login('testcustomer@baduma.local',credentials.customer);
 const role=await request('/rest/v1/rpc/baduma_staff_role',admin.access_token,{});if(role.data!=='admin')throw Error('Master admin role failed');
 const products=await request('/rest/v1/products?select=id,name,product_variants(*)&available=eq.true&limit=1');if(!products.ok||!products.data[0]?.product_variants.length)throw Error('Public catalogue unavailable');
 const anon=await request('/rest/v1/orders?select=id');if(anon.ok&&anon.data.length)throw Error('Anonymous orders exposed');
 const product=products.data[0],variant=product.product_variants[0];
 const ws=new WebSocket(base.replace('https:','wss:')+'/realtime/v1/websocket?apikey='+key+'&vsn=1.0.0');
 const changes=[];let joinResolve,joinReject;
 const joined=new Promise((resolve,reject)=>{joinResolve=resolve;joinReject=reject;});
 const timeout=setTimeout(()=>joinReject(Error('Realtime join timeout')),15000);
 ws.onopen=()=>ws.send(JSON.stringify({topic:'realtime:baduma-check-'+randomUUID(),event:'phx_join',payload:{config:{broadcast:{self:false},presence:{key:''},postgres_changes:[{event:'*',schema:'public',table:'orders'}],private:false},access_token:admin.access_token},ref:'1'}));
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.event==='phx_reply'&&m.ref==='1'){if(m.payload.status==='ok')joinResolve();else joinReject(Error('Realtime subscription rejected'));}if(m.event==='postgres_changes')changes.push(m.payload.data);};
 ws.onerror=()=>joinReject(Error('Realtime socket failed'));
 try{
  await joined;clearTimeout(timeout);
  const requestId=randomUUID(),payload={p_details:{mode:'delivery',name:'Realtime verification TEST',phone:'0700000000',address:'Test only — no delivery required',distance:'1'},p_items:[{product_id:product.id,variant:variant.label,quantity:1,extras:[]}],p_request:requestId,p_cash:null,p_code:null};
  const order=await request('/rest/v1/rpc/baduma_place_order',customer.access_token,payload);if(!order.ok)throw Error('Order creation failed (HTTP '+order.status+'): '+order.data?.message);
  const oid=order.data;
  const retry=await request('/rest/v1/rpc/baduma_place_order',customer.access_token,payload);if(retry.data!==oid)throw Error('Duplicate submission was not idempotent');
  const forbidden=await request('/rest/v1/rpc/baduma_dispatch_order',customer.access_token,{p_id:oid,p_next:'accepted',p_rider:null});if(forbidden.ok)throw Error('Customer changed staff order status');
  const rejected=await request('/rest/v1/rpc/baduma_dispatch_order',admin.access_token,{p_id:oid,p_next:'rejected',p_rider:null});if(!rejected.ok)throw Error('Admin transition failed: '+rejected.data?.message);
  const mine=await request('/rest/v1/orders?id=eq.'+oid+'&select=id,status,subtotal_lkr',customer.access_token);if(mine.data[0]?.status!=='rejected'||mine.data[0]?.subtotal_lkr!==variant.price_lkr)throw Error('Customer status or server pricing mismatch');
  const deadline=Date.now()+12000;while(Date.now()<deadline&&!changes.some(c=>c.record?.id===oid&&c.record?.status==='rejected'))await new Promise(resolve=>setTimeout(resolve,100));
  if(!changes.some(c=>c.record?.id===oid&&c.record?.status==='rejected'))throw Error('Realtime status update was not received');
  console.log(JSON.stringify({adminLogin:true,customerLogin:true,publicCatalog:true,anonymousOrderAccessBlocked:!anon.ok||anon.data.length===0,serverPricing:true,idempotency:true,customerStaffActionBlocked:true,adminStatusChange:true,customerStatusRead:true,realtimeInsert:changes.some(c=>c.type==='INSERT'&&c.record?.id===oid),realtimeStatusUpdate:true,testOrderId:oid,testOrderStatus:'rejected'}));
 }finally{clearTimeout(timeout);ws.close();}
}
