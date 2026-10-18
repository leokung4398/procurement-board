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

function sanitizeTablesForFirestore(obj) {
  if (!obj) return;
  if (Array.isArray(obj)) {
    obj.forEach(sanitizeTablesForFirestore);
  } else if (typeof obj === 'object') {
    if (obj.table && Array.isArray(obj.table.rows)) {
      obj.table.rows = obj.table.rows.map(r => Array.isArray(r) ? { c: r } : r);
    }
    Object.values(obj).forEach(sanitizeTablesForFirestore);
  }
}

function restoreTablesFromFirestore(obj) {
  if (!obj) return;
  if (Array.isArray(obj)) {
    obj.forEach(restoreTablesFromFirestore);
  } else if (typeof obj === 'object') {
    if (obj.table && Array.isArray(obj.table.rows)) {
      obj.table.rows = obj.table.rows.map(r => Array.isArray(r) ? r : (r && r.c ? r.c : (r && r.cols ? r.cols : [])));
    }
    Object.values(obj).forEach(restoreTablesFromFirestore);
  }
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
        const b = docSnap.data();
        if (b.isConfidential) {
          try {
            const p = await db.collection('bulletins').doc(id).collection('private').doc('content').get();
            if (p.exists) b.sections = p.data().sections || [];
            else b.sections = [];
          } catch(e) {
            b.sections = [];
          }
        }
        restoreTablesFromFirestore(b);
        return b;
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
      sanitizeTablesForFirestore(cleanData);
      
            if (cleanData.isConfidential) {
          const secData = cleanData.sections || [];
          cleanData.sections = []; 
          await docRef.set(cleanData, { merge: true });
          await docRef.collection('private').doc('content').set({
              sections: secData,
              authorizedEmails: cleanData.authorizedEmails || []
          });
      } else {
          await docRef.set(cleanData, { merge: true });
      }
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
      { id: 't1', t: '一、採購管理', i: '📋', hi: true },
      { id: 't2', t: '二、供應商管理', i: '🤝', hi: true },
      { id: 't3', t: '三、品質管理', i: '🔧', hi: true },
      { id: 't4', t: '四、工程管理', i: '⚙️', hi: true },
      { id: 't5', t: '五、物流管理', i: '🚚', hi: true },
      { id: 't6', t: '六、倉儲管理', i: '📦', hi: true },
      { id: 't7', t: '七、文件管理', i: '📁', hi: true, hf: true },
      { id: 't8', t: '八、公告管理', i: '📢', hi: true },
      { id: 't9', t: '九、其他', i: '📝', hi: true }
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
        if (data.readAt) {
          try {
            data.readAt = typeof data.readAt.toDate === 'function' ? data.readAt.toDate().toLocaleString('zh-TW') : new Date(data.readAt).toLocaleString('zh-TW');
          } catch(e) { data.readAt = String(data.readAt); }
        }
        if (data.lastViewedAt) {
          try {
            data.lastViewedAt = typeof data.lastViewedAt.toDate === 'function' ? data.lastViewedAt.toDate().toLocaleString('zh-TW') : new Date(data.lastViewedAt).toLocaleString('zh-TW');
          } catch(e) { data.lastViewedAt = String(data.lastViewedAt); }
        }
        data.readProgress = typeof data.readProgress === 'number' ? data.readProgress : 100;
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
    if (!this.isConfigured() || !bulletinId) return;
    try {
      const user = firebase.auth().currentUser;
      const email = (user && user.email) ? user.email.toLowerCase().trim() : '';

      // 排除測試人員 (Leo Kung 孔令淳)，避免測試操作污染正式稽核日誌
      const isTestUser = email === 'leokung@youbike.com.tw' || 
                         email === 'gb4398@giantcycling.com' ||
                         (user && user.displayName && user.displayName.includes('孔令淳'));
      if (isTestUser) {
        console.log('[AuditLog] 測試人員 (Leo Kung) 操作，略過日誌寫入以防污染正式稽核紀錄。');
        return;
      }

      // 動態解析操作者中文姓名與身分
      let senderInfo = '系統';
      if (user) {
        let adminMatch = null;
        if (typeof S !== 'undefined' && Array.isArray(S.admins)) {
          adminMatch = S.admins.find(a => a.email && a.email.toLowerCase().trim() === email);
        }
        if (!adminMatch && typeof S !== 'undefined' && Array.isArray(S.whitelist)) {
          adminMatch = S.whitelist.find(w => w.email && w.email.toLowerCase().trim() === email);
        }
        if (adminMatch && adminMatch.name) {
          senderInfo = adminMatch.name;
        } else if (user.displayName) {
          senderInfo = user.displayName;
        } else if (email) {
          senderInfo = email.split('@')[0];
        }
      }

      await db.collection('bulletins').doc(bulletinId).collection('audit_logs').add({
        action: actionDesc,
        sender: senderInfo,
        senderEmail: email || null,
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
          ${filteredMmap[mk].map(b => {
            const isAct = S.cur?.id === b.id;
            const isHid = !!b.isHidden;
            const isRestricted = b.audienceType === 'custom' || (b.authorizedEmails && b.authorizedEmails.length > 0 && b.audienceType !== 'all');
            let badge = '';
            if (isHid) {
              badge += '<span class="ml-1 text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded font-bold">隱藏</span>';
            } else if (isRestricted) {
              badge += '<span class="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.2 rounded font-bold">限定</span>';
            }
            return `<button class="sb-bb ${isAct ? 'act' : ''} flex items-center justify-between" onclick="loadB('${b.id}')"><span class="truncate">${b.id}</span><span>${badge}</span></button>`;
          }).join('')}
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
    
    let allUsers = S.whitelist || [];
    if (allUsers.length === 0) {
      allUsers = await DS.getWhitelist();
      S.whitelist = allUsers;
    }

    const b = S.cur && S.cur.id === id ? S.cur : await DS.getById(id);
    const targetEmails = (b && b.authorizedEmails && b.authorizedEmails.length > 0) 
      ? b.authorizedEmails 
      : allUsers.map(u => u.email);
    
    const targetEmailsLower = targetEmails.map(e => (e || '').trim().toLowerCase());
    
    // 預處理已讀同仁資料，支援多層次寬容匹配
    const readLookup = readers.map(r => {
      const email = (r.email || '').trim().toLowerCase();
      const emailPrefix = email ? email.split('@')[0] : '';
      const name = (r.displayName || '').replace(/[\s\u3000]/g, '').toLowerCase();
      return { email, emailPrefix, name, raw: r };
    });
    
    const unread = allUsers.filter(u => {
      const uEmailLower = (u.email || '').trim().toLowerCase();
      const uPrefix = uEmailLower.split('@')[0];
      const uName = (u.name || '').replace(/[\s\u3000]/g, '').toLowerCase();
      
      const isTarget = targetEmailsLower.includes(uEmailLower);
      if (!isTarget) return false;

      // 多維度匹配檢查：
      // 1. Email 完全相同
      // 2. Email 帳號前綴相同 (例如 rubychen2, janechuang)
      // 3. 姓名相同 (去除空格後)
      // 4. 特殊同音異字相容 (如 吳俊瑋 <-> 吳俊緯)
      const isRead = readLookup.some(r => {
        if (r.email && r.email === uEmailLower) return true;
        if (r.emailPrefix && uPrefix && r.emailPrefix === uPrefix) return true;
        if (r.name && uName && (r.name === uName || r.name.includes(uName) || uName.includes(r.name))) return true;
        if ((uName === '吳俊緯' && r.name.includes('吳俊瑋')) || (uName === '吳俊瑋' && r.name.includes('吳俊緯'))) return true;
        return false;
      });

      return !isRead;
    });

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
              <th class="pb-1.5 font-semibold">登入信箱 (Email)</th>
              <th class="pb-1.5 font-semibold">部門</th>
              <th class="pb-1.5 font-semibold text-center">閱讀完成率</th>
              <th class="pb-1.5 font-semibold">首次閱讀時間</th>
              <th class="pb-1.5 font-semibold">最後閱覽時間</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-50">
            ${readers.map(r => {
              const prog = typeof r.readProgress === 'number' ? r.readProgress : 100;
              let badgeCls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
              if (prog < 50) badgeCls = 'bg-slate-100 text-slate-600 border-slate-200';
              else if (prog < 100) badgeCls = 'bg-amber-50 text-amber-700 border-amber-200';
              
              // 判定是否為主要窗口 (isPrimary)
              const rEmail = (r.email || '').trim().toLowerCase();
              const rName = (r.displayName || '').replace(/[\s\u3000]/g, '').toLowerCase();
              const isPrimaryContact = allUsers.some(u => {
                if (!u.isPrimary) return false;
                const uEmail = (u.email || '').trim().toLowerCase();
                const uName = (u.name || '').replace(/[\s\u3000]/g, '').toLowerCase();
                return (uEmail && uEmail === rEmail) || (uName && (uName === rName || rName.includes(uName)));
              });
              const primaryBadge = isPrimaryContact 
                ? `<span class="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 shadow-sm" title="單位主要窗口">⭐ 主要窗口</span>` 
                : '';

              return `
              <tr class="${isPrimaryContact ? 'bg-amber-50/20' : ''}">
                <td class="py-2 text-slate-700 font-medium flex items-center">${xe(r.displayName)}${primaryBadge}</td>
                <td class="py-2 text-slate-500 font-mono text-xs">${xe(r.email || '-')}</td>
                <td class="py-2 text-slate-500">${xe(r.department)}</td>
                <td class="py-2 text-center">
                  <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${badgeCls}">
                    ${prog === 100 ? '✓ ' : ''}${prog}%
                  </span>
                </td>
                <td class="py-2 text-slate-400 text-xs">${r.readAt}</td>
                <td class="py-2 text-slate-400 text-xs">${r.lastViewedAt}</td>
              </tr>
            `;}).join('')}
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
          ${unread.map(u => {
            const isPrimary = !!u.isPrimary;
            const cls = isPrimary ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold' : 'bg-rose-50 text-rose-600 font-medium';
            const star = isPrimary ? '⭐ ' : '';
            return `<span class="px-2.5 py-1 ${cls} rounded text-xs flex items-center gap-1" title="${xe(u.email)}">${star}${xe(u.name)}${isPrimary ? ' (主要窗口)' : ''}</span>`;
          }).join('')}
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

async function showHandover() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.remove('hidden');
    switchSettingsTab('tab-handover');
  } else {
    // 容錯備援
    const oldModal = document.getElementById('handover-modal');
    if (oldModal) oldModal.classList.remove('hidden');
  }
}

function hideHandover() {
  const oldModal = document.getElementById('handover-modal');
  if (oldModal) oldModal.classList.add('hidden');
  closeSettingsModal();
}

function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  switchSettingsTab('tab-whitelist');
}
function closeSettingsModal() {
  if (kmDirty && !confirm('「關鍵字資料庫」尚有未儲存的修改，確定要直接關閉並放棄變更嗎？')) return;
  kmDirty = false;
  document.getElementById('settings-modal').classList.add('hidden');
}
function switchSettingsTab(t) {
  const curKwTab = document.getElementById('tab-keywords');
  if (t !== 'tab-keywords' && curKwTab && !curKwTab.classList.contains('hidden') && kmDirty) {
    if (!confirm('「關鍵字資料庫」尚有未儲存的修改，確定要離開此分頁並放棄變更嗎？')) return;
    kmDirty = false;
  }
  document.querySelectorAll('.settings-tab-pane').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[id^="btn-tab-"]').forEach(el => el.classList.remove('bg-blue-50', 'text-blue-700', 'font-bold'));
  const tEl = document.getElementById(t), bEl = document.getElementById('btn-'+t);
  if (tEl) tEl.classList.remove('hidden');
  if (bEl) bEl.classList.add('bg-blue-50', 'text-blue-700', 'font-bold');
  if(t==='tab-whitelist')renderWL(); if(t==='tab-groups')renderGroupList(); if(t==='tab-admin')renderAdminList(); if(t==='tab-keywords'){initKeywordTab();} if(t==='tab-handover')loadHandoverConfig();
}
function openAboutModal() { document.getElementById('about-modal').classList.remove('hidden'); switchAboutTab('tab-guide'); }
function closeAboutModal() { document.getElementById('about-modal').classList.add('hidden'); }
function switchAboutTab(t) {
  document.querySelectorAll('.about-tab-pane').forEach(el => el.classList.add('hidden'));
  ['tab-guide', 'tab-achievements', 'tab-architecture', 'tab-valuation'].forEach(tabId => {
    const bEl = document.getElementById('btn-' + tabId);
    if (!bEl) return;
    if (tabId === t) {
      bEl.className = 'flex-1 py-3 font-semibold text-sm border-b-2 transition-colors text-amber-600 border-amber-500';
    } else {
      bEl.className = 'flex-1 py-3 font-semibold text-sm border-b-2 transition-colors text-slate-500 border-transparent hover:text-slate-700';
    }
  });
  const tEl = document.getElementById(t);
  if (tEl) tEl.classList.remove('hidden');
}

let currentGroupId = null;
let filterGroupMemberOnly = false;

// 自動清理群組內已不存在於通訊錄的「幽靈殘留信箱」，確保群組人數與通訊錄 100% 吻合
async function sanitizeAllGroupEmails() {
  if (!Array.isArray(S.mailGroups) || !Array.isArray(S.whitelist)) return;
  const validEmails = new Set(S.whitelist.map(w => (w.email || '').trim().toLowerCase()));
  let changed = false;
  S.mailGroups.forEach(g => {
    if (!Array.isArray(g.emails)) {
      g.emails = [];
      changed = true;
      return;
    }
    const seen = new Set();
    const cleaned = [];
    g.emails.forEach(em => {
      const lower = (em || '').trim().toLowerCase();
      if (lower && validEmails.has(lower) && !seen.has(lower)) {
        seen.add(lower);
        const canonical = S.whitelist.find(w => (w.email || '').trim().toLowerCase() === lower);
        cleaned.push(canonical ? canonical.email : em.trim());
      } else {
        changed = true;
      }
    });
    if (cleaned.length !== g.emails.length) {
      g.emails = cleaned;
      changed = true;
    }
  });
  if (changed) {
    try { await DS.saveMailGroups(S.mailGroups); } catch (e) {}
  }
}

async function addGroup() {
  const name = document.getElementById('grp-name').value.trim();
  if (!name) return toast('請輸入群組名稱', 'er');
  const dup = (S.mailGroups || []).some(g => (g.name || '').trim().toLowerCase() === name.toLowerCase());
  if (dup) return toast(`已存在同名群組「${name}」`, 'er');
  const newGrp = { id: 'grp_' + Date.now(), name, emails: [] };
  S.mailGroups.push(newGrp);
  await DS.saveMailGroups(S.mailGroups);
  document.getElementById('grp-name').value = '';
  currentGroupId = newGrp.id;
  renderGroupList();
  selectGroup(newGrp.id);
  toast(`已建立群組「${name}」 ✓`, 'ok');
}

async function renameGroup(id) {
  const g = S.mailGroups.find(x => x.id === id);
  if (!g) return;
  const newName = prompt('請輸入新的群組名稱：', g.name);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) return toast('群組名稱不可為空', 'er');
  const dup = S.mailGroups.some(x => x.id !== id && (x.name || '').trim().toLowerCase() === trimmed.toLowerCase());
  if (dup) return toast(`已存在同名群組「${trimmed}」`, 'er');
  g.name = trimmed;
  await DS.saveMailGroups(S.mailGroups);
  renderGroupList();
  if (currentGroupId === id) {
    updateGroupDetailHeader(g);
  }
  toast('已更新群組名稱 ✓', 'ok');
}

async function moveGroupOrder(id, dir) {
  const idx = S.mailGroups.findIndex(x => x.id === id);
  if (idx === -1) return;
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= S.mailGroups.length) return;
  [S.mailGroups[idx], S.mailGroups[targetIdx]] = [S.mailGroups[targetIdx], S.mailGroups[idx]];
  await DS.saveMailGroups(S.mailGroups);
  renderGroupList();
}

async function delGroup(id) {
  const g = S.mailGroups.find(x => x.id === id);
  if (!g) return;
  if (!confirm(`確定要刪除群組「${g.name}」嗎？（不會刪除通訊錄內的聯絡人）`)) return;
  S.mailGroups = S.mailGroups.filter(x => x.id !== id);
  await DS.saveMailGroups(S.mailGroups);
  if (currentGroupId === id) {
    currentGroupId = S.mailGroups.length > 0 ? S.mailGroups[0].id : null;
  }
  renderGroupList();
  if (currentGroupId) {
    selectGroup(currentGroupId);
  } else {
    const t = document.getElementById('group-detail-title');
    const acts = document.getElementById('group-detail-actions');
    const m = document.getElementById('group-members');
    if (t) t.textContent = '請選擇左側群組';
    if (acts) acts.classList.add('hidden');
    if (m) m.innerHTML = '<div class="text-center text-slate-400 mt-10 text-sm">請先於上方建立新群組</div>';
  }
  toast('已刪除群組', 'ok');
}

function updateGroupDetailHeader(g) {
  const t = document.getElementById('group-detail-title');
  const acts = document.getElementById('group-detail-actions');
  if (g) {
    if (t) t.textContent = `${g.name} (${(g.emails || []).length} 位成員)`;
    if (acts) acts.classList.remove('hidden');
  } else {
    if (t) t.textContent = '請選擇左側群組';
    if (acts) acts.classList.add('hidden');
  }
}

