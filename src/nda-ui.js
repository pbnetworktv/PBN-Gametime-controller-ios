// Shared, dependency-free signing screen used by web and both applications.
export function mountNdaGate(root, {request,onAccepted,onDeclined,guardianToken='',review=false}) {
 const originalClass=root.className;
 let alive=true,busy=false,status=null,guardianMode=Boolean(guardianToken),message='';
 const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text)n.textContent=text;Object.assign(n,attrs);return n;};
 const button=(text,run)=>{const n=el('button',text,{type:'button'});n.addEventListener('click',run);return n;};
 const api=(suffix='',body)=>request('/api/game-time/player/nda'+suffix,body===undefined?{method:'GET'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 function error(e){message=e?.message||'Unable to connect. Please try again.';busy=false;render();}
 function legal(documentText){const article=el('article','',{className:'pbn-nda-document',tabIndex:0});article.setAttribute('aria-label','Complete non-disclosure agreement');for(const line of documentText.split('\n')){if(!line.trim())continue;const heading=/^(#{1,3})\s+/.exec(line);const n=el(heading?'h3':'p',line.replace(/^#{1,3}\s+/,'').replaceAll('**',''));article.append(n);}return article;}
 function render(){
  if(!alive)return;root.replaceChildren();root.className='pbn-nda';
  const style=el('style',`.pbn-nda{position:relative;min-height:100%;box-sizing:border-box;background:#080a12;color:#f4f3f8;font:16px/1.5 system-ui,sans-serif;padding:max(24px,env(safe-area-inset-top)) 18px max(32px,env(safe-area-inset-bottom));overflow:auto;isolation:isolate}.pbn-nda *{box-sizing:border-box}.pbn-nda section{max-width:780px;margin:auto}.pbn-nda h1{font-size:30px;line-height:1.15;margin:12px 0}.pbn-nda h2{font-size:21px}.pbn-nda .eyebrow{color:#d7b8ff;letter-spacing:2px;font-size:12px;font-weight:800}.pbn-nda p{margin:12px 0}.pbn-nda .muted{color:#bfc0cc}.pbn-nda article{max-height:44vh;min-height:180px;overflow:auto;background:#131623;border:1px solid #454052;border-radius:12px;padding:20px;margin:20px 0;white-space:normal;overscroll-behavior:contain}.pbn-nda article h3{font-size:17px;margin:20px 0 8px}.pbn-nda article p{font-size:14px;line-height:1.6}.pbn-nda label{display:block;margin:15px 0}.pbn-nda input:not([type=checkbox]){display:block;width:100%;padding:13px;margin-top:6px;color:white;background:#151827;border:1px solid #666079;border-radius:8px;font:inherit}.pbn-nda input[type=checkbox]{width:20px;height:20px;vertical-align:middle;margin:0 10px 3px 0;accent-color:#c194ff}.pbn-nda button,.pbn-nda a{font:inherit}.pbn-nda button{cursor:pointer;border:1px solid #9c70ce;border-radius:9px;padding:13px 17px;margin:6px 10px 6px 0;color:#fff;background:#312044;min-height:46px}.pbn-nda button[type=submit]{background:#d4b0ff;color:#160b25;font-weight:800}.pbn-nda button:disabled{opacity:.5;cursor:wait}.pbn-nda :focus-visible{outline:3px solid #e4c9ff;outline-offset:3px}.pbn-nda .notice{padding:12px;border-left:3px solid #c296ff;background:#21172f}.pbn-nda .error{color:#ffc2c2}.pbn-nda .receipt{overflow-wrap:anywhere}.pbn-nda a{color:#ddc4ff}`);
  root.append(style);const section=el('section');root.append(section);section.append(el('p','PBN • CONFIDENTIAL ACCESS',{className:'eyebrow'}),el('h1',guardianToken?'Guardian signature':'Before you enter Game Time'));
  const alert=el('p',message,{className:'error',role:'alert'});section.append(alert);
  if(!status){section.append(el('p',busy?'Loading your agreement…':'We need a connection to verify your agreement.'),button('Try again',load));if(onDeclined)section.append(button('Sign out',onDeclined));return;}
  const receipt=status.receipt;
  if(receipt){
   section.append(el('h2','Your signed agreement'),el('p',`${receipt.signerName} • ${receipt.capacity==='GUARDIAN'?'Parent / legal guardian':'Adult recipient'}`),el('p',`Signed ${new Date(receipt.signedAt).toLocaleString()} • Version ${receipt.version}`),el('p',`Account: ${receipt.accountEmail}`,{className:'receipt'}),legal(receipt.document));
   const copy=JSON.stringify(receipt,null,2);
   section.append(button('Copy signed agreement',async()=>{try{await navigator.clipboard.writeText(copy);message='Signed copy copied.';render();}catch{const area=el('textarea',null,{value:copy,readOnly:true,rows:8});section.append(area);area.focus();area.select();}}));
   if(!guardianToken)section.append(button('Continue to Game Time',()=>onAccepted(receipt)));
   else section.append(el('p','The account can now return to Game Time or Controller and select “Check signing status.”'));
   return;
  }
  section.append(el('p','Read and sign this agreement to access PBN Game Time and Game Time Controller. One signature covers both apps and the website.',{className:'muted'}));
  section.append(el('p','A breach can result in a permanent ban from PBN subscription services and legal action, as set out in the agreement.',{className:'notice'}));
  if(guardianToken)section.append(el('p',`Signing as parent or legal guardian for ${status.accountEmail}. Email confirmed by this private link: ${status.guardianEmail}.`));
  section.append(legal(status.document));
  const form=el('form');section.append(form);
  if(status.guardianRequired&&!guardianToken)guardianMode=true;
  if(guardianMode&&!guardianToken){
   form.append(el('h2','Parent or legal guardian required'),el('p','Send a private signing link to your parent or legal guardian. They must open the email, read the agreement and sign for this account.'));
   const email=el('input',null,{type:'email',required:true,autoComplete:'email',placeholder:'Parent or guardian email'}),label=el('label','Parent or guardian email');label.append(email);form.append(label);
   form.append(el('button',busy?'Sending…':'Email guardian signing link',{type:'submit',disabled:busy}));
   form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;try{await api('/guardian-invite',{email:email.value});message='Email sent. Ask your guardian to open the private signing link.';busy=false;render();}catch(e){error(e);}};
   section.append(button('Check signing status',load));
   if(!status.guardianRequired)section.append(button('I am signing as an adult',()=>{guardianMode=false;message='';render();}));
  }else{
   const name=el('input',null,{type:'text',required:true,minLength:3,maxLength:160,autoComplete:'name'}),label=el('label','Full legal name');label.append(name);form.append(label);
   const check=(text)=>{const c=el('input',null,{type:'checkbox',required:true});const l=el('label');l.append(c,document.createTextNode(text));form.append(l);return c;};
   const majority=check('I have reached the age of legal majority where I live.');
   const guardian=guardianToken?check('I am the parent or legal guardian of the user named above and have authority to sign in this capacity.'):null;
   const accepted=check(status.acknowledgement);
   form.append(el('button',busy?'Saving signature…':'Sign NDA & Continue',{type:'submit',disabled:busy}));
   form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;form.querySelector('button').disabled=true;try{const data=await api(guardianToken?'/guardian':'',{name:name.value,version:status.version,hash:status.hash,accepted:accepted.checked,majority:majority.checked,guardian:guardian?.checked??false,...(guardianToken?{token:guardianToken}:{})});status={...status,receipt:data.receipt};message='Your signature has been saved.';busy=false;render();}catch(e){if(e.code==='NDA_VERSION_CHANGED'){status=null;message=e.message;await load();}else error(e);}};
   if(!guardianToken)section.append(button('I need a parent or guardian to sign',()=>{guardianMode=true;message='';render();}));
  }
  if(onDeclined)section.append(button('Decline & sign out',onDeclined));
  const help=el('a','Account support',{href:'mailto:team@pbnetwork.tv',target:'_blank',rel:'noopener noreferrer'});section.append(help);
 }
 async function load(){busy=true;render();try{const data=await api(guardianToken?'/guardian':'',guardianToken?{action:'READ',token:guardianToken}:undefined);if(!alive)return;status=data;busy=false;if(data.receipt&&!review&&!guardianToken){onAccepted(data.receipt);return;}render();}catch(e){error(e);}}
 void load();return ()=>{alive=false;root.replaceChildren();root.className=originalClass;};
}
