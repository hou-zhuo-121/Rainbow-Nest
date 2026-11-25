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
  if(searchState) doSearch();
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
async function amapLocate(text){
  if(!AMAP_KEY) return null;
  try{
    const tips = await fetch(`https://restapi.amap.com/v3/assistant/inputtips?key=${AMAP_KEY}&city=北京&citylimit=true&keywords=${encodeURIComponent(text)}`).then(r=>r.json());
    const t = (tips&&tips.status==='1'&&tips.tips||[]).find(x=>x.location);
    if(t){ const [lng,lat]=t.location.split(',').map(Number); return {name:t.name, lng, lat, mode:'amap', kind:'在线定位', note:'高德 inputtips'}; }
    const geo = await fetch(`https://restapi.amap.com/v3/geocode/geo?key=${AMAP_KEY}&city=北京&address=${encodeURIComponent(text)}`).then(r=>r.json());
    const g = (geo&&geo.status==='1'&&geo.geocodes||[])[0];
    if(g){ const [lng,lat]=g.location.split(',').map(Number); return {name:g.formatted_address||text, lng, lat, mode:'amap', kind:'门牌号', note:'高德地理编码'}; }
  }catch(e){ console.warn('高德在线定位失败，回落离线兜底', e); }
  return null;
}
async function resolveAnchor(){
  if(pendingAnchor) return pendingAnchor;
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
    const b=document.createElement('button'); b.className='chip'+(i===0?' on':''); b.dataset.n=nm;
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
    const b=document.createElement('button'); b.className='chip'+(i===0?' on':''); b.textContent=a.area;
    b.onclick=()=>{ $$('#areaChips .chip').forEach(x=>x.classList.remove('on')); b.classList.add('on');
      pendingAnchor = anchorFromPOI({name:a.district+'·'+a.area,lng:a.lng,lat:a.lat,kind:'片区',mode:'area',alias:''}); showLock(pendingAnchor); };
    wrap.appendChild(b);
  });
}
function showLock(a){
  lastAnchor = a;
  $('#lockedLoc').style.display='flex';
  $('#lockText').innerHTML = `已选 <b>${escapeHtml(a.name)}</b>` +
    (a.mode==='area' ? '<span class="lock-note">片区级估算</span>' : '');
  $('#searchFeedback').textContent = '';
  $('#sugList').classList.remove('on');
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

async function doSearch({bringIntoView = false} = {}){
  const version = ++searchVersion;
  const feedback = $('#searchFeedback');
  feedback.textContent = '';
  const poi = await resolveAnchor();
  if(version!==searchVersion) return;
  if(!poi || isNaN(poi.lat)){
    feedback.textContent = '请先输入实习地点，或选择地标、片区。';
    return;
  }
  showLock(poi);
  const din = new Date($('#dIn').value), dout = new Date($('#dOut').value);
  if(!(din<dout)){
    feedback.textContent = '退租日期需要晚于入住日期。';
    $('#dOut').focus();
    return;
  }
  const days = Math.round((dout-din)/86400000);
  const bmin=+$('#budMin').value, bmax=+$('#budMax').value;
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
    buckets[k].sort((a,b)=>a.total-b.total);
  });
  searchState = {poi, buckets, days, bmin, bmax, din, dout, budCut, dateCut, fitCut,
                 filtered: [...filtered.values()],
                 pool: serverIds ? serverIds.size : LISTINGS.length - budCut - dateCut};
  searchState.nearest = AREAS.reduce((best, area)=>{
    const distance = hav(area.lat, area.lng, poi.lat, poi.lng);
    return !best || distance<best.d ? {a:area, d:distance} : best;
  }, null);
  showingExcluded = false;
  curTab = ['walk','bike','metro','taxi'].find(k=>buckets[k].length) || 'walk';
  $('#summary').textContent = `${poi.name} · ${days} 天 · 月租 ¥${fmt(bmin)}–${fmt(bmax)} · 模拟房源`;
  if(Q) $('#qState').textContent = '已应用室友偏好，结果显示匹配分。';
  $('#filterReport').innerHTML = `<li>预算与租期均符合 ${searchState.pool} 套</li>
    <li>超出预算 ${budCut} 套</li><li>租期不符 ${dateCut} 套</li>` +
    (fitCut ? `<li>另有 ${fitCut} 套符合所选租期，但未覆盖预设实习季。</li>` : '') +
    (Q ? `<li>室友条件不符 ${filtered.size} 套 ${filtered.size ? '<button type="button" id="seeCut" class="text-btn">查看原因</button>' : ''}</li>` : '');
  $('#seeCut')?.addEventListener('click', ()=>{
    showingExcluded = true;
    setResultView('list');
    render();
    $('#returnToResults').focus();
  });
  render();
  if(bringIntoView){
    $('#resultsTitle').focus({preventScroll:true});
    $('#results').scrollIntoView({block:'start', behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }
}
/* ============ 卡片与列表 ============ */
const TAB_RANGE = {walk:'≤ 1.5 公里', bike:'1.5–5 公里', metro:'≤ 30 分钟', taxi:'≤ 25 分钟'};

function cardHTML(result, mode){
  const {l, cm, match, iid, total} = result;
  const communityPrefix = l.area + '·';
  const community = l.community.startsWith(communityPrefix) ? l.community.slice(communityPrefix.length) : l.community;
  const risks = match?.pass === false
    ? match.hard.join(' · ')
    : l.roommates.some(person=>person.smoke===2) ? '有室友在室内吸烟' : '';
  const price = match?.pass === false ? l.rent : total;
  const costLabel = match?.pass === false ? '月租 / 间' : '每月总成本 · 含通勤';
  const commuteLabel = result.amapMinutes===undefined
    ? `${TAB_NAME[mode]}约 ${cm[mode].min} 分钟`
    : `高德${mode==='metro'?'公共交通':mode==='taxi'?'驾车':TAB_NAME[mode]}约 ${result.amapMinutes} 分钟`;
  return `<article class="card result-card" data-id="${iid}">
    <div class="card-top">
      <div>
        <p class="card-location">${escapeHtml(l.district)} · ${escapeHtml(l.area)}</p>
        <h3>${escapeHtml(l.roomType)} · ${escapeHtml(community)}</h3>
        <p class="loc">${l.roomSqm}㎡ · ${escapeHtml(l.layout)} · ${escapeHtml(l.channel)}</p>
      </div>
      <div class="card-price"><strong>¥${fmt(price)}</strong><span>${costLabel}</span></div>
    </div>
    <div class="card-foot">
      <div class="card-facts">
        ${match?.pass === false
            ? `<span class="risk">${escapeHtml(risks)}</span>`
            : `<strong>${commuteLabel}</strong><span>房租 ¥${fmt(l.rent)}/月</span>
               <span>${l.roommates.length ? `${l.roommates.length} 位室友` : '暂无室友资料'}</span>
               ${match ? `<strong>匹配 ${match.score} 分</strong>` : ''}
               ${risks ? `<span class="risk">${escapeHtml(risks)}</span>` : ''}`}
      </div>
      <button type="button" class="text-btn card-detail" data-d="${iid}" aria-haspopup="dialog">查看详情 <span aria-hidden="true">›</span></button>
    </div>
  </article>`;
}

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
    : `${TAB_NAME[curTab]} ${TAB_RANGE[curTab]} · 按月总成本排序`;
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
  window.housingBackend?.renderRouteControl();
  renderMap();
}