function renderGroupList() {
  const c = document.getElementById('group-list');
  if (!c) return;
  sanitizeAllGroupEmails();

  const statsBadge = document.getElementById('grp-stats-badge');
  if (statsBadge) {
    statsBadge.textContent = `共 ${(S.mailGroups || []).length} 個群組`;
  }

  // 若尚未選取任何群組且列表中有群組，預設自動選取第一個群組，消除右側空白
  if (!currentGroupId && S.mailGroups && S.mailGroups.length > 0) {
    currentGroupId = S.mailGroups[0].id;
  }

  const searchEl = document.getElementById('grp-list-search');
  const kw = searchEl ? searchEl.value.trim().toLowerCase() : '';

  let list = S.mailGroups || [];
  if (kw) {
    list = list.filter(g => (g.name || '').toLowerCase().includes(kw));
  }

  if (list.length === 0) {
    c.innerHTML = '<div class="text-center text-slate-400 py-8 text-xs bg-slate-50/60 rounded-xl border border-dashed border-slate-200">尚無符合群組</div>';
    return;
  }
  c.innerHTML = list.map(g => {
    const isSelected = g.id === currentGroupId;
    const origIdx = S.mailGroups.findIndex(x => x.id === g.id);
    return `
      <div onclick="selectGroup('${g.id}')" class="group p-2.5 rounded-xl cursor-pointer transition-all duration-150 border ${
        isSelected
          ? 'bg-indigo-50/70 border-indigo-300 text-indigo-900 shadow-xs font-semibold ring-1 ring-indigo-200/60'
          : 'bg-white border-slate-200/70 text-slate-700 hover:bg-slate-50 hover:border-indigo-100 shadow-xs'
      } flex items-center justify-between text-xs">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-indigo-600' : 'bg-slate-300 group-hover:bg-indigo-400'} flex-shrink-0"></span>
          <span class="truncate">${xe(g.name)}</span>
        </div>
        <div class="flex items-center gap-1 flex-shrink-0">
          <span class="text-[11px] font-mono px-2 py-0.5 rounded-full ${isSelected ? 'bg-indigo-100/90 text-indigo-700 font-bold' : 'bg-slate-100 text-slate-500'}">${(g.emails || []).length}</span>
          <div class="hidden group-hover:flex items-center gap-0.5 ml-0.5">
            <button onclick="event.stopPropagation(); moveGroupOrder('${g.id}', -1)" class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 ${origIdx === 0 ? 'opacity-30 pointer-events-none' : ''}" title="上移排序">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
            </button>
            <button onclick="event.stopPropagation(); moveGroupOrder('${g.id}', 1)" class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 ${origIdx === S.mailGroups.length - 1 ? 'opacity-30 pointer-events-none' : ''}" title="下移排序">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <button onclick="event.stopPropagation(); renameGroup('${g.id}')" class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="重新命名群組">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
          </div>
          <button onclick="event.stopPropagation(); delGroup('${g.id}')" class="w-6 h-6 rounded-md flex items-center justify-center text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="刪除此群組">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  const curG = (S.mailGroups || []).find(x => x.id === currentGroupId);
  if (curG) {
    updateGroupDetailHeader(curG);
    renderGroupMembers();
  }
}

function selectGroup(id) {
  currentGroupId = id;
  renderGroupList();
}

function toggleGroupMemberOnlyFilter() {
  filterGroupMemberOnly = !filterGroupMemberOnly;
  const btn = document.getElementById('grp-filter-member-btn');
  const txt = document.getElementById('grp-filter-member-txt');
  if (btn) {
    if (filterGroupMemberOnly) {
      btn.className = 'text-xs px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-indigo-100 text-indigo-800 font-bold flex items-center gap-1 flex-shrink-0 shadow-xs transition-colors';
      if (txt) txt.textContent = '顯示全部聯絡人';
    } else {
      btn.className = 'text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/60 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors font-medium flex items-center gap-1 flex-shrink-0';
      if (txt) txt.textContent = '僅看本群組成員';
    }
  }
  renderGroupMembers();
}

function getFilteredGroupCandidateList(g) {
  if (!g) return [];
  const searchEl = document.getElementById('grp-search');
  const regionEl = document.getElementById('grp-filter-region');
  const kw = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const regionKw = regionEl ? regionEl.value : '';
  const memberSet = new Set((g.emails || []).map(em => (em || '').trim().toLowerCase()));

  let list = (S.whitelist || []).slice();
  if (regionKw) {
    list = list.filter(w => w.region === regionKw);
  }
  if (filterGroupMemberOnly) {
    list = list.filter(w => memberSet.has((w.email || '').trim().toLowerCase()));
  }
  if (kw) {
    list = list.filter(w =>
      (w.name || '').toLowerCase().includes(kw) ||
      (w.email || '').toLowerCase().includes(kw) ||
      (w.unit || '').toLowerCase().includes(kw) ||
      (w.region || '').toLowerCase().includes(kw)
    );
  }

  // 自動將「已加入此群組的成員」排在最上方，方便管理員一眼檢視本群組名單
  list.sort((a, b) => {
    const aIn = memberSet.has((a.email || '').trim().toLowerCase());
    const bIn = memberSet.has((b.email || '').trim().toLowerCase());
    if (aIn !== bIn) return aIn ? -1 : 1;
    if ((a.isPrimary === true) !== (b.isPrimary === true)) return a.isPrimary ? -1 : 1;
    return (a.unit || a.region || '').localeCompare(b.unit || b.region || '', 'zh-TW');
  });
  return list;
}

function renderGroupMembers() {
  const c = document.getElementById('group-members');
  if (!c) return;
  const g = (S.mailGroups || []).find(x => x.id === currentGroupId);
  if (!g) return;

  const memberSet = new Set((g.emails || []).map(em => (em || '').trim().toLowerCase()));
  const list = getFilteredGroupCandidateList(g);

  if (list.length === 0) {
    c.innerHTML = `<div class="col-span-full text-center text-slate-400 py-10 text-xs bg-white rounded-xl border border-dashed border-slate-200">${filterGroupMemberOnly ? '此群組在目前篩選條件下尚無成員，可點擊上方「顯示全部聯絡人」進行勾選' : '無符合條件的聯絡人名單'}</div>`;
    return;
  }
  c.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      ${list.map(w => {
        const isMember = memberSet.has((w.email || '').trim().toLowerCase());
        const regionBadge = w.region ? `<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-500 border border-slate-200">${xe(w.region)}</span>` : '';
        const unitBadge = w.unit ? `<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] bg-blue-50 text-blue-600 border border-blue-100">${xe(w.unit)}</span>` : '';
        const primaryBadge = w.isPrimary ? `<span class="text-[10px] text-amber-600 font-bold" title="主要聯絡人">⭐</span>` : '';

        return `
          <label class="flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer transition-all duration-150 ${
            isMember
              ? 'border-indigo-300 bg-indigo-50/30 shadow-xs ring-1 ring-indigo-200/60'
              : 'border-slate-200/70 bg-white/70 hover:bg-white hover:border-slate-300'
          }">
            <input type="checkbox" class="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 flex-shrink-0 cursor-pointer" ${isMember ? 'checked' : ''} onchange="toggleGroupMember('${xe(w.email)}', this.checked)">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 truncate">
                <span class="text-xs font-bold ${isMember ? 'text-indigo-950' : 'text-slate-800'}">${xe(w.name)}</span>
                ${primaryBadge}
                ${regionBadge}
                ${unitBadge}
              </div>
              <div class="text-[11px] text-slate-400 truncate font-mono mt-0.5">${xe(w.email)}</div>
            </div>
          </label>
        `;
      }).join('')}
    </div>
  `;
}

async function toggleGroupMember(email, isChecked) {
  const g = S.mailGroups.find(x => x.id === currentGroupId);
  if (!g) return;
  const emailLower = (email || '').trim().toLowerCase();
  if (isChecked) {
    if (!g.emails.some(e => (e || '').trim().toLowerCase() === emailLower)) {
      g.emails.push(email);
    }
  } else {
    g.emails = g.emails.filter(e => (e || '').trim().toLowerCase() !== emailLower);
  }
  await DS.saveMailGroups(S.mailGroups);
  updateGroupDetailHeader(g);
  renderGroupList();
}

async function toggleGroupAllVisible() {
  const g = S.mailGroups.find(x => x.id === currentGroupId);
  if (!g) return;
  const visibleList = getFilteredGroupCandidateList(g);
  if (visibleList.length === 0) return toast('目前篩選範圍內無聯絡人', 'er');
  const memberSet = new Set((g.emails || []).map(em => (em || '').trim().toLowerCase()));
  const allChecked = visibleList.every(w => memberSet.has((w.email || '').trim().toLowerCase()));

  if (allChecked) {
    const removeSet = new Set(visibleList.map(w => (w.email || '').trim().toLowerCase()));
    g.emails = g.emails.filter(em => !removeSet.has((em || '').trim().toLowerCase()));
    toast(`已從「${g.name}」移除目前篩選的 ${visibleList.length} 位人員`, 'in');
  } else {
    let added = 0;
    visibleList.forEach(w => {
      const lower = (w.email || '').trim().toLowerCase();
      if (!memberSet.has(lower)) {
        g.emails.push(w.email);
        memberSet.add(lower);
        added++;
      }
    });
    toast(`已將目前篩選範圍內 ${added} 位人員加入「${g.name}」 ✓`, 'ok');
  }
  await DS.saveMailGroups(S.mailGroups);
  updateGroupDetailHeader(g);
  renderGroupList();
}

async function selectGroupPrimaryMembers() {
  const g = S.mailGroups.find(x => x.id === currentGroupId);
  if (!g) return;
  const visibleList = getFilteredGroupCandidateList(g).filter(w => w.isPrimary === true);
  if (visibleList.length === 0) return toast('目前篩選範圍內無「⭐主要聯絡人」', 'er');
  const memberSet = new Set((g.emails || []).map(em => (em || '').trim().toLowerCase()));
  let added = 0;
  visibleList.forEach(w => {
    const lower = (w.email || '').trim().toLowerCase();
    if (!memberSet.has(lower)) {
      g.emails.push(w.email);
      memberSet.add(lower);
      added++;
    }
  });
  await DS.saveMailGroups(S.mailGroups);
  updateGroupDetailHeader(g);
  renderGroupList();
  toast(added > 0 ? `已將 ${added} 位主要窗口加入「${g.name}」 ✓` : '篩選範圍內的主要窗口皆已在此群組中', 'ok');
}

function copyCurrentGroupEmails() {
  const g = S.mailGroups.find(x => x.id === currentGroupId);
  if (!g || !g.emails || g.emails.length === 0) {
    return toast('此群組目前尚無成員信箱可複製', 'er');
  }
  const emailStr = g.emails.join('; ');
  navigator.clipboard.writeText(emailStr).then(() => {
    toast(`📋 已複製「${g.name}」共 ${g.emails.length} 筆信箱（可直接貼入 Outlook）！`, 'ok');
  }).catch(() => {
    prompt('請複製以下群組信箱清單：', emailStr);
  });
}









function showAdminList() { 
  document.getElementById('admin-modal').classList.remove('hidden'); 
  renderAdminList(); 
}
function hideAdminList() { document.getElementById('admin-modal').classList.add('hidden'); }
function renderAdminList() {
  const c = document.getElementById('am-list');
  if (S.admins.length === 0) {
    c.innerHTML = '<tr><td colspan="3" class="px-4 py-8 text-center text-slate-400 text-xs">目前尚無自訂管理員，請於上方新增</td></tr>';
    return;
  }
  c.innerHTML = S.admins.map((u, i) => `
    <tr class="hover:bg-slate-50/70 transition-colors group">
      <td class="px-4 py-3 text-slate-800 font-bold text-xs">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
            ${xe(u.name ? u.name.charAt(0).toUpperCase() : 'A')}
          </div>
          <span>${xe(u.name)}</span>
        </div>
      </td>
      <td class="px-4 py-3 text-slate-500 font-mono text-xs">
        <div class="flex items-center gap-1.5 text-slate-600">
          <svg class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          <span>${xe(u.email)}</span>
        </div>
      </td>
      <td class="px-4 py-3 text-center">
        <button onclick="delAdmin(${i})" class="w-7 h-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="移除管理員">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
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

