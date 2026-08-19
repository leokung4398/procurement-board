import re

with open('c:/新增資料夾/佈告欄/admin.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add Sidebar button
sidebar_btn = '''      <button onclick="showAchievements()" class="btn-s w-full justify-center text-sm text-amber-600 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 hover:from-amber-100 hover:to-orange-100 shadow-sm relative overflow-hidden group">
        <div class="absolute inset-0 bg-white/40 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-500 skew-x-12"></div>
        <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
        <span class="font-bold tracking-wide">專案開發成果</span>
      </button>
      <button onclick="showKM()" class="btn-s w-full justify-center text-sm text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 mt-2">
        <span class="font-bold tracking-wide">📚 關鍵字資料庫維護</span>
      </button>'''

content = re.sub(r'      <button onclick="showAchievements\(\)".*?</button>', sidebar_btn, content, flags=re.DOTALL)

# 2. Add getKeywords & saveKeywords to DS
ds_methods = '''  async getKeywords() {
    if (!this.isConfigured()) return [];
    try {
      const snap = await db.collection('dictionary').doc('keywords').get();
      if (snap.exists) { return snap.data().categories || []; }
      return [];
    } catch(e) { console.error(e); return []; }
  },
  async saveKeywords(categories) {
    if (!this.isConfigured()) return;
    try { await db.collection('dictionary').doc('keywords').set({ categories: categories }); } catch(e) { console.error(e); }
  },
  async getTpls() {'''
content = content.replace('  async getTpls() {', ds_methods)

# 3. Add keywords to S and init()
content = content.replace('const S={cur:null,dirty:false,fbs:[],tpls:[],mmap:{},amon:null,users:[]};', 'const S={cur:null,dirty:false,fbs:[],tpls:[],keywords:[],mmap:{},amon:null,users:[]};')
content = content.replace('S.tpls=await DS.getTpls();', 'S.tpls=await DS.getTpls();\n  S.keywords=await DS.getKeywords();')

# 4. Modify bldSec to use dependent dropdowns
bldSec_old = '''const isCust=!S.tpls.find(t=>t.t===sec.title);return`<div class="p-5 hover:bg-slate-50/40 transition-colors border-t border-slate-100 first:border-0">
<div class="flex items-center gap-2 mb-3">
<select class="form-input csel w-16 text-center text-lg py-1" onchange="uSec(${si},'icon',this.value)">${ICONS.map(ic=>`<option ${sec.icon===ic?'selected':''} value="${ic}">${ic}</option>`).join('')}</select>
<select class="form-input csel flex-1 font-semibold py-1" onchange="sTitleSel(${si},this.value)">${S.tpls.map(t=>`<option value="${t.t}" ${sec.title===t.t?'selected':''}>${t.t}</option>`).join('')}<option value="__c__" ${isCust?'selected':''}>自訂...</option></select>
<span class="text-xs text-slate-400 font-medium">${NUMS[si]||si+1}、</span>'''

bldSec_new = '''const isCust=!S.keywords.find(c=>c.name===sec.title);
const curCat = S.keywords.find(c=>c.name===sec.title) || (S.keywords.length ? S.keywords[0] : null);
const dlHTML = curCat ? `<datalist id="dl-${si}">${(curCat.keywords||[]).filter(k=>k.isActive!==false).sort((a,b)=>a.order-b.order).map(k=>`<option value="${k.text}">`).join('')}</datalist>` : '';
return`<div class="p-5 hover:bg-slate-50/40 transition-colors border-t border-slate-100 first:border-0">
<div class="flex items-center gap-2 mb-3">
<select class="form-input csel w-16 text-center text-lg py-1" onchange="uSec(${si},'icon',this.value)">${ICONS.map(ic=>`<option ${sec.icon===ic?'selected':''} value="${ic}">${ic}</option>`).join('')}</select>
<select class="form-input csel flex-1 font-semibold py-1 max-w-[200px]" onchange="sTitleSel(${si},this.value)">${S.keywords.map(c=>`<option value="${c.name}" ${sec.title===c.name?'selected':''}>${c.name}</option>`).join('')}<option value="__c__" ${isCust?'selected':''}>自訂...</option></select>
<div class="flex-1 relative ml-1">
  ${dlHTML}
  <input list="dl-${si}" class="form-input text-sm py-1 font-medium text-slate-700 w-full" value="${xe(sec.subtitle||'')}" placeholder="請選擇或輸入子標題關鍵字..." onchange="uSec(${si},'subtitle',this.value)" ${isCust ? 'disabled' : ''}>
</div>
<span class="text-xs text-slate-400 font-medium ml-2">${NUMS[si]||si+1}、</span>'''

content = content.replace(bldSec_old, bldSec_new)

# 5. Modify sTitleSel
sTitleSel_old = '''function sTitleSel(si,v){const ci=document.getElementById(`cti-${si}`);if(v==='__c__'){ci&&ci.classList.remove('hidden');}else{ci&&ci.classList.add('hidden');S.cur.sections[si].title=v;const t=S.tpls.find(tp=>tp.t===v);if(t)S.cur.sections[si].icon=t.i;S.dirty=true;}}'''
sTitleSel_new = '''function sTitleSel(si,v){const ci=document.getElementById(`cti-${si}`);if(v==='__c__'){ci&&ci.classList.remove('hidden');}else{ci&&ci.classList.add('hidden');S.cur.sections[si].title=v;S.cur.sections[si].subtitle='';const c=S.keywords.find(tp=>tp.name===v);if(c)S.cur.sections[si].icon='📋';S.dirty=true;}renderSecs();}'''
content = content.replace(sTitleSel_old, sTitleSel_new)


# 6. Add the KM Modal HTML and JS at the end
km_modal = '''
  <!-- Keyword Maintenance Modal -->
  <div id="km" class="hidden fixed inset-0 z-[110] flex justify-center items-center bg-slate-900/60 backdrop-blur-sm transition-all duration-300">
    <div class="w-full max-w-5xl h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden m-4">
      <div class="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">📚 關鍵字資料庫維護</h3>
        <button onclick="hideKM()" class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>
      <div class="flex-1 flex overflow-hidden">
        <!-- Left: Categories -->
        <div class="w-1/3 border-r border-slate-200 bg-slate-50/50 flex flex-col">
          <div class="p-3 border-b border-slate-200 font-semibold text-sm text-slate-600 bg-white shadow-sm z-10">母標題 (類別)</div>
          <div class="flex-1 overflow-y-auto p-2" id="km-cat-list"></div>
        </div>
        <!-- Right: Keywords -->
        <div class="flex-1 flex flex-col bg-white relative">
          <div class="p-3 border-b border-slate-200 flex items-center justify-between shadow-sm z-10">
            <span class="font-semibold text-sm text-slate-600" id="km-kw-title">請選擇左側母標題</span>
            <button onclick="addKW()" class="text-xs bg-blue-50 text-blue-600 font-semibold px-3 py-1.5 rounded hover:bg-blue-100 transition-colors">＋ 新增關鍵字</button>
          </div>
          <div class="flex-1 overflow-y-auto p-4 bg-slate-50/30" id="km-kw-list">
            <div class="text-center text-slate-400 mt-10 text-sm">請從左側選擇一個母標題來編輯對應的子標題</div>
          </div>
        </div>
      </div>
      <div class="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
        <button onclick="hideKM()" class="btn-s">取消</button>
        <button onclick="saveKMDb()" class="btn-p">💾 儲存並發布生效</button>
      </div>
    </div>
  </div>
  <script>
    let tempKw = [];
    let curKwId = null;
    function showKM() {
      tempKw = JSON.parse(JSON.stringify(S.keywords));
      document.getElementById('km').classList.remove('hidden');
      if (tempKw.length > 0) selKMCat(tempKw[0].id);
      renderKMCats();
    }
    function hideKM() { document.getElementById('km').classList.add('hidden'); }
    function renderKMCats() {
      const c = document.getElementById('km-cat-list');
      c.innerHTML = tempKw.map(cat => `<div onclick="selKMCat('${cat.id}')" class="p-3 mb-1.5 rounded-lg cursor-pointer transition-colors border ${cat.id===curKwId ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm font-semibold' : 'bg-white border-transparent text-slate-600 hover:bg-slate-100 hover:border-slate-200'} flex items-center justify-between text-sm"><span class="truncate">${cat.name}</span><span class="text-xs bg-white px-2 py-0.5 rounded-full shadow-sm text-slate-500">${(cat.keywords||[]).length}</span></div>`).join('');
    }
    function selKMCat(id) {
      curKwId = id;
      renderKMCats();
      const cat = tempKw.find(c => c.id === id);
      document.getElementById('km-kw-title').textContent = cat ? cat.name + ' - 子標題管理' : '';
      renderKWs();
    }
    function renderKWs() {
      const c = document.getElementById('km-kw-list');
      const cat = tempKw.find(cat => cat.id === curKwId);
      if (!cat) return;
      if (!cat.keywords || cat.keywords.length === 0) {
        c.innerHTML = '<div class="text-center text-slate-400 mt-10 text-sm">尚無任何關鍵字子標題</div>';
        return;
      }
      cat.keywords.sort((a,b)=>a.order-b.order);
      c.innerHTML = cat.keywords.map((k, i) => `
        <div class="flex items-center gap-3 bg-white p-3 mb-2 rounded-lg border border-slate-200 shadow-sm hover:border-blue-300 transition-colors group">
          <div class="cursor-move text-slate-300 hover:text-slate-500">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </div>
          <input type="text" class="form-input flex-1 font-medium text-sm border-transparent hover:border-slate-200 focus:border-blue-400 bg-transparent focus:bg-white" value="${k.text}" onchange="uKWText('${k.id}', this.value)">
          <div class="flex items-center gap-2 border-l border-slate-100 pl-3">
            <button onclick="tgKWActive('${k.id}')" class="px-3 py-1 rounded text-xs font-semibold ${k.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}">${k.isActive !== false ? '啟用中' : '已停用'}</button>
            <button onclick="mvKWUp('${k.id}')" class="p-1 rounded hover:bg-slate-100 text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg></button>
            <button onclick="mvKWDn('${k.id}')" class="p-1 rounded hover:bg-slate-100 text-slate-400"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg></button>
          </div>
        </div>
      `).join('');
    }
    function getCurCat() { return tempKw.find(cat => cat.id === curKwId); }
    function uKWText(kwId, val) { const c = getCurCat(); const k = c.keywords.find(x => x.id === kwId); if(k) k.text = val; }
    function tgKWActive(kwId) { const c = getCurCat(); const k = c.keywords.find(x => x.id === kwId); if(k) k.isActive = (k.isActive === false ? true : false); renderKWs(); }
    function addKW() { const c = getCurCat(); if(!c)return; if(!c.keywords) c.keywords=[]; c.keywords.push({id: 'kw_'+Date.now(), text: '新關鍵字', isActive: true, order: c.keywords.length+1}); renderKWs(); renderKMCats(); }
    function mvKWUp(kwId) { const c = getCurCat(); const idx = c.keywords.findIndex(x => x.id === kwId); if(idx>0){ [c.keywords[idx-1], c.keywords[idx]] = [c.keywords[idx], c.keywords[idx-1]]; c.keywords.forEach((x,i)=>x.order=i+1); renderKWs(); } }
    function mvKWDn(kwId) { const c = getCurCat(); const idx = c.keywords.findIndex(x => x.id === kwId); if(idx<c.keywords.length-1){ [c.keywords[idx], c.keywords[idx+1]] = [c.keywords[idx+1], c.keywords[idx]]; c.keywords.forEach((x,i)=>x.order=i+1); renderKWs(); } }
    async function saveKMDb() {
      try {
        await DS.saveKeywords(tempKw);
        S.keywords = tempKw;
        toast('關鍵字資料庫已更新並生效！', 'ok');
        hideKM();
        if(S.cur) renderSecs();
      } catch(e) { toast('儲存失敗', 'er'); }
    }
  </script>
</body>
'''
content = content.replace('</body>', km_modal)

with open('c:/新增資料夾/佈告欄/admin.html', 'w', encoding='utf-8') as f:
    f.write(content)