/* ============ 地图 ============ */
let map, layerGroup;
function initMap(){
  if(typeof L==='undefined'){
    $('#mapBox').classList.add('is-offline');
    $('#map').hidden = true;
    $('#mapNote').textContent = '地图暂未加载。联网后刷新页面可恢复，房源列表仍可查看。';
    return;
  }
  map = L.map('map',{zoomControl:true});
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    {subdomains:['1','2','3','4'], maxZoom:18, attribution:'© 高德地图'}).addTo(map);
  map.setView([39.92,116.40], 11);
  layerGroup = L.layerGroup().addTo(map);
}
const RADII = {walk:1500, bike:5000};
function renderMap(){
  if(!searchState || !$('#mapBox').getClientRects().length) return;
  if(!map) initMap();
  if(!map) return;
  map.invalidateSize({pan:false});
  layerGroup.clearLayers();
  const {poi,buckets}=searchState;
  const items = buckets[curTab];
  L.marker([poi.lat,poi.lng],{icon:L.divIcon({className:'',html:'<div class="map-anchor">'+escapeHtml(poi.name)+'</div>',iconAnchor:[10,30]})}).addTo(layerGroup);
  let radius = RADII[curTab];
  if((curTab==='metro'||curTab==='taxi') && items.length) radius = Math.max(...items.map(b=>b.cm.d))*1000 + 300;
  const col = '#176451';
  if(radius) L.circle([poi.lat,poi.lng],{radius, color:col, weight:1.5, dashArray:'6 5', fillColor:col, fillOpacity:.07}).addTo(layerGroup);
  items.forEach(b=>{
    L.circleMarker([b.l.lat,b.l.lng],{radius:7, color:'#fff', weight:2, fillColor:col, fillOpacity:.95})
      .bindTooltip(`${escapeHtml(b.l.roomType)} · ${escapeHtml(b.l.area)} · 月总 ¥${fmt(b.total)}`)
      .on('click',()=>openDetail(b.iid))
      .addTo(layerGroup);
  });
  map.setView([poi.lat,poi.lng], curTab==='walk'?13:12);
  $('#mapNote').textContent = items.length
    ? `${items.length} 套房源 · 点击标记查看详情`
    : '当前通勤方式下没有符合条件的房源。';
}