function newBulletin(){
  if(S.dirty&&!confirm('有未儲存的修改，確定繼續？'))return;
  const now=new Date(),p=n=>String(n).padStart(2,'0'),ds=`${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;
  S.cur={
    id:`${now.getFullYear()}-W${wk(now)}`,
    publishDate:ds,
    title:'經營TEAM採購｜本週重點摘要',
    periodStart:ds,
    periodEnd:ds,
    isPinned:false,
    isHidden:false,
    audienceType:'all',
    authorizedEmails:[],
    status:'draft',
    version:1,
    sections:[]
  };
  S.dirty=false;
  renderEd();
  toast('已建立新週報草稿','in');
}
function wk(d){const j=new Date(d.getFullYear(),0,1);return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7);}
async function unpubBulletin(){if(!S.cur)return;if(!confirm('確定要撤回發布？撤回後前台將無法看見此週報。'))return;const pt=document.getElementById('pub-txt'),btn=document.getElementById('btn-unpub');btn.disabled=true;pt.textContent='撤回中...';try{const d={...S.cur,status:'draft',feedbackLog:S.fbs};if(S.cur.authorizedEmails)d.authorizedEmails=S.cur.authorizedEmails;await DS.save(d.id,d);await DS.addAuditLog(d.id, `管理員撤回了週報。`);S.dirty=false;const sb=document.getElementById('tb-status');sb.className='bdg-dft';sb.textContent='草稿';toast('週報已撤回發布！','ok');S.mmap=await DS.getMonths();renderSB();renderAuditLogs(d.id);renderEd();renderReadReceipts(d.id);}catch(e){toast('撤回失敗：'+e.message,'er');}finally{btn.disabled=false;pt.textContent='正式發布';}}
function renderEd(){
  const b=S.cur;if(!b)return;
  document.getElementById('es').classList.add('hidden');
  document.getElementById('bf').classList.remove('hidden');
  document.getElementById('tb-acts').classList.remove('hidden');
  document.getElementById('tb-title').textContent=b.id||'新週報';
  const sb=document.getElementById('tb-status');
  sb.className=b.status==='published'?'bdg-pub':'bdg-dft';
  sb.textContent=b.status==='published'?'已發布':'草稿';
  sb.classList.remove('hidden');
  if(b.status==='published'){
    document.getElementById('btn-unpub').classList.remove('hidden');
    document.getElementById('btn-pub').classList.add('hidden');
  }else{
    document.getElementById('btn-unpub').classList.add('hidden');
    document.getElementById('btn-pub').classList.remove('hidden');
  }
  document.getElementById('f-id').value=b.id||'';
  document.getElementById('f-pd').value=b.publishDate||'';
  document.getElementById('f-ps').value=b.periodStart||'';
  document.getElementById('f-pe').value=b.periodEnd||'';
  document.getElementById('f-ti').value=b.title||'';
  document.getElementById('f-pin').checked=!!b.isPinned;
  if(document.getElementById('f-hidden')) document.getElementById('f-hidden').checked=!!b.isHidden;
  
  // 載入閱讀觀看權限設定
  const audType = b.audienceType || (b.authorizedEmails && b.authorizedEmails.length > 0 ? 'custom' : 'all');
  setAudienceType(audType, false);
  
  renderSecs();
}
function renderSecs(){if(window.tinymce){try{tinymce.remove('.quill-editor');}catch(e){}}const c=document.getElementById('sc');const b=S.cur;const ptl=document.getElementById('toolbar-portal');if(ptl)ptl.innerHTML='';if(!b?.sections?.length){c.innerHTML='<div class="text-center py-10 text-slate-400 text-sm">尚未建立任何段落<br><span class="text-xs">點擊右上角「新增段落」</span></div>';return;}c.innerHTML=b.sections.map((s,i)=>bldSec(s,i)).join('');setTimeout(()=>{
  document.querySelectorAll('.quill-editor').forEach(el=>{
    if(el.classList.contains('tox-target')) return;
    tinymce.init({
      target: el,
      language: 'zh-Hant',
      language_url: 'https://cdn.jsdelivr.net/npm/tinymce-i18n@26.8.2/langs6/zh-Hant.js',
      inline: true,
      menubar: false,
      placeholder: '點擊此處輸入公告內容（可使用上方工具列排版、插入表格或連結）...',
      plugins: 'table lists link image autolink searchreplace wordcount',
      toolbar: 'undo redo | fontfamily fontsize | bold italic underline strikethrough | boxed circled | forecolor backcolor stdcolor | alignleft aligncenter alignright alignjustify | merge_center table | lineheight removeformat',
      fixed_toolbar_container: '#toolbar-portal',
      toolbar_mode: 'sliding',
      table_toolbar: 'tableprops tabledelete | tableinsertrowbefore tableinsertrowafter tabledeleterow | tableinsertcolbefore tableinsertcolafter tabledeletecol | tablemergecells tablesplitcells | tablecellvalign',
      table_grid: true,
      table_default_attributes: {
        class: 'pro-table'
      },
      table_default_styles: {
        width: '100%',
        borderCollapse: 'collapse'
      },
      table_responsive_width: true,
      paste_data_images: true,
      paste_as_text: false,
      paste_postprocess: function(plugin, args) {
        const tables = args.node.querySelectorAll('table');
        tables.forEach(table => {
          table.style.width = '100%';
          table.style.borderCollapse = 'collapse';
          table.style.margin = '2px 0';
          table.removeAttribute('width');
          const cells = table.querySelectorAll('td, th');
          cells.forEach(cell => {
            cell.removeAttribute('width');
            cell.removeAttribute('height');
            if (cell.style.width) cell.style.width = '';
            if (cell.style.height) cell.style.height = '';
            cell.style.border = '1px solid #cbd5e1';
            cell.style.padding = '3px 6px';
            cell.style.fontSize = '0.875rem';
            cell.style.lineHeight = '1.3';
          });
          const headers = table.querySelectorAll('th');
          headers.forEach(th => {
            th.style.backgroundColor = '#f8fafc';
            th.style.fontWeight = '600';
            th.style.color = '#475569';
          });
        });

        // 2. Sanitize Word list artifacts
        const lists = args.node.querySelectorAll('ol, ul');
        lists.forEach(list => {
          const lis = list.querySelectorAll('li');
          let hasManual = false;
          lis.forEach(li => {
            const txt = li.textContent.trim();
            if (/^[•·\-\*]|^(?:📌|📢|✅|👉|\d+[\.、])/.test(txt)) hasManual = true;
          });
          if (hasManual) {
            const container = list.ownerDocument.createElement('div');
            container.className = 'space-y-1';
            lis.forEach(li => {
              li.querySelectorAll('p').forEach(p => {
                while (p.firstChild) p.parentNode.insertBefore(p.firstChild, p);
                p.remove();
              });
              const row = list.ownerDocument.createElement('div');
              if (li.getAttribute('style')) row.setAttribute('style', li.getAttribute('style'));
              while (li.firstChild) row.appendChild(li.firstChild);
              container.appendChild(row);
            });
            list.parentNode.replaceChild(container, list);
          } else {
            lis.forEach(li => {
              li.querySelectorAll('p').forEach(p => {
                while (p.firstChild) p.parentNode.insertBefore(p.firstChild, p);
                p.remove();
              });
            });
          }
        });
      },
      font_size_formats: '6pt 8pt 9pt 10pt 11pt 12pt 13pt 14pt 16pt 18pt 20pt 22pt 24pt 26pt 28pt 32pt',
      font_family_formats: 'Inter=Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 微軟正黑體="Microsoft JhengHei", "PingFang TC", "Heiti TC", sans-serif; 新細明體="PMingLiU", "MingLiU", serif; 標楷體="DFKai-SB", "BiauKai", "Kaiti TC", serif; 微軟雅黑="Microsoft YaHei", "PingFang SC", sans-serif; Arial=Arial, Helvetica, sans-serif; Calibri=Calibri, Candara, Segoe, "Segoe UI", Optima, Arial, sans-serif; Times New Roman="Times New Roman", Times, serif; Segoe UI="Segoe UI", Tahoma, Geneva, Verdana, sans-serif; Georgia=Georgia, Garamond, "Times New Roman", serif; Consolas=Consolas, Menlo, Monaco, "Courier New", monospace',
      line_height_formats: '1 1.5 2 2.5 3',
      color_map: [
        '000000', '純黑',
        '334155', '深藍灰 (Slate 700)',
        '64748b', '中灰 (Slate 500)',
        '94a3b8', '淡灰 (Slate 400)',
        'cbd5e1', '框線灰 (Slate 300)',
        'f1f5f9', '背景淡灰 (Slate 100)',
        'f8fafc', '極淡灰 (Slate 50)',
        'ffffff', '純白',
        '1e3a8a', '深海軍藍',
        '2563eb', '微笑藍 (Blue 600)',
        '0284c7', '天空藍 (Sky 600)',
        '0d9488', '松石綠 (Teal 600)',
        '059669', '翡翠綠 (Emerald 600)',
        'd97706', '警示琥珀 (Amber 600)',
        'ea580c', '活力橙 (Orange 600)',
        'dc2626', '緊急深紅 (Red 600)',
        '6b6258', '莫蘭迪暖深灰',
        'a89c93', '莫蘭迪奶咖',
        'd4c9be', '莫蘭迪邊框米',
        'f5f0eb', '莫蘭迪底色米',
        '7a9e84', '莫蘭迪鼠尾草綠',
        'e8ede9', '莫蘭迪淡綠底',
        'b08080', '莫蘭迪玫瑰豆沙',
        'f0e8e6', '莫蘭迪淡粉底',
        'fef08a', '高光淡黃',
        'bbf7d0', '高光淡綠',
        'bfdbfe', '高光淡藍',
        'fecdd3', '高光淡紅',
        'fed7aa', '高光淡橙',
        'ddd6fe', '高光淡紫',
        'e9d5ff', '高光淡粉紫',
        'fbcfe8', '高光淡洋紅'
      ],
      color_cols: 8,
      custom_colors: false,
      setup: function(editor) {
        editor.ui.registry.addButton('boxed', {
          text: '🄰',
          tooltip: '文字加框',
          onAction: function () { editor.formatter.toggle('boxed'); }
        });
                editor.ui.registry.addButton('stdcolor', {
          icon: 'color-picker',
          tooltip: '標準蜂巢色彩盤 (文字色彩/背景色彩)',
          onAction: function () {
            window._activeTinyEditor = editor;
            openStdColorPicker('forecolor', '#000000');
          }
        });
        editor.ui.registry.addButton('circled', {
          text: '⭕',
          tooltip: '文字加圓圈',
          onAction: function () { editor.formatter.toggle('circled'); }
        });
        editor.ui.registry.addButton('merge_center', {
          icon: 'table-merge-cells',
          tooltip: '跨欄置中 (合併選取並置中)',
          onAction: function () {
            editor.execCommand('mceTableMergeCells');
            editor.execCommand('JustifyCenter');
            const node = editor.selection.getNode();
            const cell = node ? node.closest('td, th') : null;
            if (cell) {
              cell.style.textAlign = 'center';
              cell.style.verticalAlign = 'middle';
            }
          }
        });
        
        editor.on('init', function() {
          editor.formatter.register('boxed', { inline: 'span', styles: { border: '1px solid currentColor', padding: '0 4px', borderRadius: '4px' }, classes: 'ql-boxed' });
          editor.formatter.register('circled', { inline: 'span', styles: { border: '1px solid currentColor', padding: '1px 5px', borderRadius: '50%' }, classes: 'ql-circled' });
          const ptl = document.getElementById('toolbar-portal');
          const hint = document.getElementById('toolbar-hint');
          if (hint) hint.style.display = 'none';
          
          if (ptl && !ptl._boundPreventBlur) {
            ptl._boundPreventBlur = true;
            ptl.addEventListener('mousedown', function(e) {
              if (!e.target.closest('input, textarea')) {
                e.preventDefault();
              }
            });
          }
        });
        
        editor.on('focus', function() {
          window._activeTinyEditor = editor;
          const hint = document.getElementById('toolbar-hint');
          if (hint) hint.style.display = 'none';
        });

        editor.on('click', function() {
          const popups = document.querySelectorAll('.tox-tinymce-aux .tox-pop, .tox-tinymce-aux .tox-menu');
          if (popups.length > 0) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          }
        });
        
        editor.on('input change undo redo execCommand paste', function() {
          let obj=S.cur;
          const p=el.getAttribute('data-path').split(/[.\[\]]/).filter(Boolean);
          for(let i=0;i<p.length-1;i++) obj=obj[p[i]];
          obj[p[p.length-1]]=editor.getContent();
          S.dirty=true;
        });
      },
      images_upload_handler: function (blobInfo, progress) {
        return new Promise(async (resolve, reject) => {
          try {
            const res = await DS.uploadAttachment(S.cur.id || 'temp', blobInfo.blob());
            resolve(res.url);
          } catch(err) {
            toast('圖片上傳失敗', 'er');
            reject('Image upload failed');
          }
        });
      }
    });
  });
  // 卡片點擊代理：點擊卡片空白處自動 focus 輸入框
  document.querySelectorAll('.bulletin-item-card').forEach(card => {
    if (card._boundClickFocus) return;
    card._boundClickFocus = true;
    card.addEventListener('click', (e) => {
      if (e.target.closest('select, button, svg, input, textarea')) return;
      const editor = card.querySelector('.quill-editor');
      if (editor) {
        editor.focus();
        const tinymceInst = window.tinymce && window.tinymce.get(editor.id);
        if (tinymceInst) tinymceInst.focus();
      }
    });
  });
},10);}
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
function bldGenericTbl(t,si){if(!t||!t.columns||!t.rows)return'';return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">表格資料</p><div class="flex gap-3"><button onclick="editGenCols(${si})" class="text-xs text-indigo-600 font-medium bg-indigo-50 px-2 py-0.5 rounded">⚙️ 編輯欄位</button><button onclick="addGenRow(${si})" class="text-xs text-blue-600 font-medium">＋ 新增列</button><button onclick="rmSecTable(${si}, \'table\')" class="text-xs text-red-500 font-medium ml-3 flex items-center gap-1 hover:text-red-700"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> 刪除表格</button></div></div><div class="overflow-x-auto rounded-lg border border-slate-200"><table class="data-table w-full text-xs"><thead><tr>${t.columns.map(c=>`<th>${xe(c)}</th>`).join('')}<th style="width:28px"></th></tr></thead><tbody>${t.rows.map((r,ri)=>{const rowCells=Array.isArray(r)?r:(r&&r.c?r.c:(r&&r.cols?r.cols:[]));return `<tr>${rowCells.map((c,ci)=>`<td><input value="${xe(c||'')}" onchange="uGenRow(${si},${ri},${ci},this.value)"></td>`).join('')}<td><button onclick="rmGenRow(${si},${ri})" class="bic d"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`;}).join('')}</tbody></table></div></div>`;}
function addGenRow(si){if(!S.cur.sections[si].table)return;const cols=S.cur.sections[si].table.columns.length;S.cur.sections[si].table.rows.push(Array(cols).fill(''));S.dirty=true;renderSecs();}
function rmGenRow(si,ri){S.cur.sections[si].table.rows.splice(ri,1);S.dirty=true;renderSecs();}
function uGenRow(si,ri,ci,v){const r=S.cur.sections[si].table.rows[ri];if(Array.isArray(r)){r[ci]=v;}else if(r&&r.c){r.c[ci]=v;}else if(r&&r.cols){r.cols[ci]=v;}S.dirty=true;}
function editGenCols(si){const t=S.cur.sections[si].table;const cStr=prompt('請輸入欄位名稱 (使用逗號分隔，例如: 廠商,料號,數量)',t.columns.join(','));if(cStr!==null){const cols=cStr.split(',').map(s=>s.trim()).filter(s=>s);if(cols.length>0){t.columns=cols;t.rows=t.rows.map(r=>{const row=Array.isArray(r)?r:(r&&r.c?r.c:(r&&r.cols?r.cols:[]));while(row.length<cols.length)row.push('');if(row.length>cols.length)row.length=cols.length;return row;});S.dirty=true;renderSecs();}}}
function rmSecTable(si, type) { if(confirm('確定要刪除此表格嗎？')) { delete S.cur.sections[si][type]; S.dirty=true; renderSecs(); } }
function addTableToSec(si){S.cur.sections[si].table={columns:['欄位一','欄位二'],rows:[]};S.dirty=true;renderSecs();}
function bldItems(sec,si){
  const items=sec.items||[];
  return `<div class="mb-4">
    <div class="flex items-center justify-between mb-2">
      <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">重點公告項目（1:1 前台等寬所見即所得）</p>
      <button onclick="addItm(${si})" class="btn-s text-xs py-1 px-2.5 text-blue-600 font-medium">＋ 新增公告</button>
    </div>
    <div class="space-y-1.5">
      ${items.map((item,ii)=>{
        const isHigh = item.priority === 'high';
        const isEven = ii % 2 === 0;
        const borderClass = isHigh
          ? (isEven ? 'border-rose-500 bg-rose-100/75 text-slate-900' : 'border-rose-400 bg-rose-50/70 text-slate-800')
          : (isEven ? 'border-blue-600 bg-blue-100/70 text-slate-900' : 'border-blue-400 bg-blue-50/50 text-slate-800');
        return `
          <div class="bulletin-item-card pl-3 pr-2.5 pt-2 pb-1.5 border-l-4 rounded-r-lg shadow-sm ${borderClass} group relative">
            <div class="flex items-center justify-between mb-1 pb-1 border-b border-black/5">
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-slate-400">#${ii+1}</span>
                <select class="form-input csel text-xs py-0.5 px-2 w-28 font-semibold ${isHigh ? 'text-red-600 bg-red-50 border-red-200' : 'text-slate-700 bg-white/80 border-slate-200'}" onchange="uItm(${si},${ii},'priority',this.value)">
                  <option value="normal" ${item.priority==='normal'?'selected':''}>一般公告</option>
                  <option value="high" ${item.priority==='high'?'selected':''}>🚨 緊急公告</option>
                </select>
              </div>
              <button onclick="rmItm(${si},${ii})" class="bic d text-slate-400 hover:text-red-600" title="刪除此項目">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
            <div class="w-full quill-editor text-sm font-medium outline-none text-left bg-white/90 min-h-[52px] p-2 rounded border border-dashed border-slate-300 hover:border-blue-400 focus:border-blue-500 cursor-text transition-all" data-path="sections[${si}].items[${ii}].content" placeholder="點擊此處輸入公告內容...">${item.content || '<p><br></p>'}</div>
          </div>
        `;
      }).join('')}
    </div>
    ${!items.length?'<p class="text-xs text-slate-400 py-1">尚無公告項目</p>':''}
  </div>`;
}function bldSubs(sec,si){const subs=sec.subsections||[];return`<div class="mb-3 pl-3 border-l-2 border-blue-100"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">子段落</p><button onclick="addSub(${si})" class="text-xs text-blue-600 font-medium">＋ 新增子段落</button></div>${subs.map((sub,sbi)=>`<div class="mb-3 bg-slate-50 rounded-lg p-3"><div class="flex items-center gap-2 mb-2"><span class="text-xs text-slate-400 font-semibold">${sbi+1}.</span><input type="text" class="form-input flex-1 text-sm py-1 font-bold text-slate-700" value="${xe(sub.title||'')}" placeholder="子段落標題..." oninput="uSub(${si},${sbi},'title',this.value)"><button onclick="rmSub(${si},${sbi})" class="bic d"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div><div class="space-y-1">${(sub.items||[]).map((item,ii)=>{
  const isHigh = item.priority === 'high';
  const isEven = ii % 2 === 0;
  const borderClass = isHigh
    ? (isEven ? 'border-rose-500 bg-rose-100/75 text-slate-900' : 'border-rose-400 bg-rose-50/70 text-slate-800')
    : (isEven ? 'border-blue-600 bg-blue-100/70 text-slate-900' : 'border-blue-400 bg-blue-50/50 text-slate-800');
  return `
    <div class="bulletin-item-card px-2.5 py-1.5 border-l-4 rounded-r shadow-sm ${borderClass} group relative">
      <div class="flex items-center justify-between mb-1 pb-0.5 border-b border-black/5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-slate-400">#${ii+1}</span>
          <select class="form-input csel text-xs py-0.5 px-2 w-28 font-semibold ${isHigh ? 'text-red-600 bg-red-50 border-red-200' : 'text-slate-700 bg-white/80 border-slate-200'}" onchange="uSI(${si},${sbi},${ii},'priority',this.value)">
            <option value="normal" ${item.priority==='normal'?'selected':''}>一般條目</option>
            <option value="high" ${item.priority==='high'?'selected':''}>🚨 緊急條目</option>
          </select>
        </div>
        <button onclick="rmSI(${si},${sbi},${ii})" class="bic d text-slate-400 hover:text-red-600" title="刪除此條目">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="w-full quill-editor text-sm font-medium outline-none text-left bg-white/90 min-h-[52px] p-2 rounded border border-dashed border-slate-300 hover:border-blue-400 focus:border-blue-500 cursor-text transition-all" data-path="sections[${si}].subsections[${sbi}].items[${ii}].content" placeholder="點擊此處輸入條目內容...">${item.content || '<p><br></p>'}</div>
    </div>
  `;
}).join('')}</div><button onclick="addSI(${si},${sbi})" class="text-xs text-blue-500 mt-2 font-medium">＋ 新增條目</button></div>`).join('')}</div>`;}function bldOT(orders,si,field,label){return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">${label}</p><button onclick="addRow(${si},'${field}')" class="text-xs text-blue-600 font-medium">＋ 新增列</button><button onclick="rmSecTable(${si}, '${field}')" class="text-xs text-red-500 font-medium ml-3 flex items-center gap-1 hover:text-red-700"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> 刪除表格</button></div><div class="overflow-x-auto rounded-lg border border-slate-200"><table class="data-table w-full text-xs min-w-[640px]"><thead><tr><th>供應商</th><th>訂單號</th><th>行號</th><th>料號</th><th>品名</th><th>數量</th><th>原交期</th><th>新交期</th><th>倉庫</th><th style="width:28px"></th></tr></thead><tbody>${(orders||[]).map((o,ri)=>`<tr><td><input value="${xe(o.supplierName||'')}" onchange="uRow(${si},'${field}',${ri},'supplierName',this.value)"></td><td><input value="${xe(o.poNumber||'')}" onchange="uRow(${si},'${field}',${ri},'poNumber',this.value)"></td><td><input value="${xe(o.lineNumber||'')}" style="width:45px" onchange="uRow(${si},'${field}',${ri},'lineNumber',this.value)"></td><td><input value="${xe(o.partNumber||'')}" onchange="uRow(${si},'${field}',${ri},'partNumber',this.value)"></td><td><input value="${xe(o.itemName||'')}" onchange="uRow(${si},'${field}',${ri},'itemName',this.value)"></td><td><input type="number" value="${o.quantity||''}" style="width:55px" onchange="uRow(${si},'${field}',${ri},'quantity',parseInt(this.value)||0)"></td><td><input type="date" value="${xe(o.originalDelivery||'')}" onchange="uRow(${si},'${field}',${ri},'originalDelivery',this.value)"></td><td><input value="${xe(o.newDelivery||'')}" onchange="uRow(${si},'${field}',${ri},'newDelivery',this.value)"></td><td><input value="${xe(o.warehouseName||'')}" onchange="uRow(${si},'${field}',${ri},'warehouseName',this.value)"></td><td><button onclick="rmRow(${si},'${field}',${ri})" class="bic d"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`).join('')}</tbody></table></div></div>`;}function bldRT(records,si){return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">返修紀錄</p><button onclick="addRep(${si})" class="text-xs text-blue-600 font-medium">＋ 新增</button><button onclick="rmSecTable(${si}, 'repairRecords')" class="text-xs text-red-500 font-medium ml-3 flex items-center gap-1 hover:text-red-700"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> 刪除表格</button></div><div class="overflow-x-auto rounded-lg border border-slate-200"><table class="data-table w-full text-xs min-w-[560px]"><thead><tr><th>供應商</th><th>返修單位</th><th>返修日</th><th>追蹤號</th><th>異常類型</th><th>品名</th><th>數量</th><th></th></tr></thead><tbody>${(records||[]).map((r,ri)=>`<tr><td><input value="${xe(r.supplierName||'')}" onchange="uRep(${si},${ri},'supplierName',this.value)"></td><td><input value="${xe(r.repairUnit||'')}" onchange="uRep(${si},${ri},'repairUnit',this.value)"></td><td><input type="date" value="${xe(r.repairDate||'')}" onchange="uRep(${si},${ri},'repairDate',this.value)"></td><td><input value="${xe(r.trackingNumber||'')}" onchange="uRep(${si},${ri},'trackingNumber',this.value)"></td><td><input value="${xe(r.faultType||'')}" onchange="uRep(${si},${ri},'faultType',this.value)"></td><td><input value="${xe(r.faultModel||'')}" onchange="uRep(${si},${ri},'faultModel',this.value)"></td><td><input type="number" value="${r.quantity||''}" style="width:55px" onchange="uRep(${si},${ri},'quantity',parseInt(this.value)||0)"></td><td><button onclick="rmRep(${si},${ri})" class="bic d"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`).join('')}</tbody></table></div></div>`;}function bldPT(items,si){return`<div class="mb-3"><div class="flex items-center justify-between mb-1"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider">漲價料件</p><button onclick="addPrc(${si})" class="text-xs text-blue-600 font-medium">＋ 新增</button><button onclick="rmSecTable(${si}, 'priceChangeItems')" class="text-xs text-red-500 font-medium ml-3 flex items-center gap-1 hover:text-red-700"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> 刪除表格</button></div><div class="overflow-x-auto rounded-lg border border-slate-200"><table class="data-table w-full text-xs"><thead><tr><th>供應商</th><th>品號</th><th>品名/說明</th><th></th></tr></thead><tbody>${(items||[]).map((it,ri)=>`<tr><td><input value="${xe(it.supplierName||'')}" onchange="uPrc(${si},${ri},'supplierName',this.value)"></td><td><input value="${xe(it.partNumber||'')}" onchange="uPrc(${si},${ri},'partNumber',this.value)"></td><td><input value="${xe(it.description||'')}" onchange="uPrc(${si},${ri},'description',this.value)"></td><td><button onclick="rmPrc(${si},${ri})" class="bic d"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`).join('')}</tbody></table></div></div>`;}function bldFiles(sec,si){const files=sec.files||[];return`<div class="mt-3 pt-3 border-t border-slate-100"><p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">📎 附件</p>${files.map((f,fi)=>`<div class="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 mb-1.5 text-xs"><span class="text-slate-400">📄</span><input class="flex-1 bg-transparent border-none outline-none text-blue-600 font-medium text-xs" value="${xe(f.fileName||'')}" onchange="uFile(${si},${fi},'fileName',this.value)"><button onclick="rmFile(${si},${fi})" class="text-red-400 hover:text-red-600">🗑️</button></div>`).join('')}<label class="inline-flex items-center gap-1.5 mt-1 text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium"><span>＋ 上傳附件</span><input type="file" class="hidden" onchange="upFile(this,${si})"></label><span class="text-[11px] text-slate-400 ml-2">最大 20MB</span></div>`;}function renderFBL(){const c=document.getElementById('fll');if(!S.fbs.length){c.innerHTML='<p style="color:var(--morandi-subtle);font-size:.8rem;text-align:center;padding:1rem 0">目前尚無回饋項目</p>';return;}c.innerHTML=S.fbs.map(item=>`<div class="feedback-item"><div>${item.isCompleted?`<div class="fi-done"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7a9e84" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>`:'<div class="fi-pend"></div>'}</div><div class="flex-1 min-w-0"><p style="font-size:.85rem;color:var(--morandi-text);font-weight:500;line-height:1.5">${xe(item.item)}</p>${!item.isCompleted&&item.reason?`<span class="fb-reason">${xe(item.reason)}</span>`:''}<p style="font-size:.72rem;color:var(--morandi-subtle);margin-top:.25rem">${fmtD(item.createdAt)}</p></div><button onclick="rmFB('${item.id}')" class="bic d flex-shrink-0"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>`).join('');}function fc(){
  if(!S.cur)return;
  S.dirty=true;
  S.cur.id=document.getElementById('f-id').value.trim();
  S.cur.publishDate=document.getElementById('f-pd').value;
  S.cur.periodStart=document.getElementById('f-ps').value;
  S.cur.periodEnd=document.getElementById('f-pe').value;
  S.cur.title=document.getElementById('f-ti').value.trim();
  S.cur.isPinned=document.getElementById('f-pin').checked;
  S.cur.isHidden=document.getElementById('f-hidden') ? document.getElementById('f-hidden').checked : false;
  S.cur.audienceType = window._currentAudienceType || (S.cur.audienceType || 'all');
  if (S.cur.audienceType === 'custom') {
    const checked = Array.from(document.querySelectorAll('.aud-user-cb:checked')).map(cb => cb.value);
    S.cur.authorizedEmails = checked;
  } else {
    S.cur.authorizedEmails = [];
  }
}async function saveDraft(){if(!S.cur)return;fc();document.getElementById('btn-dft').disabled=true;try{await DS.save(S.cur.id,{...S.cur,status:'draft',feedbackLog:S.fbs});S.dirty=false;const sb=document.getElementById('tb-status');sb.className='bdg-dft';sb.textContent='草稿';toast('草稿已儲存 ✓','ok');S.mmap=await DS.getMonths();renderSB();}catch(e){toast('儲存失敗：'+e.message,'er');}finally{document.getElementById('btn-dft').disabled=false;}}async function cloneBulletin(){if(!S.cur)return;const c=JSON.parse(JSON.stringify(S.cur));const now=new Date();c.id=`${now.getFullYear()}-W${wk(now)}-copy`;c.status='draft';c.version=1;c.isPinned=false;S.cur=c;S.fbs=[];S.dirty=true;renderEd();toast(`已複製為新草稿：${c.id}`,'in');}async function delBulletin(){if(!S.cur)return;if(!confirm(`確定刪除「${S.cur.id}」？`))return;try{await DS.del(S.cur.id);S.cur=null;S.dirty=false;document.getElementById('es').classList.remove('hidden');document.getElementById('bf').classList.add('hidden');document.getElementById('tb-acts').classList.add('hidden');document.getElementById('tb-title').textContent='請選擇或新增週報';document.getElementById('tb-status').classList.add('hidden');S.mmap=await DS.getMonths();renderSB();toast('週報已刪除','ok');}catch(e){toast('刪除失敗：'+e.message,'er');}}function showModal(){document.getElementById('sm').classList.remove('hidden');document.getElementById('tl').innerHTML=S.tpls.map(t=>`<button onclick="addTpl('${t.id}')" class="w-full text-left px-4 py-2.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all flex items-center gap-3 text-sm mb-1.5"><span class="text-xl">${t.i}</span><span class="font-medium text-slate-700">${t.t}</span></button>`).join('');}function hideModal(){document.getElementById('sm').classList.add('hidden');}function addTpl(tid){
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
  if(t.hi) sec.items = [{ id: `i-${Date.now()}`, content: '', priority: 'normal' }];
  if(t.hs) sec.subsections = [];
  if(t.hao) sec.affectedOrders = [];
  if(t.hr) sec.repairRecords = [];
  if(t.hp) sec.priceChangeItems = [];
  if(t.hf) sec.files = [];
  S.cur.sections.push(sec);
  S.dirty=true;
  hideModal();
  renderSecs();
}function addCustomSec(){const title=document.getElementById('ct').value.trim(),icon=document.getElementById('ci').value.trim()||'📝';if(!title){toast('請輸入段落標題','er');return;}const i=(S.cur.sections||[]).length;if(!S.cur.sections)S.cur.sections=[];S.cur.sections.push({id:`s${i+1}-${Date.now()}`,sectionNumber:NUMS[i]||String(i+1),title,icon,items:[{ id: `i-${Date.now()}`, content: '', priority: 'normal' }]});S.dirty=true;hideModal();renderSecs();}function uSec(si,f,v){S.cur.sections[si][f]=v;S.dirty=true;}function sTitleSel(si,v){const ci=document.getElementById(`cti-${si}`);if(v==='__c__'){ci&&ci.classList.remove('hidden');}else{ci&&ci.classList.add('hidden');S.cur.sections[si].title=v;S.cur.sections[si].subtitle='';const t=S.tpls.find(tp=>tp.t===v);if(t){S.cur.sections[si].icon=t.i;}else{const c=S.keywords.find(tp=>tp.name===v);if(c)S.cur.sections[si].icon='📋';}S.dirty=true;}renderSecs();}function rmSec(si){if(!confirm('確定移除？'))return;S.cur.sections.splice(si,1);S.dirty=true;renderSecs();}function mvUp(si){if(si===0)return;const s=S.cur.sections;[s[si-1],s[si]]=[s[si],s[si-1]];S.dirty=true;renderSecs();}function mvDn(si){const s=S.cur.sections;if(si>=s.length-1)return;[s[si],s[si+1]]=[s[si+1],s[si]];S.dirty=true;renderSecs();}function addItm(si){if(!S.cur.sections[si].items)S.cur.sections[si].items=[];S.cur.sections[si].items.push({id:`i-${Date.now()}`,content:'',priority:'normal'});S.dirty=true;renderSecs();}function rmItm(si,ii){S.cur.sections[si].items.splice(ii,1);S.dirty=true;renderSecs();}function uItm(si,ii,f,v){S.cur.sections[si].items[ii][f]=v;S.dirty=true;if(f==='priority')renderSecs();}function addSub(si){if(!S.cur.sections[si].subsections)S.cur.sections[si].subsections=[];const idx=S.cur.sections[si].subsections.length;S.cur.sections[si].subsections.push({id:`sub-${Date.now()}`,subsectionNumber:String(idx+1),title:'',items:[]});S.dirty=true;renderSecs();}function rmSub(si,sbi){S.cur.sections[si].subsections.splice(sbi,1);S.dirty=true;renderSecs();}function uSub(si,sbi,f,v){S.cur.sections[si].subsections[sbi][f]=v;S.dirty=true;}function addSI(si,sbi){if(!S.cur.sections[si].subsections[sbi].items)S.cur.sections[si].subsections[sbi].items=[];S.cur.sections[si].subsections[sbi].items.push({id:`si-${Date.now()}`,content:'',priority:'normal'});S.dirty=true;renderSecs();}function rmSI(si,sbi,ii){S.cur.sections[si].subsections[sbi].items.splice(ii,1);S.dirty=true;renderSecs();}function uSI(si,sbi,ii,f,v){S.cur.sections[si].subsections[sbi].items[ii][f]=v;S.dirty=true;if(f==='priority')renderSecs();}function addRow(si,field){if(!S.cur.sections[si][field])S.cur.sections[si][field]=[];S.cur.sections[si][field].push({supplierName:'',poNumber:'',lineNumber:'',partNumber:'',itemName:'',quantity:0,originalDelivery:'',newDelivery:'',warehouseName:''});S.dirty=true;renderSecs();}function rmRow(si,field,ri){S.cur.sections[si][field].splice(ri,1);S.dirty=true;renderSecs();}function uRow(si,field,ri,col,v){S.cur.sections[si][field][ri][col]=v;S.dirty=true;}function addRep(si){if(!S.cur.sections[si].repairRecords)S.cur.sections[si].repairRecords=[];S.cur.sections[si].repairRecords.push({supplierName:'',repairUnit:'',repairDate:'',trackingNumber:'',faultType:'',faultModel:'',quantity:0});S.dirty=true;renderSecs();}function rmRep(si,ri){S.cur.sections[si].repairRecords.splice(ri,1);S.dirty=true;renderSecs();}function uRep(si,ri,f,v){S.cur.sections[si].repairRecords[ri][f]=v;S.dirty=true;}function addPrc(si){if(!S.cur.sections[si].priceChangeItems)S.cur.sections[si].priceChangeItems=[];S.cur.sections[si].priceChangeItems.push({supplierName:'',partNumber:'',description:''});S.dirty=true;renderSecs();}function rmPrc(si,ri){S.cur.sections[si].priceChangeItems.splice(ri,1);S.dirty=true;renderSecs();}function uPrc(si,ri,f,v){S.cur.sections[si].priceChangeItems[ri][f]=v;S.dirty=true;}function uFile(si,fi,f,v){S.cur.sections[si].files[fi][f]=v;S.dirty=true;}function rmFile(si,fi){if(!confirm('確定移除？'))return;S.cur.sections[si].files.splice(fi,1);S.dirty=true;renderSecs();}async function upFile(el,si){
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
}function addFB(){const item=document.getElementById('fn-item').value.trim(),done=document.getElementById('fn-done').checked,reason=document.getElementById('fn-rsn').value.trim();if(!item){toast('請輸入調整項目說明','er');return;}S.fbs.push({id:`fb-${Date.now()}`,item,isCompleted:done,reason:done?null:(reason||null),createdAt:new Date().toISOString()});document.getElementById('fn-item').value='';document.getElementById('fn-done').checked=false;document.getElementById('fn-rsn').value='';S.dirty=true;renderFBL();}function rmFB(id){S.fbs=S.fbs.filter(f=>f.id!==id);S.dirty=true;renderFBL();}function xe(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}function fmtD(iso){try{return new Date(iso).toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'});}catch(e){return iso;}}function toast(msg,type){const c=document.getElementById('tc'),icons={ok:'✅',er:'❌',in:'ℹ️'};const el=document.createElement('div');el.className=`toast t-${type}`;el.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;c.appendChild(el);setTimeout(()=>{el.style.cssText='opacity:0;transform:translateX(20px);transition:all .3s';setTimeout(()=>el.remove(),300);},3500);}window.addEventListener('beforeunload',e=>{if(S.dirty){e.preventDefault();e.returnValue='';}});
function showAchievements() {
  document.getElementById('am').classList.remove('hidden');
}
function hideAchievements() {
  document.getElementById('am').classList.add('hidden');
}

/* =========================================================
   即時前台畫面預覽控制器 (WYSIWYG 1:1 Live Preview Modal)
   ========================================================= */
let currentPreviewDevice = 'desktop';

function openPreviewModal() {
  if (!S.cur) {
    toast('請先選擇或新增一份週報', 'in');
    return;
  }

  // 1. 同步當前表單文字與編輯器內容至 S.cur
  fc();

  // 2. 深度深拷貝週報資料，確保預覽隔離性
  const previewDoc = JSON.parse(JSON.stringify(S.cur));
  previewDoc.feedbackLog = S.fbs ? JSON.parse(JSON.stringify(S.fbs)) : [];
  previewDoc.status = 'published'; // 在預覽中模擬已發布視覺狀態

  // 3. 將資料存入 sessionStorage 供前台 iframe 讀取
  try {
    sessionStorage.setItem('procurement_preview_data', JSON.stringify(previewDoc));
  } catch(e) {
    console.error('Save preview data error:', e);
  }

  // 4. 重設為電腦版視角並載入 iframe
  setPreviewDevice('desktop');
  const iframe = document.getElementById('preview-iframe');
  if (iframe) {
    // 加上時間戳防快取
    iframe.src = 'index.html?preview=1&t=' + Date.now();
  }

  // 5. 顯示 Modal 視窗
  const modal = document.getElementById('preview-modal');
  if (modal) modal.classList.remove('hidden');
}

function closePreviewModal() {
  const modal = document.getElementById('preview-modal');
  if (modal) modal.classList.add('hidden');
  const iframe = document.getElementById('preview-iframe');
  if (iframe) iframe.src = 'about:blank'; // 釋放記憶體
}

function setPreviewDevice(device) {
  currentPreviewDevice = device;
  const wrapper = document.getElementById('preview-iframe-wrapper');
  const btnDesktop = document.getElementById('pv-device-desktop');
  const btnTablet = document.getElementById('pv-device-tablet');
  const btnMobile = document.getElementById('pv-device-mobile');

  // 更新按鈕選取外觀
  [btnDesktop, btnTablet, btnMobile].forEach(btn => {
    if (!btn) return;
    btn.className = 'px-3 py-1 font-semibold rounded-lg transition-colors text-slate-600 hover:text-slate-900 flex items-center gap-1.5';
  });

  const activeBtn = device === 'desktop' ? btnDesktop : (device === 'tablet' ? btnTablet : btnMobile);
  if (activeBtn) {
    activeBtn.className = 'px-3 py-1 font-semibold rounded-lg transition-colors bg-white text-blue-600 shadow-xs flex items-center gap-1.5';
  }

  // 調整 iframe 外框寬度
  if (wrapper) {
    if (device === 'desktop') {
      wrapper.style.maxWidth = '100%';
      wrapper.style.width = '100%';
    } else if (device === 'tablet') {
      wrapper.style.maxWidth = '768px';
      wrapper.style.width = '768px';
    } else if (device === 'mobile') {
      wrapper.style.maxWidth = '414px';
      wrapper.style.width = '414px';
    }
  }
}

function openPreviewInNewTab() {
  if (!S.cur) return;
  fc();
  const previewDoc = JSON.parse(JSON.stringify(S.cur));
  previewDoc.feedbackLog = S.fbs ? JSON.parse(JSON.stringify(S.fbs)) : [];
  previewDoc.status = 'published';
  try {
    sessionStorage.setItem('procurement_preview_data', JSON.stringify(previewDoc));
  } catch(e) {}
  window.open('index.html?preview=1&t=' + Date.now(), '_blank');
}


let tempKw = [];
let curKwId = null;
let kmDirty = false;
let kmFilterStatus = 'all';
let kmDragKwId = null;

function initKeywordTab() {
  tempKw = JSON.parse(JSON.stringify(S.keywords || []));
  kmDirty = false;
  updateKMDirtyUI();
  if (!curKwId || !tempKw.some(c => c.id === curKwId)) {
    curKwId = tempKw.length > 0 ? tempKw[0].id : null;
  }
  renderKMCats();
  renderKWs();
}

function showKM() {
  openSettingsModal();
  switchSettingsTab('tab-keywords');
}

function hideKM() {
  const legacyKm = document.getElementById('km');
  if (legacyKm) legacyKm.classList.add('hidden');
}

function markKMDirty() {
  kmDirty = true;
  updateKMDirtyUI();
}

function updateKMDirtyUI() {
  const footer = document.getElementById('km-footer-bar');
  const hint = document.getElementById('km-dirty-hint');
  const resetBtn = document.getElementById('km-reset-btn');
  const saveBtn = document.getElementById('km-save-btn');
  if (!footer || !hint) return;
  if (kmDirty) {
    footer.classList.remove('bg-white', 'border-slate-200/80');
    footer.classList.add('bg-amber-50/90', 'border-amber-200');
    hint.className = 'text-xs font-bold text-amber-700 flex items-center gap-1';
    hint.innerHTML = '⚠️ <span>您有尚未儲存的關鍵字變更，請記得點擊右側「儲存關鍵字並發布生效」！</span>';
    if (resetBtn) resetBtn.classList.remove('hidden');
    if (saveBtn) saveBtn.classList.add('ring-2', 'ring-blue-300');
  } else {
    footer.classList.add('bg-white', 'border-slate-200/80');
    footer.classList.remove('bg-amber-50/90', 'border-amber-200');
    hint.className = 'text-xs text-slate-400';
    hint.textContent = '💡 可直接拖曳 ☰ 調整順序、點擊文字直接修改，完成後請點擊右側按鈕儲存生效。';
    if (resetBtn) resetBtn.classList.add('hidden');
    if (saveBtn) saveBtn.classList.remove('ring-2', 'ring-blue-300');
  }
}

function discardKMChanges() {
  if (!confirm('確定要放棄所有尚未儲存的關鍵字變更，還原為目前線上版本嗎？')) return;
  tempKw = JSON.parse(JSON.stringify(S.keywords || []));
  kmDirty = false;
  updateKMDirtyUI();
  if (!curKwId || !tempKw.some(c => c.id === curKwId)) {
    curKwId = tempKw.length > 0 ? tempKw[0].id : null;
  }
  renderKMCats();
  renderKWs();
  toast('已還原未儲存的關鍵字變更', 'in');
}

function setKMFilterStatus(val) {
  kmFilterStatus = val || 'all';
  renderKMCats();
  renderKWs();
}

function onKMSearchInput() {
  const inp = document.getElementById('km-search');
  const clearBtn = document.getElementById('km-search-clear');
  const q = inp ? inp.value.trim() : '';
  if (clearBtn) {
    if (q) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
  renderKMCats();
  renderKWs();
}

function clearKMSearch() {
  const inp = document.getElementById('km-search');
  if (inp) inp.value = '';
  onKMSearchInput();
}

function updateKMHeaderTitle() {
  const titleEl = document.getElementById('km-kw-title');
  if (!titleEl) return;
  const searchQ = (document.getElementById('km-search')?.value || '').trim();
  if (searchQ) {
    titleEl.textContent = `🔍 跨構面搜尋結果：「${searchQ}」`;
    return;
  }
  const cat = tempKw.find(c => c.id === curKwId);
  if (!cat) {
    titleEl.textContent = '請選擇左側母標題';
    return;
  }
  const kws = cat.keywords || [];
  const activeCount = kws.filter(k => k.isActive !== false).length;
  titleEl.textContent = `${cat.name} (啟用 ${activeCount} / 共 ${kws.length} 個子標題)`;
}

function renderKMCats() {
  const c = document.getElementById('km-cat-list');
  if (!c) return;

  let totalCats = tempKw.length;
  let totalKws = 0;
  let totalActiveKws = 0;
  tempKw.forEach(cat => {
    const kws = cat.keywords || [];
    totalKws += kws.length;
    totalActiveKws += kws.filter(k => k.isActive !== false).length;
  });

  const statsBadge = document.getElementById('km-stats-badge');
  if (statsBadge) {
    statsBadge.textContent = `${totalCats} 大構面 · 啟用 ${totalActiveKws} / 共 ${totalKws} 個子標題`;
  }
  const catCountLabel = document.getElementById('km-cat-count-label');
  if (catCountLabel) {
    catCountLabel.textContent = `${totalCats} 大構面`;
  }

  const searchQ = (document.getElementById('km-search')?.value || '').trim().toLowerCase();

  c.innerHTML = tempKw.map((cat, idx) => {
    const isSelected = cat.id === curKwId;
    const kws = cat.keywords || [];
    const activeCount = kws.filter(k => k.isActive !== false).length;
    const matchCount = searchQ
      ? kws.filter(k => (k.text || '').toLowerCase().includes(searchQ) || (cat.name || '').toLowerCase().includes(searchQ)).length
      : 0;
    const badgeText = activeCount === kws.length ? `${kws.length}` : `${activeCount}/${kws.length}`;

    return `
      <div onclick="selKMCat('${cat.id}')" class="group p-2.5 rounded-xl cursor-pointer transition-all duration-150 border ${
        isSelected
          ? 'bg-blue-50/80 border-blue-200 text-blue-900 shadow-xs font-bold ring-1 ring-blue-200/50'
          : (searchQ && matchCount > 0 ? 'bg-indigo-50/40 border-indigo-200 text-slate-800' : 'bg-white border-slate-200/70 text-slate-700 hover:bg-slate-50 hover:border-blue-100 shadow-xs')
      } flex items-center justify-between text-xs gap-1.5">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-600' : (searchQ && matchCount > 0 ? 'bg-indigo-500' : 'bg-slate-300 group-hover:bg-blue-400')} flex-shrink-0"></span>
          <span class="truncate" title="${xe(cat.name)}">${xe(cat.name)}</span>
          ${searchQ && matchCount > 0 ? `<span class="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded font-bold flex-shrink-0">命中 ${matchCount}</span>` : ''}
        </div>
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <span class="text-[11px] font-mono px-2 py-0.5 rounded-full ${isSelected ? 'bg-blue-100 text-blue-700 font-bold' : 'bg-slate-100 text-slate-500'}" title="啟用 ${activeCount} / 總計 ${kws.length}">${badgeText}</span>
          <div class="hidden group-hover:flex items-center gap-0.5 ml-0.5">
            <button onclick="event.stopPropagation(); renameKMCat('${cat.id}')" class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-100/60" title="重新命名母標題">✏️</button>
            <button onclick="event.stopPropagation(); moveKMCatOrder(${idx}, -1)" class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 ${idx === 0 ? 'opacity-30 pointer-events-none' : ''}" title="上移構面">↑</button>
            <button onclick="event.stopPropagation(); moveKMCatOrder(${idx}, 1)" class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 ${idx === tempKw.length - 1 ? 'opacity-30 pointer-events-none' : ''}" title="下移構面">↓</button>
            <button onclick="event.stopPropagation(); delKMCat('${cat.id}')" class="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50" title="刪除此母標題構面">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  updateKMHeaderTitle();
}

