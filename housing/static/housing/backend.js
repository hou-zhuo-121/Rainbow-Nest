(() => {
  let account = {user:null, preferences:null, csrf_token:''};
  let sessionRequest;
  let favoriteRequest;
  let authBusy = false;
  let refreshQueued = false;
  let routeRequest;
  let canRoute = document.documentElement.dataset.amapRoutes==='on';
  const importNotice = '之前的收藏还在等待同步，刷新页面可重试。';

  async function request(path, {method='GET', body, favoriteAccount}={}){
    const headers = {Accept:'application/json'};
    if(body!==undefined) headers['Content-Type'] = 'application/json';
    if(favoriteAccount) headers['X-Favorites-Account'] = encodeURIComponent(favoriteAccount);
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
      const error = new Error(result?.error || '后端暂时无法处理这次请求。');
      error.status = response.status;
      throw error;
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
    updateProfile();
    if(['habits','preferences'].includes(currentPage())) showPrefForm();
    if(searchState) doSearch();
  }

  function setAccount(result){
    const previous = account.user;
    const {user, preferences, csrf_token} = result;
    account = {user, preferences, csrf_token};
    $('#btnAccount').textContent = result.user ? '我的账号' : '登录';
    $('#accountForm').hidden = Boolean(result.user);
    $('#accountMember').hidden = !result.user;
    $('#accountName').textContent = result.user ? `已登录 · ${result.user.username}` : '';
    if(result.user?.username!==previous?.username){
      if(result.preferences || previous) setQuestionnaire(result.preferences || null);
    }
    setFavoriteIds(user ? result.favorites : guestFavorites);
  }

  function refreshSession(){
    if(!sessionRequest){
      sessionRequest = request('/api/session').then(applySession).finally(()=>{
        sessionRequest = null;
        finishFavoriteOperation();
      });
      syncHearts();
    }
    return sessionRequest;
  }

  function favoritesBusy(){
    return Boolean(sessionRequest || favoriteRequest || authBusy);
  }

  function refreshFavorites(){
    if(document.hidden) return;
    if(favoritesBusy()){
      refreshQueued = true;
      return;
    }
    refreshSession().catch(()=>{});
  }

  function finishFavoriteOperation(){
    syncHearts();
    if(refreshQueued && !favoritesBusy()){
      refreshQueued = false;
      refreshFavorites();
    }
  }

  function notifyFavoriteChange(){
    remember('favorite-sync', Date.now());
  }

  function removeGuestFavorites(ids){
    const remaining = new Set(guestFavorites);
    ids.forEach(id=>remaining.delete(id));
    storeGuestFavorites(remaining);
  }

  function removePendingFavorites(key, ids){
    const pending = favoriteIds(recall(key, []));
    const size = pending.size;
    ids.forEach(id=>pending.delete(id));
    if(pending.size!==size) remember(key, [...pending]);
  }

  async function mergeGuestFavorites(username){
    const key = 'favorite-import.' + username;
    const ids = [...new Set([...favoriteIds(recall(key, [])), ...guestFavorites])];
    if(!ids.length) return;

    // Keep a failed import with the account it was intended for.
    const queued = remember(key, ids);
    if(queued) removeGuestFavorites(ids);
    for(let offset=0; offset<ids.length; offset+=200){
      const batch = ids.slice(offset, offset+200);
      const result = await request('/api/favorites', {
        method:'POST', body:{listing_ids:batch}, favoriteAccount:username,
      });
      if(queued) removePendingFavorites(key, batch);
      else removeGuestFavorites(batch);
      setFavoriteIds(result.favorites);
      notifyFavoriteChange();
    }
  }

  async function applySession(result){
    setAccount(result);
    if(!result.user) return;
    try{
      await mergeGuestFavorites(result.user.username);
      for(const selector of ['#favoriteNotice','#accountStatus']){
        const notice = $(selector);
        if(notice.textContent===importNotice) notice.textContent = '';
      }
    }catch{
      $('#favoriteNotice').textContent = importNotice;
      if($('#maskAccount').classList.contains('show')) $('#accountStatus').textContent = importNotice;
    }
  }

  function toggleFavorite(id){
    if(favoritesBusy()) return;
    const notice = $('#favoriteNotice');
    notice.textContent = '';
    favoriteRequest = (async ()=>{
      if(!account.csrf_token) await refreshSession();
      if(!account.user){
        toggleGuestFavorite(id);
        return;
      }
      const username = account.user.username;
      const result = await request(`/api/favorites/${encodeURIComponent(id)}`, {
        method:favorites.has(id) ? 'DELETE' : 'PUT',
        favoriteAccount:username,
      });
      removePendingFavorites('favorite-import.' + username, [id]);
      setFavoriteIds(result.favorites);
      notifyFavoriteChange();
    })().catch(error=>{
      notice.textContent = error.message;
      if([401,403,409].includes(error.status)) refreshQueued = true;
    }).finally(()=>{
      favoriteRequest = null;
      finishFavoriteOperation();
    });
    syncHearts();
  }

  function openAccount(){
    $('#accountStatus').textContent = '';
    openM('maskAccount');
    if(!account.user) $('#accountUsername').focus();
  }

  async function submitAccount(event){
    event.preventDefault();
    if(authBusy) return;
    const action = event.submitter?.value==='register' ? 'register' : 'login';
    const form = event.currentTarget;
    const buttons = [...form.querySelectorAll('button')];
    const status = $('#accountStatus');
    authBusy = true;
    syncHearts();
    buttons.forEach(button=>{ button.disabled = true; });
    status.textContent = '';
    try{
      await Promise.allSettled([sessionRequest, favoriteRequest]);
      await applySession(await request(`/api/auth/${action}`, {
        method:'POST',
        body:{username:$('#accountUsername').value, password:$('#accountPassword').value},
      }));
      notifyFavoriteChange();
      form.reset();
      if($('#maskAccount').classList.contains('show')) $('#btnLogout').focus();
    }catch(error){
      status.textContent = error.message;
    }finally{
      buttons.forEach(button=>{ button.disabled = false; });
      authBusy = false;
      finishFavoriteOperation();
    }
  }

  async function logout(){
    if(authBusy) return;
    const button = $('#btnLogout');
    authBusy = true;
    syncHearts();
    button.disabled = true;
    $('#accountStatus').textContent = '';
    try{
      await Promise.allSettled([sessionRequest, favoriteRequest]);
      setAccount(await request('/api/auth/logout',{method:'POST'}));
      $('#favoriteNotice').textContent = '';
      notifyFavoriteChange();
      if($('#maskAccount').classList.contains('show')) $('#accountUsername').focus();
    }catch(error){
      $('#accountStatus').textContent = error.message;
    }finally{
      button.disabled = false;
      authBusy = false;
      finishFavoriteOperation();
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
    allListings, renderRouteControl, favoritesBusy, toggleFavorite,
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
  $('#accountFavorites').onclick = ()=>closeM('maskAccount');
  $('#btnLogout').onclick = logout;
  $('#btnRoute').onclick = fetchRoutes;
  $('#keyState').textContent = canRoute ? '已配置后端路线规划' : '路线使用距离估算';

  window.addEventListener('storage', event=>{
    if(event.key===storagePrefix+'favorite-sync') refreshFavorites();
  });
  window.addEventListener('hashchange', ()=>{
    if(currentPage()==='saved') refreshFavorites();
  });
  document.addEventListener('visibilitychange', refreshFavorites);
  window.addEventListener('pageshow', event=>{ if(event.persisted) refreshFavorites(); });

  refreshSession().catch(error=>{ $('#accountStatus').textContent = error.message; });
  allListings().then(rows=>{
    loadListingRows(rows, '共享房源数据库');
    $('#btnSearch').disabled = !rows.length;
    if(!rows.length) $('#summary').textContent = '暂时没有可查询的房源。';
    window.dispatchEvent(new CustomEvent('housing:listings-ready', {detail:{count:rows.length}}));
  }).catch(error=>{
    $('#summary').textContent = error.message;
    window.dispatchEvent(new CustomEvent('housing:listings-error', {detail:{message:error.message}}));
  });
})();
