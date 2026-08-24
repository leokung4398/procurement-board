// Quill Customizations
if (typeof Quill !== 'undefined') {
  const SizeStyle = Quill.import('attributors/style/size');
  SizeStyle.whitelist = ['8pt', '10pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '32pt'];
  Quill.register(SizeStyle, true);

  // Get StyleAttributor safely from SizeStyle's constructor
  const StyleAttributor = SizeStyle.constructor;
  const Parchment = Quill.import('parchment');
  
  const LineHeightStyle = new StyleAttributor('lineHeight', 'line-height', {
    scope: Parchment.Scope ? Parchment.Scope.BLOCK : 2,
    whitelist: ['1', '1.5', '2', '2.5', '3']
  });
  Quill.register(LineHeightStyle, true);

  const FontStyle = new StyleAttributor('font', 'font-family', {
    scope: Parchment.Scope ? Parchment.Scope.INLINE : 1,
    whitelist: ['"Inter", sans-serif', '"MingLiU", PMingLiU, serif', '"Microsoft JhengHei", sans-serif', 'monospace']
  });
  Quill.register(FontStyle, true);

  const Inline = Quill.import('blots/inline');
  class BoxBlot extends Inline {
    static create() {
      let node = super.create();
      node.style.border = '1px solid currentColor';
      node.style.padding = '0 4px';
      node.style.borderRadius = '4px';
      return node;
    }
    static formats(node) { return true; }
  }
  BoxBlot.blotName = 'boxed';
  BoxBlot.tagName = 'span';
  BoxBlot.className = 'ql-boxed';
  Quill.register(BoxBlot);

  class CircleBlot extends Inline {
    static create() {
      let node = super.create();
      node.style.border = '1px solid currentColor';
      node.style.padding = '1px 5px';
      node.style.borderRadius = '50%';
      return node;
    }
    static formats(node) { return true; }
  }
  CircleBlot.blotName = 'circled';
  CircleBlot.tagName = 'span';
  CircleBlot.className = 'ql-circled';
  Quill.register(CircleBlot);
}

const DS = {
  isConfigured() {
    return typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined' && firebaseConfig.projectId && firebaseConfig.projectId !== "YOUR_PROJECT_ID";
  },
  async getAllBulletins() {
    if (!this.isConfigured()) {
      try {
        const r = await fetch('data.json');
        const j = await r.json();
        return j.bulletins || [];
      } catch (e) { return []; }
    }
    try {
      const snap = await db.collection('bulletins').get();
      const list = [];
      snap.forEach(doc => {
        const b = doc.data();
        if (b.status !== 'deleted') {
          list.push(b);
        }
      });
      list.sort((a, b) => (b.publishDate || '').localeCompare(a.publishDate || ''));
      return list;
    } catch (e) {
      console.error(e);
      return [];
    }
  },
  async getMonths() {
    const list = await this.getAllBulletins();
    const m = {};
    list.forEach(b => {
      const mk = (b.publishDate || '').slice(0, 7) || '?';
      if (!m[mk]) m[mk] = [];
      m[mk].push({ id: b.id, status: b.status || 'published', sections: b.sections, publishDate: b.publishDate });
    });
    return m;
  },
  async getById(id) {
    if (!this.isConfigured()) {
      try {
        const r = await fetch('data.json');
        const j = await r.json();
        return j.bulletins.find(b => b.id === id) || null;
      } catch (e) { return null; }
    }
    try {
      const docSnap = await db.collection('bulletins').doc(id).get();
      if (docSnap.exists) {
        return docSnap.data();
      }
      return null;
    } catch (e) {
      console.error(e);
      return null;
    }
  },
  async save(id, d) {
    if (!this.isConfigured()) {
      toast("請設定 firebase-config.js 以存入資料庫", "er");
      return { success: false };
    }
    try {
      const docRef = db.collection('bulletins').doc(id);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        const existing = docSnap.data();
        d.version = (existing.version || 1) + 1;
        if (existing.meta && existing.meta.publishedAt) {
          if (!d.meta) d.meta = {};
          d.meta.publishedAt = existing.meta.publishedAt;
        }
      } else {
        d.version = 1;
      }
      d.monthKey = (d.publishDate || '').slice(0, 7) || '';
      if (!d.meta) d.meta = {};
      d.meta.lastUpdated = new Date().toISOString();
      if (d.status === 'published' && !d.meta.publishedAt) {
        d.meta.publishedAt = d.meta.lastUpdated;
      }
      
      // 移除可能存在的 undefined 屬性 (Firestore 不支援 undefined)
      const cleanData = JSON.parse(JSON.stringify(d));
      
      await docRef.set(cleanData, { merge: true });
      return { success: true };
    } catch (e) {
      console.error(e);
      throw e;
    }
  },
  async del(id) {
    if (!this.isConfigured()) {
      toast("請設定 Firebase", "er");
      return { success: false };
    }
    try {
      const docRef = db.collection('bulletins').doc(id);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        await docRef.update({ status: 'deleted' });
      }
      return { success: true };
    } catch (e) {
      console.error(e);
      throw e;
    }
  },
  async getFB(id) {
    const b = await this.getById(id);
    return b ? b.feedbackLog || [] : [];
  },

  async getWhitelist() {
    if (!this.isConfigured()) return [];
    try {
      const snap = await db.collection('systemConfig').doc('whitelist').get();
      return snap.exists ? (snap.data().list || []) : [];
    } catch(e) { console.error(e); return []; }
  },
  async saveWhitelist(list) {
    if (!this.isConfigured()) return;
    try { await db.collection('systemConfig').doc('whitelist').set({ list }, { merge: true }); } catch(e) { console.error(e); }
  },
  async getMailGroups() {
    if (!this.isConfigured()) return [];
    try {
      const snap = await db.collection('systemConfig').doc('mailGroups').get();
      return snap.exists ? (snap.data().list || []) : [];
    } catch(e) { console.error(e); return []; }
  },
  async saveMailGroups(list) {
    if (!this.isConfigured()) return;
    try { await db.collection('systemConfig').doc('mailGroups').set({ list }, { merge: true }); } catch(e) { console.error(e); }
  },
  async getAdmins() {
    if (!this.isConfigured()) return [];
    try {
      const snap = await db.collection('systemConfig').doc('admins').get();
      return snap.exists ? (snap.data().list || []) : [];
    } catch(e) { console.error(e); return []; }
  },
  async saveAdmins(list) {
    if (!this.isConfigured()) return;
    try {
      await db.collection('systemConfig').doc('admins').set({ list: list }, { merge: true });
    } catch (e) {
      console.error(e);
    }
  },
  async getKeywords() {
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
  async getTpls() {
    const defaultTpls = [
      { id: 't1', t: '採購作業進度', i: '📋', hi: true },
      { id: 't2', t: '詢價／報價作業', i: '💰', hs: true },
      { id: 't3', t: '訂單異動作業', i: '📦', hao: true, hs: true },
      { id: 't4', t: '供應商管理作業', i: '🤝', hi: true },
      { id: 't5', t: '交貨管理作業', i: '🚚', hi: true },
      { id: 't6', t: '品質異常作業', i: '🔧', hr: true, hi: true },
      { id: 't7', t: '工程變更作業', i: '⚙️', hi: true },
      { id: 't8', t: '採購通知公告', i: '📢', hi: true },
      { id: 't9', t: '其他異動作業', i: '📝', hi: true },
      { id: 't10', t: '附件文件', i: '📎', hf: true },
      { id: 't11', t: '供應商通知', i: '✉️', hi: true },
      { id: 't12', t: '系統公告', i: '🔔', hi: true }
    ];
    if (!this.isConfigured()) return defaultTpls;
    try {
      const snap = await db.collection('systemConfig').doc('templates').collection('list').get();
      if (snap.empty) {
        return defaultTpls;
      }
      const tpls = [];
      snap.forEach(doc => tpls.push(doc.data()));
      tpls.sort((a, b) => a.id.localeCompare(b.id));
      return tpls;
    } catch (e) {
      console.error(e);
      return defaultTpls;
    }
  },
  async uploadAttachment(bulletinId, file) {
    if (!this.isConfigured()) throw new Error("請設定 Firebase 連線");
    try {
      const fileRef = storage.ref().child(`attachments/${bulletinId}/${Date.now()}_${file.name}`);
      await fileRef.put(file);
      const url = await fileRef.getDownloadURL();
      return { fileName: file.name, url: url };
    } catch (e) {
      console.error(e);
      throw e;
    }
  },
  async getReadReceipts(bulletinId) {
    if (!this.isConfigured()) return { total: 0, readers: [] };
    try {
      const snap = await db.collection('bulletins').doc(bulletinId).collection('readReceipts').get();
      const readers = [];
      snap.forEach(doc => {
        const data = doc.data();
        if (data.readAt) data.readAt = data.readAt.toDate().toLocaleString('zh-TW');
        if (data.lastViewedAt) data.lastViewedAt = data.lastViewedAt.toDate().toLocaleString('zh-TW');
        readers.push(data);
      });
      return { total: readers.length, readers: readers };
    } catch (e) {
      console.error(e);
      return { total: 0, readers: [] };
    }
  },
  async archiveOldBulletins(retentionMonths = 6) {
    if (!this.isConfigured()) return { archivedCount: 0 };
    try {
      const now = new Date();
      now.setMonth(now.getMonth() - retentionMonths);
      const cutoffStr = now.toISOString().slice(0, 10);
      const snap = await db.collection('bulletins').get();
      let count = 0;
      const batch = db.batch();
      snap.forEach(doc => {
        const data = doc.data();
        if (data.status === 'published' && data.publishDate < cutoffStr) {
          batch.update(doc.ref, { status: 'archived', archivedAt: firebase.firestore.FieldValue.serverTimestamp() });
          count++;
        }
      });
      if (count > 0) await batch.commit();
      return { archivedCount: count };
    } catch (e) {
      console.error(e);
      return { archivedCount: 0 };
    }
  },
  async addAuditLog(bulletinId, actionDesc) {
    if (!this.isConfigured()) return;
    try {
      const senderInfo = (firebase.auth().currentUser && firebase.auth().currentUser.email) ? (firebase.auth().currentUser.displayName || firebase.auth().currentUser.email) : '系統';
      await db.collection('bulletins').doc(bulletinId).collection('audit_logs').add({
        action: actionDesc,
        sender: senderInfo,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) { console.error('Audit Log Error:', e); }
  },
  async getAuditLogs(bulletinId) {
    if (!this.isConfigured()) return [];
    try {
      const snap = await db.collection('bulletins').doc(bulletinId).collection('audit_logs').orderBy('timestamp', 'desc').get();
      const logs = [];
      snap.forEach(doc => logs.push(doc.data()));
      return logs;
    } catch (e) { console.error('Get Audit Log Error:', e); return []; }
  }
};

const NS = {
  async send(templateParams) {
    if (typeof emailjs === 'undefined' || typeof emailjsConfig === 'undefined' || !emailjsConfig.serviceId) {
      console.log('[NS] EmailJS not configured. Would have sent:', templateParams);
      return { ok: false };
    }
    try {
      await emailjs.send(emailjsConfig.serviceId, emailjsConfig.templateId, templateParams);
      console.log('[NS] Email sent successfully');
      return { ok: true };
    } catch (e) {
      console.error('[NS] Email send failed:', e);
      return { ok: false };
    }
  },
  async notify(b) {
    return this.send({
      bulletin_id: b.id,
      bulletin_title: b.title || '無標題',
      publish_date: b.publishDate,
      message: `[採購週報] ${b.id} 已正式發布，請同仁登入系統查看。`
    });
  }
};

// Initialize Firebase if configured
var db, storage;
if (DS.isConfigured()) {
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    storage = firebase.storage();
  } catch (e) {
    console.error("Firebase initialization failed:", e);
  }
}

const S = {
  tpls: [],
  keywords: [],
  
  admins: [],
  whitelist: [],
  mailGroups: [],
  mmap: {},
  cur: null,
  dirty: false
};
async function init(){
  S.tpls=await DS.getTpls();
  S.keywords=await DS.getKeywords();
    S.admins=await DS.getAdmins();
  S.whitelist=await DS.getWhitelist();
  S.mailGroups=await DS.getMailGroups();
  
  if (S.whitelist.length === 0) {
    S.whitelist = "JunWei Wu 吳俊緯 <JunWeiWu@youbike.com.tw>; Jiyu Gu 顧致宇 <JiyuGu@youbike.com.tw>; Lucas Wang 王文樺 <LucasWang@youbike.com.tw>; Mars Lin 林瑋泰 <MarsLin@youbike.com.tw>; George Chen 陳俊帆 <GeorgeChen@youbike.com.tw>; Sherry Lu 呂淑意 <SherryLu@youbike.com.tw>; Jane Chuang 莊佳誼 <JaneChuang@youbike.com.tw>; Beichen Ren 任北辰 <BeichenRen@youbike.com.tw>; Ruby Chen 陳恩柔 <RubyChen2@youbike.com.tw>; Wei Wan 萬偉 <WeiWan@youbike.com.tw>; Sinan Lin 林信安 <SinanLin@youbike.com.tw>; Tank Lin 林育民 <TankLin@youbike.com.tw>; Clon Huang 黃龍輝 <ClonHuang@youbike.com.tw>; HsuWei Chu 朱栩葳 <HsuWeiChu@youbike.com.tw>; XinRay Hung 洪訢睿 <XinRayHung@youbike.com.tw>; Shuni NI 倪順一 <ShuniNI@youbike.com.tw>; Chiahsiu Li 李嘉修 <ChiahsiuLi@youbike.com.tw>; Boa Chen 陳漢全 <BoaChen@youbike.com.tw>; YiMin Chiu 邱宜敏 <YiMinChiu@youbike.com.tw>; Bruce Lin 林渝軒 <BruceLin@youbike.com.tw>; RuXuan Zhang 張挐瑄 <RuXuanZhang@youbike.com.tw>; Cola Wu 吳建穎 <ColaWu@youbike.com.tw>; JianDe Liu 劉建德 <JianDeLiu@youbike.com.tw>; Sam Huang 黃聖育 <SamHuang@youbike.com.tw>; ZihYue Li 李子岳 <ZihYueLi@youbike.com.tw>; Zoey Lin 林言柔 <ZoeyLin@youbike.com.tw>; ShuChi Lu 呂淑綺 <ShuChiLu@youbike.com.tw>; Colin Tang 唐仕伀 <ColinTang@youbike.com.tw>; Hanley Fu 傅涵立 <HanleyFu@youbike.com.tw>; Ringka Huang 黃仁瑱 <RingkaHuang@youbike.com.tw>; Kevin Chang 張浩 <KevinChang@youbike.com.tw>; Aidpan Chen 陳麒任 <AidpanChen@youbike.com.tw>; Jerry Hsu 徐嘉鴻 <JHsu@youbike.com.tw>; Wendy Lu 盧瑞云 <WendyLu@youbike.com.tw>; Ruowei Wang 王若維 <RuoweiWang@youbike.com.tw>; Yun Chen 陳韻欣 <YunChen@youbike.com.tw>; Ryan Peng 彭上維 <RyanPeng@youbike.com.tw>; Michael Chien 簡榮德 <MichaelChien@youbike.com.tw>; Hank Tsai 蔡瀚緯 <HankTsai@youbike.com.tw>; MingXiao Lin 林明孝 <MingXiaoLin@youbike.com.tw>; Chenlong Pai 白正隆 <ChenlongPai@youbike.com.tw>; QiZhong Huang 黃啟中 <QiZhongHuang@youbike.com.tw>".split('; ').map(s => { const m = s.match(/(.+)\s<(.+)>/); return m ? { name: m[1].trim(), email: m[2].trim() } : null; }).filter(Boolean);
    await DS.saveWhitelist(S.whitelist);
  }

  S.mmap=await DS.getMonths();
  
  // 載入月份選單過濾用的月份選單
  const mArr = Object.keys(S.mmap).sort().reverse();
  const smEl = document.getElementById('admin-search-month');
  if(smEl) {
    smEl.innerHTML = '<option value="">全部月份</option>';
    mArr.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      smEl.appendChild(opt);
    });
  }

  renderSB();
  if (DS.isConfigured()) {
    try {
      const { archivedCount } = await DS.archiveOldBulletins(6);
      if (archivedCount > 0) {
        console.log(`Auto-archived ${archivedCount} old bulletins.`);
      }
    } catch(e) {}
  }
}

