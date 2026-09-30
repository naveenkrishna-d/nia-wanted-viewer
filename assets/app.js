'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = (value = '') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const safeURL = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
  const link = (url, title, cls = '') => { const safe = safeURL(url); return safe ? `<a class="${cls}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : ''; };
  const initials = name => name.replace(/\([^)]*\)/g, '').trim().split(/\s+/).slice(0, 2).map(v => v[0] || '').join('').toUpperCase();
  const date = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}) : 'Not available'; };
  const bookmark = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M5 3h10v14l-5-3-5 3Z"/></svg>';
  const params = new URLSearchParams(location.search);
  let records = [], matches = [], dataset = {}, page = 1, view = 'cards', current = null, busy = false, reportPromise = null, reports = null, searchTimer, initialized = false;
  const compact = matchMedia('(max-width: 480px)');
  let pageSize = compact.matches ? 12 : 24;
  compact.addEventListener('change', event => {pageSize=event.matches ? 12:24;page=1;render();});
  let saved = new Set();
  try { saved = new Set(JSON.parse(localStorage.getItem('nia-explorer-saved') || '[]')); } catch {}
  function persistSaved() { try { localStorage.setItem('nia-explorer-saved', JSON.stringify([...saved])); return true; } catch { return false; } }
  function avatar(record, eager = false) {
    const url = safeURL(record.image_url);
    return `<div class="avatar">${url ? `<img src="${esc(url)}" alt="${esc(record.name)}" width="85" height="104" loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" data-fallback="${esc(initials(record.name))}">` : esc(initials(record.name))}</div>`;
  }
  document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement && event.target.dataset.fallback) event.target.parentElement.textContent = event.target.dataset.fallback; }, true);
  function enrich(rows) {
    const seen = new Set();
    return rows.filter(r => r && typeof r.name === 'string' && r.name.trim()).map((r, i) => {
      const id = String(r.id || `legacy-${i}`);
      if (seen.has(id)) throw new Error('Duplicate record identifiers');
      seen.add(id);
      const cases = Array.isArray(r.cases) ? r.cases.filter(c => typeof c === 'string') : [];
      const branches = [...new Set(cases.map(c => c.split('/').pop()).filter(Boolean))];
      return {...r, id, cases, branches, source_pages:Array.isArray(r.source_pages) ? r.source_pages : [], year:Math.max(0, ...cases.map(c => +(c.match(/\/(\d{4})\//)?.[1] || 0))), search:[r.name,r.aliases,r.parentage,r.address,r.wanted_in_raw,r.status,r.age,r.organization,r.reward,...cases].join(' ').normalize('NFKD').toLowerCase()};
    });
  }
  function updateURL() {
    const q = new URLSearchParams();
    for (const [key, id] of [['q','query'],['branch','branch'],['source','source'],['sort','sort']]) if ($(id).value && !(key === 'sort' && $(id).value === 'name')) q.set(key, $(id).value);
    if ($('photos').checked) q.set('photos','1');
    if ($('saved').checked) q.set('saved','1');
    if (current) q.set('profile',current.id);
    history.replaceState(null, '', location.pathname + (q.size ? '?' + q.toString() : '') + location.hash);
  }
  function filter(resetPage = true) {
    if (resetPage) page = 1;
    const terms = $('query').value.trim().normalize('NFKD').toLowerCase().split(/\s+/).filter(Boolean);
    matches = records.filter(r => terms.every(t => r.search.includes(t)) && (!$('branch').value || r.branches.includes($('branch').value)) && (!$('source').value || r.source_pages.includes($('source').value)) && (!$('photos').checked || safeURL(r.image_url)) && (!$('saved').checked || saved.has(r.id)));
    const order = $('sort').value;
    matches.sort((a,b) => (order === 'cases' ? b.cases.length - a.cases.length : order === 'recent' ? b.year - a.year : 0) || a.name.localeCompare(b.name));
    updateURL(); render();
  }
  function card(r) {
    return `<article class="record-card"><div class="card-top">${avatar(r)}<button class="save" data-save="${esc(r.id)}" aria-label="Save ${esc(r.name)} on this device" aria-pressed="${saved.has(r.id)}">${bookmark}</button></div><div class="card-body"><h3 class="record-name"><button data-open="${esc(r.id)}">${esc(r.name)}</button></h3><p class="aliases" title="${esc(r.aliases || '')}">${r.aliases ? 'Alias · '+esc(r.aliases) : 'No alias listed'}</p><div class="tags">${r.source_pages.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div><div class="case-line">${esc(r.cases[0] || 'No case reference listed')}${r.cases.length > 1 ? `<span class="extra">+${r.cases.length-1} more</span>` : ''}</div><div class="card-meta"><span>Branch <b>${esc(r.branches.join(', ') || '—')}</b></span><span>${r.year ? `Case year <b>${r.year}</b>` : 'Year not listed'}</span></div></div><div class="card-foot"><button class="open-record" data-open="${esc(r.id)}">View record <span>↗</span></button>${link(r.source_url || dataset.source,'NIA source ↗')}</div></article>`;
  }
  function render() {
    const pages = Math.max(1, Math.ceil(matches.length/pageSize));
    page = Math.max(1,Math.min(page,pages));
    const start = (page-1)*pageSize;
    $('records').className = 'cards' + (view === 'list' ? ' list' : '');
    $('records').innerHTML = matches.slice(start,start+pageSize).map(card).join('');
    $('resultCount').innerHTML = `<strong>${matches.length.toLocaleString()}</strong> ${matches.length === 1 ? 'record' : 'records'}${matches.length !== records.length ? ` of ${records.length.toLocaleString()}` : ' in the directory'}`;
    $('empty').hidden = matches.length > 0 || busy;
    $('pagination').hidden = matches.length === 0;
    $('range').textContent = `${start+1}–${Math.min(start+pageSize,matches.length)} of ${matches.length}`;
    $('pageInfo').textContent = `${page} / ${pages}`;
    $('prev').disabled = page === 1; $('next').disabled = page === pages;
    $('export').disabled = !matches.length;
  }
  function reset() { $('query').value=''; $('branch').value=''; $('source').value=''; $('sort').value='name'; $('photos').checked=false; $('saved').checked=false; filter(); }
  function options(id, values, first) { const value = initialized ? $(id).value : (params.get(id) || ''); $(id).innerHTML = `<option value="">${first}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); $(id).value = values.includes(value) ? value : ''; }
  async function load() {
    if (busy) return;
    busy=true; $('refresh').disabled=true; $('loading').hidden=false; $('error').hidden=true;
    try {
      const [response, statusResult] = await Promise.all([fetch('data/records.json', {cache:'no-cache'}), fetch('data/status.json',{cache:'no-cache'}).then(async r => r.ok ? r.json() : null).catch(() => null)]);
      if (!response.ok) throw new Error(`Dataset request failed (${response.status})`);
      const nextData = await response.json(); const nextRecords = enrich(nextData.records || []);
      if (!nextRecords.length) throw new Error('Dataset has no valid records');
      dataset=nextData; records=nextRecords;
      options('branch',[...new Set(records.flatMap(r => r.branches))].sort(),'All branches');
      options('source',[...new Set(records.flatMap(r => r.source_pages))].sort(),'Both lists');
      for (const [id, number] of [['total', records.length], ['caseCount', new Set(records.flatMap(r => r.cases)).size], ['branchCount',new Set(records.flatMap(r => r.branches)).size], ['imageCount',records.filter(r => safeURL(r.image_url)).length]]) $(id).textContent=number.toLocaleString();
      const stale = !Number.isFinite(Date.parse(dataset.generated_at)) || Date.now()-Date.parse(dataset.generated_at) > 12*3600000;
      const failure = statusResult?.ok === false;
      $('syncDot').className = failure || stale || !statusResult ? 'bad' : 'ok';
      $('syncText').textContent = failure ? 'Latest check failed · previous dataset retained' : stale ? 'Dataset may be out of date' : !statusResult ? 'Refresh status unavailable' : 'Official-source check completed';
      $('syncMeta').textContent = `Dataset updated ${date(dataset.generated_at)}${dataset.generated_at ? ' · '+new Date(dataset.generated_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}`;
      if (failure) { $('error').textContent='The latest official-source refresh failed. Showing the previous validated dataset; verify current details on NIA.'; $('error').hidden=false; }
      busy=false; filter();
      const requested = !initialized && params.get('profile'); initialized=true; if (requested && !current) openProfile(requested);
      reports=null; reportPromise=null;
    } catch (error) {
      $('error').textContent = records.length ? `Refresh unavailable. Keeping displayed records. ${error.message}` : `Unable to load records. ${error.message}. Use Refresh to retry.`;
      $('error').hidden=false; $('syncDot').className='bad'; $('syncText').textContent='Dataset refresh unavailable';
    } finally { busy=false; $('loading').hidden=true; $('refresh').disabled=false; }
  }
  function row(label,value) { return `<div class="data-row"><dt>${esc(label)}</dt><dd>${value || 'Not listed'}</dd></div>`; }
  function official(r) {
    const urls = [...new Set(r.source_urls || [r.source_url || dataset.source])];
    return `<dl>${[['Name',r.name],['Aliases',r.aliases],['Parentage',r.parentage],['Address',r.address],['Age / DOB',r.age],['Accused status',r.status],['Organization',r.organization],['Reward',r.reward]].map(([k,v]) => row(k,esc(v || ''))).join('')}${row('Case references',r.cases.length ? r.cases.map(esc).join('<br>') : esc(r.wanted_in_raw || ''))}${row('Official lists',esc(r.source_pages.join(', ')))}${row('Source pages', urls.map((u,i) => link(u,`Verify on NIA · source ${i+1} ↗`)).join(''))}${row('Dataset checked',esc(date(dataset.generated_at)))}</dl><div class="notice">NIA listings are authoritative for the official fields above. Listings may be historical; presence here is not proof of guilt or independent confirmation of current status.</div>`;
  }
  function openProfile(id) {
    const r=records.find(r => r.id===id); if (!r) return;
    current=r; updateURL();
    $('profileBody').innerHTML=`<div class="profile-heading">${avatar(r,true)}<div><h2 id="profileTitle">${esc(r.name)}</h2><p>${esc(r.aliases || 'No alias listed')}</p></div></div><div class="profile-tabs" role="tablist" aria-label="Profile information"><button id="officialTab" role="tab" aria-selected="true" aria-controls="officialPanel">Official record</button><button id="reportTab" role="tab" tabindex="-1" aria-selected="false" aria-controls="reportPanel">News & public reporting</button></div><section id="officialPanel" role="tabpanel" aria-labelledby="officialTab">${official(r)}</section><section id="reportPanel" role="tabpanel" aria-labelledby="reportTab" hidden></section><div class="profile-actions"><button data-save="${esc(r.id)}" aria-pressed="${saved.has(r.id)}">${saved.has(r.id) ? 'Saved on this device' : 'Save on this device'}</button><button id="share">Copy profile link ↗</button></div><p id="copyStatus" class="copy-status" role="status"></p>`;
    if (!$('profile').open) { $('profile').showModal(); document.body.style.overflow='hidden'; }
    $('profile').scrollTop=0;
    $('officialTab').onclick=() => tab(false);
    $('reportTab').onclick=() => tab(true);
    $('profileBody').querySelector('.profile-tabs').onkeydown = event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {event.preventDefault(); const show = event.key==='End' || (event.key!=='Home' && $('officialTab').getAttribute('aria-selected')==='true'); tab(show); $(show ? 'reportTab':'officialTab').focus();} };
    $('share').onclick=async () => { try { await navigator.clipboard.writeText(location.href.split('#')[0]); $('copyStatus').textContent='Profile link copied.'; } catch { $('copyStatus').textContent='Copy the profile URL from your address bar.'; } };
  }
  async function tab(report) {
    $('officialTab').setAttribute('aria-selected',String(!report)); $('reportTab').setAttribute('aria-selected',String(report));
    $('officialTab').tabIndex=report ? -1:0; $('reportTab').tabIndex=report ? 0:-1;
    $('officialPanel').hidden=report; $('reportPanel').hidden=!report;
    if (!report) return;
    const id=current.id;
    $('reportPanel').innerHTML='<p class="report-intro">Loading source-linked reporting…</p>';
    try {
      if (!reportPromise) reportPromise=fetch('data/intelligence.json',{cache:'no-cache'}).then(r => {if(!r.ok) throw new Error('Reporting data unavailable');return r.json();}).then(data => reports=data).catch(error => { reportPromise=null;throw error; });
      await reportPromise;
      if (current?.id!==id || !$('profile').open) return;
      $('reportPanel').innerHTML=reporting(current);
    } catch { if(current?.id===id) $('reportPanel').innerHTML=reporting(current,true); }
  }
  function reporting(r, unavailable=false) {
    const query=encodeURIComponent(`"${r.name}" NIA`);
    const sources=reports?.profiles?.[r.id]?.sources || reports?.profiles?.[r.name]?.sources;
    let html=`<p class="report-intro">These are unverified search matches, not identity or status confirmations. Check the original publisher, date and case context.</p><div class="source-actions">${link('https://news.google.com/search?q='+query,'Search news ↗')}${link('https://x.com/search?q='+query+'&f=live','Search X ↗')}</div>`;
    if(!sources) return html+`<p class="report-intro">${unavailable?'Reporting data is unavailable. You can use the source searches above.':'This profile is awaiting its scheduled reporting check. No reporting has been verified here.'}</p>`;
    for (const [provider, source] of Object.entries(sources)) {
      const titles={news:'News discovery',gdelt:'GDELT · public news index',x:'Public X posts'};
      const state=source.state==='ok' ? 'Search completed' : source.state==='failed' ? 'Latest search failed · previous links retained' : source.state==='not_configured' ? 'Automatic search not enabled' : 'Check pending';
      const items=(source.items || []).filter(item => safeURL(item.url));
      html+=`<article class="provider"><h3>${esc(titles[provider] || provider)}</h3><p class="provider-state">${esc(state)}${source.checked_at ? ' · Last success '+esc(date(source.checked_at)) : ''}</p>${items.length ? items.map(item => `<div class="report-item">${link(item.url,item.title || 'Open source ↗')}<small>${esc(item.publisher || 'Public source')} · ${esc(item.published_at || 'Publication date not supplied')} · Unverified match</small></div>`).join('') : `<p>${source.state==='ok'?'No matches returned for this query.':'No source links available yet.'}</p>`}</article>`;
    }
    return html;
  }
  $('records').onclick=event => handleAction(event);
  $('profileBody').onclick=event => handleAction(event);
  function handleAction(event) {
    const open=event.target.closest('[data-open]'); if(open) openProfile(open.dataset.open);
    const button=event.target.closest('[data-save]'); if(!button) return;
    const id=button.dataset.save; saved.has(id)?saved.delete(id):saved.add(id);
    const stored=persistSaved();
    document.querySelectorAll('[data-save]').forEach(el => { if(el.dataset.save===id) {el.setAttribute('aria-pressed',String(saved.has(id)));if(!el.classList.contains('save'))el.textContent=saved.has(id)?'Saved on this device':'Save on this device';} });
    if(!stored && $('copyStatus')) $('copyStatus').textContent='Browser storage is unavailable. Saved for this session only.';
    if($('saved').checked) filter(false);
  }
  $('profile').addEventListener('close',() => {current=null;document.body.style.overflow='';updateURL();});
  $('profile').addEventListener('click',event => {if(event.target===$('profile')) {const box=$('profile').getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)$('profile').close();}});
  $('closeProfile').onclick=() => $('profile').close();
  $('query').value=params.get('q') || ''; if (['cases','recent'].includes(params.get('sort'))) $('sort').value=params.get('sort');
  $('photos').checked=params.get('photos')==='1';$('saved').checked=params.get('saved')==='1';
  $('query').addEventListener('input',() => {clearTimeout(searchTimer);searchTimer=setTimeout(filter,100);});
  for(const id of ['branch','source','sort','photos','saved']) $(id).addEventListener('change',() => filter());
  $('reset').onclick=reset; $('emptyReset').onclick=reset; $('clearSearch').onclick=() => {$('query').value='';filter();$('query').focus();};
  for(const [id, layout] of [['gridBtn','cards'],['listBtn','list']]) $(id).onclick=() => {view=layout;$('gridBtn').setAttribute('aria-pressed',String(view==='cards'));$('listBtn').setAttribute('aria-pressed',String(view==='list'));render();};
  for(const [id, step] of [['prev',-1],['next',1]]) $(id).onclick=() => {page+=step;render();$('resultCount').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
  $('refresh').onclick=load;
  $('export').onclick=() => {
    const csvCell=value => '"'+String(value || '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g,'""')+'"';
    const rows=[['Name','Aliases','Cases','NIA branches','Official lists','NIA status','Source URL'],...matches.map(r => [r.name,r.aliases,r.cases.join('; '),r.branches.join('; '),r.source_pages.join('; '),r.status,r.source_url])];
    const blob=new Blob(['\uFEFF'+rows.map(row => row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='nia-public-records.csv';a.click();setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  document.addEventListener('keydown',event => { const tag=document.activeElement?.tagName; if(event.key==='/' && !['INPUT','TEXTAREA','SELECT'].includes(tag) && !$('profile').open && !event.ctrlKey && !event.metaKey && !event.altKey) {event.preventDefault();$('query').focus();} });
  document.addEventListener('visibilitychange',() => {const active=!document.hidden; document.querySelectorAll('.radar-sweep,.beacon').forEach(el=>el.style.animationPlayState=active?'running':'paused');});
  load();
})();
