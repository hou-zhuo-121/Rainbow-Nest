(() => {
  let account = {user:null, preferences:null, favorites:[], csrf_token:''};
  let sessionRequest;
  let routeRequest;
  let canRoute = document.documentElement.dataset.amapRoutes==='on';

  async function request(path, {method='GET', body}={}){
    const headers = {Accept:'application/json'};
    if(body!==undefined) headers['Content-Type'] = 'application/json';
    if(method!=='GET'){
      if(!account.csrf_token) await refreshSession();
      headers['X-CSRFToken'] = account.csrf_token;
    }
    let response;
    try{
      response = await fetch(path, {
        method, headers, credentials:'same-origin', cache:'no-store',
        body:body===undefined ? undefined : JSON.stringify(body),
      });
    }catch{
      throw new Error('暂时无法连接后端，请稍后重试。');
    }
    const result = await response.json().catch(()=>null);
    if(!response.ok || !result){
      throw new Error(result?.error || '后端暂时无法处理这次请求。');
    }
    return result;
  }

  function setQuestionnaire(profile){
    Q = profile;
    const choices = {
      qGender:profile?.gender, qPet:profile?.pet,
      qRhythm:profile?.rhythm, qSmoke:profile?.smoke,
    };
    $$('#maskQ .seg button').forEach(button=>{
      const group = button.parentElement;
      const value = group.id ? choices[group.id] : profile?.mbti?.[Number(group.dataset.p)];
      const selected = value!==undefined && button.dataset.v===String(value);
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    $('#btnQ').textContent = profile ? '编辑室友偏好' : '设置室友偏好';
    $('#qState').textContent = profile ? '已从账号载入室友偏好。' : '';
    if(searchState) doSearch();
  }

  function setAccount(result){
    const previous = account.user;
    account = {...result, favorites:result.favorites || []};
    $('#btnAccount').textContent = result.user ? '我的账号' : '登录';
    $('#accountForm').hidden = Boolean(result.user);
    $('#accountMember').hidden = !result.user;
    $('#accountName').textContent = result.user ? `已登录 · ${result.user.username}` : '';
    if(result.user?.username!==previous?.username){
      if(result.preferences || previous) setQuestionnaire(result.preferences || null);
    }
    renderFavorites();
  }

  function refreshSession(){
    if(!sessionRequest){
      sessionRequest = request('/api/session').then(setAccount).finally(()=>{ sessionRequest = null; });
    }
    return sessionRequest;
  }

  function renderFavorites(){
    const list = $('#favoriteList');
    list.replaceChildren();
    $('#favoritesEmpty').hidden = account.favorites.length>0;
    account.favorites.forEach(id=>{
      const listing = LISTINGS.find(item=>item.key===id);
      const entry = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'text-btn';
      open.textContent = listing ? `${listing.area} · ${listing.roomType} · ¥${fmt(listing.rent)}/月` : id;
      open.onclick = async ()=>{
        try{
          const item = buildListing((await request(`/api/listings/${encodeURIComponent(id)}`)).listing);
          let index = LISTINGS.findIndex(listing=>listing.key===id);
          if(index===-1) index = LISTINGS.push(item)-1;
          else LISTINGS[index] = item;
          closeM('maskAccount');
          openDetail(index);
        }catch(error){
          $('#accountStatus').textContent = error.message;
        }
      };
      entry.append(open);
      list.append(entry);
    });
  }

  function showFavorite(listing){
    const button = $('#btnFavorite');
    const saved = account.favorites.includes(listing.key);
    $('#favoriteTools').hidden = false;
    $('#favoriteStatus').textContent = '';
    button.textContent = !account.user ? '登录后可收藏' : saved ? '取消收藏' : '收藏房源';
    button.setAttribute('aria-pressed', String(saved));
    button.onclick = async ()=>{
      if(!account.user){
        closeM('maskDetail');
        openAccount();
        return;
      }
      button.disabled = true;
      try{
        const response = await request(`/api/favorites/${encodeURIComponent(listing.key)}`, {
          method:saved ? 'DELETE' : 'PUT',
        });
        account.favorites = response.favorites;
        renderFavorites();
        if(curListing?.key===listing.key) showFavorite(listing);
      }catch(error){
        $('#favoriteStatus').textContent = error.message;
      }finally{
        button.disabled = false;
      }
    };
  }

  function openAccount(){
    $('#accountStatus').textContent = '';
    renderFavorites();
    openM('maskAccount');
    if(!account.user) $('#accountUsername').focus();
  }

  async function submitAccount(event){
    event.preventDefault();
    const action = event.submitter?.value==='register' ? 'register' : 'login';
    const form = event.currentTarget;
    const buttons = [...form.querySelectorAll('button')];
    const status = $('#accountStatus');
    buttons.forEach(button=>{ button.disabled = true; });
    status.textContent = '';
    try{
      setAccount(await request(`/api/auth/${action}`, {
        method:'POST',
        body:{username:$('#accountUsername').value, password:$('#accountPassword').value},
      }));
      form.reset();
      $('#btnLogout').focus();
    }catch(error){
      status.textContent = error.message;
    }finally{
      buttons.forEach(button=>{ button.disabled = false; });
    }
  }

  async function logout(){
    const button = $('#btnLogout');
    button.disabled = true;
    $('#accountStatus').textContent = '';
    try{
      setAccount(await request('/api/auth/logout',{method:'POST'}));
      $('#accountUsername').focus();
    }catch(error){
      $('#accountStatus').textContent = error.message;
    }finally{
      button.disabled = false;
    }
  }

  function renderRouteControl(){
    const state = searchState;
    const eligible = canRoute && state && !showingExcluded && state.buckets[curTab].length;
    $('#routeTools').hidden = !eligible;
    if(!eligible) return;
    const pending = Boolean(routeRequest);
    $('#btnRoute').disabled = Boolean(pending);
    $('#routeStatus').textContent = pending ? '正在查询路线。'
      : state.routeStatus?.[curTab] || '可查询当前方式的前 6 套房源。';
  }

  async function fetchRoutes(){
    const state = searchState;
    const mode = curTab;
    if(routeRequest || !canRoute || !state || showingExcluded) return;
    const top = state.buckets[mode].slice(0,6);
    if(!top.length) return;
    const attempt = {state, mode};
    routeRequest = attempt;
    state.routeStatus ??= {};
    renderRouteControl();
    try{
      const response = await request('/api/commutes', {
        method:'POST',
        body:{
          destination:{lng:state.poi.lng, lat:state.poi.lat}, mode,
          listing_ids:top.map(item=>item.l.key),
        },
      });
      if(!response.configured){
        canRoute = false;
        return;
      }
      let count = 0;
      top.forEach(item=>{
        const route = response.routes?.[item.l.key];
        if(route?.source==='amap' && Number.isFinite(route.min)){
          item.amapMinutes = route.min;
          count++;
        }
      });
      state.routeStatus[mode] = count
        ? `${count} 套已显示高德路线时间。筛选范围和通勤费用仍按距离估算。`
        : '暂未获取到高德路线，仍显示距离估算。';
    }catch(error){
      state.routeStatus[mode] = error.message;
    }finally{
      if(routeRequest===attempt) routeRequest = null;
      if(searchState===state && curTab===mode) render();
      else renderRouteControl();
    }
  }

  async function allListings(){
    return (await request('/api/listings')).listings;
  }

  window.housingBackend = {
    allListings, showFavorite, renderRouteControl,
    signedIn:()=>Boolean(account.user),
    search:filters=>request('/api/listings?'+new URLSearchParams(filters)),
    savePreferences:async profile=>{
      const response = await request('/api/preferences', {method:'PUT', body:profile});
      account.preferences = response.preferences;
    },
  };

  $('#btnAccount').hidden = false;
  $('#btnAccount').onclick = openAccount;
  $('#accountForm').onsubmit = submitAccount;
  $('#btnLogout').onclick = logout;
  $('#btnRoute').onclick = fetchRoutes;
  $('#keyState').textContent = canRoute ? '已配置后端路线规划' : '路线使用距离估算';

  refreshSession().catch(error=>{ $('#accountStatus').textContent = error.message; });
  allListings().then(rows=>{
    loadListingRows(rows, '共享房源数据库');
    $('#btnSearch').disabled = !rows.length;
    if(!rows.length) $('#list .empty p').textContent = '数据库暂无房源。运行导入命令后刷新页面。';
    renderFavorites();
  }).catch(error=>{
    $('#summary').textContent = error.message;
    $('#list .empty p').textContent = '暂时无法读取共享房源，请确认服务已启动并刷新页面。';
  });
})();