/* ============ 详情弹窗 ============ */
let curListing=null, tplDirty=false;
function openDetail(iid, toTpl){
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
  openM('maskDetail');
  window.housingBackend?.showFavorite(l);
  $('#maskDetail').scrollTop = 0;
  $('#maskDetail .modal').scrollTop = 0;
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
  <div class="tp-sub">（实习生短租版 · 由「实习窝」按房源 ${escapeHtml(l.key)} 自动生成，${isoDate(new Date())}）</div>
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
    + `<div class="ps-foot">本文本由「实习窝」原型按房源字段自动生成，已在页面内在线编辑；打印时可选择「另存为 PDF」。生成的模板供参考，签署前请核对房屋产权、出租方身份与原始租赁合同。数据来源：${escapeHtml(SRC_LABEL)}。</div>`;
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
  $$('.mode').forEach(b=>b.onclick=()=>{
    $$('.mode').forEach(x=>{
      x.classList.toggle('on', x===b);
      x.setAttribute('aria-pressed', String(x===b));
    });
    $$('.loc-panes').forEach(p=>p.classList.toggle('on', p.id===b.dataset.pane));
    pendingAnchor=null; $('#lockedLoc').style.display='none';
  });
  const inp=$('#poiText'), box=$('#sugList'); let sel=-1;
  const paint=(items,q)=>{
    if(!items.length){ box.classList.remove('on'); box.innerHTML=''; return; }
    box.innerHTML = items.map((it,i)=>`<div class="sug-item${i===sel?' sel':''}" data-i="${i}">
        <span class="sg-kind">${escapeHtml(it.kind)}</span><span>${hl(it.name,q)}</span>
        <span class="sg-meta">${it.mode==='area'?'片区中心':escapeHtml(it.note||'')}</span></div>`).join('');
    box.classList.add('on');
    $$('.sug-item', box).forEach(el=>el.addEventListener('mousedown',e=>{e.preventDefault(); choose(items[+el.dataset.i], inp.value);}));
  };
  function choose(it, raw){
    pendingAnchor = anchorFromPOI(it, raw);
    inp.value = it.name;
    box.classList.remove('on'); sel=-1;
    showLock(pendingAnchor);
    setLocHint('');
  }
  inp.addEventListener('input', async ()=>{
    const q = inp.value; pendingAnchor=null; $('#lockedLoc').style.display='none';
    if(!q.trim()){ box.classList.remove('on'); sel=-1; setLocHint(''); return; }
    let items = suggest(q);
    if(!items.length && AMAP_KEY){
      setLocHint('本地索引未命中，正在请求高德输入提示…');
      const online = await amapLocate(q);
      if(online){ items=[{name:online.name,lng:online.lng,lat:online.lat,kind:online.kind,alias:'',mode:online.mode}]; }
    }
    sel = items.length?0:-1;
    paint(items, q);
    if(!items.length){
      const fb = resolveFreeText(q);
      setLocHint(fb ? '可用附近片区估算。' : '暂未找到这个地点。试试公司简称，或按片区选。', fb ? 'ok' : 'err');
      if(fb){ pendingAnchor = {...fb}; showLock(pendingAnchor); }
    }else{
      setLocHint('');
    }
  });
  inp.addEventListener('keydown',e=>{
    const items = suggest(inp.value);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      if(!items.length) return; e.preventDefault();
      sel = (sel + (e.key==='ArrowDown'?1:-1) + items.length) % items.length;
      paint(items, inp.value);
    } else if(e.key==='Enter'){
      if(sel>=0 && items[sel]){ e.preventDefault(); choose(items[sel], inp.value); }
      else if(items.length){ e.preventDefault(); choose(items[0], inp.value); }
    } else if(e.key==='Escape'){ box.classList.remove('on'); }
  });
  inp.addEventListener('blur', ()=>setTimeout(()=>box.classList.remove('on'),80));
  $('#lockClear').onclick=()=>{ pendingAnchor=null; $('#lockedLoc').style.display='none'; $('.mode[data-pane="pInput"]').click(); $('#poiText').focus(); };

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
    openM('maskQ');
  };
  $('#btnSearch').onclick=()=>doSearch({bringIntoView:true});
  $('#btnReset').onclick=()=>{ location.reload(); };
  $('#btnQApply').onclick=async ()=>{
    const g=$('#qGender button.on')?.dataset.v;
    const pet=$('#qPet button.on')?.dataset.v;
    const rh=$('#qRhythm button.on')?.dataset.v;
    const sm=$('#qSmoke button.on')?.dataset.v;
    const mb=$$('#maskQ .seg[data-p] button.on').map(b=>b.dataset.v);
    if(!g||!pet||rh===undefined||mb.length!==4||sm===undefined){
      $('#qFeedback').textContent = '请完成五项偏好，包括 MBTI 的四组选择。';
      return;
    }
    const profile={gender:g, pet, rhythm:+rh, smoke:+sm, mbti:mb.join('')};
    if(window.housingBackend?.signedIn()){
      const button = $('#btnQApply');
      button.disabled = true;
      try{
        await window.housingBackend.savePreferences(profile);
      }catch(error){
        $('#qFeedback').textContent = error.message;
        return;
      }finally{
        button.disabled = false;
      }
    }
    Q = profile;
    $('#qState').textContent = searchState ? '已应用室友偏好，结果显示匹配分。' : '已应用室友偏好，查找房源后将显示匹配分。';
    $('#btnQ').textContent = '编辑室友偏好';
    closeM('maskQ');
    if(searchState) doSearch();
  };
  $$('#tabs .tab').forEach(t=>t.onclick=()=>{
    curTab=t.dataset.k;
    showingExcluded = false;
    render();
  });
  $('#btnMapView').onclick=()=>{
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
