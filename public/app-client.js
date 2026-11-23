
window.__amConsent = "2026-09-12";
window.__amBootMode = window.__amBootMode || "standard";
window.__amWebMode = true;


(function(){
  var mode="standard", lastMe=null, metaFull=[], champMetaList=[], activeTab="broadcast", buildMode="win", lastChampData=null, lastChampName="", lastMyChampData=null, amMetaBase=50; // lastChampName = 지금 연 챔피언(통계를 못 받았을 때 이름을 띄우고 다시 시도하려면 필요하다) // buildMode 기본="win"(최고 승률(메타) 먼저, 2026-08-27 사용자 지시 — 종전 "common")
  var _myChampQ="", _anSearch=""; // 내 챔피언 통계 검색어(item1) / 상세분석 탭 검색어(item2) — 페이지 내 필터(우상단 #q ctrl+f와 별개)
  // ── "최고 승률(메타)" = 적합도 1위 (2026-08-27 사용자 확정 — 옛 검증된 픽(2026-07-12)은 동점 폴백) ──
  //   ★룬·아이템·증강·시너지 공통: 적합도 점수(판수×기준차×EB, amFitScore) 최대가 1위. 저표본 요행은 EB(절반신뢰 200판)와 30판 게이트로 배제.
  //   ★보조 트리 = 비주트리 중 (슬롯별 최고픽) 상위 2개의 '초록(잘 맞는 픽)' 판수합이 최대인 트리(amTreeSecScore). 사이트 app_v2.js amMeta*와 동일.
  function amImp(x){return Number(x&&x.impact)||0;} // 서버 impact(참고용)
  // ★최고승률(메타) = 적합도 기준(2026-08-27 사용자 확정: 메타 픽 선정도 사이트 공개분석 적합도(amFitVerdict/amFitScore 9차)와 동일 축).
  //   1위 = 적합도 점수 최대(초록 중 판수×승률차 질량 최대). 동점 폴백 = 종전 검증된 픽(통과→판수→승률).
  //   amMetaBase=렌더 직전 세팅한 그 챔프 승률(없으면 50). 사이트 app_v2.js amMeta*와 동일.
  var AM_META_TOL=1.0;
  function amMetaQual(x){ return amFitVerdict(x, amMetaBase) > 0; }
  function amRuneCmp(a,b){ var s=amFitScore(b,amMetaBase)-amFitScore(a,amMetaBase); if(s) return s; return (Number(amMetaQual(b))-Number(amMetaQual(a))) || ((Number(b.games)||0)-(Number(a.games)||0)) || ((Number(b.winRate)||0)-(Number(a.winRate)||0)); } // 적합도 점수↓ → (동점) 통과↓ → 판수↓ → 승률↓
  function amSortRunePick(arr){return (arr||[]).slice().sort(amRuneCmp);} // ★룬 최고승률 = 검증된픽(챔프평균↑ 중 최다판수)
  function amSortItems(arr){return (arr||[]).slice().sort(amRuneCmp);} // 아이템·증강도 동일 검증된픽 규칙(룬과 통일)
  function amSortCommon(arr){return (arr||[]).slice().sort(function(a,b){return (Number(b.games)||0)-(Number(a.games)||0);});} // 가장 흔한: 표본순
  // 보조 트리 = 검증된픽: win=행별 최고픽 상위2 중 '챔프평균 이상' 판수합 최대(요행트리는 통과판수 0) / common=판수합
  function amTreeSecScore(subRunes, catalog, mode){ var winMode=(mode||buildMode)==="win"; var catBy={}; (catalog||[]).forEach(function(c){ if(c.id!=null)catBy[c.id]={tree:c.tree,slot:c.slot}; }); var byTree={}; (subRunes||[]).forEach(function(r){ var t=r.tree||(catBy[r.id]&&catBy[r.id].tree)||""; (byTree[t]=byTree[t]||[]).push(r); }); var out={};
    Object.keys(byTree).forEach(function(t){ var totG=byTree[t].reduce(function(s,r){return s+(Number(r.games)||0);},0); if(!winMode){ out[t]=totG; return; }
      // ★카탈로그 실제 룬 행으로 그룹 — pick데이터 slot은 뒤엉켜 있어(전설:가속·체력차극복이 한 slot, 궁사·섬기가 한 slot) 트리점수가 왜곡됨. 카탈로그 있으면 정확 행, 없으면 pick slot 폴백.
      var byRow={}; byTree[t].forEach(function(r){ var sk=String((catBy[r.id]&&catBy[r.id].slot!=null)?catBy[r.id].slot:r.slot); (byRow[sk]=byRow[sk]||[]).push(r); });
      var tops=Object.keys(byRow).map(function(sk){ return amSortRunePick(byRow[sk])[0]; }).filter(Boolean).sort(amRuneCmp).slice(0,2); // 행별 최고픽(검증된픽)
      out[t]=tops.reduce(function(s,r){return s+(amMetaQual(r)?(Number(r.games)||0):0);},0)*1e7 + totG; // ★통과행(챔프평균 이상) 판수합 최대 → 동률/전무면 총판수. 요행 트리(2·4판)는 통과판수 0.
    }); return out; }
  function amPickSecTree(subRunes, catalog, mode){ var sc=amTreeSecScore(subRunes, catalog, mode); var best=null,bv=-Infinity; Object.keys(sc).forEach(function(t){ if(sc[t]>bv){bv=sc[t];best=t;} }); return best; }
  // ★적합도(2026-08-27 사이트 세로 지표·티어 분석 개편 미러 — app_v2.js rankVerdict/rankScore/rankCmp와 동일 산식):
  //   판정 = 초록(확실히 이기거나(승률>50%+오차) 확실히 자기평균 위) / 빨강(초록 아니면서 확실히 평균 아래) /
  //          회색(표본<30판 또는 어느 쪽도 확실치 않은 "같은 선" — 항상 스텁 길이). 오차 = 1%p + 50/√판수.
  //   점수 = 판수 × 기준차(초록=50%·평균 중 유리한 쪽, 빨강=불리한 쪽) × EB축소(g/(g+K)) — 색·방향·길이·정렬 전부 이 하나에서.
  //   ⚠️최고 승률(메타)=검증된 픽(amMeta*)은 별개 로직으로 유지(2026-08-27 사용자 확정: 픽 선정과 적합도 그래프는 역할이 다름).
  // tableSort/tableDir 의 "auto" = 서버가 그 표에 티어가 실제로 있는지 보고 기본정렬을 정한다(티어순 / 없으면 표본순).
  var RANK_K=200, AM_FIT_TOL=1.0, AM_FIT_MIN_G=30;   // RANK_K=적합도 EB 절반 신뢰점 200판(니달리 요행픽 참사 방지, 사이트 동일)
  function amFitBase(b){ return (isFinite(b)&&Number(b)>0)?Number(b):50; }
  function amFitErr(g){ return AM_FIT_TOL+(g>0?50/Math.sqrt(g):50); }
  function amFitVerdict(x,base){ var g=Number(x&&x.games)||0, w=Number(x&&x.winRate)||0, b=amFitBase(base), e=amFitErr(g); if(g<AM_FIT_MIN_G)return 0; var d=Math.max(w-50,w-(b-AM_FIT_TOL)); if(d>0&&(w>=b-AM_FIT_TOL||w>50+e))return 1; if(w<b-e)return -1; return 0; } // 9차+니달리: [검증된 픽 통과 or 확실한 승리] ∧ 방향 양수(방향=50%·통과선 중 유리한 쪽, 사이트 동일)
  function amFitScore(x,base){ var v=amFitVerdict(x,base); if(!v)return 0; var g=Number(x&&x.games)||0, w=Number(x&&x.winRate)||0, b=amFitBase(base); var d=v>0?Math.max(w-50,w-(b-AM_FIT_TOL)):Math.min(w-50,w-b); return g*d*g/(g+RANK_K); }
  function amFitCmp(base){ return function(a,b2){ return (amFitScore(b2,base)-amFitScore(a,base))||((Number(b2&&b2.games)||0)-(Number(a&&a.games)||0)); }; }
  function amFitLabel(x,base){ var v=amFitVerdict(x,base); return v>0?"잘 맞는 픽":v<0?"안 맞는 픽":((Number(x&&x.games)||0)<AM_FIT_MIN_G?"표본 부족 · 판단 불가":"평균과 같은 선"); }
  var tableDefs=[], tableRanges=[], tableTabs=[], tableCategory="broadcast", activeTableKey="", activeTableRange="all", tableOffset=0, tableLimit=5000, /* ★2026-07-22: 서버 상한과 동일하게. 600이면 상대법 표 대부분이 잘리는데 페이지네이션이 없어 601행부터는 도달 자체가 불가였다 */ tableLast=null, tableTimer=null, tableSort="auto", tableDir="auto", tableFiltersClosed=false, verticalKey="", distMetric="avgDpm", bcClass="all", bcHideLow=false, bcEntity="champion", bcWindow="";
  var initialParams=new URLSearchParams(location.search), pendingTableKey="";
  var metaSort="games", metaClass="all", metaClassOpen=false; // ⑦ 메타 정렬·클래스필터 상태
  var $=function(s){return document.querySelector(s)};
  function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return{"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;"}[c]})}
  function pim(url){return url?(/^data:/i.test(String(url))||String(url).charAt(0)==="/"?'<img alt="" src="'+esc(url)+'" onerror="this.remove()">':'<img alt="" src="/img?u='+encodeURIComponent(url)+'" onerror="this.remove()">'):''}
  // ★2026-07-22 공용 디바운스. 검색창 핸들러들이 키 한 번마다 목록 전체를 정렬·재렌더하고 있었다(디바운스 0개).
  //   기존 scheduleUnifiedSearch/scheduleTableSearch 에도 디바운스가 있지만 그 경로는 호출되는 데가 없어(죽은 코드) 실제로는 아무 데도 안 걸려 있었다.
  function deb(fn,ms){var t;return function(){var a=arguments,s=this;clearTimeout(t);t=setTimeout(function(){fn.apply(s,a)},ms||180)}}
  function img(url,cls){return '<span class="'+cls+'">'+pim(url)+'</span>'}
  function wr(n,thin){var c=thin?'muted':(n>=50?'good':'bad');return '<span class="wr '+c+'">'+n+'%</span>'}
  function kfmt(n){n=+n||0;return Math.round(n).toLocaleString('ko-KR')} // 한국식 전체 숫자(콤마). K압축은 한국인에 안 와닿음(사용자 지적) → 120,000 형태
  // 만 단위(한국식) 줄여 쓰기 — 사이트 app_v2.js amMan 정본을 글자 그대로 옮긴 것(한쪽만 고치지 마라).
  //   2026-09-19 운영자 B안: 넓은 표는 kfmt 전체 숫자 그대로, 좁은 칸(목록 '표본'·아이콘 밑 글씨·세로 지표 머리 칸·증강 카드·룬 칸)만 만 단위.
  //   1만 미만=전체 숫자(9,999) · 1만~100만 미만=소수 한 자리(36.8만) · 100만~1억 미만=정수 만(285만·1,235만) · 1억부터=억(1.2억). 줄인 칸엔 title 로 전체 숫자.
  function amMan(value) {
    var n = Math.round(Number(value) || 0), neg = n < 0;
    n = Math.abs(n);
    var group = function (x) { var s = String(x), o = ""; for (var i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) o += ","; o += s.charAt(i); } return o; };
    var one = function (x) { return x.toFixed(1).replace(/\.0$/, ""); };
    var out;
    if (n < 10000) out = group(n);
    else {
      var m1 = Math.round(n / 1000) / 10;
      if (m1 < 100) out = one(m1) + "만";
      else {
        var m0 = Math.round(n / 10000);
        if (m0 < 10000) out = group(m0) + "만";
        else { var e1 = Math.round(n / 10000000) / 10; out = (e1 < 100 ? one(e1) : group(Math.round(n / 100000000))) + "억"; }
      }
    }
    return (neg ? "-" : "") + out;
  }
  // 증강 카드(.ac) 폭 = 그 화면에서 가장 긴 판수 라벨 하나로 통일 → 카드 간격이 자릿수 따라 들쭉날쭉해지지 않는다.
  // tabular-nums라 숫자 1글자=1ch, 콤마·점≈0.5ch, '판'·'만'(전각)≈2ch. 아이콘 36px보다 좁아지는 건 CSS min-width:44px가 막는다.
  //   2026-09-19: 라벨이 만 단위(36.8만판)라 7·8자리가 돼도 카드가 더 안 넓어진다(종전엔 전체 숫자라 자릿수만큼 넓어졌다).
  function acWidthCh(arr){
    var w=0;
    (arr||[]).forEach(function(x){
      var s=amMan(x&&x.games)+'판',c=0;
      for(var i=0;i<s.length;i++){var ch=s.charAt(i);c+=(ch>='0'&&ch<='9')?1:((ch===','||ch==='.')?0.5:2);}
      if(c>w)w=c;
    });
    return (Math.ceil(w*2)/2)+'ch';
  }
  function tierBadge(t){if(!t)return '';var n=Math.min(t,5);return '<span class="tier t'+n+'">'+"SABCD".charAt(n-1)+'</span>';} // 티어 색 위계 칩(S/A/B/C/D, 6+는 D)
  var AM_SPLASH_OVERRIDE={Morgana:'https://cdn.communitydragon.org/latest/champion/Morgana/splash-art/centered',Xayah:'https://cdn.communitydragon.org/latest/champion/Xayah/splash-art/centered',Rakan:'https://cdn.communitydragon.org/latest/champion/Rakan/splash-art/centered',Kayle:'https://cdn.communitydragon.org/latest/champion/Kayle/splash-art/centered'}; // ★챔피언별 일러스트 지정 — 기본 스플래시가 둘을 한 장에 그린 조합(라칸+자야, 케일+모르가나)을 각자 초점 크롭으로. overlay_standard.js SPLASH_OVERRIDE 와 같은 값
  function splashStyle(icon){var raw=String(icon||'');var s=raw.replace(/\/cdn\/[^\/]+\/img\/champion\/([^\/]+)\.png.*$/,'/cdn/img/champion/splash/$1_0.jpg');if(!s||s===raw)return '';var m=raw.match(/\/img\/champion\/([A-Za-z0-9_]+)\.png/);if(m&&AM_SPLASH_OVERRIDE[m[1]])s=AM_SPLASH_OVERRIDE[m[1]];return ' style="--splash:url(\''+'/img?u='+encodeURIComponent(s)+'\')"';} // §12 #11 표시용: ddragon 스퀘어→스플래시(지정표 우선). 미매칭=배너 없음
  function skList(n){var s='';for(var i=0;i<(n||9);i++){s+='<div class="sk-row"><span class="sk sk-ic"></span><span class="sk sk-bar" style="width:'+(72-i*4)+'%"></span></div>';}return s;} // 메타 리스트 로딩 스켈레톤

  /* ── 챔피언 통계(티어 리스트) ── */
  var CLASS_KO={all:"전체",fighter:"전사",assassin:"암살자",marksman:"원거리",mage:"마법사",tank:"탱커",support:"유틸"};
  function canClassFilter(){ return activeTab==="champion" || (activeTab==="item" && mode==="standard"); } // 클래스 필터=챔피언+일반칼바람 아이템(증강 아이템은 클래스 데이터 없음)
  function applyMetaView(list){
    var arr=(list||[]).slice();
    if(canClassFilter() && metaClass!=="all") arr=arr.filter(function(c){return (c.group||"all")===metaClass;});
    arr.sort(function(a,b){
      if(metaSort==="name") return String(a.name||"").localeCompare(String(b.name||""),"ko");
      if(metaSort==="tier") return (a.tier||9)-(b.tier||9) || (b.games||0)-(a.games||0);
      if(metaSort==="winRate") return (b.winRate||0)-(a.winRate||0) || (b.games||0)-(a.games||0);
      return (b.games||0)-(a.games||0);
    });
    return arr;
  }
  function metaCtrlHtml(){
    var sorts=[["tier","티어순"],["games","표본순"],["name","가나다순"],["winRate","승률순"]];
    var h='<div class="meta-ctrl"><div class="ms-sorts">'+sorts.map(function(s){return '<button type="button" data-ms="'+s[0]+'" class="'+(metaSort===s[0]?"on":"")+'">'+s[1]+'</button>'}).join('')+'</div>';
    if(canClassFilter()){
      h+='<button type="button" class="ms-ftg'+(metaClassOpen?" on":"")+'" data-mcf="1">'+(metaClass==="all"?"역할 전체":CLASS_KO[metaClass])+(metaClassOpen?" ▴":" ▾")+'</button>';
      if(metaClassOpen){ h+='<div class="ms-class">'+Object.keys(CLASS_KO).map(function(k){return '<button type="button" data-mc="'+k+'" class="'+(metaClass===k?"on":"")+'">'+CLASS_KO[k]+'</button>'}).join('')+'</div>'; }
    }
    return h+'</div>';
  }
  function normName(s){return String(s||"").toLowerCase().replace(/\s+/g,"");}
  function modeSecondTab(){return mode==="augment"?"augment":"rune";}
  function normalizeMetaTab(tab){
    if(tab==="champ")return "champion";
    if(tab==="second"||tab==="rune"||tab==="augment")return modeSecondTab();
    return tab||"champion";
  }
  function setMetaTabButton(tab){
    activeTab=normalizeMetaTab(tab);
    document.querySelectorAll("#meta-tabs button").forEach(function(b){b.classList.toggle("on",normalizeMetaTab(b.dataset.tab)===activeTab)});
  }
  // 메타 통계 5개 탭(챔피언/룬·증강/아이템/조합/공개분석) 전부 테이블시스템(/api/tables,/api/table) 사용
  //   → 고승률/저승률/쌍/시간대 "테이블 선택" 드롭다운 필터 제공. server.mjs에 엔드포인트 구현·발행 완료(rev19~).
  //   ⚠️이전 #20이 stale dev서버를 404로 오판해 챔피언/룬/아이템을 renderList 단일목록으로 우회시켜 그 필터들이
  //     통째로 사라졌었음(사용자 "고승률 저승률 어디갔냐") → 본래 테이블시스템으로 복원함. renderList/metaCtrl은 사용 안 함.
  function isTableTab(tab){return ["broadcast","champion","rune","augment","item","combo","analysis"].indexOf(normalizeMetaTab(tab))>=0;}
  function tableTabKey(tab){return normalizeMetaTab(tab);}
  function modeTableLabel(){return mode==="augment"?"증강 칼바람 시즌2":"일반 칼바람";}
  var RIOT_SEARCH=false; // 소환사 검색(다른 사람)은 Riot API 키 보유(=운영자)에서만. 서버 /api/settings.riotKey로 결정. 키 없으면 #쿼리도 소환사검색 아님(일반검색으로 폴백) + 플레이스홀더에 소환사 예시 안 뜸.
  function isSummonerQuery(q){return RIOT_SEARCH && /#/.test(String(q||""));}
  function findChampByQuery(q){
    var n=normName(q);
    if(!n||!champMetaList.length)return null;
    return champMetaList.filter(function(c){return normName(c.name)===n;})[0]
      || champMetaList.filter(function(c){return normName(c.name).indexOf(n)===0;})[0]
      || null;
  }
  function applyMetaSearch(){
    closeChamp();
    var raw=($("#q").value||"").trim();
    if(isSummonerQuery(raw)){
      var ctrl=isTableTab(activeTab)?tableCtrlHtml(tableLast||{rows:[],total:0,offset:0,limit:tableLimit}):metaCtrlHtml();
      $("#meta").innerHTML=ctrl+'<p class="hint"><b>소환사 검색어입니다.</b><br>Enter를 누르면 전적을 조회합니다. 표 안에서 찾으려면 # 없이 입력하세요.</p>';
      return;
    }
    if(isTableTab(activeTab)){ if(!raw){loadSiteTable(true);} else {scheduleUnifiedSearch();} return; } // 통합검색(사이트식): 쿼리→전 카테고리 카드. 비면 현재 표 복원.
    if(!raw){renderList(metaFull);return;}
    if(activeTab!=="champion"&&findChampByQuery(raw)){
      setMetaTabButton("champion");
      metaFull=champMetaList;
    }
    var q=normName(raw);
    renderList(metaFull.filter(function(c){return normName(c.name).indexOf(q)>=0;}));
  }
  function rerenderMeta(){ if(isTableTab(activeTab)){ loadSiteTable(true); } else { renderList(metaFull); } } // #q는 이제 '페이지 내 찾기' 전용 — 정렬·클래스 변경 시 현재 뷰만 재렌더(통합검색 필터 없음)

  // ══════ 페이지 내 찾기(ctrl+f) — 우상단 #q. 사이트식 통합검색 대신 '현재 화면'에서 키워드를 하이라이팅·카운트·이동. ══════
  //   티어리스트처럼 이름이 숨겨진(초상화-only) 항목도 포함: el.textContent는 display:none(.tier-asset-name) 텍스트도 잡으므로 초상화(.tier-asset)에 링 하이라이팅.
  var _findQ="", _findHits=[], _findIdx=-1, _findObserver=null, _findTimer=null;
  function findScope(){ var b=document.body; if(b.classList.contains("am-set-open"))return $("#setpage"); if(b.classList.contains("cp"))return $("#champpage"); return document.querySelector(".wrap"); }
  function findVisible(el){ return !!(el && el.nodeType===1 && el.getClientRects && el.getClientRects().length); } // 화면에 실제 렌더되는가(숨은 탭·display:none 제외)
  function findNearestVisible(node){ var el=node.nodeType===1?node:node.parentElement; if(!el)return null; if(findVisible(el))return el; var gp=el.parentElement; if(gp&&findVisible(gp))return gp; return null; } // 부모가 보이면 그대로. 부모만 숨은 '라벨'(티어 .tier-asset-name=display:none)이면 조부모(초상화 .tier-asset-wrap)에서 하이라이팅. 그 이상 숨었으면(숨은 패널 #mychamps 등 전체가 display:none) null=매치 안 함 — 숨은 패널 텍스트가 거대한 조상(.card)으로 새 '아이번 2/2'처럼 세던 버그 방지.
  function findSkip(el){ return !el || (el.closest && el.closest("#q,.search,.ctip,#findnav,script,style")); } // 검색입력·툴팁·스크립트는 매칭 제외
  function findClearMarks(){ var els=document.querySelectorAll(".am-find-el,.am-find-cur"); for(var i=0;i<els.length;i++){els[i].classList.remove("am-find-el");els[i].classList.remove("am-find-cur");} }
  function findUpdateCount(){ var nav=$("#findnav"), cnt=$("#findcount"); if(!nav||!cnt)return; if(!_findQ){nav.hidden=true;return;} nav.hidden=false; cnt.textContent=(_findHits.length?(_findIdx+1)+"/"+_findHits.length:"0/0"); cnt.classList.toggle("none",!_findHits.length); }
  // 범용 찾기 — 특정 클래스 목록이 아니라 '현재 화면(모든 탭·모든 필터·모든 레이아웃)'의 보이는 텍스트 전부 + 숨은이름(티어 초상화) + 아이콘-only 셀을 훑는다. 표(.tr .tname)·목록(.row .nm)·티어보드·상세 등 레이아웃 무관.
  function applyFind(preserveIdx){
    findClearMarks();
    var q=normName(_findQ);
    if(!q){ _findHits=[]; _findIdx=-1; findUpdateCount(); return; }
    var scope=findScope(); if(!scope){ _findHits=[]; _findIdx=-1; findUpdateCount(); return; }
    var hits=[], hitSet=[];
    function addHit(el){ if(!el||el.nodeType!==1) return; for(var j=0;j<hitSet.length;j++){ if(hitSet[j]===el||hitSet[j].contains(el)||el.contains(hitSet[j])) return; } hitSet.push(el); hits.push(el); } // 중첩 dedup(조상/자손 중 하나만)
    // 1) 텍스트 노드 패스 — 모든 레이아웃의 보이는 텍스트 + 숨은 이름(티어 .tier-asset-name)
    var tw=document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    var tn; while((tn=tw.nextNode())){ var v=tn.nodeValue; if(!v||!v.trim()) continue; if(findSkip(tn.parentElement)) continue; if(normName(v).indexOf(q)<0) continue; var vis=findNearestVisible(tn); if(vis && !findSkip(vis)) addHit(vis); }
    // 2) 아이콘-only 패스 — 이름이 title/data-tip/data-champ/alt에만 있고 텍스트가 없는 셀(빌드 아이템·증강 아이콘 등)
    var cand=scope.querySelectorAll("[title],[data-tip],[data-champ],img[alt]");
    for(var i=0;i<cand.length;i++){ var el=cand[i]; if(!findVisible(el)||findSkip(el)) continue; var nm=(el.getAttribute("data-champ")||"")+" "+(el.getAttribute("title")||"")+" "+(el.getAttribute("data-tip")||"")+" "+(el.getAttribute("alt")||""); if(normName(nm).indexOf(q)<0) continue; addHit(el); }
    hits.sort(function(a,b){ var p=a.compareDocumentPosition(b); return (p&Node.DOCUMENT_POSITION_FOLLOWING)?-1:((p&Node.DOCUMENT_POSITION_PRECEDING)?1:0); }); // 문서 순서(이동 순서)
    _findHits=hits;
    if(!hits.length){ _findIdx=-1; findUpdateCount(); return; }
    if(!(preserveIdx && _findIdx>=0 && _findIdx<hits.length)) _findIdx=0;
    for(var k=0;k<hits.length;k++) hits[k].classList.add("am-find-el");
    findSetCurrent(false); findUpdateCount();
  }
  function findSetCurrent(scroll){ for(var i=0;i<_findHits.length;i++) _findHits[i].classList.remove("am-find-cur"); var el=_findHits[_findIdx]; if(!el)return; el.classList.add("am-find-cur"); if(scroll){ try{ el.scrollIntoView({block:"center",behavior:"smooth"}); }catch(e){ try{el.scrollIntoView();}catch(_){}} } }
  function findGo(dir){ if(!_findHits.length)return; _findIdx=(_findIdx+dir+_findHits.length)%_findHits.length; findSetCurrent(true); findUpdateCount(); }
  function findClear(){ _findQ=""; _findHits=[]; _findIdx=-1; findClearMarks(); var qi=$("#q"); if(qi)qi.value=""; findUpdateCount(); }
  function findOnInput(){ var qi=$("#q"); _findQ=qi?qi.value:""; applyFind(false); }
  function findEnsureObserver(){ if(_findObserver)return; _findObserver=new MutationObserver(function(){ if(!_findQ)return; clearTimeout(_findTimer); _findTimer=setTimeout(function(){ if(_findQ) applyFind(true); },120); }); [document.querySelector(".wrap"),$("#champpage"),$("#setpage")].forEach(function(n){ if(n) _findObserver.observe(n,{childList:true,subtree:true,characterData:true}); }); } // class(attribute) 변경은 관찰 안 함 → 하이라이트 재트리거 없음
  // ── 통합검색(사이트 publicSearchResultTable 이식): 쿼리를 전 카테고리 표에 매칭한 결과 카드. 카드 클릭 → 해당 탭+검색어 유지. ──
  var unifiedTimer=null;
  function scheduleUnifiedSearch(){ clearTimeout(unifiedTimer); unifiedTimer=setTimeout(runUnifiedSearch,200); }
  function runUnifiedSearch(){
    var q=($("#q").value||"").trim();
    if(!q||isSummonerQuery(q)) return;
    var seq=++metaLoadSeq;
    $("#meta").innerHTML='<div class="usearch-head"><b>"'+esc(q)+'" 통합검색</b></div>'+skList(5);
    fetch("/api/search?mode="+mode+"&range="+activeTableRange+"&q="+encodeURIComponent(q)).then(function(r){return r.json()}).then(function(j){
      if(seq!==metaLoadSeq)return; renderUnifiedSearch(j,q);
    }).catch(function(){ if(seq!==metaLoadSeq)return; $("#meta").innerHTML='<p class="hint">통합검색을 불러오지 못했습니다.</p>'; });
  }
  function renderUnifiedSearch(j,q){
    var cards=(j&&j.cards)||[];
    var head='<div class="usearch-head"><b>"'+esc(q)+'" 통합검색</b><span class="r">'+(cards.length?cards.length+'개 표에서 발견':'요약엔 없음')+'</span></div>';
    if(!cards.length){ $("#meta").innerHTML=head+'<p class="hint"><b>"'+esc(q)+'"와 일치하는 항목이 없습니다.</b><br>챔피언·증강·아이템·조합 이름으로 검색하세요. 소환사 전적은 이름#태그로.</p>'; return; }
    var grid='<div class="usearch-grid">'+cards.map(function(c){
      var ic=c.sampleIcon?'<img src="/img?u='+encodeURIComponent(c.sampleIcon)+'" alt="">':'';
      var ric=c.sampleRightIcon?'<img src="/img?u='+encodeURIComponent(c.sampleRightIcon)+'" alt="">':'';
      var wrc=(c.sampleWinRate!=null)?(Number(c.sampleWinRate)>=50?'good':'bad'):'';
      return '<button type="button" class="usearch-card" data-uscard="1" data-ustab="'+esc(c.tab)+'" data-uskey="'+esc(c.key)+'">'+
        '<div class="us-top"><span class="us-tab">'+esc(c.tabLabel||'')+'</span><span class="us-cnt">'+(c.count||0)+'개 결과</span></div>'+
        '<div class="us-label">'+esc(c.label||'')+'</div>'+
        '<div class="us-sample">'+ic+ric+'<span class="us-nm">'+esc(c.sampleLabel||'')+'</span>'+(c.sampleWinRate!=null?'<em class="'+wrc+'">'+fmtPct(c.sampleWinRate)+'</em>':'')+(c.sampleGames?'<i>'+kfmt(c.sampleGames)+'판</i>':'')+'</div>'+
      '</button>';
    }).join('')+'</div>';
    $("#meta").innerHTML=head+grid;
  }
  function goUnifiedCard(tab,key){ // 카드 클릭 → 해당 탭+표로 이동(검색어 q 유지하여 표가 필터됨)
    tableCategory=tab; setMetaTabButton(tab); pendingTableKey=key; activeTableKey=key; tableOffset=0; tableSort="auto"; tableDir="auto"; verticalKey=""; bcClass="all"; bcHideLow=false; loadSiteTable(true); // 정렬=auto → 서버가 그 표의 기본(티어순/표본순/동시출현)을 정한다
  }
  function renderList(list){
    var ctrl=metaCtrlHtml();
    if(!list||!list.length){
      var raw=""; // #q는 페이지 내 찾기 전용 — 목록은 #q로 필터하지 않음
      var msg=raw?'<p class="hint"><b>현재 탭에 결과가 없습니다.</b><br>검색어 "'+esc(raw)+'"가 '+(activeTab==="champion"?"챔피언":activeTab==="item"?"아이템":mode==="standard"?"룬":"증강")+' 목록에 없습니다.</p>':'<p class="hint">데이터 없음.</p>';
      $("#meta").innerHTML=ctrl+msg;return;
    }
    var view=applyMetaView(list);
    var champ=(activeTab==="champion"), icCls=champ?"ci":(activeTab==="rune"&&mode==="standard"?"ri":"ii");
    var body=view.length?view.map(function(c,i){
      return '<div class="row'+(champ?' clk" data-champ="'+esc(c.name)+'"':'"')+'>'+
        tierBadge(c.tier)+img(c.icon,icCls)+
        '<span class="nm">'+esc(c.name)+'</span>'+wr(c.winRate,c.thin)+'<span class="g">'+kfmt(c.games)+'판</span></div>';
    }).join(""):'<p class="hint">해당 역할 '+(activeTab==="item"?"아이템":"챔피언")+'이 없어요.</p>';
    $("#meta").innerHTML=ctrl+body;
  }
  function fmtPct(n){n=Number(n||0);return n.toFixed(1).replace(/\.0$/,"")+"%";}
  /* ★2026-09-15 【MMR 구간 필터】 사이트 public/app_v2.js 의 구간 필터를 그대로 옮긴 것이다.
     구간 정의·라벨·물음표 문구·데이터 파일이 전부 사이트와 같다 — 여기서 새로 만들지 마라.
     고칠 일이 생기면 사이트 쪽을 고치고 여기로 다시 옮긴다.
     ⚠️ 구간은 실측으로 골랐다(아이언~실버 / 골드~플래티넘 / 에메랄드~챌린저).
        원래 안이던 "다이아~챌린저" 는 챔피언당 3,355판으로 혼자 5.3배 얇았다.
     ⚠️ MMR 은 10판 이상 계정에만 있어 구간 표본은 전체의 54% 다 — 전체와 숫자가 다른 건 정상이다.
     ⚠️ 그 구간에 표본이 없는 행은 **뺀다**(사이트와 동일). 0판을 0% 로 그리면 거짓이 된다. */
  var AM_TIER_BAND_DEFS=[
    {key:"all",label:"전체 구간",tiers:[]},
    {key:"low",label:"아이언~실버",tiers:[0,1,2]},
    {key:"mid",label:"골드~플래티넘",tiers:[3,4]},
    {key:"high",label:"에메랄드~챌린저",tiers:[5,6,7,8,9]}
  ];
  var activeTierBand="all", amTierBands=null, amTierBandsBusy=false;
  function amTierBandsLoad(){
    if(amTierBands||amTierBandsBusy)return;
    amTierBandsBusy=true;
    fetch("/api/tierbands",{cache:"no-store"}).then(function(r){return r.ok?r.json():Promise.reject(new Error("HTTP "+r.status))})
      .then(function(j){amTierBands=j||{data:{}}})
      .catch(function(){amTierBands={data:{}}})
      .then(function(){amTierBandsBusy=false; if(activeTierBand!=="all"&&tableLast)renderTablePayload(tableLast);});
  }
  /* 이 표가 어느 구간표를 봐야 하나 — 방송(메타 통계) 탭의 엔티티 선택을 그대로 쓴다. */
  function amTierBandType(){ return (bcEntity==="augment"||bcEntity==="item")?bcEntity:"champion"; }
  function amTierBandOn(){ return activeTierBand!=="all" && tableCategory==="broadcast"; }
  /* 구간 값으로 갈아끼운다. 메타(이름·아이콘)는 그대로 두고 수치만 바꾼다. */
  function amTierBandApply(rows,type){
    if(activeTierBand==="all"||!amTierBands||!amTierBands.data)return rows||[];
    var tbl=(amTierBands.data[type]||{})[activeTierBand];
    if(!tbl)return rows||[];
    /* ⚠️ 티어리스트 행에는 champion 필드가 없다 — key 를 쓴다(실측: {key:"jinx", entityId:222}).
       빌드가 낸 구간표 키도 같다(챔피언=슬러그, 증강·아이템=id 문자열). */
    var keyOf=function(r){
      if(r.key!=null&&r.key!=="")return String(r.key);
      if(type==="champion")return String(r.champion||r.label||"");
      return String(r.id!=null?r.id:(r.entityId!=null?r.entityId:""));
    };
    var out=[];
    (rows||[]).forEach(function(r){
      var v=tbl[keyOf(r)]; if(!v)return;
      out.push(Object.assign({},r,{games:v.games,wins:v.wins,losses:Math.max(0,(v.games||0)-(v.wins||0)),
        winRate:v.winRate,reportScore:v.reportScore,tier:v.tier,lowSample:false}));
    });
    return out;
  }
  /* ⚠️ 2026-09-15 운영자 지시 — 여기엔 티어 아이콘을 넣지 않는다.
     사이트는 고른 구간의 티어 그림을 드롭박스 왼쪽에 붙이는데, 이 앱의 표 도구 줄은 한 줄에
     기간·표·구간·새로고침이 다 들어가 있어서 구간마다 그림이 0~5개로 늘었다 줄었다 하면
     왼쪽 필터들의 폭이 그때마다 밀린다. 그래서 드롭박스와 물음표만 둔다. 아이콘을 다시 넣지 마라. */
  function amTierBandSelectHtml(){
    var opts=AM_TIER_BAND_DEFS.map(function(d){return '<option value="'+d.key+'"'+(activeTierBand===d.key?' selected':'')+'>'+esc(d.label)+'</option>'}).join('');
    /* 물음표 문구는 사이트와 글자까지 같다 — 내 말로 고쳐 쓰지 마라. */
    return '<span class="band-pick">'
      +'<select data-tier-band="1" aria-label="MMR 구간">'+opts+'</select>'
      +'<span class="ao-help" tabindex="0" aria-label="MMR 구간 설명">?<span class="ao-tip" role="tooltip"><b>MMR 구간 티어</b><br>이 티어는 랭크 게임 티어가 아니라 증바람MMR에 따라 배정된 티어에 위치한 유저들의 데이터입니다.</span></span></span>';
  }
  function tableCatDefs(){return tableDefs.filter(function(t){return (t.tab||t.category)===tableCategory});}
  // 티어 정렬 가능 여부 = 서버가 실제 행을 보고 알려준 hasTier. def 이름 regex로 판단하면 틀린다 —
  //   같은 표라도 q450 풀엔 티어가 있고 q2400(season2) 풀엔 없다(실측). 로드 전엔 종전 regex로 임시 판단.
  function isTierTableDef(def){return !!(def&&/^(observed|observedWeak)(Champion|Augment|Item)$/.test(def.key||""));}
  function tableHasTier(){ if(tableLast&&tableLast.table===activeTableKey&&tableLast.hasTier!=null) return !!tableLast.hasTier; var adef=activeTableDef(); return isTierTableDef(adef)||!!(adef&&adef.layout==="vertical"); }
  function normalizeTableSort(){ if(tableSort==="tier"&&!tableHasTier()){tableSort="games";tableDir="desc";} } // 티어 없는 표에서 티어순이 남아있지 않게
  function ensureTableKey(){
    var list=tableCatDefs();
    // ⚠️ tableDefs가 아직 로드 안 됐으면(빈 배열) tableCategory를 덮어쓰지 않는다 — 안 그러면 방송 등 새 탭이 로드 전 ensureTableKey에서 champion으로 리셋됨(레이스). defs 로드 후 콜백서 다시 ensureTableKey가 정상 선택.
    if(!list.length && tableDefs.length){tableCategory=(tableDefs[0]&&(tableDefs[0].tab||tableDefs[0].category))||"champion";list=tableCatDefs();}
    if(pendingTableKey && list.some(function(t){return t.key===pendingTableKey})){activeTableKey=pendingTableKey;pendingTableKey="";return;}
    if(!list.some(function(t){return t.key===activeTableKey})) activeTableKey=(list[0]&&list[0].key)||"";
  }
  function activeRangeLabel(){var r=(tableRanges||[]).filter(function(x){return x.key===activeTableRange})[0];return r?r.label:"전체";}
  function activeTableLabel(){var t=(tableDefs||[]).filter(function(x){return x.key===activeTableKey})[0];return t?t.label:"";}
  function emptyTableHint(){
    var raw="", label=(activeRangeLabel()+' · '+activeTableLabel()).trim(); // #q는 페이지 내 찾기 전용 — 표는 #q로 필터하지 않음
    if(raw) return '<p class="hint"><b>현재 표 기준 결과가 없습니다.</b><br>검색어 "'+esc(raw)+'"가 '+esc(label)+'에 없습니다. 다른 하위 표를 선택하거나 검색어를 지워 확인하세요.</p>';
    return '<p class="hint">데이터 없음.</p>';
  }
  function tableCtrlHtml(p){
    ensureTableKey();
    normalizeTableSort();
    var catH='';
    var rangeH='<select data-trange="1">'+(tableRanges.length?tableRanges:[{key:"all",label:"전체"}]).map(function(r){return '<option value="'+esc(r.key)+'" '+(activeTableRange===r.key?"selected":"")+'>'+esc(r.label)+'</option>'}).join('')+'</select>';
    var tableH='<select class="grow" data-tkey="1">'+tableCatDefs().map(function(t){return '<option value="'+esc(t.key)+'" '+(activeTableKey===t.key?"selected":"")+'>'+esc(t.label)+'</option>'}).join('')+'</select>';
    var loading=(p&&p.loading)?'<span class="table-loading">갱신 중</span>':'';
    var adef=activeTableDef(), blay=adef&&adef.layout;
    // 방송 정렬: 세로 데이터만 정렬바 노출(사이트와 동일, 티어순 포함). 티어/분포는 자체 컨트롤(버킷/지표칩)이라 정렬바 숨김.
    var _isMulti=adef&&/^multiplicity/.test(adef.key||""); // 많을때 표: 사이트와 동일 — 정렬바는 기준(승률 순/표본 순)만 두고, 열 선택은 열 제목 클릭
    var sorts=(tableHasTier()?[["tier","티어순"]]:[]).concat(_isMulti?[["label","가나다순"]]:[["games","표본순"],["label","가나다순"],["winRate","승률순"]]);
    var hideSort=(blay==="tier"||blay==="dist"||blay==="contrib"||blay==="augdrift"); // augdrift: 자체 열 제목 정렬
    var sortH=hideSort?'':'<div class="table-sortbar">'+(_isMulti?multiMetricButtons():'')+sorts.map(function(s){return '<button type="button" data-tsort="'+s[0]+'" class="'+(tableSort===s[0]?"on":"")+'">'+s[1]+(tableSort===s[0]?(tableDir==="asc"?" ↑":" ↓"):"")+'</button>';}).join('')+'</div>'+(_isMulti&&!hideSort?'<div class="table-trunc">기준을 고른 뒤 전체·1개~5개+ 열 제목을 누르면 그 열 기준으로 정렬돼요. 한 번 더 누르면 오름·내림차순이 바뀌어요.</div>':'');
    /* ★2026-09-15 운영자 지시 — 표 드롭박스 오른쪽, 새로고침 왼쪽 그 사이에 MMR 구간 필터를 둔다. */
    var bandH=(tableCategory==="broadcast")?amTierBandSelectHtml():'';
    var pickH='<div class="table-pickers">'+rangeH+tableH+bandH+'<button class="table-refresh" type="button" data-trefresh="1">새로고침</button>'+loading+'</div>';
    var headH='<div class="table-head"><span class="table-title">'+esc(activeRangeLabel())+' · '+esc(activeTableLabel())+'</span><button class="table-filter-toggle" type="button" data-tfilter="1">'+(tableFiltersClosed?'필터 열기':'필터 닫기')+'</button></div>';
    var pageH=''; // 이전/다음 페이지네이션 제거 — 모든 데이터를 한 화면에(limit 상향). 사용자 지시
    // ★2026-07-22 잘림 표시: 페이지네이션을 뺀 이상 "몇 행 중 몇 행"이라도 있어야 한다. 상대법 표는 실데이터로
    //   증바람 증강▶상대증강 41,630행 / 일반칼바람 챔피언▶상대챔피언 3,460행이라 상한을 넘는데 아무 표시가 없었다.
    if(p&&p.total&&p.rows&&p.rows.length<p.total) pageH='<div class="table-trunc">'+p.total.toLocaleString()+'행 중 '+p.rows.length.toLocaleString()+'행 표시 · 검색으로 좁히기</div>';
    return '<div class="table-ctrl '+(tableFiltersClosed?'compact':'')+'">'+headH+catH+pickH+sortH+pageH+'</div>';
  }
  function metric(label,val,cls,tip){return '<span class="metric '+(cls||'')+'"'+(tip?' title="'+esc(tip)+'"':'')+'><b>'+esc(val)+'</b><span>'+esc(label)+'</span></span>'} // tip=마우스 올리면 뜨는 전체 숫자(만 단위로 줄인 칸)
  function activeTableDef(){return (tableDefs||[]).filter(function(t){return t.key===activeTableKey})[0]||null;}
  function isBucketRows(rows){return rows&&rows.length&&Array.isArray(rows[0].durationBuckets)&&rows[0].durationBuckets.length;}
  function isMultiBucketRows(rows){
    var bs=(rows&&rows[0]&&rows[0].durationBuckets)||[];
    return bs.some(function(b){return /개/.test(String(b.label||""));});
  }
  function isOrderBucketRows(rows){
    var def=activeTableDef(), bs=(rows&&rows[0]&&rows[0].durationBuckets)||[];
    return !!(def&&def.context==="entityTimeAugment"&&mode==="augment") || bs.some(function(b){return /번째|선택/.test(String(b.label||""));});
  }
  function bucketHeaders(rows){
    var bs=((rows&&rows[0]&&rows[0].durationBuckets)||[]).slice();
    if(isMultiBucketRows(rows)) return ["1개","2개","3개","4개","5개+"].map(function(label){return {label:label};});
    if(isOrderBucketRows(rows)) return ["1번째","2번째","3번째","4번째"].map(function(label){return {label:label};});
    return bs.slice(0,4);
  }
  function bucketByLabel(row,label,index){
    var bs=row.durationBuckets||[];
    return bs.filter(function(b){return String(b.label||"")===String(label||"");})[0] || bs[index] || null;
  }
  function bucketMetricCell(b){
    var games=Number(b&&b.games||0);
    if(!b||games<3)return '<div class="bcell empty"><b>-</b><span>'+kfmt(games||0)+'판</span><i><u style="width:0%"></u></i></div>'; // 3판 미만은 노이즈(예 100% 1판) → "-"
    var wr=Number(b.winRate||0), cls=wr>=50?'good':'bad';
    var bar=Math.max(0,Math.min(100,wr));
    return '<div class="bcell '+cls+'"><b>'+fmtPct(wr)+'</b><span>'+kfmt(games)+'판</span><i><u style="width:'+bar+'%"></u></i></div>';
  }
  function headerButton(key,label){return '<button type="button" data-thsort="'+esc(key)+'" class="'+(tableSort===key?"on":"")+'">'+esc(label)+'</button>'}
  // 2026-08-24 '많을 때' 표 정렬 계약(사이트 app_v2.js와 동일) — 축이 둘이다.
  //   ① 기준 = 승률 순 / 표본 순 (정렬바 칩)   ② 열 = 전체·1개~5개+ (열 제목 클릭)
  //   기준에 따라 열의 정렬 key 를 winRate↔games / bucketN↔bucketNw 로 바꾼다. 현재 기준·열은 tableSort 하나에서 역산.
  function multiSortMetric(key){var k=String(key||"");if(k==="label"||k==="tier")return "";if(k==="winRate"||/^bucket[0-4]w$/.test(k)||k==="multiWinRate")return "winRate";return "games";}
  function multiSortColumn(key){var k=String(key||"");if(k==="winRate"||k==="games")return "total";var m=k.match(/^bucket([0-4])w?$/);return m?m[1]:"";}
  function multiSortKeyFor(col,metric){var wantGames=(metric!=="winRate");if(!col||col==="total")return wantGames?"games":"winRate";return "bucket"+col+(wantGames?"":"w");}
  function multiMetricButtons(){
    var m=multiSortMetric(tableSort);
    return [["winRate","승률 순"],["games","표본 순"]].map(function(o){return '<button type="button" data-tmetric="'+o[0]+'" class="'+(m===o[0]?"on":"")+'">'+o[1]+(m===o[0]?(tableDir==="asc"?" ↑":" ↓"):"")+'</button>';}).join('');
  }
  function timeSummaryText(row){
    var s=row.summary||{}, best=s.bestActiveHour||s.bestStartHour||{}, worst=s.worstActiveHour||s.worstStartHour||{}, bd=s.bestDuration||{}, wd=s.worstDuration||{};
    if(row.graphKind==="sample")return '총 '+kfmt(row.games)+'판 · 시간대별 표본 분포';
    if(row.graphKind==="trend")return (bd.label?'최고 '+bd.label+' '+fmtPct(bd.winRate):'')+(wd.label?' · 최저 '+wd.label+' '+fmtPct(wd.winRate):'');
    return (best.label?'최고 '+best.label+' '+fmtPct(best.winRate):'')+(worst.label?' · 최저 '+worst.label+' '+fmtPct(worst.winRate):'');
  }
  function renderTimeAnalysis(p){
    var rows=p&&p.rows?p.rows:[];
    if(!rows.length)return '<p class="hint">데이터 없음.</p>';
    return '<div class="time-analysis-grid">'+rows.map(function(r){
      var series=(r.series||[]).slice(0,24), kind=r.graphKind||"winRate";
      var vals=series.map(function(x){return kind==="sample"?Number(x.games||0):Number(x.winRate||0);});
      var max=Math.max.apply(null,vals.concat([1]));
      var bars=series.map(function(x){
        var val=kind==="sample"?Number(x.games||0):Number(x.winRate||0);
        var h=Math.max(2,Math.round(val/max*100));
        var label=kind==="sample"?kfmt(val):fmtPct(val);
        return '<span class="time-bar" title="'+esc(x.label+' · '+label+' · '+kfmt(x.games)+'판')+'"><i style="height:'+h+'%"></i><b>'+esc(label)+'</b></span>';
      }).join('');
      var labels=series.map(function(x){return '<span>'+esc(String(x.label||'').replace('시',''))+'</span>';}).join('');
      return '<div class="time-card"><h4>'+esc(r.label||'-')+'</h4><div class="tsum">'+esc(timeSummaryText(r))+'</div><div class="time-bars">'+bars+'</div><div class="time-labels">'+labels+'</div></div>';
    }).join('')+'</div>';
  }
  // 티어 분석(적합도, layout:contrib) — 엔티티별 좌/우 구성 마스터-디테일. 사이트 contrib 렌더 이식(닫힘=신발1+비신발1·그외 상위2 / 펼침=[3,7]·상위10).
  //   2026-08-27 적합도 미러: 선별(쿼터)은 유지, 순서·색·폭은 amFitScore(자기평균 기준) — 회색(같은 선/표본 부족)은 스텁.
  function contribCol(c,maxImpact,mode,entityWr){
    var arr=((c&&c.arr)||[]).slice().sort(amFitCmp(entityWr)),sub;
    if(c&&c.kind==="item"){var bt=[],nn=[];for(var i=0;i<arr.length;i++){(arr[i].isBoots?bt:nn).push(arr[i]);}sub=(mode==="open"?bt.slice(0,3).concat(nn.slice(0,7)):bt.slice(0,1).concat(nn.slice(0,1)));}
    else if(c&&c.kind==="rune"){var b0=[],b1=[],b2=[];for(var j=0;j<arr.length;j++){var rk=arr[j].runeRank;rk=(rk===0||rk===1||rk===2)?rk:1;(rk===0?b0:rk===1?b1:b2).push(arr[j]);}var rcc=(mode==="open"?[3,4,3]:[1,1,0]);sub=b0.slice(0,rcc[0]).concat(b1.slice(0,rcc[1])).concat(b2.slice(0,rcc[2]));} // 룬=메인/하위/파편 버킷(사이트 runeStructured 미러)
    else sub=arr.slice(0,mode==="open"?10:2);
    sub=sub.slice().sort(amFitCmp(entityWr));   // 선별 후 표시 순서도 적합도 순(사이트와 동일)
    var h='<div class="contrib-col"><div class="contrib-col-h">'+esc(c?c.label:'')+'</div>';
    if(!sub.length)return h+'<div class="contrib-bar-empty">표본 부족</div></div>';
    var mi=maxImpact>0?maxImpact:1;
    return h+'<div class="contrib-rank">'+sub.map(function(x){
      var v=amFitVerdict(x,entityWr),s=amFitScore(x,entityWr);
      var w=v===0?3:Math.max(3,Math.min(100,Math.abs(s)/mi*100));
      var bg=v>0?'var(--good)':v<0?'var(--bad)':'rgba(147,160,184,.55)';
      var cw=v>0?'cw-good':v<0?'cw-bad':'';
      return '<div class="contrib-rank-row" title="'+esc((x.label||'')+' · '+amFitLabel(x,entityWr)+' · 승률 '+fmtPct(x.winRate)+' · '+kfmt(x.games||0)+'판')+'"><span class="contrib-rank-ic">'+pim(x.icon)+'</span><div class="contrib-rank-track"><div class="contrib-rank-fill" style="width:'+w.toFixed(1)+'%;background:'+bg+'"></div><span class="contrib-rank-nm">'+esc(x.label||'')+'</span></div><div class="contrib-rank-meta"><b class="'+cw+'">'+fmtPct(x.winRate)+'</b> '+kfmt(x.games||0)+'판</div></div>';
    }).join('')+'</div></div>';
  }
  function renderContribEntity(r){
    var t=Number(r.tier),letter=({1:'S',2:'A',3:'B',4:'C',5:'D'})[t]||'',tb=letter?'<span class="contrib-tier t'+t+'">'+letter+'</span>':'';
    var good=(Number(r.winRate)||0)>=50;
    var head='<div class="contrib-head">'+(r.icon?'<span class="contrib-icon">'+pim(r.icon)+'</span>':'')+'<span class="contrib-name">'+esc(r.label)+'</span>'+tb+'<span class="contrib-spacer"></span><span class="contrib-wr '+(good?'good':'bad')+'">'+fmtPct(r.winRate)+'</span><span class="contrib-sample">'+kfmt(r.games||0)+'판</span></div>';
    var entityWr=Number(r.winRate)||50; // ★적합도 기준 = 이 항목 자기 평균(사이트와 동일)
    var _all=(((r.left&&r.left.arr)||[]).concat((r.right&&r.right.arr)||[])), mi=1;
    _all.forEach(function(x){var im=Math.abs(amFitScore(x,entityWr)); if(im>mi)mi=im;});
    var cl='<div class="contrib-cols">'+contribCol(r.left,mi,"closed",entityWr)+contribCol(r.right,mi,"closed",entityWr)+'</div>';
    var op='<div class="contrib-cols">'+contribCol(r.left,mi,"open",entityWr)+contribCol(r.right,mi,"open",entityWr)+'</div>';
    return '<details class="contrib-entity"><summary>'+head+cl+'</summary><div class="contrib-detail">'+op+'</div></details>';
  }
  function renderContribTable(p){
    var rows=(p&&p.rows)||[];
    if(!rows.length)return '<p class="hint">데이터 없음.</p>';
    return '<div class="contrib-hint">이 항목이 무엇을 가야 하는지를 봅니다. 막대 = 적합도(판수 × 승률차): <b style="color:var(--good)">초록</b> = 잘 맞는 픽(확실히 이기거나 자기 평균 위), <b style="color:var(--bad)">빨강</b> = 안 맞는 픽(확실히 평균 아래), 길수록 뚜렷. 가장 긴 초록이 맨 위, 가장 긴 빨강이 맨 아래. 승률 낮은 챔피언도 "그나마 맞는 픽"이 초록으로 뜹니다. 회색 = 평균과 같은 선이거나 표본 부족(30판 미만은 판정하지 않음). 항목을 누르면 전체가 펼쳐져요.</div><div class="contrib-list">'+rows.map(renderContribEntity).join('')+'</div>';
  }
  // 표 행/타일 → 엔티티 상세 클릭 라우팅. kind: champion(이름)·item/rune/augment(entityId). 쌍/조합("")은 비대상.
  function navDataAttr(r,kind){
    if(kind==="champion"&&(r.label||r.name)) return ' data-champ="'+esc(r.label||r.name)+'"';
    if((kind==="item"||kind==="rune"||kind==="augment")&&r.entityId!=null) return ' data-'+kind+'="'+esc(r.entityId)+'"';
    return '';
  }
  function navClk(r,kind){return navDataAttr(r,kind)?' clk':'';}
  function defNavKind(def){
    if(!def) return '';
    var c=String(def.context||'');
    if(c==="champion"||c==="entityTimeChampion") return "champion";
    if(c==="item"||c==="entityTimeItem") return "item";
    if(c==="augment"||c==="entityTimeAugment") return (mode==="augment")?"augment":"rune";
    return '';
  }
  function renderTableRows(rows, navKind){
    if(!rows||!rows.length)return emptyTableHint();
    if(isBucketRows(rows)){
      var headers=bucketHeaders(rows), multi=isMultiBucketRows(rows), order=isOrderBucketRows(rows);
      // 많을때(multi)=표본 총계열 제거(1개~5개 버킷만). 시간대·선택순서는 표본 유지.
      // 2026-08-24 많을때 열 제목은 정렬기준 칩(승률 순/표본 순)에 따라 정렬 key 가 바뀐다 — 첫 지표열은 사이트와 같은 '전체'.
      var _mMetric=multi?multiSortMetric(tableSort):"", _mSuffix=(_mMetric==="winRate")?"w":"";
      var h='<div class="th">'+headerButton("label","항목")+headerButton(multi&&_mMetric==="games"?"games":"winRate",multi?"전체":"승률")+(multi?'':headerButton("games","표본"))+headers.map(function(b,i){return headerButton("bucket"+i+(multi?_mSuffix:""),b.label||("-"+(i+1)));}).join('')+'</div>';
      return '<div class="bucket-table '+(multi?'multi-buckets':(order?'order-buckets':'time-buckets'))+'">'+h+rows.map(function(r){
        var iconList=(r.icons&&r.icons.length?r.icons:[r.icon,r.rightIcon].filter(Boolean)).slice(0,4);
        var icons='<span class="ticons">'+iconList.map(function(u){return '<img src="/img?u='+encodeURIComponent(u)+'" alt="">'}).join('')+'</span>';
        var sub=(r.leftLabel&&r.rightLabel&&!(r.label&&r.label.indexOf(r.leftLabel)>=0&&r.label.indexOf(r.rightLabel)>=0))?(r.leftLabel+' / '+r.rightLabel):''; // 제목에 두 이름이 이미 있으면(예: "제이스 ▶ 요네") 부제 생략 — 동어반복 제거(B3)
        var cls=r.winRate>=50?'good':'bad';
        var bs=r.durationBuckets||[];
        return '<div class="tr bucket-row'+navClk(r,navKind)+'"'+navDataAttr(r,navKind)+'><div class="tentity" title="'+esc((r.label||'')+(r.desc?'\n'+r.desc:''))+'">'+icons+'<div class="ttext"><div class="tname">'+esc(r.label||'-')+'</div>'+(sub?'<div class="tsub">'+esc(sub)+'</div>':'')+'</div></div>'+'<div class="bcell '+cls+'"><b>'+fmtPct(r.winRate)+'</b><i><u style="width:'+Math.max(0,Math.min(100,Number(r.winRate||0))).toFixed(0)+'%"></u></i></div>'+(multi?'':'<span class="metric"><b>'+kfmt(r.games)+'판</b></span>')+headers.map(function(h,i){return bucketMetricCell(bucketByLabel(r,h.label,i));}).join('')+'</div>'; // 많을때(multi)=표본 총계열 제거 — 총계(games)는 1개~5개 버킷의 합이라 무의미(2026-07-13 사용자 지시). 시간대·선택순서(비-multi)는 원본 games 표본 유지.
      }).join('')+'</div>';
    }
    // 헤더 3열: 항목 | (막대 레인 빈칸) | 승률·표본. 정렬버튼 그대로(table-sortbar와 동일 동작).
    var header='<div class="th">'+headerButton("label","항목")+'<span class="th-c">'+headerButton("winRate","승률")+'</span><span class="th-c">'+headerButton("games","표본")+'</span></div>';
    var renderRow=function(r){
      var iconList=(r.icons&&r.icons.length?r.icons:[r.icon,r.rightIcon].filter(Boolean)).slice(0,4);
      var icons='<span class="ticons">'+iconList.map(function(u){return '<img src="/img?u='+encodeURIComponent(u)+'" alt="">'}).join('')+'</span>';
      var sub=(r.leftLabel&&r.rightLabel&&!(r.label&&r.label.indexOf(r.leftLabel)>=0&&r.label.indexOf(r.rightLabel)>=0))?(r.leftLabel+' / '+r.rightLabel):''; // 제목에 두 이름이 이미 있으면(예: "제이스 ▶ 요네") 부제 생략 — 동어반복 제거(B3)
      var cls=r.winRate>=50?'good':'bad';
      var tier=isTierTableDef(activeTableDef())?tierBadge(r.tier):'';
      // 라벨(승률/표본) 제거: 상단 정렬헤더에 이미 있어 동어반복(사용자 지적). 승률 = 숫자 위 + 막대 아래 세로 스택(bcell 재사용, 버킷셀과 동일).
      var wr=Number(r.winRate||0);
      var bw=Math.max(0,Math.min(100,wr)).toFixed(1);
      var wrcell='<div class="bcell '+cls+'"><b>'+fmtPct(r.winRate)+'</b><i><u style="width:'+bw+'%"></u></i></div>';
      var smpcell='<div class="smpcell" title="'+kfmt(r.games)+'판">'+amMan(r.games)+'판</div>'; // 표본=그 표의 원본 games(사이트 실시간 창별 판수와 동일). canonical 통일 폐기. 2026-09-19 B안: 칸이 좁아 만 단위(285만판), 전체 숫자는 title.
      return '<div class="tr'+navClk(r,navKind)+'"'+navDataAttr(r,navKind)+'><div class="tentity" title="'+esc((r.label||'')+(r.desc?'\n'+r.desc:''))+'">'+tier+icons+'<div class="ttext"><div class="tname">'+esc(r.label||'-')+'</div>'+(sub?'<div class="tsub">'+esc(sub)+'</div>':'')+'</div></div>'+wrcell+smpcell+'</div>';
    };
    return '<div class="site-table">'+header+rows.map(renderRow).join('')+'</div>';
  }
  // 메타 표 챔피언 행 클릭 → 그 챔피언 메타 빌드(openChamp). 단일챔피언 표(고승률/저승률 챔피언)만 클릭 가능(쌍/아이템/룬/증강 표는 비대상).
  // ── 방송 리포트 4종 distinct 렌더러(사이트 이식, 2026-06-25): tier 사다리 / vertical 마스터-디테일 / dist 스캐터 / all 전체표 ──
  function moveBadge(r){return null;} // 떡상떡락(티어 이동 IN/OUT/▲▼) 개념 제거 — 컴패니언 불필요(2026-07-03 사용자 지시)
  function renderTierBoard(rows, navKind){
    rows=(rows||[]).slice(); // movement!=="out" 필터 해제 — 떡상떡락 개념 제거로 이동중인 챔프도 현재 티어에 그대로 표시
    if(!rows.length) return emptyTableHint();
    var LET={1:"S",2:"A",3:"B",4:"C",5:"D"};
    var byTier={1:[],2:[],3:[],4:[],5:[],sample:[]};
    rows.forEach(function(r){
      var raw=String(r.tier==null?"":r.tier);
      var t=(/^[1-5]$/.test(raw)&&!r.lowSample)?raw:"sample";
      byTier[t].push(r);
    });
    function sortT(a,b){return (Number(b.reportScore||0)-Number(a.reportScore||0))||(Number(b.games||0)-Number(a.games||0))||(Number(b.winRate||0)-Number(a.winRate||0));}
    function chip(r){
      var nm=r.label||"-";
      var ic=r.icon?'<img src="/img?u='+encodeURIComponent(r.icon)+'" alt="">':'<span>'+esc(nm.charAt(0))+'</span>';
      var mv=moveBadge(r);
      var tip=esc(nm+(r.desc?'\n'+r.desc:'')+'\n승률 '+fmtPct(r.winRate)+' · '+kfmt(r.games)+'판'+(r.rank?(' · '+r.rank+'위'):''));
      // 상시 승률 뱃지(§11 [data-wr]::after) — 사이트 dailyTierAsset와 동일 규칙(표본부족 제외, 48~52 중립)
      var wrN=Number(r.winRate);
      var hasWr=!r.lowSample&&isFinite(wrN)&&Number(r.games||0)>0;
      var wrCls=hasWr?(wrN>=52?' wr-up':(wrN<=48?' wr-dn':' wr-mid')):'';
      return '<span class="tier-asset-wrap'+(mv?' '+mv.kind:'')+wrCls+navClk(r,navKind)+'"'+navDataAttr(r,navKind)+(hasWr?' data-wr="'+esc(fmtPct(r.winRate))+'"':'')+' title="'+tip+'"><span class="tier-asset'+(mv?' has-change '+mv.kind:'')+'">'+ic+(mv?'<b>'+esc(mv.text)+'</b>':'')+'</span><span class="tier-asset-name">'+esc(nm)+'</span></span>';
    }
    var html=[1,2,3,4,5].map(function(t){
      var list=byTier[t].slice().sort(sortT);
      return '<div class="tier-row tier-'+t+'"><div class="tier-label"><strong>'+LET[t]+'</strong><span>TIER</span></div><div class="tier-icons">'+(list.map(chip).join('')||'<em>표본 없음</em>')+'</div></div>';
    }).join('');
    if(byTier.sample.length){
      html+='<div class="tier-sample-divider"><span>표본부족: 기본 집계 제외</span></div><div class="tier-row tier-sample"><div class="tier-label"><strong>표본부족</strong></div><div class="tier-icons">'+byTier.sample.slice().sort(sortT).map(chip).join('')+'</div></div>';
    }
    return '<div class="tier-board">'+html+'</div>';
  }
  // lo/hi = 사분면 라벨(사이트 '승률 분포' TABLES 의 xLow/xHigh 와 같은 글자, 2026-09-11 사이트와 화면 일치).
  var DIST_METRICS=[
    {key:"avgDpm",label:"딜량",axis:"분당 딜량",lo:"낮은 딜량",hi:"높은 딜량",fmt:function(v){return kfmt(Math.round(v))},acc:function(r){return Number(r.avgDpm||0)}},
    {key:"avgGoldPerMinute",label:"골드",axis:"분당 골드",lo:"낮은 골드",hi:"높은 골드",fmt:function(v){return kfmt(Math.round(v))},acc:function(r){return Number(r.avgGoldPerMinute||0)}},
    {key:"avgTakenPerMinute",label:"탱킹",axis:"분당 받은 피해",lo:"적게 받음",hi:"많이 받음(탱킹)",fmt:function(v){return kfmt(Math.round(v))},acc:function(r){return Number(r.avgTakenPerMinute||0)}},
    {key:"avgMitigatedPerMinute",label:"피해감소",axis:"분당 피해 감소",lo:"적게 버팀",hi:"많이 버팀",fmt:function(v){return kfmt(Math.round(v))},acc:function(r){return Number(r.avgMitigatedPerMinute||0)}},
    {key:"avgHealPerMinute",label:"회복",axis:"분당 회복",lo:"적은 회복",hi:"많은 회복",fmt:function(v){return kfmt(Math.round(v))},acc:function(r){return Number(r.avgHealPerMinute||0)}},
    {key:"avgCcPerMinute",label:"CC",axis:"분당 CC(초)",lo:"적은 CC",hi:"많은 CC",fmt:function(v){return Number(v).toFixed(2)+'초'},acc:function(r){return Number(r.avgCcPerMinute||0)}},
    {key:"reportScore",label:"포로점수",axis:"포로점수",lo:"낮은 점수",hi:"높은 점수",fmt:function(v){return Number(v).toFixed(1)},acc:function(r){return Number(r.reportScore||0)}},
    {key:"games",label:"표본",axis:"표본(판)",lo:"적은 표본",hi:"많은 표본",fmt:function(v){return kfmt(Math.round(v))+'판'},acc:function(r){return Number(r.games)||0}}
  ];
  function distChips(){return '<div class="dist-chips">'+DIST_METRICS.map(function(m){return '<button type="button" data-dist-metric="'+m.key+'" class="'+(distMetric===m.key?'on':'')+'">'+m.label+'</button>'}).join('')+'</div>';}
  // 방송 리포트 3종(티어/세로/분포) 공통 필터바 — 사이트의 클래스/표본 필터 이식. 세 뷰가 같은 상태(bcClass/bcHideLow)·같은 컨트롤 공유(일관성).
  //   broadcast는 챔프 단일 kind이므로 챔프 클래스(row.group)만. 엔티티타입/레어도/룬계열은 데이터 부재로 스코프 외.
  function isBroadcastLayout(lay){return lay==="tier"||lay==="vertical"||lay==="dist";}
  function bcApplyChampFilters(rows){
    var arr=(rows||[]).slice();
    if(bcClass!=="all") arr=arr.filter(function(r){return bcRowGroup(r)===bcClass;});
    if(bcHideLow) arr=arr.filter(function(r){return !(r.lowSample||String(r.tier)==="6"||String(r.tier)==="sample");});
    return arr;
  }
  var BC_RARITY_KO={all:"전체",silver:"실버",gold:"골드",prismatic:"프리즘"};
  var RUNE_CAT_KO={all:"전체",main:"메인룬",sub:"하위룬",shard:"파편"}; // 일반칼바람 룬 하위필터(키스톤=main). 사용자 요청 — 증강의 실버/골드/프리즘처럼
  function isRuneEntity(){ return bcEntity==="augment" && mode!=="augment"; } // 표준모드 '증강' 탭 = 룬
  function bcRowGroup(r){ return isRuneEntity() ? (r.runeCategory||"all") : (r.group||"all"); } // 룬=runeCategory, 그 외=챔프클래스
  // 엔티티 타입별 그룹 옵션. 챔프·아이템=챔프클래스, 증강=레어도, 룬=메인/하위/파편.
  function bcGroupKo(){
    if(bcEntity==="augment") return mode==="augment"?BC_RARITY_KO:RUNE_CAT_KO; // 증강=레어도, 표준 룬=카테고리
    return CLASS_KO; // 챔피언·아이템=챔프 클래스
  }
  function bcEntityTabs(){
    var second=mode==="augment"?"증강":"룬";
    var types=[["champion","챔피언"],["augment",second],["item","아이템"]];
    return types.map(function(t){return '<button type="button" data-bcentity="'+t[0]+'" class="'+(bcEntity===t[0]?"on":"")+'">'+t[1]+'</button>';}).join('');
  }
  // 기간(전체 / 최근 28일 / 최근 14일) = 상단 기간 필터와 같은 목록·같은 상태. 서버 TABLE_RANGES 를 그대로 쓴다.
  //   2026-08-24 전에는 여기만 따로 28/14/7일을 들고 있어 상단 필터와 서로 다른 기간을 가리킬 수 있었다.
  function bcWindowOptions(){
    var rs=(tableRanges&&tableRanges.length)?tableRanges:[{key:"all",label:"전체"}];
    return rs.map(function(r){return [r.key, r.label];});
  }
  function bcWindowActive(){ var o=bcWindowOptions(); return o.some(function(x){return x[0]===activeTableRange;})?activeTableRange:o[0][0]; }
  function broadcastCtrlHtml(rows){
    var KO=bcGroupKo();
    var cnt={}; (rows||[]).forEach(function(r){var g=bcRowGroup(r);cnt[g]=(cnt[g]||0)+1;});
    var classes=Object.keys(KO).filter(function(k){return k==="all"||cnt[k];}); // 데이터에 있는 그룹만(+전체)
    var classChips=(classes.length>1)?classes.map(function(k){return '<button type="button" data-bcclass="'+esc(k)+'" class="'+(bcClass===k?"on":"")+'">'+KO[k]+'</button>';}).join(''):'';
    var entChips=bcEntityTabs();
    var aw=bcWindowActive();
    var winChips=bcWindowOptions().map(function(o){return '<button type="button" data-bcwin="'+o[0]+'" class="'+(aw===o[0]?"on":"")+'">'+o[1]+'</button>';}).join('');
    return '<div class="bc-ctrl"><div class="bc-chips bc-ent">'+entChips+'</div><div class="bc-chips bc-win">'+winChips+'</div>'+(classChips?'<div class="bc-chips">'+classChips+'</div>':'')+'</div>'; // "표본부족 숨김" 버튼 제거(쓸데없음) — 사용자 지시
  }
  // ══ 분포 축 정본 amDistLayout — 사이트 app_v2.js 와 같은 본문(사이트 쪽 주석에 설계 이유). 한쪽만 고치면 두 화면이 갈라진다(2026-09-11). ══
  function amDistLayout(xs, ys, opts) {
    opts = opts || {};
    var BODY = 40, TAIL = 7, SIGMAS = 2.8, LADDER = [3, 2, 1.5, 1, 0.5, 0.25, 0], SYM = 0.35;
    var finite = function (a) { var o = []; for (var i = 0; i < a.length; i++) { var v = Number(a[i]); if (isFinite(v)) o.push(v); } return o; };
    var sorted = function (a) { return a.slice().sort(function (p, q) { return p - q; }); };
    var quant = function (s, p) { if (!s.length) return 0; var pos = (s.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
    var skew = function (a) { var n = a.length; if (n < 3) return 0; var m = 0, i; for (i = 0; i < n; i++) m += a[i]; m /= n; var m2 = 0, m3 = 0; for (i = 0; i < n; i++) { var d = a[i] - m; m2 += d * d; m3 += d * d * d; } m2 /= n; m3 /= n; return m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0; };
    var rawX = finite(xs).map(function (v) { return v < 0 ? 0 : v; });
    var sortedRawX = sorted(rawX);
    var xMedianRaw = quant(sortedRawX, 0.5);
    var shift = Math.max(1e-9, xMedianRaw * 0.02);
    var tf = function (lambda) { return lambda === 0 ? function (v) { return Math.log(Math.max(0, v) + shift); } : function (v) { return Math.pow(Math.max(0, v), lambda); }; };
    var inv = function (lambda) { return lambda === 0 ? function (t) { return Math.exp(t) - shift; } : function (t) { return Math.pow(Math.max(0, t), 1 / lambda); }; };
    var lambda = 1;
    if (rawX.length >= 3 && sortedRawX[sortedRawX.length - 1] > sortedRawX[0]) {
      var linSkew = Math.abs(skew(rawX));
      if (linSkew > SYM) {
        var best = 1, bestSkew = linSkew;
        for (var li = 0; li < LADDER.length; li++) {
          var s = Math.abs(skew(rawX.map(tf(LADDER[li]))));
          if (s < bestSkew - 1e-9) { bestSkew = s; best = LADDER[li]; }
        }
        lambda = best;
      }
    }
    var tx = tf(lambda), itx = inv(lambda);
    var tX = sorted(rawX.map(tx));
    var xCenter = quant(tX, 0.5);
    var xSigma = (quant(tX, 0.75) - quant(tX, 0.25)) / 1.349;
    if (!(xSigma > 0)) { var sd = 0; for (var k = 0; k < tX.length; k++) sd += (tX[k] - xCenter) * (tX[k] - xCenter); xSigma = tX.length ? Math.sqrt(sd / tX.length) : 0; }
    if (!(xSigma > 0)) xSigma = Math.max(1e-6, Math.abs(xCenter) * 0.05 || 1);
    var xHalf = xSigma * SIGMAS;
    var yCenter = isFinite(Number(opts.yCenter)) && opts.yCenter !== undefined && opts.yCenter !== null ? Number(opts.yCenter) : 50;
    var tY = sorted(finite(ys));
    var ySigma = (quant(tY, 0.75) - quant(tY, 0.25)) / 1.349;
    var yHalf = Math.max(Number(opts.minYHalf) || 6, (ySigma > 0 ? ySigma : 0) * SIGMAS);
    var xz = function (v) { return (tx(Number(v)) - xCenter) / xHalf; };
    var yz = function (v) { return (Number(v) - yCenter) / yHalf; };
    var place = function (z) { if (!isFinite(z)) return 50; var a = Math.abs(z); if (a <= 1) return 50 + BODY * z; return 50 + (z < 0 ? -1 : 1) * (BODY + TAIL * Math.tanh(0.8 * (a - 1))); };
    var xPct = function (v) { return place(xz(v)); };
    var yPct = function (v) { return place(yz(v)); };
    var xTicks = [], tZero = tx(0);
    for (var zi = -2; zi <= 2; zi++) { var tv = xCenter + zi * xSigma; var rv = itx(tv); if (isFinite(rv) && rv > 0 && tv > tZero) xTicks.push({ z: zi, value: rv, pct: 50 + BODY * (zi * xSigma / xHalf) }); }
    var yTicks = [];
    for (var yv = yCenter - 30; yv <= yCenter + 30; yv += 5) { var yzv = (yv - yCenter) / yHalf; if (Math.abs(yzv) <= 0.86) yTicks.push({ value: yv, pct: 50 + BODY * yzv }); }
    var scaleName = lambda === 1 ? "선형" : lambda === 0 ? "로그" : lambda === 0.5 ? "제곱근" : lambda === 0.25 ? "4제곱근" : lambda === 2 ? "제곱" : lambda === 3 ? "세제곱" : lambda === 1.5 ? "1.5제곱" : String(lambda) + "제곱";
    return { lambda: lambda, scaleName: scaleName, xCenter: itx(xCenter), xSigmaT: xSigma, yCenter: yCenter, yHalf: yHalf, tx: tx, inv: itx, xz: xz, yz: yz, place: place, xPct: xPct, yPct: yPct, xTicks: xTicks, yTicks: yTicks, body: BODY, tail: TAIL, count: rawX.length };
  }
  function renderDistScatter(rows, def, navKind){
    rows=(rows||[]).filter(function(r){return Number(r.games||0)>0;});
    if(!rows.length) return distChips()+emptyTableHint();
    var m=DIST_METRICS.filter(function(x){return x.key===distMetric})[0]||DIST_METRICS[0];
    // 2026-09-11 사이트 '승률 분포'(표본~군중 제어)와 같은 축·같은 화면. 축은 정본 amDistLayout(위, 사이트와 같은 본문):
    //   지표별 정규화 변환(사다리 자동 선택) + 중앙값 가운데·양쪽 같은 σ 척도 → 시간 승률 분포처럼 종 모양 구름이 그대로 보인다.
    //   화면 요소도 사이트와 같게: 격자 · 빨간 세로선(중앙값) · 파란 가로선(승률 50%) · 사분면 라벨 · 위/오른쪽 주변 밀도 띠 ·
    //   가로 눈금(중앙값·±1σ·±2σ 원 단위) · 세로 눈금(5%p) · 범위 밖은 가장자리에 붙이고 금테. 확대/이동(viewBox)은 종전 그대로.
    var W=500,H=500,PL=46,PR=18,PT=18,PB=46,R=13,BW=W-PL-PR,BH=H-PT-PB;
    var xs=rows.map(m.acc), ys=rows.map(function(r){return Number(r.winRate||0)});
    var lay=amDistLayout(xs, ys, {yCenter:50});
    var px=function(p){return PL+p/100*BW;}, py=function(p){return PT+(100-p)/100*BH;};
    var sx=function(v){return px(lay.xPct(v));}, sy=function(v){return py(lay.yPct(v));};
    var x0=px(50), y50=py(50), uid='dg'+Math.floor(Math.random()*1e6);
    var defsClips='<defs>'
      +'<pattern id="'+uid+'m" x="'+PL+'" y="'+PT+'" width="'+(BW*0.04).toFixed(2)+'" height="'+(BH*0.04).toFixed(2)+'" patternUnits="userSpaceOnUse"><path d="M '+(BW*0.04).toFixed(2)+' 0 L 0 0 0 '+(BH*0.04).toFixed(2)+'" fill="none" stroke="rgba(255,255,255,.055)" stroke-width="1"/></pattern>'
      +'<pattern id="'+uid+'M" x="'+PL+'" y="'+PT+'" width="'+(BW*0.12).toFixed(2)+'" height="'+(BH*0.12).toFixed(2)+'" patternUnits="userSpaceOnUse"><path d="M '+(BW*0.12).toFixed(2)+' 0 L 0 0 0 '+(BH*0.12).toFixed(2)+'" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="1"/></pattern>'
      +'<clipPath id="'+uid+'box"><rect x="'+PL+'" y="'+PT+'" width="'+BW+'" height="'+BH+'"/></clipPath>'
      +rows.map(function(r,i){return r.icon?('<clipPath id="dc'+i+'"><circle cx="'+sx(m.acc(r)).toFixed(1)+'" cy="'+sy(Number(r.winRate||0)).toFixed(1)+'" r="'+R+'"/></clipPath>'):''}).join('')+'</defs>';
    // (위·오른쪽 주변 밀도 띠는 사용자가 흉물이라 해 뺐다 — 사이트와 동일하게 점·안내선·눈금만.)
    var pts=rows.map(function(r,i){
      var xv=m.acc(r), wrn=Number(r.winRate||0), cx=sx(xv), cy=sy(wrn);
      var stroke=wrn>=50?'var(--good)':'var(--bad)';
      var lo=r.lowSample?' low':'';
      var out=(Math.abs(lay.xz(xv))>1||Math.abs(lay.yz(wrn))>1);
      var tip=esc((r.label||'-')+' · 승률 '+fmtPct(wrn)+' · '+m.axis+' '+m.fmt(xv)+' · '+kfmt(r.games)+'판'); // 표본=원본 games(사이트 창별 판수와 동일)
      var inner=r.icon
        ? '<image href="/img?u='+encodeURIComponent(r.icon)+'" x="'+(cx-R).toFixed(1)+'" y="'+(cy-R).toFixed(1)+'" width="'+(R*2)+'" height="'+(R*2)+'" clip-path="url(#dc'+i+')" preserveAspectRatio="xMidYMid slice"/>'
        : '<text x="'+cx.toFixed(1)+'" y="'+(cy+4).toFixed(1)+'" text-anchor="middle" class="dist-pt-txt">'+esc(String(r.label||'').slice(0,1))+'</text>';
      return '<g class="dist-pt'+lo+(out?' out':'')+'" data-tip="'+tip+'">'+(out?'<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+(R+3)+'" fill="none" stroke="rgba(255,216,122,.72)" stroke-width="3"/>':'')+'<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+R+'" fill="var(--card)" stroke="'+stroke+'" stroke-width="2"/>'+inner+'</g>'; // 클릭진입 제거(호버로만), data-tip=즉시 커스텀 툴팁 — 사용자 지시(빼곡해도 클릭불필요)
    }).join('');
    var xt=lay.xTicks.map(function(t){return '<text x="'+px(t.pct).toFixed(1)+'" y="'+(H-PB+16)+'" text-anchor="middle" class="dist-axis dist-tick'+(t.z===0?' dist-tick--x0':'')+'">'+esc(m.fmt(t.value))+'</text>';}).join('');
    var yt=lay.yTicks.map(function(t){return '<text x="'+(PL-5)+'" y="'+(py(t.pct)+4).toFixed(1)+'" text-anchor="end" class="dist-axis dist-tick'+(t.value===50?' dist-tick--y0':'')+'">'+t.value+'%</text>';}).join('');
    var quad=function(x,y,anchor,txt){return '<text x="'+x+'" y="'+y+'" text-anchor="'+anchor+'" class="dist-quad">'+esc(txt)+'</text>';};
    var svg='<svg class="dist-svg" viewBox="0 0 '+W+' '+H+'" role="img" preserveAspectRatio="xMidYMid meet">'+defsClips
      +'<rect x="'+PL+'" y="'+PT+'" width="'+BW+'" height="'+BH+'" fill="url(#'+uid+'m)"/><rect x="'+PL+'" y="'+PT+'" width="'+BW+'" height="'+BH+'" fill="url(#'+uid+'M)"/>'
      +'<rect x="'+PL+'" y="'+PT+'" width="'+BW+'" height="'+BH+'" fill="none" stroke="var(--line-2)"/>'
      +'<line x1="'+x0.toFixed(1)+'" y1="'+PT+'" x2="'+x0.toFixed(1)+'" y2="'+(PT+BH)+'" stroke="#ff174d" stroke-width="2.5"/>'
      +'<line x1="'+PL+'" y1="'+y50.toFixed(1)+'" x2="'+(W-PR)+'" y2="'+y50.toFixed(1)+'" stroke="#1687ff" stroke-width="2.5"/>'
      +quad(PL+8,PT+15,'start','고승률 · '+(m.lo||''))+quad(W-PR-8,PT+15,'end','고승률 · '+(m.hi||''))
      +quad(PL+8,PT+BH-7,'start','저승률 · '+(m.lo||''))+quad(W-PR-8,PT+BH-7,'end','저승률 · '+(m.hi||''))
      +yt+xt
      +'<text x="'+(PL+BW/2)+'" y="'+(H-6)+'" text-anchor="middle" class="dist-axis">'+esc(m.axis)+' · '+esc(lay.scaleName)+' 눈금 →</text>'
      +'<text x="10" y="'+(PT+BH/2)+'" text-anchor="middle" transform="rotate(-90 10 '+(PT+BH/2)+')" class="dist-axis">승률 →</text>'
      +pts+'</svg>';
    var avg=rows.reduce(function(s,r){return s+Number(r.winRate||0)},0)/rows.length;
    var sumG=rows.reduce(function(s,r){return s+(Number(r.games)||0)},0);
    var stats='<div class="dist-stats">'+metric('표시',rows.length+'개')+metric('합산 표본',kfmt(sumG)+'판')+metric('평균 승률',fmtPct(avg),avg>=50?'good':'bad')+'</div>';
    var zoomCtrl='<div class="dist-zoom"><button type="button" data-dz="in" aria-label="확대">+</button><button type="button" data-dz="out" aria-label="축소">−</button><button type="button" data-dz="reset" aria-label="리셋">⟲</button></div>';
    var hint='<div class="dist-hint">휠 확대 · 드래그 이동 · 더블클릭 또는 ⟲ 리셋 · 빨간 선 = 중앙값('+esc(m.fmt(lay.xCenter))+') · 파란 선 = 승률 50% · 금테 = 범위 밖(가장자리 띠에 눌러 담음)</div>';
    return distChips()+'<div class="dist-wrap">'+svg+zoomCtrl+'</div>'+hint+stats;
  }
  function renderVerticalLayout(rows, def, navKind){
    if(!rows||!rows.length) return emptyTableHint();
    var keyOf=function(r){return String(r.key!=null?r.key:(r.label||''));};
    var TLET=function(t){var n=Number(t);return (n>=1&&n<=5)?'SABCD'.charAt(n-1):'-';};
    // 아코디언: 닫힘=2열 목록, 항목 클릭 시 그 자리에서 좋은 조합 | 주의 조합을 좌우로 펼침(활성 항목은 전체폭 차지 → 카드 줄바꿈 없음). 모든 엔티티 동일. 사용자 #2.
    var items=rows.map(function(r,i){
      var k=keyOf(r), active=(k===verticalKey);
      var ic=r.icon?'<img src="/img?u='+encodeURIComponent(r.icon)+'" alt="">':'<span>'+esc((r.label||'-').slice(0,1))+'</span>';
      var tn=(r.lowSample||String(r.tier)==='6'||String(r.tier)==='sample')?6:Math.min(Number(r.tier)||5,5);
      var rate=(r.winRate==null)?'-':fmtPct(r.winRate);
      var rcls=(r.winRate==null)?'':(Number(r.winRate)>=50?'good':'bad');
      var rbw=(r.winRate==null)?'0':Math.max(0,Math.min(100,Number(r.winRate))).toFixed(1);
      var head='<button type="button" class="dv-row acc-head'+(active?' active':'')+'" data-dvkey="'+esc(k)+'" title="'+esc((r.label||'')+(r.desc?'\n'+r.desc:''))+'">'
        +'<span class="dv-av">'+ic+'</span>'
        +'<strong>'+esc(r.label||'-')+'</strong>'
        +'<span class="tier t'+Math.min(tn,5)+'">'+(tn===6?'·':TLET(r.tier))+'</span>'
        +'<span class="dv-rate '+rcls+'"><b>'+rate+'</b>'+(r.winRate==null?'':'<span class="dv-bar"><i style="width:'+rbw+'%"></i></span>')+'</span></button>';
      var body='';
      if(active){
        var wrCls=Number(r.winRate||0)>=50?'good':'bad';
        var poro=(r.reportScore!=null)?metric('포로점수',Number(r.reportScore).toFixed(1)):'';
        var _cg=Number(r.games||0); var conf=(_cg>=30)?['신뢰도 높음','high']:(_cg>=10?['표본 보통','mid']:['표본 적음','low']); // 신뢰도=원본 games 기준(집계판수와 일치)
        var kpis='<div class="dv-kpis acc-kpis">'
          +metric('승률', r.winRate==null?'-':fmtPct(r.winRate), wrCls)
          +metric('집계 판수', amMan(r.games||0)+'판', '', kfmt(r.games||0)+'판') // 원본 games(사이트 창별 판수와 동일). 2026-09-19 B안: 좁은 칸이라 만 단위, 전체는 title.
          +poro
          +metric('승 · 패', amMan(r.wins||0)+' / '+amMan(r.losses||0), '', kfmt(r.wins||0)+'승 / '+kfmt(r.losses||0)+'패') // 종전 "208,011 / 161,538"이 두 줄로 꺾였다
          +'</div>';
        var nav=navDataAttr(r,navKind)?'<button type="button" class="acc-detail clk"'+navDataAttr(r,navKind)+'>전체 상세 보기 →</button>':'';
        body='<div class="acc-body"><div class="dv-badges"><span class="dv-badge dv-badge--'+conf[1]+'">'+conf[0]+'</span></div>'+kpis
          +'<div class="dv-combos acc-wide" data-dvc="'+esc(dvBuildKey(r))+'" data-dvcname="'+esc(r.label||'')+'" data-dvctype="'+esc(bcEntity||'champion')+'"><div class="dv-combos-hint">빌드 데이터를 불러오는 중…</div></div>'+nav+'</div>';
      }
      return '<div class="acc-item'+(active?' active':'')+'">'+head+body+'</div>';
    }).join('');
    return '<div class="acc-grid">'+items+'</div>';
  }
  // ── 세로 지표 우측 = 빌드패널(사이트 aram-mayhem.com 이식) ───────────────────────────────
  //   구성 = [룬/증강 · 아이템] 2축 탭 + 검색 + 정렬(적합도/승률/표본) + 적합도 발산 막대(전량, 캡 없음).
  //   2026-08-27 적합도 미러(사이트 rankVerdict/rankScore와 동일): 막대 = 중앙선 기준 초록(우)=잘 맞음 / 빨강(좌)=안 맞음 /
  //   회색=같은 선·표본 부족(항상 스텁). 길이 = |적합도 점수| / (좌·우 두 축 통합 최댓값) × 50 — 탭을 바꿔도 재스케일되지 않는다.
  //   기본 정렬 = 서버 순서(템플릿), 적합도 순서는 "적합도" 버튼을 눌렀을 때만(사이트와 동일).
  var _dvBuildCache={}, _dvBuildState={ent:"",filter:"",sort:"impact",query:""};
  function dvBuildKey(r){ return String(bcEntity==="champion"||!bcEntity ? (r.label||r.key||"") : (r.id!=null?r.id:(r.key!=null?r.key:(r.label||"")))); }
  function dvFitMax(d,base){ var mi=1; ((d&&d.cols)||[]).forEach(function(c){ ((c&&c.arr)||[]).forEach(function(x){ var v=Math.abs(amFitScore(x,base)); if(v>mi)mi=v; }); }); return mi; }
  function dvBuildBody(d,col){
    var q=normName(_dvBuildState.query||""), arr=(col.arr||[]).slice();
    if(q)arr=arr.filter(function(c){return normName(c.label||"").indexOf(q)>=0;});
    var base=Number(d.entityWr)||50, s=_dvBuildState.sort;
    if(s==="winRate")arr.sort(function(a,b){return (Number(b.winRate)-Number(a.winRate))||(Number(b.games)-Number(a.games));});
    else if(s==="games")arr.sort(function(a,b){return (Number(b.games)-Number(a.games))||(Number(b.winRate)-Number(a.winRate));});
    else if(s==="contrib")arr.sort(amFitCmp(base)); // 적합도 순: 가장 긴 초록 맨 위 → 회색(0) → 가장 긴 빨강 맨 아래
    else { // 기본(impact) = 템플릿 순서: 서버 표본순 + 구조화(신발 선두·룬 버킷) — 사이트 colStructured("all") 미러(2026-08-27)
      if(col.kind==="item"){var _bt=[],_nn=[];arr.forEach(function(x){(x.isBoots?_bt:_nn).push(x);});arr=_bt.concat(_nn);}
      else if(col.kind==="rune"){var _b=[[],[],[]];arr.forEach(function(x){var rk=x.runeRank;rk=(rk===0||rk===1||rk===2)?rk:1;_b[rk].push(x);});arr=_b[0].concat(_b[1]).concat(_b[2]);}
    }
    if(!arr.length)return '<div class="contrib-bar-empty">'+(_dvBuildState.query?'"'+esc(_dvBuildState.query)+'" 검색 결과가 없습니다.':'표본이 아직 충분치 않습니다.')+'</div>';
    var mi=dvFitMax(d,base), den=Number(d.games)||1;
    return '<div class="contrib-rank dv-rank">'+arr.map(function(c){
      var v=amFitVerdict(c,base), sc=amFitScore(c,base);
      var dv=v===0?2.5:Math.max(2.5,Math.min(50,Math.abs(sc)/mi*50));
      var sh=Math.min(100,(Number(c.games)||0)/den*100);
      var w2=Number(c.winRate)||0, dA=w2-50, dR=w2-base;
      var dd=v>0?Math.max(dA,dR):Math.min(dA,dR), rn=(v>0?dA>=dR:dA<=dR)?"50%":"평균";
      var tip=(c.label||'')+' · '+amFitLabel(c,base)+' · 승률 '+fmtPct(c.winRate)+(v===0?'':'('+rn+' 대비 '+(dd>=0?'+':'')+dd.toFixed(1)+'%p)')+' · 채택 '+sh.toFixed(0)+'%('+kfmt(c.games||0)+'판)';
      var pos=(sc<0)?'is-bad':'is-good';
      var bg=v>0?'var(--good)':v<0?'var(--bad)':'rgba(147,160,184,.55)';
      var cw=v>0?'cw-good':v<0?'cw-bad':'';
      return '<div class="contrib-rank-row dv-rank-row" title="'+esc(tip)+'"><span class="contrib-rank-ic">'+pim(c.icon)+'</span>'
        +'<div class="contrib-rank-track dv-rank-track"><i class="contrib-rank-mid"></i>'
        +'<div class="contrib-rank-fill dv-rank-fill '+pos+'" style="width:'+dv.toFixed(1)+'%;background:'+bg+'"></div>'
        +'<span class="contrib-rank-nm">'+esc(c.label||'')+'</span></div>'
        +'<div class="contrib-rank-meta dv-rank-meta"><b class="'+cw+'">'+fmtPct(c.winRate)+'</b> <small>'+kfmt(c.games||0)+'판</small></div></div>';
    }).join('')+'</div>';
  }
  function dvBuildPanelHtml(d){
    if(!d) return '<div class="dv-combos-hint">빌드 데이터를 불러오는 중…</div>';
    if(!d.found||!d.cols||!d.cols.length) return '<div class="dv-combos-empty">이 항목의 빌드 데이터가 없어요.</div>';
    var st=_dvBuildState;
    var col=d.cols.filter(function(c){return c.key===st.filter;})[0]||d.cols[0];
    st.filter=col.key;
    var tabs='<div class="dv-build-tabs">'+d.cols.map(function(c){
      return '<button type="button" class="dv-build-tab'+(c.key===col.key?' active':'')+'" data-dvbtab="'+esc(c.key)+'">'+esc(c.label)+'<span class="dv-build-cnt">'+kfmt((c.arr||[]).length)+'</span></button>';
    }).join('')+'</div>';
    var sb=function(k,l){return '<button type="button" class="dv-build-sort-btn'+(st.sort===k?' active':'')+'" data-dvbsort="'+k+'">'+l+'</button>';};
    var ctrl='<div class="dv-build-controls"><div class="dv-build-search-wrap"><input type="search" class="dv-build-search" placeholder="'+esc(col.label)+' 검색" autocomplete="off" value="'+esc(st.query)+'"></div>'
      +'<div class="dv-build-sort">'+sb("contrib","적합도")+sb("winRate","승률")+sb("games","표본")+'</div></div>';
    var legend='<div class="dv-build-legend">막대 = <b>적합도</b> <small>오른쪽 초록 잘 맞음(확실히 이기거나 평균 위) · 왼쪽 빨강 안 맞음 · 길수록 뚜렷(판수×승률차) · 회색 같은 선/표본 부족 · 평균 '+fmtPct(d.entityWr)+'</small></div>';
    return '<div class="dv-build-panel">'+tabs+ctrl+legend+'<div class="dv-build-body">'+dvBuildBody(d,col)+'</div></div>';
  }
  function dvBuildBox(){ return document.querySelector('#meta .dv-combos[data-dvc]'); }
  function dvBuildRepaint(){ var b=dvBuildBox(); if(!b)return; var d=_dvBuildCache[_dvBuildState.ent]; if(d)b.innerHTML=dvBuildPanelHtml(d); }
  function hydrateDvCombos(){
    var box=dvBuildBox(); if(!box) return;
    var key=box.getAttribute('data-dvc'); if(!key){ box.innerHTML=''; return; }
    var type=box.getAttribute('data-dvctype')||'champion', nm=box.getAttribute('data-dvcname')||'';
    var ck=mode+'|'+activeTableRange+'|'+type+'|'+key;
    if(_dvBuildState.ent!==ck){ _dvBuildState={ent:ck,filter:"",sort:"impact",query:""}; } // 엔티티가 바뀌면 탭·정렬·검색 초기화(사이트와 동일)
    var fill=function(d){ var b=dvBuildBox(); if(b&&b.getAttribute('data-dvc')===key) b.innerHTML=dvBuildPanelHtml(d); };
    if(_dvBuildCache[ck]){ fill(_dvBuildCache[ck]); return; }
    fetch("/api/build-panel?mode="+mode+"&range="+encodeURIComponent(activeTableRange)+"&type="+encodeURIComponent(type)+"&key="+encodeURIComponent(key)+"&name="+encodeURIComponent(nm))
      .then(function(r){return r.json()}).then(function(d){ _dvBuildCache[ck]=d; fill(d); })
      .catch(function(){ var b=dvBuildBox(); if(b&&b.getAttribute('data-dvc')===key) b.innerHTML='<div class="dv-combos-empty">빌드 데이터 불러오기 실패</div>'; });
  }
  // ══════ 증강 제공 변동 5탭(지표 분석, layout:augdrift) — 사이트 app_v2.js installAugmentDriftTabs v3 이식(2026-09-03) ══════
  //   데이터 = /api/augdrift(사이트 augment-availability-season2.json 통째, gen loop 매시간 갱신). 서버는 행을 만들지 않고 여기서 그린다.
  //   사이트와 같은 규칙: 설명 문구 없음 · 판정 명칭 = 등장 확률 없음/감소/증가·신규 등장 · 오래 안 나온 증강(35일 0회) 제외 ·
  //   영문 원문 없음 · 헤더 = 판정 4종 개수(필터 토글) · 등급 열 정렬 · 검색 = 우상단 페이지 내 찾기(#q) 하나로 초상화·행을 거른다.
  var AMD = (function(){
    var TABLES = { augDriftAug: "aug", augDriftChamp: "champ", augDriftSlot: "slot", augDriftProbChamp: "prob", augDriftProbAug: "probaug" };
    var ST = { lost: "등장 확률 없음", down: "등장 확률 감소", up: "등장 확률 증가", new: "신규 등장" };
    var SC = { L: ST.lost, N: ST.new, D: ST.down, U: ST.up };
    var ORDER = ["lost", "down", "up", "new"];
    var RANK = { prismatic: 3, gold: 2, silver: 1 };
    var RN = { prismatic: "프리즘", gold: "골드", silver: "실버" };
    var S = { subjectAug: null, subjectChamp: null, subjectProb: null, subjectProbAug: null, order: "name", rarity: "all", cats: { lost: true, down: true, up: true, new: true }, sort: null, limit: 150 };
    var R = null, loadP = null, loadErr = null, lastTab = "";
    function rerender() { try { if (tableLast) renderTablePayload(tableLast); } catch (_) {} }
    function ensure() {
      if (R) return true;
      if (!loadP) loadP = fetch("/api/augdrift").then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !Array.isArray(j.augments)) throw new Error(j && j.error || "bad data");
        R = j; rerender();
      }).catch(function (e) { loadErr = e; loadP = null; rerender(); });
      return false;
    }
    var escT = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
    var numT = function (v, d) { d = d || 0; return Number(v || 0).toLocaleString("ko-KR", { maximumFractionDigits: d, minimumFractionDigits: d }); };
    var fmtP = function (v) { var x = Number(v) * 100; if (!isFinite(x)) return "-"; return (x >= 10 ? x.toFixed(1) : x.toFixed(2)) + "%"; };
    var fmtPp = function (v) { var x = Number(v) * 100; return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1) + "%p"; };
    var fmtDay = function (d) { return d ? (+String(d).slice(5, 7)) + "/" + (+String(d).slice(8, 10)) : ""; };
    var patchName = function (p) { var m = /^(\d+)\.(\d+)$/.exec(p || ""); return m ? ((+m[1]) + 10) + "." + m[2] : (p || "-"); };
    var pctChange = function (r) { return r >= 99 ? "신규" : (r >= 1 ? "+" : "−") + Math.abs(Math.round((r - 1) * 100)) + "%"; };
    var normS = function (s) { return String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, ""); };
    var iconOf = function (o, cls) { return (o && o.icon) ? '<img class="amd-ic ' + (cls || "") + '" src="' + escT(o.icon) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '<span class="amd-ic ' + (cls || "") + '"></span>'; };
    var isExcludedAug = function (a) { var w = a && a.win && a.win.week && a.win.week.raw; return !w || (Number(w.nB || 0) + Number(w.nR || 0)) === 0; };
    var hayOf = function (name, en) { return normS(name) + " " + normS(en || ""); };
    function searchQ() { try { var el = document.getElementById("q"); return el ? normS(el.value) : ""; } catch (_) { return ""; } }
    var augById = null, chById = null, probByAug = null;
    function idx() {
      if (augById) return;
      augById = new Map(R.augments.map(function (a) { return [a.id, a]; })); chById = new Map(R.champions.map(function (c) { return [c.id, c]; }));
      probByAug = new Map(); R.champions.forEach(function (c) { (c.probs || []).forEach(function (r) { if (!probByAug.has(r[0])) probByAug.set(r[0], []); probByAug.get(r[0]).push({ cid: c.id, nAll: r[1], nCur: r[2], nPrev: r[3], g: c.games }); }); });
    }
    var row = function (r) { return { id: r[0], nB: r[1], NB: r[2], nR: r[3], NR: r[4], eB: r[5], eR: r[6], st: r[7], z: r[8], codes: r[10], pB: r[2] ? r[1] / r[2] : 0, pR: r[4] ? r[3] / r[4] : 0 }; };
    var ratioOf = function (x) { return x.pB > 0 ? x.pR / x.pB : (x.pR > 0 ? 99 : 1); };
    var chg = function (x) { var r = ratioOf(x); return r >= 99 ? 9.99 : r - 1; };
    var ST2CODE = { lost: "L", new: "N", down: "D", up: "U" };
    function slotSpecial(codes, stt, relative, sep) {
      var b = relative ? "" : (ST2CODE[stt] || "-"); var by = {};
      for (var s = 0; s < 4; s += 1) { var c = String(codes || "")[s]; if (!c || c === "-" || c === "?" || c === b) continue; (by[c] = by[c] || []).push(s + 1); }
      return Object.keys(by).map(function (c) { return by[c].join("·") + "번째 " + (SC[c] || ""); }).join(sep || " · ");
    }
    function spark(counts, totals, label) {
      var n = counts.length; if (!n) return ""; var Wd = 160, H = 44, padX = 6, padT = 6, padB = 5;
      var vals = counts.map(function (c, i) { return totals[i] ? c / totals[i] : 0; }); var max = (Math.max.apply(null, vals) || 0.0001) * 1.15;
      var px = function (i) { return padX + (Wd - padX * 2) * (n > 1 ? i / (n - 1) : 0.5); }; var py = function (v) { return padT + (1 - Math.min(1, v / max)) * (H - padT - padB); };
      var pts = vals.map(function (v, i) { return px(i).toFixed(1) + "," + py(v).toFixed(1); }); var line = "M " + pts.join(" L ");
      var area = line + " L " + px(n - 1).toFixed(1) + "," + (H - padB).toFixed(1) + " L " + px(0).toFixed(1) + "," + (H - padB).toFixed(1) + " Z";
      var bounds = (R.boundaries || []).filter(function (b) { return b.idx > 0 && b.idx < n; }).map(function (b) { return '<line x1="' + px(b.idx).toFixed(1) + '" y1="' + (padT - 3) + '" x2="' + px(b.idx).toFixed(1) + '" y2="' + (H - padB + 2) + '" stroke="#4a5566" stroke-width="0.8" stroke-dasharray="2 2"><title>' + patchName(b.patch) + " " + fmtDay(b.day) + "</title></line>"; }).join("");
      var dots = vals.map(function (v, i) { return '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(v).toFixed(1) + '" r="2.6" fill="transparent"><title>' + fmtDay(R.days[i]) + ": " + fmtP(v) + "</title></circle>"; }).join("");
      return '<svg viewBox="0 0 ' + Wd + " " + H + '" role="img" aria-label="' + escT(label || "") + '" style="display:block;width:100%;height:auto"><path d="' + area + '" fill="#7fb4ec" fill-opacity="0.12"/><path d="' + line + '" fill="none" stroke="#7fb4ec" stroke-width="1.8" stroke-linejoin="round"/>' + bounds + dots + "</svg>";
    }
    var rarChip = function (r) { return r ? '<span class="amd-rar ' + r + '">' + (RN[r] || r) + "</span>" : '<span class="amd-muted">-</span>'; };
    var augCell = function (a) { return '<span class="amd-asset">' + iconOf(a, a.rarity) + "<strong>" + escT(a.name) + "</strong></span>"; };
    var champCell = function (c) { return '<span class="amd-asset">' + iconOf(c, "amd-champ") + "<strong>" + escT(c.name) + "</strong></span>"; };
    var rateCell = function (v, n, N) { return '<strong class="amd-num" title="' + numT(n) + " / " + numT(N) + '">' + fmtP(v) + "</strong>"; };
    var chgCell = function (x) { var r = ratioOf(x); return '<strong class="amd-num ' + (r >= 1 ? "amd-up" : "amd-down") + '">' + pctChange(r) + "</strong>"; };
    var slotCell = function (codes, stt) { var t = slotSpecial(codes, stt, false, "<br>"); return t ? '<span class="amd-slot-note">' + t + "</span>" : '<span class="amd-muted">-</span>'; };
    var th = function (key, label, width) { var on = S.sort && S.sort.key === key; return '<th class="amd-sortable" data-amd-sort="' + key + '" style="width:' + width + '">' + label + (on ? '<span class="amd-arrow">' + (S.sort.dir === "desc" ? "▼" : "▲") + "</span>" : "") + "</th>"; };
    var sortResetChip = function () { return S.sort ? '<button type="button" class="amd-chip amd-sm" data-amd-sort-reset="1">정렬 초기화</button>' : ""; };
    var rarityChips = function () { return '<span class="amd-chipset">' + [["all", "전체"], ["prismatic", "프리즘"], ["gold", "골드"], ["silver", "실버"]].map(function (p) { return '<button type="button" class="amd-chip amd-sm ' + (S.rarity === p[0] ? "active" : "") + '" data-amd-rarity="' + p[0] + '">' + p[1] + "</button>"; }).join("") + "</span>"; };
    var orderChips = function () { return '<span class="amd-chipset"><button type="button" class="amd-chip amd-sm ' + (S.order === "name" ? "active" : "") + '" data-amd-order="name">가나다</button><button type="button" class="amd-chip amd-sm ' + (S.order === "impact" ? "active" : "") + '" data-amd-order="impact">변화 큰 순</button></span>'; };
    var statCells = function (counts, cats) { return '<div class="amd-stats">' + ORDER.map(function (k) { return '<button type="button" class="amd-stat ' + k + (cats[k] ? " active" : "") + '" data-amd-cat="' + k + '" aria-pressed="' + (cats[k] ? "true" : "false") + '"><span>' + ST[k] + "</span><b>" + numT(counts[k] || 0) + "</b></button>"; }).join("") + "</div>"; };
    var sortVal = function (x, key, nameOf, rarityOf) { return key === "name" ? nameOf(x) : key === "rarity" ? (RANK[rarityOf ? rarityOf(x) : ""] || 0) : key === "before" ? x.pB : key === "now" ? x.pR : key === "change" ? chg(x) : 0; };
    var cmp = function (a, b) { return typeof a === "string" ? a.localeCompare(b, "ko") : a - b; };
    function tableRows(rowsAll, renderRow, cols, nameOf, rarityOf, q) {
      var active = rowsAll.filter(function (r) { return S.cats[r.st] && (!q || hayOf(nameOf(r), r.en || "").indexOf(q) >= 0); });
      if (S.sort) {
        var k = S.sort.key, dir = S.sort.dir === "desc" ? -1 : 1;
        var list = active.slice().sort(function (p, o) { return cmp(sortVal(p, k, nameOf, rarityOf), sortVal(o, k, nameOf, rarityOf)) * dir || cmp(nameOf(p), nameOf(o)); });
        return { html: list.slice(0, S.limit).map(renderRow).join(""), total: active.length };
      }
      var out = [], shown = 0;
      ORDER.forEach(function (k) {
        if (!S.cats[k]) return;
        var list = active.filter(function (r) { return r.st === k; }).sort(function (p, o) { return k === "lost" ? o.pB - p.pB : k === "new" ? o.pR - p.pR : Math.abs(o.z) - Math.abs(p.z); });
        if (!list.length) return;
        out.push('<tr class="amd-grp ' + k + '"><td colspan="' + cols + '">' + ST[k] + " <b>" + numT(list.length) + "</b></td></tr>");
        list.forEach(function (x) { if (shown >= S.limit) return; out.push(renderRow(x)); shown += 1; });
      });
      return { html: out.join(""), total: active.length };
    }
    function picker(kind, list, activeId, q) {
      var shown = 0;
      var portraits = list.map(function (p) {
        var hay = hayOf(p.name, p.en); var hide = q && hay.indexOf(q) < 0; if (!hide) shown += 1;
        var o = kind === "champ" ? chById.get(p.id) : augById.get(p.id);
        var img = (o && o.icon) ? '<img class="amd-ic ' + (kind === "champ" ? "amd-champ" : (p.rarity || "")) + '" src="' + escT(o.icon) + '" alt="' + escT(p.name) + '" loading="lazy" decoding="async">' : '<span class="amd-ic" style="font-size:10px;line-height:32px;text-align:center">' + escT(String(p.name).slice(0, 2)) + "</span>";
        return '<button type="button" class="amd-portrait' + (p.id === activeId ? " active" : "") + (p.hasData ? "" : " amd-nodata") + '" data-amd-subject="' + p.id + '" data-amd-hay="' + escT(hay) + '"' + (hide ? ' style="display:none"' : "") + ' title="' + escT(p.name) + (p.tip ? " · " + escT(p.tip) : "") + '" aria-pressed="' + (p.id === activeId) + '">' + img + (p.mark ? '<i class="amd-pmark ' + p.mark + '"></i>' : "") + "</button>";
      }).join("");
      return '<div class="amd-picker"><div class="amd-pick-head">' + orderChips() + (kind === "aug" ? rarityChips() : "") + '<small class="amd-cnt">' + numT(shown) + '개</small></div><div class="amd-portraits">' + portraits + "</div></div>";
    }
    var moreRow = function (total) { return total > S.limit ? '<div class="amd-more"><button type="button" data-amd-more="1">더보기 (' + numT(total - S.limit) + "개 더)</button></div>" : ""; };
    var tipOf = function (k) { return ORDER.map(function (s) { return ST[s] + " " + (k[s] || 0); }).join(" · "); };
    var byOrder = function (p, o) { return S.order === "name" ? p.name.localeCompare(o.name, "ko") : (o.imp - p.imp) || p.name.localeCompare(o.name, "ko"); };
    var champList = function () { return R.champions.map(function (c) { var k = c.counts.week; var p = c.picks.week; var hasData = p.R >= 30 && p.B >= 30; var mark = k.lost && k.new ? "mixed" : k.lost ? "lost" : k.new ? "gain" : ""; return { id: c.id, name: c.name, en: c.en, hasData: hasData, mark: mark, imp: hasData ? k.lost * 3 + k.new * 2 + k.down + k.up : -1, tip: tipOf(k) }; }).sort(byOrder); };
    var augList = function () { return R.augments.filter(function (a) { return !isExcludedAug(a); }).map(function (a) { var w = a.win.week.raw; var c = a.counts.week; var hasData = (w.nR + w.nB) >= 20; var mark = c.lost && c.new ? "mixed" : c.lost ? "lost" : c.new ? "gain" : ""; return { id: a.id, name: a.name, en: a.en, rarity: a.rarity, hasData: hasData, mark: mark, imp: hasData ? c.lost * 3 + c.new * 2 + c.down + c.up : -1, tip: fmtP(w.pB) + " → " + fmtP(w.pR) + " · " + tipOf(c) }; }).filter(function (p) { return S.rarity === "all" || p.rarity === S.rarity; }).sort(byOrder); };
    var subjectId = function (o, cls, name, rarity) { return '<div class="amd-sh-id">' + iconOf(o, cls + " amd-lg") + '<div class="amd-sh-name">' + escT(name) + (rarity ? " " + rarChip(rarity) : "") + "</div></div>"; };
    var tableWrap = function (inner) { return '<div class="amd-table-wrap"><table>' + inner + "</table></div>"; };
    function renderAug() {
      var q = searchQ(); var list = augList();
      if (!S.subjectAug || !augById.has(S.subjectAug) || isExcludedAug(augById.get(S.subjectAug))) S.subjectAug = ((list.filter(function (p) { return p.hasData; })[0] || list[0] || {}).id) || null;
      var a = augById.get(S.subjectAug); if (!a) return '<p class="hint">표시할 증강이 없습니다.</p>';
      var w = a.win.week; var c = a.counts.week;
      var rowsAll = a.champs.week.map(row).map(function (x) { x.en = (chById.get(x.id) || {}).en; return x; });
      var special = slotSpecial(w.codes, "", true);
      var head = '<div class="amd-subject amd-subject--aug">' + subjectId(a, a.rarity, a.name, a.rarity) + '<div class="amd-sh-mid">' + statCells(c, S.cats) + (special ? '<div class="amd-slot-note amd-sh-slot">선택 순서 ' + special + "</div>" : "") + '</div><div class="amd-sh-spark">' + spark(a.series, R.totals, a.name) + "</div></div>";
      var nameOf = function (x) { return (chById.get(x.id) || { name: "" }).name; };
      var tr = function (x) { var ch = chById.get(x.id) || { id: x.id, name: String(x.id) }; return '<tr class="amd-st-' + x.st + '" data-amd-hay="' + escT(hayOf(ch.name, ch.en)) + '"><td>' + champCell(ch) + "</td><td>" + rateCell(x.pB, x.nB, x.NB) + "</td><td>" + rateCell(x.pR, x.nR, x.NR) + "</td><td>" + chgCell(x) + "</td><td>" + slotCell(x.codes, x.st) + "</td></tr>"; };
      var t = tableRows(rowsAll, tr, 5, nameOf, null, q);
      return picker("aug", list, a.id, q) + head + (S.sort ? '<div class="amd-toolbar">' + sortResetChip() + "</div>" : "") + tableWrap("<thead><tr>" + th("name", "챔피언", "30%") + th("before", "이전 28일", "15%") + th("now", "최근 7일", "15%") + th("change", "변화", "14%") + '<th style="width:26%">선택 순서</th></tr></thead><tbody>' + (t.html || '<tr><td colspan="5" class="amd-empty">-</td></tr>') + "</tbody>") + moreRow(t.total);
    }
    function renderChamp() {
      var q = searchQ(); var list = champList();
      if (!S.subjectChamp || !chById.has(S.subjectChamp)) S.subjectChamp = ((list.filter(function (p) { return p.hasData; })[0] || list[0] || {}).id) || null;
      var c = chById.get(S.subjectChamp); if (!c) return '<p class="hint">표시할 챔피언이 없습니다.</p>';
      var rowsAll = c.augs.week.map(row).filter(function (x) { var a = augById.get(x.id); return a && !isExcludedAug(a); }).map(function (x) { x.en = (augById.get(x.id) || {}).en; return x; });
      var k = {}; ORDER.forEach(function (s) { k[s] = rowsAll.filter(function (x) { return x.st === s; }).length; });
      var head = '<div class="amd-subject amd-subject--champ">' + subjectId(c, "amd-champ", c.name, "") + '<div class="amd-sh-mid">' + statCells(k, S.cats) + "</div></div>";
      var nameOf = function (x) { return (augById.get(x.id) || { name: "" }).name; };
      var rarityOf = function (x) { return (augById.get(x.id) || {}).rarity || ""; };
      var tr = function (x) { var a = augById.get(x.id); return '<tr class="amd-st-' + x.st + '" data-amd-hay="' + escT(hayOf(a.name, a.en)) + '"><td>' + rarChip(a.rarity) + "</td><td>" + augCell(a) + "</td><td>" + rateCell(x.pB, x.nB, x.NB) + "</td><td>" + rateCell(x.pR, x.nR, x.NR) + "</td><td>" + chgCell(x) + "</td><td>" + slotCell(x.codes, x.st) + "</td></tr>"; };
      var t = tableRows(rowsAll, tr, 6, nameOf, rarityOf, q);
      return picker("champ", list, c.id, q) + head + (S.sort ? '<div class="amd-toolbar">' + sortResetChip() + "</div>" : "") + tableWrap("<thead><tr>" + th("rarity", "등급", "9%") + th("name", "증강", "27%") + th("before", "이전 28일", "14%") + th("now", "최근 7일", "14%") + th("change", "변화", "13%") + '<th style="width:23%">선택 순서</th></tr></thead><tbody>' + (t.html || '<tr><td colspan="6" class="amd-empty">-</td></tr>') + "</tbody>") + moreRow(t.total);
    }
    function probTable(rows, firstCol, nameOf, rarityOf, q) {
      var k = S.sort ? S.sort.key : "all"; var dir = S.sort ? (S.sort.dir === "desc" ? -1 : 1) : -1;
      var val = function (x) { return k === "name" ? nameOf(x) : k === "rarity" ? (RANK[rarityOf ? rarityOf(x) : ""] || 0) : k === "all" ? x.pAll : k === "cur" ? x.pCur : k === "prev" ? x.pPrev : k === "diff" ? x.pCur - x.pAll : x.pAll; };
      var list = rows.filter(function (x) { return !q || hayOf(nameOf(x), x.en || "").indexOf(q) >= 0; }).sort(function (p, o) { return cmp(val(p), val(o)) * dir || cmp(nameOf(p), nameOf(o)); });
      var diffCell = function (x) { var d = x.pCur - x.pAll; var big = Math.abs(d) >= 0.05 || (x.pAll > 0 && Math.abs(d / x.pAll) >= 0.3 && x.nAll >= 20); return '<strong class="amd-num ' + (big ? (d >= 0 ? "amd-up" : "amd-down") : "amd-muted") + '">' + fmtPp(d) + "</strong>" + (x.nCur === 0 && x.pAll >= 0.01 && x.gCur >= 30 ? ' <span class="amd-badge lost">' + ST.lost + "</span>" : ""); };
      return { total: list.length, body: list.slice(0, S.limit).map(function (x) { return '<tr data-amd-hay="' + escT(hayOf(nameOf(x), x.en || "")) + '">' + firstCol(x) + "<td>" + rateCell(x.pAll, x.nAll, x.gAll) + "</td><td>" + rateCell(x.pPrev, x.nPrev, x.gPrev) + "</td><td>" + rateCell(x.pCur, x.nCur, x.gCur) + "</td><td>" + diffCell(x) + "</td></tr>"; }).join("") };
    }
    var probHeads = function () { var PW = R.windows.prob; return { all: "전체 표본", prev: patchName(PW.prev && PW.prev.patch) + " 패치", cur: patchName(PW.cur.patch) + " 패치" }; };
    function renderProb() {
      var q = searchQ(); var H = probHeads();
      var list = champList().map(function (p) { var c = chById.get(p.id); p.hasData = c.games.all >= 30; p.tip = ""; p.mark = ""; return p; });
      if (!S.subjectProb || !chById.has(S.subjectProb)) S.subjectProb = ((list.filter(function (p) { return p.hasData; })[0] || list[0] || {}).id) || null;
      var c = chById.get(S.subjectProb); if (!c) return '<p class="hint">표시할 챔피언이 없습니다.</p>';
      var g = c.games;
      var rows = (c.probs || []).map(function (r) { var a = augById.get(r[0]); return { id: r[0], a: a, en: a && a.en, nAll: r[1], nCur: r[2], nPrev: r[3], gAll: g.all, gCur: g.cur, gPrev: g.prev, pAll: g.all ? r[1] / g.all : 0, pCur: g.cur ? r[2] / g.cur : 0, pPrev: g.prev ? r[3] / g.prev : 0 }; }).filter(function (x) { return x.a && !isExcludedAug(x.a); });
      if (S.rarity !== "all") rows = rows.filter(function (x) { return x.a.rarity === S.rarity; });
      var t = probTable(rows, function (x) { return "<td>" + rarChip(x.a.rarity) + "</td><td>" + augCell(x.a) + "</td>"; }, function (x) { return x.a.name; }, function (x) { return x.a.rarity; }, q);
      return picker("champ", list, c.id, q) + '<div class="amd-subject amd-subject--slim">' + subjectId(c, "amd-champ", c.name, "") + '<div class="amd-toolbar amd-toolbar--inline">' + rarityChips() + '<small class="amd-cnt">' + numT(t.total) + "종</small>" + sortResetChip() + "</div></div>" + tableWrap("<thead><tr>" + th("rarity", "등급", "9%") + th("name", "증강", "31%") + th("all", H.all, "15%") + th("prev", H.prev, "15%") + th("cur", H.cur, "15%") + th("diff", "차이", "15%") + "</tr></thead><tbody>" + (t.body || '<tr><td colspan="6" class="amd-empty">-</td></tr>') + "</tbody>") + moreRow(t.total);
    }
    function renderProbAug() {
      var q = searchQ(); var H = probHeads();
      var list = R.augments.filter(function (a) { return !isExcludedAug(a); }).map(function (a) { return { id: a.id, name: a.name, en: a.en, rarity: a.rarity, hasData: !!(a.games && a.games.all >= 30), mark: "", imp: a.games ? a.games.all : 0, tip: "" }; }).filter(function (p) { return S.rarity === "all" || p.rarity === S.rarity; }).sort(byOrder);
      if (!S.subjectProbAug || !augById.has(S.subjectProbAug) || isExcludedAug(augById.get(S.subjectProbAug))) S.subjectProbAug = ((list.filter(function (p) { return p.hasData; })[0] || list[0] || {}).id) || null;
      var a = augById.get(S.subjectProbAug); if (!a) return '<p class="hint">표시할 증강이 없습니다.</p>';
      var rows = (probByAug.get(a.id) || []).map(function (r) { var c = chById.get(r.cid); return { cid: r.cid, c: c, en: c && c.en, nAll: r.nAll, nCur: r.nCur, nPrev: r.nPrev, g: r.g, gAll: r.g.all, gCur: r.g.cur, gPrev: r.g.prev, pAll: r.g.all ? r.nAll / r.g.all : 0, pCur: r.g.cur ? r.nCur / r.g.cur : 0, pPrev: r.g.prev ? r.nPrev / r.g.prev : 0 }; }).filter(function (x) { return x.c && x.g.all >= 30; });
      var t = probTable(rows, function (x) { return "<td>" + champCell(x.c) + "</td>"; }, function (x) { return x.c.name; }, null, q);
      return picker("aug", list, a.id, q) + '<div class="amd-subject amd-subject--slim">' + subjectId(a, a.rarity, a.name, a.rarity) + '<div class="amd-toolbar amd-toolbar--inline"><small class="amd-cnt">' + numT(t.total) + "명</small>" + sortResetChip() + "</div></div>" + tableWrap("<thead><tr>" + th("name", "챔피언", "36%") + th("all", H.all, "16%") + th("prev", H.prev, "16%") + th("cur", H.cur, "16%") + th("diff", "차이", "16%") + "</tr></thead><tbody>" + (t.body || '<tr><td colspan="5" class="amd-empty">-</td></tr>') + "</tbody>") + moreRow(t.total);
    }
    function renderSlot() {
      var q = searchQ();
      var list = R.augments.filter(function (a) { return a.win.week.special && !isExcludedAug(a); }).map(function (a) { return { a: a, w: a.win.week }; });
      if (S.rarity !== "all") list = list.filter(function (x) { return x.a.rarity === S.rarity; });
      if (q) list = list.filter(function (x) { return hayOf(x.a.name, x.a.en).indexOf(q) >= 0; });
      var k = S.sort ? S.sort.key : "name"; var dir = S.sort ? (S.sort.dir === "desc" ? -1 : 1) : 1;
      var val = function (x) { return k === "name" ? x.a.name : k === "rarity" ? (RANK[x.a.rarity] || 0) : k === "now" ? x.w.raw.pR : k === "before" ? x.w.raw.pB : k === "change" ? (x.w.raw.ratio >= 99 ? 9.99 : x.w.raw.ratio - 1) : /^slot\d$/.test(k) ? x.w.slots[+k.slice(4)].pR : 0; };
      list.sort(function (p, o) { return cmp(val(p), val(o)) * dir || p.a.name.localeCompare(o.a.name, "ko"); });
      var cell = function (c, code) { return '<td class="amd-sc-' + code + '"><span class="amd-nowrap" title="' + numT(c.nB) + "회 → " + numT(c.nR) + '회">' + fmtP(c.pB) + " → <b>" + fmtP(c.pR) + "</b></span>" + (code !== "-" && code !== "?" ? '<em class="amd-scode ' + code + '">' + (SC[code] || "") + "</em>" : "") + "</td>"; };
      var body = list.slice(0, S.limit).map(function (x) { var a = x.a, w = x.w; return '<tr data-amd-hay="' + escT(hayOf(a.name, a.en)) + '"><td>' + rarChip(a.rarity) + "</td><td>" + augCell(a) + '</td><td><span class="amd-nowrap">' + fmtP(w.raw.pB) + " → <b>" + fmtP(w.raw.pR) + "</b></span></td>" + [0, 1, 2, 3].map(function (s) { return cell(w.slots[s], String(w.codes || "")[s] || "?"); }).join("") + '<td><span class="amd-slot-note">' + (slotSpecial(w.codes, "", true, "<br>") || "-") + "</span></td></tr>"; }).join("");
      return '<div class="amd-toolbar">' + rarityChips() + '<small class="amd-cnt">' + numT(list.length) + "종</small>" + sortResetChip() + "</div>" + '<div class="amd-table-wrap amd-slots"><table><thead><tr>' + th("rarity", "등급", "6%") + th("name", "증강", "16%") + th("now", "전체", "10%") + [0, 1, 2, 3].map(function (s) { return th("slot" + s, (s + 1) + "번째", "13%"); }).join("") + '<th style="width:16%">특이점</th></tr></thead><tbody>' + (body || '<tr><td colspan="8" class="amd-empty">-</td></tr>') + "</tbody></table></div>" + moreRow(list.length);
    }
    var RENDER = { aug: renderAug, champ: renderChamp, slot: renderSlot, prob: renderProb, probaug: renderProbAug };
    function render(p) {
      try {
        if (mode !== "augment") return '<p class="hint">증강 칼바람 전용 표입니다.</p>';
        if (!ensure()) return loadErr ? '<p class="hint">데이터를 불러오지 못했습니다. 잠시 후 다시 시도합니다.</p>' : '<p class="hint">불러오는 중입니다…</p>';
        idx();
        var def = activeTableDef(); var kind = (def && def.drift) || TABLES[def && def.key] || "aug";
        if (kind !== lastTab) { S.sort = null; S.limit = 150; lastTab = kind; }
        return '<section class="amd-root" data-amd-tab="' + kind + '">' + RENDER[kind]() + "</section>";
      } catch (e) { try { console.warn("augment drift render failed", e); } catch (_) {} return '<p class="hint">표를 그리지 못했습니다.</p>'; }
    }
    document.addEventListener("click", function (ev) {
      var root = ev.target.closest && ev.target.closest(".amd-root"); if (!root) return;
      var t = ev.target.closest("button, th.amd-sortable"); if (!t) return;
      var tab = root.getAttribute("data-amd-tab");
      if (t.dataset.amdSubject && !t.classList.contains("amd-nodata")) { var id = Number(t.dataset.amdSubject); if (tab === "aug") S.subjectAug = id; else if (tab === "prob") S.subjectProb = id; else if (tab === "probaug") S.subjectProbAug = id; else S.subjectChamp = id; S.limit = 150; rerender(); return; }
      if (t.dataset.amdOrder) { S.order = t.dataset.amdOrder; rerender(); return; }
      if (t.dataset.amdRarity) { S.rarity = t.dataset.amdRarity; rerender(); return; }
      if (t.dataset.amdCat) { S.cats[t.dataset.amdCat] = !S.cats[t.dataset.amdCat]; rerender(); return; }
      if (t.dataset.amdSortReset) { S.sort = null; rerender(); return; }
      if (t.dataset.amdSort) { var key = t.dataset.amdSort; if (S.sort && S.sort.key === key) S.sort.dir = S.sort.dir === "desc" ? "asc" : "desc"; else S.sort = { key: key, dir: key === "name" ? "asc" : "desc" }; rerender(); return; }
      if (t.dataset.amdMore) { S.limit += 150; rerender(); return; }
    }, true);
    // 우상단 페이지 내 찾기(#q) 하나로 초상화·행을 거른다(재렌더 없음 — 사이트의 상세표 검색과 같은 역할).
    function applyDomFilter(q) {
      var root = document.querySelector(".amd-root"); if (!root) return;
      var shown = 0;
      root.querySelectorAll(".amd-portrait").forEach(function (b) { var hide = q && String(b.getAttribute("data-amd-hay") || "").indexOf(q) < 0; b.style.display = hide ? "none" : ""; if (!hide) shown += 1; });
      var cnt = root.querySelector(".amd-picker .amd-cnt"); if (cnt) cnt.textContent = numT(shown) + "개";
      root.querySelectorAll("tbody tr[data-amd-hay]").forEach(function (tr) { tr.style.display = (q && String(tr.getAttribute("data-amd-hay") || "").indexOf(q) < 0) ? "none" : ""; });
    }
    document.addEventListener("input", function (ev) { var el = ev.target; if (!el || el.id !== "q") return; applyDomFilter(normS(el.value)); }, true);
    return { render: render };
  })();
  function renderAugDrift(p){ return AMD.render(p); }
  function renderTableBody(p){
    var def=activeTableDef();
    var lay=(p&&p.layout)||(def&&def.layout)||"";
    var rows=(p&&p.rows)||[];
    var navKind=defNavKind(def);
    if(isBroadcastLayout(lay)){
      navKind=(bcEntity==="champion")?"champion":(bcEntity==="item")?"item":(bcEntity==="augment")?((mode==="augment")?"augment":"rune"):""; // 방송 엔티티 종류별 행 클릭→상세
      var bar=tableFiltersClosed?'':broadcastCtrlHtml(rows);          // 엔티티/클래스/표본 필터바 — 필터 닫기 시 표 필터(범위/정렬)와 함께 통일되게 숨김(사용자 #1). 상태는 유지돼 필터는 계속 적용됨
      var f=bcApplyChampFilters(rows);          // 필터 적용 후 각 뷰 렌더
      if(lay==="tier")     return bar+renderTierBoard(f, navKind);
      if(lay==="vertical") return bar+renderVerticalLayout(f, def, navKind);
      if(lay==="dist")     return bar+renderDistScatter(f, def, navKind);
    }
    if(lay==="contrib") return renderContribTable(p); // 티어 분석(기여 분해) 전용 마스터-디테일 렌더
    if(lay==="augdrift") return renderAugDrift(p); // 증강 제공 변동 5탭(지표 분석) — 사이트 이식, 클라가 /api/augdrift 를 받아 그린다
    return renderTableRows(rows, navKind);
  }
  function renderTablePayload(p){
    if(!p||p.ok===false){$("#meta").innerHTML=tableCtrlHtml(tableLast||{rows:[],total:0,offset:0,limit:tableLimit})+'<p class="hint">표 데이터를 불러오지 못했습니다.</p>';return;}
    // 서버가 실제로 쓴 정렬을 채택 — auto 였으면 여기서 티어순/표본순이 확정돼 정렬바 버튼이 맞게 켜진다.
    if(p.sort)tableSort=p.sort; if(p.dir)tableDir=p.dir;
    /* ★2026-09-15 MMR 구간 — 원본(p)은 tableLast 에 그대로 두고, 그리는 것만 구간 값으로 갈아끼운다.
       원본을 덮으면 구간을 "전체"로 되돌렸을 때 돌아갈 값이 없어진다. */
    tableLast=p;
    var view=p;
    if(amTierBandOn()){ amTierBandsLoad(); view=Object.assign({},p,{rows:amTierBandApply(p.rows,amTierBandType())}); }
    $("#meta").innerHTML=tableCtrlHtml(view)+renderTableBody(view);hydrateDvCombos();
  }
  var metaLoadSeq=0; // 모드 빠른 토글 등 동시 로드 레이스 방지 — 스테일 응답 무시 + 실패 시 자가복구(고착 버그 수정)
  function loadTableDefs(done){
    if(tableDefs.length){ensureTableKey();if(done)done();return;}
    if(!tableLast)$("#meta").innerHTML=skList(8);
    var seq=metaLoadSeq;
    fetch("/api/tables?mode="+mode).then(function(r){return r.json()}).then(function(j){
      if(seq!==metaLoadSeq)return; // 그새 모드/탭 바뀜 → 스테일, 클로버 방지
      tableDefs=j.tables||[];tableRanges=j.ranges||[];tableTabs=j.tabs||[];if(tableRanges.length&&!tableRanges.some(function(r){return r.key===activeTableRange;}))activeTableRange=tableRanges[0].key;bcWindow=activeTableRange;ensureTableKey();if(done)done();else loadSiteTable(true);
    }).catch(function(){ if(seq!==metaLoadSeq)return; setTimeout(function(){ if(seq===metaLoadSeq&&!tableDefs.length)loadTableDefs(done); },300); }); // 스테일이면 무시, 아니면 300ms 후 재시도(고착 방지)
  }
  function loadSiteTable(reset){
    if(reset)tableOffset=0;
    var seq=++metaLoadSeq; // 이 로드의 토큰 — 더 새 로드가 시작되면 이 응답은 무시
    ensureTableKey();normalizeTableSort();
    loadTableDefs(function(){
      if(seq!==metaLoadSeq)return; // 스테일 로드 무시(레이스)
      ensureTableKey();
      var q=""; // #q는 페이지 내 찾기 전용 — 표는 서버 검색어로 필터하지 않음(찾기가 행을 하이라이팅)
      var compatible=tableLast&&tableLast.mode===mode&&tableLast.range===activeTableRange&&tableLast.table===activeTableKey;
      var loadingPayload=compatible?Object.assign({},tableLast,{loading:true}):{rows:[],total:0,offset:tableOffset,limit:tableLimit,loading:true};
      $("#meta").innerHTML=tableCtrlHtml(loadingPayload)+(compatible?renderTableBody(tableLast):skList(6));
      var url="/api/table?mode="+mode+"&range="+activeTableRange+"&table="+encodeURIComponent(activeTableKey)+"&limit="+tableLimit+"&offset="+tableOffset+"&sort="+encodeURIComponent(tableSort)+"&dir="+encodeURIComponent(tableDir)+"&q="+encodeURIComponent(q)+"&bctype="+encodeURIComponent(bcEntity)+"&bcwin="+encodeURIComponent(bcWindowActive());
      fetch(url).then(function(r){return r.json()}).then(function(p){ if(seq!==metaLoadSeq)return; renderTablePayload(p); }).catch(function(){ if(seq!==metaLoadSeq)return; $("#meta").innerHTML=tableCtrlHtml(tableLast||{rows:[],total:0,offset:0,limit:tableLimit})+'<p class="hint">표 데이터를 불러오지 못했습니다.</p>';});
    });
  }
  function scheduleTableSearch(){clearTimeout(tableTimer);tableTimer=setTimeout(function(){loadSiteTable(true)},180);}
  function loadChampMeta(){ // 챔피언 메타 = 내챔프열 인라인 비교에도 쓰임 → 항상 보유
    var m=mode; fetch("/api/champs?mode="+m).then(function(r){return r.json()}).then(function(l){ if(m!==mode)return; champMetaList=Array.isArray(l)?l:[]; renderMyChamps(); }).catch(function(){}); // 2026-07-09 모드캡처(일칼·증바람 혼입 방지)+배열가드(500 {error}객체가 renderMyChamps.forEach throw 유발 방지)
  }
  function loadTab(tab, keepQuery){
    tab=normalizeMetaTab(tab);
    setMetaTabButton(tab); // 페이지 내 찾기는 탭 전환에도 유지 — 관찰자가 새 탭 내용에 재적용(모든 탭·필터에서 계속 검색됨). 지우지 않음.
    // 모든 메타 탭은 테이블시스템으로(고승률/저승률/쌍/시간대 필터). 우측 "내 챔피언 통계"용 champMetaList는 loadChampMeta가 별도 유지.
    tableCategory=tab; activeTableKey=""; tableOffset=0; tableSort="auto"; tableDir="auto"; verticalKey=""; bcClass="all"; bcHideLow=false; bcEntity="champion"; bcWindow=""; loadSiteTable(true);
  }
  // 메타 통계(가운데)+내 챔피언 통계도 자동갱신 — 데이터 들어오면 알아서 판수 올라감(검색 중이면 목록은 안 건드림).
  function reloadMeta(){
    var m=mode; fetch("/api/champs?mode="+m).then(function(r){return r.json()}).then(function(l){ if(m!==mode)return; if(Array.isArray(l)&&l.length){ champMetaList=l; renderMyChamps(); } }).catch(function(){}); // 2026-07-09 모드캡처(모드혼입 방지)+배열가드
  }

  /* ── op.gg식 전체너비 챔피언 빌드 페이지 ── */
  function cpLoading(){return '<div class="cp-wrap"><div class="cp-loading"><span class="spin"></span>빌드 불러오는 중…</div></div>';}
  /* ★2026-09-12 【통계를 못 받으면 조용히 닫지 말고 말한다】
     종전엔 fetch 가 실패하거나 서버가 {error} 를 주면 그냥 closeChamp() 였다. 쓰는 사람 눈에는
     "챔피언을 눌렀는데 아무 일도 안 일어난다" 로 보인다 — 실제로 다른 PC 에서 그 신고가 왔다.
     통계는 aram-mayhem.com 에서 받아오는데(그 PC엔 로컬 사본이 없다) 한 번 삐끗하면 통째로 빈다.
     닫지 말고 이유를 보여주고 다시 시도할 수 있게 둔다. 깨진 상세(승률 undefined판)를 막으려던
     2026-07-09 의 의도는 그대로다 — 깨진 화면 대신 '왜 없는지' 를 보여주는 것으로 바꿨을 뿐이다. */
  function cpError(name,why,autoSec){ // autoSec = 인게임 상세가 스스로 다시 받기까지 남은 초(있으면 안내 한 줄)
    return '<div class="cp-wrap"><button class="cp-back" id="cpbackerr" type="button">← 챔피언 목록</button>'
      +'<div class="cp-loading" style="flex-direction:column;align-items:center;gap:10px;text-align:center;line-height:1.7">'
      +'<div style="font-size:17px;font-weight:800;color:var(--tx)">통계를 못 받았어요</div>'
      +'<div style="color:var(--mut);font-size:15px">'+esc(name||"이 챔피언")+' 통계를 받아오지 못했습니다.<br>'+(autoSec?(autoSec+'초 뒤 자동으로 다시 받아요.'):'인터넷 연결을 확인하고 다시 시도해 주세요.')+'</div>'
      +(why?'<div style="color:var(--mut);font-size:12px;opacity:.7">'+esc(why)+'</div>':'')
      +'<button class="btn" id="cpretry" type="button" style="margin-top:6px;width:auto;padding:9px 22px">다시 시도</button>'
      +'</div></div>';
  }
  function showChampError(name,why){
    $("#champpage").innerHTML=cpError(name,why);
    document.body.classList.add("cp");
    var b=$("#cpbackerr"); if(b)b.onclick=function(){navBack();};
    var r=$("#cpretry"); if(r)r.onclick=function(){openChamp(name,true);};
  }
  function openChamp(name,replace){
    // 2026-07-09 닫기 무한루프 수정: replace=true면(내 챔피언 0판 폴백처럼 이미 상세 안에서 호출) 새 history 엔트리를
    //   쌓지 말고 현재 엔트리를 champ로 교체. 안 그러면 닫기(back)→mychamp 엔트리 복원→async fetch→0판→openChamp→navPush가
    //   매번 반복돼 상세가 영영 안 닫혔다(사용자 신고: 내 챔피언 통계 상세→닫기 안 됨, 이상한 챔피언통계에 무한히 갇힘).
    if(replace&&!_navRestoring){try{history.replaceState({nav:{t:"champ",name:name},m:mode,e:_navEpoch,d:navDepth()},"");}catch(_){}} /* 자리만 바꾸는 것이라 깊이는 유지 */
    else navPush({t:"champ",name:name});
    var _tk=++_navSeq;
    lastChampName=name;
    $("#champpage").innerHTML=cpLoading();
    document.body.classList.add("cp");
    /* ★2026-09-12 한 번은 다시 받아본다 — 다른 PC 는 통계를 전부 원격에서 받아오므로 한 번의 실패가 곧 빈 화면이다.
       그래도 안 되면 닫지 말고 이유를 보여준다(cpError). 종전엔 조용히 closeChamp() 라 "눌러도 아무 일이 없다" 로 보였다. */
    var _url="/api/champ?mode="+mode+"&name="+encodeURIComponent(name)+"&range="+encodeURIComponent(activeTableRange);
    var _ask=function(){return fetch(_url,{cache:"no-store"}).then(function(r){
      // 서버가 이유를 실어 보낸다(어느 파일을 왜 못 받았나) — 상태 번호만 띄우면 다음 신고에서도 원인을 모른다(2026-09-25)
      if(!r.ok)return r.json().catch(function(){return null;}).then(function(j){ throw new Error((j&&j.error)?String(j.error):("서버 응답 "+r.status)); });
      return r.json();
    });};
    _ask().catch(function(e){ return new Promise(function(ok){setTimeout(ok,700);}).then(_ask); })
      .then(function(d){
        if(_tk!==_navSeq)return;
        if(!d||d.error)showChampError(name,d&&d.error?String(d.error).slice(0,120):"");
        else renderChamp(d);
      })
      .catch(function(e){ if(_tk===_navSeq)showChampError(name,String(e&&e.message||e).slice(0,120)); });
  }
  function closeChamp(){if(!_navRestoring&&document.body.classList.contains("cp")){++_navEpoch;try{history.replaceState({nav:null,m:mode,e:_navEpoch,d:0},"");}catch(_){}} /* d:0 — 이 엔트리는 더 이상 상세가 아니므로 깊이도 0 으로(navToList 가 이 지점을 목록으로 본다) */ /* out-of-band 닫기(모드토글·설정·검색·에러)로 오버레이를 닫을 때 현재 히스토리 엔트리를 base(null)로 교체 → stale 상세 엔트리 제거. 없으면 상세분석 열었다 out-of-band로 닫은 뒤 매치 열고 닫기(history.back) 시 그 stale 상세분석으로 잘못 복귀(사용자 신고 버그). 정상 닫기(navBack=history.back)는 이 함수를 안 거침. */ ++_navSeq;document.body.classList.remove("cp");$("#champpage").innerHTML="";}
  var PORO_READER_ICON="/poro_cutout.png"; // ★2026-07-22: 687KB base64 리터럴을 서버 라우트로 교체. 그 한 줄이 인라인 <script> 의 65.9% 였고 매 실행 파서를 막았다.
  function modeLabel(){return mode==="augment"?"증강 칼바람":"일반 칼바람";}
  var anonMode=false; try{anonMode=localStorage.getItem('am_anon')==='on';}catch(e){} // 익명 모드(공유용) — ON이면 내 닉/태그를 익명#--로, 사주풀이도 익명님
  function dispWho(){return anonMode?'익명':((lastMe&&lastMe.who)?lastMe.who:'사용자');}
  function dispTag(){return anonMode?'--':((lastMe&&lastMe.whoTag)?lastMe.whoTag:'');}
  function updateAnonBtn(){var b=$("#anonbtn");if(b){b.classList.toggle('on',anonMode);b.setAttribute('aria-pressed',anonMode?'true':'false');}}
  function readerName(){if(anonMode)return '익명';var n=lastMe&&lastMe.who?String(lastMe.who).trim():"";return n&&n!=="-"&&n!=="?"&&n!=="??"?n:"사용자";}
  /* ── 익명 모드 이름 덮기 ─────────────────────────────────────────────────────
     토글을 켜면 전적 개요(10인)의 소환사 칸을 **그 줄이 실제로 쓴 챔피언 이름**으로 덮는다.
     내 줄도 예외 없이 똑같이 챔피언 이름으로 뜬다(나만 '익명'으로 남기지 않는다).
     ⚠️ 표시만 덮는 것 — 원본 닉네임은 서버 응답에만 남고 화면·호버·공유 캡처 어디에도 안 나간다. */
  function anonAlias(r){ return (r&&r.champName)?String(r.champName):''; }
  function parseKdaText(s){var m=String(s||"").match(/([\d.]+)\s*\/\s*([\d.]+)\s*\/\s*([\d.]+)/);return {k:m?+m[1]:0,d:m?+m[2]:0,a:m?+m[3]:0};}
  function weightedAvg(list,key){var s=0,w=0;(list||[]).forEach(function(c){var g=+c.games||0,v=+c[key]||0;if(g&&v){s+=v*g;w+=g;}});return w?Math.round(s/w):0;}
  function pickReliabilityTarget(total){total=+total||0;if(total>=120)return 14;if(total>=80)return 12;if(total>=50)return 8;if(total>=25)return 6;if(total>=10)return 4;return 2;}
  function pickBaseRate(list,fallback){var s=0,w=0;(list||[]).forEach(function(x){var g=+x.games||0,wr=+x.winRate;if(g&&isFinite(wr)){s+=wr*g;w+=g;}});return w?s/w:(fallback==null?50:fallback);}
  function reliablePickScore(x,total,high,baseRate){var g=+((x&&x.games)||0),wr=+((x&&x.winRate)!=null?x.winRate:baseRate);if(!g||!isFinite(wr))return high?-Infinity:Infinity;var target=pickReliabilityTarget(total),p=Math.max(0,Math.min(1,wr/100)),z=1.64,den=1+(z*z)/g,center=p+(z*z)/(2*g),margin=z*Math.sqrt((p*(1-p)+(z*z)/(4*g))/g),lower=((center-margin)/den)*100,upper=((center+margin)/den)*100,vol=Math.min(g,100)*0.035+Math.min(1,g/Math.max(1,target))*1.2;return high?lower+vol+wr*0.01:upper-vol+wr*0.01;}
  function topBy(list,key,minGames,high,total,baseRate){
    var arr=(list||[]).filter(function(c){return (+c.games||0)>=minGames && (+c[key]||0)>0;});
    arr.sort(function(a,b){
      if(key==="winRate"){var av=reliablePickScore(a,total,high,baseRate),bv=reliablePickScore(b,total,high,baseRate);return high?(bv-av)||((+b.winRate||0)-(+a.winRate||0))||((+b.games||0)-(+a.games||0)):(av-bv)||((+a.winRate||0)-(+b.winRate||0))||((+b.games||0)-(+a.games||0));}
      var av=+a[key]||0,bv=+b[key]||0;return high?(bv-av)||((+b.games||0)-(+a.games||0)):(av-bv)||((+b.games||0)-(+a.games||0));
    });
    return arr[0]||null;
  }
  /* ── 사주풀이 풀이로직 핵심(H 설계 = agent_team/ai_lab/fortune/reference_impl.mjs 회귀오라클, 동일입력→동일출력) ──
     ⓐ 소표본 극단승률 교정: EB 2단계 수축 + Wilson 하한/상한 + 최소표본 게이트. 칼바람 KDA 미사용. */
  function ebShrink(wins,games,priorMean,K){var g=Number(games)||0,w=Number(wins)||0;return (w+K*priorMean)/(g+K);}
  function correctedWinRate(pickWins,pickGames,playerWins,playerGames,opts){opts=opts||{};var KPlayer=opts.KPlayer==null?20:opts.KPlayer,KPick=opts.KPick==null?12:opts.KPick;var playerBase=ebShrink(playerWins,playerGames,0.5,KPlayer);return ebShrink(pickWins,pickGames,playerBase,KPick);}
  function wilsonInterval(wins,games,z){z=z==null?1.64:z;var n=Number(games)||0;if(n===0)return {lower:0,upper:1,p:0.5,width:1};var p=(Number(wins)||0)/n,den=1+(z*z)/n,center=p+(z*z)/(2*n),margin=z*Math.sqrt((p*(1-p)+(z*z)/(4*n))/n),lower=(center-margin)/den,upper=(center+margin)/den;return {lower:lower,upper:upper,p:p,width:upper-lower};}
  // 최소표본 게이트 — 챔프/증강은 항목별 표본이 작다(아이템처럼 한 판에 여러 번·반복 안 됨). 과거 5~8은 아이템 기준이라 챔프/증강 칼럼을 통째로 비웠음. Wilson 하한/상한 랭킹이 이미 소표본을 자동 후순위로 누르므로 게이트는 1~2판 노이즈 차단용으로 충분 → 낮춤.
  function minSampleGate(total){total=Number(total)||0;if(total>=150)return 4;if(total>=50)return 3;return 2;}
  function pickBestWorst(list,playerWins,playerTotal,opts){
    opts=opts||{};var gate=minSampleGate(playerTotal);
    var cand=(list||[]).filter(function(x){return (Number(x.games)||0)>=gate && (x.winRate!=null||(x.wins!=null&&x.games));});
    function enrich(x){
      var games=Number(x.games)||0,wins=x.wins!=null?Number(x.wins):Math.round((Number(x.winRate)||0)/100*games),w=wilsonInterval(wins,games),adj=correctedWinRate(wins,games,playerWins,playerTotal,opts);
      return {name:x.name,id:x.id!=null?x.id:null,icon:x.icon||"",games:games,wins:wins,
        rawWinRate:x.winRate!=null?Math.round(x.winRate):Math.round(wins/games*100),
        adjWinRate:Math.round(adj*100),wilsonLow:Math.round(w.lower*100),wilsonHigh:Math.round(w.upper*100),
        confident:w.width<=0.45&&games>=gate+1};
    }
    if(cand.length<1)return {best:null,worst:null,gate:gate,reason:"표본 부족"};
    var rows=cand.map(enrich);
    var _base=ebShrink(playerWins,playerTotal,0.5,(opts.KPlayer==null?20:opts.KPlayer))*100,_K=10,_fw=function(g){return g/(g+_K);}; // rankPicks와 동일: 빈도 가중 편차(자주+평균대비 좋은 픽 우선)
    var _bs=function(x){return (x.adjWinRate-_base)*_fw(x.games);},_ws=function(x){return (_base-x.adjWinRate)*_fw(x.games);};
    var best=rows.slice().sort(function(a,b){return (_bs(b)-_bs(a))||(b.adjWinRate-a.adjWinRate)||(b.games-a.games);})[0];
    var worst=rows.slice().sort(function(a,b){return (_ws(b)-_ws(a))||(a.adjWinRate-b.adjWinRate)||(b.games-a.games);})[0];
    return {best:best,worst:worst,gate:gate,reason:null};
  }
  // 표시용 별칭: .winRate를 '보정 승률'로(헤드라인=보정, 원시는 .rawWinRate로 괄호 처리). 기존 소비자(a.best.winRate 등) 호환.
  function withAdjWr(o){if(!o)return null;o.winRate=o.adjWinRate;return o;}
  /* ── ⓑ 획일화 탈피: 코호트 평균 대비 "그 사람만의" 특징(z-score)로 개인 구분(reference_impl.mjs 오라클 동일) ──
     칼바람 KDA 의미 사용 금지 → 풍부한 지표(피해/버팀/성장/픽형태)로. support/crowd는 데이터 있을 때만(없으면 null→스킵). */
  /* ⇒FORTUNE-CORE-BEGIN (generated from agent_team/ai_lab/fortune/content_bank.mjs — 직접 수정 금지, _transplant.mjs 로 재생성) */
  // ── 축 메타(라벨은 명사 2~3자, tip은 한 줄) ─────────────────────────────
  var FORTUNE_AXIS_META={
    firepower:{label:"딜 화력",tip:"한 판에서 얼마나 많은 피해를 꽂는가",radar:true,radarLabel:"딜 화력"},
    durability:{label:"몸빵",tip:"앞에서 얼마나 맞아주고 버티는가",radar:true,radarLabel:"몸빵"},
    economy:{label:"성장 속도",tip:"장비를 얼마나 빨리 갖춰 후반에 강해지는가",radar:true,radarLabel:"성장 속도"},
    aggression:{label:"선공 기질",tip:"교전 한가운데에 얼마나 깊게 들어가 있는가",radar:true,radarLabel:"선공 기질"},
    momentum:{label:"최근 기세",tip:"요즘 흐름이 평소보다 올라 있는가, 식어 있는가",radar:true,radarLabel:"최근 기세"},
    loyalty:{label:"챔프 폭",tip:"한 챔프만 파는가, 여러 챔프를 두루 쓰는가",radar:false,radarLabel:"챔프 폭"},
    breadth:{label:"챔프 폭",tip:"아무 15판을 뽑았을 때 서로 다른 챔프가 몇 종 나오는가",radar:false,radarLabel:"챔프 폭"},
    // ⚠️ 라벨은 실제 재는 값과 일치해야 한다: heal=totalHeal(분당 회복량, 자힐 포함) · cc=timeCCingOthers(분당 CC 초).
    //    옛 라벨 "팀 챙김/한타 장악"은 재지 않는 것(아군 실드·한타 기여)을 말해 지어낸 의미였다 → 실측 그대로로 교정.
    support:{label:"회복",tip:"한 판에서 체력을 얼마나 되살리는가(분당 회복량)",radar:true,radarLabel:"회복"},
    crowd:{label:"군중 제어",tip:"적을 얼마나 오래 묶어 두는가(분당 CC 초)",radar:true,radarLabel:"군중 제어"}
  };
  var FORTUNE_AXES=[
    {key:"firepower",label:"화력",kind:"metric",get:function(a){return a.avgDpm;},hi:"원거리에서 피해를 많이 누적",lo:"딜보다 다른 역할에 무게"},
    {key:"durability",label:"버팀",kind:"metric",get:function(a){return a.avgTaken;},hi:"앞에서 몸으로 받아냄",lo:"최전선보다 뒤를 선호"},
    {key:"support",label:"팀케어",kind:"metric",get:function(a){return a.avgSupport;},hi:"아군 회복·보호로 판을 이음",lo:"팀 유틸보다 자기 역할 집중"},
    {key:"crowd",label:"군중제어",kind:"metric",get:function(a){return a.avgCc;},hi:"상대를 묶어 한타를 연다",lo:"묶기보다 다른 방식"},
    {key:"economy",label:"성장",kind:"metric",get:function(a){return a.avgGpm;},hi:"꾸준히 성장해 후반에 강함",lo:"성장 곡선보다 초반 관여"},
    {key:"breadth",label:"픽 폭",kind:"behavior",get:function(a){return a.breadthScore;},hi:"판마다 다른 얼굴",lo:"좁고 일관된 챔프 폭"},
    {key:"aggression",label:"선공",kind:"behavior",get:function(a){return a.aggression;},hi:"각이 보이면 먼저 들어감",lo:"먼저 열기보다 받아치는 쪽"},
    {key:"momentum",label:"최근 흐름",kind:"behavior",get:function(a){return (a.recentRate!=null&&a.winRate!=null?a.recentRate-a.winRate:null);},hi:"요즘 감각이 누적보다 좋음",lo:"누적보다 최근이 식음"}
  ];
  // ★챔프 폭(2026-08-29 교체) — 희박화: 내 판 중 아무 15판을 뽑으면 서로 다른 챔프가 몇 종 나오나.
  //   옛 산식 effChamps/√판수 는 판수가 많을수록 구조적으로 깎였다(실측 중앙값 15~30판 3.42 → 800판+ 1.60).
  //   그래서 889판을 다양하게 한 사람이 하위 22%, 96판 사람이 상위 91% 로 뒤집혔다(사용자 신고 → 원인 확정).
  //   희박화는 판수와 무관(구간별 중앙값 13.28~13.44) → 같은 자로 재는 공정한 비교가 된다. 기준선 배치와 같은 식·같은 m.
  // 판수 가중 평균(반올림 없음) — 회복은 정수지만 CC 는 분당 1~3초라 반올림하면 변별이 통째로 사라진다.
  function fortuneWeightedAvgF(list,key){
    var rows=Array.isArray(list)?list:[],s=0,w=0;
    for(var i=0;i<rows.length;i++){var g=+(rows[i]&&rows[i].games)||0,v=+(rows[i]&&rows[i][key]);
      if(g>0&&isFinite(v)&&v>0){s+=v*g;w+=g;}}
    return w?(s/w):null; // 한 판도 값이 없으면 null(0으로 채우면 '기록 없음'이 '최하위'로 둔갑한다)
  }
  var FORTUNE_BREADTH_M=15;
  function fortuneBreadthScore(champs){
    var rows=Array.isArray(champs)?champs:[],total=0,i;
    for(i=0;i<rows.length;i++)total+=(+(rows[i]&&rows[i].games)||0);
    if(!(total>=FORTUNE_BREADTH_M))return null; // 15판 미만은 잴 수 없다(지어내지 않는다)
    var s=0;
    for(i=0;i<rows.length;i++){
      var n=+(rows[i]&&rows[i].games)||0; if(n<=0)continue;
      var p=1;
      for(var k=0;k<FORTUNE_BREADTH_M;k++){var num=total-n-k; if(num<=0){p=0;break;} p*=num/(total-k);}
      s+=1-p;
    }
    return s;
  }
  // 레이더 6축 = 두 모드 모두 **실측 분위표가 있는** 축만(가짜 값으로 모양을 채우지 않는다).
  //   챔프 폭·최근 기세는 증강 모드에 모집단 분포가 없어(기여 데이터가 익명이라 사람 단위 집계 불가) 레이더에서 빼고,
  //   칩·12장에서 사실(수치)로 다룬다.
  var FORTUNE_RADAR_AXES=["firepower","aggression","economy","durability","support","crowd"].map(function(k){return {key:k,label:FORTUNE_AXIS_META[k].radarLabel,tip:FORTUNE_AXIS_META[k].tip};});

  // ── 백분위 엔진: 분위표(q[p1..p99]) 실측 보간. q 없으면 정규근사 폴백(% 표시는 measured=false로 차단). ──
  function fortunePercentile(v,cs){
    if(v==null||!cs)return null;
    var q=cs.q;
    if(q&&q.length===99){
      if(v<=q[0])return 1;
      if(v>=q[98])return 99;
      var lo=0,hi=98;
      while(lo+1<hi){var m=(lo+hi)>>1;if(q[m]<=v)lo=m;else hi=m;}
      var span=q[hi]-q[lo],frac=span>0?(v-q[lo])/span:0;
      return Math.max(1,Math.min(99,Math.round((lo+1)+frac*(hi-lo))));
    }
    if(!(cs.std>0))return null;
    var z=(v-cs.mean)/cs.std;
    return Math.max(1,Math.min(99,Math.round(100/(1+Math.exp(-1.702*z)))));
  }
  function fortuneAxisMeasured(cs){return !!(cs&&cs.q&&cs.q.length===99);}
  function fortuneZScores(a,cohortStats){
    var out=[];
    for(var i=0;i<FORTUNE_AXES.length;i++){
      var ax=FORTUNE_AXES[i],v=ax.get(a),cs=cohortStats&&cohortStats[ax.key];
      if(v==null||!cs||!(cs.std>0))continue;
      var pct=fortunePercentile(v,cs);
      if(pct==null)continue;
      out.push({key:ax.key,label:ax.label,kind:ax.kind,value:v,z:(v-cs.mean)/cs.std,pct:pct,measured:fortuneAxisMeasured(cs),median:(cs.q&&cs.q.length===99)?cs.q[49]:cs.mean,axis:ax});
    }
    return out;
  }
  // 판정 컷(모드 분포 성질별): players=사람 분포(그대로), games=판 분포(플레이어 '평균'은 판 분포보다 중앙에
  //   촘촘히 몰리므로 같은 컷이면 전원 균형형이 된다 — 컷만 낮춰 사람 기준과 비슷한 빈도로 특징을 잡는다.
  //   ⚠️ 화면의 % 숫자는 어느 쪽이든 그대로 실측값 — 컷은 '두드러짐 판정' 편집 기준일 뿐 수치를 바꾸지 않는다).
  function fortuneCuts(basis){
    return basis==="games"?{hi:65,lean:58,strong:88,clear:78,chapter:62}:{hi:78,lean:65,strong:93,clear:85,chapter:70};
  }
  function fortuneStrengthOf(pct,cuts){return (pct>=cuts.strong||pct<=(100-cuts.strong))?"강":(pct>=cuts.clear||pct<=(100-cuts.clear))?"뚜렷":"약간";}
  // 두드러진 축 = 백분위 컷 밖(기본 players 78/22 · games 65/35). 균형이면 lean 컷의 결만.
  function fortuneDistinctiveAxes(a,cohortStats,opts){
    opts=opts||{};
    var cuts=fortuneCuts(cohortStats&&cohortStats.__meta&&cohortStats.__meta.basis);
    var K=opts.K==null?3:opts.K,hiCut=opts.hiCut==null?cuts.hi:opts.hiCut,leanCut=opts.leanCut==null?cuts.lean:opts.leanCut;
    var all=fortuneZScores(a,cohortStats);
    var zs=all.filter(function(x){return x.pct>=hiCut||x.pct<=(100-hiCut);});
    zs.sort(function(x,y){return Math.abs(y.pct-50)-Math.abs(x.pct-50);});
    var top=zs.slice(0,K).map(function(x){return {key:x.key,label:x.label,kind:x.kind,value:x.value,z:x.z,pct:x.pct,measured:x.measured,median:x.median,axis:x.axis,dir:x.pct>=50?"hi":"lo",phrase:x.pct>=50?x.axis.hi:x.axis.lo,strength:fortuneStrengthOf(x.pct,cuts)};});
    var balanced=top.length===0;
    var lean=null;
    if(balanced&&all.length){
      var m=null;
      for(var i2=0;i2<all.length;i2++){var x2=all[i2];if(!m||Math.abs(x2.pct-50)>Math.abs(m.pct-50))m=x2;}
      if(m&&(m.pct>=leanCut||m.pct<=(100-leanCut)))lean={key:m.key,dir:m.pct>=50?"hi":"lo",z:m.z,pct:m.pct,measured:m.measured};
    }
    return {axes:top,balanced:balanced,lean:lean};
  }
  function fortuneFingerprint(distinct){if(distinct.balanced)return "balanced";return distinct.axes.map(function(x){return x.key+(x.dir==="hi"?"+":"-");}).join("|");}

  // ── 표시 포맷터(일반어만) ────────────────────────────────────────────
  function fortuneComma(n){return String(Math.round(+n||0)).replace(/\B(?=(\d{3})+(?!\d))/g,",");}
  function fortuneRankText(x){
    if(!x||!x.measured||x.pct==null)return "";
    return x.pct>=50?("상위 "+Math.max(1,100-x.pct)+"%"):("하위 "+Math.max(1,x.pct)+"%");
  }
  // 축별 값 라벨(+주격조사)·값 문자열. breadth는 추상값이라 수치 대신 백분위·서술만 쓴다.
  var FORTUNE_VALUE_LABEL={
    firepower:{label:"분당 피해",josa:"가"},
    durability:{label:"분당 받는 피해",josa:"가"},
    economy:{label:"분당 골드",josa:"가"},
    aggression:{label:"교전 지분",josa:"이"},
    support:{label:"분당 회복량",josa:"이"},
    crowd:{label:"분당 CC 시간",josa:"이"}
  };
  function fortuneValText(key,v){
    if(key==="aggression")return (Math.round((+v||0)*10)/10)+"%";
    if(key==="momentum"){var n=Math.round(+v||0);return (n>=0?"+":"")+n+"%p";}
    if(key==="crowd")return (Math.round((+v||0)*10)/10)+"초";
    if(key==="breadth")return (Math.round((+v||0)*10)/10)+"종";
    if(key==="firepower"||key==="durability"||key==="economy"||key==="support")return fortuneComma(v);
    return null;
  }
  // 비교 기준 명사(모드 안 섞기: 문구만 다름). basis="players"=실제 플레이어 분포, "games"=실제 판 분포.
  function fortuneBasisNoun(a){
    var b=a&&a.fortuneBasis&&a.fortuneBasis.basis;
    return b==="games"?"같은 모드 판에서는":"같은 모드 플레이어들은";
  }

  // ── 헤드라인(별명 대체 — 사람이 쓰는 말, 1축 1방향) ─────────────────────
  var FORTUNE_HEADLINE={
    firepower:{hi:"딜은 확실하게 넣는 편",lo:"딜보다 다른 일을 많이 하는 편"},
    durability:{hi:"맨 앞에서 몸으로 받는 편",lo:"안 맞는 자리를 잘 찾는 편"},
    economy:{hi:"차곡차곡 커져서 후반을 보는 편",lo:"초반부터 빠르게 붙는 편"},
    aggression:{hi:"싸움 한복판에 있는 편",lo:"한 발 물러서서 받아치는 편"},
    momentum:{hi:"요즘 유독 손이 잘 맞는 흐름",lo:"요즘은 잠깐 숨 고르는 흐름"},
    breadth:{hi:"이 챔프 저 챔프 다 쥐는 편",lo:"한 챔프를 깊게 파는 편"},
    support:{hi:"체력을 많이 되살리는 편",lo:"회복보다 다른 일로 버티는 편"},
    crowd:{hi:"적을 오래 묶어 두는 편",lo:"묶기보다 다른 방식으로 푸는 편"},
    balanced:"어느 한쪽에 크게 치우치지 않는 편"
  };
  var FORTUNE_HEADLINE_LEAN={
    firepower:{hi:"고른 편인데 딜 쪽으로 살짝 기운 편",lo:"고른 편인데 딜 욕심은 적은 편"},
    durability:{hi:"고른 편인데 조금 더 단단한 쪽",lo:"고른 편인데 조금 더 날렵한 쪽"},
    economy:{hi:"고른 편인데 후반 쪽으로 살짝 기운 편",lo:"고른 편인데 초반에 살짝 더 강한 편"},
    aggression:{hi:"고른 편인데 먼저 나서는 쪽",lo:"고른 편인데 받아치는 쪽"},
    momentum:{hi:"고른 편인데 요즘 손이 좋은 쪽",lo:"고른 편인데 요즘은 쉬어 가는 쪽"},
    breadth:{hi:"고른 편인데 픽 폭이 넓은 쪽",lo:"고른 편인데 한 우물 쪽"},
    support:{hi:"고른 편인데 회복이 조금 더 많은 쪽",lo:"고른 편인데 회복은 적은 쪽"},
    crowd:{hi:"고른 편인데 묶는 시간이 조금 긴 쪽",lo:"고른 편인데 묶기는 적은 쪽"}
  };
  function fortunePersonaNickname(distinct){
    if(distinct.balanced||!distinct.axes.length){
      var lean=distinct.lean;
      if(lean&&FORTUNE_HEADLINE_LEAN[lean.key]&&FORTUNE_HEADLINE_LEAN[lean.key][lean.dir])return FORTUNE_HEADLINE_LEAN[lean.key][lean.dir];
      return FORTUNE_HEADLINE.balanced;
    }
    var a1=distinct.axes[0];
    return (FORTUNE_HEADLINE[a1.key]||{})[a1.dir]||FORTUNE_HEADLINE.balanced;
  }

  // ── 한 줄 요약 = 사람 비교 증거 문장("보통은 ~인데, 당신은 ~ — 상위 N%") ──
  function fortuneOneLinerAxis(x,a){
    var vl=FORTUNE_VALUE_LABEL[x.key],rank=fortuneRankText(x);
    if(x.key==="breadth"){
      var bv=fortuneValText("breadth",x.value);
      if(x.measured&&rank)return "아무 15판을 뽑아도 평균 "+bv+"이 나옵니다 — 챔프 폭 "+rank+"입니다.";
      return "아무 15판을 뽑으면 평균 "+bv+"이 나옵니다.";
    }
    if(x.key==="momentum"){
      var mv=fortuneValText("momentum",x.value);
      if(x.dir==="hi")return "최근 10판 승률이 평소보다 "+mv+" 높습니다"+(rank?(" — 상승 흐름 "+rank+"입니다."):".");
      return "최근 10판 승률이 평소보다 "+mv.replace("-","")+" 낮습니다 — 기량이 아니라 잠깐의 흐름입니다.";
    }
    if(vl&&x.measured&&rank){
      return fortuneBasisNoun(a)+" "+vl.label+vl.josa+" 보통 "+fortuneValText(x.key,x.median)+" 선인데, 당신은 "+fortuneValText(x.key,x.value)+" — "+rank+"입니다.";
    }
    if(vl)return "당신의 "+vl.label+"는 "+fortuneValText(x.key,x.value)+"입니다 — "+(x.dir==="hi"?"높은 쪽":"낮은 쪽")+"에 서 있습니다.";
    return "";
  }
  function fortuneOneLiner(distinct,a){
    a=a||{};
    if(distinct.balanced||!distinct.axes.length){
      var lean=distinct.lean;
      if(lean&&FORTUNE_HEADLINE_LEAN[lean.key]&&FORTUNE_HEADLINE_LEAN[lean.key][lean.dir]){
        return "어느 축도 크게 튀지 않습니다. 그나마 "+FORTUNE_AXIS_META[lean.key].label+" 쪽으로 살짝 기울어 있는 정도입니다.";
      }
      return "어느 축도 크게 튀지 않습니다 — 판이 필요로 하는 자리를 그때그때 채우는 쪽입니다.";
    }
    var head=fortuneOneLinerAxis(distinct.axes[0],a);
    var a2=distinct.axes[1];
    if(a2){
      var chip2=fortuneAxisChipRanked(a2);
      if(chip2)head+=" "+chip2+"도 눈에 띕니다.";
    }
    return head;
  }

  // ── 태그 칩: 실측 축만 %(상위/하위), prior 축은 방향만. breadth 하위=한우물로 양성 표기. ──
  function fortuneAxisChip(axisKey,dir){
    var m=FORTUNE_AXIS_META[axisKey];
    if(axisKey==="loyalty")return dir==="hi"?"한우물 장인":"다재다능";
    if(axisKey==="breadth")return dir==="hi"?"다재다능":"한우물 장인";
    return m.label+" "+(dir==="hi"?"高":"낮음");
  }
  function fortuneAxisChipRanked(x){
    if(!x)return "";
    if(x.measured&&x.pct!=null){
      var t=fortuneRankText(x);
      return FORTUNE_AXIS_META[x.key].label+" "+t;
    }
    return fortuneAxisChip(x.key,x.dir);
  }

  // ── 12장: (장×축×방향) 템플릿 함수. ctx로 실측 수치를 문장에 직접 넣는다. ──
  // ctx={v,pct,median,measured,dir,strength,adv,rank,val,mval,basisNoun}
  //   adv: 강=확실히 / 뚜렷=제법 / 약간=조금. rank: "상위 8%"(실측만). val/mval: 내 값/중앙값 문자열(없는 축은 null).
  var FORTUNE_CHAPTER_AXIS_MAP={
    "전투 본능":["firepower","durability","aggression"],
    "손해를 본 뒤의 버릇":["momentum","aggression"],
    "싸움이 열리기 전":["aggression","crowd"],
    "들어갈 때와 빠질 때":["durability","aggression"],
    "아군과 맞물리는 방식":["support","crowd"],
    "상대가 불편해지는 자리":["firepower","crowd","durability"],
    "잘 풀리는 날의 얼굴":["firepower","economy","support"],
    "안 풀리는 날의 새는 곳":["aggression","momentum"],
    "픽을 고르는 손":["breadth"],
    "장비와 선택을 타는 방식":["economy","firepower"],
    "최근 흐름":["momentum"],
    "포로의 결론":["breadth","firepower","durability"]
  };
  function fortuneChapterLead(chapterTitle,allZ){
    var keys=FORTUNE_CHAPTER_AXIS_MAP[chapterTitle]||[],lead=null;
    for(var i=0;i<allZ.length;i++){var z=allZ[i];if(keys.indexOf(z.key)>=0){if(!lead||Math.abs(z.pct-50)>Math.abs(lead.pct-50))lead=z;}}
    return lead;
  }
  // 증거 꼬리표: 실측이면 " (…— 상위 8%)"류 짧은 근거. 없으면 빈 문자열.
  function fortuneEv(ctx){
    if(!ctx.measured||!ctx.rank)return "";
    if(ctx.val&&ctx.mval)return " 보통 "+ctx.mval+" 선인데 당신은 "+ctx.val+", "+ctx.rank+"입니다.";
    return " 폭 기준 "+ctx.rank+"입니다.";
  }
  // ── 12장 프로즈 뱅크 (2026-08-31: v1 문장으로 복원) ─────────────────────────
  //   v2 가 문장을 갈아엎으면서 세 가지를 한꺼번에 망쳤다(사용자 신고 "원래 것들보다 못나네"):
  //     ① 말투를 관상가 → 분석가로 바꿨다("~스타일입니다").
  //     ② 본문 앞머리에 수치·백분위·중앙값을 박았다 = 점집에서 할 소리가 아니고, 읽는 사람이 알 필요도 없다.
  //     ③ 강도 3단계(strong/clear/mild)를 없애 hi/lo 2분기로 축소 → 문장 수가 186 → 62 로 1/3 이 됐다.
  //   그래서 **판정은 v2(실측 백분위), 문장은 v1(관상가 말투·수치 없음)** 으로 되돌린다.
  //   수치는 본문이 아니라 칩(axisLabel)에만 남는다 — 보고 싶은 사람만 보게.
  //   구조: PROSE_BANK[장][축][hi|lo][strong|clear|mild] = {lead, body}. 아래 fortuneChapters 가
  //   ctx.strength(강/뚜렷/약간)를 strong/clear/mild 로 매핑해 고른다.
  var PROSE_BANK = {
    "전투 본능": {
      firepower: {
        hi: {
          strong: { lead: "당신은 대놓고 화력으로 판을 가르는 사람입니다.", body: "싸움이 시작되면 당신의 눈은 가장 굵은 피해를 어디에 꽂을지부터 찾습니다. 한 발이면 충분할 자리에서도 한 발을 더 욕심내고, 그 욕심이 한 판을 통째로 뒤집어 놓곤 합니다. 화력이 곧 당신의 언어이고, 적은 그 언어 앞에서 자주 말을 잃습니다." },
          clear:  { lead: "당신은 피해를 욕심내며 싸움을 끄는 편입니다.", body: "딜이 한 번 들어가기 시작하면 좀처럼 멈출 줄을 모릅니다. 끝을 보려는 그 집요함이 어정쩡하던 교전을 당신 쪽으로 기울게 만듭니다. 적 입장에선 깎이는 체력이 가장 신경 쓰이는 위협일 겁니다." },
          mild:   { lead: "당신에겐 화력으로 풀어가려는 기색이 있습니다.", body: "기본은 차분하지만, 기회가 열리면 한 번 더 욕심내 피해를 누적합니다. 무리하게 끌고 가진 않아도 결정적인 순간엔 손이 먼저 나갑니다. 필요한 만큼 꽂을 줄 아는 감각이 있습니다." },
        },
        lo: {
          strong: { lead: "당신은 직접 딜을 꽂기보다 다른 일로 싸움을 푸는 사람입니다.", body: "큰 피해는 동료에게 맡기고, 당신은 판의 비어 있는 다른 칸을 채웁니다. 시선을 끌고 자리를 잡고 길을 트는 일이 당신 손에서 자연스럽게 돌아갑니다. 화력판에 이름이 안 올라도 당신이 빠지면 싸움의 모양이 무너집니다." },
          clear:  { lead: "당신은 딜 욕심보다 역할 분담을 택하는 편입니다.", body: "혼자 다 해내려 하기보다 제 몫을 정확히 끊어내는 쪽입니다. 큰 한 방 대신 빈틈을 메우는 손길로 팀의 균형을 잡습니다. 그래서 당신의 기여는 화면 숫자보다 판의 흐름에서 더 또렷합니다." },
          mild:   { lead: "당신은 딜에 매달리지 않는 기색이 있습니다.", body: "필요한 만큼만 꽂고 나머지 힘은 다른 일에 나눠 씁니다. 화력에 집착하지 않으니 시야가 넓고 판단이 유연합니다. 욕심을 덜어낸 자리에 안정감이 들어차 있습니다." },
        },
      },
      durability: {
        hi: {
          strong: { lead: "당신은 앞에서 맞아주는 일을 두려워하지 않는 사람입니다.", body: "남들이 망설이는 최전선에 당신은 먼저 몸을 들이밉니다. 당신이 버텨준 그 몇 초 동안 뒤의 딜이 살아나고 팀의 형태가 잡힙니다. 맞는 걸 두려워하지 않는 그 담대함이 곧 팀의 방패입니다." },
          clear:  { lead: "당신은 최전선에서 몸을 거는 편입니다.", body: "위험한 앞자리를 기꺼이 맡아 팀이 설 땅을 만들어 줍니다. 당신이 자리를 잡고 있으면 동료들은 한결 마음 놓고 화력을 쏟습니다. 앞을 책임지는 사람이 있다는 것만으로 싸움의 무게가 달라집니다." },
          mild:   { lead: "당신에겐 앞을 받아주려는 기색이 있습니다.", body: "평소엔 무리하지 않지만, 필요한 순간엔 한 발 앞에 서 줍니다. 팀이 흔들릴 때 그 한 발이 형태를 다시 잡아 줍니다. 책임질 자리를 외면하지 않는 사람입니다." },
        },
        lo: {
          strong: { lead: "당신은 몸을 던지기보다 살아남아 일하는 사람입니다.", body: "맞을 자리를 미리 읽고 피하는 감각이 당신에겐 곧 생존입니다. 무너지지 않고 끝까지 남아 있는 것 자체가 당신식 기여입니다. 위험을 덜 지는 대신 더 오래, 더 길게 판에 영향을 남깁니다." },
          clear:  { lead: "당신은 최전선보다 한 발 뒤를 택하는 편입니다.", body: "굳이 위험을 끌어안지 않고 안전한 거리에서 일을 봅니다. 덜 맞는 만큼 더 오래 싸울 수 있고, 그 지속이 후반에 차이를 만듭니다. 영리하게 살아남는 것도 분명한 강점입니다." },
          mild:   { lead: "당신은 무리해서 앞서지 않는 기색이 있습니다.", body: "들이밀기보다 자리를 골라 안전하게 풀어가는 편입니다. 한 발 물러선 위치에서 판 전체를 보며 움직입니다. 무모함이 없는 만큼 손해도 적습니다." },
        },
      },
      aggression: {
        hi: {
          strong: { lead: "당신은 각이 보이면 먼저 들어가는 선공형입니다.", body: "남이 망설이는 순간에 당신은 이미 첫 발을 뗍니다. 당신이 여는 그 한 수로 싸움의 방향이 통째로 정해지곤 합니다. 먼저 칼을 빼는 용기가 판을 당신의 박자로 끌어옵니다." },
          clear:  { lead: "당신은 기회가 오면 먼저 치고 들어가는 편입니다.", body: "각이 보이면 주저 없이 시동을 걸어 싸움을 엽니다. 그 과감함이 망설이던 팀을 함께 움직이게 만듭니다. 먼저 움직이는 사람이 흐름의 주인이 됩니다." },
          mild:   { lead: "당신에겐 먼저 열어보려는 기색이 있습니다.", body: "기본은 신중하지만 각이 좋으면 한 발 앞서 봅니다. 분위기가 무르익었다 싶으면 슬쩍 시동을 거는 감각이 있습니다. 무모하진 않아도 기회를 그냥 흘려보내진 않습니다." },
        },
        lo: {
          strong: { lead: "당신은 먼저 열기보다 받아쳐서 이기는 사람입니다.", body: "성급히 들어가는 대신 상대가 발을 들이는 순간을 기다립니다. 그 빈틈이 열리면 정확히 되갚아 판을 가져옵니다. 먼저 친 쪽이 아니라 잘 받아친 쪽이 이긴다는 걸 몸으로 압니다." },
          clear:  { lead: "당신은 서두르지 않고 기다리는 편입니다.", body: "조급함 대신 타이밍으로 싸움을 풉니다. 한 박자 늦게 들어가도 그 한 박자가 더 정확합니다. 기다릴 줄 아는 인내가 당신의 무기입니다." },
          mild:   { lead: "당신은 먼저 들어가기보다 살피는 기색이 있습니다.", body: "안전을 한 번 확인하고 움직이는 신중함이 있습니다. 무턱대고 뛰어들지 않으니 헛된 손해가 적습니다. 한 호흡 늦춘 그 침착함이 판을 안정시킵니다." },
        },
      }
    },
    "손해를 본 뒤의 버릇": {
      momentum: {
        hi: {
          strong: { lead: "당신은 흐름이 한 번 타면 끝까지 밀고 가는 사람입니다.", body: "손해를 봐도 당신은 좀처럼 가라앉지 않습니다. 요즘의 감각이 워낙 올라 있어 한 번 삐끗해도 다음 교전에서 금세 만회합니다. 흐름을 읽고 올라타는 그 탄력이 손해를 가볍게 덮어 버립니다." },
          clear:  { lead: "당신은 한 번 풀리면 그 기세를 이어가는 편입니다.", body: "최근의 좋은 감각이 작은 손해쯤은 묻어 버립니다. 분위기가 한 번 오르면 그 기세를 놓치지 않고 끌고 갑니다. 잘 풀릴 때 더 잘 풀리는 사람입니다." },
          mild:   { lead: "당신에겐 분위기를 살려 가는 기색이 있습니다.", body: "좋은 흐름이 오면 그 결을 놓치지 않습니다. 손해를 봐도 크게 흔들리지 않고 다음 기회를 봅니다. 분위기를 읽는 감각이 살아 있습니다." },
        },
        lo: {
          strong: { lead: "당신은 한 번 무너지면 회복에 시간이 필요한 사람입니다.", body: "손해 한 번이 마음에 길게 남는 편입니다. 만회하려 서두를수록 오히려 두 번째 손해가 따라붙곤 합니다. 무너진 직후엔 한 박자 가다듬을 시간을 스스로에게 주면 흐름이 훨씬 부드럽게 돌아옵니다." },
          clear:  { lead: "당신은 손해를 본 직후 다소 흔들리는 편입니다.", body: "한 번 밀리면 잠깐 페이스가 어긋납니다. 다만 한 호흡만 고르면 곧 제자리로 돌아오는 사람입니다. 흔들림을 인정하고 천천히 가는 게 당신에겐 더 빠른 길입니다." },
          mild:   { lead: "당신은 불리해지면 잠시 신중해지는 기색이 있습니다.", body: "손해를 보면 무리한 만회 대신 안전을 먼저 챙깁니다. 욕심을 누르고 한 발 물러서는 그 판단이 더 큰 손해를 막습니다. 신중함이 회복의 발판이 됩니다." },
        },
      },
      aggression: {
        hi: {
          strong: { lead: "당신은 손해를 보면 곧장 되갚으러 가는 사람입니다.", body: "밀린 순간 당신은 물러서는 대신 다시 칼을 빼 듭니다. 곧장 반격을 노리는 그 기질이 한 번의 교전으로 판을 되돌리기도 합니다. 다만 그 불 같은 성미가 가끔은 두 번째 손해를 부르니, 한 박자만 늦추면 더 매서워집니다." },
          clear:  { lead: "당신은 밀리면 만회를 노리고 들어가는 편입니다.", body: "손해 뒤에 가만히 있지 못하고 곧 반격의 각을 잽니다. 그 적극성이 한 번의 반격으로 흐름을 되돌려 놓습니다. 물러서지 않는 근성이 당신의 색입니다." },
          mild:   { lead: "당신에겐 손해 뒤 다시 시도하려는 기색이 있습니다.", body: "밀려도 쉽게 포기하지 않고 다음 각을 봅니다. 무리하진 않아도 기회가 오면 만회를 노립니다. 끈질기게 다시 붙는 그 태도가 판을 끝까지 끌고 갑니다." },
        },
        lo: {
          strong: { lead: "당신은 손해를 보면 무리하지 않고 다시 쌓는 사람입니다.", body: "급한 반격으로 손해를 키우는 대신 안전하게 형태부터 회복합니다. 한 발 물러서서 판을 다시 짜는 그 침착함이 결국 손해를 메웁니다. 서두르지 않는 게 당신식 만회입니다." },
          clear:  { lead: "당신은 밀린 뒤엔 차분히 재정비하는 편입니다.", body: "조급한 한 수를 아끼고 천천히 자리를 다시 잡습니다. 손해를 인정하고 기본부터 다지는 그 태도가 흐름을 안정시킵니다. 무너진 판을 차분히 복구하는 힘이 있습니다." },
          mild:   { lead: "당신은 불리할 때 무리수를 줄이는 기색이 있습니다.", body: "밀리면 욕심을 누르고 다음 기회를 기다립니다. 무리한 한 수로 손해를 키우는 일이 적습니다. 인내가 곧 회복의 길임을 압니다." },
        },
      }
    },
    "싸움이 열리기 전": {
      aggression: {
        hi: {
          strong: { lead: "당신은 싸움의 시작 버튼을 직접 누르는 사람입니다.", body: "교전이 열리기 직전, 다들 눈치를 볼 때 당신이 첫 발을 뗍니다. 당신이 시동을 걸면 팀이 그 신호를 따라 붙어 한 덩어리가 됩니다. 싸움의 첫 박자를 정하는 그 결단력이 곧 당신의 존재 이유입니다." },
          clear:  { lead: "당신은 먼저 시동을 거는 편입니다.", body: "각이 보이면 망설임 없이 먼저 움직여 싸움을 엽니다. 당신의 첫 한 수가 흩어져 있던 팀을 하나로 모읍니다. 시작을 책임지는 사람이 흐름을 쥡니다." },
          mild:   { lead: "당신에겐 먼저 열어보려는 기색이 있습니다.", body: "분위기가 무르익으면 슬그머니 앞장서는 편입니다. 무리해서 열진 않아도 때가 됐다 싶으면 먼저 발을 뗍니다. 그 감각이 팀에 시작의 신호를 줍니다." },
        },
        lo: {
          strong: { lead: "당신은 누가 열어주길 기다렸다가 정확히 올라타는 사람입니다.", body: "당신은 첫 발을 떼는 사람이 아니라, 열린 싸움 위에 가장 매섭게 얹는 사람입니다. 누군가 판을 열면 그 위로 정확히 들어가 마무리를 가져갑니다. 그래서 당신은 첫 발보다 두 번째 발이 더 무섭습니다." },
          clear:  { lead: "당신은 시작보다 합류에 강한 편입니다.", body: "직접 열기보다 열린 싸움에 깔끔하게 얹는 데 능합니다. 타이밍을 읽고 들어가는 그 합류가 교전의 무게를 단번에 키웁니다. 마무리를 책임지는 손길이 있습니다." },
          mild:   { lead: "당신은 먼저 열기보다 지켜보는 기색이 있습니다.", body: "성급히 들어가기보다 안전한 진입 지점을 먼저 고릅니다. 한 박자 지켜보다 들어가니 헛된 손해가 적습니다. 신중하게 합류하는 그 판단이 판을 안정시킵니다." },
        },
      },
      crowd: {
        hi: {
          strong: { lead: "당신은 적을 묶어 싸움의 판을 짜는 사람입니다.", body: "당신의 한 번 묶기가 흩어져 있던 교전을 한 점으로 모읍니다. 발이 묶인 적 위로 팀의 화력이 한꺼번에 쏟아지고, 그 순간 싸움은 이미 당신 손에서 설계된 그림대로 흘러갑니다. 시작을 여는 건 칼이 아니라 당신의 묶기입니다." },
          clear:  { lead: "당신은 적을 붙잡아 길을 여는 편입니다.", body: "결정적 순간에 적을 붙잡아 팀이 들어올 길을 냅니다. 묶인 적 위로 화력이 쏟아질 때 교전의 저울이 단번에 기웁니다. 판을 여는 열쇠를 당신이 쥡니다." },
          mild:   { lead: "당신에겐 적을 끊어주려는 기색이 있습니다.", body: "꼭 필요한 순간 한 명을 묶어 흐름을 만듭니다. 화려하진 않아도 그 한 번의 컨트롤이 큰 차이를 냅니다. 결정적 타이밍을 읽는 눈이 있습니다." },
        },
        lo: {
          strong: { lead: "당신은 묶기보다 정면 화력으로 싸움을 여는 사람입니다.", body: "복잡한 변수를 거는 대신 정직한 힘으로 정면을 뚫습니다. 묶고 흔드는 설계 없이도 당신의 화력 자체가 위협이 됩니다. 단순하지만 그래서 더 막기 어렵습니다." },
          clear:  { lead: "당신은 컨트롤보다 직접 부딪치는 편입니다.", body: "묶고 가두는 설계보다 정면으로 풀어가는 쪽입니다. 복잡함을 덜어낸 만큼 판단이 빠르고 명료합니다. 직진의 힘이 당신의 무기입니다." },
          mild:   { lead: "당신은 묶는 일에 매이지 않는 기색이 있습니다.", body: "한 가지 방식에 갇히지 않고 상황에 맞춰 풀어갑니다. 묶기든 정면이든 그날의 판에 맞는 답을 고릅니다. 유연함이 당신의 색입니다." },
        },
      }
    },
    "들어갈 때와 빠질 때": {
      durability: {
        hi: {
          strong: { lead: "당신은 들어갈 때 끝까지 버티는 사람입니다.", body: "한 번 진입하면 좀처럼 빠지지 않고 그 자리를 끝까지 지킵니다. 쉽게 물러서지 않는 그 무게가 팀이 매달릴 닻이 됩니다. 당신이 버틴 시간만큼 동료들이 안심하고 일합니다." },
          clear:  { lead: "당신은 진입 후 오래 버티는 편입니다.", body: "앞에 머무는 시간이 길어 팀의 전선이 쉽게 무너지지 않습니다. 당신이 자리를 지키는 동안 화력이 마음껏 쏟아집니다. 버팀이 곧 당신의 기여입니다." },
          mild:   { lead: "당신에겐 버티며 자리를 지키려는 기색이 있습니다.", body: "한 번 들어가면 쉽게 물러서지 않는 끈기가 있습니다. 필요한 순간 그 자리를 지켜 팀의 형태를 잡아 줍니다. 무게감 있는 앞자리를 책임집니다." },
        },
        lo: {
          strong: { lead: "당신은 들어가고 빠지는 타이밍이 날렵한 사람입니다.", body: "치고 빠지는 감각이 예리해 손해 없이 이득만 챙겨 나옵니다. 위험이 커지기 직전에 정확히 발을 빼니 좀처럼 잡히지 않습니다. 그 영리한 거리 감각이 당신을 끈질긴 위협으로 만듭니다." },
          clear:  { lead: "당신은 길게 버티기보다 깔끔하게 빠지는 편입니다.", body: "위험이 커지기 전에 발을 빼는 판단이 빠릅니다. 무리하게 머물지 않으니 헛된 손해가 적습니다. 들고 나는 결정이 군더더기 없습니다." },
          mild:   { lead: "당신은 무리하게 머무르지 않는 기색이 있습니다.", body: "한 번 더 욕심내기 전에 한 발 빼는 절제가 있습니다. 위험을 길게 끌지 않아 손해가 깔끔합니다. 물러설 때를 아는 감각이 있습니다." },
        },
      },
      aggression: {
        hi: {
          strong: { lead: "당신은 빠질 자리에서도 한 번 더 들어가는 사람입니다.", body: "물러설 타이밍에도 당신의 손은 한 번 더 들어가려 합니다. 그 한 수가 판을 통째로 뒤집기도 하고, 때론 위험을 부르기도 합니다. 끝을 보려는 그 과감함이 당신의 매력이자 숙제입니다." },
          clear:  { lead: "당신은 진입을 망설이지 않는 편입니다.", body: "각이 보이면 깊이 들어가는 데 거리낌이 없습니다. 그 과감함이 다른 사람은 못 만드는 기회를 열어 줍니다. 들어가는 용기가 당신의 무기입니다." },
          mild:   { lead: "당신에겐 한 발 더 들어가려는 기색이 있습니다.", body: "기회 앞에서 평소보다 한 걸음 더 과감해집니다. 욕심이 손해로 이어지지 않게만 조절하면 그 적극성이 빛납니다. 들어갈 때를 아는 감각이 살아 있습니다." },
        },
        lo: {
          strong: { lead: "당신은 들어갈 때를 까다롭게 고르는 사람입니다.", body: "확실한 각이 아니면 좀처럼 발을 들이지 않습니다. 그 깐깐함 덕에 헛되이 무너지는 일이 거의 없습니다. 한 번 들어가면 그만큼 이유가 분명한 진입입니다." },
          clear:  { lead: "당신은 진입을 신중히 고르는 편입니다.", body: "무리한 깊이를 피하고 안전한 각만 골라 들어갑니다. 그 신중함이 손해를 줄이고 판을 길게 끕니다. 욕심보다 판단을 앞세웁니다." },
          mild:   { lead: "당신은 들어가기 전 한 번 더 살피는 기색이 있습니다.", body: "안전을 먼저 확인하고 발을 들이는 습관이 있습니다. 한 박자 늦더라도 그만큼 정확한 진입을 합니다. 무모함이 없는 만큼 손해도 적습니다." },
        },
      }
    },
    "아군과 맞물리는 방식": {
      support: {
        hi: {
          strong: { lead: "당신은 뒤에서 아군을 살리고 지켜 판을 잇는 사람입니다.", body: "당신의 시선은 늘 위태로운 동료에게 먼저 가닿습니다. 당신이 살리고 지켜 준 만큼 아군은 더 오래 싸우고 더 멀리 갑니다. 화면에 잘 안 잡히는 그 손길이 팀을 끝까지 굴러가게 하는 진짜 힘입니다." },
          clear:  { lead: "당신은 아군을 보조하며 맞물리는 편입니다.", body: "혼자 빛나기보다 동료와 맞물려 함께 강해지는 쪽입니다. 위급한 순간 내미는 당신의 손이 판을 이어 붙입니다. 함께일 때 더 강한 사람입니다." },
          mild:   { lead: "당신에겐 아군을 챙기려는 기색이 있습니다.", body: "위급한 동료가 보이면 모른 척하지 못합니다. 결정적인 순간 내미는 그 한 손이 흐름을 살립니다. 팀을 향한 시선이 따뜻합니다." },
        },
        lo: {
          strong: { lead: "당신은 아군을 챙기기보다 제 역할을 끝까지 하는 사람입니다.", body: "남을 살리는 손길보다 자기 자리를 빈틈없이 지키는 게 당신의 방식입니다. 각자 제 몫을 다하면 이긴다는 믿음이 당신 플레이의 중심에 있습니다. 그 우직함이 팀의 한 축을 단단히 잡아 줍니다." },
          clear:  { lead: "당신은 보조보다 자기 일에 집중하는 편입니다.", body: "맡은 자리를 비우지 않고 끝까지 책임지는 쪽입니다. 화려한 케어 대신 묵묵한 제 몫으로 팀에 기여합니다. 믿고 맡길 수 있는 한 축입니다." },
          mild:   { lead: "당신은 팀 유틸보다 본분에 무게를 두는 기색이 있습니다.", body: "남을 돕기보다 자기 역할을 또렷이 해내는 편입니다. 제 일을 확실히 하는 그 태도가 팀의 토대가 됩니다. 본분에 충실한 사람입니다." },
        },
      },
      crowd: {
        hi: {
          strong: { lead: "당신은 적을 묶어 아군이 들어올 길을 여는 사람입니다.", body: "당신이 적을 붙잡는 그 순간이 한타의 시작점이 됩니다. 발이 묶인 적 위로 동료들이 달려들고, 흩어져 있던 싸움이 한 점으로 모입니다. 한타가 당신 손끝에서 풀린다는 걸 팀이 압니다." },
          clear:  { lead: "당신은 컨트롤로 아군과 맞물리는 편입니다.", body: "당신이 잡아 둔 적 위로 팀의 화력이 쏟아집니다. 묶고 여는 그 한 수가 동료들의 딜을 살려 냅니다. 팀과 톱니처럼 맞물리는 사람입니다." },
          mild:   { lead: "당신에겐 적을 끊어 아군을 돕는 기색이 있습니다.", body: "결정적 순간 한 번의 묶기로 흐름을 만들어 냅니다. 화려하진 않아도 그 한 수가 아군의 길을 엽니다. 팀을 향한 감각이 살아 있습니다." },
        },
        lo: {
          strong: { lead: "당신은 묶고 살리기보다 앞장서 길을 여는 사람입니다.", body: "케어나 컨트롤로 맞무는 대신 직접 화력으로 판을 정리합니다. 당신이 앞장서 길을 트면 팀은 그 뒤를 따라옵니다. 정면을 책임지는 그 모습이 당신다움입니다." },
          clear:  { lead: "당신은 변수를 거는 쪽보단 정면을 맡는 편입니다.", body: "복잡한 설계 대신 직접 부딪쳐 길을 냅니다. 정직하게 앞을 뚫는 그 힘이 팀의 방향을 잡습니다. 단순하지만 분명한 기여입니다." },
          mild:   { lead: "당신은 컨트롤보다 다른 방식으로 맞무는 기색이 있습니다.", body: "묶기 하나에 매이지 않고 상황에 맞춰 역할을 잡습니다. 그날의 판이 필요로 하는 자리를 골라 채웁니다. 유연하게 팀과 맞물립니다." },
        },
      }
    },
    "상대가 불편해지는 자리": {
      firepower: {
        hi: {
          strong: { lead: "당신은 멀리서 꽂는 화력으로 상대를 옥죄는 사람입니다.", body: "당신이 사정거리 안에 자리를 잡는 순간 상대는 발이 묶입니다. 다가오면 맞고 물러서면 밀리니 어느 쪽도 마음 편한 선택이 없습니다. 그 보이지 않는 압박이 상대를 가장 불편하게 만드는 당신의 무기입니다." },
          clear:  { lead: "당신은 거리에서 피해를 누적해 압박하는 편입니다.", body: "꾸준히 쌓이는 피해가 상대의 선택지를 하나씩 지웁니다. 다가오지도 물러서지도 못하게 만드는 그 거리 싸움이 당신의 특기입니다. 가만히 있어도 상대는 점점 불리해집니다." },
          mild:   { lead: "당신에겐 화력으로 거리를 재는 기색이 있습니다.", body: "기회가 오면 한 발 꽂아 상대의 자리를 좁힙니다. 무리하진 않아도 거리를 다루는 감각이 있습니다. 슬며시 거는 그 압박이 상대를 신경 쓰이게 합니다." },
        },
        lo: {
          strong: { lead: "당신은 딜이 아닌 다른 방식으로 상대를 불편하게 하는 사람입니다.", body: "큰 피해 대신 자리와 압박, 시선으로 판을 흔듭니다. 화력판엔 안 보여도 당신이 막아선 길 때문에 상대는 답답해집니다. 숫자로 안 잡히는 그 존재감이 진짜 위협입니다." },
          clear:  { lead: "당신은 화력 외의 수로 상대를 까다롭게 하는 편입니다.", body: "딜이 아니라 존재만으로도 상대의 길을 막습니다. 자리를 잡고 압박을 거는 그 방식이 상대를 불편하게 합니다. 보이지 않는 위협을 거는 사람입니다." },
          mild:   { lead: "당신은 직접 딜보다 다른 압박을 거는 기색이 있습니다.", body: "역할로 상대를 묶고 자리로 흔드는 편입니다. 큰 피해 없이도 상대의 선택을 좁힙니다. 다른 방식의 위협을 아는 사람입니다." },
        },
      },
      crowd: {
        hi: {
          strong: { lead: "당신은 상대를 묶어 가장 불편한 순간을 만드는 사람입니다.", body: "당신의 컨트롤에 걸린 적은 당신의 팀 앞에서 손발이 묶입니다. 도망칠 수도 받아칠 수도 없는 그 순간이 상대에겐 악몽입니다. 가장 결정적인 타이밍에 가장 아픈 자리를 짚어 내는 눈이 있습니다." },
          clear:  { lead: "당신은 컨트롤로 상대의 발을 묶는 편입니다.", body: "결정적 묶기 한 번으로 교전의 저울을 가릅니다. 묶인 적은 아무것도 못 하고 당신 팀에 정리됩니다. 판을 가르는 그 한 수가 당신의 색입니다." },
          mild:   { lead: "당신에겐 적을 끊어 압박하는 기색이 있습니다.", body: "꼭 필요한 순간 한 번의 묶기로 큰 차이를 냅니다. 화려하진 않아도 그 타이밍이 정확합니다. 결정적 순간을 읽는 감각이 있습니다." },
        },
        lo: {
          strong: { lead: "당신은 묶기보다 정면 압박으로 상대를 누르는 사람입니다.", body: "변수를 거는 대신 정직한 힘으로 상대를 밀어붙입니다. 복잡한 설계 없이도 당신의 압박 자체가 무겁습니다. 단순해서 더 막기 어려운 정면 승부가 당신의 방식입니다." },
          clear:  { lead: "당신은 컨트롤보다 직접적인 압박을 거는 편입니다.", body: "복잡함 없이 정면으로 부딪쳐 상대를 누릅니다. 군더더기 없는 그 압박이 상대를 뒤로 물립니다. 직진의 힘으로 길을 냅니다." },
          mild:   { lead: "당신은 묶는 일에 매이지 않는 기색이 있습니다.", body: "한 가지 방식에 갇히지 않고 상대를 흔드는 수를 바꿉니다. 그날의 판에 맞춰 압박의 결을 고릅니다. 유연하게 상대를 까다롭게 만듭니다." },
        },
      },
      durability: {
        hi: {
          strong: { lead: "당신은 버티는 몸으로 상대의 진입을 막는 사람입니다.", body: "당신이 길목에 서 있으면 상대는 쉽게 넘어오지 못합니다. 넘으려다 막히고 돌아가려다 늦어지니 상대의 계획이 어그러집니다. 그저 버티고 서 있는 것만으로 길을 닫아 버리는 벽이 됩니다." },
          clear:  { lead: "당신은 단단함으로 상대를 가로막는 편입니다.", body: "쉽게 뚫리지 않는 그 단단함이 상대의 발을 묶습니다. 당신을 넘지 못해 상대는 다른 길을 찾아 헤맵니다. 막아서는 것 자체가 압박입니다." },
          mild:   { lead: "당신에겐 몸으로 길을 막는 기색이 있습니다.", body: "필요한 순간 앞을 가려 상대의 진입을 늦춥니다. 무리하진 않아도 길목을 지키는 감각이 있습니다. 그 한 발이 상대를 망설이게 합니다." },
        },
        lo: {
          strong: { lead: "당신은 버티기보다 위치로 상대를 까다롭게 하는 사람입니다.", body: "정면으로 막아서는 대신 맞지 않는 자리에서 상대를 흔듭니다. 잡힐 듯 잡히지 않는 그 거리가 상대를 가장 답답하게 합니다. 몸이 아니라 위치로 길을 좁히는 영리함이 있습니다." },
          clear:  { lead: "당신은 정면 막기보다 자리로 압박하는 편입니다.", body: "거리를 두고 상대를 불편하게 만드는 데 능합니다. 직접 부딪치지 않아도 당신의 위치 자체가 위협입니다. 영리한 자리 싸움이 당신의 무기입니다." },
          mild:   { lead: "당신은 몸으로 막기보다 다른 수를 쓰는 기색이 있습니다.", body: "위치로 길을 좁히며 상대를 까다롭게 합니다. 정면 대신 거리로 푸는 감각이 있습니다. 무리 없이 상대를 흔드는 사람입니다." },
        },
      }
    },
    "잘 풀리는 날의 얼굴": {
      firepower: {
        hi: {
          strong: { lead: "잘 풀리는 날의 당신은 화력으로 판을 혼자 끌고 갑니다.", body: "감이 오는 날엔 당신의 딜이 한 번 터지기 시작하면 아무도 못 말립니다. 적은 다가오지도 못하고 녹아내리고, 팀은 당신 뒤에 서기만 하면 됩니다. 그런 날의 당신은 판 전체를 혼자 짊어지고 끌고 갑니다." },
          clear:  { lead: "잘 풀리면 당신의 화력이 판을 주도하는 편입니다.", body: "한 번 살아난 화력이 끝까지 몰아치며 판을 이끕니다. 좋은 날엔 당신의 딜이 곧 팀의 주된 무기가 됩니다. 흐름을 쥐면 좀처럼 놓지 않습니다." },
          mild:   { lead: "잘 풀리는 날엔 화력이 살아나는 기색이 있습니다.", body: "기세를 타면 평소보다 한 걸음 더 과감해집니다. 좋은 날의 당신은 화력으로 분위기를 끌어올립니다. 살아난 손이 판에 활기를 더합니다." },
        },
        lo: {
          strong: { lead: "잘 풀리는 날의 당신은 딜보다 역할로 빛납니다.", body: "감이 오는 날, 당신은 화력 숫자가 아니라 판이 굴러가는 모양으로 빛납니다. 막고 트고 이어 주는 그 손길에 팀 전체가 매끄럽게 돌아갑니다. 당신의 좋은 날은 팀의 좋은 날과 같은 말입니다." },
          clear:  { lead: "잘 풀리면 당신은 제 역할을 완벽히 해내는 편입니다.", body: "좋은 날엔 화력 없이도 맡은 일을 빈틈없이 해냅니다. 제 몫을 정확히 하는 그 안정감이 판을 이깁니다. 빛나는 방식이 화려하지 않을 뿐 분명합니다." },
          mild:   { lead: "잘 풀리는 날엔 본분에 더 충실해지는 기색이 있습니다.", body: "감이 오면 맡은 일이 한결 매끄럽게 돌아갑니다. 욕심내지 않아도 제 자리가 또렷해집니다. 본분에서 빛나는 사람입니다." },
        },
      },
      economy: {
        hi: {
          strong: { lead: "잘 풀리는 날의 당신은 차곡차곡 강해져 후반을 지배합니다.", body: "초반이 다소 잠잠해도 당신은 조급해하지 않습니다. 시간이 흐를수록 장비가 쌓이고, 쌓인 만큼 당신은 무서워집니다. 후반에 이르면 판은 어느새 당신이 지배하는 무대가 되어 있습니다." },
          clear:  { lead: "잘 풀리면 당신은 후반 캐리로 굳어지는 편입니다.", body: "성장이 한 번 쌓이기 시작하면 판을 가져옵니다. 시간이 지날수록 당신의 존재감이 커집니다. 후반을 책임지는 든든함이 있습니다." },
          mild:   { lead: "잘 풀리는 날엔 성장이 매끄럽게 도는 기색이 있습니다.", body: "좋은 날엔 장비가 자연스럽게 갖춰지며 후반으로 갈수록 강해집니다. 느긋하지만 꾸준한 그 곡선이 끝에 가서 빛납니다. 시간을 자기편으로 만드는 사람입니다." },
        },
        lo: {
          strong: { lead: "잘 풀리는 날의 당신은 초반부터 끓어올라 기세를 만듭니다.", body: "당신은 장비가 갖춰질 때까지 기다리는 사람이 아닙니다. 좋은 날엔 초반부터 불을 지펴 판의 주도권을 가져옵니다. 느긋한 성장보다 빠른 한 방이 당신다운 승리 공식입니다." },
          clear:  { lead: "잘 풀리면 당신은 초반 주도권을 쥐는 편입니다.", body: "기다리기보다 먼저 굴려 흐름을 만듭니다. 초반에 잡은 기세가 그대로 판을 끌고 갑니다. 빠른 시작이 당신의 색입니다." },
          mild:   { lead: "잘 풀리는 날엔 초반부터 적극적인 기색이 있습니다.", body: "좋은 날엔 시작부터 빠르게 흐름을 잡습니다. 느긋함보다 속도로 판을 여는 편입니다. 초반의 활기가 당신의 무기입니다." },
        },
      },
      support: {
        hi: {
          strong: { lead: "잘 풀리는 날의 당신은 팀을 살려 모두를 빛나게 합니다.", body: "감이 오는 날, 당신의 손이 닿는 동료마다 한 번씩 살아납니다. 당신이 챙긴 덕에 팀 전체가 살아나고, 모두가 자기 몫 이상을 해냅니다. 당신 한 사람의 좋은 날이 다섯 사람의 좋은 날로 번집니다." },
          clear:  { lead: "잘 풀리면 당신의 케어가 팀을 굴러가게 하는 편입니다.", body: "좋은 날엔 당신의 손길에 팀이 매끄럽게 돌아갑니다. 함께 강해지는 그 흐름을 당신이 만들어 냅니다. 팀의 윤활유 같은 사람입니다." },
          mild:   { lead: "잘 풀리는 날엔 아군을 더 잘 챙기는 기색이 있습니다.", body: "감이 오면 동료를 살피는 손길이 한결 빨라집니다. 그 작은 케어들이 모여 팀의 흐름을 살립니다. 함께일 때 빛나는 사람입니다." },
        },
        lo: {
          strong: { lead: "잘 풀리는 날의 당신은 제 몫을 완벽히 해 판을 끕니다.", body: "당신은 각자 제 몫을 다하면 이긴다는 걸 몸으로 증명하는 사람입니다. 좋은 날엔 맡은 자리를 흔들림 없이 지켜 판을 끝까지 끌고 갑니다. 화려한 케어 없이도 우직한 한 축이 팀을 이깁니다." },
          clear:  { lead: "잘 풀리면 당신은 본분에서 빛나는 편입니다.", body: "좋은 날엔 맡은 자리를 확실히 지켜 냅니다. 제 일을 또렷이 해내는 그 안정감이 팀을 받칩니다. 믿고 맡길 수 있는 사람입니다." },
          mild:   { lead: "잘 풀리는 날엔 자기 역할이 매끄러워지는 기색이 있습니다.", body: "감이 오면 흔들림 없이 제 일을 해냅니다. 본분에 충실한 그 모습이 팀의 토대가 됩니다. 묵묵히 제 몫을 하는 사람입니다." },
        },
      }
    },
    "안 풀리는 날의 새는 곳": {
      aggression: {
        hi: {
          strong: { lead: "안 풀리는 날, 당신은 무리한 한 발에 발목 잡히곤 합니다.", body: "잘 안 풀리는 날일수록 당신의 손은 한 발 더 들어가려 합니다. 그 욕심이 가끔은 판을 살리지만, 안 풀리는 날엔 그게 새는 구멍이 됩니다. 들어가고 싶은 마음을 딱 한 번만 눌러 줘도 흐름이 눈에 띄게 달라집니다." },
          clear:  { lead: "안 풀리면 당신은 과감함이 독이 되는 편입니다.", body: "평소의 무기인 과감함이 안 풀리는 날엔 손해로 돌아옵니다. 각을 한 번 더 재는 그 한 박자가 새는 곳을 줄여 줍니다. 용기를 거두라는 게 아니라 한 번 더 보라는 뜻입니다." },
          mild:   { lead: "안 풀리는 날엔 조금 서두르는 기색이 있습니다.", body: "흐름이 안 좋으면 평소보다 마음이 앞서곤 합니다. 한 호흡만 늦춰도 그 서두름이 가라앉습니다. 조급함만 다스리면 충분한 사람입니다." },
        },
        lo: {
          strong: { lead: "안 풀리는 날, 당신은 너무 사리다 기회를 놓치곤 합니다.", body: "안 풀리는 날일수록 당신은 더 몸을 사립니다. 그 신중함이 손해는 막아 주지만, 분명한 기회까지 흘려보내게 만듭니다. 확실한 각에선 한 번쯤 먼저 들어가도 좋습니다." },
          clear:  { lead: "안 풀리면 당신은 망설임이 길어지는 편입니다.", body: "흐름이 안 좋으면 결단이 자꾸 뒤로 밀립니다. 결정을 반 박자만 당기면 끊겼던 흐름이 다시 돕니다. 용기를 반 발만 앞세우면 됩니다." },
          mild:   { lead: "안 풀리는 날엔 다소 소극적인 기색이 있습니다.", body: "안 풀리면 평소보다 한 걸음 물러서는 편입니다. 한 번쯤 먼저 움직여 보면 흐름이 바뀝니다. 살짝의 용기면 충분합니다." },
        },
      },
      momentum: {
        hi: {
          strong: { lead: "안 풀리는 날, 당신은 기세에 취해 무리하기 쉽습니다.", body: "잘 나갈 때의 그 자신감이 안 풀리는 날엔 발목을 잡습니다. 흐름이 좋다고 믿고 한 발 더 갔다가 손해를 보곤 합니다. 잘 나갈 때일수록 한 발을 아껴 두면 그 기세가 더 오래갑니다." },
          clear:  { lead: "안 풀리면 당신은 좋은 흐름을 과신하는 편입니다.", body: "기세를 믿는 마음이 가끔 무리수로 이어집니다. 기세와 무리수를 구분하는 눈이 생기면 훨씬 단단해집니다. 자신감을 다듬으면 강점이 됩니다." },
          mild:   { lead: "안 풀리는 날엔 분위기에 휩쓸리는 기색이 있습니다.", body: "흐름이 좋으면 거기에 살짝 들뜨곤 합니다. 한 번만 가다듬으면 금세 균형을 찾습니다. 작은 절제면 충분한 사람입니다." },
        },
        lo: {
          strong: { lead: "안 풀리는 날, 당신은 한 번 무너지면 길게 흔들립니다.", body: "손해 하나가 다음 판까지 마음에 길게 남는 편입니다. 흔들리는 채로 이어 가면 손해가 손해를 부르기 쉽습니다. 무너진 뒤 딱 한 판만 차분히 가다듬으면 본래 기량이 돌아옵니다." },
          clear:  { lead: "안 풀리면 당신은 회복이 더딘 편입니다.", body: "한 번 밀리면 페이스를 되찾는 데 시간이 걸립니다. 한 호흡 고르며 천천히 가면 본래 기량이 돌아옵니다. 서두르지 않는 게 더 빠른 길입니다." },
          mild:   { lead: "안 풀리는 날엔 잠시 페이스가 식는 기색이 있습니다.", body: "흐름이 안 좋으면 잠깐 손이 무뎌집니다. 다만 곧 제자리를 찾는 사람입니다. 잠깐의 식음은 금세 풀립니다." },
        },
      }
    },
    "픽을 고르는 손": {
      loyalty: {
        hi: {
          strong: { lead: "당신은 정든 챔프 하나를 깊게 파는 장인입니다.", body: "당신의 손은 늘 손에 익은 그 챔프를 먼저 찾습니다. 폭이 넓진 않아도 그 한 챔프에선 누구보다 매섭고 정교합니다. 익숙함을 끝까지 갈고닦은 그 깊이가 곧 당신의 이름입니다." },
          clear:  { lead: "당신은 손에 익은 챔프를 고집하는 편입니다.", body: "여러 챔프를 떠도는 대신 즐겨 쓰는 픽으로 손을 모읍니다. 그 익숙함이 흔들림 없는 안정감을 줍니다. 한 챔프에 쌓인 손맛이 당신의 무기입니다." },
          mild:   { lead: "당신에겐 즐겨 찾는 챔프가 또렷한 기색이 있습니다.", body: "마음이 가는 챔프가 분명히 있는 편입니다. 그 챔프가 손에 들어오면 플레이의 안정감이 달라집니다. 좋아하는 손맛이 또렷한 사람입니다." },
        },
        lo: {
          strong: { lead: "당신은 한 챔프에 매이지 않는 다재다능형입니다.", body: "당신은 정해진 픽 없이 그날의 판이 필요로 하는 챔프를 골라 듭니다. 판마다 다른 얼굴로 나서니 상대는 당신을 읽기 어렵습니다. 무엇이든 쥘 수 있다는 그 자체가 당신의 무기입니다." },
          clear:  { lead: "당신은 여러 챔프를 두루 다루는 편입니다.", body: "한 챔프에 갇히지 않고 상황에 맞는 픽을 골라 씁니다. 그 유연함이 어떤 조합에도 답을 내게 합니다. 폭넓은 손이 당신의 강점입니다." },
          mild:   { lead: "당신에겐 새 챔프도 마다 않는 기색이 있습니다.", body: "익숙한 픽에만 머물지 않고 폭을 넓혀 가며 즐깁니다. 새로운 챔프를 시도하는 그 태도가 시야를 넓힙니다. 갇히지 않는 손을 가진 사람입니다." },
        },
      },
      breadth: {
        hi: {
          strong: { lead: "당신은 판마다 다른 챔프를 꺼내는 만능형입니다.", body: "당신의 픽은 그날의 조합과 분위기에 따라 매번 달라집니다. 넓은 폭이 어떤 상황에도 들어맞는 답을 마련해 줍니다. 무엇이 나와도 받아칠 수 있다는 게 당신의 든든함입니다." },
          clear:  { lead: "당신은 챔프 폭이 넓은 편입니다.", body: "상황에 맞춰 자유롭게 픽을 고르는 유연함이 있습니다. 한 챔프에 묶이지 않으니 선택의 여지가 넓습니다. 폭이 곧 당신의 무기입니다." },
          mild:   { lead: "당신에겐 다양한 챔프를 시도하는 기색이 있습니다.", body: "한 챔프에 갇히지 않고 이것저것 손을 대 봅니다. 그 도전이 챔프 폭을 조금씩 넓혀 갑니다. 시야가 닫혀 있지 않은 사람입니다." },
        },
        lo: {
          strong: { lead: "당신은 좁고 깊게 파는 한우물 장인입니다.", body: "당신의 모든 감각은 정든 그 한 챔프에 모여 있습니다. 폭을 넓히는 대신 깊이를 파 내려간 그 손맛이 남다릅니다. 한 챔프를 끝까지 갈고닦은 깊이가 당신의 이름이 됩니다." },
          clear:  { lead: "당신은 챔프 폭이 또렷하게 좁은 편입니다.", body: "여러 챔프를 떠도는 대신 한 챔프 숙련을 깊게 쌓습니다. 좁은 만큼 그 챔프에선 흔들림이 없습니다. 깊이가 곧 당신의 강점입니다." },
          mild:   { lead: "당신에겐 즐겨 쓰는 챔프가 정해진 기색이 있습니다.", body: "마음이 가는 픽이 분명한 편입니다. 익숙한 손맛을 따라가니 플레이가 안정적입니다. 좋아하는 챔프가 또렷한 사람입니다." },
        },
      }
    },
    "장비와 선택을 타는 방식": {
      economy: {
        hi: {
          strong: { lead: "당신은 장비를 차곡차곡 갖춰 후반에 폭발하는 사람입니다.", body: "당신은 한 방을 서두르지 않고 차분히 장비를 쌓아 올립니다. 시간이 흐를수록 당신의 무게가 무거워지고, 후반에 이르면 손쓸 수 없는 위협이 됩니다. 시간이 당신 편일수록 더 무서워지는 사람입니다." },
          clear:  { lead: "당신은 성장 곡선을 길게 그리는 편입니다.", body: "초반보다 후반으로 갈수록 존재감이 커지는 쪽입니다. 갖춰진 장비가 당신의 한 수를 점점 묵직하게 만듭니다. 길게 보는 안목이 당신의 강점입니다." },
          mild:   { lead: "당신에겐 꾸준히 갖춰 가는 기색이 있습니다.", body: "급하지 않게 시간을 들여 강해지는 편입니다. 천천히 쌓인 장비가 후반에 빛을 봅니다. 꾸준함이 당신의 무기입니다." },
        },
        lo: {
          strong: { lead: "당신은 장비를 기다리기보다 초반에 승부를 보는 사람입니다.", body: "당신은 장비가 갖춰질 때까지 가만히 기다리지 않습니다. 한 발 빠른 압박으로 초반부터 주도권을 가져오는 게 당신의 길입니다. 느긋한 성장보다 빠른 관여가 당신다운 승리 방식입니다." },
          clear:  { lead: "당신은 성장보다 초반 관여를 택하는 편입니다.", body: "느긋함 대신 속도를 골라 먼저 굴립니다. 초반에 만든 기세가 그대로 판을 끌고 갑니다. 빠른 시작이 당신의 색입니다." },
          mild:   { lead: "당신에겐 초반부터 굴리려는 기색이 있습니다.", body: "기다리기보다 먼저 움직여 흐름을 잡는 편입니다. 초반의 작은 관여가 판의 분위기를 만듭니다. 속도를 아는 사람입니다." },
        },
      },
      firepower: {
        hi: {
          strong: { lead: "당신은 화력 장비를 몰아 한 방을 키우는 사람입니다.", body: "당신의 선택은 늘 한 타격의 무게를 키우는 쪽으로 기웁니다. 장비가 갖춰질수록 당신의 한 방은 점점 더 묵직해집니다. 끝을 보는 그 한 방이 당신이 판을 푸는 방식입니다." },
          clear:  { lead: "당신은 공격적인 선택을 우선하는 편입니다.", body: "버티기보다 딜을 키우는 쪽으로 손이 먼저 갑니다. 그 공격성이 당신의 한 수를 위협적으로 만듭니다. 화력에 무게를 싣는 사람입니다." },
          mild:   { lead: "당신에겐 화력을 먼저 챙기는 기색이 있습니다.", body: "선택의 갈림길에서 한 발의 무게를 키우는 쪽을 봅니다. 무리하진 않아도 공격적인 결을 선호합니다. 한 방을 아끼는 사람입니다." },
        },
        lo: {
          strong: { lead: "당신은 화력보다 생존·유틸 쪽 선택을 먼저 잡는 사람입니다.", body: "한 방의 무게보다 오래 싸우는 형태를 만드는 게 당신의 우선순위입니다. 살아남고 버티는 선택이 당신을 끝까지 판에 남게 합니다. 지속을 보는 그 안목이 당신다움입니다." },
          clear:  { lead: "당신은 딜보다 버티는 선택을 택하는 편입니다.", body: "한 방보다 지속을 보고 안정적인 쪽을 고릅니다. 위험을 덜어낸 선택이 당신을 길게 싸우게 합니다. 오래가는 힘을 아는 사람입니다." },
          mild:   { lead: "당신에겐 안전한 선택을 챙기는 기색이 있습니다.", body: "위험을 덜고 길게 가는 쪽으로 손이 갑니다. 무모한 한 방보다 안정을 우선합니다. 신중한 선택을 하는 사람입니다." },
        },
      }
    },
    "최근 흐름": {
      momentum: {
        hi: {
          strong: { lead: "요즘의 당신은 한껏 물이 오른 상승세입니다.", body: "최근의 감각이 그동안 쌓아 온 기록보다 한 발 앞서 있습니다. 손이 잘 맞고 판단이 가벼우니 지금이 당신의 절정입니다. 이 흐름을 의심하지 말고 믿고 한 판 더 이어 가도 좋습니다." },
          clear:  { lead: "당신은 최근 들어 기세가 좋은 편입니다.", body: "요즘 들어 손이 부쩍 잘 맞는 흐름입니다. 지금의 감각을 믿고 가도 좋은 시기입니다. 올라온 기세를 놓치지 마세요." },
          mild:   { lead: "당신에겐 요즘 감각이 살아나는 기색이 있습니다.", body: "최근 흐름이 조금씩 위를 향하고 있습니다. 손이 풀리기 시작한 좋은 신호입니다. 이 결을 이어 가면 됩니다." },
        },
        lo: {
          strong: { lead: "요즘의 당신은 본래 기량보다 살짝 식은 상태입니다.", body: "지금의 감각이 평소 당신의 실력보다 조금 가라앉아 있습니다. 하지만 이건 실력이 아니라 잠깐의 흐름일 뿐입니다. 조급해하지 말고 한 판씩 감각을 되찾으면 본래 기량이 돌아옵니다." },
          clear:  { lead: "당신은 최근 흐름이 다소 가라앉은 편입니다.", body: "요즘 손이 살짝 무뎌진 시기입니다. 다만 이건 일시적이고 원래 기량은 그대로입니다. 천천히 가면 곧 제자리를 찾습니다." },
          mild:   { lead: "당신에겐 요즘 페이스가 잠시 무뎌진 기색이 있습니다.", body: "최근 감각이 살짝 식어 있는 정도입니다. 한 호흡 고르면 금세 풀립니다. 잠깐의 무뎌짐일 뿐입니다." },
        },
      }
    },
    "포로의 결론": {
      firepower: {
        hi: {
          strong: { lead: "결국 당신은 화력으로 기억되는 사람입니다.", body: "여러 면을 살펴봐도 당신을 한마디로 묶는 건 결국 화력입니다. 끝을 보려는 그 한 방이 당신의 플레이를 정의합니다. 이 강점을 믿고 더 과감하게 밀어붙여도 좋습니다." },
          clear:  { lead: "당신의 중심엔 화력이 있습니다.", body: "당신의 플레이는 화력을 축으로 돌아갑니다. 이 강점을 중심으로 판을 풀어가면 가장 당신다운 그림이 나옵니다. 화력이 당신의 길입니다." },
          mild:   { lead: "당신에겐 화력이라는 색이 배어 있습니다.", body: "여러 면 중에서도 화력의 결이 은은하게 묻어납니다. 그 색을 더 살려 가면 당신만의 무기가 됩니다. 화력이 당신 안에 자리하고 있습니다." },
        },
        lo: {
          strong: { lead: "결국 당신은 화력이 아닌 다른 무기로 빛나는 사람입니다.", body: "당신을 정의하는 건 화면에 찍히는 딜 숫자가 아닙니다. 막고 트고 이어 주는 그 손길이 당신의 진짜 무기입니다. 그 강점을 믿고 당신만의 방식대로 가면 됩니다." },
          clear:  { lead: "당신의 중심은 딜 밖에 있습니다.", body: "화력보다 다른 일에서 당신의 색이 더 또렷합니다. 그쪽 강점을 더 키워 가면 당신다움이 분명해집니다. 딜이 전부가 아닙니다." },
          mild:   { lead: "당신에겐 화력 외의 색이 또렷합니다.", body: "딜보다 다른 결이 당신 안에 선명하게 자리합니다. 그 색을 살려 가면 당신만의 길이 보입니다. 화력 밖에 강점이 있습니다." },
        },
      },
      durability: {
        hi: {
          strong: { lead: "결국 당신은 팀의 기둥으로 기억되는 사람입니다.", body: "여러 면을 살펴봐도 당신의 중심엔 흔들리지 않는 단단함이 있습니다. 당신이 버틴 그 자리에서 승부가 갈리곤 합니다. 그 버팀을 믿고 끝까지 앞에 서도 좋습니다." },
          clear:  { lead: "당신의 중심엔 단단함이 있습니다.", body: "당신의 플레이는 버티는 힘을 축으로 돌아갑니다. 그 단단함을 믿고 앞에 서면 팀이 설 땅이 생깁니다. 버팀이 당신의 길입니다." },
          mild:   { lead: "당신에겐 버티는 색이 배어 있습니다.", body: "여러 면 중에서도 묵직하게 버티는 결이 묻어납니다. 그 색을 더 살려 가면 든든한 무기가 됩니다. 단단함이 당신 안에 자리하고 있습니다." },
        },
        lo: {
          strong: { lead: "결국 당신은 살아남아 일하는 사람입니다.", body: "당신의 강점은 앞에서 부서지는 게 아니라 끝까지 남아 있는 데 있습니다. 안전한 자리에서 더 길게 영향을 남기는 게 당신의 방식입니다. 그 영리한 생존을 믿고 가세요." },
          clear:  { lead: "당신의 중심은 최전선 밖에 있습니다.", body: "최전선보다 한 발 뒤에서 당신의 색이 더 또렷합니다. 위치 감각을 더 살려 가면 손해 없이 길게 갑니다. 살아남는 영리함이 당신의 무기입니다." },
          mild:   { lead: "당신에겐 한 발 뒤의 여유가 배어 있습니다.", body: "앞보다 한 걸음 뒤에서 판을 보는 결이 묻어납니다. 그 여유를 살려 가면 안정적인 무기가 됩니다. 거리 감각이 당신 안에 있습니다." },
        },
      },
      loyalty: {
        hi: {
          strong: { lead: "결국 당신은 한 챔프로 기억되는 장인입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 정든 그 한 챔프입니다. 좁지만 깊게 판 그 외길이 당신의 색이 되었습니다. 그 길을 끝까지 믿고 가도 좋습니다." },
          clear:  { lead: "당신의 중심엔 정든 픽이 있습니다.", body: "당신의 플레이는 손에 익은 그 챔프를 축으로 돌아갑니다. 그 깊이를 무기로 삼으면 흔들림이 없습니다. 외길이 당신의 강점입니다." },
          mild:   { lead: "당신에겐 좋아하는 챔프의 색이 또렷합니다.", body: "여러 면 중에서도 즐겨 쓰는 픽의 결이 또렷합니다. 그 손맛을 살려 가면 당신만의 무기가 됩니다. 정든 챔프가 당신 안에 자리합니다." },
        },
        lo: {
          strong: { lead: "결국 당신은 무엇이든 쥐는 만능러입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 넓은 챔프 폭입니다. 무엇이 나와도 답을 내는 그 유연함이 당신의 색입니다. 그 넓이를 자랑으로 삼고 가세요." },
          clear:  { lead: "당신의 중심엔 다재다능이 있습니다.", body: "당신의 플레이는 폭넓은 손을 축으로 돌아갑니다. 어떤 조합에서도 답을 내는 그 유연함이 강점입니다. 넓이가 당신의 길입니다." },
          mild:   { lead: "당신에겐 폭넓은 색이 배어 있습니다.", body: "여러 면 중에서도 두루 다루는 결이 묻어납니다. 그 유연함을 살려 가면 어떤 판에도 답을 냅니다. 넓은 손이 당신 안에 있습니다." },
        },
      },
      breadth: {
        hi: {
          strong: { lead: "결국 당신은 어떤 픽도 소화하는 만능러입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 넓은 챔프 폭입니다. 무엇이 나와도 받아내는 그 유연함이 당신의 무기입니다. 그 폭을 자랑으로 삼고 가세요." },
          clear:  { lead: "당신의 중심엔 넓은 챔프 폭이 있습니다.", body: "당신의 플레이는 상황마다 다른 답을 내는 유연함을 축으로 돕니다. 한 챔프에 묶이지 않는 그 폭이 강점입니다. 넓이가 당신의 길입니다." },
          mild:   { lead: "당신에겐 두루 다루는 색이 배어 있습니다.", body: "여러 면 중에서도 폭넓게 소화하는 결이 묻어납니다. 그 유연함을 살려 가면 어떤 판에도 답을 냅니다. 넓은 손이 당신 안에 자리합니다." },
        },
        lo: {
          strong: { lead: "결국 당신은 한우물을 파는 장인입니다.", body: "여러 면을 살펴봐도 당신의 중심엔 좁고 깊은 숙련이 있습니다. 한 챔프를 끝까지 파 내려간 그 깊이가 당신의 색입니다. 그 깊이를 끝까지 믿고 가도 좋습니다." },
          clear:  { lead: "당신의 중심엔 좁고 깊은 숙련이 있습니다.", body: "당신의 플레이는 한 챔프에 쌓인 손맛을 축으로 돕니다. 그 깊이를 무기로 삼으면 흔들림이 없습니다. 외길이 당신의 강점입니다." },
          mild:   { lead: "당신에겐 외길의 색이 또렷합니다.", body: "여러 면 중에서도 좁고 깊게 파는 결이 또렷합니다. 그 손맛을 살려 가면 당신만의 무기가 됩니다. 깊이가 당신 안에 자리합니다." },
        },
      },
      economy: {
        hi: {
          strong: { lead: "결국 당신은 후반을 가져오는 대기만성입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 시간이 흐를수록 무거워지는 무게입니다. 초반의 잠잠함을 견디면 후반엔 누구도 당신을 막지 못합니다. 시간을 자기편으로 삼는 그 뚝심을 끝까지 믿어도 좋습니다." },
          clear:  { lead: "당신의 중심엔 후반의 힘이 있습니다.", body: "당신의 플레이는 차곡차곡 쌓아 올린 성장을 축으로 돌아갑니다. 시간이 지날수록 존재감이 커지니 길게 보는 안목이 당신의 강점입니다. 성장이 당신의 길입니다." },
          mild:   { lead: "당신에겐 후반형의 색이 배어 있습니다.", body: "여러 면 중에서도 천천히 강해지는 결이 묻어납니다. 그 꾸준함을 더 살려 가면 후반이 당신의 무대가 됩니다. 성장의 무게가 당신 안에 자리하고 있습니다." },
        },
        lo: {
          strong: { lead: "결국 당신은 초반을 사는 속전속결러입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 끓어오르는 초반의 기세입니다. 장비를 기다리는 대신 먼저 굴려 판의 주도권을 가져옵니다. 빠른 한 방이 당신다운 승리 공식이니 그 속도를 자랑으로 삼으세요." },
          clear:  { lead: "당신의 중심엔 초반의 기세가 있습니다.", body: "당신의 플레이는 먼저 굴려 잡은 주도권을 축으로 돌아갑니다. 기다리기보다 시작부터 흐름을 만드는 그 속도가 강점입니다. 빠른 시작이 당신의 길입니다." },
          mild:   { lead: "당신에겐 초반형의 색이 배어 있습니다.", body: "여러 면 중에서도 시작부터 굴리려는 결이 묻어납니다. 그 속도를 살려 가면 초반에 잡은 기세가 판을 끌고 갑니다. 초반의 활기가 당신 안에 자리합니다." },
        },
      },
      aggression: {
        hi: {
          strong: { lead: "결국 당신은 먼저 칼을 빼는 선봉장입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 먼저 들어가는 그 결단력입니다. 남이 망설일 때 당신이 떼는 첫 발이 싸움의 방향을 통째로 정합니다. 그 과감함을 믿고 판을 당신의 박자로 끌어와도 좋습니다." },
          clear:  { lead: "당신의 중심엔 선공의 기질이 있습니다.", body: "당신의 플레이는 먼저 치고 들어가는 과감함을 축으로 돌아갑니다. 시동을 거는 그 한 수가 망설이던 팀을 함께 움직이게 합니다. 먼저 여는 용기가 당신의 길입니다." },
          mild:   { lead: "당신에겐 선공형의 색이 배어 있습니다.", body: "여러 면 중에서도 먼저 열어보려는 결이 묻어납니다. 그 과감함을 더 살려 가면 흐름의 주인이 됩니다. 먼저 가는 감각이 당신 안에 자리하고 있습니다." },
        },
        lo: {
          strong: { lead: "결국 당신은 받아치는 한 수의 달인입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 기다렸다 되갚는 그 정확함입니다. 성급히 열기보다 상대의 빈틈을 노려 판을 가져옵니다. 먼저 친 쪽이 아니라 잘 받아친 쪽이 이긴다는 걸 그 손이 압니다." },
          clear:  { lead: "당신의 중심엔 받아치는 한 수가 있습니다.", body: "당신의 플레이는 타이밍을 노린 반격을 축으로 돌아갑니다. 한 박자 늦게 들어가도 그만큼 더 정확한 그 인내가 강점입니다. 기다릴 줄 아는 감각이 당신의 길입니다." },
          mild:   { lead: "당신에겐 역공형의 색이 배어 있습니다.", body: "여러 면 중에서도 한 박자 살피고 받아치는 결이 묻어납니다. 그 침착함을 살려 가면 헛된 손해 없이 이득만 챙깁니다. 받아치는 감각이 당신 안에 자리합니다." },
        },
      },
      momentum: {
        hi: {
          strong: { lead: "결국 당신은 물오른 상승세입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 지금 한껏 오른 그 감각입니다. 최근의 손이 그동안의 기록보다 한 발 앞서 있으니 지금이 당신의 절정입니다. 이 흐름을 의심하지 말고 믿고 더 밀어붙여도 좋습니다." },
          clear:  { lead: "당신의 중심엔 오른 기세가 있습니다.", body: "당신의 플레이는 요즘 부쩍 잘 맞는 손을 축으로 돌아갑니다. 올라온 그 감각을 믿고 가도 좋은 시기입니다. 살아난 기세가 당신의 길입니다." },
          mild:   { lead: "당신에겐 상승세의 색이 배어 있습니다.", body: "여러 면 중에서도 요즘 위를 향하는 결이 묻어납니다. 그 흐름을 이어 가면 손이 점점 더 풀립니다. 살아나는 감각이 당신 안에 자리하고 있습니다." },
        },
        lo: {
          strong: { lead: "결국 당신은 한결같은 페이스메이커입니다.", body: "여러 면을 살펴봐도 당신을 정의하는 건 들쭉날쭉 없는 그 한결같음입니다. 요즘이라고 특별히 오르지도 식지도 않고 늘 제 몫을 해냅니다. 그 변함없는 안정감이야말로 가장 믿을 수 있는 강점입니다." },
          clear:  { lead: "당신의 중심엔 한결같은 페이스가 있습니다.", body: "당신의 플레이는 기복 없는 꾸준함을 축으로 돌아갑니다. 늘 일정한 그 페이스가 팀이 믿고 기댈 토대가 됩니다. 한결같음이 당신의 길입니다." },
          mild:   { lead: "당신에겐 꾸준한 색이 배어 있습니다.", body: "여러 면 중에서도 흔들림 없이 제 몫을 하는 결이 묻어납니다. 그 안정감을 살려 가면 어떤 판에서도 믿음직합니다. 한결같은 페이스가 당신 안에 자리합니다." },
        },
      }
    }
  };
  // 균형 폴백(주도축 없는 장) — reader 해시로 변형 선택(같은 사람=같은 문구, 사람마다 다름).
  // ── 균형(중간대) 문장 뱅크 (2026-08-31 재작성) ───────────────────────────────
  //   두드러진 축이 없거나 그 장의 주도축이 중간대면 여기로 온다. 전체의 25~35% 가 이 길을 탄다(실측).
  //   v2 는 이 자리를 "픽 폭이 넓지도 좁지도 않은, 실속형입니다" 같은 짧은 진단문으로 채웠다 —
  //   점집 말투가 아니고, 장당 3~4개뿐이라 세 명 중 한 명이 글자까지 같은 문장을 받았다(사용자 신고).
  //   그래서 v1 관상가 말투("당신은 ~하는 사람입니다", 수치 0개, 마지막 문장은 그 사람 편을 든다)로
  //   다시 쓰고 장당 4변형으로 늘렸다. 없는 데이터를 지어내지 않는다 — 균형이라는 사실을 다르게 말할 뿐.
  var BALANCED_PROSE={
    "전투 본능":{lead:"당신은 어느 한쪽에 치우치지 않고 상황에 맞춰 싸우는 사람입니다.",body:"공격이 필요하면 앞장서고 버팀이 필요하면 자리를 지킵니다. 그날의 판이 무엇을 원하는지 읽고 거기에 맞춰 무기를 바꿉니다. 한 색에 갇히지 않는 그 유연함이 당신의 색입니다."},
    "손해를 본 뒤의 버릇":{lead:"당신은 손해를 봐도 크게 흔들리지 않는 사람입니다.",body:"밀려도 무리하게 만회하려 들지 않고, 그렇다고 위축되지도 않습니다. 손해를 담담히 받아들이고 제 페이스를 그대로 지킵니다. 그 균형 감각이 판을 길게 끌고 가는 힘입니다."},
    "싸움이 열리기 전":{lead:"당신은 열고 받는 타이밍을 상황 따라 고르는 사람입니다.",body:"먼저 시동을 걸어야 할 때와 합류해야 할 때를 그때그때 읽습니다. 한 가지 방식에 갇히지 않으니 상대가 당신의 패턴을 잡기 어렵습니다. 상황을 읽는 그 눈이 당신의 무기입니다."},
    "들어갈 때와 빠질 때":{lead:"당신은 들어가고 빠지는 균형이 무난한 사람입니다.",body:"과하게 깊이 들어가지도, 너무 일찍 빠지지도 않습니다. 위험과 이득을 저울질해 적당한 선을 지킵니다. 그 무난한 균형이 헛된 손해를 줄여 줍니다."},
    "아군과 맞물리는 방식":{lead:"당신은 팀 상황에 맞춰 역할을 유연하게 잡는 사람입니다.",body:"챙겨야 할 날엔 동료를 챙기고, 앞서야 할 날엔 앞섭니다. 정해진 역할에 묶이지 않고 비어 있는 자리를 채워 갑니다. 그 유연함이 팀의 빈틈을 메웁니다."},
    "상대가 불편해지는 자리":{lead:"당신은 한 가지 수가 아니라 여러 방식으로 상대를 흔드는 사람입니다.",body:"화력으로 누르기도, 자리로 막기도, 타이밍으로 흔들기도 합니다. 정해진 패턴이 없으니 상대는 당신을 읽기가 어렵습니다. 그 예측 불가함이 당신을 까다로운 상대로 만듭니다."},
    "잘 풀리는 날의 얼굴":{lead:"잘 풀리는 날의 당신은 어느 면에서나 고르게 좋아집니다.",body:"한쪽이 튀는 게 아니라 전체가 매끄럽게 맞물려 돌아갑니다. 화력도 버팀도 판단도 한 박자씩 더 정확해집니다. 빈틈없이 고른 그 모습이 당신의 좋은 날입니다."},
    "안 풀리는 날의 새는 곳":{lead:"안 풀리는 날에도 당신은 큰 구멍 없이 버티는 편입니다.",body:"치명적인 실수로 판을 통째로 내주는 일이 드뭅니다. 흐름이 나빠도 무난하게 마무리하며 손해를 최소로 줄입니다. 그 안정감이 안 풀리는 날의 버팀목이 됩니다."},
    "픽을 고르는 손":{lead:"당신은 즐기는 챔프와 새 챔프 사이 균형이 좋은 사람입니다.",body:"손에 익은 픽만 고집하지도, 무작정 새것만 찾지도 않습니다. 익숙함과 도전을 적절히 섞어 가며 폭을 유지합니다. 그 균형이 당신을 어느 조합에도 흔들리지 않게 합니다."},
    "장비와 선택을 타는 방식":{lead:"당신은 상황에 맞춰 선택을 유연하게 가져가는 사람입니다.",body:"한 가지 빌드에 묶이지 않고 그날의 판에 맞춰 길을 고릅니다. 공격이 필요하면 공격으로, 버팀이 필요하면 버팀으로 갑니다. 그 유연함이 당신의 선택을 늘 합리적으로 만듭니다."},
    "최근 흐름":{lead:"당신의 최근 흐름은 여태 해 온 그대로 한결같습니다.",body:"요즘이라고 특별히 오르지도 식지도 않은 안정적인 상태입니다. 들쭉날쭉 없이 늘 제 몫을 해내는 사람입니다. 그 한결같음이야말로 믿을 수 있는 강점입니다."},
    "포로의 결론":{lead:"결국 당신은 빈틈을 메우는 균형형입니다.",body:"어느 한 축이 튀기보다 모든 면이 고르게 맞물려 있습니다. 한 색에 갇히지 않고 판이 필요로 하는 자리를 채우는 게 당신의 색입니다. 그 균형 감각을 자랑으로 삼아도 좋습니다."}
  };
  // 장당 4변형. reader 이름+장 제목 안정 해시로 고른다(Math.random 금지 — 같은 사람은 늘 같은 풀이).
  var BALANCED_PROSE_VARIANTS={
    "전투 본능":[
      {lead:"당신은 어느 한쪽에 치우치지 않고 상황에 맞춰 싸우는 사람입니다.",body:"공격이 필요하면 앞장서고 버팀이 필요하면 자리를 지킵니다. 그날의 판이 무엇을 원하는지 읽고 거기에 맞춰 무기를 바꿉니다. 한 색에 갇히지 않는 그 유연함이 당신의 색입니다."},
      {lead:"당신은 정해진 싸움법이 없는 사람입니다.",body:"어떤 판에서는 앞에 서고 어떤 판에서는 뒤를 봅니다. 남들은 자기 방식이 있는데 당신은 판의 방식을 따릅니다. 그래서 당신을 상대해 본 사람도 다음 판의 당신은 예측하지 못합니다."},
      {lead:"당신의 싸움엔 모난 데가 없습니다.",body:"딜이든 버팀이든 어느 하나를 특별히 앞세우지 않고 필요한 만큼만 씁니다. 튀지 않는다는 건 무너질 구석도 없다는 뜻입니다. 어느 자리에 앉혀 놔도 제 몫을 하는 손입니다."},
      {lead:"당신은 판을 보고 나서 무기를 고르는 사람입니다.",body:"먼저 정해 놓고 들어가는 게 아니라, 열린 판을 읽고 그때 정합니다. 한 박자 늦게 정하는 대신 틀리는 법이 드뭅니다. 그 신중함이 당신을 오래 살아남게 합니다."}
    ],
    "손해를 본 뒤의 버릇":[
      {lead:"당신은 손해를 봐도 크게 흔들리지 않는 사람입니다.",body:"밀려도 무리하게 만회하려 들지 않고, 그렇다고 위축되지도 않습니다. 손해를 담담히 받아들이고 제 페이스를 그대로 지킵니다. 그 균형 감각이 판을 길게 끌고 가는 힘입니다."},
      {lead:"당신은 한 번 밀렸다고 판을 놓는 사람이 아닙니다.",body:"손해가 나도 얼굴색이 크게 변하지 않습니다. 다음 수를 조급하게 찾지 않으니 두 번째 손해로 이어지는 일이 적습니다. 지고 있어도 무너지지 않는 사람이 결국 뒤집습니다."},
      {lead:"당신에게 손해는 그냥 지나가는 한 장면입니다.",body:"되갚으러 달려가지도, 겁을 먹고 물러나지도 않습니다. 방금 일을 마음에 오래 담지 않는 그 담백함이 다음 교전의 판단을 깨끗하게 지켜 줍니다."},
      {lead:"당신은 밀린 뒤에도 하던 대로 하는 사람입니다.",body:"손해를 봤다고 갑자기 다른 사람이 되지 않습니다. 흔들리지 않는 그 일관됨 덕에 팀도 당신을 기준 삼아 다시 자리를 잡습니다. 판이 무너지려 할 때 그 값이 제일 큽니다."}
    ],
    "싸움이 열리기 전":[
      {lead:"당신은 열고 받는 타이밍을 상황 따라 고르는 사람입니다.",body:"먼저 시동을 걸어야 할 때와 합류해야 할 때를 그때그때 읽습니다. 한 가지 방식에 갇히지 않으니 상대가 당신의 패턴을 잡기 어렵습니다. 상황을 읽는 그 눈이 당신의 무기입니다."},
      {lead:"당신은 먼저 열지도, 마냥 기다리지도 않는 사람입니다.",body:"교전 직전의 그 짧은 정적에서 당신은 판을 한 번 훑습니다. 열 만하면 열고 아니면 접는 그 판단이 헛싸움을 크게 줄여 줍니다. 안 여는 것도 하나의 수라는 걸 아는 사람입니다."},
      {lead:"당신의 시작 신호는 매번 다릅니다.",body:"어떤 날은 당신이 첫 발을 떼고, 어떤 날은 남이 뗀 발에 가장 먼저 붙습니다. 정해진 역할이 없으니 상대가 당신을 기준으로 계산을 세우지 못합니다."},
      {lead:"당신은 싸움이 열리는 순간을 기다릴 줄 아는 사람입니다.",body:"급하게 먼저 들어가 판을 그르치는 일이 드뭅니다. 열려야 할 때 열린다는 걸 알기에 조급해하지 않습니다. 그 여유가 교전의 첫 박자를 정확하게 만듭니다."}
    ],
    "들어갈 때와 빠질 때":[
      {lead:"당신은 들어가고 빠지는 균형이 무난한 사람입니다.",body:"과하게 깊이 들어가지도, 너무 일찍 빠지지도 않습니다. 위험과 이득을 저울질해 적당한 선을 지킵니다. 그 무난한 균형이 헛된 손해를 줄여 줍니다."},
      {lead:"당신은 발을 뺄 자리를 알고 들어가는 사람입니다.",body:"들어가기 전에 나올 길을 먼저 봐 둡니다. 그래서 무모하게 갇히는 일이 드물고, 살아 나온 만큼 다음 교전에 다시 섭니다. 죽지 않는 것도 실력입니다."},
      {lead:"당신의 거리 감각엔 큰 사고가 없습니다.",body:"한 발 더 욕심내다 무너지는 일도, 겁내다 기회를 흘리는 일도 잘 없습니다. 재미없어 보여도 이 균형이 승패를 가르는 자리에서 제일 크게 값을 합니다."},
      {lead:"당신은 위험을 재고 움직이는 사람입니다.",body:"들어갈 이유가 분명할 때만 들어가고, 아니면 미련 없이 물러납니다. 그 계산이 몸에 배어 있어 판을 통째로 내주는 실수가 거의 없습니다."}
    ],
    "아군과 맞물리는 방식":[
      {lead:"당신은 팀 상황에 맞춰 역할을 유연하게 잡는 사람입니다.",body:"챙겨야 할 날엔 동료를 챙기고, 앞서야 할 날엔 앞섭니다. 정해진 역할에 묶이지 않고 비어 있는 자리를 채워 갑니다. 그 유연함이 팀의 빈틈을 메웁니다."},
      {lead:"당신은 팀이 비워 둔 자리를 먼저 보는 사람입니다.",body:"내가 뭘 할지보다 팀에 뭐가 없는지를 먼저 읽습니다. 그래서 어떤 조합에 섞여도 톱니처럼 맞물려 돌아갑니다. 같이 하는 사람이 편한 유형입니다."},
      {lead:"당신은 조합을 가리지 않는 사람입니다.",body:"좋은 팀을 만나야만 잘하는 게 아니라, 어떤 팀이든 그 팀에 맞춰 갑니다. 고르게 맞물리니 무작위로 짜이는 판에서 특히 값이 큽니다."},
      {lead:"당신은 앞뒤 어느 자리든 설 수 있는 사람입니다.",body:"앞이 비면 앞에 서고 뒤가 비면 뒤를 봅니다. 한 자리만 고집하지 않으니 팀의 모양이 당신 덕에 완성됩니다. 티는 안 나도 빠지면 바로 표가 나는 역할입니다."},
      // 이 장은 축(support/crowd)이 휴면이라 전원이 균형 뱅크를 탄다 → 변형을 8개로 늘려 겹침을 절반으로(2026-08-31).
      {lead:"당신은 남이 하는 걸 보고 자기 몫을 정하는 사람입니다.",body:"먼저 깃발을 꽂기보다 판이 흘러가는 모양을 보고 빈 데로 들어갑니다. 욕심내 겹치는 일이 없으니 팀의 힘이 흩어지지 않습니다. 같이 하면 편한 사람이라는 말을 들을 겁니다."},
      {lead:"당신은 팀을 고르지 않는 사람입니다.",body:"잘 맞는 동료를 만나야 사는 게 아니라, 만난 동료에 맞춰 삽니다. 무작위로 다섯이 묶이는 판에서 이건 그냥 재주가 아니라 승률입니다."},
      {lead:"당신은 팀의 모양을 완성하는 마지막 조각입니다.",body:"혼자 판을 끌지는 않지만 당신이 빠지면 어딘가 어긋납니다. 눈에 잘 안 띄는 자리를 말없이 채우는 사람이 사실 제일 아쉽습니다."},
      {lead:"당신은 조합에 자기를 맞출 줄 아는 사람입니다.",body:"내가 뭘 하고 싶은지보다 이 판에 뭐가 필요한지를 먼저 셉니다. 고집을 접을 줄 아는 그 판단이 다섯 명을 한 덩어리로 만듭니다."}
    ],
    "상대가 불편해지는 자리":[
      {lead:"당신은 한 가지 수가 아니라 여러 방식으로 상대를 흔드는 사람입니다.",body:"화력으로 누르기도, 자리로 막기도, 타이밍으로 흔들기도 합니다. 정해진 패턴이 없으니 상대는 당신을 읽기가 어렵습니다. 그 예측 불가함이 당신을 까다로운 상대로 만듭니다."},
      {lead:"상대는 당신을 어떻게 막아야 할지 정하기 어렵습니다.",body:"한쪽을 잠그면 다른 쪽으로 옵니다. 뚜렷한 약점이 없다는 건 파고들 틈도 없다는 뜻입니다. 상대 입장에선 계산이 서지 않는 상대가 제일 성가십니다."},
      {lead:"당신은 매 판 다른 방식으로 성가신 사람입니다.",body:"어제 통했던 대응이 오늘은 안 통합니다. 당신이 스스로 바꾸는 게 아니라 판에 맞추다 보니 그렇게 됩니다. 읽히지 않는 상대만큼 불편한 것도 없습니다."},
      {lead:"당신을 상대하려면 여러 가지를 동시에 신경 써야 합니다.",body:"어느 하나만 막아서는 답이 안 나옵니다. 고르게 갖춘 사람은 봉쇄가 아니라 감당의 대상이 됩니다. 그 자체가 상대에게는 부담입니다."}
    ],
    "잘 풀리는 날의 얼굴":[
      {lead:"잘 풀리는 날의 당신은 어느 면에서나 고르게 좋아집니다.",body:"한쪽이 튀는 게 아니라 전체가 매끄럽게 맞물려 돌아갑니다. 화력도 버팀도 판단도 한 박자씩 더 정확해집니다. 빈틈없이 고른 그 모습이 당신의 좋은 날입니다."},
      {lead:"잘 풀리는 날의 당신은 뭘 해도 반 박자씩 잘 맞습니다.",body:"손도 자리도 타이밍도 조금씩 좋아져서 합이 크게 납니다. 특정 장면이 터진다기보다 판 전체가 부드럽게 흘러갑니다. 그런 날은 이겼는지도 모르게 이겨 있습니다."},
      {lead:"당신의 좋은 날은 '사고가 없다'로 옵니다.",body:"화려한 장면 대신 실수 없는 운영으로 이깁니다. 재미없어 보여도 이런 승리가 가장 다시 만들기 쉽습니다. 당신은 운보다 습관으로 이기는 쪽입니다."},
      {lead:"잘 풀리는 날의 당신은 조용히 강합니다.",body:"눈에 띄는 한 방보다 어긋나는 데 없이 굴러가는 판을 만듭니다. 팀이 당신 덕을 봤다는 걸 나중에야 아는 유형입니다. 그런 이김이 쌓이면 실력이라 부릅니다."}
    ],
    "안 풀리는 날의 새는 곳":[
      {lead:"안 풀리는 날에도 당신은 큰 구멍 없이 버티는 편입니다.",body:"치명적인 실수로 판을 통째로 내주는 일이 드뭅니다. 흐름이 나빠도 무난하게 마무리하며 손해를 최소로 줄입니다. 그 안정감이 안 풀리는 날의 버팀목이 됩니다."},
      {lead:"당신은 지는 판도 무너져서 지지는 않습니다.",body:"안 풀리는 날이라고 유독 새는 구멍이 보이진 않습니다. 아슬아슬하게 지는 판이 많다는 건 뒤집을 거리가 가까웠다는 뜻입니다. 그 차이가 다음 판의 회복을 빠르게 합니다."},
      {lead:"나쁜 날에도 당신의 습관은 크게 흐트러지지 않습니다.",body:"흐름이 나빠도 판단 자체는 평소와 비슷하게 굴러갑니다. 그래서 연패가 길게 이어지는 일이 드뭅니다. 무너지지 않는 사람에게 나쁜 날은 그냥 하루입니다."},
      {lead:"당신은 안 풀릴수록 조용해지는 쪽입니다.",body:"판이 어그러져도 무리수로 뒤집으려 들지 않습니다. 손해를 키우지 않고 접을 줄 아는 그 절제가 사실 제일 어려운 재주입니다."}
    ],
    "픽을 고르는 손":[
      {lead:"당신은 즐기는 챔프와 새 챔프 사이 균형이 좋은 사람입니다.",body:"손에 익은 픽만 고집하지도, 무작정 새것만 찾지도 않습니다. 익숙함과 도전을 적절히 섞어 가며 폭을 유지합니다. 그 균형이 당신을 어느 조합에도 흔들리지 않게 합니다."},
      {lead:"당신의 손엔 믿는 픽과 시도하는 픽이 반씩 있습니다.",body:"정든 얼굴의 안정감과 낯선 얼굴의 재미를 다 챙기는 쪽입니다. 어느 한쪽에 갇히지 않았으니 무엇이 걸려도 크게 당황하지 않습니다."},
      {lead:"당신은 픽 운에 크게 좌우되지 않는 사람입니다.",body:"좋아하는 게 떠야 잘하는 게 아니라, 뜬 것으로 답을 만듭니다. 무작위로 던져지는 판에서 이만한 재주가 없습니다."},
      {lead:"당신의 손은 넓지도 좁지도 않게, 딱 쓸 만큼입니다.",body:"쓸 줄 아는 픽을 중심에 두고 필요하면 그때그때 폭을 넓힙니다. 모험과 안정 사이의 그 감각이 욕심 없이 정확합니다."},
      // 폭이 중간대면 전원이 여기로 온다 → 8변형(2026-08-31).
      {lead:"당신은 뜬 걸로 답을 만드는 사람입니다.",body:"고르고 싶은 걸 고를 수 없는 판에서, 당신은 불평 대신 방법을 찾습니다. 낯선 픽이 걸려도 한 판 버리는 법이 없습니다. 그 태도가 결국 폭이 됩니다."},
      {lead:"당신의 챔프 창은 조용히 넓어지는 중입니다.",body:"한 번에 확 늘리진 않지만 쓸 만한 얼굴을 하나씩 늘려 갑니다. 급하지 않게 쌓은 폭이라 손에 오래 남습니다."},
      {lead:"당신은 손에 붙은 픽을 버리지 않는 사람입니다.",body:"새것을 기웃거리면서도 믿는 몇은 늘 데리고 다닙니다. 돌아갈 자리가 있으니 실험이 겁나지 않습니다. 그 안전판이 당신을 과감하게 만듭니다."},
      {lead:"당신의 픽엔 유행이 잘 안 묻습니다.",body:"남들이 몰리는 픽이라고 따라가지도, 일부러 피하지도 않습니다. 쓸 만하면 쓰고 아니면 마는 담백한 손입니다."}
    ],
    "장비와 선택을 타는 방식":[
      {lead:"당신은 상황에 맞춰 선택을 유연하게 가져가는 사람입니다.",body:"한 가지 빌드에 묶이지 않고 그날의 판에 맞춰 길을 고릅니다. 공격이 필요하면 공격으로, 버팀이 필요하면 버팀으로 갑니다. 그 유연함이 당신의 선택을 늘 합리적으로 만듭니다."},
      {lead:"당신의 선택엔 극단이 없습니다.",body:"한쪽으로 몰아 도박을 걸지 않습니다. 판을 보고 고르는 습관이 몸에 배어 있어, 어느 구간에서도 크게 손해 보는 선택이 나오지 않습니다."},
      {lead:"당신은 정해 놓고 가지 않는 사람입니다.",body:"들어가기 전에 답을 굳히기보다 판이 알려 주는 대로 맞춰 갑니다. 늦게 정하는 대신 틀리는 법이 드뭅니다. 그게 당신 선택이 늘 말이 되는 이유입니다."},
      {lead:"당신의 성장 곡선은 평균 궤도에 잘 붙어 있습니다.",body:"서두르지도 처지지도 않습니다. 특정 타이밍에 전부를 걸지 않으니 초반이든 후반이든 제 몫을 합니다. 어느 구간에서도 계산이 서는 사람입니다."}
    ],
    "최근 흐름":[
      {lead:"당신의 최근 흐름은 여태 해 온 그대로 한결같습니다.",body:"요즘이라고 특별히 오르지도 식지도 않은 안정적인 상태입니다. 들쭉날쭉 없이 늘 제 몫을 해내는 사람입니다. 그 한결같음이야말로 믿을 수 있는 강점입니다."},
      {lead:"요즘의 당신은 평소의 당신과 다르지 않습니다.",body:"위로도 아래로도 크게 치우치지 않은 구간을 지나고 있습니다. 컨디션에 휘둘리지 않는다는 건 언제 앉혀 놔도 같은 값을 한다는 뜻입니다."},
      {lead:"당신의 페이스는 요즘도 흔들림이 없습니다.",body:"좋은 날도 나쁜 날도 큰 진폭 없이 이어집니다. 기복이 적은 사람은 당장 눈에 안 띄어도 길게 보면 가장 앞서 갑니다."},
      {lead:"당신은 지금 제 속도로 가고 있습니다.",body:"무리해서 끌어올린 구간도, 주저앉은 구간도 아닙니다. 이럴 때는 뭘 바꾸기보다 하던 대로 쌓는 게 제일 낫습니다."},
      // 최근 기세가 중간대면 전원이 여기로 온다 → 8변형(2026-08-31).
      {lead:"요즘 당신에겐 특별한 바람이 불지 않습니다.",body:"올라탈 상승세도, 견뎌야 할 내리막도 아닙니다. 이런 구간이 사실 제일 길고, 여기서 쌓아 둔 것이 나중에 값을 합니다."},
      {lead:"당신의 손은 요즘도 어제와 같은 무게입니다.",body:"컨디션을 타지 않는다는 건 재능보다 습관에 기대고 있다는 뜻입니다. 습관은 배신을 잘 안 합니다."},
      {lead:"당신은 오르내림으로 설명되는 사람이 아닙니다.",body:"잘 될 때와 안 될 때의 간격이 좁습니다. 최고점이 낮아 보일 수 있어도, 최저점이 높다는 게 훨씬 강한 무기입니다."},
      {lead:"지금은 판을 늘려도 되는 시기입니다.",body:"흐름이 어느 쪽으로도 기울지 않았으니 무리할 이유도, 몸을 사릴 이유도 없습니다. 평소 하던 대로 한 판씩 가면 됩니다."}
    ],
    "포로의 결론":[
      {lead:"결국 당신은 빈틈을 메우는 균형형입니다.",body:"어느 한 축이 튀기보다 모든 면이 고르게 맞물려 있습니다. 한 색에 갇히지 않고 판이 필요로 하는 자리를 채우는 게 당신의 색입니다. 그 균형 감각을 자랑으로 삼아도 좋습니다."},
      {lead:"결국 당신의 무기는 '못 하는 게 없다'는 겁니다.",body:"튀는 축이 없다는 건 파고들 구멍도 없다는 뜻입니다. 어떤 팀, 어떤 판에 넣어도 돌아가는 사람은 생각보다 흔하지 않습니다."},
      {lead:"결국 당신은 판에 맞춰 얼굴을 바꾸는 사람입니다.",body:"고정된 색 대신 그때그때 맞는 답을 고르는 것이 당신의 색입니다. 정체가 없는 게 아니라, 그 유연함이 정체입니다. 믿고 가면 됩니다."},
      {lead:"결국 당신은 어디에 놓아도 굴러가는 사람입니다.",body:"한 가지로 기억되진 않겠지만, 빠지면 바로 표가 나는 쪽입니다. 화려한 재주보다 이런 사람이 팀을 오래 버티게 합니다."}
    ]
  };
  function fortuneStableHash(str){var h=0,s=String(str==null?"":str);for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}
  function fortuneStableBalancedProse(title,reader){var v=BALANCED_PROSE_VARIANTS[title];if(v&&v.length)return v[fortuneStableHash((reader||"")+"|"+title)%v.length];return BALANCED_PROSE[title];}
  var FORTUNE_CHAPTER_ORDER=["전투 본능","손해를 본 뒤의 버릇","싸움이 열리기 전","들어갈 때와 빠질 때","아군과 맞물리는 방식","상대가 불편해지는 자리","잘 풀리는 날의 얼굴","안 풀리는 날의 새는 곳","픽을 고르는 손","장비와 선택을 타는 방식","최근 흐름","포로의 결론"];
  function fortuneIntensify(base,strength){return base[strength==="강"?"strong":strength==="뚜렷"?"clear":"mild"];} // 레거시 시그니처 보존(외부 호출 없음)
  // 비교 불가 축의 사실 서술 — 그 모드에 모집단 분위표가 없을 때(증강의 챔프 폭·최근 기세) 쓴다.
  //   백분위 없이 실측 수치만 말한다: 지어내지 않고, 그렇다고 정보를 숨기지도 않는다.
  function fortuneUncomparedFact(title,a){
    if(title==="픽을 고르는 손"&&a&&a.breadthScore!=null){
      // 2026-08-31: 옛 문장은 "이 모드는 사람별 비교 기준이 아직 없어, 순위 대신 실측값만 둡니다"로 끝났다.
      //   집계 사정을 손님에게 설명하는 소리 = 점집에서 할 말이 아니고 읽는 사람이 알 필요도 없다(사용자 신고).
      //   수치는 칩에만 남기고, 본문은 손의 성향만 말한다. 폭 자체로 갈라 3분기(넓음/중간/좁음).
      var bv=fortuneValText("breadth",a.breadthScore),n=Math.round(+a.champCount||0),bs=+a.breadthScore||0;
      var pool=n?("여태 손에 쥐어 본 챔프만 "+n+"종입니다. "):"";
      if(bs>=11)return {chip:"15판당 "+bv,lead:"당신의 손은 한 자리에 머물지 않습니다.",
        body:pool+"열 판을 하면 열 판이 다른 얼굴입니다. 낯선 픽이 떠도 당황하는 법이 없고, 오히려 처음 잡는 손맛을 즐기는 쪽입니다. 무엇이 걸려도 할 줄 안다는 건 생각보다 드문 재주입니다."};
      if(bs>=7)return {chip:"15판당 "+bv,lead:"당신의 손엔 익숙한 자리와 새 자리가 반씩 있습니다.",
        body:pool+"믿는 픽 몇을 축으로 두고, 나머지는 그날 판에 맡깁니다. 고집도 없고 휩쓸리지도 않는 손이라 어떤 조합에 떨어져도 제 몫을 찾아냅니다. 재미와 승산을 같이 챙기는 영리한 균형입니다."};
      return {chip:"15판당 "+bv,lead:"당신의 손은 아는 자리로 돌아옵니다.",
        body:pool+"이것저것 건드리기보다 손에 붙은 몇을 깊게 팝니다. 그래서 그 픽이 걸린 판은 남들보다 한 수 앞을 봅니다. 넓게 아는 것보다 깊게 아는 게 이기는 판이 분명히 있고, 당신은 그 판을 노리는 사람입니다."};
    }
    if(title==="최근 흐름"&&a&&a.recentN>=5&&a.recentRate!=null&&a.winRate!=null){
      var d=Math.round(a.recentRate-a.winRate);
      // 수치는 칩으로 빼고 본문은 흐름 이야기만 — 승률 몇 %p 를 본문에서 읊는 건 점집 말이 아니다(2026-08-31).
      if(d>=5)return {chip:"최근 +"+d+"%p",lead:"지금 당신의 손엔 물이 올라 있습니다.",
        body:"같은 판을 놓고도 요즘은 답이 먼저 보일 겁니다. 이런 시기는 길지 않으니 아끼지 말고 밀어붙이는 게 맞습니다. 잘 풀릴 때 크게 벌어 두는 사람이 결국 앞서 갑니다."};
      if(d<=-5)return {chip:"최근 "+d+"%p",lead:"지금은 숨을 고를 자리입니다.",
        body:"실력이 어디 간 게 아니라 흐름이 잠깐 등을 돌린 겁니다. 이럴 때 판수로 밀어붙이면 더 깊이 빠집니다. 한 판 지면 한 판 쉬어 가는 게 가장 빠른 회복입니다."};
      return {chip:"최근 "+(d>=0?"+":"")+d+"%p",lead:"당신의 흐름은 지금 평소 그대로입니다.",
        body:"위로도 아래로도 크게 흔들리지 않고 제 페이스를 지키고 있습니다. 오르내림이 적다는 건 어느 날 앉혀 놔도 같은 값을 한다는 뜻입니다. 기복 없는 손이 길게 보면 제일 무섭습니다."};
    }
    return null;
  }
  function fortuneChapterCtx(x,a){
    return {v:x.value,pct:x.pct,median:x.median,measured:!!x.measured,dir:x.dir,strength:x.strength,
      adv:x.strength==="강"?"확실히":x.strength==="뚜렷"?"제법":"조금",
      rank:fortuneRankText(x),val:fortuneValText(x.key,x.value),mval:fortuneValText(x.key,x.median),
      basisNoun:fortuneBasisNoun(a)};
  }
  function fortuneChapters(a){
    var allZ=a.allZ||[];
    var distinctAxes=a.distinct||[],isBalanced=!!a.balanced,reader=a.reader||"";
    return FORTUNE_CHAPTER_ORDER.map(function(title){
      // "포로의 결론"만 헤드라인과 같은 근거(개인 #1 두드러진 축)를 직접 참조 → 결론=헤드라인 일치.
      var lead=(title==="포로의 결론")?(isBalanced?null:(distinctAxes[0]||null)):fortuneChapterLead(title,allZ);
      // ★장 게이트(v2): 그 장의 주도축이 중간대(모드별 chapter 컷 안)면 단정하지 않고 균형 문장으로.
      //   비특징 축이 "한참 위/아래" 단정 템플릿을 타던 과장(실측과 어긋남)을 막는다.
      var cuts=fortuneCuts(a&&a.fortuneBasis&&a.fortuneBasis.basis);
      if(lead&&lead.pct!=null&&lead.pct<cuts.chapter&&lead.pct>(100-cuts.chapter))lead=null;
      if(!lead){
        // 비교 모집단이 없는 축(증강 모드의 챔프 폭·최근 기세)은 백분위를 지어내는 대신 **실측 사실**을 그대로 말한다.
        var fact=fortuneUncomparedFact(title,a);
        if(fact)return {title:title,axisLabel:fact.chip,dir:null,lead:fact.lead,body:fact.body};
        var b=fortuneStableBalancedProse(title,reader);return {title:title,axisLabel:null,dir:null,lead:b.lead,body:b.body};
      }
      var dir=lead.dir||(lead.pct!=null?(lead.pct>=50?"hi":"lo"):(lead.z>=0?"hi":"lo"));
      var withDir={key:lead.key,value:lead.value,pct:lead.pct,median:lead.median,measured:lead.measured,dir:dir,
        strength:lead.strength||fortuneStrengthOf(lead.pct,cuts)};
      var bank=(PROSE_BANK[title]||{})[lead.key];
      // 뱅크에서 문장 고르기. v1 형태(강도 3단계 객체 strong/clear/mild)와 v2 형태(함수) 둘 다 받는다.
      //   새 최상위 심볼을 만들지 않고 여기서 인라인으로 처리한다 — 회귀 하네스가 심볼 화이트리스트로
      //   코어를 뽑아 가므로, 헬퍼 함수를 새로 만들면 이식은 되도 회귀에서 not defined 로 터진다(2026-08-31 실측).
      var node=bank&&bank[dir],text=null;
      if(typeof node==="function")text=node(fortuneChapterCtx(withDir,a));
      else if(node){var slot=withDir.strength==="강"?"strong":withDir.strength==="뚜렷"?"clear":"mild";text=node[slot]||node.clear||node.mild||node.strong;}
      if(!text||!text.lead)text=fortuneStableBalancedProse(title,reader);
      var meta=FORTUNE_AXIS_META[lead.key];
      var chip=fortuneAxisChipRanked(withDir)||(meta?(meta.label+" "+(dir==="hi"?"高":"낮음")):null);
      return {title:title,axisLabel:chip,dir:dir,lead:text.lead,body:text.body};
    });
  }

  // ── 닫는 말 ─────────────────────────────────────────────────────────
  var FORTUNE_CLOSING={
    firepower:{hi:"그 화력이면 충분합니다. 조금 더 과감해져도 됩니다.",lo:"딜이 전부가 아닙니다. 당신 방식대로 판을 끄는 게 더 당신답습니다."},
    durability:{hi:"당신이 버틴 자리에서 승부가 갈립니다. 그 단단함을 믿으면 됩니다.",lo:"살아남아 일하는 것도 강함입니다. 그 영리함을 믿으면 됩니다."},
    economy:{hi:"시간은 당신 편입니다. 조급해하지 않아도 됩니다.",lo:"초반의 속도가 당신의 색입니다. 먼저 굴려서 기세를 잡으면 됩니다."},
    aggression:{hi:"먼저 들어가는 용기가 당신의 무기입니다. 나올 때만 한 발 아끼면 됩니다.",lo:"받아치는 정확함이 당신의 무기입니다. 확실한 각에선 먼저 가도 됩니다."},
    momentum:{hi:"지금 흐름이 좋습니다. 믿고 한 판 더 이어 가면 됩니다.",lo:"잠깐 식었을 뿐 기량은 그대로입니다. 한 판씩 되찾으면 됩니다."},
    loyalty:{hi:"정든 픽 하나로도 충분합니다. 그 깊이를 밀고 가면 됩니다.",lo:"무엇이든 쥐는 손이 당신의 자랑입니다. 폭을 즐기면 됩니다."},
    breadth:{hi:"넓은 폭이 당신의 무기입니다. 어떤 판에도 답이 있습니다.",lo:"좁고 깊게 판 그 챔프가 당신의 이름이 됩니다."},
    support:{hi:"되살리는 힘이 당신의 무기입니다. 그 지속력을 믿으면 됩니다.",lo:"회복에 기대지 않고 버티는 게 당신의 방식입니다."},
    crowd:{hi:"묶어 두는 시간이 당신의 무기입니다. 그 타이밍을 믿으면 됩니다.",lo:"묶기 말고도 판을 푸는 길을 아는 사람입니다."},
    balanced:{hi:"치우침 없는 균형이 당신의 색입니다. 어떤 판에서도 제 몫을 합니다.",lo:"치우침 없는 균형이 당신의 색입니다. 어떤 판에서도 제 몫을 합니다."}
  };
  function fortuneClosingLine(distinct){
    if(distinct.balanced||!distinct.axes.length)return FORTUNE_CLOSING.balanced.hi;
    var a1=distinct.axes[0];
    return (FORTUNE_CLOSING[a1.key]||FORTUNE_CLOSING.balanced)[a1.dir];
  }

  // ── 레이더 점수 = 백분위 그대로(실측이 곧 모양). pct 없으면 50. ──
  function fortuneRadarScore(x){
    if(!x||x.pct==null)return 50;
    return Math.max(4,Math.min(96,Math.round(x.pct)));
  }
  // 레이더 6축 행(제품 공용): a.allZ의 백분위를 점수로. name/label 동봉(양 제품 렌더러 호환).
  function fortuneStatScores(a){
    var pMap={},all=a.allZ||[],out=[];
    for(var i=0;i<all.length;i++)pMap[all[i].key]=all[i];
    for(var j=0;j<FORTUNE_RADAR_AXES.length;j++){
      var ax=FORTUNE_RADAR_AXES[j],x=pMap[ax.key];
      if(!x||x.pct==null)continue; // 그 모드에서 못 재는 축은 그리지 않는다(50점으로 채우면 없는 데이터를 지어내는 것)
      out.push({key:ax.key,name:ax.label,label:ax.label,tip:ax.tip,score:fortuneRadarScore(x)});
    }
    return out;
  }

  // ── 상단 3장 카드(오늘 흐름 · 포로가 본 특징 · 한 줄 조언) ─────────────────
  //   ⚠️ 2026-08-29 재설계: 옛 판정은 판수에 의존하는 고정 임계값이라 거의 모두에게 같은 카드가 떴다.
  //      실측: "얼굴 분산"(대표픽 비중 ≤10%)이 전체 66.8%, **150판 이상은 99.6%** — 칼바람은 랜덤픽이라
  //      판수가 늘면 최다 챔프 비중이 자연히 내려가기 때문. 챔프 폭 산식과 같은 종류의 결함이었다.
  //   새 판정은 **그 사람의 실측 축 프로필 모양**으로 간다: 어느 축이 솟고 어느 축이 낮은지, 얼마나 뾰족한지.
  //   축 조합이 라벨·본문에 들어가므로 사람마다 갈린다(8축 × 방향 조합).
  var FORTUNE_ADVICE={
    firepower:{hi:{k:"한 발의 거리",t:"화력이 무기인 만큼 거리 관리가 곧 승률입니다. 끝내러 들어가는 한 걸음을 아끼면 그 화력이 더 오래 살아 있습니다."},
               lo:{k:"내 몫의 자리",t:"딜로 승부하는 사람이 아니니 화력 순위에 흔들릴 필요가 없습니다. 대신 내가 서 있어야 할 자리를 먼저 정하면 판이 편해집니다."}},
    durability:{hi:{k:"버틴 뒤의 한 수",t:"앞에서 받아내는 건 이미 충분합니다. 버틴 다음에 팀이 들어올 시간을 벌어 주는 한 수까지 챙기면 그 몸값이 배가 됩니다."},
                lo:{k:"맞지 않는 각",t:"덜 맞고 오래 사는 게 당신 방식입니다. 위험한 각에서는 한 걸음 더 물러서도 손해가 아닙니다."}},
    economy:{hi:{k:"버는 시간",t:"시간이 갈수록 강해지는 형이니 초반엔 최소한의 문만 닫아 두면 됩니다. 버티는 것과 밀리는 건 다릅니다."},
             lo:{k:"초반의 속도",t:"장비를 기다리기보다 먼저 굴려서 이기는 형입니다. 초반에 잡은 것을 후반까지 끌고 갈 그림을 미리 그려 두세요."}},
    aggression:{hi:{k:"두 번째 진입",t:"먼저 들어가는 기질은 그대로 두고, 한 번 연 뒤 아군이 따라오는지부터 보세요. 손해는 두 번째 진입에서 납니다."},
                lo:{k:"확실한 각",t:"받아치는 정확함이 강점입니다. 다만 확실한 각에서는 반 박자 먼저 가도 손해가 없습니다."}},
    support:{hi:{k:"한 명 선택",t:"살리는 손이 좋습니다. 모두를 살리기보다 이번 한타에서 값이 가장 큰 한 명을 고르는 눈이 핵심입니다."},
             lo:{k:"버티는 법",t:"회복에 기대지 않는 형이라 애초에 덜 맞는 자리 선정이 곧 생존입니다. 위치를 한 번 더 보는 습관이 값을 합니다."}},
    crowd:{hi:{k:"묶는 타이밍",t:"묶는 시간이 깁니다. 먼저 거는 것보다 팀 화력이 준비된 순간에 거는 게 그 시간을 이득으로 바꿉니다."},
           lo:{k:"내 방식의 압박",t:"묶어서 푸는 형이 아니니 억지로 각을 만들 필요가 없습니다. 화력이든 자리든 내가 잘하는 압박으로 가면 됩니다."}},
    breadth:{hi:{k:"오늘의 역할",t:"무엇이 나와도 소화하는 손입니다. 첫 한타에서 오늘 설 자리를 빨리 정할수록 그 폭이 강점이 됩니다."},
             lo:{k:"익숙함의 값",t:"손에 익은 픽이 분명합니다. 그 픽이 안 나온 판에서 무엇을 할지만 미리 정해 두면 기복이 줄어듭니다."}},
    momentum:{hi:{k:"기세의 관리",t:"지금 흐름이 좋습니다. 잘 나갈 때일수록 한 발을 아껴 두면 이 기세가 더 오래갑니다."},
              lo:{k:"한 판의 간격",t:"잠깐 식은 구간입니다. 진 직후 바로 다음 판을 잡기보다 한 호흡 두면 원래 페이스가 빨리 돌아옵니다."}}
  };
  function fortuneSignalCards(a){
    var zs=(a&&a.allZ||[]).filter(function(x){return x&&x.pct!=null;});
    var cards=[];
    // ① 오늘 흐름 — 최근 폼(절대값). 백분위가 있으면 순위까지.
    var recentN=+a.recentN||0,delta=(a.recentRate!=null&&a.winRate!=null)?Math.round(a.recentRate-a.winRate):0;
    var mz=null; for(var i=0;i<zs.length;i++)if(zs[i].key==="momentum")mz=zs[i];
    if(recentN>=5){
      var flowV=delta>=12?"상승운":delta<=-12?"조정운":delta>=5?"살짝 오름":delta<=-5?"살짝 식음":"반반운";
      var flowB=(delta>=5?("최근 "+recentN+"판 승률이 평소보다 "+delta+"%p 높습니다. "):(delta<=-5?("최근 "+recentN+"판 승률이 평소보다 "+Math.abs(delta)+"%p 낮습니다. "):("최근 "+recentN+"판 승률이 평소와 "+Math.abs(delta)+"%p 차이로 거의 같습니다. ")))
        +(mz&&mz.measured?("상승 폭으로는 "+fortuneRankText(mz)+"입니다."):(delta>=5?"손이 맞아 들어가는 구간입니다.":delta<=-5?"기량이 아니라 흐름이 식은 구간입니다.":"컨디션에 크게 휘둘리지 않는 편입니다."));
      cards.push({key:"오늘 흐름",val:flowV,body:flowB});
    }else cards.push({key:"오늘 흐름",val:"표본 부족",body:"최근 판이 적어 흐름은 아직 말하지 않습니다. 몇 판 더 쌓이면 여기에 최근 승률과 평소의 차이가 들어갑니다."});
    // ② 포로가 본 특징 — 축 프로필의 모양(어디가 솟고 어디가 꺼졌나). 판수에 의존하지 않는다.
    if(zs.length>=3){
      var hi=zs[0],lo=zs[0];
      for(var j=1;j<zs.length;j++){if(zs[j].pct>hi.pct)hi=zs[j];if(zs[j].pct<lo.pct)lo=zs[j];}
      var spread=hi.pct-lo.pct;
      var hiL=FORTUNE_AXIS_META[hi.key].label,loL=FORTUNE_AXIS_META[lo.key].label;
      var val,body;
      if(spread>=55){val=hiL+" 쏠림";
        body=hiL+"은 "+fortuneRankText(hi)+"인데 "+loL+"은 "+fortuneRankText(lo)+"입니다. 한쪽으로 뚜렷하게 기운 프로필이라, 잘 맞는 판과 안 맞는 판이 분명하게 갈립니다.";}
      else if(spread<=22){val="고른 편";
        body="여덟 축이 모두 중간대에 모여 있습니다(가장 높은 "+hiL+" "+fortuneRankText(hi)+", 가장 낮은 "+loL+" "+fortuneRankText(lo)+"). 뾰족한 무기 대신 구멍이 없는 게 무기인 유형입니다.";}
      else{val=hiL+" 우위";
        body=hiL+"이 "+fortuneRankText(hi)+"로 가장 앞서고, "+loL+"이 "+fortuneRankText(lo)+"로 가장 뒤입니다. 극단적이진 않지만 무게가 어디에 실려 있는지는 분명합니다.";}
      cards.push({key:"포로가 본 특징",val:val,body:body});
      // ③ 한 줄 조언 — 가장 두드러진 축(강점이면 살리는 쪽, 약점이면 보완하는 쪽)
      var pick=(100-hi.pct)<=lo.pct?{ax:hi,dir:"hi"}:{ax:lo,dir:"lo"};
      var ad=(FORTUNE_ADVICE[pick.ax.key]||{})[pick.dir]||FORTUNE_ADVICE.breadth.hi;
      cards.push({key:"한 줄 조언",val:ad.k,body:ad.t});
    }else{
      cards.push({key:"포로가 본 특징",val:"표본 부족",body:"비교할 수 있는 축이 아직 적습니다. 판이 쌓이면 어느 축이 솟고 어느 축이 낮은지 여기에 실측으로 들어갑니다."});
      cards.push({key:"한 줄 조언",val:"조금 더 쌓기",body:"몇 판만 더 쌓이면 축별 위치가 잡히고, 그때부터 당신에게 맞는 조언이 붙습니다."});
    }
    return cards;
  }

  // ── 비교 기준 각주(실측 명시 — 신뢰의 근거) ──
  //   2026-09-03 사용자 지시: 두 모드 모두 "전체 집계 표본(참가 기록 건)" 대비. 단위는 사이트 히어로와 같은 건(= 판 × 10, 10인 전원 집계).
  //   플레이어 분포(명·판 이상) 문구는 옛 기준선 JSON 이 남아 있을 때만의 폴백이다.
  function fortuneBasisNote(a){
    var meta=a&&a.fortuneBasis;
    if(!meta)return "";
    // ★사이트가 표시하는 판수(siteMatches) × 10 = 사이트 히어로의 건 — 컴패니언과 사이트가 다른 숫자를 보여주지 않게.
    //   없으면 분포를 만든 건수(participantRows) → 판수 × 10 순으로 폴백. 옛 기준선 JSON(플레이어 분포)이 남아 있어도 건으로 적는다.
    var rows=(meta.siteMatches!=null?meta.siteMatches*10:(meta.participantRows!=null?meta.participantRows:(meta.matches||0)*10));
    if(rows)return "비교 기준: 같은 모드 실제 "+fortuneComma(rows)+"건의 실측 분포";
    if(meta.basis==="players"&&meta.players)return "비교 기준: 같은 모드에서 실제로 뛴 플레이어 "+fortuneComma(meta.players)+"명("+(meta.minGames||15)+"판 이상)의 실측 분포";
    return "";
  }
/* ⇒FORTUNE-CORE-END */
  function fortuneShareAggression(matches,puuid){
    var rows=Array.isArray(matches)?matches:[],n=0,sd=0,st=0;
    for(var i=0;i<rows.length;i++){var r=rows[i];if(!r)continue;
      // matchDetail.participants 폴백 제거: 이 앱엔 그 필드를 만드는 코드가 없다(전수 확인). 게다가 호출부가
      //   puuid를 안 넘겨 매칭 자체가 불가능했다. 생산자 없는 폴백은 결측을 조용히 숨겨 "있는 척"만 한다.
      var dmg=r.dmgShare,taken=r.takenShare;
      if(dmg==null||taken==null)continue; // 상세를 아직 못 받은 게임 — 지어내지 말고 표본에서 제외
      sd+=(+dmg||0);st+=(+taken||0);n++;}
    if(n<3)return null;
    // involve = 팀내 피해 점유 + 받은피해 점유의 평균(%). 5인팀이라 모집단 평균은 정의상 정확히 20%.
    //   ⚠️ 옛 (involve-15)/20*100 변환은 involve<15%를 전부 0으로 바닥clip(실측 17.9%의 게임)해 저담당(서포터)
    //      플레이어를 레일에 처박았다. 변환 없이 involve를 그대로 두고 z-score(mean 20 / std 5.93pp, 아래 prior)가
    //      정규화하게 한다 — 다른 축(화력·버팀)이 per-champion 넓은 std로 정규화되는 것과 같은 스케일.
    return (sd/n+st/n)/2;
  }
  // ── 유효 챔프수(Simpson 1/Σp²) — 판수에 안 줄고 "고르게 몇 종"을 반영. champs 각 {games}.
  function fortuneEffectiveChamps(champs){
    var rows=Array.isArray(champs)?champs:[],tot=0;for(var i=0;i<rows.length;i++)tot+=(+(rows[i]&&rows[i].games)||0);
    if(!tot)return null;var sq=0;for(var j=0;j<rows.length;j++){var p=(+(rows[j]&&rows[j].games)||0)/tot;sq+=p*p;}
    return sq>0?1/sq:null;
  }
  // 챔프 폭(pickDiversity)=effChamps/sqrt(총 판수). games-aware — 판수 적은 유저가 전원 '장인'으로 수렴하던 함정 제거. 사이트/오라클 정합.
  function fortunePickDiversity(champs){
    var rows=Array.isArray(champs)?champs:[],tot=0;for(var i=0;i<rows.length;i++)tot+=(+(rows[i]&&rows[i].games)||0);
    if(!tot)return null;var eff=fortuneEffectiveChamps(rows);return eff==null?null:eff/Math.sqrt(tot);
  }
  function analyzeRecord(rec){
    var champs=(rec.champs||[]).slice(),recent=(rec.recent||[]).slice(),form=(rec.form||recent.map(function(m){return !!m.win;})).slice(0,10);
    var total=+rec.total||0,wins=+rec.wins||0,winRate=Math.round(rec.winRate!=null?+rec.winRate:(total?wins/total*100:0)),losses=Math.max(0,total-wins);
    var minGames=total>=40?4:(total>=20?3:(total>=8?2:1));
    // best/hard = 보정 승률+Wilson+최소표본 게이트(소표본 극단 100%/0% 자동 강등). minGames는 화력/탱/골드(metric topBy)에만.
    var _bw=pickBestWorst(champs,wins,total),best=withAdjWr(_bw.best),hard=withAdjWr(_bw.worst),pickGate=_bw.gate;
    var kda=parseKdaText(rec.avgKda),top=champs[0]||null;
    var damage=topBy(champs,"dpm",minGames,true),tank=topBy(champs,"taken",minGames,true),gold=topBy(champs,"gpm",minGames,true);
    var avgDpm=weightedAvg(champs,"dpm"),avgTaken=weightedAvg(champs,"taken"),avgGpm=weightedAvg(champs,"gpm");
    // 회복·군중 제어(2026-08-29 실축 가동) — champs 행의 분당 heal/cc 를 판수 가중 평균. 기준선 정의와 동일(heal=totalHeal, cc=timeCCingOthers).
    var avgSupport=fortuneWeightedAvgF(champs,"heal"),avgCc=fortuneWeightedAvgF(champs,"cc");
    var recentWins=form.filter(function(x){return !!x;}).length,recentRate=form.length?Math.round(recentWins/form.length*100):winRate, switches=0;
    for(var fi=1;fi<form.length;fi++)if(!!form[fi]!==!!form[fi-1])switches++;
    var snow=0,mk=0;recent.forEach(function(m){if((m.spells||[]).join(" ").indexOf("SummonerSnowball")>=0)snow++;if((+m.mk||0)>=3)mk++;});
    var topShare=top&&total?Math.round((+top.games||0)/total*100):0, champSpread=total?Math.round(champs.length/total*100):0;
    // ── 선공 기질(share-aggression): recent[*]의 팀내 피해/받은피해 점유(dmgShare/takenShare, 팀 균등=20%) 게임평균
    //    → involve=(dmg+taken)/2 → clamp((involve-15)/20*100,0,100). 3판 미만이면 null(소표본 방어). 킬 신호 0(KDA 금지).
    var aggression=fortuneShareAggression(recent);
    // ── 챔프 폭(breadth)=pickDiversity(effChamps/sqrt판수, games-aware). effChamps는 서술 보조로만 보존.
    var effChamps=fortuneEffectiveChamps(champs);
    var pickDiversity=fortunePickDiversity(champs);
    return {total:total,wins:wins,losses:losses,winRate:winRate,kda:kda,top:top,best:best,hard:hard,damage:damage,tank:tank,gold:gold,avgDpm:avgDpm,avgTaken:avgTaken,avgGpm:avgGpm,recentN:form.length,recentWins:recentWins,recentRate:recentRate,recentSwitches:switches,snowRate:recent.length?Math.round(snow/recent.length*100):0,multiKills:mk,topShare:topShare,champCount:champs.length,champSpread:champSpread,effChamps:effChamps,pickDiversity:pickDiversity,breadthScore:fortuneBreadthScore(champs),avgSupport:avgSupport,avgCc:avgCc,aggression:aggression,minGames:minGames,pickGate:pickGate};
  }
  function hasBatchim(s){s=String(s||"").trim();var c=s.charCodeAt(s.length-1);return c>=44032&&c<=55203?((c-44032)%28)>0:false;}
  function josa(s,a,b){return esc(s)+(hasBatchim(s)?a:b);}
  function josaText(s,a,b){return String(s||"")+(hasBatchim(s)?a:b);}
  function who(a){return esc(a.reader||"사용자")+"님";}
  function whoPlain(a){return String(a.reader||"사용자")+"님";}
  // 헤더 페르소나 = 코호트 대비 가장 두드러진 축(KDA 역할분류 대체, 칼바람 KDA 금지). 두드러진 축 없으면 '균형형' 폴백.
  function personaFromAxes(a){
    var ax=(a.distinct&&a.distinct[0])||null;
    if(!ax)return {i:5,n:"균형 조율형",base:"균형 조율",line:"한쪽으로 치우치기보다 판에 맞춰 얼굴을 바꾸는 사람",key:"adapter"};
    var m={
      firepower:{hi:{base:"거리 화력",line:"거리에서 피해를 쌓아 길을 내는 사람",key:"artillery",i:2},lo:{base:"비화력 조율",line:"딜보다 다른 일로 판을 만드는 사람",key:"connector",i:3}},
      durability:{hi:{base:"앞문 전열",line:"앞에서 몸으로 받아내며 판을 여는 사람",key:"front",i:0},lo:{base:"후방 거리",line:"최전선보다 뒤에서 그림을 그리는 사람",key:"artillery",i:2}},
      economy:{hi:{base:"후반 성장",line:"시간이 지날수록 무거워지는 사람",key:"scaler",i:4},lo:{base:"초반 관여",line:"성장 곡선보다 초반 싸움에 끼는 사람",key:"front",i:0}},
      support:{hi:{base:"팀 케어",line:"아군을 살리고 한타를 이어 붙이는 사람",key:"connector",i:3},lo:{base:"자기 역할",line:"팀 유틸보다 제 몫에 집중하는 사람",key:"closer",i:1}},
      crowd:{hi:{base:"군중 제어",line:"상대를 묶어 한타를 여는 사람",key:"front",i:0},lo:{base:"비제어 압박",line:"묶기보다 다른 방식으로 누르는 사람",key:"artillery",i:2}},
      loyalty:{hi:{base:"한우물 장인",line:"정든 픽을 깊게 파고드는 사람",key:"closer",i:1},lo:{base:"폭넓은 손",line:"한 챔프에 매이지 않는 사람",key:"adapter",i:5}},
      breadth:{hi:{base:"변신술사",line:"판마다 다른 얼굴을 꺼내는 사람",key:"adapter",i:5},lo:{base:"좁은 정예",line:"좁고 일관된 폭으로 가는 사람",key:"closer",i:1}},
      aggression:{hi:{base:"선공 기질",line:"각이 보이면 먼저 들어가는 사람",key:"front",i:0},lo:{base:"받아치기",line:"먼저 열기보다 받아치는 사람",key:"artillery",i:2}},
      momentum:{hi:{base:"상승세",line:"요즘 손이 더 맞아 들어가는 사람",key:"closer",i:1},lo:{base:"식은 흐름",line:"누적보다 최근 흐름이 식은 사람",key:"adapter",i:5}}
    };
    var e=(m[ax.key]&&m[ax.key][ax.dir])||{base:"균형 조율",line:"판에 맞춰 얼굴을 바꾸는 사람",key:"adapter",i:5};
    return {i:e.i,n:e.base+"형",base:e.base,line:e.line,key:e.key};
  }
  // 헤더/페르소나 = content_bank 별명·요약·태그·닫는말(코호트 대비 두드러진 축 조합 → 사람마다 다름).
  //   roleKey는 한 줄 조언(fortuneSignalHtml)용으로만 유지(KDA 분류 제거됨, personaFromAxes에서 도출).
  function readingType(a){
    var distinct={axes:(a.distinct||[]),balanced:!!a.balanced,lean:a.lean||null};
    var role=personaFromAxes(a);
    var nick=fortunePersonaNickname(distinct);      // 〈명사구〉 별명
    var oneLiner=fortuneOneLiner(distinct,a);        // v2: 사람 비교 실측 한 줄("보통은 ~인데, 당신은 ~ — 상위 N%")
    var closing=fortuneClosingLine(distinct);        // 닫는 말
    // 태그 = 두드러진 축 칩 v2(실측 축은 백분위 %, prior 축은 방향만). 두드러진 축 없으면 '균형형'.
    var tags=(distinct.balanced||!distinct.axes.length)?["균형형"]:distinct.axes.map(function(x){return fortuneAxisChipRanked(x);});
    return {name:nick,title:nick,baseRole:role.base,roleKey:role.key,detail:tags,tagList:tags,
      fingerprint:a.fingerprint||"balanced",oneLiner:oneLiner,tone:oneLiner,closing:closing,basis:{role:role}};
  }
  function champPhrase(a){
    var s=[];
    if(a.top&&a.topShare<=10)s.push('한 챔피언으로 얼굴이 고정된 전적은 아닙니다. '+esc(a.top.name)+'이 눈에 먼저 들어와도, 진짜 얼굴은 여러 픽에서 반복되는 습관입니다.');
    else if(a.top)s.push(esc(a.top.name)+'이 전적 첫인상에 남습니다. 다만 이름보다 중요한 건 그 픽을 들었을 때 앞으로 서는지, 뒤에서 마무리하는지입니다.');
    if(a.best&&a.hard&&a.best.name!==a.hard.name)s.push(esc(a.best.name)+'은 손이 편한 얼굴이고, '+esc(a.hard.name)+'은 마음이 급해지기 쉬운 얼굴입니다.');
    if(a.damage&&a.tank&&a.damage.name!==a.tank.name)s.push('화력을 낼 때의 얼굴과 몸으로 받아낼 때의 얼굴이 갈립니다. 한 역할로만 보면 반쪽만 본 풀이가 됩니다.');
    return s.join(' ');
  }
  /* combatPhrase 제거: 칼바람 KDA 의미 사용(데스/어시) 죽은 함수 — 렌더 미호출 + 가드 위반이라 폐기 */
  function trendPhrase(a){
    var gap=a.recentRate-a.winRate;
    if(gap>=15)return '요즘 손은 따뜻합니다. 새 재능이 생겼다기보다, 최근에는 덜 억지 부리고 맞는 판을 더 자주 고른 쪽입니다.';
    if(gap<=-15)return '요즘 손은 조금 차갑습니다. 못해졌다기보다 첫 손해 뒤에 만회하려는 손이 빨라진 쪽으로 읽힙니다.';
    return '최근과 누적이 크게 싸우지 않습니다. 한 판의 운보다 오래 반복된 습관이 더 크게 보입니다.';
  }
  function modePhrase(a){
    if(mode==="augment")return '증강을 잡은 뒤 내가 열어도 되는 판인지 착각하면 손해가 커지는 모드입니다. 챔피언 이름보다 변신한 성격이 더 세게 남습니다.';
    return '룬과 첫 아이템이 첫 표정을 만드는 모드입니다. 다만 시작 선택보다 첫 교전에서 그 선택을 어떻게 쓰는지가 더 크게 남습니다.';
  }
  function stripHtml(s){return String(s||"").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim();}
  function fortuneCard(k,v,body){return '<div class="fortune-card"><span>'+esc(k)+'</span><b>'+esc(v)+'</b><p>'+esc(stripHtml(body))+'</p></div>';}
  function factHtml(k,v,m){return '<div class="fortune-fact"><span>'+esc(k)+'</span><b>'+esc(v||"-")+'</b><em>'+esc(m||"")+'</em></div>';}
  function signedPp(n){n=Math.round(+n||0);return (n>0?"+":"")+n+"%p";}
  function rateDelta(row,base){return row&&row.winRate!=null?Math.round((+row.winRate||0)-(+base||0)):null;}
  function rowShare(row,total){return row&&total?Math.round((+row.games||0)/(+total||1)*100):0;}
  function pickRateLine(row,kind,base,total){
    if(!row)return kind+" 표본은 아직 얇아서 단정하지 않습니다.";
    var name=pickName(row,kind),wr=row.winRate!=null?+row.winRate:null,d=wr==null?null:Math.round(wr-(+base||0));
    var label=kind==="item"?"장비":kind==="augment"?"증강":kind==="rune"?"룬":"픽";
    if(wr==null)return label+" 쪽은 아직 얼굴만 보이고 길흉은 흐립니다. "+josa(name,"은","는")+" 자주 보이는 흔적 정도로만 둡니다.";
    var s;
    if(Math.abs(d)<=3)s=label+" 이름이 운명을 가른 전적은 아닙니다. "+josa(name,"은","는")+" 자주 보여도 승패를 혼자 끌고 간 주인공이라기보다, 그걸 들고 어디에 섰는지가 더 크게 남습니다.";
    else if(d>0)s=josa(name,"은","는")+" 손에 들어왔을 때 판이 조금 더 부드럽게 풀린 쪽입니다. 무조건 정답이라기보다, 이 전적에서는 그 선택이 싸움의 모양과 잘 붙었습니다.";
    else s=josa(name,"은","는")+" 많이 보일수록 조심할 이름입니다. 아이템이나 선택 자체가 나쁘다기보다, 그걸 고른 판에서 진입 순서와 조합이 같이 꼬였을 가능성이 큽니다.";
    return s;
  }
  // 상단 3장 카드 — 판정·문구는 정본 코어(fortuneSignalCards)가 만든다. 여기선 감싸기만.
  function fortuneSignalHtml(a,rec,type){
    return '<div class="fortune-insights">'+fortuneSignalCards(a).map(function(c){return fortuneCard(c.key,c.val,c.body);}).join('')+'</div>';
  }
  function champFactHtml(a){
    var f=[];
    if(a.top)f.push(factHtml("대표 픽",a.top.name,kfmt(a.top.games)+"판"));
    if(a.best)f.push(factHtml("승률 인연",a.best.name,"보정 "+a.best.adjWinRate+"% (실제 "+a.best.rawWinRate+"%·"+kfmt(a.best.games)+"판)"+(a.best.confident?"":" · 참고")));
    if(a.damage)f.push(factHtml("화력 얼굴",a.damage.name,kfmt(a.damage.dpm)+"/분"));
    if(a.tank)f.push(factHtml("전열 흔적",a.tank.name,kfmt(a.tank.taken)+"/분"));
    if(a.hard&&a.hard.winRate<=45)f.push(factHtml("주의 픽",a.hard.name,"보정 "+a.hard.adjWinRate+"% (실제 "+a.hard.rawWinRate+"%·"+kfmt(a.hard.games)+"판)"+(a.hard.confident?"":" · 참고")));
    return '<div class="fortune-facts">'+(f.length?f.join(''):factHtml("표본 부족","-","챔피언별 판수가 더 쌓이면 분리됩니다."))+'</div>';
  }
  /* recordAdviceLists/adviceHtml 제거: 칼바람 KDA 의미 사용(어시/데스) 죽은 함수 — 렌더 미호출 + 가드 위반이라 폐기 */
  function fortuneRoleKey(a,type){
    // 역할키 = 축 기반 페르소나(KDA 분류 제거). 12장/레이더 공용.
    return (type&&type.roleKey)||personaFromAxes(a).key;
  }
  function fortunePickName(row,fallback){return row&&row.name?row.name:(fallback||"그 픽");}
  function fortunePickJosa(row,a,b,fallback){return josaText(fortunePickName(row,fallback),a,b);}
  function fortuneRoleLabel(k){
    return k==="front"?"앞에서 판을 여는 사람":k==="closer"?"끝낼 장면을 보는 사람":k==="artillery"?"거리로 판을 깎는 사람":k==="connector"?"옆 사람의 각을 살리는 사람":k==="scaler"?"늦게 익을수록 강해지는 사람":"판에 맞춰 얼굴을 바꾸는 사람";
  }
  function clampScore(n){n=Math.round(+n||0);return Math.max(12,Math.min(96,n));}
  function svgTextEsc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  // 레이더 6축(content_bank RADAR_AXES) = 12장·지문과 같은 축 체계. z를 0~100 시각화(50+z*18, 5~95클램프).
  //   "챔프 폭" 축 = breadth(pickDiversity) z 그대로(넓을수록 z↑=점수↑). loyalty 폐기로 z 뒤집기 불필요.
  var IMPACT_AXES=[{k:'dpm',mk:'metaDpm',label:'딜량',ref:3500},{k:'gpm',mk:'metaGpm',label:'골드',ref:1300,unit:'(분당 G)'},{k:'taken',mk:'metaTank',label:'탱킹',ref:7000},{k:'mit',mk:'metaMit',label:'피해 감소',ref:7000},{k:'heal',mk:'metaHeal',label:'회복',ref:2500},{k:'cc',mk:'metaCc',label:'CC',ref:6,unit:'(분당 초)'}]; // CC만 '분당 초'라 다른 분당 수치(딜량 등)보다 작음 → 카드에 단위 표기(라디아 축 라벨엔 미표기)
  // 지표 분석 육각형 — 6축. 메타·내 플레이 둘 다 축별 기준최대(ref) 대비 절대 정규화 → 메타도 챔프별 고유 모양, 내값과의 차이가 시각화됨. 내 데이터 없는 축은 폴리곤만 메타에 맞추고 리스트는 '-'(없는 데이터 안 지어냄).
  function impactRadarHtml(d){
    var AMP=2.2, hasAnyMine=false; // 내 값의 메타 대비 편차를 ±2.2배 증폭해 표시 → 내 특성이 도드라지게(겹쳐도 차이 보임)
    var ax=IMPACT_AXES.map(function(a){
      var ref=a.ref||100;
      var mv=Number(d[a.mk]); if(isNaN(mv))mv=0;
      var nvRaw=d[a.k]; var hasMine=!(nvRaw==null||nvRaw===''); var nv=hasMine?Number(nvRaw):NaN;
      var ok=hasMine&&!isNaN(nv)&&nv>0; if(ok)hasAnyMine=true; // 0=미수집(옛 일반게임은 피해감소/회복/CC 미기록)→'-'. 실 ARAM 게임은 어떤 지표도 0일 수 없음
      var metaPct=Math.max(3,Math.min(100,Math.round(mv/ref*100)));
      var mineAbs=ok?Math.max(0,Math.min(125,nv/ref*100)):metaPct;
      var minePct=ok?Math.max(3,Math.min(100,Math.round(metaPct+(mineAbs-metaPct)*AMP))):metaPct; // 메타 기준 편차 증폭
      return {label:a.label, unit:a.unit, metaPct:metaPct, minePct:minePct, mineRaw:ok?nvRaw:null, metaRaw:(mv<10?+mv.toFixed(1):Math.round(mv))};
    });
    var cx=60,cy=56,r=34,lr=48,n=ax.length;
    function pt(i,scale){var ang=-Math.PI/2+i*2*Math.PI/n;return [cx+Math.cos(ang)*r*scale,cy+Math.sin(ang)*r*scale];}
    function poly(key){return ax.map(function(a,i){var p=pt(i,a[key]/100);return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');}
    var grid=[.25,.5,.75,1].map(function(s){return '<polygon points="'+ax.map(function(_,i){var p=pt(i,s);return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ')+'" fill="none" stroke="rgba(147,161,181,.15)" stroke-width="0.7"/>';}).join('');
    var axesH=ax.map(function(a,i){var p=pt(i,1),ang=-Math.PI/2+i*2*Math.PI/n,lp=[cx+Math.cos(ang)*lr,cy+Math.sin(ang)*lr];var anc=Math.abs(lp[0]-cx)<6?'middle':(lp[0]>cx?'start':'end');return '<line x1="'+cx+'" y1="'+cy+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'" stroke="rgba(147,161,181,.12)" stroke-width="0.7"/><text x="'+lp[0].toFixed(1)+'" y="'+lp[1].toFixed(1)+'" text-anchor="'+anc+'" dominant-baseline="middle" fill="#c2cee0" font-size="7" font-family="Malgun Gothic, Arial">'+svgTextEsc(a.label)+'</text>';}).join('');
    var ac=(typeof mode!=='undefined'&&mode==='augment')?'#a878ff':'#38bdf8'; // 모드 액센트(증강 보라/표준 청록)
    var metaP='<polygon points="'+poly('metaPct')+'" fill="rgba(147,161,181,.09)" stroke="rgba(147,161,181,.5)" stroke-width="1" stroke-dasharray="3 2.5"/>'; // 메타=옅은 점선 배경(참고)
    var mineP=hasAnyMine?'<polygon points="'+poly('minePct')+'" fill="'+ac+'" fill-opacity="0.45" stroke="'+ac+'" stroke-width="1.3" stroke-linejoin="round"/>':''; // 내 플레이=선명·두껍게(도드라지게). 내 데이터 없으면 안 그림(미플레이 챔프에 가짜 보라 그래프 금지)
    var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="-28 -6 176 124"><rect x="-28" y="-6" width="176" height="124" rx="13" fill="#0b1627"/>'+grid+axesH+metaP+mineP+'</svg>';
    var list='<div class="ir-list">'+ax.map(function(a){return '<div class="ir-item"><span>'+esc(a.label)+(a.unit?' <em class="ir-unit">'+esc(a.unit)+'</em>':'')+'</span><b'+((a.mineRaw!=null&&Number(a.mineRaw)>Number(a.metaRaw))?' class="win"':'')+'>'+(a.mineRaw!=null?a.mineRaw:'-')+'</b><i>메타 '+a.metaRaw+'</i></div>';}).join('')+'</div>'; /* §12 #16 메타 상회 강조(표시용 비교) */
    var legend=hasAnyMine?'<span class="ir-mine">내 플레이</span><span class="ir-meta">메타</span>':'<span class="ir-meta">메타</span><span class="ir-none">내 기록 없음</span>'; // 미플레이면 보라 범례 대신 안내
    return '<div class="impact-radar"><div class="ir-legend">'+legend+'</div><div class="impact-radar-art"><img alt="지표 분석 육각형" src="data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)+'"></div>'+list+'</div>';
  }
  // 평균 KDA — 챔프 헤더 우측 빈공간(지표 박스 아님). 내/메타 둘 중 있는 것만(없는 데이터 안 지어냄).
  function kdaSplit(s){var p=String(s==null?'':s).split('/');return p.length===3?[p[0].trim(),p[1].trim(),p[2].trim()]:null;} // 원문 부분(표시용)
  function kdaNums(parts){if(!parts)return null;var n=parts.map(parseFloat);return n.some(function(x){return isNaN(x);})?null:n;} // 비교/비율용 숫자
  function kdaRatioStr(n){return (n[1]>0?((n[0]+n[2])/n[1]):(n[0]+n[2])).toFixed(2);}
  // 단일 KDA 색코딩(K / 데스=빨강 / A) + 선택적 비율. 흰숫자 슬래시 → 스캔 가능.
  function kda3(str,withRatio){var p=kdaSplit(str);if(!p)return esc(str==null?'':str);var n=kdaNums(p);var r=(withRatio&&n)?'<span class="kr">'+kdaRatioStr(n)+':1</span>':'';return '<span class="kda3"><b class="kk">'+esc(p[0])+'</b><i class="ks">/</i><b class="kd">'+esc(p[1])+'</b><i class="ks">/</i><b class="ka">'+esc(p[2])+'</b>'+r+'</span>';}
  // 평균 KDA — 내 평균 vs 메타 비교(킬/데스/어시 3열, 색=메타보다 좋/나쁨, 데스는 낮을수록 좋음 반전). 한쪽만 있으면 단일 색코딩.
  function champHeaderKda(mine,meta){
    var mp=kdaSplit(mine),tp=kdaSplit(meta),mn=kdaNums(mp),tn=kdaNums(tp);
    if(mp&&tp&&mn&&tn){
      var lab=['킬','데스','어시'],cells='';
      for(var i=0;i<3;i++){
        var mv=mn[i],tv=tn[i],lowerBetter=(i===1);
        var cls=(mv===tv)?'eqk':((lowerBetter?mv<tv:mv>tv)?'good':'bad');
        var ar=(mv>tv)?'<span class="kc-ar">▲</span>':(mv<tv)?'<span class="kc-ar">▼</span>':'';
        cells+='<div class="kc '+cls+'"><span>'+lab[i]+'</span><b>'+esc(mp[i])+ar+'</b><em>메타 '+esc(tp[i])+'</em></div>';
      }
      return '<div class="cp-hkda"><span class="kchd">평균 KDA<br>내 vs 메타</span>'+cells+'</div>';
    }
    if(mp||tp){var only=mp?mine:meta,l=mp?'내 평균 KDA':'메타 평균 KDA';return '<div class="cp-hkda"><span class="kchd">'+l+'</span>'+kda3(only,false)+'</div>';}
    return '';
  }
  function fortuneRadarHtml(a){
    var ordered=fortuneStatScores(a);
    if(!ordered.length)return ""; // 이 모드에서 잴 수 있는 축이 없으면 육각형을 그리지 않는다(가짜 50점 금지)
    // viewBox에 좌우 여백을 둬 긴 한글 라벨(선공 기질/성장 속도/챔프 폭)이 잘리지 않게(좌우 anchor로 바깥쪽 정렬).
    var cx=60,cy=58,r=33,lr=46,n=ordered.length;
    function point(i,rad,scale){var ang=-Math.PI/2+i*2*Math.PI/n;var rr=rad*(scale==null?1:scale);return [cx+Math.cos(ang)*rr,cy+Math.sin(ang)*rr];}
    function pts(scale){return ordered.map(function(_,i){var p=point(i,r,scale);return p[0].toFixed(1)+","+p[1].toFixed(1);}).join(" ");}
    // 리스킨 v2: 모드 액센트(증강 보라/표준 청록 — impactRadarHtml과 동일 규칙) + 그라디언트 스트로크. 사이트 amFortuneRadarHtml과 동일 언어.
    var _ac=(typeof mode!=='undefined'&&mode==='augment')?'#a878ff':'#38bdf8',_ac2=(typeof mode!=='undefined'&&mode==='augment')?'#d879f2':'#2dd4bf';
    function _acA(a){var h=_ac.replace('#','');return 'rgba('+parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16)+','+a+')';}
    var grid=[.25,.5,.75,1].map(function(s){return '<polygon points="'+pts(s)+'" fill="none" stroke="'+_acA(.2)+'" stroke-width="0.7"/>';}).join("");
    var axes=ordered.map(function(row,i){var p=point(i,r,1),lp=point(i,lr,1);var ax=Math.abs(lp[0]-cx)<6?"middle":(lp[0]>cx?"start":"end");var lx=lp[0]+(ax==="start"?2:ax==="end"?-2:0);return '<line x1="'+cx+'" y1="'+cy+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'" stroke="'+_acA(.14)+'" stroke-width="0.7"/><text x="'+lx.toFixed(1)+'" y="'+lp[1].toFixed(1)+'" text-anchor="'+ax+'" dominant-baseline="middle" fill="#b6c8de" font-size="6.4" font-family="Malgun Gothic, Arial">'+svgTextEsc(row.label)+'</text>';}).join("");
    var data=ordered.map(function(row,i){var p=point(i,r,row.score/100);return p[0].toFixed(1)+","+p[1].toFixed(1);}).join(" ");
    // width/height 명시 → 캡처 시 naturalWidth/Height(164x124=1.32)로 object-fit:contain 레터박스 정확(육각형 좌우눌림 방지). 브라우저 렌더는 CSS 지배로 무변화.
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="164" height="124" viewBox="-22 -4 164 124"><defs><linearGradient id="ftRadarG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="'+_ac+'"/><stop offset="1" stop-color="'+_ac2+'"/></linearGradient></defs><rect x="-22" y="-4" width="164" height="124" rx="13" fill="#0b1424"/>'+grid+axes+'<polygon points="'+data+'" fill="'+_acA(.28)+'" stroke="url(#ftRadarG)" stroke-width="2" stroke-linejoin="round"/><circle cx="'+cx+'" cy="'+cy+'" r="2.4" fill="#c8f2ff"/></svg>';
    var sorted=ordered.slice().sort(function(x,y){return y.score-x.score;}),top=sorted[0],second=sorted[1]||sorted[0];
    return '<div class="fortune-radar"><div class="fortune-radar-art"><img alt="플레이 성향 육각형" src="data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)+'"></div><div class="fortune-radar-side"><h4>플레이 성향 육각형</h4><p>한쪽이 길게 뻗으면 그 방향이 또렷한 사람이고, 고르게 차면 여러 면을 두루 소화하는 쪽입니다. '+esc(top.label)+(hasBatchim(top.label)?"이":"가")+' 가장 앞서고, '+esc(second.label)+(hasBatchim(second.label)?"이":"가")+' 그다음입니다.</p><div class="fortune-radar-list">'+ordered.map(function(row){return '<div class="fortune-radar-item" title="'+esc(row.tip)+'"><div class="fri-top"><span>'+esc(row.label)+'</span><b>'+row.score+'</b></div><i class="fri-gauge"><u style="width:'+Math.max(0,Math.min(100,row.score))+'%"></u></i></div>';}).join('')+'</div></div></div>';
  }
  /* (구 12장 역할템플릿 6종 switch 함수들은 축구동 PROSE_BANK로 대체되어 제거됨 — KDA 의존 포함 폐기) */
  /* ── ⓑ 12장 = 각 장의 '주제축' 중 그 사람이 코호트 대비 가장 두드러진 축(chapterLeadAxis)로 본문 구동 ──
     단일 역할키 6개 switch(획일화)를 폐기. 두드러진 축이 없으면 '균형(평균형)' 문장. 칼바람 KDA 의미 사용 금지. */
  /* ── content_bank.mjs PROSE_BANK 임베드(ITERATION_1 #1 풀이 깊이 복원): PROSE_BANK[장][축][방향(hi|lo)][강도(강|뚜렷|약간)]={lead,body} ──
     lead=굵게 나갈 핵심 한 줄(스캔용 takeaway), body=그 단정을 풀어 보이는 2~3문장 해석체 본문(역술 풀이 결).
     강도(distinctiveAxes.strength)로 단정 세기를 진짜 다르게(과장 방지). 벽글·양면진술·KDA·내부용어 금지. 사이트(app_v2.js)와 동일 원본. */
  function deepReadingHtml(a){
    var chapters=fortuneChapters(a);
    return '<div class="fortune-readgrid">'+chapters.map(function(ch){
      var chip=ch.axisLabel?'<span class="fortune-read-axis">'+esc(ch.axisLabel)+'</span>':'<span class="fortune-read-axis fortune-read-axis--bal">균형</span>';
      var body=ch.body?'<p class="fortune-read-body">'+esc(ch.body)+'</p>':'';
      return '<section class="fortune-read fortune-read--'+(ch.dir==="hi"?"hi":ch.dir==="lo"?"lo":"bal")+'"><header class="fortune-read-head"><h5 class="fortune-read-title">'+esc(ch.title)+'</h5>'+chip+'</header><p class="fortune-read-lead">'+esc(ch.lead)+'</p>'+body+'</section>';
    }).join('')+'</div>';
  }
  function pickKey(x){return String((x&&x.id!=null?x.id:x&&x.name)||"");}
  function pickName(x,kind){
    if(!x)return "-";
    if(kind==="rune"){var rd=_runeMap&&_runeMap[x.id];if(rd&&rd.name)return rd.name;var sh=SHARD[x.id];if(sh)return /파편$/.test(sh[0])?sh[0]:(sh[0]+" 파편");return x.name||("룬 #"+(x.id||""));}
    if(kind==="item"){var it=_itemMap&&_itemMap[x.id];return x.name||(it&&it.name)||(x.id?("아이템 #"+x.id):"아이템");}
    if(kind==="augment")return x.name||(x.id?("증강 #"+x.id):"증강");
    return x.name||"-";
  }
  /* (구 pickIconUrl 제거 — 룬 파편 텍스트폴백 버그의 근원. fortunePickIconUrl이 SHARD 매핑으로 대체) */
  /* ── content_bank.mjs PICK_CUE 임베드(ITERATION_1 #3): 숫자 전면 제거 → 정성 한마디. 통계(EB·Wilson·게이트)는 순위에만, 표시 안 함. ──
     cue=부드러운 운세체 한마디. 베스트=긍정 변주, 워스트=고전 변주. idx로 1위가 가장 단정, 아래로 갈수록 은근. */
  var PICK_CUE={
    best:["손이 제일 잘 맞나 봐요","유난히 잘 풀리는 손이에요","이 픽은 좋은 손인가 봐요","꽤 잘 맞는 편이에요","은근히 잘 풀리나 봐요"],
    worst:["아직 잘 안 풀리나 봐요","유독 고전하는 손이에요","이 픽은 좀 까다로운가 봐요","아직 손에 덜 익은 듯해요","조금 애를 먹는 편이에요"]
  };
  function pickCue(kind,idx){var pool=PICK_CUE[kind]||PICK_CUE.best;return pool[Math.min(idx,pool.length-1)];}
  // 베스트/워스트 N개 랭킹 — 오라클 pickBestWorst와 '동일 산식'(게이트·Wilson·EB)으로 정렬만 확장. 반환 각 행 {name,id,cue}(숫자 일절 없음). count=뽑을 개수(기본 5).
  // 2026-07-03 구성 쿼터(사이트 app_v2.js amFortuneComposeQuota 미러): 룬 2메인·2하위·1파편/아이템 2신발·3비신발/증강 2프리즘·2골드·1실버(가능한 한).
  //   표본가중 랭킹순으로 쿼터 채우고 부족분은 랭크로 폴백(표시순=랭크순). 분류 불가 항목은 폴백으로만 = 무회귀.
  var FORTUNE_KEYSTONE_IDS={8005:1,8008:1,8010:1,8021:1,8112:1,8124:1,8128:1,9923:1,8214:1,8229:1,8230:1,8437:1,8439:1,8465:1,8351:1,8360:1,8369:1};
  var FORTUNE_BOOTS_IDS={1001:1,2422:1,3006:1,3008:1,3009:1,3010:1,3013:1,3020:1,3047:1,3111:1,3117:1,3158:1,3171:1,3172:1,3173:1};
  function fortuneRuneCat(r){var id=Number(r&&r.id);if(SHARD[id]||SHARD[id%10000]||String((r&&r.rarity)||"")==="파편")return "shard";if(FORTUNE_KEYSTONE_IDS[id]||FORTUNE_KEYSTONE_IDS[id%10000]||Number(r&&r.runeSlot)===1||String((r&&r.runeCategory)||"").toLowerCase()==="main")return "main";return "sub";}
  function fortuneAugRarity(r){var rr=String((r&&r.rarity)||"").toLowerCase();if(rr.indexOf("prism")>=0||rr.indexOf("프리즘")>=0)return "prismatic";if(rr.indexOf("gold")>=0||rr.indexOf("골드")>=0)return "gold";if(rr.indexOf("silver")>=0||rr.indexOf("실버")>=0)return "silver";return "";}
  function fortuneIsBoots(r){var id=Number(r&&r.id);if(FORTUNE_BOOTS_IDS[id]||FORTUNE_BOOTS_IDS[id%10000])return true;return /군화|장화|신발|발걸음$/.test(String((r&&r.name)||(r&&r.localName)||""));}
  function fortuneQuotaCat(r,kind){if(kind==="rune")return fortuneRuneCat(r);if(kind==="item")return fortuneIsBoots(r)?"boots":"other";if(kind==="augment"||kind==="aug")return fortuneAugRarity(r);return "";}
  function fortuneQuotaWant(kind){if(kind==="rune")return {main:2,sub:2,shard:1};if(kind==="item")return {boots:2,other:3};if(kind==="augment"||kind==="aug")return {prismatic:2,gold:2,silver:1};return null;}
  function fortuneComposeQuota(sorted,count,kind){var w=fortuneQuotaWant(kind);if(!w||sorted.length<=1)return sorted.slice(0,count);var rank=new Map();sorted.forEach(function(r,i){rank.set(r,i);});var cutoff=sorted.length>=count?(Number(sorted[count-1].games)||0):0,floor=cutoff*0.5;var picked=[],used=new Set(),got={};var i;for(i=0;i<sorted.length;i++){if(picked.length>=count)break;if((Number(sorted[i].games)||0)<floor)continue;var c=fortuneQuotaCat(sorted[i],kind);if(c&&(w[c]||0)>(got[c]||0)){picked.push(sorted[i]);used.add(sorted[i]);got[c]=(got[c]||0)+1;}}for(i=0;i<sorted.length;i++){if(picked.length>=count)break;if(used.has(sorted[i]))continue;var c2=fortuneQuotaCat(sorted[i],kind);var cap=c2?(w[c2]||0):count;if((got[c2]||0)>=cap)continue;picked.push(sorted[i]);used.add(sorted[i]);got[c2]=(got[c2]||0)+1;}var _catKeys=Object.keys(w),_cat=function(r){var ci=_catKeys.indexOf(fortuneQuotaCat(r,kind));return ci<0?99:ci;};return picked.sort(function(a,b){return (_cat(a)-_cat(b))||(rank.get(a)-rank.get(b));});} // 표시순=등급순(증강 프리즘>골드>실버·아이템 신발>비신발·룬 메인>하위>파편) 위에서 아래로, 등급 내에선 비중순
  function rankPicks(list,playerWins,playerTotal,count,entKind){
    count=count==null?5:count;
    var total=Number(playerTotal)||0,hasWR=function(x){return (x.winRate!=null||(x.wins!=null&&x.games));};
    var baseGate=minSampleGate(total); // 1~2판 노이즈만 차단(비중 가중이 소표본을 자동 후순위로 누름)
    var cand=(list||[]).filter(function(x){return (Number(x.games)||0)>=baseGate && hasWR(x);});
    if(!cand.length)cand=(list||[]).filter(function(x){return (Number(x.games)||0)>=1 && hasWR(x);}); // 최후 완화 — 아예 안 뜨느니
    if(!cand.length)return {best:[],worst:[]};
    var _base=ebShrink(playerWins,playerTotal,0.5,20); // 내 평균(EB)
    var rows=cand.map(function(x){
      var games=Number(x.games)||0,wins=x.wins!=null?Number(x.wins):Math.round((Number(x.winRate)||0)/100*games),adj=correctedWinRate(wins,games,playerWins,playerTotal);
      return {name:x.name,id:x.id!=null?x.id:null,icon:x.icon||"",adj:adj,games:games,rarity:x.rarity||x.group||"",runeCategory:x.runeCategory||"",runeSlot:x.runeSlot!=null?x.runeSlot:0};
    });
    // 비중 지배 랭킹: best=내 평균 초과 픽을 '비중(=판수, 전체판수는 상수라 판수순=비중순) 내림차순'(승률은 동점처리), worst=내 평균 미달 픽을 비중 내림차순.
    //   즉 자주 쓰고 이기는 픽이 상위, 자주 쓰고 지는 픽이 고전. 비중 작은 픽은 더 큰 비중 픽이 있으면 승률이 높아도/낮아도 상위로 오지 않는다(18판 요행·콩콩이·전설:가속 재발 방지). 이기는 픽을 고전으로 오표기 안 함. 룬·증강·아이템·챔프 동일.
    var bestSorted=rows.filter(function(x){return x.adj>_base;}).sort(function(a,b){return (b.games-a.games)||(b.adj-a.adj);});
    var worstSorted=rows.filter(function(x){return x.adj<_base;}).sort(function(a,b){return (b.games-a.games)||(a.adj-b.adj);});
    // ITERATION_2 A: best/worst 겹침 0(best 확정 뒤 worst 풀에서 제외). 구성쿼터 적용 후에도 유지.
    function keyOf(r){return String(r.id!=null?r.id:r.name);}
    var best=fortuneComposeQuota(bestSorted,count,entKind),bestKeys={};
    best.forEach(function(r){bestKeys[keyOf(r)]=true;});
    var worst=fortuneComposeQuota(worstSorted.filter(function(r){return !bestKeys[keyOf(r)];}),count,entKind);
    function decorate(arr,kind){return arr.map(function(r,i){return {name:r.name,id:r.id,icon:r.icon,cue:pickCue(kind,i)};});}
    return {best:decorate(best,"best"),worst:decorate(worst,"worst")};
  }
  /* ── 아이콘 훅(ITERATION_1 #3a): 텍스트 폴백 박멸 ── 룬 파편=SHARD→ddragon StatMods 이미지, 챔프/아이템=ddragon 이미지.
     "공격 속도 파편"이 텍스트로 깨지던 버그를 차단: 파편 id(5008/5005/5007/5010/5013/5001/5011/5012)는 SHARD 매핑으로 무조건 이미지가 나온다. */
  function fortunePickIconUrl(row,kind){
    if(!row)return "";
    if(kind==="rune"){
      var rd=_runeMap&&_runeMap[row.id];
      if(rd&&rd.icon)return "https://ddragon.leagueoflegends.com/cdn/img/"+rd.icon;          // 키스톤/룬
      var sh=SHARD[row.id];
      if(sh)return "https://ddragon.leagueoflegends.com/cdn/img/perk-images/StatMods/"+sh[1]+".png"; // 파편(공격 속도 파편 등) → 이미지
      return row.icon||"";
    }
    if(kind==="item"){var it=_itemMap&&_itemMap[row.id];return row.icon||(it&&it.icon)||(row.id?("https://ddragon.leagueoflegends.com/cdn/16.12.1/img/item/"+row.id+".png"):"");}
    return row.icon||""; // 챔프/증강은 기록의 ddragon icon URL
  }
  function fortunePickIconHtml(row,kind){
    var url=fortunePickIconUrl(row,kind);
    return url?pim(url):'';
  }
  // 한 열(≤5행): [아이콘 + 항목명 + cue 한마디]. 숫자 없음(ITERATION_1 #3b/d).
  function pickColHtml(rows,kind,good){
    var label=good?"잘 맞는 픽":"고전하는 픽";
    if(!rows||!rows.length)return '<div class="fortune-pickcol fortune-pickcol--'+(good?'best':'worst')+'"><h6>'+label+'</h6><div class="fortune-pick-empty">아직 보여줄 '+label+'이 모이지 않았어요.</div></div>';
    var items=rows.map(function(r){ // 정본(사이트 amFortunePickColumnHtml) 동일 마크업 — 공유 페이지가 선택자 정규화만으로 재생(v3)
      var name=pickName(r,kind);
      return '<div class="fortune-pick-row fortune-pick-row--'+(good?'best':'worst')+'"><div class="fortune-pick-icon">'+fortunePickIconHtml(r,kind)+'</div><div class="fortune-pick-main"><strong title="'+esc(name)+'">'+esc(name)+'</strong></div></div>';
    }).join('');
    return '<div class="fortune-pickcol fortune-pickcol--'+(good?'best':'worst')+'"><h6>'+label+'</h6>'+items+'</div>';
  }
  function pickBoxHtml(title,kind,list,a){
    var ranked=rankPicks(list,a.wins,a.total,5,kind); // ITERATION_2 A: best/worst 중복 제거는 rankPicks 내부에서 보장(겹침 0). kind=구성쿼터용(rune/item/augment).
    return '<div class="fortune-pickbox"><h5>'+esc(title)+'<span>최대 5개</span></h5><div class="fortune-pickcols">'+
      pickColHtml(ranked.best,kind,true)+
      pickColHtml(ranked.worst,kind,false)+
      '</div></div>';
  }
  // 사주 아이템 픽에서 소비템(포로 간식·물약·영약·와드·트링킷) 제외 — 사이트 amFortuneIsConsumableItem 미러. 아수라장 변종 id%10000.
  var FORTUNE_CONSUMABLE_ITEM_IDS={2003:1,2031:1,2033:1,2010:1,2052:1,2055:1,2056:1,2138:1,2139:1,2140:1,2150:1,2151:1,3340:1,3363:1,3364:1,2419:1,2420:1,2421:1,2422:1,2403:1,2049:1};
  function isFortuneConsumableItem(it){
    var id=Number((it&&it.id)||0);
    if(id&&(FORTUNE_CONSUMABLE_ITEM_IDS[id]||FORTUNE_CONSUMABLE_ITEM_IDS[id%10000]))return true;
    var name=(((it&&it.localName)||"")+" "+((it&&it.name)||"")).toLowerCase();
    if(/영약|물약|강장|비약|포션|elixir|potion|비스킷|biscuit|과자|포로\s*간식|poro[-\s]?snax|제어\s*와드|감시\s*와드|은신\s*와드|예지의\s*끝|예언자의\s*렌즈|와드\s*토템|control\s*ward|stealth\s*ward|farsight|oracle\s*lens|warding\s*totem/.test(name))return true;
    return false;
  }
  function pickSummaryHtml(a,rec){
    var p=rec.picks||{},boxes=[];
    boxes.push(pickBoxHtml("챔피언 픽","champ",rec.champs||[],a));
    boxes.push(pickBoxHtml("아이템 픽","item",(p.items||[]).filter(function(it){return !isFortuneConsumableItem(it);}),a));
    boxes.push(mode==="augment"?pickBoxHtml("증강 픽","augment",p.augments||[],a):pickBoxHtml("룬 픽","rune",p.runes||[],a));
    return '<div class="fortune-picks">'+boxes.join('')+'</div>';
  }
  var _readingShare=null,_cohortStats={};
  function loadCohortStats(){ // 사주풀이 z-score 코호트 축통계(모드별, 1회 fetch+캐시). 실패해도 '평균형' 폴백으로 동작.
    var key=mode==="augment"?"augment":"standard";
    if(_cohortStats[key])return Promise.resolve(_cohortStats[key]);
    return fetch("/api/fortune-cohort?mode="+encodeURIComponent(key)).then(function(r){return r.json();}).then(function(s){_cohortStats[key]=s;return s;}).catch(function(){return null;});
  }
  function attachFortuneDistinct(a){ // 코호트 대비 개인 두드러진 축 부착(없으면 균형형). 같은 모드만(절대 안 섞음).
    var cs=_cohortStats[mode==="augment"?"augment":"standard"];
    if(cs){var d=fortuneDistinctiveAxes(a,cs);a.allZ=fortuneZScores(a,cs);a.distinct=d.axes;a.balanced=d.balanced;a.lean=d.lean||null;a.fingerprint=fortuneFingerprint(d);a.fortuneBasis=cs.__meta||null;}
    else{a.allZ=[];a.distinct=[];a.balanced=true;a.lean=null;a.fingerprint="balanced";a.fortuneBasis=null;}
    return a;
  }
  function renderRecordReading(rec){
    var a=analyzeRecord(rec);a.reader=readerName();attachFortuneDistinct(a);
    var type=readingType(a),name=a.reader,ml=modeLabel();
    var _ssP=fortuneStatScores(a).slice().sort(function(x,y){return y.score-x.score;}); // 6번째 스탯=대표 성향(레이더 최상위 축과 동일 → 사이드 "○○이 가장 앞서고"와 정합)
    var stats=[["모드",ml],["전적",kfmt(a.total)+"판"],["승률",a.winRate+"%"],["최근",a.recentN?(kfmt(a.recentWins)+"승 "+kfmt(a.recentN-a.recentWins)+"패"):"-"],["대표",a.top?a.top.name:"-"],["대표 성향",_ssP.length?_ssP[0].label:"-"]]; // 분당딜은 제거유지(ARAM 무의미), 빈칸을 대표 성향으로
    var statH='<div class="fortune-stats">'+stats.map(function(s){return '<div class="fortune-stat"><span>'+s[0]+'</span><b>'+esc(s[1])+'</b></div>';}).join('')+'</div>';
    var insights=fortuneSignalHtml(a,rec,type);
    var radar=fortuneRadarHtml(a);
    _readingShare={a:a,type:type,name:name,ml:ml,rec:rec,stats:stats};
    var tagsHtml=(type.tagList||[]).map(function(t){return '<span class="fortune-tag fortune-chip">'+esc(t)+'</span>';}).join('');
    var html='<div class="fortune-top"><button class="cp-back" id="rback" type="button">← 챔피언 통계</button><div class="share-actions"><button class="fortune-share" id="rshare" type="button">이미지 복사</button><button class="fortune-share fortune-link" id="rlink" type="button">링크 복사</button></div></div><div class="fortune-capture">'+
      '<div class="fortune-hero"><div class="fortune-poro">'+pim(PORO_READER_ICON)+'<span>포로 관상가</span></div>'+
      '<div class="fortune-title"><div class="fortune-kicker">포로 관상가 · '+esc(ml)+'</div><h2>'+esc(name)+'님, <em class="fortune-nick">'+esc(type.title)+'</em></h2><p class="fortune-oneliner">'+esc(type.oneLiner||type.tone)+'</p><div class="fortune-tags fortune-chips">'+tagsHtml+'</div></div></div>'+
      statH+
      insights+
      radar+
      '<div class="fortune-section"><h4>포로의 12장 풀이</h4>'+deepReadingHtml(a)+'</div>'+
      '<div class="fortune-section"><h4>내게 맞는 픽과 조심할 픽</h4>'+pickSummaryHtml(a,rec)+'</div>'+
      '<footer class="fortune-closing"><p>'+esc(type.closing||"")+'</p>'+(fortuneBasisNote(a)?'<p class="fortune-source">'+esc(fortuneBasisNote(a))+'</p>':'')+'</footer></div>';
    $("#champpage").innerHTML='<div class="cp-wrap fortune-wrap">'+html+'</div>';
    document.body.classList.add("cp");
    $("#rback").onclick=navToList;
    $("#rshare").onclick=shareRecordReading;var _rl=$("#rlink");if(_rl)_rl.onclick=shareRecordLink;
  }
  /* recordFortuneAdvice 제거: 칼바람 KDA 의미 사용(어시/데스) 죽은 함수 — 렌더 미호출 + 가드 위반이라 폐기 */
  function renderRecordReadingEmpty(msg,withLoad){
    $("#champpage").innerHTML='<div class="cp-wrap fortune-wrap"><button class="cp-back" id="rback" type="button">← 챔피언 통계</button><div class="fortune-empty">'+esc(msg)+(withLoad?'<button class="btn" id="rload" type="button">전적 불러오기</button>':'')+'</div></div>';
    document.body.classList.add("cp");
    $("#rback").onclick=navToList;
    var b=$("#rload");if(b)b.onclick=function(){closeChamp();$("#load").click();};
  }
  function openRecordReading(){
    navGo({t:"reading"});
    ++_navSeq; // 사주풀이(동기 렌더)로 전환 시 대기중 fetch 무효화(상세분석 fetch가 사주풀이 위 덮는 것 방지)
    closeSettings();
    var rec=lastMe?(mode==="augment"?lastMe.augment:lastMe.standard):null;
    if(!lastMe){renderRecordReadingEmpty(modeLabel()+' 전적을 먼저 불러오면 포로가 현재 기록을 보고 풀이해 줍니다.',true);return;}
    // ★leagueOff여도 누적 기록이 있으면 풀이한다(2026-08-27 사용자 지적): /api/me 는 롤이 꺼져 있어도
    //   standard 누적 전적을 그대로 준다(전적 탭도 동일하게 표시). 예전엔 leagueOff 만으로 선차단해
    //   기록 17판을 갖고도 "롤을 켜라"가 떴다. 롤 안내는 기록이 정말 없을 때만.
    if(!rec||!rec.total){
      if(mode!=="augment"&&lastMe.leagueOff)renderRecordReadingEmpty('웹 버전에서는 [데모 체험] 버튼을 눌러 전적을 먼저 불러오면 포로가 사주풀이를 해줍니다!',true);
      else renderRecordReadingEmpty(modeLabel()+' 기록이 아직 없어서 풀이할 표본이 부족합니다.',true);
      return;
    }
    // ★단일 렌더 계약(2026-08-27): 예전엔 '즉시 반쪽 렌더 → 로드 후 통째 재렌더'라 들어갈 때마다
    //   임시 풀이(균형형 폴백·미해석 픽 이름)가 찰나 떴다가 진짜 풀이로 바뀌었다(재계산처럼 보여 김샘 — 사용자 지적).
    //   데이터(아이템/룬 맵·코호트 축통계)가 다 캐시돼 있으면 그 자리에서 1회만, 아니면 로딩 한 줄 후 1회만 그린다.
    var _ck=mode==="augment"?"augment":"standard";
    if(_itemMaps[mode||"standard"]&&(mode!=="standard"||_runeMap)&&_cohortStats[_ck]){renderRecordReading(rec);return;}
    $("#champpage").innerHTML='<div class="cp-wrap"><div class="cp-loading"><span class="spin"></span>포로 관상가가 풀이를 준비하는 중…</div></div>';
    document.body.classList.add("cp");
    var _tk=_navSeq,_done=false;
    function _fin(){if(_done)return;_done=true;if(_tk===_navSeq)renderRecordReading(rec);}
    Promise.all([loadItemMap(),mode==="standard"?loadRuneMap():Promise.resolve({}),loadCohortStats()]).then(_fin).catch(_fin);
    setTimeout(_fin,4000); // 전부 로컬 API(ms 단위)라 사실상 안 걸리는 안전판 — 넘기면 있는 것만으로 그린다(코호트 없으면 균형형 폴백, 재렌더는 안 함)
  }
  function downloadBlob(blob,name){var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},500);}
  function blobToDataUrl(blob){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(r.result)};r.onerror=reject;r.readAsDataURL(blob);});}
  async function inlineCaptureImages(root){
    var imgs=[].slice.call(root.querySelectorAll("img"));
    await Promise.all(imgs.map(async function(im){
      try{
        var src=im.getAttribute("src")||"";
        if(!src||src.indexOf("data:")===0)return;
        var res=await fetch(src,{cache:"force-cache",credentials:"same-origin"});
        if(!res.ok)throw new Error("image fetch failed");
        im.setAttribute("src",await blobToDataUrl(await res.blob()));
      }catch(_){
        im.setAttribute("src","data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E");
      }
    }));
  }
  function inlineCaptureStyles(src,dst){
    var cs=getComputedStyle(src),txt="";for(var i=0;i<cs.length;i++){var prop=cs[i];txt+=prop+":"+cs.getPropertyValue(prop)+";";}dst.setAttribute("style",txt);
    for(var j=0;j<src.children.length;j++)inlineCaptureStyles(src.children[j],dst.children[j]);
  }
  function elementToPngBlob(node){
    return new Promise(async function(resolve,reject){
      try{
        // 리스킨 v2: 캡처 전 애니메이션 settle(엔트런스=finish, 무한 장식=cancel) — 클릭 시점 무관 완성 화면 캡처(사이트 동형).
        try{var _anims=typeof node.getAnimations==="function"?node.getAnimations({subtree:true}):[];for(var _ai=0;_ai<_anims.length;_ai++){try{var _t=_anims[_ai].effect&&_anims[_ai].effect.getTiming?_anims[_ai].effect.getTiming():null;if(_t&&_t.iterations===Infinity)_anims[_ai].cancel();else _anims[_ai].finish();}catch(_e){}}}catch(_e){}
        var rect=node.getBoundingClientRect(),w=Math.ceil(Math.max(rect.width,node.scrollWidth)),h=Math.ceil(Math.max(rect.height,node.scrollHeight));
        var clone=node.cloneNode(true);inlineCaptureStyles(node,clone);
        (function stripAnim(el){if(el.nodeType===1){el.style.animation="none";el.style.transition="none";}for(var i=0;i<(el.children||[]).length;i++)stripAnim(el.children[i]);})(clone); // 인라인된 animation이 SVG 캡처에서 재생돼 t=0 프레임(투명/이동) 캡처되는 버그 차단(사이트 동형)
        await inlineCaptureImages(clone);
        clone.setAttribute("xmlns","http://www.w3.org/1999/xhtml");clone.style.width=w+"px";clone.style.minHeight=h+"px";
        var _ncs=getComputedStyle(node);if(!_ncs.backgroundImage||_ncs.backgroundImage==="none")clone.style.background=_ncs.backgroundColor||"#08111f"; // 그라디언트 배경 보존(리스킨 v2), 단색일 때만 폴백 덮기
        var xml=new XMLSerializer().serializeToString(clone);
        var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><foreignObject width="100%" height="100%">'+xml+'</foreignObject></svg>';
        var url=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"})),im=new Image();
        im.onload=function(){try{var scale=Math.max(.6,Math.min(1.6,window.devicePixelRatio||1.25,8192/Math.max(w,1),12000/Math.max(h,1))),c=document.createElement("canvas");c.width=Math.ceil(w*scale);c.height=Math.ceil(h*scale);var ctx=c.getContext("2d");ctx.scale(scale,scale);ctx.drawImage(im,0,0);URL.revokeObjectURL(url);stampSiteMark(c);c.toBlob(function(b){b?resolve(b):reject(new Error("PNG blob failed"));},"image/png");}catch(e){URL.revokeObjectURL(url);reject(e);}};
        im.onerror=function(){URL.revokeObjectURL(url);reject(new Error("?? ??? ?? ??"));};im.src=url;
      }catch(e){reject(e);}
    });
  }
  // 2026-07-02: 공유 PNG 우하단 사이트 주소 워터마크(사이트 app_v2.js amFortuneStampSiteMark와 동일 규칙). 실패해도 공유는 진행.
  function stampSiteMark(c){try{var ctx=c.getContext("2d");ctx.save();ctx.setTransform(1,0,0,1,0,0);var fs=Math.max(11,Math.min(18,Math.round(c.width/56)));ctx.font="600 "+fs+"px Pretendard, 'Malgun Gothic', Arial, sans-serif";ctx.textAlign="right";ctx.textBaseline="bottom";var pad=Math.round(fs*0.9);ctx.fillStyle="rgba(0,0,0,0.35)";ctx.fillText("aram-mayhem.com",c.width-pad+1,c.height-pad+1);ctx.fillStyle="rgba(255,255,255,0.62)";ctx.fillText("aram-mayhem.com",c.width-pad,c.height-pad);ctx.restore();}catch(e){}}
  function canvasBlob(c){return new Promise(function(resolve,reject){try{stampSiteMark(c);c.toBlob(function(b){b?resolve(b):reject(new Error("canvas blob failed"));},"image/png");}catch(e){reject(e);}});}
  function roundBox(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else{ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);}ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
  function wrapCanvasText(ctx,text,x,y,maxW,lineH,maxLines,align){
    text=String(text||"").replace(/\s+/g," ").trim();if(!text)return y;
    align=align||"left";function lineX(s){var w=ctx.measureText(s).width,dx=(align==="center")?(maxW-w)/2:(align==="right")?(maxW-w):0;return x+(dx>0?dx:0);}
    // 어절(공백) 단위 + 한글/공백없는 긴 어절은 글자 단위로도 쪼갬(한국어 긴 어절·공백없는 구간이 maxW 넘어 안 줄바꿈→넘침/잘림 방지).
    var line="",n=0,done=false;
    function emit(s){ctx.fillText(s,lineX(s),y);y+=lineH;n++;if(maxLines&&n>=maxLines){ctx.fillText("…",x+maxW-ctx.measureText("…").width,y-lineH);done=true;}}
    function flushWord(w){ // 한 어절을 (필요하면 글자 단위로) 현재 줄에 채워 넣음
      if(done)return;
      var cand=line?line+" "+w:w;
      if(ctx.measureText(cand).width<=maxW){line=cand;return;}
      if(line){emit(line);line="";if(done)return;} // 줄 비우고 다음 줄에서 다시 시도
      if(ctx.measureText(w).width<=maxW){line=w;return;}
      // 어절 자체가 한 줄보다 길다 → 글자 단위로 강제 분할
      var cur="";
      for(var k=0;k<w.length;k++){
        var c=w[k],test=cur+c;
        if(ctx.measureText(test).width>maxW&&cur){emit(cur);if(done)return;cur=c;}
        else cur=test;
      }
      line=cur;
    }
    var words=text.split(" ");
    for(var i=0;i<words.length&&!done;i++)flushWord(words[i]);
    if(!done&&line)ctx.fillText(line,lineX(line),y),y+=lineH;
    return y;
  }
  function shareChunksFromDom(target){
    var chunks=[],seen={};
    function add(sel,kind){[].slice.call(target.querySelectorAll(sel)).forEach(function(el){var t=String(el.innerText||el.textContent||"").replace(/\s+/g," ").trim();if(t&&!seen[t]){seen[t]=true;chunks.push({kind:kind,text:t});}});}
    add(".fortune-title h2","title");add(".fortune-title p","body");add(".fortune-stat","stat");add(".fortune-card","card");
    add(".fortune-section h4","head");add(".fortune-read","body");add(".fortune-fact","body");add(".fortune-pickbox","body");add(".fortune-duo-box","body");
    return chunks.slice(0,90);
  }
  async function fallbackRecordShareBlob(target){
    // 실캡처 경로(Electron/크롬 foreignObject taint) — ①분리 노드면 최신으로 재조회 ②애니메이션 settle 후 그리기(사이트 동형, 2026-07-08)
    if(target&&!target.isConnected)target=null;
    target=target||document.querySelector("#champpage .fortune-capture");
    if(!target)throw new Error("no capture target");
    try{var _as=typeof target.getAnimations==="function"?target.getAnimations({subtree:true}):[];for(var _ai2=0;_ai2<_as.length;_ai2++){try{var _tt=_as[_ai2].effect&&_as[_ai2].effect.getTiming?_as[_ai2].effect.getTiming():null;if(_tt&&_tt.iterations===Infinity)_as[_ai2].cancel();else _as[_ai2].finish();}catch(_e2){}}}catch(_e2){}
    function visible(el){var cs=getComputedStyle(el),r=el.getBoundingClientRect();return cs.display!=="none"&&cs.visibility!=="hidden"&&+cs.opacity!==0&&r.width>1&&r.height>1;}
    function opaque(c){return c&&c!=="transparent"&&!/rgba?\(0,\s*0,\s*0,\s*0\)/.test(c)&&!/rgba?\([^)]*,\s*0\)/.test(c);}
    function tameBorder(c){var m=String(c||"").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);if(!m)return "#253653";var r=+m[1],g=+m[2],b=+m[3];return (r+g+b>570)?"#253653":c;}
    function num(v){return Math.max(0,parseFloat(v)||0);}
    function relRect(el,base){var r=el.getBoundingClientRect();return {x:r.left-base.left+target.scrollLeft,y:r.top-base.top+target.scrollTop,w:r.width,h:r.height};}
    // 그라데이션/반투명/투명 배경이라 backgroundColor가 비-불투명인 주요 컨테이너에 깔 기본 패널색(투명해서 안 보이던 박스 해소).
    //   .fortune-title/.fortune-poro/.fortune-closing=gradient → backgroundColor=rgba(0,0,0,0)이라 안 그려지던 것들 포함.
    var PANEL_CLASSES=["fortune-title","fortune-poro","fortune-closing","fortune-section","fortune-card","fortune-radar","fortune-radar-art","fortune-radar-item","fortune-fact","fortune-duo-box","fortune-read","fortune-pickbox","fortune-stat"];
    function hasPanelClass(el){var cl=el&&el.classList;if(!cl)return false;for(var i=0;i<PANEL_CLASSES.length;i++)if(cl.contains(PANEL_CLASSES[i]))return true;return false;}
    function drawBox(el,base){
      var cs=getComputedStyle(el),r=relRect(el,base);
      if(r.y>11900||r.w<2||r.h<2)return;
      var bg=cs.backgroundColor,bd=tameBorder(cs.borderTopColor),bw=num(cs.borderTopWidth),rad=num(cs.borderTopLeftRadius);
      if(opaque(bg))roundBox(ctx,r.x,r.y,r.w,r.h,Math.min(rad,24),bg,null);
      else if(hasPanelClass(el))roundBox(ctx,r.x,r.y,r.w,r.h,Math.min(rad,24),"#0d1830",null); // 그라데이션/투명 배경 주요 패널 → 기본 다크 패널색(투명해서 안 보이던 박스)
      if(bw>0&&opaque(bd)){ctx.save();ctx.strokeStyle=bd;ctx.lineWidth=Math.min(2,bw);if(ctx.roundRect){ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,Math.min(rad,24));ctx.stroke();}else{roundBox(ctx,r.x,r.y,r.w,r.h,Math.min(rad,24),"rgba(0,0,0,0)",bd);}ctx.restore();}
      else if(bw>0&&hasPanelClass(el)){ctx.save();ctx.strokeStyle="#253653";ctx.lineWidth=1;if(ctx.roundRect){ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,Math.min(rad,24));ctx.stroke();}else{roundBox(ctx,r.x,r.y,r.w,r.h,Math.min(rad,24),"rgba(0,0,0,0)","#253653");}ctx.restore();} // 반투명 보더 → 기본 보더색
    }
    async function drawImageEl(imEl,base){
      try{
        if(!visible(imEl))return;
        var src=imEl.currentSrc||imEl.src||"";
        // ITERATION_2 B: 교차출처(ddragon 챔프/아이템/파편)도 crossOrigin="anonymous"로 로드해 그린다(canvas 오염 안 됨).
        //   crossorigin 로드 실패(onerror) 시에만 스킵 → 비오염 폴백(회귀 0). 글자 폴백으로 깨지던 버그 제거.
        var isData=src.indexOf("data:")===0;
        var im=await new Promise(function(resolve){var i=new Image();if(!isData)i.crossOrigin="anonymous";i.onload=function(){resolve(i)};i.onerror=function(){resolve(null)};i.src=src;});
        if(!im)return;
        var r=relRect(imEl,base);
        ctx.save();
        var cs2=getComputedStyle(imEl),rad=num(cs2.borderTopLeftRadius);
        if(rad&&ctx.roundRect){ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,rad);ctx.clip();}
        // object-fit:contain 재현 — 종횡비 보존 레터박스(정사각 박스의 레이더 육각형 좌우눌림 방지). cover/fill/기본은 기존 채우기(정사각 아이콘 무영향).
        var ft=String(cs2.objectFit||"").toLowerCase(),nw=im.naturalWidth||0,nh=im.naturalHeight||0,dx=r.x,dy=r.y,dw=r.w,dh=r.h;
        if((ft==="contain"||ft==="scale-down")&&nw>0&&nh>0){var s2=Math.min(r.w/nw,r.h/nh);dw=nw*s2;dh=nh*s2;dx=r.x+(r.w-dw)/2;dy=r.y+(r.h-dh)/2;}
        ctx.drawImage(im,dx,dy,dw,dh);
        ctx.restore();
      }catch(_){}
    }
    function textOf(el){var s="";for(var i=0;i<el.childNodes.length;i++){var nd=el.childNodes[i];if(nd.nodeType===3)s+=nd.nodeValue;}return s.replace(/\s+/g," ").trim();} // 직계 텍스트만 — 자식 요소(별명 em·"최대 5개" span)는 각자 그림(중복 인쇄 방지, v3)
    function drawTextEl(el,base){
      if(!visible(el))return;
      var t=textOf(el);if(!t)return;
      var cs=getComputedStyle(el),r=relRect(el,base),fs=num(cs.fontSize)||16,lh=num(cs.lineHeight)||Math.round(fs*1.35);
      if(r.y>11900||r.w<6||r.h<6)return;
      // 칸 안 글자 위치 정합: 패딩+테두리(내용 시작점)·text-align(가운데/오른쪽)을 반영해 그린다.
      //   (기존엔 테두리박스 좌상단에 좌측정렬로만 그려 칩 글자 -9px·맺음말 등 가운데정렬 -40px 어긋났음)
      var padL=num(cs.paddingLeft)+num(cs.borderLeftWidth),padR=num(cs.paddingRight)+num(cs.borderRightWidth),padT=num(cs.paddingTop)+num(cs.borderTopWidth);
      var cw=Math.max(20,r.w-padL-padR),al=String(cs.textAlign||"").toLowerCase();
      al=(al==="center")?"center":(al==="right"||al==="end")?"right":"left";
      ctx.fillStyle=cs.color||"#eaf1ff";
      ctx.font=(cs.fontWeight||"600")+" "+fs+"px "+(cs.fontFamily||"Malgun Gothic, Arial");
      ctx.textBaseline="top";
      var domLines=Math.max(1,Math.round((r.h-padT)/lh));
      if(domLines<=1||/nowrap/.test(cs.whiteSpace)){var cw1=Math.max(0,r.w-padL-padR),tw=ctx.measureText(t).width,tx=r.x+padL;if(al==="center")tx=r.x+padL+(cw1-tw)/2;else if(al==="right")tx=r.x+padL+(cw1-tw);ctx.fillText(t,tx,r.y+padT);} // 한 줄 요소(레이더 점수 등)는 통째로 — 서브픽셀 측정차로 "40"→"4/0" 갈라짐 방지. 정렬은 실제 내용폭(cw의 20px 하한이 좁은 가운데정렬 요소를 오른쪽으로 밀던 것, captureElementBlob 동형)
      else{var maxLines=Math.max(1,Math.floor((r.h-padT)/lh)+1);wrapCanvasText(ctx,t,r.x+padL,r.y+padT,cw,lh,maxLines,al);}
    }
    var base=target.getBoundingClientRect(),W=Math.ceil(Math.max(base.width,target.scrollWidth)),H=Math.ceil(Math.min(12000,Math.max(base.height,target.scrollHeight))),scale=Math.max(.7,Math.min(1.5,window.devicePixelRatio||1.15,8192/Math.max(W,1),12000/Math.max(H,1)));
    var c=document.createElement("canvas"),ctx=c.getContext("2d");c.width=Math.ceil(W*scale);c.height=Math.ceil(H*scale);ctx.scale(scale,scale);
    var baseBg=getComputedStyle(target).backgroundColor;ctx.fillStyle=opaque(baseBg)?baseBg:"#0c1322";ctx.fillRect(0,0,W,H); // .fortune-capture는 배경 없음(투명) → 페이지 다크색으로 불투명 베이스 보장(투명 PNG 방지)
    [target].concat([].slice.call(target.querySelectorAll("*"))).forEach(function(el){if(visible(el))drawBox(el,base);});
    var imageEls=[].slice.call(target.querySelectorAll("img"));
    for(var ii=0;ii<imageEls.length;ii++)await drawImageEl(imageEls[ii],base);
    var textSel=".fortune-kicker,.fortune-title h2,.fortune-nick,.fortune-title p,.fortune-oneliner,.fortune-tag,.fortune-chip,.fortune-poro span,.fortune-stat span,.fortune-stat b,.fortune-card span,.fortune-card b,.fortune-card p,.fortune-radar-side h4,.fortune-radar-side p,.fortune-radar-item span,.fortune-radar-item b,.fortune-section h4,.fortune-read-title,.fortune-read-axis,.fortune-read-lead,.fortune-read-sub,.fortune-read-body,.fortune-fact span,.fortune-fact b,.fortune-fact em,.fortune-pickbox h5,.fortune-pickbox h5 span,.fortune-pickcol h6,.fortune-pick-main strong,.fortune-pick-main small,.fortune-pick-cue,.fortune-pick-empty,.fortune-closing p"; // v3: 직계텍스트 방식 + 정본 픽 마크업 반영(.fp-* 폐기, .fortune-nick 추가)
    [].slice.call(target.querySelectorAll(textSel)).forEach(function(el){drawTextEl(el,base);});
    return canvasBlob(c);
  }
  async function shareRecordReading(){
    var b=$("#rshare"),target=$("#champpage .fortune-capture");if(!b||!target)return;var old=b.textContent;b.disabled=true;b.textContent="\uC774\uBBF8\uC9C0 \uBCF5\uC0AC \uC911";
    try{var blob;try{blob=await elementToPngBlob(target);}catch(e){console.warn("[record-share] dom capture failed, fallback canvas",e);blob=await fallbackRecordShareBlob($("#champpage .fortune-capture")||target);}if(navigator.clipboard&&window.ClipboardItem){try{await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);b.textContent="\uBCF5\uC0AC\uB428 \u00B7 \uCE74\uD1A1/\uB514\uC2A4\uCF54\uB4DC/\uAC8C\uC2DC\uAE00\uC5D0 \uBD99\uC5EC\uB123\uAE30";}catch(_){downloadBlob(blob,"aram-mayhem-reading.png");b.textContent="\uC800\uC7A5\uB428 \u00B7 \uC774\uBBF8\uC9C0\uB97C \uC5C5\uB85C\uB4DC\uD558\uC138\uC694";}}else{downloadBlob(blob,"aram-mayhem-reading.png");b.textContent="\uC800\uC7A5\uB428 \u00B7 \uC774\uBBF8\uC9C0\uB97C \uC5C5\uB85C\uB4DC\uD558\uC138\uC694";}}
    catch(e){b.textContent="\uCEA1\uCC98 \uC2E4\uD328 \u00B7 \uB2E4\uC2DC \uB20C\uB7EC\uC8FC\uC138\uC694";}
    setTimeout(function(){b.disabled=false;b.textContent=old;},2600);
  }
  // 지표 분석표 이미지 복사 — elementToPngBlob(foreignObject)은 Chrome에서 canvas를 오염시켜 toBlob 실패 → 범용 폴백 captureElementBlob 사용.
  //   분석표 아이콘은 전부 same-origin /img 프록시라 수동 canvas 그리기에서 오염 없이 그려짐(사주 전용 fallbackRecordShareBlob은 .fortune-* 하드코딩이라 미사용).
  async function shareAnalysis(){
    var b=$("#anshare"),target=$("#champpage .an-capture");if(!b||!target)return;var old=b.textContent;b.disabled=true;b.textContent="\uC774\uBBF8\uC9C0 \uBCF5\uC0AC \uC911";
    try{var blob=await captureElementBlob(target);
      if(navigator.clipboard&&window.ClipboardItem){try{await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);b.textContent="\uBCF5\uC0AC\uB428 \u00B7 \uCE74\uD1A1/\uB514\uC2A4\uCF54\uB4DC/\uAC8C\uC2DC\uAE00\uC5D0 \uBD99\uC5EC\uB123\uAE30";}catch(_){downloadBlob(blob,"aram-mayhem-analysis.png");b.textContent="\uC800\uC7A5\uB428 \u00B7 \uC774\uBBF8\uC9C0\uB97C \uC5C5\uB85C\uB4DC\uD558\uC138\uC694";}}
      else{downloadBlob(blob,"aram-mayhem-analysis.png");b.textContent="\uC800\uC7A5\uB428 \u00B7 \uC774\uBBF8\uC9C0\uB97C \uC5C5\uB85C\uB4DC\uD558\uC138\uC694";}}
    catch(e){console.warn("[analysis-share] capture failed",e);b.textContent="\uCEA1\uCC98 \uC2E4\uD328 \u00B7 \uB2E4\uC2DC \uB20C\uB7EC\uC8FC\uC138\uC694";}
    setTimeout(function(){b.disabled=false;b.textContent=old;},2600);
  }
  // 범용 DOM→PNG 폴백 — elementToPngBlob(foreignObject)의 Chrome canvas 오염을 피해 수동으로 그린다.
  //   불투명 배경/보더 박스 + 이미지(same-origin이라 오염 없음, 로드된 <img> 직접 그림) + 모든 요소의 직접 텍스트. 셀렉터 하드코딩 없음(어떤 뷰든 됨).
  async function captureElementBlob(target){
    var base=target.getBoundingClientRect();
    var W=Math.ceil(Math.max(base.width,target.scrollWidth)),H=Math.ceil(Math.min(12000,Math.max(base.height,target.scrollHeight)));
    var scale=Math.max(.9,Math.min(2,window.devicePixelRatio||1.3,8192/Math.max(W,1),12000/Math.max(H,1)));
    var c=document.createElement("canvas"),ctx=c.getContext("2d");c.width=Math.ceil(W*scale);c.height=Math.ceil(H*scale);ctx.scale(scale,scale);
    function num(v){return Math.max(0,parseFloat(v)||0);}
    function opaque(col){return !!col&&col!=="transparent"&&!/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(col)&&!/rgba?\([^)]*,\s*0\s*\)/.test(col);}
    var baseBg=getComputedStyle(target).backgroundColor;ctx.fillStyle=opaque(baseBg)?baseBg:"#0c1322";ctx.fillRect(0,0,W,H);
    function rel(el){var r=el.getBoundingClientRect();return {x:r.left-base.left,y:r.top-base.top,w:r.width,h:r.height};}
    function vis(el){var cs=getComputedStyle(el),r=el.getBoundingClientRect();return cs.display!=="none"&&cs.visibility!=="hidden"&&+cs.opacity!==0&&r.width>0.5&&r.height>0.5;}
    // ── CSS 재현 보조: 캔버스에 직접 그리는 방식이라 아래 4가지는 따로 처리해야 원본과 같아진다.
    //    (안 하면 공유 이미지에서 막대·등급 테두리·팀 색띠가 통째로 사라지고 숫자가 뭉친다 — 실제 증상)
    function gradFill(el,cs,r,rad){ // ① linear-gradient 배경(딜 막대, 팀 헤더 띠)
      var bi=String(cs.backgroundImage||""); if(bi.indexOf("linear-gradient")<0)return false;
      var inner=bi.slice(bi.indexOf("linear-gradient(")+16); var depth=1,end=0;
      for(var i=0;i<inner.length;i++){var ch=inner[i];if(ch==="(")depth++;else if(ch===")"){depth--;if(!depth){end=i;break;}}}
      inner=inner.slice(0,end);
      var parts=[],buf="",d2=0;
      for(var j=0;j<inner.length;j++){var c2=inner[j];if(c2==="(")d2++;if(c2===")")d2--;if(c2===","&&!d2){parts.push(buf.trim());buf="";}else buf+=c2;}
      if(buf.trim())parts.push(buf.trim());
      var deg=90; if(/^-?[\d.]+deg$/.test(parts[0])){deg=parseFloat(parts[0]);parts.shift();}
      else if(/^to\s/.test(parts[0])){deg=/right/.test(parts[0])?90:/left/.test(parts[0])?270:/top/.test(parts[0])?0:180;parts.shift();}
      var stops=parts.map(function(p){var m2=p.match(/^((?:rgba?\([^)]*\))|#[0-9a-f]{3,8}|[a-z]+)\s*(?:([\d.]+)%)?$/i);return m2?{c:m2[1],p:m2[2]!=null?+m2[2]/100:null}:null;}).filter(Boolean);
      if(stops.length<2)return false;
      var rad2=(deg-90)*Math.PI/180,cx=r.x+r.w/2,cy=r.y+r.h/2,L=(Math.abs(r.w*Math.cos(rad2))+Math.abs(r.h*Math.sin(rad2)))/2;
      var g=ctx.createLinearGradient(cx-Math.cos(rad2)*L,cy-Math.sin(rad2)*L,cx+Math.cos(rad2)*L,cy+Math.sin(rad2)*L);
      stops.forEach(function(s2,i2){var pos=s2.p!=null?s2.p:(i2/(stops.length-1));try{g.addColorStop(Math.max(0,Math.min(1,pos)),s2.c);}catch(e){}});
      roundBox(ctx,r.x,r.y,r.w,r.h,rad,g,null); return true;
    }
    function insetShadow(cs,r,rad){ // ② box-shadow: inset → 안쪽 테두리(아이템칸·증강 등급색·내 행 강조)
      var sh=String(cs.boxShadow||""); if(sh==="none"||sh.indexOf("inset")<0)return;
      var segs=[],buf="",d3=0;
      for(var i=0;i<sh.length;i++){var c3=sh[i];if(c3==="(")d3++;if(c3===")")d3--;if(c3===","&&!d3){segs.push(buf);buf="";}else buf+=c3;}
      if(buf)segs.push(buf);
      segs.forEach(function(s3){ if(s3.indexOf("inset")<0)return;
        var col=(s3.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i)||[])[1]; if(!col||!opaque(col))return;
        var nums=(s3.replace(/rgba?\([^)]*\)/g,"").match(/-?[\d.]+px/g)||[]).map(parseFloat);
        var ox=nums[0]||0,oy=nums[1]||0,spread=nums[3]||0,thick=Math.abs(spread)||Math.max(Math.abs(ox),Math.abs(oy))||1;
        ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=thick;
        if(Math.abs(ox)>0.5&&!spread){ ctx.beginPath(); ctx.moveTo(r.x+thick/2,r.y); ctx.lineTo(r.x+thick/2,r.y+r.h); ctx.stroke(); } // inset 2px 0 0 → 왼쪽 줄
        else if(ctx.roundRect){ ctx.beginPath(); ctx.roundRect(r.x+thick/2,r.y+thick/2,Math.max(0,r.w-thick),Math.max(0,r.h-thick),Math.max(0,rad-thick/2)); ctx.stroke(); }
        ctx.restore(); });
    }
    /* ★2026-09-13 ④ ::before/::after 의 배경(색 견본) — 의사요소는 DOM 에 없어 위 단계가 통째로 건너뛴다.
       결과판 피해 분해 범례(물리·마법·고정)의 두 색 그라데이션 견본이 공유 이미지에서 빈 칸으로 남던 자리다.
       글자가 없는(content:"") 견본만 대상으로 좁힌다 — 글자 의사요소까지 사각형으로 칠하면 안 된다. */
    function pseudoFill(el,r,rad){
      if(el.children.length)return;
      /* flex 배치일 때만 — ::before 는 앞, ::after 는 뒤로 위치가 정해진다. 그 밖은 어디에 놓일지 몰라 안 그린다.
         크기도 계산값이 px 로 확정된 것만 쓴다. 부모 상자를 통째로 칠했다가 레이더 범례("내 플레이/메타")의
         글자를 색칠로 덮은 적이 있다 — 견본은 부모보다 훨씬 작다. */
      var cs6=getComputedStyle(el); if(String(cs6.display||"").indexOf("flex")<0)return;
      var flow=function(cs5){ var p=String(cs5.position||"static"); return p==="static"||p==="relative"; };   // 절대배치 의사요소는 어디에 놓일지 모른다 — 안 그린다
      var px=function(v){ var n=parseFloat(v); return (isFinite(n)&&n>0&&/px$/.test(String(v)))?n:0; };
      var draw=function(cs5,tail){
        if(!cs5||String(cs5.content||"")!=='""'||!opaque(cs5.backgroundColor)||!flow(cs5))return;
        var w5=px(cs5.width), h5=px(cs5.height); if(!w5||!h5)return;
        roundBox(ctx, tail?(r.x+r.w-w5):r.x, r.y+Math.max(0,(r.h-h5)/2), w5, h5, Math.min(rad,h5/2), cs5.backgroundColor, null);
      };
      draw(getComputedStyle(el,"::before"),false); draw(getComputedStyle(el,"::after"),true);
    }
    function sideBorders(cs,r){ // ③ 위쪽 말고 다른 방향만 있는 테두리(팀 승/패 색띠 = border-left)
      [["Top",r.x,r.y,r.x+r.w,r.y],["Right",r.x+r.w,r.y,r.x+r.w,r.y+r.h],["Bottom",r.x,r.y+r.h,r.x+r.w,r.y+r.h],["Left",r.x,r.y,r.x,r.y+r.h]].forEach(function(s4){
        var bw2=num(cs["border"+s4[0]+"Width"]),col=cs["border"+s4[0]+"Color"];
        if(bw2<=0||!opaque(col)||String(cs["border"+s4[0]+"Style"]||"")==="none")return;
        ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=bw2;
        var off=bw2/2,dx4=(s4[0]==="Left")?off:(s4[0]==="Right")?-off:0,dy4=(s4[0]==="Top")?off:(s4[0]==="Bottom")?-off:0;
        ctx.beginPath(); ctx.moveTo(s4[1]+dx4,s4[2]+dy4); ctx.lineTo(s4[3]+dx4,s4[4]+dy4); ctx.stroke(); ctx.restore(); });
    }
    /* ★2026-09-13 SVG 내부는 여기서 빼고 아래에서 통째로 한 장으로 그린다.
       안 빼면 SVG 안의 <text>(골드 그래프 축 눈금)만 HTML 좌표로 다시 찍혀 그래프 없이 숫자만 떠다닌다. */
    var isSvgPart=function(el){ return !!el.ownerSVGElement || String(el.tagName||"").toLowerCase()==="svg"; };
    var els=[target].concat([].slice.call(target.querySelectorAll("*"))).filter(function(el){ return !isSvgPart(el); });
    els.forEach(function(el){ if(!vis(el))return; var cs=getComputedStyle(el),r=rel(el); if(r.y>11950||r.w<2||r.h<2)return;
      var rad=Math.min(num(cs.borderTopLeftRadius),24);
      if(opaque(cs.backgroundColor))roundBox(ctx,r.x,r.y,r.w,r.h,rad,cs.backgroundColor,null);
      gradFill(el,cs,r,rad);
      pseudoFill(el,r,rad);
      var bw=num(cs.borderTopWidth);
      if(bw>0&&opaque(cs.borderTopColor)&&num(cs.borderBottomWidth)===bw&&num(cs.borderLeftWidth)===bw){ctx.save();ctx.strokeStyle=cs.borderTopColor;ctx.lineWidth=Math.min(2,bw);if(ctx.roundRect){ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,rad);ctx.stroke();}ctx.restore();}
      else sideBorders(cs,r); // 사방 균일이 아니면 변별로(옛 코드는 위쪽 값으로 사각형을 그려 한쪽만 있는 테두리를 놓쳤다)
      insetShadow(cs,r,rad); });
    [].slice.call(target.querySelectorAll("img")).forEach(function(imEl){ if(!vis(imEl)||!imEl.complete||!imEl.naturalWidth)return; var r=rel(imEl); if(r.y>11950)return;
      var cs3=getComputedStyle(imEl); ctx.save(); var rad=num(cs3.borderTopLeftRadius); if(rad&&ctx.roundRect){ctx.beginPath();ctx.roundRect(r.x,r.y,r.w,r.h,rad);ctx.clip();}
      // object-fit:contain 재현 — 종횡비 보존 레터박스(레이더 육각형 좌우눌림 방지). cover/fill/기본은 기존 채우기.
      var ft=String(cs3.objectFit||"").toLowerCase(),nw=imEl.naturalWidth||0,nh=imEl.naturalHeight||0,dx=r.x,dy=r.y,dw=r.w,dh=r.h;
      if((ft==="contain"||ft==="scale-down")&&nw>0&&nh>0){var s3=Math.min(r.w/nw,r.h/nh);dw=nw*s3;dh=nh*s3;dx=r.x+(r.w-dw)/2;dy=r.y+(r.h-dh)/2;}
      try{ctx.drawImage(imEl,dx,dy,dw,dh);}catch(e){} ctx.restore(); });
    /* 인라인 <svg> — 이 렌더러는 HTML 박스·<img>·텍스트만 그린다. 결과판의 골드 차이 타임라인이
       인라인 SVG 라서 공유 이미지에서 통째로 빠졌다(실측: 공유본에 그래프 없음).
       직렬화해 data URI 이미지 한 장으로 그린다 — 안의 포탑·억제기 아이콘도 이미 data URI 라 같이 실린다.
       ⚠️ 지표 분석 레이더는 원래 <img src="data:image/svg+xml"> 라 위 img 단계가 그린다(건드리지 않는다). */
    var inlineSvgs=[].slice.call(target.querySelectorAll("svg"));
    for(var si=0;si<inlineSvgs.length;si++){
      var sv=inlineSvgs[si]; if(!vis(sv))continue; var rs=rel(sv); if(rs.y>11950||rs.w<2||rs.h<2)continue;
      try{
        var clone=sv.cloneNode(true);
        clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
        clone.setAttribute("xmlns:xlink","http://www.w3.org/1999/xlink");
        clone.setAttribute("width",String(Math.ceil(rs.w))); clone.setAttribute("height",String(Math.ceil(rs.h)));
        var svgTxt=new XMLSerializer().serializeToString(clone);
        var svgUrl="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svgTxt);
        var svgImg=await new Promise(function(res){ var x=new Image(); x.onload=function(){res(x)}; x.onerror=function(){res(null)}; x.src=svgUrl; });
        if(svgImg)ctx.drawImage(svgImg,rs.x,rs.y,rs.w,rs.h);
      }catch(e){}
    }
    /* ★2026-09-25 글자 조각을 화면에서 잰 폭에 맞춰 그린다. 화면은 고정폭 숫자(font-variant-numeric:tabular-nums)·자간으로
       그리는데 캔버스는 둘 다 모른다 → 공유 이미지에서 숫자가 화면보다 좁게 찍혀 "10 /12 /48"·"380,970  딜" 처럼 숫자 뒤가
       벌어졌다(실측: 전적 개요 KDA·팀 합계). 또 앞 공백까지 잰 자리에 공백을 뺀 글자를 찍어, 글자가 공백 폭만큼 앞당겨 찍혔다.
       ⇒ ① 앞뒤 공백을 뺀 글자만의 자리를 잰다 ② 고정폭 숫자는 숫자마다 같은 칸 가운데에, 그 밖은 폭 차이만큼 자간을 준다.
       ⚠️ 한 줄이고 차이가 설명되는 만큼일 때만(폭의 25%·3px + 화면 자간 + 숫자 폭 차이) — 잰 폭이 엉뚱하면 종전대로 그린다. */
    function glyphRect(nd){
      var s=String(nd.nodeValue||""), a=s.search(/\S/), b=s.length; if(a<0) return null;
      while(b>a&&/\s/.test(s.charAt(b-1))) b--;
      var rg=document.createRange(); rg.setStart(nd,a); rg.setEnd(nd,b); return rg.getBoundingClientRect();
    }
    var _tabGap={};
    function tabGap(){ var f=ctx.font; if(_tabGap[f]==null){ var mx=0,mn=1e9; for(var q=0;q<10;q++){ var m=ctx.measureText(String(q)).width; if(m>mx)mx=m; if(m<mn)mn=m; } _tabGap[f]=Math.max(0,mx-mn); } return _tabGap[f]; }   // 이 글꼴에서 가장 넓은 숫자 - 가장 좁은 숫자
    function fitText(txt,x,y,rr,fs,cs){
      var w=ctx.measureText(txt).width, d=rr?(rr.width-w):0, n=txt.length;
      var tab=/tabular/.test(String((cs&&cs.fontVariantNumeric)||"")), lsc=parseFloat(cs&&cs.letterSpacing)||0;   // 화면 자간(글자마다 뒤에 붙는다 · "normal" 은 0)
      var lim=Math.max(3,w*0.25)+Math.abs(lsc)*n;
      if(tab){ var dn=(txt.match(/\d/g)||[]).length; if(dn) lim+=dn*tabGap(); }   // "11" 처럼 좁은 숫자만 있으면 고정폭과의 차이가 크다
      if(!(rr&&rr.height<=fs*1.8&&Math.abs(d)>0.3&&Math.abs(d)<=lim)){ ctx.fillText(txt,x,y); return; }
      if(tab&&/\d/.test(txt)){   // 고정폭 숫자 — 화면처럼 숫자마다 같은 칸을 주고 그 칸 가운데에 찍는다
        var digs=0, other=0, i, ch;
        for(i=0;i<n;i++){ ch=txt.charAt(i); if(ch>="0"&&ch<="9") digs++; else other+=ctx.measureText(ch).width; }
        var A=(rr.width-other)/digs, cx=x;
        if(A>0){ for(i=0;i<n;i++){ ch=txt.charAt(i); var cw=ctx.measureText(ch).width;
          if(ch>="0"&&ch<="9"){ ctx.fillText(ch,cx+(A-cw)/2,y); cx+=A; } else { ctx.fillText(ch,cx,y); cx+=cw; } } return; }
      }
      if(n===1){ ctx.fillText(txt,x+(lsc?0:d/2),y); return; }
      if("letterSpacing" in ctx){ ctx.letterSpacing=(lsc?d/n:d/(n-1)).toFixed(2)+"px"; ctx.fillText(txt,x,y); ctx.letterSpacing="0px"; return; }   // 화면 자간이 있으면 끝 글자 뒤에도 붙은 폭이다
      ctx.fillText(txt,x,y);
    }
    /* ★2026-09-25 그림 위에 얹힌 딱지(절대 배치)의 바탕을 그림 **다음에** 한 번 더 칠한다.
       위에서 상자를 전부 먼저 칠하고 그림을 나중에 그려서, 챔피언 초상화 위 레벨 딱지("18")의 어두운 바탕이 그림에 덮여
       공유 이미지에선 숫자가 초상화 위에 맨몸으로 찍혔다(실측: 전적 개요 10줄 전부). 화면에선 절대 배치가 그림보다 위다.
       ⚠️ 그림 안에 들어가는 작은 것(그림 넓이의 60% 미만)만 — 큰 배경 상자를 그림 위에 덮지 않게. */
    (function(){
      var imgR=[].slice.call(target.querySelectorAll("img")).filter(function(im){ return vis(im)&&im.complete&&im.naturalWidth; }).map(rel);
      if(!imgR.length) return;
      els.forEach(function(el){ if(!vis(el)) return; var cs7=getComputedStyle(el); if(cs7.position!=="absolute"||!opaque(cs7.backgroundColor)) return;
        var r7=rel(el); if(r7.w<2||r7.h<2||r7.y>11950) return;
        var on=imgR.some(function(q){ return r7.x>=q.x-1&&r7.y>=q.y-1&&r7.x+r7.w<=q.x+q.w+1&&r7.y+r7.h<=q.y+q.h+1&&r7.w*r7.h<q.w*q.h*0.6; });
        if(on) roundBox(ctx,r7.x,r7.y,r7.w,r7.h,Math.min(num(cs7.borderTopLeftRadius)||num(cs7.borderTopRightRadius),24),cs7.backgroundColor,null); });
    })();
    els.forEach(function(el){ if(!vis(el))return;
      var direct="",tnodes=[],hasEl=false;
      for(var i=0;i<el.childNodes.length;i++){var nd=el.childNodes[i];
        if(nd.nodeType===3){direct+=nd.nodeValue; if(String(nd.nodeValue).trim())tnodes.push(nd);}
        else if(nd.nodeType===1)hasEl=true; }
      direct=direct.replace(/\s+/g," ").trim(); if(!direct)return;
      var cs0=getComputedStyle(el);
      // ★부모의 직속 텍스트가 자식 요소들과 한 줄에 섞여 있으면(예: <b>61</b> 킬<i></i><b>282,392</b> 딜)
      //   부모 rect 한 곳에 몰아 그리면 "킬 딜 골드"처럼 뭉친다. 텍스트 조각마다 실제 위치를 Range 로 재서 그린다.
      if(hasEl&&tnodes.length){
        var fs0=num(cs0.fontSize)||14;
        ctx.fillStyle=cs0.color||"#eaf1ff";
        ctx.font=(cs0.fontStyle&&cs0.fontStyle!=="normal"?cs0.fontStyle+" ":"")+(cs0.fontWeight||"600")+" "+fs0+"px "+(cs0.fontFamily||"Malgun Gothic, Arial");
        ctx.textBaseline="top";
        var drew=0;
        tnodes.forEach(function(nd2){
          var txt=String(nd2.nodeValue).replace(/\s+/g," ").trim(); if(!txt)return;
          var rr; try{ rr=glyphRect(nd2); }catch(e){ return; }
          if(!rr||rr.width<1||rr.height<1)return;
          var y0=rr.top-base.top+Math.max(0,(rr.height-fs0*1.2)/2);
          if(y0>11950)return;
          fitText(txt,rr.left-base.left,y0,rr,fs0,cs0); drew++;
        });
        if(drew)return; // 조각별로 그렸으면 통짜 그리기는 건너뛴다
      }
      var cs=cs0,r=rel(el); if(r.y>11950||r.w<2||r.h<2)return; // 폭 4px 미만도 그린다 — KDA 의 "/" 같은 한 글자가 통째로 빠지던 것
      var fs=num(cs.fontSize)||14,lh=num(cs.lineHeight)||Math.round(fs*1.35);
      var padL=num(cs.paddingLeft)+num(cs.borderLeftWidth),padR=num(cs.paddingRight)+num(cs.borderRightWidth),padT=num(cs.paddingTop)+num(cs.borderTopWidth),padB=num(cs.paddingBottom)+num(cs.borderBottomWidth);
      var cw=Math.max(16,r.w-padL-padR),al=String(cs.textAlign||"").toLowerCase(); al=(al==="center")?"center":(al==="right"||al==="end")?"right":"left";
      ctx.fillStyle=cs.color||"#eaf1ff"; ctx.font=(cs.fontStyle&&cs.fontStyle!=="normal"?cs.fontStyle+" ":"")+(cs.fontWeight||"600")+" "+fs+"px "+(cs.fontFamily||"Malgun Gothic, Arial"); ctx.textBaseline="top";
      var domLines=Math.max(1,Math.round((r.h-padT-padB)/lh)); // 실제 DOM 줄 수(반올림)
      // 한 줄 정렬은 실제 내용폭으로 — cw의 16px 하한을 그대로 쓰면 KDA의 "/"(4px) 같은 좁은 가운데정렬 요소가 (16-4)/2≈6px 오른쪽으로 밀려 다음 숫자 위에 겹쳐 찍힌다(실제 증상). 하한은 줄바꿈 폭 가드로만 유지.
      if(domLines<=1||/nowrap/.test(cs.whiteSpace)){ var cw1=Math.max(0,r.w-padL-padR),one=direct;
        /* ★2026-09-13 원본이 말줄임(text-overflow:ellipsis + overflow:hidden)이면 캡처도 같은 자리에서 잘라야 한다.
           안 자르고 전체를 그리면 긴 소환사명이 칸 밖으로 넘쳐 옆 챔피언 아이콘 위에 겹쳐 찍힌다(실측: 전적 개요 내 행). */
        if(/ellipsis/.test(String(cs.textOverflow||""))&&/hidden|clip/.test(String(cs.overflowX||cs.overflow||""))&&cw1>0&&ctx.measureText(one).width>cw1){
          while(one.length>1&&ctx.measureText(one+"…").width>cw1) one=one.slice(0,-1);
          one+="…";
        }
        var tw=ctx.measureText(one).width,tx=r.x+padL,ty=r.y+padT; if(al==="center")tx=r.x+padL+(cw1-tw)/2; else if(al==="right")tx=r.x+padL+(cw1-tw);
        /* ★2026-09-13 ::before 색 견본(범례의 짧은 선·점)이 앞에 놓이면 글자는 그만큼 오른쪽에서 시작한다.
           박스 왼쪽부터 그리면 글자가 견본 위에 겹쳐 찍힌다(실측: 지표 분석 "내 플레이 / 메타").
           의사요소는 DOM 에 없어 계산으로는 알 수 없으니, 글자 자체의 실제 렌더 위치를 Range 로 재서 맞춘다. */
        var fitR=null;
        if(tnodes.length===1){ try{ var rr0=glyphRect(tnodes[0]);
          if(rr0&&rr0.width>0.5&&rr0.height>0.5){ tx=rr0.left-base.left; ty=rr0.top-base.top+Math.max(0,(rr0.height-fs*1.2)/2); if(one===direct) fitR=rr0; } }catch(e){} }   // 말줄임으로 자른 글자는 폭을 맞추지 않는다
        fitText(one,tx,ty,fitR,fs,cs); } // 한 줄·nowrap 은 줄바꿈 없이 그린다(KDA·라벨 깨짐 방지)
      else wrapCanvasText(ctx,direct,r.x+padL,r.y+padT,cw,lh,domLines,al); });
    return canvasBlob(c);
  }
  // 링크 공유 — 캡처한 PNG를 로컬 서버(/api/share)→ingest 워커→공개 R2에 올리고 URL을 클립보드로. 사주·지표 공용.
  function copyText(t){ if(navigator.clipboard&&navigator.clipboard.writeText){ return navigator.clipboard.writeText(t); } return new Promise(function(res,rej){ try{ var ta=document.createElement("textarea"); ta.value=t; ta.style.cssText="position:fixed;left:-9999px;opacity:0"; document.body.appendChild(ta); ta.select(); var ok=document.execCommand&&document.execCommand("copy"); ta.remove(); ok?res():rej(new Error("copy")); }catch(e){ rej(e); } }); }
  async function captureFortuneBlob(){ var t=$("#champpage .fortune-capture"); if(!t) return null; try{ return await elementToPngBlob(t); }catch(e){ try{ return await fallbackRecordShareBlob($("#champpage .fortune-capture")||t); }catch(_){ return null; } } } // 폴백은 최신 노드로(재렌더 레이스)
  // 공유 페이지(/r/<id>)용 렌더 스냅샷 업로드(v3) — 캡처 DOM을 그대로 올려 링크가 살아있는(애니메이션) 풀이 페이지로 열리게(사이트 amFortuneShareMeta 동형).
  async function postShareMeta(id,target){
    try{
      var h2=target.querySelector(".fortune-title h2");
      // 스냅샷 다이어트: 포로 data URI(≈680KB)는 제거(페이지가 사이트 자산으로 대체), 로컬 /img 프록시는 원본 URL로 복원, 대형 data URI는 레이더 SVG만 허용.
      var clone=target.cloneNode(true);
      var poroImg=clone.querySelector(".fortune-poro img"); if(poroImg)poroImg.setAttribute("src","");
      [].forEach.call(clone.querySelectorAll("img"),function(im){
        var s=im.getAttribute("src")||"";
        var m=s.match(/^\/img\?u=(.+)$/); if(m){try{im.setAttribute("src",decodeURIComponent(m[1]));}catch(e){}return;}
        if(s.indexOf("data:")===0&&s.length>8000&&!im.closest(".fortune-radar-art"))im.setAttribute("src","");
      });
      var meta={v:2,kind:"fortune",mode:(mode==="augment"?"augment":"standard"),modeLabel:modeLabel(),
        title:String((h2&&h2.textContent)||"전적 사주풀이").replace(/\s+/g," ").trim(),
        html:clone.outerHTML,w:Math.round(target.getBoundingClientRect().width)||980};
      var body=JSON.stringify({id:id,data:meta});
      if(body.length>250000)return false;
      var r=await fetch("/api/share-meta",{method:"POST",headers:{"Content-Type":"application/json"},body:body});
      var j=await r.json().catch(function(){return null;});
      return !!(j&&j.ok);
    }catch(e){ return false; }
  }
  // 공유 페이지(/r/<id>) 제목·문구용 가벼운 메타(스냅샷 HTML 없음). 경기 상세·상세 분석 링크가
  //   이걸 안 보내면 사이트가 종류를 몰라 전부 "전적 사주풀이 — 포로 관상가"로 뜬다.
  async function postShareMetaLite(id, meta){
    try{ var r=await fetch("/api/share-meta",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id,data:meta})});
      var j=await r.json().catch(function(){return null;}); return !!(j&&j.ok); }catch(e){ return false; }
  }
  async function shareLinkFromBlob(b, blob, metaTarget, metaLite){
    if(!b) return; var old=b.getAttribute("data-lbl")||"링크 복사"; b.disabled=true; b.textContent="링크 만드는 중";
    try{
      if(!blob){ b.textContent="캡처 실패 · 다시"; }
      else{
        var res=await fetch("/api/share",{method:"POST",headers:{"Content-Type":"image/png"},body:blob});
        var j=await res.json().catch(function(){return null;});
        if(j&&j.ok&&j.url){
          var sid=j.id||((String(j.url).match(/\/i\/([0-9a-f]{6,64})/)||[])[1]||"");
          if(sid&&metaTarget){ try{ await postShareMeta(sid,metaTarget); }catch(_){} } // 실패해도 진행 — /r 페이지가 PNG 폴백 표시
          else if(sid&&metaLite){ try{ await postShareMetaLite(sid,metaLite); }catch(_){} } // 스냅샷 없는 종류(경기 상세·상세 분석)는 제목/종류만
          var pageUrl=sid?String(j.url).replace("/i/"+sid,"/r/"+sid):j.url;
          try{ await copyText(pageUrl); b.textContent="링크 복사됨 · 붙여넣기"; }catch(_){ b.title=pageUrl; b.textContent="링크 생성됨(수동복사)"; }
        }
        else if(j&&j.error==="too-large"){ b.textContent="이미지가 커요 · 필터로 줄여요"; }
        else{ b.textContent="링크 실패 · 다시"; }
      }
    }catch(e){ b.textContent="링크 실패 · 다시"; }
    setTimeout(function(){ b.disabled=false; b.textContent=old; },3400);
  }
  async function shareRecordLink(){ var b=$("#rlink"); if(!b) return; b.disabled=true; b.textContent="캡처 중"; var blob=await captureFortuneBlob(); shareLinkFromBlob(b, blob, $("#champpage .fortune-capture")); }
  async function shareAnalysisLink(){ var b=$("#anlink"); if(!b) return; b.disabled=true; b.textContent="캡처 중"; var blob=null; try{ blob=await captureElementBlob($("#champpage .an-capture")); }catch(e){}
    shareLinkFromBlob(b, blob, null, {v:2,kind:"analysis",mode:(mode==="augment"?"augment":"standard"),modeLabel:modeLabel(),title:modeLabel()+" 상세 분석"}); }
  // 경기 상세 이미지/링크 공유 — 분석표와 동일 파이프라인(captureElementBlob). 경기상세 아이콘도 전부 /img 프록시라 오염 없음.
  // 전적 개요(10인) 표도 공유물에 함께 담는다(사용자 지시) — 캡처 대상 .match-capture 안에 있으므로 그대로 그려진다.
  //   표가 아직 로딩 중이면 그 자리만 비므로, 행(·증강 칼바람 MMR)이 붙을 때까지 최대 6초 기다렸다가 캡처한다.
  async function waitScoreboard(ms){
    var t0=Date.now(),lim=ms||5000,nap=function(){return new Promise(function(r){setTimeout(r,120);});};
    while(Date.now()-t0<lim){ var b=$("#sbbox"); if(b&&(b.querySelector(".sb-row")||b.querySelector(".sb-empty"))) break; await nap(); } // ① 행이 붙을 때까지
    /* ★2026-09-25 ③ 증강 칼바람 MMR 칸·팀 평균이 채워질 때까지 — 안 기다리면 공유 이미지에 "…" 가 그대로 박힌다.
       채워지면서 새로 붙는 티어 딱지는 바로 아래 ② 가 다 뜰 때까지 기다린다. */
    while(Date.now()-t0<lim){ var b1=$("#sbbox"); if(!b1||!b1.querySelector(".sb-wait")) break; await nap(); }
    /* ★2026-09-25 ⑤ '지표 분석(분당)' 의 챔피언 메타가 붙을 때까지(못 받았으면 openMatchDetail 이 "none" 으로 적는다).
       메타는 따로 늦게 와서, 상세를 열자마자 복사하면 공유 이미지에 "메타 0" 이 박혔다(실측: 표만 채워지고 0.7초 만에 복사). */
    while(Date.now()-t0<lim){ var rb=$("#mdradar"); if(!rb||rb.getAttribute("data-meta")) break; await nap(); }
    /* ★2026-09-13 ② 아이콘 대기를 캡처 대상 전체로 넓힌다 — 전적 개요만 보고 있어서, 그 아래 '게임 통계'의
       룬·증강·아이템이 아직 로딩 중이면 공유 이미지에서 빈 칸으로 박혔다(실측: 일반 칼바람 '이 경기 룬' 6칸이 비었다). */
    /* ★2026-09-25 ④ 아직 안 불러온 "나중에 불러오기"(loading=lazy) 그림은 지금 바로 불러오게 한다 — 화면 아래(이 경기 증강 등)에 있으면
       스크롤하기 전엔 안 받아서 ② 가 상한까지 기다린 뒤 그 칸을 비운 채 캡처했다(실측: 창 밖 증강 아이콘 4개). */
    try{ var bl=$("#champpage .match-capture"); if(bl) [].slice.call(bl.querySelectorAll('img[loading="lazy"]')).forEach(function(x){ if(!x.complete) x.loading="eager"; }); }catch(_){}
    while(Date.now()-t0<lim){ var b2=$("#champpage .match-capture")||$("#sbbox"); if(!b2) return; var im=[].slice.call(b2.querySelectorAll("img"));
      if(!im.length||im.every(function(x){return x.complete;})) return; await nap(); } // ② 아이콘이 다 뜰 때까지(빈 칸으로 박히지 않게)
  }
  async function captureMatchBlob(target){ return captureElementBlob(target); }
  async function shareMatch(){
    var b=$("#mdshare"),target=$("#champpage .match-capture");if(!b||!target)return;var old=b.textContent;b.disabled=true;b.textContent="이미지 복사 중";
    try{await waitScoreboard(6000);var blob=await captureMatchBlob(target);   // 6초 = 10명 행(①) + 증강 칼바람 MMR(③) + 아이콘(②)
      if(navigator.clipboard&&window.ClipboardItem){try{await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);b.textContent="복사됨 · 카톡/디스코드/게시글에 붙여넣기";}catch(_){downloadBlob(blob,"aram-mayhem-match.png");b.textContent="저장됨 · 이미지를 업로드하세요";}}
      else{downloadBlob(blob,"aram-mayhem-match.png");b.textContent="저장됨 · 이미지를 업로드하세요";}}
    catch(e){console.warn("[match-share] capture failed",e);b.textContent="캡처 실패 · 다시 눌러주세요";}
    setTimeout(function(){b.disabled=false;b.textContent=old;},2600);
  }
  async function shareMatchLink(){ var b=$("#mdlink"); if(!b) return; b.disabled=true; b.textContent="캡처 중"; var blob=null; try{ await waitScoreboard(6000); blob=await captureMatchBlob($("#champpage .match-capture")); }catch(e){}
    // 제목 = 챔피언 + 승/패 + 시각 + 모드. .cn 에는 멀티킬·KDA 도 같이 들어 있어 직속 텍스트(챔프명)와 .res 만 추린다.
    var cn=$("#champpage .cp-head .cn"), md=$("#champpage .cp-head .meta"), champ="", res="";
    if(cn){ for(var ci=0;ci<cn.childNodes.length;ci++){ var nd=cn.childNodes[ci]; if(nd.nodeType===3) champ+=nd.nodeValue; }
      champ=champ.replace(/\s+/g," ").trim(); var rs=cn.querySelector(".res"); res=rs?rs.textContent.trim():""; }
    var when=((md&&md.textContent)||"").replace(/\s+/g," ").trim();
    var t=[ (champ+(res?" "+res:"")).trim(), when, modeLabel() ].filter(Boolean).join(" · ");
    shareLinkFromBlob(b, blob, null, {v:2,kind:"match",mode:(mode==="augment"?"augment":"standard"),modeLabel:modeLabel(),title:t||"경기 상세"}); }
  /* ── 경기 상세(⑧): 전적 클릭 → 그 경기 룬(일반)/증강(증강) + 지표 ── */
  var _itemMap=null,_itemMaps={},_itemMapLoading={};
  function loadItemMap(){
    var key=mode||"standard";
    if(_itemMaps[key]){_itemMap=_itemMaps[key];return Promise.resolve(_itemMap);}
    if(_itemMapLoading[key])return _itemMapLoading[key].then(function(m){_itemMap=m;return m;});
    _itemMapLoading[key]=fetch("/api/items?mode="+encodeURIComponent(key)).then(function(r){return r.json()}).then(function(list){
      var m={};(list||[]).forEach(function(it){if(it&&it.id!=null)m[it.id]={name:it.name||it.localName||"",icon:it.icon||""};});
      _itemMaps[key]=m;_itemMap=m;return m;
    }).catch(function(){_itemMaps[key]={};_itemMap=_itemMaps[key];return _itemMap;});
    return _itemMapLoading[key];
  }
  var _runeMap=null,_runeMapLoading=null;
  function loadRuneMap(){
    if(_runeMap)return Promise.resolve(_runeMap);
    if(_runeMapLoading)return _runeMapLoading;
    _runeMapLoading=fetch("https://ddragon.leagueoflegends.com/cdn/16.12.1/data/ko_KR/runesReforged.json").then(function(r){return r.json()}).then(function(styles){
      var m={};(styles||[]).forEach(function(st){m[st.id]={name:st.name,icon:st.icon};(st.slots||[]).forEach(function(sl){(sl.runes||[]).forEach(function(rn){m[rn.id]={name:rn.name,icon:rn.icon,desc:(rn.shortDesc||rn.longDesc||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim()};});});});_runeMap=m;return m;
    }).catch(function(){_runeMap={};return _runeMap;});
    return _runeMapLoading;
  }
  try{loadRuneMap();}catch(e){} // 룬 호버 설명을 위해 앱 시작 시 룬맵 미리 로드(렌더 시점에 _runeMap 준비)
  var SHARD={5008:["적응형 능력치 파편","StatModsAdaptiveForceIcon"],5005:["공격 속도","StatModsAttackSpeedIcon"],5007:["스킬 가속","StatModsCDRScalingIcon"],5010:["이동 속도","StatModsMovementSpeedIcon"],5013:["강인함","StatModsTenacityIcon"],5001:["체력 비례","StatModsHealthScalingIcon"],5011:["체력","StatModsHealthPlusIcon"],5012:["체력","StatModsHealthPlusIcon"]};
  function runeImg(id){var d=_runeMap&&_runeMap[id];if(d&&d.icon)return '<img class="ri" src="/img?u='+encodeURIComponent("https://ddragon.leagueoflegends.com/cdn/img/"+d.icon)+'" title="'+esc(d.name||"")+'" loading="lazy">';var sh=SHARD[id];if(sh)return '<img class="ri shard" src="/img?u='+encodeURIComponent("https://ddragon.leagueoflegends.com/cdn/img/perk-images/StatMods/"+sh[1]+".png")+'" title="'+esc(sh[0])+'" loading="lazy">';return "";}
  /* ── 경기 상세 "전체(10인)" 스코어보드 ─────────────────────────────────────
     그 한 판의 5:5 전원을 op.gg식 표로. 데이터는 /api/match-team 이 각자 PC의 LCU 에서
     그 경기 하나만 받아온다(내 PC 전용 파일에 의존하지 않음 → 어느 PC에서나 동일하게 뜬다).
     ⚠️ 열 구성은 두 모드가 같고 빌드 칸만 증강↔룬으로 바뀐다. 값이 없는 칸은 '–' 로 두고 지어내지 않는다. */
  // 맨 앞 32px = 등수/MVP·ACE 배지 자리. 아이템은 7칸 → 6칸(맨 우측 포로 간식 자리를 없앴다)으로 줄여 그 폭을 여기로 돌렸다.
  /* ★2026-09-25 증강 칼바람만 — 운영자 지시: "피해 감소 회복 CC 이 3열을 삭제하고 남은 공간만큼 골고루 공간을 활용하도록 하며,
       증강 아이템들의 열은 그대로 두고 나머지 … 열들을 적절히 칸에 맞춰 배치하고, MMR열을 하나 신설 … 위치는 등수 왼쪽"
     열 = MMR · 등수 · 챔피언 · 소환사 · KDA · 가한 피해 · 받은 피해 · 증강(120px 그대로) · 아이템(154px 그대로).
     남는 폭은 소환사·KDA·가한 피해·받은 피해가 나눠 갖는다(소환사가 1.5몫 — 긴 이름이 잘리던 칸). 최소 폭 합이 줄어
     창을 가장 좁혔을 때(960)도 표가 상자 밖으로 안 넘친다. 일반 칼바람(SB_COLS_S)은 그대로다(운영자 선택: 증강 칼바람만). */
  var SB_COLS_A="64px 42px 58px minmax(80px,1.5fr) minmax(84px,1fr) minmax(96px,1fr) minmax(88px,1fr) 120px 154px";
  var SB_COLS_S="38px 58px minmax(72px,1fr) 86px 96px 84px 74px 62px 40px 144px 154px";
  /* 전적 개요 MMR — 한 판 10명을 한 번에 묻고(/api/mmr-many), 표는 기다리지 않고 먼저 그린 뒤 값이 오면 그 칸만 채운다.
     _sbMmr.res = { p:{ "이름#태그":[MMR,판수,등수,티어]|null }, tiers, basePeople } — 이번에 연 그 판(gid)의 것만 쓴다. */
  var _sbMmr={tk:0,gid:"",res:null};
  function sbMmrId(r){ var n=r&&r.name?String(r.name).trim():'', t=r&&r.tag?String(r.tag).trim():''; return (n&&t)?(n+'#'+t):''; }   // 태그가 없으면 다른 사람일 수 있다 — 찾지 않는다
  function sbTeamKey(r){ return String((r.team==null||r.team!==r.team)?"?":r.team); }
  function _sbTierImg(t){ if(t==null||t==="")return ''; var i=Number(t); if(!isFinite(i)||i<0||i>9)return ''; return '<img class="sb-tier" src="'+_MMR_TIER_IMG[i]+'" alt="'+_MMR_TIER_NAME[i]+'" width="22" height="22">'; }
  // 평균 점수 → 티어 딱지. 아래 일곱 칸은 조회표 경계(cuts), 위 세 칸은 그 칸 막내의 점수(명단 minMmr) — 사이트가 실어 보낸 값 그대로.
  function sbTierOfScore(v,T){ if(!T||!T.cuts||!T.cuts.length||!isFinite(v))return null;
    if(T.chal!=null&&v>=T.chal)return 9; if(T.gm!=null&&v>=T.gm)return 8; if(T.master!=null&&v>=T.master)return 7;
    for(var i=0;i<T.cuts.length;i++) if(v<T.cuts[i]) return i; return T.cuts.length; }
  function sbMmrRes(gid){ return (_sbMmr.res&&_sbMmr.gid===String(gid==null?"":gid))?_sbMmr.res:null; }
  function sbMmrCell(r,i,gid){
    var R=sbMmrRes(gid), id=sbMmrId(r), v=(R&&id&&R.p)?R.p[id]:null, inner, tip='';
    if(!id) inner='<span class="sb-dash">-</span>';                        // 이름·태그가 없는 줄 — 찾을 수 없다
    else if(!R) inner='<span class="sb-wait">…</span>';                   // 묻는 중
    else if(!v) inner='<span class="sb-dash">-</span>';                   // 조회표에 없다(10판 미만·아직 집계 전) = 모름
    else { inner=_sbTierImg(v[3])+'<b>'+v[0]+'</b>';
      var rk=Number(v[2])||0, tot=Number(R.basePeople)||0, g=(Number(v[1])||0).toLocaleString()+'판 반영됨';
      tip=' title="'+esc((rk&&tot)?(tot.toLocaleString()+'명 중 '+rk.toLocaleString()+'등 / '+g):g)+'"'; }   // 커서 줄 = 최근 경기 MMR 배지와 같은 문장
    return '<span class="sb-mmr" data-mi="'+i+'"'+tip+'>'+inner+'</span>';
  }
  function sbAvgHtml(t,k,gid){
    var R=sbMmrRes(gid), inner, tip='';
    if(!R) inner='<span class="sb-wait">…</span>';
    else { var s=0,n=0; t.forEach(function(r){ var id=sbMmrId(r), v=(id&&R.p)?R.p[id]:null; if(v&&isFinite(+v[0])){ s+=+v[0]; n++; } });
      if(!n) inner='<span class="sb-dash">-</span>';                      // 이 팀에 MMR 을 아는 사람이 없다
      else { var avg=Math.round(s/n); inner=_sbTierImg(sbTierOfScore(avg,R.tiers))+'<b>'+avg+'</b>';
        tip=' title="'+(n===t.length?(n+'명 평균'):(t.length+'명 중 MMR 이 있는 '+n+'명의 평균'))+'"'; } }   // 모르는 사람은 빼고 아는 사람만 평균낸다
    return '<span class="sb-avg" data-tk="'+esc(k)+'"'+tip+'><span class="sb-avg-l">평균 MMR</span>'+inner+'</span>';
  }
  // 값이 오면 표를 다시 그리지 않고 MMR 칸과 팀 평균만 갈아끼운다(아이콘 수십 개를 다시 붙이며 깜빡이지 않게).
  function paintSbMmr(){
    var b=$("#sbbox"), d=_sbLast; if(!b||!d||String(d.gid==null?"":d.gid)!==_sbMmr.gid) return;
    var rows=d.rows||[];
    [].slice.call(b.querySelectorAll('.sb-mmr[data-mi]')).forEach(function(el){ var i=+el.getAttribute('data-mi'), r=rows[i]; if(r) el.outerHTML=sbMmrCell(r,i,d.gid); });
    [].slice.call(b.querySelectorAll('.sb-avg[data-tk]')).forEach(function(el){ var k=el.getAttribute('data-tk'); el.outerHTML=sbAvgHtml(rows.filter(function(r){return sbTeamKey(r)===k;}),k,d.gid); });
  }
  function loadSbMmr(d,tk){
    if(mode!=="augment"||!d) return;                                        // 일반 칼바람엔 MMR 이 없다
    var gid=String(d.gid==null?"":d.gid);
    if(_sbMmr.tk===tk&&_sbMmr.gid===gid) return;                           // 이번에 연 이 판은 이미 물었다
    _sbMmr={tk:tk,gid:gid,res:null};
    var ids=[]; (d.rows||[]).forEach(function(r){ var id=sbMmrId(r); if(id&&ids.indexOf(id)<0) ids.push(id); });
    var fin=function(R){ if(_sbMmr.tk!==tk||_sbMmr.gid!==gid) return; _sbMmr.res=R; paintSbMmr(); };
    if(!ids.length){ fin({p:{}}); return; }
    /* 응답이 영영 안 오면 "…" 로 굳지 않게 20초 뒤 모르는 것(" - ")으로 둔다. 그 뒤에 늦게 와도 받으면 채운다. */
    var got=false, to=setTimeout(function(){ if(!got) fin({p:{}}); },20000);
    fetch("/api/mmr-many",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:ids})})
      .then(function(r){return r.json();})
      .then(function(j){ got=true; clearTimeout(to); fin((j&&j.ok&&j.p)?j:{p:{}}); })
      .catch(function(){ got=true; clearTimeout(to); fin({p:{}}); });
  }
  function sbNum(v,max,kind,tail){var w=max>0?Math.max(2,Math.round((Number(v)||0)/max*100)):0;return '<span class="sb-n"><b>'+kfmt(v)+(tail||'')+'</b><span class="sb-bar '+kind+'"><i style="width:'+w+'%"></i></span></span>';} // tail = 숫자 바로 뒤에 붙일 것(증강 칼바람 "딜 1위")
  function sbRuneImg(id,i){var d=_runeMap&&_runeMap[id];var u=(d&&d.icon)?("https://ddragon.leagueoflegends.com/cdn/img/"+d.icon):"";return '<span class="sb-ru'+(i===0?' key':'')+'" title="'+esc((d&&d.name)||("룬 "+id))+'">'+(u?pim(u):'')+'</span>';}
  function sbEmpty(d){var why=(d&&d.reason==="no-lcu")?'롤 클라이언트를 켜면 그때 바로 받아옵니다.':'이 경기의 10인 기록을 찾지 못했어요.';return '<div class="sb-empty"><b>이 경기 전체 기록이 아직 없어요.</b><span>'+esc(why)+'</span></div>';}
  function sbHtml(d){
    var isAug=(mode==="augment"),cols=isAug?SB_COLS_A:SB_COLS_S,rows=d.rows||[];
    var mx=function(k){var m=0;rows.forEach(function(r){var v=Number(r[k])||0;if(v>m)m=v;});return m;};
    var M={dmg:mx("dmg"),taken:mx("taken")};
    var head=isAug
      ? '<div class="sb-head" style="grid-template-columns:'+cols+'"><span>MMR</span><span>등수</span><span>챔피언</span><span>소환사</span><span class="c">KDA</span><span>가한 피해</span><span>받은 피해</span><span>증강</span><span>아이템</span></div>'
      : '<div class="sb-head" style="grid-template-columns:'+cols+'"><span>등수</span><span>챔피언</span><span>소환사</span><span class="c">KDA</span><span>가한 피해</span><span>받은 피해</span><span class="c">피해 감소</span><span class="c">회복</span><span class="c">CC</span><span>룬</span><span>아이템</span></div>';
    // 같은 닉네임이라도 #태그가 다르면 다른 사람이다. 이름 칸이 좁으니 그 판에 동명이인이 있을 때만 태그를 붙이고,
    //   호버에는 항상 "이름#태그"를 넣는다(구분이 필요한 자리에서만 폭을 쓴다).
    function fullName(r){ return (r.name||'')+(r.tag?('#'+r.tag):''); }
    // 익명 토글 ON → 이 표의 닉네임(내 것 포함 10인 전부)을 가명으로 덮는다. 태그는 아예 안 붙이고 호버에도 가명만 남긴다.
    var alias=!!anonMode;
    function sbName(r){ if(!r.name) return ''; return alias?(anonAlias(r)||'익명'):r.name; }
    function sbTitle(r){ return alias?sbName(r):fullName(r); }
    var nameCount={},dupName={};
    rows.forEach(function(r){ if(!r.name)return; (nameCount[r.name]=nameCount[r.name]||[]).push(r.tag||''); });
    Object.keys(nameCount).forEach(function(n){ var s={},c=0; nameCount[n].forEach(function(t){ if(!s[t]){s[t]=1;c++;} }); if(c>1) dupName[n]=true; });
    // MVP = 이긴 팀 1등, ACE = 진 팀 1등 (전체 1~10등과는 별개로 팀별 최고 점수자)
    var bestOf={};
    rows.forEach(function(r){ var k=String(r.team); if(!bestOf[k]||r.score>bestOf[k].score) bestOf[k]=r; });
    // ★09-26 서버가 배지를 매겼으면(빈 값 포함) 서버 것만 — 등수 D 에선 팀 최고 점수자가 네 칸 모두 앞선 팀원 뒤로 밀릴 수 있어
    //   여기서 점수로 다시 고르면 한 팀에 MVP 가 둘 붙는다. 점수로 고르는 건 배지 없이 온 옛 응답에만.
    var srvBadge=rows.some(function(r){ return r&&Object.prototype.hasOwnProperty.call(r,'badge'); });
    var badgeOf=function(r){
      if(r.badge) return r.badge==='MVP'?'<i class="mvp">MVP</i>':'<i class="ace">ACE</i>'; // 서버가 매긴 값 우선
      if(srvBadge) return '';
      var b=bestOf[String(r.team)]; if(!b||b!==r) return ''; return r.win?'<i class="mvp">MVP</i>':'<i class="ace">ACE</i>'; };
    // ⚠️ 팀 묶기는 값 비교(===)로 하지 않는다. team 이 NaN/undefined 로 오면 비교가 전부 false 가 되어
    //    한 행도 못 그리고 머리글만 남는다(실제 증상). 한 번 훑으며 그룹에 담아 두면 그런 구멍이 없다.
    var groups=[];
    rows.forEach(function(r){
      var key=(r.team==null||r.team!==r.team)?"?":r.team;
      var g=null;for(var gi=0;gi<groups.length;gi++){if(groups[gi].key===key){g=groups[gi];break;}}
      if(!g){g={key:key,rows:[]};groups.push(g);}
      g.rows.push(r);
    });
    groups.sort(function(a,b){var am=a.rows.some(function(r){return r.mine;}),bm=b.rows.some(function(r){return r.mine;});return (bm?1:0)-(am?1:0);}); // 내 팀 먼저
    var out="";
    groups.forEach(function(g,ti){
      var t=g.rows;if(!t.length)return;
      var win=!!t[0].win,mine=!!t[0].mine,K=0,G=0,D=0,topD=0;
      t.forEach(function(r){K+=Number(r.k)||0;G+=Number(r.gold)||0;D+=Number(r.dmg)||0;if((Number(r.dmg)||0)>topD)topD=Number(r.dmg)||0;});
      out+=(ti?'<div class="sb-gap"></div>':'')+'<div class="sb-team '+(win?'win':'loss')+'"><span class="sb-res">'+(win?'승리':'패배')+'</span><span class="sb-side">'+(mine?'우리 팀':'상대 팀')+'</span>'+(isAug?sbAvgHtml(t,String(g.key),d.gid):'')+'<span class="sb-tot">'+(d.hasKda?'<b>'+K+'</b> 킬<i></i>':'')+'<b>'+kfmt(D)+'</b> 딜'+(G>0?'<i></i><b>'+kfmt(G)+'</b> 골드':'')+'</span></div>';
      out+=t.map(function(r){
        var build=isAug
          ? '<span class="sb-augs">'+(r.augments||[]).slice(0,4).map(function(a){return '<span class="sb-aug '+esc(a.rarity||'')+'" title="'+esc(a.name||('증강 '+a.id))+'">'+(a.icon?pim(a.icon):'')+'</span>';}).join('')+'</span>'
          : '<span class="sb-runes">'+(r.runeIds||[]).slice(0,6).map(sbRuneImg).join('')+'</span>';
        var items="";for(var i=0;i<6;i++){var u=(r.itemIcons||[])[i];items+='<span class="sb-is">'+(u?pim(u):'')+'</span>';} // 7번째(포로 간식) 칸 제거 — 그 폭을 등수 배지로
        return '<div class="sb-row '+(win?'win':'loss')+(r.me?' me':'')+'" style="grid-template-columns:'+cols+'">'
          +(isAug?sbMmrCell(r,rows.indexOf(r),d.gid):'')
          +'<span class="sb-rk">'+(r.rank?'<b>'+r.rank+'위</b>':'')+badgeOf(r)+'</span>'   // ★09-26 운영자 "등수에 커서를 얹었을 때 왜 그런 등수인지도 알리지 마" — 근거 글 없음
          +'<span class="sb-ch"><span class="sb-ci" title="'+esc(r.champName||'')+'">'+(r.champIcon?pim(r.champIcon):'')+(r.lvl?'<span class="sb-lv">'+r.lvl+'</span>':'')+'</span><span class="sb-sp">'+(r.spellIcons||[]).slice(0,2).map(function(su){return '<span class="sb-spi">'+pim(su)+'</span>';}).join('')+'</span></span>'
          +'<span class="sb-nm'+(r.name?'':' none')+'" title="'+esc(sbTitle(r))+'">'+esc(sbName(r)||'이름 없음')+((!alias&&dupName[r.name]&&r.tag)?'<i class="sb-tag">#'+esc(r.tag)+'</i>':'')+'</span>'
          +'<span class="sb-kda">'+(r.k==null?'<span class="sb-dash">–</span>':'<b>'+r.k+'</b><s>/</s><em>'+r.d+'</em><s>/</s><b>'+r.a+'</b><small>'+(r.d?((r.k+r.a)/r.d).toFixed(2):'Perfect')+(r.kp==null?'':'<u>관여 '+r.kp+'%</u>')+'</small>')+'</span>'
          +'<span class="sb-m">'+(isAug
            ? sbNum(r.dmg,M.dmg,'dmg',((Number(r.dmg)||0)===topD&&topD>0)?'<span class="sb-crown in" title="이 팀 최다 딜">딜 1위</span>':'')   // ★09-25 숫자 오른쪽에 나란히 — 위에 띄우면 숫자 끝을 5~10px 덮었다(실측)
            : sbNum(r.dmg,M.dmg,'dmg')+(((Number(r.dmg)||0)===topD&&topD>0)?'<span class="sb-crown" title="이 팀 최다 딜">딜 1위</span>':''))+'</span>'
          +'<span class="sb-m">'+sbNum(r.taken,M.taken,'taken')+'</span>'
          +(isAug?'':('<span class="sb-s">'+(r.mit==null?'<span class="sb-dash">–</span>':kfmt(r.mit))+'</span>'
          +'<span class="sb-s">'+(r.heal==null?'<span class="sb-dash">–</span>':kfmt(r.heal))+'</span>'
          +'<span class="sb-s">'+(r.cc==null?'<span class="sb-dash">–</span>':(Number(r.cc)||0))+'</span>'))   // 증강 칼바람은 이 3열을 뺐다(운영자 지시 09-25)
          +'<span class="sb-bd">'+build+'</span>'
          +'<span class="sb-it">'+items+'</span></div>';
      }).join('');
    });
    if(!out)return sbEmpty(d); // 어떤 이유로든 한 행도 못 그렸으면 머리글만 남기지 않는다
    /* ★09-26 운영자: "등수 = 선택 + 피지컬 · … 같은 말들은 사실 필요 없고" — 증강 칼바람은 등수 설명 줄을 안 그린다(재료를 못 읽어 옛 식으로 매긴 판도).
       일반 칼바람 설명 줄은 지목 밖이라 그대로. 예전 방식 저장분 안내는 등수 설명이 아니라 남긴다. */
    var _ft=[Number(d.queueId)===2400?'':'등수 = 딜·피해감소·회복·보호·CC·골드·CS·킬·어시·생존의 기대치 대비 초과분',
      d.partial?'이 경기는 예전 방식으로 저장돼 소환사명·KDA 칸이 비어 있어요 — 롤을 켜 두면 다시 받아옵니다.':''].filter(Boolean).join('<br>');
    return '<div class="sbtab">'+head+out+'</div>'+(_ft?'<div class="sb-foot">'+_ft+'</div>':'');
  }
  var _sbLast=null; // 마지막으로 그린 전적 개요 payload — 익명 토글이 바뀌면 재요청 없이 그 자리에서 다시 그린다
  function rerenderScoreboard(){ var b=$("#sbbox"); if(!b||!_sbLast)return; b.innerHTML='<h4>전적 개요</h4>'+sbHtml(_sbLast); }
  /* 결과판 — /api/match-team 이 주는 d.result 로 그린다(8892 와 같은 집계·같은 화면). */
  function paintResultPanel(d){
    var box=$("#rsbox"); if(!box) return;
    if(!d||!d.result||!d.result.blue||!d.result.red){ box.innerHTML=''; return; }
    try{ box.innerHTML=resultHtml({result:d.result,duration:d.duration,rows:d.rows||[],gid:d.gid||''}); animateBars(box); }
    catch(e){ box.innerHTML=''; }
  }
  function loadMatchTeam(gid,tk){
    var box=$("#sbbox");if(!box)return;
    var put=function(html){if(tk!==_navSeq)return;var b=$("#sbbox");if(b)b.innerHTML='<h4>전적 개요</h4>'+html;};
    if(!gid)return put(sbEmpty({reason:"no-gid"}));
    /* ★2026-09-23 응답이 영영 안 오면 이 칸이 '불러오는 중' 으로 굳는다(무한 로딩 제보와 같은 자리).
       25초면 못 받은 것으로 보고 이유를 적는다 — 그 뒤에 늦게 와도 그때 갈아끼운다(아래 put 은 늦은 응답도 받는다). */
    var sbDone=false;
    var sbTimer=setTimeout(function(){ if(!sbDone&&tk===_navSeq) put(sbEmpty({})); },25000);
    Promise.all([
      fetch("/api/match-team?mode="+encodeURIComponent(mode)+"&gid="+encodeURIComponent(gid)).then(function(r){return r.json();}).catch(function(){return null;}),
      loadRuneMap() // 룬 아이콘(일반 모드) — 아직 안 왔으면 여기서 기다린다
    ]).then(function(a){sbDone=true;clearTimeout(sbTimer);var d=a[0];var ok=(d&&d.ok&&d.found&&(d.rows||[]).length)?d:null;if(tk===_navSeq)_sbLast=ok;put(ok?sbHtml(ok):sbEmpty(d));
      if(tk===_navSeq) paintResultPanel(ok);   /* 결과판은 전적 개요와 같은 응답을 쓴다 — 호출이 늘지 않는다 */
      if(tk===_navSeq&&ok) loadSbMmr(ok,tk);   /* 증강 칼바람 MMR 열 — 표를 그린 뒤 10명을 한 번에 묻는다(표를 막지 않는다) */
    });
  }
  var _matchMetaCache={}; // 경기상세 지표분석용 챔프 메타 캐시(모드|이름)
  // ★2026-07-22: 히스토리에 배열 인덱스만 저장하던 것을 안정 키(gid, 없으면 이름|날짜|시간) 대조로 바꿨다.
  //   목록(recent 20개)은 3분 타이머·창 포커스 복귀마다 통째로 갱신되고, 새 경기가 앞에 끼면 인덱스가 통째로 밀린다.
  //   그래서 예전에 쌓아둔 {t:"match", i:N} 엔트리가 나중에 **전혀 다른 경기**를 열었다(사용자 신고: 자이라 보다가 세주아니).
  //   인자는 숫자(목록 클릭)와 객체(히스토리 복원) 둘 다 받는다.
  function matchKeyOf(m){ return m ? ((m.gid!=null&&m.gid!=="") ? ("g|"+m.gid) : ("k|"+(m.name||"")+"|"+(m.date||"")+"|"+(m.dur||""))) : ""; }
  function openMatchDetail(a){
    var rec=lastMe?(mode==="augment"?lastMe.augment:lastMe.standard):null;
    var list=(rec&&rec.recent)||[];
    var i, key=null;
    if(a&&typeof a==="object"){
      key=a.k||null;
      i=key?list.findIndex(function(x){return matchKeyOf(x)===key;}):(a.i|0);
      if(i<0){ closeAllDetail(); return; } // 목록에서 밀려난 경기 → 엉뚱한 경기를 여는 대신 목록으로
    } else i=a;
    var m=list[i];if(!m)return;
    navPush({t:"match",i:i,k:matchKeyOf(m)});
    var _tk=++_navSeq;
    function render(meta){
      var mk=m.mk>=2?' <span class="mk">'+(m.mk>=5?'펜타킬':m.mk>=4?'쿼드라킬':m.mk>=3?'트리플킬':'더블킬')+'</span>':'';
      var head=
        '<div class="cp-head">'+img(m.icon,"ci lg")+'<div><div class="cn">'+esc(m.name)+' <span class="res '+(m.win?'win':'loss')+'">'+(m.win?'승':'패')+'</span>'+mk+(m.kda?'<span class="md-hkda"><span>KDA</span>'+kda3(m.kda,false)+'</span>':'')+'</div><div class="meta">'+esc((m.date||'')+(m.dur?' '+m.dur:''))+'</div></div></div>'; // 상세: 월/일 MM:SS (자세히). KDA = 헤더 더블킬 우측(부가)
      // 칼바람 의미지표(KDA·골드·받은피해 무의미 제외): 가한 피해 + 피해감소·회복·실드·CC(데이터 있을 때만 노출, 없으면 생략). 게임시간은 헤더에.
      // 지표 = 챔피언 통계와 동일 지표분석 육각형(이 경기 분당 vs 챔프 메타). 6카드 그리드 폐기(공간낭비).
      var dm=String(m.dur||'').split(':'),durMin=(Number(dm[0])||0)+(Number(dm[1])||0)/60;
      var pm=function(v){return (durMin>0&&v!=null)?Math.round((Number(v)||0)/durMin):null;};
      var d={dpm:pm(m.dmg),gpm:pm(m.gold),taken:pm(m.taken),mit:(m.mit==null?null:pm(m.mit)),heal:(m.heal==null?null:pm(m.heal)),cc:(m.cc==null||durMin<=0?null:+((Number(m.cc)||0)/durMin).toFixed(1))};
      if(meta){d.metaDpm=meta.metaDpm;d.metaGpm=meta.metaGpm;d.metaTank=meta.metaTank;d.metaMit=meta.metaMit;d.metaHeal=meta.metaHeal;d.metaCc=meta.metaCc;}
      var radarBox='<div class="cp-box" id="mdradar"'+(meta?' data-meta="1"':'')+'><h4>지표 분석 (분당)</h4>'+impactRadarHtml(d)+'</div>';   // data-meta = 메타가 붙었다(이미지 복사가 이걸 기다린다 · 아래 waitScoreboard ⑤)
      // 우측: 이 경기 증강/룬(있으면) + 아이템 + 소환사 주문(좌측서 이동, 우측 남는공간 채움)
      var itemsH='<div class="ilab">아이템</div><div class="m-it">'+(m.items||[]).slice(0,7).map(function(u){return '<span class="islot">'+pim(u)+'</span>'}).join('')+'</div>';
      var spellsH='<div class="ilab">소환사 주문</div><div class="m-sp">'+(m.spells||[]).map(function(u){return '<span class="sp">'+pim(u)+'</span>'}).join('')+'</div>';
      var title,lead;
      if(mode==="augment"){var augs=m.augments||[];title='이 경기 증강';lead=augs.length?'<div class="md-augs">'+augs.map(function(a){return '<span class="md-aug">'+(a.icon?'<img src="/img?u='+encodeURIComponent(a.icon)+'" loading="lazy" onerror="this.remove()">':'')+'<span>'+esc(a.name)+'</span></span>'}).join('')+'</div>':'<div class="bnote">이 경기 증강 기록이 없어요.</div>';}
      else{var pk=m.perks;if(pk&&pk.ids&&pk.ids.length){title='이 경기 룬';lead='<div class="md-runes">'+pk.ids.map(runeImg).join('')+'</div>'+(pk.shards&&pk.shards.length?'<div class="md-shards">'+pk.shards.map(runeImg).join('')+'</div>':'');}else{title='이 경기 빌드';lead='<div class="bnote">이 경기는 룬 기록이 없어요.</div>';}}
      var rightBox='<div class="cp-box"><h4>'+title+'</h4>'+lead+itemsH+spellsH+'</div>';
      // 순서 = 헤더 → 전적 개요(10인) → 지표/룬·증강. 스코어보드는 .match-capture 안에 있지만
      // 공유 캡처(.match-capture)에도 함께 담긴다 — 이미지/링크 복사에 전적 개요가 같이 들어간다.
      /* ★2026-09-13 순서 = 헤더 → 전적 개요 → "게임 통계"(결과판 → 지표 분석·이 경기 증강).
         운영자 지시: "전적개요 아래에다가 게임 통계라고 만들라고. 그 아래에 저 blue red같은 지금 니가 만든
         내용들과 그 아래 지표분석(분당)이랑 이 경기 증강을 두면 된다"
         ⚠️ 전부 .match-capture 안에 있어야 이미지 복사·링크 복사에 같이 담긴다. */
      $("#champpage").innerHTML='<div class="cp-wrap"><div class="fortune-top"><button class="cp-back" id="mback" type="button">← 닫기</button><div class="share-actions"><button class="fortune-share" id="mdshare" type="button">이미지 복사</button><button class="fortune-share fortune-link" id="mdlink" type="button">링크 복사</button></div></div><div class="match-capture">'+head
        +'<div class="cp-box sb-box" id="sbbox"><h4>전적 개요</h4><div class="cp-loading"><span class="spin"></span>10명 전체를 불러오는 중</div></div>'
        +'<div class="cp-box rs-stats-box"><h4>게임 통계</h4><div id="rsbox"></div><div class="cp-grid g2">'+radarBox+rightBox+'</div></div>'
        +'</div></div>';
      document.body.classList.add("cp");$("#mback").onclick=navToList;if($("#mdshare"))$("#mdshare").onclick=shareMatch;if($("#mdlink"))$("#mdlink").onclick=shareMatchLink;
      loadMatchTeam(m.gid,_tk); // 지연 로드 — 상세 렌더를 막지 않는다
    }
    var ck=mode+'|'+(m.name||'');
    if(_matchMetaCache[ck]){if(_tk===_navSeq)render(_matchMetaCache[ck]);return;}
    /* ★2026-09-23 【누르면 무한 로딩】 외부 유저 제보. 예전엔 챔피언 메타(/api/mychamp)를 **받은 뒤에야** 상세를 그렸다.
       그 요청은 로컬 데이터가 없는 PC 에서 사이트 파일(가장 큰 것 18.6MB)까지 받아올 수 있고, 서버의 원격 상한이 180초다
       (한 요청에 파일이 여러 개면 그만큼 더). 내 PC 는 로컬 파일을 읽어 이 구간이 0초라 영영 못 겪는 증상이다.
       → 화면은 **바로** 그린다(이 경기 값은 이미 손에 있다). 메타는 도착하면 '지표 분석' 칸만 조용히 갈아끼운다.
       ⚠️ render() 를 두 번 부르지 않는다 — 다시 부르면 전적 개요(10인)를 또 받아오고 스크롤도 튄다. */
    /* ★2026-09-25 메타가 끝내 안 오거나 못 받으면 "없음" 으로 적는다 — 이미지 복사가 그걸 보고 기다림을 멈춘다(무한 대기 금지). */
    var _metaDone=function(v){ if(_tk!==_navSeq)return; var bx=$("#mdradar"); if(bx&&!bx.getAttribute("data-meta")) bx.setAttribute("data-meta",v); };
    render(null);
    fetch("/api/mychamp?mode="+mode+"&name="+encodeURIComponent(m.name||"")).then(function(r){return r.json();}).then(function(b){
      if(_tk!==_navSeq)return;
      if(!b){ _metaDone("none"); return; }
      _matchMetaCache[ck]=b;
      var box=$("#mdradar"); if(!box)return;
      var dm2=String(m.dur||'').split(':'),durMin2=(Number(dm2[0])||0)+(Number(dm2[1])||0)/60;
      var pm2=function(v){return (durMin2>0&&v!=null)?Math.round((Number(v)||0)/durMin2):null;};
      var d2={dpm:pm2(m.dmg),gpm:pm2(m.gold),taken:pm2(m.taken),mit:(m.mit==null?null:pm2(m.mit)),heal:(m.heal==null?null:pm2(m.heal)),cc:(m.cc==null||durMin2<=0?null:+((Number(m.cc)||0)/durMin2).toFixed(1))};
      d2.metaDpm=b.metaDpm;d2.metaGpm=b.metaGpm;d2.metaTank=b.metaTank;d2.metaMit=b.metaMit;d2.metaHeal=b.metaHeal;d2.metaCc=b.metaCc;
      box.innerHTML='<h4>지표 분석 (분당)</h4>'+impactRadarHtml(d2); box.setAttribute("data-meta","1");
    }).catch(function(){ _metaDone("none"); });
  }
  // 내 챔피언 클릭 → 개인 빌드 페이지(메타 아님): 내가 찍은 증강·아이템 + 내 승률 vs 메타
  function openMyChamp(name){
    navPush({t:"mychamp",name:name});
    var _tk=++_navSeq;
    $("#champpage").innerHTML=cpLoading();
    document.body.classList.add("cp");
    fetch("/api/mychamp?mode="+mode+"&name="+encodeURIComponent(name)).then(function(r){return r.json()}).then(function(d){if(_tk===_navSeq)renderMyChampPage(d);}).catch(function(){if(_tk===_navSeq)closeChamp();});
  }
  function renderMyChampPage(d){
    var _seq=_navSeq; // ★스냅샷(++ 아님) — 늦게 오는 룬맵(외부 CDN) 응답이 그 사이 연 다른 상세를 덮지 않게. 형제 fetch 콜백과 동일 계약.
    lastMyChampData=d;
    amMetaBase=Number(d.winRate)||50; // ★검증된픽 기준선 = 이 챔프 평균 승률
    function sortBuild(arr){return buildMode==="win"?amSortItems(arr):amSortCommon(arr);} function runeSort(arr){return buildMode==="win"?amSortRunePick(arr):amSortCommon(arr);} /* 2026-07-11 최고승률=사이트 기여도(rankImpact): 아이템·증강=sortBuild(|기여도|↓ 고표본 스테이플 먼저) / 룬=runeSort(부호기여도↓ 최선 픽·지는 고표본 매장). 서버 정확승수 x.impact 사용 */
    function rwr(n,thin){return '<span class="iwr '+(thin?'':(n>=50?'good':'bad'))+'">'+n+'%</span>'}
    var bm=(buildMode==="win"?"최고 승률":"가장 흔한");
    var toggle='<div class="btoggle bt"><button data-bm="win" class="'+(buildMode==="win"?"on":"")+'" type="button">최고 승률</button><button data-bm="common" class="'+(buildMode==="common"?"on":"")+'" type="button">가장 흔한</button></div>';
    var head='<button class="cp-back" id="cpback2" type="button">← 챔피언 목록</button>'+
      '<div class="cp-head"'+splashStyle(d.icon)+'>'+img(d.icon,"ci lg")+'<div><div class="cn">'+esc(d.name)+' <span class="tier" style="background:rgba(154,123,240,.18);color:#c9b3f5;box-shadow:inset 0 0 0 1px rgba(154,123,240,.35)">내 빌드</span></div>'+
      '<div class="meta">내 승률 '+(Number(d.winRate)||0)+'% · '+kfmt(Number(d.games)||0)+'판 ('+kfmt(Number(d.wins)||0)+'승 '+kfmt((Number(d.games)||0)-(Number(d.wins)||0))+'패)</div></div>'+champHeaderKda(d.kda,d.metaKda)+(d.games?toggle:'')+'</div>'; // undefined/NaN 방어(다른PC·미플레이·데이터누락)
    if(!d.games){ /* #18 개인 기록 0판(다른 PC·미플레이 챔프)이면 빈 화면 대신 메타 빌드로 폴백 — 메타는 공유소스(사이트/번들)라 어느 PC에서든 로드됨. */ if(d.name){ openChamp(d.name,true); return; } $("#champpage").innerHTML='<div class="cp-wrap">'+head+'<div class="cp-box"><div class="blank">이 챔피언으로 한 기록이 없어요'+(mode!=="augment"?' (일반은 롤 켜고 불러와야 함)':'')+'.</div></div></div>'; document.body.classList.add("cp"); $("#cpback2").onclick=navToList; return; }
    function augGrid(arr,wch){return arr.length?'<div class="agrid" style="--acw:'+(wch||acWidthCh(arr))+'">'+arr.map(function(x){return '<div class="ac" title="'+esc(x.name+(x.desc?'\n'+x.desc:''))+'">'+img(x.icon,"ii")+'<span class="iwr '+(x.thin?'':(x.winRate>=50?'good':'bad'))+'">'+x.winRate+'%</span><span class="ig" title="'+kfmt(x.games)+'판">'+amMan(x.games)+'판</span></div>'}).join('')+'</div>':'<div class="blank">데이터 없음</div>'}
    function augGroups(arr){ // 내 증강 프리즘/골드/실버 등급 묶음(추천증강과 동일 규칙, rarity 없으면 평면 폴백)
      if(!arr||!arr.length) return '<div class="blank">데이터 없음</div>';
      var wch=acWidthCh(arr); // 등급 그룹이 나뉘어도 폭 기준은 전체 하나 — 프리즘/골드/실버 줄끼리 간격이 달라지지 않게
      if(!arr.some(function(x){return x.rarity})) return augGrid(arr,wch);
      var G=[["prismatic","프리즘","#e08bd0","pz"],["gold","골드","#f0c674","gd"],["silver","실버","#b9c4d6","sv"]],out="",first=true; // §12 #15 희귀도 클래스
      G.forEach(function(g){var sub=arr.filter(function(x){return String(x.rarity).toLowerCase()===g[0]});if(sub.length){out+='<div class="aug-t '+g[3]+'" style="font-size:16px;font-weight:700;color:'+g[2]+';margin:'+(first?0:11)+'px 0 6px">'+g[1]+'</div>'+augGrid(sub,wch);first=false;}});
      var rest=arr.filter(function(x){return !G.some(function(g){return String(x.rarity).toLowerCase()===g[0]})});if(rest.length){out+='<div class="aug-t" style="font-size:16px;font-weight:700;color:var(--mut);margin:'+(first?0:11)+'px 0 6px">기타</div>'+augGrid(rest,wch);}
      return out;
    }
    var its=sortBuild(d.items),core=its.slice(0,3),rest=its.slice(3,9);
    function ibi(x){return '<span class="ibi" title="'+esc(x.name+(x.desc?'\n'+x.desc:''))+'">'+pim(x.icon)+'</span>'}
    var coreH=core.length?'<div class="core-row">'+core.map(function(x){return '<div class="core">'+ibi(x)+'<span class="core-nm">'+esc(x.name)+'</span><span class="core-st"><b class="'+(x.thin?'':(x.winRate>=50?'good':'bad'))+'">'+x.winRate+'%</b><small title="'+kfmt(x.games)+'판">'+amMan(x.games)+'판</small></span></div>'}).join('')+'</div>':'<div class="blank">데이터 없음</div>'; /* §12 #17 개별 카드 — 이미 있는 x.name/x.winRate/x.games만 사용 */
    var restH=rest.length?'<div class="ib">'+rest.map(function(x){return '<div style="text-align:center">'+ibi(x)+'<div class="icap" title="'+kfmt(x.games)+'판">'+rwr(x.winRate,x.thin)+'<br>'+amMan(x.games)+'판</div></div>'}).join('')+'</div>':'';
    var cmp=function(l,a,b2){a=Number(a)||0;b2=Number(b2)||0;var hi=Math.max(a,b2,1),base=hi*0.45,den=(hi-base)||1;var pa=Math.max(4,Math.min(100,Math.round((a-base)/den*100))),pb=Math.max(4,Math.min(100,Math.round((b2-base)/den*100)));return '<div class="cl">'+l+'</div><div class="cr mine"><span class="ck">나</span><span class="cbar mine"><i style="width:'+pa+'%"></i></span><span class="cv">'+a+'</span></div><div class="cr"><span class="ck">메타</span><span class="cbar meta"><i style="width:'+pb+'%"></i></span><span class="cv">'+b2+'</span></div>'};
    var barsBox=impactRadarHtml(d); // 지표 분석 6축 육각형(나 vs 메타) — 사용자 지시. d=나(dpm/taken/gpm/mit/heal/cc)+메타(meta*)
    /* ★2026-09-18 잘 맞는 아군 숫자 = 그 아군의 승률이 아니라 **궁합**(둘이 같이 있을 때만 더 이기는 몫). 사이트 synBox 와 같은 표기. */
    var swr=function(x){if(x&&isFinite(x.lift)){var n=Math.round(x.lift*1000)/10;return '<span class="iwr '+(n>=0?'good':'bad')+'">'+(n>=0?'+':'')+n.toFixed(1)+'%</span>'}return rwr(x.winRate,x.thin)};
    var stip=function(x){return isFinite(x.lift)?(x.name+' · 같이 '+x.winRate+'% · '+kfmt(x.games||0)+'판'):(x.name+' · '+kfmt(x.games||0)+'판')};
    var synH=(d.synergies&&d.synergies.length)?'<div class="ib" style="gap:10px">'+d.synergies.slice(0,8).map(function(x){return '<div class="ally" style="text-align:center" title="'+esc(stip(x))+'">'+img(x.icon,"ci")+'<div class="icap">'+esc(x.name)+'<br>'+swr(x)+' <span class="g">'+amMan(x.games||0)+'판</span></div></div>'}).join('')+'</div>':'<div class="blank">데이터 없음</div>'; /* §12 #18 */
    var html=head;
    // 메타 챔프상세(renderChamp)와 동일 템플릿: gR[빌드 | 지표 분석], g2[아이템 | 잘 맞는 아군]. 데이터만 내 것. 사용자 지시(통일).
    var radarBox='<div class="cp-box"><h4>지표 분석 (분당)</h4>'+barsBox+'</div>';
    // 내 룬(일반) — 개별 전적/'내 룬' 분석탭과 똑같이 LCU서 수집된 x.perks 사용. 옛 "일반 룬은 LCU 미수집" 라벨은 오류(룬은 수집됨)여서 실제 대표 룬 페이지로 교체.
    var runeH='';
    if(mode!=="augment"){
      var rpg=(d.runes&&d.runes.length)?runeSort(d.runes)[0]:null; // 대표 룬 = 부호 기여도 최고(runeSort)
      if(rpg&&rpg.ids&&rpg.ids.length){
        runeH='<div class="ilab">내 룬 · '+bm+'</div><div class="build-runes"><div class="md-runes">'+rpg.ids.map(runeImg).join('')+'</div>'+(rpg.shards&&rpg.shards.length?'<div class="md-shards">'+rpg.shards.map(runeImg).join('')+'</div>':'')+'<div class="brune-st">'+rwr(rpg.winRate,rpg.thin)+' <span class="g">'+kfmt(rpg.games)+'판</span></div></div>';
      }else{
        runeH='<div class="bnote">이 챔프 룬 기록이 없어요.</div>';
      }
    }
    var itemBox='<div class="cp-box ci-box"><h4>내 아이템 · '+bm+'</h4><div class="ilab">핵심 아이템</div><div class="core-items">'+coreH+'</div><div class="ilab">그 외 아이템</div><div class="added-items">'+restH+'</div>'+runeH+'</div>';
    var allyBox='<div class="cp-box"><h4>잘 맞는 아군</h4>'+synH+'</div>';
    if(mode==="augment"){
      html+='<div class="cp-grid gR"><div class="cp-box"><h4>내 증강 · '+bm+'</h4>'+augGroups(sortBuild(d.augments).slice(0,12))+'</div>'+radarBox+'</div>';
      html+='<div class="cp-grid g2">'+itemBox+allyBox+'</div>';
    }else{
      html+='<div class="cp-grid gR">'+itemBox+radarBox+'</div>';
      html+='<div class="cp-grid">'+allyBox+'</div>';
    }
    $("#champpage").innerHTML='<div class="cp-wrap">'+html+'</div>';
    document.body.classList.add("cp");
    $("#cpback2").onclick=navToList;
    // 룬맵(runesReforged)이 아직 로드 전(null)이면 로드 후 1회만 재렌더 → 룬 아이콘 빈칸 방지. {}(로드실패)/로드완료면 재트리거 안 함(무한루프 방지).
    if(mode!=="augment"&&d.runes&&d.runes.length&&_runeMap===null){ loadRuneMap().then(function(){ if(_seq===_navSeq&&lastMyChampData===d) renderMyChampPage(d); }); }
    document.querySelectorAll("#champpage .btoggle button").forEach(function(b){b.onclick=function(){buildMode=b.dataset.bm;renderMyChampPage(lastMyChampData);}});
  }
  // ── 개인 상세 분석 12종 — /api/analysis, 각자 PC LCU 캐시(8896 로직 재구성).
  //    두 모드가 같은 항목·같은 갯수이고, 증강(q2400) 자리에 룬(q450)이 오는 것만 다르다 — anTabs 참조.
  //    일반의 아군/상대는 stdfull(상세 증분 수집)이 채워야 나온다 → d.ctxGames 로 표본을 정직하게 표기. ──
  var _anData=null,_anTab=null,_anHr="activeHour",_anSort="games",_anDir="desc"; // _anSort=games|winRate|delta, 기본 표본순 desc
  function openAnalysis(){navGo({t:"analysis"});closeSettings();var _tk=++_navSeq;$("#champpage").innerHTML=cpLoading();document.body.classList.add("cp");fetch("/api/analysis?mode="+mode).then(function(r){return r.json()}).then(function(d){if(_tk!==_navSeq)return;_anData=d;_anTab=null;renderAnalysis();}).catch(function(){if(_tk===_navSeq)closeChamp();});}
  // 정렬(요구①): 헤더 클릭으로 표본수/승률/영향 정렬, 기본 표본순. 데이터 복사본 정렬 + 판수 2차키.
  function anSortArr(a){var k=_anSort,dir=_anDir==="desc"?1:-1;return (a||[]).slice().sort(function(x,y){var xv,yv;if(k==="winRate"){xv=x.winRate;yv=y.winRate;}else if(k==="delta"){xv=x.delta==null?-1e9:x.delta;yv=y.delta==null?-1e9:y.delta;}else{xv=x.games;yv=y.games;}return (yv-xv)*dir||(y.games-x.games);});}
  function anTh(key,label){var on=_anSort===key;return '<button class="an-th'+(on?' on':'')+'" data-ansort="'+key+'" type="button">'+label+(on?'<i>'+(_anDir==="desc"?'▾':'▴')+'</i>':'')+'</button>';}
  function anHead(nameLabel,p2){return '<div class="an-thead'+(p2?' p2':'')+'"><span class="nmh">'+nameLabel+'</span>'+anTh("games","판수")+anTh("winRate","승률")+'</div>';} // 영향(Δ)열 제거 · p2=아이콘 2개 쌍 표
  // 탭 구성: 두 모드가 같은 항목·같은 갯수(12). 증강 자리를 룬이 대체하는 것만 다르다 —
  //   사이트 aram-mayhem.com이 q450(룬)/q2400(증강)을 다루는 대응 그대로.
  function anTabs(d){return d.mode==="augment"
    ?[["myAugments","내 증강"],["myItems","내 아이템"],["myChampAugments","내 챔피언 + 증강"],["myChampItems","내 챔피언 + 아이템"],["myAugmentItems","내 증강 + 아이템"],["allyItems","아군 아이템"],["enemyItems","상대 아이템"],["allyChampions","아군 챔피언"],["enemyChampions","상대 챔피언"],["allyAugments","아군 증강"],["enemyAugments","상대 증강"],["time","시간대"]]
    :[["myRunes","내 룬"],["myItems","내 아이템"],["myChampRunes","내 챔피언 + 룬"],["myChampItems","내 챔피언 + 아이템"],["myRuneItems","내 룬 + 아이템"],["allyItems","아군 아이템"],["enemyItems","상대 아이템"],["allyChampions","아군 챔피언"],["enemyChampions","상대 챔피언"],["allyRunes","아군 룬"],["enemyRunes","상대 룬"],["time","시간대"]];}
  /* ── 결과판(8892 원본 이식) ── 아이콘은 원본 png 를 그대로 실은 data URI 다. */
  var _RS_TOWER_IMG="data:image/png;base64,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";
  var _RS_INHIB_IMG="data:image/png;base64,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";
  var FF='Sora, Pretendard, "Noto Sans KR", sans-serif';
  function kK(n){n=+n||0;var a=Math.abs(n);if(a<1000)return String(Math.round(n));return (n<0?'-':'')+(Math.floor(a/100)/10).toFixed(1)+'K'} /* 4687 → 4.6K (LCK 표기) */
  function _rsPad2(n){return String(n).padStart(2,'0')}
  function mmss(s){s=Math.max(0,Math.round(+s||0));return Math.floor(s/60)+':'+_rsPad2(s%60)}
  function smoothPath(P){
    if(P.length<2)return '';
    var d='M'+P[0][0].toFixed(1)+','+P[0][1].toFixed(1);
    for(var i=0;i<P.length-1;i++){
      var p0=P[i-1]||P[i], p1=P[i], p2=P[i+1], p3=P[i+2]||p2;
      var c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6, c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
      d+=' C'+c1x.toFixed(1)+','+c1y.toFixed(1)+' '+c2x.toFixed(1)+','+c2y.toFixed(1)+' '+p2[0].toFixed(1)+','+p2[1].toFixed(1);
    }
    return d;
  }
  function goldSvg(tl,gid){
    if(!tl||!tl.frames||tl.frames.length<2) return '<p class="rs-note">이 판의 시간대별 골드 기록이 없습니다.</p>';
    var W=640, L=60, Rm=26, T=18, ph=134, ICON=18, fr=tl.frames, maxMin=Math.max(1,fr[fr.length-1].min);
    var mxd=0,mnd=0; fr.forEach(function(f){if(f.diff>mxd)mxd=f.diff;if(f.diff<mnd)mnd=f.diff;});
    var span=Math.max(mxd,-mnd,500), top=Math.max(mxd,span*0.2), bot=Math.min(mnd,-span*0.2);
    var pw=W-L-Rm;
    var x=function(m){return L+Math.min(m,maxMin)/maxMin*pw}, y=function(v){return T+(top-v)/(top-bot)*ph};
    var y0=y(0), P=fr.map(function(f){return [x(f.min),y(f.diff)]});
    var curve=smoothPath(P);
    var area=curve+' L'+x(fr[fr.length-1].min).toFixed(1)+','+y0.toFixed(1)+' L'+x(fr[0].min).toFixed(1)+','+y0.toFixed(1)+' Z';
    var ticks=[]; for(var m=4;m<maxMin;m+=4)ticks.push(m); var lastM=Math.round(maxMin); if(!ticks.length||lastM-ticks[ticks.length-1]>=1.5)ticks.push(lastM);
    var axisY=T+ph+16;
    var tickH=ticks.map(function(m){return '<line x1="'+x(m).toFixed(1)+'" y1="'+T+'" x2="'+x(m).toFixed(1)+'" y2="'+(T+ph)+'" stroke="rgba(255,255,255,.07)"/><text x="'+x(m).toFixed(1)+'" y="'+axisY+'" text-anchor="middle" font-size="11" font-family=\''+FF+'\' fill="#6b7488">'+m+'</text>';}).join('');
    var evs=(tl.events||[]).slice().sort(function(a,b){return a.min-b.min}), groups=[], marks=[], maxRows=1;
    evs.forEach(function(e){
      var cx=x(e.min), g=null; for(var i=0;i<groups.length;i++){ if(Math.abs(groups[i].x-cx)<ICON){g=groups[i];break;} }
      if(!g){g={x:cx,n:0};groups.push(g);} var row=g.n++; if(g.n>maxRows)maxRows=g.n;
      marks.push({e:e,x:g.x,row:row});
    });
    var markTop=axisY+9, H=markTop+maxRows*(ICON+2)+6;
    var ev=marks.map(function(mk){var e=mk.e, w=e.type==='INHIB'?ICON*66/63:ICON*52/71, cy=markTop+mk.row*(ICON+2), who=e.team===100?'블루':'레드';   /* team = 부서진 건물의 주인 팀 */
      return '<image href="'+(e.type==='INHIB'?_RS_INHIB_IMG:_RS_TOWER_IMG)+'" x="'+(mk.x-w/2).toFixed(1)+'" y="'+cy.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+ICON+'" filter="url(#'+(e.team===200?'fxr-':'fxb-')+gid+')"><title>'+who+' '+(e.type==='INHIB'?'억제기':'포탑')+' 파괴 · '+e.min+'분</title></image>';}).join('');
    var last=fr[fr.length-1], lx=x(last.min), ly=y(last.diff), lc=last.diff>=0?'#8fb0ff':'#ff98a6';
    /* 끝값 라벨: 점 아래에 자리가 없으면(축 눈금과 겹치면) 위로 */
    var lyText=(last.diff>=0||ly+18>T+ph-2)?ly-10:ly+16;
    var endMark='<circle cx="'+lx.toFixed(1)+'" cy="'+ly.toFixed(1)+'" r="7" fill="'+lc+'" opacity=".22"/><circle cx="'+lx.toFixed(1)+'" cy="'+ly.toFixed(1)+'" r="3.2" fill="'+lc+'"/>'
      +'<text x="'+(lx+2).toFixed(1)+'" y="'+lyText.toFixed(1)+'" text-anchor="end" font-size="11.5" font-weight="700" font-family=\''+FF+'\' fill="'+lc+'">'+(last.diff>=0?'+':'-')+kK(Math.abs(last.diff))+'</text>';
    /* 축 라벨: 최대/최소가 0 선과 겹칠 만큼 작으면 그 라벨은 생략 */
    var showMax=mxd>0&&Math.abs(y(mxd)-y0)>=12, showMin=mnd<0&&Math.abs(y(mnd)-y0)>=12;
    var up='gc-up-'+gid, dn='gc-dn-'+gid;
    return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="골드 차이 타임라인">'
      +'<defs>'
      +'<clipPath id="'+up+'"><rect x="0" y="0" width="'+W+'" height="'+y0.toFixed(1)+'"/></clipPath><clipPath id="'+dn+'"><rect x="0" y="'+y0.toFixed(1)+'" width="'+W+'" height="'+(T+ph-y0).toFixed(1)+'"/></clipPath>'
      +'<linearGradient id="gb-'+gid+'" gradientUnits="userSpaceOnUse" x1="0" y1="'+T+'" x2="0" y2="'+y0.toFixed(1)+'"><stop offset="0" stop-color="#5b8bff" stop-opacity=".62"/><stop offset="1" stop-color="#5b8bff" stop-opacity=".08"/></linearGradient>'
      +'<linearGradient id="gr-'+gid+'" gradientUnits="userSpaceOnUse" x1="0" y1="'+y0.toFixed(1)+'" x2="0" y2="'+(T+ph)+'"><stop offset="0" stop-color="#f26d7d" stop-opacity=".08"/><stop offset="1" stop-color="#f26d7d" stop-opacity=".62"/></linearGradient>'
      +'<filter id="fxb-'+gid+'" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.4" flood-color="#000" flood-opacity=".6"/></filter>'
      +'<filter id="fxr-'+gid+'" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 1 0 0  0 0.32 0 0 0  0.3 0 0 0 0  0 0 0 1 0" result="c"/><feDropShadow in="c" dx="0" dy="1.5" stdDeviation="1.4" flood-color="#000" flood-opacity=".6"/></filter>'
      +'<filter id="gl-'+gid+'" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
      +'</defs>'
      +tickH
      +'<path d="'+area+'" fill="url(#gb-'+gid+')" clip-path="url(#'+up+')"/><path d="'+area+'" fill="url(#gr-'+gid+')" clip-path="url(#'+dn+')"/>'
      +'<path d="'+curve+'" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3" filter="url(#gl-'+gid+')" opacity=".55"/>'
      +'<path d="'+curve+'" fill="none" stroke="#eef1f6" stroke-width="1.4"/>'
      +'<line x1="'+L+'" y1="'+y0.toFixed(1)+'" x2="'+(W-Rm)+'" y2="'+y0.toFixed(1)+'" stroke="rgba(255,255,255,.4)" stroke-width="1"/>'
      +(showMax?'<text x="'+(L-8)+'" y="'+Math.max(T+9,y(mxd)+4).toFixed(1)+'" text-anchor="end" font-size="11" font-family=\''+FF+'\' fill="#8fb0ff">'+kK(mxd)+'</text>':'')
      +'<text x="'+(L-8)+'" y="'+(y0+4).toFixed(1)+'" text-anchor="end" font-size="11" font-family=\''+FF+'\' fill="#a3acbd">0</text>'
      +(showMin?'<text x="'+(L-8)+'" y="'+Math.min(T+ph-1,y(mnd)+4).toFixed(1)+'" text-anchor="end" font-size="11" font-family=\''+FF+'\' fill="#ff98a6">'+kK(-mnd)+'</text>':'')
      +endMark+ev+'</svg>';
  }
  function resultHtml(d){
    var R=d.result; if(!R||!R.blue||!R.red) return '';
    var B=R.blue, Rd=R.red;
    var top='<div class="rs-top rv" style="--i:0"><div class="rs-team blue"><span class="rs-name">BLUE</span><span class="rs-res'+(B.win?' w':'')+'">'+(B.win?'WIN':'LOSS')+'</span></div>'
      +'<div class="rs-time"><span class="rs-lbl">경기 종료</span><b>'+mmss(d.duration)+'</b></div>'
      +'<div class="rs-team red"><span class="rs-res'+(Rd.win?' w':'')+'">'+(Rd.win?'WIN':'LOSS')+'</span><span class="rs-name">RED</span></div></div>';
    function cell(side,items){ var list=[].concat(items).filter(function(x){return x!=null&&x!==''}); if(!list.length) return '<span class="v '+side+' dim">—</span>'; return '<span class="v '+side+'">'+list.map(function(x){return '<span>'+x+'</span>'}).join('')+'</span>'; }
    function row(label,bv,rv){return '<div class="rs-row">'+cell('b',bv)+'<span class="l">'+label+'</span>'+cell('r',rv)+'</div>';}
    /* ★2026-09-17 양쪽 다 없는 줄은 아예 뺀다. 소스에 없는 값을 0 으로 적으면 거짓 화면이 된다(집계쪽 sumN 과 한 쌍). */
    function nrow(label,bv,rv,f){ if(bv==null&&rv==null) return ''; f=f||kK; return row(label,bv==null?'—':f(bv),rv==null?'—':f(rv)); }
    function firsts(t,side){var a=[];if(t.firstBlood)a.push('첫 킬');if(t.firstTower)a.push('첫 포탑');if(t.firstInhib)a.push('첫 억제기');return a.map(function(x){return '<i class="mk '+side+'">'+x+'</i>'});}
    function multi(t,side){var a=[];if(t.dk)a.push('더블 킬 '+t.dk);if(t.tk)a.push('트리플 킬 '+t.tk);if(t.qk)a.push('쿼드라 킬 '+t.qk);if(t.pk)a.push('펜타 킬 '+t.pk);return a.map(function(x){return '<i class="mk '+side+'">'+x+'</i>'});}
    var stats='<div class="rs-stats rv" style="--i:1"><div class="rs-h">게임 지표</div>'
      +((B.k==null&&Rd.k==null)?'':row('KDA',B.k+' / '+B.d+' / '+B.a,Rd.k+' / '+Rd.d+' / '+Rd.a))
      +nrow('총 골드',B.gold,Rd.gold)
      +nrow('포탑',B.towers,Rd.towers,String)
      +nrow('억제기',B.inhibs,Rd.inhibs,String)
      +((B.firstBlood==null&&B.firstTower==null&&B.firstInhib==null)?'':row('선취점',firsts(B,'b'),firsts(Rd,'r')))
      +((B.dk==null&&Rd.dk==null)?'':row('멀티 킬',multi(B,'b'),multi(Rd,'r')))
      +nrow('누적 피해량',B.dmg,Rd.dmg)
      +nrow('누적 받은 피해량',B.taken,Rd.taken)
      +nrow('누적 회복량',B.heal,Rd.heal)
      +nrow('군중제어(초)',B.cc,Rd.cc)
      +nrow('포탑에 가한 피해량',B.dmgTurrets,Rd.dmgTurrets)
      +(R.surrender?row('항복',B.win?'':'<i class="mk b">항복</i>',Rd.win?'':'<i class="mk r">항복</i>'):'')
      +'</div>';
    var rows=d.rows||[], mx=0; rows.forEach(function(r){if(r.dmg>mx)mx=r.dmg;});
    var bl=rows.filter(function(r){return r.team===100}), rd=rows.filter(function(r){return r.team===200});
    function bar(r){var w=mx?r.dmg/mx*100:0, s=r.dmg||1;
      /* ★2026-09-17 분해가 없는 소스면 한 색 막대 — 0/0/0 으로 쪼개면 막대가 통째로 사라진다. */
      if(r.physDmg==null&&r.magicDmg==null&&r.trueDmg==null) return '<span class="rs-bar"><i class="f" data-w="'+w.toFixed(1)+'"></i></span>';
      return '<span class="rs-bar"><i class="p" data-w="'+(w*(r.physDmg||0)/s).toFixed(1)+'"></i><i class="m" data-w="'+(w*(r.magicDmg||0)/s).toFixed(1)+'"></i><i class="t" data-w="'+(w*(r.trueDmg||0)/s).toFixed(1)+'"></i></span>';}
    function pl(r,side){ if(!r) return '<div class="rs-p '+side+'"></div>'; var hasSplit=(r.physDmg!=null||r.magicDmg!=null||r.trueDmg!=null); var ci='<span class="rs-ci">'+pim(r.champIcon)+'</span>', tx='<span class="rs-pt"><span class="rs-nm" title="'+esc(r.champName)+(hasSplit?(' · 물리 '+kfmt(r.physDmg)+' / 마법 '+kfmt(r.magicDmg)+' / 고정 '+kfmt(r.trueDmg)):'')+'">'+esc(r.name||r.champName)+'</span><span class="rs-val">'+kK(r.dmg)+'</span>'+bar(r)+'</span>'; return '<div class="rs-p '+side+'">'+(side==='b'?ci+tx:tx+ci)+'</div>'; }
    var dmg='<div class="rv" style="--i:2"><div class="rs-h">총 피해량 분포</div><div class="rs-dmg">'+[0,1,2,3,4].map(function(i){return '<div class="rs-dr">'+pl(bl[i],'b')+pl(rd[i],'r')+'</div>'}).join('')+'</div>'
      +(rows.some(function(r){return r.physDmg!=null})?'<div class="rs-leg"><span class="lp"><i></i>물리</span><span class="lm"><i></i>마법</span><span class="lt"><i></i>고정</span></div>':'')+'</div>';
    /* ★2026-09-17 골드 차이 타임라인은 롤 클라이언트가 줄 때만 있다. 폴백 소스에서는 "기록이 없습니다" 줄만
       남으므로 칸 자체를 뺀다. LCU 소스에서 타임라인만 실패한 경우는 종전대로 그 안내 줄을 그대로 둔다. */
    var gold=R.lean?'':'<div class="rv" style="--i:3"><div class="rs-h">골드 차이 타임라인</div><div class="rs-gold">'+goldSvg(R.timeline,d.gid)+'</div></div>';
    return '<div class="rs">'+top+'<div class="rs-body">'+stats+'<div class="rs-right">'+dmg+gold+'</div></div>'+'</div>';
  }
  /* ★2026-09-13 rAF 는 창이 가려지거나 최소화되면 통째로 멈춘다 — 그 상태에서 상세를 열면
     피해 분해 막대가 0% 인 채로 굳고, 그대로 이미지 복사하면 빈 막대가 공유된다(실측).
     애니메이션은 그대로 두고, 늦게라도 반드시 채워지도록 시간 폴백을 하나 더 건다. */
  function animateBars(root){ var bars=root.querySelectorAll('.rs-bar i[data-w]');
    var fill=function(){ bars.forEach(function(b){ b.style.width=b.getAttribute('data-w')+'%'; }); };
    requestAnimationFrame(function(){ requestAnimationFrame(fill); }); setTimeout(fill,240); }

  function anHint(t){return {myAugments:"내가 든 증강별 승률·판수 (표본 많은 순).",myItems:"내가 산 아이템별 승률·판수.",allyItems:"아군(본인 제외)이 산 아이템별 내 승률 (5판+).",enemyItems:"상대가 산 아이템별 내 승률 (5판+).",myRunes:"내가 든 룬·파편별 승률 (일반 칼바람은 최근 게임부터 수집).",allyChampions:"이 챔피언이 우리 팀일 때 내 승률 (5판+). Δ = 내 전체 승률 대비 높/낮음.",enemyChampions:"이 챔피언을 상대했을 때 내 승률 (5판+). Δ = 전체 대비.",allyAugments:"아군이 이 증강을 들었을 때 내 승률 (5판+).",enemyAugments:"상대가 이 증강을 들었을 때 내 승률 (5판+).",allyRunes:"아군이 이 룬을 들었을 때 내 승률 (5판+).",enemyRunes:"상대가 이 룬을 들었을 때 내 승률 (5판+).",myChampAugments:"내가 이 챔피언으로 이 증강을 들었을 때의 승률 (2판+). 행을 누르면 챔피언 상세로.",myChampRunes:"내가 이 챔피언으로 이 룬을 들었을 때의 승률 (2판+). 행을 누르면 챔피언 상세로.",myChampItems:"내가 이 챔피언으로 이 아이템을 샀을 때의 승률 (2판+). 행을 누르면 챔피언 상세로.",myAugmentItems:"이 증강과 이 아이템을 한 게임에 같이 갔을 때의 승률 (2판+).",myRuneItems:"이 룬과 이 아이템을 한 게임에 같이 갔을 때의 승률 (2판+).",time:"게임 시각·길이별 내 승률 (KST 기준). 표본 적은 시간대는 흐리게."}[t]||"";}
  // 필터(요구②④): 증강=희귀도, 아이템·챔피언=클래스. 상태 _anRarity/_anClass(null=전체). 승률색 그라데이션(요구⑦): 50%기준 |Δ|로 진해짐(연승 진녹·연패 진적, streak와 동일 규칙).
  var _anRarity=null,_anClass=null;
  function anWrColor(wr){var d=Math.max(-1,Math.min(1,(Number(wr)-50)/25)),t=Math.min(Math.abs(d),1),up=d>=0;var hue=up?145:2,sat=Math.round((up?38:46)+t*(up?34:30)),lig=Math.round((up?54:55)-t*(up?18:15));return 'hsl('+hue+' '+sat+'% '+lig+'%)';}
  function anFiltBar(tab){
    if(tab==="myAugments"||tab==="allyAugments"||tab==="enemyAugments"){var R=[["","전체"],["prismatic","프리즘"],["gold","골드"],["silver","실버"]];return '<div class="an-filt">'+R.map(function(r){return '<button class="an-fbtn'+((_anRarity||"")===r[0]?' on':'')+'" data-anrar="'+r[0]+'" type="button">'+r[1]+'</button>';}).join('')+'</div>';}
    if(tab==="myItems"||tab==="allyItems"||tab==="enemyItems"||tab==="allyChampions"||tab==="enemyChampions"){var C=["","전사","마법사","원거리","암살자","탱커","유틸"];return '<div class="an-filt">'+C.map(function(c){return '<button class="an-fbtn'+((_anClass||"")===c?' on':'')+'" data-ancls="'+esc(c)+'" type="button">'+(c||"전체")+'</button>';}).join('')+'</div>';}
    return '';
  }
  function anApplyFilter(arr,tab){arr=arr||[];
    if((tab==="myAugments"||tab==="allyAugments"||tab==="enemyAugments")&&_anRarity)return arr.filter(function(x){return String(x.rarity).toLowerCase()===_anRarity;});
    if((tab==="myItems"||tab==="allyItems"||tab==="enemyItems"||tab==="allyChampions"||tab==="enemyChampions")&&_anClass)return arr.filter(function(x){return x.cls===_anClass;});
    return arr;}
  function anApplySearch(arr){arr=arr||[];var q=normName(_anSearch);if(!q)return arr;return arr.filter(function(x){return normName(x.label||x.name||"").indexOf(q)>=0;});} // item2: 상세분석 현재 탭 목록을 검색어로 필터(증강/아이템/챔피언/룬 이름=label)
  function anSearchPlaceholder(t){var n=({myAugments:"증강",allyAugments:"증강",enemyAugments:"증강",myItems:"아이템",allyItems:"아이템",enemyItems:"아이템",myRunes:"룬·파편",allyRunes:"룬",enemyRunes:"룬",allyChampions:"챔피언",enemyChampions:"챔피언",myChampAugments:"챔피언·증강",myChampRunes:"챔피언·룬",myChampItems:"챔피언·아이템",myAugmentItems:"증강·아이템",myRuneItems:"룬·아이템"})[t]||"항목";return n+" 검색";}
  function anDelta(x){if(x.delta==null)return '';var up=x.direction==="높음";return '<span class="an-d '+(up?'up':'dn')+'">'+(up?'▲':'▼')+Math.abs(x.delta)+'</span>';}
  // C4(2026-07-03): 증강/아이템/룬 개인 상세분석을 아이콘 흩뿌리기(.agrid) → 정렬된 행 표(.an-rows)로.
  //   aram-mayhem 상세표/8896 records 표 느낌(아이콘+이름 | 승률바 | 판수 | Δ), 표본 많은 순(서버 정렬 유지).
  function anRow(x, attr, delta, labelKey){var key=labelKey?x.label:(x.id!=null?x.id:x.label); // 챔피언은 이름이 키(openChamp가 이름으로 조회), 증강/아이템/룬은 id
    return '<div class="an-tr clk" '+attr+'="'+esc(key)+'" data-tip="'+esc(x.label+(x.desc?'\n'+x.desc:''))+'">'+img(x.icon,"ci")+'<span class="nm">'+esc(x.label)+'</span><span class="g">'+kfmt(x.games)+'판</span>'+wr(x.winRate,x.thin||x.games<5)+'</div>';} // 영향(Δ)열 제거(사용자 지시) — delta 파라미터 무시
  function anRowList(a, attr, delta, labelKey){return '<div class="an-rows">'+a.map(function(x){return anRow(x,attr,delta,labelKey);}).join('')+'</div>';}
  function anAugGrid(arr,delta){arr=arr||[];if(!arr.length)return '<div class="blank">데이터 없음</div>';
    if(delta)return anRowList(arr,"data-augment",true);
    if(!arr.some(function(x){return x.rarity}))return anRowList(arr,"data-augment",false);
    var G=[["prismatic","프리즘","#e08bd0"],["gold","골드","#f0c674"],["silver","실버","#b9c4d6"]],out="",first=true;
    G.forEach(function(g){var sub=arr.filter(function(x){return String(x.rarity).toLowerCase()===g[0]});if(sub.length){out+='<div class="an-rlab" style="color:'+g[2]+';margin:'+(first?0:14)+'px 0 6px">'+g[1]+'</div>'+anRowList(sub,"data-augment",false);first=false;}});
    var rest=arr.filter(function(x){return !G.some(function(g){return String(x.rarity).toLowerCase()===g[0]})});if(rest.length)out+='<div class="an-rlab" style="color:var(--mut);margin:14px 0 6px">기타</div>'+anRowList(rest,"data-augment",false);
    return out;}
  function anItemGrid(arr,delta){arr=arr||[];if(!arr.length)return '<div class="blank">데이터 없음</div>';return anRowList(arr,"data-item",!!delta);}
  function anRuneGrid(d){var runes=anApplySearch(anSortArr(d.myRunes||[])),shards=anApplySearch(anSortArr(d.myShards||[]));if(!runes.length&&!shards.length)return '<div class="blank">'+(normName(_anSearch)?'"'+esc(_anSearch)+'" 결과 없음':'데이터 없음')+'</div>';
    var main=runes.filter(function(x){return x.cat==="main"}),sub=runes.filter(function(x){return x.cat!=="main"}),out='';
    if(main.length)out+='<div class="an-rlab">메인 룬</div>'+anRowList(main,"data-rune",false);
    if(sub.length)out+='<div class="an-rlab" style="margin-top:14px">하위 룬</div>'+anRowList(sub,"data-rune",false);
    if(shards.length)out+='<div class="an-rlab" style="margin-top:14px">파편</div>'+anRowList(shards,"data-x",false);
    return out;}
  function anChampRows(arr){arr=arr||[];if(!arr.length)return '<div class="blank">데이터 없음 (표본 5판 이상인 챔피언만).</div>';return anRowList(arr,"data-champ",true,true);}
  function anRuneRows(arr){arr=arr||[];if(!arr.length)return '<div class="blank">데이터 없음 (표본 5판 이상인 룬만).</div>';return anRowList(arr,"data-rune",true);}
  // 쌍 행 — 아이콘 2개(왼=챔피언/증강/룬, 오른=증강/룬/아이템) + "A + B" 이름. 챔피언이 왼쪽인 쌍만 클릭(그 챔프 상세로).
  function anPairRow(x){var clickable=x.kindA==="champion"&&x.aKey;
    return '<div class="an-tr p2'+(clickable?' clk':'')+'"'+(clickable?' data-champ="'+esc(x.aKey)+'"':'')+' data-tip="'+esc(x.label)+'">'+img(x.icon,"ci")+img(x.icon2,"ci")+'<span class="nm">'+esc(x.label)+'</span><span class="g">'+kfmt(x.games)+'판</span>'+wr(x.winRate,x.games<5)+'</div>';}
  function anPairRows(arr){arr=arr||[];if(!arr.length)return '<div class="blank">'+(normName(_anSearch)?'"'+esc(_anSearch)+'" 결과 없음':'데이터 없음 (같이 간 표본 2판 이상인 조합만).')+'</div>';
    return '<div class="an-rows">'+arr.map(anPairRow).join('')+'</div>';}
  function anTime(d){var tp=d.timePattern||{};if(!tp.games)return '<div class="blank">데이터 없음</div>';var arr=tp.activeHour||[],s=tp.summary||{},maxG=Math.max.apply(null,arr.map(function(b){return b.games}))||1; // 경기중/시작/종료 토글 제거(요구⑤) — activeHour 단일뷰
    var bars=arr.map(function(b){var h=b.games?Math.max(8,Math.min(100,Math.round((b.winRate-30)*1.6+18))):8;var op=b.games?Math.max(.3,Math.min(1,b.games/maxG)):.12;var cls=b.games<tp.minHighlightGames?'thin':(b.winRate>=50?'good':'bad');return '<div class="an-hcol" data-tip="'+esc(b.label+' · 승률 '+b.winRate+'% · '+kfmt(b.games)+'판')+'"><span class="an-hbar '+cls+'" style="height:'+h+'%;opacity:'+op.toFixed(2)+'"></span><span class="an-hx">'+(Number(b.key)%3===0?Number(b.key):'')+'</span></div>';}).join(''); // 색=good/bad, 농도=표본 opacity(원래 방식이 기준 — 사각형이 이걸 따름)
    function tc(t,b,good){if(!b)return '';return '<div class="an-tc '+(good?'good':'bad')+'"><span class="an-tcl">'+t+'</span><b>'+esc(b.label)+'</b><span class="an-tcv">'+b.winRate+'% · '+kfmt(b.games)+'판</span></div>';}
    var dur=(tp.durationMinute||[]).map(function(b){return '<div class="an-drow" data-tip="'+esc(b.label+' · '+b.winRate+'% · '+kfmt(b.games)+'판')+'"><span class="an-dl">'+esc(b.label)+'</span><span class="an-db"><i class="'+(b.games<tp.minHighlightGames?'thin':(b.winRate>=50?'good':'bad'))+'" style="width:'+Math.round(b.winRate)+'%"></i></span><span class="an-dv">'+b.winRate+'% <small>'+kfmt(b.games)+'판</small></span></div>';}).join('');
    return '<div class="an-ttop"><h4>시간대별 승률</h4><span class="an-tsub">경기 시각 · KST</span></div><div class="an-hchart">'+bars+'</div>'+
      '<div class="an-tcards">'+tc("가장 좋은 시간",s.bestActiveHour,true)+tc("가장 나쁜 시간",s.worstActiveHour,false)+'</div>'+
      '<h4 style="margin:18px 0 9px">게임 길이별 승률 <span class="an-tsub">(가운데 흰 선 = 50%)</span></h4><div class="an-durs">'+(dur||'<div class="blank">데이터 없음</div>')+'</div>';}
  function renderAnalysis(){var d=_anData;
    var _anqWasFocus=!!(document.activeElement&&document.activeElement.id==="anq"),_anqSel=_anqWasFocus?document.activeElement.selectionStart:null; // 검색 입력(item2) 포커스·커서 보존용
    if(!d||!d.ok){$("#champpage").innerHTML='<div class="cp-wrap"><button class="cp-back" id="anback" type="button">← 전적</button><div class="blank" style="margin-top:20px">분석 데이터를 불러오지 못했어요.</div></div>';$("#anback").onclick=navToList;return;}
    var tabs=anTabs(d);if(!_anTab||!tabs.some(function(t){return t[0]===_anTab}))_anTab=tabs[0][0];
    var HEAD={myAugments:['증강',false],myItems:['아이템',false],allyItems:['아이템',true],enemyItems:['아이템',true],myRunes:['룬 · 파편',false],allyChampions:['챔피언',true],enemyChampions:['챔피언',true],allyAugments:['증강',true],enemyAugments:['증강',true],allyRunes:['룬',true],enemyRunes:['룬',true],
      myChampAugments:['챔피언 + 증강',false,true],myChampRunes:['챔피언 + 룬',false,true],myChampItems:['챔피언 + 아이템',false,true],myAugmentItems:['증강 + 아이템',false,true],myRuneItems:['룬 + 아이템',false,true]}; // [이름열 라벨, Δ여부, 쌍(아이콘2)]
    if(_anSort==="delta")_anSort="games"; // 영향(Δ)열 제거 — 델타 정렬 없음, 표본순 폴백
    function F(arr){return anApplySearch(anApplyFilter(anSortArr(arr),_anTab));} // 정렬→클래스/희귀도 필터→검색어 필터(item2)
    // 아군/상대 탭은 경기별 상세(팀 구성)가 있어야 나온다. 표본이 0인데 "데이터 없음"이라고만 하면
    // 이유를 뭉개는 거짓 안내가 된다 → 왜 비었는지 정확히 말한다.
    var CTX_TABS={allyItems:1,enemyItems:1,allyChampions:1,enemyChampions:1,allyAugments:1,enemyAugments:1,allyRunes:1,enemyRunes:1};
    var body;
    if(d.games<=0){body='<div class="blank" style="margin-top:8px">이 모드('+esc(modeLabel())+') 기록이 아직 없어요. 좌측에서 <b>전적 불러오기</b>를 먼저 해주세요.</div>';}
    else if(CTX_TABS[_anTab]&&!d.ctxGames){body='<div class="blank" style="margin-top:8px">아군·상대 분석은 경기별 상세를 받아야 나와요. 롤을 켠 채로 두면 최근 경기부터 조금씩 모입니다'+(d.capturing?' <span class="an-cap">(지금 수집 중…)</span>':'')+'.</div>';}
    else if(_anTab==="myAugments")body=anAugGrid(F(d.myAugments),false);
    else if(_anTab==="myItems")body=anItemGrid(F(d.myItems));
    else if(_anTab==="allyItems")body=anItemGrid(F(d.allyItems),true);
    else if(_anTab==="enemyItems")body=anItemGrid(F(d.enemyItems),true);
    else if(_anTab==="myRunes")body=anRuneGrid(d);
    else if(_anTab==="allyChampions")body=anChampRows(F(d.allyChampions));
    else if(_anTab==="enemyChampions")body=anChampRows(F(d.enemyChampions));
    else if(_anTab==="allyAugments")body=anAugGrid(F(d.allyAugments),true);
    else if(_anTab==="enemyAugments")body=anAugGrid(F(d.enemyAugments),true);
    else if(_anTab==="allyRunes")body=anRuneRows(F(d.allyRunes));
    else if(_anTab==="enemyRunes")body=anRuneRows(F(d.enemyRunes));
    else if(_anTab==="myChampAugments")body=anPairRows(F(d.myChampAugments));
    else if(_anTab==="myChampRunes")body=anPairRows(F(d.myChampRunes));
    else if(_anTab==="myChampItems")body=anPairRows(F(d.myChampItems));
    else if(_anTab==="myAugmentItems")body=anPairRows(F(d.myAugmentItems));
    else if(_anTab==="myRuneItems")body=anPairRows(F(d.myRuneItems));
    else if(_anTab==="time")body=anTime(d);
    // 목록형 탭일 때만 검색창·필터바·정렬헤더를 붙인다. 시간대(차트)와 '표본 0' 안내문 위에 얹으면
    // 눌러도 아무 일 없는 유령 컨트롤이 되고, 그대로 공유 이미지에도 찍힌다.
    var listMode=d.games>0&&_anTab!=="time"&&!(CTX_TABS[_anTab]&&!d.ctxGames);
    if(listMode&&HEAD[_anTab])body=anFiltBar(_anTab)+anHead(HEAD[_anTab][0],HEAD[_anTab][2])+body;
    var cap=d.capturing?' · <span class="an-cap">데이터 수집 중… <button class="an-refresh" id="anref" type="button">새로고침</button></span>':'';
    var anShareBtn=d.games>0?'<div class="share-actions"><button class="fortune-share" id="anshare" type="button">이미지 복사</button><button class="fortune-share fortune-link" id="anlink" type="button">링크 복사</button></div>':'';
    var html='<div class="cp-wrap"><div class="fortune-top"><button class="cp-back" id="anback" type="button">← 전적</button>'+anShareBtn+'</div><div class="an-capture">'+
      '<div class="an-head"><div class="an-title">개인 상세 분석 <span class="an-sub">'+esc(modeLabel())+' · '+kfmt(d.games)+'게임'+(d.ctxGames?' · 팀분석 '+kfmt(d.ctxGames)+'게임':'')+cap+'</span></div></div>'+
      '<div class="an-tabs">'+tabs.map(function(t){return '<button class="'+(t[0]===_anTab?'on':'')+'" data-antab="'+t[0]+'" type="button">'+t[1]+'</button>';}).join('')+'</div>'+
      '<div class="cp-box an-box">'+(listMode?'<div class="inpage-filter an-search"><input id="anq" type="text" placeholder="'+esc(anSearchPlaceholder(_anTab))+'" autocomplete="off" value="'+esc(_anSearch)+'"></div>':'')+(listMode?'<p class="ehint">'+esc(anHint(_anTab))+'</p>':(_anTab==="time"&&d.games>0?'<p class="ehint">'+esc(anHint("time"))+'</p>':''))+body+'</div></div></div>';
    $("#champpage").innerHTML=html;
    $("#anback").onclick=navToList;
    if($("#anshare"))$("#anshare").onclick=shareAnalysis;if($("#anlink"))$("#anlink").onclick=shareAnalysisLink;
    if($("#anref"))$("#anref").onclick=openAnalysis;
    document.querySelectorAll("#champpage [data-antab]").forEach(function(b){b.onclick=function(){_anTab=b.getAttribute("data-antab");_anSearch="";renderAnalysis();};});
    document.querySelectorAll("#champpage [data-anhr]").forEach(function(b){b.onclick=function(){_anHr=b.getAttribute("data-anhr");renderAnalysis();};});
    document.querySelectorAll("#champpage [data-ansort]").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-ansort");if(_anSort===k)_anDir=_anDir==="desc"?"asc":"desc";else{_anSort=k;_anDir="desc";}renderAnalysis();};});
    document.querySelectorAll("#champpage [data-anrar]").forEach(function(b){b.onclick=function(){_anRarity=b.getAttribute("data-anrar")||null;renderAnalysis();};});
    document.querySelectorAll("#champpage [data-ancls]").forEach(function(b){b.onclick=function(){_anClass=b.getAttribute("data-ancls")||null;renderAnalysis();};});
    var _anq=$("#anq"); if(_anq){ _anq.oninput=deb(function(){_anSearch=_anq.value;renderAnalysis();},180); if(_anqWasFocus){ _anq.focus(); try{var _p=_anqSel==null?_anq.value.length:_anqSel;_anq.setSelectionRange(_p,_p);}catch(e){} } } // item2 검색 입력 — 재렌더 후 포커스·커서 복원
  }
  function renderChamp(d){
    // 2026-07-09 /api/champ 500 {error} 방어(형제 renderEntity와 동일) — '승률 undefined판' 깨진 상세를 막는다.
    // ★2026-09-12 조용히 닫는 대신 이유를 보여준다(다른 PC 신고: 챔피언을 눌러도 아무 일이 안 일어남).
    if(!d||d.error){showChampError(lastChampName||"",d&&d.error?String(d.error).slice(0,120):"");return;}
    lastChampData=d;
    amMetaBase=Number(d.winRate)||50; // ★검증된픽 기준선 = 이 챔프 평균 승률
    function sortBuild(arr){return buildMode==="win"?amSortItems(arr):amSortCommon(arr);} function runeSort(arr){return buildMode==="win"?amSortRunePick(arr):amSortCommon(arr);} /* 2026-07-11 최고승률=사이트 기여도(rankImpact): 아이템·증강=sortBuild(|기여도|↓ 고표본 스테이플 먼저) / 룬=runeSort(부호기여도↓ 최선 픽·지는 고표본 매장). 서버 정확승수 x.impact 사용 */
    function rwr(n,thin){return '<span class="iwr '+(thin?'':(n>=50?'good':'bad'))+'">'+n+'%</span>'}
    var rec=lastMe?(mode==="augment"?lastMe.augment:lastMe.standard):null; // 게이트 없음 — 일반칼바람도 캐시(readStdCache)라 롤 꺼도 내 기록 있으면 비교 표시(renderMe/renderMyChamps/매치상세와 동일). 그 챔프 기록 없을 때만 '내 기록 없음'.
    var mc=rec&&rec.champs?rec.champs.filter(function(c){return c.name===d.name})[0]:null;
    var bm=(buildMode==="win"?"최고 승률":"가장 흔한");
    // 헤더 + 토글
    var meta='승률 '+d.winRate+'% · '+kfmt(d.games)+'판'+(d.cls?' · '+esc(d.cls):''); // 기대 대비(op.gg 등 외부 일반칼바람 평균 기준)는 모드혼합·오해라 제거(사용자 지시)
    var toggle='<div class="btoggle bt"><button data-bm="win" class="'+(buildMode==="win"?"on":"")+'" type="button">최고 승률 (메타)</button><button data-bm="common" class="'+(buildMode==="common"?"on":"")+'" type="button">가장 흔한 (메타)</button></div>';
    var head='<button class="cp-back" id="cpback" type="button">← 챔피언 목록</button>'+
      '<div class="cp-head'+(d.tier?' t'+Math.min(d.tier,5):'')+'"'+splashStyle(d.icon)+'>'+img(d.icon,"ci lg")+'<div><div class="cn">'+esc(d.name)+(d.tier?' '+tierBadge(d.tier):'')+'</div><div class="meta">'+meta+'</div></div>'+champHeaderKda(mc&&mc.kda,d.kda)+toggle+'</div>';
    // 지표 박스
    var bar=function(l,v,disp){return '<div class="stat"><span class="sl">'+l+'</span><span class="sb"><i style="width:'+champPct(l,v)+'%"></i></span><span class="sv">'+(disp!=null?disp:(Number(v)>=1000?kfmt(v):v))+'</span></div>'};
    var cmp=function(l,a,b2){a=Number(a)||0;b2=Number(b2)||0;var hi=Math.max(a,b2,1),base=hi*0.45,den=(hi-base)||1;var pa=Math.max(4,Math.min(100,Math.round((a-base)/den*100))),pb=Math.max(4,Math.min(100,Math.round((b2-base)/den*100)));return '<div class="cl">'+l+'</div><div class="cr mine"><span class="ck">나</span><span class="cbar mine"><i style="width:'+pa+'%"></i></span><span class="cv">'+a+'</span></div><div class="cr"><span class="ck">메타</span><span class="cbar meta"><i style="width:'+pb+'%"></i></span><span class="cv">'+b2+'</span></div>'};
    // 칼바람 의미지표만 — 피해 감소·회복·CC·팀딜 지분. 분당 딜량·받은피해·골드는 ARAM서 무의미(사용자 지적)라 제거하고 의미지표를 주연으로.
    var radarData={dpm:mc&&mc.dpm,taken:mc&&mc.taken,gpm:mc&&mc.gpm,mit:mc&&mc.mit,heal:mc&&mc.heal,cc:mc&&mc.cc,metaDpm:d.dpm,metaTank:d.tank,metaGpm:d.gpm,metaMit:d.mit,metaHeal:d.heal,metaCc:d.cc}; // 나=mc(개인)/메타=d(챔프 평균)
    var barsBox=impactRadarHtml(radarData); // 지표 분석 6축 육각형(나 vs 메타)
    var extraStrip='';
    // 아군 궁합 박스
    /* ★2026-09-18 숫자 = 그 아군의 승률이 아니라 **궁합**(둘이 같이 있을 때만 더 이기는 몫). 사이트 synBox 와 같은 표기. */
    var swr=function(x){if(x&&isFinite(x.lift)){var n=Math.round(x.lift*1000)/10;return '<span class="iwr '+(n>=0?'good':'bad')+'">'+(n>=0?'+':'')+n.toFixed(1)+'%</span>'}return rwr(x.winRate,x.thin)};
    var stip=function(x){return isFinite(x.lift)?(x.name+' · 같이 '+x.winRate+'% · '+kfmt(x.games||0)+'판'):(x.name+' · '+kfmt(x.games||0)+'판')};
    var synH=(d.synergies&&d.synergies.length)?'<div class="ib" style="gap:10px">'+d.synergies.slice(0,6).map(function(x){return '<div class="ally" style="text-align:center" title="'+esc(stip(x))+'">'+img(x.icon,"ci")+'<div class="icap">'+esc(x.name)+'<br>'+swr(x)+' <span class="g">'+amMan(x.games||0)+'판</span></div></div>'}).join('')+'</div>':'<div class="blank">데이터 없음</div>'; /* §12 #18 */
    // 아이템 박스(공통)
    var its=sortBuild(d.items), core=its.slice(0,3), rest=its.slice(3,9);
    function ibi(x){return '<span class="ibi" title="'+esc(x.name+(x.desc?'\n'+x.desc:''))+'">'+pim(x.icon)+'</span>'}
    var coreH=core.length?'<div class="core-row">'+core.map(function(x){return '<div class="core">'+ibi(x)+'<span class="core-nm">'+esc(x.name)+'</span><span class="core-st"><b class="'+(x.thin?'':(x.winRate>=50?'good':'bad'))+'">'+x.winRate+'%</b><small title="'+kfmt(x.games)+'판">'+amMan(x.games)+'판</small></span></div>'}).join('')+'</div>':'<div class="blank">데이터 없음</div>'; /* §12 #17 개별 카드 — 이미 있는 x.name/x.winRate/x.games만 사용 */
    var restH=rest.length?'<div class="ib">'+rest.map(function(x){return '<div style="text-align:center">'+ibi(x)+'<div class="icap" title="'+kfmt(x.games)+'판">'+rwr(x.winRate,x.thin)+'<br>'+amMan(x.games)+'판</div></div>'}).join('')+'</div>':'<div class="blank">데이터 없음</div>';
    // 룬 페이지(일반) — 전체 트리 카탈로그(op.gg식): 모든 룬 표시, 찍은 것만 강조+승률, 나머지 흐림
    function runePage(picks,catalog){
      if(!catalog||!catalog.length){ // 카탈로그 없으면 픽만
        if(!picks||!picks.length) return '<div class="blank">데이터 없음</div>';
        return '<div class="rp"><div class="rp-grid" style="grid-template-columns:repeat(4,1fr)">'+runeSort(picks).slice(0,8).map(function(x){return '<span class="rc on"><span class="ri28">'+pim(x.icon)+'</span><span class="rcw on">'+x.winRate+'%</span><span class="rcg" title="'+kfmt(x.games)+'판">'+amMan(x.games)+'</span></span>'}).join('')+'</div></div>';
      }
      var pick={}; (picks||[]).forEach(function(r){if(r.id!=null)pick[r.id]=r;});
      var ks=runeSort((picks||[]).filter(function(r){return r.cat==="main"&&r.slot===1})); var pTree=ks[0]?ks[0].tree:null;
      var subs=(picks||[]).filter(function(r){return r.cat==="sub"&&r.tree!==pTree}); var secTree=amPickSecTree(subs, catalog); // ★보조 트리 = 카탈로그 실제 행별 최고픽(gate+기여도) 상위2행 합 최대 트리(전부 지는 트리 방지, pick slot 왜곡 안 씀)
      var treeBlock=function(tree,skipKey,label){
        if(!tree) return ''; var runes=catalog.filter(function(c){return c.tree===tree}); if(!runes.length) return '';
        var slots={}; runes.forEach(function(c){(slots[c.slot]=slots[c.slot]||[]).push(c)});
        var slotKeys=Object.keys(slots).sort(function(a,b){return a-b}).filter(function(sk){return !(skipKey&&sk==="0")}); // 보조 트리는 키스톤행(slot 0) 스킵
        var maxC=Math.max.apply(null,slotKeys.map(function(sk){return slots[sk].length})); if(!(maxC>0))maxC=1;
        // 슬롯별 추천 픽 + 사용량(games) 선계산
        var slotRec={};
        slotKeys.forEach(function(sk){
          var usedPicks=slots[sk].filter(function(c){return pick[c.id]&&(tree!=="파편"||String(pick[c.id].slot)===String(sk))}).map(function(c){return pick[c.id]}); // ★파편만 데이터 실제 슬롯으로 필터 — 카탈로그가 적응형/체력을 두 슬롯에 중복 배치, slot8=이동속도 누수 방지. main/sub는 카탈로그·데이터 슬롯번호 체계 달라 필터 제외
          var rec=runeSort(usedPicks)[0];
          slotRec[sk]={recId:rec?rec.id:null,games:usedPicks.reduce(function(s,p){return s+(p.games||0)},0),imp:rec?amImp(rec):-1e12,rec:rec||null};
        });
        // ⚠️ 보조(secondary) 트리는 LoL 규칙상 슬롯 3개 중 2개만 선택 → 상위 2슬롯만 추천 강조. ★최고승률=행 대표룬 amRuneCmp(승리행 먼저·승리끼리 기여도·패배끼리 Wilson) 상위2행, 가장흔한=판수↓ 상위2행. 주룬/파편은 전부.
        var active={};
        if(skipKey) slotKeys.slice().sort(function(a,b){ if(buildMode==="win"){ var ra=slotRec[a].rec,rb=slotRec[b].rec; if(!ra&&!rb)return 0; if(!ra)return 1; if(!rb)return -1; return amRuneCmp(ra,rb); } return slotRec[b].games-slotRec[a].games; }).slice(0,2).forEach(function(sk){active[sk]=1});
        else slotKeys.forEach(function(sk){active[sk]=1});
        var cells='';
        slotKeys.forEach(function(sk){
          var isKs=(sk==="0"); // 키스톤행 → 크게
          var recId=active[sk]?slotRec[sk].recId:null; // 토글에 따른 추천 픽(보조는 상위 2슬롯만)
          slots[sk].forEach(function(c){ var p=pick[c.id], on=(c.id===recId);
            cells+='<span class="rc'+(isKs?' ks':'')+(on?' on':'')+(p?'':' off')+'" title="'+esc(c.name+(p?' · 승률 '+p.winRate+'% · '+kfmt(p.games)+'판':' · (미사용)')+((_runeMap&&_runeMap[c.id]&&_runeMap[c.id].desc)?'\n'+_runeMap[c.id].desc:''))+'"><span class="ri28">'+pim(c.icon)+'</span><span class="rcw'+(on?' on':'')+'">'+(p?p.winRate+'%':'')+'</span>'+(function(l){return '<span class="rcg'+(l.length>=7?' long':'')+'">'+l+'</span>'})(p?amMan(p.games)+'판':'')+'</span>'; // 2026-09-19 B안: 룬 아이콘 밑(칸 57px)이라 만 단위, 전체 숫자는 칸 title. "1,234만판"처럼 7글자부터는 12px(14px 이면 62px 로 넘친다)
          });
          for(var i=slots[sk].length;i<maxC;i++) cells+='<span class="rc empty"></span>';
        });
        return '<div class="rp-tree"><div class="tname">'+esc(tree)+(label?' ('+label+')':'')+'</div><div class="rp-grid" style="grid-template-columns:repeat('+maxC+',1fr)">'+cells+'</div></div>';
      };
      return '<div class="rp">'+treeBlock(pTree,false,'주 룬')+treeBlock(secTree,true,'보조')+treeBlock('파편',false,'스탯')+'</div>';
    }
    // 전체 보조 선택지 표(레퍼런스 3~5)
    function entityTable(title,arr,ic){
      if(!arr||!arr.length) return '';
      var s=arr.slice().sort(function(a,b){return b.games-a.games});
      return '<div class="rtable"><h4>'+title+'</h4><div class="rt-grid">'+s.map(function(x){return '<div class="rt-r">'+img(x.icon,ic==="auto"?(x.cat==="shard"?"ii":"ri"):ic)+'<span class="rn">'+esc(x.name)+'</span><span class="rv">'+rwr(x.winRate,x.thin)+'</span><span class="rg">'+kfmt(x.games)+'판</span></div>'}).join('')+'</div></div>';
    }
    // 증강 추천(아이콘+승률+판수, 컴팩트)
    function augGrid(arr,wch){return arr.length?'<div class="agrid" style="--acw:'+(wch||acWidthCh(arr))+'">'+arr.map(function(x){return '<div class="ac" title="'+esc(x.name+(x.desc?'\n'+x.desc:''))+'">'+img(x.icon,"ii")+'<span class="iwr '+(x.thin?'':(x.winRate>=50?'good':'bad'))+'">'+x.winRate+'%</span><span class="ig" title="'+kfmt(x.games)+'판">'+amMan(x.games)+'판</span></div>'}).join('')+'</div>':'<div class="blank">데이터 없음</div>'}
    function augGroups(arr){ // 추천증강 프리즘/골드/실버 등급 묶음(rarity 없으면 평면 폴백)
      if(!arr||!arr.length) return '<div class="blank">데이터 없음</div>';
      var wch=acWidthCh(arr); // 등급 그룹이 나뉘어도 폭 기준은 전체 하나 — 프리즘/골드/실버 줄끼리 간격이 달라지지 않게
      if(!arr.some(function(x){return x.rarity})) return augGrid(arr,wch);
      var G=[["prismatic","프리즘","#e08bd0","pz"],["gold","골드","#f0c674","gd"],["silver","실버","#b9c4d6","sv"]],out="",first=true; // §12 #15 희귀도 클래스
      G.forEach(function(g){var sub=arr.filter(function(x){return String(x.rarity).toLowerCase()===g[0]});if(sub.length){out+='<div class="aug-t '+g[3]+'" style="font-size:16px;font-weight:700;color:'+g[2]+';margin:'+(first?0:11)+'px 0 6px">'+g[1]+'</div>'+augGrid(sub,wch);first=false;}});
      var rest=arr.filter(function(x){return !G.some(function(g){return String(x.rarity).toLowerCase()===g[0]})});if(rest.length){out+='<div class="aug-t" style="font-size:16px;font-weight:700;color:var(--mut);margin:'+(first?0:11)+'px 0 6px">기타</div>'+augGrid(rest,wch);}
      return out;
    }
    var html;
    if(mode==="augment"){
      html=head+
        '<div class="cp-grid gR">'+
          '<div class="cp-box"><h4>추천 증강 · '+bm+'</h4>'+augGroups(sortBuild(d.runes).slice(0,12))+'</div>'+
          '<div class="cp-box"><h4>지표 분석 (분당)</h4>'+barsBox+extraStrip+'</div>'+
        '</div>'+
        '<div class="cp-grid g2"><div class="cp-box ci-box"><h4>추천 아이템 · '+bm+'</h4><div class="ilab">핵심 아이템</div><div class="core-items">'+coreH+'</div><div class="ilab">그 외 아이템</div><div class="added-items">'+restH+'</div></div><div class="cp-box"><h4>잘 맞는 아군</h4>'+synH+'</div></div>';
    } else {
      html=head+
        '<div class="cp-grid gR">'+
          '<div class="cp-box"><h4>룬 · '+bm+'</h4>'+runePage(d.runes,d.runeCatalog)+'</div>'+
          '<div class="cp-box"><h4>지표 분석 (분당)</h4>'+barsBox+extraStrip+'</div>'+
        '</div>'+
        '<div class="cp-grid g2"><div class="cp-box ci-box"><h4>아이템 · '+bm+'</h4><div class="ilab">핵심 아이템</div><div class="core-items">'+coreH+'</div><div class="ilab">그 외 아이템</div><div class="added-items">'+restH+'</div></div><div class="cp-box"><h4>잘 맞는 아군</h4>'+synH+'</div></div>';
    }
    $("#champpage").innerHTML='<div class="cp-wrap">'+html+'</div>';
    document.body.classList.add("cp");
    $("#cpback").onclick=navToList;
    document.querySelectorAll("#champpage .btoggle button").forEach(function(b){b.onclick=function(){buildMode=b.dataset.bm;renderChamp(lastChampData);}});
    try{ if(window.__igReattach)window.__igReattach(); }catch(_){} // ★인게임 중 상세 재렌더 시 조합배너 즉시 복구(둘 다 보이게). 게임 밖이면 no-op(igGameChamp 게이트).
  }

  /* ── 아이템/룬/증강 상세(데이터 근거만: 지표·관계. 지어낸 빌드/구매순서 없음) ── */
  var ENT_MAX={"분당 딜":2500,"분당 받은 피해":2800,"분당 피해 감소":1500,"분당 회복":600,"분당 CC":4,"분당 골드":1200};
  function entVal(m){return m.cc?(Number(m.value).toFixed(1)+'초'):(m.value>=1000?kfmt(m.value):String(Math.round(m.value)));}
  // 챔프 지표 막대: 고정 큰 max(2500 등)는 값이 달라도 비슷한 길이라 차이가 안 느껴짐 → 실데이터 범위에 맞춘 floor·ceil로 정규화(차이가 막대로 보이게). 막대 폭은 CSS에서 제한(쓸데없이 길지 않게).
  var CHAMP_RNG={'딜량':[900,2400],'딜':[800,2600],'받은피해':[1100,2900],'받은 피해':[1000,2900],'피해 감소':[80,1600],'회복':[20,700],'CC':[0.1,3.5],'골드':[650,1200],'팀딜 지분%':[8,36]};
  function champPct(l,v){var r=CHAMP_RNG[l]||[0,Math.max(1,Number(v)||1)];return Math.max(3,Math.min(100,Math.round(((Number(v)||0)-r[0])/((r[1]-r[0])||1)*100)));}
  function openItem(id){openEntity('item',id);}
  function openRune(id){openEntity('rune',id);}
  function openAugment(id){openEntity('augment',id);}
  function openEntity(kind,id){
    navPush({t:"entity",kind:kind,id:id});
    var _tk=++_navSeq;
    $("#champpage").innerHTML=cpLoading();
    document.body.classList.add("cp");
    var path=kind==="item"?"/api/item":(kind==="rune"?"/api/rune":"/api/augment");
    fetch(path+"?mode="+mode+"&id="+encodeURIComponent(id)+"&range="+encodeURIComponent(activeTableRange)).then(function(r){return r.json()}).then(function(d){if(_tk===_navSeq)renderEntity(d);}).catch(function(){if(_tk===_navSeq)closeChamp();});
  }
  function renderEntity(d){
    if(!d||d.error){closeChamp();return;}
    function rel(arr,navkey){
      if(!arr||!arr.length) return '<div class="blank">데이터 없음</div>';
      return arr.map(function(x){
        var nav=navkey==="champ"?' clk" data-champ="'+esc(x.name)+'"':(x.id!=null?' clk" data-'+navkey+'="'+esc(x.id)+'"':'"');
        return '<div class="row'+nav+(x.desc?' title="'+esc(x.name+'\n'+x.desc)+'"':'')+'>'+img(x.icon,"ci")+'<span class="nm">'+esc(x.name)+'</span>'+wr(x.winRate,false)+'<span class="g">'+kfmt(x.games)+'판</span></div>'; // 등급/분류 태그(골드·프리즘·실버/파편·하위룬·메인룬) 제거 — 사용자 지시
      }).join('');
    }
    function slotsBox(slots){
      var bySlot={},maxN=4; (slots||[]).forEach(function(s){var n=Number(s.slot)||0; if(n>0){bySlot[n]=s; if(n>maxN)maxN=n;}}); // 빈 슬롯도 -/0판으로 칸 유지(1~4선택)
      var cells='';
      for(var i=1;i<=maxN;i++){ var s=bySlot[i];
        if(s){ var cls=s.winRate>=50?'good':'bad'; cells+='<div class="slot-cell"><div class="slot-n">'+i+'번째 선택</div><div class="slot-wr '+cls+'">'+s.winRate+'%</div><div class="slot-g">'+kfmt(s.games)+'판</div></div>'; }
        else { cells+='<div class="slot-cell empty"><div class="slot-n">'+i+'번째 선택</div><div class="slot-wr">-</div><div class="slot-g">0판</div></div>'; }
      }
      return '<div class="slot-row">'+cells+'</div>';
    }
    var back={item:'← 아이템 목록',rune:'← 룬 목록',augment:'← 증강 목록'}[d.kind]||'← 목록';
    var tags=[]; if(d.cls)tags.push(esc(d.cls)); if(d.rarity)tags.push(esc(d.rarity)); else if(d.sub)tags.push(esc(d.sub)); tags.push((d.games||0)+'판 집계');
    var tn=Math.min(Number(d.tier)||0,5), tl=tn?'SABCD'.charAt(tn-1):'-';
    var wrCls=d.winRate>=50?'good':'bad';
    // 판정 히어로 — 사람들이 궁금한 "좋은가 나쁜가"를 가장 크게: 티어 + 승률
    var hero='<button class="cp-back" id="cpback" type="button">'+back+'</button>'+
      '<div class="ed-hero"><span class="ed-ic">'+pim(d.icon)+'</span>'+
        '<div class="ed-id"><div class="ed-name">'+esc(d.name)+'</div><div class="ed-tags">'+tags.join(' · ')+'</div></div>'+
        '<div class="ed-verdict"><div class="ed-vstat"><b class="t'+(tn||5)+'">'+tl+'</b><span class="vlab">티어</span></div><div class="ed-vstat"><b class="'+wrCls+'">'+d.winRate+'%</b><span class="vlab">승률</span></div></div>'+
      '</div>'+
      (d.plaintext?'<div class="edesc-full">'+esc(d.plaintext)+'</div>':''); // 설명은 hero(flex) 밖 전체폭 블록 — flex 안에선 0폭 수축돼 세로로 깨지던 것 근본해결(전체표시)
    // 분당 지표 제거(아이템·증강·룬 전 엔티티 상세): 분당 딜/받은피해/감소/회복/CC/골드는 '그 엔티티'의 분석이 아니라 그걸 쓴 게임들의 평균치라 무의미. 승리연관=헤더 승률, 엔티티 의미=슬롯별 승률·궁합. 사용자가 무의미하다 지목한 지표를 같은 종류 상세에 일관 적용.
    var metricsStrip='';
    // 슬롯(증강) — 어느 슬롯이 좋은가
    var slotsHtml=(d.slots&&d.slots.length)?'<div class="ed-sec">'+slotsBox(d.slots)+'</div>':'';
    // 궁합(관계)
    var R=d.relations||{};
    var _bx=function(t,h){return '<div class="cp-box"><h4>'+t+'</h4>'+h+'</div>';};
    var g; // 관계 3열 한 화면(잘 쓰는 챔피언 | 함께 간 증강·룬 | 함께 간 아이템) — 스크롤 없게
    if(d.kind==="item") g='<div class="cp-grid gE3">'+_bx('잘 쓰는 챔피언',rel(R.champions,"champ"))+(d.mode==="augment"?_bx('함께 간 증강',rel(R.augments,"augment")):_bx('함께 간 룬',rel(R.runes,"rune")))+_bx('함께 간 아이템',rel(R.itemPairs,"item"))+'</div>';
    else if(d.kind==="rune") g='<div class="cp-grid gE3">'+_bx('잘 쓰는 챔피언',rel(R.champions,"champ"))+_bx('함께 간 아이템',rel(R.items,"item"))+_bx('함께 간 룬',rel(R.runePairs,"rune"))+'</div>';
    else g='<div class="cp-grid gE3">'+_bx('잘 쓰는 챔피언',rel(R.champions,"champ"))+_bx('함께 간 증강',rel(R.augments,"augment"))+_bx('함께 간 아이템',rel(R.items,"item"))+'</div>';
    var relsHtml='<div class="ed-sec">'+g+'</div>';
    $("#champpage").innerHTML='<div class="cp-wrap ed-wrap">'+hero+metricsStrip+slotsHtml+relsHtml+'</div>'; // 상세 페이지에는 상대법을 두지 않는다(2026-07-22 사용자 지시) — 상대법은 메타 '상대법' 탭에만
    document.body.classList.add("cp");
    $("#cpback").onclick=navToList;
  }

  /* ── 내 전적 ── */
  // ★2026-07-22: 3분 타이머·창 포커스 복귀마다 #me 를 innerHTML 로 통째 교체했다. 노드가 새로 만들어지면
  //   .match 의 진입 애니메이션(amcRise)이 매번 다시 돌아, 바뀐 게 없어도 전적이 깜빡이며 갱신되는 것처럼 보였다.
  //   완성된 HTML 을 지문으로 남겨 두고, 같은 결과면 DOM 을 아예 건드리지 않는다(애니메이션도 안 돈다).
  //   force=true 면 지문을 무시하고 다시 그린다(모드 전환·익명 토글처럼 즉시 반영이 필요한 경로).
  var _meSig=null;
  function renderMe(force){
    if(!lastMe)return;
    if(lastMe.error){ try{$("#me").innerHTML='<p class="hint">전적을 불러오지 못했어요. 롤 클라이언트가 켜져 있는지 확인하고 잠시 후 다시 시도해 주세요.</p>';}catch(_){} _meSig=null; return; } // 2026-07-09 /api/me 500 {error}를 '롤에서 최근 0판 읽었어요'로 오분기하던 문제 — 실패를 실패로 표시
    var rec=mode==="augment"?lastMe.augment:lastMe.standard;
    if(!rec||!rec.total){
      var msg;
      if(mode==="augment"){ msg='증강 칼바람 기록이 없어요.'; }
      else if(lastMe.leagueOff){ msg='웹 버전에서는 로컬 롤 클라이언트(LCU)에 직접 연결할 수 없어요. [데모 체험] 버튼으로 개인 전적과 사주풀이를 체험해보세요!'; }
      else { msg='최근 일반 칼바람 기록이 없어요.'; }
      $("#me").innerHTML='<p class="hint">'+msg+'</p>'; _meSig=null; renderMyChamps(); return;
    }
    var sm='<div class="sm">'+
      '<div class="sm-top"><div class="sm-stat"><div class="big">'+rec.winRate+'%</div></div>'+
        '<div class="nick" title="'+esc(dispWho()+(dispTag()?'#'+dispTag():''))+'"><span class="nickname">'+esc(dispWho())+'</span>'+(dispTag()?'<span class="nicktag">#'+esc(dispTag())+'</span>':'')+'</div></div>'+
      /* ★2026-09-15 판수가 커져서 세 자리마다 쉼표를 넣는다(kfmt). 계산이 아니라 표시 자리만이다. */
      '<div class="sub"><span class="sub-t">'+kfmt(rec.total)+'전 '+kfmt(rec.wins)+'승 '+kfmt(rec.total-rec.wins)+'패</span><span class="sm-rank" id="smrank"></span></div>'+
      '<div class="form">'+(function(f){f=f||[];var n=f.length,h='';for(var i=0;i<n;i++){var w=f[i],L=1,R=1;for(var j=i-1;j>=0&&f[j]===w;j--)L++;for(var j2=i+1;j2<n&&f[j2]===w;j2++)R++;var c=Math.min(L,R),t=Math.min((c-1)/2,1);var op=(0.5+0.5*t).toFixed(2);h+='<span class="fdot '+(w?'w':'l')+'" style="opacity:'+op+'" title="'+(w?'승':'패')+'"></span>';}return h;})(rec.form)+'</div>'+ /* 색=시간대 hour bar와 동일 good/bad(CSS), 농도=연속 중심도 opacity(연승/연패 중심일수록 불투명=진해짐). 사각형을 시간대별 승률에 맞춤 */
      (rec.form.length?'<div class="form-cap"><span>← 최근</span><span>'+rec.form.length+'게임</span></div>':'')+ /* §12 #7 방향 캡션(실데이터 판수 그대로) */
    '</div>';
    var matches='<div class="sec sec-row">최근 경기<span class="mmr-badge" id="mmrbadge"></span></div>'+rec.recent.map(function(m,mi){
      var sp='<div class="m-sp">'+(m.spells||[]).slice(0,2).map(function(u){return '<span class="sp">'+pim(u)+'</span>'}).join('')+'</div>';
      var its=(m.items||[]).slice(0,6),slots='';for(var i=0;i<6;i++){slots+='<span class="islot">'+pim(its[i])+'</span>';}
      var mkT=m.mk>=5?['펜타','penta','펜타킬']:m.mk>=4?['쿼드라','quad','쿼드라킬']:m.mk>=3?['트리플','tri','트리플킬']:m.mk>=2?['더블','dbl','더블킬']:null; // 아이콘 오버레이라 짧은 라벨, 전체명은 title
      var mkBadge=mkT?'<span class="mk-badge mk-'+mkT[1]+'" title="'+mkT[2]+'">'+mkT[0]+'</span>':'';
      var _dm=String(m.dur||'').split(':'),_mn=Math.round((Number(_dm[0])||0)+(Number(_dm[1])||0)/60); // 게임길이 30초 기준 반올림→분
      var when=(m.date||'')+(m.dur?' · '+_mn+'분 경기':''); // 목록: 월/일 · N분 경기 (초 없음)
      // 가한 피해(유틸폿엔 무의미·6지표중 1개만이라 오해)·중간줄(m-c2) 제거 → 우측엔 멀티킬 배지(킬별 색)만. 배지 유무와 무관하게 행 높이 고정.
      return '<div class="match clk '+(m.win?'win':'loss')+'" data-mi="'+mi+'">'+
        '<div class="m-l"><span class="m-ic">'+img(m.icon,"ci")+mkBadge+'</span>'+sp+'</div>'+
        '<div class="m-c">'+
          '<div class="m-c1"><b class="m-name" title="'+esc(m.name)+'">'+esc(m.name)+'</b></div>'+
          '<div class="m-it">'+slots+'</div>'+
        '</div>'+
        '<div class="m-r">'+(m.kda?'<span class="m-kda">'+kda3(m.kda,false)+'</span>':'')+'<span class="m-t">'+when+'</span></div>'+
      '</div>';}).join("");
    var _html=sm+matches;
    if(!force&&_meSig===_html){ renderMyChamps(); return; } // 내용 동일 → DOM 유지(깜빡임·진입 애니메이션 재생 없음)
    _meSig=_html;
    $("#me").innerHTML=_html;
    fillRankBadge(mode, rec.recent, rec.rankGids);
    fillMmrBadge();
    renderMyChamps();
  }

  /* ── 최근 N판 평균 등수 배지 ──
     전적 개요(10인 표)에 매기는 그 등수를 최근 판들에 대해 평균낸다. 별도 계산식을 새로 만들지 않는다.
     게임별 등수는 서버의 렌더 캐시를 타므로 이미 펼쳐 본 판은 즉시 나오고, 처음 보는 판만 LCU 를 읽는다.
     못 구한 판은 조용히 빼고 구한 것만으로 평균낸다(0판이면 배지를 감춘다 — 없는 값을 지어내지 않는다). */
  var _rrCache={};
  function _rrBadge(j){
    var a=Number(j.avg)||0;
    var cls=a<=4.5?'g':(a<=6.5?'m':'b');                       // 10인 중 5.5 가 중앙
    /* 예비까지 다 봐도 목표(20판)를 못 채웠을 때만 꼬리말을 단다. 평소엔 딱 20판이라 안 뜬다. */
    var note=(j.n<(j.want||j.asked))?(' ('+j.asked+'판 중 '+j.n+'판 계산됨)'):'';
    return '<span class="rb '+cls+'" title="최근 '+j.n+'판, 전적 개요와 같은 기준으로 매긴 등수의 평균입니다.'+note+'">'+
      '평균 '+a.toFixed(1)+'위</span>';
  }
  /* ★2026-09-12 MMR 배지 — "최근 경기" 줄 오른쪽. 운영자 지시: "담담하게 MMR - 0000 이런식으로".
     ⚠️ 증강 칼바람에서만 띄운다(일반 칼바람엔 MMR 이 없다).
     ⚠️ 찾는 열쇠는 "이름#태그" 통째다. 태그가 다르면 다른 사람이라, 못 찾으면 못 찾았다고만 한다.
     ⚠️ 익명 모드여도 조회는 진짜 이름으로 한다(화면에 이름을 안 띄우는 기능이지 다른 사람이 되는 게 아니다). */
  var _mmrCache={};
  /* 운영자 지시: "물음표를 누르면 아래처럼 뜨게". 마우스를 올려도 뜨는 기존 동작은 그대로 두고 클릭 토글을 얹는다.
     바깥을 누르면 닫힌다 — 열어놓고 다른 걸 누르는데 계속 떠 있으면 화면을 가린다. */
  function _mmrTipClick(el){
    var h=el.querySelector('.ao-help'); if(!h) return;
    h.onclick=function(e){ e.stopPropagation(); h.classList.toggle('open'); };
    if(!_mmrTipClick._bound){
      _mmrTipClick._bound=true;
      document.addEventListener('click',function(){
        var o=document.querySelector('.mmr-badge .ao-help.open'); if(o)o.classList.remove('open');
      });
    }
  }
  /* ★2026-09-12 이 글은 **운영자가 직접 써 준 문구**다. 임의로 고치거나 문장을 보태지 마라.
     바뀌는 값은 분석 판수 하나뿐이다(운영자 원문의 "000,000게임" 자리).
     ★2026-09-14 운영자 지시로 단위를 "게임" -> "건" 으로 바꾸고 값에 0 을 하나 더 붙였다.
       "게임 숫자보다 건의 숫자로 통일하는거야" — 사이트의 같은 문장과 맞춘 것이다.
       meta.games 는 판 수이고 증바람은 한 판에 10명이라 참가 행은 정확히 10배다
       (구간 빌드 실측: 판 1,136,353 · 참가 행 11,363,530).
       ⚠️ 사이트 app_v2.js 의 amMmrBasisText · m/m.js 의 mmrBasisText 와 같은 계산이다.
          한 곳만 고치면 앱과 사이트 숫자가 갈린다. 셋은 같은 mmr/meta.json 을 읽는다.
     ★2026-09-19 운영자 승인 문구로 바꿨다("좋네") — MMR 이 "만나는 판 수준 + 그 안 지표"(마무리)로 바뀌어
       "승패 여부는 반영되지 않습니다" 가 사실이 아니게 됐다(매칭 자리가 승패로 움직인다).
       "[최대 3000 ~ 최저 0]" 줄은 뺐다 — 3000 을 넘는 사람이 있다(09-19 명단 35명 · 1등 3,055).
       사이트·모바일의 설명(amMmrBasisText · mmrBasisText)은 운영자 지시로 그대로 둔다("칼바람 분석기가 아니고서야 설명이 다르구나"). */
  function _mmrHow(j){
    var m=j.meta||{};
    return '<b>증바람MMR이란?</b><br>'
      +'모든 계정이 1500에서 시작합니다. 경기에 함께한 플레이어들의 MMR 평균에 자신의 인게임 지표를 일부 반영해 오르고 내려갑니다.<br><br>'
      +(((m.games||0)*10).toLocaleString())+'건을 분석한 기반으로 자신의 플레이를 증바람MMR 계산에 반영하며, 공식 MMR과는 상이할 수 있습니다.<br><br>'
      +'10판부터 점수가, 30판부터 등수가 나옵니다. 새 계정으로 로그인해 증바람MMR 측정이 안될 시 서버에 계정 데이터가 반영 중이니 몇 시간 뒤 다시 확인해보시면 됩니다.';
  }
  /* ── 티어 딱지 ───────────────────────────────────────────────────────────
     3000 이상이 챌린저, 그 아래는 실제 솔로랭크 비율대로 나눈 칸이다(경계는 사이트가 정해 실어 보낸다).
     ⚠️ 그림은 op.gg 가 쓰는 랭크 엠블럼 그대로다. 직접 그린 걸 쓰지 마라.
        컴패니언은 남의 PC 에서 도니 주소로 불러오지 않고 여기 글자로 박아 넣었다. */
  var _MMR_TIER_NAME=["아이언","브론즈","실버","골드","플래티넘","에메랄드","다이아몬드","마스터","그랜드마스터","챌린저"];
  var _MMR_TIER_IMG=['data:image/png;base64,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','data:image/png;base64,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','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAACXBIWXMAAAsTAAALEwEAmpwYAAAE9GlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNy4xLWMwMDAgNzkuOWNjYzRkZTkzLCAyMDIyLzAzLzE0LTE0OjA3OjIyICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjMuMyAoTWFjaW50b3NoKSIgeG1wOkNyZWF0ZURhdGU9IjIwMjItMDEtMTBUMTM6MTQ6MDQrMDk6MDAiIHhtcDpNb2RpZnlEYXRlPSIyMDIyLTA1LTAyVDExOjQzOjI1KzA5OjAwIiB4bXA6TWV0YWRhdGFEYXRlPSIyMDIyLTA1LTAyVDExOjQzOjI1KzA5OjAwIiBkYzpmb3JtYXQ9ImltYWdlL3BuZyIgcGhvdG9zaG9wOkNvbG9yTW9kZT0iMyIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo2MmUyNWVjOC0zNzQ4LTRhZjItOTM2NC1lMWI5NmU2MDY3OWMiIHhtcE1NOkRvY3VtZW50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','data:image/png;base64,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','data:image/png;base64,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','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAHXklEQVR4Ae2az1MUVxDHu2cGUHNwDXDTEv8DPaQKSKWy/AEmeMwpUApX8JgT+BeIV8UCbrmB8Q9wU6lCqnIAb7m5VjxYBZTrxcgy8166Z3bWmdlh3psfCML7nGD2za/v9Ovu1/0ADAaDwWAwGAwGg8FgMMSoPf7uJpxThh+PK9/dUg2wrb45OKcIC6ZUYyz1AFmvrdRrcM6orYyOIMCvqnFKASXgiOO25+Gc4QiLxVMajlJAH4Q5ssIROCew9Ukpp3TGKgVEkE2+puMdrMA5wXZxEQFHdMbqWaAP1oeejJ35qTz8dHwKEZW+L0TtA9Fqdf9BfDh8htOaYOrCw/B/CdBUnaMWUMg30f+F1bd+Fv0hi2d7+AIigaPjvjJRT2GMfwUK7XSj9ouzJGIoXo/fk/hBda46D0TYSR47SyIeKV7Ajup8pYCHXvpFWETHa28PLo9NwlfK0JPRuuNZ20dFXAtleQGhr7+Z8WuNbr4+9HR8Ab4yvl0emwO0Yj4vSdseUAqIoMHQ8tgLTmOyxnDE8uz+idZ0owmnGJ6yjocrqvchZXb27m7eAgV6eaDEP1VDwil9mnNFtjqeskrxCClRaX2MZiItGnrjaDpQrji4PP76NAWYGpWleBZZgEugsb5lUHprWuNAk6Hl8fe6Nw+hQsSqZ/c9OKlpzVUkRxwukDnlmhXsjvbvbd7QGau/lJPwCHJCiegUTevXg8vfr3xJi2ThOLDxvfOKF4AN7ZG6A/2v6bXfQwnyWiQ7/OCvCy06p6Uz3vas+U4dr3gNU4qJvZmths5QbQGZ4cejU9KySlVlsqaH/5Hcgyl6qp97HD1FRXbsWR9AJ1tQP6C8vzfzckl3eI5qDMDu7NaqKw45tCut4Sg41Uk7Prj8w6Q/5SgIpYog4WboEo7KO11bTpd5NilgOo94TC4Bmdbs3zsoxH0ogoRU62FBELx10J12EhbpnO1kq6E1vdUs4quDa8r7+7Obq5CT3AIybIl8Q8hHy3X6V5MHfWsiQSAvZJFU5F1PHqZ7sAXls0L6sHktL8SGgnx8/nbrm9tXb9CU06oPUgD5/f3dv2K5FTt9S+AGFAZHLt2++oGfJTzy6Vnz06Xb1y6Sz6zrXUM2SLxpKEghCww5dAbmpUbNjElLTIMlVUkQF3q7hnqJPwc01x4oLB5TSsBOaqE1lZNpQZCilIyYnUv5kbv3XsppbAkoneSXEpDZv/dyg6dB5qCUmqLlYnVlMD/tSR7DZtYpbH27BYJGEkc1IMjN2vMS4br/XBLeSKqTefZAI0xuhYRnVpbPkbLHGrAa6wuv1uOHpRCvMMM/s/WFf/M72t5BHSXejL6n44jVdxzZM1AKyCLRDZb6RHtSSLlAX5Y69kj+q82JawMFrh1SdLW8NudmqWmIBKuZPIYoL+fM47PIveo47OtvcEGVfSh4bRIaa/w4yFOfUiGO5nsaqx+lgEzH0lbJbzUcgeucQgS/YF1aULcD8b4mWlx6o4JqUvhXrt0/mccv5vKBnKgGRUYZSz24FggZVkDW1jvFaIpAdaRYCmZZZQ16n5fFq+cNKoWCiB/6Ud1w6SJ9gROHcpyvvkFv48vC66BJkM74lpd7GVhIQL6Ra4k7oJ/x15LlLAtkdQJSEIvdjPNCKbUSfKZMK6JwGsPTmZJo7SSUcrVY2hLkaor0RxPXGYi5FA54oAstScvkgqXywE4OqLcUS8vVpHwAZUkpUAgBmgL6y7hCa+CQ0ol0ZymkMZV5cxKlDRF8K5RQWET2XXszm4vRY/7GyLSP1Uur7DKOKS0g+0Ptqcw5VwJfgAIihm3U5HHemqZzPlt/Fb2awtWYKP/98fafiz9du0LpzGj2yN7qCfPx+b8NPk4C8/kXQAHd5xFFzV9IgHfR47w1jX5V5qTcWtif2fwNKqC6pUCwHNrW2JjYQnE4sUuF2d5rUE+DLQjhx5TrkKXDBkqxltavCBrm3PPNXpVUvQGgMgGZKl8iWIN/8lMR14FmK2NNqtggFIX8Xv+tKtuslQrIBOtLf89JSIv6KBM2OvOJnZ++7wwiebn7ScSVhHgbdO01Osb1xu7H5J7HfgUVmCiVC8hEu3fRLhz7KC5IxF4Wccm1+h7ltYqgad6eS7QDWiRSt7cR69L5Zft4xK6C0lE4jaBnEkRWXieHFePdu5vUF5YTsSo2Nb6LbGC33YOlqHj+ckzARNzCOuWsYxKPORYBmWh6Evoyhn1Zj4gpOWIWPDbqDro+dXZzJzoGePoeo3jMsQnI8INTC3Raoh3b9R6IOHArJiKq048QSkOmPv+dHpD8MX6T/PjEY47FBybhKJkWRZPRkyLkFVVFJLrFJCuaH3XPqjlWCww56kV8SxRut6qjUwSIugNPwJ2jgs+XEI/5IgJmwTsdukWFbqU7C6veGfsg6vNOihMXkAkqIrIhAC+rxlLTp5ZWRDgpToWAPrqlLSlr0Y6aIcLQk/FF9ZjTtQf79FggdDcGKcYMlFr6GQwGg8FgMBgMBoPBYDAYDAZDUf4HCoF0IOm0NIoAAAAASUVORK5CYII=','data:image/png;base64,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','data:image/png;base64,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','data:image/png;base64,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','data:image/png;base64,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'];
  function _mmrTierImg(t){
    var i=Number(t);
    if(i===null||i===undefined||!isFinite(i)||i<0||i>9) return "";   // 서버가 티어를 안 주면(옛 조회표) 딱지를 안 그린다
    return '<img class="mb-tier" src="'+_MMR_TIER_IMG[i]+'" alt="'+_MMR_TIER_NAME[i]+'" width="18" height="18">';
  }
  function fillMmrBadge(){
    var el=document.getElementById('mmrbadge'); if(!el) return;
    if(mode!=="augment"){ el.innerHTML=''; return; }                       // 일반 칼바람은 빈 채로 둔다(CSS :empty 가 감춘다)
    var who=(lastMe&&lastMe.who)?String(lastMe.who).trim():'';
    var tag=(lastMe&&lastMe.whoTag)?String(lastMe.whoTag).trim():'';
    if(!who||!tag||who==='-'||who==='?'){ el.innerHTML=''; return; }        // 계정을 모르면 지어내지 않는다
    var id=who+'#'+tag;
    var done=function(j){
      if(!j||!j.ok){ el.innerHTML=''; return; }                            // 조회표를 못 받았으면 조용히 없앤다(배지는 곁가지다)
      if(!j.found){
        el.innerHTML='<span class="ao-help" tabindex="0" aria-label="MMR 안내">?<span class="ao-tip" role="tooltip">'
          +_mmrHow(j)+'</span></span>';
        _mmrTipClick(el);
        return;
      }
      var rk=Number(j.rank)||0, m=j.meta||{};
      /* 커서를 올리면 뜨는 줄 — 운영자 지시 "몇명 중 몇등 / 몇판 기준". 등수가 없으면 판수만 남긴다. */
      var tot=Number(m.basePeople)||0;
      var tip=(rk&&tot)?(tot.toLocaleString()+'명 중 '+rk.toLocaleString()+'등 / '+(Number(j.games)||0).toLocaleString()+'판 반영됨')
                       :((Number(j.games)||0).toLocaleString()+'판 반영됨');
      el.innerHTML='<span class="mb" title="'+tip+'">'
        +(rk?'<span class="mb-rk">#'+rk.toLocaleString()+'</span>':'')
        +'증바람MMR '+_mmrTierImg(j.tier)+j.mmr+'</span>'
        +'<span class="ao-help" tabindex="0" aria-label="증바람MMR 안내">?<span class="ao-tip" role="tooltip">'
        +_mmrHow(j)+'</span></span>';
      _mmrTipClick(el);
    };
    /* ★2026-09-12 캐시에 수명을 준다. 종전엔 한 번 받으면 앱을 끌 때까지 그 값만 썼다 —
       점수가 1시간마다 다시 계산되는데 화면은 껐다 켜야만 바뀌었다(운영자 신고).
       3분으로 둔다: 서버쪽 원격 캐시가 5분이라 그보다 짧아야 새 값을 놓치지 않는다. */
    var hit=_mmrCache[id];
    if(hit && (Date.now()-hit.at) < 3*60*1000){ done(hit.j); return; }
    fetch('/api/mmr?id='+encodeURIComponent(id),{cache:'no-store'}).then(function(r){return r.json()})
      .then(function(j){ _mmrCache[id]={at:Date.now(), j:j}; done(j); })
      .catch(function(){ if(!hit) el.innerHTML=''; });   // 실패하면 옛 값이라도 남겨둔다(깜빡임 방지)
  }
  /* 켜두고 아무것도 안 눌러도 따라가게 — 전적을 다시 그릴 때만 부르면 가만히 있는 동안은 영영 안 바뀐다.
     배지가 화면에 없으면 fillMmrBadge 가 바로 되돌아오므로 헛일이 아니다. */
  setInterval(function(){ try{ fillMmrBadge(); }catch(e){} }, 5*60*1000);
  function fillRankBadge(mode,recent,spare){
    var el=document.getElementById('smrank'); if(!el) return;
    /* ★2026-09-14 예비까지 보낸다. 20판만 보내면 등수를 못 구한 판이 그대로 빠져
       '최근 20판' 이 17판·15판으로 흔들렸다 — 서버가 20판을 채우면 거기서 멈춘다. */
    var gids=(spare&&spare.length?spare:(recent||[]).map(function(m){return m&&m.gid;}).filter(Boolean)).slice(0,40);
    if(!gids.length){ el.innerHTML=''; return; }
    var key=mode+'|'+gids.join(',');
    if(_rrCache[key]){ el.innerHTML=_rrBadge(_rrCache[key]); return; }    // 재렌더 시 깜빡임 없음
    el.innerHTML='<span class="rb m">평균 …</span>';
    var done=function(h){ var e=document.getElementById('smrank'); if(e) e.innerHTML=h; };
    fetch("/api/recent-rank?mode="+encodeURIComponent(mode)+"&want=20&gids="+encodeURIComponent(gids.join(',')))
      .then(function(r){return r.json();})
      .then(function(j){
        if(!j||!j.ok||!j.n){ done(''); return; }
        _rrCache[key]=j; done(_rrBadge(j));
      })
      .catch(function(){ done(''); });
  }

  /* ── 내 챔피언 통계(우측 2열째) — 내가 한 챔프 + 메타 나란히 ── */
  var _mcSig=null, _mcRowsSig=null; // 목록 지문(전체 / 행만) — 값 공간이 달라 따로 둔다
  function renderMyChamps(){
    var el=$("#mychamps");
    var rec=lastMe?(mode==="augment"?lastMe.augment:lastMe.standard):null; // 증강은 롤 무관(db.json)이라 leagueOff 게이트 없음
    if(!rec||!rec.total||!rec.champs.length){
      var em=!lastMe?'전적을 불러오면 표시돼요.':(mode!=="augment"&&lastMe.leagueOff?'롤을 켜고 불러오면 표시돼요.':(mode==="augment"?"증강":"일반")+' 기록이 없어요.');
      el.innerHTML='<p class="hint">'+em+'</p>'; _mcSig=null; _mcRowsSig=null; return; // 빈 상태 → 지문 초기화(다음에 데이터가 오면 반드시 다시 그린다)
    }
    var q=normName(_myChampQ);
    var shown=q?rec.champs.filter(function(c){return normName(c.name).indexOf(q)>=0;}):rec.champs;
    var rowsH=shown.length?shown.map(function(c){
      return '<div class="row clk" data-champ="'+esc(c.name)+'">'+img(c.icon,"ci")+'<span class="nm">'+esc(c.name)+'</span>'+wr(c.winRate,c.thin)+'<span class="g">'+kfmt(c.games)+'판</span></div>'; // 메타 티어/승률 라벨(mmeta) 제거 — 넓은 창 외부 유저까지 완전히 안 보이게(2026-07-13 사용자 지시)
    }).join(""):'<p class="hint">"'+esc(_myChampQ)+'"와 일치하는 내 챔피언이 없어요.</p>';
    // 검색창(item1) — 내 챔피언 통계에서 챔피언 필터. 입력 포커스 중이면 목록(#mc-rows)만 교체해 커서·값 보존(autoRefresh 재렌더 안전).
    if(document.activeElement&&document.activeElement.id==="mcq"&&$("#mc-rows")){ if(_mcRowsSig!==rowsH){ _mcRowsSig=rowsH; $("#mc-rows").innerHTML=rowsH; } return; }
    var _mcHtml='<div class="inpage-filter"><input id="mcq" type="text" placeholder="내 챔피언 검색" autocomplete="off" value="'+esc(_myChampQ)+'"></div><div id="mc-rows">'+rowsH+'</div>';
    if(_mcSig===_mcHtml) return; // 내용 동일 → DOM 유지(목록이 매번 다시 그려지며 깜빡이던 것 제거)
    _mcSig=_mcHtml; _mcRowsSig=rowsH;
    el.innerHTML=_mcHtml;
    var inp=$("#mcq"); if(inp) inp.oninput=deb(function(){_myChampQ=inp.value;renderMyChamps();},180);
  }

  /* ── controls ── */
  function setMode(m){mode=m;document.body.dataset.mode=m;closeChamp();_anData=null;_anTab=null; // data-mode → 듀얼톤 액센트 교체 · 2026-07-09 상세분석 캐시 무효화(모드전환 후 옛 모드 데이터에 새 모드 라벨이 섞이던 문제 방지 — 일칼≠증바람)
    /* ⚠️ 증강 칼바람(q2400) 에만 MMR 이 있다. 일반 칼바람(q450) 에서는 버튼을 내리고,
       열려 있던 창도 닫는다 — 두 모드의 수치를 섞어 보여주면 안 된다. */
    var _mb = $("#mmrbtn"); if (_mb) _mb.hidden = (m !== "augment");
    if (m !== "augment" && window.amMmrCloseWin) window.amMmrCloseWin();
    document.querySelectorAll(".toggle button").forEach(function(b){b.classList.toggle("on",b.dataset.mode===m)});
    var meModeEl=$("#me-mode"); if(meModeEl) meModeEl.textContent=m==="augment"?"시즌2":"올해"; // 모드는 상단 토글에 표시되므로 배지는 시즌만(헤더 혼잡 방지)
    $("#tab-rune").textContent=m==="augment"?"증강":"룬";
    $("#tab-rune").dataset.tab=m==="augment"?"augment":"rune";
    $("#q").value=""; _myChampQ=""; _anSearch=""; if(typeof findClear==="function")findClear(); // 모드 전환 → 페이지검색·필터 초기화(챔프목록·상세분석 데이터 교체됨)
    activeTab="broadcast"; document.querySelectorAll("#meta-tabs button").forEach(function(b){b.classList.toggle("on",normalizeMetaTab(b.dataset.tab)==="broadcast")});
    champMetaList=[]; tableDefs=[]; tableRanges=[]; tableTabs=[]; tableCategory="broadcast"; activeTableKey=""; tableOffset=0; tableLast=null; loadChampMeta(); loadTab("broadcast", true); renderMe(true); // 모드 전환 = 데이터가 통째로 바뀐다 → 강제 렌더
  }
  document.querySelectorAll(".toggle button").forEach(function(b){b.onclick=function(){setMode(b.dataset.mode)}});
  // 좌측 '내 전적' 카드 안에서 전적 ↔ 챔피언 통계 전환. renderMe가 #me와 #mychamps를 모두 그려두므로 display만 토글(재렌더 없음).
  function setMeView(v){
    var rec=v!=="champs";
    if($("#me")) $("#me").style.display=rec?"":"none";
    if($("#mychamps")) $("#mychamps").style.display=rec?"none":"";
    document.querySelectorAll("#me-switch button").forEach(function(b){b.classList.toggle("on",b.dataset.meview===(rec?"record":"champs"))});
  }
  document.querySelectorAll("#me-switch button").forEach(function(b){b.onclick=function(){setMeView(b.dataset.meview)}});
  // ── 설정 패널(클라 설정: 시작모드·자동불러오기, localStorage 저장·다음 실행 적용) ──
  function renderSettings(){
    var sm=localStorage.getItem('am_startMode')||'standard', auto=localStorage.getItem('am_autoLoad')!=='off';
    $("#setpage").innerHTML='<div class="set-wrap"><button class="cp-back" id="setback" type="button">← 닫기</button>'+
      '<div class="set-card">'+
        '<div class="set-row"><div class="set-t"><b>시작 모드</b><span>앱을 켤 때 기본으로 열리는 모드</span></div>'+
          '<div class="btoggle" style="margin-left:0"><button data-sm2="standard" class="'+(sm==="standard"?"on":"")+'" type="button">일반</button><button data-sm2="augment" class="'+(sm==="augment"?"on":"")+'" type="button">증강</button></div></div>'+
        '<div class="set-row"><div class="set-t"><b>실행 시 자동 불러오기</b><span>켜면 시작할 때 내 전적을 자동으로 갱신</span></div><div class="sw '+(auto?"on":"")+'" id="sw-auto" role="switch" tabindex="0"></div></div>'+
        '<div class="set-row"><div class="set-t"><b>메타 통계에 데이터 제공</b><span>전적을 모아 전체 메타 통계를 키웁니다. 동의하셔야 프로그램을 이용할 수 있습니다.</span></div><span style="font-size:16px;color:var(--good);font-weight:700">동의함</span></div>'+
        '<div class="set-row"><div class="set-t"><b>자동 업데이트</b><span>새 버전이 나오면 다음 실행에 자동 적용</span></div><span style="font-size:16px;color:var(--good);font-weight:700">켜짐</span></div>'+
        '<div class="set-row"><div class="set-t"><b>버전</b></div><span style="font-size:16px;color:var(--mut)">'+(window.__amVer?esc(window.__amVer):'-')+'</span></div>'+
        '<div class="set-row"><div class="set-t"><b>웹 통계 사이트</b><span>전체 메타 통계와 티어리스트를 웹에서 봅니다</span></div><a href="https://aram-mayhem.com" target="_blank" rel="noreferrer" style="font-size:15px;font-weight:700;color:#7fb3ff;text-decoration:none">aram-mayhem.com ↗</a></div>'+
      '</div>'+
      // ★Riot 비공식 고지(법적 필수) — 사이트 푸터 정본 문구를 글자 그대로 복사(수정 금지). 위치=설정 최하단(2026-08-26 사용자 선택 ②).
      '<div class="set-card" style="margin-top:10px"><div style="padding:12px 14px;font-size:11px;line-height:1.7;color:var(--mut)"><b style="display:block;font-size:11.5px;margin-bottom:3px;color:var(--tx2,#b8c4d9)">Riot Games 비공식 고지</b>'+
        'ARAM Mayhem Report는 Riot Games가 승인, 후원, 보증한 제품이 아니며 Riot Games의 공식 의견을 대변하지 않습니다. League of Legends, Riot Games 및 관련 자산과 상표는 Riot Games, Inc.의 소유입니다.'+
      '</div></div></div>';
    $("#setback").onclick=closeSettings;
    document.querySelectorAll('#setpage [data-sm2]').forEach(function(b){b.onclick=function(){localStorage.setItem('am_startMode',b.dataset.sm2);fetch("/api/settings?startMode="+encodeURIComponent(b.dataset.sm2)).catch(function(){});renderSettings();}});
    $("#sw-auto").onclick=function(){var on=localStorage.getItem('am_autoLoad')!=='off';var nv=on?'off':'on';localStorage.setItem('am_autoLoad',nv);fetch("/api/settings?autoLoad="+nv).catch(function(){});renderSettings();};
  }
  function openSettings(){closeChamp();renderSettings();document.body.classList.add("am-set-open");}
  function closeSettings(){document.body.classList.remove("am-set-open");$("#setpage").innerHTML="";}
  $("#setbtn").onclick=openSettings;
  // #19 뒤로가기 키가 Electron 창을 시작 스플래시(data:)로 되돌려 갇히는 것 방지.
  //   컴패니언은 URL 히스토리 네비를 안 쓰므로(DOM 스왑), 뒤로가기를 "열린 상세/설정 패널 닫기"로 가로채고
  //   센티넬을 즉시 다시 밀어 webContents가 스플래시로 빠지지 않게 한다.
  // ── 뷰 히스토리 스택(요구②, 2026-07-03): 상세 진입을 history state로 쌓고 뒤로가기는 한 단계씩 이전 뷰 복원(처음으로 튕기지 않음) ──
  var _navRestoring=false, _navSeq=0, _navEpoch=0, _igUserClosed=false; // _igUserClosed=이 게임 동안 사용자가 상세를 직접 닫았다(인게임 폴의 자동 재오픈 금지) // _navEpoch=out-of-band 닫기 세대. closeChamp가 옆길로 오버레이 닫을 때마다 +1 → 그 이전 엔트리를 popstate서 stale 처리(다단 중첩 orphan 재오픈 방지). _navSeq=네비 순번. 비동기 fetch 레이스 가드: 뒤로가기로 뷰를 떠나면 순번이 올라가, 떠나기 전 시작된 fetch가 늦게 와도 stale이라 렌더 안 함(엉뚱한 페이지 방지).
  function closeAllDetail(){++_navSeq;document.body.classList.remove("cp","am-set-open");if($("#champpage"))$("#champpage").innerHTML="";if($("#setpage"))$("#setpage").innerHTML="";} // (래치는 navToList=사용자가 닫기 버튼을 누른 경로에서만 켠다)
  function navSameNav(a,b){ if(!a||!b) return false; return a.t===b.t && String(a.name==null?"":a.name)===String(b.name==null?"":b.name) && String(a.id==null?"":a.id)===String(b.id==null?"":b.id) && String(a.kind==null?"":a.kind)===String(b.kind==null?"":b.kind) && String(a.i==null?"":a.i)===String(b.i==null?"":b.i); }
  // 2026-07-09 중복 히스토리 엔트리 방지(단일규칙): 같은 상세를 연달아(더블클릭·같은 항목 재클릭) 열면 동일 nav로
  //   pushState가 2번 이상 쌓여, 뒤로가기/닫기를 여러 번 눌러야 했다(첫 뒤로가기=같은 페이지처럼 보임 — 사용자 최초 신고).
  //   현재 히스토리 top과 동일 nav면 push 대신 replace로 합쳐 항상 1엔트리 유지. 모든 open*(champ/mychamp/entity/match) 공통.
  // ★2026-07-22 상세 깊이(d) 추적: base(전적)=0, 상세를 열 때마다 +1. '← 챔피언 목록' 이 d 만큼 한 번에 되돌아가
  //   히스토리를 한 칸씩 걷지 않고 목록으로 확실히 나가게 한다(아래 navToList). 기존 뒤로가기 동작은 그대로 둔다.
  function navDepth(){ var s=history.state; return (s&&typeof s.d==="number")?s.d:0; }
  function navPush(nav){if(_navRestoring)return;try{ var cur=history.state&&history.state.nav; var d=navDepth(); if(navSameNav(cur,nav)){ history.replaceState({nav:nav,m:mode,e:_navEpoch,d:d},""); return; } history.pushState({nav:nav,m:mode,e:_navEpoch,d:d+1},""); }catch(_){}} // m=엔트리를 쌓은 모드(popstate가 모드 불일치 상세 복원 차단에 사용)
  // navGo=최상위 상세뷰(상세분석/사주풀이)용. 헤더 버튼은 상세뷰 안에서도 항상 보여서, 이미 상세 안이면 새 엔트리 쌓지 말고 현재 엔트리를 교체(횡이동). 전적에서 열 때만 push. → 몇 번 토글해도 뒤로가기 한 번에 전적으로 복귀(누적으로 "한참 전 지점" 방지).
  function navGo(nav){if(_navRestoring)return;try{var d=navDepth();if(document.body.classList.contains("cp")||document.body.classList.contains("am-set-open"))history.replaceState({nav:nav,m:mode,e:_navEpoch,d:d},"");else history.pushState({nav:nav,m:mode,e:_navEpoch,d:d+1},"");}catch(_){}}
  function navBack(){try{history.back();}catch(_){closeAllDetail();}}
  // ★'← 챔피언 목록'·'← 닫기' 전용: 히스토리를 한 칸씩 걷지 않고 쌓인 상세 depth 만큼 한 번에 빠져나온다.
  //   예전엔 이 버튼이 history.back() 이라, 앞서 다른 챔피언 상세를 열어둔 적이 있으면 목록이 아니라 **그 챔피언**이 떴다
  //   (사용자 신고: 자이라 보다가 목록으로 돌아갔는데 세주아니가 나옴). 브라우저/앱 자체 뒤로가기는 종전대로 한 칸씩.
  function navToList(){ _igUserClosed=true; var d=navDepth(); if(d>0){ try{ history.go(-d); return; }catch(_){} } closeAllDetail(); try{ history.replaceState({nav:null,m:mode,e:_navEpoch,d:0},""); }catch(_){} } // d=0(인게임 자동상세처럼 push 없이 열린 화면)에서 back 으로 '알 수 없는 한 칸'을 걷던 폴백 제거 — 목록 버튼은 무조건 목록으로
  function navRender(nav){
    _navRestoring=true;++_navSeq; // 이전 뷰의 미완료 fetch 무효화(캐시 복원 포함 전 경로 커버)
    try{
      if($("#setpage"))$("#setpage").innerHTML=""; document.body.classList.remove("am-set-open"); // 2026-07-09 설정을 상세 위에 열고 뒤로가기 시 sp가 안 꺼져 설정이 계속 덮여 '뒤로가기 먹통'처럼 보이던 문제 — 히스토리 복원 시 항상 설정 오버레이 제거(설정은 히스토리에 안 쌓임)
      if(!nav)closeAllDetail();
      else if(nav.t==="champ")openChamp(nav.name);
      else if(nav.t==="mychamp")openMyChamp(nav.name);
      else if(nav.t==="analysis"){if(_anData){renderAnalysis();}else{openAnalysis();}}
      else if(nav.t==="reading")openRecordReading();
      else if(nav.t==="match")openMatchDetail(nav); // 인덱스가 아니라 nav 통째로 — 안정 키(k)로 대조 복원
      else if(nav.t==="entity")openEntity(nav.kind,nav.id);
      else closeAllDetail();
    }finally{_navRestoring=false;}
  }
  try {
    history.replaceState({ nav: null, d: 0 }, "");   // index0 = 전적(base)
    history.pushState({ nav: null, d: 0 }, "");        // 트랩 한 겹(base 뒤로가기 여유 → 앱 스플래시 이탈 방지). d:0 = navToList 가 여기까지만 되돌아간다(앱 밖으로 안 나감)
    window.addEventListener("popstate", function(e){
      var st = e.state || {};
      var nav = st.nav;
      // 2026-07-09 모드 토글 후 뒤로가기가 '다른 모드에서 쌓인' 상세/분석 엔트리를 복원해 (a)닫은 상세가 유령처럼 재오픈되거나 (b)일칼·증바람 데이터/라벨이 섞이던 문제 → 다른 모드 엔트리는 복원하지 않고 전적으로 닫음.
      if (nav && st.m && st.m !== mode) nav = null;
      if (nav && st.e !== _navEpoch) nav = null; // 마지막 out-of-band 닫기(closeChamp) 이전 세대 엔트리는 stale → 다단 중첩 상세 orphan 재오픈 방지·뒤로가기 base 수렴(모드가드의 상위집합)
      navRender(nav);
      if (!nav) { try { history.pushState({ nav: null, d: 0 }, ""); } catch (_) {} } // base 도달 시 트랩 재장전(깊이 0 — 여기가 목록이다)
    });
  } catch (_) {}
  document.querySelectorAll("#meta-tabs button").forEach(function(b){b.onclick=function(){loadTab(b.dataset.tab)}});
  function champClick(e){
    var r=e.target.closest("[data-champ]"); if(r){openChamp(r.getAttribute("data-champ"));return;}
    var it=e.target.closest("[data-item]"); if(it){openItem(it.getAttribute("data-item"));return;}
    var ru=e.target.closest("[data-rune]"); if(ru){openRune(ru.getAttribute("data-rune"));return;}
    var au=e.target.closest("[data-augment]"); if(au){openAugment(au.getAttribute("data-augment"));return;}
  }
  $("#meta").addEventListener("click",champClick);
  $("#champpage").addEventListener("click",champClick); // 상세 내부 관계 카드 → 다른 엔티티 상세로 이동
  $("#meta").addEventListener("click",function(e){ // ⑦ 정렬/클래스필터
    var uc=e.target.closest("[data-uscard]"); if(uc){ goUnifiedCard(uc.getAttribute("data-ustab"),uc.getAttribute("data-uskey")); return; } // 조합 카드 클릭 → 해당 탭/표로 이동(#q는 페이지 내 찾기 전용이라 건드리지 않음)
    var tc=e.target.closest("[data-tcat]"); if(tc){ tableCategory=tc.getAttribute("data-tcat"); activeTableKey=""; tableOffset=0; loadSiteTable(false); return; }
    var tf=e.target.closest("[data-tfilter]"); if(tf){ tableFiltersClosed=!tableFiltersClosed; $("#meta").innerHTML=tableCtrlHtml(tableLast||{rows:[],total:0,offset:0,limit:tableLimit})+(tableLast?renderTableBody(tableLast):''); return; }
    var tr=e.target.closest("[data-trefresh]"); if(tr){ loadSiteTable(false); return; }
    var tp=e.target.closest("[data-tpage]"); if(tp){ var dir=tp.getAttribute("data-tpage"); tableOffset=Math.max(0,tableOffset+(dir==="next"?tableLimit:-tableLimit)); loadSiteTable(false); return; }
    // 많을때 표 정렬기준 칩(승률 순/표본 순): 지금 고른 열은 그대로 두고 기준만 바꾼다(열 미선택이면 '전체').
    var tmt=e.target.closest("[data-tmetric]"); if(tmt){ tableSort=multiSortKeyFor(multiSortColumn(tableSort),tmt.getAttribute("data-tmetric")); tableDir=(tableDir==="asc")?"asc":"desc"; tableOffset=0; loadSiteTable(false); return; }
    var ts=e.target.closest("[data-tsort],[data-thsort]"); if(ts){ var nk=ts.getAttribute("data-tsort")||ts.getAttribute("data-thsort"); if(tableSort===nk){tableDir=tableDir==="asc"?"desc":"asc";}else{tableSort=nk;tableDir=(nk==="label"||nk==="tier")?"asc":"desc";} tableOffset=0; loadSiteTable(false); return; }
    var dv=e.target.closest("[data-dvkey]"); if(dv){ var _nk=dv.getAttribute("data-dvkey"); verticalKey=(verticalKey===_nk)?'':_nk; if(tableLast){ var _st=$("#meta").scrollTop; $("#meta").innerHTML=tableCtrlHtml(tableLast)+renderTableBody(tableLast); $("#meta").scrollTop=_st; hydrateDvCombos();} return; } // 2026-07-09 아코디언 펼침 시 #meta 통째 재렌더로 스크롤이 맨 위로 튀던 문제 — scrollTop 보존
    // 세로데이터 빌드패널 — 탭/정렬만 바꾸고 패널만 다시 그린다(표 통째 재렌더 없음 = 스크롤 튐·재요청 없음)
    var dbt=e.target.closest("[data-dvbtab]"); if(dbt){ _dvBuildState.filter=dbt.getAttribute("data-dvbtab"); _dvBuildState.query=""; dvBuildRepaint(); return; }
    var dbs=e.target.closest("[data-dvbsort]"); if(dbs){ var _sk=dbs.getAttribute("data-dvbsort"); _dvBuildState.sort=(_dvBuildState.sort===_sk)?"impact":_sk; dvBuildRepaint(); return; } // 같은 버튼 재클릭 = 기본(서버 순서)으로(사이트와 동일)
    var dm=e.target.closest("[data-dist-metric]"); if(dm){ distMetric=dm.getAttribute("data-dist-metric"); if(tableLast){$("#meta").innerHTML=tableCtrlHtml(tableLast)+renderTableBody(tableLast);} return; }
    var bcc=e.target.closest("[data-bcclass]"); if(bcc){ bcClass=bcc.getAttribute("data-bcclass"); verticalKey=""; if(tableLast){$("#meta").innerHTML=tableCtrlHtml(tableLast)+renderTableBody(tableLast);} return; } // 방송 클래스 필터(클라 재렌더, 네트워크 없음)
    var bcl=e.target.closest("[data-bclow]"); if(bcl){ bcHideLow=!bcHideLow; if(tableLast){$("#meta").innerHTML=tableCtrlHtml(tableLast)+renderTableBody(tableLast);} return; } // 방송 표본부족 숨김 토글
    var bce=e.target.closest("[data-bcentity]"); if(bce){ bcEntity=bce.getAttribute("data-bcentity"); bcClass="all"; verticalKey=""; tableOffset=0; loadSiteTable(true); return; } // 방송 엔티티 타입(챔피언/증강·룬/아이템) 전환 — 서버 재요청
    var bcw=e.target.closest("[data-bcwin]"); if(bcw){ activeTableRange=bcw.getAttribute("data-bcwin")||activeTableRange; bcWindow=activeTableRange; verticalKey=""; tableOffset=0; loadSiteTable(false); return; } // 기간(전체/최근 28일/최근 14일) 전환 = 상단 기간 필터와 같은 상태 — 서버 재요청
    var s=e.target.closest("[data-ms]"); if(s){ metaSort=s.getAttribute("data-ms"); rerenderMeta(); return; }
    var c=e.target.closest("[data-mc]"); if(c){ metaClass=c.getAttribute("data-mc"); metaClassOpen=false; rerenderMeta(); return; }
    var f=e.target.closest("[data-mcf]"); if(f){ metaClassOpen=!metaClassOpen; rerenderMeta(); return; }
  });
  $("#meta").addEventListener("change",function(e){
    /* ★2026-09-15 MMR 구간 — 서버를 다시 부르지 않는다. 받아 둔 표를 구간 값으로 다시 그릴 뿐이다. */
    var bd=e.target.closest("[data-tier-band]"); if(bd){activeTierBand=bd.value;amTierBandsLoad();if(tableLast)renderTablePayload(tableLast);return;}
    var r=e.target.closest("[data-trange]"); if(r){activeTableRange=r.value;tableOffset=0;loadSiteTable(false);return;}
    var t=e.target.closest("[data-tkey]"); if(t){activeTableKey=t.value;tableOffset=0;verticalKey="";tableSort="auto";tableDir="auto";loadSiteTable(false);return;} // 표 전환 → 정렬 auto: 서버가 그 표의 기본을 정한다(티어 있으면 티어순 / 많을때=동시출현 / 그 외 표본순)
  });
  $("#mychamps").addEventListener("click",function(e){var r=e.target.closest("[data-champ]");if(r)openMyChamp(r.getAttribute("data-champ"))});
  $("#readbtn").onclick=openRecordReading;
  $("#anlbtn").onclick=openAnalysis;
  $("#me").addEventListener("click",function(e){var r=e.target.closest("[data-mi]");if(r)openMatchDetail(+r.getAttribute("data-mi"))});
  // ── 2026-07-09 인게임(픽창) 모드 — 롤 픽창/게임 진입 자동 감지 → 인게임 화면. 탐색 모드와 🎮 토글. 관용영역(인게임 오버레이 없음). 데이터 모드분리. ──
  (function(){
    var IGS=document.createElement("style"); IGS.textContent=
      '#ingamepage{position:fixed;left:0;right:0;top:var(--top-h,54px);bottom:0;overflow:auto;background:var(--bg);z-index:9;display:none;padding:16px}'
      +'body.ig #ingamepage{display:block}'
      +'#igbtn.on{color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent-line),0 0 8px 1px var(--accent-glow)}' /* 게임 중 🎮 강조 글로우 */
      +'.ig-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}'
      +'.ig-toggle-hint{margin-left:auto;font-size:13px;color:var(--accent);border:1px solid var(--accent-line);border-radius:999px;padding:3px 10px;white-space:nowrap;background:var(--accent-glow)}' /* 🎮 마스터 on/off 강조 */
      +'.ig-compbanner{position:sticky;top:0;z-index:5;background:var(--card-2);border-bottom:2px solid var(--accent-line);box-shadow:0 8px 22px rgba(0,0,0,.45);padding:11px 16px}' /* 인게임 상세 위 sticky 조합 승률 배너 — 상세와 동시에 보이게 */
      +'.igb-inner{max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:6px}'
      +'.igb-line{font-size:15px;line-height:1.3}'
      +'.igb-wr{font-size:18px;font-weight:600} .igb-wr b{font-size:21px}'
      +'.igb-sub{font-size:14px;color:var(--muted)}'
      +'.igb-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap}'
      +'.igb-lbl{font-size:12px;color:var(--muted);min-width:32px}'
      +'.igb-ch{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-weight:600}'
      +'.igb-ch.me{outline:2px solid var(--accent);border-radius:7px;padding:1px 3px}'
      +'.igb-ic{width:26px;height:26px;border-radius:6px;object-fit:cover}'
      +'.ig-compbanner .ig-toggle-hint{margin-left:0;margin-top:3px;align-self:flex-start}'
      +'.ig-wrap{max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:11px}'
      +'.ig-head{display:flex;align-items:center;gap:10px}.ig-head b{font-size:19px;letter-spacing:-.01em}'
      +'.ig-exp{margin-left:auto;font-size:15px}.ig-exp b{font-size:20px}'
      +'.ig-rec{font-size:15px;background:linear-gradient(180deg,var(--card),var(--inset));border:1px solid var(--line);border-radius:13px;padding:12px 15px;min-height:20px;box-shadow:0 1px 3px rgba(0,0,0,.12)}.ig-rec b{font-size:16.5px}'
      +'.ig-teamcomp{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px;background:linear-gradient(180deg,var(--card),var(--inset));border:1px solid var(--line);border-radius:13px;padding:13px 15px;box-shadow:0 1px 3px rgba(0,0,0,.12)}.ig-teamcomp b{font-weight:800}.ig-teamcomp b.good{color:#41c07a;font-size:23px;letter-spacing:-.02em}.ig-teamcomp b.bad{color:#e2707c;font-size:23px;letter-spacing:-.02em}'
      +'.ig-sec{font-size:12px;font-weight:700;color:var(--mut);margin-top:7px;letter-spacing:.01em}'
      +'.ig-team,.ig-benchrow{display:flex;flex-wrap:wrap;gap:8px}'
      +'.ig-slot,.ig-bench{width:92px;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:10px 6px 9px;text-align:center;position:relative;box-shadow:0 1px 2px rgba(0,0,0,.1);transition:transform .12s ease,border-color .12s ease,box-shadow .12s ease}'
      +'.ig-bench{cursor:pointer;color:var(--tx);font:inherit}.ig-bench:hover{border-color:var(--accent-line);transform:translateY(-2px);box-shadow:0 5px 12px rgba(0,0,0,.2)}.ig-bench:active{transform:translateY(0)}'
      +'.ig-slot.self{border-color:var(--accent-line);box-shadow:inset 0 0 0 1px var(--accent-line),0 1px 2px rgba(0,0,0,.1)}'
      +'.ig-slot.strong{border-color:#e0655a;box-shadow:inset 0 0 0 1px rgba(224,101,90,.5),0 1px 2px rgba(0,0,0,.1)}'
      +'.ig-slot.ally-best{border-color:#41c07a;box-shadow:inset 0 0 0 1px rgba(65,192,122,.55),0 1px 2px rgba(0,0,0,.1)}'
      +'.ig-bench.best{border-color:#41c07a;box-shadow:0 0 0 1px #41c07a inset,0 1px 2px rgba(0,0,0,.1)}'
      +'.ig-bench.igswapping{opacity:.5;pointer-events:none;filter:grayscale(.4)}.ig-bench.igswapping::after{content:"스왑 중…";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;background:rgba(0,0,0,.44);border-radius:13px}'
      +'.ig-slot .ci,.ig-bench .ci{width:46px;height:46px;border-radius:10px;object-fit:cover}'
      +'.ig-nm{font-size:12px;font-weight:600;margin:5px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      +'.ig-wr{font-weight:700;font-size:13px}.ig-wr.good{color:#41c07a}.ig-wr.bad{color:#e2707c}.ig-wr.muted{color:var(--mut)}'
      // ★2026-09-25 증강 픽창 조합 완성도(결정 보드 '픽창 추천 고르는 법' 4차 "바꾼 뒤" 그대로) — 추천 줄 · 점수+막대 · 대기석 오르내림
      +'.ig-rec.pm{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}.ig-rec .mv{font-size:13.5px;font-weight:700;font-variant-numeric:tabular-nums}.ig-rec .mv .up{color:#2fcf9a}'
      +'.ig-score{display:flex;align-items:center;gap:10px;flex:1 1 220px;min-width:0}.ig-score .num{font-size:23px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums;min-width:3.4ch}.ig-score .num small{font-size:13px;font-weight:700;margin-left:1px}'
      +'.ig-gauge{flex:1 1 auto;height:8px;border-radius:99px;background:#232d3a;position:relative;overflow:hidden;min-width:80px}.ig-gauge i{position:absolute;left:0;top:0;bottom:0;border-radius:99px}'
      +'.ig-dl{font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;line-height:1.2}.ig-dl.up{color:#2fcf9a}.ig-dl.down{color:#f26d7d}.ig-dl.flat{color:var(--mut)}.ig-to{font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums}'
      +'.ig-badge{position:absolute;top:-7px;right:-6px;font-size:9.5px;font-weight:700;background:#41c07a;color:#fff;border-radius:7px;padding:2px 6px;box-shadow:0 1px 3px rgba(0,0,0,.28)}.ig-slot.strong .ig-badge{background:#e0655a}'
      +'.ig-strong{font-size:13px;padding:9px 13px;background:var(--inset);border:1px solid var(--line);border-radius:11px}.ig-note{font-size:12px;line-height:1.55;margin-top:2px;color:var(--mut)}'
      +'.ig-buildbox{display:block}.ig-buildrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.ig-rune{display:inline-flex;align-items:center;gap:4px;font-size:12px;background:var(--inset);border:1px solid var(--line);border-radius:9px;padding:4px 7px}.ig-rune img,.ig-rune .ri{width:24px;height:24px;border-radius:5px}.ig-rune .ii{display:inline-flex;width:22px;height:22px}.ig-rune .ii img{width:22px;height:22px;border-radius:5px}.ig-rune b{font-weight:700}.ig-rune b.good{color:#41c07a}.ig-rune b.bad{color:#e2707c}'
      +'.ig-auto{font-size:12px;font-weight:500;color:var(--tx);margin-left:8px;cursor:pointer;user-select:none}.ig-auto input{vertical-align:middle;margin-right:3px}';
    document.head.appendChild(IGS);
    var igActive=false, igManual=null, igPoll=null, igAutoRune=true, igBusy=false, igSig="", igLastChamp="", igMode="standard", igBuildCache={}, igPageCache={}, igPrevView="", igShownDetailFor="", igGameChamp="", igEnabled=true, igLastState=null, igUserMode=null, igUserBuildMode=null;
    try{ if(localStorage.getItem('am_ig_autorune')==='0') igAutoRune=false; }catch(_){} // ★자동 룬적용 = 기본 켜짐(default ON). 사용자가 명시적으로 끈 경우('0')만 유지.
    try{ if(localStorage.getItem('am_ig_enabled')==='0') igEnabled=false; }catch(_){} // ★인게임 모드 = 기본 켜짐(default ON). 🎮로 완전히 끄면 게임 감지·자동표시 안 함(영속).
    var IGMOCK=(new URLSearchParams(location.search)).get("igmock")||"";
    function icon(u,cls){ return '<img class="'+(cls||"ci")+'" src="'+esc(u||"")+'" alt="" loading="lazy">'; }
    function wr(v){ if(v==null) return '<span class="ig-wr muted">–</span>'; return '<span class="ig-wr '+(v>=50?"good":"bad")+'">'+v+'%</span>'; }
    function igRo(name){ var s=String(name||""), c=s.charCodeAt(s.length-1)-0xAC00; if(!(c>=0&&c<=11171)) return s+"로"; var j=c%28; return s+((j===0||j===8)?"로":"으로"); } // 받침 없거나 ㄹ = "로", 나머지 = "으로"
    function igDl(n){ if(n==null||isNaN(n)) return '<div class="ig-dl flat">–</div>'; if(n===0) return '<div class="ig-dl flat">±0</div>'; return '<div class="ig-dl '+(n>0?"up":"down")+'">'+(n>0?"+":"−")+Math.abs(n)+'</div>'; }
    function igShow(on){ igActive=on; document.body.classList.toggle("ig",on); if(!on){$("#ingamepage").innerHTML="";igSig="";} } // 오버레이(픽창/로딩) 표시. 🎮 버튼 .on은 igEnabled(마스터)로 별도 관리(updateIgBtn).
    function updateIgBtn(){ var sw=$("#igsw"); if(sw)sw.classList.toggle("on",igEnabled); var bb=$("#igbtn"); if(bb)bb.title=igEnabled?"인게임 모드 켜짐 — 게임 감지 시 내 챔프 상세 + 조합 승률 자동 표시. 눌러서 끄기.":"인게임 모드 꺼짐 — 게임을 감지해도 아무것도 안 띄움. 눌러서 켜기."; } // 좌우 스위치로 상태 표시
    function igSortWin(arr){ return amSortRunePick(arr); } // 룬 픽 = Wilson 하한↓(챔프상세 runeSort와 동일). 서버 정확승수 x.wilson.
    var IG_TREE={ "정밀":8000,"지배":8100,"마법":8200,"결의":8400,"영감":8300,"Precision":8000,"Domination":8100,"Sorcery":8200,"Resolve":8400,"Inspiration":8300 };
    function igRunePick(picks,catalog){ // ★챔프상세 runePage와 동일 선택: 키스톤(main·slot1) Wilson최고→주트리, 보조트리=Wilson상위2슬롯합 최고, 슬롯별 Wilson 픽. 결과=코히런트 페이지.
      if(!catalog||!catalog.length) return null;
      var pick={}; (picks||[]).forEach(function(r){if(r.id!=null)pick[r.id]=r;});
      var ks=igSortWin((picks||[]).filter(function(r){return r.cat==="main"&&r.slot===1})); var pTree=ks[0]?ks[0].tree:null; if(!pTree)return null;
      var subs=(picks||[]).filter(function(r){return r.cat==="sub"&&r.tree!==pTree}); var secTree=amPickSecTree(subs, catalog, 'win'); // ★자동적용은 항상 win(기여도) — 픽창 buildMode가 common이어도 최고승률 룬 적용. 카탈로그 실제 행별 기여도 상위2행 합 최대 트리.
      function slotRec(tree){ var runes=catalog.filter(function(c){return c.tree===tree}); var slots={}; runes.forEach(function(c){(slots[c.slot]=slots[c.slot]||[]).push(c)}); var out={}; Object.keys(slots).forEach(function(sk){ var used=slots[sk].filter(function(c){return pick[c.id]&&(tree!=="파편"||String(pick[c.id].slot)===String(sk))}).map(function(c){return pick[c.id]}); var r=igSortWin(used)[0]; out[sk]={id:(r?r.id:(slots[sk][0]&&slots[sk][0].id)),games:used.reduce(function(s,p){return s+(p.games||0)},0),imp:(r?amImp(r):-1e12),rec:r||null}; }); return out; } // ★파편만 데이터 실제 슬롯 필터(중복 슬롯 누수 방지). main/sub는 슬롯번호 체계 달라 제외. rec=행 대표룬.
      var pr=slotRec(pTree), sr=slotRec(secTree), fr=slotRec('파편');
      var primary=Object.keys(pr).sort(function(a,b){return a-b}).map(function(sk){return pr[sk].id}).filter(function(x){return x;});
      var secKeys=Object.keys(sr).filter(function(sk){return sk!=="0"}).sort(function(a,b){ var ra=sr[a].rec,rb=sr[b].rec; if(!ra&&!rb)return 0; if(!ra)return 1; if(!rb)return -1; return amRuneCmp(ra,rb); }).slice(0,2); // ★보조 2행 = amRuneCmp(승리행 먼저·승리끼리 기여도·패배끼리 Wilson) 상위 — 상세 최고승률과 동일. 자동적용도 이 룬으로.
      var secondary=secKeys.map(function(sk){return sr[sk].id}).filter(function(x){return x;});
      var shards=Object.keys(fr).sort(function(a,b){return a-b}).map(function(sk){return fr[sk].id}).filter(function(x){return x;});
      var perkIds=primary.concat(secondary).concat(shards);
      return { pTree:pTree, secTree:secTree, primary:primary, secondary:secondary, shards:shards, perkIds:perkIds, pick:pick, page:{ primaryStyleId:IG_TREE[pTree]||0, subStyleId:IG_TREE[secTree]||0, selectedPerkIds:perkIds } };
    }
    function buildBoxHtml(name){ return igBuildCache[name]||('<span class="muted">'+(name?"불러오는 중…":"챔프 선택 후 표시")+'</span>'); }
    function renderCS(d){
      var rec=d.recommend, aug=(igMode==="augment");
      var namedTeam=(d.myTeam||[]).filter(function(p){return p.name}); // ★챔프 배정 전엔 "?" 슬롯 대신 대기 표시
      // ★2026-09-26 증강 픽창 첫 순간(내 챔프 아직 모름 · 조합 모델 받는 중)은 서버가 waiting 을 보낸다 — 옛 승률 화면을 먼저 그리지 않는다(운영자 "%같은 잔재").
      if(d.waiting||!namedTeam.length){ var wmsg=d.waiting==="model"?"조합 계산을 준비하는 중… (곧 조합 완성도가 떠요)":d.waiting==="model-fail"?"조합 계산 자료를 아직 못 받았어요 — 잠시 뒤 다시 받아요":"챔피언 배정을 기다리는 중… (배정되면 팀 조합·추천이 떠요)"; $("#ingamepage").innerHTML='<div class="ig-wrap"><div class="ig-head"><b>인게임 · 픽창</b><span class="muted">'+(aug?"증강 칼바람":"일반 칼바람")+' · 큐 자동감지</span></div><div class="ig-rec muted">'+wmsg+'</div></div>'; return; }
      /* ★2026-09-25 증강 칼바람 조합 모델(운영자 결정 "픽창 추천 — 바꾼다. 대신 아는 척을 크게 해선 안돼. 앞라인이 비어서 같은 소리는 하지 마.")
         숫자와 순서만 보여 준다 — 이유 문구를 붙이지 마라. 아군 칸 숫자는 뺐다(팀 숫자 하나와 대기석 숫자로 본다).
         ★같은 날 4차: 띄우는 숫자 = 조합 완성도 0~100점(서버 pct · 실제 증바람 팀 조합들 가운데 서는 자리). 예상 승률(%)은 안 띄운다 —
           운영자: "62.5%막 이렇게 나왔던 것 같은데, 그대로 지게 된다면 상심이 크더라고" · "조합의 완성도를 … 지표처럼 내라고" ·
           "지금 챔피언을 뭘로 바꿔야 얼만큼 더 좋고 나쁨을 표시하라고". 대기석 큰 숫자 = 그 챔프로 바꾸면 몇 점 오르고(+) 내리나(−).
           추천 챔프를 고르는 규칙은 서버 그대로(d.recommend — 대기석이 지금 챔프보다 확실히 나을 때만 바꾸라고 한다).
         ★09-26: 서버가 모델을 못 쓰면(파일 없음·내 챔프 미정) 종전 화면으로 떨어지지 않고 waiting 을 보낸다(위 기다림 한 줄). 종전 화면은 일반 칼바람 전용이다. */
      if(d.pickModel){
        var recM=d.recommend, meM=d.me||{}, meP=meM.pct, recB=null;
        if(recM&&recM.championId!==meM.championId) (d.bench||[]).forEach(function(p){ if(p.championId===recM.championId) recB=p; });
        var scM=(meP>=50)?"#41c07a":"#e2707c";
        var teamM=namedTeam.map(function(p){return '<div class="ig-slot'+(p.isSelf?' self':'')+'" title="'+esc(p.name||'')+'">'+icon(p.icon)+'<div class="ig-nm">'+esc(p.name)+'</div></div>';}).join('');
        var benchM=(d.bench||[]).map(function(p){var best=!!(recB&&recB.championId===p.championId);return '<button class="ig-bench'+(best?' best':'')+'" data-igswap="'+p.championId+'" type="button" title="클릭하면 이 챔프로 스왑돼요">'+icon(p.icon)+'<div class="ig-nm">'+esc(p.name)+'</div>'+igDl(p.pct-meP)+'<div class="ig-to">'+p.pct+'점</div>'+(best?'<span class="ig-badge">추천</span>':'')+'</button>';}).join('')||'<div class="muted">고를 수 있는 챔프 없음</div>';
        var recLine=recB
          ?('<span>추천: <b>'+esc(igRo(recB.name))+'</b> 바꾸기</span><span class="mv">조합 완성도 '+meP+' → <span class="up">'+recB.pct+'</span> <span class="up">(+'+(recB.pct-meP)+')</span></span>')
          :('<span>추천: 지금 <b>'+esc(meM.name)+'</b> 그대로</span><span class="mv muted">조합 완성도 '+meP+'</span>');
        $("#ingamepage").innerHTML='<div class="ig-wrap"><div class="ig-head"><b>인게임 · 픽창</b><span class="muted">증강 칼바람 · 큐 자동감지</span>'+IG_TOGGLE_HINT+'</div>'
          +'<div class="ig-rec pm">'+recLine+'</div>'
          +'<div class="ig-teamcomp"><span>조합 <b>완성도</b></span><div class="ig-score"><span class="num" style="color:'+scM+'">'+meP+'<small>점</small></span><div class="ig-gauge" aria-hidden="true"><i style="width:'+Math.max(2,meP)+'%;background:'+scM+'"></i></div></div><span class="muted">· 지금 픽 그대로일 때 · 팀 바뀌면 갱신</span></div>'
          +'<div class="ig-sec">아군 팀</div><div class="ig-team">'+teamM+'</div>'
          +'<div class="ig-sec">고를 수 있는 챔피언 <span class="muted">· 큰 숫자 = 그 챔프로 바꾸면 조합 완성도가 몇 점 오르고(+) 내리나(−)'+(d.benchEnabled?' · 클릭하면 그 챔프로 스왑':'')+'</span></div><div class="ig-benchrow">'+benchM+'</div>'
          +'<div class="ig-sec muted">증강 칼바람은 룬이 없어요 — 픽만 봅니다.</div></div>';
        return;
      }
      var pending=(d.myTeam||[]).length-namedTeam.length; // 아직 안 정해진(이름 없는) 슬롯 수
      var team=namedTeam.map(function(p){var best=d.bestAlly&&p.name===d.bestAlly;var cw=(p.compWR!=null?p.compWR:p.winRate);return '<div class="ig-slot'+(p.isSelf?' self':'')+(best?' ally-best':'')+'" title="'+esc(p.name||'')+(p.compWR!=null?' · 조합 반영 승률 '+p.compWR+'%'+(p.winRate!=null?' (단독 '+p.winRate+'%)':''):'')+'">'+icon(p.icon)+'<div class="ig-nm">'+esc(p.name)+'</div>'+wr(cw)+(best?'<span class="ig-badge">조합↑</span>':'')+'</div>';}).join(''); // ★미정 슬롯("?")은 제외 — 정해진 챔프만 표시(확정 안 난 챔프 ? 문제)
      var bench=(d.bench||[]).map(function(p){var best=rec&&rec.name===p.name;return '<button class="ig-bench'+(best?' best':'')+'" data-igswap="'+p.championId+'" type="button" title="클릭하면 이 챔프로 스왑돼요">'+icon(p.icon)+'<div class="ig-nm">'+esc(p.name)+'</div>'+wr(p.winRate)+(best?'<span class="ig-badge">추천</span>':'')+'</button>';}).join('')||'<div class="muted">고를 수 있는 챔프 없음</div>';
      var auto=aug?'':'<label class="ig-auto"><input type="checkbox" id="ig-autorune"'+(igAutoRune?' checked':'')+'> 룬 자동 적용</label>';
      var tc=(d.teamComp!=null)?('<div class="ig-teamcomp">아군 팀 <b>조합 승률</b> <b class="'+(d.teamComp>=50?"good":"bad")+'">'+d.teamComp+'%</b>'+(d.bestAlly?' <span class="muted">· 조합상 유리: '+esc(d.bestAlly)+(d.worstAlly&&d.worstAlly!==d.bestAlly?' / 불리: '+esc(d.worstAlly):'')+'</span>':'')+'<span class="muted"> · 팀 바뀌면 갱신</span></div>'):'';
      var html='<div class="ig-wrap"><div class="ig-head"><b>인게임 · 픽창</b><span class="muted">'+(aug?"증강 칼바람":"일반 칼바람")+' · 큐 자동감지</span>'+IG_TOGGLE_HINT+'</div>'
        +'<div class="ig-rec">'+(rec?('추천 픽: <b>'+esc(rec.name)+'</b> '+wr(rec.score)+(rec.synergy?' <span class="muted">· 아군 시너지 반영</span>':'')):'추천 계산 중…')+'</div>'
        +tc
        +'<div class="ig-sec">아군 팀 <span class="muted">· 승률=조합 반영'+(pending>0?(' · '+pending+'명 선택 중'):'')+'</span></div><div class="ig-team">'+team+'</div>'
        +'<div class="ig-sec">고를 수 있는 챔피언'+(d.benchEnabled?' <span class="muted">· 클릭하면 그 챔프로 스왑</span>':'')+'</div><div class="ig-benchrow">'+bench+'</div>'; /* 벤치 스왑=공짜 스왑(무제한). 리롤(리롤포인트로 챔프 새로 굴리기)과 다른 개념이라 "리롤 N" 표시 제거 — 스왑이 리롤에 막히는 것처럼 오해줬음 */
      if(!aug){ html+='<div class="ig-sec">추천 룬·아이템 (최고 승률) '+auto+'</div><div class="ig-buildbox" id="ig-buildbox">'+buildBoxHtml(d.me&&d.me.name)+'</div>'; }
      else { html+='<div class="ig-sec muted">증강 칼바람은 룬이 없어요 — 픽만 봅니다.</div>'; }
      html+='</div>'; $("#ingamepage").innerHTML=html;
    }
    async function loadBuild(name){ try{ if(igBuildCache[name]){var bx=$("#ig-buildbox");if(bx)bx.innerHTML=igBuildCache[name];return;}
      var d=await fetch("/api/champ?mode="+igMode+"&name="+encodeURIComponent(name),{cache:"no-store"}).then(function(x){return x.json()});
      // ★2026-09-25 못 받았거나(오류) 조각이 빈 응답은 캐시하지 않고 8초 뒤 폴이 다시 부르게 한다 — 종전엔 한 번 실패한 '룬 데이터 없음' 이 그 챔프 내내 굳었다
      var _incomplete=!d||d.error||(d.partial||[]).some(function(p){return p==="combos"||p==="runeCatalog";}); // 룬·아이템에 닿는 조각만 — KDA 등이 빠진 건 이 칸과 무관
      if(_incomplete)setTimeout(function(){ if(igLastChamp===name)igLastChamp=""; },8000);
      if(!d||d.error){ var bxe=$("#ig-buildbox"); if(bxe)bxe.innerHTML='<span class="muted">통계를 받는 중… 잠시 뒤 다시 받아요</span>'; return; }
      amMetaBase=Number(d&&d.winRate)||50; // ★검증된픽 기준선 = 이 챔프 평균 승률
      var rp=igRunePick(d&&d.runes, d&&d.runeCatalog); if(rp&&rp.page&&rp.page.selectedPerkIds.length>=9) igPageCache[name]=rp.page;
      var runesH = rp ? ('<div class="ig-buildrow">'+rp.perkIds.map(function(id){ var p=rp.pick[id]; return '<span class="ig-rune" title="'+(p?('승률 '+p.winRate+'% · '+kfmt(p.games)+'판'):'')+'">'+runeImg(id)+(p?'<b class="'+(p.winRate>=50?"good":"bad")+'">'+p.winRate+'%</b>':'')+'</span>'; }).join('')+'</div>') : '<span class="muted">룬 데이터 없음</span>';
      var items=amSortItems((d&&d.items)||[]).slice(0,6); // 아이템 = |기여도|↓(스테이플 먼저)
      var itemsH = items.length ? ('<div class="ig-sec" style="margin-top:8px">추천 아이템</div><div class="ig-buildrow">'+items.map(function(x){ return '<span class="ig-rune" title="'+esc(x.name||'')+'"><span class="ii">'+pim(x.icon)+'</span><b class="'+((x.winRate||0)>=50?"good":"bad")+'">'+(x.winRate||0)+'%</b></span>'; }).join('')+'</div>') : '';
      var h=runesH+itemsH; if(!_incomplete)igBuildCache[name]=h; var box=$("#ig-buildbox"); if(box)box.innerHTML=h;
    }catch(e){} }
    async function applyRunes(name){ try{ var page=igPageCache[name]; if(!page||!page.selectedPerkIds||page.selectedPerkIds.length<9)return; var r=await fetch("/api/ingame/runes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,page:page})}).then(function(x){return x.json()}); var tag=(r&&r.ok?'<div class="ig-note" style="color:#5db55d">✔ 룬 적용됨</div>':'<div class="ig-note" style="color:#d9707a">룬 적용 실패'+(r&&r.error?' ('+esc(String(r.error)).slice(0,50)+')':'')+'</div>'); if(igBuildCache[name]&&String(igBuildCache[name]).indexOf('룬 적용')<0&&String(igBuildCache[name]).indexOf('적용 실패')<0){ igBuildCache[name]+=tag; var box=$("#ig-buildbox"); if(box)box.innerHTML=igBuildCache[name]; } }catch(e){} }
    async function loadGameBuild(name){ try{ // 게임 중 내 챔프 빌드(증강모드=증강+아이템, 일반=룬참고+아이템)를 오버레이 빌드박스에 로드. 상세페이지 안 띄우고 여기서 내용만 보게.
      if(igBuildCache["game:"+name]){ var bx0=$("#ig-gamebuild"); if(bx0)bx0.innerHTML=igBuildCache["game:"+name]; return; }
      var d=await fetch("/api/champ?mode="+igMode+"&name="+encodeURIComponent(name)).then(function(x){return x.json()});
      amMetaBase=Number(d&&d.winRate)||50; // ★검증된픽 기준선 = 이 챔프 평균 승률
      var aug=(igMode==="augment"); var html='';
      var chip=function(x){ return '<span class="ig-rune" title="'+esc((x.name||'')+' · '+(x.winRate||0)+'% · '+kfmt(x.games||0)+'판')+'"><span class="ii">'+pim(x.icon)+'</span><b class="'+((x.winRate||0)>=50?"good":"bad")+'">'+(x.winRate||0)+'%</b></span>'; };
      if(aug){ var augs=amSortItems((d&&d.runes)||[]).slice(0,6); if(augs.length) html+='<div class="ig-buildrow">'+augs.map(chip).join('')+'</div>'; }
      else { var rp=igRunePick(d&&d.runes, d&&d.runeCatalog); if(rp) html+='<div class="ig-buildrow">'+rp.perkIds.map(function(id){ var p=rp.pick[id]; return '<span class="ig-rune" title="'+(p?('승률 '+p.winRate+'% · '+kfmt(p.games)+'판'):'')+'">'+runeImg(id)+(p?'<b class="'+(p.winRate>=50?"good":"bad")+'">'+p.winRate+'%</b>':'')+'</span>'; }).join('')+'</div>'; }
      var items=amSortItems((d&&d.items)||[]).slice(0,6); if(items.length) html+='<div class="ig-buildrow" style="margin-top:6px">'+items.map(chip).join('')+'</div>';
      if(!html) html='<span class="muted">빌드 데이터 없음</span>';
      igBuildCache["game:"+name]=html; var box=$("#ig-gamebuild"); if(box)box.innerHTML=html;
    }catch(e){} }
    var IG_TOGGLE_HINT=''; // 글자 힌트 제거 — 상단 🎮 좌우 ON/OFF 스위치가 상태를 표시(사용자: 스위치 있으면 알아서 식별). 하위 +IG_TOGGLE_HINT는 no-op 유지.
    function renderIgLoading(){ $("#ingamepage").innerHTML='<div class="ig-wrap"><div class="ig-head"><b>인게임 · 로딩</b><span class="muted">'+(igMode==="augment"?"증강 칼바람":"일반 칼바람")+' · 곧 상대 조합</span>'+IG_TOGGLE_HINT+'</div><div class="ig-rec muted">게임 불러오는 중… 잠시 후 아군·상대 조합이 떠요</div></div>'; }
    /* ★2026-09-25 외부 PC 신고 "게임 들어가면 로딩창부터 '통계를 못 받았어요 · 서버 응답 500'":
       로딩창에서 상세를 한 번 못 받으면 그 판 내내 그 화면에 멈춰 있었다 — 폴은 cp 클래스를 보고 '이미 열림' 으로 여겨 다시 안 열었고,
       '다시 시도' 는 lastChampName 이 비어 있어 엉뚱한(빈) 이름으로 요청했다(빈 이름이면 목록 첫 챔프가 뜬다).
       → 실패하면 이 판 · 이 챔프인 동안 스스로 다시 받는다(3·6·10·20·30초, 그 뒤 30초마다). 조각만 빠진 응답(partial)은
         보이는 화면은 그대로 두고 잠시 뒤 조용히 다시 받아 채운다(최대 3번). 게임이 끝나거나 사용자가 닫으면 멈춘다. */
    var igDetailTimer=null, IG_RETRY_S=[3,6,10,20,30];
    function igDetailTimerClear(){ if(igDetailTimer){ clearTimeout(igDetailTimer); igDetailTimer=null; } }
    function igDetailLater(name,attempt,quiet){ // attempt = 몇 번째 다시 받기인가(1부터)
      igDetailTimerClear();
      if(quiet&&attempt>3)return;
      var tk=_navSeq, s=IG_RETRY_S[Math.min(attempt-1,IG_RETRY_S.length-1)];
      igDetailTimer=setTimeout(function(){ igDetailTimer=null; if(tk!==_navSeq||igGameChamp!==name||_igUserClosed||!igEnabled)return; openGameDetail(name,attempt,quiet); },s*1000);
    }
    function igDetailFail(name,attempt,why){
      var s=IG_RETRY_S[Math.min(attempt,IG_RETRY_S.length-1)];
      $("#champpage").innerHTML=cpError(name,why,s); document.body.classList.add("cp");
      var b=$("#cpbackerr"); if(b)b.onclick=function(){ igDetailTimerClear(); navToList(); };
      var r=$("#cpretry"); if(r)r.onclick=function(){ igDetailTimerClear(); openGameDetail(name,0); };
      igDetailLater(name,attempt+1,false);
    }
    function openGameDetail(name,attempt,quiet){ // 게임 진입 시 내가 픽한 챔프 상세페이지 표시 — 그 위(sticky)에 조합 승률 배너를 얹어 상세+조합을 '둘 다 동시에' 보이게. 게임 끝나면 closeGameDetail로 정리(메인 복귀).
      if(!name)return; if(igMode&&igMode!==mode){ if(igUserMode==null)igUserMode=mode; setMode(igMode); } // ★상세를 실제 게임 모드(igMode)로 정렬(renderChamp이 전역 mode로 내기록·상대법·라벨). 정렬 직전 사용자 모드 저장 → 게임 끝나면 복원(마스터 off→on 재진입·픽창 수동토글 모두 이 시점에 최신값 캡처).
      if(!quiet){ if(igUserBuildMode==null)igUserBuildMode=buildMode; buildMode="win"; } // ★인게임 상세는 '최고 승률(메타)' 기본 — 자동적용 룬(igRunePick=Wilson)과 동일 논리로 표시돼 "자동적용≠최고승률/상세는 가장흔한" 혼란 제거. 게임 끝나면 사용자 기본값 복원. 조용히 채울 땐 사용자가 바꾼 토글을 되돌리지 않는다.
      attempt=attempt||0; igDetailTimerClear();
      lastChampName=name; // 오류 화면의 이름·'다시 시도'가 이 챔프를 가리키게
      var _tk;
      if(quiet)_tk=_navSeq; // 조용히 채우기 — 보고 있는 화면은 그대로, 더 나은 응답이 오면 그때 바꾼다
      else { _tk=++_navSeq; $("#champpage").innerHTML=cpLoading(); document.body.classList.add("cp"); } // ★히스토리 안 건드림 — 예전 openChamp 자동열기의 히스토리 겹겹쌓임 문제 회피
      fetch("/api/champ?mode="+igMode+"&name="+encodeURIComponent(name),{cache:"no-store"})
        .then(function(r){ return r.json().catch(function(){return null;}).then(function(j){ return r.ok?j:{error:(j&&j.error)?String(j.error):("서버 응답 "+r.status)}; }); })
        .then(function(x){
          if(_tk!==_navSeq||igGameChamp!==name)return; // 그새 다른 화면으로 갔거나 다른 판
          if(!x||x.error){ if(quiet)return igDetailLater(name,attempt+1,true); return igDetailFail(name,attempt,x&&x.error?String(x.error).slice(0,160):""); }
          renderChamp(x); renderCompBanner(igLastState); /* 상세 렌더 직후 조합배너 얹기(둘 다 보이게) */
          if(x.partial&&x.partial.length)igDetailLater(name,(quiet?attempt:0)+1,true); // 빠진 칸(증강·아이템·아군 등)은 잠시 뒤 조용히 다시 받아 채운다
        })
        .catch(function(e){ if(_tk!==_navSeq||igGameChamp!==name)return; if(quiet)return igDetailLater(name,attempt+1,true); igDetailFail(name,attempt,String((e&&e.message)||e).slice(0,160)); });
    }
    // ★2026-07-22 뿌리 수정: 예전엔 화면만 닫고 **히스토리는 그대로 뒀다**. 그래서 게임이 시작/종료될 때마다
    //   "화면엔 목록이 보이는데 히스토리 top 엔 옛 상세 엔트리가 살아 있는" 상태가 만들어졌고, 나중에 뒤로가기를 누르면
    //   그 옛 챔피언/경기가 튀어나왔다(사용자 신고: 자이라 보다가 목록으로 갔는데 세주아니). closeChamp 가 하는
    //   epoch++ + 현재 엔트리를 base 로 replace 까지 같이 한다 — 나머지 동작(navSeq++·cp 제거·champpage 비우기)은 동일.
    function closeGameDetail(){ igDetailTimerClear(); closeChamp(); } // 게임 종료 → 상세+배너 닫기(메인 복귀) + 히스토리 정리 + 예약된 다시 받기 취소
    // 인게임 조합 승률 배너(상세 위 sticky) — 상대 조합 반영 우리팀/상대팀 조합 승률·예상 승률·유리/주의 챔프. 상세페이지와 '동시에' 보이게 하는 핵심.
    function compBannerHtml(d){
      if(!d||d.myComp==null||d.enemyComp==null) return '<div class="igb-inner"><div class="igb-line muted">상대 조합 반영 승률 계산 중…</div></div>';
      var wr=function(v){return v==null?'–':('<b class="'+(v>=50?"good":"bad")+'">'+v+'%</b>');};
      var line1='<div class="igb-line igb-wr">아군 팀 조합 '+('<b class="'+(d.myComp>=d.enemyComp?"good":"bad")+'">'+d.myComp+'%</b>')+' vs 상대 '+('<b class="'+(d.enemyComp>d.myComp?"good":"bad")+'">'+d.enemyComp+'%</b>')+' → 예상 승률 '+wr(d.expectedWin)+'</div>';
      var mini=function(arr,lbl,markSelf){ arr=(arr||[]).slice().sort(function(a,b){return ((b.compWR!=null?b.compWR:b.winRate)||0)-((a.compWR!=null?a.compWR:a.winRate)||0)}); if(!arr.length)return ''; return '<div class="igb-row"><span class="igb-lbl">'+lbl+'</span>'+arr.map(function(p){var w=(p.compWR!=null?p.compWR:p.winRate);return '<span class="igb-ch'+(markSelf&&p.isSelf?' me':'')+'" title="'+esc((p.name||'')+' '+(w!=null?w+'%':''))+'">'+icon(p.icon,"igb-ic")+(w!=null?'<b class="'+(w>=50?"good":"bad")+'">'+w+'</b>':'')+'</span>';}).join('')+'</div>'; };
      var fav=[]; if(d.strongestAlly)fav.push('유리 <b class="good">'+esc(d.strongestAlly)+'</b>'); if(d.strongestEnemy)fav.push('주의 <b class="bad">'+esc(d.strongestEnemy.name)+'</b>'+(d.strongestEnemy.compWR!=null?' '+d.strongestEnemy.compWR+'%':''));
      var favH=fav.length?'<div class="igb-line igb-sub">'+fav.join(' · ')+'</div>':'';
      return '<div class="igb-inner">'+line1+mini(d.allies,'아군',true)+mini(d.enemies,'상대',false)+favH+'</div>';
    }
    function renderCompBanner(d){ // 상세페이지(#champpage) 맨 위에 sticky 배너로 조합 승률을 얹는다. 매 폴에서 갱신(픽/조합 변화 반영). 없으면 만들고 있으면 내용만 교체.
      if(d)igLastState=d; d=igLastState; if(!d)return;
      if(!document.body.classList.contains("cp"))return; var wrap=$("#champpage"); if(!wrap)return;
      var b=$("#ig-compbanner"); if(!b){ wrap.insertAdjacentHTML('afterbegin','<div class="ig-compbanner" id="ig-compbanner"></div>'); b=$("#ig-compbanner"); }
      b.innerHTML=compBannerHtml(d)+IG_TOGGLE_HINT;
    }
    function igReattachBanner(){ var d=igLastState; if(igEnabled && igGameChamp && d && d.view==="ingame" && !d.loading && document.body.classList.contains("cp")) renderCompBanner(d); } // ★renderChamp 재렌더(상세 내 빌드토글·상대챔프 클릭)로 #champpage가 통째 교체돼 배너가 지워지면 즉시 복구 → '상세+조합 둘 다 보이게' 유지(폴 기다리는 2.5초 공백 제거). igGameChamp 게이트로 게임 밖 일반 상세엔 안 붙음.
    try{ window.__igReattach=igReattachBanner; }catch(_){} // 바깥 스코프(renderChamp)에서 호출용 — IIFE 내부 함수 노출
    function renderGame(d){
      var en=(d.enemies||[]).slice().sort(function(a,b){return ((b.compWR!=null?b.compWR:b.winRate)||0)-((a.compWR!=null?a.compWR:a.winRate)||0)});
      var me=(d.allies||[]).filter(function(p){return p.isSelf})[0]; // 내 챔프(빌드 표시용)
      var slot=function(p,strong,allyBest){var cw=(p.compWR!=null?p.compWR:p.winRate);return '<div class="ig-slot'+(strong?' strong':'')+(allyBest?' ally-best':'')+(p.isSelf?' self':'')+'" title="'+esc(p.name||'')+(p.compWR!=null?' · 조합 반영 '+p.compWR+'%'+(p.winRate!=null?' (단독 '+p.winRate+'%)':''):'')+'">'+icon(p.icon)+'<div class="ig-nm">'+esc(p.name)+'</div>'+wr(cw)+(strong?'<span class="ig-badge">최강</span>':(allyBest?'<span class="ig-badge">조합↑</span>':''))+'</div>';};
      var cmp=(d.myComp!=null&&d.enemyComp!=null)?('<div class="ig-teamcomp">우리 팀 조합 <b class="'+(d.myComp>=d.enemyComp?"good":"bad")+'">'+d.myComp+'%</b> vs 상대 <b class="'+(d.enemyComp>d.myComp?"good":"bad")+'">'+d.enemyComp+'%</b> → 예상 승률 <b class="'+((d.expectedWin||50)>=50?"good":"bad")+'">'+(d.expectedWin!=null?d.expectedWin+'%':'–')+'</b></div>'):('<div class="ig-teamcomp">예상 승률 <b class="'+((d.expectedWin||50)>=50?"good":"bad")+'">'+(d.expectedWin!=null?d.expectedWin+'%':'–')+'</b></div>');
      $("#ingamepage").innerHTML='<div class="ig-wrap"><div class="ig-head"><b>인게임 · 게임</b><span class="muted">'+(igMode==="augment"?"증강":"일반")+' · 조합 반영</span>'+IG_TOGGLE_HINT+'</div>'
        +cmp
        +'<div class="ig-sec">아군 팀 <span class="muted">· 승률=조합 반영</span></div><div class="ig-team">'+(d.allies||[]).map(function(p){return slot(p,false,d.strongestAlly&&p.name===d.strongestAlly)}).join('')+'</div>'
        +'<div class="ig-sec">상대 팀 <span class="muted">· 강한 순</span></div><div class="ig-team">'+en.map(function(p,i){return slot(p,i===0,false)}).join('')+'</div>'
        +(d.strongestEnemy?'<div class="ig-strong">가장 강한 상대: <b>'+esc(d.strongestEnemy.name)+'</b> '+wr(d.strongestEnemy.compWR!=null?d.strongestEnemy.compWR:d.strongestEnemy.winRate)+'</div>':'')
        +(me&&me.name?('<div class="ig-sec">내 챔프 빌드 · '+esc(me.name)+' <span class="muted">('+(igMode==="augment"?"증강·아이템":"룬 이미 적용·아이템")+' 최고 승률)</span></div><div class="ig-buildbox" id="ig-gamebuild">'+(igBuildCache["game:"+me.name]||'<span class="muted">불러오는 중…</span>')+'</div>'):'')
        +(d.note?'<div class="ig-note muted">'+esc(d.note)+'</div>':'')+'</div>';
    }
    function sigOf(d){ if(d.view==="champselect")return 'cs|'+d.mode+'|'+(d.me&&d.me.name)+'|'+(d.recommend&&d.recommend.name)+'|'+d.teamComp+'|'+(d.teamPct!=null?d.teamPct:'')+'|'+d.bestAlly+'|'+(d.myTeam||[]).map(function(p){return p.name+p.compWR}).join()+'|'+(d.bench||[]).map(function(p){return p.name+(p.teamWR!=null?':'+p.teamWR:'')+(p.pct!=null?'/'+p.pct:'')}).join()+'|'+d.benchEnabled+'|'+(d.pickModel?1:0)+'|'+(d.waiting||''); if(d.view==="ingame")return 'ig|'+d.mode+'|'+(d.allies||[]).map(function(p){return p.name+p.compWR}).join()+'|'+(d.enemies||[]).map(function(p){return p.name+p.compWR}).join()+'|'+d.myComp+'|'+d.enemyComp+'|'+d.expectedWin; return 'none'; }
    async function refresh(){ if(igBusy)return; igBusy=true; try{
      if(!igEnabled){ if(igActive)igShow(false); return; } // ★마스터 오프 — 게임을 감지해도 아무것도 자동표시 안 함(상세는 🎮 핸들러가 이미 닫음)
      var d=await fetch("/api/ingame/state?mode="+mode+(IGMOCK?("&mock="+encodeURIComponent(IGMOCK)):"")).then(function(x){return x.json()}); if(!d||!d.ok)return;
      if(!igEnabled){ if(igActive)igShow(false); return; } // ★fetch 대기 중 마스터가 꺼졌으면 오버레이 재표시 금지(레이스 — 껐는데 in-flight refresh가 다시 띄우던 것)
      igLastState=d; igMode=d.mode||mode; // igMode=서버가 gameMode로 감지한 실제 큐(일칼q450/증바람q2400). 픽창 중엔 상단 탐색 토글(mode) 안 건드림.
      var inGame=(d.view==="champselect"||d.view==="ingame");
      var wasInGame=(igPrevView==="champselect"||igPrevView==="ingame");
      if(inGame && !wasInGame){ igShownDetailFor=""; igGameChamp=""; _igUserClosed=false; } // 새 게임 진입 초기화 (사용자 모드 저장은 openGameDetail 정렬 직전에 최신값으로)
      igPrevView=d.view;
      if(inGame){
        if(d.view==="champselect"){ // 픽창 = 오버레이(추천·팀조합·벤치·빌드). 상세는 아직 안 띄움(픽 확정 전, 스왑 잦음).
          if(document.body.classList.contains("cp"))closeGameDetail();
          if(!igActive)igShow(true);
          var sig=sigOf(d); if(sig!==igSig){ igSig=sig; renderCS(d); }
          if(igMode!=="augment"&&d.me&&d.me.name&&d.me.name!==igLastChamp){ igLastChamp=d.me.name; loadBuild(d.me.name).then(function(){ if(igAutoRune)applyRunes(igLastChamp); }); } // 룬·아이템 자동적용(내 챔프 바뀔 때)
        } else if(d.loading){ // 픽창→게임 전환 로딩 — 오버레이 유지(깜빡임/닷지처럼 꺼짐 제거)
          if(!igActive)igShow(true);
          if(igSig!=="ig-load"){igSig="ig-load";renderIgLoading();}
        } else { // ★실게임 = 내 챔프 상세페이지 + 조합 승률 배너를 '둘 다 동시에' 표시(덮지 않음)
          var meD=(d.allies||[]).filter(function(p){return p.isSelf})[0]||d.me;
          if(meD&&meD.name){
            if(igActive)igShow(false); // 픽창 오버레이 접기 — 인게임 뷰는 상세+배너
            if(igGameChamp!==meD.name){ igGameChamp=meD.name; _igUserClosed=false; openGameDetail(meD.name); } // 새 챔프 → 상세 오픈(모드 정렬+배너)
            else if(!_igUserClosed && !document.body.classList.contains("cp")){ openGameDetail(meD.name); } // 상세 닫혔으면(init 레이스·mid-game 실행·뒤로가기) 복구
            else { renderCompBanner(d); } // 이미 열림 → 배너만 갱신(상대 조합 반영 승률 변화)
          } else { // ★자기 챔프 식별 실패(빈 summonerName 등) — 상세는 못 열어도 조합만이라도 오버레이로 표시(빈 메인화면 방지)
            if(document.body.classList.contains("cp"))closeGameDetail();
            if(!igActive)igShow(true);
            var sigg=sigOf(d); if(sigg!==igSig){ igSig=sigg; renderGame(d); }
          }
          igLastChamp="";
        }
      } else {
        igLastChamp=""; _igUserClosed=false; // 로비 복귀 → 래치 해제(다음 게임엔 반드시 다시 뜬다)
        if(wasInGame){ igShownDetailFor=""; igGameChamp=""; if(igActive)igShow(false); closeGameDetail(); if(igUserMode!=null){ if(mode!==igUserMode)setMode(igUserMode); igUserMode=null; } if(igUserBuildMode!=null){ buildMode=igUserBuildMode; igUserBuildMode=null; } } // ★게임 종료 → 상세+배너 닫고 메인 복귀 + 사용자 탐색 모드·빌드모드 복원
        else if(igActive)igShow(false);
      }
    }catch(e){}finally{igBusy=false;} }
    // ── 증강 오버레이 스위치 ──────────────────────────────────────────────
    //   인게임 모드와 달리 ★최초에는 꺼져 있다(default OFF). 한 번 켜면 그 뒤로는 기억한다.
    //   화면에 뭔가를 덮어씌우는 기능이라, 켜달라고 한 적 없는 사람에게 먼저 뜨면 안 된다.
    // ★증강 오버레이 = 기본 켜짐. 끈 선택만 기억한다(인게임 모드와 같은 방식).
    var aoEnabled=true;
    try{ if(localStorage.getItem('am_ao_enabled')==='0') aoEnabled=false; }catch(_){}
    function updateAoBtn(){
      var sw=$("#aosw"); if(sw)sw.classList.toggle("on",aoEnabled);
      var bb=$("#aobtn"); if(bb)bb.title=aoEnabled
        ? "증강 오버레이 켜짐 — 증강 칼바람에서 고를 증강 3개 위에 티어·승률을 띄워요. 눌러서 끄기."
        : "증강 오버레이 꺼짐 — 아무것도 띄우지 않아요. 눌러서 켜기.";
    }
    var aoWarn="";
    function aoSetWarn(msg){
      aoWarn=msg||"";
      var h=$("#aohelp"); if(!h)return;
      h.classList.toggle("bad",Boolean(aoWarn));
      try{ h.firstChild.nodeValue = aoWarn ? "!" : "?"; }catch(_){}
      h.setAttribute("aria-label", aoWarn ? "증강 오버레이 안내 — 문제 있음" : "증강 오버레이 안내");
      renderAoTip();
    }
    function aoApply(){
      // 서버가 실제로 오버레이 프로세스를 띄우고 내린다. 실패해도 화면은 막지 않는다.
      // ★그런데 예전엔 결과를 아예 안 봤다 — 띄울 파일이 없어도 아무 말이 없어서
      //   사용자에겐 "스위치를 켰는데 그냥 안 뜬다"로만 보였다(실제 신고). 이제 이유를 표시한다.
      if(!aoEnabled){ try{ fetch("/api/augment-overlay/stop",{method:"POST"}).catch(function(){}); }catch(_){} aoSetWarn(""); return; }
      try{
        fetch("/api/augment-overlay/start",{method:"POST"}).then(function(r){return r.json()}).then(function(j){
          if(j&&j.ok){ aoSetWarn(""); return; }
          var why=(j&&j.error)||"";
          var msg;
          if(why==="overlay-not-installed"||why==="shell-too-old")
            msg="지금 설치된 칼바람 분석기가 오버레이를 띄울 수 없는 옛 버전입니다. 최신 설치본을 한 번만 설치하면 그 뒤로는 알아서 갱신됩니다.";
          else if(why==="runtime-downloading")
            msg="증강 오버레이에 필요한 글자 인식 데이터를 받는 중입니다. 다 받으면 저절로 켜집니다.";
          else if(why==="overlay-exited")
            msg="오버레이가 켜지자마자 종료됐습니다. 최신 설치본을 한 번 설치해 주세요.";
          else msg="오버레이를 시작하지 못했습니다"+(why?" ("+why+")":"")+".";
          aoSetWarn(msg);
        }).catch(function(){ aoSetWarn("오버레이 상태를 확인하지 못했습니다."); });
      }catch(_){}
    }
    var ab=$("#aobtn"); if(ab){
      ab.onclick=function(){ aoEnabled=!aoEnabled; try{localStorage.setItem('am_ao_enabled',aoEnabled?'1':'0')}catch(_){} updateAoBtn(); aoApply(); };
      ab.onkeydown=function(e){ if(e.key===" "||e.key==="Enter"){ e.preventDefault(); ab.onclick(); } };
    }
    updateAoBtn();
    if(aoEnabled) aoApply();   // 지난번에 켜둔 채 껐다면 이번에도 켜진 채로 시작한다.
    function renderAoTip(){
    var tip=document.querySelector("#aohelp .ao-tip");
    if(tip) tip.innerHTML =
      (aoWarn ? "<span class=\"warn\"><b>"+aoWarn+"</b></span><br><br>" : "")
      + "<b>증강 오버레이</b><br>"
      + "증강 칼바람에서 고를 증강 3개 위에, 내 챔피언 기준 순위를 띄웁니다.<br><br>"
      + "<span class=\"warn\">· 1920×1080 · 2560×1440 · 3840×2160 에 맞춰져 있어요.</span><br>"
      + "<span class=\"warn\">&nbsp;&nbsp;그 외 해상도에서는 자리를 못 찾습니다.</span><br>"
      + "· 화면 모드는 <b>창 모드</b> 또는 <b>테두리 없음</b>이어야 동작해요.<br><br>"
      + "화면 글자를 읽어 알아보는 방식이라 한계가 있어요.<br>"
      + "· 알트탭 등 화면 전환이 잦으면 못 읽고 넘어가요.<br>"
      + "· 일부 증강은 이름이 잘 안 읽혀요.<br>"
      + "· 못 읽은 자리는 비워 둡니다. 틀린 값을 넣지는 않아요.";
    }
    renderAoTip();
    var ao=$("#aoobs"); if(ao) ao.onclick=function(){ try{ window.open("http://127.0.0.1:8900/setup","_blank"); }catch(_){} };

    var b=$("#igbtn"); if(b) b.onclick=function(){ igEnabled=!igEnabled; try{localStorage.setItem('am_ig_enabled',igEnabled?'1':'0')}catch(_){} updateIgBtn(); if(!igEnabled){ igShow(false); if(igGameChamp)closeGameDetail(); /* ★게임 중일 때만 상세 닫음 — 게임 밖에서 보던 챔프 상세를 메인으로 날려버리지 않게 */ igShownDetailFor=""; igGameChamp=""; igSig=""; if(igUserMode!=null){ if(mode!==igUserMode)setMode(igUserMode); igUserMode=null; } if(igUserBuildMode!=null){ buildMode=igUserBuildMode; igUserBuildMode=null; } } else { igSig=""; refresh(); } }; // 🎮 = 인게임 모드 마스터 on/off. 끄면 즉시 모든 인게임 표시 닫고 메인(게임 감지 중단), 켜면 게임 감지 재개.
    updateIgBtn(); // 초기 버튼 상태(켜짐/꺼짐) 반영
    var ig=$("#ingamepage");
    if(ig){ ig.addEventListener("click",function(e){var s=e.target.closest&&e.target.closest("[data-igswap]"); if(s){ if(s.classList.contains("igswapping"))return; s.classList.add("igswapping"); igLastChamp=""; igSig=""; /* ★클릭 즉시 시각 피드백(반응성) — 스왑 완료·refresh 전에 바로 눌린 느낌 */ fetch("/api/ingame/swap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({championId:Number(s.getAttribute("data-igswap"))})}).then(function(x){return x.json()}).then(function(){refresh()}).catch(function(){ try{s.classList.remove("igswapping")}catch(_){} }); }});
      ig.addEventListener("change",function(e){ if(e.target&&e.target.id==="ig-autorune"){ igAutoRune=e.target.checked; try{localStorage.setItem('am_ig_autorune',igAutoRune?'1':'0')}catch(_){} if(igAutoRune&&igLastChamp)applyRunes(igLastChamp); } }); } // 자동룬 선택 영속화
    refresh(); igPoll=setInterval(refresh, 2500);
  })();
  // ── 커스텀 즉시 툴팁: 네이티브 title은 ~1초 지연·빈약(사용자 지적). title을 data-tip으로 옮겨 즉시 표시·자동위치 ──
  (function(){
    var tip=document.createElement('div'); tip.className='ctip'; document.body.appendChild(tip); var cur=null;
    function show(el){ var t=el.getAttribute('data-tip'); if(t==null){ t=el.getAttribute('title'); if(t!=null){ el.setAttribute('data-tip',t); el.removeAttribute('title'); } } if(!t){ return; } tip.textContent=t; tip.classList.add('on'); cur=el; }
    function hide(){ tip.classList.remove('on'); cur=null; }
    document.addEventListener('mouseover', function(e){ var el=e.target.closest&&e.target.closest('[title],[data-tip]'); if(el){ show(el); } });
    document.addEventListener('mouseout', function(e){ if(!cur){ return; } var el=e.target.closest&&e.target.closest('[data-tip]'); if(el===cur){ var to=e.relatedTarget&&e.relatedTarget.closest&&e.relatedTarget.closest('[data-tip]'); if(to!==cur){ hide(); } } });
    document.addEventListener('mousemove', function(e){ if(!cur){ return; } var r=tip.getBoundingClientRect(); var x=e.clientX+14, y=e.clientY+18; if(x+r.width>innerWidth-8){ x=e.clientX-r.width-12; } if(y+r.height>innerHeight-8){ y=e.clientY-r.height-12; } tip.style.left=Math.max(6,x)+'px'; tip.style.top=Math.max(6,y)+'px'; }, {passive:true});
  })();
  // ── 분포 스캐터 확대축소/이동: 휠=줌(커서기준)·드래그=이동·더블클릭=리셋. viewBox 조작. 사용자 지시(사이트처럼 확대축소, 클릭진입은 제거됨) ──
  (function(){
    function vb(svg){ return (svg.getAttribute('viewBox')||'0 0 500 500').split(/\s+/).map(Number); }
    document.addEventListener('wheel', function(e){
      var svg=e.target.closest&&e.target.closest('.dist-svg'); if(!svg) return; e.preventDefault();
      var v=vb(svg), x=v[0],y=v[1],w=v[2],h=v[3], rect=svg.getBoundingClientRect();
      var mx=x+(e.clientX-rect.left)/rect.width*w, my=y+(e.clientY-rect.top)/rect.height*h;
      var f=e.deltaY<0?0.85:1.18, nw=Math.max(70,Math.min(500,w*f)), nh=nw;
      var nx=mx-(mx-x)*(nw/w), ny=my-(my-y)*(nh/h);
      svg.setAttribute('viewBox', nx.toFixed(1)+' '+ny.toFixed(1)+' '+nw.toFixed(1)+' '+nh.toFixed(1));
    }, {passive:false});
    var drag=null, lx=0, ly=0;
    document.addEventListener('pointerdown', function(e){ var svg=e.target.closest&&e.target.closest('.dist-svg'); if(!svg) return; drag=svg; svg.classList.add('panning'); lx=e.clientX; ly=e.clientY; });
    document.addEventListener('pointermove', function(e){ if(!drag) return; var v=vb(drag), rect=drag.getBoundingClientRect(); var dx=(e.clientX-lx)/rect.width*v[2], dy=(e.clientY-ly)/rect.height*v[3]; drag.setAttribute('viewBox',(v[0]-dx).toFixed(1)+' '+(v[1]-dy).toFixed(1)+' '+v[2]+' '+v[3]); lx=e.clientX; ly=e.clientY; });
    document.addEventListener('pointerup', function(){ if(drag){ drag.classList.remove('panning'); drag=null; } });
    document.addEventListener('dblclick', function(e){ var svg=e.target.closest&&e.target.closest('.dist-svg'); if(svg){ svg.setAttribute('viewBox','0 0 500 500'); } });
    document.addEventListener('click', function(e){ var b=e.target.closest&&e.target.closest('[data-dz]'); if(!b) return; var wrap=b.closest('.dist-wrap'), svg=wrap&&wrap.querySelector('.dist-svg'); if(!svg) return; var act=b.getAttribute('data-dz'); if(act==='reset'){ svg.setAttribute('viewBox','0 0 500 500'); return; } var v=vb(svg), cx=v[0]+v[2]/2, cy=v[1]+v[3]/2, f=act==='in'?0.8:1.25, nw=Math.max(70,Math.min(500,v[2]*f)); svg.setAttribute('viewBox',(cx-nw/2).toFixed(1)+' '+(cy-nw/2).toFixed(1)+' '+nw.toFixed(1)+' '+nw.toFixed(1)); });
  })();
  // 세로데이터 빌드패널 검색 — 본문(.dv-build-body)만 갈아끼워 입력 포커스·커서를 보존한다(패널 통째 재렌더 금지).
  document.addEventListener("input", deb(function(e){
    var q=e.target.closest&&e.target.closest(".dv-build-search"); if(!q) return;
    _dvBuildState.query=q.value;
    var b=dvBuildBox(); if(!b) return;
    var d=_dvBuildCache[_dvBuildState.ent]; if(!d||!d.cols) return;
    var col=d.cols.filter(function(c){return c.key===_dvBuildState.filter;})[0]||d.cols[0];
    var body=b.querySelector(".dv-build-body"); if(body&&col) body.innerHTML=dvBuildBody(d,col);
  }));
  // ── 우상단 #q = 페이지 내 찾기(ctrl+f) — 현재 화면에서 키워드 하이라이팅·카운트·이동(사이트식 통합검색 대체, 사용자 지시). Enter=다음·Shift+Enter=이전·Esc=지우기. ──
  findEnsureObserver();
  $("#q").addEventListener("input",deb(findOnInput,180));
  $("#q").addEventListener("keydown",function(e){
    if(e.key==="Escape"){ e.preventDefault(); findClear(); return; }
    if(e.key==="Enter"){ e.preventDefault(); findGo(e.shiftKey?-1:1); return; }
  });
  if($("#findprev")) $("#findprev").onclick=function(){ findGo(-1); var qi=$("#q"); if(qi)qi.focus(); };
  if($("#findnext")) $("#findnext").onclick=function(){ findGo(1); var qi=$("#q"); if(qi)qi.focus(); };
  function searchSummoner(name){ closeChamp(); closeSettings(); var _tk=_navSeq; $("#champpage").innerHTML=cpLoading(); document.body.classList.add("cp"); fetch("/api/summoner?name="+encodeURIComponent(name)).then(function(r){return r.json()}).then(function(d){if(_tk===_navSeq)renderSummoner(d);}).catch(function(){if(_tk===_navSeq)closeChamp();}); } // 2026-07-09 _navSeq 가드(형제 openChamp 등과 동일) — 늦게 온 stale 소환사 응답이 현재 뷰를 덮어쓰지 않게. closeChamp가 이미 ++_navSeq 하므로 그 값을 캡처
  function renderSummoner(d){
    if(d.error){
      if(d.error==="NO_KEY"){ // 배포본(운영자 키 없음)에선 '남 소환사 검색' 불가 → 본인 전적은 키 불필요한 LCU 경로로 안내. 운영자(키 보유)는 이 분기 안 봄.
        $("#champpage").innerHTML='<div class="cp-wrap"><button class="cp-back" id="sback" type="button">← 닫기</button><div class="cp-box"><div class="blank">본인 전적은 아래 버튼으로 확인하세요.<br><span class="g">롤 클라이언트가 켜져 있어야 해요.</span><br><br>다른 소환사 전적 검색은 이 버전에선 제공되지 않아요.</div><div class="pad" style="text-align:center"><button class="btn" id="nokeyload" type="button">롤에서 내 전적 불러오기</button></div></div></div>';
        document.body.classList.add("cp"); $("#sback").onclick=navBack; $("#nokeyload").onclick=function(){ closeChamp(); loadMe(false); }; return;
      }
      var msg=d.error==="NOT_FOUND"?"소환사를 찾지 못했어요. <b>이름#태그</b>로 검색하세요 (예: 강준치칼국수#맛있워요).":"불러오기 실패 — 잠시 후 다시 시도."; $("#champpage").innerHTML='<div class="cp-wrap"><button class="cp-back" id="sback" type="button">← 닫기</button><div class="cp-box"><div class="blank">'+msg+'</div></div></div>'; document.body.classList.add("cp"); $("#sback").onclick=navBack; return; }
    var s=d.standard||{};
    var head='<button class="cp-back" id="sback" type="button">← 닫기</button>'+
      '<div class="cp-head">'+img("","ci lg")+'<div><div class="cn">'+esc(d.who)+' <span class="tier" style="background:var(--accent-soft);color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent-line)">검색</span></div>'+
      '<div class="meta">일반 칼바람 · '+kfmt(s.total)+'전 '+kfmt(s.wins)+'승 '+kfmt(s.total-s.wins)+'패 · 승률 '+s.winRate+'%'+(mode==="augment"?' <span style="color:var(--mut)">· 소환사 검색은 일반 칼바람만 지원돼요</span>':'')+'</div></div></div>'; // 분당 딜량 제거: ARAM서 무의미(사용자 지적)
    if(!s.total){ $("#champpage").innerHTML='<div class="cp-wrap">'+head+'<div class="cp-box"><div class="blank">최근 일반 칼바람 기록이 없어요.</div></div></div>'; document.body.classList.add("cp"); $("#sback").onclick=navBack; return; }
    var champH=(s.champs||[]).slice(0,12).map(function(c){return '<div class="row">'+img(c.icon,"ci")+'<span class="nm">'+esc(c.name)+'</span>'+wr(c.winRate,c.thin)+'<span class="g">'+kfmt(c.games)+'판</span></div>';}).join('')||'<div class="blank">기록 없음</div>';
    var recentH=(s.recent||[]).map(function(m){ var slots='';var its=m.items||[];for(var i=0;i<6;i++){slots+='<span class="islot">'+pim(its[i])+'</span>';} var mk=m.mk>=2?'<span class="mk">'+(m.mk>=5?'펜타킬':m.mk>=4?'쿼드라킬':m.mk>=3?'트리플킬':'더블킬')+'</span>':''; return '<div class="match '+(m.win?'win':'loss')+'"><div class="m-l">'+img(m.icon,"ci")+'</div><div class="m-c"><div class="m-c1"><b>'+esc(m.name)+'</b><span class="res">'+(m.win?'승':'패')+'</span><span class="m-t">'+(m.dur||'')+'</span></div><div class="m-c2">'+mk+'</div><div class="m-it">'+slots+'</div></div><div class="m-r"><b>'+(m.dmg?kfmt(m.dmg):'-')+'</b><span class="m-rl">가한 피해</span></div></div>';}).join('')||'<div class="blank">최근 경기 없음</div>';
    $("#champpage").innerHTML='<div class="cp-wrap">'+head+'<div class="cp-grid g2"><div class="cp-box"><h4>챔피언별 통계</h4>'+champH+'</div><div class="cp-box"><h4>최근 경기</h4>'+recentH+'</div></div></div>';
    document.body.classList.add("cp"); $("#sback").onclick=navBack;
  }
  // 전적 로드 — 수동 클릭 + 자동 갱신 공용. silent=true면 스피너/버튼상태 안 건드리고 조용히 새로고침(깜빡임 없음).
  var loadInFlight=false, lastLoadAt=0;
  var webProfileData=null;
  window.addEventListener("am:demo-loaded", function(ev){ if(ev&&ev.detail){ webProfileData=null; lastMe=ev.detail; lastLoadAt=Date.now(); renderMe(true); } });
  function renderWebProfile(d){
    var el=$("#me"); if(!el) return;
    if(!d||!d.ok){
      el.innerHTML='<p class="hint">'+(d&&d.msg?esc(d.msg):'계정을 찾지 못했습니다. 닉네임#태그 형식으로 다시 검색해보세요.')+'</p>';
      return;
    }
    var m=d.mmr;
    var parts=String(d.who||"").split("#");
    var dispName=anonMode?"익명":parts[0];
    var dispTag=anonMode?"--":(parts[1]||"KR1");
    var html='<div class="wp-card">';
    html+='<div class="wp-head"><div class="wp-name">'+esc(dispName)+' <span class="wp-tag">#'+esc(dispTag)+'</span></div>';
    if(m&&m.tierName){
      html+='<span class="tier" style="background:var(--accent-soft);color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent-line)">'+esc(m.tierName)+'</span>';
    }
    html+='</div>';
    if(m&&m.found){
      html+='<div class="wp-mmr-box">';
      html+='<div class="wp-stat"><span class="wp-stat-l">증바람 MMR</span><span class="wp-stat-v acc">'+kfmt(m.mmr)+'</span></div>';
      html+='<div class="wp-stat"><span class="wp-stat-l">전체 순위</span><span class="wp-stat-v">'+(m.rank?kfmt(m.rank)+'위':'-')+'</span></div>';
      html+='<div class="wp-stat"><span class="wp-stat-l">집계 판수</span><span class="wp-stat-v">'+kfmt(m.games)+'판</span></div>';
      html+='</div>';
      var p=m.picks||{};
      if(p.champions&&p.champions.length){
        html+='<div><div class="wp-sec-title"><span>자주 하는 챔피언</span><span>판수</span></div><div class="wp-chips">';
        p.champions.forEach(function(c){
          html+='<div class="wp-chip" data-wp-champ="'+esc(c.name)+'">'+img(c.icon,"")+'<span class="wp-chip-nm">'+esc(c.name)+'</span><span class="wp-chip-g">'+kfmt(c.games)+'판</span></div>';
        });
        html+='</div></div>';
      }
      if(p.augments&&p.augments.length){
        html+='<div><div class="wp-sec-title"><span>자주 고르는 증강</span><span>선택</span></div><div class="wp-chips">';
        p.augments.forEach(function(a){
          html+='<div class="wp-chip" data-wp-aug="'+esc(a.id)+'">'+img(a.icon,"")+'<span class="wp-chip-nm">'+esc(a.name)+'</span><span class="wp-chip-g">'+kfmt(a.games)+'회</span></div>';
        });
        html+='</div></div>';
      }
      if(p.items&&p.items.length){
        html+='<div><div class="wp-sec-title"><span>자주 가는 아이템</span><span>선택</span></div><div class="wp-chips">';
        p.items.forEach(function(it){
          html+='<div class="wp-chip" data-wp-item="'+esc(it.id)+'">'+img(it.icon,"")+'<span class="wp-chip-nm">'+esc(it.name)+'</span><span class="wp-chip-g">'+kfmt(it.games)+'회</span></div>';
        });
        html+='</div></div>';
      }
    } else if(!d.standard){
      html+='<p class="hint">증바람 MMR 집계가 아직 없습니다.</p>';
    }
    if(d.standard&&d.standard.total){
      var s=d.standard;
      html+='<div><div class="wp-sec-title"><span>일반 칼바람 최근 '+kfmt(s.total)+'전</span><span>'+kfmt(s.wins)+'승 '+(s.total-s.wins)+'패 ('+s.winRate+'%)</span></div><div class="wp-chips">';
      (s.champs||[]).slice(0,5).forEach(function(c){
        html+='<div class="wp-chip" data-wp-champ="'+esc(c.name)+'">'+img(c.icon,"")+'<span class="wp-chip-nm">'+esc(c.name)+'</span><span class="wp-chip-g">'+c.winRate+'% · '+kfmt(c.games)+'판</span></div>';
      });
      html+='</div></div>';
    }
    html+='</div>';
    el.innerHTML=html;
    el.querySelectorAll("[data-wp-champ]").forEach(function(node){
      node.onclick=function(){ openChamp(node.getAttribute("data-wp-champ")); };
    });
    el.querySelectorAll("[data-wp-aug]").forEach(function(node){
      node.onclick=function(){ if(mode!=="augment") setMode("augment"); openAugment(node.getAttribute("data-wp-aug")); };
    });
    el.querySelectorAll("[data-wp-item]").forEach(function(node){
      node.onclick=function(){ openItem(node.getAttribute("data-wp-item")); };
    });
  }
  function searchWebProfile(rawName){
    var q=String(rawName||"").trim();
    if(!q){ $("#me").innerHTML='<p class="hint">계정명#태그를 입력해주세요 (예: 주대각#kr12).</p>'; return; }
    if(loadInFlight) return; loadInFlight=true;
    var b=$("#load");
    if(b){ b.disabled=true; b.textContent="검색 중…"; }
    $("#me").innerHTML='<p class="hint"><span class="spin"></span> 계정 전적 조회 중…</p>'; _meSig=null;
    fetch("/api/web-profile?name="+encodeURIComponent(q)).then(function(r){return r.json()}).then(function(d){
      webProfileData=d;
      if(d&&d.ok){
        lastMe={
          who: d.who,
          searched: true,
          standard: d.standard||{total:0,wins:0,winRate:0,champs:[],recent:[],form:[]},
          augment: {
            total: (d.mmr&&d.mmr.games)||0,
            wins: 0,
            winRate: 0,
            champs: (d.mmr&&d.mmr.picks&&d.mmr.picks.champions)||[],
            recent: [],
            form: []
          }
        };
      }
      renderWebProfile(d);
    }).catch(function(){
      $("#me").innerHTML='<p class="hint">전적 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.</p>';
    }).finally(function(){
      loadInFlight=false;
      if(b){ b.disabled=false; b.textContent="검색"; }
    });
  }
  function loadMe(silent){
    if(webProfileData){ renderWebProfile(webProfileData); return Promise.resolve(); }
    if(silent){
      if(!lastMe){ $("#me").innerHTML='<p class="hint">위 검색창에 <b>계정명#태그</b>를 입력해 전적을 검색하거나, <b>데모</b> 버튼으로 체험해보세요.</p>'; }
      return Promise.resolve();
    }
    var inp=$("#summoner-input");
    if(inp && inp.value.trim()){ searchWebProfile(inp.value); return Promise.resolve(); }
    $("#me").innerHTML='<p class="hint">위 검색창에 <b>계정명#태그</b>를 입력해 전적을 검색하거나, <b>데모</b> 버튼으로 체험해보세요.</p>';
    return Promise.resolve();
  }
  var sform=$("#summoner-search-form");
  if(sform){ sform.onsubmit=function(e){ e.preventDefault(); var inp=$("#summoner-input"); searchWebProfile(inp?inp.value:""); }; }
  else if($("#load")){ $("#load").onclick=function(){ loadMe(false); }; }
  $("#anonbtn").onclick=function(){ anonMode=!anonMode; try{localStorage.setItem('am_anon',anonMode?'on':'off');}catch(e){} updateAnonBtn(); if(lastMe)renderMe(true); if($("#champpage .fortune-wrap"))openRecordReading(); rerenderScoreboard(); }; // 익명 토글: 닉/태그·사주풀이 + 열려 있는 전적 개요(10인 닉네임) 즉시 갱신
  updateAnonBtn();
  var startModeParam=initialParams.get("mode");
  // 서버가 셸에 심어준 __amBootMode 가 정본(설정 파일 기준). localStorage 는 랜덤 포트로 origin 이 매번 바뀌어 항상 비어 있다 — 최후 폴백으로만 둔다.
  var startMode=(startModeParam==="augment"||startModeParam==="standard")?startModeParam:((window.__amBootMode==="augment"||window.__amBootMode==="standard")?window.__amBootMode:(localStorage.getItem('am_startMode')||"standard"));
  var startTabParam=initialParams.get("tab"), startTableParam=initialParams.get("table"), startRangeParam=initialParams.get("range");
  if(startRangeParam)activeTableRange=startRangeParam;
  if(startTableParam)pendingTableKey=startTableParam;
  setMode(startMode);
  // 동의 게이트(필수): 데이터 제공에 동의해야만 프로그램 사용 가능. 옵트아웃 없음(설정 토글 제거).
  //   CONSENT_VERSION이 바뀌면 기존 사용자도 한 번 더 동의하게 한다(사용자 지시 "이미 깔린 사람도 다시 물어보게"). 동의 조건이 바뀔 때 버전 올림.
  //   ⚠️ 동의 저장은 서버(/api/settings, ~/.aram-mayhem-companion/settings.json)에 한다. Electron이 매 실행 랜덤 포트라
  //     localStorage는 origin이 바뀌어 매번 초기화 → "매번 동의창 뜸" 버그. 서버 파일은 포트 무관하게 영구.
  (function consentGate(){
    var CONSENT_VERSION="2026-09-12";   // ★2026-09-12 기여가 익명이 아니게 바뀌었다(라이엇 ID 동봉) → 이미 깔린 사람도 한 번 더 동의받는다.
    var gate=document.getElementById('amConsentGate'); if(!gate) return;
    var chk=document.getElementById('amConsentCheck'), btn=document.getElementById('amConsentBtn');
    // 기본=차단(게이트 표시). 서버 영구설정 확인 후 이미 동의했으면 숨김.
    // ★2026-07-22: 예전엔 무조건 먼저 띄워서, 이미 동의한 사람도 서버 왕복이 끝날 때까지 전체화면 덮개를 봤다.
    //   250ms 안에 "이미 동의함"이 오면 아예 안 보이고, 그보다 늦거나 서버를 못 읽으면 종전대로 뜬다(차단은 그대로 유지).
    var _consentResolved=(window.__amConsent===CONSENT_VERSION); // 서버가 셸에 심어준 값이 이미 일치하면 덮개를 아예 안 만든다
    if(!_consentResolved) setTimeout(function(){ if(!_consentResolved) gate.hidden=false; },250);
    if(chk){ chk.checked=false; chk.onchange=function(){ if(btn) btn.disabled=!chk.checked; }; }
    if(btn){ btn.disabled=true; btn.onclick=function(){
      if(!chk||!chk.checked) return;
      btn.disabled=true;
      fetch('/api/settings?consent='+encodeURIComponent(CONSENT_VERSION)+'&contribute=on').catch(function(){}).finally(function(){ gate.hidden=true; });
    }; }
    fetch('/api/settings').then(function(r){return r.json()}).then(function(s){
      if(s && s.consent===CONSENT_VERSION){ _consentResolved=true; gate.hidden=true; } // 이미 동의 → 즉시 숨김(아직 안 띄웠으면 아예 안 보임)
      else gate.hidden=false;
    }).catch(function(){ gate.hidden=false; }); // 서버 못읽으면 안전하게 게이트 유지
  })();
  if(startTabParam||startTableParam||startRangeParam)loadTab(startTabParam||"champion", true);
  if(/[?&]mock/.test(location.search)){ fetch("/api/me?mock").then(function(r){return r.json()}).then(function(j){lastMe=j;renderMe()}); }
  else {
    // #21 시작 자동 불러오기는 서버 설정 reconcile(아래 fetch /api/settings)에서 결정 — localStorage가
    //   랜덤 포트(origin)로 매 실행 초기화되므로 동기 localStorage로 판단하면 설정이 무의미해진다.
    var autoRefresh=function(){ loadMe(true); reloadMeta(); }; // 게임 후/주기: 개인+메타 둘 다 갱신
    setInterval(autoRefresh, 180000); // 3분마다 백그라운드 갱신 — 게임 끝나면 알아서 반영
    var refreshOnReturn=function(){ if(!document.hidden && Date.now()-lastLoadAt>30000) autoRefresh(); }; // 게임 후 앱으로 돌아오면 갱신(30초 쓰로틀)
    document.addEventListener("visibilitychange", refreshOnReturn);
    window.addEventListener("focus", refreshOnReturn);
  } // 프리뷰/데모용 자동 채움
  /* ★2026-09-27 위 알림 줄을 끼운 뒤 부른다 — 머리 줄 아래 끝을 --top-h 로 맞춰, 머리 줄 아래 고정 화면(전적 상세·설정·게임 중)이 같이 내려가게 한다.
     줄 높이가 바뀌면(창 폭이 줄어 두 줄이 되거나 '다시 시작' 옆 안내 글이 붙으면) 다시 잰다. 줄이 없으면 변수를 지워 종전(54px)과 같다. */
  function amSyncTopH(){
    var top=document.querySelector("body > .top"), root=document.documentElement;
    if(!top||!document.querySelector("body > .upd-bar")){ root.style.removeProperty("--top-h"); return; }
    root.style.setProperty("--top-h", top.getBoundingClientRect().bottom+"px");
  }
  var amTopRO=(typeof ResizeObserver==="function")?new ResizeObserver(amSyncTopH):null;
  function amWatchTopBar(bar){ amSyncTopH(); if(amTopRO) amTopRO.observe(bar); else window.addEventListener("resize",amSyncTopH); }
  // 업데이트 알림(R2 version.json vs 번들 버전). 실패/동일이면 아무것도 안 함(additive·비차단).
  fetch("/api/version").then(function(r){return r.json()}).then(function(v){
    if(v&&v.current) window.__amVer=v.current;
    if(!v||!v.updateAvailable||!v.url)return;
    var bar=document.createElement("a");bar.href=v.url;bar.className="upd-bar";bar.target="_blank";
    bar.innerHTML='<b>새 버전 '+esc(v.latest)+' 출시</b> — 클릭해서 다운로드 (현재 '+esc(v.current)+')';
    document.body.insertBefore(bar,document.body.firstChild);
    amWatchTopBar(bar);
  }).catch(function(){});
  /* ★2026-09-26 켜 둔 분석기의 새 판 알림 — 분석기는 켤 때만 새 판을 받는다. 오래 켜 둔 분석기가 옛 계산으로 등수를 매겨
       "같은 판인데 PC 마다 등수가 다르다" 는 제보가 나왔다(서버 runtimeRestart 주석). 새 판이 있으면 위에 한 줄 + '다시 시작'.
       저절로 다시 켜지 않는다(다시 켜질 때 창이 앞으로 떠 롤 클라이언트 앞자리를 뺏는다). 게임 중에 누르면 끝나고 다시 누르라고만 한다. */
  (function(){
    var shown=false, lastAt=0;
    function show(){
      if(shown)return; shown=true;
      var bar=document.createElement("div"); bar.className="upd-bar"; bar.id="rt-upd";
      bar.innerHTML='<b>새 버전이 준비됐어요</b> — 다시 시작하면 적용돼요<button type="button" class="rt-go" id="rt-upd-go">다시 시작</button><span class="rt-note" id="rt-upd-note"></span>';
      document.body.insertBefore(bar,document.body.firstChild);
      amWatchTopBar(bar);
      var b=document.getElementById("rt-upd-go"), note=document.getElementById("rt-upd-note");
      b.onclick=function(){
        b.disabled=true; b.textContent="다시 시작하는 중…"; note.textContent="";
        fetch("/api/runtime-update/restart",{method:"POST"}).then(function(r){return r.json()}).then(function(j){
          if(j&&j.ok)return;   // 곧 앱이 다시 켜진다
          b.disabled=false; b.textContent="다시 시작";
          note.textContent=(j&&j.error==="in-game")?"게임이 끝난 뒤에 눌러 주세요":"분석기를 직접 껐다 켜 주세요";
        }).catch(function(){ b.disabled=false; b.textContent="다시 시작"; note.textContent="분석기를 직접 껐다 켜 주세요"; });
      };
    }
    function check(){
      var now=Date.now(); if(shown||now-lastAt<60000)return; lastAt=now;
      fetch("/api/runtime-update",{cache:"no-store"}).then(function(r){return r.json()}).then(function(v){ if(v&&v.ready)show(); }).catch(function(){});
    }
    try{ window.__amRtShow=show; }catch(_){}   // 화면 확인용(개발 도구에서 한 번 불러 모양만 본다)
    setTimeout(check,3*60*1000); setInterval(check,20*60*1000);
    window.addEventListener("focus",check);
  })();
  // #21 서버 영구 설정 reconcile — localStorage가 랜덤 포트(origin)로 매 실행 초기화돼도, 서버 파일의
  //   시작 모드·자동 불러오기를 읽어 적용한다(설정이 재시작 후에도 유지되게).
  fetch("/api/settings").then(function(r){return r.json()}).then(function(cfg){
    window.__amSettings=cfg||{};
    RIOT_SEARCH=!!(cfg&&cfg.riotKey); // #q는 페이지 내 찾기 전용으로 전환 — 소환사 검색 트리거·플레이스홀더 제거(dormant 코드는 보존)
    if(cfg.startMode){ try{localStorage.setItem('am_startMode',cfg.startMode);}catch(_){} if(!startModeParam && cfg.startMode!==mode) setMode(cfg.startMode); }
    if(cfg.autoLoad){ try{localStorage.setItem('am_autoLoad',cfg.autoLoad);}catch(_){} }
    if(!/[?&]mock/.test(location.search) && (cfg.autoLoad||'on')!=='off') loadMe(true);
  }).catch(function(){ if(!/[?&]mock/.test(location.search) && localStorage.getItem('am_autoLoad')!=='off') loadMe(true); });

  /* ══ 증바람MMR 검색 창 (2026-09-14) ══════════════════════════════════════
     운영자 지시(이용자 의견): "사주풀이 오른쪽에 MMR버튼을 눌러서, MMR검색하는 창이 하나 있으면 좋겠다.
      어차피 사이트에서 조회하거나 최상위 플레이어를 보는 구성이 있으니까, 그대로 반영해서"
     → 아래는 사이트 public/app_v2.js 의 증바람MMR 조회·최상위 플레이어 코드를 **그대로 옮긴 것**이다.
       화면을 새로 만들지 않았다. 고칠 일이 생기면 사이트 쪽을 고치고 여기로 다시 옮겨라.
     바꾼 곳은 셋뿐이고 그 자리마다 주석을 달아 뒀다: 데이터 경로 · 티어 그림 주소 · 좌우 화살표 조건.
     ⚠️ 증강 칼바람(q2400) 전용이다. 일반 칼바람(q450)은 MMR 을 아예 재지 않는다 —
        setMode 에서 버튼을 내리고 열려 있던 창도 닫는다. 두 모드를 섞으면 안 된다. */
  (function amMmrWindow(){
    var amMmrTab = "lookup";
    function amMmrIsOpen(){ var g = $("#amMmrModal"); return !!(g && !g.hidden); }
    function amMmrPaint(){
      var b = $("#amMmrBody"); if (!b) return;
      b.innerHTML = amMmrTab === "top" ? window.amMmrTopTable() : window.amMmrLookupTable();
    }

    const AM_MMR_SHARDS = 64;
    const amMmrKey = s => String(s || "").normalize("NFC").replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "").toLowerCase().replace(/\s+/g, "");   // ⚠️ NFC 로 모아야 한다 — 조합형(NFD)으로 붙여넣으면 눈에는 같은데 글자 수가 달라 열쇠가 안 맞는다(실측: 11자 vs 19자).
    const amMmrEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const amMmrNum = n => Number(n || 0).toLocaleString("ko-KR");
    function amMmrShardOf(k) {
      let h = 0x811c9dc5;
      for (let i = 0; i < k.length; i += 1) { h ^= k.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
      return (h % AM_MMR_SHARDS).toString(16).padStart(2, "0");
    }
    let amMmrMeta = null;
    const amMmrShardCache = new Map();
    let amMmrRows = null, amMmrBusy = false, amMmrError = "";
    /* ★2026-09-14 조회표에 수명을 준다 — 운영자 신고 "MMR버튼 누른 다음 나오는 내용들이 한참 옛날게 그대로 떠있다".
       이 창은 사이트 코드를 그대로 옮긴 것인데, 사이트는 브라우저라 새로고침할 때마다 다시 받는다.
       이 앱은 며칠씩 켜 둔 채 페이지를 다시 안 읽으므로, 앱을 켠 순간 받은 조회표가 그대로 굳는다
       (meta·칸·최상위 셋 다 "있으면 그냥 반환"이라 영영 안 바뀐다).
       ⚠️ 배지(fillMmrBadge)가 2026-09-12 에 똑같은 이유로 이미 고쳐진 자리다 — 같은 3분을 쓴다.
          서버쪽 원격 캐시가 5분이라 그보다 짧아야 새 값을 놓치지 않는다.
       ⚠️ 새 캐시를 여기 더할 일이 생기면 amMmrExpire 에도 같이 넣어라. 빠뜨리면 그것만 옛날 값으로 남는다. */
    const AM_MMR_TTL = 3 * 60 * 1000;
    let amMmrAt = 0, amMmrLastText = "";
    function amMmrExpire() {
      if (amMmrBusy || amMmrTopBusy) return;                     // 받는 중이면 건드리지 않는다(중복 요청 방지)
      if (amMmrAt && Date.now() - amMmrAt < AM_MMR_TTL) return;
      amMmrAt = 0;
      amMmrMeta = null; amMmrShardCache.clear();
      amMmrPickMeta = null; amMmrPickTop = null; amMmrPickCache.clear();   // 주 선택 3열도 같이 늙는다
      amMmrTopData = null; amMmrTopErr = "";
      amMmrRows = null; amMmrError = "";                          // 옛 결과표를 남겨 두면 그게 곧 "옛날 게 떠 있는" 화면이다
    }
    async function amMmrGetMeta() {
      if (amMmrMeta) return amMmrMeta;
      const r = await fetch("/api/mmr-file?f=meta.json", { cache: "no-store" });
      if (!r.ok) throw new Error("조회표를 못 받았습니다");
      amMmrMeta = await r.json();
      if (!amMmrAt) amMmrAt = Date.now();
      return amMmrMeta;
    }
    async function amMmrGetShard(sh) {
      if (amMmrShardCache.has(sh)) return amMmrShardCache.get(sh);
      const r = await fetch("/api/mmr-file?f=" + sh + ".json", { cache: "no-store" });
      if (!r.ok) throw new Error("조회표를 못 받았습니다");
      const j = await r.json();
      amMmrShardCache.set(sh, j);
      if (!amMmrAt) amMmrAt = Date.now();
      return j;
    }
    /* ── 주 선택 3열(2026-09-15) — 사이트와 같은 화면이다 ────────────────────
       챔피언·증강·아이템을 각 최대 5개씩, 그 사람이 많이 고른 순으로 왼쪽부터 깐다.
       고르는 규칙(3판/3회 이상 · 아이템 비신발3+신발2 · 증강 프리즘2+골드2+실버1)은 전부
       tools/am_mmr_pickcols.mjs 가 끝내 놓았다 — 여기서는 받은 순서대로 그리기만 한다.
       ⚠️ 이름·아이콘은 pick/meta.json 사전이 정본이다(티어리스트와 같은 한글 명칭).
          컴패니언엔 사이트의 아이콘 폴백 함수가 없으므로 사전이 유일한 출처다.
       ⚠️ 5개가 안 차면 안 차는 대로 둔다. 칸이 좌측정렬이라 있는 만큼 왼쪽부터 찬다. */
    let amMmrPickMeta = null, amMmrPickTop = null;
    const amMmrPickCache = new Map();
    async function amMmrLoadPickMeta() {
      if (amMmrPickMeta) return amMmrPickMeta;
      try { const r = await fetch("/api/mmr-file?f=pick/meta.json", { cache: "no-store" }); if (r.ok) amMmrPickMeta = await r.json(); } catch (_) {}
      if (!amMmrPickMeta) amMmrPickMeta = {};
      for (const k of ["champions", "augments", "items"]) if (!amMmrPickMeta[k]) amMmrPickMeta[k] = {};
      return amMmrPickMeta;
    }
    async function amMmrGetPick(sh) {
      if (amMmrPickCache.has(sh)) return amMmrPickCache.get(sh);
      let j = null;
      try { const r = await fetch("/api/mmr-file?f=pick/" + sh + ".json", { cache: "no-store" }); if (r.ok) j = await r.json(); } catch (_) {}
      amMmrPickCache.set(sh, j);
      return j;
    }
    function amMmrPickCell(list, kind) {
      const arr = Array.isArray(list) ? list : [];
      if (!arr.length) return `<td class="am-mmr__pk"></td>`;
      const unit = kind === "champion" ? "판" : "회";
      const dict = (amMmrPickMeta && amMmrPickMeta[kind === "champion" ? "champions" : kind === "augment" ? "augments" : "items"]) || {};
      const chips = arr.map(e => {
        const id = e && e[0], n = Number(e && e[1]) || 0;
        const m = dict[id] || null;
        const label = (m && m.n) || String(id);
        const icon = (m && m.i) || "";
        const tip = amMmrEsc(label + " " + amMmrNum(n) + unit);
        return icon
          ? `<span class="am-mmr__chip" title="${tip}"><img src="${amMmrEsc(icon)}" alt="" decoding="async" onerror="const p=this.parentElement;this.remove();p&&p.classList.add('is-miss')"></span>`
          : `<span class="am-mmr__chip is-miss" title="${tip}"></span>`;
      }).join("");
      return `<td class="am-mmr__pk"><span class="am-mmr__chips">${chips}</span></td>`;
    }
    function amMmrPickCells(pick) {
      const p = Array.isArray(pick) ? pick : [];
      return amMmrPickCell(p[0], "champion") + amMmrPickCell(p[1], "augment") + amMmrPickCell(p[2], "item");
    }
    function amMmrTopPickOf(name) {
      if (!amMmrPickTop || !amMmrPickTop.p) return null;
      return amMmrPickTop.p[amMmrKey(name)] || null;
    }
    window.amMmrSearch = async function amMmrSearch() {
      const box = document.getElementById("amMmrNames");
      if (!box || amMmrBusy) return;
      const names = String(box.value || "").split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 60);
      amMmrLastText = String(box.value || "");   // 창을 다시 열 때 되돌려 넣고 새 조회표로 다시 찾는다
      amMmrBusy = true; amMmrError = ""; amMmrRows = null;
      const out = document.getElementById("amMmrOut");
      if (out) out.innerHTML = `<div class="log">찾는 중…</div>`;
      try {
        const keys = names.map(raw => { const k = amMmrKey(raw); return (k && k.indexOf("#") >= 1) ? k : ""; });
        const askAt = []; keys.forEach((k, i) => { if (k) askAt.push(i); });
        /* ★★2026-09-26 먼저 이름을 한 번에 사이트 서버로 보내 그 사람 줄만 받는다(server.mjs mmrApi · 운영자: "조회 속도를 항상 일정하게").
           종전엔 이름마다 칸(79만 바이트)을 차례로 받았다. 서버가 답하지 못한 이름만 아래 종전 길(칸 받기)로 간다. */
        const apiP = askAt.length ? fetch("/api/mmr-lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: askAt.map(i => keys[i]), pick: true }), cache: "no-store" })
          .then(r => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
        const [meta, , aj] = await Promise.all([amMmrGetMeta(), amMmrLoadPickMeta(), apiP]);   // 사전은 실패해도 조회는 그대로 된다
        const api = new Map();
        if (aj && aj.ok && Array.isArray(aj.r) && aj.r.length === askAt.length) askAt.forEach((ni, i) => { const x = aj.r[i]; if (!(x && x.e)) api.set(ni, x || null); });
        const rows = [];
        for (let ni = 0; ni < names.length; ni += 1) {
          const raw = names[ni], k = keys[ni];
          if (!k) { rows.push({ input: raw, found: false, why: "태그까지 적어주세요" }); continue; }
          let hit = null, pick = null;
          if (api.has(ni)) { const x = api.get(ni); hit = x && Array.isArray(x.m) ? x.m : null; pick = x && x.k ? x.k : null; }
          else {
            const sh = amMmrShardOf(k);
            const j = await amMmrGetShard(sh);
            hit = j && j.p ? j.p[k] : null;
            const pj = hit ? await amMmrGetPick(sh) : null;      // 주 선택 3열 — 찾은 사람만 받는다
            pick = pj && pj.p ? pj.p[k] : null;
          }
          if (hit) rows.push({ input: raw, found: true, mmr: hit[0], games: hit[1], rank: hit[2] || 0, tier: hit[3], pick });   // ★넷째 칸은 이제 티어 번호다(예전엔 "3000 한계에 걸렸나")
          else rows.push({ input: raw, found: false, why: "아직 집계되지 않았습니다" });
        }
        rows.sort((a, b) => (b.found ? (b.rank ? -b.rank : -1e8) : -1e9) - (a.found ? (a.rank ? -a.rank : -1e8) : -1e9));
        amMmrRows = { rows, meta };
      } catch (err) { amMmrError = err && err.message ? err.message : String(err); }
      amMmrBusy = false;
      const area = document.getElementById("amMmrOut");
      if (area) area.innerHTML = amMmrResultHtml();
    };
    // 이름과 태그를 갈라 보여준다 — 태그는 흐리게. ⚠️ 찾는 규칙은 그대로 "태그까지 정확히"다(보여주기만 가른다).
    function amMmrNameHtml(raw) {
      const s = String(raw || "");
      const i = s.lastIndexOf("#");
      if (i <= 0) return `<span class="am-mmr__nm-n">${amMmrEsc(s)}</span>`;
      return `<span class="am-mmr__nm-n">${amMmrEsc(s.slice(0, i))}</span><i class="am-mmr__nm-t">#${amMmrEsc(s.slice(i + 1))}</i>`;
    }
    /* ── 티어 딱지 (2026-09-12) ───────────────────────────────────────────────
       3000 이상이 챌린저, 그 아래는 실제 솔로랭크 비율대로 나눈 칸이다(경계는 서버가 정해 실어 보낸다).
       이름 목록도 서버 meta 에서 받는다 — 여기서 지어내지 않는다. 못 받으면 아래 기본값을 쓴다.
       ⚠️ 그림은 op.gg 가 쓰는 랭크 엠블럼 그대로다(원본 Riot 자산). 내가 그린 걸 쓰지 마라 — 한 번 퇴짜 맞았다.
       ⚠️ 지연 로딩은 쓰지 마라(loading="lazy"). 라이브 실측에서 표가 화면 안에 있는데도 다섯 장 모두
          complete=false 로 안 떴다. 속성만 떼자 곧바로 전부 떴다 — 22px 아이콘 몇 장에 얻을 게 없다.
          받아온 파일은 public/assets/tier/<영문티어>.png 에 있고, 배포되면 /assets/tier/ 로 나간다. */
    const AM_TIER_NAMES = ["아이언", "브론즈", "실버", "골드", "플래티넘", "에메랄드", "다이아몬드", "마스터", "그랜드마스터", "챌린저"];
    const AM_TIER_SLUG = ["iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"];
    function amTierBadge(t, size) {
      const i = Number(t);
      if (!Number.isFinite(i) || i < 0 || i > 9) return "";
      /* ⚠️ 조회표가 아직 옛 형식이면 넷째 칸은 티어가 아니라 "3000 에 걸렸나"(0/1) 다.
         그대로 읽으면 2849 짜리에 아이언이 붙는다(실사고). 새 형식인지는 meta 에 tiers 가 있는지로 가른다. */
      if (!(amMmrMeta && amMmrMeta.tiers)) return "";
      const nm = ((amMmrMeta && amMmrMeta.tiers && amMmrMeta.tiers.names) || AM_TIER_NAMES)[i] || AM_TIER_NAMES[i];
      const s = size || 22;
      return `<img class="am-tier" src="https://aram-mayhem.com/assets/tier/${AM_TIER_SLUG[i]}.png" width="${s}" height="${s}" alt="${nm}" title="${nm}" decoding="async">`;
    }
    function amMmrResultHtml() {
      if (amMmrError) return `<div class="am-mmr__msg">${amMmrEsc(amMmrError)}</div>`;
      if (!amMmrRows) return "";
      const { rows, meta } = amMmrRows;
      if (!rows.length) return `<div class="am-mmr__msg">닉네임을 적어주세요.</div>`;
      const baseMin = meta.baseMin || 30, baseN = meta.basePeople || 0;
      const body = rows.map(x => {
        if (!x.found) {
          return `<tr class="am-mmr__r am-mmr__r--miss"><td class="am-mmr__rk am-mmr__dim">—</td>`
            + `<td class="am-mmr__nm">${amMmrNameHtml(x.input)}</td>`
            + `<td class="am-mmr__why" colspan="5">${amMmrEsc(x.why)}</td></tr>`;   // 주 선택 3열이 늘어 5칸이다
        }
        // ★순위 칸에 "#28 / 16,381" 을 함께 적는다 — 그래야 열 머리에 "N명 중" 을 따로 안 써도 된다(운영자 지시).
        const rank = x.rank
          ? `<b>#${amMmrNum(x.rank)}</b><span class="am-mmr__of">/ ${amMmrNum(baseN)}</span>`
          : `<span class="am-mmr__dim">${baseMin}판 미만</span>`;
        return `<tr class="am-mmr__r"><td class="am-mmr__rk">${rank}</td>`
          + `<td class="am-mmr__nm">${amMmrNameHtml(x.input)}</td>`
          + amMmrPickCells(x.pick)
          + `<td class="am-mmr__gm">${amMmrNum(x.games)}판</td>`
          + `<td class="am-mmr__mv"><span class="am-mmr__mvwrap">${amTierBadge(x.tier, 22)}<b>${amMmrNum(x.mmr)}</b></span></td></tr>`;
      }).join("");
      return `<table class="am-mmr__table"><thead><tr>`
        + `<th class="am-mmr__rk">순위</th><th class="am-mmr__nm">닉네임</th>`
        /* ⚠️ 열 머리의 가운데 정렬을 여기 줄에 직접 박는다. 스타일 규칙으로는 안 먹는다 —
           style_v2.theme.css 의 `body.public-viewer #tableArea th{text-align:left !important}` 가
           id 를 낀 규칙이라 내 규칙보다 세다(라이브 실측: th 가 left, td 만 center 로 갈렸다). */
        + `<th class="am-mmr__pk">주 선택 챔피언</th><th class="am-mmr__pk">주 선택 증강</th><th class="am-mmr__pk">주 선택 아이템</th>`
        + `<th class="am-mmr__gm" style="text-align:center !important">반영 표본 수</th>`
        + `<th class="am-mmr__mv" style="text-align:center !important">MMR</th>`
        + `</tr></thead><tbody>${body}</tbody></table>`;
    }
    // ⚠️ 아래 세 문장은 운영자가 준 글자 그대로다. 숫자만 집계표(meta)에서 채운다 — 내 말로 고쳐 쓰지 마라.
    const AM_MMR_NOTE_2 = "칼바람 분석기 이용자를 우선으로 반영하기에, 조회하는 계정의 반영 표본 수가 상이할 수 있습니다.";
    const AM_MMR_NOTE_3 = "칼바람 분석기를 설치하여 계정을 등록하면 집계에 반영되어 수 시간 내에 뜨기 시작합니다.";
    function amMmrBasisText() {
      if (!amMmrMeta || !amMmrMeta.games) return "집계 기준을 불러오는 중입니다.";
      // ★2026-09-14 단위가 "건"이니 참가 행으로 센다 — meta.games 는 판 수라 10배가 맞는다(한 판에 10명).
      //   어림이 아니라 정확한 값이다(구간 빌드 실측: 판 1,136,353 · 참가 행 11,363,530).
      //   ⚠️ 모바일 m/m.js 의 mmrBasisText 도 같은 문장이다 — 한쪽만 고치면 두 화면 숫자가 갈린다.
      return "본 사이트에 집계된 " + amMmrNum(amMmrMeta.games * 10) + "건의 데이터에 가중치를 반영해 산출한 값이며, 공식적으로 제공되는 MMR이 아닙니다.";
    }
    // 두 번째 줄 — 운영자가 준 글자 그대로다.
    function amMmrBasisText2() {
      if (!amMmrMeta || !amMmrMeta.games) return "";
      return (amMmrMeta.minGames || 10) + "판 이상인 계정부터 MMR이 계산되고, " + (amMmrMeta.baseMin || 30) + "판부터 순위에 반영됩니다.";
    }
    /* ★2026-09-23 제목 오른쪽 집계 인원 — 사이트(app_v2.js)와 글자 그대로 같은 문장. 만 단위 내림.
       운영자: "10판 이상 집계 계정 112만 개, 30판 이상 집계 계정 42만 개 와 같이 내림으로 … 사이트랑 칼바람 분석기 두곳에 모두 반영해줘" */
    function amMmrCountText() {
      if (!amMmrMeta || !amMmrMeta.people) return "";
      const man = v => Math.floor((Number(v) || 0) / 10000).toLocaleString("ko-KR") + "만 개";
      return (amMmrMeta.minGames || 10) + "판 이상 집계 계정 " + man(amMmrMeta.people)
        + ", " + (amMmrMeta.baseMin || 30) + "판 이상 집계 계정 " + man(amMmrMeta.basePeople);
    }
    window.amMmrLookupTable = function amMmrLookupTable() {
      if (!amMmrMeta) amMmrGetMeta().then(() => {
        const el = document.getElementById("amMmrBasis");
        if (el) el.textContent = amMmrBasisText();
        const el2 = document.getElementById("amMmrBasis2");
        if (el2) el2.textContent = amMmrBasisText2();
        const el3 = document.getElementById("amMmrCount");
        if (el3) el3.textContent = amMmrCountText();
      }).catch(() => {});
      return `
        <div class="am-mmr">
          <section class="am-mmr__panel">
            <header class="am-mmr__head"><i class="am-mmr__mark" aria-hidden="true"></i><h3>증바람MMR 조회</h3><span class="am-mmr__cnt" id="amMmrCount">${amMmrCountText()}</span></header>
            <div class="am-mmr__box">
              <textarea id="amMmrNames" rows="4" spellcheck="false" placeholder="닉네임을 한줄에 하나씩 태그까지 적어주세요.(띄어쓰기 포함)
  예)
  aaa#bbb
  ccc#ddd
  eee#fff"></textarea>
              <button type="button" class="am-mmr__go" onclick="window.amMmrSearch&&window.amMmrSearch()">점수 보기</button>
            </div>
            <div id="amMmrOut" class="am-mmr__out">${amMmrResultHtml()}</div>
          </section>
          <ul class="am-mmr__note">
            <li id="amMmrBasis">${amMmrEsc(amMmrBasisText())}</li>
            <li id="amMmrBasis2">${amMmrEsc(amMmrBasisText2())}</li>
            <li>${AM_MMR_NOTE_2}</li>
            <li>${AM_MMR_NOTE_3}</li>
          </ul>
        </div>`;
    };

    /* ★2026-09-13 【증바람MMR 최상위 플레이어】 운영자 지시 그대로:
       "챌린저들만 50명씩 페이지로 좌우로 넘기게 ... 1위부터 나열되어서 50명씩 끊기게 페이지 있도록,
        좌우로 넘기면서 등수와 닉네임, MMR이 뜨도록. 조회 페이지인거야"
       ⚠️ 조회표 64칸(5.8MB)을 받지 않는다 — 이 목록 전용 파일 하나(top.json · 4.5KB)만 받는다.
       ⚠️ 등수는 발행 쪽 정본(30판 이상 안에서 매긴 등수)을 그대로 쓴다. 화면에서 순위를 새로 만들지 않는다. */
    let amMmrTopData = null, amMmrTopErr = "", amMmrTopPage = 0, amMmrTopBusy = false, amMmrTopGroup = 0;
    /* ★2026-09-13 【닉네임 검색 — 운영자 지시】
       "챌린저와 그랜드마스터, 마스터 어디에 있든 존재하면 검색되도록. 닉네임과 태그가 완전일치하지 않더라도
        #떡잎해적단 해적단 이렇게만 검색해도 ... 닉네임과 해시태그중 어디에 들어있는지, 들어있다면 검색되도록"
       → 태그를 떼지 않고 "닉네임#태그" 통짜에 부분일치를 건다. 그래야 "해적단" 도 "#떡잎해적단" 도 같이 걸린다.
       ⚠️ 검색 중에는 드롭박스(티어 고르기)를 무시하고 세 묶음 전체를 뒤진다 — 어디 있든 찾으라는 게 지시다. */
    let amMmrTopQ = "";
    const amMmrTopNk = s => String(s == null ? "" : s).normalize("NFC").replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "").toLowerCase().replace(/\s+/g, "");
    function amMmrTopHits() {
      const q = amMmrTopNk(amMmrTopQ);
      if (!q || !amMmrTopData || !Array.isArray(amMmrTopData.groups)) return null;
      const out = [];
      for (const g of amMmrTopData.groups) for (const x of (g.p || [])) {
        if (amMmrTopNk(x[1]).includes(q)) out.push([x[0], x[1], x[2], g.tier, g.label]);
      }
      out.sort((a, b) => (b[2] - a[2]) || (a[0] - b[0]));
      return out;
    }
    function amMmrTopLoad() {
      if (amMmrTopData || amMmrTopBusy) return;
      amMmrTopBusy = true;
      Promise.all([
        fetch("/api/mmr-file?f=top.json", { cache: "no-store" }).then(r => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))),
        amMmrGetMeta().catch(() => null),  // 티어 딱지를 그리려면 meta.tiers 가 있어야 한다
        /* 주 선택 3열 — 최상위 명단치를 한 장으로 받는다. 실패해도 명단은 그대로 뜬다(그 칸만 빈다). */
        fetch("/api/mmr-file?f=pick/top.json", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => { amMmrPickTop = j; }).catch(() => null),
        amMmrLoadPickMeta().catch(() => null)
      ])
        .then(([j]) => { amMmrTopData = j; amMmrTopErr = ""; if (!amMmrAt) amMmrAt = Date.now(); })
        .catch(() => { amMmrTopErr = "명단을 불러오지 못했습니다."; })
        .then(() => { amMmrTopBusy = false; amMmrTopPaint(); });
    }
    function amMmrTopG() {
      if (!amMmrTopData || !Array.isArray(amMmrTopData.groups)) return null;
      return amMmrTopData.groups[Math.min(Math.max(0, amMmrTopGroup), amMmrTopData.groups.length - 1)] || null;
    }
    function amMmrTopPer() { return (amMmrTopData && amMmrTopData.perPage) || 50; }
    /* PC app_v2 amMmrTopMinNote 그대로 — top.json 의 top3MinGames 를 읽어 왼쪽에 붙인다. */
    function amMmrTopMinNote() {
      const n = Number(amMmrTopData && amMmrTopData.top3MinGames) || 0;
      return n > 0 ? `반영 표본 수 ${amMmrNum(n)}판 이상 / ` : "";
    }
    function amMmrTopPages() { const g = amMmrTopG(); return g ? Math.max(1, Math.ceil(g.p.length / amMmrTopPer())) : 1; }
    function amMmrTopBodyHtml() {
      if (amMmrTopErr) return `<div class="am-mmr__msg">${amMmrEsc(amMmrTopErr)}</div>`;
      const per = amMmrTopPer();
      const hits = amMmrTopHits();
      if (hits) {
        if (!hits.length) return `<div class="am-mmr__msg">${amMmrEsc(amMmrTopQ)} 로 찾은 사람이 없습니다.</div>`;
        const pages = Math.max(1, Math.ceil(hits.length / per));
        const pg = Math.min(Math.max(0, amMmrTopPage), pages - 1);
        amMmrTopPage = pg;
        const body = hits.slice(pg * per, pg * per + per).map(x => `<tr class="am-mmr__r">`
          + `<td class="am-mmr__rk"><b>#${amMmrNum(x[0])}</b></td>`
          + `<td class="am-mmr__nm">${amMmrNameHtml(x[1])}</td>`
          + amMmrPickCells(amMmrTopPickOf(x[1]))
          + `<td class="am-mmr__mv"><span class="am-mmr__mvwrap">${amTierBadge(x[3], 22)}<b>${amMmrNum(x[2])}</b></span></td></tr>`).join("");
        return amMmrTopTableHtml(body) + amMmrTopPagerHtml(pg, pages, hits.length, per);
      }
      const g = amMmrTopG();
      if (!g) return `<div class="am-mmr__msg">명단을 불러오는 중입니다.</div>`;
      if (!g.p.length) return `<div class="am-mmr__msg">아직 ${amMmrEsc(g.label)} 가 없습니다.</div>`;
      const pages = amMmrTopPages();
      const pg = Math.min(Math.max(0, amMmrTopPage), pages - 1);
      amMmrTopPage = pg;
      /* 운영자 지시 — MMR 숫자 옆에 그 묶음의 티어 아이콘을 매긴다(챌린저 칸엔 챌린저, 그마 칸엔 그마). */
      const badge = amTierBadge(g.tier, 22);
      const body = g.p.slice(pg * per, pg * per + per).map(x => `<tr class="am-mmr__r">`
        + `<td class="am-mmr__rk"><b>#${amMmrNum(x[0])}</b></td>`
        + `<td class="am-mmr__nm">${amMmrNameHtml(x[1])}</td>`
        + amMmrPickCells(amMmrTopPickOf(x[1]))
        + `<td class="am-mmr__mv"><span class="am-mmr__mvwrap">${badge}<b>${amMmrNum(x[2])}</b></span></td></tr>`).join("");
      return amMmrTopTableHtml(body) + amMmrTopPagerHtml(pg, pages, g.p.length, per);
    }
    /* 표 껍데기와 페이지 넘김은 티어 목록과 검색 결과가 똑같이 쓴다(지시: "원리도 PC와 동일하게"). */
    function amMmrTopTableHtml(body) {
      return `<table class="am-mmr__table am-mmr__table--top"><thead><tr>`
        + `<th class="am-mmr__rk">등수</th><th class="am-mmr__nm">닉네임</th>`
        + `<th class="am-mmr__pk">주 선택 챔피언</th><th class="am-mmr__pk">주 선택 증강</th><th class="am-mmr__pk">주 선택 아이템</th>`
        + `<th class="am-mmr__mv" style="text-align:center !important">MMR</th>`
        + `</tr></thead><tbody>${body}</tbody></table>`;
    }
    function amMmrTopPagerHtml(pg, pages, total, per) {
      const nums = Array.from({ length: pages }, (_, n) =>
        `<button type="button" class="am-mmr__pg${n === pg ? " is-on" : ""}" onclick="window.amMmrTopSet&&window.amMmrTopSet(${n})">${n + 1}</button>`).join("");
      return `<nav class="am-mmr__pager">`
        + `<button type="button" class="am-mmr__pg am-mmr__pg--arrow" ${pg <= 0 ? "disabled" : ""} onclick="window.amMmrTopGo&&window.amMmrTopGo(-1)" aria-label="이전">‹</button>`
        + `<span class="am-mmr__pgnums">${nums}</span>`
        + `<button type="button" class="am-mmr__pg am-mmr__pg--arrow" ${pg >= pages - 1 ? "disabled" : ""} onclick="window.amMmrTopGo&&window.amMmrTopGo(1)" aria-label="다음">›</button>`
        + `<span class="am-mmr__pgof">${amMmrTopMinNote()}${pg * per + 1}–${Math.min(total, pg * per + per)}${amMmrTopQ ? "번째" : "위"} / 전체 ${amMmrNum(total)}명</span>`
        + `</nav>`;
    }
    function amMmrTopNoteHtml() {
      const g = amMmrTopG();
      if (!g) return "";
      /* 문장 틀은 운영자가 준 그대로다. 값만 채운다. */
      const hits = amMmrTopHits();
      if (hits) return `${amMmrEsc(amMmrTopQ)} 로 챌린저·그랜드마스터·마스터 전체에서 ${amMmrNum(hits.length)}명을 찾았습니다.`;
      return `MMR ${amMmrNum(g.minMmr)} 이상인 ${amMmrEsc(g.label)} ${amMmrNum(g.p.length)}명이며 공식 MMR이 아닙니다.`;
    }
    function amMmrTopPaint() {
      const el = document.getElementById("amMmrTopOut");
      if (el) el.innerHTML = amMmrTopBodyHtml();
      const nt = document.getElementById("amMmrTopNote");
      if (nt) nt.textContent = amMmrTopNoteHtml();
      const sel = document.getElementById("amMmrTopSel");
      if (sel && amMmrTopData && Array.isArray(amMmrTopData.groups) && sel.options.length !== amMmrTopData.groups.length) {
        sel.innerHTML = amMmrTopData.groups.map((g, n) => `<option value="${n}">${amMmrEsc(g.label)}</option>`).join("");
        sel.value = String(amMmrTopGroup);
      }
      /* 검색 중에는 세 묶음 전체를 보고 있으니 티어 고르기를 잠근다 — 눌러도 결과가 안 바뀌면 고장으로 보인다. */
      if (sel) sel.disabled = !!amMmrTopQ;
      const qel = document.getElementById("amMmrTopQ");
      if (qel && document.activeElement !== qel && qel.value !== amMmrTopQ) qel.value = amMmrTopQ;
    }
    window.amMmrTopSet = function amMmrTopSet(n) { amMmrTopPage = n; amMmrTopPaint(); };
    window.amMmrTopGo = function amMmrTopGo(d) { amMmrTopPage = Math.min(Math.max(0, amMmrTopPage + d), amMmrTopPages() - 1); amMmrTopPaint(); };
    window.amMmrTopPick = function amMmrTopPick(n) { amMmrTopGroup = Number(n) || 0; amMmrTopPage = 0; amMmrTopPaint(); };
    /* 버튼으로도 엔터로도 검색된다(지시: "검색과 지우기 버튼도 눌러서 검색하거나 지울 수 있게"). */
    window.amMmrTopSearch = function amMmrTopSearch() {
      const el = document.getElementById("amMmrTopQ");
      amMmrTopQ = el ? String(el.value || "").trim() : "";
      amMmrTopPage = 0;
      amMmrTopPaint();
    };
    window.amMmrTopClear = function amMmrTopClear() {
      amMmrTopQ = "";
      amMmrTopPage = 0;
      const el = document.getElementById("amMmrTopQ");
      if (el) { el.value = ""; try { el.focus(); } catch (_) {} }
      amMmrTopPaint();
    };
    /* 좌우 키로도 넘긴다 — 이 표를 보고 있을 때만. 입력칸·드롭박스에 있을 땐 손대지 않는다. */
    document.addEventListener("keydown", ev => {
      try {
        if (!(amMmrTab === "top" && amMmrIsOpen())) return;   /* 앱에서는 이 창의 최상위 탭일 때만 */
        const tag = (ev.target && ev.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || (ev.target && ev.target.isContentEditable)) return;
        if (ev.key === "ArrowLeft") { window.amMmrTopGo(-1); ev.preventDefault(); }
        else if (ev.key === "ArrowRight") { window.amMmrTopGo(1); ev.preventDefault(); }
      } catch (_) {}
    });
    window.amMmrTopTable = function amMmrTopTable() {
      amMmrTopLoad();
      const gs = (amMmrTopData && amMmrTopData.groups) || [{ label: "챌린저" }, { label: "그랜드마스터" }];
      const opts = gs.map((g, n) => `<option value="${n}"${n === amMmrTopGroup ? " selected" : ""}>${amMmrEsc(g.label)}</option>`).join("");
      return `
        <div class="am-mmr">
          <section class="am-mmr__panel">
            <header class="am-mmr__head"><i class="am-mmr__mark" aria-hidden="true"></i><h3>증바람MMR 최상위 플레이어</h3>
              <div class="am-mmr__find">
                <input id="amMmrTopQ" class="am-mmr__q" type="text" autocomplete="off" spellcheck="false"
                  placeholder="닉네임 검색" aria-label="닉네임 검색" value="${amMmrEsc(amMmrTopQ)}"
                  onkeydown="if(event.key==='Enter'){event.preventDefault();window.amMmrTopSearch&&window.amMmrTopSearch();}">
                <button type="button" class="am-mmr__qbtn" onclick="window.amMmrTopSearch&&window.amMmrTopSearch()">검색</button>
                <button type="button" class="am-mmr__qbtn am-mmr__qbtn--off" onclick="window.amMmrTopClear&&window.amMmrTopClear()">지우기</button>
              </div>
              <select id="amMmrTopSel" class="am-mmr__sel" aria-label="티어 고르기" onchange="window.amMmrTopPick&&window.amMmrTopPick(this.value)">${opts}</select>
            </header>
            <div id="amMmrTopOut" class="am-mmr__out am-mmr__out--top">${amMmrTopBodyHtml()}</div>
          </section>
          <ul class="am-mmr__note">
            <li id="amMmrTopNote">${amMmrEsc(amMmrTopNoteHtml())}</li>
          </ul>
        </div>`;
    };

    /* ── 창 여닫기 ─────────────────────────────────────────────────────── */
    window.amMmrOpen = function amMmrOpen(){
      var g = $("#amMmrModal"); if (!g) return;
      amMmrExpire();                       // ★열 때마다 묵은 조회표를 버린다 — 앱을 껐다 켜야만 바뀌던 문제
      g.hidden = false;
      amMmrPaint();
      /* 찾아 둔 이름은 되돌려 넣는다. 조회표가 버려진 뒤라면 그 자리에서 새 표로 다시 찾는다
         (다시 안 찾으면 빈 칸만 남거나 옛 결과표가 그대로 떠 있다). */
      if (amMmrTab !== "top" && amMmrLastText) {
        var box = document.getElementById("amMmrNames");
        if (box) { box.value = amMmrLastText; if (!amMmrRows && window.amMmrSearch) window.amMmrSearch(); }
      }
      var f = g.querySelector(amMmrTab === "top" ? ".am-mmr__q" : "#amMmrNames");
      if (f) { try { f.focus(); } catch (e) {} }
    };
    window.amMmrCloseWin = function amMmrCloseWin(){ var g = $("#amMmrModal"); if (g) g.hidden = true; };
    var btn = $("#mmrbtn"); if (btn) btn.onclick = window.amMmrOpen;
    var x = $("#amMmrClose"); if (x) x.onclick = window.amMmrCloseWin;
    var gate = $("#amMmrModal");
    if (gate) {
      /* 바깥 어두운 데를 누르면 닫힌다 — 카드 안을 누른 건 닫지 않는다. */
      gate.addEventListener("click", function(e){
        if (e.target === gate) { window.amMmrCloseWin(); return; }
        var t = e.target.closest && e.target.closest("[data-mmrtab]");
        if (!t) return;
        amMmrTab = t.getAttribute("data-mmrtab");
        gate.querySelectorAll("[data-mmrtab]").forEach(function(b2){ b2.classList.toggle("on", b2 === t); });
        amMmrExpire();   // 창을 열어 둔 채 탭만 오갈 때도 묵은 표를 버린다
        amMmrPaint();
      });
    }
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape" && amMmrIsOpen()) { e.preventDefault(); window.amMmrCloseWin(); }
    });
  })();

})();

;
window.__amMmrFavStore = "web";
;

/* === am-mmr-fav:begin === 증바람MMR 조회 즐겨찾기·다중 검색 — 사이트와 칼바람 분석기가 글자 그대로 같이 쓰는 한 벌(tools/am_transplant_mmr_fav.mjs 가 옮긴다) */
/* ★2026-09-22 【증바람MMR 조회 — 닉네임 즐겨찾기(로그인 없이 이 브라우저에만 저장)】 운영자 지시 그대로:
   "deeplol.gg에 있는 것처럼 닉네임 조회에 대한 즐겨찾기 기능을 제공하면 좋겠어 ... 내가 사이트에 로그인한 것도 아닌데
    특정 계정들을 즐겨찾기 할 수 있더라고. 즐겨찾기 기능을 조회부분에 추가해서 로컬(8891)에 반영해서 띄워."
   무엇: 조회 결과 줄의 닉네임 앞 별을 누르면 이 브라우저(localStorage)에 담긴다. 담긴 계정은 조회칸 위 '즐겨찾기' 줄에
     칩으로 뜨고, 칩을 누르면 그 닉네임을 바로 조회한다. '모두 조회'는 담긴 계정을 한 번에 조회한다(조회칸이 여러 줄을 받는 그대로).
   ⚠️ 서버·계정·쿠키 없음. 다른 기기·다른 브라우저와는 공유되지 않는다(deeplol 과 같은 방식).
   ⚠️ 조회 로직(amMmrSearch·amMmrResultHtml)은 건드리지 않는다 — 그려진 화면 위에 별과 칩만 얹는다.
   ⚠️ 지금은 미리보기 전용이다: tools/am_serve_pages_site.mjs(8891)가 app_v2.js 끝에 붙여서만 내보낸다.
      public/ 밖이라 워처가 배포하지 않는다. 라이브로 내보낼 때 이 블록을 public/app_v2.js 끝으로 옮긴다. */
(function amMmrFavorites() {
  "use strict";
  if (window.__amMmrFavInstalled) return;
  window.__amMmrFavInstalled = true;
  const KEY = "amMmrFav.v1";
  const MAX = 50;   // 조회칸이 한 번에 60명까지 받는다 — '모두 조회'가 넘치지 않게 그 아래로 둔다
  // 열쇠는 조회표와 같은 규칙(NFC · 소문자 · 공백 제거)이라야 같은 사람이 두 번 담기지 않는다
  const nk = s => String(s || "").normalize("NFC").replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "").toLowerCase().replace(/\s+/g, "");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4l2.62 5.3 5.85.86-4.23 4.12 1 5.83L12 16.76l-5.24 2.75 1-5.83-4.23-4.12 5.85-.86z"/></svg>`;

  /* ★2026-09-23 저장 자리가 둘이다 — 이 블록은 사이트와 칼바람 분석기에 **글자 그대로** 같이 들어간다(정본 1벌).
     · 사이트: 이 브라우저(localStorage).
     · 칼바람 분석기(window.__amMmrFavStore === "app"): 앱은 켤 때마다 포트가 바뀌어 localStorage 가 매번 비워진다
       (동의창이 매번 뜨던 것과 같은 이유) → 앱 서버가 설정 폴더 파일에 적는다(GET/POST /api/mmr-fav). */
  const APP = window.__amMmrFavStore === "app";
  function norm(a) {
    if (!Array.isArray(a)) return [];
    const seen = new Set(), out = [];
    for (const x of a) {
      const n = String((x && x.n) || "").trim(), k = nk(n);
      if (!n || k.indexOf("#") < 1 || seen.has(k)) continue;
      seen.add(k); out.push({ n, at: Number(x && x.at) || 0 });
    }
    return out.slice(0, MAX);
  }
  function load() { try { return norm(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (_) { return []; } }
  let favs = APP ? [] : load();
  let loaded = !APP;   // 앱은 서버에서 받아 온 뒤에만 담기·빼기를 받는다(받기 전에 쓰면 저장된 목록을 덮는다)
  if (APP) fetch("/api/mmr-fav", { cache: "no-store" }).then(r => (r.ok ? r.json() : [])).then(a => { favs = norm(a); loaded = true; paint(); }).catch(() => { loaded = true; });
  function save() {
    if (APP) { fetch("/api/mmr-fav", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(favs) }).catch(() => {}); return; }
    try { localStorage.setItem(KEY, JSON.stringify(favs)); } catch (_) {}
  }
  const idxOf = n => { const k = nk(n); return favs.findIndex(f => nk(f.n) === k); };
  function toggle(n) {
    if (!loaded) return;
    const i = idxOf(n);
    if (i >= 0) favs.splice(i, 1);
    else if (favs.length < MAX) favs.push({ n: String(n).trim(), at: Date.now() });
    else return;
    save(); paint();
  }
  // 결과 줄의 닉네임 = 이름 칸 + 태그 칸(태그 칸 글자가 '#' 부터다). 조회칸에 적은 그대로다.
  function rowName(tr) {
    const n = tr.querySelector(".am-mmr__nm-n"), t = tr.querySelector(".am-mmr__nm-t");
    return n ? (n.textContent + (t ? t.textContent : "")).trim() : "";
  }
  function chipHtml(f) {
    const s = f.n, j = s.lastIndexOf("#");
    const nm = j > 0 ? `${esc(s.slice(0, j))}<i>#${esc(s.slice(j + 1))}</i>` : esc(s);
    const k = esc(nk(s));
    return `<span class="am-fav__chip"><button type="button" class="am-fav__go" data-fav-go="${k}" title="${esc(s)} 조회">${nm}</button>`
      + `<button type="button" class="am-fav__x" data-fav-x="${k}" title="즐겨찾기에서 빼기" aria-label="${esc(s)} 즐겨찾기에서 빼기">×</button></span>`;
  }
  function barHtml() {
    return `<span class="am-fav__label">${STAR}즐겨찾기</span>${favs.map(chipHtml).join("")}`
      + (favs.length > 1 ? `<button type="button" class="am-fav__all" data-fav-all="1">모두 조회</button>` : "");
  }
  function runSearch(lines) {
    const box = document.getElementById("amMmrNames");
    if (!box || typeof window.amMmrSearch !== "function") return;
    box.value = lines.join("\n");
    window.amMmrSearch();
  }
  // 그리기 — 몇 번을 불러도 같은 결과(이미 맞으면 아무것도 안 바꾼다). 그래야 아래 감시와 서로 부르며 돌지 않는다.
  function paint() {
    const box = document.getElementById("amMmrNames");
    if (!box) return;
    const panel = box.closest(".am-mmr__panel");
    if (panel) {
      let bar = document.getElementById("amMmrFav");
      if (!bar || !panel.contains(bar)) {
        bar = document.createElement("div");
        bar.id = "amMmrFav"; bar.className = "am-fav"; bar.dataset.sig = "-";
        const head = panel.querySelector(".am-mmr__head");
        panel.insertBefore(bar, head ? head.nextSibling : panel.firstChild);
      }
      const sig = favs.map(f => f.n).join("\n");
      if (bar.dataset.sig !== sig) { bar.innerHTML = favs.length ? barHtml() : ""; bar.dataset.sig = sig; }
      if (bar.hidden !== !favs.length) bar.hidden = !favs.length;
    }
    const out = document.getElementById("amMmrOut");
    if (!out) return;
    // 못 찾은 줄은 담을 게 없다 — 별 대신 같은 폭의 빈 자리만 둬서 닉네임 줄이 위아래로 맞게 한다
    for (const td of out.querySelectorAll("tr.am-mmr__r--miss td.am-mmr__nm")) {
      if (!td.querySelector(".am-fav__sp")) { const sp = document.createElement("span"); sp.className = "am-fav__sp"; sp.setAttribute("aria-hidden", "true"); td.insertBefore(sp, td.firstChild); }
    }
    for (const tr of out.querySelectorAll("tr.am-mmr__r:not(.am-mmr__r--miss)")) {
      const td = tr.querySelector("td.am-mmr__nm");
      const n = td ? rowName(tr) : "";
      if (!n) continue;
      let b = td.querySelector(".am-fav__star");
      if (!b) {
        b = document.createElement("button");
        b.type = "button"; b.className = "am-fav__star"; b.innerHTML = STAR;
        td.insertBefore(b, td.firstChild);
      }
      const on = idxOf(n) >= 0, want = on ? "true" : "false";
      if (b.getAttribute("aria-pressed") !== want) {
        b.setAttribute("aria-pressed", want);
        b.classList.toggle("is-on", on);
        b.title = on ? "즐겨찾기에서 빼기" : "즐겨찾기에 추가";
        b.setAttribute("aria-label", b.title);
      }
    }
  }
  document.addEventListener("click", ev => {
    const t = ev.target && ev.target.closest ? ev.target.closest(".am-fav__star,[data-fav-go],[data-fav-x],[data-fav-all]") : null;
    if (!t) return;
    ev.preventDefault();
    if (t.classList.contains("am-fav__star")) { const tr = t.closest("tr"); const n = tr ? rowName(tr) : ""; if (n) toggle(n); return; }
    const find = k => favs.find(f => nk(f.n) === k);
    if (t.dataset.favGo) { const f = find(t.dataset.favGo); if (f) runSearch([f.n]); return; }
    if (t.dataset.favX) { const f = find(t.dataset.favX); if (f) toggle(f.n); return; }
    if (t.dataset.favAll) runSearch(favs.map(f => f.n));
  });
  // 다른 탭에서 담거나 뺀 것도 따라간다
  if (!APP) window.addEventListener("storage", ev => { if (ev.key === KEY) { favs = load(); paint(); } });
  // 조회 화면은 탭을 오갈 때마다 새로 그려지고, 결과표는 조회마다 통째로 바뀐다 — 바뀐 뒤 한 번만 다시 얹는다.
  // ⚠️ requestAnimationFrame 대신 setTimeout: 숨은 탭에서는 rAF 가 멈춰 별이 안 붙은 채로 남는다.
  let queued = 0;
  const mo = new MutationObserver(() => { if (queued) return; queued = setTimeout(() => { queued = 0; try { paint(); } catch (_) {} }, 30); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  if (!document.getElementById("amMmrFavStyle")) {
    const st = document.createElement("style");
    st.id = "amMmrFavStyle";
    // 결·색은 증바람MMR 조회 판(amMmrStyle)의 토큰 그대로. ⚠️ 사이트 기본 버튼 규칙이 더 세다 — 글자색은 !important(조회 판과 같은 이유).
    st.textContent = `
      .am-fav{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:-2px 0 12px}
      .am-fav[hidden]{display:none !important}
      .am-fav__label{display:inline-flex;align-items:center;gap:5px;margin-right:3px;font-size:12.5px;font-weight:700;color:var(--muted,#8d99ad)}
      .am-fav__label svg{width:14px;height:14px;fill:var(--accent,#a78bfa)}
      .am-fav__chip{display:inline-flex;align-items:center;height:30px;border-radius:9px;overflow:hidden;
        border:1px solid var(--line,rgba(148,163,184,.10));background:var(--bg-deep,#04060b);transition:border-color .12s ease}
      .am-fav__chip:hover{border-color:var(--accent-line,rgba(167,139,250,.32))}
      .am-mmr .am-fav__go,.am-mmr .am-fav__x{height:100%;min-height:0;margin:0;border:0;border-radius:0;background:none;box-shadow:none;
        cursor:pointer;font:inherit;line-height:1}
      .am-mmr .am-fav__go{padding:0 3px 0 11px;font-size:13px;font-weight:700;color:var(--text,#eef3fa) !important}
      .am-fav__go i{font-style:normal;font-weight:600;color:var(--faint,#76829b)}
      .am-mmr .am-fav__x{width:26px;padding:0;font-size:15px;color:var(--faint,#76829b) !important}
      .am-mmr .am-fav__x:hover{color:var(--text,#eef3fa) !important}
      .am-mmr .am-fav__all{height:30px;min-height:0;margin:0 0 0 2px;padding:0 12px;border-radius:9px;cursor:pointer;box-shadow:none;
        font:inherit;font-size:12.5px;font-weight:700;line-height:1;border:1px solid var(--accent-line,rgba(167,139,250,.32));
        background:var(--accent-soft,rgba(167,139,250,.12));color:var(--accent,#a78bfa) !important;transition:filter .12s ease}
      .am-mmr .am-fav__all:hover{filter:brightness(1.15)}
      .am-mmr .am-fav__star{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;min-height:0;
        margin:0 6px 0 -4px;padding:0;border:0;border-radius:6px;background:none;box-shadow:none;cursor:pointer;vertical-align:-5px;
        color:var(--faint,#76829b) !important;transition:color .12s ease}
      .am-mmr .am-fav__star:hover{color:var(--text,#eef3fa) !important}
      .am-mmr .am-fav__star.is-on{color:var(--accent,#a78bfa) !important}
      .am-fav__sp{display:inline-block;width:22px;height:1px;margin:0 6px 0 -4px;vertical-align:middle}
      .am-fav__star svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round}
      .am-fav__star.is-on svg{fill:currentColor}`;
    document.head.appendChild(st);
  }
  paint();
})();

/* ★2026-09-23 【증바람MMR 조회 — 채팅을 긁어 붙여도 닉네임#태그만 골라 찾는다(다중 검색)】 운영자 지시 그대로:
   "사람들이 채팅에서 닉네임을 긁어다가 쓰는 경우가 많아서 ... op.gg에서도 채택했던 ... 다중 검색인데, 예를 들면
    'aaa#bbb 님이 로비에 참가하셨습니다. / bbb#ccc 님이 로비에 참가하셨습니다.' 같은 패턴을 그냥 복사 붙여넣기만 해도
    긁은 데에서 닉네임과 해시태그를 알아서 검색하는 기능 ... 뒤에 님이 로비에 참가하셨습니다. 같은걸 날리고 검색하는 기능 ...
    즐겨찾기와 더불어 이것도 가능하게 만들어"
   무엇: 줄마다 첫 '#' 앞은 닉네임(띄어쓰기 그대로), 뒤는 태그로 읽고, 태그 뒤의 "님이 로비에 참가하셨습니다." 같은 꼬리
     (님이…·님께서…·: 대화·joined/left the lobby·문장부호)는 버린다. 줄 앞의 [시각]·[팀] 같은 대괄호도 버린다. 같은 사람은 한 번만.
     붙여넣는 순간 조회칸이 "닉네임#태그" 줄로 정리되고, 로비 알림 같은 꼬리가 붙은 채로 붙여넣었으면 바로 조회까지 한다.
     '점수 보기' 로 조회할 때도 같은 정리를 먼저 한다(끌어다 놓기 등 붙여넣기 밖으로 들어온 글자도).
   ⚠️ '#' 가 없는 줄은 그대로 둔다 — 종전처럼 "태그까지 적어주세요" 로 알려 준다(이름만으로 찾는 대체는 만들지 않는다).
   ⚠️ 찾는 규칙(열쇠: NFC·소문자·공백 제거, 태그까지 정확히)은 그대로다. 글자를 정리만 한다. */
(function amMmrPasteParse() {
  "use strict";
  if (window.__amMmrPasteInstalled) return;
  window.__amMmrPasteInstalled = true;
  const nk = s => String(s || "").normalize("NFC").replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "").toLowerCase().replace(/\s+/g, "");
  // 태그 뒤에 붙는 꼬리 — 로비·방 알림(한국어), 대화 쌍점, 영어 알림. 태그를 자르는 기준만 된다(버리는 글자).
  const TAIL_KO = /\s*님(?:이|께서)(?:\s|$)/;
  const TAG_STOP = /[\s.,:;()\[\]{}<>!?"'`~|/\\]/;
  function extractLine(line0) {
    /* ★2026-09-25 운영자 신고 — 로비 채팅을 긁어 붙이면 전원이 "아직 집계되지 않았습니다" 였다.
       롤 클라이언트 채팅은 이름과 태그를 보이지 않는 방향 표시 문자로 감싼다: ⁦⁦이름⁩ #⁦태그⁩⁩ (U+2066 · U+2069).
       종전엔 폭 없는 공백(U+200B~200D · U+FEFF)만 지워서 그 문자가 이름·태그에 남아 열쇠가 어긋났다.
       서식 문자(방향 표시 · 폭 없는 공백 · 소프트 하이픈 등)를 전부 지운다 — 게시된 조회표 열쇠 1,229,898개 중 이런 문자가 든 것 0개. */
    let line = String(line0 || "").normalize("NFC").replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, "").trim();
    if (!line) return { id: "", tail: false };
    line = line.replace(/^(?:\s*[\[(【][^\])】]{0,24}[\])】]\s*)+/, "");   // 줄 앞 [오후 3:05] · [팀] · (전체) 같은 것
    const hash = line.indexOf("#");
    if (hash < 1) return { id: line, tail: false };                          // '#' 가 없거나 이름이 없다 — 손대지 않는다
    const name = line.slice(0, hash).trim();
    let rest = line.slice(hash + 1);
    let tail = false;
    const ko = rest.search(TAIL_KO);
    if (ko >= 0) { rest = rest.slice(0, ko); tail = true; }
    let tag = "";
    for (const ch of rest) { if (TAG_STOP.test(ch) || ch === "#") break; tag += ch; }
    if (rest.length > tag.length && /\S/.test(rest.slice(tag.length))) tail = true;   // 태그 뒤에 글자가 더 있었다(대화·영어 알림 등)
    if (!name || !tag || name.length > 32 || tag.length > 8) return { id: line, tail: false };
    return { id: `${name}#${tag}`, tail };
  }
  function extractAll(text) {
    // 줄로 나누고, 한 줄이 "aaa#bbb, ccc#ddd" 처럼 쉼표로 이은 목록이면(조각마다 '#') 그때만 쉼표로 더 나눈다.
    //   대화 줄("aaa#bbb: 안녕, 반가워")의 쉼표는 나누지 않는다.
    const pieces = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const parts = line.split(",");
      if (parts.length > 1 && parts.every(p => p.includes("#"))) pieces.push(...parts); else pieces.push(line);
    }
    const found = pieces.map(extractLine).filter(r => r.id);
    const tails = found.filter(r => r.tail).length;
    // 채팅을 긁어 온 것(꼬리가 하나라도 있었다)이면 '#' 없는 줄은 이름이 아닌 알림·대화다 — 버린다.
    const keep = tails > 0 ? found.filter(r => r.id.indexOf("#") >= 1) : found;
    const out = [], seen = new Set();
    for (const r of keep) {
      const k = r.id.indexOf("#") >= 1 ? nk(r.id) : "raw:" + r.id;
      if (seen.has(k)) continue;
      seen.add(k); out.push(r.id);
    }
    return { lines: out, tails };
  }
  // 조회칸 글자를 정리해 넣는다. 바뀐 게 있으면 true.
  function tidyBox(box) {
    const r = extractAll(box.value);
    const next = r.lines.join("\n");
    if (next === box.value) return { tidied: false, tails: r.tails, n: r.lines.length };
    box.value = next;
    return { tidied: true, tails: r.tails, n: r.lines.length };
  }
  window.amMmrExtractIds = text => extractAll(text).lines;   // 확인·시험용
  /* ① 붙여넣기(Ctrl+V)는 그냥 붙여넣기다 — 정리도 조회도 안 한다.
     ★2026-09-25 운영자: "왜 ctrl v를 누르면 자동으로 아직 조회창 내용을 내가 수정을 안했는데 니 마음대로 점수보기가 되어버리고 불편하게 만들어놨냐?
       … 내가 수정하던 내용을 뒤를 니마음대로 기준삼아 잘라버리던데. 이 불편한 버그도 고쳐라"
     종전(09-23~): 붙여넣는 순간 칸 전체를 추려 다시 쓰고(고치던 줄까지 잘림) 커서를 끝으로 보냈고, 로비 알림 꼬리가 있으면 곧바로 조회했다.
     로비 채팅 추려 내기는 '점수 보기'를 누를 때(아래 ②)만 한다. 붙여넣기 때 다시 정리·조회를 붙이지 마라. */
  // ② '점수 보기' 로 조회할 때 먼저 정리한다 — 조회 함수를 감싸기만 한다(안의 규칙은 그대로).
  function wrap() {
    const orig = window.amMmrSearch;
    if (typeof orig !== "function" || orig.__amTidy) return;
    const wrapped = function () {
      const box = document.getElementById("amMmrNames");
      if (box) tidyBox(box);
      return orig.apply(this, arguments);
    };
    wrapped.__amTidy = true;
    window.amMmrSearch = wrapped;
  }
  wrap();
  /* ③ 조회칸 배경 안내 글자에 "로비 채팅을 붙여넣어도 된다" 를 보인다 — ★2026-09-23 운영자:
     "다중검색에 대한 내용이 뒷 배경 설명에 안나와있어서 사람들이 지원하는지 모를 것 같아. 로비에 참가하셨습니다 그 패턴같은게
      가능하다는 조회창 내 설명이 사이트와 분석기 모두에 반영이 안되어있을것 같아"
     첫 줄은 운영자 문장 그대로 두고 한 줄 + 로비 알림 예시를 더한다. 칸 높이(142px)에 5줄까지 보이므로 5줄 안에 맞춘다. */
  const HINT = "닉네임을 한줄에 하나씩 태그까지 적어주세요.(띄어쓰기 포함)\n로비 채팅을 복사해 그대로 붙여넣어도 됩니다.\n예)\naaa#bbb\nbbb#ccc 님이 로비에 참가하셨습니다.";
  function hint() { const box = document.getElementById("amMmrNames"); if (box && box.placeholder !== HINT) box.placeholder = HINT; }
  hint();
  // app_v2.js 가 나중에 조회 함수를 다시 걸 수도 있다 — 조회 화면이 그려질 때마다 한 번 더 감싼다(이미 감쌌으면 그대로). 안내 글자도 같이.
  let q = 0;
  new MutationObserver(() => { if (q) return; q = setTimeout(() => { q = 0; wrap(); hint(); }, 50); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
/* === am-mmr-fav:end === */


(function(){
  var demoBtn = document.getElementById("load-demo");
  if (demoBtn) {
    demoBtn.addEventListener("click", function() {
      demoBtn.disabled = true;
      demoBtn.textContent = "데모 불러오는 중…";
      fetch("/api/me?mock=1").then(function(r){ return r.json(); }).then(function(j){
        // Trigger global loadMe replacement if possible or dispatch custom event
        window.dispatchEvent(new CustomEvent("am:demo-loaded", { detail: j }));
      }).finally(function(){
        demoBtn.disabled = false;
        demoBtn.textContent = "데모 전적 체험";
      });
    });
  }
})();
