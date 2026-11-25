const AMAP_KEY = ""; // 配置高德 Web 服务 Key 后支持在线地点搜索。
const CSV_NAME = "beijing-central-shared-rent-synthetic.csv";
const backendPage = document.documentElement.dataset.backend==='django';

const mulberry32 = (a)=>function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
function hash32(s){
  let h = 2166136261>>>0;
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619)>>>0; }
  return h>>>0;
}
function seedRng(seed){ return mulberry32(typeof seed==='string'?hash32(seed):seed); }
function parseCSV(text){
  const input = String(text).replace(/^\uFEFF/, '');
  const records = [];
  let fields = [], cell = '', quoted = false;
  function finishRecord(){
    fields.push(cell);
    if(fields.some(value=>value.trim())) records.push(fields);
    fields = [];
    cell = '';
  }

  for(let i=0; i<input.length; i++){
    const char = input[i];
    if(quoted){
      if(char==='"' && input[i+1]==='"'){
        cell += '"';
        i++;
      }else if(char==='"'){
        quoted = false;
      }else{
        cell += char;
      }
    }else if(char==='"' && cell===''){
      quoted = true;
    }else if(char===','){
      fields.push(cell);
      cell = '';
    }else if(char==='\r' || char==='\n'){
      finishRecord();
      if(char==='\r' && input[i+1]==='\n') i++;
    }else{
      cell += char;
    }
  }
  if(quoted) throw new Error('存在未闭合的引号。');
  finishRecord();
  if(!records.length) return [];
  const [header, ...rows] = records;
  const columns = header.map(value=>value.trim());
  const required = ['listing_id', 'district', 'area', 'community', 'room_type', 'layout',
    'monthly_rent_cny', 'available_from', 'available_until_exclusive', 'min_lease_days',
    'max_lease_days', 'longitude_gcj02_synthetic', 'latitude_gcj02_synthetic'];
  if(!required.every(key=>columns.includes(key)) || columns.length!==new Set(columns).size){
    throw new Error('请使用包含房源编号、租金、租期和坐标的 CSV 表头。');
  }
  return rows.map((row,index)=>{
    if(row.length!==columns.length) throw new Error(`第 ${index+2} 行的列数与表头不一致。`);
    const listing = Object.fromEntries(columns.map((name,i)=>[name,row[i]]));
    const numeric = ['monthly_rent_cny', 'min_lease_days', 'max_lease_days',
      'longitude_gcj02_synthetic', 'latitude_gcj02_synthetic'];
    if(!required.every(key=>listing[key].trim()) ||
      !numeric.every(key=>Number.isFinite(Number(listing[key]))) ||
      +listing.monthly_rent_cny<=0 || +listing.min_lease_days<0 || +listing.min_lease_days>+listing.max_lease_days ||
      Math.abs(+listing.latitude_gcj02_synthetic)>90 || Math.abs(+listing.longitude_gcj02_synthetic)>180 ||
      !(Date.parse(listing.available_from)<Date.parse(listing.available_until_exclusive))){
      throw new Error(`第 ${index+2} 行的房源字段缺失或格式有误。`);
    }
    return listing;
  });
}
const isoDate = d => new Date(d).toISOString().slice(0,10);
const median = v => v.length ? v[Math.floor(v.length/2)] : 0;
const fmt = n => (+n).toLocaleString('zh-CN');
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const HUES = ['#0d9488','#d97706','#7c3aed','#db2777','#2563eb','#65a30d','#ea580c','#0891b2'];
const OCCUP = ['后端程序员','产品经理','UI 设计师','财务','新媒体运营','算法实习生','会计','教师','销售','律师助理','护士','研究生在读','咨询分析师','运营实习生'];
const RhythmNames = ['早睡早起','正常规律','夜猫子','不规律'];
const SmokeNames = ['不吸烟','偶尔·室外为主','室内常吸'];

/* 室友画像：按 listing_id 做种子，保证刷新前后同一房源画像一致 */
function makeRoommates(rec){
  const rng = seedRng(rec.listing_id+'|profile');
  const ri = (a,b)=>a+Math.floor(rng()*(b-a+1));
  const rooms = parseInt(rec.layout,10) || 3;
  const cnt = Math.max(1, Math.min(3, rooms-1));
  const rr = rng();
  const rule = rr<0.42?'仅女生入住':(rr<0.55?'仅男生入住':'不限性别');
  const arr=[];
  for(let i=0;i<cnt;i++){
    const gender = rule==='仅女生入住'?'女':(rule==='仅男生入住'?'男':(rng()<.5?'女':'男'));
    const sr = rng();
    arr.push({
      gender,
      mbti: ['E','I'][rng()<.5?0:1]+['S','N'][rng()<.5?0:1]+['T','F'][rng()<.5?0:1]+['J','P'][rng()<.5?0:1],
      rhythm: ri(0,3),
      hasPet: rng()<0.22,
      acceptPet: rng()<0.7,
      smoke: sr<0.68?0:(sr<0.90?1:2),
      occ: OCCUP[Math.floor(rng()*OCCUP.length)],
    });
  }
  return {rule, roommates:arr};
}

/* 片区中心用于地点筛选和距离估算。 */
function buildAreas(rows){
  const areas = new Map();
  rows.forEach(row=>{
    const key = row.district+'|'+row.area;
    if(!areas.has(key)) areas.set(key, {district:row.district, area:row.area, rows:[]});
    areas.get(key).rows.push(row);
  });
  areas.forEach(area=>{
    area.lng = area.rows.reduce((sum,row)=>sum+Number(row.longitude_gcj02_synthetic),0)/area.rows.length;
    area.lat = area.rows.reduce((sum,row)=>sum+Number(row.latitude_gcj02_synthetic),0)/area.rows.length;
  });
  return [...areas.values()];
}

const FIT_FROM = '2027-03-01', FIT_TO = '2027-07-01';
const FIT_DAYS = (Date.parse(FIT_TO)-Date.parse(FIT_FROM))/86400000;
function fitMarJun(row){
  return FIT_DAYS >= +row.min_lease_days && FIT_DAYS <= +row.max_lease_days &&
    Date.parse(row.available_from)<=Date.parse(FIT_FROM) &&
    Date.parse(row.available_until_exclusive)>=Date.parse(FIT_TO) ? '符合' : '不符合';
}

let AREAS = [], LISTINGS = [], DATA_ROWS = [], SRC_LABEL = CSV_NAME;
let RAW_STORE = new Map();
const SRC_LIST = [];

function loadData(csvText, label){
  const imported = parseCSV(csvText);
  if(!imported.length) throw new Error('CSV 中没有房源。');

  const nextStore = new Map(RAW_STORE);
  imported.forEach(row=>{
    nextStore.set(row.listing_id, {...nextStore.get(row.listing_id), ...row});
  });
  RAW_STORE = nextStore;
  if(label && !SRC_LIST.includes(label)) SRC_LIST.push(label);
  const count = loadListingRows([...RAW_STORE.values()], SRC_LIST.join(' + '));
  if(window.nestReady){
    listingsReady();
    if(searchState) doSearch();
  }
  return count;
}

function loadListingRows(merged, source){
  const annotated = merged.filter(row=>row.lease_fit_mar_jun_2027);
  const agreed = annotated.filter(row=>fitMarJun(row)===row.lease_fit_mar_jun_2027).length;
  DATA_ROWS = merged.map(row=>row.lease_fit_mar_jun_2027 ? row : {...row, lease_fit_mar_jun_2027:fitMarJun(row)});
  AREAS = buildAreas(DATA_ROWS);
  LISTINGS = DATA_ROWS.map(buildListing);
  SRC_LABEL = source;

  const districtCount = new Set(LISTINGS.map(listing=>listing.district)).size;
  $('#stTotal').textContent = `${LISTINGS.length} 套房源`;
  $('#stAreas').textContent = `${districtCount} 个行政区 · ${AREAS.length} 个片区`;
  $('#srcName').textContent = SRC_LABEL;
  $('#fitCheck').textContent = annotated.length ? `实习季租期标注校验 ${agreed}/${annotated.length}。按 3 月 1 日入住、7 月 1 日退租计算。` : '';
  buildBudget(); buildPoiIndex(); buildAreaChips();
  $('#summary').textContent = `${LISTINGS.length} 套模拟房源 · ${districtCount} 个行政区 · 通勤时间为估算`;
  return LISTINGS.length;
}

function roommateProfile(row){
  const rule = ['不限性别','仅女生入住','仅男生入住'].includes(row.roommate_rule) ? row.roommate_rule : '不限性别';
  if(row.roommates_json && (backendPage || row.roommate_rule===rule)){
    let roommates;
    try { roommates = JSON.parse(row.roommates_json); } catch { /* 旧版资料用示例画像。 */ }
    const expectedGender = {'仅女生入住':'女', '仅男生入住':'男'}[rule];
    const valid = Array.isArray(roommates) && (backendPage || roommates.length) && roommates.every(person=>
      person && ['女','男'].includes(person.gender) &&
      (!expectedGender || person.gender===expectedGender) &&
      typeof person.occ==='string' && person.occ.trim() &&
      typeof person.mbti==='string' && /^[EI][SN][TF][JP]$/.test(person.mbti) &&
      Number.isInteger(person.rhythm) && person.rhythm>=0 && person.rhythm<RhythmNames.length &&
      Number.isInteger(person.smoke) && person.smoke>=0 && person.smoke<SmokeNames.length &&
      typeof person.hasPet==='boolean' && typeof person.acceptPet==='boolean');
    if(valid) return {rule, roommates};
  }
  return backendPage ? {rule, roommates:[]} : makeRoommates(row);
}

function listingMapUrl(value){
  try{
    const url = new URL(value);
    if(url.origin==='https://uri.amap.com' && url.pathname==='/marker') return url.href;
  }catch{ /* 旧版房源没有地图链接。 */ }
  return '';
}

function buildListing(r){
  const rent = +r.monthly_rent_cny;
  const svc = +r.monthly_service_fee_cny || 0;
  const util = +r.estimated_utilities_cny_month || 0;
  const pay = +r.rent_payment_months || 1;
  const depRatio = +r.deposit_cny / rent;
  const depText = depRatio>=1.5?`押${depRatio.toFixed(1)}`:(depRatio>=0.99?'押一':'押半月');
  const rooms = parseInt(r.layout,10)||3;
  const prof = roommateProfile(r);
  const maxStay = +r.max_lease_days, minStay = +r.min_lease_days;
  const tags = [];
  if(pay===1) tags.push('可月付');
  if(depRatio<0.99) tags.push('低押金');
  if(r.rental_channel==='房东直租') tags.push('房东直租');
  if(svc===0) tags.push('无服务费');
  if(r.has_elevator==='有') tags.push('电梯房');
  if(minStay<=30 && maxStay<=180) tags.push('短租友好');
  if(prof.roommates.length && prof.roommates.every(x=>x.smoke===0)) tags.push('全屋不吸烟');
  return {
    key:r.listing_id, district:r.district, area:r.area, community:r.community,
    roomType:r.room_type, layout:r.layout, rooms, roomSqm:+r.room_area_sqm, aptSqm:+r.apartment_area_sqm,
    channel:r.rental_channel||'待确认', rent, svc, util,
    deposit:+r.deposit_cny, depRatio, pay, payText:`${depText}·付${pay===1?'一':pay}`,
    minStay, maxStay, availFrom:r.available_from, availUntil:r.available_until_exclusive,
    leaseFit:r.lease_fit_mar_jun_2027, elevator:r.has_elevator==='有',
    benchmark:+r.benchmark_2024_whole_unit_cny_sqm_month,
    lng:+r.longitude_gcj02_synthetic, lat:+r.latitude_gcj02_synthetic,
    dataKind:r.data_kind||'数据集',
    addr:`${r.district}${r.area} ${r.community}`,
    locationDescription:r.location_description,
    mapUrl:listingMapUrl(r.listing_amap_url),
    rule:prof.rule, roommates:prof.roommates, tags,
  };
}
/* ============ 实习地点：本地 POI 索引 + 浏览器式联想补全（可选高德在线） ============ */
/* 坐标为 GCJ02 演示坐标（精确到园区/楼宇所在路口级别）；配置 AMAP_KEY 后由 inputtips 返回精确坐标 */

let POI_INDEX = [];
function buildPoiIndex(){
  const seen = new Set();
  POI_INDEX = POI_RAW.filter(p=>{
    if(seen.has(p[0])) return false; seen.add(p[0]); return true;
  }).map(p=>({name:p[0], lng:p[1], lat:p[2], kind:p[3], alias:(p[4]||'').toLowerCase(), mode:'poi'}));
  AREAS.forEach(a=>{
    POI_INDEX.push({name:a.district+'·'+a.area, lng:a.lng, lat:a.lat, kind:'片区', alias:a.area.toLowerCase()+'|'+a.district.toLowerCase(), mode:'area'});
  });
  return POI_INDEX.length;
}
const norm = s => String(s||'').toLowerCase().replace(/\s+/g,'');

/* 排序打分：前缀 > 别名精确 > 名称包含 > 别名包含 > 子序列 */
function scoreItem(q, it){
  if(!q) return 0;
  const nq = norm(q), name = norm(it.name), alias = it.alias.split(/[,，|]/);
  const ascii = /^[a-z0-9]+$/.test(nq);            // 纯字母/数字查询只做前缀匹配，避免 bd 命中 cbd
  if(name.startsWith(nq)) return 200;
  if(alias.some(a=>a && a===nq)) return 170;
  if(alias.some(a=>a && a.startsWith(nq))) return 150;
  if(ascii) return 0;
  if(name.includes(nq)) return 120;
  if(alias.some(a=>a && a.includes(nq))) return 90;
  if(it.kind==='片区' && nq.length>=2 && it.name.replace(/^[^·]*·/,'').includes(q)) return 80;
  let i=0; if(nq.length<3) return 0;               // 短查询不做子序列，避免误命中
  for(const ch of name){ if(ch===nq[i]) i++; if(i===nq.length) return 40; }
  return 0;
}
function suggest(q, limit=9){
  if(!q || !q.trim()) return [];
  return POI_INDEX.map(it=>({it, s:scoreItem(q, it)}))
    .filter(x=>x.s>0)
    .sort((a,b)=>b.s-a.s || a.it.name.length-b.it.name.length)
    .slice(0, limit)
    .map(x=>x.it);
}
function hl(name, q){
  const nq = norm(q);
  const idx = norm(name).indexOf(nq);
  if(idx<0 || !nq) return escapeHtml(name);
  return escapeHtml(name.slice(0,idx)) + '<mark>' + escapeHtml(name.slice(idx, idx+nq.length)) + '</mark>' + escapeHtml(name.slice(idx+nq.length));
}
const escapeHtml = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

let pendingAnchor = null, lastAnchor = null;

function anchorFromPOI(it, rawText){
  return {
    name: it.name, lng: it.lng, lat: it.lat, mode: it.mode, kind: it.kind,
    note: it.mode==='area' ? '片区级估算' : (rawText && norm(rawText)!==norm(it.name) ? '联想选定' : '精确定位'),
    raw: rawText||'',
  };
}
/* 未命中索引时的离线兜底：从自由文本里抠出已知地标/片区词；只抠到行政区名则降级为行政区级估算 */
function districtCentroid(d){
  const as = AREAS.filter(a=>a.district===d);
  if(!as.length) return null;
  return {name:'行政区·'+d, lng:as.reduce((s,a)=>s+a.lng,0)/as.length, lat:as.reduce((s,a)=>s+a.lat,0)/as.length,
          mode:'area', kind:'行政区', note:'行政区级估算（仅凭文本中的行政区名定位）'};
}
function resolveFreeText(text){
  const nq = norm(text);
  if(!nq) return null;
  const dis = [...new Set(AREAS.map(a=>a.district))];
  let best=null, hitDistrict=null;
  POI_INDEX.forEach(it=>{
    const keys=[norm(it.name)].concat(it.alias.split(/[,，|]/).filter(Boolean).map(norm));
    keys.forEach(k=>{
      if(k.length>=2 && nq.includes(k)){
        if(dis.some(d=>norm(d)===k) && !hitDistrict) hitDistrict = dis.find(d=>norm(d)===k);
        const s = k.length*10 + (it.mode==='poi'?5:0);
        if(!best || s>best.s) best = {it, s, k};
      }
    });
  });
  if(best && norm(best.k)!==norm(hitDistrict||'')) return {...anchorFromPOI(best.it, text), note:'按文本中的「'+best.k+'」定位'};
  if(hitDistrict) return districtCentroid(hitDistrict);
  return null;
}
async function amapLocate(text, signal){
  if(!AMAP_KEY) return null;
  try{
    const tips = await fetch(`https://restapi.amap.com/v3/assistant/inputtips?key=${AMAP_KEY}&city=北京&citylimit=true&keywords=${encodeURIComponent(text)}`, {signal}).then(r=>r.json());
    const t = (tips&&tips.status==='1'&&tips.tips||[]).find(x=>x.location);
    if(t){ const [lng,lat]=t.location.split(',').map(Number); return {name:t.name, lng, lat, mode:'amap', kind:'在线定位', note:'高德 inputtips'}; }
    const geo = await fetch(`https://restapi.amap.com/v3/geocode/geo?key=${AMAP_KEY}&city=北京&address=${encodeURIComponent(text)}`, {signal}).then(r=>r.json());
    const g = (geo&&geo.status==='1'&&geo.geocodes||[])[0];
    if(g){ const [lng,lat]=g.location.split(',').map(Number); return {name:g.formatted_address||text, lng, lat, mode:'amap', kind:'门牌号', note:'高德地理编码'}; }
  }catch(e){ if(!signal?.aborted) console.warn('高德在线定位失败，回落离线兜底', e); }
  return null;
}
async function resolveAnchor(){
  if(pendingAnchor) return pendingAnchor;
  if(!$('#pInput').classList.contains('on')) return null;
  const text = $('#poiText').value.trim();
  if(!text) return null;
  const top = suggest(text,1)[0];
  if(top && scoreItem(text, top) >= 90) return anchorFromPOI(top, text);
  const online = await amapLocate(text);
  if(online) return online;
  return resolveFreeText(text);
}

/* 区域 chips */
function buildAreaChips(){
  const dis = [...new Set(AREAS.map(a=>a.district))];
  const dWrap = $('#districtChips'); dWrap.innerHTML='';
  dis.forEach((d,i)=>{
    const b=document.createElement('button'); b.className='chip'+(i===0?' on':''); b.dataset.d=d; b.textContent=d;
    b.onclick=()=>{ $$('#districtChips .chip').forEach(x=>x.classList.remove('on')); b.classList.add('on'); renderAreaChips(d); };
    dWrap.appendChild(b);
  });
  renderAreaChips(dis[0]);
  const wrap = $('#poiChips'); wrap.innerHTML='';
  HOT_LAND.forEach((nm,i)=>{
    const it = POI_INDEX.find(p=>p.name===nm);
    if(!it){ console.warn('热门地标索引缺失：', nm); return; }
    const b=document.createElement('button'); b.className='chip'; b.dataset.n=nm;
    const sep = nm.indexOf('·');
    b.textContent = sep>0 ? `${nm.slice(0,sep)}（${nm.slice(sep+1)}）` : nm;
    b.title = nm;
    b.onclick=()=>{ $$('#poiChips .chip').forEach(x=>x.classList.remove('on')); b.classList.add('on');
      pendingAnchor = anchorFromPOI(it); showLock(pendingAnchor); };
    wrap.appendChild(b);
  });
}
/* 演示用热门实习地标（名称需与 POI_RAW 完全一致） */
const HOT_LAND = ['字节跳动·北三环园区','百度·上地十街总部','腾讯北京·后厂村路','美团·望京园区','京东集团总部·亦庄',
  '国贸·中信大厦（中国尊）','金融街·工商银行总行','丽泽SOHO','普华永道·东二环国贸','北京协和医院·东单',
  '清华大学','奥林匹克公园·国家会议中心','古城·首钢园','通州运河商务区'];