const ADMIN_EMAILS = [
  'leokung@youbike.com.tw',
  'sunnyting@youbike.com.tw',
  'gb4398@giantcycling.com'
];

async function adminGoogleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    const result = await firebase.auth().signInWithPopup(provider);
    const user = result.user;
    const userEmail = user.email.toLowerCase();
    if (userEmail.endsWith('@youbike.com.tw') || ADMIN_EMAILS.includes(userEmail) || ADMIN_EMAILS.map(e => e.toLowerCase()).includes(userEmail)) {
      const adminList = await DS.getAdmins();
      if (adminList.some(a => a.email.toLowerCase() === userEmail) || ADMIN_EMAILS.map(e => e.toLowerCase()).includes(userEmail)) {
        document.getElementById('lo').style.display = 'none';
        await init();
        toast('歡迎回來，採購管理員 👋', 'in');
      } else {
        await firebase.auth().signOut();
        const e = document.getElementById('le');
        e.innerText = '無後台登入權限，請確認是否已被加入管理員名單。';
        e.classList.remove('hidden');
        setTimeout(() => e.classList.add('hidden'), 3000);
      }
    } else {
      await firebase.auth().signOut();
      const e = document.getElementById('le');
      e.innerText = '無登入權限，請使用 @youbike.com.tw 帳號。';
      e.classList.remove('hidden');
      setTimeout(() => e.classList.add('hidden'), 3000);
    }
  } catch (error) {
    console.error('Login failed', error);
    alert('登入失敗，請確認 Firebase 後台是否已啟用 Google 登入，或是否阻擋了彈出視窗。\n錯誤訊息：' + error.message);
  }
}

let adminSearchMonth = '';
let adminSearchParent = '';
let adminSearchQuery = '';

function handleAdminSearch() {
  adminSearchMonth = document.getElementById('admin-search-month').value;
  adminSearchParent = document.getElementById('admin-search-parent').value;
  adminSearchQuery = document.getElementById('admin-search-keyword').value.trim().toLowerCase();
  renderSB();
}