function selKMCat(id) {
  curKwId = id;
  const searchInp = document.getElementById('km-search');
  if (searchInp && searchInp.value.trim()) {
    searchInp.value = '';
    const clearBtn = document.getElementById('km-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
  }
  renderKMCats();
  renderKWs();
}

function addKMCat() {
  const inp = document.getElementById('km-new-cat-name');
  const name = inp ? inp.value.trim() : '';
  if (!name) return toast('請輸入新母標題（構面）名稱', 'er');
  if (tempKw.some(c => (c.name || '').trim().toLowerCase() === name.toLowerCase())) {
    return toast('此母標題名稱已存在', 'er');
  }
  const newCat = {
    id: 'cat_' + Date.now(),
    name,
    order: tempKw.length + 1,
    keywords: []
  };
  tempKw.push(newCat);
  if (inp) inp.value = '';
  curKwId = newCat.id;
  markKMDirty();
  renderKMCats();
  renderKWs();
  toast(`已新增母標題「${name}」（請記得點擊底部儲存生效）`, 'ok');
}

function renameKMCat(catId) {
  const cat = tempKw.find(c => c.id === catId);
  if (!cat) return;
  const newName = prompt('請輸入新的母標題（構面）名稱：', cat.name);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) return toast('母標題名稱不可為空', 'er');
  if (tempKw.some(c => c.id !== catId && (c.name || '').trim().toLowerCase() === trimmed.toLowerCase())) {
    return toast('此母標題名稱已存在', 'er');
  }
  cat.name = trimmed;
  markKMDirty();
  renderKMCats();
  renderKWs();
}