function renderAreaChips(d){
  const wrap=$('#areaChips'); wrap.innerHTML='';
  AREAS.filter(a=>a.district===d).forEach((a,i)=>{
    const b=document.createElement('button'); b.className='chip'; b.textContent=a.area;
    b.onclick=()=>{ $$('#areaChips .chip').forEach(x=>x.classList.remove('on')); b.classList.add('on');
      pendingAnchor = anchorFromPOI({name:a.district+'·'+a.area,lng:a.lng,lat:a.lat,kind:'片区',mode:'area',alias:''}); showLock(pendingAnchor); };
    wrap.appendChild(b);
  });
}
function hidePoiList(){
  $('#sugList').classList.remove('on');
  $('#poiText').setAttribute('aria-expanded','false');
  $('#poiText').removeAttribute('aria-activedescendant');
}
function showLock(a){
  lastAnchor = a;
  $('#poiText').value=a.name;
  $('#lockedLoc').style.display='flex';
  $('#lockText').innerHTML = `已选 <b>${escapeHtml(a.name)}</b>` +
    (a.mode==='area' ? '<span class="lock-note">片区级估算</span>' : '');
  $('#searchFeedback').textContent = '';
  hidePoiList();
}
/* ============ 通勤模型（距离近似；配 AMAP_KEY 后可换路径规划预计算） ============ */
function hav(la1,lo1,la2,lo2){
  const R=6371, toR=Math.PI/180;
  const dLa=(la2-la1)*toR, dLo=(lo2-lo1)*toR;
  const x=Math.sin(dLa/2)**2 + Math.cos(la1*toR)*Math.cos(la2*toR)*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function commute(l, poi){
  const d = hav(l.lat, l.lng, poi.lat, poi.lng);
  const walkMin = Math.round(d*12);                 // 5km/h
  const bikeMin = Math.round(3 + d*4.6);            // ~13km/h + 取车
  const metroMin = Math.round(12 + d*2.2);          // 门到门≈进出站换乘 + 行车
  const taxiMin = Math.round(6 + d*60/26);          // 含 6 分钟等车
  const fare = d<=6?3:Math.min(9, 3+Math.ceil((d-6)/10));
  return {
    d,
    walk:{min:walkMin, ok:d<=1.5, month:0},
    bike:{min:bikeMin, ok:d>1.5 && d<=5, month:33},
    metro:{min:metroMin, ok:metroMin<=30, month:fare*44},
    taxi:{min:taxiMin, ok:taxiMin<=25 && d>1.5, cost:Math.round(13 + Math.max(0,d-3)*2.6), month:Math.round((13+Math.max(0,d-3)*2.6)*4)},
  };
}

/* ============ 匹配算法（硬性过滤 + 五维软性打分） ============ */
const RM_M = [[1,.65,.3,.5],[.65,1,.7,.8],[.3,.7,1,.65],[.5,.8,.65,1]];   // 作息 4×4
const SMOKE_M = [[1,.45,.05],[1,.85,.45],[.85,1,.75]];                     // 吸烟 用户3态 × 室友3态
const W = {rhythm:.32, mbti:.20, smoke:.18, pet:.16, gender:.14};          // 权重和 = 1.00
let Q = null; // {gender, mbti:'ESTJ', pet:'has|accept|reject', rhythm:0-3, smoke:0-2}

function matchEval(l){
  if(!Q) return null;
  const hard = [];
  if(Q.gender){
    if(l.rule==='仅女生入住' && Q.gender!=='女') hard.push('该房源仅限女生入住');
    if(l.rule==='仅男生入住' && Q.gender!=='男') hard.push('该房源仅限男生入住');
  }
  l.roommates.forEach((r,idx)=>{
    if(Q.pet==='has' && !r.acceptPet) hard.push(`室友${idx+1}（${r.mbti}）不接受宠物`);
    if(Q.pet==='reject' && r.hasPet) hard.push(`室友${idx+1}养宠物`);
  });
  if(hard.length) return {pass:false, hard};

  const n = l.roommates.length;
  if(!n) return null;
  let rhythm=0, mbti=0, smoke=0, petS=0;
  l.roommates.forEach(r=>{
    rhythm += RM_M[Q.rhythm][r.rhythm];
    let s=0; for(let i=0;i<4;i++) if(Q.mbti[i]===r.mbti[i]) s++;
    mbti += s/4;
    smoke += SMOKE_M[Q.smoke===undefined?0:Q.smoke][r.smoke];
    const anyPet = r.hasPet;
    petS += (Q.pet==='accept' && anyPet) ? .8 : 1;
  });
  rhythm/=n; mbti/=n; smoke/=n; petS/=n;
  const anyPet = l.roommates.some(r=>r.hasPet);
  const pet = (Q.pet==='accept' && anyPet) ? .8 : 1;
  const gender = l.roommates.every(r=>Q.gender===r.gender) ? 1 : .7;
  const parts = {rhythm, mbti, smoke, pet, gender};
  const score = Math.round(100*(W.rhythm*rhythm + W.mbti*mbti + W.smoke*smoke + W.pet*pet + W.gender*gender));

  const chips=[], warn=[];
  if(rhythm>=.9) chips.push('作息高度重合'); else if(rhythm>=.7) chips.push('作息基本同步'); else chips.push('作息有差异');
  if(mbti>=.75) chips.push(`MBTI 契合 ${Math.round(mbti*100)}%`);
  else if(mbti>=.5) chips.push(`MBTI 互补型（${Math.round(mbti*100)}%同频）`);
  const smoker = l.roommates.filter(r=>r.smoke>0);
  const heavy = l.roommates.filter(r=>r.smoke===2);
  if(Q.smoke===0){
    if(!smoker.length) chips.push('室友均不吸烟');
    else if(heavy.length) warn.push(`有 ${heavy.length} 位室友室内吸烟`);
    else chips.push('室友仅室外/偶尔吸烟');
  } else if(Q.smoke===1){
    if(heavy.length) warn.push('室内常吸室友 · 需约定');
    else if(!smoker.length) chips.push('室友不吸烟');
    else chips.push('吸烟频率可接受');
  } else {
    if(!smoker.length) chips.push('你是唯一吸烟者 · 需约定室外');
    else chips.push('有吸烟室友，可协商');
  }
  if(Q.pet==='accept' && anyPet) chips.push('有宠物室友 · 你能接受');
  if(Q.pet==='has') chips.push('全员接受带宠入住');
  if(gender===1 && Q.gender) chips.push(l.rule==='不限性别'?'室友与你同性别':'同性别房源');
  return {pass:true, score, chips, warn, parts};
}

const RULE_HTML = `
<table class="rule-tbl">
  <tr><th>维度</th><th>类型</th><th>权重</th><th>取值规则</th></tr>
  <tr><td>作息时间</td><td>软性</td><td class="n">${(W.rhythm*100).toFixed(0)}%</td><td>4×4 相容矩阵（早睡/规律/夜猫/不规律），对角=1.0，「早睡早起 × 夜猫子」=0.30</td></tr>
  <tr><td>MBTI</td><td>软性</td><td class="n">${(W.mbti*100).toFixed(0)}%</td><td>EI/SN/TF/JP 四维逐位比对，相同位数 ÷ 4</td></tr>
  <tr><td>吸烟</td><td>软性（本轮新增）</td><td class="n">${(W.smoke*100).toFixed(0)}%</td><td>3×3 矩阵：不接受吸烟者 × 室内常吸 = 0.05；× 偶尔室外 = 0.45；吸烟者 × 不吸烟室友 = 0.85</td></tr>
  <tr><td>宠物</td><td>硬性 + 软性</td><td class="n">${(W.pet*100).toFixed(0)}%</td><td>带宠入住被拒 / 不接受宠物却有养宠室友 → 直接过滤；「接受宠物」但房内确有宠物 → 0.80</td></tr>
  <tr><td>性别构成</td><td>硬性 + 软性</td><td class="n">${(W.gender*100).toFixed(0)}%</td><td>房源限同性别不符 → 过滤；全员与你同性别 = 1.0，混合 = 0.70</td></tr>
</table>
<p style="margin-top:7px;font-size:11.5px">匹配分 = 100 × Σ(权重 × 该维度对全部室友的平均相容度)。权重为经验初值，正式版按「入住后 30 天换房率 / 室友投诉」回归调参；吸烟维度按「参考条件」处理，不做一票否决，但室内常吸会显著拉低分数并在卡片上给出红色提醒。</p>`;

/* ============ 筛选与渲染 ============ */
let searchState = null; // {poi, buckets:{walk:[],bike:[],metro:[],taxi:[]}, days, ...}
let curTab = 'walk', showingExcluded = false;
let searchVersion = 0;
const TAB_NAME = {walk:'步行',bike:'骑行',metro:'地铁',taxi:'打车'};

async function doSearch({useDraft = false} = {}){
  const version = ++searchVersion;
  const feedback = $('#searchFeedback');
  feedback.textContent = '';
  // Background refreshes use the submitted criteria even while a new draft is being edited.
  const applied = useDraft ? null : searchState;
  const poi = applied?.poi || await resolveAnchor();
  if(version!==searchVersion) return;
  if(!poi || isNaN(poi.lat)){
    feedback.textContent = '请先输入实习地点，或选择地标、片区。';
    return;
  }
  const din = applied?.din || new Date($('#dIn').value), dout = applied?.dout || new Date($('#dOut').value);
  if(!(din<dout)){
    feedback.textContent = '退租日期需要晚于入住日期。';
    $('#dOut').focus();
    return;
  }
  const days = Math.round((dout-din)/86400000);
  const bmin=applied?.bmin ?? +$('#budMin').value, bmax=applied?.bmax ?? +$('#budMax').value;
  if(bmin>bmax){
    feedback.textContent = '月租上限需要大于或等于下限。';
    $('#budMax').focus();
    return;
  }

  let serverIds = null, budCut=0, dateCut=0, fitCut=0;
  if(backendPage){
    feedback.textContent = '正在查询共享房源。';
    try{
      const response = await window.housingBackend.search({
        min_rent:bmin, max_rent:bmax, check_in:isoDate(din), check_out:isoDate(dout)
      });
      if(version!==searchVersion) return;
      feedback.textContent = '';
      serverIds = new Set(response.listings.map(row=>row.listing_id));
      const updated = new Map(LISTINGS.map(listing=>[listing.key, listing]));
      response.listings.forEach(row=>updated.set(row.listing_id, buildListing(row)));
      LISTINGS = [...updated.values()];
      budCut = response.counts?.budget_excluded ?? 0;
      dateCut = response.counts?.lease_excluded ?? 0;
    }catch(error){
      if(version===searchVersion) feedback.textContent = error.message;
      return;
    }
  }

  const buckets={walk:[],bike:[],metro:[],taxi:[]};
  LISTINGS.forEach((l,iid)=>{
    if(serverIds && !serverIds.has(l.key)) return;
    const cm = commute(l, poi); l._cm = cm;
    if(!serverIds && (l.rent<bmin || l.rent>bmax)){ budCut++; return; }
    if(!serverIds && (days<l.minStay || days>l.maxStay || new Date(l.availFrom)>din || new Date(l.availUntil)<dout)){ dateCut++; return; }
    if(l.leaseFit==='不符合'){ fitCut++; }
    const base = {l, cm, iid, months:(days/30.44), days};
    if(cm.walk.ok) buckets.walk.push({...base});
    if(cm.bike.ok) buckets.bike.push({...base});
    if(cm.metro.ok) buckets.metro.push({...base});
    if(cm.taxi.ok) buckets.taxi.push({...base});
  });
  const filtered = new Map();
  Object.keys(buckets).forEach(k=>{
    buckets[k].forEach(b=>{
      const m = matchEval(b.l);
      b.match = m;
      if(m && !m.pass) filtered.set(b.l.key, b);
    });
    buckets[k] = buckets[k].filter(b=>!b.match || b.match.pass);
    buckets[k].forEach(b=>{
      b.monthCommute = k==='walk'?0 : k==='bike'?b.cm.bike.month : k==='metro'?b.cm.metro.month : b.cm.taxi.month;
      b.hold = b.l.rent + b.l.svc + b.l.util;                    // 房租 + 服务费 + 水电网（数据集真实字段）
      b.total = b.hold + b.monthCommute;                          // 排序键：月总成本
    });
    buckets[k].sort((a,b)=>(b.match?.score ?? 0)-(a.match?.score ?? 0) || a.total-b.total);
  });
  searchState = {poi, buckets, days, bmin, bmax, din, dout, budCut, dateCut, fitCut,
                 filtered: [...filtered.values()],
                 pool: serverIds ? serverIds.size : LISTINGS.length - budCut - dateCut};
  searchState.nearest = AREAS.reduce((best, area)=>{
    const distance = hav(area.lat, area.lng, poi.lat, poi.lng);
    return !best || distance<best.d ? {a:area, d:distance} : best;
  }, null);
  showingExcluded = false;
  if(!window.nestModeChosen)curTab = ['walk','bike','metro','taxi'].find(k=>buckets[k].length) || 'walk';
  $('#summary').textContent = `${poi.name} · ${days} 天 · 月租 ¥${fmt(bmin)}–${fmt(bmax)} · 模拟房源`;
  if(Q) $('#qState').textContent = '已应用室友偏好，结果显示匹配分。';
  $('#filterReport').innerHTML = `<li>预算与租期均符合 ${searchState.pool} 套</li>
    <li>超出预算 ${budCut} 套</li><li>租期不符 ${dateCut} 套</li>` +
    (fitCut ? `<li>另有 ${fitCut} 套符合所选租期，但未覆盖预设实习季。</li>` : '') +
    (Q ? `<li>室友条件不符 ${filtered.size} 套 ${filtered.size ? '<button type="button" id="seeCut" class="text-btn">查看原因</button>' : ''}</li>` : '');
  $('#seeCut')?.addEventListener('click', ()=>{
    showingExcluded = true;
    if(currentPage()==='map') navigate('results');
    setResultView('list');
    render();
    $('#returnToResults').focus();
  });
  render();
  return true;
}
/* ============ 卡片与列表 ============ */
const TAB_RANGE = {walk:'≤ 1.5 公里', bike:'1.5–5 公里', metro:'≤ 30 分钟', taxi:'≤ 25 分钟'};

function cardHTML(result,mode){return homeCard(result.l,result,mode);}
function setResultView(view){
  $('#resultsLayout').dataset.view = view;
  const toggle = $('#btnMapView');
  toggle.textContent = view==='map' ? '查看列表' : '查看地图';
  toggle.setAttribute('aria-pressed', String(view==='map'));
}

function render(){
  if(!searchState) return;
  const {buckets, filtered, nearest, poi} = searchState;
  const results = buckets[curTab];
  $('#resultsLayout').dataset.searched = 'true';
  $('#mapBox').hidden = false;
  $('#tabs').hidden = false;
  $('#resultMeta').hidden = false;
  $$('#tabs .tab').forEach(tab=>{
    const selected = tab.dataset.k===curTab;
    tab.classList.toggle('on', selected);
    tab.setAttribute('aria-pressed', String(selected));
    tab.querySelector('.t-count').textContent = `${buckets[tab.dataset.k].length} 套`;
  });
  $('#resultCount').textContent = showingExcluded
    ? `室友条件不符 · ${filtered.length} 套`
    : `${TAB_NAME[curTab]} ${TAB_RANGE[curTab]} · ${Q?'合拍度优先':'月总成本优先'}`;
  const outOfCoverage = nearest && nearest.d>9 && Object.values(buckets).every(group=>!group.length);
  const bar = $('#excludedBar');
  bar.innerHTML = showingExcluded
    ? '<button type="button" id="returnToResults" class="text-btn">返回符合条件的房源</button>'
    : outOfCoverage
      ? `<div class="coverage-note">现有样本距实习地点较远。最近覆盖片区为
         ${escapeHtml(nearest.a.district)} · ${escapeHtml(nearest.a.area)}，直线约 ${nearest.d.toFixed(1)} 公里。
         <button type="button" id="openDataTools" class="text-btn">${backendPage?'查看数据说明':'导入更多房源'}</button></div>`
      : '';
  $('#returnToResults')?.addEventListener('click', ()=>{
    showingExcluded = false;
    render();
    $('#seeCut')?.focus();
  });
  $('#openDataTools')?.addEventListener('click', ()=>{
    const tools = $('#dataTools');
    tools.open = true;
    tools.querySelector('summary').focus();
    tools.scrollIntoView({block:'start'});
  });
  const items = showingExcluded ? filtered : results;
  const shown = items.slice(0, showingExcluded ? 40 : 60);
  $('#list').innerHTML = shown.length
    ? shown.map(result=>cardHTML(result, curTab)).join('') +
      (items.length>shown.length ? `<p class="list-end">显示前 ${shown.length} 套，共 ${items.length} 套。</p>` : '')
    : outOfCoverage
      ? `<div class="empty"><h3>当前样本未覆盖「${escapeHtml(poi.name)}」附近</h3><p>${backendPage?'可以换一个地点，或请管理员补充该片区。':'可以换一个地点或导入该区域的数据。'}</p></div>`
      : `<div class="empty"><h3>当前方式下没有符合条件的房源</h3><p>换一种通勤方式，或调整预算和租期。</p></div>`;
  $$('#list [data-d]').forEach(button=>{
    button.addEventListener('click',()=>openDetail(+button.dataset.d));
  });
  syncHearts();
  window.housingBackend?.renderRouteControl();
  renderMap();
}

/* ============ 地图 ============ */
function renderMap(){
  const page=currentPage();
  if(!['results','map'].includes(page) || !searchState || $('#results').hidden) return;
  const poi=searchState.poi;
  const items=[...searchState.buckets[curTab]];
  const chosen=LISTINGS.find(listing=>listing.key===tripListingKey);
  if(chosen&&!items.some(result=>result.l.key===chosen.key)){
    if(page==='map'){
      const cm=commute(chosen,poi);
      items.push({l:chosen,cm,iid:LISTINGS.indexOf(chosen),total:chosen.rent+chosen.svc+chosen.util+cm[curTab].month});
    }else tripListingKey=null;
  }
  if(releaseMap) releaseMap();
  releaseMap=window.drawNestMap($('#map'),{
    poi,items,mode:curTab,chosenKey:tripListingKey,overview:page==='results',
    onSelect:key=>{tripListingKey=key;syncMapSelection()},
    onOpen:index=>openDetail(index)
  });
  syncMapSelection();
  $('#mapNote').textContent=searchState.buckets[curTab].length+' 套符合条件的房源 · 月总成本含通勤估算';
}
let curListing=null, tplDirty=false;
function fillDetail(iid, toTpl){
  const l = LISTINGS[iid];
  if(!l) return;
  curListing = l;

  const cm = searchState ? commute(l, searchState.poi) : null;
  const m = matchEval(l);
  const days = searchState?.days ?? FIT_DAYS;
  const months = days/30.44;
  const commuteMonth = cm ? cm[curTab].month : 0;
  const hold = l.rent + l.svc + l.util;
  const firstPay = Math.round(l.deposit + l.rent*l.pay);
  const mapLink = l.mapUrl ? `<br><a class="location-link" href="${escapeHtml(l.mapUrl)}" target="_blank" rel="noopener noreferrer">在高德地图查看</a>` : '';
  const time = value=>`<time datetime="${escapeHtml(value)}">${escapeHtml(value)}</time>`;
  const infoRow = (label, value)=>`<tr><th scope="row">${label}</th><td>${value}</td></tr>`;

  $('#dtTitle').textContent = `${l.roomType} · ${l.community}`;
  $('#dtPills').textContent = `${l.district} · ${l.area} · ${l.layout} · 房间约 ${l.roomSqm}㎡`;
  const coverBadges=nestCardBadges(l);
  $('#detailCover').innerHTML=nestCoverSVG(l)+'<div class="cover-note"><b>'+escapeHtml(coverBadges.artLong)+'</b><i>'+escapeHtml('户型构成 · '+l.layout)+'</i></div><span class="cover-wm">示意图 · 非实拍</span>';
  $('#dtRent').textContent = `¥${fmt(l.rent)}`;
  $('#dtTotal').textContent = `¥${fmt(hold+commuteMonth)}`;
  $('#dtTotalContext').textContent = searchState ? `含${TAB_NAME[curTab]}通勤` : '房租及费用';
  $('#dtFirst').textContent = `¥${fmt(firstPay)}`;

  $('#dtInfo').innerHTML = [
    ['位置', escapeHtml(l.locationDescription||l.addr) + mapLink],
    ['每月费用', `租金 ¥${fmt(l.rent)} · 服务费 ¥${fmt(l.svc)} · 水电网预估 ¥${fmt(l.util)}。小计 <b>¥${fmt(hold)}</b>。`],
    ['押金与付款', `${escapeHtml(l.payText)} · 押金 ¥${fmt(l.deposit)}`],
    ['本次租期', `${days} 天，约 ${months.toFixed(1)} 个月。租金合计约 <b>¥${fmt(Math.round(l.rent*months))}</b>。另计押金和日常费用。`],
    ['可入住窗口', `${time(l.availFrom)} 至 ${time(l.availUntil)} <span class="keep-together">（最晚退租日）</span><br>最短 ${l.minStay} 天，最长 ${l.maxStay} 天。<b>${l.leaseFit==='符合'?'可覆盖':'无法完整覆盖'}</b> 3–6 月实习季。`],
    ['房间与户型', `${escapeHtml(l.roomType)}约 ${l.roomSqm}㎡ · ${escapeHtml(l.layout)} · 整套 ${l.aptSqm}㎡ · ${l.elevator?'有电梯':'无电梯'}`],
    ['出租方', `${escapeHtml(l.channel)}${l.svc>0?' · 合同需注明服务内容':''}`],
    ['房源特点', l.tags.map(escapeHtml).join(' · ') || '暂无补充'],
  ].map(([label, value])=>infoRow(label, value)).join('');

  $('#dtSourceInfo').innerHTML = [
    ['片区价格参考', `2024 年整租基准 ¥${l.benchmark.toFixed(2)}/㎡·月${l.benchmark>0?` · 房间约 ¥${(l.rent/l.roomSqm).toFixed(0)}/㎡·月`:''}`],
    ['数据编号', `<code>${escapeHtml(l.key)}</code> · ${escapeHtml(l.dataKind)}`],
  ].map(([label, value])=>infoRow(label, value)).join('');

  $('#dtCommuteHint').textContent = searchState ? `至${searchState.poi.name}` : '';
  const routed = searchState?.buckets[curTab].find(result=>result.l.key===l.key)?.amapMinutes;
  $('#dtCommuteInfo').innerHTML = cm ? [
    ['步行', `约 ${cm.walk.min} 分钟 · 直线 ${cm.d.toFixed(1)} 公里`],
    ['骑行', `约 ${cm.bike.min} 分钟`],
    ['地铁', `门到门约 ${cm.metro.min} 分钟 · 约 ¥${fmt(cm.metro.month)}/月`],
    ['打车', `单程约 ${cm.taxi.min} 分钟 · 约 ¥${fmt(cm.taxi.cost)}/程`],
    ['所选方式', `${TAB_NAME[curTab]} · 通勤费用约 ¥${fmt(commuteMonth)}/月`],
    ...(routed===undefined ? [] : [['高德路线', `约 ${routed} 分钟 · ${curTab==='metro'?'地铁优先，可能含公交':curTab==='taxi'?'驾车时间，不含等车':'按规划路线估算'}`]]),
  ].map(([label, value])=>infoRow(label, value)).join('') : infoRow('通勤', '选择实习地点后可查看通勤估算。');

  $('#dtRoommateCount').textContent = l.roommates.length ? `${l.roommates.length} 位 · ${l.rule}` : '暂无室友资料';
  $('#dtRms').innerHTML = l.roommates.map((r,i)=>`<div class="rm-row">
    <span class="ava" style="background:${HUES[(hash32(l.key)+i)%HUES.length]}">${escapeHtml(r.gender)}</span>
    <div><b>${escapeHtml(r.occ)}</b> · ${escapeHtml(r.mbti)}
      <span class="roommate-habits">${RhythmNames[r.rhythm]} · ${SmokeNames[r.smoke]} · ${r.hasPet?'养宠物':'未养宠物'} · ${r.acceptPet?'接受带宠室友':'不接受带宠室友'}</span>
    </div>
  </div>`).join('') + `<p class="detail-note">入住规则 ${escapeHtml(l.rule)} · ${l.rooms} 室合租 · 出租房间为${escapeHtml(l.roomType)}</p>`;

  $('#dtMatchSec').hidden = !m;
  if(m){
    $('#dtMatchHint').textContent = m.pass ? `${m.score} / 100 分` : '有条件不符';
    $('#dtMatch').innerHTML = m.pass
      ? `<div class="chips-reason">${m.chips.map(c=>`<span class="pill hl">${escapeHtml(c)}</span>`).join('')}${(m.warn||[]).map(w=>`<span class="pill warn">${escapeHtml(w)}</span>`).join('')}</div>
         <table class="rule-tbl"><tr><th>维度</th><th>权重</th><th>得分率</th><th>贡献分</th></tr>` +
         [['作息',W.rhythm,m.parts.rhythm],['MBTI',W.mbti,m.parts.mbti],['吸烟',W.smoke,m.parts.smoke],['宠物',W.pet,m.parts.pet],['性别',W.gender,m.parts.gender]]
           .map(([n,w,p])=>`<tr><td>${n}</td><td class="n">${(w*100).toFixed(0)}%</td><td class="n">${(p*100).toFixed(0)}%</td><td class="n">${(100*w*p).toFixed(1)}</td></tr>`).join('') +
         `<tr><td><b>合计</b></td><td class="n">100%</td><td>—</td><td class="n"><b>${m.score}</b></td></tr></table>`
      : `<ul class="check">${m.hard.map(h=>`<li><span class="no">✕</span>${escapeHtml(h)}</li>`).join('')}</ul>`;
  }

  const checklist = [
    [l.channel==='房东直租', l.channel==='房东直租' ? '房东直租时，核对身份证与房产证上的姓名。' : `${l.channel}需核实房东本人及委托或转租授权。`],
    [l.channel!=='公寓运营方'||l.svc===0, l.svc>0?`月服务费 ¥${fmt(l.svc)}，核对合同列明的服务内容。`:'当前费用单中的服务费为 ¥0，签约时确认。'],
    [l.pay===1, l.pay===1 ? '按月支付，确认付款日期。' : `一次预付 ${l.pay} 个月，首期约 ¥${fmt(firstPay)}，确认退租条款。`],
    [l.depRatio<=1, l.depRatio<=1 ? '押金在一个月房租以内，确认退还条件。' : `押金 ¥${fmt(l.deposit)}，高于一个月房租。`],
    [days>=l.minStay && days<=l.maxStay, `本次需要 ${days} 天，房源接受 ${l.minStay}–${l.maxStay} 天。`],
    [new Date(l.availFrom)<=new Date($('#dIn').value), `核对可入住日 ${l.availFrom} 与你的入住日期。`],
    [true, '交接时记录水、电、燃气表读数并拍照。'],
    [l.roommates.length && l.roommates.every(r=>r.smoke===0),
      !l.roommates.length ? '请确认目前的合租安排和室友习惯。'
        : l.roommates.every(r=>r.smoke===0) ? '现有室友均不吸烟。' : '与吸烟室友商定吸烟区域，并写入协议。'],
  ];
  $('#dtCheck').innerHTML = checklist.map(([ok,text])=>`<li><span class="${ok?'ok':'no'}">${ok?'✓':'✕'}</span>${escapeHtml(text)}</li>`).join('')
    + '<li class="detail-note">看房前核验证件和出租权，确认后再付款。</li>';

  $('#dtTpl').innerHTML = tplHTML(l, days);
  $('#dtTpl').scrollTop = 0;
  tplDirty=false;
  $('#tplState').textContent='未修改';

  $$('#detailPanels > details').forEach(panel=>{ panel.open = panel.id === (toTpl ? 'dtAgreement' : 'dtOverview'); });
  drawRoomExtras(l, commuteMonth);
  $('#maskDetail').scrollTop = 0;

  if(toTpl) requestAnimationFrame(()=>$('#dtTpl').focus());
}

/* ============ 短期合租协议：自动生成 → 在线编辑 → PDF ============ */
const F = (w) => `<span class="fill" style="min-width:${w}px">＿＿＿＿＿＿</span>`;
function tplHTML(l, days){
  const checkIn = searchState ? isoDate(searchState.din) : FIT_FROM;
  const checkOut = searchState ? isoDate(searchState.dout) : FIT_TO;
  const smokeClause = l.roommates.some(r=>r.smoke>0)
    ? `屋内现有${l.roommates.filter(r=>r.smoke>0).map(r=>SmokeNames[r.smoke]).join('、')}的室友。经三方协商一致：唯一吸烟区域为${F(90)}（阳台/楼道/室外），卧室与客厅全面禁烟；烟头须熄灭后带出室外投放，室内不得使用明火香薰及电焊类用品。`
    : `现有室友均不吸烟，全屋（含阳台）保持无烟环境；如乙方需吸烟，应提前书面告知并移至楼外指定区域。`;
  const petClause = l.roommates.some(r=>r.hasPet)
    ? `屋内现有宠物，乙方确认知悉并同意；宠物活动区域、清洁与咬坏物品赔偿由${F(70)}负责，公共区域粪便与毛发当日清理。`
    : `屋内不养宠物，任何一方不得未经书面同意带宠物入住或长期留宿他人宠物。`;
  return `<h5>短期合租协议</h5>
  <div class="tp-sub">（实习生短租版 · 由「长虹居」按房源 ${escapeHtml(l.key)} 自动生成，${isoDate(new Date())}）</div>
  <p>甲方（现承租人/室友）：${F(120)}　身份证号：${F(150)}　联系电话：${F(100)}</p>
  <p>乙方（实习生）：${F(120)}　身份证号：${F(150)}　学校及实习单位：${F(160)}</p>
  <p class="ps-sec">房屋坐落</p>
  <p>${escapeHtml(l.addr)}，${escapeHtml(l.roomType)}（建筑面积约 ${l.roomSqm}㎡，整套 ${escapeHtml(l.layout)} / 约 ${l.aptSqm}㎡，${l.elevator?'电梯房':'步梯房'}），出租方为${escapeHtml(l.channel)}。</p>
  <p class="ps-sec">一、租期</p>
  <p>自 ${checkIn} 起至 ${checkOut} 止，共 ${days} 天，为实习短租，到期自行退住、无需另行续租手续；乙方实际入住以双方签署《交接确认单》之日为准。</p>
  <p class="ps-sec">二、租金与押金</p>
  <p>床位租金 ¥${fmt(l.rent)}/月，付款方式为 <b>${l.payText}</b>；押金 ¥${fmt(l.deposit)}，于退租房屋查验无损、费用结清后 <b>7 个工作日内</b>全额退还，逾期按日 0.05% 支付资金占用费。租金不得随市场价临时上调。</p>
  <p class="ps-sec">三、服务费与其他费用</p>
  <p>${l.svc>0?`公寓/中介服务费 ¥${fmt(l.svc)}/月，对应服务内容：${F(140)}（含维修响应、公共保洁、网络带宽等，未列明的服务不得另行收费）；`:'本房源无服务费；'}水、电、燃气、网络按床位 ${l.rooms} 人均摊（预估 ¥${fmt(l.util)}/月），入住时抄表底数并拍照留证${l.channel==='房东直租'?'（民水民电以房产证性质为准，请在合同补充页确认）':''}。</p>
  <p class="ps-sec">四、公共区域与卫生</p>
  <p>厨房、卫生间、客厅轮值打扫，值班表贴于冰箱；个人物品不得占用公共通道；冰箱公共层每周日清空；访客留宿需提前一天在室友群告知，连续留宿不得超过 3 天。</p>
  <p class="ps-sec">五、作息与安静时段</p>
  <p>室友作息构成：${l.roommates.map(r=>RhythmNames[r.rhythm]).join(' / ')}。每日 23:30 至次日 07:30 为安静时段，此时段内不得外放音视频、不得使用洗衣机、通话移至走廊；夜间加班归来开门关门轻手。</p>
  <p class="ps-sec">六、吸烟与消防安全</p>
  <p>${smokeClause}</p>
  <p class="ps-sec">七、宠物约定</p>
  <p>${petClause}</p>
  <p class="ps-sec">八、中途退租与转租</p>
  <p>乙方提前退租须提前 <b>15 天</b>书面通知；若能推荐并配合甲方完成新室友签约（实习期内以同剩余租期天数折算交接），押金全额退还；否则押金按剩余租期空置损失扣减，扣减上限不超过 ${l.depRatio>=0.99?'一个月床位费':'押金额度'}。房屋结构性维修由甲方在接到通知后 48 小时内处理。</p>
  <p class="ps-sec">九、交接确认</p>
  <p>入住当日共同确认：门锁与钥匙/门禁卡 ${F(50)} 套、水电燃气表底数、家具家电清单及现状、网络账号，全部拍照存档于共享相册。</p>
  <p class="ps-sec">十、其他</p>
  <p>本协议一式两份，甲乙双方各执一份，签字或电子签名后生效；租金往来一律通过银行转账并备注「床位租金」，保留凭证。未尽事宜按《北京市住房租赁条例》执行。</p>
  <div class="ps-sign"><div>甲方签字：${F(140)}</div><div>乙方签字：${F(140)}</div></div>
  <div class="ps-sign"><div>日期：${F(110)}</div><div>日期：${F(110)}</div></div>`;
}
function tplPlain(){ const d=document.createElement('div'); d.innerHTML=$('#dtTpl').innerHTML.replace(/<br\s*\/?>/g,'\n').replace(/<\/p>/g,'\n'); return d.textContent.replace(/\n{3,}/g,'\n\n').trim(); }
function buildPrintSheet(){
  const l = curListing; if(!l) return null;
  const days = searchState?.days ?? FIT_DAYS;
  $('#printSheet').innerHTML =
    `<div class="ps-meta">房源标识 ${escapeHtml(l.key)} · ${escapeHtml(l.dataKind)} · ${escapeHtml(l.addr)} · ${escapeHtml(l.roomType)} ${l.roomSqm}㎡ · ¥${fmt(l.rent)}/月 ${l.payText} · 实习期 ${days} 天</div>`
    + $('#dtTpl').innerHTML
    + `<div class="ps-foot">本文本由「长虹居」原型按房源字段自动生成，已在页面内在线编辑；打印时可选择「另存为 PDF」。生成的模板供参考，签署前请核对房屋产权、出租方身份与原始租赁合同。数据来源：${escapeHtml(SRC_LABEL)}。</div>`;
  return $('#printSheet');
}
function printPDF(){
  if(!buildPrintSheet()) return;
  $('#tplState').textContent = tplDirty?'已修改 · 打印将使用当前版本':'未修改 · 使用自动生成版本';
  window.print();
}
let pdfLoading=null;
function downloadPDF(){
  const run = ()=>{
    const node = buildPrintSheet(); if(!node) return;
    node.style.color='#000';
    window.html2pdf().set({
      margin:[14,13,14,13], filename:`短期合租协议-${curListing.area}-${curListing.key}.pdf`,
      image:{type:'jpeg',quality:0.96}, html2canvas:{scale:2, useCORS:true, logging:false, windowWidth:794},
      jsPDF:{unit:'mm', format:'a4', compress:true}, pagebreak:{mode:['css','legacy']}
    }).from(node).save().then(()=>{ $('#tplState').textContent='PDF 已下载'; })
      .catch(err=>{ $('#tplState').textContent='下载失败，请改用打印'; console.error(err); });
  };
  if(window.html2pdf) return run();
  const s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js';
  s.onload=()=>{ pdfLoading='ok'; run(); };
  s.onerror=()=>{ pdfLoading='fail'; alert('PDF 组件加载失败（需联网）。请用「打印 / 存为 PDF」按钮，在打印对话框里选「目标 = 另存为 PDF」，效果完全一致且中文不缺字。'); };
  document.body.appendChild(s);
}
function copyTpl(){
  const t = tplPlain();
  if(navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(()=>$('#tplState').textContent='纯文本已复制');
  else { const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); $('#tplState').textContent='纯文本已复制'; }
}

/* ============ 表单构建与交互 ============ */
function setLocHint(msg, cls){
  const h=$('#locHint'); h.textContent=msg; h.className='loc-hint'+(cls?' '+cls:'');
}
function buildBudget(){
  if(!LISTINGS.length) return;
  const rents = LISTINGS.map(l=>l.rent);
  const lo = Math.floor(Math.min(...rents)/500)*500;
  const hi = Math.ceil(Math.max(...rents)/500)*500;
  [['budMin','起'],['budMax','以内']].forEach(([id,suf])=>{
    const sel=$('#'+id); sel.innerHTML='';
    for(let v=lo; v<=hi; v+=500) sel.insertAdjacentHTML('beforeend',`<option value="${v}">${id==='budMin'?'¥'+v+' 起':'¥'+v+' 以内'}</option>`);
    const preferred = id==='budMin' ? 1500 : 4000;
    sel.value = Math.max(lo,Math.min(hi,preferred));
  });
}
function buildForm(){
  $('#ruleTbl').innerHTML = RULE_HTML;
  $('#keyState').textContent = AMAP_KEY ? '已配置在线地点搜索' : '使用内置地点索引';
  // 地点输入面板
  const inp=$('#poiText'), box=$('#sugList');
  let items=[], active=-1, timer=0, lookup=null, composing=false;
  function closeSuggestions(){
    if(timer || lookup) setLocHint('');
    clearTimeout(timer);
    timer=0;
    lookup?.abort();
    lookup=null;
    items=[];
    active=-1;
    hidePoiList();
    box.replaceChildren();
  }
  $$('.mode').forEach(b=>b.onclick=()=>{
    $$('.mode').forEach(x=>{
      x.classList.toggle('on', x===b);
      x.setAttribute('aria-pressed', String(x===b));
    });
    $$('.loc-panes').forEach(p=>p.classList.toggle('on', p.id===b.dataset.pane));
    closeSuggestions();
    pendingAnchor=null; inp.value=''; $('#lockedLoc').style.display='none';
    $('#locHint').textContent=''; $('#searchFeedback').textContent='';
  });
  function selectSuggestion(index){
    box.children[active]?.classList.remove('sel');
    box.children[active]?.setAttribute('aria-selected','false');
    active=index;
    const option=box.children[index];
    option.classList.add('sel');
    option.setAttribute('aria-selected','true');
    inp.setAttribute('aria-activedescendant',option.id);
    if(option.offsetTop<box.scrollTop) box.scrollTop=option.offsetTop;
    else if(option.offsetTop+option.offsetHeight>box.scrollTop+box.clientHeight){
      box.scrollTop=option.offsetTop+option.offsetHeight-box.clientHeight;
    }
  }
  function paint(matches,q,index=0){
    items=matches;
    active=-1;
    box.innerHTML = matches.map((it,i)=>`<div class="sug-item" id="poi-option-${i}" data-i="${i}" role="option" aria-selected="false">
        <span class="sg-kind">${escapeHtml(it.kind)}</span><span>${hl(it.name,q)}</span>
        <span class="sg-meta">${it.mode==='area'?'片区中心':escapeHtml(it.note||'')}</span></div>`).join('');
    box.classList.add('on');
    box.scrollTop=0;
    inp.setAttribute('aria-expanded','true');
    selectSuggestion(index);
  }
  function choose(it){
    if(!it) return;
    pendingAnchor=anchorFromPOI(it,inp.value);
    closeSuggestions();
    showLock(pendingAnchor);
    setLocHint('');
  }
  function showLocationFallback(q){
    const fb=resolveFreeText(q);
    setLocHint(fb ? '可用附近片区估算。' : '暂未找到这个地点。试试公司简称，或按片区选。', fb ? 'ok' : 'err');
    // Let the user finish typing before confirming the approximate location.
  }
  function updateSuggestions(){
    closeSuggestions();
    pendingAnchor=null;
    $('#lockedLoc').style.display='none';
    setLocHint('');
    const q=inp.value.trim();
    if(!q || document.activeElement!==inp) return;
    const local=suggest(q);
    if(local.length){ paint(local,q); return; }
    if(!AMAP_KEY){ showLocationFallback(q); return; }
    setLocHint('本地索引未命中，正在请求高德输入提示…');
    timer=setTimeout(async ()=>{
      timer=0;
      const request=new AbortController();
      lookup=request;
      const online=await amapLocate(q,request.signal);
      if(request.signal.aborted || lookup!==request) return;
      lookup=null;
      if(inp.value.trim()!==q || document.activeElement!==inp) return;
      if(online){
        setLocHint('');
        paint([online],q);
      }else showLocationFallback(q);
    },200);
  }
  inp.addEventListener('compositionstart',()=>{
    composing=true;
    closeSuggestions();
    pendingAnchor=null;
    $('#lockedLoc').style.display='none';
    setLocHint('');
  });
  inp.addEventListener('compositionend',()=>{ composing=false; updateSuggestions(); });
  inp.addEventListener('input',e=>{ if(!composing && !e.isComposing) updateSuggestions(); });
  inp.addEventListener('keydown',e=>{
    if(composing || e.isComposing || e.keyCode===229) return;
    const open=box.classList.contains('on');
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      const down=e.key==='ArrowDown';
      if(open){
        e.preventDefault();
        selectSuggestion((active+(down?1:-1)+items.length)%items.length);
      }else if(!pendingAnchor){
        const matches=suggest(inp.value);
        if(!matches.length) return;
        e.preventDefault();
        paint(matches,inp.value,down?0:matches.length-1);
      }
    }else if(e.key==='Enter' && open){
      e.preventDefault();
      choose(items[active]);
    }else if(e.key==='Escape' && (open || timer || lookup)){
      e.preventDefault();
      closeSuggestions();
    }
  });
  box.addEventListener('mousedown',e=>{ if(e.button===0 && e.target.closest('.sug-item')) e.preventDefault(); });
  box.addEventListener('click',e=>{
    const option=e.target.closest('.sug-item');
    if(option && box.classList.contains('on')) choose(items[Number(option.dataset.i)]);
  });
  inp.addEventListener('blur',closeSuggestions);
  $('#lockClear').onclick=()=>{ $('.mode[data-pane="pInput"]').click(); inp.focus(); };

  // 画像问卷选项
  $$('#maskQ .seg button').forEach(button=>{
    button.setAttribute('aria-pressed','false');
    button.onclick=()=>[...button.parentElement.children].forEach(option=>{
      option.classList.toggle('on', option===button);
      option.setAttribute('aria-pressed', String(option===button));
    });
  });
  $('#dtTpl').addEventListener('input',()=>{ tplDirty=true; $('#tplState').textContent='已修改（打印/下载将使用当前版本）'; });
  $('#btnPrint').onclick=printPDF;
  $('#btnPdf').onclick=downloadPDF;
  $('#btnCopyTpl').onclick=copyTpl;
  $('#btnTplUndo').onclick=()=>{ if(curListing){ $('#dtTpl').innerHTML=tplHTML(curListing, searchState?searchState.days:92); tplDirty=false; $('#tplState').textContent='已恢复自动生成版本'; } };

  $('#btnQ').onclick=()=>{
    $('#qFeedback').textContent = '';
    navigate('habits');
  };

  $('#btnQApply').onclick=finishMatching;
  $$('#tabs .tab').forEach(t=>t.onclick=()=>{
    window.nestModeChosen=true;curTab=t.dataset.k;
    showingExcluded = false;
    render();
  });
  $('#btnMapView').onclick=()=>{
    navigate(currentPage()==='map'?'results':'map');return;
    setResultView($('#resultsLayout').dataset.view==='map' ? 'list' : 'map');
    renderMap();
  };
  window.matchMedia('(max-width: 820px)').addEventListener('change',renderMap);

  // 数据载入 / 导出
  $('#csvFile').addEventListener('change', e=>{
    const f = e.target.files[0]; if(!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      try{
        const n = loadData(rd.result, f.name);
        $('#dataFeedback').textContent = `已载入 ${f.name}，按房源编号合并后共 ${n} 套房源。`;
      }catch(err){ $('#dataFeedback').textContent = `CSV 载入失败。${err.message}`; }
    };
    rd.readAsText(f,'utf-8');
  });
  $('#btnExportCsv').onclick=async ()=>{
    let rows = DATA_ROWS;
    if(backendPage){
      try{
        rows = await window.housingBackend.allListings();
      }catch(error){
        $('#dataFeedback').textContent = error.message;
        return;
      }
    }
    if(!rows.length) return;
    const cols = [...new Set(rows.flatMap(row=>Object.keys(row)))];
    const esc = v => /[",\r\n]/.test(String(v)) ? '"'+String(v).replace(/"/g,'""')+'"' : String(v);
    const csv = '﻿'+[cols.join(','), ...rows.map(r=>cols.map(c=>esc(r[c]===undefined?'':r[c])).join(','))].join('\r\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    a.download='intern-home-listings.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  $$('[data-close-modal]').forEach(button=>{
    button.addEventListener('click', ()=>closeM(button.dataset.closeModal));
  });
  $$('.mask').forEach(mask=>mask.addEventListener('click',event=>{ if(event.target===mask) closeM(mask.id); }));
}
let modalTrigger = null;
function openM(id){
  const mask = $('#'+id);
  modalTrigger = document.activeElement;
  mask.classList.add('show');
  document.body.classList.add('modal-open');
  mask.querySelector('.x').focus({preventScroll:true});
}
function closeM(id){
  $('#'+id).classList.remove('show');
  document.body.classList.remove('modal-open');
  if(modalTrigger?.isConnected) modalTrigger.focus({preventScroll:true});
  modalTrigger = null;
}
document.addEventListener('keydown',event=>{
  const mask = $('.mask.show');
  if(!mask) return;
  if(event.key==='Escape'){
    event.preventDefault();
    closeM(mask.id);
  }else if(event.key==='Tab'){
    const controls = Array.from(mask.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), a[href], summary, [contenteditable=true]'
    ))
      .filter(control=>control.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if(event.shiftKey && document.activeElement===first){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey && document.activeElement===last){
      event.preventDefault();
      first.focus();
    }
  }
});



// Local metric projection of the Beijing vector tiles. Camera, buildings and overlays share the same ground plane.
(() => {
  'use strict';
  const rad=Math.PI/180, grid=100, indexes=new WeakMap();
  const land={residential:'#f3ebdc',commercial:'#e2e7ed',retail:'#f8dcc8',industrial:'#dee1ed',school:'#f2e0c5',university:'#e7e1ef',college:'#e8dded',hospital:'#f3d8db',railway:'#d9d9d6',kindergarten:'#f5dfce',library:'#e8dce5',playground:'#cae1be',zoo:'#c5dec2',neighbourhood:'#ebe6db'};
  const green={wood:'#96c8a6',grass:'#badda8',pitch:'#8dccad',stadium:'#a5cfb3',nature_reserve:'#b0d2ab',wetland:'#afd5c6',cemetery:'#c5d9b6',farmland:'#d2deb5'};
  const roofs={residential:['#ecdac9','#bb9981','#ceb099'],commercial:['#cadae7','#91a8bf','#a8bccf'],retail:['#f1d5bc','#c09c83','#d4b394'],industrial:['#d3cee0','#ada4bd','#beb6cb'],school:['#f2d7ae','#c3a485','#d7b897'],college:['#e5d8e9','#b3a1c0','#c6b4d0'],hospital:['#efd4d8','#bf9da5','#d3adb2']};
  roofs.university=roofs.college;roofs.library=roofs.college;roofs.kindergarten=roofs.school;
  const roadRanks={motorway:9,trunk:8,primary:7,secondary:6,tertiary:5,minor:4,residential:4,service:3,living_street:3,track:2,path:1,rail:0,transit:0};
  const indexed=data=>{
    if(!data)return null;if(indexes.has(data))return indexes.get(data);
    const cells=new Map(),large=[];
    for(const f of data.features){const [w,s,e,n]=f.bbox,x0=Math.floor(w*grid),x1=Math.floor(e*grid),y0=Math.floor(s*grid),y1=Math.floor(n*grid);
      if((x1-x0+1)*(y1-y0+1)>120){large.push(f);continue;}
      for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const id=x*20000+y;let cell=cells.get(id);if(!cell)cells.set(id,cell=[]);cell.push(f);}}
    const get=(w,s,e,n)=>{const found=new Set(large);for(let x=Math.floor(w*grid);x<=Math.floor(e*grid);x++)for(let y=Math.floor(s*grid);y<=Math.floor(n*grid);y++)for(const f of cells.get(x*20000+y)||[])found.add(f);return [...found].filter(f=>{const b=f.bbox;return b[0]<=e&&b[2]>=w&&b[1]<=n&&b[3]>=s})};indexes.set(data,get);return get;
  };
  window.createNestBasemap=function(canvas,data){
    const ctx=canvas.getContext('2d',{alpha:false}), query=indexed(data);
    let width=1,height=1,lon=0,lat=0,kx=1,ky=1,ca=1,sa=0,cp=1,sp=0,pxm=1;
    function project(p,alt=0){const dx=(p[0]-lon)*kx,dy=(lat-p[1])*ky;return {x:width*.5+ca*dx+sa*dy,y:height*.5+(-sa*dx+ca*dy)*cp-alt*pxm*sp};}
    function unproject(x,y){const a=x-width*.5,b=(y-height*.5)/cp;return [lon+(a*ca-b*sa)/kx,lat-(a*sa+b*ca)/ky];}
    function trace(coords,z=0,closed=false){for(let i=0;i<coords.length;i++){const p=project(coords[i],z);if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y)}if(closed)ctx.closePath();}
    function polygon(f,fill,stroke){ctx.beginPath();for(const r of f.geometry.coordinates)trace(r,0,true);ctx.fillStyle=fill;ctx.fill('evenodd');if(stroke){ctx.lineWidth=.65;ctx.strokeStyle=stroke;ctx.stroke()}}
    function draw({center,zoom,pitch,bearing,mode,width:w,height:h}){
      [lon,lat]=center;width=w;height=h;const dpr=Math.min(window.devicePixelRatio||1,2),ww=Math.round(w*dpr),hh=Math.round(h*dpr);
      if(canvas.width!==ww||canvas.height!==hh){canvas.width=ww;canvas.height=hh;}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#eeeadd';ctx.fillRect(0,0,w,h);
      kx=512*2**zoom/360;ky=kx/Math.cos(lat*rad);pxm=ky/111195;ca=Math.cos(bearing*rad);sa=Math.sin(bearing*rad);cp=Math.cos(pitch*rad);sp=Math.sin(pitch*rad);
      if(!query)return;const pad=zoom>14?Math.min(215,pxm*145):16,vs=[unproject(-8,-8),unproject(w+8,-8),unproject(-8,h+pad),unproject(w+8,h+pad)],xs=vs.map(p=>p[0]),ys=vs.map(p=>p[1]);
      const groups={land:[],green:[],water:[],building:[],road:[],label:[]};for(const f of query(Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)))groups[f.properties.kind].push(f);
      for(const f of groups.land)if(f.geometry.type==='Polygon')polygon(f,land[f.properties.class]||'#e4e2d4');
      for(const f of groups.green)if(f.geometry.type==='Polygon')polygon(f,green[f.properties.class]||'#c0dab0');
      for(const f of groups.water){if(f.geometry.type==='Polygon')polygon(f,'#83c7df','#76b8cf');else{ctx.beginPath();trace(f.geometry.coordinates);ctx.strokeStyle='#99cddb';ctx.lineWidth=2.6;ctx.stroke()}}
      const roads=groups.road.map(f=>({f,p:f.properties,r:roadRanks[f.properties.class]??-1})).filter(({r,p})=>r>=0&&(zoom>=14.3||r>=3)&&(zoom>=12.4||r>=5)&&(p.brunnel!=='tunnel'||r>=4)&&!(r===0&&p.class==='transit'));
      const band=v=>Number(v.p.layer)|| (v.p.brunnel==='bridge'?1:v.p.brunnel==='tunnel'?-1:0);
      roads.sort((a,b)=>band(a)-band(b)||a.r-b.r);
      const multiple=2**((zoom-15)*.66),taxi=mode==='taxi',metro=mode==='metro';ctx.lineCap='round';ctx.lineJoin='round';
      for(let start=0;start<roads.length;){let end=start+1;while(end<roads.length&&band(roads[end])===band(roads[start]))end++;
        for(const casing of [true,false])for(let i=start;i<end;i++){
          const {f,p,r}=roads[i],trail=r===1,bike=mode==='bike'&&(p.subclass==='cycleway'||p.bicycle==='designated');if(casing&&r<=2)continue;
          const width=Math.min(27,Math.max(r<3?.85:1,([1.4,1.8,2.2,3.4,4.5,6,7,8,9,10][r]+(taxi&&r>5?2:0))*multiple));
          ctx.lineWidth=width+(casing?1.6:0);ctx.strokeStyle=casing?(r>=7?'#d2b78f':'#d6cfc2'):bike?'#60ab91':r===0?'#a8a5ac':trail?(mode==='walk'?'#bca88a':'#d5c9b4'):r>=8?(taxi?'#f4bf72':'#f5cf91'):r===7?(taxi?'#f9d391':'#ffe3ae'):r===6?'#ffedcb':'#fffdf8';
          if(metro&&r<5)ctx.strokeStyle=casing?'#dfd9ce':'#f9f7ef';const dash=!casing&&((trail&&!bike)||r===0);if(dash)ctx.setLineDash([trail?2.5:5,2.4]);
          ctx.beginPath();trace(f.geometry.coordinates);ctx.stroke();if(dash)ctx.setLineDash([]);
        }start=end;
      }
      const buildings=zoom>=13.05?groups.building.filter(f=>zoom>=15||Math.max((f.bbox[2]-f.bbox[0])*kx,(f.bbox[3]-f.bbox[1])*ky)>4.2):[];
      const extrude=zoom>=13.05&&pitch>0;
      if(extrude){buildings.sort((a,b)=>{const depth=f=>-(f.bbox[0]+f.bbox[2])*kx*sa-(f.bbox[1]+f.bbox[3])*ky*ca;return depth(a)-depth(b)});
        ctx.save();ctx.translate(-Math.min(11,pxm*4),Math.min(14,pxm*5));ctx.fillStyle='#615b5a22';ctx.beginPath();for(const f of buildings)for(const r of f.geometry.coordinates)trace(r,0,true);ctx.fill('evenodd');ctx.restore();}
      for(const f of buildings){const z=Math.max(3,Math.min(320,Number(f.properties.height)||5)), base=Math.max(0,Math.min(z,Number(f.properties.minHeight)||0));
        const pal=z>=50?['#cbd8e3','#9eafc4','#b0bdcd']:(roofs[f.properties.landuse]||(z>=23?['#d7d9df','#a8adbd','#bdbecc']:['#e9decd','#bdad99','#cebfaa']));
        const top=extrude?z:0;
        if(extrude&&(z-base)*pxm*sp>1){for(const ring of f.geometry.coordinates){for(let i=1;i<ring.length;i++){const a=project(ring[i-1],base),b=project(ring[i],base);if(b.x>=a.x)continue;
          const rise=(z-base)*pxm*sp;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(b.x,b.y-rise);ctx.lineTo(a.x,a.y-rise);ctx.closePath();ctx.fillStyle=b.y>a.y?pal[1]:pal[2];ctx.fill();if(zoom>14.8&&rise>16&&a.x-b.x>8){ctx.strokeStyle='#ffffff4a';ctx.lineWidth=.6;ctx.beginPath();const step=Math.max(5,pxm*5*sp);for(let k=step;k<rise-2;k+=step){ctx.moveTo(a.x,a.y-k);ctx.lineTo(b.x,b.y-k)}ctx.stroke();}}}}
        ctx.beginPath();for(const r of f.geometry.coordinates)trace(r,top,true);ctx.fillStyle=pal[0];ctx.fill('evenodd');ctx.lineWidth=zoom>=15?.65:.45;ctx.strokeStyle='#b8b2a996';ctx.stroke();
      }
      drawLabels(roads,groups,mode,zoom);canvas.dataset.buildings=buildings.length;canvas.dataset.streets=roads.length;
    }
    function drawLabels(roads,groups,mode,zoom){
      const reserved=[],names=new Set(),isMetro=mode==='metro',font='"Microsoft YaHei", "PingFang SC", sans-serif';
      const reserve=(p,w,h)=>{const l=p.x-w/2,r=p.x+w/2,t=p.y-h/2,b=p.y+h/2;if(l<8||r>width-8||t<12||b>height-16||reserved.some(v=>l<v.r+5&&r>v.l-5&&t<v.b+4&&b>v.t-4))return false;reserved.push({l,r,t,b});return true};
      const text=(name,x,y,angle,size,color)=>{ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.lineJoin='round';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${size}px ${font}`;ctx.strokeStyle='#fffef4ee';ctx.lineWidth=3;ctx.strokeText(name,0,0);ctx.fillStyle=color;ctx.fillText(name,0,0);ctx.restore()};
      const collator={park:1,university:2,suburb:3,town:3,college:4,hospital:5,neighbourhood:6,library:7,museum:8,school:9,attraction:10};
      const labs=groups.label.filter(f=>Object.hasOwn(collator,f.properties.class)).sort((a,b)=>collator[a.properties.class]-collator[b.properties.class]);
      for(const f of labs){const {class:c,name}=f.properties;if(names.has(name)||name.length>15||zoom<14&&!['park','suburb','town'].includes(c))continue;const p=project(f.geometry.coordinates),size=c==='park'?12:11;
        if(reserve(p,name.length*size+13,22)){text(name,p.x,p.y,0,size,c==='park'?'#3a7757':c==='hospital'?'#9b616b':'#687975');names.add(name);if(names.size>=(isMetro?3:9))break;}}
      for(let i=roads.length-1;i>=0;i--){const {f,p,r}=roads[i],name=p.name;if(!name||names.has(name)||r<(zoom>15?2:5)||name.length>15)continue;
        const pts=f.geometry.coordinates.map(v=>project(v));let longest=0,a,b;
        for(let j=1;j<pts.length;j++){const aa=pts[j-1],bb=pts[j],len=Math.hypot(aa.x-bb.x,aa.y-bb.y);if(len>longest&&Math.min(aa.x,bb.x)<width&&Math.max(aa.x,bb.x)>0&&Math.min(aa.y,bb.y)<height&&Math.max(aa.y,bb.y)>0){longest=len;a=aa;b=bb;}}
        if(longest<name.length*6)continue;const q={x:(a.x+b.x)/2,y:(a.y+b.y)/2};let angle=Math.atan2(b.y-a.y,b.x-a.x);if(angle>Math.PI/2)angle-=Math.PI;if(angle< -Math.PI/2)angle+=Math.PI;
        const len=name.length*11;if(reserve(q,Math.abs(Math.cos(angle))*len+10,Math.abs(Math.sin(angle))*len+13)){text(name,q.x,q.y,angle,11,'#706b5d');names.add(name);if(names.size>=(isMetro?9:25))break;}}
    }
    return {project,unproject,draw,destroy(){canvas.width=canvas.height=1}};
  };
})();

// Offline street routing on the bundled OpenMapTiles transportation geometry.
// All public coordinates are [longitude, latitude] in WGS84 except for the
// directions link, whose input is the original listing/POI GCJ-02 coordinate.
(() => {
  'use strict';
  const metersY=111195, metersX=metersY*Math.cos(40*Math.PI/180);
  const cellSize=150, cache=new WeakMap();
  const roadClasses=new Set(['motorway','trunk','primary','secondary','tertiary','minor','service','track','path','pedestrian','residential','living_street','unclassified','footway','cycleway','steps','road']);
  const noPickup=new Set(['motorway','motorway_link','trunk_link']);
  const deny=new Set(['no','private','customers','delivery','permit','agricultural','forestry','military']);
  const allow=new Set(['yes','designated','permissive','official']);
  const coordinate=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
  const xy=p=>[(p[0]-116)*metersX,(p[1]-40)*metersY];
  const cell=(x,y)=>x+','+y;
  const lower=value=>String(value??'').toLowerCase();
  function policy(p,mode){
    const road=lower(p.class),sub=lower(p.subclass),specific=lower(mode==='taxi'?p.motor_vehicle:mode==='walk'?p.foot:p.bicycle);
    if(!roadClasses.has(road)||['construction','proposed','platform','corridor'].includes(sub))return null;
    if(deny.has(specific)||(!allow.has(specific)&&deny.has(lower(p.access))))return null;
    if(mode==='taxi'){
      if(['track','path','pedestrian','footway','cycleway','steps'].includes(road)||['footway','cycleway','steps','pedestrian','bridleway','sidewalk','crossing'].includes(sub))return null;
      const one=lower(p.oneway);
      return {weight:['motorway','trunk','primary'].includes(road)?1:road==='service'?1.8:1.3,forward:!['-1','reverse'].includes(one),backward:!['yes','true','1'].includes(one)};
    }
    if(['motorway','motorway_link','trunk','trunk_link'].includes(road)||/^(motorway|trunk)(_link)?$/.test(sub))return null;
    const type=sub||road;
    const walkOnly=['pedestrian','footway','steps','sidewalk','crossing'].includes(type);
    let weight=1,forward=true,backward=true;
    if(mode==='walk'){
      if(type==='cycleway'&&!allow.has(specific))return null;
      if(['primary','secondary'].includes(road))weight=1.45;
      else if(!walkOnly&&road!=='path')weight=1.13;
    }else{
      if(type==='steps'||specific==='dismount'||(walkOnly&&!allow.has(specific)))return null;
      const bikeLane=p.cycleway&&!['no','none','separate'].includes(lower(p.cycleway));
      if(type==='cycleway'||bikeLane)weight=1;
      else if(['primary','secondary'].includes(road))weight=1.75;
      else if(['path','track'].includes(road))weight=1.48;
      else weight=1.15;
      const one=lower(p['oneway:bicycle']??p.oneway);
      if(one==='-1'||one==='reverse')forward=false;
      if(['yes','true','1'].includes(one))backward=false;
    }
    return {weight,forward,backward};
  }
  function edgeTag(p){
    const road=lower(p.class),sub=lower(p.subclass),one=lower(p.oneway);
    return {name:p.name||'',road,sub,brunnel:lower(p.brunnel),layer:Number(p.layer)||0,
      oneway:['yes','true','1','-1','reverse'].includes(one)?one:'',
      service:lower(p.service),surface:lower(p.surface),
      ramp:sub.endsWith('_link')||['1','yes','true'].includes(lower(p.ramp))?1:0,
      steps:road==='steps'||sub==='steps',foot:lower(p.foot),bicycle:lower(p.bicycle)};
  }
  function buildGraph(data,mode){
    const nodes=[],byPoint=new Map(),byCell=new Map(),ends=new Map();
    function getNode(p,level){
      const key=Math.round(p[0]*1e6)+','+Math.round(p[1]*1e6);
      const idKey=key+':'+level;
      let id=byPoint.get(idKey);
      if(id===undefined){
        id=nodes.length;const [x,y]=xy(p);
        nodes.push({x,y,coord:p,links:[],key,level,id});
        byPoint.set(idKey,id);
      }
      return nodes[id];
    }
    function registerEnd(node,adjacent,name){
      const dx=adjacent.x-node.x,dy=adjacent.y-node.y,len=Math.hypot(dx,dy);
      if(!len)return;
      if(!ends.has(node.key))ends.set(node.key,[]);
      ends.get(node.key).push({node,name,dx:dx/len,dy:dy/len});
    }
    for(const feature of data.features||[]){
      const p=feature.properties||{},g=feature.geometry;
      if(p.kind!=='road'||!g)continue;
      const travel=policy(p,mode);
      if(!travel)continue;
      const level=Number(p.layer)||(p.brunnel==='bridge'?1:p.brunnel==='tunnel'?-1:0);
      const parts=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
      for(const line of parts){
        if(line.length<2||!line.every(coordinate))continue;
        const first=getNode(line[0],level);
        let previous=first,second=null,lastPrevious=null;
        for(let i=1;i<line.length;i++){
          const next=getNode(line[i],level);
          if(next===previous)continue;
          const length=Math.hypot(next.x-previous.x,next.y-previous.y);
          const edge={a:previous,b:next,length,name:p.name||'',tag:edgeTag(p),...travel};
          if(edge.forward)previous.links.push([next.id,length*edge.weight,edge.tag]);
          if(edge.backward)next.links.push([previous.id,length*edge.weight,edge.tag]);
          const x0=Math.floor(Math.min(previous.x,next.x)/cellSize),x1=Math.floor(Math.max(previous.x,next.x)/cellSize);
          const y0=Math.floor(Math.min(previous.y,next.y)/cellSize),y1=Math.floor(Math.max(previous.y,next.y)/cellSize);
          for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){
            const key=cell(x,y);
            if(!byCell.has(key))byCell.set(key,[]);
            byCell.get(key).push(edge);
          }
          second??=next;lastPrevious=previous;previous=next;
        }
        if(second){registerEnd(first,second,p.name);registerEnd(previous,lastPrevious,p.name);}
      }
    }
    // Different layers join only at a shared road end with a plausible
    // continuing alignment. Geometric crossings by themselves never join.
    for(const matches of ends.values())for(let i=0;i<matches.length;i++)for(let j=i+1;j<matches.length;j++){
      const a=matches[i],b=matches[j];
      if(a.node.level===b.node.level||Math.abs(a.node.level-b.node.level)>1)continue;
      if(a.name&&b.name&&a.name!==b.name)continue;
      if(a.dx*b.dx+a.dy*b.dy>-.64)continue;
      a.node.links.push([b.node.id,0]);b.node.links.push([a.node.id,0]);
    }
    // Tiles may simplify a straight street through a junction into a single segment.
    // Connect an observed way endpoint to that segment only on the same level and within tile rounding precision.
    for(const matches of ends.values()){
      for(const {node} of matches){
        const candidates=new Set();
        for(let x=Math.floor((node.x-1.2)/cellSize);x<=Math.floor((node.x+1.2)/cellSize);x++)for(let y=Math.floor((node.y-1.2)/cellSize);y<=Math.floor((node.y+1.2)/cellSize);y++)for(const e of byCell.get(cell(x,y))||[])candidates.add(e);
        for(const e of candidates){const {a,b,length,forward,backward,weight}=e;if(node===a||node===b||a.level!==node.level)continue;
          const dx=b.x-a.x,dy=b.y-a.y,t=((node.x-a.x)*dx+(node.y-a.y)*dy)/(length*length);
          if(t<=0||t>=1||Math.hypot(node.x-a.x-t*dx,node.y-a.y-t*dy)>1.2)continue;
          if(forward){a.links.push([node.id,t*length*weight,e.tag]);node.links.push([b.id,(1-t)*length*weight,e.tag]);}
          if(backward){b.links.push([node.id,(1-t)*length*weight,e.tag]);node.links.push([a.id,t*length*weight,e.tag]);}
        }
      }
    }
    return {nodes,byCell};
  }
  function snap(graph,p,mode,limit,range,count){
    // Keep through roads in the graph, but avoid an expressway or ramp for pickup/drop-off.
    const [x,y]=xy(p),near=new Set();
    for(let i=Math.floor((x-limit)/cellSize);i<=Math.floor((x+limit)/cellSize);i++)
      for(let j=Math.floor((y-limit)/cellSize);j<=Math.floor((y+limit)/cellSize);j++)
        for(const edge of graph.byCell.get(cell(i,j))||[])near.add(edge);
    const hits=[];
    for(const edge of near){
      const {a,b,length,tag}=edge,dx=b.x-a.x,dy=b.y-a.y;
      if(mode==='taxi'&&(noPickup.has(tag.road)||noPickup.has(tag.sub)))continue;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(length*length)));
      const d=Math.hypot(x-a.x-t*dx,y-a.y-t*dy);
      if(d<=limit)hits.push({edge,t,d,coord:[a.coord[0]+(b.coord[0]-a.coord[0])*t,a.coord[1]+(b.coord[1]-a.coord[1])*t]});
    }
    hits.sort((a,b)=>a.d-b.d);
    return hits.filter(h=>h.d<=hits[0].d+range).slice(0,count);
  }
  class MinQueue{
    constructor(){this.items=[];}
    push(id,cost){
      const items=this.items;let i=items.length;
      while(i){
        const parent=(i-1)>>1;
        if(items[parent].cost<=cost)break;
        items[i]=items[parent];i=parent;
      }
      items[i]={id,cost};
    }
    pop(){
      const items=this.items,first=items[0],tail=items.pop();
      if(!items.length)return first;
      let i=0;
      while(i*2+1<items.length){
        let child=i*2+1;
        if(child+1<items.length&&items[child+1].cost<items[child].cost)child++;
        if(items[child].cost>=tail.cost)break;
        items[i]=items[child];i=child;
      }
      items[i]=tail;return first;
    }
  }
  function route(start,end,mode,data=window.NEST_CITY_DATA){
    if(!['walk','bike','taxi'].includes(mode)||!coordinate(start)||!coordinate(end)||!Array.isArray(data?.features))return null;
    let graphs=cache.get(data);
    if(!graphs){graphs={};cache.set(data,graphs);}
    const graph=graphs[mode]??=buildGraph(data,mode);
    const normal=search(mode==='bike'?155:120,23,8);
    const direct=Math.hypot((end[0]-start[0])*metersX,(end[1]-start[1])*metersY);
    // Approximate pins can land away from the accessible street network.
    // Expand only for a missing path or a large detour, keeping the best usual route otherwise.
    if(normal&&normal.lengthMeters<=direct*5+1200)return normal;
    const expanded=search(220,75,16);
    const cost=leg=>leg.lengthMeters+4*(leg.startSnapMeters+leg.endSnapMeters);
    return expanded&&(!normal||cost(expanded)<cost(normal))?expanded:normal;

    function search(limit,range,count){
      return findStreetPath(graph,snap(graph,start,mode,limit,range,count),
        snap(graph,end,mode,limit,range,count),end,mode);
    }
  }
  function findStreetPath(graph,starts,ends,end,mode){
    if(!starts.length||!ends.length)return null;
    const distances=new Float64Array(graph.nodes.length).fill(Infinity);
    const parent=new Int32Array(graph.nodes.length).fill(-1),origins=new Map(),terminals=new Map();
    const streetNames=new Map();
    const queue=new MinQueue(),[gx,gy]=xy(end);
    function score(id,cost){const n=graph.nodes[id];return cost+Math.hypot(n.x-gx,n.y-gy);}
    let best=Infinity,winStart,winEnd,winNode=-1;
    for(const s of starts){
      for(const e of ends){
        if(e.edge!==s.edge)continue;
        const delta=e.t-s.t,ed=s.edge;
        if((delta>0&&!ed.forward)||(delta<0&&!ed.backward))continue;
        const cost=(s.d+e.d)*4+Math.abs(delta)*ed.length*ed.weight;
        if(cost<best){best=cost;winStart=s;winEnd=e;winNode=-1;}
      }
      const {a,b,length,weight,forward,backward}=s.edge;
      for(const [n,portion] of [[a,backward||s.t===0?s.t:Infinity],[b,forward||s.t===1?1-s.t:Infinity]]){
        const cost=s.d*4+length*portion*weight;
        if(cost>=distances[n.id])continue;
        distances[n.id]=cost;origins.set(n.id,s);queue.push(n.id,score(n.id,cost));
      }
    }
    for(const e of ends){
      const {a,b,length,weight,forward,backward}=e.edge;
      for(const [n,portion] of [[a,forward||e.t===0?e.t:Infinity],[b,backward||e.t===1?1-e.t:Infinity]]){
        const cost=e.d*4+length*portion*weight;
        if(!Number.isFinite(cost)||(terminals.get(n.id)?.cost??Infinity)<=cost)continue;
        terminals.set(n.id,{cost,e});
      }
    }
    while(queue.items.length){
      const {id,cost}=queue.pop();
      if(cost>=best)break;
      if(cost>score(id,distances[id])+.000001)continue;
      const terminal=terminals.get(id);
      if(terminal&&distances[id]+terminal.cost<best){
        best=distances[id]+terminal.cost;winEnd=terminal.e;winNode=id;
      }
      for(const [next,weight,tag] of graph.nodes[id].links){
        const d=distances[id]+weight;
        if(d>=distances[next])continue;
        parent[next]=id;streetNames.set(next,tag);distances[next]=d;queue.push(next,score(next,d));
      }
    }
    if(!winEnd)return null;
    const points=[];
    for(let id=winNode;id>=0;id=parent[id]){
      points.push({coord:graph.nodes[id].coord,tag:parent[id]<0?origins.get(id)?.edge.tag:streetNames.get(id)});
      if(parent[id]<0)winStart=origins.get(id);
    }
    points.reverse();points.unshift({coord:winStart.coord});points.push({coord:winEnd.coord,tag:winEnd.edge.tag});
    const coordinates=[],lengths=[],names=[],segs=[];
    for(const {coord:p,tag} of points){
      const last=coordinates.at(-1);
      const len=last?Math.hypot((p[0]-last[0])*metersX,(p[1]-last[1])*metersY):0;
      if(!last||len>.01){coordinates.push(p);lengths.push(len);if(last){names.push(tag?.name||'');segs.push(tag||{});}}
    }
    if(coordinates.length<2)return null;
    return {coordinates,names,segs,lengths,mode,lengthMeters:Math.round(lengths.reduce((a,b)=>a+b,0)),source:'本地街网估算',startSnapMeters:Math.round(winStart.d),endSnapMeters:Math.round(winEnd.d)};
  }
  window.getNestStreetRoute=route;
  window.nestDirectionsURL=function(start,end,mode,startName='房源',endName='实习地点'){
    const modes={walk:'walk',bike:'ride',metro:'bus',taxi:'car'};
    if(!coordinate(start)||!coordinate(end)||!Object.hasOwn(modes,mode))return null;
    const dest=(p,name)=>p.map(v=>v.toFixed(6)).join(',')+','+String(name).replaceAll(',','，');
    const params=new URLSearchParams({from:dest(start,startName),to:dest(end,endName),mode:modes[mode],src:'长虹居',callnative:'0'});
    return 'https://uri.amap.com/navigation?'+params;
  };
})();

(() => {
  'use strict';
  // Passenger stops and section lengths in metres. Sources:
  // https://wenjuan.bjsubway.com/station/zjgls/
  // https://www.mtr.bj.cn/service/line/distable/line-daxing.html
  // https://www.amap.com/ssr/subway/beijing-1100 (current calling patterns)
  const railSections=NEST_METRO_SECTIONS;


  const stationData=NEST_METRO_STATIONS;
  const stationDisplayName = name => name.endsWith('站') ? name : name+'站';
  const servedByStation=new Map();
  for(const [line,sections] of Object.entries(railSections)){
    for(const [a,b] of sections)for(const name of [a,b]){
      if(!servedByStation.has(name))servedByStation.set(name,new Set());
      servedByStation.get(name).add(line);
    }
  }

  // Tile station points are WGS84, the same coordinate system as both basemaps.
  // Match the passenger name before stripping a suffix to preserve names such as 北京站.
  // Additional WGS84 OpenStreetMap station points outside the bundled tile coverage.
  // The trailing IDs refer to https://www.openstreetmap.org/node/<id>.
  const supplementalStationData=NEST_METRO_SUPPLEMENTAL_STATIONS;
  const stationAliases={清河:'清河站',北京朝阳:'朝阳站'};
  const stationIndex=new Map([...stationData,...supplementalStationData].filter(([name])=>servedByStation.has(name)).map(([name,lng,lat])=>[name,{name,lng,lat}]));
  const tileStationPoints=new Map();
  for(const f of window.NEST_CITY_DATA?.features||[]){
    const p=f.properties;
    if(p.kind!=='label'||p.subclass!=='subway'||!p.name)continue;
    const raw=p.name.trim();
    const name=[raw,stationAliases[raw],raw.replace(/站$/,'')].find(n=>servedByStation.has(n));
    if(!name)continue;
    if(!tileStationPoints.has(name))tileStationPoints.set(name,new Map());
    const coord=f.geometry.coordinates;
    tileStationPoints.get(name).set(coord.join(','),coord);
  }
  for(const [name,points] of tileStationPoints){
    // Transfer platforms may have their own POIs. Choose their geographic centre for one shared marker.
    const [sumLng,sumLat]=[...points.values()].reduce(([lng,lat],[x,y])=>[lng+x,lat+y],[0,0]);
    stationIndex.set(name,{name,lng:sumLng/points.size,lat:sumLat/points.size});
  }
  const stations=[...stationIndex.values()];
  const lines=new Map();
  for(const [number,rows] of Object.entries(railSections)){
    const sections=[];
    let current=null;
    for(const [b,a] of rows){
      const pa=stationIndex.get(a),pb=stationIndex.get(b);
      if(!pa||!pb){current=null;continue;}
      if(!current||current.at(-1)!==pa){current=[pa];sections.push(current);}
      current.push(pb);
    }
    lines.set(number,sections);
  }
  const pi = Math.PI;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const money = value => Number(value).toLocaleString('zh-CN', {maximumFractionDigits:0});
  const mercator = ({lng,lat}) => {
    const rad = clamp(lat,-85,85) * pi / 180;
    return {x:(lng+180)/360, y:.5-Math.log(Math.tan(pi/4+rad/2))/(2*pi)};
  };
  const toLngLat = point => [point.x*360-180, Math.atan(Math.sinh(pi*(1-2*point.y)))*180/pi];
  // Coordinate correction for the original GCJ-02 listings, POIs and search anchor.
  function gcjToWgs({lng,lat}) {
    lng = Number(lng); lat = Number(lat);
    if(lng<72 || lng>138 || lat<.8 || lat>56) return {lng,lat};
    const x=lng-105, y=lat-35;
    const sine=(a,b)=>Math.sin(a*pi)*b;
    const shared=(sine(6*x,20)+sine(2*x,20))*2/3;
    let north=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x))+shared;
    north+=(sine(y,20)+sine(y/3,40)+sine(y/12,160)+sine(y/30,320))*2/3;
    let east=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x))+shared;
    east+=(sine(x,20)+sine(x/3,40)+sine(x/12,150)+sine(x/30,300))*2/3;
    const rad=lat*pi/180, eccentricity=.006693421622965943;
    const factor=1-eccentricity*Math.sin(rad)**2, root=Math.sqrt(factor);
    north*=180/((6378245*(1-eccentricity))/(factor*root)*pi);
    east*=180/(6378245/root*Math.cos(rad)*pi);
    return {lng:lng-east,lat:lat-north};
  }
  for(const s of stations) Object.assign(s,mercator(s));
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const modeLabels={walk:'步行',bike:'骑行',metro:'地铁',taxi:'打车'};
  const radiusMetres={walk:1500,bike:5000,metro:8409,taxi:8450};
  const validCoord = p => p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && Math.abs(+p.lat)<=85 && Math.abs(+p.lng)<=180;
  const live = new WeakMap();
  let enginePromise;
  function streetEngine(){
    if(window.maplibregl) return Promise.resolve(window.maplibregl);
    if(!enginePromise) enginePromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      const fail=()=>{clearTimeout(timer);script.remove();enginePromise=null;reject(new Error('地图组件暂不可用'));};
      const timer=setTimeout(fail,9000);
      script.src='https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.1/dist/maplibre-gl.js';
      script.onload=()=>{clearTimeout(timer);window.maplibregl ? resolve(window.maplibregl) : fail();};
      script.onerror=fail; document.head.append(script);
    });
    return enginePromise;
  }
  function element(tag,cls,content){
    const node=document.createElement(tag);
    if(cls) node.className=cls;
    if(content!==undefined) node.textContent=content;
    return node;
  }
  function button(label,content){
    const node=element('button','na-button',content);
    node.type='button'; node.setAttribute('aria-label',label);node.title=label;
    return node;
  }
  const svgNS='http://www.w3.org/2000/svg';
  function vector(tag,attrs,parent){
    const node=document.createElementNS(svgNS,tag);
    for(const [name,v] of Object.entries(attrs)) node.setAttribute(name,v);
    parent.append(node);
    return node;
  }

// Shared by the itinerary, its map annotations and the ETA. Distances are in metres.
const stationPoint=s=>[s.lng,s.lat];
const metres=(a,b)=>Math.hypot((b[0]-a[0])*111195*Math.cos((a[1]+b[1])*Math.PI/360),(b[1]-a[1])*111195);
const routeCache=new Map();
function streetLeg(a,b,mode){
  const key=[mode,...a,...b].join('|');
  if(routeCache.has(key))return routeCache.get(key);
  const r=metres(a,b)<2?{coordinates:[a,b],names:[],segs:[],lengthMeters:0,startSnapMeters:0,endSnapMeters:0,mode}:getNestStreetRoute(a,b,mode);
  if(r){
    r.totalMeters=r.lengthMeters+r.startSnapMeters+r.endSnapMeters;
    const perMinute={walk:80,bike:240,taxi:440}[mode];
    r.minutes=Math.ceil(r.lengthMeters/perMinute+(r.startSnapMeters+r.endSnapMeters)/80);
  }
  if(routeCache.size>300)routeCache.clear();
  routeCache.set(key,r);return r;
}
// ── 逐段走法：路名 / 路口 / 里程 / 参照物 / 路况提示 ──────────────────
// 全部词汇来自本文件内置的街网与地标几何，未接外部导航服务；没有名字的道路只描述形态。
const turnWords={
  0:{word:'直行',arrow:'↑'},1:{word:'向右前方',arrow:'↗'},2:{word:'右转',arrow:'↱'},3:{word:'掉头',arrow:'↺'},
  '-1':{word:'向左前方',arrow:'↖'},'-2':{word:'左转',arrow:'↰'}
};
const modeVerbs={walk:'步行',bike:'骑行',taxi:'乘车'};
function turnText(angle){
  const a=Math.abs(angle);
  if(a>148)return turnWords[3];
  if(a>72)return angle>0?turnWords[2]:turnWords['-2'];
  if(a>34)return angle>0?turnWords[1]:turnWords['-1'];
  return turnWords[0];
}
const roadWords={motorway:'快速路',motorway_link:'匝道',trunk:'主干道',trunk_link:'匝道',primary:'主干道',
  secondary:'次干道',tertiary:'支路','unclassified':'道路',minor:'小路',residential:'小区路',
  living_street:'生活街区道路',service:'内部路',pedestrian:'步行街',footway:'步道',path:'步行道',
  cycleway:'自行车道',steps:'台阶',track:'郊野小路',bridleway:'马道'};
function roadLabel(seg){
  if(!seg)return '';
  if(seg.sub==='alley')return '胡同';
  if(seg.sub==='tertiary_link'||seg.ramp)return '匝道';
  if(seg.sub==='sidewalk'||seg.sub==='crossing')return '人行道';
  if(seg.steps)return '台阶';
  if(seg.sub&&roadWords[seg.sub])return roadWords[seg.sub];
  return roadWords[seg.road]||'';
}
// 沿线参照物：公交站、地铁、公园、学校、河流、楼宇按网格索引；无名道路另建有名路段索引做"紧邻"提示。
const lm={built:false,cells:new Map(),roads:new Map()};
const LM_CELL=0.004,LM_MX=111195*Math.cos(40*Math.PI/180),LM_MY=111195;
function lmTag(p){
  const kind=String(p.kind||''),sub=String(p.subclass||'').toLowerCase(),cls=String(p.class||'').toLowerCase();
  const area=String(p.landuse||p.leisure||p.amenity||'').toLowerCase();
  if(sub==='bus_stop'||cls==='bus_stop')return '公交站';
  if(sub==='subway'||cls==='subway'||cls==='station')return '轨道交通';
  if(kind==='water')return '水系';
  if(kind==='green'||['park','garden','recreation_ground','playground','nature_reserve'].includes(sub)||['park','garden','recreation_ground'].includes(area))return '公园绿地';
  if(area==='university'||sub==='university')return '高校';
  if(area==='school'||sub==='school')return '学校';
  if(area==='hospital')return '医院';
  if(area==='retail'||area==='commercial')return '商业区';
  if(area==='residential')return '小区';
  if(sub==='forest')return '林地';
  if(cls==='peak')return '山峰';
  if(cls==='sports_centre'||sub==='sports_centre')return '体育场馆';
  if(cls==='tourism'||sub==='attraction')return '景点';
  if(kind==='building')return '楼宇';
  return '';
}
function ringCentre(ring){
  if(!Array.isArray(ring)||ring.length<2)return null;
  let x=0,y=0,n=0;
  for(const p of ring){if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1]))continue;x+=p[0];y+=p[1];n++;}
  return n?[x/n,y/n]:null;
}
function lmPush(map,pt,rec){
  if(!pt||!Number.isFinite(pt[0])||!Number.isFinite(pt[1]))return;
  const key=Math.floor(pt[0]/LM_CELL)+','+Math.floor(pt[1]/LM_CELL),list=lm.cells.get(key)||[];
  if(!lm.cells.has(key))lm.cells.set(key,list);
  if(list.length<60)list.push(rec);
}
function roadPush(pt,name){
  if(!pt||!Number.isFinite(pt[0])||!Number.isFinite(pt[1]))return;
  const key=Math.floor(pt[0]/LM_CELL)+','+Math.floor(pt[1]/LM_CELL);
  if(!lm.roads.has(key))lm.roads.set(key,[]);
  const list=lm.roads.get(key);
  if(list.length<24)list.push({name,x:pt[0],y:pt[1]});
}
function landmarkCells(){
  if(lm.built)return;
  lm.built=true;
  for(const feature of window.NEST_CITY_DATA?.features||[]){
    const p=feature.properties||{},g=feature.geometry,name=String(p.name||'').trim();
    if(!name||!g||name.length<2)continue;
    if(p.kind==='road'){
      const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
      for(const line of lines)for(const pt of line)roadPush(pt,name);
      continue;
    }
    const tag=lmTag(p);
    if(!tag)continue;
    let pt=null;
    if(g.type==='Point')pt=g.coordinates;
    else if(g.type==='MultiPoint')pt=g.coordinates?.[0];
    else if(g.type==='Polygon')pt=ringCentre(g.coordinates?.[0]);
    else if(g.type==='MultiPolygon')pt=ringCentre(g.coordinates?.[0]?.[0]);
    if(!pt||!Number.isFinite(pt[0])||!Number.isFinite(pt[1]))continue;
    lmPush(lm.cells,pt,{name,tag,x:pt[0],y:pt[1]});
  }
}
function landmarksAlong(a,b){
  if(metres(a,b)<45)return [];
  landmarkCells();
  const cells=lm.cells,vx=(b[0]-a[0])*LM_MX,vy=(b[1]-a[1])*LM_MY,square=vx*vx+vy*vy;
  if(!square)return [];
  const hits=[];
  for(let i=Math.floor(Math.min(a[0],b[0])/LM_CELL);i<=Math.floor(Math.max(a[0],b[0])/LM_CELL);i++)
    for(let j=Math.floor(Math.min(a[1],b[1])/LM_CELL);j<=Math.floor(Math.max(a[1],b[1])/LM_CELL);j++)
      for(const p of cells.get(i+','+j)||[]){
        const ex=(p.x-a[0])*LM_MX,ey=(p.y-a[1])*LM_MY,t=(ex*vx+ey*vy)/square;
        if(t<.03||t>.97)continue;
        const perp=Math.abs(vx*ey-vy*ex)/Math.sqrt(square);
        if(perp>70)continue;
        hits.push({name:p.name,tag:p.tag,perp,side:vx*ey-vy*ex>0?'左手边':'右手边',t});
      }
  hits.sort((m,n)=>(m.perp-(m.tag==='楼宇'?0:38)+m.t*60)-(n.perp-(n.tag==='楼宇'?0:38)+n.t*60));
  const seen=new Set(),out=[];
  for(const h of hits){if(seen.has(h.name))continue;seen.add(h.name);out.push(h);if(out.length>=2)break;}
  return out;
}
// 无名步道/小路时，给出平行邻近的有名道路，方便对上地图上的街道。
function nearbyRoad(a,b,exclude){
  const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  landmarkCells();
  let best='',bestD=36;
  for(let i=Math.floor(mid[0]/LM_CELL)-1;i<=Math.floor(mid[0]/LM_CELL)+1;i++)
    for(let j=Math.floor(mid[1]/LM_CELL)-1;j<=Math.floor(mid[1]/LM_CELL)+1;j++)
      for(const p of lm.roads.get(i+','+j)||[]){
        if(!p.name||p.name===exclude)continue;
        const d=metres(mid,[p.x,p.y]);
        if(d<bestD){bestD=d;best=p.name;}
      }
  return best;
}
function legCautions(segs,verb,lengths,legLen){
  const share=new Map();
  const add=(note,len)=>{if(!note)return;share.set(note,Math.min(1,(share.get(note)||0)+len));};
  segs.forEach((s,i)=>{
    if(!s)return;
    const len=lengths[i]||0;
    if(!len||!legLen)return;
    if(s.brunnel==='bridge')add('从'+(s.name||'')+'桥上通过',len/legLen);
    else if(s.brunnel==='tunnel')add('下穿'+(s.name||'')+'通道',len/legLen);
    if(s.sub==='alley')add('穿胡同',len/legLen);
    if(s.steps&&verb!=='乘车')add('有台阶',len/legLen);
    if(s.ramp)add('经匝道',len/legLen);
    if(s.surface==='unpaved')add('非铺装路面',len/legLen);
    if(verb==='步行'&&s.bicycle==='dismount')add('需下车推行',len/legLen);
  });
  return [...share.entries()].filter(([,v])=>v>=.2).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k])=>k);
}
function maneuvers(r){
  const pts=r.coordinates,cumulative=[0],turns=[],segs=r.segs||[];
  for(let i=1;i<pts.length;i++)cumulative.push(cumulative[i-1]+metres(pts[i-1],pts[i]));
  const heading=(a,b)=>Math.atan2((b[0]-a[0])*Math.cos(a[1]*Math.PI/180),b[1]-a[1])*180/Math.PI;
  const cardinal=i=>['北','东北','东','东南','南','西南','西','西北'][((Math.round(i/45)%8)+8)%8];
  for(let i=1;i<pts.length-1;i++){
    let left=i-1,right=i+1;
    while(left>0&&cumulative[i]-cumulative[left]<13)left--;
    while(right+1<pts.length&&cumulative[right]-cumulative[i]<13)right++;
    if(cumulative[i]<10||cumulative.at(-1)-cumulative[i]<10)continue;
    const change=(heading(pts[i],pts[right])-heading(pts[left],pts[i])+540)%360-180;
    if(Math.abs(change)<40)continue;
    const turn={i,angle:change,at:cumulative[i]},prev=turns.at(-1);
    if(prev&&turn.at-prev.at<22&&Math.sign(prev.angle)===Math.sign(change)){
      if(Math.abs(change)>Math.abs(prev.angle))turns[turns.length-1]=turn;
    }else turns.push(turn);
  }
  const verb=modeVerbs[r.mode]||'通行';
  // 40 米内的连续小幅折线合并：保留转角更大的一次，避免"走 14 米再左转"这类噪声。
  const merged=[];
  for(const t of turns){
    const prev=merged.at(-1);
    if(prev&&t.at-prev.at<42){
      if(Math.abs(t.angle)>=Math.abs(prev.angle))merged[merged.length-1]=t;
      continue;
    }
    // 接近终点的小掉头多是坐标吸附造成的往返，合并掉更易读。
    if(Math.abs(t.angle)>148&&cumulative.at(-1)-t.at<300)continue;
    merged.push(t);
  }
  const knots=[{i:0,at:0,angle:0},...merged];
  return knots.map((k,idx)=>{
    const next=knots[idx+1],end=next?next.i:pts.length-1;
    const back=idx?segs[k.i-1]||null:null;
    const cur=String(segs[k.i]?.name||''),prev=String(back?.name||'');
    const dist=Math.max(0,(next?next.at:cumulative.at(-1))-k.at);
    const far=pts[end]&&end!==k.i?pts[end]:pts[Math.min(k.i+1,pts.length-1)];
    const dir=cardinal(heading(pts[k.i],far));
    // 本段主力道路：起点没名字时，用这一段里里程最长的名字（例如先上步道再并入大路）。
    let dominant='',best=0;
    if(!cur){
      const tally=new Map();
      for(let i=k.i;i<end;i++){
        const nm=String(segs[i]?.name||'');
        if(!nm)continue;
        tally.set(nm,(tally.get(nm)||0)+metres(pts[i],pts[i+1]||pts[i]));
      }
      for(const [nm,len] of tally)if(len>best){best=len;dominant=nm;}
    }
    const roadName=cur||dominant;
    const shape=roadLabel(segs[k.i])||roadLabel(segs.find((_,i)=>i>=k.i&&i<end&&segs[i]))||'';
    const along=roadName||shape;
    const turnWord=turnText(k.angle),nextWord=next?turnText(next.angle):null;
    // 标题：动作 + 道路；正文：里程方向、路口、参照物、路况。
    let body;
    if(!idx)body=along?'沿'+along+'向'+dir+verb:'向'+dir+'方向'+verb+'出发';
    else if(roadName&&roadName!==prev)body=turnWord.word+'进入'+roadName;
    else if(roadName)body=turnWord.word+'，继续沿'+roadName+verb;
    else if(shape)body=turnWord.word+'，沿'+shape+verb;
    else body=turnWord.word+'，向'+dir+verb;
    const title=idx?turnWord.arrow+' '+body:body;
    const parts=[];
    parts.push('向'+dir+verb+' '+metric(dist));
    if(cur&&prev&&cur!==prev)parts.push('在'+prev+'与'+cur+'的路口'+turnWord.word);
    else if(idx&&prev)parts.push('在'+prev+'的路口'+turnWord.word);
    const crossings=Math.max(0,end-k.i-1);
    if(crossings)parts.push('途经 '+crossings+' 个路口');
    if(!roadName&&shape){
      const parallel=nearbyRoad(pts[k.i],far,'');
      if(parallel)parts.push('紧邻'+parallel);
    }
    for(const p of landmarksAlong(pts[k.i],pts[Math.max(end,k.i+1)]))parts.push(p.name+'（'+p.side+'·'+p.tag+'）');
    const legSegs=segs.slice(k.i,end),legLens=(r.lengths||[]).slice(k.i+1,end+1);
    parts.push(...legCautions(legSegs,verb,legLens,dist));
    if(nextWord)parts.push('随后'+nextWord.arrow+nextWord.word);
    else parts.push(r.endSnapMeters>5?'此后到达已知街道终点':'此后到达目的地');
    return {point:pts[k.i],turn:idx?turnWord.word:'出发',arrow:turnWord.arrow,title,plain:body,detail:parts.filter(Boolean).join(' · '),distance:k.at};
  });
}
const railGraph=new Map();
for(const [line,edges] of Object.entries(railSections))for(const [a,b,d] of edges){
  if(!stationIndex.has(a)||!stationIndex.has(b)||a===b)continue;
  for(const [from,to] of [[a,b],[b,a]]){
    if(!railGraph.has(from))railGraph.set(from,[]);
    railGraph.get(from).push({to,line,minutes:.55+d/680});
  }
}
function stationWalks(point,outbound){
  const near=[...railGraph.keys()].map(name=>{const p=stationPoint(stationIndex.get(name));return {name,p,d:metres(point,p)};})
    .filter(s=>s.d<=2200).sort((a,b)=>a.d-b.d).slice(0,5);
  return near.map(s=>({...s,walk:outbound?streetLeg(point,s.p,'walk'):streetLeg(s.p,point,'walk')}))
    .filter(s=>s.walk&&s.walk.totalMeters<=3000);
}
function metroJourney(start,end){
  const walk=metres(start,end)<1800?streetLeg(start,end,'walk'):null;
  const direct=walk&&walk.totalMeters<1800?{direct:walk,minutes:walk.minutes}:null;
  const entries=stationWalks(start,true),exits=stationWalks(end,false);
  if(!entries.length||!exits.length)return direct;
  // Search by station and current line. Waiting and transfers are charged once at boarding.
  const queue=[],best=new Map(),finish=new Map(exits.map(s=>[s.name,s]));
  function add(n){const key=n.entry.name+'|'+n.name+'|'+n.line;if(n.time>=(best.get(key)??Infinity))return;best.set(key,n.time);queue.push({...n,key});}
  for(const entry of entries)add({entry,name:entry.name,line:'',time:entry.walk.minutes,parent:null});
  let winner=null,score=Infinity;
  while(queue.length){
    queue.sort((a,b)=>b.time-a.time);const u=queue.pop();
    if(u.time!==best.get(u.key))continue;if(u.time>=score)break;
    const exit=finish.get(u.name);
    if(u.line&&exit&&exit.name!==u.entry.name&&u.time+exit.walk.minutes<score){score=u.time+exit.walk.minutes;winner={u,exit};}
    for(const edge of railGraph.get(u.name)||[]){
      if(edge.to===u.parent?.name)continue;
      const extra=u.line===edge.line?0:u.line?6:4;
      add({entry:u.entry,name:edge.to,line:edge.line,time:u.time+edge.minutes+extra,parent:u,edge});
    }
  }
  if(direct&&direct.minutes<=score)return direct;
  if(!winner)return null;
  const chain=[];for(let n=winner.u;n.parent;n=n.parent)chain.push(n);
  const rides=[];for(const n of chain.reverse()){
    let ride=rides.at(-1);if(!ride||ride.line!==n.line){ride={line:n.line,stations:[n.parent.name],time:0};rides.push(ride);}
    ride.stations.push(n.name);ride.time+=n.edge.minutes;
  }
  const {entry}=winner.u,{exit}=winner;
  const stops=rides.reduce((sum,r)=>sum+r.stations.length-1,0);
  return {entry,exit,rides,stops,minutes:entry.walk.minutes+exit.walk.minutes+4+6*(rides.length-1)+rides.reduce((v,r)=>v+Math.ceil(r.time),0)};
}

  const themes={walk:[15.4,48,-17,'#6953c5'],bike:[14.6,38,-12,'#087f65'],metro:[12.4,12,0,'#a23960'],taxi:[14.45,52,-18,'#3479a6']};
  const colors={1:'#a4343a',2:'#2254a2',3:'#c34465',4:'#008e83',5:'#ad3092',6:'#a77620',7:'#c77738',8:'#198957',9:'#678422',10:'#0078ac',11:'#c75f53',12:'#94593a',13:'#a47700',14:'#ad6578',15:'#70508a',16:'#48813a',17:'#168682',18:'#685bc7',19:'#a26487',昌平:'#bf5380',房山:'#b75e24',亦庄:'#bd317e',S1:'#8f5339'};
  const railColor=n=>colors[n]||'#617986';
  const lineName=n=>n==='1'?'1号线八通线':n==='4'?'4号线大兴线':/^\d+$/.test(n)?n+'号线':n+'线';
  const coords=p=>{const q=gcjToWgs(p);return [q.lng,q.lat]};
  const inside=(b,p)=>b&&p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];
  const metric=n=>n<1000?Math.round(n)+' 米':(n/1000).toFixed(1)+' 公里';
  window.nestNearestStation=function(listing){
    const gcj={lng:+listing?.lng,lat:+listing?.lat};
    if(!validCoord(gcj))return null;
    const p=coords(gcj);let best=null;
    for(const station of stations){
      const {name}=station,sp=stationPoint(station);
      const d=metres(p,sp);
      if(d<=4200&&(!best||d<best.straightMetres))best={name,displayName:stationDisplayName(name),straightMetres:Math.round(d),lines:[...servedByStation.get(name)].map(lineName),lng:sp[0],lat:sp[1]};
    }
    return best;
  };
  const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n};
  const btn=(label,caption,cls)=>{const n=node('button',cls,caption);n.type='button';n.title=label;n.setAttribute('aria-label',label);return n};
  function path(parent,pts,stroke,width){if(pts.length>1)return vector('polyline',{points:pts.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' '),fill:'none',stroke,'stroke-width':width,'stroke-linejoin':'round','stroke-linecap':'round'},parent)}
  function streetStyle(map,mode){
    const layers=map.getStyle().layers||[];
    for(const l of layers){const kind=l['source-layer'];
      if(l.type==='background')map.setPaintProperty(l.id,'background-color','#edeade');
      if(kind==='water'&&l.type==='fill')map.setPaintProperty(l.id,'fill-color','#a1d2e4');
      if((kind==='park'||kind==='landcover'&&/wood|grass|forest/.test(l.id))&&l.type==='fill')map.setPaintProperty(l.id,'fill-color','#b4d5a5');
      if(kind==='building'&&l.type==='fill')map.setPaintProperty(l.id,'fill-color','#dfd5c9');
      if(l.type==='symbol'&&kind==='transportation_name')map.setLayoutProperty(l.id,'text-field',['coalesce',['get','name:zh'],['get','name'],['get','name:latin']]);
    }
    const source=layers.find(l=>l['source-layer']==='building')?.source,before=layers.find(l=>l.type==='symbol')?.id;if(!source)return;
    map.addLayer({id:'nest-city-buildings',source,'source-layer':'building',type:'fill-extrusion',minzoom:13,paint:{'fill-extrusion-height':['to-number',['get','render_height'],0],'fill-extrusion-base':['to-number',['get','render_min_height'],0],'fill-extrusion-color':['interpolate',['linear'],['to-number',['get','render_height'],0],0,'#eee3cd',18,'#e6d2c4',55,'#d4cbcd',100,'#c2cada'],'fill-extrusion-opacity':.93}},before);
    if(mode==='walk'||mode==='bike')map.addLayer({id:'nest-access-ways',source,'source-layer':'transportation',type:'line',minzoom:13,filter:mode==='bike'?['==',['get','subclass'],'cycleway']:['in',['get','subclass'],['literal',['footway','pedestrian','steps']]],paint:{'line-color':mode==='bike'?'#35977a':'#b39174','line-width':['interpolate',['linear'],['zoom'],13,1,17,3],'line-dasharray':[2,1]}},before);
  }
  window.drawNestMap=function(container,{poi,items=[],mode='walk',onOpen,chosenKey,onSelect,overview=false}){
    if(!validCoord(poi))return ()=>{};
    const [initialZoom,initialPitch,initialBearing,routeColor]=themes[mode],origin=coords(poi),data=window.NEST_CITY_DATA;
    const homes=items.filter(it=>validCoord(it.l)).map(it=>({...it,point:coords(it.l)}));
    const streetMode=mode==='walk'||mode==='bike';
    let selected=streetMode&&!overview?[...homes].sort((a,b)=>a.cm.d-b.cm.d)[0]:null,route=null;
    let center=[...origin],zoom=initialZoom,pitch=initialPitch,bearing=initialBearing,w=1,h=1;
    let frame=0,dead=false,map=null,ready=false,loading=false;
    const root=node('div','ct-map');root.dataset.mode=mode;root.dataset.source='local';
    const stage=node('div','ct-stage');stage.tabIndex=0;stage.setAttribute('role','group');stage.setAttribute('aria-label','地图：方向键平移，加减键缩放');
    if(overview)stage.setAttribute('aria-description','按住 Ctrl 或 Command 滚动，可缩放地图。');
    const canvas=node('canvas','ct-local'),terrain=node('div','ct-online'),overlay=document.createElementNS(svgNS,'svg'),pins=node('div','ct-pins');
    overlay.classList.add('ct-ink');if(mode==='metro'){overlay.setAttribute('role','group');overlay.setAttribute('aria-label','地铁站点与站间连线示意')}else overlay.setAttribute('aria-hidden','true');stage.append(canvas,terrain,overlay,pins);root.append(stage);container.replaceChildren(root);
    const renderer=window.createNestBasemap?.(canvas,data);
    const controls=node('div','ct-controls'),tilt=btn('切换平面或立体视角','3D','ct-tilt'),compass=btn('顺时针旋转地图 30 度','N','ct-compass');
    const plus=btn('放大地图','＋'),minus=btn('缩小地图','−'),fit=btn('显示全部匹配房源','⌖','ct-fit');controls.append(tilt,compass,plus,minus,fit);root.append(controls);
    const legend=node('div','ct-legend'),note=node('div','ct-status'),preview=node('div','ct-preview');note.hidden=preview.hidden=true;note.setAttribute('role','status');root.append(legend,note,preview);
    const foot=node('div','ct-bottom'),scale=node('span','ct-scale'),source=node('span','ct-source');
    const link=(name,url)=>{const a=node('a','',name);a.href=url;a.target='_blank';a.rel='noopener';return a};
    source.append(node('span','ct-method','楼高为地图估值 · '),link('OpenFreeMap','https://openfreemap.org/'),' · ',link('OpenMapTiles','https://openmaptiles.org/'),' · ',link('© OpenStreetMap','https://www.openstreetmap.org/copyright'));foot.append(scale,source);root.append(foot);
    const schedule=()=>{if(!dead&&!frame)frame=requestAnimationFrame(()=>{frame=0;draw()})};
    function project(p){if(ready)return map.project(p);if(renderer)return renderer.project(p);const a=mercator({lng:p[0],lat:p[1]}),b=mercator({lng:center[0],lat:center[1]});return {x:w/2+(a.x-b.x)*512*2**zoom,y:h/2+(a.y-b.y)*512*2**zoom}}
    function unproject(x,y){if(ready){const q=map.unproject([x,y]);return [q.lng,q.lat]}if(renderer)return renderer.unproject(x,y);const c=mercator({lng:center[0],lat:center[1]});return toLngLat({x:c.x+(x-w/2)/(512*2**zoom),y:c.y+(y-h/2)/(512*2**zoom)})}
    function fitPoints(points,automatic){const a=points.map(p=>mercator({lng:p[0],lat:p[1]})),xs=a.map(p=>p.x),ys=a.map(p=>p.y);const x1=Math.min(...xs),x2=Math.max(...xs),y1=Math.min(...ys),y2=Math.max(...ys);center=toLngLat({x:(x2+x1)/2,y:(y2+y1)/2});zoom=clamp(Math.log2(Math.min((stage.clientWidth*.63||400)/Math.max(1e-7,x2-x1),(stage.clientHeight*.65||220)/Math.max(1e-7,y2-y1))/512),9,automatic?initialZoom:16.5);schedule()}
    let streetFocus=false;
    function focusStreet(){const start=selected.point,first=route?.coordinates[0]||start;center=[(start[0]+first[0])/2,(start[1]+first[1])/2];zoom=mode==='walk'?15.75:15.0;schedule()}
    function findRoute(){route=streetMode&&selected?window.getNestStreetRoute?.(selected.point,origin,mode,data):null;legend.replaceChildren(node('i','ct-swatch'),node('b','',{walk:'步行街网',bike:'骑行街网',metro:'地铁站与线路',taxi:'城市道路'}[mode]),node('small','',streetMode?(route?'约 '+metric(route.lengthMeters):'街道与支路'):mode==='metro'?'站间连线示意':'主干道与交叉口'));if(route){const action=btn('在线路全程与房源街道之间切换',streetFocus?'看全程':'看房源街道','ct-trip-fit');action.onclick=()=>{if(streetFocus)fitPoints([origin,selected.point,...route.coordinates],false);else focusStreet();streetFocus=!streetFocus;action.textContent=streetFocus?'看全程':'看房源街道'};legend.append(action)}}
        const sheet=node('section','trip-sheet');sheet.hidden=true;sheet.setAttribute('aria-label','所选房源的通勤行程');
    (container.closest('#homeAtlas')||container).after(sheet);
    let transit=null,steps=[],tripOpen=false,currentStep=null;
    function journeyPoints(){
      if(transit?.rides)return [selected.point,...transit.entry.walk.coordinates,...transit.rides.flatMap(r=>r.stations.map(s=>stationPoint(stationIndex.get(s)))),...transit.exit.walk.coordinates,origin];
      return [selected.point,...(route?.coordinates||[]),origin];
    }
    function fullJourney(){currentStep=null;bearing=0;fitPoints(journeyPoints(),false);}
    function focusStep(points){
      currentStep=points[0];
      if(points.length===1){center=points[0];zoom=Math.max(zoom,15.9);schedule();}
      else fitPoints(points,false);
    }
    function stepRow(list,mark,title,description,points,color){
      const li=node('li'),b=btn('在地图上查看'+title,'','trip-step'),copy=node('span','trip-step-copy');
      const badge=node('b','trip-mark',mark);if(color)badge.style.setProperty('--mark',color);
      copy.append(node('strong','',title),node('small','',description));b.append(badge,copy);
      b.onclick=()=>{focusStep(points);if(stage.getBoundingClientRect().bottom<100)stage.scrollIntoView({block:'center'});};
      li.append(b);list.append(li);return li;
    }
    function connectionStep(list,meters,points,atStart,color){
      if(meters<=5)return;
      stepRow(list,'接',atStart?'接入街网':'从街网到达终点',
        '距已知道路约 '+metric(meters)+' · 虚线表示位置关系，请核对实际走法',points,color);
    }
    function listWalk(part,where,from,to,list,start,end){
      const row=stepRow(list,'步',where,from+' → '+to+' · '+metric(part.totalMeters)+' · 约 '+part.minutes+' 分钟',[start,...part.coordinates,end],'#557969');
      if(part.lengthMeters<2)return;
      const directions=node('details','trip-walk'),sum=node('summary','','查看步行走法');directions.append(sum);
      const sub=node('ol');
      connectionStep(sub,part.startSnapMeters,[start,part.coordinates[0]],true,'#557969');
      for(const s of maneuvers(part))stepRow(sub,s.arrow||'·',s.plain||s.title,s.detail,[s.point]);
      connectionStep(sub,part.endSnapMeters,[part.coordinates.at(-1),end],false,'#557969');
      directions.append(sub);row.append(directions);
    }
    function showJourney(group,item){
      activeLine=null;selected=item;streetFocus=false;tripOpen=true;onSelect?.(item.l.key);preview.hidden=true;
      transit=mode==='metro'?metroJourney(item.point,origin):null;
      route=transit?.direct||((streetMode||mode==='taxi')?streetLeg(item.point,origin,mode):null);
      steps=route?.lengthMeters?maneuvers(route):[];
      const tripMode=transit?.direct?'walk':mode;
      const minutes=transit?.minutes??route?.minutes, title=node('div','trip-title');
      title.append(node('small','','房源到实习地点 · '+modeLabels[tripMode]),node('h3','',item.l.community+' → '+poi.name));
      const headline=node('header','trip-head'),eta=node('strong','trip-eta',minutes!=null?'约 '+minutes+' 分钟':'暂无完整路线');
      headline.append(title,eta);sheet.replaceChildren(headline);
      const actions=node('div','trip-actions');
      if(group.length>1){
        const sel=node('select','ct-choice');sel.setAttribute('aria-label','选择附近的房源');
        group.forEach(v=>sel.add(new Option(v.l.community+' · '+v.l.roomType+' · ¥'+money(v.total),v.l.key)));
        sel.value=item.l.key;sel.onchange=()=>showJourney(group,group.find(v=>v.l.key===sel.value));actions.append(sel);
      }
      const back=btn(minutes!=null?'查看整条路线':'查看房源和实习地点',minutes!=null?'全程视图':'查看两端位置','trip-action');back.onclick=fullJourney;
      const open=btn('查看所选房源的详情','房源详情','trip-action');open.onclick=()=>onOpen(item.iid);
      actions.append(back,open,link('高德路线规划',window.nestDirectionsURL([+item.l.lng,+item.l.lat],[+poi.lng,+poi.lat],tripMode,item.l.community,poi.name)));
      const list=node('ol','trip-list');sheet.append(list);
      if(transit?.rides){
        const {entry,exit,rides,stops}=transit;
        eta.append(node('small','',stops+' 站 · '+(rides.length===1?'直达':'换乘 '+(rides.length-1)+' 次')));
        const entryName=stationDisplayName(entry.name),exitName=stationDisplayName(exit.name);
        listWalk(entry.walk,'步行到'+entryName,item.l.community,entryName,list,item.point,entry.p);
        rides.forEach((r,i)=>{
          const ss=r.stations,from=stationDisplayName(ss[0]),to=stationDisplayName(ss.at(-1)),next=ss[1];
          const li=stepRow(list,i?'换':'乘',from+(i?'换乘':'乘坐')+lineName(r.line),'下一站 '+next+' · 坐 '+(ss.length-1)+' 站至'+to+' · 约 '+Math.ceil(r.time)+' 分钟',ss.map(s=>stationPoint(stationIndex.get(s))),railColor(r.line));
          const d=node('details','trip-walk');d.append(node('summary','','途经站点'),node('p','',ss.join(' → ')));li.append(d);
        });
        listWalk(exit.walk,exitName+'下车后步行',exitName,poi.name,list,exit.p,origin);
      }else if(route){
        eta.append(node('small','',metric(route.totalMeters)+(transit?.direct?' · 建议步行':' · '+modeLabels[mode])+(route.segs?.length?' · 本地街网逐段推算':'')));
        if(transit?.direct)sheet.insertBefore(node('p','trip-hint','这段通勤距离较短，建议直接步行。'),list);
        const color=transit?.direct?themes.walk[3]:routeColor;
        connectionStep(list,route.startSnapMeters,[item.point,route.coordinates[0]],true,color);
        let target=list;steps.forEach((s,i)=>{
          if(i===4&&steps.length>5){const holder=node('li'),more=node('details','trip-walk'),rest=node('ol');more.append(node('summary','','其余 '+(steps.length-4)+' 段走法'),rest);holder.append(more);list.append(holder);target=rest;}
          stepRow(target,String(i+1),s.title,s.detail,[s.point],color);
        });
        if(route.endSnapMeters>5){
          connectionStep(list,route.endSnapMeters,[route.coordinates.at(-1),origin],false,color);
        }else{
          stepRow(list,'终','到达'+poi.name,'到达实习地点附近',[origin],'#2879a5');
        }
      }else{
        list.remove();sheet.append(node('p','trip-hint',mode==='metro'?'本地数据未找到含两端步行的连通地铁行程。可切换出行方式，或打开高德路线规划。':'附近街网未能连接这两个地点。可打开高德路线规划查看可用路线。'));
      }
      const footCopy=transit?.rides?'含首次候车约 4 分钟，每次换乘约 6 分钟。粗虚线示意站间走向，细虚线标示步行接驳位置。实际出入口请用高德核对。':route?'路线按内置街网估算。实线为已连接的道路，虚线标示模拟点位到街网的距离，实际出入口及走法请用高德核对。':'';
      if(footCopy)sheet.append(node('p','trip-hint',footCopy));sheet.append(actions);sheet.hidden=false;
      const swatch=node('i','ct-swatch');
      if(transit?.direct)swatch.style.background=themes.walk[3];
      legend.replaceChildren(swatch,node('b','',modeLabels[tripMode]+'行程'),node('small','',minutes!=null?'约 '+minutes+' 分钟':'暂无完整路线'));
      const itinerary=btn(minutes!=null?'查看所选房源的行程步骤':'查看路线规划选项',minutes!=null?'行程步骤 ↓':'路线选项 ↓','ct-trip-fit');itinerary.onclick=()=>sheet.scrollIntoView({block:'nearest'});legend.append(itinerary);
      root.dataset.listing=item.l.key;fullJourney();
    }
    function annotate(ink){
      if(!tripOpen)return;
      function badge(coord,label,color){const p=project(coord);if(p.x<0||p.x>w||p.y<0||p.y>h)return;
        const g=vector('g',{'pointer-events':'none'},ink);vector('circle',{cx:p.x,cy:p.y,r:10,fill:color,stroke:'white','stroke-width':2},g);
        vector('text',{x:p.x,y:p.y+3.6,'text-anchor':'middle',class:'trip-map-number'},g).textContent=label;}
      if(transit?.rides){
        const access=[[transit.entry.walk,selected.point,transit.entry.p],[transit.exit.walk,transit.exit.p,origin]];
        for(const [leg,a,b] of access){
          const pts=leg.coordinates.map(q=>project(q));path(ink,pts,'white',7);path(ink,pts,'#427c67',4);
          for(const [p,q] of [[project(a),pts[0]],[pts.at(-1),project(b)]])vector('line',{x1:p.x,y1:p.y,x2:q.x,y2:q.y,stroke:'#427c67','stroke-width':2.5,'stroke-dasharray':'3 4'},ink);
        }
        for(const ride of transit.rides){const pts=ride.stations.map(s=>project(stationPoint(stationIndex.get(s))));path(ink,pts,'#fff',9);path(ink,pts,railColor(ride.line),5.5)?.setAttribute('stroke-dasharray','6 4');for(const p of pts)vector('circle',{cx:p.x,cy:p.y,r:2.6,fill:'white',stroke:railColor(ride.line)},ink);}
        transit.rides.forEach((r,i)=>badge(stationPoint(stationIndex.get(r.stations[0])),i?'换':'上',railColor(r.line)));badge(transit.exit.p,'下','#37494f');
      }else if(steps.length){
        let last;steps.forEach((s,i)=>{if(!i)return;const p=project(s.point);if(last&&Math.hypot(last.x-p.x,last.y-p.y)<24&&s.point!==currentStep)return;badge(s.point,String(i+1),transit?.direct?themes.walk[3]:routeColor);last=p;});
      }
      if(currentStep){const p=project(currentStep);vector('circle',{cx:p.x,cy:p.y,r:15,fill:'none',stroke:'#244b68','stroke-width':2,'stroke-dasharray':'3 3'},ink);}
    }

    let activeLine=null;
    function stationCard(station,served,focusedLine){
      const label=node('div','ct-selection-label');label.append(node('b','',stationDisplayName(station.name)),node('span','',served.size>1?'换乘站 · 点选线路可高亮':'点选线路可高亮'));
      const chips=node('div','ct-lines');for(const n of served){const chip=btn('高亮'+lineName(n),lineName(n),'ct-line-chip');chip.style.setProperty('--rail',railColor(n));chip.dataset.line=n;chip.setAttribute('aria-pressed',String(activeLine===n));chip.onclick=()=>{activeLine=activeLine===n?null:n;stationCard(station,served,n);schedule()};chips.append(chip);}
      const close=btn('关闭车站信息','×','ct-dismiss');close.onclick=()=>{preview.hidden=true;activeLine=null;schedule();stage.focus({preventScroll:true})};preview.replaceChildren(label,chips,close);preview.hidden=false;if(focusedLine)chips.querySelector('[data-line="'+focusedLine+'"]')?.focus();
    }
    function drawOverlay(){
      const focused=document.activeElement;
      const focusKey=pins.contains(focused)||overlay.contains(focused)?focused.getAttribute('data-map-focus'):null;
      let nextFocus=null;
      const ink=document.createDocumentFragment(), markers=document.createDocumentFragment(), occupied=[];
      const visible=(p,m=0)=>p.x>=-m&&p.y>=-m&&p.x<=w+m&&p.y<=h+m;
      const a=project(origin), groups=[];
      for(const item of homes){const p=project(item.point);if(!visible(p,-3))continue;
        const near=groups.find(g=>Math.abs(g.p.x-p.x)<64&&Math.abs(g.p.y-p.y)<24);
        if(near)near.members.push(item);else groups.push({p,members:[item]});}
      for(const {p} of groups)occupied.push([p.x-36,p.y-29,p.x+36,p.y+2]);
      occupied.push([a.x-35,a.y-8,a.x+35,a.y+24],[0,0,112,61],[w-55,0,w,198]);
      function free(x,y,dx,dy){if(x<2||y<1||x+dx>w-1||y+dy>h-12||occupied.some(b=>x<b[2]&&x+dx>b[0]&&y<b[3]&&y+dy>b[1]))return false;occupied.push([x,y,x+dx,y+dy]);return true;}
      if(mode==='metro'){
        const ordered=activeLine?[...lines.keys()].filter(n=>n!==activeLine).concat(activeLine):[...lines.keys()];
        const drawLabels=[];
        for(const number of ordered){
          const muted=activeLine?activeLine!==number:Boolean(transit?.rides);
          for(const section of lines.get(number)){
            const points=section.map(s=>project(stationPoint(s)));
            if(!points.some(p=>visible(p,250)))continue;
            path(ink,points,'#fffef8',6.5);
            const stroke=path(ink,points,muted?'#aaada8':railColor(number),activeLine===number?5:3.8);
            stroke.setAttribute('data-metro-line',number);
            stroke.setAttribute('stroke-dasharray','5 3');
            if(!muted)drawLabels.push({number,points});
          }
        }
        for(const s of stations){
          const served=servedByStation.get(s.name);
          const p=project(stationPoint(s));
          if(!visible(p,6))continue;
          const transfer=served.size>1, muted=Boolean(activeLine&&!served.has(activeLine));
          const stationGroup=vector('g',{role:'button',tabindex:0,'aria-label':stationDisplayName(s.name)+'，'+[...served].map(lineName).join('、')},ink);
          const focusId='station:'+s.name;
          stationGroup.setAttribute('data-map-focus',focusId);
          if(focusKey===focusId)nextFocus=stationGroup;
          stationGroup.onclick=()=>stationCard(s,served);
          stationGroup.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();stationCard(s,served);preview.querySelector('button')?.focus()}};
          vector('circle',{cx:p.x,cy:p.y,r:10,fill:'transparent'},stationGroup);
          const stroke=muted?'#9b9e99':transfer?'#443e51':railColor([...served][0]);
          vector('circle',{cx:p.x,cy:p.y,r:transfer?4.8:3.4,fill:'#fffcfa',stroke,'stroke-width':transfer?2.3:1.6},stationGroup);
          if(!muted&&free(p.x+5,p.y-17,s.name.length*12.4,16))vector('text',{x:p.x+7,y:p.y-5,class:'ct-station-label'},stationGroup).textContent=s.name;
        }
        const labelled=new Set();
        for(const {number,points} of drawLabels){
          if(labelled.has(number))continue;
          const caption=lineName(number),width=caption.length*10+10;
          for(let j=1;j<points.length;j++){
            const x=(points[j].x+points[j-1].x)/2,y=(points[j].y+points[j-1].y)/2;
            if(!free(x-width/2,y-8,width,15))continue;
            vector('rect',{x:x-width/2,y:y-8,width,height:15,rx:4,fill:railColor(number),'pointer-events':'none'},ink);
            vector('text',{x,y:y+3,'text-anchor':'middle',class:'ct-line-label','pointer-events':'none'},ink).textContent=caption;
            labelled.add(number);break;
          }
        }
      }
      if(route){const pts=route.coordinates.map(p=>project(p)),color=transit?.direct?themes.walk[3]:routeColor;path(ink,pts,'#fffefb',8);path(ink,pts,color,4.8);
        let walked=0;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(!len)continue;for(let d=100-(walked%100);d<len;d+=100){const x=a.x+dx*d/len,y=a.y+dy*d/len;if(!visible({x,y},4))continue;vector('path',{d:'M-3,-2.5 L0,0 L-3,2.5',transform:`translate(${x} ${y}) rotate(${Math.atan2(dy,dx)*180/pi})`,fill:'none',stroke:'white','stroke-width':1.5,'stroke-linecap':'round','stroke-linejoin':'round'},ink)}walked+=len;}

        for(const [a,b] of [[project(selected.point),pts[0]],[pts.at(-1),project(origin)]]){if(Math.hypot(a.x-b.x,a.y-b.y)<4)continue;const connector=vector('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:color,'stroke-width':2.4,'stroke-dasharray':'2 4','stroke-linecap':'round'},ink);vector('title',{},connector).textContent='地点到附近街道的直线示意';}
        for(const p of [pts[0],pts.at(-1)])vector('circle',{cx:p.x,cy:p.y,r:4.2,fill:'#fff',stroke:color,'stroke-width':2},ink);}
      annotate(ink);
      for(const {p,members} of groups){const active=members.includes(selected), item=active?selected:members[0];if(active){p.x=project(item.point).x;p.y=project(item.point).y;}const tag=btn('查看'+item.l.area+'附近房源，月总 '+money(item.total)+' 元','¥'+money(item.total),'ct-pin'+(active?' active':''));
        if(members.length>1)tag.append(node('small','',members.length));tag.style.left=p.x+'px';tag.style.top=p.y+'px';tag.onclick=()=>showJourney(members,item);
        const focusId='listing:'+item.l.key;
        tag.dataset.mapFocus=focusId;
        if(focusKey===focusId)nextFocus=tag;
        markers.append(tag);}
      if(visible(a,50)){const mark=node('div','ct-origin');mark.style.left=a.x+'px';mark.style.top=a.y+'px';mark.append(node('i'),node('b','','实习 · '+poi.name));markers.append(mark);}
      overlay.setAttribute('viewBox',`0 0 ${w} ${h}`);overlay.replaceChildren(ink);pins.replaceChildren(markers);
      if(focusKey)(nextFocus||stage).focus({preventScroll:true});
    }
    // The embedded city renders first. Load more detailed online tiles only outside its detailed neighborhood.
    let remoteFailed=false,remoteLoaded=false;
    async function loadOnline(){loading=true;try{
      const api=await streetEngine();if(dead)return;
      map=new api.Map({container:terrain,style:'https://tiles.openfreemap.org/styles/liberty',center,zoom,pitch,bearing,interactive:false,attributionControl:false,renderWorldCopies:false});
      map.once('style.load',()=>{if(!dead)streetStyle(map,mode)});
      map.on('load',()=>{remoteLoaded=true;remoteFailed=false;schedule()});map.on('error',()=>{if(!remoteLoaded){remoteFailed=true;schedule()}});
    }catch{remoteFailed=true;schedule()}}
    function draw(){
      w=stage.clientWidth;h=stage.clientHeight;if(w<2||h<2)return;
      const beyondDetail=!inside(data?.detailBBox,center),beyondCity=!inside(data?.bbox,center);
      const wantsRemote=beyondCity||zoom>=14&&beyondDetail;
      if(wantsRemote&&!loading&&navigator.onLine)loadOnline();
      ready=Boolean(wantsRemote&&remoteLoaded&&!remoteFailed);
      if(ready){map.resize();map.jumpTo({center,zoom,pitch,bearing});}else renderer?.draw({center,zoom,pitch,bearing,mode,width:w,height:h});
      root.dataset.source=ready?'online':'local';root.dataset.zoom=zoom.toFixed(2);root.dataset.pitch=pitch;root.dataset.route=route?String(route.lengthMeters):'';
      if(beyondCity&&!ready){note.textContent=remoteFailed||!navigator.onLine?'此处超出离线地图范围':'正在载入此处的地图…';note.hidden=false;}else note.hidden=true;
      drawOverlay();tilt.setAttribute('aria-pressed',String(pitch>0));compass.style.setProperty('--north',-bearing+'deg');
      const metersPixel=40075017*Math.cos(center[1]*pi/180)/(512*2**zoom),raw=metersPixel*70,power=10**Math.floor(Math.log10(raw)),bar=([5,2,1].find(v=>v*power<=raw)||1)*power;
      scale.style.width=(bar/metersPixel)+'px';scale.textContent=metric(bar);
    }
    const zoomBy=v=>{zoom=clamp(zoom+v,9,18.25);schedule()};
    plus.onclick=()=>zoomBy(.75);minus.onclick=()=>zoomBy(-.75);tilt.onclick=()=>{pitch=pitch?0:Math.max(36,initialPitch);schedule()};compass.onclick=()=>{bearing=(bearing+30)%360;schedule()};
    fit.onclick=()=>{if(homes.length)fitPoints([origin,...homes.map(v=>v.point)],false);else{center=[...origin];zoom=initialZoom;schedule()}};
    function pan(dx,dy){
      const current=project(center);
      center=unproject(current.x-dx,current.y-dy);
      schedule();
    }
    stage.addEventListener('keydown',e=>{if(e.target!==stage)return;const directions={ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]};if(directions[e.key]){e.preventDefault();pan(...directions[e.key])}else if(['+','=','-'].includes(e.key)){e.preventDefault();zoomBy(e.key==='-'?-.6:.6)}});
    stage.addEventListener('wheel',e=>{
      if((overview&&!e.ctrlKey&&!e.metaKey)||!e.deltaY||!e.cancelable)return;
      e.preventDefault();
      const unit=e.deltaMode===1?16:e.deltaMode===2?h:1;
      const d=clamp(e.deltaY*unit/100,-1,1);
      zoomBy(-d*.4);
    },{passive:false});
    const pointers=new Map();let span=0;
    const spacing=()=>{const [a,b]=pointers.values();return b?Math.hypot(a.x-b.x,a.y-b.y):0};
    stage.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,[role=button]'))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});span=spacing();stage.setPointerCapture(e.pointerId)});
    stage.addEventListener('pointermove',e=>{const last=pointers.get(e.pointerId);if(!last)return;const dx=e.clientX-last.x,dy=e.clientY-last.y;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const s=spacing();if(s&&span){zoomBy(Math.log2(s/span));span=s;}else if(e.shiftKey){bearing=(bearing+dx*.4)%360;schedule()}else pan(dx,dy)});
    const release=e=>{pointers.delete(e.pointerId);span=spacing()};stage.addEventListener('lostpointercapture',release);stage.addEventListener('pointerup',release);stage.addEventListener('pointercancel',release);
    findRoute();if(streetMode&&selected)fitPoints([origin,selected.point,...(route?.coordinates||[])],true);
    if(streetMode&&selected&&route&&zoom<14.4){streetFocus=true;if(mode==='walk')fitPoints([origin,selected.point],true);else focusStreet();legend.querySelector('.ct-trip-fit').textContent='看全程'}
    if(mode==='taxi'&&homes.length){const near=[...homes].sort((a,b)=>a.cm.d-b.cm.d)[0];fitPoints([origin,near.point],true);if(zoom<13.65){center=[...origin];zoom=14.45;}
      let all=false;const overview=btn('切换打车房源分布与实习地点','看房源分布','ct-trip-fit');overview.onclick=()=>{if(all){center=[...origin];zoom=14.45;schedule()}else fitPoints([origin,...homes.map(v=>v.point)],false);all=!all;overview.textContent=all?'看实习地点':'看房源分布'};legend.append(overview)}
    const chosen=homes.find(v=>v.l.key===chosenKey);if(chosen)showJourney([chosen],chosen);
    if(overview&&!chosen&&homes.length)fitPoints([origin,...homes.map(item=>item.point)],true);
    draw();const observer=new ResizeObserver(schedule);observer.observe(stage);
    return ()=>{dead=true;cancelAnimationFrame(frame);observer.disconnect();if(map)map.remove();renderer?.destroy();root.remove();sheet.remove()};
  };
})();

(() => {
  'use strict';
  const TAU=Math.PI*2, clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
  const tones=new Map();
  function tone(hex,light) {
    const key=hex+':'+light;
    if (!tones.has(key)) {
      const rgb=[1,3,5].map(i=>clamp(Math.round(parseInt(hex.slice(i,i+2),16)*light),0,255));
      tones.set(key,{rgb:rgb.map(n=>n/255),css:'rgb('+rgb.join(',')+')'});
    }
    return tones.get(key);
  }
  function planInterior(listing, character) {
    const roomCount = clamp(parseInt(listing.layout, 10) || listing.rooms || 2, 1, 6);
    const bathroomCount = clamp(Number(String(listing.layout).match(/(\d+)\s*卫/)?.[1] || 1), 1, 3);
    const selectedRoom = clamp(character.roomIndex, 0, roomCount - 1);
    const hasEnsuite = String(listing.roomType).includes('独卫');
    const sharedBathrooms = bathroomCount - Number(hasEnsuite);
    const features = character.features;
    const bedroomDepth = 4.3, commonDepth = 4.5, corridorWidth = 1.1;
    let frontCount = 0;
    if (roomCount >= 5 || ['double', 'cluster'].includes(character.archetype) && roomCount >= 4) {
      frontCount = Math.floor(roomCount / 2);
    } else if (['lshape', 'corridor'].includes(character.archetype) && roomCount >= 3) {
      frontCount = 1;
    }
    const rearCount = roomCount - frontCount;
    const roomWidths = Array.from({length: roomCount}, (_, index) =>
      hasEnsuite && index === selectedRoom ? 4.3 : 3.2);
    const rearWidth = roomWidths.slice(0, rearCount).reduce((sum, value) => sum + value, 0);
    const frontWidth = roomWidths.slice(rearCount).reduce((sum, value) => sum + value, 0);
    const serviceWidth = sharedBathrooms > 1 ? sharedBathrooms * 2.3 : 2.6;
    const width = Math.max(rearWidth, frontWidth + 3.3 + serviceWidth);
    const depth = bedroomDepth + corridorWidth + commonDepth;
    const commonZ = bedroomDepth + corridorWidth;
    const serviceX = width - serviceWidth;
    const zones = [], items = [], routes = [], clearances = [], walls = [], doors = [];
    const wallKeys = new Set();
    const overlaps = (a, b, gap = 0) =>
      a.x < b.x + b.w + gap - 1e-7 && a.x + a.w > b.x - gap + 1e-7 &&
      a.z < b.z + b.d + gap - 1e-7 && a.z + a.d > b.z - gap + 1e-7;
    function zone(id, type, x, z, w, d, reverse = false) {
      const result = {id, type, x, z, w, d, reverse};
      zones.push(result);
      return result;
    }
    function world(area, rect) {
      return {...rect, x: area.x + rect.x,
        z: area.reverse ? area.z + area.d - rect.z - rect.d : area.z + rect.z};
    }
    function reserve(area, name, rect) {
      const result = {...world(area, rect), zone: area.id, name};
      routes.push(result);
      return result;
    }
    function place(area, type, rect, options = {}) {
      const candidate = {...world(area, rect), type, zone: area.id, reverse: area.reverse};
      const access = (options.access || []).map(value => world(area, value));
      const inside = rect.x >= .1 - 1e-7 && rect.z >= .1 - 1e-7 &&
        rect.x + rect.w <= area.w - .1 + 1e-7 && rect.z + rect.d <= area.d - .1 + 1e-7;
      const blocked = !inside || items.some(item => overlaps(candidate, item, .04)) ||
        routes.some(path => overlaps(candidate, path)) ||
        clearances.some(space => overlaps(candidate, space)) ||
        access.some(space => items.some(item => overlaps(space, item)));
      if (blocked) {
        if (options.required) throw new Error('家具空间不足：' + area.id + '/' + type);
        return null;
      }
      items.push(candidate);
      clearances.push(...access.map(space => ({...space, zone: area.id, owner: type})));
      return candidate;
    }
    function wall(x1, z1, x2, z2, openings = [], style = 'solid') {
      const horizontal = Math.abs(z2 - z1) < 1e-7;
      const low = horizontal ? Math.min(x1, x2) : Math.min(z1, z2);
      const high = horizontal ? Math.max(x1, x2) : Math.max(z1, z2);
      const fixed = horizontal ? z1 : x1;
      const key = [horizontal, fixed, low, high].map(value =>
        typeof value === 'number' ? value.toFixed(5) : value).join('/');
      if (wallKeys.has(key)) return;
      wallKeys.add(key);
      let segments = [[low, high]];
      openings.forEach(opening => {
        doors.push({axis: horizontal ? 'x' : 'z', fixed, center: opening.center,
          width: opening.width, zone: opening.zone});
        segments = segments.flatMap(([a, b]) => [
          [a, Math.min(b, opening.center - opening.width / 2)],
          [Math.max(a, opening.center + opening.width / 2), b],
        ].filter(([start, end]) => end > start + 1e-7));
      });
      segments.forEach(([start, end]) => walls.push({
        axis: horizontal ? 'x' : 'z', fixed, start, end, style,
      }));
    }
    function roomWalls(room) {
      const headZ = room.reverse ? room.z + room.d : room.z;
      const doorZ = room.reverse ? room.z : room.z + room.d;
      const headEnd = room.ensuite ? room.x + room.w - 1.8 : room.x + room.w;
      wall(room.x, headZ, headEnd, headZ, [], 'window');
      if (room.ensuite) wall(headEnd, headZ, room.x + room.w, headZ, [],
        features.darkBath ? 'solid' : 'frosted');
      wall(room.x, doorZ, room.x + room.w, doorZ,
        [{center: room.x + room.w - .65, width: .85, zone: room.id}]);
      wall(room.x, room.z, room.x, room.z + room.d);
      wall(room.x + room.w, room.z, room.x + room.w, room.z + room.d);
    }
    function bathroom(area, privateBath = false) {
      const westDoor = privateBath;
      const doorCenter = westDoor ? area.d - .55 : .55;
      const minZ = area.z, maxZ = area.z + area.d;
      if (westDoor) {
        const center = area.reverse ? maxZ - doorCenter : minZ + doorCenter;
        wall(area.x, minZ, area.x, maxZ, [{center, width: .7, zone: area.id}]);
        reserve(area, '浴室入口', {x: .1, z: area.d - 1.02, w: .65, d: .9});
        const outside = world(area, {x: -.7, z: area.d - 1.02, w: .7, d: .9});
        routes.push({...outside, zone: area.id, name: '套卫门外通道'});
      } else {
        const doorZ = area.reverse ? minZ : maxZ;
        wall(area.x, doorZ, area.x + area.w, doorZ,
          [{center: area.x + doorCenter, width: .75, zone: area.id}]);
        wall(area.x, minZ, area.x, maxZ);
        reserve(area, '浴室入口', {x: .1, z: 1.04, w: .88, d: area.d - 1.15});
      }
      const headZ = area.reverse ? maxZ : minZ;
      if (headZ > .01 && headZ < depth - .01) wall(area.x, headZ, area.x + area.w, headZ);
      if (westDoor) {
        const otherZ = area.reverse ? minZ : maxZ;
        wall(area.x, otherZ, area.x + area.w, otherZ);
      }
      wall(area.x + area.w, minZ, area.x + area.w, maxZ, [],
        !features.darkBath && Math.abs(area.x + area.w - width) < .01 ? 'frosted' : 'solid');
      if (privateBath) {
        place(area, 'basin', {x: .12, z: .12, w: .45, d: .4}, {required: true});
        place(area, 'shower', {x: area.w - .92, z: .12, w: .8, d: .8}, {required: true});
        place(area, 'toilet', {x: area.w - .62, z: 1.25, w: .46, d: .64}, {required: true});
      } else {
        place(area, 'shower', {x: .12, z: .12, w: .82, d: .82}, {required: true});
        place(area, 'basin', {x: area.w - .68, z: .14, w: .55, d: .43}, {required: true});
        place(area, 'toilet', {x: area.w - .67, z: 1.15, w: .46, d: .67}, {required: true});
      }
    }
    function furnishBedroom(room, index) {
      room.ensuite = hasEnsuite && index === selectedRoom;
      room.selected = index === selectedRoom;
      room.index = index;
      const mattressWidth = features.singleBed && room.selected ? 1.05 : 1.35;
      const bed = {x: .16, z: .16, w: mattressWidth + .12, d: 2.11};
      reserve(room, '床侧通道', {x: Math.max(1.75, bed.x + bed.w + .12), z: .78,
        w: .65, d: room.d - .93});
      reserve(room, '床尾通道', {x: .12, z: 2.32, w: bed.x + bed.w + .73, d: .6});
      reserve(room, '卧室门口', {x: room.w - 1.15, z: room.d - 1.0, w: .95, d: .9});
      let bath;
      if (room.ensuite) {
        const rect = world(room, {x: room.w - 1.8, z: 0, w: 1.8, d: 2.05});
        bath = zone(room.id + '-bath', 'bathroom', rect.x, rect.z, rect.w, rect.d, room.reverse);
        // Reserve the complete enclosure before any bedroom furniture is placed.
        routes.push({...rect, zone: room.id, name: '套卫占地'});
      }
      place(room, 'bed', bed, {required: true});
      const desk = {x: .18, z: room.d - .68, w: features.bigDesk ? 1.3 : 1.05, d: .54};
      place(room, 'desk', desk, {required: true});
      place(room, 'chair', {x: desk.x + (desk.w - .48) / 2, z: room.d - 1.28, w: .48, d: .5},
        {required: true});
      const wardrobe = {x: room.w - .72, z: room.ensuite ? 2.28 : .95, w: .6, d: room.ensuite ? .9 : 1.15};
      if (features.wardrobe || features.shelf) {
        place(room, features.wardrobe ? 'wardrobe' : 'clothesRack', wardrobe, {
          required: true, access: [{x: wardrobe.x - .65, z: wardrobe.z, w: .65, d: wardrobe.d}],
        });
      }
      if (features.bedsideTable) place(room, 'nightstand',
        {x: bed.x + bed.w + .1, z: .22, w: .38, d: .4});
      if (features.shelf) place(room, 'bookcase',
        {x: room.w - .72, z: .56, w: .55, d: .32});
      if (features.plant) place(room, 'plant',
        {x: room.w - .58, z: .22, w: .4, d: .4});
      if (features.floorLamp) place(room, 'floorLamp', {x: .18, z: 2.96, w: .36, d: .36});
      roomWalls(room);
      if (bath) {
        // Fixtures belong to the nested bathroom rather than its bedroom reservation.
        const reserveIndex = routes.findIndex(path => path.zone === room.id && path.name === '套卫占地');
        routes.splice(reserveIndex, 1);
        bathroom(bath, true);
        routes.push({...bath, zone: room.id, name: '套卫占地'});
      }
    }
    let rearX = 0;
    const extraRear = (width - rearWidth) / rearCount;
    for (let index = 0; index < rearCount; index++) {
      const room = zone('bedroom-' + index, 'bedroom', rearX, 0,
        roomWidths[index] + extraRear, bedroomDepth);
      furnishBedroom(room, index);
      rearX += room.w;
    }
    let frontX = 0;
    for (let index = rearCount; index < roomCount; index++) {
      const room = zone('bedroom-' + index, 'bedroom', frontX, commonZ,
        roomWidths[index], commonDepth, true);
      furnishBedroom(room, index);
      frontX += room.w;
    }
    const hall = zone('hall', 'hall', 0, bedroomDepth, width, corridorWidth);
    reserve(hall, '公共走廊', {x: .1, z: .1, w: width - .2, d: corridorWidth - .2});
    const living = zone('living', 'living', frontWidth, commonZ, serviceX - frontWidth, commonDepth);
    reserve(living, '入户至走廊', {x: living.w - 1.05, z: .1, w: .9, d: living.d - .2});
    const sofaW = Math.min(2.4, living.w - 1.3);
    place(living, 'sofa', {x: .18, z: .22, w: sofaW, d: .85}, {required: true});
    place(living, 'coffeeTable', {x: .35, z: 1.57, w: Math.min(1.3, sofaW - .2), d: .6},
      {required: true});
    place(living, 'tvConsole', {x: .18, z: living.d - .5, w: Math.min(1.9, living.w - 1.4), d: .36},
      {required: true});
    if (features.workchairs) place(living, 'armchair', {x: .25, z: 2.85, w: .72, d: .75});
    if (features.plant) place(living, 'plant', {x: 1.45, z: 2.95, w: .45, d: .45});
    if (features.petBowl) place(living, 'petBowl', {x: living.w - 1.65, z: living.d - .55, w: .42, d: .35});
    const bathDepth = sharedBathrooms ? 2.2 : 0;
    for (let index = 0; index < sharedBathrooms; index++) {
      const part = serviceWidth / sharedBathrooms;
      bathroom(zone('bathroom-' + index, 'bathroom', serviceX + part * index, commonZ, part, bathDepth));
    }
    const kitchen = zone('kitchen', 'kitchen', serviceX, commonZ + bathDepth, serviceWidth, commonDepth - bathDepth);
    reserve(kitchen, '厨卫门前通道', {x: .1, z: .1, w: kitchen.w - .2, d: .8});
    reserve(kitchen, '厨房通道', {x: .84, z: .9, w: Math.max(.8, kitchen.w - 1.65), d: kitchen.d - 1.0});
    place(kitchen, 'kitchenCounter', {x: kitchen.w - .72, z: .95, w: .6, d: kitchen.d - 1.07},
      {required: true});
    place(kitchen, 'fridge', {x: .12, z: kitchen.d - .82, w: .62, d: .7}, {required: true});
    const entryCenter = living.x + living.w - .6;
    wall(frontWidth, depth, width, depth, [{center: entryCenter, width: .95, zone: 'entry'}]);
    wall(0, bedroomDepth, 0, depth);
    wall(width, bedroomDepth, width, depth);
    return {width, depth, roomCount, bathroomCount, selectedRoom, zones, items, routes, clearances, walls, doors,
      variant: frontCount > 1 ? '双排卧房' : frontCount ? 'L 形布局' : roomCount === 1 ? '一居布局' : roomCount === 2 ? '并排双卧' : '一排卧房'};
  }

  function interior(listing) {
    const ch = nestCharacter(listing), P = ch.palette, F = ch.features;
    const layout = planInterior(listing, ch);
    const {width, depth} = layout;
    const shade = (hex, value) => '#' + [1, 3, 5].map(index =>
      clamp(Math.round(parseInt(hex.slice(index, index + 2), 16) * value), 0, 255)
        .toString(16).padStart(2, '0')).join('');
    const mix = (a, b, value) => '#' + [1, 3, 5].map(index =>
      Math.round(parseInt(a.slice(index, index + 2), 16) * (1 - value) +
        parseInt(b.slice(index, index + 2), 16) * value).toString(16).padStart(2, '0')).join('');
    const faces = [];
    const ox = -width / 2, oz = -depth / 2;
    function face(vertices, color, light = 1) {
      faces.push({ points: vertices.map(([x, y, z]) => [x + ox, y, z + oz]), tone: tone(color, light) });
    }
    // The same world-space surfaces are used by the GPU and the offline canvas fallback.
    function slab(x, z, w, d, y, h, color, r = 0) {
      if (w <= 0 || d <= 0 || h < 0) return;
      r = clamp(r, 0, Math.min(w, d) / 2.1);
      const p = r ? [[x + r, z], [x + w - r, z], [x + w, z + r], [x + w, z + d - r], [x + w - r, z + d], [x + r, z + d], [x, z + d - r], [x, z + r]] :
        [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
      for (let i = 0; i < p.length && h > .0001; i++) {
        const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        face([[a[0], y, a[1]], [b[0], y, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]]], color,
          Number((.83 + .11 * (dz / len) - .045 * (dx / len)).toFixed(3)));
      }
      face(p.map(([a, b]) => [a, y + h, b]), color, 1);
    }
    function disk(x, z, y, r, h, color, n = 12) {
      const rim = Array.from({ length: n }, (_, i) => [x + Math.cos(i * TAU / n) * r, z + Math.sin(i * TAU / n) * r]);
      rim.forEach((a, i) => {
        const b = rim[(i + 1) % n];
        if (h > 0) face([[a[0], y, a[1]], [b[0], y, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]]], color, Number((.83 + .11 * Math.cos(i * TAU / n)).toFixed(2)));
      });
      face(rim.map(([a, b]) => [a, y + h, b]), color);
    }
    const oak = P.wood, darkOak = P.wood2, wallColour = P.wall;
    const warmWhite = P.soft, metal = P.metal, fabric = P.fabric, accent = P.accent;
    const highlight = mix('#f2a24c', accent, .42);
    slab(-.1, -.1, width + .2, depth + .2, -.18, .22, '#697a6f', .06);
    const plankColours = [.92, 1, 1.06, .96].map(value => shade(P.floor, value));
    for (let row = 0; row < Math.ceil(depth / .35); row++) {
      const z = row * .35;
      for (let x = 0, column = 0; x < width; x += 2.1, column++) {
        slab(x, z, Math.min(2.09, width - x), Math.min(.34, depth - z), .04, .015,
          plankColours[(row + column) % plankColours.length]);
      }
    }
    function wallSurface(segment) {
      const {axis, fixed, start, end, style} = segment;
      const length = end - start;
      const block = (position, span, bottom, height, colour) => {
        if (axis === 'x') slab(position, fixed - .055, span, .11, bottom, height, colour);
        else slab(fixed - .055, position, .11, span, bottom, height, colour);
      };
      const window = style === 'window' || style === 'frosted';
      if (window && length > .6) {
        const jamb = length * .2, opening = length - jamb * 2;
        block(start, length, .055, .56, wallColour);
        block(start, jamb, .615, .68, wallColour);
        block(end - jamb, jamb, .615, .68, wallColour);
        block(start + jamb, opening, .615, .62,
          style === 'frosted' ? '#d3ded7' : ch.night ? '#466276' : '#b4cfc9');
        block(start + jamb + opening / 2 - .018, .036, .615, .65, metal);
        block(start, length, 1.265, .045, metal);
      } else {
        block(start, length, .055, 1.12, wallColour);
        block(start, length, 1.175, .035, shade(metal, 1.05));
      }
    }
    layout.zones.filter(area => area.type === 'bedroom' && area.selected).forEach(area => {
      slab(area.x + .065, area.z + .065, area.w - .13, area.d - .13, .056, .009,
        mix(highlight, P.floor, .65));
      for (const z of [area.z + .07, area.z + area.d - .12]) {
        slab(area.x + .07, z, area.w - .14, .05, .066, .007, highlight);
      }
      for (const x of [area.x + .07, area.x + area.w - .12]) {
        slab(x, area.z + .07, .05, area.d - .14, .066, .007, highlight);
      }
    });
    layout.zones.filter(area => area.type === 'bathroom').forEach(area => {
      slab(area.x + .06, area.z + .06, area.w - .12, area.d - .12, .057, .01,
        F.darkBath ? '#9fada6' : '#bdcdc5');
      for (let x = .3; x < area.w - .1; x += .3) {
        slab(area.x + x, area.z + .06, .008, area.d - .12, .068, 0, '#dce4dc');
      }
      for (let z = .3; z < area.d - .1; z += .3) {
        slab(area.x + .06, area.z + z, area.w - .12, .008, .068, 0, '#dce4dc');
      }
    });
    layout.walls.forEach(wallSurface);
    layout.doors.forEach(door => {
      const ends = [door.center - door.width / 2, door.center + door.width / 2];
      ends.forEach(position => {
        if (door.axis === 'x') slab(position - .025, door.fixed - .065, .05, .13, .055, 1.17, oak);
        else slab(door.fixed - .065, position - .025, .13, .05, .055, 1.17, oak);
      });
      // A flush threshold leaves the doorway clear in the cutaway view.
      if (door.axis === 'x') slab(door.center - door.width / 2, door.fixed - .06,
        door.width, .12, .056, .008, shade(P.floor, .9));
      else slab(door.fixed - .06, door.center - door.width / 2,
        .12, door.width, .056, .008, shade(P.floor, .9));
    });
    const living = layout.zones.find(area => area.id === 'living');
    if (F.rug) {
      slab(living.x + .22, living.z + 1.22, Math.min(2, living.w - 1.4), 1.15,
        .056, .01, shade(fabric, 1.18), .05);
    }
    function furniture(item) {
      const {x, z, w, d, type, reverse} = item;
      const block = (dx, dz, spanX, spanZ, y, h, colour, radius = 0) => {
        slab(x + dx, reverse ? z + d - dz - spanZ : z + dz,
          spanX, spanZ, y, h, colour, radius);
      };
      const round = (dx, dz, y, radius, h, colour, segments = 12) => {
        disk(x + dx, reverse ? z + d - dz : z + dz, y, radius, h, colour, segments);
      };
      switch (type) {
        case 'bed': {
          for (const dx of [.08, w - .13]) {
            for (const dz of [.12, d - .17]) block(dx, dz, .05, .05, .055, .10, darkOak);
          }
          block(.04, .05, w - .08, d - .09, .075, .23, darkOak, .035);
          block(.02, .015, w - .04, .11, .075, .76, oak, .025);
          block(.07, .14, w - .14, d - .2, .305, .19, '#f8f3e7', .055);
          block(.085, .66, w - .17, d - .75, .5, .055, fabric, .04);
          block(.085, .69, w - .17, .16, .557, .014, warmWhite, .01);
          const pillows = w < 1.3 ? 1 : 2, pillowWidth = (w - .26) / pillows - .035;
          for (let index = 0; index < pillows; index++) {
            block(.13 + index * (pillowWidth + .035), .22, pillowWidth, .33, .497, .105, warmWhite, .05);
          }
          break;
        }
        case 'wardrobe':
          block(.025, .02, w - .05, d - .04, .055, 1.58, darkOak, .025);
          for (let index = 0; index < 2; index++) {
            block(.012, .045 + index * (d - .09) / 2, .025, (d - .12) / 2,
              .12, 1.45, oak, .008);
            block(.003, d / 2 + (index ? .07 : -.09), .035, .025, .72, .2, metal, .008);
          }
          break;
        case 'clothesRack':
          for (const dz of [.05, d - .09]) block(.05, dz, w - .1, .04, .055, 1.38, metal);
          block(.05, .05, .035, d - .1, 1.42, .035, metal);
          for (let index = 0; index < 4; index++) {
            block(.09, .12 + index * (d - .25) / 4, w - .18, .14, .52, .68,
              index % 2 ? fabric : warmWhite, .02);
          }
          break;
        case 'desk':
          for (const dx of [.055, w - .095]) {
            for (const dz of [.045, d - .085]) block(dx, dz, .04, .04, .055, .66, metal);
          }
          block(0, 0, w, d, .715, .055, oak, .025);
          block(w * .32, .1, Math.min(.3, w * .3), .22, .782, .018, '#647c77', .01);
          break;
        case 'chair':
          for (const dx of [.055, w - .1]) {
            for (const dz of [.07, d - .11]) block(dx, dz, .035, .035, .055, .36, darkOak);
          }
          block(.015, .025, w - .03, d - .04, .415, .075, fabric, .035);
          block(.02, .015, w - .04, .055, .49, .36, oak, .02);
          break;
        case 'nightstand':
          block(.025, .025, w - .05, d - .05, .055, .4, oak, .025);
          round(w / 2, d / 2, .455, .045, .14, metal);
          round(w / 2, d / 2, .595, .105, .14, warmWhite);
          break;
        case 'bookcase':
          block(.02, .02, w - .04, d - .04, .055, .93, darkOak, .015);
          for (const y of [.2, .53]) {
            for (let index = 0; index < 4; index++) {
              block(.04 + index * (w - .08) / 4, .015, (w - .12) / 4, d - .08,
                y, .23, index % 2 ? fabric : warmWhite, .008);
            }
          }
          break;
        case 'plant': {
          const radius = Math.min(w, d) * .32;
          round(w / 2, d / 2, .055, radius, .26, '#bd8869');
          round(w / 2, d / 2, .315, radius * .85, .025, '#816a50');
          for (let index = 0; index < 7; index++) {
            const angle = index * 2.39, spread = Math.min(w, d) * .44;
            const cx = x + w / 2, cz = z + d / 2;
            const tip = [cx + Math.cos(angle) * spread, .68 + index % 3 * .07,
              cz + Math.sin(angle) * spread];
            face([[cx, .31, cz], [cx + Math.cos(angle + .7) * spread * .65, .53,
              cz + Math.sin(angle + .7) * spread * .65], tip], index % 2 ? '#6f8d67' : '#7d9b75');
          }
          break;
        }
        case 'floorLamp':
          round(w / 2, d / 2, .055, .14, .045, metal);
          block(w / 2 - .012, d / 2 - .012, .024, .024, .1, .98, metal);
          round(w / 2, d / 2, 1.08, .13, .22, warmWhite);
          break;
        case 'sofa':
        case 'armchair': {
          for (const dx of [.08, w - .13]) {
            for (const dz of [.09, d - .14]) block(dx, dz, .05, .05, .055, .06, darkOak);
          }
          block(.045, .035, w - .09, d - .07, .08, .27, darkOak, .045);
          block(.015, .015, w - .03, .15, .35, .5, fabric, .045);
          for (const dx of [.015, w - .13]) block(dx, .08, .115, d - .1, .35, .27, fabric, .04);
          const seats = type === 'sofa' ? 3 : 1;
          for (let index = 0; index < seats; index++) {
            const cushionW = (w - .3) / seats;
            block(.15 + index * cushionW, .17, cushionW - .02, d - .22, .35, .16,
              shade(fabric, 1.13), .03);
          }
          block(.18, .13, Math.min(.32, w - .36), .14, .51, .24, warmWhite, .03);
          break;
        }
        case 'coffeeTable':
          for (const dx of [.14, w - .19]) {
            for (const dz of [.13, d - .18]) block(dx, dz, .05, .05, .055, .29, darkOak);
          }
          block(.01, .01, w - .02, d - .02, .345, .07, oak, .11);
          block(.15, .12, .28, .19, .417, .025, accent, .01);
          round(w - .24, d / 2, .417, .075, .04, warmWhite);
          break;
        case 'tvConsole':
          block(.015, .015, w - .03, d - .03, .055, .342, oak, .02);
          block(w * .24, d * .38, w * .52, .04, .43, .54, '#3d4b48', .01);
          block(w * .45, d * .3, w * .1, .13, .397, .04, metal);
          break;
        case 'petBowl':
          round(w * .25, d / 2, .055, .08, .06, metal);
          round(w * .73, d / 2, .055, .08, .06, accent);
          break;
        case 'basin':
          block(.035, .035, w - .07, d - .067, .058, .54, '#aebfb1', .02);
          block(.015, .015, w - .03, d - .03, .595, .06, '#f1f1e6', .025);
          block(w * .2, d * .3, w * .6, d * .52, .657, .005, '#bfcec7', .03);
          block(w / 2 - .017, .045, .034, .035, .655, .15, metal);
          break;
        case 'toilet':
          block(.095, .13, w - .19, d - .21, .055, .25, '#e9ede6', .07);
          block(.025, .14, w - .05, d - .17, .305, .095, '#f5f3e9', .11);
          block(.09, .2, w - .18, d - .3, .402, .005, '#bac8be', .07);
          block(.035, .025, w - .07, .15, .055, .55, '#f5f2e9', .02);
          break;
        case 'shower':
          block(.01, .01, w - .02, d - .02, .067, .058, '#e1e6df', .025);
          block(.04, .04, w - .08, d - .08, .125, .006, '#c5d4cd', .02);
          block(w - .07, .05, .03, .03, .14, 1.0, metal);
          block(w - .11, .045, .12, .07, 1.14, .025, metal, .01);
          block(w - .025, .02, .012, d - .04, .14, .9, '#b7d0ca');
          break;
        case 'kitchenCounter':
          block(.025, .015, w - .05, d - .03, .055, .77, '#92a995', .02);
          block(.005, .005, w - .01, d - .01, .825, .055, '#f6f0e1', .02);
          block(.075, .12, w - .15, .34, .882, .005, '#b4c4ba', .045);
          block(.09, d - .49, w - .18, .36, .882, .01, '#40534a', .02);
          for (const dz of [d - .4, d - .23]) round(w / 2, dz, .894, .055, .006, metal);
          break;
        case 'fridge':
          block(.025, .02, w - .05, d - .04, .055, 1.55, '#e5e8e0', .03);
          block(.015, d - .05, w - .03, .035, .57, .012, metal);
          block(w - .07, d - .045, .025, .025, .76, .42, metal);
          break;
      }
    }
    layout.items.forEach(furniture);
    return {faces, width, depth, layout};
  }

  const vertexSource='attribute vec3 aPoint;attribute vec3 aColor;uniform vec4 uOrbit;uniform vec2 uScale;uniform float uOffset;varying vec3 color;void main(){float x=uOrbit.x*aPoint.x+uOrbit.y*aPoint.z;float z=-uOrbit.y*aPoint.x+uOrbit.x*aPoint.z;gl_Position=vec4(x*uScale.x,(aPoint.y*uOrbit.z-z*uOrbit.w)*uScale.y+uOffset,-(z*uOrbit.z+aPoint.y*uOrbit.w)*0.038,1.0);color=aColor;}';
  const fragSource='precision mediump float;varying vec3 color;void main(){gl_FragColor=vec4(color,1.0);}';
  function gpu(canvas,faces) {
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:false});
    if(!gl)return null;
    function shader(type,source){
      const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Model shader');
      return s;
    }
    const vs=shader(gl.VERTEX_SHADER,vertexSource),fs=shader(gl.FRAGMENT_SHADER,fragSource),program=gl.createProgram();
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
    gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Model projection');
    const vertices=[];
    faces.forEach(({points,tone})=>{
      for(let i=1;i<points.length-1;i++)for(const point of [points[0],points[i],points[i+1]])vertices.push(...point,...tone.rgb);
    });
    const buffer=gl.createBuffer();
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    for(const [name,offset] of [['aPoint',0],['aColor',12]]){
      const a=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,24,offset);
    }
    gl.clearColor(0,0,0,0);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    const rot=gl.getUniformLocation(program,'uOrbit'),scale=gl.getUniformLocation(program,'uScale'),off=gl.getUniformLocation(program,'uOffset');
    return {
      paint({w,h,sy,cy,sp,cp,s,y0}){
        gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.uniform4f(rot,cy,sy,cp,sp);gl.uniform2f(scale,s*2/w,s*2/h);gl.uniform1f(off,1-y0*2/h);
        gl.drawArrays(gl.TRIANGLES,0,vertices.length/6);
      },
      dispose(){gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
    };
  }
  function raster(canvas,faces){
    const ctx=canvas.getContext('2d');if(!ctx)return null;
    // Keep a depth buffer on machines without WebGL so broad floors cannot overpaint the furniture.
    let frame,zBuffer;
    const geometry=faces.map(({points,tone})=>{
      const [r,g,b]=tone.rgb.map(x=>Math.round(x*255));
      return {points,ink:(0xff000000|(b<<16)|(g<<8)|r)>>>0};
    });
    function triangle(p,q,r,ink,data,nx,ny){
      const dx=q[0]-p[0],dy=q[1]-p[1],ex=r[0]-p[0],ey=r[1]-p[1],det=dx*ey-dy*ex;
      if(Math.abs(det)<.001)return;
      const minX=clamp(Math.floor(Math.min(p[0],q[0],r[0])),0,nx-1),maxX=clamp(Math.ceil(Math.max(p[0],q[0],r[0])),0,nx-1);
      const minY=clamp(Math.floor(Math.min(p[1],q[1],r[1])),0,ny-1),maxY=clamp(Math.ceil(Math.max(p[1],q[1],r[1])),0,ny-1);
      const du=ey/det,dv=-dy/det,depthQ=q[2]-p[2],depthR=r[2]-p[2];
      for(let y=minY;y<=maxY;y++){
        const yRel=y+.5-p[1],xRel=minX+.5-p[0];
        let u=(ey*xRel-ex*yRel)/det,v=(dx*yRel-dy*xRel)/det,j=y*nx+minX;
        for(let x=minX;x<=maxX;x++,j++,u+=du,v+=dv){
          if(u<-.00001||v<-.00001||u+v>1.00001)continue;
          const z=p[2]+u*depthQ+v*depthR;
          if(z>=zBuffer[j]-.000001){zBuffer[j]=z;data[j]=ink;}
        }
      }
    }
    return {pixelCap:1.4,paint({w,h,sy,cy,sp,cp,s,y0}){
      const nx=canvas.width,ny=canvas.height;
      if(!frame||frame.width!==nx||frame.height!==ny){
        frame=ctx.createImageData(nx,ny);zBuffer=new Float32Array(nx*ny);
      }
      const pixels=new Uint32Array(frame.data.buffer);
      pixels.fill(0);zBuffer.fill(-Infinity);
      for(const {points,ink} of geometry){
        const poly=points.map(([x,y,z])=>{
          const rz=-sy*x+cy*z;
          return [(w/2+(cy*x+sy*z)*s)*nx/w,(y0+(rz*sp-y*cp)*s)*ny/h,rz*cp+y*sp];
        });
        for(let i=1;i<poly.length-1;i++)triangle(poly[0],poly[i],poly[i+1],ink,pixels,nx,ny);
      }
      ctx.putImageData(frame,0,0);
    },dispose(){frame=null;zBuffer=null;}};
  }
  const icons={
    left:'<path d="M9 5 5 9l4 4M5 9h10a5 5 0 1 1 0 10"/>',
    right:'<path d="m15 5 4 4-4 4m4-4H9a5 5 0 1 0 0 10"/>',
    minus:'<path d="M5 12h14"/>',plus:'<path d="M5 12h14m-7-7v14"/>',
    reset:'<path d="M4 5v5h5M4.5 10a8 8 0 1 1 .7 6"/>'
  };
  window.mountNestModel=function(container,listing){
    if(!container||!listing)return ()=>{};
    container._nestDispose?.();
    const shell=document.createElement('div');
    shell.className='nest-model';
    const control=(key,label)=>'<button type="button" data-tool="'+key+'" aria-label="'+label+'" title="'+label+'"><svg aria-hidden="true" viewBox="0 0 24 24">'+icons[key]+'</svg></button>';
    shell.innerHTML='<div class="nm-stage"><canvas tabindex="0" role="img" aria-label="可旋转的三维户型示意，方向键调整视角，加减键缩放，零键复位。"></canvas><div class="nm-angle" role="group" aria-label="模型视角"><button type="button" data-tool="orbit" aria-pressed="true">立体</button><button type="button" data-tool="plan" aria-pressed="false">俯视</button></div><div class="nm-tools" role="group" aria-label="户型模型操作">'+control('left','向左旋转')+control('right','向右旋转')+'<i></i>'+control('minus','缩小')+control('plus','放大')+'<i></i>'+control('reset','复位视角')+'</div></div><div class="nm-caption"><strong>户型示意 · 非实测</strong><span id="nmMode">拖动旋转 · 滚轮或双指缩放</span></div><div class="nm-legend"></div>';
    container.replaceChildren(shell);
    let canvas=shell.querySelector('canvas');
    const model=interior(listing),ch=nestCharacter(listing),cap=shell.querySelector('#nmMode'),legend=shell.querySelector('.nm-legend');
    if(cap)cap.textContent=model.layout.variant+' · '+ch.styleName+' · 拖动旋转';
    if(legend)legend.innerHTML='<span class="nl-key"><i style="background:'+ch.palette.accent+'"></i>你的房间：'+escapeHtml(listing.roomType||'合租房间')+'（第 '+(ch.roomIndex+1)+' 间）</span><span>'+escapeHtml('整租构成 '+listing.layout+' · 建面约 '+listing.aptSqm+'㎡')+'</span><span class="nl-note">家具与开窗按房源特征生成，尺寸非实测</span>';
    let renderer;
    try {renderer=gpu(canvas,model.faces);}catch{}
    if(!renderer){
      const fresh=canvas.cloneNode();canvas.replaceWith(fresh);canvas=fresh;
      renderer=raster(canvas,model.faces);
    }
    if(!renderer){shell.querySelector('.nm-caption span').textContent='此设备暂不支持模型绘制';return ()=>shell.remove();}
    const baseYaw=-.53,basePitch=.72,limitZoom=z=>clamp(z,.58,2.15);
    let yaw=baseYaw,pitch=basePitch,zoom=1,frame=0,disposed=false;
    const byTool=k=>shell.querySelector('[data-tool="'+k+'"]');
    function draw(){
      frame=0;if(disposed)return;
      const rect=canvas.getBoundingClientRect(), w=rect.width,h=rect.height;
      if(!w||!h)return;
      const pixelRatio=Math.min(window.devicePixelRatio||1,renderer.pixelCap||2);
      const rw=Math.round(w*pixelRatio),rh=Math.round(h*pixelRatio);
      if(canvas.width!==rw||canvas.height!==rh){canvas.width=rw;canvas.height=rh;}
      const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
      const spanX=Math.abs(cy)*(model.width+.3)+Math.abs(sy)*(model.depth+.3);
      const spanZ=Math.abs(sy)*(model.width+.3)+Math.abs(cy)*(model.depth+.3);
      const s=Math.min((w-26)/spanX,(h-89)/(spanZ*sp+1.70*cp)) * zoom;
      const y0=h*.49+s*.44;
      renderer.paint({w,h,sy,cy,sp,cp,s,y0});
      const overhead=pitch>1.54;
      byTool('plan').setAttribute('aria-pressed',String(overhead));byTool('orbit').setAttribute('aria-pressed',String(!overhead));
      byTool('minus').disabled=zoom<.581;byTool('plus').disabled=zoom>2.149;
    }
    function redraw(){if(!frame&&!disposed)frame=requestAnimationFrame(draw);}
    function act(k){
      if(k==='left')yaw-=Math.PI/9;
      if(k==='right')yaw+=Math.PI/9;
      if(k==='plus')zoom=limitZoom(zoom*1.2);
      if(k==='minus')zoom=limitZoom(zoom/1.2);
      if(k==='plan'){yaw=0;pitch=Math.PI/2;}
      if(k==='orbit'){pitch=basePitch;yaw=baseYaw;}
      if(k==='reset'){yaw=baseYaw;pitch=basePitch;zoom=1;}
      redraw();
    }
    const pointers=new Map();
    const pairDistance=()=>{
      const [a,b]=pointers.values();return b?Math.hypot(b.x-a.x,b.y-a.y):0;
    };
    const controller=new AbortController(), opt={signal:controller.signal};
    shell.addEventListener('click',e=>{const b=e.target.closest('[data-tool]');if(b)act(b.dataset.tool);},opt);
    canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    },opt);
    canvas.addEventListener('pointermove',e=>{
      const old=pointers.get(e.pointerId);if(!old)return;
      const before=pairDistance();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===2&&before>1)zoom=limitZoom(zoom*pairDistance()/before);
      if(pointers.size===1){yaw+=(e.clientX-old.x)*.009;pitch=clamp(pitch+(e.clientY-old.y)*.007,.30,Math.PI/2);}
      redraw();
    },opt);
    for(const event of ['pointercancel','pointerup','lostpointercapture'])canvas.addEventListener(event,e=>pointers.delete(e.pointerId),opt);
    canvas.addEventListener('wheel',e=>{e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?15:e.deltaMode===2?185:1);zoom=limitZoom(zoom*Math.exp(-clamp(delta,-220,220)*.002));redraw();},{...opt,passive:false});
    canvas.addEventListener('keydown',e=>{
      const k=({ArrowLeft:'left',ArrowRight:'right','+':'plus','=':'plus','-':'minus','0':'reset',Home:'reset'})[e.key];
      if(k){e.preventDefault();act(k);}
      else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();pitch=clamp(pitch+(e.key==='ArrowUp'?.1:-.1),.3,Math.PI/2);redraw();}
    },opt);
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(redraw):null;
    observer?.observe(canvas);window.addEventListener('resize',redraw,opt);redraw();
    function dispose(){
      if(disposed)return;
      disposed=true;controller.abort();observer?.disconnect();cancelAnimationFrame(frame);renderer.dispose();shell.remove();
      if(container._nestDispose===dispose)delete container._nestDispose;
    }
    container._nestDispose=dispose;return dispose;
  };
})();

/* ============ 房源封面：按房源生成差异化插画（与 3D 户型共用同一"性格"） ============ */
/* 插画为示意图形，构图由 listing_id 稳定种子派生；卡片上的文字角标一律来自真实字段。 */
const NEST_STYLES = {
  nordic: { name: '北欧原木', wall: '#eef0e9', wall2: '#dfe4da', wood: '#c8a276', wood2: '#a3805a', floor: '#dfc39b', fabric: '#7f9c8b', accent: '#d68b52', metal: '#8d9a94', soft: '#f5f0e6' },
  wabi: { name: '日式侘寂', wall: '#efe9de', wall2: '#e0d7c6', wood: '#b99a72', wood2: '#8f7350', floor: '#d9c6a8', fabric: '#a89a83', accent: '#b0603c', metal: '#7e7a6e', soft: '#f7f2e7' },
  retro: { name: '复古墨绿', wall: '#e1e6dc', wall2: '#c8d2c4', wood: '#8f6b4c', wood2: '#6d4f36', floor: '#c9a877', fabric: '#3f6152', accent: '#c98a3f', metal: '#8a7a5c', soft: '#efe6d4' },
  mono: { name: '极简白', wall: '#f2f3f1', wall2: '#e4e7e4', wood: '#cfcac2', wood2: '#a8a39b', floor: '#e6e3dc', fabric: '#b9c2c4', accent: '#3c4a4f', metal: '#9aa3a6', soft: '#fbfbf9' },
  industrial: { name: '工业风', wall: '#e7e3dd', wall2: '#cec9c1', wood: '#9c7b5b', wood2: '#795c42', floor: '#c6bcab', fabric: '#6d7b85', accent: '#c0662f', metal: '#6a6f73', soft: '#efece7' },
  warm: { name: '老式单位房', wall: '#f1e7d0', wall2: '#e2d3b5', wood: '#b08a5e', wood2: '#8a6a45', floor: '#d3ab7c', fabric: '#9d5f4f', accent: '#7f9a6c', metal: '#a89a82', soft: '#f8f0de' },
  studio: { name: '精装公寓', wall: '#eaedf0', wall2: '#d5dae0', wood: '#b7bec4', wood2: '#8d959c', floor: '#dad5cc', fabric: '#4d6a7c', accent: '#e0a45c', metal: '#5c666d', soft: '#f3f5f6' },
};
const NEST_STYLE_BY_CHANNEL = {
  '公寓运营方': ['studio', 'mono', 'industrial', 'nordic'],
  '房东直租': ['warm', 'nordic', 'retro', 'wabi'],
  '室友转租': ['nordic', 'wabi', 'retro', 'mono', 'industrial'],
};
const NEST_VIEW_NAMES = { campus: '校园梧桐景', tech: '园区灯火景', skyline: 'CBD 天际景', park: '公园绿地景', hutong: '老城灰瓦景', oldtown: '街巷屋顶景', river: '河畔景', mountain: '西山远景', city: '城市街景' };
const NEST_VIEW_SHORT = { campus: '校园景', tech: '园区景', skyline: '天际线', park: '公园景', hutong: '灰瓦胡同', oldtown: '街巷屋顶', river: '河畔景', mountain: '西山景', city: '城市景' };

function nestViewScene(l) {
  const key = String(l.area || '') + String(l.district || '');
  if (/古城|八角|鲁谷|苹果园|八大处|香山/.test(key)) return 'mountain';
  if (/奥林匹克公园|朝阳公园|望京/.test(key)) return 'park';
  if (/CBD|国贸|双井|三里屯|大望路/.test(key)) return 'skyline';
  if (/中关村|五道口|知春路|学院路|海淀/.test(key)) return 'campus';
  if (/上地|清河|西二旗|西北旺|软件园/.test(key)) return 'tech';
  if (/安定门|东直门|崇文门|天坛|东城/.test(key)) return 'hutong';
  if (/金融街|月坛|广安门|西单|西城/.test(key)) return 'oldtown';
  if (/丽泽|方庄|宋家庄|六里桥|丰台/.test(key)) return 'river';
  return 'city';
}

const nestCharCache = new Map();
function nestCharacter(l) {
  if (!l) return null;
  if (nestCharCache.has(l.key)) return nestCharCache.get(l.key);
  const rng = seedRng('char|' + l.key);
  const pick = arr => arr[Math.floor(rng() * arr.length) % arr.length];
  const styleKey = pick(NEST_STYLE_BY_CHANNEL[l.channel] || ['nordic', 'mono', 'wabi', 'retro']);
  const palette = NEST_STYLES[styleKey] || NEST_STYLES.nordic;
  const view = nestViewScene(l);
  const ensuite = String(l.roomType || '').includes('独卫');
  const area = +l.roomSqm || 11;
  const spacious = area >= 14;
  const pets = (l.roommates || []).filter(r => r.hasPet).length;
  const roomy = l.rooms || 3;
  const shapes = area < 10 ? ['narrow', 'rect', 'nook'] : spacious ? ['wide', 'lshape', 'bay', 'balcony'] : ['rect', 'lshape', 'wide', 'pillar'];
  const shape = pick(shapes);
  const windows = area < 9 ? 1 : rng() < .3 ? 2 : 1;
  const windowType = styleKey === 'studio' || styleKey === 'mono' ? pick(['floor', 'grid']) : pick(['grid', 'grid', 'bay', 'arch', 'floor']);
  const roomIndex = Math.min(Math.max(0, Math.floor(rng() * roomy)), roomy - 1);
  const archetypes = roomy <= 2 ? ['pair', 'row'] : roomy === 3 ? ['row', 'lshape', 'corridor'] : roomy === 4 ? ['double', 'row', 'wing', 'corridor'] : ['double', 'wing', 'cluster', 'corridor'];
  const archetype = pick(archetypes);
  const features = {
    radiator: styleKey === 'warm' || styleKey === 'retro',
    ac: styleKey === 'studio' || styleKey === 'mono' || styleKey === 'industrial' || rng() < .4,
    desk: true, bigDesk: spacious, wardrobe: rng() < .62, shelf: rng() < .58, posters: rng() < .62,
    rug: rng() < .55, plant: rng() < .5, floorLamp: rng() < .4, stringLights: rng() < .28,
    suitcase: rng() < .48, books: rng() < .6, petBowl: pets > 0, ensuiteDoor: ensuite,
    singleBed: area < 11.5 && !ensuite, bedsideTable: rng() < .78,
    balcony: shape === 'balcony' || rng() < (ensuite ? .5 : .3), baySeat: windowType === 'bay',
    slantCeiling: rng() < .24 && styleKey !== 'studio', pillar: shape === 'pillar',
    kitchenIsland: +l.aptSqm >= 90, darkBath: rng() < .32, bathtub: rng() < .3, elevatorHall: !!l.elevator,
    workchairs: rng() < .35, deskPlant: rng() < .4,
  };
  const variantName = { pair: '对门两卧', row: '一排卧房', lshape: 'L 形布局', corridor: '中廊式', double: '双排卧房', wing: '主卧带套间', cluster: '围合客厅' }[archetype] || '常规布局';
  const shapeName = { narrow: '窄长间', rect: '方正间', nook: '带凹角', wide: '开间较大', lshape: 'L 形间', bay: '带飘窗', pillar: '有承重柱', balcony: '带阳台' }[shape] || '方正间';
  const ch = {
    styleKey, palette, view, viewName: NEST_VIEW_NAMES[view] || '城市街景', viewShort: NEST_VIEW_SHORT[view] || '城市景', styleName: palette.name,
    shape, shapeName, archetype, variant: variantName, windows, windowType, roomIndex, pets, features,
    seed: Math.floor(rng() * 1e6), night: rng() < .22, sunSide: rng() < .5 ? -1 : 1,
    hook: shapeName + ' · ' + variantName + ' · ' + (NEST_VIEW_NAMES[view] || '城市街景'),
  };
  nestCharCache.set(l.key, ch);
  return ch;
}

function nsvg(tag, attrs, inner) {
  let s = '<' + tag;
  for (const k in attrs) { const v = attrs[k]; if (v !== undefined && v !== null && v !== '') s += ' ' + k + '="' + v + '"'; }
  return s + (inner === undefined ? '/>' : '>' + inner + '</' + tag + '>');
}
const nestCoverCache = new Map();
function nestCoverSVG(l) {
  const cached = nestCoverCache.get(l.key);
  if (cached) return cached;
  const ch = nestCharacter(l), p = ch.palette, W = 320, H = 162;
  const rnd = seedRng('cover|' + l.key);
  const span = (a, b) => a + rnd() * (b - a);
  const pick = arr => arr[Math.floor(rnd() * arr.length) % arr.length];
  const floorY = 114, parts = [], uid = 'cv' + String(l.key).replace(/[^A-Za-z0-9_-]/g, '') + '-';
  const bedW = ch.features.singleBed ? 70 : 94;
  const bedLeft = rnd() < .55;
  const deskW = ch.features.bigDesk ? 84 : 68;
  const hasWardrobe = ch.features.wardrobe;
  const defs = [
    nsvg('linearGradient', { id: uid + 'w', x1: 0, y1: 0, x2: 0, y2: 1 }, nsvg('stop', { offset: 0, 'stop-color': p.wall }) + nsvg('stop', { offset: 1, 'stop-color': p.wall2 })),
    nsvg('linearGradient', { id: uid + 's', x1: 0, y1: 0, x2: 0, y2: 1 }, nsvg('stop', { offset: 0, 'stop-color': ch.night ? '#2c3a52' : '#cfe3ee' }) + nsvg('stop', { offset: 1, 'stop-color': ch.night ? '#41536f' : '#a9cddf' })),
    ch.styleKey === 'industrial' ? nsvg('pattern', { id: uid + 'b', width: 30, height: 26, patternUnits: 'userSpaceOnUse' }, nsvg('rect', { width: 30, height: 26, fill: p.wall }) + nsvg('g', { fill: '#d8d0c6' }, nsvg('rect', { x: 0, y: 0, width: 28, height: 11, rx: 1.5 }) + nsvg('rect', { x: -15, y: 13, width: 28, height: 11, rx: 1.5 }) + nsvg('rect', { x: 15, y: 13, width: 28, height: 11, rx: 1.5 }))) : '',
    ch.styleKey === 'retro' ? nsvg('pattern', { id: uid + 'b', width: 22, height: 8, patternUnits: 'userSpaceOnUse' }, nsvg('rect', { width: 22, height: 8, fill: p.wall }) + nsvg('rect', { width: 9, height: 8, fill: p.wall2, opacity: .55 })) : '',
  ].join('');
  /* 墙面 */
  parts.push(nsvg('rect', { x: 0, y: 0, width: W, height: floorY, fill: 'url(#' + uid + 'w)' }));
  if (ch.styleKey === 'industrial' || ch.styleKey === 'retro') parts.push(nsvg('rect', { x: 0, y: 0, width: W, height: floorY, fill: 'url(#' + uid + 'b)', opacity: .8 }));
  if (ch.styleKey === 'warm') parts.push(nsvg('g', {}, nsvg('rect', { x: 0, y: floorY - 30, width: W, height: 30, fill: p.wall2 }) + nsvg('rect', { x: 0, y: floorY - 31, width: W, height: 2, fill: p.wood2, opacity: .45 })));
  if (ch.features.slantCeiling) parts.push(nsvg('path', { d: 'M0,0 L' + W + ',0 L' + W + ',10 L0,26 Z', fill: p.wall2, opacity: .55 }));
  /* 地板 */
  parts.push(nsvg('rect', { x: 0, y: floorY, width: W, height: H - floorY, fill: p.floor }));
  let planks = '';
  for (let i = 0; i < 8; i++) planks += nsvg('path', { d: 'M' + (i * 46 - 20) + ',' + H + ' L' + (i * 40 + 6) + ',' + (floorY + 1), stroke: p.wood2, 'stroke-width': .8, opacity: .26, fill: 'none' });
  for (let j = 1; j < 3; j++) planks += nsvg('line', { x1: 0, y1: floorY + j * ((H - floorY) / 3), x2: W, y2: floorY + j * ((H - floorY) / 3), stroke: p.wood2, 'stroke-width': .6, opacity: .14 });
  parts.push(nsvg('g', {}, planks));
  parts.push(nsvg('rect', { x: 0, y: floorY - 3, width: W, height: 3, fill: p.soft, opacity: .85 }));
  parts.push(nsvg('path', { d: 'M0,0 L24,10 L24,' + (floorY - 3) + ' L0,' + floorY + ' Z', fill: p.wall2, opacity: .7 }));
  parts.push(nsvg('path', { d: 'M' + W + ',0 L' + (W - 24) + ',10 L' + (W - 24) + ',' + (floorY - 3) + ' L' + W + ',' + floorY + ' Z', fill: p.wall2, opacity: .42 }));
  /* 窗：位置避开衣柜，宽度按房型 */
  const winW = ch.windowType === 'floor' ? 92 : ch.windowType === 'bay' ? 100 : 78;
  const winH = ch.windowType === 'floor' ? 88 : ch.windowType === 'arch' ? 70 : 54;
  const freeSlots = [];
  if (!hasWardrobe || bedLeft) freeSlots.push(208);
  if (!hasWardrobe || !bedLeft) freeSlots.push(24);
  if (!freeSlots.length) freeSlots.push(120);
  const winX = pick(freeSlots);
  const winY = ch.windowType === 'floor' ? 18 : Math.max(14, Math.min(30, span(16, 28)));
  const clip = uid + 'c';
  parts.push(nsvg('defs', {}, nsvg('clipPath', { id: clip }, ch.windowType === 'arch'
    ? nsvg('path', { d: 'M' + winX + ',' + (winY + winH) + ' L' + winX + ',' + (winY + winW / 2) + ' A' + (winW / 2) + ',' + (winW / 2) + ' 0 0 1 ' + (winX + winW) + ',' + (winY + winW / 2) + ' L' + (winX + winW) + ',' + (winY + winH) + ' Z' })
    : nsvg('rect', { x: winX, y: winY, width: winW, height: winH, rx: 3 }))));
  parts.push(nsvg('rect', { x: winX - 3, y: winY - 3, width: winW + 6, height: winH + 6, rx: 5, fill: p.soft, stroke: p.wood2, 'stroke-width': 2.2 }));
  parts.push(nsvg('g', { 'clip-path': 'url(#' + clip + ')' }, nsvg('rect', { x: winX, y: winY, width: winW, height: winH, fill: 'url(#' + uid + 's)' }) + nestViewArt(ch, winX, winY, winW, winH, rnd)));
  if (ch.windowType !== 'arch') parts.push(nsvg('g', { stroke: p.soft, 'stroke-width': 3, opacity: .95 }, nsvg('line', { x1: winX + winW / 2, y1: winY, x2: winX + winW / 2, y2: winY + winH }) + nsvg('line', { x1: winX, y1: winY + winH * .54, x2: winX + winW, y2: winY + winH * .54 })));
  parts.push(nsvg('rect', { x: winX - 7, y: winY + winH + 3, width: winW + 14, height: 4, rx: 2, fill: p.wood }));
  if (ch.features.baySeat) parts.push(nsvg('rect', { x: winX - 4, y: winY + winH - 12, width: winW + 8, height: 12, rx: 3, fill: p.soft, stroke: p.wood2, 'stroke-width': 1.4 }));
  if (ch.windowType !== 'floor' && rnd() < .5) parts.push(nsvg('g', { opacity: .9 }, nsvg('path', { d: 'M' + (winX - 6) + ',' + (winY - 4) + ' q10,' + (winH * .6) + ' 2,' + (winH + 6) + ' l-9,0 q6,-' + (winH * .6) + ' -2,-' + (winH + 6) + ' Z', fill: p.fabric, opacity: .5 }) + nsvg('path', { d: 'M' + (winX + winW + 6) + ',' + (winY - 4) + ' q-10,' + (winH * .6) + ' -2,' + (winH + 6) + ' l9,0 q-6,-' + (winH * .6) + ' 2,-' + (winH + 6) + ' Z', fill: p.fabric, opacity: .5 })));
  if (ch.features.radiator) parts.push(nsvg('g', {}, nsvg('rect', { x: winX + 6, y: floorY - 22, width: winW - 12, height: 17, rx: 3, fill: p.soft, stroke: p.metal, 'stroke-width': 1 }) + Array.from({ length: 6 }, (_, i) => nsvg('line', { x1: winX + 12 + i * ((winW - 24) / 5), y1: floorY - 20, x2: winX + 12 + i * ((winW - 24) / 5), y2: floorY - 7, stroke: p.metal, 'stroke-width': 1, opacity: .65 })).join('')));
  if (ch.features.ac) parts.push(nsvg('g', {}, nsvg('rect', { x: bedLeft ? 252 : 26, y: 14, width: 48, height: 12, rx: 4, fill: '#f7f7f3', stroke: p.metal, 'stroke-width': 1 }) + nsvg('line', { x1: bedLeft ? 256 : 30, y1: 23, x2: bedLeft ? 296 : 70, y2: 23, stroke: p.metal, 'stroke-width': 1.2 })));
  if (!ch.night) parts.push(nsvg('path', { d: 'M' + (winX + (ch.sunSide < 0 ? 0 : winW)) + ',' + (winY + 4) + ' L' + (winX + winW * (ch.sunSide < 0 ? -.35 : 1.35)) + ',' + H + ' L' + (winX + winW * (ch.sunSide < 0 ? .62 : 2.0)) + ',' + H + ' L' + (winX + winW * .55) + ',' + (winY + 4) + ' Z', fill: '#fff4d6', opacity: .2 }));
  /* 墙面装饰（放在家具背后） */
  const decoX = bedLeft ? 236 : 40;
  if (ch.features.posters && !hasWardrobe) parts.push(nsvg('g', {}, nsvg('rect', { x: decoX, y: 34, width: 28, height: 36, rx: 2, fill: p.soft, stroke: p.wood2, 'stroke-width': 1.6 }) + nsvg('circle', { cx: decoX + 14, cy: 48, r: 6.5, fill: p.accent, opacity: .85 }) + nsvg('path', { d: 'M' + (decoX + 3) + ',64 L' + (decoX + 11) + ',54 L' + (decoX + 18) + ',61 L' + (decoX + 25) + ',56 L' + (decoX + 25) + ',66 L' + (decoX + 3) + ',66 Z', fill: p.fabric }) + nsvg('rect', { x: decoX + 33, y: 42, width: 19, height: 25, rx: 2, fill: '#fffdf8', stroke: p.metal, 'stroke-width': 1.2 })));
  if (ch.features.shelf && !hasWardrobe) parts.push(nsvg('g', {}, nsvg('rect', { x: bedLeft ? 34 : 234, y: 44, width: 52, height: 4, rx: 2, fill: p.wood }) + nsvg('rect', { x: bedLeft ? 38 : 238, y: 28, width: 6, height: 16, fill: p.accent }) + nsvg('rect', { x: bedLeft ? 46 : 246, y: 31, width: 5, height: 13, fill: p.fabric }) + nsvg('rect', { x: bedLeft ? 53 : 253, y: 26, width: 7, height: 18, fill: p.wood2 }) + nsvg('circle', { cx: bedLeft ? 74 : 274, cy: 37, r: 6, fill: '#9bb49a' })));
  if (ch.features.stringLights) parts.push(nsvg('g', { opacity: .92 }, nsvg('path', { d: 'M8,12 Q80,26 160,10 T312,16', fill: 'none', stroke: p.metal, 'stroke-width': .9 }) + Array.from({ length: 9 }, (_, i) => nsvg('circle', { cx: 18 + i * 36, cy: 15 + Math.sin(i * .9) * 6, r: 2.5, fill: '#ffe6b0' })).join('')));
  /* 衣柜 / 挂衣杆：占据中段靠墙 */
  if (hasWardrobe) {
    const wx = bedLeft ? 156 : 104;
    parts.push(nsvg('g', {}, rnd() < .72
      ? nsvg('rect', { x: wx, y: floorY - 76, width: 48, height: 76, rx: 3, fill: p.wood2 }) + nsvg('rect', { x: wx + 2, y: floorY - 74, width: 22, height: 72, rx: 2, fill: p.wood }) + nsvg('rect', { x: wx + 25, y: floorY - 74, width: 21, height: 72, rx: 2, fill: p.wood }) + nsvg('g', { fill: p.metal }, nsvg('rect', { x: wx + 21, y: floorY - 46, width: 2.2, height: 13, rx: 1.1 }) + nsvg('rect', { x: wx + 26, y: floorY - 46, width: 2.2, height: 13, rx: 1.1 }))
      : nsvg('g', {}, nsvg('path', { d: 'M' + wx + ',' + floorY + ' L' + wx + ',' + (floorY - 58) + ' M' + (wx + 46) + ',' + floorY + ' L' + (wx + 46) + ',' + (floorY - 58) + ' M' + (wx - 2) + ',' + (floorY - 58) + ' L' + (wx + 48) + ',' + (floorY - 58), stroke: p.metal, 'stroke-width': 2.4, fill: 'none' }) + nsvg('path', { d: 'M' + (wx + 5) + ',' + (floorY - 57) + ' l8,0 l3,27 l-14,0 Z', fill: p.fabric }) + nsvg('path', { d: 'M' + (wx + 19) + ',' + (floorY - 57) + ' l9,0 l2,21 l-11,0 Z', fill: p.accent }) + nsvg('path', { d: 'M' + (wx + 31) + ',' + (floorY - 57) + ' l8,0 l4,31 l-12,0 Z', fill: p.soft }))));
  }
  /* 阳台门：靠外侧墙 */
  if (ch.features.balcony) {
    const bx = bedLeft ? 34 : 246;
    parts.push(nsvg('g', {}, nsvg('rect', { x: bx, y: floorY - 84, width: 26, height: 84, rx: 2, fill: p.soft, stroke: p.wood2, 'stroke-width': 2 }) + nsvg('rect', { x: bx + 3, y: floorY - 80, width: 20, height: 42, rx: 2, fill: ch.night ? '#37496a' : '#bcd6e2' }) + nsvg('path', { d: 'M' + bx + ',' + (floorY - 36) + ' l26,0', stroke: p.wood2, 'stroke-width': 1.6 }) + nsvg('g', { fill: 'none', stroke: '#8fa39a', 'stroke-width': 1.6 }, nsvg('path', { d: 'M' + (bx - 14) + ',' + floorY + ' l0,-12 l54,0 l0,12' }) + nsvg('path', { d: 'M' + (bx - 8) + ',' + (floorY - 6) + ' l42,0' }))));
  }
  /* 独卫门：内门套间 */
  if (ch.features.ensuiteDoor) {
    const ex = bedLeft ? 112 : 200;
    parts.push(nsvg('g', {}, nsvg('rect', { x: ex, y: floorY - 78, width: 24, height: 78, rx: 2, fill: p.soft, stroke: p.wood2, 'stroke-width': 2 }) + nsvg('rect', { x: ex + 3, y: floorY - 74, width: 18, height: 30, rx: 2, fill: '#e7eef0' }) + nsvg('circle', { cx: ex + 20, cy: floorY - 40, r: 2, fill: p.metal })));
  }
  /* 床 */
  parts.push(nestBedSVG(ch, bedLeft ? 12 : 320 - 12 - bedW, floorY - 2, bedW, 40, !bedLeft));
  /* 书桌 + 椅子（对面） */
  const deskX = bedLeft ? 320 - 14 - deskW : 14 + (ch.features.ensuiteDoor ? 0 : 0);
  if (!(hasWardrobe && deskX < 210 && deskX + deskW > 150)) parts.push(nestDeskSVG(ch, deskX, floorY, p, bedLeft));
  /* 小物 */
  if (ch.features.rug) parts.push(nsvg('g', {}, nsvg('ellipse', { cx: 160, cy: floorY + (H - floorY) * .66, rx: 78, ry: 14, fill: p.fabric, opacity: .3 }) + nsvg('ellipse', { cx: 160, cy: floorY + (H - floorY) * .66, rx: 60, ry: 10, fill: 'none', stroke: p.soft, 'stroke-width': 1.6, opacity: .5 })));
  if (ch.features.suitcase) parts.push(nsvg('g', {}, nsvg('rect', { x: bedLeft ? 30 : 244, y: floorY - 20, width: 28, height: 20, rx: 3, fill: p.accent, opacity: .82 }) + nsvg('rect', { x: bedLeft ? 38 : 252, y: floorY - 26, width: 12, height: 7, rx: 3, fill: 'none', stroke: p.metal, 'stroke-width': 2 })));
  if (ch.features.plant) {
    const px = bedLeft ? 128 : 190;
    parts.push(nsvg('g', {}, nsvg('path', { d: 'M' + (px - 8) + ',' + (floorY - 16) + ' l16,0 l-3,16 l-10,0 Z', fill: '#c07f5c' }) + nsvg('path', { d: 'M' + px + ',' + (floorY - 16) + ' C' + (px - 20) + ',' + (floorY - 40) + ' ' + (px - 14) + ',' + (floorY - 56) + ' ' + (px - 2) + ',' + (floorY - 62), stroke: '#6f9271', 'stroke-width': 2.8, fill: 'none' }) + nsvg('path', { d: 'M' + px + ',' + (floorY - 16) + ' C' + (px + 18) + ',' + (floorY - 38) + ' ' + (px + 14) + ',' + (floorY - 54) + ' ' + px + ',' + (floorY - 66), stroke: '#7ea07d', 'stroke-width': 2.8, fill: 'none' }) + nsvg('ellipse', { cx: px - 11, cy: floorY - 48, rx: 8.5, ry: 4.6, fill: '#7ea07d', transform: 'rotate(-24 ' + (px - 11) + ' ' + (floorY - 48) + ')' }) + nsvg('ellipse', { cx: px + 10, cy: floorY - 54, rx: 8.5, ry: 4.6, fill: '#6f9271', transform: 'rotate(22 ' + (px + 10) + ' ' + (floorY - 54) + ')' })));
  }
  if (ch.features.floorLamp) parts.push(nsvg('g', {}, nsvg('line', { x1: bedLeft ? 306 : 16, y1: floorY - 2, x2: bedLeft ? 306 : 16, y2: floorY - 58, stroke: p.metal, 'stroke-width': 2.2 }) + nsvg('path', { d: 'M' + (bedLeft ? 295 : 5) + ',' + (floorY - 58) + ' l22,0 l-4,-17 l-14,0 Z', fill: ch.night ? '#ffe3a8' : p.soft }) + nsvg('ellipse', { cx: bedLeft ? 306 : 16, cy: floorY - 1, rx: 9, ry: 2.8, fill: p.metal, opacity: .8 })));
  if (ch.features.petBowl) parts.push(nsvg('g', {}, nsvg('path', { d: 'M' + (bedLeft ? 268 : 40) + ',' + (floorY + 10) + ' a10,5.5 0 0 0 20,0 Z', fill: p.metal }) + nsvg('g', { transform: 'translate(' + (bedLeft ? 288 : 20) + ',' + (floorY - 22) + ')' }, nsvg('ellipse', { cx: 12, cy: 13, rx: 11, ry: 6.5, fill: p.wood2 }) + nsvg('circle', { cx: 22, cy: 7, r: 5.6, fill: p.wood2 }) + nsvg('path', { d: 'M18,2 l2.4,3.4 M26,2.2 l-1.6,3.4', stroke: p.wood2, 'stroke-width': 2, 'stroke-linecap': 'round' }) + nsvg('path', { d: 'M2,13 q-6,-3 -4,-9', stroke: p.wood2, 'stroke-width': 2.4, fill: 'none', 'stroke-linecap': 'round' }))));
  /* 房型特征：让角标里的"窄长间 / L 形间 / 带凹角 / 有承重柱"在画面里真的看得见 */
  if (ch.shape === 'narrow') parts.push(nsvg('g', {}, [
    nsvg('path', { d: 'M0,0 L34,16 L34,' + (floorY + 4) + ' L0,' + H + ' Z', fill: p.wall2 }),
    nsvg('path', { d: 'M' + W + ',0 L' + (W - 34) + ',16 L' + (W - 34) + ',' + (floorY + 4) + ' L' + W + ',' + H + ' Z', fill: p.wall2, opacity: .93 }),
    nsvg('path', { d: 'M34,16 L34,' + (floorY + 4) + ' M' + (W - 34) + ',16 L' + (W - 34) + ',' + (floorY + 4), stroke: '#2b2419', 'stroke-width': 1, opacity: .14, fill: 'none' }),
  ]));
  if (ch.shape === 'lshape') {
    const right = bedLeft;
    const a = right ? 196 : 124, b = right ? 236 : 84;
    parts.push(nsvg('g', {}, [
      nsvg('path', { d: right ? 'M176,0 L' + W + ',0 L' + W + ',24 L176,38 Z' : 'M0,0 L144,0 L144,38 L0,24 Z', fill: p.wall2, opacity: .92 }),
      nsvg('path', { d: right ? 'M176,38 L' + W + ',24' : 'M0,24 L144,38', stroke: '#2b2419', 'stroke-width': 1, opacity: .12, fill: 'none' }),
      nsvg('path', { d: right ? 'M' + a + ',' + H + ' L' + b + ',' + floorY + ' L' + W + ',' + floorY + ' L' + W + ',' + H + ' Z' : 'M' + a + ',' + H + ' L' + b + ',' + floorY + ' L0,' + floorY + ' L0,' + H + ' Z', fill: p.wood2, opacity: .2 }),
      nsvg('path', { d: 'M' + a + ',' + H + ' L' + b + ',' + floorY, stroke: p.wood2, 'stroke-width': 2, opacity: .55, fill: 'none' }),
    ]));
  }
  if (ch.shape === 'nook') {
    const wx0 = hasWardrobe ? (bedLeft ? 156 : 104) : -999;
    const hit = (x0, x1, y0, y1) => x0 < y1 && x1 > y0;
    const cand = [40, 236].filter(sx => !hit(sx, sx + 54, winX - 8, winX + winW + 8) && !hit(sx, sx + 54, wx0 - 8, wx0 + 56));
    const nx = cand.length ? cand[0] : (winX > 160 ? 40 : 236);
    parts.push(nsvg('g', {}, [
      nsvg('rect', { x: nx, y: floorY - 56, width: 54, height: 56, rx: 2, fill: p.wall2 }),
      nsvg('rect', { x: nx + 4, y: floorY - 52, width: 46, height: 48, rx: 2, fill: '#2b2419', opacity: .13 }),
      nsvg('rect', { x: nx + 4, y: floorY - 26, width: 46, height: 4, rx: 2, fill: p.wood }),
      nsvg('rect', { x: nx + 9, y: floorY - 46, width: 12, height: 20, rx: 1.5, fill: p.accent, opacity: .85 }),
      nsvg('rect', { x: nx + 24, y: floorY - 42, width: 10, height: 16, rx: 1.5, fill: p.fabric, opacity: .9 }),
      nsvg('rect', { x: nx + 36, y: floorY - 22, width: 12, height: 16, rx: 2, fill: p.soft }),
    ]));
  }
  if (ch.shape === 'pillar') {
    const cx = bedLeft ? 126 : 186;
    parts.push(nsvg('g', {}, [
      nsvg('ellipse', { cx: cx + 8.5, cy: floorY + 15, rx: 17, ry: 3.6, fill: '#2b2419', opacity: .1 }),
      nsvg('rect', { x: cx, y: 14, width: 17, height: floorY + 14 - 14, fill: p.wall2 }),
      nsvg('rect', { x: cx, y: 14, width: 5, height: floorY, fill: '#ffffff', opacity: .32 }),
      nsvg('rect', { x: cx - 3, y: 10, width: 23, height: 6, rx: 2, fill: p.wood2, opacity: .8 }),
      nsvg('rect', { x: cx - 3, y: floorY + 9, width: 23, height: 6, rx: 2, fill: p.wood2, opacity: .8 }),
    ]));
  }
  if (ch.windows > 1) {
    const sx = winX > 160 ? 66 : 250;
    parts.push(nsvg('g', {}, [
      nsvg('rect', { x: sx, y: 30, width: 30, height: 34, rx: 3, fill: p.soft, stroke: p.wood2, 'stroke-width': 2 }),
      nsvg('rect', { x: sx + 3, y: 33, width: 24, height: 28, fill: ch.night ? '#37496a' : '#bcd6e2' }),
      nsvg('path', { d: 'M' + (sx + 15) + ',33 L' + (sx + 15) + ',61', stroke: p.soft, 'stroke-width': 2 }),
    ]));
  }
  if (ch.night) parts.push(nsvg('rect', { x: 0, y: 0, width: W, height: H, fill: '#243149', opacity: .16 }));
  parts.push(nsvg('text', { x: W - 6, y: H - 5, 'text-anchor': 'end', 'font-size': 8, fill: '#ffffff', 'fill-opacity': .72, 'font-family': 'system-ui,sans-serif' }, '示意图 · 非实拍'));
  const svg = '<svg class="cover" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" role="img" aria-label="' + escapeHtml(p.name + '风格示意，' + ch.shapeName + '，' + ch.viewName) + '">' + defs + parts.join('') + '</svg>';
  nestCoverCache.set(l.key, svg);
  return svg;
}
function nestBedSVG(ch, x, y, w, h, headRight) {
  const p = ch.palette;
  return nsvg('g', {}, [
    nsvg('rect', { x: headRight ? x + w - 22 : x, y: y - h - 20, width: 22, height: h + 20, rx: 3, fill: p.wood2 }),
    nsvg('rect', { x: x + 2, y: y - h + 2, width: w - 4, height: 4, rx: 2, fill: p.wood2, opacity: .5 }),
    nsvg('rect', { x, y: y - h, width: w, height: h, rx: 5, fill: p.soft, stroke: p.wood2, 'stroke-width': 1.6 }),
    nsvg('path', { d: 'M' + (headRight ? x : x + w * .34) + ',' + (y - h) + ' h' + (headRight ? w * .66 : w * .66) + ' v' + (h * .6) + ' h-' + (w * .66) + ' Z', fill: p.fabric, opacity: .92 }),
    nsvg('path', { d: 'M' + (headRight ? x : x + w * .34) + ',' + (y - h * .4) + ' h' + (w * .66), stroke: p.soft, 'stroke-width': 2, opacity: .55 }),
    nsvg('rect', { x: headRight ? x + w - 34 : x + 6, y: y - h - 5, width: 27, height: 12, rx: 5, fill: '#fffdf7', stroke: p.metal, 'stroke-width': .8 }),
    ch.features.bedsideTable ? nsvg('g', {}, nsvg('rect', { x: headRight ? x - 26 : x + w + 2, y: y - 24, width: 24, height: 24, rx: 3, fill: p.wood }) + nsvg('rect', { x: headRight ? x - 20 : x + w + 7, y: y - 36, width: 12, height: 12, rx: 2, fill: ch.night ? '#ffe3a8' : p.accent, opacity: .9 })) : '',
    nsvg('rect', { x: x + 5, y: y, width: 5, height: 7, fill: p.wood2 }), nsvg('rect', { x: x + w - 10, y: y, width: 5, height: 7, fill: p.wood2 }),
  ].join(''));
}
function nestDeskSVG(ch, x, floorY, p, bedLeft) {
  const w = ch.features.bigDesk ? 84 : 68;
  return nsvg('g', {}, [
    nsvg('rect', { x, y: floorY - 30, width: w, height: 5, rx: 2, fill: p.wood }),
    nsvg('rect', { x: x + 3, y: floorY - 25, width: 4, height: 25, fill: p.wood2 }),
    nsvg('rect', { x: x + w - 7, y: floorY - 25, width: 4, height: 25, fill: p.wood2 }),
    ch.features.bigDesk ? nsvg('rect', { x: x + w - 32, y: floorY - 26, width: 28, height: 9, rx: 2, fill: p.soft, stroke: p.wood2, 'stroke-width': 1 }) : '',
    nsvg('rect', { x: x + 13, y: floorY - 45, width: 25, height: 15, rx: 2, fill: ch.night ? '#33506b' : '#435360' }),
    nsvg('rect', { x: x + 16, y: floorY - 42, width: 19, height: 9, rx: 1, fill: ch.night ? '#9dc3de' : '#7fa3b8', opacity: .85 }),
    nsvg('rect', { x: x + 44, y: floorY - 33, width: 18, height: 3, rx: 1.5, fill: p.accent, opacity: .9 }),
    ch.features.deskPlant ? nsvg('g', {}, nsvg('rect', { x: x + 5, y: floorY - 37, width: 8, height: 7, rx: 1.5, fill: '#c07f5c' }) + nsvg('circle', { cx: x + 9, cy: floorY - 41, r: 5, fill: '#7ea07d' })) : '',
    ch.features.books ? nsvg('g', {}, nsvg('rect', { x: x + w - 17, y: floorY - 37, width: 4, height: 7, fill: p.fabric }) + nsvg('rect', { x: x + w - 12, y: floorY - 39, width: 4, height: 9, fill: p.accent }) + nsvg('rect', { x: x + w - 7, y: floorY - 36, width: 4, height: 6, fill: p.wood2 })) : '',
    nsvg('path', { d: 'M' + (x + 22) + ',' + floorY + ' l0,-14 l20,0 l0,14 M' + (x + 22) + ',' + (floorY - 14) + ' l0,-17 l4,0 l0,17', fill: 'none', stroke: p.metal, 'stroke-width': 2.4 }),
  ].join(''));
}
function nestViewArt(ch, x, y, w, h) {
  const g = [], base = y + h, horizon = base - h * .32;
  const rr = seedRng('view|' + ch.view + ch.seed);
  const R = (a, b) => a + rr() * (b - a);
  g.push(nsvg(ch.night ? 'circle' : 'circle', { cx: x + w * (ch.sunSide < 0 ? .2 : .8), cy: y + h * .18, r: ch.night ? 6 : 9, fill: ch.night ? '#f6e8bd' : '#fff5d2', opacity: ch.night ? .85 : .8 }));
  const rows = (bh, bw) => { let s = ''; const n = Math.min(5, Math.max(1, Math.floor(bh / 7))); for (let k = 0; k < n; k++) s += nsvg('rect', { x: 2, y: 4 + k * 6, width: Math.max(3, bw - 4).toFixed(1), height: 2, fill: ch.night ? '#ffe9a8' : '#e6eef3', opacity: ch.night ? .8 : .5 }); return s; };
  if (ch.view === 'campus' || ch.view === 'park') {
    g.push(nsvg('rect', { x, y: horizon, width: w, height: base - horizon, fill: ch.view === 'park' ? '#8fb37e' : '#9ab596' }));
    for (let i = 0; i < 5; i++) {
      const tx = x + 9 + i * (w - 18) / 4.2, ty = horizon - R(6, 15), tr = R(7, 11);
      g.push(nsvg('rect', { x: tx - 1.4, y: ty, width: 2.8, height: horizon - ty + 4, fill: '#7a6248' }) + nsvg('circle', { cx: tx, cy: ty, r: tr, fill: i % 2 ? '#6f9568' : '#82a875' }));
    }
    g.push(nsvg('rect', { x: x + w * .56, y: horizon - 24, width: w * .3, height: 24, fill: '#cfc4b0' }) + nsvg('path', { d: 'M' + (x + w * .54) + ',' + (horizon - 24) + ' l' + w * .16 + ',-9 l' + w * .16 + ',9 Z', fill: '#a9603f' }));
  } else if (ch.view === 'skyline' || ch.view === 'tech') {
    g.push(nsvg('rect', { x, y: horizon, width: w, height: base - horizon, fill: '#8f9aa4' }));
    for (let i = 0; i < 6; i++) {
      const bw = R(9, 17), bh = ch.view === 'skyline' ? R(20, h * .74) : R(13, 24), bx = x + 3 + i * (w - 6) / 6;
      g.push(nsvg('g', { transform: 'translate(' + bx.toFixed(1) + ',' + (horizon - bh).toFixed(1) + ')' }, nsvg('rect', { width: bw.toFixed(1), height: bh.toFixed(1), rx: 1, fill: ch.view === 'tech' ? '#9fb2b8' : ['#7f8d9c', '#93a1ad', '#6f7d8c'][i % 3] }) + rows(bh, bw)));
    }
  } else if (ch.view === 'hutong' || ch.view === 'oldtown') {
    g.push(nsvg('rect', { x, y: horizon, width: w, height: base - horizon, fill: '#9b9a90' }));
    const hw = w * .46, gap = w * .27, roof = ch.night ? '#414c5c' : '#7d8794', ridge = ch.night ? '#2f3947' : '#646e7a';
    for (let i = 0; i < 3; i++) {
      const rx = x - hw * .22 + i * gap + R(-2, 2), rh = h * [.3, .42, .25][i] + R(-2, 3), ry = horizon - rh;
      g.push(nsvg('rect', { x: rx.toFixed(1), y: (ry + rh * .26).toFixed(1), width: hw.toFixed(1), height: (horizon - ry - rh * .26 + 2).toFixed(1), fill: ['#f0eadc', '#e4ddca', '#ece5d5'][i % 3] }));
      g.push(nsvg('path', { d: 'M' + (rx - 2).toFixed(1) + ',' + (ry + rh * .26).toFixed(1) + ' L' + (rx + hw * .2).toFixed(1) + ',' + ry.toFixed(1) + ' L' + (rx + hw * .8).toFixed(1) + ',' + ry.toFixed(1) + ' L' + (rx + hw + 2).toFixed(1) + ',' + (ry + rh * .26).toFixed(1) + ' Z', fill: roof }));
      g.push(nsvg('rect', { x: (rx + hw * .2).toFixed(1), y: (ry - 2.2).toFixed(1), width: (hw * .6).toFixed(1), height: 2.6, rx: 1.2, fill: ridge }));
      g.push(nsvg('rect', { x: (rx + hw * .2).toFixed(1), y: (ry + rh * .54).toFixed(1), width: (hw * .2).toFixed(1), height: (rh * .28).toFixed(1), fill: ch.night ? '#ffd98a' : '#8ea3ae' }));
      g.push(nsvg('rect', { x: (rx + hw * .58).toFixed(1), y: (ry + rh * .54).toFixed(1), width: (hw * .2).toFixed(1), height: (rh * .28).toFixed(1), fill: ch.night ? '#ffe3a8' : '#a9bcc6' }));
    }
    g.push(nsvg('path', { d: 'M' + x + ',' + (horizon + 1).toFixed(1) + ' L' + (x + w) + ',' + (horizon + 1).toFixed(1), stroke: '#77746a', 'stroke-width': 1.4, opacity: .55 }));
    g.push(nsvg('circle', { cx: x + w * .82, cy: horizon - 30, r: 9, fill: '#7fa06f' }) + nsvg('rect', { x: x + w * .82 - 1.4, y: horizon - 26, width: 2.8, height: 26, fill: '#7a6248' }));
  } else if (ch.view === 'mountain') {
    g.push(nsvg('rect', { x, y: horizon, width: w, height: base - horizon, fill: '#93a488' }));
    g.push(nsvg('path', { d: 'M' + x + ',' + horizon + ' L' + (x + w * .24) + ',' + (horizon - h * .4) + ' L' + (x + w * .46) + ',' + horizon + ' Z', fill: '#7c8fa0' }) + nsvg('path', { d: 'M' + (x + w * .3) + ',' + horizon + ' L' + (x + w * .64) + ',' + (horizon - h * .56) + ' L' + (x + w) + ',' + horizon + ' Z', fill: '#6b7f92' }));
    for (let i = 0; i < 5; i++) g.push(nsvg('rect', { x: x + 3 + i * (w / 5), y: horizon - 11, width: 9, height: 11, fill: '#a9b1a4' }));
  } else if (ch.view === 'river') {
    g.push(nsvg('rect', { x, y: horizon, width: w, height: base - horizon, fill: '#8fa79b' }));
    for (let i = 0; i < 4; i++) g.push(nsvg('rect', { x: x + 5 + i * (w / 4), y: horizon - 19, width: 11, height: 19, fill: '#9dab9a' }));
    g.push(nsvg('path', { d: 'M' + x + ',' + (horizon + 3) + ' Q' + (x + w * .5) + ',' + (horizon - 4) + ' ' + (x + w) + ',' + (horizon + 5) + ' L' + (x + w) + ',' + base + ' L' + x + ',' + base + ' Z', fill: '#8fb9cf' }));
  } else {
    g.push(nsvg('rect', { x, y: horizon, width: w, height: base - horizon, fill: '#9aa39c' }));
    for (let i = 0; i < 5; i++) g.push(nsvg('rect', { x: x + 3 + i * (w / 5), y: horizon - R(15, 32), width: R(11, 18), height: 40, fill: ['#98a2a8', '#a7b0b4', '#8b959d'][i % 3] }));
  }
  if (!ch.night) for (let i = 0; i < 2; i++) g.push(nsvg('ellipse', { cx: x + 10 + i * (w / 2), cy: y + 6 + i * 7, rx: 9, ry: 3.2, fill: '#ffffff', opacity: .65 }));
  return g.join('');
}

/* 卡片角标：插画构图描述（示意）+ 全部来自真实数据的卖点 */
function nestCardBadges(l) {
  const ch = nestCharacter(l);
  const real = [];
  if (l.roomType === '主卧·独卫') real.push('主卧 · 独卫');
  else if (l.roomType === '主卧') real.push('主卧');
  if (ch.pets > 0) real.push('室友养宠');
  (l.tags || []).forEach(t => { if (real.length < 3 && !real.includes(t)) real.push(t); });
  if (!real.length && l.payText) real.push(l.payText);
  return { art: ch.styleName + '·' + ch.shapeName + '·' + ch.viewShort, artLong: ch.styleName + ' · ' + ch.shapeName + ' · ' + ch.viewName, real: real.slice(0, 3), view: ch.viewName, variant: ch.variant };
}
/* 封面下方的地铁钩子：站名与坐标来自内置城市数据，距离为直线估算 */
function nestTransitHook(l) {
  const near = typeof window.nestNearestStation === 'function' ? window.nestNearestStation(l) : null;
  if (!near) return null;
  const line = near.lines.join(' / ');
  const dist = near.straightMetres < 1000 ? near.straightMetres + ' 米' : (near.straightMetres / 1000).toFixed(1) + ' 公里';
  return { station: near.name, line, dist, text: (line ? line + ' ' : '') + near.displayName, sub: '直线 ' + dist };
}
const symbolPaths={
  nest:'<path d="m2 11 10-8 10 8M5.5 10v9.7h13V10M9.5 19.4v-6.1l2.5-2 2.6 2v6.1"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.4"/>',
  heart:'<path d="M20.4 5.7a5.3 5.3 0 0 0-8.4 1 5.3 5.3 0 0 0-8.4-1c-3.6 4.2 1.1 9.3 8.4 14.4 7.3-5.1 12-10.2 8.4-14.4Z"/>',
  search:'<circle cx="10.4" cy="10.4" r="6.5"/><path d="m15.4 15.4 5 5"/>',
  down:'<path d="m6 9 6 6 6-6"/>',back:'<path d="m10 5-7 7 7 7M3 12h17"/>',
  sliders:'<path d="M3 7h9m4 0h5M3 17h3m4 0h11"/><circle cx="14" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m-14 4h2m3 0h3"/>',
  wallet:'<path d="M20 7H5a2 2 0 0 1 0-4h12v4M3 5v13a2 2 0 0 0 2 2h15V7m0 4h-5v5h5"/><path d="M17 13.5h.1"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  cube:'<path d="m12 2 9 5v10l-9 5-9-5V7Zm-9 5 9 5 9-5m-9 5v10m-4.5-17.5 9 5"/>',
  metro:'<rect x="5.5" y="3" width="13" height="13" rx="3.5"/><path d="M5.5 10.5h13M9.6 20.4 7.8 22.6M14.4 20.4l1.8 2.2M5.5 16h13v2.2h-13z"/><path d="M9.2 7.2h.1M14.8 7.2h.1"/>',
  pause:'<path d="M8 5v14m8-14v14" stroke-width="3.2"/>',play:'<path d="m7 4 12 8-12 8Z" fill="currentColor"/>'
};
function icon(name){return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(symbolPaths[name]||'')+'</svg>'}
const names=['日光客厅','窗边书房','暮色起居室'];
const REDUCE=matchMedia('(prefers-reduced-motion:reduce)');
let scene=0, heroPlayback=null, heroTimer=0;
let homeLimit=6,previousPage='',fromRoom='',fromPrefs='',releaseModel=null,releaseMap=null;
let favorites=new Set(), guestFavorites=new Set();
let preferenceDraft=null;
const storagePrefix='shixiwo-v3.';
let tripListingKey=null;
function selectTripListing(key){
  if(!LISTINGS.some(listing=>listing.key===key)) return;
  tripListingKey=key;
  if(!['results','map'].includes(currentPage()) || !searchState){navigate('map');return;}
  renderMap();
  $('#mapBox').scrollIntoView({block:'nearest',behavior:REDUCE.matches?'auto':'smooth'});
}
function syncMapSelection(){
  $$('#list [data-listing]').forEach(card=>{
    card.dataset.selected=String(card.dataset.listing===tripListingKey);
  });
}
function recall(key,fallback,session=false){
  try{return JSON.parse((session?sessionStorage:localStorage).getItem(storagePrefix+key))??fallback}catch{return fallback}
}
function remember(key,value,session=false){
  try{
    (session?sessionStorage:localStorage).setItem(storagePrefix+key,JSON.stringify(value));
    return true;
  }catch{ return false; }
}
function currentPage(){return (location.hash.slice(1)||'home').split('/')[0]}
function navigate(route){if(location.hash==='#'+route)applyRoute(false);else location.hash=route}
function listingRoute(l){return '#room/'+encodeURIComponent(l.key)}
let roomReturn=null;
const roomEntryControls='a[href],button';
function rememberRoomOrigin(trigger){
  if(currentPage()==='room')return;
  const control=trigger?.closest(roomEntryControls), card=control?.closest('.home-card');
  roomReturn={
    route:location.hash.slice(1)||'home', top:window.scrollY, control,
    key:card?.dataset.listing, index:card?[...card.querySelectorAll(roomEntryControls)].indexOf(control):-1
  };
}
function openDetail(iid,toTpl){
  const l=LISTINGS[iid];
  if(!l)return;
  rememberRoomOrigin(document.activeElement);
  navigate(listingRoute(l).slice(1)+(toTpl?'/agreement':''));
}
function saveQuery(){
  if(!searchState)return;
  const s=searchState;
  remember('search',{place:s.poi.name,poi:s.poi,from:isoDate(s.din),to:isoDate(s.dout),min:s.bmin,max:s.bmax},true)
}
let guideStep=1, guideBusy=false, listingsLoaded=false, listingsError='';
let savedQuery=null, resumeSearch=false, guideDestination='results';

function updateGuideButtons(){
  const unavailable=!listingsLoaded || !LISTINGS.length || guideBusy;
  $('#guideNext').disabled=unavailable;
  $('#btnSearch').disabled=unavailable;
  $('#guideBack').disabled=guideBusy;
}
function showGuideStep(step,focus=false){
  guideStep=step;
  const first=step===1;
  $('#searchZone').dataset.step=String(step);
  $('#guideStep').textContent=first?'01 / 04':'02 / 04';
  $('#guideTitle').textContent=first?'你在哪里实习？':'给找房划个范围。';
  $('#guideIntro').textContent=first?'从每天出发的地方，找到合适的家。':pendingAnchor?.name || '选择月租预算和入住时间。';
  $('#locPop').hidden=!first;
  $('#budgetPop').hidden=first;
  $('#datePop').hidden=first;
  $('#guideNext').hidden=!first;
  $('#guideBack').hidden=first;
  $('#btnSearch').hidden=first;
  $('#searchFeedback').textContent=listingsError || (!listingsLoaded?'正在加载房源…':!LISTINGS.length?'暂无房源数据。':'');
  updateGuideButtons();
  if(focus) $('#guideTitle').focus();
}
async function nextGuideStep(){
  if(guideBusy) return;
  guideBusy=true;updateGuideButtons();
  const typed=$('#poiText').value, page=currentPage(), selected=pendingAnchor;
  try{
    const poi=await resolveAnchor();
    if(currentPage()!==page || typed!==$('#poiText').value || selected!==pendingAnchor) return;
    if(!poi || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)){
      $('#searchFeedback').textContent=typed?'未能定位这个地点。请从搜索建议中选择，或按片区选。':'请先输入实习地点，或选择地标、片区。';
      const target=$('#pInput').classList.contains('on')?$('#poiText'):$('.loc-panes.on button');
      target?.focus();
      return;
    }
    pendingAnchor=poi; showLock(poi);
    saveSearchDraft(); navigate('needs');
  }finally{ guideBusy=false;updateGuideButtons(); }
}
function validBudget(){
  if(!($('#dIn').value && $('#dOut').value && $('#dIn').value < $('#dOut').value)){
    $('#searchFeedback').textContent='退租日期需要晚于入住日期。'; $('#dOut').focus(); return false;
  }
  if(!$('#budMin').value || !$('#budMax').value || +$('#budMin').value > +$('#budMax').value){
    $('#searchFeedback').textContent='月租上限需要大于或等于下限。'; $('#budMax').focus(); return false;
  }
  return true;
}
function saveSearchDraft(){
  remember('searchDraft', {
    place:$('#poiText').value, poi:pendingAnchor, from:$('#dIn').value, to:$('#dOut').value,
    min:+$('#budMin').value, max:+$('#budMax').value
  },true);
}
function submitGuide(){
  if(!validBudget()) return;
  saveSearchDraft(); navigate('habits');
}
async function finishMatching(){
  if(guideBusy) return;
  if(!listingsLoaded || !LISTINGS.length){ $('#qFeedback').textContent=listingsError || '正在加载房源，请稍候。'; return; }
  const profile=readPreferenceDraft();
  if(!profile.gender || !profile.pet || profile.rhythm===undefined || profile.smoke===undefined || !/^[EI][SN][TF][JP]$/.test(profile.mbti)){
    $('#qFeedback').textContent='请完成生活习惯和室友偏好。';
    const missingMbti=[...profile.mbti].indexOf('_');
    if(!profile.gender) $('#qGender button').focus();
    else if(missingMbti>=0) $('#maskQ [data-p="'+missingMbti+'"] button')?.focus();
    return;
  }
  guideBusy=true; $('#btnQApply').disabled=true;
  $('#qFeedback').textContent='正在匹配房源与室友…';
  const origin=currentPage();
  try{
    if(window.housingBackend?.signedIn()) await window.housingBackend.savePreferences(profile);
    saveProfile(profile);
    if(await doSearch({useDraft:true})){
      saveQuery(); resumeSearch=false;
      $('#qFeedback').textContent='';
      if(currentPage()===origin) navigate(guideDestination);
    }else{
      $('#qFeedback').textContent=$('#searchFeedback').textContent || '暂时无法完成匹配，请重试。';
    }
  }catch(error){ $('#qFeedback').textContent=error.message; }
  finally{ guideBusy=false; $('#btnQApply').disabled=false; }
}
function restoreQuery(query){
  if(!query || !Number.isFinite(query.poi?.lat) || !Number.isFinite(query.poi?.lng) ||
    !query.poi?.name || !(Date.parse(query.from)<Date.parse(query.to))) return false;
  pendingAnchor=query.poi;
  $('#poiText').value=query.place || query.poi.name;
  showLock(pendingAnchor);
  $('#dIn').value=query.from; $('#dOut').value=query.to;
  for(const [id,value] of [['budMin',query.min],['budMax',query.max]]){
    const field=$('#'+id);
    if([...field.options].some(o=>o.value===String(value))) field.value=String(value);
  }
  return true;
}
function listingsReady(){
  listingsLoaded=true;
  listingsError='';
  if(savedQuery){
    resumeSearch=restoreQuery(savedQuery);
    savedQuery=null;
  }
  applyRoute(false);
}
function sceneChange(to){
  scene=(to+names.length)%names.length;
  $$('.hero-photos div').forEach((el,i)=>el.classList.toggle('active',i===scene));
  $$('.slide-dots button').forEach((el,i)=>el.setAttribute('aria-pressed',String(i===scene)));
  $('#sceneName').textContent=names[scene];
}
function runCarousel({restart=false}={}){
  const playing=heroPlayback ?? !REDUCE.matches;
  const visible=!document.hidden && !$('#journeyLayout').hidden;
  const button=$('#pauseHero');
  const label=playing?'暂停轮播':'播放轮播';
  if(button.getAttribute('aria-label')!==label || !button.firstChild){
    button.innerHTML=icon(playing?'pause':'play');
    button.setAttribute('aria-label',label);
  }

  if(heroTimer && (!playing || !visible || restart)){
    clearInterval(heroTimer);
    heroTimer=0;
  }
  if(!heroTimer && playing && visible){
    heroTimer=setInterval(()=>sceneChange(scene+1),6000);
  }
}
function homeCard(l,result=null,mode='walk'){
  const score=result?.match??matchEval(l),passed=score?.pass!==false, url=listingRoute(l);
  const cost=result&&passed?result.total:l.rent;
  const meta=escapeHtml(l.layout)+' · '+l.roomSqm+'㎡ · '+escapeHtml(l.channel);
  const match=score?.pass?'<span class="room-score">合拍 '+score.score+' 分</span>':'';
  const shortName=l.community.replace(l.area+'·','');
  const badges=nestCardBadges(l),transit=nestTransitHook(l);
  const feat=badges.real.map(t=>'<span class="feat-chip'+(/养宠/.test(t)?' pet':'')+'">'+escapeHtml(t)+'</span>').join('');
  const trip=transit?'<p class="house-transit">'+icon('metro')+'<b>'+escapeHtml(transit.text)+'</b><span>'+escapeHtml(transit.sub)+'</span></p>':'';
  return `<article class="home-card" data-listing="${escapeHtml(l.key)}"><div class="room-photo">${nestCoverSVG(l)}<span class="cover-art" title="${escapeHtml(badges.artLong)}">${escapeHtml(badges.art)}</span><button type="button" class="photo-trip" data-trip="${escapeHtml(l.key)}" aria-label="查看${escapeHtml(l.community)}的通勤路线"></button><a href="${url}" class="house-tag" aria-label="查看${escapeHtml(l.community)}的立体户型">${icon('cube')}3D 户型</a></div>
    <button class="heart-btn" data-save="${escapeHtml(l.key)}" aria-label="收藏${escapeHtml(l.community)}">${icon('heart')}</button>
    <button type="button" class="house-body house-trip" data-trip="${escapeHtml(l.key)}" aria-label="查看${escapeHtml(l.community)}到实习地点的通勤路线"><span class="area-label">${icon('pin')}${escapeHtml(l.district)} · ${escapeHtml(shortName)}</span>
    <h3>${escapeHtml(l.area)} · ${escapeHtml(l.roomType)}</h3><p class="house-meta">${meta}</p>
    ${feat?'<div class="house-feat">'+feat+'</div>':''}
    ${result?.match?.pass?'<p class="match-note">'+result.l.roommates.length+' 位室友 · '+escapeHtml(result.match.chips[0] || '查看生活习惯匹配')+'</p>':''}
    ${trip}
    ${result&&!passed?'<p class="house-flag">'+escapeHtml(score.hard.join(' · '))+'</p>':''}
    <div class="house-foot"><span class="house-price">¥${fmt(cost)}<small>${result&&passed?'月总成本':'/ 月租'}</small></span>
    ${match||''}<span class="house-channel">看通勤路线 ↗</span></div></button></article>`;
}
function favoriteIds(values){
  return new Set(Array.isArray(values) ? values.filter(id=>typeof id==='string' && id.trim() && id.length<=80) : []);
}
function storeGuestFavorites(ids){
  guestFavorites=ids;
  remember('favorites',[...ids]);
}
function syncHearts(){
  const busy=window.housingBackend?.favoritesBusy() || false;
  $$('[data-save]').forEach(button=>{
    const listing=LISTINGS.find(item=>item.key===button.dataset.save);
    const active=favorites.has(button.dataset.save);
    button.disabled=busy;
    button.setAttribute('aria-pressed',String(active));
    button.title=active?'取消收藏':'收藏房源';
    button.setAttribute('aria-label',button.title+' · '+(listing?.community || ''));
  });
  $('#roomSave').disabled=busy;
}
function setFavoriteIds(ids){
  const next=new Set(ids);
  const changed=next.size!==favorites.size || [...next].some(id=>!favorites.has(id));
  favorites=next;
  if(changed && currentPage()==='saved' && !$('#savedPage').hidden) renderSaved();
  else syncHearts();
  if(currentPage()==='room' && curListing) updateRoomSave();
}
function toggleGuestFavorite(key){
  const ids=new Set(guestFavorites);
  if(ids.has(key)) ids.delete(key); else ids.add(key);
  storeGuestFavorites(ids);
  setFavoriteIds(ids);
}
function toggleFavorite(key){
  if(window.housingBackend) window.housingBackend.toggleFavorite(key);
  else toggleGuestFavorite(key);
}
function updateRoomSave(){
  const active=favorites.has(curListing?.key);
  const button=$('#roomSave');
  button.disabled=window.housingBackend?.favoritesBusy() || false;
  button.setAttribute('aria-pressed',String(active));
  button.innerHTML=icon('heart')+(active?'已收藏':'收藏房源');
}
function renderSaved(){
  const rows=LISTINGS.filter(l=>favorites.has(l.key));
  $('#savedCards').innerHTML=rows.length?rows.map(l=>homeCard(l)).join(''):'<div class="empty"><h3>收藏夹还是空的</h3><p>点一下房源图片上的爱心，就能在这里比较喜欢的住处。</p><a href="#home" class="quiet-button">去发现房源</a></div>';syncHearts();
}
function renderDiscovery(){
  const area=$('#areaFilter'),value=area.value;
  const districts=[...new Set(LISTINGS.map(l=>l.district))];
  $('#coverageLabel').textContent=AREAS.length+' 个片区 · '+LISTINGS.length+' 套模拟房源';
  area.innerHTML='<option value="">全部片区</option>'+districts.map(d=>'<option>'+escapeHtml(d)+'</option>').join('');
  if(districts.includes(value))area.value=value;
  // Interleave neighborhoods and layouts so the first row offers different choices.
  const groups=new Map();
  LISTINGS.filter(l=>(!area.value||l.district===area.value)&&(!Q||matchEval(l)?.pass!==false)).forEach(l=>{
    if(!groups.has(l.area))groups.set(l.area,[]);groups.get(l.area).push(l);
  });
  const buckets=[...groups.values()].map((rows,i)=>rows.slice(i%rows.length).concat(rows.slice(0,i%rows.length)));
  const ordered=[];
  for(let i=0;buckets.some(group=>i<group.length);i++)buckets.forEach(group=>{if(group[i])ordered.push(group[i])});
  $('#discoveryCards').innerHTML=ordered.length?ordered.slice(0,homeLimit).map(l=>homeCard(l)).join(''):'<div class="empty"><h3>这个片区暂时没有合拍的房源</h3><p>可以切换片区，或调整室友偏好。</p></div>';
  $('#moreHomes').hidden=ordered.length<=homeLimit;
  syncHearts();
}
function saveProfile(profile){
  Q=profile;remember('profile',profile);updateProfile();renderDiscovery();
}
function updateProfile(){
  $('#prefAction').textContent=Q?'编辑室友偏好':'设置室友偏好';
  $('#btnQ').textContent=$('#prefAction').textContent;
  $('#prefBlurb').textContent=Q?RhythmNames[Q.rhythm]+' · '+['希望室友不吸烟','接受室外吸烟','我吸烟'][Q.smoke]+' · '+Q.mbti:'早睡还是夜猫子？把生活习惯放进找房条件。';
  $('#qState').textContent=Q?'已按你的室友偏好筛选。':'';
}
function showPrefForm(){
  const profile=preferenceDraft || Q;
  const selected={qGender:profile?.gender,qRhythm:profile?.rhythm,qSmoke:profile?.smoke,qPet:profile?.pet};
  $$('#maskQ .seg').forEach(group=>{
    const val=group.id?selected[group.id]:profile?.mbti?.[+group.dataset.p];
    group.querySelectorAll('button').forEach(button=>{
      const selected=val!=null && String(val)===button.dataset.v;
      button.classList.toggle('on',selected);button.setAttribute('aria-pressed',String(selected));
    });
  });
  const habits=currentPage()==='habits';
  $('#habitTitle').textContent=habits?'怎样住得更自在？':'找到合拍的室友。';
  $('#habitIntro').textContent=habits?'选择你的作息、吸烟和宠物偏好。':'结合入住规则与性格偏好，匹配现有室友。';
  $('#habitStep').textContent=habits?'03 / 04':'04 / 04';
  $$('#maskQ [data-profile-page]').forEach(item=>item.hidden=item.dataset.profilePage!==currentPage());
  $('#habitNext').hidden=!habits;
  $('#btnQApply').hidden=habits;
  $('#ruleBox').hidden=habits;
  $('#qFeedback').textContent='';draftProgress();
}
function readPreferenceDraft(){
  const value=id=>$('#'+id+' button.on')?.dataset.v;
  const rhythm=value('qRhythm'), smoke=value('qSmoke');
  return {gender:value('qGender'),pet:value('qPet'),rhythm:rhythm===undefined?undefined:+rhythm,
    smoke:smoke===undefined?undefined:+smoke, mbti:$$('#maskQ [data-p]').map(group=>group.querySelector('.on')?.dataset.v || '_').join('')};
}

function draftProgress(){
  if(!guideBusy) $('#qFeedback').textContent='';
  preferenceDraft=readPreferenceDraft();
  remember('preferenceDraft',preferenceDraft,true);
}

function returnToOrigin(origin){if(origin)history.back();else location.replace('#home')}
function returnFromPrefs(){returnToOrigin(fromPrefs&&fromPrefs!=='preferences'?fromPrefs:'')}
function drawRoomExtras(l,commuteCost){
  if(releaseModel)releaseModel();
  releaseModel=window.mountNestModel?.($('#modelStage'),l)||null;
  const slices=[['月租',l.rent,'#b45b3e'],['服务费',l.svc,'#cc9b63'],['水电网',l.util,'#79927e'],['通勤',commuteCost,'#54828d']].filter(row=>row[1]>0);
  $('#costChart').innerHTML='<div class="stack-bar" aria-hidden="true">'+slices.map(([,value,color])=>'<i style="flex:'+value+';background:'+color+'"></i>').join('')+'</div><div class="stack-key">'+slices.map(([label,value,color])=>'<span><i style="background:'+color+'"></i>'+label+' ¥'+fmt(value)+'</span>').join('')+'</div>';
  updateRoomSave();
}
function renderRoute(focus=true){
  const raw=location.hash.slice(1)||'home';
  const page=currentPage(),known=['home','needs','habits','browse','results','map','room','saved','preferences'].includes(page);
  if(!known){location.replace('#home');return}
  const last=previousPage.split('/')[0];
  if(page==='room'&&last!=='room')fromRoom=previousPage;
  if(['habits','preferences'].includes(page)&&!['habits','preferences'].includes(last))fromPrefs=previousPage;
  previousPage=raw;document.body.dataset.page=page;
  if(releaseModel&&page!=='room'){releaseModel();releaseModel=null}
  if(releaseMap&&!['map','results'].includes(page)){releaseMap();releaseMap=null}
  const resultsPage=page==='map'||page==='results';
  const needsGuide=page==='home'||page==='needs'||(resultsPage&&!searchState);
  const stages=['home','needs','habits','preferences'];
  const stage=stages.indexOf(page);
  $('#journeyProgress').hidden=stage<0;
  $$('#journeyProgress li').forEach((item,index)=>{
    if(index===stage)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
    item.classList.toggle('complete',index<stage);
  });
  if(listingsLoaded && ['needs','habits','preferences'].includes(page) && !pendingAnchor){
    location.replace('#home');return;
  }
  const dataPage=['room','browse','saved'].includes(page);
  const showDataStatus=dataPage&&(!listingsLoaded||!!listingsError);
  const vis=(id,on)=>$('#'+id).hidden=!on;
  vis('discover',page==='browse'&&!showDataStatus);vis('prefBanner',false);
  vis('journeyLayout',needsGuide||['habits','preferences'].includes(page));
  runCarousel();
  vis('searchZone',needsGuide);vis('results',resultsPage&&!!searchState);vis('savedPage',page==='saved'&&!showDataStatus);
  vis('maskQ',page==='preferences'||page==='habits');vis('maskDetail',page==='room'&&!showDataStatus);vis('missingPage',false);
  vis('pageStatus',showDataStatus);$('#pageStatus').textContent=listingsError || '正在加载房源…';
  const titles={map:['北京 · 通勤估算','通勤地图'],results:['北京 · 租期与预算','匹配房源'],saved:['','我的收藏'],preferences:['用于房源筛选与匹配','室友偏好']};
  vis('pageLead',!!titles[page]&&!needsGuide&&page!=='preferences'&&!resultsPage);if(titles[page]){ $('#leadKicker').textContent=titles[page][0];$('#leadTitle').textContent=titles[page][1] }
  $$('[data-nav]').forEach(link=>{if(link.dataset.nav===(['needs','results'].includes(page)?'home':page==='preferences'?'habits':page))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
  if(page==='preferences'||page==='habits')showPrefForm();
  if(page==='browse'&&!showDataStatus)renderDiscovery();
  if(page==='saved'&&!showDataStatus)renderSaved();
  if(needsGuide){
    if(page==='map') guideDestination='map';
    else if(last!=='map'||page==='results') guideDestination='results';
    showGuideStep(page==='needs'?2:1);
    if(resultsPage&&resumeSearch&&listingsLoaded){
      resumeSearch=false;
      if(Q) doSearch({useDraft:true}).then(ok=>{if(ok)applyRoute(false)});
      else navigate('habits');
    }
  }
  if(showDataStatus) return;
  if(page==='room'){
    let key;try{key=decodeURIComponent(raw.split('/')[1]||'')}catch{key=''}
    const index=LISTINGS.findIndex(l=>l.key===key);
    if(index>=0)fillDetail(index,raw.split('/')[2]==='agreement');
    else{vis('maskDetail',false);vis('missingPage',true)}
  }
  if(resultsPage&&searchState){
    $('#resultToolbar').prepend($('#tabs'));
    $('#resultsTitle').textContent=page==='map'?'通勤范围内的房源':'适合你的房源与室友';
    setResultView(page==='map'?'map':'list');
    $('#btnMapView').textContent=page==='map'?'返回匹配结果':'展开地图';
    render();
  }
  document.title=(needsGuide?'填写找房需求':page==='room'?(curListing?.community||'房源详情'):titles[page]?.[1]||'浏览房源')+' · 长虹居';
  if(focus){
    if(last==='room'&&roomReturn?.route===raw){
      const {top,control,key,index}=roomReturn;
      const card=key&&$$('.home-card[data-listing="'+CSS.escape(key)+'"]').find(item=>item.getClientRects().length);
      const target=control?.getClientRects().length?control:card?.querySelectorAll(roomEntryControls)[index];
      const fallback=resultsPage?$('#resultsTitle'):page==='saved'?$('#leadTitle'):$('#discover h2');
      (target || fallback)?.focus({preventScroll:true});
      window.scrollTo({top,behavior:'instant'});
      return;
    }
    window.scrollTo(0,0);
    const heading=needsGuide?$('#guideTitle'):resultsPage?$('#resultsTitle'):['habits','preferences'].includes(page)?$('#habitTitle'):page==='room'?$('#dtTitle'):page==='browse'?$('#discover h2'):$('#leadTitle');
    if(heading&&!heading.closest('[hidden]')){heading.tabIndex=-1;heading.focus({preventScroll:true})}
    if(page==='map'&&searchState&&tripListingKey)requestAnimationFrame(()=>{if(currentPage()==='map')$('#map').scrollIntoView({block:'center'})});
  }
}
let activeTransition=null, renderedRoute='';
function applyRoute(focus=true){
  const route=location.hash || '#home';
  const changed=renderedRoute && renderedRoute!==route;
  renderedRoute=route;
  activeTransition?.skipTransition();
  if(!changed || window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    renderRoute(focus); return;
  }
  const stageOrder=['#home','#needs','#habits','#preferences','#results'];
  const backwards=stageOrder.indexOf(route)>=0 && stageOrder.indexOf(route)<stageOrder.indexOf(previousRoute);
  document.documentElement.dataset.direction=backwards?'back':'forward';
  if(document.startViewTransition){
    activeTransition=document.startViewTransition(()=>renderRoute(focus));
    activeTransition.ready.catch(()=>{});
    activeTransition.updateCallbackDone.catch(()=>{});
    const transition=activeTransition;
    transition.finished.catch(()=>{}).finally(()=>{if(activeTransition===transition)activeTransition=null});
  }else{
    renderRoute(focus);
    $('#content').animate([
      {transform:'perspective(1400px) rotateY(7deg) translateZ(-35px)',opacity:0},
      {transform:'perspective(1400px) rotateY(0deg) translateZ(0)',opacity:1}
    ],{duration:360,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
}
let previousRoute='';
window.addEventListener('hashchange',event=>{previousRoute=new URL(event.oldURL).hash || '#home'});

function startNest(){
  document.addEventListener('click',e=>{
    const link=e.target.closest('a[href^="#room/"]');
    if(link&&!e.defaultPrevented&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey) rememberRoomOrigin(link);
    const action=e.target.closest('[data-trip]');
    if(action)selectTripListing(action.dataset.trip);
  });
  $('#roomTrip').onclick=()=>{if(curListing)selectTripListing(curListing.key)};
  $$('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  $('.slide-dots').innerHTML=names.map((name,i)=>'<button type="button" aria-label="切换到'+name+'" data-slide="'+i+'"></button>').join('');
  $$('.slide-dots button').forEach(button=>button.onclick=()=>{
    sceneChange(Number(button.dataset.slide));
    runCarousel({restart:true});
  });
  $('#pauseHero').onclick=()=>{
    heroPlayback=!(heroPlayback ?? !REDUCE.matches);
    runCarousel();
  };
  sceneChange(0);
  document.addEventListener('visibilitychange',runCarousel);
  REDUCE.addEventListener('change',runCarousel);
  guestFavorites=favoriteIds(recall('favorites',[]));
  setFavoriteIds(guestFavorites);
  window.addEventListener('storage',event=>{
    if(event.key===storagePrefix+'favorites' || event.key===null){
      guestFavorites=favoriteIds(recall('favorites',[]));
      if(!window.housingBackend?.signedIn()) setFavoriteIds(guestFavorites);
    }
  });
  const savedProfile=recall('profile',null);
  if(savedProfile&&['男','女'].includes(savedProfile.gender)&&['has','accept','reject'].includes(savedProfile.pet)&&Number.isInteger(savedProfile.rhythm)&&savedProfile.rhythm>=0&&savedProfile.rhythm<4&&Number.isInteger(savedProfile.smoke)&&savedProfile.smoke>=0&&savedProfile.smoke<3&&/^[EI][SN][TF][JP]$/.test(savedProfile.mbti))Q=savedProfile;
  preferenceDraft=recall('preferenceDraft',null,true) || Q;
  savedQuery=recall(['results','map'].includes(currentPage())?'search':'searchDraft',null,true) || recall('search',null,true);
  if(!backendPage){
    listingsLoaded=true;
    resumeSearch=restoreQuery(savedQuery);
    savedQuery=null;
  }
  updateProfile();
  document.addEventListener('click',e=>{const b=e.target.closest('[data-save]');if(b)toggleFavorite(b.dataset.save)});
  $('#guideNext').onclick=nextGuideStep;
  $('#guideBack').onclick=()=>{saveSearchDraft();navigate('home')};
  $('#habitBack').onclick=()=>navigate(currentPage()==='habits'?'needs':'habits');
  $('#habitNext').onclick=()=>{
    const draft=readPreferenceDraft();
    const missing=draft.rhythm===undefined?'#qRhythm':draft.smoke===undefined?'#qSmoke':!draft.pet?'#qPet':null;
    if(missing){
      $('#qFeedback').textContent='请完成作息、吸烟和宠物三项选择。';
      $(missing+' button').focus();
      return;
    }
    navigate('preferences');
  };
  $('#btnSearch').onclick=submitGuide;
  $('#editSearch').onclick=()=>{
    resumeSearch=false;
    restoreQuery(recall('search',null,true));
    guideDestination=currentPage()==='map'?'map':'results';
    showGuideStep(1);navigate('home');
  };
  $('#searchZone').addEventListener('input',()=>{resumeSearch=false;if(listingsLoaded && LISTINGS.length) $('#searchFeedback').textContent='';saveSearchDraft()});
  $('#searchZone').addEventListener('change',saveSearchDraft);
  window.addEventListener('housing:listings-ready',listingsReady);
  window.addEventListener('housing:listings-error',event=>{
    listingsLoaded=false;listingsError=event.detail?.message || '暂时无法读取房源，请刷新页面重试。';applyRoute(false);
  });
  $('#areaFilter').onchange=()=>{homeLimit=6;renderDiscovery()};$('#moreHomes').onclick=()=>{homeLimit+=6;renderDiscovery()};
  $('#maskQ').addEventListener('click',e=>{if(e.target.closest('.seg button'))draftProgress()});

  $('#roomSave').onclick=()=>{if(curListing)toggleFavorite(curListing.key)};
  $('#backRoom').onclick=()=>returnToOrigin(fromRoom);
  $('.page-footer').insertAdjacentHTML('beforeend','<div class="footer-sign"><b>长虹居</b></div>');
  window.addEventListener('hashchange',()=>applyRoute());window.nestReady=true;applyRoute(false);
}

/* ============ 启动 ============ */
if(backendPage){
  $('#btnSearch').disabled = true;
  $('#csvImportLabel').hidden = true;
  $('#sharedDataNote').hidden = false;
  $('#summary').textContent = '正在加载共享房源。';
}else{
  try{
    loadData(NEST_LISTING_CSV, CSV_NAME);
  }catch(err){
    console.error(err);
    $('#list').innerHTML = '<div class="empty">数据集解析失败：'+escapeHtml(err.message)+'</div>';
  }
}
buildForm();
startNest();
