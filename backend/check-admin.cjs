const {randomUUID}=require('node:crypto');
if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');let input='';
console.log('Ready for verification credentials on stdin (input hidden).');
process.stdin.on('data',async chunk=>{input+=chunk;if(!input.includes('\n'))return;process.stdin.removeAllListeners('data');if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{await run(JSON.parse(input));process.exit(0);}catch(e){console.error('Verification failed:',e.message);process.exit(1);}});
async function run(credentials){
 const base='https://mduiomtaykqeenoohaee.supabase.co',key='sb_publishable_msclttzX3_M30cNy5r0zGQ_Knw99_Yb';
 async function request(path,token,body,method){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)};}
 const must=(r,label)=>{if(!r.ok)throw Error(label+': HTTP '+r.status+' '+(r.data?.error||r.data?.message||r.data?.msg||''));return r.data;};
 const login=async(email,password)=>must(await request('/auth/v1/token?grant_type=password',null,{email,password}),'Login '+email);
 const admin=await login('masteradmin@baduma.local',credentials.admin),customer=await login('testcustomer@baduma.local',credentials.customer);
 const staff=(token,body)=>request('/functions/v1/baduma-staff-admin',token,body);
 const denied=await staff(customer.access_token,{operation:'create',username:'forbidden',name:'Forbidden',role:'manager',permissions:[]});if(denied.ok)throw Error('Customer created staff');
 const managerPerms=['orders.view','orders.manage','pos.use','products.manage','promotions.manage','expenses.view','expenses.manage','cash.handover','users.manage'];
 const manager=must(await staff(admin.access_token,{operation:'create',username:'manager01',name:'Restaurant Manager — Tablet',role:'manager',permissions:managerPerms}),'Create Manager');
 console.log('CREATED_ACCOUNT '+JSON.stringify(manager));
 const m=await login('manager01@staff.baduma.local',manager.password);
 const self=must(await request('/rest/v1/rpc/baduma_me',m.access_token,{}),'Manager profile');if(self.role!=='manager'||!self.permissions.includes('users.manage'))throw Error('Manager profile mismatch');
 const peer=await staff(m.access_token,{operation:'create',username:'forbidden-peer',name:'Forbidden',role:'manager',permissions:[]});if(peer.ok)throw Error('Manager created another Manager');
 const driver=must(await staff(m.access_token,{operation:'create',username:'driver01',name:'Delivery Driver — Phone',role:'rider',permissions:['delivery.use']}),'Manager creates Driver');
 console.log('CREATED_ACCOUNT '+JSON.stringify(driver));
 const d=await login('driver01@staff.baduma.local',driver.password);
 const escalation=await request('/rest/v1/employees?user_id=eq.'+driver.user_id,d.access_token,{permissions:['users.manage']},'PATCH');if(escalation.ok)throw Error('Driver edited permissions directly');
 const denial=await request('/rest/v1/rpc/baduma_save_product',d.access_token,{p_id:'forbidden-product',p_name:'Forbidden',p_category:'kottu',p_prep:15,p_available:false,p_variants:[{label:'Regular',price_lkr:100}]});if(denial.ok)throw Error('Driver added product');
 const cashier=must(await staff(admin.access_token,{operation:'create',username:'cashier01',name:'Cashier — Phone',role:'cashier',permissions:['pos.use','cash.handover']}),'Create Cashier');
 console.log('CREATED_ACCOUNT '+JSON.stringify(cashier));
 const c=await login('cashier01@staff.baduma.local',cashier.password);
 const cat=must(await request('/rest/v1/categories?select=id&limit=1'),'Category')[0];
 const productId='verification-'+randomUUID().slice(0,8);
 must(await request('/rest/v1/rpc/baduma_save_product_details',m.access_token,{p_id:productId,p_name:'Verification TEST product',p_category:cat.id,p_prep:5,p_available:false,p_variants:[{label:'Test',price_lkr:1}],p_ingredients:['Test'],p_spice:'unconfirmed',p_image:null}),'Manager adds product');
 const product=must(await request('/rest/v1/products?id=eq.'+productId+'&select=*,product_variants(*)',m.access_token),'Read test product')[0];if(product.product_variants[0].price_lkr!==1)throw Error('Price not saved');
 const expense=must(await request('/rest/v1/expenses',m.access_token,{incurred_on:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Colombo'}),category:'Verification TEST',description:'Temporary permission verification — remove after test',amount_lkr:1}),'Manager adds expense')[0];
 const expenseDenied=await request('/rest/v1/expenses',c.access_token,{incurred_on:'2026-11-18',category:'Forbidden',description:'Forbidden',amount_lkr:1});if(expenseDenied.ok)throw Error('Cashier wrote expenses without permission');
 must(await staff(admin.access_token,{operation:'update',user_id:cashier.user_id,name:'Cashier — Phone',role:'cashier',permissions:['cash.handover'],active:true}),'Untick POS permission');
 const products=must(await request('/rest/v1/products?select=id,product_variants(*)&available=eq.true&limit=1'));
 const pos=await request('/rest/v1/rpc/baduma_place_order',c.access_token,{p_details:{mode:'pos'},p_items:[{product_id:products[0].id,variant:products[0].product_variants[0].label,quantity:1,extras:[]}],p_request:randomUUID(),p_cash:100000,p_code:null});if(pos.ok)throw Error('Unticked permission still permits POS');
 must(await staff(admin.access_token,{operation:'update',user_id:cashier.user_id,name:'Cashier — Phone',role:'cashier',permissions:['pos.use','cash.handover'],active:true}),'Restore cashier permissions');
 console.log('VERIFIED '+JSON.stringify({masterCreatesManager:true,managerCreatesDriver:true,managerCannotCreatePeer:true,customerCannotCreateStaff:true,driverCannotEscalate:true,driverCannotEditProducts:true,productVariantsSaved:true,expensesSaved:true,cashierCannotWriteExpenses:true,permissionRevocationImmediate:true,cleanup:{productId,expenseId:expense.id}}));
}
