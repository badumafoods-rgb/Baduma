// Passwords and the service-role key never enter client bundles or database audit rows.
const PERMISSIONS = ['orders.view','orders.manage','pos.use','products.manage','promotions.manage','expenses.view','expenses.manage','cash.handover','users.manage','delivery.use'];
const ROLES = ['manager','rider','cashier','employee'];
const ORIGIN = 'https://baduma-ordering-preview.spiffybard257.chatgpt.site';
const headers = {'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply({error:'Use POST'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return reply({error:'Origin denied'},403);
 const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const bearer=req.headers.get('Authorization');
 if(!bearer?.startsWith('Bearer '))return reply({error:'Sign in first'},401);
 async function api(path:string,body:unknown,method='POST',actor=false){
  const response=await fetch(url+path,{method,headers:{apikey:actor?anon:service,Authorization:actor?bearer!:'Bearer '+service,'Content-Type':'application/json',Prefer:'return=representation'},...(body!==null?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.message||data?.msg||data?.error_description||'Account operation failed');
  return data;
 }
 try{
  const who=await api('/auth/v1/user',null,'GET',true);
  if(!who?.id)return reply({error:'Invalid session'},401);
  const me=await api('/rest/v1/rpc/baduma_me',{},'POST',true);
  const master=me.role==='admin';
  if(!master&&(me.role!=='manager'||!me.permissions?.includes('users.manage')))return reply({error:'User management permission required'},403);
  const body=await req.json(),op=body.operation;
  if(!['create','update','reset_password'].includes(op))return reply({error:'Unknown operation'},400);
  let existing:any=null;
  if(op!=='create'){
   if(!/^[0-9a-f-]{36}$/i.test(body.user_id)||body.user_id===who.id)return reply({error:'You cannot modify your own account here'},400);
   const rows=await api('/rest/v1/employees?user_id=eq.'+encodeURIComponent(body.user_id)+'&select=*',null,'GET',true);
   existing=rows?.[0];
   if(!existing||(!master&&(existing.created_by!==who.id||existing.role==='manager')))return reply({error:'Account is outside your management scope'},403);
  }
  const password=()=>{if(body.password){if(typeof body.password!=='string'||body.password.length<12||body.password.length>128)throw Error('Use a password with 12–128 characters');return body.password;}
   const bytes=crypto.getRandomValues(new Uint8Array(15));return 'Bd!'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')+'A7';};
  if(op==='reset_password'){
   const next=password();await api('/auth/v1/admin/users/'+existing.user_id,{password:next},'PUT');
   return reply({username:existing.username,password:next,role:existing.role});
  }
  const role=body.role,name=String(body.name||'').trim(),active=body.active!==false;
  if(!ROLES.includes(role)||(!master&&role==='manager'))return reply({error:'Only Master Admin can create or promote a Manager'},403);
  if(name.length<1||name.length>120)return reply({error:'Enter a name (1–120 characters)'},400);
  if(!Array.isArray(body.permissions)||body.permissions.some((p:unknown)=>typeof p!=='string'||!PERMISSIONS.includes(p)))return reply({error:'Invalid permissions'},400);
  const perms=[...new Set(body.permissions)] as string[];
  if(perms.includes('orders.manage')&&!perms.includes('orders.view'))perms.push('orders.view');
  if(perms.includes('expenses.manage')&&!perms.includes('expenses.view'))perms.push('expenses.view');
  if(perms.includes('users.manage')&&role!=='manager')return reply({error:'Only a Manager can receive delegated user management'},400);
  if(perms.includes('delivery.use')&&role!=='rider')return reply({error:'Delivery permission requires the Driver role'},400);
  if(!master&&perms.some(p=>!me.permissions.includes(p)&&!(p==='delivery.use'&&role==='rider'&&me.permissions.includes('orders.manage'))))return reply({error:'You cannot grant permissions you do not have'},403);
  if(op==='update'){
   await api('/rest/v1/employees?user_id=eq.'+existing.user_id,{name,role,permissions:perms,active,updated_at:new Date().toISOString()},'PATCH');
   await api('/auth/v1/admin/users/'+existing.user_id,{ban_duration:active?'none':'876000h'},'PUT');
   return reply({user_id:existing.user_id,username:existing.username,role,active});
  }
  const username=String(body.username||'').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)||['masteradmin','testcustomer'].includes(username))return reply({error:'Use a unique username with 3–40 letters, numbers, dots, underscores or hyphens'},400);
  const next=password(),email=username+'@staff.baduma.local';
  const user=await api('/auth/v1/admin/users',{email,password:next,email_confirm:true,app_metadata:{baduma_staff:true},user_metadata:{name}});
  if(!user?.id)throw Error('Account could not be created');
  try{
   await api('/rest/v1/employees',{user_id:user.id,name,email,username,role,permissions:perms,active,created_by:who.id});
   if(!active)await api('/auth/v1/admin/users/'+user.id,{ban_duration:'876000h'},'PUT');
  }catch(e){await api('/auth/v1/admin/users/'+user.id,null,'DELETE');throw e;}
  return reply({user_id:user.id,username,password:next,role,active});
 }catch(e){return reply({error:e instanceof Error?e.message:'Account operation failed'},400);}
});
