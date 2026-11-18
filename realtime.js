/* BADUMA live application. Supabase publishable key is safe in browser code. */
(() => {
  'use strict';
  const {React:R,root,Menu,Signature}=window.BadumaUI;
  const h=R.createElement, {useState,useEffect,useRef}=R;
  if (!window.supabase) {root.render(h('p',null,'Connection library could not load. Please refresh.'));return;}
  const adminPage=location.pathname.startsWith('/admin');
  const loginEmail=value=>{const v=value.trim().toLowerCase();return ({masteradmin:'masteradmin@baduma.local',testcustomer:'testcustomer@baduma.local'}[v]||(v.includes('@')?v:v+'@staff.baduma.local'));};
  const {StaffManager,ProductManager,ExpenseManager,Dashboard,roleNames}=window.BadumaAdmin;
  const defaultView=me=>new URLSearchParams(location.search).get('open')==='Messages'&&(me.role==='admin'||me.permissions.includes('orders.manage'))?'Messages':me.role==='admin'?'Dashboard':me.permissions.includes('orders.manage')?'Orders':me.permissions.includes('delivery.use')?'Rider':me.permissions.includes('pos.use')?'POS':'Dashboard';
  const db=window.supabase.createClient('https://mduiomtaykqeenoohaee.supabase.co','sb_publishable_msclttzX3_M30cNy5r0zGQ_Knw99_Yb');
  const money=n=>'Rs. '+Number(n||0).toLocaleString('en-LK');
  const names={new:'New',accepted:'Confirmed',rejected:'Rejected',preparing:'Preparing',ready:'Ready',out_for_delivery:'Dispatched',delivered_pending_handover:'Delivered',closed:'Closed',cancelled:'Cancelled'};
  const total=o=>o.subtotal_lkr+(o.final_delivery_lkr??o.quoted_delivery_lkr??0)-(o.discount_lkr||0);
  async function ok(p){const {data,error}=await p;if(error)throw error;return data;}
  function normalizeCart(items,products){return items.map(item=>{
    const product=products.find(p=>item.name.startsWith(p.name+' · '));
    if(!product)throw Error('An item changed. Please add it to your cart again.');
    const labels=item.name.slice(product.name.length+3).split(' + '),variant=labels.shift();
    if(!product.product_variants.some(v=>v.label===variant))throw Error('Please choose a valid size.');
    return {product_id:product.id,variant,extras:labels,quantity:item.quantity};
  });}
  if(!adminPage&&window.BadumaCustomer){root.render(h(window.BadumaCustomer.App,{db}));return;}
  function App(){
    const [profile,setProfile]=useState({role:'',permissions:[]});
    const [session,setSession]=useState(null),[role,setRole]=useState(''),[view,setView]=useState('Customer');
    const [catalog,setCatalog]=useState({products:[],categories:[]}),[orders,setOrders]=useState([]),[promos,setPromos]=useState([]),[riders,setRiders]=useState([]),[locations,setLocations]=useState([]);
    const [message,setMessage]=useState(''),[connection,setConnection]=useState('Connecting…'),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
    const [email,setEmail]=useState(()=>new URLSearchParams(location.search).get('username')||''),[password,setPassword]=useState(''),[register,setRegister]=useState(false),[request,setRequest]=useState(crypto.randomUUID());
    const gps=useRef(null),lastGps=useRef(0),pending=useRef(false),generation=useRef(0);
    const authUser=useRef(null);
    const [messageTarget,setMessageTarget]=useState('');
    const can=key=>profile.role==='admin'||profile.permissions.includes(key);
    const canManage=can('orders.manage'),canCash=can('cash.handover');
    async function action(fn){if(pending.current)return;pending.current=true;setBusy(true);setMessage('');try{await fn();}catch(e){setMessage(e.message||'The action failed. Please retry.');}finally{pending.current=false;setBusy(false);}}
    async function catalogLoad(){const [products,categories,promotions]=await Promise.all([
      ok(db.from('products').select('*,product_variants(*)').order('name')),
      ok(db.from('categories').select('*').order('position')),
      ok(db.from('promotions').select('*').order('code'))
    ]);window.BadumaProductImages=Object.fromEntries(products.filter(p=>p.image_path?.startsWith('https://')).map(p=>[p.id,p.image_path]));setCatalog({products,categories});setPromos(promotions);setReady(true);}
    async function recordsLoad(user,staff){
      const gen=++generation.current;
      if(!user){setOrders([]);setLocations([]);setRiders([]);return;}
      const me=await ok(db.rpc('baduma_me'));if(gen!==generation.current)return;setProfile(me);setRole(me.role||'');if(adminPage&&!me.role)setView('Access');
      const query=db.from('orders').select('*,order_items(*),cash_settlements(*)').order('created_at',{ascending:false}).limit(200);
      const data=await ok(staff?query:query.eq('customer_id',user.id));
      if(gen!==generation.current)return;
      setOrders(data);
      setLocations(await ok(db.from('rider_locations').select('*')));
      if(me.role==='admin'||me.permissions.includes('orders.manage'))setRiders(await ok(db.rpc('baduma_active_riders')));else setRiders([]);
    }
    useEffect(()=>{
      let alive=true;
      async function update(s){if(!alive)return;setSession(s);if(authUser.current===s?.user.id)return;authUser.current=s?.user.id;setRole('');setProfile({role:'',permissions:[]});setView('Customer');setOrders([]);stopGPS();
        if(s){try{const me=await ok(db.rpc('baduma_me'));if(!alive)return;setProfile(me);setRole(me.role||'');if(adminPage)setView(me.role?defaultView(me):'Access');await recordsLoad(s.user,me.role||'');}catch(e){setMessage(e.message);}}
      }
      db.auth.getSession().then(({data,error})=>error?setMessage(error.message):update(data.session));
      const {data:{subscription}}=db.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>update(s),0);});
      catalogLoad().catch(e=>setMessage('Backend setup required: '+e.message));
      return()=>{alive=false;subscription.unsubscribe();stopGPS();};
    },[]);
    useEffect(()=>{
      let closed=false,timer;
      const refresh=()=>{clearTimeout(timer);timer=setTimeout(async()=>{if(closed)return;try{await catalogLoad();await recordsLoad(session?.user,role);}catch(e){setMessage(e.message);}},150);};
      const channel=db.channel('baduma-live-'+(session?.user.id||'catalog'));
      for(const table of ['products','product_variants','categories','orders','order_items','cash_settlements','promotions','rider_locations','employees','expenses','restaurant_settings','dining_tables'])channel.on('postgres_changes',{event:'*',schema:'public',table},refresh);
      channel.subscribe(status=>{
        if(closed)return;
        setConnection(status==='SUBSCRIBED'?'Live':status==='CHANNEL_ERROR'?'Reconnecting…':status==='TIMED_OUT'?'Connection timed out':'Connecting…');
        if(status==='SUBSCRIBED')refresh();
      });
      const onFocus=()=>refresh();window.addEventListener('focus',onFocus);window.addEventListener('online',onFocus);
      const fallback=setInterval(refresh,30000);
      return()=>{closed=true;clearInterval(fallback);clearTimeout(timer);db.removeChannel(channel);window.removeEventListener('focus',onFocus);window.removeEventListener('online',onFocus);};
    },[session?.user.id,role]);
    function stopGPS(){if(gps.current!==null){navigator.geolocation?.clearWatch(gps.current);gps.current=null;}}
    function startGPS(){if(gps.current!==null)return;if(!navigator.geolocation){setMessage('GPS is unavailable on this device.');return;}
      gps.current=navigator.geolocation.watchPosition(async({coords})=>{
        if(Date.now()-lastGps.current<5000)return;lastGps.current=Date.now();
        try{await ok(db.from('rider_locations').upsert({user_id:session.user.id,lat:coords.latitude,lng:coords.longitude,updated_at:new Date().toISOString()}));setMessage('Rider location shared.');}
        catch(e){setMessage(e.message);stopGPS();}
      },e=>{setMessage(e.message);stopGPS();},{enableHighAccuracy:true,timeout:15000});
    }
    async function place(details,items,cash=null,code=null){
      if(!session)throw Error('Sign in above before placing an order.');
      if(pending.current)throw Error('An order is already being submitted.');
      pending.current=true;setBusy(true);
      try{const id=await ok(db.rpc('baduma_place_order',{p_details:details,p_items:normalizeCart(items,catalog.products),p_request:request,p_cash:cash,p_code:code}));
        setRequest(crypto.randomUUID());setMessage('Order '+id.slice(0,8)+' saved.');await recordsLoad(session.user,role);return id;
      }finally{pending.current=false;setBusy(false);}
    }
    async function dispatch(order,next,rider=null){await ok(db.rpc('baduma_dispatch_order',{p_id:order.id,p_next:next,p_rider:rider}));await recordsLoad(session.user,role);}
    function btn(label,fn,extra={}){return h('button',{className:'bm-button',disabled:busy,onClick:()=>action(fn),...extra},label);}
    function input(name,props={}){return h('label',null,name,h('input',{name,...props}));}
    const views=adminPage?(session&&role?['Dashboard',...(role==='admin'?['Customers','Invoices','Salaries','Reports']:[]),...(can('orders.view')||canManage?['Orders']:[]),...(can('pos.use')?['POS']:[]),...(can('products.manage')?['Products']:[]),...(can('promotions.manage')?['Promotions']:[]),...(can('expenses.view')||can('expenses.manage')?['Expenses']:[]),...(can('users.manage')?['Employees']:[]),...(can('orders.manage')?['Messages']:[]),...(role==='rider'&&can('delivery.use')?['Rider']:[]),...(canCash?['Cashier']:[])]:[]):['Customer'];
    useEffect(()=>{if(adminPage&&session&&role&&!views.includes(view))setView('Dashboard');},[profile,view]);
    const shown=orders.filter(o=>view==='Customer'?o.customer_id===session?.user.id:view==='Rider'?o.rider_id===session?.user.id:view==='Cashier'?['delivered_pending_handover','closed'].includes(o.status):true);
    return h('div',{className:'bm'},
      h('header',{className:'bm-top'},h('strong',null,adminPage?'BADUMA Admin Panel':'BADUMA Customer'),h('span',{role:'status'},connection),h('nav',null,...views.map(v=>h('button',{key:v,'aria-pressed':view===v,onClick:()=>{if(view==='Rider')stopGPS();setView(v);}},v==='Rider'?'Driver':v)))),
      h('section',{className:'bm-card',style:{padding:16,margin:'16px 0'}},session?h('div',null,h('span',null,(profile.username||session.user.email)+' · '+(roleNames[role]||'Customer')),btn('Sign out',async()=>{stopGPS();await ok(db.auth.signOut());})):
        h('form',{className:'bm-checkout',onSubmit:e=>{e.preventDefault();action(async()=>{
          if(register){await ok(db.auth.signUp({email:loginEmail(email),password,options:{emailRedirectTo:location.origin}}));setMessage('Check your email to confirm your account, then sign in.');}
          else await ok(db.auth.signInWithPassword({email:loginEmail(email),password}));
        });}},h('strong',null,register?'Create customer account':(adminPage?'Staff login — Master Admin / Manager / Driver / Cashier':'Customer sign in')),
          h('label',null,'Email / Username',h('input',{type:register?'email':'text',required:true,value:email,onChange:e=>setEmail(e.target.value),autoComplete:'username'})),
          h('label',null,'Password',h('input',{type:'password',required:true,minLength:8,value:password,onChange:e=>setPassword(e.target.value),autoComplete:register?'new-password':'current-password'})),
          h('button',{className:'bm-button',disabled:busy},register?'Create account':'Sign in'),
          !adminPage&&h('button',{type:'button',className:'bm-outline',onClick:()=>setRegister(!register)},register?'Already have an account? Sign in':'New customer? Create account'))),
      session&&role&&window.BadumaAlerts&&h(window.BadumaAlerts.Panel,{db,userId:session.user.id,onOpen:async n=>{if(n.kind==='message'&&can('orders.manage')){if(n.message_id){try{const m=await ok(db.from('customer_messages').select('customer_id').eq('id',n.message_id).single());setMessageTarget(m.customer_id)}catch{}}setView('Messages')}else setView(role==='rider'?'Rider':'Orders')}}),
      message&&h('p',{role:'status',className:'bm-demo-note'},message),
      view==='Customer'&&h('section',null,...promos.filter(p=>p.active).map(p=>h('article',{key:p.code,className:'bm-card'},p.image&&h('img',{src:p.image,alt:p.title}),h('strong',null,p.title),h('p',null,(p.kind==='percent'?p.value+'% off':money(p.value)+' off')+' · POS code '+p.code)))),
      view==='Customer'&&!adminPage&&(ready?h(Menu,{products:catalog.products.filter(p=>p.available),categories:catalog.categories,preview:false,onPlace:place}):h('p',null,'Loading live menu…')),
      view==='Promotions'&&can('promotions.manage')&&h(window.BadumaOps.Promotions,{db,profile,promos,onSaved:catalogLoad,onError:setMessage}),
      adminPage&&session&&view==='Access'&&h('section',{className:'ba-card'},h('h2',null,'No staff access'),h('p',null,'This account has no active staff role. Ask Master Admin to create or activate your account.')),
      view==='Dashboard'&&h(Dashboard,{profile,orders,onNavigate:setView}),
      role==='admin'&&view==='Invoices'&&h(window.BadumaOps.Invoices,{db,profile,onError:setMessage}),
      role==='admin'&&view==='Salaries'&&h(window.BadumaOps.Payroll,{db,profile,onError:setMessage}),
      role==='admin'&&view==='Reports'&&h(window.BadumaOps.Reports,{db,profile,onError:setMessage}),
      view==='Customers'&&role==='admin'&&h(window.BadumaCustomerDirectory,{db,profile}),
      view==='Messages'&&can('orders.manage')&&h(window.BadumaCustomer.StaffMessages,{db,onError:setMessage,selectedCustomer:messageTarget}),
      ['Users','Employees'].includes(view)&&can('users.manage')&&h(window.BadumaOps.Employees,{db,profile,onError:setMessage}),
      view==='Products'&&can('products.manage')&&h(ProductManager,{db,catalog,onSaved:catalogLoad,onError:setMessage}),
      view==='Expenses'&&(can('expenses.view')||can('expenses.manage'))&&h(ExpenseManager,{db,profile,onError:setMessage}),
      view==='POS'&&h(Sale,{db,products:catalog.products.filter(p=>p.available),promos,place,onError:e=>setMessage(e.message),busy}),
      view==='Rider'&&h('section',null,btn('Share rider GPS',async()=>startGPS()),btn('Stop GPS',async()=>{stopGPS();setMessage('Location sharing stopped.');})),
      session&&h('details',null,h('summary',null,'Change password'),h('form',{className:'bm-checkout',onSubmit:e=>{e.preventDefault();const form=e.currentTarget;const next=String(new FormData(form).get('newPassword'));action(async()=>{await ok(db.auth.updateUser({password:next}));form.reset();setMessage('Password updated.');});}},h('label',null,'New password',h('input',{name:'newPassword',type:'password',minLength:12,required:true,autoComplete:'new-password'})),h('button',{className:'bm-button',disabled:busy},'Update password'))),
      ['Customer','Orders','Rider','Cashier'].includes(view)&&h('section',{'aria-label':'Live orders',className:'bm-demo-records'},h('h2',null,view==='Customer'?'Your orders':'Orders'),!shown.length&&h('p',null,session?'No orders yet.':'Sign in to see your orders.'),
        ...shown.map(o=>h('article',{key:o.id,className:'bm-card',style:{padding:16,marginBottom:16}},
          h('h3',null,'Order '+o.id.slice(0,8)+' · '+names[o.status]),h('p',null,new Date(o.created_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})),
          h('p',null,o.channel==='dine_in'?'Table '+o.details.table:o.channel==='pos'?'POS sale':o.details.address),
          h('p',null,[o.contact_name,o.contact_phone].filter(Boolean).join(' · ')),
          h('ul',null,...o.order_items.map(i=>h('li',{key:i.id},i.item_name+' · '+i.variant_label+' × '+i.quantity+' · '+money(i.unit_price_lkr*i.quantity)))),
          h('strong',null,'Total '+money(total(o))),view==='Rider'&&['accepted','preparing'].includes(o.status)&&h('p',null,'Your assigned order is being prepared. Wait for the Ready / Pick up alert.'),view==='Rider'&&o.status==='ready'&&h('p',null,'Ready for pickup. Confirm collection with the manager before dispatch.'),o.status==='delivered_pending_handover'&&h('p',null,'Cash collected · Restaurant cash receipt NOT YET marked.'),h('p',null,'Delivery '+money(o.final_delivery_lkr??o.quoted_delivery_lkr)+' · Discount '+money(o.discount_lkr)),
          canManage&&view==='Orders'&&h('div',null,
            btn('Message customer',async()=>{setMessageTarget(o.customer_id);setView('Messages')}),
            o.channel==='delivery'&&['new','accepted','preparing','ready'].includes(o.status)&&h('form',{className:'ba-card',onSubmit:e=>{e.preventDefault();const km=Number(new FormData(e.currentTarget).get('km'));action(async()=>{await ok(db.rpc('baduma_confirm_delivery_distance',{p_order:o.id,p_km:km}));await recordsLoad(session.user,role);})}},h('p',null,'Confirm road distance before marking Ready. First 1 km free; then Rs. 60/km.'),h('label',null,'Delivery distance (km)',h('input',{name:'km',type:'number',min:0,max:100,step:0.01,required:true,defaultValue:o.details.confirmed_distance_km??o.details.distance})),h('button',{className:'bm-button',disabled:busy},o.details.distance_confirmed?'Update confirmed distance':'Confirm distance & bill')),

            ...(o.status==='new'?[o.channel==='delivery'?h('form',{onSubmit:e=>{e.preventDefault();const rider=new FormData(e.currentTarget).get('rider');action(async()=>{await ok(db.rpc('baduma_begin_order',{p_order:o.id,p_rider:rider}));await recordsLoad(session.user,role);})}},h('select',{name:'rider',required:true},h('option',{value:''},'Choose driver for this order'),...riders.map(r=>h('option',{key:r.user_id,value:r.user_id},r.name))),h('button',{className:'bm-button',disabled:busy||!riders.length},'Accept & start preparing')):btn('Accept & start preparing',async()=>{await ok(db.rpc('baduma_begin_order',{p_order:o.id,p_rider:null}));await recordsLoad(session.user,role);}),btn('Reject',()=>dispatch(o,'rejected'))]:[]),
            o.status==='accepted'&&btn('Start preparing',()=>dispatch(o,'preparing')),
            o.status==='preparing'&&btn('Mark ready',()=>dispatch(o,'ready'),{disabled:busy||(o.channel==='delivery'&&!o.details.distance_confirmed)}),
            o.status==='ready'&&(o.channel==='dine_in'?btn('Complete table order',()=>dispatch(o,'closed')):h('form',{onSubmit:e=>{e.preventDefault();const rider=new FormData(e.currentTarget).get('rider');action(()=>dispatch(o,'out_for_delivery',rider));}},h('select',{name:'rider',required:true,defaultValue:o.rider_id||''},h('option',{value:''},'Choose rider'),...riders.map(r=>h('option',{value:r.user_id,key:r.user_id},r.name))),h('button',{className:'bm-button',disabled:busy||!riders.length},'Dispatch')))),
          view==='Rider'&&o.status==='out_for_delivery'&&h(Signature,{order:{subtotal:total(o),deliveryFee:0},onDeliver:(signature,cash)=>action(async()=>{await ok(db.rpc('baduma_deliver',{p_id:o.id,p_cash:cash,p_signature:signature}));await recordsLoad(session.user,role);})}),
          view==='Rider'&&o.details.location&&h('a',{className:'bm-outline',href:'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(o.details.location),target:'_blank',rel:'noreferrer'},'Delivery directions'),
          canCash&&['Cashier','Orders'].includes(view)&&o.status==='delivered_pending_handover'&&btn('Confirm cash handover '+money(total(o)),async()=>{await ok(db.rpc('baduma_handover',{p_id:o.id,p_cash:total(o)}));await recordsLoad(session.user,role);}),
          ...locations.filter(l=>l.user_id===o.rider_id&&o.status==='out_for_delivery').map(l=>h('p',{key:l.user_id},h('a',{href:'https://www.google.com/maps?q='+l.lat+','+l.lng,target:'_blank',rel:'noreferrer'},'Rider location'), ' · Updated '+new Date(l.updated_at).toLocaleTimeString())),
          o.channel==='pos'&&h('p',null,'Cash '+money(o.details.cash)+' · Change '+money(o.details.cash-total(o)))
        ))));
  }
  function Sale({db,products,promos,place,onError,busy}){
    const [receipt,setReceipt]=useState(null);
    const [cart,setCart]=useState([]),[cash,setCash]=useState(''),[code,setCode]=useState(''),[note,setNote]=useState('');
    const subtotal=cart.reduce((n,i)=>n+i.price*i.quantity,0),promo=promos.find(p=>p.code===code&&p.active),discount=promo?Math.min(subtotal,promo.kind==='percent'?Math.round(subtotal*promo.value/100):promo.value):0;
    return h('section',null,h('h2',null,'POS cash sale'),h('select',{value:'',onChange:e=>{if(!e.target.value)return;const [id,label]=JSON.parse(e.target.value),p=products.find(p=>p.id===id),v=p.product_variants.find(v=>v.label===label);setCart([...cart,{name:p.name+' · '+label,price:v.price_lkr,quantity:1}]);}},h('option',{value:''},'Add menu item'),...products.flatMap(p=>p.product_variants.map(v=>h('option',{key:p.id+v.label,value:JSON.stringify([p.id,v.label])},p.name+' · '+v.label+' · '+money(v.price_lkr))))),
      ...cart.map((i,index)=>h('p',{key:index},i.name,h('input',{'aria-label':'Quantity for '+i.name,type:'number',min:1,max:100,value:i.quantity,onChange:e=>setCart(cart.map((x,j)=>j===index?{...x,quantity:Number(e.target.value)}:x))}),h('button',{onClick:()=>setCart(cart.filter((_,j)=>j!==index))},'Remove'))),
      h('p',null,'Total '+money(subtotal-discount)),h('label',null,'Promotion',h('select',{value:code,onChange:e=>setCode(e.target.value)},h('option',{value:''},'None'),...promos.filter(p=>p.active).map(p=>h('option',{key:p.code,value:p.code},p.code)))),
      h('label',null,'Cash received',h('input',{type:'number',min:subtotal-discount,value:cash,onChange:e=>setCash(e.target.value)})),
      h('button',{className:'bm-button',disabled:busy||!cart.length||Number(cash)<subtotal-discount,onClick:async()=>{try{const id=await place({mode:'pos'},cart,Number(cash),code||null);setNote('Sale saved. Change '+money(Number(cash)-subtotal+discount));setCart([]);setCash('');setReceipt(await ok(db.from('orders').select('*,order_items(*)').eq('id',id).single()));}catch(e){onError(e);}}},'Record sale'),h('p',{role:'status'},note),receipt&&h('section',{className:'ba-receipt ba-card'},h('h2',null,'BADUMA'),h('p',null,'Malgammana, Pilimatalawa'),h('p',null,'Bill '+receipt.id.slice(0,8)),h('p',null,new Date(receipt.created_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})),...receipt.order_items.map(i=>h('p',{key:i.id},i.item_name+' · '+i.variant_label+' × '+i.quantity+' — '+money(i.unit_price_lkr*i.quantity))),h('p',null,'Discount '+money(receipt.discount_lkr)),h('strong',null,'Total '+money(total(receipt))),h('p',null,'Cash '+money(receipt.details.cash)+' · Change '+money(receipt.details.cash-total(receipt))),h('button',{className:'bm-button ba-no-print',onClick:()=>window.print()},'Print bill')));
  }
  window.BadumaLive={normalizeCart,total};
  root.render(h(App));
})();