function renderSB() {
  const c = document.getElementById('sbm');
  let filteredMmap = {};
  
  Object.keys(S.mmap).forEach(mk => {
    // 過濾月份
    if (adminSearchMonth && mk !== adminSearchMonth) return;
    
    const matched = S.mmap[mk].filter(b => {
      // 母標題過濾
      if (adminSearchParent) {
        if (!b.sections) return false;
        const secs = Array.isArray(b.sections) ? b.sections : Object.values(b.sections);
        const hasParent = secs.some(s => s.title === adminSearchParent);
        if (!hasParent) return false;
      }
      
      // 關鍵字過濾
      if (adminSearchQuery) {
        const contentStr = JSON.stringify(b).toLowerCase();
        if (!contentStr.includes(adminSearchQuery)) return false;
      }
      return true;
    });
    
    if (matched.length > 0) filteredMmap[mk] = matched;
  });

  const ks = Object.keys(filteredMmap).sort().reverse();
  if (!ks.length) {
    c.innerHTML = '<div class="text-center py-6 text-slate-400 text-xs">尚無符合條件的週報</div>';
    return;
  }
  c.innerHTML = ks.map(mk => {
    const a = mk === S.amon;
    return `
      <div class="mb-1">
        <button class="sb-mb ${a ? 'act' : ''}" onclick="togMo('${mk}')">
          <span>${fmtMo(mk)}</span><span class="text-xs text-slate-400">${filteredMmap[mk].length} 份</span>
        </button>
        <div id="mo-${mk}" class="${a ? '' : 'hidden'} mt-0.5 space-y-0.5">
          ${filteredMmap[mk].map(b => `<button class="sb-bb ${S.cur?.id === b.id ? 'act' : ''}" onclick="loadB('${b.id}')">${b.id}</button>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}
function togMo(mk) { S.amon = S.amon === mk ? null : mk; renderSB(); }
function fmtMo(mk) { const [y, m] = mk.split('-'); return `${y} 年 ${parseInt(m)} 月`; }

async function loadB(id){
  if(S.dirty&&!confirm('有未儲存的修改，確定離開？'))return;
  const b=await DS.getById(id);
  if(!b){toast('無法載入此週報','er');return;}
  S.cur=JSON.parse(JSON.stringify(b));
  S.dirty=false;
  renderEd();
  renderSB();
  renderReadReceipts(id);
  renderAuditLogs(id);
}

async function renderReadReceipts(id) {
  const container = document.getElementById('read-list');
  const countEl = document.getElementById('read-count');
  if (!container) return;
  
  if (!DS.isConfigured()) {
    container.innerHTML = '<p class="text-slate-400 text-center py-2">本地測試模式：不支援已讀追蹤</p>';
    countEl.innerHTML = `
      <span class="text-xs bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full font-semibold border border-indigo-100">已讀: 0 人</span>
      <span class="text-xs bg-slate-50 text-slate-500 px-2.5 py-1 rounded-full font-medium border border-slate-200">未讀: 0 人</span>
    `;
    return;
  }
  
  try {
    const { total, readers } = await DS.getReadReceipts(id);
    
    const allUsers = S.whitelist || [];

    const b = S.cur && S.cur.id === id ? S.cur : await DS.getById(id);
    const targetEmails = (b && b.authorizedEmails && b.authorizedEmails.length > 0) 
      ? b.authorizedEmails 
      : allUsers.map(u => u.email);
    
    const unread = allUsers.filter(u => 
      targetEmails.includes(u.email) && 
      !readers.find(r => r.email === u.email || r.displayName === u.name)
    );

    countEl.innerHTML = `
      <span class="text-xs bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full font-semibold border border-indigo-100">已讀: ${total} 人</span>
      <span class="text-xs bg-slate-50 text-slate-500 px-2.5 py-1 rounded-full font-medium border border-slate-200">未讀: ${unread.length} 人</span>
    `;
    
    if (readers.length === 0 && unread.length === 0) {
      container.innerHTML = '<p class="text-slate-400 text-center py-2">目前尚無閱讀紀錄，且未設定名冊</p>';
      return;
    }
    
    let html = '';
    if (readers.length > 0) {
      html += `
        <p class="font-semibold text-slate-700 mb-2 border-b border-slate-100 pb-1">✅ 已讀人員</p>
        <table class="w-full text-left border-collapse mb-4">
          <thead>
            <tr class="text-[10px] text-slate-400">
              <th class="pb-1.5 font-semibold">姓名</th>
              <th class="pb-1.5 font-semibold">部門</th>
              <th class="pb-1.5 font-semibold">首次閱讀時間</th>
              <th class="pb-1.5 font-semibold">最後閱覽時間</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-50">
            ${readers.map(r => `
              <tr>
                <td class="py-2 text-slate-700 font-medium">${xe(r.displayName)}</td>
                <td class="py-2 text-slate-500">${xe(r.department)}</td>
                <td class="py-2 text-slate-400">${r.readAt}</td>
                <td class="py-2 text-slate-400">${r.lastViewedAt}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    
    if (unread.length > 0) {
      const isDraft = S.cur && S.cur.status === 'draft';
      const hiddenCls = isDraft ? 'hidden' : '';
      const toggleBtn = isDraft ? `<button onclick="document.getElementById('unread-container').classList.toggle('hidden')" class="ml-2 text-xs text-blue-500 hover:text-blue-700 font-normal bg-blue-50 px-2 py-0.5 rounded cursor-pointer border border-blue-200">👁️ 顯示/隱藏</button>` : '';
      html += `
        <div class="font-semibold text-slate-700 mb-2 border-b border-slate-100 pb-1 mt-4 flex items-center">
          <span>⚠️ 未讀人員</span> ${toggleBtn}
        </div>
        <div id="unread-container" class="flex flex-wrap gap-2 ${hiddenCls}">
          ${unread.map(u => `<span class="px-2.5 py-1 bg-rose-50 text-rose-600 rounded text-xs font-medium">${xe(u.name)}</span>`).join('')}
        </div>
      `;
    }
    
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="text-red-400 text-center py-2">載入已讀狀態失敗</p>';
  }
}

async function renderAuditLogs(id) {
  const container = document.getElementById('audit-list');
  if (!container) return;
  if (!DS.isConfigured()) {
    container.innerHTML = '<p class="text-slate-400 text-center py-2">本地測試模式：不支援紀錄</p>';
    return;
  }
  try {
    const logs = await DS.getAuditLogs(id);
    if (logs.length === 0) {
      container.innerHTML = '<p class="text-slate-400 text-center py-2">尚無發送或操作紀錄</p>';
      return;
    }
    container.innerHTML = logs.map(l => {
      let timeStr = '時間未知';
      if (l.timestamp && l.timestamp.toDate) {
        const d = l.timestamp.toDate();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        timeStr = `${yyyy}/${mm}/${dd} ${hh}:${min}`;
      }
      const sender = l.sender || '系統';
      return `
        <div class="flex flex-col gap-1 py-3 border-b border-slate-100 last:border-0">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">${xe(sender)}</span>
            <span class="text-xs text-slate-400">${timeStr}</span>
          </div>
          <span class="text-sm text-slate-700 font-medium pl-1">${xe(l.action)}</span>
        </div>
      `;
    }).join('');
  } catch(e) {
    container.innerHTML = '<p class="text-red-400 text-center py-2">載入紀錄失敗</p>';
  }
}

function openSettingsModal() { document.getElementById('settings-modal').classList.remove('hidden'); switchSettingsTab('tab-frontend'); }
function closeSettingsModal() { document.getElementById('settings-modal').classList.add('hidden'); }
function switchSettingsTab(t) {
  document.querySelectorAll('.settings-tab-pane').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[id^="btn-tab-"]').forEach(el => el.classList.remove('bg-blue-50', 'text-blue-700', 'font-bold'));
  const tEl = document.getElementById(t), bEl = document.getElementById('btn-'+t);
  if (tEl) tEl.classList.remove('hidden');
  if (bEl) bEl.classList.add('bg-blue-50', 'text-blue-700', 'font-bold');
  if(t==='tab-whitelist')renderWL(); if(t==='tab-groups')renderGroupList(); if(t==='tab-admin')renderAdminList(); if(t==='tab-keywords'){tempKw=JSON.parse(JSON.stringify(S.keywords));renderKMCats();} if(t==='tab-handover')loadHandoverConfig();
}
function openAboutModal() { document.getElementById('about-modal').classList.remove('hidden'); switchAboutTab('tab-guide'); }
function closeAboutModal() { document.getElementById('about-modal').classList.add('hidden'); }
function switchAboutTab(t) {
  document.querySelectorAll('.about-tab-pane').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[id^="btn-tab-"]').forEach(el => {
    if(el.id==='btn-tab-guide'||el.id==='btn-tab-achievements') { el.classList.remove('text-amber-600','border-amber-500'); el.classList.add('text-slate-500','border-transparent'); }
  });
  const tEl = document.getElementById(t), bEl = document.getElementById('btn-'+t);
  if (tEl) tEl.classList.remove('hidden');
  if (bEl) { bEl.classList.remove('text-slate-500','border-transparent'); bEl.classList.add('text-amber-600','border-amber-500'); }
}

let currentGroupId = null;
async function addGroup() {
  const name = document.getElementById('grp-name').value.trim();
  if (!name) return toast('請輸入群組名稱', 'er');
  S.mailGroups.push({ id: 'grp_'+Date.now(), name, emails: [] });
  await DS.saveMailGroups(S.mailGroups);
  document.getElementById('grp-name').value = '';
  renderGroupList();
  toast('已建立群組', 'ok');
}
async function delGroup(id) {
  if (!confirm('確定刪除此群組？')) return;
  S.mailGroups = S.mailGroups.filter(g => g.id !== id);
  await DS.saveMailGroups(S.mailGroups);
  if (currentGroupId === id) {
    currentGroupId = null;
    const t = document.getElementById('group-detail-title'), m = document.getElementById('group-members');
    if (t) t.textContent = '請選擇左側群組';
    if (m) m.innerHTML = '<div class="text-center text-slate-400 mt-10 text-sm">請選擇左側群組以編輯成員</div>';
  }
  renderGroupList();
}
function renderGroupList() {
  const c = document.getElementById('group-list');
  if (!c) return;
  if (S.mailGroups.length === 0) {
    c.innerHTML = '<div class="text-center text-slate-400 mt-5 text-sm">尚無群組</div>';
    return;
  }
  c.innerHTML = S.mailGroups.map(g => `
    <div onclick="selectGroup('${g.id}')" class="p-3 mb-1.5 rounded-lg cursor-pointer transition-colors border ${g.id === currentGroupId ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm font-semibold' : 'bg-white border-transparent text-slate-600 hover:bg-slate-100'} flex items-center justify-between text-sm">
      <span class="truncate">${xe(g.name)}</span>
      <div class="flex items-center gap-2">
        <span class="text-xs bg-white px-2 py-0.5 rounded-full shadow-sm text-slate-500">${g.emails.length}</span>
        <button onclick="event.stopPropagation(); delGroup('${g.id}')" class="text-red-400 hover:text-red-600">🗑️</button>
      </div>
    </div>
  `).join('');
}
function selectGroup(id) {
  currentGroupId = id;
  renderGroupList();
  const g = S.mailGroups.find(x => x.id === id);
  if (!g) return;
  const t = document.getElementById('group-detail-title');
  if (t) t.textContent = g.name + ' - 成員管理';
  renderGroupMembers();
}
function renderGroupMembers() {
  const c = document.getElementById('group-members');
  if (!c) return;
  const g = S.mailGroups.find(x => x.id === currentGroupId);
  if (!g) return;
  
  const searchEl = document.getElementById('grp-search');
  const kw = searchEl ? searchEl.value.trim().toLowerCase() : '';
  
  let list = S.whitelist;
  if(kw) {
    list = list.filter(w => w.name.toLowerCase().includes(kw) || w.email.toLowerCase().includes(kw));
  }

  if (list.length === 0) {
    c.innerHTML = '<div class="text-center text-slate-400 mt-10 text-sm">無符合條件的名單</div>';
    return;
  }
  c.innerHTML = list.map(w => {
    const isMember = g.emails.includes(w.email);
    return `
      <label class="flex items-center gap-3 p-3 mb-1.5 rounded-lg border ${isMember ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100 bg-white hover:bg-slate-50'} cursor-pointer transition-colors">
        <input type="checkbox" class="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500" ${isMember ? 'checked' : ''} onchange="toggleGroupMember('${w.email}', this.checked)">
        <div class="flex flex-col"><span class="text-sm font-semibold text-slate-700">${xe(w.name)}</span><span class="text-xs text-slate-400">${xe(w.email)}</span></div>
      </label>
    `;
  }).join('');
}
async function toggleGroupMember(email, isChecked) {
  const g = S.mailGroups.find(x => x.id === currentGroupId);
  if (!g) return;
  if (isChecked) { if (!g.emails.includes(email)) g.emails.push(email); }
  else { g.emails = g.emails.filter(e => e !== email); }
  await DS.saveMailGroups(S.mailGroups);
  renderGroupList();
}









function showAdminList() { 
  document.getElementById('admin-modal').classList.remove('hidden'); 
  renderAdminList(); 
}
function hideAdminList() { document.getElementById('admin-modal').classList.add('hidden'); }
function renderAdminList() {
  const c = document.getElementById('am-list');
  if (S.admins.length === 0) {
    c.innerHTML = '<tr><td colspan="3" class="px-3 py-4 text-center text-slate-400">目前尚無管理員，請新增</td></tr>';
    return;
  }
  c.innerHTML = S.admins.map((u, i) => `
    <tr>
      <td class="px-3 py-2 text-slate-700 font-medium">${xe(u.name)}</td>
      <td class="px-3 py-2 text-slate-500">${xe(u.email)}</td>
      <td class="px-3 py-2 text-center">
        <button onclick="delAdmin(${i})" class="text-rose-500 hover:text-rose-700"><svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
      </td>
    </tr>
  `).join('');
}
async function addAdmin() {
  const n = document.getElementById('am-name').value.trim();
  const e = document.getElementById('am-email').value.trim();
  if(!n || !e) return toast('姓名與信箱必填', 'er');
  S.admins.push({ name: n, email: e });
  await DS.saveAdmins(S.admins);
  document.getElementById('am-name').value = '';
  document.getElementById('am-email').value = '';
  renderAdminList();
  toast('已新增管理員', 'ok');
}
async function delAdmin(i) {
  if(!confirm('確定刪除嗎？')) return;
  S.admins.splice(i, 1);
  await DS.saveAdmins(S.admins);
  renderAdminList();
  toast('已刪除', 'ok');
}

function newBulletin(){if(S.dirty&&!confirm('有未儲存的修改，確定繼續？'))return;const now=new Date(),p=n=>String(n).padStart(2,'0'),ds=`${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;S.cur={id:`${now.getFullYear()}-W${wk(now)}`,publishDate:ds,title:'經營TEAM採購｜本週重點摘要',periodStart:ds,periodEnd:ds,isPinned:false,status:'draft',version:1,sections:[]};S.dirty=false;renderEd();toast('已建立新週報草稿','in');}
function wk(d){const j=new Date(d.getFullYear(),0,1);return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7);}
async function unpubBulletin(){if(!S.cur)return;if(!confirm('確定要撤回發布？撤回後前台將無法看見此週報。'))return;const pt=document.getElementById('pub-txt'),btn=document.getElementById('btn-unpub');btn.disabled=true;pt.textContent='撤回中...';try{const d={...S.cur,status:'draft',feedbackLog:S.fbs};await DS.save(d.id,d);await DS.addAuditLog(d.id, `管理員撤回了週報。`);S.dirty=false;const sb=document.getElementById('tb-status');sb.className='bdg-dft';sb.textContent='草稿';toast('週報已撤回發布！','ok');S.mmap=await DS.getMonths();renderSB();renderAuditLogs(d.id);renderEd();}catch(e){toast('撤回失敗：'+e.message,'er');}finally{btn.disabled=false;pt.textContent='正式發布';}}
function renderEd(){const b=S.cur;if(!b)return;document.getElementById('es').classList.add('hidden');document.getElementById('bf').classList.remove('hidden');document.getElementById('tb-acts').classList.remove('hidden');document.getElementById('tb-title').textContent=b.id||'新週報';const sb=document.getElementById('tb-status');sb.className=b.status==='published'?'bdg-pub':'bdg-dft';sb.textContent=b.status==='published'?'已發布':'草稿';sb.classList.remove('hidden');if(b.status==='published'){document.getElementById('btn-unpub').classList.remove('hidden');document.getElementById('btn-pub').classList.add('hidden');}else{document.getElementById('btn-unpub').classList.add('hidden');document.getElementById('btn-pub').classList.remove('hidden');}document.getElementById('f-id').value=b.id||'';document.getElementById('f-pd').value=b.publishDate||'';document.getElementById('f-ps').value=b.periodStart||'';document.getElementById('f-pe').value=b.periodEnd||'';document.getElementById('f-ti').value=b.title||'';document.getElementById('f-pin').checked=!!b.isPinned;renderSecs();}
function renderSecs(){const c=document.getElementById('sc');const b=S.cur;const ptl=document.getElementById('toolbar-portal');if(ptl)ptl.innerHTML='';if(!b?.sections?.length){c.innerHTML='<div class="text-center py-10 text-slate-400 text-sm">尚未建立任何段落<br><span class="text-xs">點擊右上角「新增段落」</span></div>';return;}c.innerHTML=b.sections.map((s,i)=>bldSec(s,i)).join('');setTimeout(()=>{document.querySelectorAll('.quill-editor').forEach(el=>{if(el.__quill)return;const q=new Quill(el,{theme:'snow',modules:{toolbar:{
  container: [
    [{'font':['"Inter", sans-serif', '"MingLiU", PMingLiU, serif', '"Microsoft JhengHei", sans-serif', 'monospace']}, {'size':['8pt', '10pt', '12pt', '14pt', false, '18pt', '20pt', '24pt', '28pt', '32pt']}],
    ['bold','italic','underline','strike'],
    ['boxed', 'circled'],
    [{'color':['#000000', '#444444', '#666666', '#999999', '#cccccc', '#eeeeee', '#f3f4f6', '#ffffff', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#9900ff', '#ff00ff', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#b4a7d6', '#d5a6bd', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c6', '#674ea7', '#a64d79', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#0b5394', '#351c75', '#741b47', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#073763', '#20124d', '#4c1130']},
     {'background':['#000000', '#444444', '#666666', '#999999', '#cccccc', '#eeeeee', '#f3f4f6', '#ffffff', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#9900ff', '#ff00ff', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#b4a7d6', '#d5a6bd', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6fa8dc', '#8e7cc3', '#c27ba0', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c6', '#674ea7', '#a64d79', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#0b5394', '#351c75', '#741b47', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#073763', '#20124d', '#4c1130']}],
    [{'lineHeight':['1', '1.5', '2', '2.5', '3']}],
    ['delete-table', 'clean']
  ],
  handlers: {
    'delete-table': function() {
      const range = this.quill.getSelection();
      if(range) {
          const leaf = this.quill.getLeaf(range.index);
          let node = leaf && leaf[0] ? leaf[0].domNode : null;
          while(node && node.tagName !== 'TABLE' && node.tagName !== 'BODY') {
              node = node.parentNode;
          }
          if(node && node.tagName === 'TABLE') {
              node.remove();
              this.quill.update();
          } else {
              toast('請先將游標點擊在表格內，再按下刪除按鈕', 'in');
          }
      }
    }
  }
}}});el.__quill=q;q.root.addEventListener('paste', async (e) => {
const file = e.clipboardData?.files?.[0];
if (file && file.type.startsWith('image/')) {
e.preventDefault();
const range = q.getSelection(true);
q.insertText(range.index, '⏳ 圖片上傳中...', 'user');
try {
const res = await DS.uploadAttachment(S.cur.id || 'temp', file);
q.deleteText(range.index, '⏳ 圖片上傳中...'.length);
q.insertEmbed(range.index, 'image', res.url, 'user');
} catch(err) {
q.deleteText(range.index, '⏳ 圖片上傳中...'.length);
toast('圖片上傳失敗', 'er');
}
}
});const tb=el.previousElementSibling;if(tb&&tb.classList.contains('ql-toolbar')){tb.style.display='none';if(ptl)ptl.appendChild(tb);const focusFn=()=>{if(ptl){Array.from(ptl.children).forEach(ch=>ch.style.display='none');tb.style.display='flex';const hint=document.getElementById('toolbar-hint');if(hint)hint.style.display='none';}};q.root.addEventListener('focus',focusFn);tb.addEventListener('mousedown',(e)=>{e.preventDefault();focusFn();});
const setIcon = (cls, icon, title, groupIndex) => {
  let btn = tb.querySelector('.ql-' + cls);
  if(!btn) {
    btn = document.createElement('button');
    btn.className = 'ql-' + cls;
    const groups = tb.querySelectorAll('.ql-formats');
    if(groups.length > groupIndex) groups[groupIndex].appendChild(btn);
    else if(groups.length > 0) groups[groups.length-1].appendChild(btn);
  }
  btn.innerHTML = icon; btn.title = title; btn.style.fontSize='14px';
};
setIcon('boxed', '🄰', '文字加框', 2);
setIcon('circled', '⭕', '文字加圓圈', 2);
setIcon('delete-table', '🗑️', '刪除段落內表格', 5);
}q.on('text-change',()=>{let obj=S.cur;const p=el.getAttribute('data-path').split(/[.\[\]]/).filter(Boolean);for(let i=0;i<p.length-1;i++)obj=obj[p[i]];obj[p[p.length-1]]=q.root.innerHTML;S.dirty=true;});});},10);}
const NUMS=['一','二','三','四','五','六','七','八','九','十'];const ICONS=['📋','📦','🔧','💰','📈','📎','⚙️','📊','📝','🏭'];function bldSec(sec,si){const isCust=!S.keywords.find(c=>c.name===sec.title);
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
<span class="text-xs text-slate-400 font-medium ml-2">${NUMS[si]||si+1}、</span>
<button onclick="mvUp(${si})" class="bic" title="上移"><svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg></button>
<button onclick="mvDn(${si})" class="bic" title="下移"><svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg></button>
<button onclick="rmSec(${si})" class="bic d" title="刪除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
<button onclick="addTableToSec(${si})" class="bic text-xs" title="新增自訂表格" ${sec.table||sec.affectedOrders||sec.cancelledOrders||sec.repairRecords||sec.priceChangeItems?'style="display:none"':''}>📊 表格</button>
</div>
<input id="cti-${si}" type="text" class="form-input text-sm mb-3 ${isCust?'':'hidden'}" value="${xe(sec.title||'')}" placeholder="自訂段落標題..." oninput="uSec(${si},'title',this.value)">
${bldItems(sec,si)}${sec.subsections!=null?bldSubs(sec,si):''}${sec.table!=null?bldGenericTbl(sec.table,si):''}${sec.affectedOrders!=null?bldOT(sec.affectedOrders,si,'affectedOrders','異動訂單'):''}${sec.cancelledOrders!=null?bldOT(sec.cancelledOrders,si,'cancelledOrders','取消訂單'):''}${sec.repairRecords!=null?bldRT(sec.repairRecords,si):''}${sec.priceChangeItems!=null?bldPT(sec.priceChangeItems,si):''}${bldFiles(sec,si)}
</div>`;}
function bldGenericTbl(t,si){if(!t||!t.columns||!t.rows)return'';return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">表格資料</p><div class="flex gap-3"><button onclick="editGenCols(${si})" class="text-xs text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded">⚙️ 編輯欄位</button><button onclick="addGenRow(${si})" class="text-xs text-blue-600 font-medium">＋ 新增列</button><button onclick="rmSecTable(${si}, \'table\')" class="text-xs text-red-500 font-medium ml-3 flex items-center gap-1 hover:text-red-700"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> 刪除表格</button></div></div><div class="overflow-x-auto rounded-lg border border-slate-200"><table class="data-table w-full text-xs"><thead><tr>${t.columns.map(c=>`<th>${xe(c)}</th>`).join('')}<th style="width:28px"></th></tr></thead><tbody>${t.rows.map((r,ri)=>`<tr>${r.map((c,ci)=>`<td><input value="${xe(c||'')}" onchange="uGenRow(${si},${ri},${ci},this.value)"></td>`).join('')}<td><button onclick="rmGenRow(${si},${ri})" class="bic d"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`).join('')}</tbody></table></div></div>`;}
function addGenRow(si){if(!S.cur.sections[si].table)return;const cols=S.cur.sections[si].table.columns.length;S.cur.sections[si].table.rows.push(Array(cols).fill(''));S.dirty=true;renderSecs();}
function rmGenRow(si,ri){S.cur.sections[si].table.rows.splice(ri,1);S.dirty=true;renderSecs();}
function uGenRow(si,ri,ci,v){S.cur.sections[si].table.rows[ri][ci]=v;S.dirty=true;}
function editGenCols(si){const t=S.cur.sections[si].table;const cStr=prompt('請輸入欄位名稱 (使用逗號分隔，例如: 廠商,料號,數量)',t.columns.join(','));if(cStr!==null){const cols=cStr.split(',').map(s=>s.trim()).filter(s=>s);if(cols.length>0){t.columns=cols;t.rows=t.rows.map(r=>{while(r.length<cols.length)r.push('');if(r.length>cols.length)r.length=cols.length;return r;});S.dirty=true;renderSecs();}}}
function rmSecTable(si, type) { if(confirm('確定要刪除此表格嗎？')) { delete S.cur.sections[si][type]; S.dirty=true; renderSecs(); } }
function addTableToSec(si){S.cur.sections[si].table={columns:['欄位一','欄位二'],rows:[]};S.dirty=true;renderSecs();}
function bldItems(sec,si){const items=sec.items||[];return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">重點公告</p><button onclick="addItm(${si})" class="text-xs text-blue-600 font-medium">＋ 新增</button></div>${items.map((item,ii)=>`<div class="flex items-start gap-2 mb-2"><select class="form-input csel w-20 text-xs py-1" onchange="uItm(${si},${ii},'priority',this.value)"><option value="normal" ${item.priority==='normal'?'selected':''}>一般</option><option value="high" ${item.priority==='high'?'selected':''}>緊急</option></select><div class="flex-1 quill-editor bg-white border border-slate-200 rounded min-h-[60px]" data-path="sections[${si}].items[${ii}].content">${item.content||''}</div><button onclick="rmItm(${si},${ii})" class="bic d mt-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>`).join('')}${!items.length?'<p class="text-xs text-slate-400 py-1">尚無公告項目</p>':''}</div>`;}function bldSubs(sec,si){const subs=sec.subsections||[];return`<div class="mb-3 pl-3 border-l-2 border-blue-100"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">子段落</p><button onclick="addSub(${si})" class="text-xs text-blue-600 font-medium">＋ 新增子段落</button></div>${subs.map((sub,sbi)=>`<div class="mb-3 bg-slate-50 rounded-lg p-3"><div class="flex items-center gap-2 mb-2"><span class="text-xs text-slate-400 font-semibold">${sbi+1}.</span><input type="text" class="form-input flex-1 text-sm py-1" value="${xe(sub.title||'')}" placeholder="子段落標題..." oninput="uSub(${si},${sbi},'title',this.value)"><button onclick="rmSub(${si},${sbi})" class="bic d"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>${(sub.items||[]).map((item,ii)=>`<div class="flex items-start gap-2 mb-1.5"><select class="form-input csel w-20 text-xs py-1" onchange="uSI(${si},${sbi},${ii},'priority',this.value)"><option value="normal" ${item.priority==='normal'?'selected':''}>一般</option><option value="high" ${item.priority==='high'?'selected':''}>緊急</option></select><div class="flex-1 quill-editor bg-white border border-slate-200 rounded min-h-[60px]" data-path="sections[${si}].subsections[${sbi}].items[${ii}].content">${item.content||''}</div><button onclick="rmSI(${si},${sbi},${ii})" class="bic d mt-0.5"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>`).join('')}<button onclick="addSI(${si},${sbi})" class="text-xs text-blue-500 mt-1">＋ 新增條目</button></div>`).join('')}</div>`;}function bldOT(orders,si,field,label){return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">${label}</p><button onclick="addRow(${si},'${field}')" class="text-xs text-blue-600 font-medium">＋ 新增列</button><button onclick="rmSecTable(${si}, '${field}')" class="text-xs text-red-500 font-medium ml-3 flex items-center gap-1 hover:text-red-700"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> 刪除表格</button></div><div class="overflow-x-auto rounded-lg border border-slate-200"><table class="data-table w-full text-xs min-w-[640px]"><thead><tr><th>供應商</th><th>訂單號</th><th>行號</th><th>料號</th><th>品名</th><th>數量</th><th>原交期</th><th>新交期</th><th>倉庫</th><th style="width:28px"></th></tr></thead><tbody>${(orders||[]).map((o,ri)=>`<tr><td><input value="${xe(o.supplierName||'')}" onchange="uRow(${si},'${field}',${ri},'supplierName',this.value)"></td><td><input value="${xe(o.poNumber||'')}" onchange="uRow(${si},'${field}',${ri},'poNumber',this.value)"></td><td><input value="${xe(o.lineNumber||'')}" style="width:45px" onchange="uRow(${si},'${field}',${ri},'lineNumber',this.value)"></td><td><input value="${xe(o.partNumber||'')}" onchange="uRow(${si},'${field}',${ri},'partNumber',this.value)"></td><td><input value="${xe(o.itemName||'')}" onchange="uRow(${si},'${field}',${ri},'itemName',this.value)"></td><td><input type="number" value="${o.quantity||''}" style="width:55px" onchange="uRow(${si},'${field}',${ri},'quantity',parseInt(this.value)||0)"></td><td><input type="date" value="${xe(o.originalDelivery||'')}" onchange="uRow(${si},'${field}',${ri},'originalDelivery',this.value)"></td><td><input value="${xe(o.newDelivery||'')}" onchange="uRow(${si},'${field}',${ri},'newDelivery',this.value)"></td><td><input value="${xe(o.warehouseName||'')}" onchange="uRow(${si},'${field}',${ri},'warehouseName',this.value)"></td><td><button onclick="rmRow(${si},'${field}',${ri})" class="bic d"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`).join('')}</tbody></table></div></div>`;}function bldRT(records,si){return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">返修紀錄</p><button onclick="addRep(${si})" class="text-xs text-blue-600 font-medium">＋ 新增</button><button onclick="rmSecTable(${si}, 'repairRecords')" class="text-xs text-red-500 font-medium ml-3 flex items-center gap-1 hover:text-red-700"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> 刪除表格</button></div><div class="overflow-x-auto rounded-lg border border-slate-200"><table class="data-table w-full text-xs min-w-[560px]"><thead><tr><th>供應商</th><th>返修單位</th><th>返修日</th><th>追蹤號</th><th>異常類型</th><th>品名</th><th>數量</th><th></th></tr></thead><tbody>${(records||[]).map((r,ri)=>`<tr><td><input value="${xe(r.supplierName||'')}" onchange="uRep(${si},${ri},'supplierName',this.value)"></td><td><input value="${xe(r.repairUnit||'')}" onchange="uRep(${si},${ri},'repairUnit',this.value)"></td><td><input type="date" value="${xe(r.repairDate||'')}" onchange="uRep(${si},${ri},'repairDate',this.value)"></td><td><input value="${xe(r.trackingNumber||'')}" onchange="uRep(${si},${ri},'trackingNumber',this.value)"></td><td><input value="${xe(r.faultType||'')}" onchange="uRep(${si},${ri},'faultType',this.value)"></td><td><input value="${xe(r.faultModel||'')}" onchange="uRep(${si},${ri},'faultModel',this.value)"></td><td><input type="number" value="${r.quantity||''}" style="width:55px" onchange="uRep(${si},${ri},'quantity',parseInt(this.value)||0)"></td><td><button onclick="rmRep(${si},${ri})" class="bic d"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`).join('')}</tbody></table></div></div>`;}function bldPT(items,si){return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">漲價料件</p><button onclick="addPrc(${si})" class="text-xs text-blue-600 font-medium">＋ 新增</button><button onclick="rmSecTable(, \'priceChangeItems\')" class="text-xs text-red-500 font-medium ml-3 flex items-center gap-1 hover:text-red-700"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> 刪除表格</button></div><div class="overflow-x-auto rounded-lg border border-slate-200"><table class="data-table w-full text-xs"><thead><tr><th>供應商</th><th>品號</th><th>品名/說明</th><th></th></tr></thead><tbody>${(items||[]).map((it,ri)=>`<tr><td><input value="${xe(it.supplierName||'')}" onchange="uPrc(${si},${ri},'supplierName',this.value)"></td><td><input value="${xe(it.partNumber||'')}" onchange="uPrc(${si},${ri},'partNumber',this.value)"></td><td><input value="${xe(it.description||'')}" onchange="uPrc(${si},${ri},'description',this.value)"></td><td><button onclick="rmPrc(${si},${ri})" class="bic d"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`).join('')}</tbody></table></div></div>`;}function bldFiles(sec,si){const files=sec.files||[];return`<div class="mt-3 pt-3 border-t border-slate-100"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">📎 附件</p>${files.map((f,fi)=>`<div class="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 mb-1.5 text-xs"><span class="text-slate-400">📄</span><input class="flex-1 bg-transparent border-none outline-none text-blue-600 font-medium text-xs" value="${xe(f.fileName||'')}" onchange="uFile(${si},${fi},'fileName',this.value)"><button onclick="rmFile(${si},${fi})" class="text-red-400 hover:text-red-600">🗑️</button></div>`).join('')}<label class="inline-flex items-center gap-1.5 mt-1 text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium"><span>＋ 上傳附件</span><input type="file" class="hidden" onchange="upFile(this,${si})"></label><span class="text-[11px] text-slate-400 ml-2">最大 20MB</span></div>`;}function renderFBL(){const c=document.getElementById('fll');if(!S.fbs.length){c.innerHTML='<p style="color:var(--morandi-subtle);font-size:.8rem;text-align:center;padding:1rem 0">目前尚無回饋項目</p>';return;}c.innerHTML=S.fbs.map(item=>`<div class="feedback-item"><div>${item.isCompleted?`<div class="fi-done"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7a9e84" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>`:'<div class="fi-pend"></div>'}</div><div class="flex-1 min-w-0"><p style="font-size:.85rem;color:var(--morandi-text);font-weight:500;line-height:1.5">${xe(item.item)}</p>${!item.isCompleted&&item.reason?`<span class="fb-reason">${xe(item.reason)}</span>`:''}<p style="font-size:.72rem;color:var(--morandi-subtle);margin-top:.25rem">${fmtD(item.createdAt)}</p></div><button onclick="rmFB('${item.id}')" class="bic d flex-shrink-0"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>`).join('');}function fc(){if(!S.cur)return;S.dirty=true;S.cur.id=document.getElementById('f-id').value.trim();S.cur.publishDate=document.getElementById('f-pd').value;S.cur.periodStart=document.getElementById('f-ps').value;S.cur.periodEnd=document.getElementById('f-pe').value;S.cur.title=document.getElementById('f-ti').value.trim();S.cur.isPinned=document.getElementById('f-pin').checked;}async function saveDraft(){if(!S.cur)return;fc();document.getElementById('btn-dft').disabled=true;try{await DS.save(S.cur.id,{...S.cur,status:'draft',feedbackLog:S.fbs});S.dirty=false;const sb=document.getElementById('tb-status');sb.className='bdg-dft';sb.textContent='草稿';toast('草稿已儲存 ✓','ok');S.mmap=await DS.getMonths();renderSB();}catch(e){toast('儲存失敗：'+e.message,'er');}finally{document.getElementById('btn-dft').disabled=false;}}async function pubBulletin(){if(!S.cur)return;if(!confirm('確定要正式發布？'))return;fc();const pt=document.getElementById('pub-txt'),ps=document.getElementById('pub-spn'),btn=document.getElementById('btn-pub');btn.disabled=true;pt.textContent='發布中...';ps.classList.remove('hidden');try{const d={...S.cur,status:'published',feedbackLog:S.fbs};await DS.save(d.id,d);await NS.notify(d);S.dirty=false;const sb=document.getElementById('tb-status');sb.className='bdg-pub';sb.textContent='已發布';toast('🎉 週報已正式發布！','ok');S.mmap=await DS.getMonths();renderSB();}catch(e){toast('發布失敗：'+e.message,'er');}finally{btn.disabled=false;pt.textContent='正式發布';ps.classList.add('hidden');}}async function cloneBulletin(){if(!S.cur)return;const c=JSON.parse(JSON.stringify(S.cur));const now=new Date();c.id=`${now.getFullYear()}-W${wk(now)}-copy`;c.status='draft';c.version=1;c.isPinned=false;S.cur=c;S.fbs=[];S.dirty=true;renderEd();toast(`已複製為新草稿：${c.id}`,'in');}async function delBulletin(){if(!S.cur)return;if(!confirm(`確定刪除「${S.cur.id}」？`))return;try{await DS.del(S.cur.id);S.cur=null;S.dirty=false;document.getElementById('es').classList.remove('hidden');document.getElementById('bf').classList.add('hidden');document.getElementById('tb-acts').classList.add('hidden');document.getElementById('tb-title').textContent='請選擇或新增週報';document.getElementById('tb-status').classList.add('hidden');S.mmap=await DS.getMonths();renderSB();toast('週報已刪除','ok');}catch(e){toast('刪除失敗：'+e.message,'er');}}function showModal(){document.getElementById('sm').classList.remove('hidden');document.getElementById('tl').innerHTML=S.tpls.map(t=>`<button onclick="addTpl('${t.id}')" class="w-full text-left px-4 py-2.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all flex items-center gap-3 text-sm mb-1.5"><span class="text-xl">${t.i}</span><span class="font-medium text-slate-700">${t.t}</span></button>`).join('');}function hideModal(){document.getElementById('sm').classList.add('hidden');}function addTpl(tid){
  const t=S.tpls.find(tp=>tp.id===tid);
  if(!t)return;
  const i=(S.cur.sections||[]).length;
  if(!S.cur.sections)S.cur.sections=[];
  const sec = {
    id:`s${i+1}-${Date.now()}`,
    sectionNumber:NUMS[i]||String(i+1),
    title:t.t,
    icon:t.i
  };
  if(t.hi) sec.items = [];
  if(t.hs) sec.subsections = [];
  if(t.hao) sec.affectedOrders = [];
  if(t.hr) sec.repairRecords = [];
  if(t.hp) sec.priceChangeItems = [];
  if(t.hf) sec.files = [];
  S.cur.sections.push(sec);
  S.dirty=true;
  hideModal();
  renderSecs();
}function addCustomSec(){const title=document.getElementById('ct').value.trim(),icon=document.getElementById('ci').value.trim()||'📝';if(!title){toast('請輸入段落標題','er');return;}const i=(S.cur.sections||[]).length;if(!S.cur.sections)S.cur.sections=[];S.cur.sections.push({id:`s${i+1}-${Date.now()}`,sectionNumber:NUMS[i]||String(i+1),title,icon,items:[]});S.dirty=true;hideModal();renderSecs();}function uSec(si,f,v){S.cur.sections[si][f]=v;S.dirty=true;}function sTitleSel(si,v){const ci=document.getElementById(`cti-${si}`);if(v==='__c__'){ci&&ci.classList.remove('hidden');}else{ci&&ci.classList.add('hidden');S.cur.sections[si].title=v;S.cur.sections[si].subtitle='';const c=S.keywords.find(tp=>tp.name===v);if(c)S.cur.sections[si].icon='📋';S.dirty=true;}renderSecs();}function rmSec(si){if(!confirm('確定移除？'))return;S.cur.sections.splice(si,1);S.dirty=true;renderSecs();}function mvUp(si){if(si===0)return;const s=S.cur.sections;[s[si-1],s[si]]=[s[si],s[si-1]];S.dirty=true;renderSecs();}function mvDn(si){const s=S.cur.sections;if(si>=s.length-1)return;[s[si],s[si+1]]=[s[si+1],s[si]];S.dirty=true;renderSecs();}function addItm(si){if(!S.cur.sections[si].items)S.cur.sections[si].items=[];S.cur.sections[si].items.push({id:`i-${Date.now()}`,content:'',priority:'normal'});S.dirty=true;renderSecs();}function rmItm(si,ii){S.cur.sections[si].items.splice(ii,1);S.dirty=true;renderSecs();}function uItm(si,ii,f,v){S.cur.sections[si].items[ii][f]=v;S.dirty=true;}function addSub(si){if(!S.cur.sections[si].subsections)S.cur.sections[si].subsections=[];const idx=S.cur.sections[si].subsections.length;S.cur.sections[si].subsections.push({id:`sub-${Date.now()}`,subsectionNumber:String(idx+1),title:'',items:[]});S.dirty=true;renderSecs();}function rmSub(si,sbi){S.cur.sections[si].subsections.splice(sbi,1);S.dirty=true;renderSecs();}function uSub(si,sbi,f,v){S.cur.sections[si].subsections[sbi][f]=v;S.dirty=true;}function addSI(si,sbi){if(!S.cur.sections[si].subsections[sbi].items)S.cur.sections[si].subsections[sbi].items=[];S.cur.sections[si].subsections[sbi].items.push({id:`si-${Date.now()}`,content:'',priority:'normal'});S.dirty=true;renderSecs();}function rmSI(si,sbi,ii){S.cur.sections[si].subsections[sbi].items.splice(ii,1);S.dirty=true;renderSecs();}function uSI(si,sbi,ii,f,v){S.cur.sections[si].subsections[sbi].items[ii][f]=v;S.dirty=true;}function addRow(si,field){if(!S.cur.sections[si][field])S.cur.sections[si][field]=[];S.cur.sections[si][field].push({supplierName:'',poNumber:'',lineNumber:'',partNumber:'',itemName:'',quantity:0,originalDelivery:'',newDelivery:'',warehouseName:''});S.dirty=true;renderSecs();}function rmRow(si,field,ri){S.cur.sections[si][field].splice(ri,1);S.dirty=true;renderSecs();}function uRow(si,field,ri,col,v){S.cur.sections[si][field][ri][col]=v;S.dirty=true;}function addRep(si){if(!S.cur.sections[si].repairRecords)S.cur.sections[si].repairRecords=[];S.cur.sections[si].repairRecords.push({supplierName:'',repairUnit:'',repairDate:'',trackingNumber:'',faultType:'',faultModel:'',quantity:0});S.dirty=true;renderSecs();}function rmRep(si,ri){S.cur.sections[si].repairRecords.splice(ri,1);S.dirty=true;renderSecs();}function uRep(si,ri,f,v){S.cur.sections[si].repairRecords[ri][f]=v;S.dirty=true;}function addPrc(si){if(!S.cur.sections[si].priceChangeItems)S.cur.sections[si].priceChangeItems=[];S.cur.sections[si].priceChangeItems.push({supplierName:'',partNumber:'',description:''});S.dirty=true;renderSecs();}function rmPrc(si,ri){S.cur.sections[si].priceChangeItems.splice(ri,1);S.dirty=true;renderSecs();}function uPrc(si,ri,f,v){S.cur.sections[si].priceChangeItems[ri][f]=v;S.dirty=true;}function uFile(si,fi,f,v){S.cur.sections[si].files[fi][f]=v;S.dirty=true;}function rmFile(si,fi){if(!confirm('確定移除？'))return;S.cur.sections[si].files.splice(fi,1);S.dirty=true;renderSecs();}async function upFile(el,si){
  const file=el.files[0];if(!file)return;
  if(file.size>20*1024*1024){toast('超過 20MB 限制','er');return;}
  const label = el.parentElement;
  const originalHTML = label.innerHTML;
  label.innerHTML = `<span class="text-slate-400 font-medium animate-pulse">⏳ 上傳中...</span>`;
  try {
    const res = await DS.uploadAttachment(S.cur.id, file);
    if(!S.cur.sections[si].files)S.cur.sections[si].files=[];
    S.cur.sections[si].files.push({fileName:res.fileName,url:res.url});
    S.dirty=true;
    renderSecs();
    toast(`已上傳：${file.name}`,'ok');
  } catch (e) {
    toast(`上傳失敗: ${e.message}`,'er');
    label.innerHTML = originalHTML;
  }
}function addFB(){const item=document.getElementById('fn-item').value.trim(),done=document.getElementById('fn-done').checked,reason=document.getElementById('fn-rsn').value.trim();if(!item){toast('請輸入調整項目說明','er');return;}S.fbs.push({id:`fb-${Date.now()}`,item,isCompleted:done,reason:done?null:(reason||null),createdAt:new Date().toISOString()});document.getElementById('fn-item').value='';document.getElementById('fn-done').checked=false;document.getElementById('fn-rsn').value='';S.dirty=true;renderFBL();}function rmFB(id){S.fbs=S.fbs.filter(f=>f.id!==id);S.dirty=true;renderFBL();}async function pubBulletin(){if(!S.cur)return;if(!confirm('確定要正式發布？'))return;fc();const pt=document.getElementById('pub-txt'),ps=document.getElementById('pub-spn'),btn=document.getElementById('btn-pub');btn.disabled=true;pt.textContent='發布中...';ps.classList.remove('hidden');try{const d={...S.cur,status:'published',feedbackLog:S.fbs};await DS.save(d.id,d);await NS.notify(d);await DS.addAuditLog(d.id, `管理員發布了週報通知信給相關同仁。`);S.dirty=false;const sb=document.getElementById('tb-status');sb.className='bdg-pub';sb.textContent='已發布';toast('🎉 週報已正式發布！','ok');S.mmap=await DS.getMonths();renderSB();renderAuditLogs(d.id);}catch(e){toast('發布失敗：'+e.message,'er');}finally{btn.disabled=false;pt.textContent='正式發布';ps.classList.add('hidden');}}function xe(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}function fmtD(iso){try{return new Date(iso).toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});}catch(e){return iso;}}function toast(msg,type){const c=document.getElementById('tc'),icons={ok:'✅',er:'❌',in:'ℹ️'};const el=document.createElement('div');el.className=`toast t-${type}`;el.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;c.appendChild(el);setTimeout(()=>{el.style.cssText='opacity:0;transform:translateX(20px);transition:all .3s';setTimeout(()=>el.remove(),300);},3500);}window.addEventListener('beforeunload',e=>{if(S.dirty){e.preventDefault();e.returnValue='';}});
function showAchievements() {
  document.getElementById('am').classList.remove('hidden');
}
function hideAchievements() {
  document.getElementById('am').classList.add('hidden');
}

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

let editWLIndex = null;
async function addWL() {
  const n = document.getElementById('wl-name').value.trim();
  const e = document.getElementById('wl-email').value.trim();
  const region = document.getElementById('wl-region').value;
  const receiveEmail = document.getElementById('wl-receive').checked;
  if(!n || !e) return toast('姓名與信箱必填', 'er');
  if (editWLIndex !== null) {
    S.whitelist[editWLIndex] = {name: n, email: e, region, receiveEmail};
    editWLIndex = null;
    document.getElementById('wl-btn').innerText = '新增';
    toast('已更新名單', 'ok');
  } else {
    S.whitelist.push({name: n, email: e, region, receiveEmail});
    toast('已新增名單', 'ok');
  }
  await DS.saveWhitelist(S.whitelist); renderWL();
  document.getElementById('wl-name').value=''; 
  document.getElementById('wl-email').value='';
  document.getElementById('wl-region').value='';
  document.getElementById('wl-receive').checked=true;
}
function editWL(idx) {
  editWLIndex = idx;
  document.getElementById('wl-name').value = S.whitelist[idx].name || '';
  document.getElementById('wl-email').value = S.whitelist[idx].email || '';
  document.getElementById('wl-region').value = S.whitelist[idx].region || '';
  document.getElementById('wl-receive').checked = (S.whitelist[idx].receiveEmail !== false);
  document.getElementById('wl-btn').innerText = '儲存';
  document.getElementById('wl-name').focus();
}
async function rmWL(idx) { 
  if(!confirm(`確定要刪除 ${S.whitelist[idx].name} 嗎？`)) return;
  S.whitelist.splice(idx, 1); await DS.saveWhitelist(S.whitelist); renderWL(); 
}
let isBatchMode = false;
let selectedWL = [];

function toggleBatchMode() {
  isBatchMode = !isBatchMode;
  selectedWL = [];
  const btn = document.getElementById('btn-batch-mode');
  const acts = document.getElementById('batch-actions');
  if(isBatchMode) {
    btn.classList.replace('bg-slate-100', 'bg-blue-600');
    btn.classList.replace('text-slate-600', 'text-white');
    btn.classList.replace('hover:bg-slate-200', 'hover:bg-blue-700');
    if(acts) acts.classList.remove('hidden');
  } else {
    btn.classList.replace('bg-blue-600', 'bg-slate-100');
    btn.classList.replace('text-white', 'text-slate-600');
    btn.classList.replace('hover:bg-blue-700', 'hover:bg-slate-200');
    if(acts) acts.classList.add('hidden');
  }
  renderWL();
}

function toggleWLCb(email, checked) {
  if (checked) {
    if(!selectedWL.includes(email)) selectedWL.push(email);
  } else {
    selectedWL = selectedWL.filter(e => e !== email);
  }
}

async function batchDeleteWL() {
  if(selectedWL.length === 0) return toast('請先勾選名單', 'er');
  if(!confirm(`確定要刪除選取的 ${selectedWL.length} 筆名單嗎？`)) return;
  S.whitelist = S.whitelist.filter(w => !selectedWL.includes(w.email));
  await DS.saveWhitelist(S.whitelist);
  selectedWL = [];
  renderWL();
  toast('已批次刪除', 'ok');
}

function openBatchGroupModal() {
  if(selectedWL.length === 0) return toast('請先勾選名單', 'er');
  document.getElementById('batch-group-modal').classList.remove('hidden');
  const c = document.getElementById('batch-group-list');
  if(S.mailGroups.length === 0) {
    c.innerHTML = '<p class="text-sm text-slate-500">目前尚無任何群組，請先到「發信群組管理」建立。</p>';
    return;
  }
  c.innerHTML = S.mailGroups.map(g => `
    <label class="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer border border-slate-100 transition-colors">
      <input type="checkbox" class="batch-grp-cb w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500" value="${g.id}">
      <span class="text-sm font-semibold text-slate-700">${g.name} <span class="text-xs text-slate-400 font-normal ml-1">(${g.emails.length} 人)</span></span>
    </label>
  `).join('');
}

function closeBatchGroupModal() {
  document.getElementById('batch-group-modal').classList.add('hidden');
}

async function confirmBatchAddGroup() {
  const cbs = document.querySelectorAll('.batch-grp-cb:checked');
  if(cbs.length === 0) return toast('請勾選至少一個群組', 'er');
  
  const targetGroupIds = Array.from(cbs).map(cb => cb.value);
  let changed = false;
  
  S.mailGroups.forEach(g => {
    if (targetGroupIds.includes(g.id)) {
      selectedWL.forEach(email => {
        if(!g.emails.includes(email)) {
          g.emails.push(email);
          changed = true;
        }
      });
    }
  });
  
  if (changed) {
    await DS.saveMailGroups(S.mailGroups);
    toast(`成功將 ${selectedWL.length} 人加入到 ${targetGroupIds.length} 個群組！`, 'ok');
  } else {
    toast('選取的人員皆已在目標群組中', 'in');
  }
  
  closeBatchGroupModal();
  toggleBatchMode(); // exit batch mode
}

function renderWL() {
  const c = document.getElementById('wl-list');
  const searchEl = document.getElementById('wl-search');
  const regionEl = document.getElementById('wl-filter-region');
  const kw = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const regionKw = regionEl ? regionEl.value : '';
  
  let list = S.whitelist;
  if(regionKw) {
    list = list.filter(w => w.region === regionKw);
  }
  if(kw) {
    list = list.filter(w => w.name.toLowerCase().includes(kw) || w.email.toLowerCase().includes(kw));
  }
  
  if (list.length === 0) {
    c.innerHTML = '<div class="text-center text-slate-400 mt-10 text-sm">找不到符合條件的名單</div>';
    return;
  }
  
  c.innerHTML = list.map((w) => {
    const origIdx = S.whitelist.findIndex(x => x.email === w.email);
    const regionBadge = w.region ? `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">${w.region}</span>` : '';
    const receiveBadge = (w.receiveEmail !== false) ? `<span class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600 border border-green-100">✉️</span>` : `<span class="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-slate-400 border border-slate-100" title="不收信">🔕</span>`;
    return `
      <div class="flex items-center gap-3 p-3 mb-2 bg-white rounded-lg border border-slate-200 hover:border-blue-200 transition-colors">
        ${isBatchMode ? `
          <input type="checkbox" onchange="toggleWLCb('${w.email}', this.checked)" class="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500" ${selectedWL.includes(w.email) ? 'checked' : ''}>
        ` : ''}
        <div class="flex-1 min-w-0">
          <div class="font-medium text-slate-800 text-sm truncate flex items-center">${w.name}${regionBadge}${receiveBadge}</div>
          <div class="text-xs text-slate-500 truncate">${w.email}</div>
        </div>
        ${!isBatchMode ? `
          <div class="flex gap-1 flex-shrink-0">
            <button onclick="editWL(${origIdx})" class="text-blue-500 hover:bg-blue-50 p-1.5 rounded" title="修改"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
            <button onclick="rmWL(${origIdx})" class="text-red-500 hover:bg-red-50 p-1.5 rounded" title="刪除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// Override original pubBulletin to show modal instead
async function pubBulletin() {
  if(!S.cur) return;
  document.getElementById('pub-modal').classList.remove('hidden');

  // Render group buttons
  const gb = document.getElementById('pub-group-buttons');
  if (gb) {
    if (S.mailGroups.length > 0) {
      gb.innerHTML = '<span class="text-xs font-semibold text-blue-800 mr-2">群組快選：</span>' + S.mailGroups.map(g => `
        <button onclick="selectPubGroup('${g.id}')" class="px-2.5 py-1 bg-white border border-blue-200 text-blue-600 text-xs rounded hover:bg-blue-50 font-medium transition-colors mb-1 mr-1 shadow-sm">${xe(g.name)}</button>
      `).join('');
    } else {
      gb.innerHTML = '<span class="text-xs font-semibold text-slate-400">目前尚無群組，可於設定中心建立</span>';
    }
  }

  document.getElementById('pub-wl-all').checked = true;
  const c = document.getElementById('pub-wl-list');
  c.innerHTML = S.whitelist.map((w, i) => `
    <label class="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer border border-slate-100 transition-colors">
      <input type="checkbox" class="pub-wl-cb w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500" value="${w.email}" checked data-email="${w.email}">
      <div class="flex flex-col"><span class="text-sm font-semibold text-slate-700">${w.name}</span><span class="text-xs text-slate-400 mt-0.5">${w.email}</span></div>
    </label>
  `).join('');
}

function selectPubGroup(groupId) {
  const g = S.mailGroups.find(x => x.id === groupId);
  if (!g) return;
  const groupEmailsLower = g.emails.map(e => (e || '').toLowerCase());
  document.querySelectorAll('.pub-wl-cb').forEach(cb => {
    if (groupEmailsLower.includes((cb.dataset.email || '').toLowerCase())) {
      cb.checked = true;
    }
  });
  // Check if all are selected now
  const allCbs = document.querySelectorAll('.pub-wl-cb');
  const allChecked = Array.from(allCbs).every(cb => cb.checked);
  document.getElementById('pub-wl-all').checked = allChecked;
}

function renderPubWLList() {
  const q = document.getElementById('pub-search-input')?.value.trim().toLowerCase() || '';
  const labels = document.querySelectorAll('#pub-wl-list label');
  labels.forEach(lbl => {
    const text = lbl.innerText.toLowerCase();
    if (text.includes(q)) {
      lbl.style.display = 'flex';
    } else {
      lbl.style.display = 'none';
    }
  });
}

function hidePubModal() { document.getElementById('pub-modal').classList.add('hidden'); }
function toggleAllWL(checked) {
  document.querySelectorAll('.pub-wl-cb').forEach(cb => cb.checked = checked);
}

async function confirmPubBulletin() {
  if(!S.cur) return;
  const cbs = document.querySelectorAll('.pub-wl-cb:checked');
  const selectedEmails = Array.from(cbs).map(cb => cb.value);
  if (selectedEmails.length === 0 && !confirm('您沒有勾選任何收件人，確定要繼續發布且不寄出通知信嗎？')) return;
  
  fc(); 
  const btn=document.getElementById('btn-pub-confirm');
  btn.disabled=true; btn.textContent='發布中...';
  try {
    const d={...S.cur, status:'published', feedbackLog:S.fbs};
    
    // Save authorizedEmails for access control
    d.authorizedEmails = selectedEmails;
    
    await DS.save(d.id,d);
    await DS.addAuditLog(d.id, '管理員正式發布了週報（並發送郵件通知）。');
    
    // 自訂發送名單
    if (selectedEmails.length > 0 && typeof emailjs !== 'undefined') {
      const emailRecipients = selectedEmails.filter(email => {
        const w = S.whitelist.find(x => x.email === email);
        return !w || w.receiveEmail !== false;
      });
      const toList = emailRecipients.join(',');
      
      // 處理必讀公告
      let mustReadText = '';
      const mustReadCb = document.getElementById('pub-must-read');
      if (mustReadCb && mustReadCb.checked) {
        let importantItems = [];
        (d.sections || []).forEach(sec => {
          (sec.items || []).forEach(item => {
            if (item.priority === 'high' && item.content) {
              let plain = item.content.replace(/<\/(p|div|h[1-6])>/gi, '<br>').replace(/<img[^>]+src="([^">]+)"[^>]*>/gi, '|||IMG_$1|||').replace(/<br\s*\/?>/gi, '|||BR|||').replace(/<[^>]+>/g, '').replace(/\|\|\|IMG_([^|]+)\|\|\|/g, '<br><img src="$1" style="max-width: 100%; max-height: 400px; display: block; margin: 10px 0; border-radius: 4px;"><br>').replace(/\|\|\|BR\|\|\|/g, '<br>').trim();
              if(plain) importantItems.push(plain);
            }
          });
          (sec.subsections || []).forEach(sub => {
            (sub.items || []).forEach(item => {
              if (item.priority === 'high' && item.content) {
                let plain = item.content.replace(/<\/(p|div|h[1-6])>/gi, '<br>').replace(/<img[^>]+src="([^">]+)"[^>]*>/gi, '|||IMG_$1|||').replace(/<br\s*\/?>/gi, '|||BR|||').replace(/<[^>]+>/g, '').replace(/\|\|\|IMG_([^|]+)\|\|\|/g, '<br><img src="$1" style="max-width: 100%; max-height: 400px; display: block; margin: 10px 0; border-radius: 4px;"><br>').replace(/\|\|\|BR\|\|\|/g, '<br>').trim();
                if(plain) importantItems.push(plain);
              }
            });
          });
        });
        if (importantItems.length > 0) {
          mustReadText = '⭐ 【本週必讀重點】<br><br>' + importantItems.map(i => '• ' + i).join('<br><br>');
        }
      }

      if (toList) {
        await emailjs.send(emailjsConfig.serviceId, emailjsConfig.templateId, {
          to_email: toList,
        subject: '【採購週報上線】' + d.title,
        bulletin_title: d.title || '無標題',
        publish_date: d.publishDate || '',
        message: '新版採購週報已上線，請點擊連結查看。',
        link: window.location.href.replace('admin.html', 'index.html') + '?id=' + d.id,
        must_read_text: mustReadText
        });
      }
    }
    
    S.dirty=false;
    const sb=document.getElementById('tb-status'); sb.className='bdg-pub'; sb.textContent='已發布';
    document.getElementById('btn-unpub').classList.remove('hidden');
    document.getElementById('btn-pub').classList.add('hidden');
    toast('🎉 週報已正式發布並寄出通知信！', 'ok');
    S.mmap = await DS.getMonths();
    renderSB();
    hidePubModal();
  } catch(e) { toast('發布失敗：'+e.message,'er'); } 
  finally { btn.disabled=false; btn.textContent='確認發布並寄信'; }
}

function showGuide() {
  document.getElementById('guide-modal').classList.remove('hidden');
}
function hideGuide() {
  document.getElementById('guide-modal').classList.add('hidden');
}

// --- Handover Settings ---
async function loadHandoverConfig() {
  try {
    const snap = await db.collection('bulletins').doc('config_handover').get();
    if(snap.exists) {
      const data = snap.data();
      document.getElementById('ho-pwd').value = data.secretCode || 'sunny';
      document.getElementById('ho-name').value = (data.contact && data.contact.name) || 'Sunny Ting 丁美云';
      document.getElementById('ho-tel').value = (data.contact && data.contact.tel) || '+886-2-8978-5094';
      document.getElementById('ho-email').value = (data.contact && data.contact.email) || 'sunnyting@youbike.com.tw';
      document.getElementById('ho-addr').value = (data.contact && data.contact.address) || '105403 台北市松山區民生東路三段138號10樓';
    } else {
      document.getElementById('ho-pwd').value = 'sunny';
      document.getElementById('ho-name').value = 'Sunny Ting 丁美云';
      document.getElementById('ho-tel').value = '+886-2-8978-5094';
      document.getElementById('ho-email').value = 'sunnyting@youbike.com.tw';
      document.getElementById('ho-addr').value = '105403 台北市松山區民生東路三段138號10樓';
    }
  } catch(e) { console.error('Load config error', e); }
}

async function showHandover() {
  document.getElementById('handover-modal').classList.remove('hidden');
  await loadHandoverConfig();
}

function hideHandover() {
  document.getElementById('handover-modal').classList.add('hidden');
}

async function saveHandover() {
  const contact = {
    name: document.getElementById('ho-name').value.trim() || 'Sunny Ting 丁美云',
    tel: document.getElementById('ho-tel').value.trim() || '+886-2-8978-5094',
    email: document.getElementById('ho-email').value.trim() || 'sunnyting@youbike.com.tw',
    address: document.getElementById('ho-addr').value.trim() || '105403 台北市松山區民生東路三段138號10樓'
  };

  const btn = document.getElementById('btn-save-ho');
  btn.disabled = true;
  btn.textContent = '儲存中...';

  try {
    const payload = {
      status: 'deleted',
      contact: contact
    };

    await db.collection('bulletins').doc('config_handover').set(payload, { merge: true });
    toast('交接設定已儲存', 'ok');
    hideHandover();
  } catch(e) {
    toast('儲存失敗: ' + e.message, 'er');
  } finally {
    btn.disabled = false;
    btn.textContent = '儲存設定';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user && (user.email.endsWith('@youbike.com.tw') || ADMIN_EMAILS.includes(user.email))) {
      const snap = await db.collection('systemConfig').doc('admins').get();
      const adminList = snap.exists ? (snap.data().list || []) : [];
      if (adminList.some(a => a.email === user.email) || ADMIN_EMAILS.includes(user.email)) {
        document.getElementById('lo').style.display = 'none';
        await init();
      } else {
        document.getElementById('lo').style.display = 'flex';
      }
    } else {
      document.getElementById('lo').style.display = 'flex';
    }
  });
});