function moveKMCatOrder(idx, dir) {
  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= tempKw.length) return;
  const tmp = tempKw[idx];
  tempKw[idx] = tempKw[targetIdx];
  tempKw[targetIdx] = tmp;
  tempKw.forEach((c, i) => { c.order = i + 1; });
  markKMDirty();
  renderKMCats();
}

function delKMCat(catId) {
  const cat = tempKw.find(c => c.id === catId);
  if (!cat) return;
  if (!confirm(`確定要刪除母標題「${cat.name}」及其底下 ${(cat.keywords || []).length} 個關鍵字嗎？`)) return;
  tempKw = tempKw.filter(c => c.id !== catId);
  if (curKwId === catId) {
    curKwId = tempKw.length > 0 ? tempKw[0].id : null;
  }
  markKMDirty();
  renderKMCats();
  renderKWs();
}

function filterKWItemByStatus(k) {
  if (kmFilterStatus === 'active') return k.isActive !== false;
  if (kmFilterStatus === 'inactive') return k.isActive === false;
  return true;
}

function renderKWs() {
  const c = document.getElementById('km-kw-list');
  if (!c) return;
  updateKMHeaderTitle();

  const searchQ = (document.getElementById('km-search')?.value || '').trim().toLowerCase();

  // 若有輸入全域搜尋關鍵字，呈現跨構面搜尋結果
  if (searchQ) {
    const matchedRows = [];
    tempKw.forEach(cat => {
      (cat.keywords || []).sort((a, b) => a.order - b.order).forEach((k, idx) => {
        if (!filterKWItemByStatus(k)) return;
        if ((k.text || '').toLowerCase().includes(searchQ) || (cat.name || '').toLowerCase().includes(searchQ)) {
          matchedRows.push({ cat, k, idx });
        }
      });
    });

    if (matchedRows.length === 0) {
      c.innerHTML = `<div class="text-center text-slate-400 py-12 text-xs bg-white rounded-xl border border-dashed border-slate-200">找不到符合「${xe(searchQ)}」的關鍵字項目</div>`;
      return;
    }

    c.innerHTML = matchedRows.map(({ cat, k, idx }) => `
      <div class="flex items-center gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-indigo-200 transition-all">
        <button onclick="selKMCat('${cat.id}')" class="text-[11px] bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/80 px-2 py-0.5 rounded-md font-semibold flex-shrink-0" title="點擊切換至此構面">
          ${xe(cat.name)}
        </button>
        <span class="text-[11px] font-mono text-slate-400 w-6 text-center flex-shrink-0">#${idx + 1}</span>
        <div class="flex-1 min-w-0">
          <input type="text" class="w-full font-semibold text-xs ${k.isActive !== false ? 'text-slate-800' : 'text-slate-400 line-through'} border border-transparent hover:border-slate-200 focus:border-blue-400 rounded-lg px-2.5 py-1.5 bg-transparent focus:bg-white transition-all outline-none" value="${xe(k.text)}" onchange="uKWTextInCat('${cat.id}', '${k.id}', this.value)" placeholder="輸入子標題關鍵字名稱...">
        </div>
        <div class="flex items-center gap-1 border-l border-slate-100 pl-2.5 flex-shrink-0">
          <button onclick="tgKWActiveInCat('${cat.id}', '${k.id}')" class="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${k.isActive !== false ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
            ${k.isActive !== false ? '● 啟用中' : '○ 已停用'}
          </button>
          <button onclick="delKWInCat('${cat.id}', '${k.id}')" class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors" title="刪除此關鍵字">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `).join('');
    return;
  }

  const cat = tempKw.find(cat => cat.id === curKwId);
  if (!cat) {
    c.innerHTML = '<div class="text-center text-slate-400 mt-12 text-xs">請從左側選擇一個母標題來編輯對應的子標題。</div>';
    return;
  }
  if (!cat.keywords || cat.keywords.length === 0) {
    c.innerHTML = '<div class="text-center text-slate-400 py-12 text-xs bg-white rounded-xl border border-dashed border-slate-200">尚無任何關鍵字子標題，可於上方輸入框快速新增</div>';
    return;
  }

  cat.keywords.sort((a, b) => a.order - b.order);
  const visibleKws = cat.keywords.filter(filterKWItemByStatus);

  if (visibleKws.length === 0) {
    c.innerHTML = '<div class="text-center text-slate-400 py-12 text-xs bg-white rounded-xl border border-dashed border-slate-200">目前狀態篩選下沒有符合的關鍵字子標題</div>';
    return;
  }

  c.innerHTML = visibleKws.map((k) => {
    const realIdx = cat.keywords.findIndex(x => x.id === k.id);
    return `
      <div id="kw-row-${k.id}" draggable="true"
           ondragstart="onKWDragStart(event, '${k.id}')"
           ondragover="onKWDragOver(event)"
           ondrop="onKWDrop(event, '${k.id}')"
           ondragend="onKWDragEnd(event)"
           class="flex items-center gap-2.5 bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs hover:border-indigo-200 hover:shadow-sm transition-all group">
        <div class="cursor-move text-slate-300 hover:text-indigo-500 flex-shrink-0 p-1" title="按住上下拖曳排序">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </div>
        <span class="text-[11px] font-mono font-bold text-slate-400 w-6 text-center flex-shrink-0">#${realIdx + 1}</span>
        <div class="flex-1 min-w-0">
          <input id="kw-input-${k.id}" type="text" class="w-full font-semibold text-xs ${k.isActive !== false ? 'text-slate-800' : 'text-slate-400 line-through'} border border-transparent hover:border-slate-200 focus:border-blue-400 rounded-lg px-2.5 py-1.5 bg-transparent focus:bg-white transition-all outline-none" value="${xe(k.text)}" onchange="uKWText('${k.id}', this.value)" placeholder="輸入子標題關鍵字名稱...">
        </div>
        <div class="flex items-center gap-1 border-l border-slate-100 pl-2.5 flex-shrink-0">
          <button onclick="tgKWActive('${k.id}')" class="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${k.isActive !== false ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'}" title="點擊切換啟用或停用">
            ${k.isActive !== false ? '● 啟用中' : '○ 已停用'}
          </button>
          <button onclick="mvKWUp('${k.id}')" class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors ${realIdx === 0 ? 'opacity-30 pointer-events-none' : ''}" title="上移">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
          </button>
          <button onclick="mvKWDn('${k.id}')" class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors ${realIdx === cat.keywords.length - 1 ? 'opacity-30 pointer-events-none' : ''}" title="下移">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
          </button>
          <button onclick="delKW('${k.id}')" class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors" title="刪除此關鍵字">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function onKWDragStart(ev, kwId) {
  kmDragKwId = kwId;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', kwId);
  }
  if (ev.currentTarget) ev.currentTarget.classList.add('opacity-50');
}

function onKWDragOver(ev) {
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
}

function onKWDrop(ev, targetKwId) {
  ev.preventDefault();
  if (!kmDragKwId || kmDragKwId === targetKwId) return;
  const c = getCurCat();
  if (!c || !c.keywords) return;
  const fromIdx = c.keywords.findIndex(x => x.id === kmDragKwId);
  const toIdx = c.keywords.findIndex(x => x.id === targetKwId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = c.keywords.splice(fromIdx, 1);
  c.keywords.splice(toIdx, 0, moved);
  c.keywords.forEach((x, i) => { x.order = i + 1; });
  kmDragKwId = null;
  markKMDirty();
  renderKWs();
}

function onKWDragEnd(ev) {
  kmDragKwId = null;
  if (ev.currentTarget) ev.currentTarget.classList.remove('opacity-50');
}

function getCurCat() { return tempKw.find(cat => cat.id === curKwId); }

function uKWTextInCat(catId, kwId, val) {
  const c = tempKw.find(cat => cat.id === catId);
  if (!c || !c.keywords) return;
  const trimmed = (val || '').trim();
  if (!trimmed) {
    toast('關鍵字名稱不可為空', 'er');
    renderKWs();
    return;
  }
  const k = c.keywords.find(x => x.id === kwId);
  if (k && k.text !== trimmed) {
    k.text = trimmed;
    markKMDirty();
    renderKMCats();
  }
}

function uKWText(kwId, val) {
  if (!curKwId) return;
  uKWTextInCat(curKwId, kwId, val);
}

function tgKWActiveInCat(catId, kwId) {
  const c = tempKw.find(cat => cat.id === catId);
  if (!c || !c.keywords) return;
  const k = c.keywords.find(x => x.id === kwId);
  if (k) {
    k.isActive = (k.isActive === false ? true : false);
    markKMDirty();
    renderKMCats();
    renderKWs();
  }
}

function tgKWActive(kwId) {
  if (!curKwId) return;
  tgKWActiveInCat(curKwId, kwId);
}

function toggleAllCurCatKW(enable) {
  const c = getCurCat();
  if (!c || !c.keywords || c.keywords.length === 0) return;
  let changed = false;
  c.keywords.forEach(k => {
    const curState = k.isActive !== false;
    if (curState !== enable) {
      k.isActive = enable;
      changed = true;
    }
  });
  if (changed) {
    markKMDirty();
    renderKMCats();
    renderKWs();
    toast(enable ? `已將「${c.name}」全部子標題設為啟用` : `已將「${c.name}」全部子標題設為停用`, 'in');
  }
}

function addKW() {
  const c = getCurCat();
  if (!c) return toast('請先選擇左側母標題', 'er');
  if (!c.keywords) c.keywords = [];

  const inp = document.getElementById('km-new-kw-input');
  const rawText = inp ? inp.value.trim() : '';
  const text = rawText || '新關鍵字';

  if (rawText && c.keywords.some(k => (k.text || '').trim().toLowerCase() === rawText.toLowerCase())) {
    return toast(`「${c.name}」底下已存在名為「${rawText}」的關鍵字`, 'er');
  }

  const newId = 'kw_' + Date.now();
  c.keywords.push({
    id: newId,
    text,
    isActive: true,
    order: c.keywords.length + 1
  });

  if (inp) inp.value = '';
  markKMDirty();
  renderKMCats();
  renderKWs();

  setTimeout(() => {
    if (rawText) {
      if (inp) inp.focus();
      const rowEl = document.getElementById(`kw-row-${newId}`);
      if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      const targetInp = document.getElementById(`kw-input-${newId}`);
      if (targetInp) {
        targetInp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        targetInp.focus();
        targetInp.select();
      }
    }
  }, 30);
}

function delKWInCat(catId, kwId) {
  const c = tempKw.find(cat => cat.id === catId);
  if (!c || !c.keywords) return;
  const k = c.keywords.find(x => x.id === kwId);
  if (!k) return;
  if (!confirm(`確定要從「${c.name}」刪除關鍵字「${k.text}」嗎？`)) return;
  c.keywords = c.keywords.filter(x => x.id !== kwId);
  c.keywords.forEach((x, i) => { x.order = i + 1; });
  markKMDirty();
  renderKMCats();
  renderKWs();
}

function delKW(kwId) {
  if (!curKwId) return;
  delKWInCat(curKwId, kwId);
}

function mvKWUp(kwId) {
  const c = getCurCat();
  if (!c || !c.keywords) return;
  const idx = c.keywords.findIndex(x => x.id === kwId);
  if (idx > 0) {
    [c.keywords[idx - 1], c.keywords[idx]] = [c.keywords[idx], c.keywords[idx - 1]];
    c.keywords.forEach((x, i) => { x.order = i + 1; });
    markKMDirty();
    renderKWs();
  }
}

function mvKWDn(kwId) {
  const c = getCurCat();
  if (!c || !c.keywords) return;
  const idx = c.keywords.findIndex(x => x.id === kwId);
  if (idx < c.keywords.length - 1) {
    [c.keywords[idx], c.keywords[idx + 1]] = [c.keywords[idx + 1], c.keywords[idx]];
    c.keywords.forEach((x, i) => { x.order = i + 1; });
    markKMDirty();
    renderKWs();
  }
}

async function saveKMDb() {
  try {
    await DS.saveKeywords(tempKw);
    S.keywords = JSON.parse(JSON.stringify(tempKw));
    kmDirty = false;
    updateKMDirtyUI();
    toast('關鍵字資料庫已更新並生效！', 'ok');
    hideKM();
    if (S.cur) renderSecs();
  } catch (e) {
    toast('儲存失敗：' + (e.message || e), 'er');
  }
}

let editWLIndex = null;
let filterWLPrimaryOnly = false;

const REGION_DEFAULT_UNIT_MAP = {
  '工程處': '工程處',
  '經營Team': '經營Team',
  '台北': '北區營運處',
  '新北': '北區營運處',
  '桃園': '桃園營運處',
  '新竹': '新竹營運處',
  '苗栗': '苗栗營運處',
  '台中': '台中營運處',
  '嘉義': '嘉義營運處',
  '台南': '台南營運處',
  '高雄': '高雄營運處',
  '屏東': '屏東營運處',
  '台東': '台東營運處'
};

function onWLRegionChange(regionVal) {
  const unitEl = document.getElementById('wl-unit');
  if (!unitEl) return;
  const curUnit = unitEl.value.trim();
  const isDefaultUnit = !curUnit || Object.values(REGION_DEFAULT_UNIT_MAP).includes(curUnit) || curUnit.endsWith('營運處');
  if (regionVal && REGION_DEFAULT_UNIT_MAP[regionVal] && isDefaultUnit) {
    unitEl.value = REGION_DEFAULT_UNIT_MAP[regionVal];
  } else if (!regionVal && isDefaultUnit) {
    unitEl.value = '';
  }
}

function cancelEditWL() {
  editWLIndex = null;
  document.getElementById('wl-name').value = '';
  document.getElementById('wl-email').value = '';
  document.getElementById('wl-region').value = '';
  if (document.getElementById('wl-unit')) document.getElementById('wl-unit').value = '';
  if (document.getElementById('wl-primary')) document.getElementById('wl-primary').checked = false;
  document.getElementById('wl-receive').checked = true;
  document.getElementById('wl-btn').innerText = '新增';
  const cancelBtn = document.getElementById('wl-cancel-btn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  const editHint = document.getElementById('wl-edit-hint');
  if (editHint) editHint.classList.add('hidden');
  const formCard = document.getElementById('wl-form-card');
  if (formCard) {
    formCard.classList.remove('ring-2', 'ring-blue-400', 'bg-blue-50/40', 'border-blue-300');
  }
  renderWL();
}

async function addWL() {
  const n = document.getElementById('wl-name').value.trim();
  const e = document.getElementById('wl-email').value.trim();
  const region = document.getElementById('wl-region').value;
  let unit = document.getElementById('wl-unit') ? document.getElementById('wl-unit').value.trim() : '';
  if (!unit && region && REGION_DEFAULT_UNIT_MAP[region]) {
    unit = REGION_DEFAULT_UNIT_MAP[region];
  }
  const isPrimary = document.getElementById('wl-primary') ? document.getElementById('wl-primary').checked : false;
  const receiveEmail = document.getElementById('wl-receive').checked;
  if (!n || !e) return toast('請填寫聯絡人姓名與電子郵件', 'er');

  // 檢查 Email 是否重複
  const emailLower = e.toLowerCase();
  const dupIdx = S.whitelist.findIndex((w, i) => i !== editWLIndex && (w.email || '').trim().toLowerCase() === emailLower);
  if (dupIdx !== -1) {
    return toast(`此信箱已存在於通訊錄中（${S.whitelist[dupIdx].name}），請直接編輯該筆資料`, 'er');
  }

  const newData = { name: n, email: e, region, unit, isPrimary, receiveEmail };
  if (editWLIndex !== null) {
    const oldEmail = (S.whitelist[editWLIndex]?.email || '').trim().toLowerCase();
    S.whitelist[editWLIndex] = newData;
    // 若修改了信箱，同步更新發信群組內的信箱參照
    if (oldEmail && oldEmail !== emailLower && Array.isArray(S.mailGroups)) {
      let grpUpdated = false;
      S.mailGroups.forEach(g => {
        if (Array.isArray(g.emails)) {
          g.emails = g.emails.map(em => {
            if ((em || '').trim().toLowerCase() === oldEmail) {
              grpUpdated = true;
              return e;
            }
            return em;
          });
        }
      });
      if (grpUpdated) await DS.saveMailGroups(S.mailGroups);
    }
    toast('已更新聯絡人資料 ✓', 'ok');
  } else {
    S.whitelist.push(newData);
    toast('已新增聯絡人 ✓', 'ok');
  }
  await DS.saveWhitelist(S.whitelist);
  cancelEditWL();
}

function editWL(idx) {
  if (!S.whitelist[idx]) return;
  editWLIndex = idx;
  document.getElementById('wl-name').value = S.whitelist[idx].name || '';
  document.getElementById('wl-email').value = S.whitelist[idx].email || '';
  document.getElementById('wl-region').value = S.whitelist[idx].region || '';
  if (document.getElementById('wl-unit')) document.getElementById('wl-unit').value = S.whitelist[idx].unit || '';
  if (document.getElementById('wl-primary')) document.getElementById('wl-primary').checked = S.whitelist[idx].isPrimary === true;
  document.getElementById('wl-receive').checked = (S.whitelist[idx].receiveEmail !== false);
  document.getElementById('wl-btn').innerText = '儲存修改';

  const cancelBtn = document.getElementById('wl-cancel-btn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  const editHint = document.getElementById('wl-edit-hint');
  if (editHint) {
    editHint.textContent = `✏️ 正在編輯：${S.whitelist[idx].name}`;
    editHint.classList.remove('hidden');
  }
  const formCard = document.getElementById('wl-form-card');
  if (formCard) {
    formCard.classList.add('ring-2', 'ring-blue-400', 'bg-blue-50/40', 'border-blue-300');
    formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  renderWL();
  document.getElementById('wl-name').focus();
}

async function quickToggleWLPrimary(idx) {
  if (!S.whitelist[idx]) return;
  S.whitelist[idx].isPrimary = !S.whitelist[idx].isPrimary;
  if (editWLIndex === idx && document.getElementById('wl-primary')) {
    document.getElementById('wl-primary').checked = S.whitelist[idx].isPrimary;
  }
  await DS.saveWhitelist(S.whitelist);
  renderWL();
  toast(
    S.whitelist[idx].isPrimary
      ? `⭐ 已將「${S.whitelist[idx].name}」設為主要聯絡人`
      : `已取消「${S.whitelist[idx].name}」的主要聯絡人標記`,
    'in'
  );
}

async function quickToggleWLReceive(idx) {
  if (!S.whitelist[idx]) return;
  const cur = S.whitelist[idx].receiveEmail !== false;
  S.whitelist[idx].receiveEmail = !cur;
  if (editWLIndex === idx && document.getElementById('wl-receive')) {
    document.getElementById('wl-receive').checked = S.whitelist[idx].receiveEmail;
  }
  await DS.saveWhitelist(S.whitelist);
  renderWL();
  toast(
    S.whitelist[idx].receiveEmail
      ? `✉️ 已開啟「${S.whitelist[idx].name}」接收信件通知`
      : `🔕 已暫停「${S.whitelist[idx].name}」接收信件通知`,
    'in'
  );
}

function toggleWLPrimaryFilter() {
  filterWLPrimaryOnly = !filterWLPrimaryOnly;
  const btn = document.getElementById('wl-filter-primary-btn');
  if (btn) {
    if (filterWLPrimaryOnly) {
      btn.className = 'text-xs px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-100 text-amber-800 font-bold flex items-center gap-1 flex-shrink-0 shadow-xs transition-colors';
    } else {
      btn.className = 'text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/60 text-slate-600 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 transition-colors font-medium flex items-center gap-1 flex-shrink-0';
    }
  }
  renderWL();
}

async function rmWL(idx) {
  if (!S.whitelist[idx]) return;
  if (!confirm(`確定要刪除「${S.whitelist[idx].name} (${S.whitelist[idx].email})」嗎？`)) return;
  if (editWLIndex === idx) cancelEditWL();
  S.whitelist.splice(idx, 1);
  await DS.saveWhitelist(S.whitelist);
  await sanitizeAllGroupEmails();
  renderWL();
  toast('已刪除聯絡人', 'ok');
}

let isBatchMode = false;
let selectedWL = [];

function updateBatchSelectedCount() {
  const el = document.getElementById('batch-selected-count');
  if (el) el.textContent = `已選 ${selectedWL.length} 人`;
}

function toggleBatchMode() {
  isBatchMode = !isBatchMode;
  selectedWL = [];
  const btn = document.getElementById('btn-batch-mode');
  const acts = document.getElementById('batch-actions');
  if (isBatchMode) {
    btn.classList.replace('bg-slate-100', 'bg-blue-600');
    btn.classList.replace('text-slate-600', 'text-white');
    btn.classList.replace('hover:bg-slate-200', 'hover:bg-blue-700');
    if (acts) acts.classList.remove('hidden');
  } else {
    btn.classList.replace('bg-blue-600', 'bg-slate-100');
    btn.classList.replace('text-white', 'text-slate-600');
    btn.classList.replace('hover:bg-blue-700', 'hover:bg-slate-200');
    if (acts) acts.classList.add('hidden');
  }
  updateBatchSelectedCount();
  renderWL();
}

function toggleWLCb(email, checked) {
  if (checked) {
    if (!selectedWL.includes(email)) selectedWL.push(email);
  } else {
    selectedWL = selectedWL.filter(e => e !== email);
  }
  updateBatchSelectedCount();
}

function getFilteredWLList() {
  const searchEl = document.getElementById('wl-search');
  const regionEl = document.getElementById('wl-filter-region');
  const kw = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const regionKw = regionEl ? regionEl.value : '';

  let list = S.whitelist || [];
  if (regionKw) {
    list = list.filter(w => w.region === regionKw);
  }
  if (filterWLPrimaryOnly) {
    list = list.filter(w => w.isPrimary === true);
  }
  if (kw) {
    list = list.filter(w => {
      const userEmailLower = (w.email || '').trim().toLowerCase();
      const userGroups = (S.mailGroups || [])
        .filter(g => Array.isArray(g.emails) && g.emails.some(em => (em || '').trim().toLowerCase() === userEmailLower))
        .map(g => (g.name || '').toLowerCase())
        .join(' ');
      return (
        (w.name || '').toLowerCase().includes(kw) ||
        userEmailLower.includes(kw) ||
        (w.unit || '').toLowerCase().includes(kw) ||
        (w.region || '').toLowerCase().includes(kw) ||
        userGroups.includes(kw)
      );
    });
  }
  return list;
}

function toggleSelectAllVisibleWL() {
  const visibleList = getFilteredWLList();
  if (visibleList.length === 0) return;
  const visibleEmails = visibleList.map(w => w.email);
  const allSelected = visibleEmails.every(em => selectedWL.includes(em));
  if (allSelected) {
    selectedWL = selectedWL.filter(em => !visibleEmails.includes(em));
  } else {
    visibleEmails.forEach(em => {
      if (!selectedWL.includes(em)) selectedWL.push(em);
    });
  }
  updateBatchSelectedCount();
  renderWL();
}

async function batchDeleteWL() {
  if (selectedWL.length === 0) return toast('請先勾選名單', 'er');
  if (!confirm(`確定要刪除選取的 ${selectedWL.length} 筆名單嗎？`)) return;
  S.whitelist = S.whitelist.filter(w => !selectedWL.includes(w.email));
  await DS.saveWhitelist(S.whitelist);
  await sanitizeAllGroupEmails();
  selectedWL = [];
  updateBatchSelectedCount();
  renderWL();
  toast('已批次刪除', 'ok');
}

function openBatchGroupModal() {
  if (selectedWL.length === 0) return toast('請先勾選名單', 'er');
  document.getElementById('batch-group-modal').classList.remove('hidden');
  const c = document.getElementById('batch-group-list');
  if (S.mailGroups.length === 0) {
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
  if (cbs.length === 0) return toast('請勾選至少一個群組', 'er');

  const targetGroupIds = Array.from(cbs).map(cb => cb.value);
  let changed = false;

  S.mailGroups.forEach(g => {
    if (targetGroupIds.includes(g.id)) {
      selectedWL.forEach(email => {
        if (!g.emails.includes(email)) {
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

function exportWLExcel() {
  if (!S.whitelist || S.whitelist.length === 0) {
    return toast('目前通訊錄無資料可匯出', 'er');
  }
  const rows = S.whitelist.map(w => {
    const emailLower = (w.email || '').trim().toLowerCase();
    const groups = (S.mailGroups || [])
      .filter(g => Array.isArray(g.emails) && g.emails.some(em => (em || '').trim().toLowerCase() === emailLower))
      .map(g => g.name)
      .join('、');
    return {
      '地區': w.region || '',
      '單位': w.unit || '',
      '姓名': w.name || '',
      '電子郵件': w.email || '',
      '主要聯絡人': w.isPrimary ? '是' : '否',
      '接收信件通知': w.receiveEmail !== false ? '是' : '否',
      '所屬群組': groups
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '郵件通訊錄');
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(wb, `採購週報_郵件通訊錄_${dateStr}.xlsx`);
  toast('已匯出通訊錄 Excel 檔案 ✓', 'ok');
}

async function importWLExcel(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    if (!rows || rows.length === 0) {
      toast('Excel 檔案中沒有可讀取的資料列', 'er');
      inputEl.value = '';
      return;
    }
    let addedCount = 0;
    let updatedCount = 0;
    rows.forEach(r => {
      const name = String(r['姓名'] || r['聯絡人姓名'] || r['name'] || r['Name'] || '').trim();
      const email = String(r['電子郵件'] || r['信箱'] || r['Email'] || r['email'] || '').trim();
      if (!name || !email || !email.includes('@')) return;
      const region = String(r['地區'] || r['region'] || '').trim();
      const unit = String(r['單位'] || r['unit'] || (region && REGION_DEFAULT_UNIT_MAP[region] ? REGION_DEFAULT_UNIT_MAP[region] : '')).trim();
      const primaryRaw = String(r['主要聯絡人'] || r['isPrimary'] || '').trim().toLowerCase();
      const isPrimary = ['是', 'true', '1', 'y', 'yes', '⭐', '主要'].includes(primaryRaw);
      const recvRaw = String(r['接收信件通知'] || r['收信'] || r['receiveEmail'] || '是').trim().toLowerCase();
      const receiveEmail = !['否', 'false', '0', 'n', 'no', '停用'].includes(recvRaw);

      const emailLower = email.toLowerCase();
      const existIdx = S.whitelist.findIndex(w => (w.email || '').trim().toLowerCase() === emailLower);
      const entry = { name, email, region, unit, isPrimary, receiveEmail };
      if (existIdx !== -1) {
        S.whitelist[existIdx] = entry;
        updatedCount++;
      } else {
        S.whitelist.push(entry);
        addedCount++;
      }
    });
    if (addedCount > 0 || updatedCount > 0) {
      await DS.saveWhitelist(S.whitelist);
      renderWL();
      toast(`匯入完成：新增 ${addedCount} 筆、更新 ${updatedCount} 筆聯絡人 ✓`, 'ok');
    } else {
      toast('未偵測到有效的「姓名」與「電子郵件」欄位', 'er');
    }
  } catch (err) {
    console.error('importWLExcel error:', err);
    toast('匯入 Excel 失敗：' + (err.message || err), 'er');
  } finally {
    inputEl.value = '';
  }
}

function renderWL() {
  const c = document.getElementById('wl-list');
  if (!c) return;

  const totalCount = (S.whitelist || []).length;
  const primaryCount = (S.whitelist || []).filter(w => w.isPrimary === true).length;
  const list = getFilteredWLList();

  const statsBadge = document.getElementById('wl-stats-badge');
  if (statsBadge) {
    if (list.length !== totalCount) {
      statsBadge.textContent = `篩選 ${list.length} / 共 ${totalCount} 人 · ⭐主要 ${primaryCount} 人`;
    } else {
      statsBadge.textContent = `共 ${totalCount} 人 · ⭐主要 ${primaryCount} 人`;
    }
  }

  if (list.length === 0) {
    c.innerHTML = '<div class="col-span-full text-center text-slate-400 py-12 text-sm bg-white rounded-xl border border-dashed border-slate-200">找不到符合條件的通訊名單</div>';
    return;
  }

  c.innerHTML = list.map((w) => {
    const origIdx = S.whitelist.findIndex(x => x.email === w.email && x.name === w.name);
    const safeIdx = origIdx !== -1 ? origIdx : S.whitelist.findIndex(x => x.email === w.email);
    const isEditingThis = editWLIndex === safeIdx;

    const regionBadge = w.region ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200/80">${xe(w.region)}</span>` : '';
    const unitBadge = w.unit ? `<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">${xe(w.unit)}</span>` : '';

    // 可一鍵切換的「⭐ 主要」按鈕標籤
    const primaryToggleBtn = w.isPrimary
      ? `<button type="button" onclick="quickToggleWLPrimary(${safeIdx})" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 shadow-xs transition-colors cursor-pointer" title="點擊可取消主要聯絡人">⭐ 主要</button>`
      : `<button type="button" onclick="quickToggleWLPrimary(${safeIdx})" class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-50 hover:bg-amber-50 text-slate-400 hover:text-amber-600 border border-slate-200/70 hover:border-amber-200 opacity-0 group-hover:opacity-100 transition-all cursor-pointer" title="點擊設為主要聯絡人">☆ 設為主要</button>`;

    // 可一鍵切換的「收信 / 停用」按鈕標籤
    const receiveToggleBtn = (w.receiveEmail !== false)
      ? `<button type="button" onclick="quickToggleWLReceive(${safeIdx})" class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-100 transition-colors cursor-pointer" title="點擊可暫停接收信件通知">收信</button>`
      : `<button type="button" onclick="quickToggleWLReceive(${safeIdx})" class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-rose-50 hover:bg-rose-100 text-rose-500 border border-rose-200 transition-colors cursor-pointer" title="點擊可恢復接收信件通知">🔕 停用</button>`;

    // 查詢此聯絡人所屬的發信群組
    const emailLower = (w.email || '').trim().toLowerCase();
    const userGroups = (S.mailGroups || []).filter(g => Array.isArray(g.emails) && g.emails.some(em => (em || '').trim().toLowerCase() === emailLower));
    const groupBadges = userGroups.map(g => `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50/80 text-indigo-600 border border-indigo-100" title="所屬發信群組：${xe(g.name)}">👥 ${xe(g.name)}</span>`).join('');

    return `
      <div class="group flex items-center justify-between gap-3 p-3 bg-white rounded-xl border transition-all duration-150 ${
        isEditingThis
          ? 'ring-2 ring-blue-500 border-blue-400 bg-blue-50/20 shadow-sm'
          : (w.isPrimary
              ? 'border-amber-200/90 shadow-xs bg-gradient-to-r from-amber-50/20 to-white hover:border-amber-300'
              : 'border-slate-200/80 hover:border-indigo-200 hover:shadow-xs')
      }">
        <div class="flex items-center gap-3 min-w-0 flex-1">
          ${isBatchMode ? `
            <input type="checkbox" onchange="toggleWLCb('${xe(w.email)}', this.checked)" class="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 cursor-pointer" ${selectedWL.includes(w.email) ? 'checked' : ''}>
          ` : ''}
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5 mb-1">
              <span class="font-bold text-slate-800 text-sm tracking-tight">${xe(w.name)}</span>
              ${primaryToggleBtn}
              ${regionBadge}
              ${unitBadge}
              ${receiveToggleBtn}
              ${groupBadges}
            </div>
            <div class="text-xs text-slate-400 font-mono truncate flex items-center gap-1">
              <svg class="w-3 h-3 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              <span>${xe(w.email)}</span>
            </div>
          </div>
        </div>
        ${!isBatchMode ? `
          <div class="flex items-center gap-1 flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
            <button onclick="editWL(${safeIdx})" class="w-8 h-8 rounded-lg flex items-center justify-center ${isEditingThis ? 'text-blue-600 bg-blue-100' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'} transition-colors" title="修改聯絡人">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button onclick="rmWL(${safeIdx})" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="刪除">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
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

  if (S.whitelist.length === 0) {
    S.whitelist = await DS.getWhitelist();
  }

  const prevAuthLower = (S.cur.authorizedEmails && S.cur.authorizedEmails.length > 0)
    ? S.cur.authorizedEmails.map(e => (e || '').trim().toLowerCase())
    : null;

  const c = document.getElementById('pub-wl-list');
  c.innerHTML = S.whitelist.map((w, i) => {
    const isChecked = prevAuthLower ? prevAuthLower.includes((w.email || '').trim().toLowerCase()) : true;
    return `
    <label class="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer border border-slate-100 transition-colors">
      <input type="checkbox" class="pub-wl-cb w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500" value="${w.email}" ${isChecked ? 'checked' : ''} data-email="${w.email}">
      <div class="flex flex-col"><span class="text-sm font-semibold text-slate-700">${w.name}</span><span class="text-xs text-slate-400 mt-0.5">${w.email}</span></div>
    </label>
  `;}).join('');

  const allCbs = document.querySelectorAll('.pub-wl-cb');
  const allChecked = Array.from(allCbs).length > 0 && Array.from(allCbs).every(cb => cb.checked);
  document.getElementById('pub-wl-all').checked = allChecked;
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
    const isConfidential = document.getElementById('pub-confidential') ? document.getElementById('pub-confidential').checked : false;
    const d={...S.cur, status:'published', feedbackLog:S.fbs, isConfidential: isConfidential};
    
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
        
        // 專門用於將富文本內容安全轉換為優美電子郵件 HTML 的處理函式
        function formatContentForEmail(htmlContent) {
          if (!htmlContent) return '';
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            
            // 1. 處理表格：保留結構並加上 Outlook / 郵件客戶端通用的內聯樣式
            doc.querySelectorAll('table').forEach(tbl => {
              tbl.setAttribute('style', 'width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13px; font-family: "Microsoft JhengHei", sans-serif;');
              tbl.setAttribute('border', '1');
              tbl.setAttribute('cellpadding', '6');
              tbl.setAttribute('cellspacing', '0');
              tbl.querySelectorAll('th').forEach(th => {
                th.setAttribute('style', 'background-color: #f1f5f9; color: #1e293b; font-weight: bold; padding: 6px 8px; border: 1px solid #cbd5e1; text-align: left; font-size: 12px;');
              });
              tbl.querySelectorAll('td').forEach(td => {
                td.setAttribute('style', 'padding: 6px 8px; border: 1px solid #cbd5e1; color: #334155; vertical-align: top; font-size: 12px;');
              });
            });
            
            // 2. 處理圖片：限制最大寬度與邊距
            doc.querySelectorAll('img').forEach(img => {
              img.setAttribute('style', 'max-width: 100%; max-height: 400px; display: block; margin: 8px 0; border-radius: 4px;');
            });

            // 3. 處理段落與換行：將 </p>, </div>, </h1>~</h6> 結尾補上 <br>
            doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6').forEach(el => {
              if (el.tagName.toLowerCase() !== 'div' || !el.querySelector('table')) {
                const br = doc.createElement('br');
                el.parentNode.insertBefore(br, el.nextSibling);
              }
            });

            // 取出處理後的 HTML 並剝除危險標籤
            let out = doc.body.innerHTML;
            
            // 移除不支援或多餘的標籤，但保留 table, thead, tbody, tr, th, td, img, br, strong, b, span, a
            out = out.replace(/<(?!\/?(?:table|thead|tbody|tr|th|td|colgroup|col|img|br|strong|b|span|a|font))[^>]+>/gi, '');
            
            // 清理連續過多的 <br>
            out = out.replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
            return out.trim();
          } catch(err) {
            console.error('formatContentForEmail error:', err);
            return htmlContent.replace(/<[^>]+>/g, '').trim();
          }
        }

        (d.sections || []).forEach(sec => {
          (sec.items || []).forEach(item => {
            if (item.priority === 'high' && item.content) {
              let formatted = formatContentForEmail(item.content);
              if (formatted) importantItems.push(formatted);
            }
          });
          (sec.subsections || []).forEach(sub => {
            (sub.items || []).forEach(item => {
              if (item.priority === 'high' && item.content) {
                let formatted = formatContentForEmail(item.content);
                if (formatted) importantItems.push(formatted);
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
    
    S.cur = d;
    S.dirty=false;
    const sb=document.getElementById('tb-status'); sb.className='bdg-pub'; sb.textContent='已發布';
    document.getElementById('btn-unpub').classList.remove('hidden');
    document.getElementById('btn-pub').classList.add('hidden');
    toast('🎉 週報已正式發布並寄出通知信！', 'ok');
    S.mmap = await DS.getMonths();
    renderSB();
    renderReadReceipts(d.id);
    renderAuditLogs(d.id);
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
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.remove('hidden');
    switchSettingsTab('tab-handover');
  } else {
    const oldModal = document.getElementById('handover-modal');
    if (oldModal) oldModal.classList.remove('hidden');
  }
}

function hideHandover() {
  const oldModal = document.getElementById('handover-modal');
  if (oldModal) oldModal.classList.add('hidden');
  closeSettingsModal();
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
    if (user) {
      const userEmail = user.email.toLowerCase();
      const allowedEmails = ADMIN_EMAILS.map(e => e.toLowerCase());
      if (userEmail.endsWith('@youbike.com.tw') || allowedEmails.includes(userEmail)) {
        const snap = await db.collection('systemConfig').doc('admins').get();
        const adminList = snap.exists ? (snap.data().list || []) : [];
        if (adminList.some(a => a.email.toLowerCase() === userEmail) || allowedEmails.includes(userEmail)) {
          document.getElementById('lo').style.display = 'none';
          await init();
          return;
        }
      }
    }
    document.getElementById('lo').style.display = 'flex';
  });
});


// KPI Logic
let currentKPIOffset = 0;
let kpiDataCache = {};

function closeKPIModal() {
  document.getElementById('kpi-modal').classList.add('hidden');
}

async function fetchKPIData(monthOffset) {
  const targetDate = new Date();
  targetDate.setMonth(targetDate.getMonth() + monthOffset);
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth();
  
  const monthStr = `${targetYear} 年 ${targetMonth + 1} 月`;
  
  // 1. Get whitelist
  const snapW = await db.collection('systemConfig').doc('whitelist').get();
  const whitelist = snapW.exists ? (snapW.data().list || []) : [];
  
  // 檢查是否有名單明確設定過 isPrimary
  const hasExplicitPrimary = whitelist.some(w => w && w.isPrimary === true);

  const unitPrimaryCount = {};
  const allUnits = new Set();
  const primaryByUnit = {};

  whitelist.forEach(w => {
    // 單位名稱支援 w.unit 或 w.region 回退機制
    const rawUnit = (w.unit || w.region || '').trim();
    if (!rawUnit) return;
    allUnits.add(rawUnit);

    // 判定是否為該單位的主要統計代表：
    // 若系統中已有名單設為 isPrimary，則依照 isPrimary 判定；
    // 若全系統尚未有人設定 isPrimary，則自動將各營運處全員視為應閱讀窗口！
    const isTargetPrimary = hasExplicitPrimary ? (w.isPrimary === true) : true;

    if (isTargetPrimary) {
      unitPrimaryCount[rawUnit] = (unitPrimaryCount[rawUnit] || 0) + 1;
      if (!primaryByUnit[rawUnit]) primaryByUnit[rawUnit] = [];
      let found = primaryByUnit[rawUnit].find(p => p.name === w.name);
      if (!found) {
        found = { name: w.name, emails: new Set() };
        primaryByUnit[rawUnit].push(found);
      }
      if (w.email) found.emails.add(w.email.trim().toLowerCase());
    }
  });

  // Also link alternate emails of the same person in the same unit
  whitelist.forEach(w => {
    const rawUnit = (w.unit || w.region || '').trim();
    if (!rawUnit) return;
    if (primaryByUnit[rawUnit]) {
      const found = primaryByUnit[rawUnit].find(p => p.name === w.name);
      if (found && w.email) {
        found.emails.add(w.email.trim().toLowerCase());
      }
    }
  });

  const missingUnits = [];
  const validUnits = [];
  allUnits.forEach(u => {
    if (!unitPrimaryCount[u]) {
      missingUnits.push(u);
    } else {
      validUnits.push(u);
    }
  });

  // 2. Get bulletins for the month by publishDate / monthKey (avoids composite index failure)
  const targetMonthPrefix = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;
  const snapB = await db.collection('bulletins')
    .where('status', '==', 'published')
    .get();
    
  let bulletinIds = [];
  snapB.forEach(d => {
    const data = d.data();
    const pDate = data.publishDate || (data.meta && data.meta.publishedAt ? data.meta.publishedAt.slice(0, 10) : '');
    const mKey = data.monthKey || pDate.slice(0, 7);
    if (mKey === targetMonthPrefix || pDate.startsWith(targetMonthPrefix)) {
      bulletinIds.push(d.id);
    }
  });
  let bulletinCount = bulletinIds.length;

  // 3. Process reads with support for primary contact multi-email & name matching
  const unitConfirmed = {};
  const unitTotalProgress = {};
  const unitFirstConfirmedTime = {};
  validUnits.forEach(u => {
    unitConfirmed[u] = 0;
    unitTotalProgress[u] = 0;
    unitFirstConfirmedTime[u] = Infinity;
  });

  for (let bId of bulletinIds) {
    const snapR = await db.collection('bulletins').doc(bId).collection('readReceipts').get();
    const readerMap = new Map();
    snapR.forEach(r => {
      const data = r.data();
      // 只要同仁有確認打卡 (confirmed: true) 或已有讀取紀錄，該篇進度視為 100%
      let prog = 100;
      if (data.confirmed === false) {
        prog = typeof data.readProgress === 'number' ? data.readProgress : 0;
      } else {
        prog = (typeof data.readProgress === 'number' && data.readProgress > 0) ? 100 : 100;
      }
      let timeMs = Infinity;
      if (data.confirmedAt && typeof data.confirmedAt.toDate === 'function') {
        timeMs = data.confirmedAt.toDate().getTime();
      } else if (data.confirmedAt && data.confirmedAt.seconds) {
        timeMs = data.confirmedAt.seconds * 1000;
      } else if (data.confirmedAt) {
        timeMs = new Date(data.confirmedAt).getTime() || Infinity;
      } else if (data.readAt && typeof data.readAt.toDate === 'function') {
        timeMs = data.readAt.toDate().getTime();
      } else if (data.readAt && data.readAt.seconds) {
        timeMs = data.readAt.seconds * 1000;
      } else if (data.readAt) {
        timeMs = new Date(data.readAt).getTime() || Infinity;
      } else if (data.lastViewedAt && typeof data.lastViewedAt.toDate === 'function') {
        timeMs = data.lastViewedAt.toDate().getTime();
      } else if (data.lastViewedAt && data.lastViewedAt.seconds) {
        timeMs = data.lastViewedAt.seconds * 1000;
      } else if (data.lastViewedAt) {
        timeMs = new Date(data.lastViewedAt).getTime() || Infinity;
      }

      const info = { prog, timeMs };
      if (r.id) readerMap.set(r.id.toLowerCase(), info);
      if (data.email) readerMap.set(data.email.trim().toLowerCase(), info);
      if (data.displayName) readerMap.set(data.displayName.trim(), info);
    });
    
    validUnits.forEach(u => {
      const primaries = primaryByUnit[u] || [];
      primaries.forEach(p => {
        let hasRead = false;
        let bestProg = 0;
        let earliestTime = Infinity;
        for (let em of p.emails) {
          if (readerMap.has(em)) {
            hasRead = true;
            const item = readerMap.get(em);
            bestProg = Math.max(bestProg, item.prog);
            if (item.timeMs < earliestTime) earliestTime = item.timeMs;
          }
        }
        if (!hasRead && p.name && readerMap.has(p.name)) {
          hasRead = true;
          const item = readerMap.get(p.name);
          bestProg = Math.max(bestProg, item.prog);
          if (item.timeMs < earliestTime) earliestTime = item.timeMs;
        }
        if (hasRead) {
          unitConfirmed[u]++;
          unitTotalProgress[u] += bestProg;
          if (earliestTime < unitFirstConfirmedTime[u]) {
            unitFirstConfirmedTime[u] = earliestTime;
          }
        }
      });
    });
  }

  // 4. Compile stats
  let totalExpected = 0;
  let totalConfirmed = 0;
  let totalProgressSum = 0;
  const tableData = [];
  
  validUnits.forEach(u => {
    let expected = unitPrimaryCount[u] * bulletinCount;
    let confirmed = unitConfirmed[u];
    let unconfirmed = Math.max(0, expected - confirmed);
    let rate = expected === 0 ? 0 : Math.round((confirmed / expected) * 100);
    let avgProgress = expected === 0 ? 0 : Math.round(unitTotalProgress[u] / expected);
    let firstTime = unitFirstConfirmedTime[u] || Infinity;
    let readTimeStr = '--';
    if (firstTime !== Infinity && !isNaN(firstTime)) {
      const dt = new Date(firstTime);
      const pad = n => String(n).padStart(2, '0');
      readTimeStr = `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    }

    totalExpected += expected;
    totalConfirmed += confirmed;
    totalProgressSum += unitTotalProgress[u];
    
    tableData.push({
      unit: u,
      bulletins: bulletinCount,
      expected: expected,
      confirmed: confirmed,
      unconfirmed: unconfirmed,
      rate: rate,
      avgProgress: avgProgress,
      firstTime: firstTime,
      readTimeStr: readTimeStr
    });
  });
  
  let overallRate = totalExpected === 0 ? 0 : Math.round((totalConfirmed / totalExpected) * 100);
  let overallAvgProgress = totalExpected === 0 ? 0 : Math.round(totalProgressSum / (totalExpected || 1));
  
  // 排序優先順序：閱讀率高者在前；閱讀率相同時，以最先確認時間 (firstTime 越早/越小) 排序
  tableData.sort((a, b) => {
    if (b.rate !== a.rate) return b.rate - a.rate;
    if (a.firstTime !== b.firstTime) return a.firstTime - b.firstTime;
    return b.avgProgress - a.avgProgress;
  });
  
  return {
    monthStr,
    missingUnits,
    tableData,
    overallRate
  };
}

async function showKPI(monthOffset = 0) {
  currentKPIOffset = monthOffset;
  document.getElementById('kpi-modal').classList.remove('hidden');
  
  document.getElementById('kpi-tab-0').className = monthOffset === 0 ? 'px-4 py-1.5 text-sm font-semibold rounded-md transition-colors bg-white text-blue-600 shadow-sm' : 'px-4 py-1.5 text-sm font-semibold rounded-md transition-colors text-slate-500 hover:text-slate-700';
  document.getElementById('kpi-tab-1').className = monthOffset === -1 ? 'px-4 py-1.5 text-sm font-semibold rounded-md transition-colors bg-white text-blue-600 shadow-sm' : 'px-4 py-1.5 text-sm font-semibold rounded-md transition-colors text-slate-500 hover:text-slate-700';
  
  document.getElementById('kpi-month-label').innerText = '載入中...';
  document.getElementById('kpi-table-body').innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400">載入中...</td></tr>';
  
  const data = await fetchKPIData(monthOffset);
  window._lastKPIData = data; // store for export
  
  document.getElementById('kpi-month-label').innerText = data.monthStr;
  
  if (data.missingUnits.length > 0) {
    document.getElementById('kpi-warning').classList.remove('hidden');
    document.getElementById('kpi-missing-units').innerText = data.missingUnits.join('、');
  } else {
    document.getElementById('kpi-warning').classList.add('hidden');
  }
  
  document.getElementById('kpi-total-rate').innerText = `${data.overallRate}%`;
  
  if (data.tableData.length > 0) {
    document.getElementById('kpi-best-unit').innerText = data.tableData[0].unit;
    document.getElementById('kpi-best-rate').innerText = `${data.tableData[0].rate}%`;
    
    // 若所有單位閱讀率皆達 100%（或全數達標平等），則「最低點閱單位」顯示留空 -- (全數達標)
    const allPerfect = data.tableData.every(r => r.rate >= 100);
    const worstUnit = data.tableData[data.tableData.length - 1];
    
    if (allPerfect || worstUnit.rate >= 100) {
      document.getElementById('kpi-worst-unit').innerText = '無（全數達標 🎉）';
      document.getElementById('kpi-worst-rate').innerText = '--';
    } else {
      document.getElementById('kpi-worst-unit').innerText = worstUnit.unit;
      document.getElementById('kpi-worst-rate').innerText = `${worstUnit.rate}%`;
    }
  } else {
    document.getElementById('kpi-best-unit').innerText = '--';
    document.getElementById('kpi-best-rate').innerText = '--%';
    document.getElementById('kpi-worst-unit').innerText = '--';
    document.getElementById('kpi-worst-rate').innerText = '--%';
  }
  
  let html = '';
  data.tableData.forEach(row => {
    let lightBadge = '';
    if (row.rate >= 100) {
      lightBadge = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"><span class="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200"></span>已達標</span>';
    } else if (row.rate >= 90) {
      lightBadge = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200"><span class="w-2 h-2 rounded-full bg-amber-400 ring-2 ring-amber-200"></span>待提升</span>';
    } else {
      lightBadge = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200"><span class="w-2 h-2 rounded-full bg-rose-500 ring-2 ring-rose-200"></span>未達標</span>';
    }
    
    html += `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="px-5 py-3.5 text-sm font-bold text-slate-800">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            <span>${row.unit}</span>
          </div>
        </td>
        <td class="px-4 py-3.5 text-sm text-slate-600 text-center font-medium">${row.bulletins}</td>
        <td class="px-4 py-3.5 text-sm text-slate-600 text-center font-medium">${row.expected}</td>
        <td class="px-4 py-3.5 text-sm text-emerald-600 text-center font-bold">${row.confirmed}</td>
        <td class="px-4 py-3.5 text-sm ${row.unconfirmed > 0 ? 'text-rose-500 font-bold' : 'text-slate-400'} text-center">${row.unconfirmed}</td>
        <td class="px-4 py-3.5 text-sm font-extrabold ${row.rate >= 100 ? 'text-emerald-600' : (row.rate >= 90 ? 'text-amber-600' : 'text-rose-600')} text-right">${row.rate}%</td>
        <td class="px-4 py-3.5 text-sm font-semibold text-slate-700 text-right">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${row.avgProgress >= 90 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : (row.avgProgress >= 70 ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-slate-100 text-slate-600')}">
            ${row.avgProgress}%
          </span>
        </td>
        <td class="px-4 py-3.5 text-xs text-slate-500 text-center font-mono whitespace-nowrap">${row.readTimeStr || '--'}</td>
        <td class="px-5 py-3.5 text-sm text-center">
          ${lightBadge}
        </td>
      </tr>
    `;
  });
  
  if(html === '') html = '<tr><td colspan="9" class="text-center py-12 text-slate-400 text-xs">尚無統計數據</td></tr>';
  document.getElementById('kpi-table-body').innerHTML = html;
}


function exportKPIExcel() {
  if (!window._lastKPIData) return;
  const data = window._lastKPIData;
  
  const exportData = data.tableData.map(row => {
    let status = '未達標';
    if(row.rate >= 100) status = '已達標';
    else if (row.rate >= 90) status = '待提升';
    
    return {
      '單位': row.unit,
      '(月)佈告數': row.bulletins,
      '應閱讀': row.expected,
      '已確認': row.confirmed,
      '未確認': row.unconfirmed,
      '閱讀率(%)': row.rate,
      '平均閱讀完成率(%)': row.avgProgress,
      '點閱時間': row.readTimeStr || '--',
      '燈號/狀態': status
    };
  });
  
  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "點閱統計");
  
  const filename = `週報點閱績效統計_${data.monthStr.replace(/ /g, '')}.xlsx`;
  XLSX.writeFile(wb, filename);
}


if (!window._toxGlobalClickBound) {
  window._toxGlobalClickBound = true;
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.tox-tinymce-aux') && !e.target.closest('#toolbar-portal')) {
      const popups = document.querySelectorAll('.tox-tinymce-aux .tox-pop, .tox-tinymce-aux .tox-menu');
      if (popups.length > 0) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      }
    }
  });
}


// --- Survey Feedback & Analytics ---
var _lastSurveyData = [];

async function showSurveyModal() {
  const modal = document.getElementById('survey-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  await fetchSurveyData();
}

function closeSurveyModal() {
  const modal = document.getElementById('survey-modal');
  if (modal) modal.classList.add('hidden');
}

async function fetchSurveyData() {
  const tbody = document.getElementById('survey-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-400">載入問卷資料中...</td></tr>';
  
  try {
    if (typeof db === 'undefined' || !db) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-rose-500">Firebase 資料庫未就緒</td></tr>';
      return;
    }
    
    const snap = await db.collection('surveys').orderBy('createdAt', 'desc').get();
    const list = [];
    snap.forEach(doc => {
      list.push({ id: doc.id, ...doc.data() });
    });
    
    _lastSurveyData = list;
    renderSurveyModal(list);
  } catch (err) {
    console.error("fetchSurveyData error:", err);
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-rose-500">載入失敗：${err.message}</td></tr>`;
  }
}

function renderSurveyModal(list) {
  const countEl = document.getElementById('survey-stat-count');
  const scoreUEl = document.getElementById('survey-stat-score-u');
  const scoreLEl = document.getElementById('survey-stat-score-l');
  const topInfoEl = document.getElementById('survey-stat-top-info');
  const summaryEl = document.getElementById('survey-table-summary');
  const tbody = document.getElementById('survey-table-body');
  
  if (countEl) countEl.textContent = `${list.length} 份`;
  if (summaryEl) summaryEl.textContent = `共 ${list.length} 筆回覆`;
  
  if (!list.length) {
    if (scoreUEl) scoreUEl.textContent = '--';
    if (scoreLEl) scoreLEl.textContent = '--';
    if (topInfoEl) topInfoEl.textContent = '尚無資料';
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-12 text-slate-400 text-sm">目前尚無任何問卷填答紀錄</td></tr>';
    return;
  }
  
  let sumU = 0, sumL = 0;
  const infoCount = {};
  
  list.forEach(item => {
    sumU += (Number(item.scoreUnderstand) || 0);
    sumL += (Number(item.scoreLayout) || 0);
    if (Array.isArray(item.wantedInfo)) {
      item.wantedInfo.forEach(inf => {
        infoCount[inf] = (infoCount[inf] || 0) + 1;
      });
    }
  });
  
  const avgU = (sumU / list.length).toFixed(1);
  const avgL = (sumL / list.length).toFixed(1);
  if (scoreUEl) scoreUEl.textContent = avgU;
  if (scoreLEl) scoreLEl.textContent = avgL;
  
  // Find top wanted info
  let topInfo = '--', maxInfCount = 0;
  for (const [k, v] of Object.entries(infoCount)) {
    if (v > maxInfCount) {
      maxInfCount = v;
      topInfo = `${k} (${v}票)`;
    }
  }
  if (topInfoEl) topInfoEl.textContent = topInfo;
  
  // Render table rows
  if (tbody) {
    tbody.innerHTML = list.map(item => {
      const timeStr = item.createdAt && item.createdAt.toDate ? 
        item.createdAt.toDate().toLocaleString('zh-TW', { hour12: false }) : 
        '--';
      
      const wantedStr = (item.wantedInfo || []).join(', ') + 
        (item.wantedInfoOther ? ` (其他:${item.wantedInfoOther})` : '');
      
      return `
        <tr class="hover:bg-slate-50/70 transition-colors">
          <td class="px-3 py-2.5 text-slate-500 whitespace-nowrap">${timeStr}</td>
          <td class="px-3 py-2.5 font-medium text-slate-800">${item.unit || '未填'}</td>
          <td class="px-3 py-2.5 text-blue-600 font-semibold">${item.empId || '未填'}</td>
          <td class="px-3 py-2.5 text-slate-600">${item.frequency || '--'}</td>
          <td class="px-3 py-2.5 text-center font-bold text-blue-600">${item.scoreUnderstand || '--'}</td>
          <td class="px-3 py-2.5 text-center font-bold text-indigo-600">${item.scoreLayout || '--'}</td>
          <td class="px-3 py-2.5 text-slate-600 max-w-[200px] truncate" title="${wantedStr}">${wantedStr || '--'}</td>
          <td class="px-3 py-2.5 text-slate-600 max-w-[220px] truncate" title="${item.feedback || ''}">${item.feedback || '--'}</td>
        </tr>
      `;
    }).join('');
  }
}

function exportSurveyExcel() {
  if (!_lastSurveyData || !_lastSurveyData.length) {
    alert('目前尚無問卷資料可供匯出！');
    return;
  }
  
  const exportRows = _lastSurveyData.map(item => {
    const timeStr = item.createdAt && item.createdAt.toDate ? 
      item.createdAt.toDate().toLocaleString('zh-TW', { hour12: false }) : 
      '';
    
    return {
      '填答時間': timeStr,
      '所屬單位': item.unit || '',
      '員工工號': item.empId || '',
      '查看頻率': item.frequency || '',
      '查看頻率原因備註': item.frequencyReason || '',
      '內容理解度評分(1-5)': item.scoreUnderstand || '',
      '內容理解度備註': item.scoreUnderstandOther || '',
      '版面易讀度評分(1-5)': item.scoreLayout || '',
      '版面易讀度備註': item.scoreLayoutOther || '',
      '期望資訊需求': (item.wantedInfo || []).join('、'),
      '其他期望資訊': item.wantedInfoOther || '',
      '期望增加功能': (item.wantedFeatures || []).join('、'),
      '其他期望功能': item.wantedFeaturesOther || '',
      '其他意見或建議': item.feedback || ''
    };
  });
  
  const ws = XLSX.utils.json_to_sheet(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "問卷回覆明細");
  
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const filename = `採購電子週報使用需求問卷調查_${dateStr}.xlsx`;
  XLSX.writeFile(wb, filename);
}


// ==========================================
// 標準蜂巢色彩選取器 (1:1 復刻圖 3 Windows/Office 標準色彩面板)
// ==========================================
window._stdColorState = {
  activeType: 'forecolor', // 'forecolor' or 'hilitecolor'
  activeEditor: null,
  currentBookmark: null,
  selectedColor: '#000000',
  originalColor: '#000000'
};

function openStdColorPicker(type = 'forecolor', defaultColor = '#000000') {
  const ed = window._activeTinyEditor;
  if (!ed) return;
  
  window._stdColorState.activeType = type;
  window._stdColorState.activeEditor = ed;
  try {
    window._stdColorState.currentBookmark = ed.selection.getBookmark(2, true);
  } catch (e) {
    window._stdColorState.currentBookmark = null;
  }
  
  window._stdColorState.selectedColor = defaultColor;
  window._stdColorState.originalColor = defaultColor;
  
  const modal = document.getElementById('std-color-modal');
  if (!modal) return;
  
  updateStdColorPreview(defaultColor);
  const currEl = document.getElementById('std-preview-curr');
  if (currEl) currEl.style.backgroundColor = defaultColor;
  
  switchStdColorTab('standard');
  modal.classList.remove('hidden');
}

function closeStdColorPicker() {
  const modal = document.getElementById('std-color-modal');
  if (modal) modal.classList.add('hidden');
}

function switchStdColorTab(tab) {
  const btnStd = document.getElementById('tab-btn-std');
  const btnCust = document.getElementById('tab-btn-cust');
  const paneStd = document.getElementById('tab-pane-std');
  const paneCust = document.getElementById('tab-pane-cust');
  
  if (tab === 'standard') {
    if (btnStd) { btnStd.classList.add('active'); }
    if (btnCust) { btnCust.classList.remove('active'); }
    if (paneStd) paneStd.classList.remove('hidden');
    if (paneCust) paneCust.classList.add('hidden');
  } else {
    if (btnCust) { btnCust.classList.add('active'); }
    if (btnStd) { btnStd.classList.remove('active'); }
    if (paneCust) paneCust.classList.remove('hidden');
    if (paneStd) paneStd.classList.add('hidden');
  }
}

function selectStdColor(hex, el = null) {
  window._stdColorState.selectedColor = hex;
  updateStdColorPreview(hex);
  
  // 移動如圖 3 的黑白雙層選取框到目標色塊
  if (el) {
    const pts = el.getAttribute('points');
    const group = document.getElementById('std-selection-group');
    const outer = document.getElementById('std-hex-selector');
    const inner = document.getElementById('std-hex-selector-inner');
    if (group && outer && inner && pts) {
      outer.setAttribute('points', pts);
      inner.setAttribute('points', pts);
      group.classList.remove('hidden');
    }
  }
}

function onStdNativeColorChange(hex) {
  window._stdColorState.selectedColor = hex;
  updateStdColorPreview(hex);
  const input = document.getElementById('std-hex-input');
  if (input) input.value = hex.replace('#', '').toUpperCase();
}

function onStdHexInputChange(val) {
  const clean = val.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length === 6) {
    const hex = '#' + clean.toUpperCase();
    window._stdColorState.selectedColor = hex;
    updateStdColorPreview(hex);
    const nativePicker = document.getElementById('std-native-color-picker');
    if (nativePicker) nativePicker.value = hex;
  }
}

function updateStdColorPreview(hex) {
  const newEl = document.getElementById('std-preview-new');
  if (newEl) newEl.style.backgroundColor = hex;
  const input = document.getElementById('std-hex-input');
  if (input && document.activeElement !== input) input.value = hex.replace('#', '').toUpperCase();
  const nativePicker = document.getElementById('std-native-color-picker');
  if (nativePicker) nativePicker.value = hex;
}

function applyStdColorPicker() {
  const ed = window._stdColorState.activeEditor;
  const hex = window._stdColorState.selectedColor;
  const cmd = window._stdColorState.activeType === 'hilitecolor' ? 'HiliteColor' : 'ForeColor';
  
  if (ed) {
    ed.focus();
    if (window._stdColorState.currentBookmark) {
      try {
        ed.selection.moveToBookmark(window._stdColorState.currentBookmark);
      } catch (e) {}
    }
    ed.execCommand(cmd, false, hex);
  }
  closeStdColorPicker();
}

// 監聽蜂巢多邊形點擊
document.addEventListener('DOMContentLoaded', () => {
  const svg = document.getElementById('std-honeycomb-svg');
  if (svg) {
    svg.addEventListener('click', (e) => {
      const target = e.target.closest('.std-hex-item');
      if (target) {
        const col = target.getAttribute('data-color');
        if (col) selectStdColor(col, target);
      }
    });
  }
  
  // 全域監聽 TinyMCE 色彩選取器底部的自訂顏色按鈕點擊
  document.addEventListener('click', (e) => {
    const customBtn = e.target.closest('.tox-swatches__picker-btn, [data-mce-color-picker], [aria-label*="Custom color"], [aria-label*="自訂顏色"]');
    if (customBtn) {
      e.preventDefault();
      e.stopPropagation();
      // 判斷是文字顏色還是背景顏色
      let type = 'forecolor';
      const openSplit = document.querySelector('.tox-split-button[data-alloy-tabstop="true"][aria-expanded="true"]');
      if (openSplit && (openSplit.getAttribute('aria-label') || '').includes('背景')) {
        type = 'hilitecolor';
      }
      openStdColorPicker(type, '#000000');
    }
  }, true);
});

// ==========================================
// 手動補登閱讀打卡功能 (Manual Read Backfill)
// ==========================================
async function openManualReadModal() {
  const modal = document.getElementById('manual-read-modal');
  if (!modal) return;

  const bId = S.cur ? S.cur.id : null;
  if (!bId) {
    if (typeof toast === 'function') toast('⚠️ 請先選擇或建立一篇週報，再進行補登操作。', 'er');
    else alert('請先選擇或建立一篇週報，再進行補登操作。');
    return;
  }

  // 顯示當前週報 ID
  const idEl = document.getElementById('m-read-bulletin-id');
  if (idEl) {
    idEl.innerHTML = `
      <span>${xe(bId)}</span>
      <span class="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${S.cur.title ? xe(S.cur.title) : '當前週報'}</span>
    `;
  }

  const selectEl = document.getElementById('m-read-user-select');
  if (selectEl) {
    selectEl.innerHTML = '<option value="">載入名冊與已讀狀態中...</option>';
    selectEl.disabled = true;
  }

  modal.classList.remove('hidden');

  try {
    // 獲取通訊錄與目前已讀清單
    let allUsers = S.whitelist || [];
    if (allUsers.length === 0) {
      allUsers = await DS.getWhitelist();
      S.whitelist = allUsers;
    }

    const { readers } = await DS.getReadReceipts(bId);

    // 建立已讀比對查找表
    const readLookup = readers.map(r => {
      const email = (r.email || '').trim().toLowerCase();
      const emailPrefix = email ? email.split('@')[0] : '';
      const name = (r.displayName || '').replace(/[\s\u3000]/g, '').toLowerCase();
      return { email, emailPrefix, name, raw: r };
    });

    // 標記每位通訊錄同仁是否已讀
    const userListWithStatus = allUsers.map(u => {
      const uEmailLower = (u.email || '').trim().toLowerCase();
      const uPrefix = uEmailLower.split('@')[0];
      const uName = (u.name || '').replace(/[\s\u3000]/g, '').toLowerCase();

      const existingReader = readLookup.find(r => {
        if (r.email && r.email === uEmailLower) return true;
        if (r.emailPrefix && uPrefix && r.emailPrefix === uPrefix) return true;
        if (r.name && uName && (r.name === uName || r.name.includes(uName) || uName.includes(r.name))) return true;
        if ((uName === '吳俊緯' && r.name.includes('吳俊瑋')) || (uName === '吳俊瑋' && r.name.includes('吳俊緯'))) return true;
        return false;
      });

      return {
        ...u,
        isAlreadyRead: !!existingReader,
        currentProgress: existingReader ? existingReader.raw.readProgress : 0
      };
    });

    // 未讀同仁排在最前面，同狀態則依部門與名稱排序
    userListWithStatus.sort((a, b) => {
      if (a.isAlreadyRead !== b.isAlreadyRead) {
        return a.isAlreadyRead ? 1 : -1;
      }
      const deptA = a.unit || a.department || '';
      const deptB = b.unit || b.department || '';
      if (deptA !== deptB) return deptA.localeCompare(deptB, 'zh-TW');
      return (a.name || '').localeCompare(b.name || '', 'zh-TW');
    });

    let optsHtml = '<option value="">-- 請選擇要補登打卡的同仁 --</option>';
    let lastGroup = null;

    userListWithStatus.forEach(u => {
      const groupLabel = u.unit || u.department || '未分組';
      const statusText = u.isAlreadyRead ? `[已讀 ${u.currentProgress}%]` : '[未讀]';
      const primaryTag = u.isPrimary ? ' ⭐主要窗口' : '';
      
      optsHtml += `
        <option value="${xe(JSON.stringify(u))}">
          ${statusText} ${xe(groupLabel)} - ${xe(u.name || u.email)}${primaryTag} (${xe(u.email)})
        </option>
      `;
    });

    if (selectEl) {
      selectEl.innerHTML = optsHtml;
      selectEl.disabled = false;
    }
  } catch (err) {
    console.error('openManualReadModal error:', err);
    if (selectEl) {
      selectEl.innerHTML = '<option value="">名冊載入失敗，請稍後重試</option>';
    }
  }
}

function closeManualReadModal() {
  const modal = document.getElementById('manual-read-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitManualRead() {
  const bId = S.cur ? S.cur.id : null;
  if (!bId) {
    toast('⚠️ 查無目標週報 ID', 'er');
    return;
  }

  const selectEl = document.getElementById('m-read-user-select');
  const progressEl = document.getElementById('m-read-progress');
  const btn = document.getElementById('btn-submit-manual-read');

  if (!selectEl || !selectEl.value) {
    toast('⚠️ 請先選擇要補登打卡的同仁！', 'er');
    return;
  }

  let selectedUser;
  try {
    selectedUser = JSON.parse(selectEl.value);
  } catch(e) {
    toast('⚠️ 使用者資料格式解析異常', 'er');
    return;
  }

  const progress = parseInt(progressEl ? progressEl.value : '100', 10) || 100;
  const userEmail = (selectedUser.email || '').trim();
  const userName = selectedUser.name || (userEmail ? userEmail.split('@')[0] : '同仁');
  const userDept = selectedUser.unit || selectedUser.department || '未指定';

  // 決定 Document ID：若有特定 uid 優先使用，否則以 Email 正規化安全字元作為 ID
  const docId = selectedUser.userId || selectedUser.uid || (userEmail ? userEmail.replace(/[@.]/g, '_') : null);

  if (!docId) {
    toast('⚠️ 無法取得該同仁的唯一識別碼 (Email 或 UID)', 'er');
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      <span>補登寫入中...</span>
    `;
  }

  try {
    const receiptRef = db.collection('bulletins').doc(bId).collection('readReceipts').doc(docId);
    const docSnap = await receiptRef.get();

    const timestamp = firebase.firestore.FieldValue.serverTimestamp();
    const backfillNote = `[管理員手動補登] ${new Date().toLocaleString('zh-TW')}`;

    if (docSnap.exists) {
      const updateData = {
        readProgress: progress,
        lastViewedAt: timestamp,
        note: backfillNote
      };
      if (progress >= 100) {
        updateData.confirmed = true;
        updateData.confirmedAt = timestamp;
      }
      await receiptRef.update(updateData);
    } else {
      const docData = {
        userId: docId,
        email: userEmail,
        displayName: userName,
        department: userDept,
        readProgress: progress,
        readAt: timestamp,
        lastViewedAt: timestamp,
        note: backfillNote
      };
      if (progress >= 100) {
        docData.confirmed = true;
        docData.confirmedAt = timestamp;
      }
      await receiptRef.set(docData);
    }

    // 寫入防舞弊操作紀錄日誌 (Audit Log)
    await DS.addAuditLog(bId, `管理員手動補登同仁「${userName} (${userDept})」已讀打卡（完成率：${progress}%）。`);

    toast(`✅ 成功為 ${userName} (${userDept}) 補登本期已讀打卡 (${progress}%)！`, 'ok');
    closeManualReadModal();

    // 即時刷新 Section C 已讀狀態列表與 Section D 操作紀錄日誌
    if (typeof renderReadReceipts === 'function') {
      await renderReadReceipts(bId);
    }
    if (typeof renderAuditLogs === 'function') {
      await renderAuditLogs(bId);
    }
  } catch (err) {
    console.error('submitManualRead error:', err);
    toast(`⚠️ 補登失敗: ${err.message || err}`, 'er');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg class="w-3.5 h-3.5 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        <span>確認補登</span>
      `;
    }
  }
}

/* ==========================================================================
   Audience Control Functions (週報閱讀觀看權限設定)
   ========================================================================== */

window._currentAudienceType = 'all';

async function setAudienceType(type, markDirty = true) {
  window._currentAudienceType = type;
  if (S.cur) {
    S.cur.audienceType = type;
    if (markDirty) S.dirty = true;
  }

  const btnAll = document.getElementById('btn-aud-all');
  const btnCustom = document.getElementById('btn-aud-custom');
  const customPanel = document.getElementById('aud-custom-panel');

  if (type === 'all') {
    if (btnAll) {
      btnAll.className = 'px-3 py-1 text-xs font-semibold rounded-md transition-all bg-blue-600 text-white shadow-xs';
    }
    if (btnCustom) {
      btnCustom.className = 'px-3 py-1 text-xs font-semibold rounded-md transition-all text-slate-600 hover:text-slate-900';
    }
    if (customPanel) customPanel.classList.add('hidden');
  } else {
    if (btnAll) {
      btnAll.className = 'px-3 py-1 text-xs font-semibold rounded-md transition-all text-slate-600 hover:text-slate-900';
    }
    if (btnCustom) {
      btnCustom.className = 'px-3 py-1 text-xs font-semibold rounded-md transition-all bg-indigo-600 text-white shadow-xs';
    }
    if (customPanel) customPanel.classList.remove('hidden');

    // 確保白名單與群組資料已載入
    if (!S.whitelist || S.whitelist.length === 0) {
      S.whitelist = await DS.getWhitelist();
    }
    if (!S.mailGroups || S.mailGroups.length === 0) {
      S.mailGroups = await DS.getMailGroups();
    }
    renderAudUsersList();
  }
}

function renderAudUsersList() {
  const container = document.getElementById('aud-users-list');
  const fastSelectContainer = document.getElementById('aud-group-fastselect');
  if (!container) return;

  const authList = (S.cur?.authorizedEmails || []).map(e => (e || '').trim().toLowerCase());

  // 渲染群組快選按鈕
  if (fastSelectContainer) {
    if (S.mailGroups && S.mailGroups.length > 0) {
      fastSelectContainer.innerHTML = '<span class="text-[11px] text-slate-400 mr-1">群組快選:</span>' + S.mailGroups.map(g => `
        <button type="button" onclick="selectAudGroup('${g.id}')" class="px-2 py-0.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 text-[10px] rounded border border-slate-200 transition-colors font-medium">
          ${xe(g.name)}
        </button>
      `).join('');
    } else {
      fastSelectContainer.innerHTML = '';
    }
  }

  // 渲染人員卡片
  const users = S.whitelist || [];
  if (users.length === 0) {
    container.innerHTML = '<div class="col-span-full text-center py-4 text-slate-400 text-xs">通訊錄尚無人員資料</div>';
    updateAudSelectedCount();
    return;
  }

  container.innerHTML = users.map(u => {
    const emailLower = (u.email || '').trim().toLowerCase();
    const isChecked = authList.includes(emailLower);
    const unitBadge = u.unit ? `<span class="text-[10px] bg-slate-100 text-slate-600 px-1 rounded">${xe(u.unit)}</span>` : '';
    return `
      <label class="aud-user-item flex items-center gap-2 p-2 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors text-xs" data-search="${(u.name || '') + ' ' + (u.email || '') + ' ' + (u.unit || '')}">
        <input type="checkbox" class="aud-user-cb rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 w-3.5 h-3.5" value="${xe(u.email)}" ${isChecked ? 'checked' : ''} onchange="onAudUserCheckChanged()">
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-1">
            <span class="font-bold text-slate-700 truncate">${xe(u.name || u.email.split('@')[0])}</span>
            ${unitBadge}
          </div>
          <p class="text-[10px] text-slate-400 truncate mt-0.5">${xe(u.email)}</p>
        </div>
      </label>
    `;
  }).join('');

  updateAudSelectedCount();
}

function onAudUserCheckChanged() {
  if (S.cur) {
    const checked = Array.from(document.querySelectorAll('.aud-user-cb:checked')).map(cb => cb.value);
    S.cur.authorizedEmails = checked;
    S.dirty = true;
  }
  updateAudSelectedCount();
}

function updateAudSelectedCount() {
  const cbs = document.querySelectorAll('.aud-user-cb:checked');
  const countEl = document.getElementById('aud-selected-count');
  if (countEl) {
    countEl.textContent = `已授權：${cbs.length} 人`;
  }
}

function toggleAudAll(checked) {
  document.querySelectorAll('.aud-user-cb').forEach(cb => {
    cb.checked = checked;
  });
  onAudUserCheckChanged();
}

function selectAudGroup(groupId) {
  const g = (S.mailGroups || []).find(x => x.id === groupId);
  if (!g || !g.emails) return;
  const targetEmails = g.emails.map(e => (e || '').trim().toLowerCase());

  document.querySelectorAll('.aud-user-cb').forEach(cb => {
    if (targetEmails.includes((cb.value || '').trim().toLowerCase())) {
      cb.checked = true;
    }
  });
  onAudUserCheckChanged();
  toast(`已勾選群組【${g.name}】成員`, 'in');
}

function filterAudList() {
  const q = document.getElementById('aud-search-input')?.value.trim().toLowerCase() || '';
  const items = document.querySelectorAll('.aud-user-item');
  items.forEach(it => {
    const text = it.getAttribute('data-search')?.toLowerCase() || '';
    if (!q || text.includes(q)) {
      it.style.display = 'flex';
    } else {
      it.style.display = 'none';
    }
  });
}


