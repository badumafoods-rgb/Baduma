const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)});
let stateIndex=0,overrides={},root;
const R={createElement:h,useState:init=>[Object.hasOwn(overrides,stateIndex)?overrides[stateIndex++]:((stateIndex++),typeof init==='function'?init():init),()=>{}],useEffect:()=>{},useRef:v=>({current:v})};
const window={BadumaUI:{React:R,root:{render:x=>root=x},Menu:()=>null,Signature:()=>null},supabase:{createClient:()=>({})}};
const context={window,location:{pathname:'/admin/',search:'',origin:'https://baduma-ordering-preview.spiffybard257.chatgpt.site'},URLSearchParams,crypto:require('node:crypto'),setTimeout,clearTimeout,console};
vm.runInNewContext(fs.readFileSync('dist/admin-modules.js','utf8'),context);
vm.runInNewContext(fs.readFileSync('dist/realtime.js','utf8'),context);
const keys=['orders.view','orders.manage','pos.use','products.manage','promotions.manage','expenses.view','expenses.manage','cash.handover','users.manage'];
function text(node){if(node==null||node===false)return '';if(typeof node!=='object')return String(node);return node.children.map(text).join(' ');}
function render(profile,view){stateIndex=0;overrides={0:profile,1:{user:{id:'test',email:'test@example.invalid'}},2:profile.role,3:view};return root.type();}
let master=render({role:'admin',username:'masteradmin',permissions:keys},'Dashboard');
for(const label of ['Dashboard','Orders','POS','Products','Expenses','Users'])assert.ok(text(master).includes(label),'Master navigation: '+label);
let driver=render({role:'rider',username:'driver01',permissions:['delivery.use']},'Rider');assert.ok(text(driver).includes('Driver'));assert.ok(!text(driver).includes('Users'));assert.ok(!text(driver).includes('Products'));
let cashier=render({role:'cashier',username:'cashier01',permissions:['cash.handover']},'Cashier');assert.ok(!text(cashier).includes('POS'));
stateIndex=0;overrides={};let staff=window.BadumaAdmin.StaffManager({db:{},profile:{role:'admin',permissions:keys},onError:()=>{}});assert.ok(text(staff).includes('Generate account & password'));assert.ok(text(staff).includes('Permissions'));
stateIndex=0;overrides={};let product=window.BadumaAdmin.ProductManager({db:{},catalog:{products:[],categories:[{id:'kottu',name:'Kottu'}]},onSaved:()=>{},onError:()=>{}});assert.ok(text(product).includes('Add product'));assert.ok(text(product).includes('Sizes & prices'));
console.log('Passed: Master Admin modules, Driver/Cashier navigation restrictions, user permission form and product editor.');
