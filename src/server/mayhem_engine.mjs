// 칼바람 컴패니언 로컬 서버 — 더블클릭 런처가 이걸 띄우고 브라우저를 연다.
//  /api/me      = 내 LCU 개인기록(일반·증강). Riot API키 0.
//  /api/champs  = aram-mayhem 집계 메타(모드별).
import http from "node:http";
import https from "node:https";
import os from "node:os";
import zlib from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync, readdirSync, renameSync } from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { getRecords, personalChampBuild, augmentMetaFromTeams, augmentAugmentMeta, augmentItemAgg, augmentRarityMap, EXCLUDE_ITEM, captureAndUploadAugments, captureAugmentContributions, captureStandardTeams, matchTeamRows, personalAnalysis, ingameGameflowPhase, ingameChampSelect, ingameBenchSwap, ingameSetRunes, ingameLiveGame, ingameQueue, sendHeartbeat, uploadRosterNow } from "./lcu_personal.mjs";

// 옵트인(설정 ON) 시 내 증강(2400/KIWI 시즌2) 전적을 익명으로 메타 통계에 기여. UI 비차단(백그라운드)·5분 throttle·중복실행 금지.
//   ⚠️ 캡처+익명화+업로드 전부 lcu_personal.mjs 안에 인라인(소프트업데이트가 받는 파일이라야 설치된 앱이 자동 적용됨).
// ─── 2026-07-24 근본수정: 인게임 프리징의 정체 ──────────────────────────────────────────────
//   증상(사용자 신고): 게임마다 **인게임 6분 30초 전후 30초 이내**에 프리징 수준의 렉이 한 번 확 온다. 항상.
//   기전(코드로 추적 완료):
//     public/index.html:4191  setInterval(autoRefresh, 180000)   ← 3분마다
//       autoRefresh → loadMe() → GET /api/me
//         server.mjs:/api/me → maybeCaptureStdfullLocal() + maybeContributeAugments()
//           → captureStandardTeams / captureAndUploadAugments
//             → getMatches(lcu, scan) + 상세 fetch 최대 60~240건 = **롤 클라이언트에 대량 조회**
//   왜 하필 6분대인가: 킥들은 5분 쿨다운이라 3분 타이머와 맞물려 발화가 0분·6분·12분이 된다.
//   게임을 시작하면 앱→게임으로 포커스가 넘어가며 visibilitychange/focus 가 refreshOnReturn(:4192)을
//   태워 그 시점에 쿨다운이 리셋된다 → **게임 시작 기준 6분**에 정확히 터진다. 신고 시각과 일치.
//   → 세 킥 전부 "게임 밖일 때만" 으로 막는다. 게임 중엔 어차피 캡처할 새 매치가 없다(현재 판은 아직
//     히스토리에 없다) → 데이터 손실 0, 순수 이득.
//   ⚠️ 쿨다운은 **실제로 돌 때만** 소모한다. 게임 중 스킵에 쿨다운을 태우면 게임 끝나고도 5분을 더 기다린다.
//   ⚠️ 게이트 판정 자체(gameflow-phase)는 문자열 하나 받는 초경량 호출이라 3분마다 해도 부하가 없다.
//   ⚠️ 되돌리기: 각 킥의 `if (!(await outOfGameNow())) return;` 한 줄씩 제거.
const CONTRIB_SAFE_PHASES = new Set(["Off", "None", "Lobby", "EndOfGame", "PreEndOfGame", "WaitingForStats", "TerminatedInError"]);
async function outOfGameNow() {
  try {
    const phase = String(await ingameGameflowPhase() || "");
    return CONTRIB_SAFE_PHASES.has(phase);   // 모르는 phase 는 '게임 중'으로 본다(안전한 쪽으로 실패)
  } catch { return false; }
}
let _contribAt = 0, _contribBusy = false;
function maybeContributeAugments() {
  const now = Date.now();
  if (_contribBusy || now - _contribAt < 5 * 60 * 1000) return;
  _contribBusy = true;
  (async () => {
    try {
      if (!(await outOfGameNow())) return;   // 인게임 → 아무것도 안 한다(쿨다운도 안 태운다)
      _contribAt = Date.now();
      try { await captureAndUploadAugments({ maxDetail: 120 }); }
      catch {}
      // ★2026-09-26 판을 불러온 계정·같이 뛴 사람(긁기 1·2순위) — 같은 동의·같은 게임 밖 조건 안에서만. 설치 번호는 안 싣는다(lcu_personal uploadRoster 주석).
      try { await uploadRosterNow(); }
      catch {}
      // 클래식 스타일(2450) — 증바람과 캐시·큐가 완전히 분리된 별도 호출. 한쪽이 실패해도 다른 쪽은 계속 간다.
      try { await captureAndUploadAugments({ queueId: 2450, maxDetail: 120 }); }
      catch {}
    } finally { _contribBusy = false; }
  })();
}
// ─── 2026-07-23 근본수정: 기여 업로드가 "전적 화면을 열 때" 에만 걸려 있었다 ────────────────────
//   실측 근거: maybeContributeAugments 의 호출부가 전 코드베이스에서 /api/me 핸들러(아래 :2268) **한 곳뿐**이고,
//   server.mjs 에 주기 타이머(setInterval)가 하나도 없었다. 즉 게임을 아무리 해도 사용자가 앱에서 전적 화면을
//   불러오지 않으면 인제스트 워커로 요청 자체가 가지 않는다.
//   그 결과가 워커 수신 로그의 톱니 모양이다 — 누가 앱을 열면 밀린 게 한꺼번에(96·126·160·243건) 올라가고
//   그 뒤론 0 이 된다(실측 D1 ingested_at 시간대별, 2026-07-21~23). 유저 수가 늘어도 총량이 안 느는 이유가 이것이다.
//   → 앱이 떠 있는 동안 주기적으로도 킥한다. 게이트는 그대로다:
//      · 동의(st.consent) + contribute≠off 인 사용자만 (동의 안 한 사용자는 전과 100% 동일하게 아무것도 안 보냄)
//      · maybeContributeAugments 내부의 5분 throttle·중복실행 금지 그대로 → 호출 빈도가 늘어도 실제 작업량은 안 늘어난다
//      · 새 게임이 없으면 uploadContributions 의 fresh 가 0 이라 네트워크 요청도 안 나간다(무부하)
//   ⚠️ 되돌리기: 아래 블록 삭제. 그러면 다시 전적 화면을 열 때만 올라간다.
//
// ⚠️⚠️ 2026-07-23 (사용자 지적 반영): 게임 도중에는 **절대 돌지 않는다**.
//   업로드 경로는 captureAugmentContributions → getMatches(lcu, 600) 로 LCU 에 최근 600판 목록을 조회한다.
//   그건 롤 클라이언트에 붙는 로컬 API 호출이라, 인게임 중에 돌면 사용자에게 히칭을 줄 수 있다.
//   → gameflow phase 를 보고 "게임 밖" 일 때만 킥한다. 허용 목록(allowlist)으로 판정해서,
//     모르는 phase 가 새로 생겨도 기본이 '안 돈다' 가 되게 한다(안전한 쪽으로 실패).
//   ⚠️ 그리고 사용자 요구대로 **앱을 켤 때 1회** 도 올린다(그게 없었다 — 여태 전적 화면을 열어야만 올라갔다).
//     켤 때 1회 + 게임 밖 5분 주기 = 게임 중 부하 0, 밀린 전적은 앱만 켜두면 알아서 나간다.
const CONTRIB_TICK_MS = 5 * 60 * 1000;
// ⚠️ 2026-07-24: phase 게이트(CONTRIB_SAFE_PHASES/outOfGameNow)는 킥 함수 **안쪽**으로 옮겼다.
//   이유: /api/me 경로가 maybeContributeAugments 를 직접 부르는데 여기서만 막으면 그 경로가 무방비였고,
//   실제로 그 경로가 인게임 6분대 프리징의 발화점이었다. 이제 어느 경로로 들어와도 게임 중엔 안 돈다.
//   여기 남는 건 동의 게이트뿐이다(중복 선언 제거).
function contributeIfOutOfGame(reason) {
  try {
    const st = readSettings();
    if (!st || !st.consent || st.contribute === "off") return;   // 동의 게이트 — 종전과 동일
    maybeContributeAugments();                                    // 인게임 판정·5분 throttle 은 이 함수 내부가 담당
  } catch {}
}
// Web/serverless mode: background desktop timers disabled.
// 개인분석용 로컬 캡처 킥 — captureAugmentContributions는 augfull 캐시(이 PC 디스크)만 채우고 업로드하지 않는다.
//   기여(업로드)는 별도 동의 게이트(maybeContributeAugments) 그대로 — 분석은 자기 LCU 데이터를 자기 PC에서 보는 것이라 동의 무관.
let _augfullBusy = false, _augfullAt = 0;
function maybeCaptureAugfullLocal() {
  const now = Date.now();
  if (_augfullBusy || _contribBusy || now - _augfullAt < 5 * 60 * 1000) return; // 기여 캡처 중이면 중복 fetch 방지(같은 캐시 사용)
  _augfullBusy = true;
  (async () => {
    try {
      if (!(await outOfGameNow())) return;   // 2026-07-24 인게임 프리징 차단(위 주석 참조) — 쿨다운도 안 태운다
      _augfullAt = Date.now();
      try { await captureAugmentContributions({ maxDetail: 120 }); }
      catch {}
      try { await captureAugmentContributions({ queueId: 2450, maxDetail: 120 }); } // 클래식(2450)은 classicfull 캐시로 따로 쌓인다
      catch {}
    } finally { _augfullBusy = false; }
  })();
}
// 일반(450) 아군/상대 분석용 팀 구성 캡처 킥 — augfull과 같은 방식이되 stdfull 캐시(로컬 전용·업로드 경로 없음).
//   ⚠️ LCU 목록엔 내 참가자밖에 없어(실측: dmgShare 495행 전부 100.0%) 아군/상대는 상세 fetch가 유일한 경로다.
//   유휴 양보: 1회 60개 상한 + 5분 쿨다운 + 증분(이미 받은 게임 스킵) → 첫 실행만 여러 개, 이후 0~수개.
let _stdfullBusy = false, _stdfullAt = 0;
function maybeCaptureStdfullLocal() {
  const now = Date.now();
  if (_stdfullBusy || now - _stdfullAt < 5 * 60 * 1000) return;
  _stdfullBusy = true;
  (async () => {
    try {
      if (!(await outOfGameNow())) return;   // 2026-07-24 인게임 프리징 차단(위 주석 참조) — 쿨다운도 안 태운다
      _stdfullAt = Date.now();
      try { await captureStandardTeams({ maxDetail: 60 }); }
      catch {}
    } finally { _stdfullBusy = false; }
  })();
}
const isExcludedItem = v => EXCLUDE_ITEM.has(Number(v)) || EXCLUDE_ITEM.has(Number(v) % 10000); // 소모품·부품·영약 비표시(baseId로 증강 변종도)
const REMOVED_ARAM_ITEM_NAMES = new Set(["\uAE30\uD68C", "\uC694\uC0C8\uD30C\uAD34\uC790", "hubris", "fortress breaker", "\uC5B5\uAC81\uC758 \uCE74\uD0C8\uB9AC\uC2A4\uD2B8", "\uC5B5\uAC81\uC758\uCE74\uD0C8\uB9AC\uC2A4\uD2B8", "catalyst of aeons", "catalystofaeons"]); // \uC5B5\uAC81\uC758 \uCE74\uD0C8\uB9AC\uC2A4\uD2B8=\uBD80\uD488(\uCD5C\uC885\uC544\uC774\uD15C \uC544\uB2D8)\u2192\uD2F0\uC5B4\uB9AC\uC2A4\uD2B8 \uC81C\uC678. \u26A0\uFE0F\uCCB4\uACC4\uC801 \uBD80\uD488 \uC804\uC218\uC81C\uC678\uB294 ddragon into/depth \uB370\uC774\uD130 \uD544\uC694(\uD6C4\uC18D)
const itemIdFromKey = raw => {
  const m = /(\d+)\s*$/.exec(String(raw ?? ""));
  return m ? Number(m[1]) : 0;
};
function isRemovedAramItem(id, name = "", key = "") {
  const numeric = Number(id || itemIdFromKey(key) || 0);
  if (numeric && isExcludedItem(numeric)) return true;
  return REMOVED_ARAM_ITEM_NAMES.has(norm(name));
}
function rowHasRemovedAramItem(row, context = "") {
  if (!row || typeof row !== "object") return false;
  const ctx = String(context || "");
  const itemContext = /item/i.test(ctx) || row.type === "item" || row.kind === "item";
  const checkObject = obj => obj && typeof obj === "object" && isRemovedAramItem(
    obj.id ?? obj.itemId,
    obj.localName || obj.name || obj.itemName || obj.label || obj.displayName || "",
    obj.key ?? obj.itemKey
  );
  if (itemContext && isRemovedAramItem(row.itemId ?? row.id, row.localName || row.name || row.itemName || "", row.itemKey ?? row.key)) return true;
  for (const key of ["item", "primaryItem", "secondaryItem", "leftItem", "rightItem"]) {
    if (checkObject(row[key])) return true;
  }
  if (Array.isArray(row.items) && row.items.some(v => typeof v === "object" ? checkObject(v) : isRemovedAramItem(v))) return true;
  for (const key of ["itemKey", "key"]) {
    const value = String(row[key] || "");
    if (value.includes("item:") && value.split("|").some(part => /^item:(\d+)/.test(part) && isRemovedAramItem(itemIdFromKey(part)))) return true;
  }
  if (String(row.leftKind || "") === "item" && isRemovedAramItem(row.leftId, row.leftLabel || "", row.leftKey)) return true;
  if (String(row.rightKind || "") === "item" && isRemovedAramItem(row.rightId, row.rightLabel || "", row.rightKey)) return true;
  return false;
}
// 표본보정 백분위 티어(1~5) 부여 — augmentMetaFromTeams와 동일 산식. 라이브 메타에 티어 붙일 때 공용.
function withTiers(list) {
  const ranked = list.map(c => ({ c, s: ((c.winRate || 0) / 100 * (c.games || 0) + 10) / ((c.games || 0) + 20) })).sort((a, b) => b.s - a.s);
  ranked.forEach((o, i) => { const p = ranked.length ? i / ranked.length : 1; o.c.tier = p < 0.06 ? 1 : p < 0.30 ? 2 : p < 0.72 ? 3 : p < 0.96 ? 4 : 5; });
  return list;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REL_DIR = path.resolve(__dirname, "../../aram_mayhem_auto/data/pages_site/static/api");
const ABS_DIR = "E:\\프린서버\\plugins\\Skript\\scripts\\aram_mayhem_auto\\data\\pages_site\\static\\api"; // 설치본 폴백(상대경로 깨질 때)
const API_DIR = process.env.MAYHEM_API_DIR || (existsSync(REL_DIR) ? REL_DIR : ABS_DIR);
const PORT = Number(process.env.MAYHEM_COMPANION_PORT || 8900);
const cache = {};
const norm = s => String(s || "").normalize("NFKC").trim().toLowerCase();
const GROUP_KO = { fighter: "전사", mage: "마법사", marksman: "원거리", assassin: "암살자", tank: "탱커", support: "유틸", slayer: "척결자", controller: "제어", specialist: "전문가" };
const AUG_RARITY_KO = { prismatic: "프리즘", gold: "골드", silver: "실버" };
// 스탯 파편 아이콘 — championAugment·augmentRows 둘 다 빈값이라 ddragon StatMods로 id 매핑(전부 200 확인)
const SHARD_ICON = { 5008: "StatModsAdaptiveForceIcon", 5005: "StatModsAttackSpeedIcon", 5007: "StatModsCDRScalingIcon", 5010: "StatModsMovementSpeedIcon", 5013: "StatModsTenacityIcon", 5001: "StatModsHealthScalingIcon", 5011: "StatModsHealthPlusIcon" };
const shardIcon = id => SHARD_ICON[Number(id)] ? `https://ddragon.leagueoflegends.com/cdn/img/perk-images/StatMods/${SHARD_ICON[Number(id)]}.png` : "";
const adjPct = (w, g) => Math.round((g ? (w + 10) / (g + 20) : 0.5) * 100); // 표본보정(소표본 50%수축)
// 상대법 강/약 분류·정렬 단일규칙: 보정승률(adjWinRate, 데이터 제공 소표본 수축)로 강약 분류, 신뢰가중 점수(편차×표본비중)로 정렬.
//   → 2~3판 100% 플루크가 "강한 상대" 헤드라인을 점유 못 함. 표시 winRate는 raw+판수 유지(정직). 기존 winRate-desc 정렬이 소표본을 최상위에 올리던 것 교정.
function _counterSplit(all) {
  const K = 6, av = x => Number(x.adj != null ? x.adj : x.winRate) || 0, dev = x => (av(x) - 50) * (x.games / (x.games + K));
  return {
    strong: all.filter(x => av(x) >= 50).sort((a, b) => dev(b) - dev(a)).slice(0, 8),
    weak: all.filter(x => av(x) < 50).sort((a, b) => dev(a) - dev(b)).slice(0, 8)
  };
}

// ── 아이콘 프록시 — Electron 렌더러가 외부 https 이미지를 못 띄우는 문제 우회. 서버가 받아 localhost로 내줌(+디스크캐시). ──
const ICON_HOSTS = new Set(["ddragon.leagueoflegends.com", "opgg-static.akamaized.net", "raw.communitydragon.org", "cdn.communitydragon.org"]); // metasrc는 403(핫링크차단)이라 제외 — 대신 augmentCombos가 번들 communitydragon 아이콘으로 폴백
// ★2026-07-22: 캐시를 os.tmpdir() 에 두면 윈도 디스크 정리·PC 클리너가 지운다 → 그 유저는 매 실행이 콜드(수십 MB 재다운로드).
//   런타임 코드 캐시는 이미 userData 를 쓰고 있었다(runtime_sync). main.cjs 가 MAYHEM_CACHE_DIR 로 같은 곳을 넘겨준다.
const CACHE_ROOT = process.env.MAYHEM_CACHE_DIR || os.tmpdir();
const ICON_DIR = path.join(CACHE_ROOT, "aram-mayhem-icons");
try { mkdirSync(ICON_DIR, { recursive: true }); } catch {}
const imgMem = new Map();
const diskKey = url => path.join(ICON_DIR, url.replace(/[^a-z0-9]/gi, "_").slice(-140) + ".png");
// ⚠️ 파일 하나가 18.6MB(standard-aram-cohort-all.json)다. 45초로는 조금만 느린 회선에서
//   못 받고, 못 받으면 화면이 조용히 "표본 부족"으로 뜬다(내 PC 는 로컬 파일을 읽어 이 문제를
//   영영 못 겪는다 — 다른 PC 에서만 나는 증상의 정체였다). 큰 파일 기준으로 넉넉히 잡는다.
const FETCH_BUDGET_MS = 180000; // 원격 1건의 총 소요 상한. node 의 timeout 은 '무통신'만 재므로 이게 없으면 상한이 사실상 없다.
function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, r => {
      if (r.statusCode !== 200) { clearTimeout(budget); r.resume(); return reject(new Error("status " + r.statusCode)); }
      const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => { clearTimeout(budget); resolve(Buffer.concat(ch)); });
    });
    const budget = setTimeout(() => req.destroy(new Error("budget")), FETCH_BUDGET_MS);
    req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", e => { clearTimeout(budget); reject(e); });
  });
}
// ★서버는 Electron **메인 프로세스** 안에서 돈다 = 창의 UI 스레드다. 여기서 동기 I/O 를 하면 그 시간만큼 창이 굳는다.
//   표 한 화면에 아이콘 수백 개가 붙으므로 디스크 읽기는 비동기로.
async function getIcon(url) {
  if (imgMem.has(url)) return imgMem.get(url);
  const f = diskKey(url);
  let buf = null; try { buf = await readFile(f); } catch {}
  if (!buf) { buf = await fetchBuf(url); try { writeFileSync(f, buf); } catch {} }
  imgMem.set(url, buf); return buf;
}
// ── 메타 데이터 원격화 — 어느 PC에서든 aram-mayhem.com 게시본을 받아 사이트와 일치(사이트 갱신 시 자동 반영). ──
//    조건부 GET(ETag)으로 변경분만 받고, 실패 시 디스크캐시→로컬파일 순 폴백(오프라인/메인PC 동작).
const DATA_BASE = process.env.MAYHEM_DATA_BASE || "https://aram-mayhem.com/static/api";
const R2_BASE = process.env.MAYHEM_R2_BASE || "https://pub-05f47b0b01de41feaa96c0efaedde627.r2.dev"; // 컴패니언 전용 번들 호스팅(사이트 25MB 제한 회피)
// 링크 공유(/api/share) — 브라우저 CORS 우회: 클라 PNG를 여기(로컬 서버)서 ingest 워커 /share로 전달, 공개 URL 반환. 토큰은 서버측 보관.
const SHARE_ENDPOINT = process.env.MAYHEM_INGEST_URL || "https://aram-mayhem-ingest.xhunt79.workers.dev";
const SHARE_TOKEN = process.env.MAYHEM_INGEST_TOKEN || "amx_contrib_9f3a7b2e6d14";
const MAX_SHARE_BYTES = 5_000_000;
const FILE_BASE = { "companion-augment-meta.json": R2_BASE }; // 증강 메타 번들은 R2에서(사이트엔 미배포). 표준·콤보는 DATA_BASE(사이트, 자동동기화)
const DATA_DIR = path.join(CACHE_ROOT, "aram-mayhem-data");
try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
// #21 origin 독립 설정 저장 — main.cjs가 startServer(0)=매 실행 랜덤 포트라 origin(127.0.0.1:port)이 바뀌어
//   localStorage가 재시작마다 초기화됨(설정 무의미). 홈 디렉터리 고정 파일에 저장해 포트·재시작과 무관하게 유지.
const SETTINGS_FILE = path.join(os.tmpdir(), "aram-mayhem-companion", "settings.json");
function readSettings() { try { return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) || {}; } catch { return {}; } }
function writeSettings(s) { try { mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); writeFileSync(SETTINGS_FILE, JSON.stringify(s)); return true; } catch { return false; } }
const dataMem = {};
const dataStatus = {};
const dataDisk = file => path.join(DATA_DIR, file.replace(/[^a-z0-9._-]/gi, "_"));
const TTL_MS = 5 * 60 * 1000; // 디스크캐시 신선도 — 이 안엔 네트워크 생략(잦은 재실행 시 대용량 재다운 방지). 한 세션 내엔 dataMem로 1회만 fetch.
// ★전송압축(2026-07-21): node의 https.get은 Accept-Encoding을 **안 붙인다** → Cloudflare가 원문 그대로 보낸다.
//   풀파일은 10~19MB JSON이라 로컬 데이터가 없는 설치 유저는 이걸 압축 없이 받고 있었다(일반모드 첫 화면 ~107MB).
//   br/gzip을 요청하고 여기서 풀면 같은 데이터가 대략 1/8~1/12로 줄어든다. 캐시·ETag·폴백 경로는 그대로.
function fetchData(url, cond) {
  return new Promise((resolve, reject) => {
    const headers = { "Accept-Encoding": "br, gzip, deflate" };
    if (cond && cond.etag) headers["If-None-Match"] = cond.etag;
    if (cond && cond.lastModified) headers["If-Modified-Since"] = cond.lastModified;
    // ★총 예산(2026-07-22): node 의 timeout 은 '무통신' 타이머다. 초당 몇 KB 씩이라도 흘러오면 영원히 발화하지 않는다.
    //   백신 HTTPS 검사·프록시·느린 회선에서 한 파일이 몇 분씩 매달려도 여기서 끊기지 않아 화면이 무한 대기했다.
    //   예산을 넘기면 destroy → reject → 기존 디스크캐시/로컬 폴백 경로가 그대로 탄다(데이터는 안 잃는다).
    const req = https.get(url, { headers, timeout: 15000 }, r => {
      if (r.statusCode === 304) { clearTimeout(budget); r.resume(); return resolve({ notModified: true }); }
      if (r.statusCode !== 200) { clearTimeout(budget); r.resume(); return reject(new Error("status " + r.statusCode)); }
      const enc = String(r.headers["content-encoding"] || "").toLowerCase();
      const dec = enc === "br" ? zlib.createBrotliDecompress() : enc === "gzip" ? zlib.createGunzip() : enc === "deflate" ? zlib.createInflate() : null;
      const src = dec ? r.pipe(dec) : r;
      if (dec) dec.on("error", e => { clearTimeout(budget); reject(e); }); // 손상 스트림 → reject → 디스크캐시/로컬 폴백(기존 경로)
      const ch = []; src.on("data", c => ch.push(c)); src.on("end", () => { clearTimeout(budget); resolve({ body: Buffer.concat(ch).toString("utf8"), etag: r.headers.etag || "", lastModified: r.headers["last-modified"] || "" }); }); // Buffer 연결 후 UTF-8 디코드 — 문자열 += 는 멀티바이트 한글을 청크경계서 □□로 깨뜨림
    });
    const budget = setTimeout(() => req.destroy(new Error("budget")), FETCH_BUDGET_MS);
    req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", e => { clearTimeout(budget); reject(e); }); // idle 타임아웃 → 캐시/로컬 폴백
  });
}
const parseJson = t => { try { return (t && t[0] !== "<" && t.indexOf("�") < 0) ? JSON.parse(t) : null; } catch { return null; } }; // SPA폴백 HTML 거부 + U+FFFD(인코딩 손상) 거부 → 손상 캐시 자가치유
// ★2026-09-25 방금 받은 본문에는 U+FFFD 거부를 걸지 않는다. 그 거부는 옛 청크 디코딩이 깨뜨린 **디스크 사본**을 버리려는 것인데,
//   받은 본문(Buffer 연결 후 디코드)에 그 글자가 있으면 사이트 파일 자체에 들어 있는 것이다 — 버려도 더 나은 사본이 없어서
//   원격·디스크·로컬 셋 다 거부 → "데이터를 받을 수 없음" → 설치 유저 전원의 상세가 500 이 된다(사이트 화면은 멀쩡한데).
const parseJsonRemote = t => { try { return (t && t[0] !== "<") ? JSON.parse(t) : null; } catch { return null; } };
// ★동시요청 합류(2026-07-21): 프론트가 부팅 때 20여 개 /api 를 동시에 쏘는데, 그 중 여럿이 같은 파일을 필요로 한다.
//   합류가 없으면 같은 10~19MB 파일을 N번 동시에 내려받아(로컬 데이터 없는 유저) 회선을 스스로 나눠 먹었다.
//   같은 파일에 대한 진행 중 로드가 있으면 그 프라미스에 붙는다.
const dataInflight = new Map();
// ★메모리 상한: dataMem 은 만료만 있고 축출이 없어, 표·상세를 눌러 다닐수록 파싱된 풀이 힙에 계속 쌓였다.
//   19MB JSON 하나가 힙에선 수백 MB다 → 몇 개 쌓이면 V8이 풀GC를 반복하며 프로세스 전체가 초 단위로 멈춘다
//   (개인 증강쌍처럼 큰 풀을 뒤늦게 누를 때 '응답 없음'으로 나타남). 예산 초과 시 오래 안 쓴 것부터 버린다.
const DATA_MEM_BUDGET = 120 * 1024 * 1024; // 원문 바이트 기준 합계. 파싱된 객체는 원문의 5~10배라 이 값이 곧 힙 상한 역할을 한다.
//   축출돼도 원본은 디스크 캐시에 남아 재파싱(수백 ms)일 뿐 재다운로드가 아니다 — 초 단위 풀GC 멈춤보다 싸다.
let dataMemBytes = 0;
function dataMemPut(file, json, status, bytes, localStat) {
  const prev = dataMem[file];
  if (prev) dataMemBytes -= prev.bytes || 0;
  const e = { json, fetchedAt: Date.now(), status, bytes: bytes || 0, usedAt: Date.now(), localMtimeMs: localStat ? localStat.mtimeMs : undefined, localSize: localStat ? localStat.size : undefined };
  delete dataMem[file]; // 재삽입으로 키 순서를 최신으로(축출은 이 순서를 LRU 로 씀)
  dataMem[file] = e;
  dataMemBytes += e.bytes;
  for (const k of Object.keys(dataMem)) { // 오래된 것부터 축출 — 방금 넣은 건 남긴다
    if (dataMemBytes <= DATA_MEM_BUDGET) break;
    if (k === file) continue;
    dataMemBytes -= dataMem[k].bytes || 0;
    delete dataMem[k];
  }
}
function dataMemDrop(file) { // 한 번 쓰고 버릴 대용량(슬라이스 등)을 캐시에서 즉시 놓아준다
  const e = dataMem[file];
  if (!e) return;
  dataMemBytes -= e.bytes || 0;
  delete dataMem[file];
}
async function loadData(file) {
  const hit = dataInflight.get(file);
  if (hit) return hit;
  const p = _loadData(file).finally(() => { if (dataInflight.get(file) === p) dataInflight.delete(file); });
  dataInflight.set(file, p);
  return p;
}
async function readTextOrNull(p) { try { return await readFile(p, "utf8"); } catch { return null; } } // 동기 readFileSync 는 19MB 를 읽는 동안 서버 전체(다른 모든 요청)를 세운다
async function _loadData(file) { // 파싱된 JSON 반환. (TTL내 디스크) → 조건부 원격 → 디스크캐시 → 로컬 순
  const now = Date.now();
  const mem = dataMem[file];
  if (mem && now - (mem.fetchedAt || 0) < TTL_MS) {
    mem.usedAt = now;
    delete dataMem[file]; dataMem[file] = mem; // 최근 사용으로 키 순서 갱신(축출은 이 순서를 LRU 로 읽는다)
    dataStatus[file] = { ...(mem.status || {}), file, source: "memory-ttl", fetchedAt: mem.fetchedAt, cacheAgeMs: now - mem.fetchedAt, ttlMs: TTL_MS };
    return mem.json;
  }
  const diskF = dataDisk(file), metaF = diskF + ".meta";
  let meta = null; try { meta = JSON.parse(readFileSync(metaF, "utf8")); } catch {} // .meta 는 수백 바이트라 동기로 둔다
  let json = null;
  let bytes = 0;
  let status = { file, source: "", fetchedAt: now, cacheAgeMs: 0, ttlMs: TTL_MS };
  const localF = path.join(API_DIR, file);
  let localStat = null;
  try { localStat = statSync(localF); } catch {}
  // ★2026-08-31 사용자 지시 "외부 PC에서도 똑같이 보여야 한다" — 로컬 canonical 우선 읽기를 제거했다.
  //   예전엔 localStat 이 있으면 여기서 확정하고 원격을 아예 안 봤다. 그런데 API_DIR 은 리포의
  //   data/pages_site/static/api = **배포 전 canonical** 이라, 운영자 PC 컴패니언만 사이트보다 앞서 갔다
  //   (실측 2026-08-31: 사이트 51,028판(00:45 빌드) vs 컴패니언 51,510판(02:30 canonical) — 482판 차이).
  //   이제 순서는 외부 유저 PC 와 동일하다: 메모리TTL → 디스크TTL → 원격(사이트) → 디스크(만료) → 로컬(최후폴백).
  //   로컬은 네트워크가 죽었을 때만 쓰인다(아래 마지막 폴백). loadPool 주석이 원래 말하던 순서와도 이제 일치한다.
  if (json == null && meta && existsSync(diskF) && (Date.now() - (meta.fetchedAt || 0) < TTL_MS)) {
    const t = await readTextOrNull(diskF);
    json = parseJson(t); bytes = t ? t.length : 0; // TTL 안 → 네트워크 생략
    if (json != null) status = { file, source: "disk-ttl", fetchedAt: meta.fetchedAt || now, cacheAgeMs: now - (meta.fetchedAt || now), ttlMs: TTL_MS, etag: meta.etag || "", lastModified: meta.lastModified || "" };
    if (json == null) { try { unlinkSync(diskF); unlinkSync(metaF); } catch {} meta = null; } // 손상캐시(U+FFFD/HTML) 삭제 → 아래서 etag 없이 풀 재fetch(자가치유)
  }
  const remoteUrl = `${FILE_BASE[file] || DATA_BASE}/${file}`;
  let remoteErr = ""; // 원격이 왜 실패했나 — 던지는 에러에 실어 화면(상세 '통계를 못 받았어요')까지 올린다. 종전엔 catch {} 가 삼켜 이유가 사라졌다.
  const takeRemote = async r => { // 200 본문 → 파싱 + 디스크 캐시. 없는 파일 = Pages 가 200+HTML → null → 폴백
    const j = parseJsonRemote(r.body); bytes = r.body ? r.body.length : 0;
    if (j == null) { remoteErr = (r.body && r.body[0] === "<") ? "HTML 응답" : "JSON 아님"; return null; }
    const fetchedAt = Date.now(); status = { file, source: "remote", fetchedAt, cacheAgeMs: 0, ttlMs: TTL_MS, etag: r.etag || "", lastModified: r.lastModified || "" };
    try { await writeFile(diskF, r.body); writeFileSync(metaF, JSON.stringify({ etag: r.etag, lastModified: r.lastModified, fetchedAt })); } catch {} // 본문은 최대 19MB라 동기 쓰기면 그동안 창이 굳는다(서버가 Electron 메인 프로세스에서 돎)
    return j;
  };
  if (json == null) {
    try {
      const r = await fetchData(remoteUrl, meta);
      // 304 = 서버 본문과 우리가 가진 게 같다. 이미 파싱해 둔 게 메모리에 있으면 19MB 를 다시 읽고 파싱할 이유가 없다.
      //   (2026-08-31: 로컬우선 제거로 사라진 "local-unchanged" 고속경로를 원격 쪽에 대체 배치 — 5분 TTL 마다
      //    19MB 재파싱으로 Electron 메인 프로세스가 멎던 회귀 방지. 값은 304 라 동일함이 서버로 보증된다.)
      if (r.notModified && mem && mem.json != null) { const fetchedAt = Date.now(); mem.fetchedAt = fetchedAt; mem.usedAt = fetchedAt; delete dataMem[file]; dataMem[file] = mem; dataStatus[file] = { file, source: "remote-304-memory", fetchedAt, cacheAgeMs: 0, ttlMs: TTL_MS, etag: meta?.etag || "", lastModified: meta?.lastModified || "" }; try { writeFileSync(metaF, JSON.stringify({ ...meta, fetchedAt })); } catch {} return mem.json; }
      if (r.notModified) { if (existsSync(diskF)) { const t = await readTextOrNull(diskF); json = parseJson(t); bytes = t ? t.length : 0; const fetchedAt = Date.now(); status = { file, source: "remote-304", fetchedAt, cacheAgeMs: 0, ttlMs: TTL_MS, etag: meta?.etag || "", lastModified: meta?.lastModified || "" }; try { writeFileSync(metaF, JSON.stringify({ ...meta, fetchedAt })); } catch {} } if (json == null) remoteErr = "304 인데 디스크 사본을 못 읽음"; }
      else json = await takeRemote(r);
    } catch (e) { remoteErr = String((e && (e.code || e.message)) || e).slice(0, 80); }
  }
  if (json == null && existsSync(diskF)) { const t = await readTextOrNull(diskF); json = parseJson(t); bytes = t ? t.length : 0; if (json != null) status = { file, source: "disk-stale", fetchedAt: meta?.fetchedAt || now, cacheAgeMs: now - (meta?.fetchedAt || now), ttlMs: TTL_MS, etag: meta?.etag || "", lastModified: meta?.lastModified || "" }; } // 원격 실패/HTML → 디스크캐시(만료여도)
  if (json == null) { const lf = path.join(API_DIR, file); if (existsSync(lf)) { const t = await readTextOrNull(lf); json = parseJson(t); bytes = t ? t.length : 0; if (json != null) status = { file, source: "local", fetchedAt: Date.now(), cacheAgeMs: 0, ttlMs: TTL_MS, localPath: lf }; } } // → 로컬(개발/메인PC)
  // ★2026-09-25 마지막 한 번 — 원격·디스크·로컬이 다 비었을 때만. 1.5초 쉬고 **조건 없이 통째로** 다시 받는다.
  //   (a) 순간 끊김을 한 번 흡수한다. 설치 유저 PC 엔 로컬·디스크 사본이 없는 파일이 많아 한 번 삐끗하면 곧 500 이었다
  //       (외부 PC 신고: 게임 로딩창부터 상세가 '통계를 못 받았어요 · 서버 응답 500' — 픽창은 옛 번들로 대신 채워져 멀쩡해 보였다).
  //   (b) 304 인데 디스크 사본이 깨진 경우를 스스로 푼다 — 종전엔 같은 ETag 로 304 만 계속 받아 그 파일이 영영 안 읽혔다.
  if (json == null) {
    await new Promise(r => setTimeout(r, 1500));
    try { const r = await fetchData(remoteUrl, null); if (!r.notModified) json = await takeRemote(r); } catch (e) { remoteErr = String((e && (e.code || e.message)) || e).slice(0, 80); }
  }
  if (json == null) throw new Error("데이터를 받을 수 없음: " + file + (remoteErr ? ` (${remoteErr})` : ""));
  // 2026-09-03 증강 제공 변동: 지금 안 나오는 챔피언×증강 쌍을 걷어낸다(정의는 아래 augAvailFilter). 캐시에 걸러진 본을 넣어 매 요청 재필터 없음.
  try { json = await augAvailFilter(file, json); } catch {}
  dataStatus[file] = status;
  dataMemPut(file, json, status, bytes, status.source === "local" ? localStat : null);
  return json;
}
// 증강 메타 번들(챔피언/아이템/증강 — db.json 없이 사이트와 일치). 이것만 R2 공개 주소(r2.dev)에서 받는다.
// ★2026-09-25 실패를 60초 기억한다 — r2.dev 가 안 닿는 PC 에서 상세 한 번에 두세 번씩(각 1.5초 재시도 포함) 다시 두드리지 않게.
//   종전엔 이 번들 하나만 못 받아도 증강 상세 전체가 500 이었다(/api/champ · augmentCombos). 지금은 둘 다 없이도 그린다.
let _augMetaFailAt = 0;
async function augMeta() {
  if (Date.now() - _augMetaFailAt < 60000) throw new Error("증강 메타 번들 최근 실패 — 60초 뒤 다시");
  try { return await loadData("companion-augment-meta.json"); } catch (e) { _augMetaFailAt = Date.now(); throw e; }
}
async function load(file) {
  const r = (await loadData(file)).report || {};
  if (file === "standard-aram-cohort-all.json") await hydrateStdReport(r); // ★다이어트 회귀 수정: 캡된 comboRows를 외부 full 풀로 리하이드레이트
  return r;
}
// ★부팅 지연 분리(2026-07-21): load()는 표준 코호트를 읽을 때마다 외부 풀 7개(~89MB)를 함께 받는다.
//   그런데 티어리스트·챔피언/아이템/룬 목록처럼 리포트 상단 배열(championRows/itemRows/augmentRows)만 읽는 곳은
//   그 풀을 하나도 안 쓴다. 로컬 데이터가 있는 PC 에선 안 보이지만, 원격으로 받는 유저는 첫 화면을 띄우려고
//   상세용 풀 89MB 를 기다리고 있었다. 그런 곳은 이걸 쓴다 — 반환 객체는 load() 와 같은 참조라
//   나중에 상세 화면이 hydrate 하면 그 값이 그대로 보인다(데이터 차이 없음, 시점만 늦춤).
async function loadLite(file) { return (await loadData(file)).report || {}; }
// ★사이트 25MB 다이어트가 리포트 comboRows.championItem/championAugment를 200행 전역캡함(챔프당 ~1행) → 표준 챔프상세 아이템/룬 대량누락.
//   full 데이터는 외부 풀파일(search-pool-all-observedChampion{Items,Augments}.json, 각 6859·8148행)에 살아있으므로 그걸로 comboRows를 다시 채운다(단일지점 → topCombos·stdItemDetail·stdRuneDetail 등 모든 소비자 자동복구). augment모드는 원래 외부풀(season2)이라 무관.
// ★그룹별 분리(2026-07-21): 예전엔 7개 풀을 한 덩어리로 받아, 아이템 클래스 하나 알자고 89MB 를 전부 기다렸다.
//   그룹마다 따로 받고 따로 캐시한다. 인자를 안 주면 종전대로 전부 — 기존 호출자 동작은 그대로다.
const PAIR_KEYS = ["observedChampionPairs", "observedItemPairs", "observedTeamItemPairs", "observedAugmentPairs"]; // observedChampionSynergies 제외: fetch되나 어떤 소비자도 안 읽음(topSynergies=observedChampionPairs 사용) — 죽은 fetch 제거
// full 외부풀 행을 그대로 보존(rightKind/rightKey/leftKind/tier/icon/secondary* 등) → 챔프상세 topCombos + 아이템/룬 상세 stdItemDetail·stdRuneDetail 필터 전부 동작.
const STD_HYDRATE = {
  championItem: async r => { const ci = await loadPool("search-pool-all-observedChampionItems.json"); if (!Array.isArray(ci) || !ci.length) return false; r.comboRows = r.comboRows || {}; r.comboRows.championItem = ci; return true; },
  championAugment: async r => { const ca = await loadPool("search-pool-all-observedChampionAugments.json"); if (!Array.isArray(ca) || !ca.length) return false; r.comboRows = r.comboRows || {}; r.comboRows.championAugment = ca.map(x => x.augment ? x : { ...x, augment: x.secondaryAugment || null }); return true; }, // topCombos 룬은 x.augment 기대 → secondaryAugment 별칭
  augmentItem: async r => { const ai = await loadPool("search-pool-all-observedAugmentItems.json"); if (!Array.isArray(ai) || !ai.length) return false; r.comboRows = r.comboRows || {}; r.comboRows.augmentItem = ai; return true; },
  // pairs/시너지: 임베드 120캡 → 외부 full(챔피언쌍은 샤딩=loadPool 재조립) → 잘맞는아군(topSynergies)·아이템쌍·룬쌍 복구.
  pairs: async r => {
    const pools = await Promise.all(PAIR_KEYS.map(k => loadPool(`search-pool-all-${k}.json`)));
    r.personalRecommendations = r.personalRecommendations || {};
    let ok = false;
    PAIR_KEYS.forEach((k, i) => { if (Array.isArray(pools[i]) && pools[i].length) { r.personalRecommendations[k] = pools[i]; ok = true; } });
    return ok;
  }
};
const STD_HYDRATE_ALL = Object.keys(STD_HYDRATE);
async function hydrateStdReport(r, need) {
  if (!r) return r;
  const groups = (Array.isArray(need) && need.length) ? need : STD_HYDRATE_ALL;
  if (!r._hyd) Object.defineProperty(r, "_hyd", { value: {}, enumerable: false, configurable: true }); // 리포트 JSON 에 안 섞이게 비열거
  await Promise.all(groups.map(g => {
    const fn = STD_HYDRATE[g];
    if (!fn) return null;
    // 실패(부분/전체)한 그룹은 캐시를 비워 다음 호출에 재시도 — 풀 fetch 한 번 실패로 5분간 빈 풀이 굳던 sticky-degrade 방지
    if (!r._hyd[g]) r._hyd[g] = fn(r).then(ok => { if (!ok) r._hyd[g] = null; return ok; }, () => { r._hyd[g] = null; return false; });
    return r._hyd[g];
  }));
  r._comboHydrated = !!(r.comboRows && r.comboRows.championItem && r.comboRows.championItem.length && r.comboRows.championAugment && r.comboRows.championAugment.length); // 핵심 콤보풀이 실제 로드됐을 때만 확정
  return r;
}
function itemIconMap(r) { if (!r._iic) { r._iic = new Map(); for (const it of (r.itemRows || [])) if (it.id != null) r._iic.set(Number(it.id), it.icon); } return r._iic; }
function champIconMap(r) { if (!r._cic) { r._cic = new Map(); for (const c of (r.championRows || [])) { if (!c.icon) continue; if (c.localName) r._cic.set(norm(c.localName), c.icon); if (c.displayName) r._cic.set(norm(c.displayName), c.icon); } } return r._cic; }
function topCombos(r, champ, field, min, limit = 6) {
  const rows = field === "augmentName" ? ((r.comboRows || {}).championAugment) : ((r.comboRows || {}).championItem);
  const iic = field === "itemName" ? itemIconMap(r) : null, q = norm(champ);
  const m = (rows || []).filter(x => norm(x.championName) === q && x[field]).map(x => {
    const games = +x.games || 0, wins = +x.wins || 0;
    let icon = "", cat = null, slot = null, tree = null;
    let id = null;
    if (field === "augmentName") { const a = x.augment || {}; id = a.id ?? null; cat = a.runeCategory || null; slot = a.runeSlot ?? null; tree = a.rarity || null; icon = a.icon || shardIcon(a.id); } // 룬 슬롯메타 + id + 파편 아이콘 폴백
    else { const mm = String(x.key || "").match(/item:(\d+)/); icon = mm ? (iic.get(Number(mm[1])) || `https://ddragon.leagueoflegends.com/cdn/16.11.1/img/item/${mm[1]}.png`) : ""; }
    // 기여도(사이트 rankImpact) = games × (승률−50) × games/(games+20). 아이템 정렬용(|값|↓). ★정확 승수(wins/games).
    const impact = games ? games * (wins / games * 100 - 50) * games / (games + 20) : 0;
    // Wilson 하한(z=1.64) = 룬 슬롯 픽용(클라에서 표본게이트 50판과 함께 씀). 표본신뢰 승률 — 저표본은 구간이 넓어 하한↓. z=1.64면 충분판수(465판)의 승률우위가 초대형표본(1029판)을 이김(폭풍의결집>주문작열). 극단 저표본(20~45판)은 클라 게이트가 확실히 매장. ★정확 승수.
    const wilson = (() => { if (!games) return 0; const z = 1.64, p = wins / games, n = games, dn = 1 + z * z / n, c = p + z * z / (2 * n), mrg = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return (c - mrg) / dn * 100; })();
    return { name: x[field], icon, games, thin: games < min, winRate: Math.round(+x.winRate || 0), adj: adjPct(wins, games), impact, wilson, cat, slot, tree, id, key: x.key };
  });
  let p = m.filter(x => x.games >= 5 && !isRemovedAramItem(x.id, x.name, x.key)); // 삭제/제외 아이템 배제
  return p.sort((a, b) => b.games - a.games).slice(0, limit); // 더 많이 반환(클라가 토글로 정렬/그룹)
}
function topSynergies(r, champ, base) {
  const q = norm(champ), cic = champIconMap(r), rows = (r.personalRecommendations && r.personalRecommendations.observedChampionPairs) || [], out = [];
  for (const x of rows) {
    const partner = norm(x.championName) === q ? x.rightLabel : (norm(x.rightLabel) === q ? x.championName : null);
    if (!partner) continue;
    const games = +x.games || 0, wins = x.wins != null ? +x.wins : Math.round((+x.winRate || 0) / 100 * games);
    out.push({ name: partner, icon: cic.get(norm(partner)) || "", games, thin: games < 15, winRate: Math.round(+x.winRate || 0), adj: adjPct(wins, games), key: String(x.key) });
  }
  // ★잘 맞는 아군 = 적합도(9차) 초록(잘 맞는 픽) 판정인 아군을 사이트 세로 지표 "적합도" 정렬(rankCmp: 점수↓ → 판수↓)과 같은 순서로
  //   (2026-09-06 사용자 지시 — 사이트 티어리스트 모달 synBox와 동일 규칙). base = 그 챔프 평균 승률(상세 헤더로 보내는 winRate와 같은 값).
  //   30판 미만은 판정 금지라 자동 제외(2026-09-06 정본 풀 실측: 일칼 173챔프 중 171이 초록 아군 6명 이상 — 빈 칸 없음).
  //   옛 규칙(보정승률 50%+ 중 표본순)은 50% 언저리 대세 아군이 상위를 점유했다(제이스: 이즈리얼 50%/487판 1위 ↔ 적합도순 리산드라 62%/326판).
  return fitAllies(out, base, amAllySynergy(rows));
}
// 잘 맞는 아군 공통 선별·정렬(일칼 topSynergies · 증바람 augmentPartnerChamps).
// ★2026-09-18 사용자 결정: 궁합(둘이 같이 있을 때만 더 이기는 몫) 순이 1순위. 사이트 synBox 와 같은 규칙·같은 문턱(3명).
//   syn 이 null 이거나 궁합 양수 아군이 3명 미만이면 종전 적합도(fitVerdict/fitCmp) 순서 그대로 — 산식 사본 금지.
function fitAllies(arr, base, syn) {
  const b = (Number.isFinite(Number(base)) && Number(base) > 0) ? Number(base) : 50;
  if (syn) {
    const lifted = arr.map(x => ({ ...x, lift: syn.get(x.key) })).filter(x => Number.isFinite(x.lift) && x.lift > 0);
    if (lifted.length >= 3) return lifted.sort((x, y) => (y.lift - x.lift) || ((Number(y.games) || 0) - (Number(x.games) || 0))).slice(0, 8);
  }
  return arr.filter(x => fitVerdict(x, b) > 0).sort(fitCmp(b)).slice(0, 8);
}

// 증강 빌드는 report.comboRows가 비어있어 별도 pool 파일에서 읽는다(season2)
// ── 증강 제공 변동(2026-09-03 사용자 지시, v2): "지금 안 나오는" 챔피언×증강 쌍 + 전역 비활성 증강(최근 7일 0회) + 연동 아이템(공허의 불길)을
//   추천·티어리스트 어디에도 띄우지 않는다. 사이트 gen loop 가 매시간 쓰는 augment-unavailable-season2.json 을 같은 DATA_BASE 에서 받아,
//   증바람 검색풀 전부(rows)와 리포트(dailyReport 티어리스트·추천 임베드·엔티티 행)를 깊이 순회하며 걷어낸다. 사이트 app_v2.js(installAugmentAvailability v2)와 같은 규칙.
//   삭제가 아니라 비활성 — 정본 목록에서 빠지면(다시 나오면) TTL 뒤 자동 복귀. 표준(q450) 파일은 이름이 다르므로 통과.
const AUG_UNAVAIL_FILE = "augment-unavailable-season2.json";
const _augNorm = s => String(s == null ? "" : s).normalize("NFKC").toLowerCase().replace(/[\s\-_.'"`:()]/g, "");
let _augUnavailIdx = null, _augUnavailAt = 0, _augUnavailP = null;
function _augBuildIndex(small) {
  const byChamp = new Map(), gAug = new Set(), gItem = new Set(); const champs = (small && small.champions) || {}, augs = (small && small.augments) || {};
  for (const pr of ((small && small.pairs) || [])) {
    const cid = pr[0], aid = pr[1]; const c = champs[cid] || {}, a = augs[aid] || {};
    const ckeys = [String(cid), _augNorm(c.en), _augNorm(c.name)].filter(Boolean);
    const akeys = [String(aid)]; if (a.catalogId != null) akeys.push(String(a.catalogId)); if (a.name) akeys.push("n:" + _augNorm(a.name));
    for (const ck of ckeys) { if (!byChamp.has(ck)) byChamp.set(ck, new Set()); const st = byChamp.get(ck); for (const k of akeys) st.add(k); }
  }
  for (const g of ((small && small.globalAugments) || [])) { if (g.id != null) gAug.add(String(g.id)); if (g.catalogId != null) gAug.add(String(g.catalogId)); if (g.name) gAug.add("n:" + _augNorm(g.name)); }
  for (const it of ((small && small.items) || [])) { if (!it.unavailable) continue; if (it.id != null) gItem.add(String(it.id)); if (it.name) gItem.add("n:" + _augNorm(it.name)); }
  return { byChamp, gAug, gItem };
}
async function augUnavailIndex() {
  if (_augUnavailIdx && Date.now() - _augUnavailAt < TTL_MS) return _augUnavailIdx;
  if (_augUnavailP) return _augUnavailP;
  _augUnavailP = (async () => { try { const j = await loadData(AUG_UNAVAIL_FILE); _augUnavailIdx = _augBuildIndex(j); _augUnavailAt = Date.now(); } catch {} finally { _augUnavailP = null; } return _augUnavailIdx; })();
  return _augUnavailP;
}
function _augChampKeys(row) { const o = []; const push = v => { if (v == null || v === "") return; if (typeof v === "object") { push(v.id); push(v.key); push(v.name); push(v.localName); push(v.displayName); return; } o.push(_augNorm(v)); }; push(row.championKey); push(row.championName); push(row.championLocalName); push(row.localChampion); push(row.champion); push(row.primaryChampion); push(row.championId); return o; }
function _augObjKeys(a, o) { if (a == null || a === "") return; if (typeof a !== "object") { o.push(String(a)); return; } for (const v of [a.id, a.value, a.riotId, a.rawAugmentId, a.catalogId, a.key]) if (v != null && v !== "") o.push(String(v)); for (const v of [a.localName, a.name, a.displayName]) if (v) o.push("n:" + _augNorm(v)); }
function _itemObjKeys(it, o) { if (it == null || it === "") return; if (typeof it !== "object") { o.push(String(it)); return; } for (const v of [it.id, it.itemId, it.key]) if (v != null && v !== "") o.push(String(v)); for (const v of [it.localName, it.name, it.displayName]) if (v) o.push("n:" + _augNorm(v)); }
function _augPairKeys(row) { const o = []; for (const a of [row.augment, row.primaryAugment, row.secondaryAugment]) if (a && typeof a === "object") _augObjKeys(a, o); for (const v of [row.augmentKey, row.augmentId]) if (v != null && v !== "") o.push(String(v)); for (const v of [row.augmentName, row.augmentLocalName]) if (v) o.push("n:" + _augNorm(v)); return o; }
function _augHasBoth(row) { return !!(row && typeof row === "object" && (row.championKey || row.championName || row.championLocalName || (row.champion && typeof row.champion === "object")) && (row.augment || row.primaryAugment || row.secondaryAugment || row.augmentKey || row.augmentName)); }
function _augPairBlocked(row, idx) { if (!idx.byChamp || !_augHasBoth(row)) return false; const aks = _augPairKeys(row); if (!aks.length) return false; for (const ck of _augChampKeys(row)) { const st = idx.byChamp.get(ck); if (!st) continue; for (const ak of aks) if (st.has(ak)) return true; } return false; }
// ⚠️ row.augments[]/row.items[] 같은 목록은 행 판정에 쓰지 않는다(챔피언 행이 상위 증강 목록에 비활성 증강을 품었다고 사라지면 안 된다) — 목록 요소는 walk 가 거른다.
function _augGlobalBlocked(row, idx, hint) { if (!idx.gAug.size) return false; const o = []; for (const a of [row.augment, row.primaryAugment, row.secondaryAugment]) _augObjKeys(a, o); if (Array.isArray(row.augmentKeys)) for (const v of row.augmentKeys) if (v != null && v !== "" && typeof v !== "object") o.push(String(v)); for (const v of [row.augmentKey, row.augmentId, row.rawAugmentId]) if (v != null && v !== "") o.push(String(v)); for (const v of [row.augmentName, row.augmentLocalName]) if (v) o.push("n:" + _augNorm(v)); if (hint === "augment") { for (const v of [row.id, row.key, row.value]) if (v != null && v !== "") o.push(String(v)); for (const v of [row.localName, row.name, row.displayName]) if (v) o.push("n:" + _augNorm(v)); } for (const k of o) if (idx.gAug.has(k)) return true; return false; }
function _itemGlobalBlocked(row, idx, hint) { if (!idx.gItem.size) return false; const o = []; for (const it of [row.item, row.primaryItem, row.secondaryItem]) _itemObjKeys(it, o); if (Array.isArray(row.itemKeys)) for (const v of row.itemKeys) if (v != null && v !== "" && typeof v !== "object") o.push(String(v)); for (const v of [row.itemKey, row.itemId]) if (v != null && v !== "") o.push(String(v)); for (const v of [row.itemName, row.itemLocalName]) if (v) o.push("n:" + _augNorm(v)); if (hint === "item") { for (const v of [row.id, row.key]) if (v != null && v !== "") o.push(String(v)); for (const v of [row.localName, row.name, row.displayName]) if (v) o.push("n:" + _augNorm(v)); } for (const k of o) if (idx.gItem.has(k)) return true; return false; }
function augAvailBlocked(row, idx, hint) { idx = idx || _augUnavailIdx; if (!idx || !row || typeof row !== "object") return false; return _augPairBlocked(row, idx) || _augGlobalBlocked(row, idx, hint || "") || _itemGlobalBlocked(row, idx, hint || ""); }
const _AUG_SKIP_KEY = /meta|catalog|hextech|alias|summary|generatedAt/i;
const _augHintOf = (key, inherit) => /augment/i.test(key) ? "augment" : /item/i.test(key) ? "item" : /champion/i.test(key) ? "champion" : inherit;
function augAvailWalk(node, idx, hint, depth) {
  if (!node || typeof node !== "object" || depth > 9) return node;
  if (Array.isArray(node)) { const out = []; for (const el of node) { if (el && typeof el === "object" && !Array.isArray(el) && augAvailBlocked(el, idx, hint)) continue; out.push(augAvailWalk(el, idx, hint, depth + 1)); } return out; }
  for (const key of Object.keys(node)) { const v = node[key]; if (!v || typeof v !== "object" || _AUG_SKIP_KEY.test(key)) continue; node[key] = augAvailWalk(v, idx, _augHintOf(key, hint), depth + 1); }
  return node;
}
async function augAvailFilter(file, json) {
  const f = String(file || "");
  if (f === AUG_UNAVAIL_FILE || !json || typeof json !== "object") return json;
  const isPool = /^search-pool-.*season2.*\.json$/i.test(f) && Array.isArray(json.rows), isReport = /^report-public-.*\.json$/i.test(f) && !/-classic\.json$/i.test(f);
  if (!isPool && !isReport) return json;
  const idx = await augUnavailIndex(); if (!idx) return json;
  if (isPool) { const hint = /observed(?:Weak)?Augments-/i.test(f) ? "augment" : /observed(?:Weak)?Items-/i.test(f) ? "item" : ""; json.rows = json.rows.filter(r => !augAvailBlocked(r, idx, hint)); }
  if (isReport) { const rep = (json.report && typeof json.report === "object") ? json.report : json; augAvailWalk(rep, idx, "", 0); }
  return json;
}
async function loadPool(file) {
  const j = await loadData(file);
  if (j && j.sharded && Array.isArray(j.shards) && j.shards.length) { // ★샤딩 매니페스트(rows:[])는 파트를 투명 재조립(사이트 클라 app_v2.js와 동일). 24MB↑ 풀-표본(챔피언쌍 14654행 등)이 rows:0으로만 읽히던 버그.
    const parts = await Promise.all(j.shards.map(s => loadData(typeof s === "string" ? s : (s && (s.file || s.name))).then(p => (p && p.rows) || []).catch(() => [])));
    return parts.flat();
  }
  return (j && j.rows) || [];
}
async function augmentCombos(name, kind, limit = 6) { // kind: "augment" | "item"
  const file = kind === "augment" ? "search-pool-all-observedChampionAugments-season2.json" : "search-pool-all-observedChampionItems-season2.json";
  const rows = await loadPool(file), q = norm(name);
  let augIcon = null, augRarity = null; // metasrc(403) 아이콘 폴백 + rarity(프리즘/골드/실버)
  if (kind === "augment") { augIcon = new Map(); augRarity = augmentRarityMap(); try { for (const a of ((await augMeta()).augments || [])) augIcon.set(norm(a.name), a.icon); } catch {} } // R2 번들은 아이콘 보충용일 뿐 — 못 받아도 증강 목록은 그린다(2026-09-25)
  const descMap = kind === "augment" ? await augDescMap() : await itemDescMap(); // 호버 툴팁 설명(증강/아이템 공통)
  return rows.filter(x => norm(x.championLocalName) === q || norm(x.championName) === q).map(x => {
    const o = kind === "augment" ? x.augment : x.item, games = +x.games || 0, wins = +x.wins || 0;
    const nm = (o && (o.localName || o.name)) || x.rightLabel || "";
    let icon = (o && o.icon) || "";
    if (kind === "augment" && (!icon || /metasrc/.test(icon))) icon = augIcon.get(norm(nm)) || ""; // metasrc/빈값 → 번들 communitydragon 아이콘
    const rarity = kind === "augment" ? ((o && o.rarity) || augRarity.get(norm(nm)) || null) : null;
    const _oid = o?.id ?? itemIdFromKey(x.key);
    // ★기여도·Wilson(정확 승수) — topCombos와 동일. 없으면 클라 최고승률이 games-desc 폴백돼 '가장흔한'과 똑같아짐(증강 아이템·증강 안 바뀌던 원인).
    const impact = games ? games * (wins / games * 100 - 50) * games / (games + 20) : 0;
    const wilson = (() => { if (!games) return 0; const z = 1.64, p = wins / games, n = games, dn = 1 + z * z / n, c = p + z * z / (2 * n), mrg = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return (c - mrg) / dn * 100; })();
    return { name: nm, icon, games, thin: games < 8, winRate: Math.round(+x.winRate || 0), adj: adjPct(wins, games), impact, wilson, rarity, desc: descMap.get(Number(_oid)) || "", id: _oid, key: x.key };
  }).filter(x => x.name && (kind !== "item" || !isRemovedAramItem(x.id, x.name, x.key))).sort((a, b) => b.games - a.games).slice(0, limit); // 표본순(증강 데이터 희소), 삭제/제외 아이템 배제
}
async function augmentPartnerChamps(name, base) {
  const rows = await loadPool("search-pool-all-observedChampionPairs-season2.json"), q = norm(name), out = [];
  for (const x of rows) {
    const champs = x.champions || []; if (!champs.some(c => norm(c.localName) === q || norm(c.name) === q)) continue;
    const partner = champs.find(c => norm(c.localName) !== q && norm(c.name) !== q); if (!partner) continue;
    const games = +x.games || 0, wins = +x.wins || 0;
    out.push({ name: partner.localName || partner.name, icon: partner.icon || "", games, thin: games < 8, winRate: Math.round(+x.winRate || 0), adj: adjPct(wins, games), key: String(x.key) });
  }
  // ★잘 맞는 아군 = 적합도 초록 판정 + 적합도 점수순(topSynergies와 같은 fitAllies). 옛 "시즌2 쌍 희소(games>=5면 전멸)" 전제는 끝났다
  //   (2026-09-06 정본 풀 실측: 쌍당 중앙값 184판, 173챔프 중 168이 초록 아군 6명 이상).
  return fitAllies(out, base, amAllySynergy(rows));
}
// 설명 맵 캐시는 데이터 TTL과 동일하게 만료(2026-08-27): 영구 캐시였을 땐 앱을 오래 켜두면 사이트가 설명을
//   갱신해도(치명적 미사일 실사고) 재시작 전까지 옛 설명이 남았다. 리포트 자체는 loadData TTL로 이미 갱신됨.
let _augDescMap = null, _augDescAt = 0;
async function augDescMap() { // 증강 id→설명(아이콘 호버 툴팁용). 리포트 augmentRows.description 단일소스.
  if (_augDescMap && Date.now() - _augDescAt < TTL_MS) return _augDescMap;
  const m = new Map();
  try { const r = (await publicReport("augment", "all")).report || {}; for (const x of (r.augmentRows || [])) { const id = Number(x.id); const d = x.description || x.plaintext || ""; if (id && d) m.set(id, d); } } catch {}
  if (m.size || !_augDescMap) { _augDescMap = m; } // 일시 실패로 빈 맵이 덮지 않게 — 기존 맵 유지
  _augDescAt = Date.now(); return _augDescMap;
}
let _itemDescMap = null, _itemDescAt = 0;
async function itemDescMap() { // 아이템 id→설명(호버 툴팁). itemRows.description 사용(plaintext는 일부 오매칭—탐욕의군화→마나무네).
  if (_itemDescMap && Date.now() - _itemDescAt < TTL_MS) return _itemDescMap;
  const m = new Map();
  try { const r = (await publicReport("augment", "all")).report || {}; for (const x of (r.itemRows || [])) { const id = Number(x.id); const d = x.description || x.plaintext || ""; if (id && d) m.set(id, d); } } catch {}
  if (m.size || !_itemDescMap) { _itemDescMap = m; }
  _itemDescAt = Date.now(); return _itemDescMap;
}

// 챔피언 역할(전사/암살자/원거리/마법사/탱커/서포터) — 클래스 필터(⑦)용. 코호트 championRows.group이 출처(역할은 모드 무관).
function roleNorm(r) { const s = String(r || "").toLowerCase(); return ["fighter", "assassin", "marksman", "mage", "tank", "support"].includes(s) ? s : "all"; }
// 챔피언 역할/아이템 클래스 보정 = 단일 소스 static/api/class-overrides.json. 사이트 app_v2.js도 같은 파일을 read → 코드에 사본 맵 금지, 분류 수정은 그 JSON 한 곳만(drift 원천봉쇄). Riot ddragon 태그(c.group)는 ARAM 실제와 다른 챔프 많음(럼블=Fighter지만 ARAM 마법사).
const ROLE_FIX = new Map();        // norm(이름) -> 역할(class-overrides.json role, 6클래스)
const ITEM_CLASS_FIX = new Map();  // norm(이름) -> 클래스(class-overrides.json item, 120아이템 명시)
function _applyClsOvr(j) {
  ROLE_FIX.clear(); ITEM_CLASS_FIX.clear();
  for (const [k, v] of Object.entries((j && j.role) || {})) ROLE_FIX.set(norm(k), v);
  for (const [k, v] of Object.entries((j && j.item) || {})) ITEM_CLASS_FIX.set(norm(k), v);
}
try { _applyClsOvr(JSON.parse(readFileSync(path.join(API_DIR, "class-overrides.json"), "utf8"))); } catch {} // 즉시 로컬 폴백(운영자 canonical 있으면 시작부터)
let _clsOvrOnce = null;
// ★설치 유저 PC 오분류 수정: 정본 class-overrides.json을 사이트(app_v2.js)와 동일하게 loadData로 받는다(로컬 우선→없으면 라이브 aram-mayhem.com).
//   옛 구현은 로컬 readFileSync 전용이라 앱 번들에 파일 없는 유저 PC선 빈 맵→raw ddragon(럼블=전사 등). 다른 메타는 다 loadData로 받는데 이 오버라이드만 로컬 의존이던 것을 정합.
function ensureClassOverrides() {
  // ★2026-07-22: 실패해도 프라미스가 남아 프로세스 수명 내내 '빈 보정'이 굳던 것을 고쳤다(재시도 없음 → 럼블=전사 같은 raw 분류가 영구화).
  //   실패 시 캐시를 비워 다음 호출에 다시 시도한다.
  if (!_clsOvrOnce) _clsOvrOnce = (async () => {
    try {
      const j = await loadData("class-overrides.json");
      if (j && (j.role || j.item)) { _applyClsOvr(j); return true; }
      console.warn("[class-overrides] 내용 없음 → 다음 호출에 재시도");
    } catch (e) { console.warn("[class-overrides] 로드 실패 → 로컬/raw 유지, 다음 호출에 재시도:", e && e.message); }
    _clsOvrOnce = null; // 실패는 굳히지 않는다
    return false;
  })();
  return _clsOvrOnce;
}
ensureClassOverrides(); // 서버 시작 시 선(先)fetch — 첫 상세 요청 전 채워지게(레이스 최소화)
function fixChampRole(name, group) { return ROLE_FIX.get(norm(name)) || group; }
function fixItemClass(name, cls) { return ITEM_CLASS_FIX.get(norm(name)) || cls; }
let _champRoleMap = null;
async function champRoleMap() {
  if (_champRoleMap) return _champRoleMap;
  await ensureClassOverrides(); // 정본 오버라이드 확보(로컬 파일 없는 유저 PC도 라이브서 받아 사이트와 동일 분류)
  const m = new Map();
  let loaded = 0;
  try { const rows = (await loadLite("standard-aram-cohort-all.json")).championRows || []; loaded = rows.length; for (const c of rows) { const g = roleNorm(c.group); for (const n of [c.localName, c.displayName, c.champion, c.name]) if (n) m.set(norm(n), g); } } catch {} // championRows 만 읽음 → 상세용 풀 대기 불필요
  for (const [k, v] of ROLE_FIX) m.set(k, v); // ARAM 실역할 보정(class-overrides.json 정본) 덮어쓰기
  // ★2026-07-22: 코호트를 못 읽었으면(네트워크·재생성 중) 빈 맵을 프로세스 수명 내내 굳히지 않는다 — 다음 호출에 다시 만든다.
  if (loaded) _champRoleMap = m;
  return m;
}
// 아이템 클래스(전사~서포터) — 서버 itemRows엔 group이 없어(=all) 클래스 필터가 비어 보인다. 코호트의
// comboRows.championItem(챔피언↔아이템↔판수)을 champRoleMap과 조인해 "어느 클래스가 이 아이템을 많이 가는가"로
// 각 아이템의 dominant 클래스를 산출(사이트 assignItemGroupsFromBuilds와 동일 로직, 검증됨).
let _itemClassMap = null, _itemClassOk = false;
async function itemClassMap() {
  if (_itemClassMap) return _itemClassMap;
  await ensureClassOverrides(); // 정본 아이템 클래스 확보(로컬 파일 없는 유저 PC도 라이브서)
  const m = new Map(); // norm(itemName) -> class
  try {
    const cohort = await hydrateStdReport(await loadLite("standard-aram-cohort-all.json"), ["championItem"]); // 이 표가 읽는 건 championItem 뿐 — 나머지 6개 풀은 안 기다린다
    const ci = (cohort.comboRows || {}).championItem || [];
    const rmap = await champRoleMap();
    const agg = new Map();
    for (const row of ci) {
      const g = rmap.get(norm(row.championName));
      const inm = row.itemName; const games = Number(row.games || row.rightGames || 0) || 0;
      if (!g || g === "all" || !inm || !games) continue;
      let o = agg.get(inm); if (!o) { o = {}; agg.set(inm, o); } o[g] = (o[g] || 0) + games;
    }
    for (const [inm, o] of agg) { let best = "all", bv = -1; for (const k in o) if (o[k] > bv) { bv = o[k]; best = k; } if (best !== "all") m.set(norm(inm), best); }
    _itemClassOk = agg.size > 0;
  } catch {}
  for (const [k, v] of ITEM_CLASS_FIX) m.set(k, v); // 정본 class-overrides item(120아이템 명시)으로 덮어씀 — 사이트와 동일(build-dominant 위에). 옛 build-dominant 전용→사이트 불일치 수정
  if (_itemClassOk) _itemClassMap = m; // ★조인이 한 건도 성립 안 했으면 캐시하지 않는다 — 다음 호출에 재시도(빈 클래스 영구화 방지)
  return m;
}
// ── 사주풀이 z-score용 코호트 축 통계(같은 모드) — H 설계 ⓑ. metric(화력/버팀/성장)=챔피언 분포 가중 mean/std,
//    behavior(픽집중/픽폭/선공/최근흐름)=같은 모드 코호트 28계정 per-player 실측 분포(고정 prior 폐기, 2026-06 standardAram).
//    aggression=피해+받은피해 점유 기반(킬 신호 0, KDA 금지), breadth=Simpson 유효챔프수, loyalty=topShare(%). 양 모드 절대 안 섞음. 캐시.
// breadth=pickDiversity(effChamps/sqrt판수, games-aware). loyalty(topShare) 폐기 — 같은 차원·std 1.0 과민(전원 장인 수렴). 사이트/오라클 정합.
// ⚠️ aggression = involve(팀내 피해+받은피해 점유 평균, %) 를 그대로 z-score. (클라 fortuneShareAggression 이 변환 제거)
//    mean 20.0 = 구조적 앵커(5인팀 점유 모집단 평균은 정의상 정확히 20%, 양 모드 공통, 측정 불필요).
//    std = per-game involve 실측: ★모드별로 다르다 — q450(일반)=4.45 / q2400(증바람)=5.93 (증강이 딜 분포를 넓힘).
//      q450 = cohort_local 35,900 참가자-게임(평균 20.00 / std 4.45 / p5 12.9 p95 27.4).
//      q2400 = augfull 4,240 참가자-게임(평균 20.00 / std 5.93 / p5 11.1 p95 30.0).
//    ★이력: 옛 {32.6, 9.0}은 dmgShare 가 항상 100%이던 버그 시절 값 → {25.0, 9.0} 임시 → std 9.0 은 '20판+ 플레이어
//      평균끼리'의 좁은 분포라 aggression 만 유일하게 레일(-2.5σ, 점수 5)에 박혔다 → per-game 넓은 std(모드별)로 통일.
//    ★사이트 app_v2.js(사주풀이 표준 전용)의 AM_FORTUNE_BEHAVIOR_PRIORS.aggression 은 이 표준값 {20.0, 4.45}와 동일해야 파리티.
const AGGRESSION_STD_BY_MODE = Object.freeze({ standard: 4.45, augment: 5.93 });
const FORTUNE_BEHAVIOR_PRIORS = Object.freeze({ breadth: { mean: 2.4, std: 0.74 }, momentum: { mean: -2.9, std: 19.3 } });
const _fortuneCohort = {};
async function fortuneCohortStats(mode) {
  const m = mode === "augment" ? "augment" : "standard";
  // v2: 영구 캐시 → 5분 TTL. 기준선(fortune-people-*.json)은 워처가 사이트 리포트를 따라 재계산하므로
  //   (2026-08-30: 하루 1회 → 리포트 추종), 캐시가 1시간이면 그 갱신을 앱이 1시간 늦게 본다.
  //   하위 fetch 는 loadData 가 5분 TTL + mtime/ETag 로 막아주므로 5분 TTL 이어도 디스크·네트워크 비용은 사실상 0.
  if (_fortuneCohort[m] && Date.now() - (_fortuneCohort[m].__cachedAt || 0) < 300000) return _fortuneCohort[m];
  let rows = [];
  if (m === "augment") { try { rows = (await augmentMetaFromTeams()).map(c => ({ dpm: +c.dpm || 0, taken: +c.taken || 0, gpm: +c.gpm || 0, games: +c.games || 0 })); } catch {} }
  else { try { rows = ((await loadLite("standard-aram-cohort-all.json")).championRows || []).map(c => ({ dpm: +c.avgDpm || 0, taken: +c.avgTakenPerMinute || 0, gpm: +c.avgGoldPerMinute || 0, games: +c.games || 0 })); } catch {} } // championRows 만 읽음
  const wstat = key => { // 게임수 가중 mean/std(전형적 한 판 분포 근사)
    let sw = 0, s = 0; for (const r of rows) { const v = +r[key] || 0, w = +r.games || 0; if (v > 0 && w > 0) { s += v * w; sw += w; } }
    const mean = sw ? s / sw : 0; let sv = 0; for (const r of rows) { const v = +r[key] || 0, w = +r.games || 0; if (v > 0 && w > 0) sv += w * (v - mean) * (v - mean); }
    return { mean: Math.round(mean * 10) / 10, std: Math.round(Math.sqrt(sw ? sv / sw : 0) * 10) / 10 };
  };
  const out = { firepower: wstat("dpm"), durability: wstat("taken"), economy: wstat("gpm"), ...FORTUNE_BEHAVIOR_PRIORS, aggression: { mean: 20.0, std: AGGRESSION_STD_BY_MODE[m] || 5.93 } };
  // ── v2 실측 기준선(2026-08-27): fortune-people-{mode}.json = 실제 분포 분위표(q450=플레이어/판수하한, q2400=시즌2 판).
  //    사이트 /static/api 게시본을 받아(디스크캐시 폴백 포함) 축별로 덮는다. 실패 시 위 legacy 그대로(무회귀).
  try {
    const people = await loadData(`fortune-people-${m}.json`);
    if (people && people.schema === "fortune-people-v1" && people.axes) {
      for (const [k, v] of Object.entries(people.axes)) out[k] = v;
      // ⚠️ 실측 분위표에 없는 축은 **지운다**. 옛 하드코딩 prior(예 breadth 2.4±0.74)가 남아 있으면 새 스케일
      //   (15판 환산 다양성 ≈13)과 곱해져 가짜 상위 99% 를 만든다. 비교 기준이 없으면 순위를 만들지 않고
      //   화면은 사실(수치)만 말한다 — 증강 모드의 챔프 폭·최근 기세가 여기 해당(기여 데이터가 익명이라 사람별 집계 불가).
      for (const k of Object.keys(out)) { if (k !== "__meta" && !people.axes[k]) delete out[k]; }
      out.__meta = {
        basis: people.basis,
        players: people.source && people.source.playersAtMin,
        matches: people.source && people.source.matches,
        participantRows: people.source && people.source.participantRows,   // 건(참가 기록) — 각주 폴백
        siteMatches: people.source && people.source.siteMatches,   // 사이트가 표시하는 판수 — 각주는 이걸(× 10 = 건) 쓴다
        minGames: people.minGames,
        generatedAt: people.generatedAt
      };
    }
  } catch {}
  out.__cachedAt = Date.now();
  _fortuneCohort[m] = out; return out;
}
async function champMeta(mode) {
  const rmap = await champRoleMap();
  if (mode === "augment") {
    const reportRows = await augmentChampionMetaFromReport();
    if (reportRows.length) {
      return reportRows.map(c => ({
        name: firstText(c.localName, c.label, c.displayName, c.name),
        icon: c.icon || "",
        games: Number(c.games || 0),
        thin: Number(c.games || 0) < 10,
        winRate: Number(c.winRate || 0),
        tier: c.tier ?? null,
        group: rmap.get(norm(firstText(c.localName, c.label, c.displayName, c.name))) || roleNorm(c.group)
      })).filter(c => c.name).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    }
    const live = await augmentMetaFromTeams(); // db.json 10명 라이브 집계 — 메인PC선 실시간(게임마다 갱신). 동결 해소.
    if (live.length) return live.map(c => ({ name: c.name, icon: c.icon || "", games: c.games || 0, thin: (c.games || 0) < 10, winRate: c.winRate || 0, tier: c.tier ?? null, group: rmap.get(norm(c.name)) || "all" }));
    return (await augMeta()).champions.map(c => ({ name: c.name, icon: c.icon || "", games: c.games || 0, thin: (c.games || 0) < 10, winRate: c.winRate || 0, tier: c.tier ?? null, group: rmap.get(norm(c.name)) || "all" })); // db.json 없는 다른 PC 폴백(번들)
  }
  const rows = (await loadLite("standard-aram-cohort-all.json")).championRows || []; // 챔피언 목록=championRows 만
  return rows.map(c => ({ name: c.localName || c.displayName, icon: c.icon || "", games: c.games || 0, thin: (c.games || 0) < 20, winRate: Math.round(c.winRate || 0), tier: c.tier ?? null, group: rmap.get(norm(c.localName || c.displayName || c.champion || c.name)) || roleNorm(c.group) }))
    .filter(c => c.name).sort((a, b) => b.games - a.games); // 표본수(판수) 내림차순(전체 — 검색용). group=ARAM 역할보정(rmap) 우선

}
// 표본보정 백분위 티어(1~5, cut 6/30/72/96%) — 일반 코호트 티어와 같은 의미로 증강쪽에 부여
function assignTiers(list) {
  const ranked = list.map(c => ({ c, s: (c.winRate / 100 * c.games + 10) / (c.games + 20) })).sort((a, b) => b.s - a.s);
  ranked.forEach((o, i) => { const p = ranked.length ? i / ranked.length : 1; o.c.tier = p < 0.06 ? 1 : p < 0.30 ? 2 : p < 0.72 ? 3 : p < 0.96 ? 4 : 5; });
  return list;
}
// 데이터드래곤 버전 — 신 챔피언(예: 로크=Locke)이 아이콘/이름 깨지지 않게 최신 폴백 + 라이브 최신본으로 동적 갱신.
//   (하드코딩 고정 시 새 패치 챔피언이 챔프#id·깨진아이콘으로 떴음). 아이콘/이름 해석 전용 — 증강 시즌 경계(gameVersion)와 무관.
let DDV = "16.13.1";
(async () => { try { const v = await fetchJsonU("https://ddragon.leagueoflegends.com/api/versions.json"); if (Array.isArray(v) && /^\d+\.\d+/.test(String(v[0] || ""))) DDV = v[0]; } catch {} })();
async function itemMeta(mode) {
  if (mode === "augment") { // db.json 라이브 아이템 카운트 + 번들의 이름/아이콘(id매칭), 티어 라이브계산. 메인PC 실시간.
    const live = augmentItemAgg();
    if (live.length) {
      const byId = new Map(((await augMeta()).items || []).map(it => [Number(it.id), it]));
      const list = live.map(c => { const b = byId.get(c.id); return b ? { name: b.name, icon: b.icon || `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/item/${c.id}.png`, games: c.games, winRate: c.winRate, thin: c.games < 50, id: c.id } : null; }).filter(x => x && !isRemovedAramItem(x.id, x.name));
      if (list.length) return withTiers(list).sort((a, b) => b.games - a.games);
    }
    return (await augMeta()).items.slice().filter(it => !isRemovedAramItem(it.id, it.name)).sort((a, b) => b.games - a.games); // db.json 없는 다른 PC 폴백(번들)
  }
  const cohort = await load("standard-aram-cohort-all.json");
  const imap = await itemClassMap();
  return (cohort.itemRows || []).filter(it => !isRemovedAramItem(it.id, it.localName || it.name)).map(it => ({ name: it.localName || it.name, icon: it.icon || "", games: it.games || 0, winRate: Math.round(it.winRate || 0), tier: it.tier ?? null, thin: (it.games || 0) < 50, group: fixItemClass(it.localName || it.name, imap.get(norm(it.localName || it.name))) || "all" })).filter(it => it.name).sort((a, b) => b.games - a.games);
}
async function runeMeta(mode) { // 일반=룬(코호트 augmentRows), 증강=증강(번들, 사이트와 일치)
  if (mode === "augment") {
    const live = augmentAugmentMeta(); // db.json 라이브 증강 메타(메인PC 실시간), augmentDetails 아이콘이라 폭격기도 정상
    if (live.length) return withTiers(live).slice().sort((a, b) => b.games - a.games);
    return (await augMeta()).augments.slice().sort((a, b) => b.games - a.games); // db.json 없는 다른 PC 폴백
  }
  const r = await loadLite("standard-aram-cohort-all.json"); // 룬 목록=augmentRows 만
  return (r.augmentRows || []).map(a => ({ name: a.localName || a.name, icon: a.icon || shardIcon(a.id), games: a.games || 0, winRate: Math.round(a.winRate || 0), tier: a.tier ?? null, thin: (a.games || 0) < 100 })).filter(a => a.name).sort((a, b) => b.games - a.games); // 파편 아이콘 폴백
}
// 완전한 룬 트리(ddragon runesReforged) — 관측된 룬만 아니라 전체 트리(키스톤+3줄×3)로 깔아야 lolalytics처럼 정렬됨
// 2026-08-24 사용자 지시: 컴패니언 기간 필터를 사이트 티어리스트 필터와 같은 축으로 통일한다.
//   옛 축(전체 기간·현재 패치·최근 2패치·최근 3패치)은 사이트 어디에도 같은 축이 없어 컴패니언만 다른 숫자를 보였다.
const TABLE_RANGES = Object.freeze([
  { key: "all", label: "전체" },
  { key: "recent28", label: "최근 28일" },
  { key: "recent14", label: "최근 14일" }
]);
// 기간키 → 모드별 실제 소스. report=리포트 파일 range · pool=search-pool 파일 range · win=dailyReport 창키.
//   ⚠️두 모드가 같은 기간을 서로 다른 이름으로 갖고 있다(파일이 실제로 그렇게 배포된다):
//     일반칼바람(q450)  = standard-aram-cohort-all.json 한 벌 안에 all/recent28/recent14 창 + 같은 이름의 풀·상대법 파일
//     증강칼바람(q2400) = report-public-all-season2.json 한 벌 안에 all/patch(28일)/week(14일) 창 + 같은 이름의 풀
//   리포트 파일은 두 모드 다 "all" 한 벌만 쓴다(28/14일짜리 리포트 파일은 만들지 않는다 — 파일당 14MB+137MB라 배포가 감당 못 함).
//   그래서 기간에 따라 좁아지는 건 dailyReport 창을 읽는 표(티어리스트·세로·분포·챔피언)와 풀을 읽는 표다.
const RANGE_SOURCES = Object.freeze({
  standard: Object.freeze({
    all: { report: "all", pool: "all", win: "all" },
    recent28: { report: "all", pool: "recent28", win: "recent28" },
    recent14: { report: "all", pool: "recent14", win: "recent14" }
  }),
  augment: Object.freeze({
    all: { report: "all", pool: "all", win: "all" },
    recent28: { report: "all", pool: "patch", win: "patch" },
    recent14: { report: "all", pool: "week", win: "week" }
  })
});
const TABLE_TABS_BY_MODE = Object.freeze({
  standard: Object.freeze([
    { key: "broadcast", label: "메타 통계" },
    { key: "champion", label: "챔피언" },
    { key: "rune", label: "룬" },
    { key: "item", label: "아이템" },
    { key: "combo", label: "조합" },
    { key: "analysis", label: "지표 분석" }
  ]),
  augment: Object.freeze([
    { key: "broadcast", label: "메타 통계" },
    { key: "champion", label: "챔피언" },
    { key: "augment", label: "증강" },
    { key: "item", label: "아이템" },
    { key: "combo", label: "조합" },
    { key: "analysis", label: "지표 분석" }
    // 상대법 탭 제거(2026-08-24 사용자 결정) — 양 모드 공통. 데이터·읽기 코드는 그대로 둔다.
  ])
});
const LIVE_PUBLIC_TABLE_BLUEPRINTS = Object.freeze([
  // ── 방송 리포트(사이트 메인 이식): 티어리스트·세로·분포. dailyReport 티어 데이터(고저 미분리=all:true)를 source:"daily"로 읽는다. ──
  //   layout으로 클라 렌더 분기(tier=티어 사다리, vertical=세로 마스터-디테일, dist=분포 스캐터). compactTableRow가 tier·rank·group·avgDpm/Gold/Taken 통과.
  //   "전체 데이터"는 챔피언/증강/아이템 탭에 이미 있어 제외(사용자 요청). 챔프 단일 kind이므로 엔티티타입/레어도/룬계열 필터는 스코프 외.
  { key: "broadcastTier", tab: "broadcast", label: "티어리스트", source: "daily", kind: "champion", prop: "observedChampions", context: "champion", all: true, layout: "tier" },
  { key: "broadcastVertical", tab: "broadcast", label: "세로 지표", source: "daily", kind: "champion", prop: "observedChampions", context: "champion", all: true, layout: "vertical" },   // 라벨 개편(2026-08-27 "지표 순위"→"세로 지표" — 사이트와 동일 명칭)
  { key: "broadcastDist", tab: "broadcast", label: "승률 분포", source: "daily", kind: "champion", prop: "observedChampions", context: "champion", all: true, layout: "dist" },
  // ── 고/저 통합 → [전체](all:true, 접두어 없는 단일 표). 사이트 최근 패치 미러(2026-07-03). ──
  //   pool/prop은 이미 전체분포(고+저; 예 observedChampions 173=고86+저87)라 winRate 필터만 끄면(all:true) 전체가 나옴. concat 불필요. entity/counter는 side 생략 or all로 필터해제.
  { key: "observedChampion", tab: "champion", label: "챔피언", prop: "observedChampions", context: "champion", all: true }, // ★pool 미지정(의도적): 증강 observedChampion은 dailyReport.patch(observedSingleRows)를 써서 표=상세=목록 판수 일치(브랜드 basis 정합, scenario_audit brandApiAgree 가드). 챔피언은 pool(1357)≠dailyReport(1269)라 pool 쓰면 상세와 어긋남.
  { key: "observedChampionPair", tab: "champion", label: "챔피언쌍", prop: "observedChampionPairs", pool: "observedChampionPairs", context: "ChampionPair", all: true },
  { key: "entityTimeChampion", tab: "champion", label: "챔피언 시간대", source: "entity", entity: "championRows", context: "entityTimeChampion", all: true },
  { key: "observedAugment", tab: "second", label: { standard: "룬", augment: "증강" }, prop: "observedAugments", pool: "observedAugments", context: "augment", all: true },
  { key: "observedAugmentPair", tab: "second", label: { standard: "개인 룬쌍", augment: "개인 증강쌍" }, prop: "observedAugmentPairs", pool: "observedAugmentPairs", context: "AugmentPair", all: true },
  { key: "observedTeamAugmentPair", tab: "second", label: { standard: "팀 룬쌍", augment: "팀 증강쌍" }, prop: "observedTeamAugmentPairs", pool: "observedTeamAugmentPairs", context: "TeamAugmentPair", all: true },
  { key: "entityTimeAugment", tab: "second", label: { standard: "룬 시간대", augment: "증강 선택순서" }, source: "entity", entity: "augmentRows", context: "entityTimeAugment", all: true },
  { key: "observedItem", tab: "item", label: "아이템", prop: "observedItems", pool: "observedItems", context: "item", all: true },
  { key: "observedItemPair", tab: "item", label: "개인 아이템쌍", prop: "observedItemPairs", pool: "observedItemPairs", context: "ItemPair", all: true },
  { key: "observedTeamItemPair", tab: "item", label: "팀 아이템쌍", prop: "observedTeamItemPairs", pool: "observedTeamItemPairs", context: "TeamItemPair", all: true },
  { key: "entityTimeItem", tab: "item", label: "아이템 시간대", source: "entity", entity: "itemRows", context: "entityTimeItem", all: true },
  { key: "observedChampionAugment", tab: "combo", label: { standard: "챔피언+룬", augment: "챔피언+증강" }, prop: "observedChampionAugments", pool: "observedChampionAugments", context: "ChampionAugment", all: true },
  { key: "observedChampionItem", tab: "combo", label: "챔피언+아이템", prop: "observedChampionItems", pool: "observedChampionItems", context: "ChampionItem", all: true },
  { key: "observedAugmentItem", tab: "combo", label: { standard: "룬+아이템", augment: "증강+아이템" }, prop: "observedAugmentItems", pool: "observedAugmentItems", context: "AugmentItem", all: true },
  // 지표 분석(2026-09-03 사용자 지시, 사이트 순서 미러): 팀 룬(증강)·팀 아이템 분석 → 증강 제공 변동 5탭(증바람 전용).
  // ★2026-09-27 운영자 지시(사이트와 같이): 챔피언·룬(증강)·아이템 티어 분석 3표를 뗐다 — 세로 지표에 이미 들어 있다.
  //   계산(contribRows)은 그대로 둔다 — 세로 지표 오른쪽 빌드 패널(/api/build-panel)이 같은 계산을 쓴다.
  { key: "multiplicityManyAugment", tab: "analysis", label: { standard: "팀 룬 분석", augment: "팀 증강 분석" }, source: "multiplicity", kind: "augment", context: "augment" },
  { key: "multiplicityManyItem", tab: "analysis", label: "팀 아이템 분석", source: "multiplicity", kind: "item", context: "item" },
  // 증강 제공 변동 5탭(사이트 app_v2.js installAugmentDriftTabs 이식). 데이터 = /api/augdrift(augment-availability-season2.json 통째, 사이트 gen loop 가 매시간 갱신).
  //   행은 서버가 만들지 않는다(rows:[]) — 클라 renderAugDrift 가 JSON 을 받아 그린다. augmentOnly → 표준 모드에선 forbiddenStandardTable 이 뺀다.
  { key: "augDriftAug", tab: "analysis", label: "증강 별 확률 분석", source: "augdrift", drift: "aug", context: "augment", layout: "augdrift", augmentOnly: true },
  { key: "augDriftChamp", tab: "analysis", label: "챔피언 별 확률 분석", source: "augdrift", drift: "champ", context: "champion", layout: "augdrift", augmentOnly: true },
  { key: "augDriftProbAug", tab: "analysis", label: "증강-챔피언 확률 분석", source: "augdrift", drift: "probaug", context: "augment", layout: "augdrift", augmentOnly: true },
  { key: "augDriftProbChamp", tab: "analysis", label: "챔피언-증강 확률 분석", source: "augdrift", drift: "prob", context: "champion", layout: "augdrift", augmentOnly: true },
  { key: "augDriftSlot", tab: "analysis", label: "선택 순서 분석", source: "augdrift", drift: "slot", context: "augment", layout: "augdrift", augmentOnly: true },
  // (상대법 9표 제거 — 2026-08-24 사용자 결정. 데이터와 rowsForPublicTable 의 counter 읽기 분기는 그대로 둔다.)
]);
function forbiddenSeason2Table(def) {
  const haystack = `${def?.key || ""} ${def?.label || ""} ${def?.prop || ""} ${def?.pool || ""}`;
  return /synergy|시너지|recommendSynergy/i.test(haystack);
}
function forbiddenStandardTable(def) {
  if (def?.augmentOnly) return true; // 증강 제공 변동 5탭은 증바람 전용(라벨에 '증강'이 없는 것도 있어 명시 플래그로 뺀다)
  const label = String(def?.label || "");
  return /증강|시너지/.test(label) || /synergy|recommendSynergy/i.test(`${def?.key || ""} ${def?.prop || ""} ${def?.pool || ""}`);
}
function safeTableMode(mode) { return mode === "augment" ? "augment" : "standard"; }
function safeTableRange(range) { return TABLE_RANGES.some(r => r.key === range) ? range : "all"; }
function rangeSources(mode, range) {
  const table = RANGE_SOURCES[safeTableMode(mode)] || RANGE_SOURCES.standard;
  return table[safeTableRange(range)] || table.all;
}
function tableDefForMode(t, mode) {
  const m = safeTableMode(mode);
  return {
    ...t,
    tab: t.tab === "second" ? (m === "augment" ? "augment" : "rune") : t.tab,
    label: typeof t.label === "object" ? t.label[m] : t.label,
    mode: m
  };
}
function publicTableDefs(mode = "standard") {
  const m = safeTableMode(mode);
  return LIVE_PUBLIC_TABLE_BLUEPRINTS
    .map(t => tableDefForMode(t, m))
    .filter(def => m === "augment" ? !forbiddenSeason2Table(def) : !forbiddenStandardTable(def));
}
function publicTableTabs(mode = "standard") {
  const m = safeTableMode(mode);
  return TABLE_TABS_BY_MODE[m];
}
function publicTableDefByKey(mode, key) {
  return publicTableDefs(mode).find(t => t.key === key) || null;
}
function tableReportFile(mode, range) {
  const rep = rangeSources(mode, range).report;
  return safeTableMode(mode) === "augment" ? `report-public-${rep}-season2.json` : `standard-aram-cohort-${rep}.json`;
}
async function publicReport(mode, range) {
  const file = tableReportFile(mode, range);
  const data = await loadData(file);
  return { file, data, report: data.report || {}, generatedAt: data.report?.generatedAt || data.generatedAt || "" };
}
// ── 창 슬라이스(2026-08-24) ───────────────────────────────────────────────────────────────
//   시간대(entityTimePatternReport)·많을때(multiplicityRows)는 리포트 파일 한 벌 안에 "창"이 없다 —
//   전체 기간 1벌뿐이라, 기간 필터를 바꿔도 그 5개 표가 전혀 안 변했다(사용자 지목: "챔피언 시간대가 안 바뀐다").
//   사이트 생성기가 창별로 이미 계산해놓고 버리던 두 키를 사이드카로 쓰게 했고(am_generate_standard_aram_cohort_incremental
//   / am_build_augment_seasons), 여기서 그 파일을 읽어 덮는다.
//   ⚠️아직 배포되지 않은 배포본에선 파일이 없다 → 조용히 null 을 돌려 종전대로 전체 기간 값을 쓴다(빈 화면 금지).
function windowSliceFile(mode, range) {
  const pool = rangeSources(mode, range).pool;
  if (!pool || pool === "all") return "";   // 전체 = 리포트 본문에 이미 있음
  return safeTableMode(mode) === "augment" ? `window-slice-${pool}-season2.json` : `window-slice-${pool}.json`;
}
async function windowSlice(mode, range) {
  const file = windowSliceFile(mode, range);
  if (!file) return null;
  try {
    const data = await loadData(file);
    if (data && (data.entityTimePatternReport || data.multiplicityRows)) return { ...data, file };
    poolWarnOnce(`slice:${file}`, `[slice] ${file} 을 읽었지만 시간대·많을때 키가 없다 — 기간 필터가 그 표들에 안 먹는다(전체 기간 값 표시).`);
  } catch (e) {
    poolWarnOnce(`slice:${file}`, `[slice] ${file} 없음/로드 실패(${e && e.message}) — 아직 배포 전이면 정상. 그동안 시간대·많을때는 전체 기간 값.`);
  }
  return null;
}
// ★2026-07-22: 풀을 못 읽으면 예외를 삼키고 임베드 미리보기로 폴백하는데, 그게 화면엔 '정상 표'처럼 보였다.
//   폴백 자체는 유지(화면이 비는 것보단 낫다) — 대신 로그로 남겨 다음엔 조용히 지나가지 않게 한다.
const _poolWarned = new Set();
function poolWarnOnce(k, msg) { if (_poolWarned.has(k)) return; _poolWarned.add(k); console.warn(msg); }
async function publicPoolRows(mode, range, pool) {
  const poolRange = rangeSources(mode, range).pool;
  const names = mode === "augment"
    ? [`search-pool-${poolRange}-${pool}-season2.json`]
    : [`search-pool-${poolRange}-${pool}.json`];
  for (const file of names) {
    try {
      const data = await loadData(file);
      // ★2026-07-22: 샤딩 매니페스트(rows:[] + shards:[...])를 여기서 안 풀고 있었다. loadPool 에는 이미 있는 처리인데
      //   표 경로만 빠져서, 일반 칼바람 챔피언쌍이 all/last2Patches/last3Patches/recent28 네 범위에서 각각
      //   14,852·13,892·14,393·13,891행을 0행으로 읽고 임베드 미리보기(120캡)로 조용히 폴백하고 있었다. 사이트 클라와 동일하게 재조립한다.
      const rows = (data && data.sharded && Array.isArray(data.shards) && data.shards.length)
        ? (await Promise.all(data.shards.map(s => loadData(typeof s === "string" ? s : (s && (s.file || s.name))).then(p => (p && p.rows) || []).catch(() => [])))).flat()
        : (Array.isArray(data.rows) ? data.rows : []);
      if (rows.length) return { rows, file, generatedAt: data.generatedAt || "" };
      poolWarnOnce(file, `[pool] ${file} 을 읽었지만 0행 — 표가 임베드 미리보기(120캡)로 조용히 폴백한다.`);
    } catch (e) { poolWarnOnce(file, `[pool] ${file} 로드 실패(${e && e.message}) — 표가 임베드 미리보기로 폴백한다.`); }
  }
  return { rows: [], file: "", generatedAt: "" };
}
function recommendationRows(report, prop) {
  const rec = report.personalRecommendations || report.observedRecommendations || {};
  const rows = Array.isArray(rec[prop]) ? rec[prop] : [];
  // 28일 미등장 표식(stale28) 행은 표(목록) 표면에서 숨긴다(2026-08-26 사이트 선택 ① 미러 — 표식은 사이트 생성기가 얹음).
  //   이 함수는 표 빌더들의 공용 리더라 여기 한 곳이면 되고, 검색(loadPool)·상세(직접 read) 경로는 안 거치므로 조회는 그대로 나온다.
  return rows.filter(r => !(r && r.stale28));
}
function observedSingleKind(def) {
  const key = String(def?.key || "");
  if (!/^observed(Weak)?(Champion|Augment|Item)$/.test(key)) return "";
  if (/Champion/.test(key)) return "champion";
  if (/Item/.test(key)) return "item";
  return "augment";
}
// win = 선택된 기간의 dailyReport 창키. 안 주면 사이트 기본 창(all)부터 폴백 — 사이트 상세(resolveEntity)와 같은 표면을 읽는다.
function observedSingleBaseRows(report, kind, prop, win = "") {
  if (!kind) return [];
  const dr = report.dailyReport || {};
  const order = [win, "all", "patch", "week", "recent28", "recent14", "recent50"].filter(Boolean);
  let dailyRows = [];
  for (const w of order) {
    const rows = dr[w]?.types?.[kind]?.rows;
    if (Array.isArray(rows) && rows.length) { dailyRows = rows; break; }
  }
  const recRows = recommendationRows(report, prop);
  const rows = (Array.isArray(dailyRows) && dailyRows.length) ? dailyRows : recRows;
  return Array.isArray(rows) ? rows.slice() : [];
}
// 방송 리포트 4종 전용 행: dailyReport에서 "가장 풍부한" 윈도를 고른다.
//   두 모드가 채우는 윈도가 다르다 — 증강=patch만 채워짐(.all 빈값), 표준=현재패치(patch)가 전원 저표본이고
//   .all 윈도가 정상 티어 분포를 가짐. 따라서 patch만 보면 표준 보드가 통째로 "표본"으로 빠진다.
//   해법: 정상 티어(저표본 아님)가 있는 첫 윈도를 채택하고, 없으면 비지 않은 첫 윈도로 폴백. (기존 일반 표는 건드리지 않음)
function broadcastBaseRows(report, kind, prop, window) {
  if (!kind) return [];
  const dr = report.dailyReport;
  // 사용자가 기간 윈도(최근 28/14/7일 등)를 고르면 그 윈도를 우선(정상 티어가 있을 때만; 전부 저표본이면 아래 auto 폴백).
  if (dr && window) {
    const rows = dr[window]?.types?.[kind]?.rows;
    if (Array.isArray(rows) && rows.length) {
      const hasRealTier = rows.some(r => !r.lowSample && /^[1-5]$/.test(String(r.tier == null ? "" : r.tier)));
      if (hasRealTier) return rows.slice();
    }
  }
  const order = ["all", "patch", "week", "recent28", "recent14", "recent50", "recent7"];
  let fallback = [];
  if (dr) {
    for (const w of order) {
      const rows = dr[w]?.types?.[kind]?.rows;
      if (!Array.isArray(rows) || !rows.length) continue;
      const hasRealTier = rows.some(r => !r.lowSample && /^[1-5]$/.test(String(r.tier == null ? "" : r.tier)));
      if (hasRealTier) return rows.slice(); // 정상 티어가 있는 첫 윈도 채택
      if (!fallback.length) fallback = rows; // 전부 저표본이어도 첫 비지않은 윈도는 기억
    }
  }
  if (fallback.length) return fallback.slice();
  const rec = recommendationRows(report, prop);
  return Array.isArray(rec) ? rec.slice() : [];
}
function observedSingleRows(report, def, win = "") {
  const kind = observedSingleKind(def);
  // A5: 아이템 관측표만 사이트(app_v2.js)와 동일 전체 observed(observedRecommendations full)로 — patch윈도(273)는 구패치 아이템게임 누락해 entityTime(전체 291)·사이트와 어긋남. 챔피언/증강은 기존 patch윈도 유지(상세헤더·브랜드 basis 정합).
  const _full = kind === "item" ? recommendationRows(report, def.prop) : null;
  const rows = (Array.isArray(_full) && _full.length) ? _full : observedSingleBaseRows(report, kind, def.prop, win);
  const base = (Array.isArray(rows) ? rows : []).filter(r => Number(r.games || 0) >= 3);
  if (def.all) return base; // [전체](고/저 통합): winRate 미필터 = 전체 분포
  const lowSide = /Weak/.test(def.key || "");
  return base.filter(r => { const wr = Number(r.winRate || 0); return lowSide ? wr < 50 : wr >= 50; });
}
function publicChampionDetailRow(report, q, win = "") {
  const seen = new Set();
  const rows = [
    ...observedSingleBaseRows(report, "champion", "observedChampions", win),
    ...observedSingleBaseRows(report, "champion", "observedWeakChampions", win)
  ].filter(r => {
    const key = norm(firstText(r.key, r.label, r.localName, r.displayName, r.name, r.championName));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return rows.find(r => [r.label, r.localName, r.displayName, r.name, r.championName, r.key].some(v => norm(v) === q)) || null;
}
async function augmentChampionMetaFromReport() {
  try {
    const loaded = await publicReport("augment", "all");
    return observedSingleBaseRows(loaded.report, "champion", "observedChampions");
  } catch {
    return [];
  }
}
function sortEntityRows(rows, side) {
  let list = Array.isArray(rows) ? rows.slice() : [];
  list = list.filter(r => Number(r.games || 0) >= 3); // 1~2판 노이즈 제외
  // 고/저 분리(side): 고=승률≥50 엔티티들의 경기길이 패턴, 저=<50. (예전 버그: side 무시 → 고=저 동일)
  if (side === "high") list = list.filter(r => Number(r.winRate || 0) >= 50);
  else if (side === "low") list = list.filter(r => Number(r.winRate || 0) < 50);
  return list.sort((a, b) => Number(b.games || 0) - Number(a.games || 0));
}
function isAugmentOrderTable(def) {
  return def?.mode === "augment" && def?.context === "entityTimeAugment";
}
function augmentSlotBuckets(row = {}) {
  const stats = Array.isArray(row.slotStats) ? row.slotStats : [];
  return [1, 2, 3, 4].map(slot => {
    const stat = stats.find(x => Number(x?.slot || 0) === slot) || {};
    const games = Number(stat.games || 0);
    const wins = Number(stat.wins || 0);
    const losses = Number(stat.losses ?? Math.max(0, games - wins));
    const rawRate = Number(stat.winRate);
    const winRate = Number.isFinite(rawRate) ? rawRate : (games ? Number((wins / games * 100).toFixed(1)) : 0);
    return { key: `slot${slot}`, label: `${slot}번째`, order: slot, games, wins, losses, winRate };
  });
}
function augmentOrderRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    ...row,
    bucketKind: "augment-order",
    durationBuckets: augmentSlotBuckets(row),
    bestDuration: null,
    worstDuration: null,
    lateDelta: null
  }));
}
function timeSeriesRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => Number(r.games || 0) > 0).map(r => ({
    key: r.key,
    label: r.label || r.key,
    games: Number(r.games || 0),
    wins: Number(r.wins || 0),
    losses: Number(r.losses || 0),
    winRate: Number(r.winRate || 0),
    sampleShare: Number(r.sampleShare || 0)
  }));
}
function timePatternRows(report) {
  const t = report.timePatternReport || {};
  const rows = [
    { key: "time-winrate", label: "승률 그래프", graphKind: "winRate", series: timeSeriesRows(t.activeHour || t.startHour), summary: t.summary || null },
    { key: "time-sample", label: "표본 그래프", graphKind: "sample", series: timeSeriesRows(t.activeHour || t.startHour), summary: t.summary || null },
    { key: "time-trend", label: "추이 그래프", graphKind: "trend", series: timeSeriesRows(t.durationMinute), summary: t.summary || null }
  ];
  return rows.map(row => ({ ...row, games: Number(t.games || 0), timezone: t.timezone || "Asia/Seoul" }));
}
function multiplicityRows(report, kind, modeName) {
  const m = report.multiplicityRows || {};
  const iconFor = row => {
    const key = row.key ?? row.asset?.key ?? row.asset?.id;
    return row.asset?.icon || row.icon
      || (kind === "item" ? itemIconUrl(key) : "")
      || (kind === "augment" && modeName === "standard" ? runeIconUrl(key) : "");
  };
  return [...(m.allRows || [])]  // ★사이트 multiplicityRowsForTable와 동일 소스=allRows. manyGood/manyBad는 부분집합이라 마법미사일 등 고-multiGames 항목이 누락됐음(사이트와 불일치 원인).
    .filter(row => !kind || row.kind === kind)
    .map(row => ({
      ...row,
      label: row.label || entityText(row.asset),
      icon: iconFor(row),
      id: Number(row.key != null ? row.key : String(row.id || "").split(":").pop()) || null, // 상세 클릭용 숫자 id. 원본 id는 "item:6676"·"augment:133"류 접두문자열이라 클릭 시 상세 API가 Number()→NaN 됐음. key(숫자) 우선, 없으면 접두 제거. 라우팅 kind는 defNavKind이 모드별(item/증강→augment/표준→rune) 처리.
      games: Number(row.games || 0), // 표본 = 총 출현 판수(1~5개 버킷합과 일치). 전엔 multiGames(2명+만)를 표본으로 찍어 "표본 85 vs 1개버킷 574" 모순 → 망각의구 659=574+83+2로 일관. multi수치는 ...row로 보존돼 verdict에 사용.
      wins: Number(row.wins || 0),
      losses: Number(row.losses || 0),
      winRate: Number(row.winRate ?? 0),
      selectionRate: row.trendDelta ?? null,
      durationBuckets: [1, 2, 3, 4, 5].map(n => ({
        key: String(n),
        label: n === 5 ? "5개+" : `${n}개`,
        games: Number(row[["", "one", "two", "three", "four", "five"][n] + "Games"] || 0),
        wins: Number(row[["", "one", "two", "three", "four", "five"][n] + "Wins"] || 0),
        winRate: Number(row[["", "one", "two", "three", "four", "five"][n] + "WinRate"] || 0)
      })).filter(x => x.games > 0)
    }))
    .filter(row => Number(row.multiGames || 0) > 0) // ★사이트와 동일: 동시출현(2명+)이 1판이라도 있으면 포함(multiGames>0). 표본열은 총 출현판수.
    .sort((a, b) => (Number(b.multiGames || 0) - Number(a.multiGames || 0)) || (b.games - a.games) || (b.winRate - a.winRate)); // ★사이트 정본 정렬 = multiGames(동시출현) 내림차순(app_v2.js 5361). games순 아님 → 마법미사일(multiGames1313) 1등, 처형시간 아님.
}
function entityAllRows(report) {
  const e = report.entityTimePatternReport || {};
  return [
    ...(e.championRows || []).slice(0, 20),
    ...(e.augmentRows || []).slice(0, 20),
    ...(e.itemRows || []).slice(0, 20)
  ];
}
// ── 상대법(counter) ─────────────────────────────────────────────────────────────
//   데이터 위치: 표준=별도 파일 standard-aram-counter-{range}.json(top-level에 subjects/champEnemyMeta/itemMeta/runeMeta 직접),
//                증강=publicReport(...).report.counterRows(동형 + augmentMeta).
//   메타 해석(전부 데이터 기반, 손코딩 금지):
//     champEnemyMeta 키 = 전체키("champion:오른"), itemMeta/runeMeta/augmentMeta 키 = 베어ID("2065"/"8005"/"1045").
//   주체키: 챔프=한글(표준)/라틴(증강), 아이템="item:2503", 룬="rune:8128", 증강="augment:1045".
//   enemyKey: "champion:오른"|"item:2065"|"rune:8005"|"augment:N" → type:id 파싱.
// ★2026-07-22 증바람 상대법 복구: 사이트가 q2400 의 counterRows 를 코어 리포트에서 떼어내
//   report-public-{range}-season2-pools.json 슬라이스로 분리했다(app_v2 amHydrateAugmentPools 가 그 파일을 받아 report 에 병합).
//   컴패니언은 여전히 report.counterRows 만 보고 있어서 증강 모드 상대법 9개 표가 통째로 비어 있었다.
//   사이트와 같은 파일을 같은 이름으로 읽는다. 슬라이스엔 expectedWinReport/teamPowerReport 도 들어 있어 76MB인데
//   여기서 필요한 건 counterRows 뿐이므로, 뽑아서 따로 들고 원본은 메모리에서 즉시 놓아준다.
const counterRootMem = new Map(); // `${mode}:${range}` → { cr, sourceFile, generatedAt, at }
async function loadCounterRoot(mode, range) {
  const src = rangeSources(mode, range);
  if (mode === "augment") {
    const ck = `augment:${src.report}`;
    const hit = counterRootMem.get(ck);
    if (hit && Date.now() - hit.at < TTL_MS) return { cr: hit.cr, sourceFile: hit.sourceFile, generatedAt: hit.generatedAt };
    const loaded = await publicReport("augment", range);
    if (loaded.report && loaded.report.counterRows) return { cr: loaded.report.counterRows, sourceFile: loaded.file, generatedAt: loaded.generatedAt }; // 모놀리스(구 canonical)면 그대로
    const poolsFile = `report-public-${src.report}-season2-pools.json`;
    try {
      const pools = await loadData(poolsFile);
      const root = (pools && pools.report) ? pools.report : pools;
      const cr = root && root.counterRows;
      if (cr && typeof cr === "object") {
        dataMemDrop(poolsFile); // 슬라이스 통째(76MB)를 캐시에 붙들지 않는다 — counterRows 만 아래 캐시가 들고 있는다
        const entry = { cr, sourceFile: poolsFile, generatedAt: root.generatedAt || loaded.generatedAt || "", at: Date.now() };
        counterRootMem.set(ck, entry);
        for (const k of counterRootMem.keys()) { if (counterRootMem.size <= 2) break; if (k !== ck) counterRootMem.delete(k); } // 범위 2개까지만 상주
        return { cr: entry.cr, sourceFile: entry.sourceFile, generatedAt: entry.generatedAt };
      }
    } catch {}
    return { cr: {}, sourceFile: loaded.file, generatedAt: loaded.generatedAt };
  }
  const file = `standard-aram-counter-${src.pool}.json`;   // 기간별 파일이 실제로 배포된다(all/recent28/recent14)
  const cr = await loadData(file); // 표준은 top-level이 곧 cr
  return { cr: cr || {}, sourceFile: file, generatedAt: cr?.generatedAt || "" };
}
// ★2026-07-22: 주체 이름/아이콘의 정본은 pickers 다. itemMeta/runeMeta/champEnemyMeta 는 "상대(enemy)로 등장한 키"에서만
//   수확되므로(search.js buildCounterExportPayload), 주체로만 나오고 상대로는 안 나온 항목이 통째로 빠진다.
//   실측: standard 'all' 범위에서 아이템 주체 115개 중 14개(헤르메스의 발걸음 125,645판·마법사의 신발·무한의 대검·
//   라바돈·존야·리안드리 등, 합계 770,481판)가 메타 없음으로 조용히 버려지고 있었다. pickers 는 전 주체 100% 이름·아이콘 보유.
//   사이트도 주체 라벨을 pickers 로 그린다 — 여기를 맞추는 게 사이트 미러다.
function counterPickerMeta(cr, subjectKey, subjectType) {
  const list = (cr.pickers || {})[subjectType];
  if (!Array.isArray(list) || !list.length) return null;
  if (!cr._pickIdx) Object.defineProperty(cr, "_pickIdx", { value: {}, enumerable: false, configurable: true }); // 주체 수백 개 × 표마다 선형탐색 방지
  let idx = cr._pickIdx[subjectType];
  if (!idx) { idx = new Map(); for (const p of list) if (p && p.key != null) idx.set(String(p.key), p); cr._pickIdx[subjectType] = idx; }
  const hit = idx.get(String(subjectKey));
  return (hit && hit.name && hit.icon) ? { name: String(hit.name), icon: String(hit.icon) } : null;
}
// 주체(subject) 이름/아이콘 = pickers 정본 → 없으면 주체유형별 메타 폴백.
function counterSubjectMeta(cr, subjectKey, subjectType) {
  const picked = counterPickerMeta(cr, subjectKey, subjectType);
  if (picked) return picked;
  if (subjectType === "champion") {
    const hit = (cr.champEnemyMeta || {})["champion:" + subjectKey];
    return hit ? { name: hit.name || hit.localName || "", icon: String(hit.icon || "") } : null;
  }
  if (subjectType === "item") {
    const id = String(subjectKey).replace(/^item:/, "");
    const hit = (cr.itemMeta || {})[id];
    return hit ? { name: hit.name || hit.localName || "", icon: String(hit.icon || "") } : null;
  }
  if (subjectType === "rune") {
    const id = String(subjectKey).replace(/^rune:/, "");
    const hit = (cr.runeMeta || {})[id];
    return hit ? { name: hit.name || hit.localName || "", icon: String(hit.icon || "") } : null;
  }
  // augment
  const id = String(subjectKey).replace(/^augment:/, "");
  const hit = (cr.augmentMeta || {})[id];
  return hit ? { name: hit.name || hit.localName || "", icon: String(hit.icon || "") } : null;
}
// 상대(enemy) 이름/아이콘 = enemyKey "type:id" 파싱 후 해당 메타 조회.
function counterEnemyMeta(cr, enemyKey) {
  const raw = String(enemyKey || "");
  const idx = raw.indexOf(":");
  if (idx < 0) return null;
  const type = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (type === "champion") {
    const hit = (cr.champEnemyMeta || {})[raw]; // 전체키
    return hit ? { name: hit.name || hit.localName || "", icon: String(hit.icon || "") } : null;
  }
  if (type === "item") {
    const hit = (cr.itemMeta || {})[id];
    return hit ? { name: hit.name || hit.localName || "", icon: String(hit.icon || "") } : null;
  }
  if (type === "rune") {
    const hit = (cr.runeMeta || {})[id];
    return hit ? { name: hit.name || hit.localName || "", icon: String(hit.icon || "") } : null;
  }
  if (type === "augment") {
    const hit = (cr.augmentMeta || {})[id];
    return hit ? { name: hit.name || hit.localName || "", icon: String(hit.icon || "") } : null;
  }
  return null;
}
function counterRowsForTable(cr, mode, def) {
  const secondType = mode === "augment" ? "augment" : "rune";
  const subjectType = def.subjectType === "second" ? secondType : def.subjectType;
  const enemyField = def.enemyField === "vsSecond"
    ? (mode === "augment" ? "vsAugment" : "vsRune")
    : def.enemyField;
  const subjects = (cr.subjects || {})[subjectType] || {};
  const lowSide = def.side === "low";
  const out = [];
  let dropped = 0; // 계약 자체검사 — 주체가 통째로 사라지는 회귀(2026-07-22)가 예외도 로그도 없이 지나갔던 게 발견이 늦은 이유다
  for (const subjectKey of Object.keys(subjects)) {
    const subjMeta = counterSubjectMeta(cr, subjectKey, subjectType);
    if (!subjMeta || !subjMeta.name || !subjMeta.icon) { dropped++; continue; } // 메타 못 찾은 주체 스킵(이름·아이콘 없으면 깨짐)
    const list = Array.isArray(subjects[subjectKey]?.[enemyField]) ? subjects[subjectKey][enemyField] : [];
    for (const r of list) {
      const games = Number(r.games || 0);
      if (games < 2) continue; // 최소표본(증강 희소 대응, 사이트 게이트와 정합)
      const winRate = Number(r.winRate || 0); // 사이트와 동일: raw winRate로 고/저 가름
      if (!def.all && (lowSide ? !(winRate < 50) : !(winRate >= 50))) continue; // [전체](all)=고/저 미필터
      const enemyMeta = counterEnemyMeta(cr, r.enemyKey);
      if (!enemyMeta || !enemyMeta.name || !enemyMeta.icon) continue; // 메타 못 찾은 상대 스킵(유령 행 방지)
      out.push({
        key: `${subjectType}|${subjectKey}|${r.enemyKey}`,
        label: `${subjMeta.name} ▶ ${enemyMeta.name}`,
        leftLabel: subjMeta.name,
        rightLabel: enemyMeta.name,
        icon: subjMeta.icon,
        rightIcon: enemyMeta.icon,
        icons: [subjMeta.icon, enemyMeta.icon],
        games,
        winRate
      });
    }
  }
  if (dropped) counterWarnOnce(`${mode}:${subjectType}`, `[counter] 주체 ${Object.keys(subjects).length}개 중 ${dropped}개가 이름·아이콘을 못 찾아 표에서 빠짐(mode=${mode} type=${subjectType}). 데이터 계약이 바뀌었을 수 있음.`);
  return out;
}
const _counterWarned = new Set();
function counterWarnOnce(key, msg) { if (_counterWarned.has(key)) return; _counterWarned.add(key); console.warn(msg); } // 사용자 화면엔 안 띄우고 로그에만(요청당 반복 금지)
// ── 티어 분석(적합도) — 사이트 contrib 이식. 풀에서 엔티티별 좌/우 기여자 조립. 증강모드 우측=증강 / 일반모드 우측=룬(절대 안 섞음). ──
// 2026-08-27 적합도 미러(사이트 app_v2.js rankVerdict/rankScore와 동일 산식). ⚠️선별(prep 쿼터)도 이 기준을 써야 한다 —
//   옛 |기여| 크기순으로 선별하면 클라가 적합도로 재정렬해도 후보 자체가 사이트와 달라진다(2026-08-27 베인 증강 꼬리 불일치 사고).
const CONTRIB_K = 20, FIT_TOL = 1.0, FIT_MIN_G = 30, FIT_K = 200;   // FIT_K: 적합도 EB 절반 신뢰점 200판(니달리 요행픽 참사 방지, 사이트 RANK_K 동일)
function contribImpact(c) { const g = Number(c.games) || 0; return g * ((Number(c.winRate) || 0) - 50) * g / (g + CONTRIB_K); }
const fitErr = g => FIT_TOL + (g > 0 ? 50 / Math.sqrt(g) : 50);
function fitVerdict(c, base) {
  // 9차+니달리 수정(2026-08-27, 사이트 rankVerdict와 동일): 초록 = [검증된 픽 통과(≥평균−1%p) 또는 확실한 승리(>50%+오차)] ∧ 방향 양수.
  //   방향 = max(50% 대비, 통과선(평균−1%p) 대비) — 저승률 챔프 코어가 회색으로 몰리는 것 방지.
  const g = Number(c.games) || 0, w = Number(c.winRate) || 0, b = (Number.isFinite(base) && base > 0) ? base : 50, e = fitErr(g);
  if (g < FIT_MIN_G) return 0;
  const d = Math.max(w - 50, w - (b - FIT_TOL));
  if (d > 0 && (w >= b - FIT_TOL || w > 50 + e)) return 1;
  if (w < b - e) return -1;
  return 0;
}
function fitScore(c, base) {
  const v = fitVerdict(c, base);
  if (!v) return 0;
  const g = Number(c.games) || 0, w = Number(c.winRate) || 0, b = (Number.isFinite(base) && base > 0) ? base : 50;
  const d = v > 0 ? Math.max(w - 50, w - (b - FIT_TOL)) : Math.min(w - 50, w - b);
  return g * d * g / (g + FIT_K);
}
const fitCmp = base => (a, b) => (fitScore(b, base) - fitScore(a, base)) || ((Number(b.games) || 0) - (Number(a.games) || 0));

/* ═══ 잘 맞는 아군 = "둘이 같이 있을 때만 더 이기는 몫"(궁합) — 2026-09-18 사용자 결정 ═══
   ⚠️ 사이트 app_v2.js 의 amAllySynergy 와 **같은 식 한 벌**이다(상수·반복·게이트 전부 동일). 한쪽만 고치지 마라.
   왜 바꿨나: 종전 순서(적합도 9차)는 "그 아군과 같이 있던 판의 승률"에서 내 평균(또는 50%)만 뺐다.
     그 승률에는 아군이 원래 센 만큼이 그대로 들어 있어서 무엇을 빼든 센 챔피언이 위로 왔다
     (실측 2026-09-18 증바람 28일 200만 판: 상위 3칸의 61%가 전체 승률 20위 안 · 쌍 승률 분산의 86%가 개인 실력).
   무엇을 하나: 그 기간 쌍 풀 전체에 판수 가중 가법 2원 모형 logit(쌍 승률) = mu + a[A] + a[B] 를 맞춰
     두 챔피언 개인 몫을 빼고 남는 차이를 궁합으로 쓴다. 표본 잡음은 경험 베이즈 수축으로 줄인다.
   ⚠️ 고정표가 아니다 — 풀이 바뀌면 매번 다시 맞춘다. 못 받치면 null → 호출부가 종전 적합도 순서로 간다.
     게이트 실측(2026-09-18): 증바람 전체 신뢰중앙 0.83 → 적용 / 일반 칼바람 0.042·문턱통과 0쌍 → 종전 유지. */
const SYN_MIN_GAMES = 200, SYN_MIN_PAIRS = 300, SYN_MIN_SIGMA = 0.004, SYN_MIN_REL = 0.5, SYN_ITER = 60, SYN_EPS = 1e-9;
const _synCache = new WeakMap();
function pairSides(r) {   // 스키마가 모드마다 다름(q2400 championKeys 영문 · q450 championName/rightLabel 한글)
  const kk = Array.isArray(r && r.championKeys) ? r.championKeys : null;
  if (kk && kk.length >= 2 && kk[0] && kk[1]) return [String(kk[0]), String(kk[1])];
  const cs = Array.isArray(r && r.champions) ? r.champions : [];
  const a = cs[0] && (cs[0].name || cs[0].localName || cs[0].displayName);
  const b = cs[1] && (cs[1].name || cs[1].localName || cs[1].displayName);
  if (a && b) return [String(a), String(b)];
  const l = r && (r.leftKey || r.championName || r.leftLabel), g = r && (r.rightKey || r.rightLabel);
  return (l && g) ? [String(l), String(g)] : null;
}
function amAllySynergy(pool) {
  if (!Array.isArray(pool) || !pool.length) return null;
  if (_synCache.has(pool)) return _synCache.get(pool);
  let out = null;
  try {
    const idx = new Map(), A = [], B = [], G = [], Y = [], PR = [], KEY = [];
    for (const r of pool) {
      const g = Number(r && r.games) || 0; if (!(g >= SYN_MIN_GAMES)) continue;
      const w = (r.wins != null) ? (Number(r.wins) || 0) : Math.round((Number(r.winRate) || 0) / 100 * g);
      const p = w / g; if (!(p > 0 && p < 1)) continue;
      const sd = pairSides(r); if (!sd || sd[0] === sd[1]) continue;
      if (!idx.has(sd[0])) idx.set(sd[0], idx.size);
      if (!idx.has(sd[1])) idx.set(sd[1], idx.size);
      A.push(idx.get(sd[0])); B.push(idx.get(sd[1])); G.push(g); Y.push(Math.log(p / (1 - p))); PR.push(p); KEY.push(String(r.key));
    }
    const n = A.length, m = idx.size;
    if (n >= SYN_MIN_PAIRS && m >= 2) {
      const al = new Float64Array(m), nu = new Float64Array(m), de = new Float64Array(m);
      let mu = 0, tw = 0;
      for (let i = 0; i < n; i++) { mu += G[i] * Y[i]; tw += G[i]; }
      mu /= tw;
      for (let it = 0; it < SYN_ITER; it++) {
        nu.fill(0); de.fill(0);
        for (let i = 0; i < n; i++) {
          const a = A[i], b = B[i], g = G[i], y = Y[i];
          nu[a] += g * (y - mu - al[b]); de[a] += g;
          nu[b] += g * (y - mu - al[a]); de[b] += g;
        }
        let sh = 0, sw = 0, mx = 0;
        for (let k = 0; k < m; k++) { const v = de[k] ? nu[k] / de[k] : 0; const d = Math.abs(v - al[k]); if (d > mx) mx = d; al[k] = v; sh += v * de[k]; sw += de[k]; }
        const me = sh / sw;
        for (let k = 0; k < m; k++) al[k] -= me;
        mu += 2 * me;
        if (mx < SYN_EPS) break;
      }
      const dl = new Float64Array(n), vr = new Float64Array(n);
      let sD = 0, sV = 0;
      for (let i = 0; i < n; i++) {
        const pe = 1 / (1 + Math.exp(-(mu + al[A[i]] + al[B[i]])));
        dl[i] = PR[i] - pe; vr[i] = pe * (1 - pe) / G[i];
        sD += dl[i] * dl[i]; sV += vr[i];
      }
      const s2 = Math.max(0, (sD - sV) / n);
      const rel = []; for (let i = 0; i < n; i++) rel.push(s2 / (s2 + vr[i]));
      rel.sort((x, y) => x - y);
      if (Math.sqrt(s2) >= SYN_MIN_SIGMA && rel[Math.floor(rel.length / 2)] >= SYN_MIN_REL) {
        const map = new Map();
        for (let i = 0; i < n; i++) map.set(KEY[i], dl[i] * s2 / (s2 + vr[i]));
        out = map;
      }
    }
  } catch { out = null; }
  _synCache.set(pool, out);
  return out;
}
function contribTierMap(report, type) {
  const dr = (report && report.dailyReport) || {};
  let win = null;
  for (const k of ["all", "patch", "week", "recent50", "latestDay"]) { if (dr[k] && dr[k].types) { win = dr[k]; break; } }
  if (!win) for (const k of Object.keys(dr)) { if (dr[k] && dr[k].types) { win = dr[k]; break; } }
  const td = (win && win.types && win.types[type]) || {};
  const m = new Map();
  for (const r of (td.rows || [])) {
    if (!r || !r.tier) continue;
    if (type === "champion") { for (const t of [norm(r.key), norm(r.localName), norm(r.label), norm(r.name)]) if (t && !m.has(t)) m.set(t, Number(r.tier)); }
    else { const k = String(r.key != null ? r.key : (r.id != null ? r.id : "")); if (k) m.set(k, Number(r.tier)); }
  }
  return m;
}
// panel = {key} 이면 그 엔티티 하나의 좌/우 기여자를 **전량**(캡 없음) 반환 — 세로데이터 우측 빌드패널용.
//   사이트 amBuildPanelData(app_v2.js:33563)와 동일 계약: 좌/우 두 축을 통틀어 maxImpact 하나로 정규화해
//   탭을 바꿔도 막대가 재스케일되지 않게 한다.
async function contribRows(mode, range, type, panel) {
  const sfx = mode === "augment" ? "-season2" : "";
  const P = n => loadPool(`search-pool-${rangeSources(mode, range).pool}-${n}${sfx}.json`);
  const [oc, ci, ca, ai, oi, oa, loaded] = await Promise.all([
    P("observedChampions"), P("observedChampionItems"), P("observedChampionAugments"), P("observedAugmentItems"),
    P("observedItems"), P("observedAugments"), publicReport(mode, range)
  ]);
  const push = (m, k, v) => { if (!k) return; const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  // 양 스키마 대응: season2={championKey,itemKey,item{}} / 표준={key:"champion:한글|item:6698", championName(한글), itemName, icon}. key에서 id추출 + 한글명 정규화 키.
  const keyPart = (key, kind) => { const m = String(key || "").match(new RegExp("(?:^|\\|)" + kind + ":([^|]+)")); return m ? m[1] : ""; };
  const ckeyOf = r => norm(r.championLocalName || r.championName || keyPart(r.key, "champion") || "");
  const itemIdOf = r => String(r.itemKey != null ? r.itemKey : ((r.item && r.item.id) != null ? r.item.id : keyPart(r.key, "item")));
  const augIdOf = r => String(r.augmentKey != null ? r.augmentKey : ((r.augment && r.augment.id) != null ? r.augment.id : (keyPart(r.key, "rune") || keyPart(r.key, "augment"))));
  const itName = r => (r.item && (r.item.localName || r.item.name)) || r.itemName || r.rightLabel || "";
  const auName = r => (r.augment && (r.augment.localName || r.augment.name || r.augment.displayName)) || r.augmentName || r.leftLabel || r.rightLabel || "";
  const cName = r => r.championLocalName || r.championName || keyPart(r.key, "champion") || "";
  // ⚠️표준 풀의 r.icon은 챔피언 아이콘(행이 챔피언 기준)이라 그대로 쓰면 모든 아이템·룬이 챔피언 얼굴로 뜸 → id로 정확한 아이콘 조회(증강은 item/augment.icon 폴백, 파편은 shardIcon).
  const itemIcon = new Map(), runeIcon = new Map(), champIcon = new Map();
  for (const r of oi) itemIcon.set(String(r.id != null ? r.id : r.key), r.icon || "");
  for (const r of oa) { const k = String(r.id != null ? r.id : r.key); runeIcon.set(k, r.icon || shardIcon(k)); }
  for (const r of oc) champIcon.set(norm(r.localName || r.name || ""), r.icon || "");
  const itIcon = (id, r) => itemIcon.get(String(id)) || (r && r.item && r.item.icon) || "";
  const auIcon = (id, r) => runeIcon.get(String(id)) || (r && r.augment && r.augment.icon) || shardIcon(id) || "";
  const chIcon = (ck, r) => champIcon.get(ck) || (r && r.championIcon) || "";
  const champItem = new Map(), itemByChamp = new Map(), champAug = new Map(), augByChamp = new Map(), augByItem = new Map(), itemByAug = new Map();
  for (const r of ci) {
    const ck = ckeyOf(r), g = Number(r.games) || 0, wr = Number(r.winRate) || 0, itId = itemIdOf(r);
    push(champItem, ck, { id: itId, label: itName(r) || itId, icon: itIcon(itId, r), games: g, winRate: wr });
    push(itemByChamp, itId, { id: ck, label: cName(r) || ck, icon: chIcon(ck, r), games: g, winRate: wr });
  }
  for (const r of ca) {
    const ck = ckeyOf(r), g = Number(r.games) || 0, wr = Number(r.winRate) || 0, auId = augIdOf(r);
    push(champAug, ck, { id: auId, label: auName(r) || auId, icon: auIcon(auId, r), games: g, winRate: wr });
    push(augByChamp, auId, { id: ck, label: cName(r) || ck, icon: chIcon(ck, r), games: g, winRate: wr });
  }
  for (const r of ai) {
    const auId = String(r.leftKey != null ? r.leftKey : augIdOf(r)), itId = String(r.rightKey != null ? r.rightKey : itemIdOf(r)), g = Number(r.games) || 0, wr = Number(r.winRate) || 0;
    push(augByItem, auId, { id: itId, label: itName(r) || itId, icon: itIcon(itId, r), games: g, winRate: wr });
    push(itemByAug, itId, { id: auId, label: auName(r) || auId, icon: auIcon(auId, r), games: g, winRate: wr });
  }
  const bootsSet = new Set(["1001", "2422", "3006", "3008", "3009", "3010", "3013", "3020", "3047", "3111", "3117", "3158", "3171", "3172", "3173"]); // 사이트 AM_BOOTS_ITEM_IDS 시드(표준풀엔 tags 없어 tags만으론 신발 미검출) + 아래 tags 보강
  for (const r of oi) if (Array.isArray(r.tags) && r.tags.includes("Boots")) bootsSet.add(String(r.id != null ? r.id : r.key));
  const isBoots = c => bootsSet.has(String(c.id)) || /군화|장화|신발|발걸음$/.test(String(c.label || ""));
  const wrOf = r => { const g = Number(r.games) || 0; return Number.isFinite(Number(r.winRate)) ? Number(r.winRate) : (g ? (Number(r.wins) || 0) / g * 100 : 0); };
  let entities;
  if (type === "champion") entities = oc.map(r => ({ id: String(r.id != null ? r.id : (r.championId != null ? r.championId : "")), key: String(r.key != null ? r.key : (r.id != null ? r.id : "")), nkey: norm(r.localName || r.name || ""), label: r.localName || r.name || "-", icon: r.icon || "", games: Number(r.games) || 0, winRate: wrOf(r) }));
  else if (type === "item") entities = oi.map(r => ({ id: String(r.id != null ? r.id : (r.key || "")), label: r.localName || r.name || "-", icon: r.icon || "", games: Number(r.games) || 0, winRate: wrOf(r) }));
  else entities = oa.map(r => ({ id: String(r.id != null ? r.id : (r.key || "")), label: r.localName || r.displayName || r.name || "-", icon: r.icon || shardIcon(r.id != null ? r.id : r.key) || "", games: Number(r.games) || 0, winRate: wrOf(r) }));
  const rightKind = mode === "augment" ? "augment" : "rune", rightLbl = mode === "augment" ? "증강" : "룬";
  const colsFor = e => {
    if (type === "item") return { left: { label: "챔피언", kind: "champion", arr: itemByChamp.get(e.id) || [] }, right: { label: rightLbl, kind: rightKind, arr: itemByAug.get(e.id) || [] } };
    if (type === "augment") return { left: { label: "챔피언", kind: "champion", arr: augByChamp.get(e.id) || [] }, right: { label: "아이템", kind: "item", arr: augByItem.get(e.id) || [] } };
    return { left: { label: "아이템", kind: "item", arr: champItem.get(e.nkey) || [] }, right: { label: rightLbl, kind: rightKind, arr: champAug.get(e.nkey) || [] } };
  };
  const tierm = contribTierMap(loaded.report, type);
  const RUNE_SHARD_IDS = new Set(["5001", "5005", "5007", "5008", "5010", "5011", "5013"]);
  const runeOrderRank = r => { if (!r) return 0; const id = String(r.id != null ? r.id : r.key != null ? r.key : ""); const sk = String(r.sourceKind || "").toLowerCase(), c = String(r.runeCategory || "").toLowerCase(), slot = Number(r.runeSlot || r.slot || 0), rar = String(r.rarity || ""); if (sk === "rune-shard" || c === "shard" || slot >= 7 || RUNE_SHARD_IDS.has(id) || rar === "파편") return 2; if (c === "main" || slot === 1) return 0; if (c === "sub") return 1; return 0; }; // 사이트 amRuneOrderRank 미러(메인0/하위1/파편2)
  const runeRankMap = new Map();
  if (mode !== "augment") for (const r of oa) runeRankMap.set(String(r.id != null ? r.id : r.key), runeOrderRank(r)); // 표준모드 룬만 구조화(증강모드=main/sub/shard 없음 → 미적용)
  // ── prep = "화면에 실제로 그려지는 것만" 보낸다 ────────────────────────────────────────────
  //   클라(index.html contribCol)는 받은 배열을 **적합도(amFitCmp)** 순으로 재정렬한 뒤
  //   버킷 쿼터로 뽑는다: 아이템=신발3+비신발7 / 룬=메인3·하위4·파편3 / 그 외=10 → 한쪽당 최대 10칸.
  //   서버 선별도 같은 적합도 기준(fitCmp)이어야 후보 집합이 사이트와 일치한다(2026-08-27).
  const CONTRIB_VIEW_QUOTA = Object.freeze({ item: [3, 7], rune: [3, 4, 3], other: 10 });
  const impactAt = (c, base) => { const g = Number(c.games) || 0; const b = (Number.isFinite(base) && base > 0) ? base : 50; return g * ((Number(c.winRate) || 0) - b) * g / (g + CONTRIB_K); };
  const runeBucket = c => { const rr = runeRankMap.get(String(c.id)); return (rr === 0 || rr === 1 || rr === 2) ? rr : 1; };
  const prep = (arr, kind, entityWr) => {
    // 2026-08-27: 선별 기준 = 적합도(fitCmp, 사이트와 동일). 옛 |기여| 크기순 선별은 사이트와 다른 후보를 보내
    //   베인 증강 꼬리가 갈렸다(사이트: 영혼 흡수·탭 댄서 / 컴패니언: 치명적 가속·징수의 총 업그레이드 — 실측).
    const sorted = (arr || []).slice().sort(fitCmp(entityWr));
    let sub;
    if (kind === "item") { const bt = [], nn = []; for (const x of sorted) (isBoots(x) ? bt : nn).push(x); sub = bt.slice(0, CONTRIB_VIEW_QUOTA.item[0]).concat(nn.slice(0, CONTRIB_VIEW_QUOTA.item[1])); }
    else if (kind === "rune") { const b = [[], [], []]; for (const x of sorted) b[runeBucket(x)].push(x); sub = b[0].slice(0, CONTRIB_VIEW_QUOTA.rune[0]).concat(b[1].slice(0, CONTRIB_VIEW_QUOTA.rune[1])).concat(b[2].slice(0, CONTRIB_VIEW_QUOTA.rune[2])); }
    else sub = sorted.slice(0, CONTRIB_VIEW_QUOTA.other);
    return sub.map(c => { const o = { id: c.id, label: c.label, icon: c.icon, games: c.games, winRate: c.winRate, impact: Math.round(Math.abs(impactAt(c, entityWr))) }; if (kind === "item") o.isBoots = isBoots(c); if (kind === "rune") o.runeRank = runeBucket(c); return o; });
  };
  // ⚠️ Number(null)===0 이라 무티어(null)가 S티어(1)보다 앞으로 정렬되던 결함 수정 — 무티어는 뒤로(9).
  //    :942 가 티어를 못 찾으면 항상 null 을 넣으므로 이 분기가 실제로 탄다(q2400 증강 2개 실측: 무티어가 1·2위 점유).
  const tr = t => { if (t == null) return 9; const n = Number(t); return Number.isFinite(n) ? n : 9; };
  // ── 세로데이터 우측 빌드패널: 엔티티 1개 · 좌/우 전량 ───────────────────────────────────
  if (panel && panel.key != null && String(panel.key) !== "") {
    const nk = norm(String(panel.key)), nn = norm(String(panel.name || ""));
    // 세로데이터 행(dailyReport)과 여기 entities(pool)는 소스가 달라 id 체계가 어긋날 수 있다 → id 우선, 이름 폴백.
    const e = entities.find(x => type === "champion"
      ? (norm(x.nkey || "") === nk || norm(x.label || "") === nk || norm(x.key || "") === nk)
      : (String(x.id) === String(panel.key) || String(x.key || "") === String(panel.key) || norm(x.label || "") === nk || (nn && norm(x.label || "") === nn)));
    if (!e) return { ok: true, mode, type, found: false, cols: [] };
    const ewr = Number(e.winRate) || 50;
    const full = (arr, kind) => (arr || []).slice()
      .sort((a, b) => ((Number(b.games) || 0) - (Number(a.games) || 0)) || ((Number(b.winRate) || 0) - (Number(a.winRate) || 0))) // 기본=표본순(사이트 빌드패널 템플릿 순서 미러; 클라가 구조화·적합도 재정렬 담당)
      .map(c => { const o = { id: c.id, label: c.label, icon: c.icon, games: c.games, winRate: c.winRate, impact: Math.round(Math.abs(impactAt(c, ewr))) }; if (kind === "item") o.isBoots = isBoots(c); if (kind === "rune") o.runeRank = runeBucket(c); return o; });
    const C = colsFor(e);
    const L = { key: "left", label: C.left.label, kind: C.left.kind, arr: full(C.left.arr, C.left.kind) };
    const R = { key: "right", label: C.right.label, kind: C.right.kind, arr: full(C.right.arr, C.right.kind) };
    let mi = 1; for (const c of L.arr) if (c.impact > mi) mi = c.impact; for (const c of R.arr) if (c.impact > mi) mi = c.impact;
    const cols = type === "champion" ? [R, L] : [L, R]; // 챔피언=룬/증강 먼저, 그 외=챔피언 먼저(사이트와 동일)
    return { ok: true, mode, type, found: true, key: String(panel.key), label: e.label, icon: e.icon, games: e.games, winRate: e.winRate, entityWr: ewr, maxImpact: mi, cols };
  }
  const rows = entities.map(e => {
    const ewr = Number(e.winRate) || 50; // 기여 기준 = 이 항목 자기 평균(사이트 rankBars와 동일, 50% 아님)
    const C = colsFor(e), L = prep(C.left.arr, C.left.kind, ewr), R = prep(C.right.arr, C.right.kind, ewr);
    const maxImpact = Math.max(1, ...L.map(c => c.impact), ...R.map(c => c.impact));
    const tier = type === "champion" ? (tierm.get(norm(e.key)) != null ? tierm.get(norm(e.key)) : (tierm.get(norm(e.label)) != null ? tierm.get(norm(e.label)) : null)) : (tierm.get(e.id) != null ? tierm.get(e.id) : (tierm.get(e.key) != null ? tierm.get(e.key) : null));
    return { id: e.id, key: e.key, label: e.label, icon: e.icon, games: e.games, winRate: e.winRate, tier, maxImpact, left: { label: C.left.label, kind: C.left.kind, arr: L }, right: { label: C.right.label, kind: C.right.kind, arr: R } };
  });
  const isShard = e => (typeof SHARD_NAME !== "undefined" && SHARD_NAME[String(e.id)] != null) || /파편$/.test(String(e.label || ""));
  const demote = e => (type === "item" ? (isBoots(e) ? 1 : 0) : (type === "augment" && mode !== "augment" ? (isShard(e) ? 1 : 0) : 0)); // 아이템탭=신발 뒤로, 표준 룬탭=파편 뒤로(사이트 demote 미러)
  rows.sort((a, b) => (demote(a) - demote(b)) || (tr(a.tier) - tr(b.tier)) || (b.games - a.games) || (b.winRate - a.winRate));
  // ★캡 없음(옛 slice(0,50) 제거). 50 컷은 티어순 정렬 뒤라 챔피언 173개 중 S 10 + A 40 만 남기고
  //   A티어 마지막 1개와 B·C·D 122개를 통째로 잘랐다(실측). UI에 "상위 50" 표기조차 없어 전체인 척했다.
  //   ⚠️ 로드·조인 비용은 캡과 무관하게 원래부터 전량이었다(:880-883) — 캡은 다 만든 걸 버리는 마지막 줄이었을 뿐.
  //      늘어나는 건 직렬화뿐인데, 위 prep 이 40→10(클라가 그리는 만큼)으로 줄어 응답은 오히려 가벼워진다.
  return rows;
}
const AUG_DRIFT_FILE = "augment-availability-season2.json";
async function rowsForPublicTable(mode, range, def) {
  if (def.source === "augdrift") { // 행 없음 — 클라가 /api/augdrift 를 받아 그린다(layout:augdrift)
    return { rows: [], sourceFile: AUG_DRIFT_FILE, generatedAt: "", report: null };
  }
  if (def.source === "contrib") {
    const rows = await contribRows(mode, range, def.subject || "champion");
    return { rows, sourceFile: `search-pool(${mode})`, generatedAt: "", report: null };
  }
  if (def.source === "counter") {
    const { cr, sourceFile, generatedAt } = await loadCounterRoot(mode, range);
    const rows = counterRowsForTable(cr, mode, def);
    return { rows: rows.filter(row => !rowHasRemovedAramItem(row, def.context || def.key)), sourceFile, generatedAt, report: null };
  }
  const loaded = await publicReport(mode, range);
  let rows = [];
  let sourceFile = loaded.file;
  let generatedAt = loaded.generatedAt;
  // 공개 표는 배포 사이트와 같은 정적 리포트 기준으로 고정한다. live db.json은 개인/LCU 화면에만 쓴다.
  // ★pool 있는 표(증강·아이템 티어 = observedAugment/observedItem)는 증강 모드에서도 자기 pool(search-pool-observed*)을 읽는다 — 사이트가 그 pool을 읽으므로(app_v2 searchPool/pools.observedAugments) 같은 판수(마법미사일 9438). dailyReport.patch(8924)로 가로채면 사이트와 어긋남(2026-07-13). pool 없는 표(챔피언=observedChampion)만 증강 모드에서 observedSingleRows(리포트) 사용.
  // ★2026-08-24: 이 분기가 증강 모드에만 걸려 있어서, 일반 칼바람 "챔피언" 표만 기간 필터를 무시하고
  //   전체 기간 값을 고정 표시했다(recommendationRows=리포트 본문 전체 풀). 같은 화면의 챔피언 **상세**는
  //   이미 dailyReport 창(rangeSources().win)으로 좁히고 있어 표≠상세로 어긋나 있었다. 두 모드 다 창을 따른다.
  if (observedSingleKind(def) && !def.pool) rows = observedSingleRows(loaded.report, def, rangeSources(mode, range).win);
  else if (def.pool) {
    const pooled = await publicPoolRows(mode, range, def.pool);
    if (pooled.rows.length) {
      rows = pooled.rows;
      sourceFile = pooled.file;
      generatedAt = pooled.generatedAt || generatedAt;
    }
  }
  if (def.source === "timePattern") rows = timePatternRows(loaded.report);
  else if (def.source === "multiplicity") {
    const slice = await windowSlice(mode, range);   // 선택 기간의 많을때(없으면 null=전체 기간)
    if (slice?.multiplicityRows) { sourceFile = slice.file; generatedAt = slice.generatedAt || generatedAt; }
    rows = multiplicityRows(slice?.multiplicityRows ? { multiplicityRows: slice.multiplicityRows } : loaded.report, def.kind, mode);
  }
  else if (def.source === "entityAll") rows = entityAllRows(loaded.report);
  else if (def.source === "daily") rows = broadcastBaseRows(loaded.report, def.kind, def.prop, def.window); // 방송 리포트: dailyReport 윈도(사용자선택 or 가장 풍부, 고저 미분리)
  else if (!rows.length && def.source === "entity") {
    const slice = await windowSlice(mode, range);   // 선택 기간의 시간대(없으면 null=전체 기간)
    if (slice?.entityTimePatternReport) { sourceFile = slice.file; generatedAt = slice.generatedAt || generatedAt; }
    const entityTime = slice?.entityTimePatternReport || loaded.report.entityTimePatternReport || {};
    const entityRows = sortEntityRows(entityTime[def.entity] || [], def.side);
    rows = isAugmentOrderTable(def) ? augmentOrderRows(entityRows) : entityRows;
  }
  else if (!rows.length && def.prop) rows = recommendationRows(loaded.report, def.prop);
  // 고/저 승률 분리 보정(2026-06-16): observed* "고승률" 세트가 실은 전체 풀(저승률 혼입; 예 고승률 챔피언+아이템에
  //   나르+삼위일체 38.9%, observedChampionItems 599중 410이 <50%)이고 일부 Weak 세트엔 ≥50%가 샌다. 사이트는
  //   티어/승률순 정렬로 가려졌을 뿐(표본순 정렬 시 동일 누수). → 라벨대로 강제: "고승률"(non-Weak)=winRate≥50만,
  //   "저승률"(Weak)=<50만. entityTime(시간대)/multiplicity(공개분석)는 행이 고/저 단일승률이 아니라 prop 없음→제외.
  if (def.prop) {
    rows = rows.filter(r => Number(r.games || 0) >= 3); // 1~2판 단발(100%/0%) 노이즈 제외 — 표준 무영향, 증강은 3판+만
    if (!def.all) { // [전체](all:true)는 고/저 미필터(전체 분포). [고승률]=≥50, [저승률]=<50.
      const lowSide = /Weak/.test(def.key);
      rows = rows.filter(r => { const wr = Number(r.winRate || 0); return lowSide ? wr < 50 : wr >= 50; });
    }
  }
  return { rows: rows.filter(row => !rowHasRemovedAramItem(row, def.context || def.key)), sourceFile, generatedAt, report: loaded.report };
}
function rowText(row) {
  const out = [];
  const visit = (value, depth = 0) => {
    if (value == null || depth > 2) return;
    if (typeof value === "string" || typeof value === "number") { out.push(String(value)); return; }
    if (Array.isArray(value)) { value.slice(0, 6).forEach(v => visit(v, depth + 1)); return; }
    if (typeof value === "object") {
      for (const key of ["label", "pairLabel", "name", "localName", "displayName", "championName", "championLocalName", "augmentName", "itemName", "leftLabel", "rightLabel"]) visit(value[key], depth + 1);
    }
  };
  visit(row);
  return norm(out.join(" "));
}
function filterTableRows(rows, q) {
  const query = norm(q);
  if (!query) return rows;
  return rows.filter(row => rowText(row).includes(query));
}
function firstText(...values) { return values.find(v => String(v || "").trim()) || ""; }
function entityText(value) {
  return firstText(value?.localName, value?.displayName, value?.name, value?.label, value?.championLocalName, value?.championName, value?.itemName, value?.augmentName);
}
function normalizedIconUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) return text;
  const ddragonPath = text.replace(/^\/+/, "").replace(/^img\//i, "");
  if (/^(perk-images|plugins\/rcp-fe-lol-static-assets)\//i.test(ddragonPath)) {
    return `https://ddragon.leagueoflegends.com/cdn/img/${ddragonPath}`;
  }
  return "";
}
function itemIconUrl(value) {
  const id = itemIdFromKey(value) || Number(value || 0);
  return id ? `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/item/${id}.png` : "";
}
function runeIconUrl(value) {
  const id = itemIdFromKey(value) || Number(value || 0);
  if (!id) return "";
  return shardIcon(id) || `https://opgg-static.akamaized.net/meta/images/lol/16.11.1/perk/${id}.png`;
}
function championImageKey(value) {
  const raw = (typeof value === "string" || typeof value === "number")
    ? String(value).trim()
    : firstText(value?.champion, value?.championKey, value?.key, value?.id, value?.name);
  if (/^playeraugment/i.test(raw)) return "";
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(raw)) return "";
  const special = {
    aurelionsol: "AurelionSol", belveth: "Belveth", chogath: "Chogath", drmundo: "DrMundo",
    fiddlesticks: "Fiddlesticks", jarvaniv: "JarvanIV", kaisa: "Kaisa", khazix: "Khazix",
    kogmaw: "KogMaw", ksante: "KSante", leesin: "LeeSin", masteryi: "MasterYi",
    missfortune: "MissFortune", monkeyking: "MonkeyKing", reksai: "RekSai",
    tahmkench: "TahmKench", twistedfate: "TwistedFate", velkoz: "Velkoz", xinzhao: "XinZhao"
  };
  const lower = raw.toLowerCase();
  if (special[lower]) return special[lower];
  return /[A-Z]/.test(raw.slice(1)) ? raw : raw.charAt(0).toUpperCase() + raw.slice(1);
}
function championIconUrl(value) {
  const key = championImageKey(value);
  return key ? `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/champion/${key}.png` : "";
}
function rowLabel(row) {
  if (row.label || row.pairLabel) return row.label || row.pairLabel;
  if (row.leftLabel && row.rightLabel) return `${row.leftLabel} + ${row.rightLabel}`;
  if (Array.isArray(row.champions) && row.champions.length >= 2) return row.champions.map(entityText).filter(Boolean).join(" + ");
  if (Array.isArray(row.augments) && row.augments.length >= 2) return row.augments.map(entityText).filter(Boolean).join(" + ");
  if (Array.isArray(row.items) && row.items.length >= 2) return row.items.map(entityText).filter(Boolean).join(" + ");
  if (row.primaryChampion && row.secondaryChampion) return [entityText(row.primaryChampion), entityText(row.secondaryChampion)].filter(Boolean).join(" + ");
  if (row.primaryAugment && row.secondaryAugment) return [entityText(row.primaryAugment), entityText(row.secondaryAugment)].filter(Boolean).join(" + ");
  if (row.primaryItem && row.secondaryItem) return [entityText(row.primaryItem), entityText(row.secondaryItem)].filter(Boolean).join(" + ");
  if (row.championLocalName && row.item?.localName) return `${row.championLocalName} + ${row.item.localName}`;
  if (row.championLocalName && row.augment?.displayName) return `${row.championLocalName} + ${row.augment.displayName}`;
  return firstText(row.localName, row.displayName, row.name, row.itemName, row.augmentName, row.championLocalName, row.championName, row.rightLabel);
}
function collectIcons(row) {
  const out = [];
  const seen = new Set();
  const iconIdentity = icon => String(icon || "")
    .replace(/\/cdn\/[^/]+\/img\//i, "/cdn/img/")                          // ddragon 버전 정규화
    .replace(/\/meta\/images\/lol\/[0-9][0-9.]*\//i, "/meta/images/lol/")  // opgg-static 버전 정규화 — 같은 룬/아이템이 데이터 icon(현버전)+key유도 runeIconUrl(구버전 16.11.1)로 서로 다른 URL이 되어 dedup을 못 넘어 2중 렌더되던 버그(예: 이즈리얼+침착). 전 조합 탭 공통 수정.
    .replace(/^https?:\/\/[^/]+/i, "");
  const push = icon => {
    const text = String(icon || "");
    if (!text) return;
    const id = iconIdentity(text);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(text);
    }
  };
  const add = value => {
    const icon = normalizedIconUrl(typeof value === "string" ? value : value?.icon);
    push(icon);
  };
  const addChampion = value => push(championIconUrl(value));
  const addTypedKeyIcons = value => {
    String(value || "").split("|").forEach(part => {
      const match = /^([a-z]+):(.+)$/i.exec(part.trim());
      if (!match) return;
      const kind = match[1].toLowerCase();
      const key = match[2];
      if (kind === "rune") push(runeIconUrl(key));
      if (kind === "item") push(itemIconUrl(key));
    });
  };
  add(row.icon); add(row.championIcon);
  [row.asset, row.primaryChampion, row.secondaryChampion, row.champion, row.augment, row.primaryAugment, row.secondaryAugment, row.item, row.primaryItem, row.secondaryItem, row.leftItem, row.rightItem].forEach(add);
  addTypedKeyIcons(row.key);
  push(shardIcon(row.key ?? row.id));
  [row.asset, row.primaryChampion, row.secondaryChampion].forEach(addChampion);
  if (row.type === "champion" || row.championId || row.champion || row.championName || row.championLocalName) {
    [row.champion, row.championName, row.championKey, row.key, row.name].forEach(addChampion);
  }
  ["champions", "augments", "items"].forEach(key => { if (Array.isArray(row[key])) row[key].forEach(add); });
  if (Array.isArray(row.champions)) row.champions.forEach(addChampion);
  if (row.item?.icon && row.championIcon) add(row.item.icon);
  if (out.length === 1 && row.leftLabel && row.rightLabel && row.leftLabel === row.rightLabel) out.push(out[0]);
  return out.slice(0, 4);
}
function rowIcon(row) { return collectIcons(row)[0] || ""; }
function rowRightIcon(row) { return collectIcons(row)[1] || ""; }
function compactTableRow(row, index) {
  // 상대법 등 행이 이미 명시 아이콘 배열(icons)을 줄 때는 그대로 신뢰(collectIcons는 챔프 enemyKey를
  //   파싱 못 해 적챔프 아이콘을 떨군다 — 챔프▶챔프 우상단 아이콘 누락 버그). 명시 아이콘이 우선.
  const explicit = Array.isArray(row.icons) ? row.icons.filter(Boolean) : [];
  const icons = explicit.length ? explicit.slice(0, 4) : collectIcons(row);
  return {
    key: row.key ?? row.id ?? index,
    entityId: (row.id != null && row.leftKey == null) ? row.id : null, // 단일 엔티티(아이템/룬/증강 티어행) id — 상세 클릭용. 쌍/조합행(leftKey 보유)은 null
    label: rowLabel(row),
    icon: icons[0] || row.icon || rowIcon(row),
    rightIcon: icons[1] || row.rightIcon || rowRightIcon(row),
    icons,
    leftLabel: row.leftLabel || row.championLocalName || row.championName || "",
    rightLabel: row.rightLabel || row.item?.localName || row.augment?.displayName || row.itemName || row.augmentName || "",
    games: Number(row.games || 0),
    tier: row.tier ?? null,
    left: row.left ?? null, right: row.right ?? null, maxImpact: row.maxImpact ?? null, // 티어 분석(contrib) 좌/우 기여 구성 — 마스터-디테일 렌더용
    rank: row.rank ?? null,
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    winRate: Number(row.winRate || 0),
    selectionRate: row.selectionRate ?? row.pickRate ?? row.shareRate ?? row.sampleShare ?? null,
    reverseSelectionRate: row.reverseSelectionRate ?? row.rightShareRate ?? null,
    avgDpm: row.avgDpm ?? null,
    avgTakenPerMinute: row.avgTakenPerMinute ?? null,
    avgGoldPerMinute: row.avgGoldPerMinute ?? row.avgGpm ?? null,
    avgMitigatedPerMinute: row.avgMitigatedPerMinute ?? null, avgHealPerMinute: row.avgHealPerMinute ?? null, avgCcPerMinute: row.avgCcPerMinute ?? null, // 분포 8종(피해감소/회복/CC)
    desc: row.description || row.plaintext || row.longDescription || row.tooltip || "", // 호버 툴팁 설명(증강/아이템/룬 효과)
    runeCategory: row.runeCategory || null, runeCategoryLabel: row.runeCategoryLabel || null, // 룬 하위필터(메인룬/하위룬/파편)용
    avgMinutes: row.avgMinutes ?? null,
    reportScore: row.reportScore ?? row.score ?? null,
    movement: row.movement ?? null,
    rankDelta: row.rankDelta ?? null,
    winRateDelta: row.winRateDelta ?? null,
    scoreDelta: row.scoreDelta ?? null,
    previousRank: row.previousRank ?? null,
    previousGames: row.previousGames ?? null,
    previousWinRate: row.previousWinRate ?? null,
    previousReportScore: row.previousReportScore ?? row.previousScore ?? null,
    lowSample: row.lowSample ?? null,
    group: fixChampRole(rowLabel(row), row.group ?? row.itemGroup ?? row.itemReportGroup ?? null),    bucketKind: row.bucketKind || null, // 챔프 클래스 ARAM 실역할 보정(단일소스)
    durationBuckets: Array.isArray(row.durationBuckets) ? row.durationBuckets : null,
    bestDuration: row.bestDuration || null,
    worstDuration: row.worstDuration || null,
    graphKind: row.graphKind || null,
    series: Array.isArray(row.series) ? row.series : null,
    summary: row.summary || null,
    timezone: row.timezone || null
  };
}
// 버킷 열 idx → 실제 버킷. ⚠️ '많을 때' 표는 빈 버킷(games 0)을 걸러 담기 때문에 위치≠개수다
//   (1개 버킷이 없는 행은 durationBuckets[0]이 "2개"). 클라(bucketByLabel)는 라벨로 찾는데 서버만 위치로 찾아
//   "3개 열을 눌렀는데 다른 개수로 정렬"되던 어긋남 → 개수 라벨이 있으면 서버도 라벨로 찾는다.
//   시간대·선택순서 표(라벨이 "13분 미만"·"1번째")는 종전대로 위치 그대로.
function bucketAt(row, idx) {
  const buckets = Array.isArray(row?.durationBuckets) ? row.durationBuckets : [];
  if (buckets.some(b => /개/.test(String(b?.label || "")))) {
    const want = idx >= 4 ? "5개+" : `${idx + 1}개`;
    return buckets.find(b => String(b?.label || "") === want) || null;
  }
  return buckets[idx] || null;
}
function sortValue(row, key) {
  if (key === "label" || key === "name") return rowLabel(row);
  if (key === "tier") return Number(row.tier ?? row.rank ?? 9999);
  if (key === "selectionRate") return Number(row.selectionRate ?? row.pickRate ?? row.shareRate ?? row.sampleShare ?? 0);
  // 버킷 열 정렬. key "bucket3"=표본 순 / "bucket3w"=승률 순 (2026-08-24 사용자 지시: 두 기준 다 되게).
  if (/^bucket[0-4]w?$/.test(key)) {
    const idx = Number(key.replace(/^bucket/, "").replace(/w$/, ""));
    const bucket = bucketAt(row, idx);
    const games = Number(bucket?.games ?? 0);
    if (!key.endsWith("w")) return games;
    // 승률 순: 화면이 3판 미만을 "-"로 감추므로(bucketMetricCell) 정렬에서도 값 없음으로 본다.
    //   안 그러면 1판 100%가 화면엔 "-"인 채 1등으로 올라온다.
    return games >= 3 ? Number(bucket?.winRate ?? 0) : -1;
  }
  if (key === "durationBuckets") {
    const best = row.bestDuration?.winRate ?? row.durationBuckets?.reduce((m, b) => Math.max(m, Number(b.winRate || 0)), 0);
    return Number(best || 0);
  }
  return Number(row[key] ?? 0);
}
function sortRowsForPublicTable(rows, sortKey = "games", dir = "desc") {
  const key = ["tier", "games", "label", "name", "winRate", "selectionRate", "multiGames", "multiWinRate", "durationBuckets",
    "bucket0", "bucket1", "bucket2", "bucket3", "bucket4",
    "bucket0w", "bucket1w", "bucket2w", "bucket3w", "bucket4w"].includes(sortKey) ? sortKey : "games";
  const direction = dir === "asc" ? 1 : -1;
  // 값 없는 버킷(표본 0 · 승률순은 3판 미만)은 방향과 무관하게 항상 뒤로 — 오름차순에서 "-" 행이 1등으로 올라오지 않게.
  const emptyRank = row => (/^bucket[0-4]w?$/.test(key) ? (sortValue(row, key) < 0 || (!key.endsWith("w") && sortValue(row, key) === 0) ? 1 : 0) : 0);
  return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
    const emptyGap = emptyRank(a) - emptyRank(b);
    if (emptyGap) return emptyGap;
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    const cmp = typeof av === "string" || typeof bv === "string"
      ? String(av || "").localeCompare(String(bv || ""), "ko")
      : (Number(av || 0) - Number(bv || 0));
    return cmp ? cmp * direction : (key === "tier" ? (Number(a.rank || 9999) - Number(b.rank || 9999)) : Number(b.games || 0) - Number(a.games || 0)); // 티어순 동률은 rank(1위 먼저)로 — 티어 내 순서 정렬
  });
}
function tableColumns(def) {
  const cols = [
    { key: "label", label: "항목", type: "entity", sortable: true },
    { key: "winRate", label: "승률", type: "percent", sortable: true },
    ...(def.source === "multiplicity" ? [] : [{ key: "games", label: "표본", type: "number", sortable: true }]) // 많을때 표: '총 표본' 열 제외 — 그 표본은 1개-보유(단일)가 대부분이라 '많을 때'(2+동시) 표엔 오해만 줌(사이트와 동일, 2026-07-13 사용자 지시). 개수 버킷·동시출현으로 봄.
  ];
  if (def.source === "timePattern") cols.push({ key: "series", label: "그래프", type: "series", sortable: false });
  else if (def.source === "entity") cols.push({ key: "durationBuckets", label: isAugmentOrderTable(def) ? "선택순서" : "시간대", type: "buckets", sortable: true });
  else if (def.source === "multiplicity") cols.push({ key: "durationBuckets", label: "개수", type: "buckets", sortable: true });
  else if (def.source === "counter") { /* 상대법은 [항목,승률,표본] 3열 — 선택률 없음(사이트 상대법과 동일). */ }
  else if (def.source === "contrib") { /* 티어 분석은 마스터-디테일 전용렌더(layout:contrib) — 기본 [항목,승률,표본]만, 선택률 없음. */ }
  else if (def.source === "augdrift") { /* 증강 제공 변동은 클라 전용렌더(layout:augdrift) — 열 정의 무의미. */ }
  else cols.push({ key: "selectionRate", label: "선택률", type: "percent", sortable: true });
  return cols;
}
// 통합검색(사이트 publicSearchResultTable 이식): 쿼리를 활성 모드의 엔티티 표들(챔피언/룬·증강/아이템/조합/공개분석)에
//   걸쳐 매칭해 "표별 결과 카드"를 만든다. 방송 리포트(챔피언 중복뷰)·상대법(쌍 기반)은 사이트와 동일하게 제외.
const UNIFIED_SEARCH_TABS = new Set(["champion", "rune", "augment", "item", "combo", "analysis"]);
async function unifiedSearchCards(mode, range, q) {
  const m = safeTableMode(mode), rng = safeTableRange(range);
  if (!norm(q)) return [];
  const defs = publicTableDefs(m).filter(d => UNIFIED_SEARCH_TABS.has(d.tab));
  const tabs = publicTableTabs(m);
  const cards = [];
  for (const def of defs) {
    let rows, rep = null;
    try { const _r = await rowsForPublicTable(m, rng, def); rows = _r.rows; rep = _r.report; } catch { continue; }
    const matched = filterTableRows(rows, q);
    if (!matched.length) continue;
    const _repWins = r => r.wins != null ? +r.wins : Math.round((+r.winRate || 0) / 100 * (+r.games || 0)); // 대표행=표본 충분(>=8) 중 보정승률 최고. matched[0](rank순)은 소표본 단발이 대표로 뜰 수 있음. 없으면 전체 adj-best(희소 전멸 방지).
    const _solid = matched.filter(r => (+r.games || 0) >= 8), _pool = _solid.length ? _solid : matched;
    const _rep = _pool.slice().sort((x, y) => adjPct(_repWins(y), +y.games || 0) - adjPct(_repWins(x), +x.games || 0) || (+y.games || 0) - (+x.games || 0))[0];
    const top = compactTableRow(_rep, 0);
    cards.push({
      tab: def.tab, key: def.key, label: def.label || def.key,
      tabLabel: tabs.find(t => t.key === def.tab)?.label || def.tab,
      count: matched.length,
      sampleLabel: top.label, sampleIcon: top.icon, sampleRightIcon: top.rightIcon, sampleWinRate: top.winRate, sampleGames: top.games
    });
  }
  cards.sort((a, b) => b.count - a.count);
  return cards.slice(0, 16);
}
// ── 엔티티 상세(아이템/룬/증강) — 데이터 근거만, 지어낸 순서·추천순 금지 ──
function _metric(label, v, cc) { return (v == null) ? null : { label, value: Number(v), cc: !!cc }; }
function _dedupByName(arr) { const seen = new Set(); return arr.filter(x => { const k = x.name; if (!k || seen.has(k)) return false; seen.add(k); return true; }); }
// 증강 id 공간 비일관(짧은 id 225 ↔ value 1225/2225, 일부 id===value) — 슬롯 접두(1000/2000) 제거한 base로 통일 매칭.
function _augBase(v) { v = Number(v) || 0; return v >= 1000 ? v % 1000 : v; }
function _augEq(a, b) { return _augBase(a) === _augBase(b); }
// 방송 티어 표가 쓰는 dailyReport 윈도 행(가장 풍부한 윈도) — 상세가 티어표와 같은 엔티티 유니버스를 커버하도록.
//   itemRows/augmentRows(관찰 리포트)보다 넓고 tier/rank/전 지표를 갖춰, 클릭 가능한 모든 항목이 빈 상세로 안 빠진다.
// ★2026-07-22: '행수가 가장 많은 창'을 고르던 것을 모드별 창 우선순위(사이트 app_v2 dailyWindowKeyList 와 동일)로 바꿨다.
//   증바람 리포트엔 all 창이 없고 week 와 patch 의 행수가 같아서(챔피언 173=173·증강 206=206·아이템 116=116)
//   '더 많으면 교체' 규칙이 뒤집히지 않아 항상 week 로 굳었다 → 상세의 티어·순위·판수가 티어표/사이트(patch)와 어긋났다.
//   실측 차이: 챔피언 tier 38·rank 167·games 173행, 증강 tier 41·rank 196·games 206행, 아이템 tier 22·rank 106·games 116행.
//   표준은 종전대로 all 이 첫 순위라 동작 불변.
function dailyRichRows(report, kind, mode, win = "") {
  const dr = report.dailyReport || {};
  const base = mode === "augment" ? ["all", "patch", "week", "recent50"] : ["all", "recent28", "recent14", "week", "patch", "recent50"];
  const order = win ? [win, ...base.filter(k => k !== win)] : base;
  for (const w of order) {
    const rows = dr[w] && dr[w].types && dr[w].types[kind] && dr[w].types[kind].rows;
    if (Array.isArray(rows) && rows.length) return rows;
  }
  return [];
}
// ── 엔티티 총판수 단일 캐노니컬 소스: 폐기(2026-07-13) ──
// entityTotalGames/kindFromDef로 모든 표의 "N판"을 엔티티별 단일 총판수로 통일하던 로직 제거.
// 이유: 그 통일값이 사이트의 실시간 창별 판수와 어긋남(증강 9438·많을때 8057 vs 8924). 각 표는 자기 원본 games를 그대로 쓴다.
// 표준 아이템 상세: itemRows 행 + 관계(쓰는 챔프/같이 가는 룬/아이템쌍) + 상대법(counter subjects.item).
async function stdItemDetail(id, range) {
  const _win = rangeSources("standard", range).win;
  const r = await load("standard-aram-cohort-all.json");
  const idn = Number(id), ids = String(idn);
  const drRow = dailyRichRows(r, "item", "standard", _win).find(x => Number(x.id) === idn) || {};
  const irRow = (r.itemRows || []).find(x => Number(x.id) === idn) || {};
  const row = { ...irRow, ...drRow }; // dailyReport(티어·전지표) 우선, itemRows 보충
  const cr = r.comboRows || {}, pr = r.personalRecommendations || {};
  const champs = (cr.championItem || []).filter(x => x.rightKind === "item" && String(x.rightKey) === ids)
    .map(x => ({ name: x.championName, icon: x.icon, winRate: Math.round(x.winRate || 0), games: x.games || 0, tier: x.tier ?? null }))
    .filter(x => x.name).sort((a, b) => b.games - a.games).slice(0, 12);
  const runes = (cr.augmentItem || []).filter(x => x.leftKind === "rune" && String(x.rightKey) === ids)
    .map(x => { const ru = x.augment || x.primaryAugment || {}; return { id: ru.id, name: ru.displayName || x.augmentName, icon: ru.icon || runeIconUrl(ru.id), winRate: Math.round(x.winRate || 0), games: x.games || 0, sub: ru.runeCategoryLabel || "" }; }) // ★행이 이미 현 패치 아이콘을 갖고 있다(실측 7,319행 중 6,514행). 그걸 버리고 코드에 박힌 구버전 URL을 다시 만들던 것을 데이터 우선으로.
    .filter(x => x.name).sort((a, b) => b.games - a.games).slice(0, 12);
  const pairs = [...(pr.observedItemPairs || []), ...(pr.observedTeamItemPairs || [])]
    .filter(x => String(x.leftKey) === ids || String(x.rightKey) === ids)
    .map(x => { const o = String(x.leftKey) === ids ? (x.secondaryItem || {}) : (x.primaryItem || {}); return { id: o.id, name: o.displayName, icon: o.icon || itemIconUrl(o.id), winRate: Math.round(x.winRate || 0), games: x.games || 0 }; })
    .filter(x => x.name).sort((a, b) => b.games - a.games).slice(0, 12);
  const counter = null; // 상세 페이지에서 상대법을 제거(2026-07-22 사용자 지시) — 계산도 하지 않는다(상대법 파일 로드 비용 제거). 상대법은 메타 표 경로에만 남는다.
  const metrics = [_metric("분당 딜", row.avgDpm), _metric("분당 받은 피해", row.avgTakenPerMinute), _metric("분당 피해 감소", row.avgMitigatedPerMinute), _metric("분당 회복", row.avgHealPerMinute), _metric("분당 CC", row.avgCcPerMinute, true), _metric("분당 골드", row.avgGoldPerMinute)].filter(Boolean);
  return {
    kind: "item", id: idn, name: row.localName || row.displayName || row.name || ("아이템 " + idn), icon: row.icon || itemIconUrl(idn),
    tier: row.tier ?? null, rank: row.rank ?? null, reportScore: row.reportScore ?? null,
    games: row.games || 0, wins: row.wins || 0, losses: row.losses || 0, winRate: Math.round(row.winRate || 0), plaintext: row.description || row.plaintext || "", // 아이템은 description이 정확(plaintext가 일부 오매칭: 탐욕의군화→마나무네 설명). 룬/증강은 이미 description.
    metrics, relations: { champions: champs, runes, itemPairs: pairs }, counter
  };
}
// 증강 아이템 상세: itemRows 행(tier/counter 없음) + 관계(championBreakdown 내장 / 가는 증강 / 아이템쌍).
async function augItemDetail(id, range = "all") {
  const _win = rangeSources("augment", range).win;
  const r = (await publicReport("augment", "all")).report || {};
  const idn = Number(id), ids = String(idn);
  const orc = r.observedRecommendations || {};
  const drRow = dailyRichRows(r, "item", "augment", _win).find(x => Number(x.id) === idn) || {};
  const irRow = (r.itemRows || []).find(x => Number(x.id) === idn) || {};
  const oi = [...(orc.observedItems || []), ...(orc.observedWeakItems || [])].find(x => Number(x.id) === idn) || {};
  const row = { ...oi, ...irRow, ...drRow }; // dailyReport(티어/전지표) 우선 → itemRows → observed 보충
  const m = k => (row[k] != null ? row[k] : null);
  const _ciPool = await loadPool("search-pool-all-observedChampionItems-season2.json"); // 잘 쓰는 챔피언 = 풀메타(games). championBreakdown은 itemRows(소표본/내데이터)라 무한의대검=아크샨5판처럼 thin → 검색풀 우선.
  let champs = _dedupByName(_ciPool.filter(x => String(x.itemKey) === ids || String(x.rightKey) === ids).map(x => ({ name: x.championLocalName || x.championName, icon: x.championIcon, winRate: Math.round(x.winRate || 0), games: Number(x.games) || 0 })).filter(c => c.name && c.games > 0));
  if (!champs.length) champs = (irRow.championBreakdown || []).map(c => ({ name: c.localName || c.name, icon: c.icon, winRate: Math.round(c.winRate || 0), games: c.games || 0 })).filter(c => c.name && c.games > 0); // 폴백: 검색풀에 없을 때만 breakdown
  champs = champs.sort((a, b) => b.games - a.games).slice(0, 12);
  const _aiPool2 = await loadPool("search-pool-all-observedAugmentItems-season2.json"); // 함께 간 증강(이 아이템과 same-player로 함께 든 증강, games=풀메타). 팀/적 증강은 별도 파일이라 안 섞임
  const _augD2 = await augDescMap();
  const augs = _dedupByName(_aiPool2.filter(x => String(x.itemKey) === ids || String(x.rightKey) === ids)
    .map(x => { const a = x.augment || {}; const aid = a.id != null ? a.id : x.augmentKey; return { id: aid, name: (a.localName || a.name) || x.leftLabel, icon: a.icon || "", winRate: Math.round(x.winRate || 0), games: Number(x.games) || 0, sub: AUG_RARITY_KO[a.rarity] || "", desc: _augD2.get(Number(aid)) || "" }; })
    .filter(x => x.name && x.games > 0)).sort((a, b) => b.games - a.games).slice(0, 12);
  const _ipPool = await loadPool("search-pool-all-observedItemPairs-season2.json"); // 함께 간 아이템(same-player 아이템쌍, games=풀메타). 팀 아이템쌍(observedTeamItemPairs)은 별도 파일이라 제외
  const _itemD2 = await itemDescMap();
  const pairs = _dedupByName(_ipPool.filter(x => String(x.leftKey) === ids || String(x.rightKey) === ids)
    .map(x => { const isL = String(x.leftKey) === ids; const oid = isL ? x.rightKey : x.leftKey; const nm = isL ? x.rightLabel : x.leftLabel; return { id: oid, name: nm, icon: itemIconUrl(oid), winRate: Math.round(x.winRate || 0), games: Number(x.games) || 0, desc: _itemD2.get(Number(oid)) || "" }; })
    .filter(x => x.name && x.games > 0)).sort((a, b) => b.games - a.games).slice(0, 12);
  const metrics = [_metric("분당 딜", m("avgDpm")), _metric("분당 받은 피해", m("avgTakenPerMinute")), _metric("분당 피해 감소", m("avgMitigatedPerMinute")), _metric("분당 회복", m("avgHealPerMinute")), _metric("분당 CC", m("avgCcPerMinute"), true), _metric("분당 골드", m("avgGoldPerMinute"))].filter(Boolean);
  const _base = observedSingleBaseRows(r, "item", "observedItems", _win).find(x => Number(x.id) === idn) || {}; // 상세 헤더 총판수=dailyReport.patch — 사이트 상세(resolveEntity)도 dailyReport 윈도를 읽으므로 동일. ★티어 표는 pool이지만 상세 헤더는 사이트도 dailyReport라 여기서 pool 쓰면 사이트 상세와 어긋남(2026-07-13 확인). tier/reportScore도 dailyReport(row).
  const _tg = Number(_base.games ?? oi.games ?? row.games ?? 0), _tw = Number(_base.wins ?? oi.wins ?? row.wins ?? 0), _tl = Number(_base.losses ?? oi.losses ?? row.losses ?? 0), _twr = Math.round(Number(_base.winRate ?? oi.winRate ?? row.winRate ?? 0));
  return {
    kind: "item", mode: "augment", id: idn, name: row.localName || row.name || ("아이템 " + idn), icon: row.icon || itemIconUrl(idn),
    tier: row.tier ?? null, rank: row.rank ?? null, reportScore: row.reportScore ?? null, cls: GROUP_KO[fixItemClass(row.localName || row.name || row.displayName, row.group)] || "", // 아이템 클래스 오버라이드(class-overrides.json) 적용
    games: _tg, wins: _tw, losses: _tl, winRate: _twr, plaintext: row.description || row.plaintext || "", // 아이템은 description이 정확(plaintext가 일부 오매칭: 탐욕의군화→마나무네 설명). 룬/증강은 이미 description.
    metrics, relations: { champions: champs, augments: augs, itemPairs: pairs }, counter: null
  };
}
// 표준 룬 상세: augmentRows(=룬) 행 + 관계(쓰는 챔프/가는 아이템/룬쌍) + 상대법(counter subjects.rune).
async function stdRuneDetail(id, range) {
  const _win = rangeSources("standard", range).win;
  const r = await load("standard-aram-cohort-all.json");
  const idn = Number(id), ids = String(idn);
  const rows = r.augmentRows || [];
  const arRow = rows.find(x => Number(x.id) === idn) || {};
  const drRow = dailyRichRows(r, "augment", "standard", _win).find(x => Number(x.id) === idn) || {};
  const row = { ...arRow, ...drRow }; // dailyReport(방송 티어와 동일) 우선, augmentRows 보충
  const cr = r.comboRows || {}, pr = r.personalRecommendations || {};
  const ricon = new Map(rows.map(x => [String(x.id), x.icon]));
  const ic = i => ricon.get(String(i)) || runeIconUrl(i);
  const champs = (cr.championAugment || []).filter(x => x.rightKind === "rune" && String(x.rightKey) === ids)
    .map(x => ({ name: x.championName, icon: x.icon, winRate: Math.round(x.winRate || 0), games: x.games || 0, tier: x.tier ?? null }))
    .filter(x => x.name).sort((a, b) => b.games - a.games).slice(0, 12);
  const items = (cr.augmentItem || []).filter(x => x.leftKind === "rune" && String(x.leftKey) === ids)
    .map(x => { const it = x.secondaryItem || {}; return { id: it.id, name: it.displayName, icon: it.icon || itemIconUrl(it.id), winRate: Math.round(x.winRate || 0), games: x.games || 0 }; })
    .filter(x => x.name).sort((a, b) => b.games - a.games).slice(0, 12);
  const runePairs = [...(pr.observedAugmentPairs || []), ...(pr.observedTeamAugmentPairs || [])]
    .filter(x => x.leftKind === "rune" && (String(x.leftKey) === ids || String(x.rightKey) === ids))
    .map(x => { const parts = String(x.pairLabel || x.label || "").split(" + "); const oid = String(x.leftKey) === ids ? x.rightKey : x.leftKey; const nm = String(x.leftKey) === ids ? (x.rightLabel || parts[1]) : parts[0]; return { id: oid, name: nm, icon: ic(oid), winRate: Math.round(x.winRate || 0), games: x.games || 0 }; })
    .filter(x => x.name).sort((a, b) => b.games - a.games).slice(0, 12);
  const counter = null; // 상세 페이지에서 상대법을 제거(2026-07-22 사용자 지시) — 계산도 하지 않는다(상대법 파일 로드 비용 제거). 상대법은 메타 표 경로에만 남는다.
  const metrics = [_metric("분당 딜", row.avgDpm), _metric("분당 받은 피해", row.avgTakenPerMinute), _metric("분당 피해 감소", row.avgMitigatedPerMinute), _metric("분당 회복", row.avgHealPerMinute), _metric("분당 CC", row.avgCcPerMinute, true), _metric("분당 골드", row.avgGoldPerMinute)].filter(Boolean);
  return {
    kind: "rune", id: idn, name: row.localName || row.displayName || ("룬 " + idn), icon: row.icon || runeIconUrl(idn),
    tier: row.tier ?? null, rank: row.rank ?? null, reportScore: row.reportScore ?? null, sub: row.runeCategoryLabel || row.rarity || "",
    games: row.games || 0, wins: row.wins || 0, losses: row.losses || 0, winRate: Math.round(row.winRate || 0), plaintext: row.description || "",
    metrics, relations: { champions: champs, items, runePairs }, counter
  };
}
// 증강 증강 상세: augmentRows 행 + 슬롯별 승률 + 관계(쓰는 챔프/같이 가는 증강/같이 가는 아이템). tier·counter 없음.
async function augAugmentDetail(id, range = "all") {
  const _win = rangeSources("augment", range).win;
  const r = (await publicReport("augment", "all")).report || {};
  const idn = Number(id), ids = String(idn);
  const orc = r.observedRecommendations || {};
  const drRows = dailyRichRows(r, "augment", "augment", _win);
  const drRow = drRows.find(x => Number(x.id) === idn) || drRows.find(x => _augEq(x.id, idn)) || {};
  const arRows = r.augmentRows || [];
  const arRow = arRows.find(x => Number(x.id) === idn) || arRows.find(x => _augEq(x.id, idn)) || {};
  const obsAug = [...(orc.observedAugments || []), ...(orc.observedWeakAugments || [])];
  const oa = obsAug.find(x => Number(x.id) === idn) || obsAug.find(x => _augEq(x.id, idn)) || {};
  const row = { ...oa, ...arRow, ...drRow }; // dailyReport(티어/슬롯/전지표) 우선 → augmentRows → observed 보충
  const m = k => (row[k] != null ? row[k] : null);
  const slots = (row.slotStats || []).filter(s => Number(s.games || 0) > 0).map(s => ({ slot: s.slot, winRate: Math.round(s.winRate || 0), games: s.games || 0 }));
  const dedupByName = arr => { const seen = new Set(); return arr.filter(x => { const k = x.name; if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
  // 관계 표본 = games(이 엔티티를 든 플레이어가 same-player로 함께 한 동시출현, 풀메타). personal+ally+enemy 합 = games(뷰어기준 분해일 뿐 전부 same-player).
  // personalGames(운영자 본인 게임만)를 쓰면 표본이 한자리로 쪼그라들어 "내 데이터" 착시 — games로 풀메타 집계. 팀 쌍(남이 든 증강, 마법미사일류)은 observedTeamAugmentPairs 별도 파일이라 개인쌍 파일(여기)엔 안 섞임.
  const _pg = x => Number(x.games) || 0;
  // ★2026-07-22 남의 데이터 오염 차단: _augEq 는 id%1000 으로 비교하는데, 2xxx 는 슬롯 변종이 아니라 **다른 증강의 독립 id** 다.
  //   실측(증강 208종) 충돌 그룹 30개·영향 증강 60개(28.8%). 예: 2138 적응형 와드 상세가 138 선혈포식(8,162판) 데이터로 전부 채워졌다.
  //   그래서 정확 일치를 먼저 쓰고, 정확 일치가 0행일 때만 종전 base 비교로 폴백한다(구 데이터 호환은 유지, 오염만 제거).
  const _exact = (a, b) => Number(a) === Number(b);
  const _pick = (pool, exactFn, baseFn) => { const e = pool.filter(exactFn); return e.length ? e : pool.filter(baseFn); };
  const _caPool = await loadPool("search-pool-all-observedChampionAugments-season2.json"); // 잘 쓰는 챔피언
  let champs = _dedupByName(_pick(_caPool,
      x => Number(x.augment && x.augment.id) === idn || _exact(x.augmentKey, idn),
      x => _augEq(x.augmentKey, idn))
    .map(x => ({ name: x.championLocalName || x.championName, icon: x.championIcon, winRate: Math.round(x.winRate || 0), games: _pg(x) })).filter(x => x.name && x.games > 0))
    .sort((a, b) => b.games - a.games).slice(0, 12);
  const _apPool = await loadPool("search-pool-all-observedAugmentPairs-season2.json"); // 함께 간 증강(개인 쌍만, 팀 쌍 파일 미사용)
  const _augD = await augDescMap();
  const _apRows = _pick(_apPool, x => _exact(x.leftKey, idn) || _exact(x.rightKey, idn), x => _augEq(x.leftKey, idn) || _augEq(x.rightKey, idn));
  const _apExact = _apRows.some(x => _exact(x.leftKey, idn) || _exact(x.rightKey, idn)); // 상대편 고르기도 같은 기준으로(섞이면 자기 자신이 상대로 뜬다)
  const _isSelf = (v) => _apExact ? _exact(v, idn) : _augEq(v, idn);
  const augPairs = _dedupByName(_apRows
    .map(x => { const arr = x.augments || []; const o = arr.find(a => !_isSelf(a.id)) || {}; const isL = _isSelf(x.leftKey); return { id: o.id, name: o.localName || o.name || (isL ? x.rightLabel : x.leftLabel), icon: o.icon || "", winRate: Math.round(x.winRate || 0), games: _pg(x), sub: AUG_RARITY_KO[o.rarity] || "", desc: _augD.get(Number(o.id)) || "" }; })
    .filter(x => x.name && x.games > 0)).sort((a, b) => b.games - a.games).slice(0, 12);
  const _aiPool = await loadPool("search-pool-all-observedAugmentItems-season2.json"); // 함께 간 아이템(본인 personalGames)
  const _itemD = await itemDescMap();
  const items = _dedupByName(_pick(_aiPool, x => _exact(x.augmentKey, idn) || _exact(x.leftKey, idn), x => _augEq(x.augmentKey, idn) || _augEq(x.leftKey, idn))
    .map(x => { const _iid = x.itemKey || x.rightKey; return { id: _iid, name: x.rightLabel || (x.item && x.item.localName), icon: (x.item && x.item.icon) || itemIconUrl(_iid), winRate: Math.round(x.winRate || 0), games: _pg(x), desc: _itemD.get(Number(_iid)) || "" }; })
    .filter(x => x.name && x.games > 0)).sort((a, b) => b.games - a.games).slice(0, 12);
  const metrics = [_metric("분당 딜", m("avgDpm")), _metric("분당 받은 피해", m("avgTakenPerMinute")), _metric("분당 피해 감소", m("avgMitigatedPerMinute")), _metric("분당 회복", m("avgHealPerMinute")), _metric("분당 CC", m("avgCcPerMinute"), true), _metric("분당 골드", m("avgGoldPerMinute"))].filter(Boolean);
  const _base = observedSingleBaseRows(r, "augment", "observedAugments", _win).find(x => Number(x.id) === idn) || {}; // 상세 헤더 총판수=dailyReport.patch — 사이트 상세(resolveEntity)도 dailyReport 윈도를 읽으므로 동일(8924). ★티어 표는 pool(9458)이지만 상세 헤더는 사이트도 dailyReport라 여기서 pool 쓰면 오히려 사이트 상세와 어긋남(2026-07-13 확인). tier/reportScore/slot도 dailyReport(row).
  const _tg = Number(_base.games ?? oa.games ?? row.games ?? 0), _tw = Number(_base.wins ?? oa.wins ?? row.wins ?? 0), _tl = Number(_base.losses ?? oa.losses ?? row.losses ?? 0), _twr = Math.round(Number(_base.winRate ?? oa.winRate ?? row.winRate ?? 0));
  return {
    kind: "augment", mode: "augment", id: idn, name: row.localName || row.name || ("증강 " + idn), icon: row.icon || "",
    tier: row.tier ?? null, rank: row.rank ?? null, reportScore: row.reportScore ?? null, rarity: AUG_RARITY_KO[row.rarity] || "", sub: AUG_RARITY_KO[row.rarity] || "",
    games: _tg, wins: _tw, losses: _tl, winRate: _twr, plaintext: row.description || "",
    slots, metrics, relations: { champions: champs, augments: augPairs, items }, counter: null
  };
}
// 상세 페이지의 상대법은 제거됐다(2026-07-22 사용자 지시: "상세페이지에 상대법을 없애라"). 챔피언 상세용 champCounterData 와 그 전용 헬퍼도 함께 삭제 — 상세를 열 때마다 상대법 파일(표준 3.3MB·증바람 pools 76MB)을 읽던 비용이 사라진다. 상대법은 메타 '상대법' 탭(counterRowsForTable)에만 남는다.
// ★2026-07-22 표 페이로드 캐시: 정렬 버튼을 누르거나 탭에 돌아올 때마다 1만행대 배열을 filter+sort+map 으로
//   처음부터 다시 만들고 있었다(그것도 창의 UI 스레드에서). 같은 질의는 데이터가 바뀌기 전까지 결과가 같다.
//   무효화는 데이터 캐시와 같은 TTL — 파일이 갱신되면 그 다음 요청부터 새로 만든다.
const _tablePayloadMem = new Map(); // key → { payload, at }
function tablePayloadCacheGet(k) { const e = _tablePayloadMem.get(k); if (!e) return null; if (Date.now() - e.at > TTL_MS) { _tablePayloadMem.delete(k); return null; } return e.payload; }
function tablePayloadCachePut(k, payload) {
  _tablePayloadMem.set(k, { payload, at: Date.now() });
  for (const old of _tablePayloadMem.keys()) { if (_tablePayloadMem.size <= 24) break; if (old !== k) _tablePayloadMem.delete(old); }
}
async function publicTablePayload(params) {
  const mode = safeTableMode(params.get("mode") || "standard");
  const range = safeTableRange(params.get("range") || "all");
  const defs = publicTableDefs(mode);
  const requestedTable = params.get("table") || "";
  const tableKey = requestedTable || defs[0]?.key || "";
  let def = publicTableDefByKey(mode, tableKey);
  if (!def) {
    return { ok: false, error: "unknown_table", mode, range, table: tableKey, tabs: publicTableTabs(mode), tables: defs, rows: [], total: 0 };
  }
  // 방송 리포트 엔티티 타입 전환(챔피언/증강·룬/아이템 티어리스트) — 사이트 activeDailyType 이식.
  //   dailyReport.types.{champion|augment|item}을 직접 읽으므로 kind만 바꾼다(augment=증강모드 증강/표준모드 룬).
  const bctype = params.get("bctype");
  if (def.source === "daily" && ["champion", "augment", "item"].includes(bctype)) {
    const propBy = { champion: "observedChampions", augment: "observedAugments", item: "observedItems" };
    def = { ...def, kind: bctype, prop: propBy[bctype] || def.prop };
  }
  // 기간 필터는 range 하나로 통일됐다(전체·최근 28일·최근 14일) → 방송 리포트 창도 그 range 를 모드별 창키로 푼 값.
  //   bcwin 은 하위호환으로만 남긴다: 기간키(all/recent28/recent14)면 같은 규칙으로 풀고, 원시 창키(patch/week/…)면 그대로 쓴다.
  const rangeWin = rangeSources(mode, range).win;
  const bcwin = params.get("bcwin");
  if (def.source === "daily") {
    const raw = bcwin && /^[a-z0-9]+$/i.test(bcwin) ? bcwin : "";
    const resolved = raw ? ((RANGE_SOURCES[safeTableMode(mode)] || {})[raw]?.win || raw) : rangeWin;
    def = { ...def, window: resolved };
  }
  const limit = Math.min(5000, Math.max(10, Number(params.get("limit") || 5000))); // 캡 상향: 페이지네이션 제거로 전체 행 한 번에 반환(사용자 지시). 기본 200은 증강 208행을 8개 조용히 자르던 잠복 구멍이라 기본도 상한과 같게.
  const offset = Math.max(0, Number(params.get("offset") || 0));
  const q = params.get("q") || "";
  const cacheKey = [mode, range, def.key, def.kind || "", def.window || "", params.get("sort") || "", params.get("dir") || "", offset, limit, q, bctype || "", bcwin || ""].join("|");
  const cachedPayload = tablePayloadCacheGet(cacheKey);
  if (cachedPayload) return cachedPayload;
  const loaded = await rowsForPublicTable(mode, range, def);
  if (bctype === "item") { try { const icm = await itemClassMap(); for (const row of (loaded.rows || [])) { const nm = row.localName || row.name || row.label || rowLabel(row); const c = fixItemClass(nm, icm.get(norm(nm))); if (c && c !== "all") row.group = c; } } catch {} } // 방송 아이템: itemClassMap 조인 + 명시 보정(아트마=탱커) → 클래스 하위필터
  // ── 기본 정렬 = 티어를 매길 수 있으면 티어순, 아니면 종전대로 표본순 ────────────────────────
  //   ⚠️ def 이름으로 판단하면 틀린다 — 같은 표라도 모드에 따라 티어가 있고 없다.
  //      실측: q450 풀은 챔피언 173/173·룬 66/66·아이템 115/115 전부 tier 보유. q2400(season2) 풀은 셋 다 **0개**.
  //      그래서 행에 티어가 실제로 있는지로만 정한다(없는 표에 티어 버튼을 띄우면 눌러도 아무 일 없는 유령 컨트롤).
  const hasTier = (loaded.rows || []).some(r => r && r.tier != null && Number(r.tier) > 0);
  const defaultSort = def.source === "multiplicity" ? "multiGames" : (hasTier ? "tier" : "games"); // 많을때 표는 동시출현이 기본(사이트와 동일)
  const defaultDir = defaultSort === "tier" ? "asc" : "desc"; // 티어는 S(1)가 먼저 → 오름차순
  const rawSort = params.get("sort") || "";
  const sort = (!rawSort || rawSort === "auto") ? defaultSort : rawSort;
  const rawDir = params.get("dir") || "";
  const dir = (!rawDir || rawDir === "auto") ? ((sort === "tier" || sort === "label") ? "asc" : "desc") : (rawDir === "asc" ? "asc" : "desc");
  const filtered = def.source === "contrib" // 티어 분석은 contribRows의 정렬(티어→판수→승률) 보존 — 일반 정렬바로 덮지 않음. 검색 필터만 적용. (multiplicity는 정렬 가능해야 하므로 보존 안 함 — 기본 multiGames는 클라 default+multiplicityRows 사전정렬로, 재정렬은 정렬바 multiGames/games/winRate/label로.)
    ? filterTableRows(loaded.rows, q)
    : sortRowsForPublicTable(filterTableRows(loaded.rows, q), sort, dir);
  const page = filtered.slice(offset, offset + limit).map(compactTableRow);
  // ★canonicalGames 제거(2026-07-13): 각 표는 자기 원본 games를 그대로 표시한다. 엔티티별 단일 총판수로 통일하던 로직(entityTotalGames로 덮기)은 사이트의 실시간 창별 판수와 어긋나므로(증강 9438·많을때 8057 vs 8924) 폐기. 클라는 canonicalGames 미설정 시 games로 폴백.
  const payload = {
    ok: true,
    mode,
    season: mode === "augment" ? "season2" : "standard",
    range,
    table: def.key,
    label: def.label,
    tableLabel: def.label,
    tab: def.tab,
    tabLabel: publicTableTabs(mode).find(t => t.key === def.tab)?.label || def.tab,
    layout: def.layout || "",
    columns: tableColumns(def),
    total: filtered.length,
    offset,
    limit,
    sort,
    dir,
    hasTier,      // 클라 정렬바: 티어 버튼 노출 여부를 데이터로 판단(def 이름 regex 아님)
    defaultSort,  // 클라가 표를 바꿀 때 되돌아갈 기본 정렬
    defaultDir,
    rows: page,
    sourceFile: loaded.sourceFile,
    generatedAt: loaded.generatedAt,
    dataStatus: loaded.sourceFile ? dataStatus[loaded.sourceFile] || null : null
  };
  tablePayloadCachePut(cacheKey, payload);
  return payload;
}
async function dataStatusPayload() {
  let deployMeta = null;
  try { deployMeta = await loadData("deploy-meta.json"); } catch {}
  return {
    ok: true,
    dataBase: DATA_BASE,
    localApiDir: API_DIR,
    ttlMs: TTL_MS,
    generatedAt: deployMeta?.generatedAt || deployMeta?.time || "",
    deployMeta,
    files: Object.values(dataStatus).sort((a, b) => String(a.file).localeCompare(String(b.file)))
  };
}
function fetchJsonU(url) { return new Promise((resolve, reject) => { const req = https.get(url, { timeout: 12000 }, r => { if (r.statusCode !== 200) { r.resume(); return reject(new Error("status " + r.statusCode)); } const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString("utf8"))); } catch (e) { reject(e); } }); }); req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", reject); }); }
let _runeCat = null;
async function fullRuneCatalog() {
  if (_runeCat) return _runeCat;
  const out = [];
  try {
    const rr = await fetchJsonU(`https://ddragon.leagueoflegends.com/cdn/${DDV}/data/ko_KR/runesReforged.json`);
    for (const tree of (rr || [])) tree.slots.forEach((slot, ri) => { for (const rune of slot.runes) out.push({ id: rune.id, name: rune.name, icon: `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`, tree: tree.name, slot: ri, cat: ri === 0 ? "main" : "sub" }); });
  } catch {}
  // 스탯 파편(runesReforged엔 없음) — 고정 3줄(공격/유연/방어)
  const gotTrees = out.length > 0;
  const SHARDS = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];
  SHARDS.forEach((row, ri) => row.forEach(id => out.push({ id, name: SHARD_NAME[id] || ("파편 " + id), icon: shardIcon(id), tree: "파편", slot: 7 + ri, cat: "shard" })));
  if (gotTrees) _runeCat = out; // ★2026-09-25 룬 트리를 못 받은 판(파편만)은 붙잡아 두지 않는다 — 종전엔 한 번 실패하면 앱을 끌 때까지 룬 트리가 빈 채였다
  return out;
}

// ── 소환사 검색(다른 사람) — Riot API. 키는 config.json(서버측만, 클라/발행물 노출 안 함). 키 없으면 NO_KEY. ──
let _riotCfg = null;
function riotCfg() {
  if (process.env.RIOT_API_KEY) {
    return { apiKey: process.env.RIOT_API_KEY, regional: process.env.RIOT_REGIONAL || "asia", tagLine: process.env.RIOT_TAGLINE || "KR1" };
  }
  if (_riotCfg !== null) return _riotCfg;
  for (const cp of [path.resolve(API_DIR, "../../../config.json"), path.resolve(API_DIR, "../../config.json"), "E:\\프린서버\\plugins\\Skript\\scripts\\aram_mayhem_auto\\data\\config.json"]) { try { const r = JSON.parse(readFileSync(cp, "utf8")).riot; if (r && r.apiKey) { return (_riotCfg = r); } } catch {} }
  return (_riotCfg = {});
}
function riotGet(host, p) { return new Promise((resolve, reject) => { const req = https.get("https://" + host + p, { headers: { "X-Riot-Token": riotCfg().apiKey || "" }, timeout: 9000 }, r => { if (r.statusCode !== 200) { r.resume(); return reject(Object.assign(new Error("riot " + r.statusCode), { status: r.statusCode })); } const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString("utf8"))); } catch (e) { reject(e); } }); }); req.on("timeout", () => req.destroy(new Error("timeout"))); req.on("error", reject); }); }
let _champDD = null;
async function champDD() { if (_champDD) return _champDD; const j = await fetchJsonU(`https://ddragon.leagueoflegends.com/cdn/${DDV}/data/ko_KR/champion.json`); const byName = new Map(); for (const key in (j.data || {})) { const c = j.data[key]; byName.set(key, { name: c.name, icon: `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/champion/${c.image.full}` }); } return (_champDD = byName); }
// 아이템 id→이름 전체 카탈로그(ddragon) — 일반 개인 픽 아이템 이름 해석용. 코호트 itemRows(118)엔 없는 본인 빌드 아이템도 이름이 나오게.
let _ddItemMap = null;
async function ddItemMap() { if (_ddItemMap) return _ddItemMap; const m = new Map(); try { const j = await fetchJsonU(`https://ddragon.leagueoflegends.com/cdn/${DDV}/data/ko_KR/item.json`); for (const id in (j.data || {})) { const nm = j.data[id]?.name; if (nm) m.set(Number(id), nm); } } catch {} if (m.size) _ddItemMap = m; return m; } // 빈 맵(받기 실패)은 붙잡지 않는다 — 다음 호출에 다시 받는다(2026-09-25)
// /api/me 개인기록의 picks.items 중 이름이 빈 것(일반 모드 LCU 픽)을 ddragon 이름으로 채움. 증강은 db.json에서 이미 이름 보유.
async function enrichPickItemNames(rec) {
  if (!rec || typeof rec !== "object") return rec;
  let im = null;
  for (const mode of ["standard", "augment"]) {
    const items = rec[mode]?.picks?.items;
    if (!Array.isArray(items) || !items.some(it => it && !it.name && it.id)) continue;
    if (!im) im = await ddItemMap();
    for (const it of items) { if (it && !it.name && it.id != null) { const nm = im.get(Number(it.id)); if (nm) it.name = nm; } }
  }
  return rec;
}
// ⚠️ 비-소유자(db.json 없는 다른 PC) 증강 픽 버그: augfull 캡처는 증강 id(value)만 담아 이름/아이콘이 없다
//   → season2 풀(id/value→localName/icon/rarity)로 recent[].augments·picks.augments의 빈 이름/아이콘을 채운다.
//   소유자(db.json)는 이미 이름 보유 → "빈 것만 채움" 균일 규칙(회귀 0). 지어내지 않음(풀에 없으면 그대로 둠).
async function enrichRecordAugmentNames(rec) {
  const a = rec && rec.augment;
  if (!a || typeof a !== "object") return rec;
  const recent = Array.isArray(a.recent) ? a.recent : [];
  const picks = (a.picks && Array.isArray(a.picks.augments)) ? a.picks.augments : [];
  const needRecent = recent.some(m => ((m && m.augments) || []).some(x => x && (x.value != null || x.id != null) && (!x.name || !x.icon)));
  const needPicks = picks.some(p => p && p.id != null && (!p.name || !p.icon));
  if (!needRecent && !needPicks) return rec; // 이미 다 채워짐(소유자) → 풀 fetch 생략
  let am = null;
  try { const pool = await loadPool("search-pool-all-observedAugments-season2.json"); am = new Map(); for (const r of pool) for (const k of [r.value, r.id, r.rawAugmentId]) if (k != null && !am.has(Number(k))) am.set(Number(k), r); } catch {}
  if (!am) return rec; // 풀 못 받으면 그대로(빈 이름은 클라가 "증강 #id"로 폴백)
  const look = id => am.get(Number(id));
  for (const m of recent) for (const x of ((m && m.augments) || [])) { const r = look(x.value != null ? x.value : x.id); if (!r) continue; if (!x.name) x.name = r.localName || r.name || ""; if (!x.icon) x.icon = r.icon || ""; if (x.rarity == null) x.rarity = r.rarity || null; }
  for (const p of picks) { const r = look(p.id); if (!r) continue; if (!p.name) p.name = r.localName || r.name || ""; if (!p.icon) p.icon = r.icon || ""; if (p.rarity == null) p.rarity = r.rarity || null; }
  // 풀에도 없는 신규 증강(패치 직후)은 CommunityDragon 으로 메운다 — 경기 상세와 같은 규칙
  try {
    const flat = recent.flatMap(m => ((m && m.augments) || []).map(x => ({ get id() { return x.value != null ? x.value : x.id; },
      get name() { return x.name; }, set name(v) { x.name = v; }, get icon() { return x.icon; }, set icon(v) { x.icon = v; },
      get rarity() { return x.rarity; }, set rarity(v) { x.rarity = v; } })));
    await fillUnknownAugments(flat.concat(picks));
  } catch {}
  return rec;
}
// ── 경기 내 10인 순위(전적 개요 등수) ────────────────────────────────────
//   축(가중 MT_W): 딜 · 피해감소 · CC · 받은피해 · 회복 · 자원효율 · 증강픽질 · 메이킹(어시) · 킬 · 빌드초과 − 헛죽음.
//   각 축 = [그 경기 10명 내 z 10%(MT_ABS)] + [증바람 시즌2 실측 그 챔피언 평균 대비 배수(log)의 z 90%]
//   → "누가 잡아도 그 정도 나오는 판"이면 배수가 1 근처라 점수가 안 튄다.
//   ⚠️ 기준선을 코드에 심는 이유 = 다른 PC 에는 로컬 데이터가 없다. 판이 늘면 이 상수만 다시 굽는다.
const MT_AX = ["dmg", "taken", "mit", "cc", "heal", "gold", "death", "kill", "ast"];
const MT_BASE = {"g":46569,"r":465690,"a":[2029.545,2232.629,2193.885,1.899,541.167,931.143,0.599,0.598,1.448],"b":{"1":[1866.384,1482.183,1004.99,2.335,159.171,895.674,0.638,0.498,1.541],"2":[2073.233,2659.417,3721.069,1.129,687.191,918.38,0.726,0.639,1.208],"3":[1732.35,3503.181,6744.117,3.314,489.854,899.158,0.631,0.438,1.665],"4":[1911.014,1456.589,725.189,2.138,170.186,925.792,0.575,0.48,1.547],"5":[2106.833,3725.242,3414.76,1.998,1469.147,926.814,0.738,0.643,1.365],"6":[1915.688,3003.952,3358.833,1.649,439.54,911.861,0.698,0.545,1.326],"7":[2059.853,1610.755,1086.448,0.827,239.253,928.327,0.625,0.724,1.265],"8":[2253.762,2851.868,1648.958,0.548,1956.804,920.721,0.612,0.571,1.377],"9":[1960.883,2130.833,1352.858,3.663,617.836,906.406,0.649,0.523,1.402],"10":[2066.405,1754.785,813.878,0.407,606.163,940.074,0.605,0.558,1.606],"11":[2211.832,2044.433,1890.269,0.109,365.375,971.708,0.754,0.861,0.992],"12":[1451.853,4214.626,6633.012,4.178,1517.195,888.185,0.628,0.412,1.867],"13":[2463.025,2484.768,1655.208,1.433,634.71,944.667,0.59,0.648,1.305],"14":[2288.893,6248.235,8675.177,2.615,960.675,953.818,0.69,0.628,1.461],"15":[2335.391,1582.16,788.89,0.044,303.664,976.399,0.597,0.596,1.669],"16":[573.154,1441.371,921.508,3.379,2723.373,829.35,0.385,0.152,2.287],"17":[1888.729,1497.214,659.601,3.018,164.834,909.118,0.58,0.454,1.359],"18":[2277.093,1638.993,833.803,0.255,288.142,968.083,0.651,0.743,1.106],"19":[1912.89,3654.234,4562.228,1.86,1402.05,918.582,0.697,0.646,1.159],"20":[1660.799,2953.917,3834.379,2.515,1011.099,900.249,0.642,0.5,1.669],"21":[2205.839,1425.125,679.48,1.068,179.032,956.115,0.543,0.623,1.531],"22":[1961.059,1406.692,711.78,2.792,186.722,922.649,0.581,0.523,1.432],"23":[1998.771,2816.137,3707.072,1.473,725.729,930.379,0.719,0.618,1.285],"24":[2083.221,2567.655,2963.209,1.577,523.976,934.277,0.744,0.709,1.155],"25":[1748.051,1559.795,933.463,4.17,331.567,901.502,0.475,0.395,1.902],"26":[1432.718,1495.967,948.389,2.261,599.653,885.996,0.44,0.334,1.875],"27":[1891.256,3127.551,3371.779,3.645,520.229,903.751,0.693,0.418,1.77],"28":[2219.591,1831.643,1716.334,0.709,504.719,922.699,0.58,0.722,1.162],"29":[2392.06,1592.459,769.719,0.673,200.969,994.951,0.677,0.856,1.201],"30":[2868.152,1924.905,953.838,1.829,112.165,958.442,0.854,0.612,1.716],"31":[1848.016,3938.823,4782.505,6.425,723.181,917.858,0.56,0.623,1.345],"32":[1697.505,3394.817,3834.501,2.857,423.767,899.793,0.743,0.477,1.522],"33":[1582.781,3534.403,6619.545,2.903,502.949,897.846,0.68,0.437,1.535],"34":[1588.504,2015.791,1090.782,3.846,327.061,888.654,0.478,0.401,1.483],"35":[1840.045,1502.884,1013.099,1.976,180.656,941.694,0.575,0.729,1.188],"36":[2331.102,5436.387,5456.431,0.987,1252.87,922.157,0.597,0.613,1.287],"37":[1009.245,1649.406,1170.33,0.985,1372.198,864.512,0.455,0.273,2.312],"38":[2287.665,2471.134,2864.516,0.603,501.684,937.05,0.671,0.746,1.279],"39":[2030.152,2658.699,3534.638,1.387,670.623,959.416,0.777,0.674,1.219],"40":[805.888,1345.729,942.435,3.178,1028.451,846.036,0.395,0.196,2.182],"41":[2380.699,1914.102,1357.729,0.768,500.615,999.488,0.552,0.795,1.123],"42":[2542.308,1740.407,1156.261,0.194,302.689,992.433,0.628,0.825,1.25],"43":[1230.773,1445.26,1322.42,1.904,455.045,862.034,0.449,0.306,1.896],"44":[1128.019,3383.148,4699.972,2.683,1447.17,857.776,0.575,0.281,2.077],"45":[1828.194,1595.118,956.27,2.098,299.824,906.844,0.519,0.49,1.434],"48":[1691.685,2871.693,2904.517,2.873,1105.274,909.131,0.535,0.421,1.711],"50":[2043.593,3755.58,2644.617,3.645,1641.224,907.958,0.528,0.513,1.692],"51":[2444.059,1492.609,761.775,1.464,268.417,993.423,0.568,0.785,1.182],"53":[1319.574,2298.87,2754.672,3.439,236.631,845.101,0.603,0.34,1.499],"54":[1809.278,2575.537,3959.846,1.905,321.555,911.557,0.65,0.582,1.334],"55":[2339.427,2425.457,2034.297,0.302,439.751,942.088,0.749,0.752,1.277],"56":[1969.03,2093.521,2000.358,7.849,349.226,953.666,0.708,0.768,1.1],"57":[1893.037,4111.358,5232.997,4.658,1379.274,896.304,0.586,0.441,1.642],"58":[1766.368,3132.087,3693.458,1.369,882.974,900.853,0.695,0.536,1.275],"59":[1883.889,3014.123,3818.533,2.256,499.808,932.038,0.722,0.6,1.926],"60":[2030.115,1740.442,1308.881,1.974,389.19,908.824,0.588,0.584,1.333],"61":[1962.503,1397.385,991.929,1.863,210.331,925.715,0.508,0.514,1.817],"62":[1878.412,2582.669,3063.889,0.878,485.152,929.151,0.674,0.661,1.331],"63":[2445.187,1690.38,767.606,1.594,211.806,937.431,0.616,0.569,1.442],"64":[1852.447,2251.459,3207.128,1.341,600.568,928,0.66,0.673,1.472],"67":[2567.753,1616.569,884.372,0.513,253.472,958.399,0.666,0.779,1.026],"68":[2527.515,2081.822,2113.759,1.101,375.38,945.668,0.674,0.668,1.458],"69":[2063.889,2193.604,1287.643,2.489,612.287,926.529,0.577,0.588,1.381],"72":[2200.556,3884.822,6712.659,3.052,670.542,927.767,0.614,0.577,1.604],"74":[2142.523,1473.659,703.131,1.906,212.491,908.948,0.493,0.437,1.482],"75":[1859.281,2983.734,3815.333,1.184,682.999,935.223,0.613,0.543,1.444],"76":[2101.281,1575.026,1021.694,0.059,711.128,927.305,0.433,0.621,1.549],"77":[2389.615,2263.405,2663.394,2.484,372.207,939.574,0.753,0.549,1.419],"78":[1968.423,3895.832,6356.405,2.674,755.357,915.699,0.603,0.582,1.374],"79":[1831.287,2990.82,3839.094,3.156,988.076,894.206,0.56,0.514,1.463],"80":[2103.768,2192.803,2297.675,1.622,429.019,935.465,0.686,0.75,1.209],"81":[2479.076,1671.785,875.141,0.073,379.227,953.836,0.508,0.67,1.286],"82":[2158.741,2905.11,3791.325,1.081,827.941,906.366,0.668,0.594,1.276],"83":[1733.59,2661.081,2554.349,0.95,762.509,889.357,0.55,0.441,1.374],"84":[1959.38,2233.401,2198.696,0.264,428.233,921.455,0.66,0.705,1.133],"85":[1873.609,1620.312,1096.2,1.628,186.046,897.383,0.647,0.526,1.292],"86":[1891.646,3111.676,4743.576,2.285,434.373,932.749,0.662,0.673,1.103],"89":[1694.465,3938.578,6187.639,3.611,617.898,883.714,0.643,0.428,1.539],"90":[1865.315,1485.619,930.883,4.444,194.625,938.107,0.532,0.458,1.435],"91":[2352.065,1967.262,1811.052,0.488,280.74,973.835,0.73,0.846,1.12],"92":[1742.405,2126.194,3913.294,2.218,425.788,911.624,0.675,0.623,1.193],"96":[2447.187,1541.511,789.913,0.876,202.786,944.291,0.619,0.624,1.442],"98":[1911.684,3737.432,6059.431,2.649,581.227,891.958,0.602,0.479,1.736],"99":[1694.81,1130.451,839.055,4.116,143.956,900.413,0.441,0.421,1.809],"101":[2044.617,1184.824,593.574,2.006,140.009,913.521,0.452,0.537,1.622],"102":[2339.557,2544.213,3488.775,0.959,603.495,928.11,0.619,0.576,1.36],"103":[2042.308,1663.296,885.997,1.643,430.07,917.642,0.565,0.55,1.473],"104":[2583.602,1987.492,1627.761,1.273,493.019,1035.016,0.658,0.942,1.107],"105":[2056.635,2365.212,1946.784,0.828,323.696,935.175,0.742,0.725,1.229],"106":[1914.064,3890.614,5442.617,1.949,944.709,899.516,0.642,0.531,1.34],"107":[2186.764,2261.897,2015.395,0.569,512.827,970.525,0.816,0.905,0.949],"110":[2422.316,1471.151,745.577,1.658,219.059,972.083,0.564,0.764,1.298],"111":[1533.534,3657.588,7051.469,5.541,572.654,885.405,0.618,0.43,1.639],"112":[2363.436,1495.766,1286.167,2.47,254.379,940.042,0.535,0.597,1.588],"113":[2071.623,4203.05,5490.79,2.051,637.03,931.237,0.657,0.616,1.484],"114":[2168.659,2590.257,3574.619,0.8,914.223,929.294,0.721,0.663,1.278],"115":[2036.549,1327.497,592.213,1.632,168.529,905.093,0.469,0.428,1.598],"117":[649.439,1271.755,865.103,2.562,557.135,836.667,0.418,0.18,2.171],"119":[2438.571,1786.373,1199.874,0.817,394.427,1054.445,0.633,0.879,1.026],"120":[2249.74,3408.805,4381.395,1.423,1122.646,940.02,0.737,0.72,1.381],"121":[2179.073,1882.124,1702.304,0.9,447.072,962.3,0.645,0.846,1.047],"122":[1840.379,2947.242,3262.952,1.793,763.648,911.231,0.686,0.598,1.223],"126":[2321.169,1469.041,1144.537,0.79,190.289,965.286,0.604,0.743,1.502],"127":[1891.126,1937.387,1111.759,4.142,342.859,912.23,0.709,0.502,1.589],"131":[2045.268,2206.814,2826.342,0.675,320.157,922.997,0.707,0.634,1.34],"133":[2250.715,1614.004,1090.991,1.664,256.379,973.863,0.651,0.808,1.084],"134":[2123.624,1379.336,733.351,3.289,225.194,926.961,0.523,0.578,1.406],"136":[2180.348,1830.772,985.608,1.696,299.95,962.521,0.61,0.635,1.557],"141":[2282.692,2456.974,2612.091,1.326,695.018,916.665,0.746,0.654,1.178],"142":[2031.009,1368.652,819.304,2.264,195.215,909.653,0.517,0.558,1.426],"143":[2022.54,1411.591,705.407,3.293,204.155,904.626,0.497,0.408,1.573],"145":[2361.382,1364.889,923.669,0.036,188.138,957.195,0.531,0.723,1.21],"147":[1799.58,1377.931,879.578,2.918,406.316,914.56,0.471,0.459,2.146],"150":[2102.464,3010.965,3129.588,2.181,457.741,923.671,0.602,0.63,1.322],"154":[1663.405,4465.724,5365.544,3.014,2551.181,882.514,0.649,0.448,1.423],"157":[1932.139,2046.357,2865.188,1.673,414.442,929.111,0.713,0.559,1.211],"161":[2149.265,1330.745,676.536,2.396,189.692,907.903,0.486,0.493,1.535],"163":[2137.08,1592.456,818.141,3.083,252.292,917.4,0.588,0.509,1.555],"164":[1831.418,2608.552,3463.536,1.616,594.212,901.085,0.714,0.593,1.274],"166":[2411.887,1596.105,1144.787,0.067,241.072,1029.301,0.654,0.881,1.056],"200":[1962.697,2570.355,2900.787,1.56,724.636,924.142,0.69,0.625,1.204],"201":[1214.862,3625.575,4415.692,3.001,450.46,849.471,0.59,0.284,1.919],"202":[2201.98,1406.366,702.305,1.796,198.374,999.313,0.533,0.809,1.292],"203":[2349.197,1731.706,1211.818,0.215,603.6,977.852,0.639,0.757,1.158],"221":[2446.592,1657.899,956.768,0.355,247.855,1004.874,0.628,0.793,1.25],"222":[2370.78,1523.484,719.913,1.192,227.939,989.512,0.607,0.741,1.335],"223":[2092.298,4309.235,5695.591,2.222,1609.829,893.512,0.501,0.546,1.438],"233":[2103.657,3260.111,4101.948,2.126,1720.282,929.551,0.778,0.668,1.254],"234":[2205.299,2287.431,2178.167,1.298,663.402,973.472,0.7,0.866,1.026],"235":[1888.198,1554.229,800.457,2.16,889.51,956.304,0.506,0.503,1.893],"236":[2605.555,1624.948,959.055,0.05,266.021,1008.308,0.635,0.882,1.16],"238":[2330.855,1690.82,1499.284,0.492,245.848,971.206,0.646,0.858,1.14],"240":[2022.009,3645.633,4016.751,0.711,484.811,907.967,0.637,0.541,1.495],"245":[2236.74,2355.964,2169.088,1.664,686.678,958.606,0.649,0.818,1.27],"246":[2224.084,1831.182,1627.306,1.379,230.837,958.19,0.699,0.837,1.107],"254":[1889.386,2893.772,4144.766,2.054,514.948,912.441,0.712,0.617,1.243],"266":[2029.959,3095.275,3614.552,1.523,1307.897,902.28,0.646,0.598,1.222],"267":[880.191,1374.652,816.071,2.653,1281.604,844.823,0.396,0.197,2.221],"268":[2276.027,1669.61,1241.703,0.859,270.272,930.194,0.627,0.595,1.324],"350":[835.353,780.957,465.095,1.479,807.338,845.098,0.292,0.204,2.314],"360":[2593.822,2128.853,1531.318,0.214,545.459,1043.333,0.75,1.056,1.033],"412":[1335.976,3412.34,4065.938,2.864,431.571,857.02,0.597,0.338,1.825],"420":[2162.757,4116.043,4657.012,0.476,1342.201,914.934,0.595,0.547,1.311],"421":[1735.919,3646.109,4624.245,2.62,1486.126,893.232,0.594,0.52,1.513],"427":[735.233,1359.533,1063.337,3.278,679.516,839.491,0.395,0.192,2.166],"429":[2304.953,1736.248,1228.597,0.636,310.886,967.084,0.658,0.758,1.141],"432":[1203.92,1756.8,1105.613,3.246,1167.121,862.525,0.463,0.311,1.812],"497":[1145.361,3199.501,4497.578,2.895,765.83,866.681,0.553,0.333,1.883],"498":[2384.811,1575.277,802.328,1.104,258.384,979.822,0.601,0.725,1.225],"516":[1757.929,4418.817,5602.026,2.727,681.94,897.451,0.596,0.479,1.461],"517":[2049.763,3169.837,2972.643,1.736,1082.852,918.836,0.695,0.675,1.314],"518":[1699.245,1486.457,869.922,3.284,170.861,884.415,0.549,0.453,1.398],"523":[2565.833,1683.106,966.12,0.848,391.777,1012.627,0.622,0.849,1.081],"526":[1677.503,3892.174,6764.534,2.971,649.996,901.383,0.605,0.457,1.881],"555":[1389.274,1894.901,1830.229,2.486,638.109,935.562,0.517,0.756,1.153],"711":[2060.123,1483.659,1251.861,2.424,210.983,917.136,0.573,0.561,1.478],"777":[2237.824,2015.801,2679.874,1.677,430.376,937.508,0.703,0.611,1.199],"799":[2297.068,2341.573,3601.647,0.819,586.134,936.176,0.714,0.706,1.26],"800":[2105.473,1425.333,895.069,2.816,221.928,969.616,0.52,0.807,1.214],"804":[2602.437,1674.334,854.382,0.507,286.573,994.627,0.654,0.782,1.283],"805":[1727.858,2173.05,1697.788,0.904,577.098,940.669,0.735,0.831,1.064],"875":[2431.478,4249.731,4754.689,1.742,550.428,920.588,0.633,0.641,1.235],"876":[2503.898,2269.362,1529.564,1.834,813.708,933.492,0.571,0.58,1.463],"887":[2453.089,2712.749,2538.192,0.444,964.274,930.768,0.659,0.689,1.222],"888":[1013.68,1531.394,1204.27,1.703,430.877,851.834,0.474,0.246,2.068],"893":[2599.98,1732.699,930.251,0.8,452.043,943.48,0.565,0.704,1.412],"895":[2064.357,2079.289,1975.074,0.721,604.187,981.555,0.69,0.755,1.21],"897":[1737.115,3446.887,5798.078,2.564,584.854,872.854,0.659,0.43,1.449],"901":[2321.302,1574.283,760.085,0.736,255.876,951.962,0.568,0.583,1.408],"902":[779.36,1288.958,864.249,1.696,1105.944,848.282,0.36,0.17,2.298],"904":[2086.852,3415.95,3966.356,1.79,1185.619,912.835,0.662,0.586,1.35],"910":[2229.212,1382.61,871.378,2.288,230.523,937.407,0.464,0.535,1.814],"950":[2010.831,1866.374,1839.701,0.198,403.861,969.376,0.647,0.808,1.111]}};
const MT_ITEM_EXPECT = {"games":46569,"rows":465690,"items":199,"gAvg":{"dmg":2029.545,"taken":2232.629,"mit":2193.885,"cc":1.899,"heal":541.167,"gold":931.143},"e":{"1001":[1628.776,1842.797,1517.433,1.91,416.684,892.39,20915],"1004":[1023.236,1351.635,1065.868,2.17,801.146,849.35,570],"1006":[1502.361,2734.891,3011.962,2.498,677.622,863.122,690],"1011":[1614.368,3133.531,3858.405,2.719,692.606,876.06,11325],"1018":[1748.437,1508.171,1010.947,1.098,247.008,916.695,7747],"1026":[1746.334,1574.297,1073.579,2.042,359.39,887.176,6239],"1027":[1702.402,1799.537,1465.46,2.138,401.332,890.936,395],"1028":[1518.173,2831.512,3117.881,2.411,638.625,864.03,13596],"1029":[1537.568,2866.776,3300.322,2.466,624.18,868.992,4475],"1031":[1532.634,3276.288,4073.647,2.791,672.746,863.109,6777],"1033":[1609.022,2740.151,3011.758,2.301,615.847,880.875,4085],"1036":[1831.482,1792.128,1488.052,1.185,356.757,920.906,15345],"1037":[1760.097,1769.327,1463.463,1.151,357.698,909.502,11774],"1038":[1934.477,1529.215,998.885,1.067,271.326,942.606,8440],"1042":[1712.2,1566.218,1099.6,1.16,295.358,909.497,4289],"1043":[1910.198,1689.219,1186.706,1.104,327.888,913.398,6354],"1052":[1668.66,1554.543,1076.428,2.114,348.994,884.069,16594],"1053":[2136.159,1681.96,1138.905,0.994,317.249,956.846,9869],"1057":[1666.295,3007.497,3683.375,2.432,605.97,883.457,6017],"1058":[1818.686,1613.252,1093.405,2.057,325.778,895.733,27016],"2003":[1382.51,1816.454,1614.64,1.773,450.092,860.044,461],"2019":[1888.237,2385.08,2534.01,1.399,609.158,915.868,3304],"2020":[1875.58,1737.197,1478.519,1.325,337.965,942.367,1877],"2021":[1868.95,2882.54,3178.304,1.593,624.032,903.237,6468],"2022":[1473.821,1969.815,1797.713,2.008,516.86,869.534,3189],"2031":[1518.599,1411.876,990.153,2.115,266.727,874.719,13986],"2051":[1363.873,2713.886,3342.527,2.806,611.12,862.798,1448],"2052":[2038.294,2245.669,2224.185,1.888,547.583,931.265,194025],"2065":[921.248,1553.753,1290.949,2.183,714.31,861.619,2144],"2420":[1793.474,1782.493,1256.583,1.922,379.605,902.234,3099],"2421":[1894.054,1834.102,1327.462,1.995,416.948,912.301,2267],"2501":[2519.313,4900.555,5764.868,1.884,1011.009,945.549,9979],"2502":[1988.156,4527.97,6692.36,3.153,1167.271,914.021,37870],"2503":[2217.642,1609.691,945.772,2.55,295.192,933.48,49132],"2504":[1709.321,3867.01,6475.337,2.982,716.779,904.647,12144],"2508":[1744.563,1592.252,1049.462,2.171,321.302,891.293,3386],"2510":[2290.068,2564.751,2377.42,1.271,793.134,942.571,12357],"2512":[2407.3,1762.573,1141.317,0.812,281.169,985.002,7414],"2517":[2606.18,2725.168,3192.073,1.163,914.457,977.341,6892],"2522":[2541.906,2473.3,1735.648,1.57,625.849,953.509,2730],"2523":[2407.395,1577.043,828.074,1.369,340.657,993.832,7215],"2524":[1295.66,2439.59,3053.681,3.079,731.59,879.265,831],"2525":[1711.085,3564.703,4946.319,2.815,879.185,905.397,921],"2526":[1265.951,1705.587,1415.937,2.056,754.439,866.576,622],"2530":[735.902,1376.264,946.718,2.292,1350.783,845.683,15147],"3003":[1967.199,1682.392,1165.863,2.231,372.396,912.621,1722],"3004":[1941.352,1920.652,1547.58,1.363,408.839,930.608,1039],"3006":[2270.607,1642.501,1094.281,1,301.182,967.764,61386],"3008":[2481.776,2120.966,1644.863,1.296,597.006,977.483,45640],"3009":[1974.113,2058.93,1670.548,2.15,511.192,947.967,17421],"3020":[2053.56,1651.26,1114.554,2.141,323.847,920.986,108125],"3024":[1742.07,2543.827,2874.575,2.217,545.92,893.127,316],"3031":[2450.709,1751.646,1209.221,0.972,350.732,1000.239,90015],"3032":[2298.492,1586.219,886.741,0.977,260.457,969.505,15453],"3033":[2592.689,1829.897,1291.085,0.989,393.318,1001.829,15140],"3035":[2077.144,1576.041,1049.106,1.021,277.393,953.32,6628],"3036":[2790.105,1794.349,1189.296,0.965,374.281,1017.083,32951],"3039":[2173.6,3292.656,3547.988,1.759,666.834,939.722,363],"3040":[2112.269,1934.113,1371.201,2.282,469.348,928.996,23201],"3042":[2371.258,1844.34,1436.671,0.972,413.941,963.051,21474],"3044":[1820.638,2339.303,2565.277,1.594,548.173,904.722,1785],"3046":[2286.464,1968.855,1780.105,1.456,355.693,970.386,6176],"3047":[1903.82,3500.086,4789.983,2.416,835.851,914.906,29924],"3050":[1388.399,2858.775,4403.942,3.089,592.919,881.793,1130],"3051":[2133.736,1707.89,1180.029,0.947,335.947,937.131,2104],"3053":[2223.378,3409.317,4368.524,1.598,830.335,940.024,6174],"3057":[1726.169,2037.23,1839.715,1.497,486.183,896.426,2199],"3065":[2018.837,4150.362,5586.989,2.511,1413.056,917.308,35268],"3066":[1617.465,2846.977,3227.238,2.478,535.41,882.037,867],"3067":[1464.618,2767.658,3009.894,2.533,738.151,859.789,7457],"3068":[1954.19,3965.607,5970.418,3.088,839.059,948.697,5976],"3070":[1527.863,1874.759,1645.039,2.442,416.85,872.39,14629],"3071":[2221.406,2567.584,2969.25,1.671,717.001,943.959,10102],"3072":[2672.16,1863.204,1316.207,0.862,435.921,1034.561,21766],"3073":[2175.724,2384.908,2530.299,2.163,499.142,949.835,4385],"3074":[2224.319,2632.124,3226.595,1.248,866.418,954.374,3467],"3075":[1828.39,4161.951,6485.554,2.933,923.636,910.48,30655],"3076":[1585.297,3588.097,4655.205,2.9,763.856,868.079,7444],"3077":[1909.822,2911.749,3197.524,1.806,642.469,912.429,1323],"3078":[2194.489,2357.889,2333.062,0.931,583.524,945.162,17111],"3082":[1639.177,3250.985,4221.485,2.531,686.697,885.902,2970],"3083":[1905.044,4560.24,6046.673,2.916,1066.918,911.882,38246],"3084":[1881.325,4162.329,5578.725,2.791,940.73,900.048,83765],"3085":[2424.035,1626.029,876.973,1.118,355.914,983.078,23089],"3086":[1831.705,1520.465,1005.885,1.176,286.576,925.801,2809],"3087":[2049.169,1800.795,1117.42,1.616,614.61,949.445,12190],"3089":[2292.833,1818.189,1273.748,2,422.716,947.818,82812],"3091":[2370.242,2065.879,2020.859,1.079,451.713,964.508,10289],"3094":[2138.635,1546.72,803.344,1.47,310.211,976.123,15879],"3097":[2378.997,1693.332,1052.783,1.09,280.815,987.63,2933],"3100":[2045.517,1881.566,1434.357,1.527,438.443,934.103,14938],"3102":[2141.541,1790.207,1393.4,1.803,380.768,953.52,3032],"3107":[789.762,1443.997,1043.368,2.241,1285.157,853.836,6004],"3108":[1596.031,1758.417,1303.845,2.117,536.774,874.366,4936],"3109":[1176.58,2484.643,3271.716,2.634,857.123,874.16,965],"3110":[1778.271,3219.129,4795.594,2.527,725.507,916.458,5306],"3111":[1904.612,3342.332,4336.745,2.306,807.298,915.471,92974],"3112":[1838.243,1790.062,1409.907,1.936,452.171,907.539,823],"3113":[1524.583,1549.706,1111.62,1.919,444.812,876.399,2976],"3114":[738.778,1212.593,818.527,2.196,984.263,825.621,2912],"3115":[2223.737,1877.791,1331.302,1.312,461.628,937.537,15280],"3116":[2108.513,2088.03,1494.221,2.907,477.39,927.465,32745],"3118":[1933.985,1718.461,1246.954,2.458,293.318,908.428,45425],"3119":[1655.899,2847.528,3018.423,2.649,714.634,886.171,1706],"3121":[1606.119,3780.032,5482.523,3.615,869.172,887.356,18367],"3123":[2060.309,1844.685,1491.097,1.244,389.62,930.675,3952],"3124":[2491.157,1701.572,1066.617,0.658,344.141,961.698,13945],"3133":[1827.374,2059.746,2040.226,1.257,478.577,910.314,6537],"3134":[1817.35,1644.318,1289.28,1.351,302.941,928.886,4663],"3135":[2536.432,1791.583,1251.074,2.027,384.887,958.003,29685],"3137":[2146.561,1768.513,1223.369,2.31,444.507,937.135,4203],"3139":[2801.459,2038.578,1676.933,0.934,509.769,1036.559,3102],"3140":[2282.68,1947.998,1656.38,1.092,409.713,975.866,1054],"3142":[2033.787,1884.547,1584.764,1.67,429.939,974.816,4308],"3143":[1892.656,3912.014,6199.301,2.614,895.142,926.07,13396],"3144":[1675.716,1468.47,893.871,1.323,290.213,909.788,2039],"3145":[1691.682,1521.792,1053.374,1.953,282.42,881.392,8871],"3146":[2201.399,2182.123,1894.121,0.72,516.563,948.759,3923],"3147":[1780.118,2030.333,1645.11,2.475,500.595,885.008,5479],"3152":[1917.609,2208.907,1851.394,1.81,590.914,919.588,10558],"3153":[2597.741,1953.177,1573.474,1.075,463.542,971.507,49856],"3155":[2045.622,2071.299,2091.315,1.21,483.978,944.118,1199],"3156":[2316.86,2275.834,2731.192,1.135,608.08,984.859,4985],"3157":[2052.968,1965.855,1542.13,2.095,450.275,936.563,33488],"3158":[1643.769,1651.886,1208.786,1.838,598.393,908.05,44251],"3161":[2336.923,2487.923,2686.686,1.057,683.939,949.113,14287],"3165":[2227.327,1796.537,1187.841,2.635,427.352,934.938,21772],"3177":[2112.997,2099.239,1989.859,1.382,508.963,957.668,1099],"3179":[2111.175,1989.07,1752.124,1.723,413.987,962.23,431],"3181":[2165.069,2741.352,2803.035,1.762,624.283,937.042,150],"3184":[1970.285,2001.92,1824.576,1.378,475.084,943.692,330],"3190":[868.664,1862.877,2109.873,2.463,864.082,861.577,2121],"3211":[1638.614,3318.329,3940.075,2.604,840.731,876.577,5782],"3222":[779.466,1323.942,973.289,2.135,1052.172,853.486,3403],"3302":[2767.201,1877.851,1350.181,0.768,392.915,982.12,7102],"3330":[1959.374,2131.936,1404.657,3.534,610.735,908.978,1906],"3400":[1831.682,1994.663,1943.957,2.016,530.824,921.742,168],"3504":[753.774,1350.345,923.084,2.129,1155.4,850.47,8661],"3508":[2471.423,1701.615,1046.11,0.552,329.492,986.685,14122],"3742":[1799.377,3090.125,3990.752,2.591,617.841,920.483,2104],"3748":[2387.42,4212.51,4778.088,1.793,892.837,942.962,6562],"3801":[1435.928,2867.161,3372.546,2.697,628.467,853.541,1255],"3802":[1623.01,1535.879,1058.477,2.259,323.766,879.285,2993],"3803":[1831.944,2157.321,1961.316,2.281,617.337,901.718,143],"3814":[2097.492,1879.171,1580.99,1.631,386.908,980.637,5811],"3916":[1936.085,1619.099,1050.688,2.603,354.666,897.346,18669],"4003":[1896.775,2168.622,2186.251,1.963,470.408,925.094,90],"4004":[1940.768,2090.095,2002.016,2.15,424.09,943.551,264],"4005":[1389.932,1797.775,1563.183,3.108,643.307,882.701,8196],"4401":[1875.441,3758.285,5796.812,2.707,788.685,922.308,6401],"4628":[1978.783,1375.965,844.187,1.868,296.417,918.727,8315],"4629":[2090.399,2376.59,1764.233,1.89,993.892,927.411,6081],"4630":[2055.335,1653.194,1143.497,2.082,324.036,914.825,8619],"4632":[1913.822,1810.18,1441.496,1.829,368.043,925.339,578],"4633":[2339.658,3306.572,3227.595,1.931,1196.163,931.932,19720],"4642":[1088.626,1476.025,1155.162,2.348,773.056,850.686,837],"4645":[2170.602,1698.61,1184.474,1.936,331.601,936.547,85022],"4646":[1985.91,1643.892,1228.591,1.84,319.556,921.38,28962],"6333":[2233.541,2729.863,3864.612,1.424,841.828,952.192,19094],"6609":[2465.173,2484.486,2685.476,1.552,664.088,964.707,1336],"6610":[1982.536,2987.427,3710.341,1.613,924.013,922.134,21027],"6616":[854.972,1454.71,1046.335,1.996,1330.593,862.857,3225],"6617":[736.889,1365.93,932.333,2.301,1330.034,844.925,17579],"6620":[956.691,1572.116,1096.27,2.152,1630.59,868.487,2469],"6621":[803.188,1445.005,999.26,2.152,1538.072,859.953,5889],"6631":[1958.293,2927.764,3682.385,2.071,552.096,928.65,4205],"6653":[2277.627,1838.781,1249.346,2.531,377.583,931.919,75942],"6655":[1953.56,1460.739,959.936,1.99,301.313,917.734,56537],"6657":[1993.219,2650.381,2124.145,2.471,804.261,913.972,22691],"6660":[1583.002,3390.536,4029.631,2.903,681.687,885.539,1865],"6662":[1860.809,3276.874,4507.696,1.975,822.462,907.908,3308],"6664":[1953.392,4333.524,6541.846,3.062,865.93,937.835,9270],"6665":[2015.471,3864.929,6170.706,2.661,923.011,932.393,18494],"6670":[1962.986,1643.487,1124.324,1.106,296.555,946.298,2975],"6672":[2459.282,1782.66,1264.201,0.819,353.795,979.306,18305],"6673":[2296.087,2073.135,2134.212,1.088,501.536,990.574,7522],"6675":[2408.679,1778.711,1196.791,0.495,338.524,983.141,13422],"6676":[2255.029,1748.698,1278.477,1.024,340.928,1004.091,62997],"6690":[1837.723,1709.863,1298.792,1.335,350.409,922.792,856],"6692":[2126.126,2292.427,3010.551,1.28,597.406,937.939,14574],"6694":[2410.766,1787.161,1416.732,0.985,345.197,982.914,12815],"6695":[2353.107,1932.855,1670.852,1.285,406.815,971.881,10667],"6696":[2075.761,1838.361,1612.911,1.791,357.202,965.809,17069],"6698":[2230.248,2076.069,1989.495,1.794,432.724,978.727,2175],"6699":[2267.243,1863.211,1596.259,1.166,357.924,979.837,13914],"8010":[2488.13,2045.612,1457.977,2.63,453.036,954.656,7560],"8020":[1934.095,3420.676,4832.075,2.909,676.281,917.396,2152],"123430":[2169.105,1786.425,2185.058,1.61,428.926,941.267,1405],"124011":[1138.183,1670.518,1172.717,2.16,1367.779,879.989,4680],"126697":[2180.186,1857.337,1666.475,1.317,380.611,967.36,32653],"220013":[2051.452,2240.302,2206.895,1.899,551.306,934.66,232289],"223069":[2032.233,3772.154,6530.147,2.825,671.022,933.329,5781],"228002":[2156.966,1719.153,1392.583,1.887,387.836,932.124,9000],"994403":[2143.389,2227.795,2211.643,1.746,473.891,944.63,876]}};
// 아이템/증강 기대치가 없는(모두가 드는) 소모품·트링킷 — 변별력이 0 이라 빌드 기대치에서 뺀다
const MT_NOINFO_ITEM = new Set([2052, 2055, 2003, 2031, 2033, 3340, 3363, 3364]);
// ── 안 보이는 산출(아군 힐·실드) 추정 ─────────────────────────────
//   ⚠️ 롤 클라이언트(LCU)는 totalHealsOnTeammates·totalDamageShieldedOnTeammates 를 주지 않는다 — 전 참가자 0으로 온다.
//      (2026-08-29 실측: 로컬 증바람 캐시 6,810 참가자행 전부 0. 사이트 파이프라인은 Riot 웹 API 라 정상적으로 들어온다.)
//      그래서 "그 판에 산 아이템"으로 추정한다. ⚠️ 챔피언은 보지 않는다 — 챔피언으로 역할을 정하면 구원 산 브루저는
//      영원히 안 잡히고 딜템만 간 서포터는 계속 인정받는다(같은 챔프 안에서 실측 보호량이 10~34배 갈린다).
//   값 = 그 아이템을 산 사람들의 분당 아군 힐+실드 평균. q450 로컬 코호트 1,770판 17,700행, 40판 이상 등장한 108종.
const MT_PROT_ITEM = {"2065":625,"2501":0,"2502":49,"2503":38,"2504":67,"2510":6,"2512":1,"2517":8,"2522":22,"2523":18,"2524":138,"2525":67,"2530":948,"3006":7,"3008":14,"3009":73,"3020":35,"3031":10,"3032":8,"3033":6,"3036":4,"3040":67,"3042":7,"3046":1,"3047":32,"3050":136,"3053":10,"3065":39,"3071":33,"3072":7,"3073":3,"3075":53,"3076":60,"3078":10,"3083":195,"3084":45,"3085":16,"3087":76,"3089":40,"3091":4,"3094":41,"3097":3,"3100":35,"3107":925,"3109":366,"3110":54,"3111":33,"3115":7,"3116":43,"3118":77,"3121":87,"3123":22,"3124":5,"3135":32,"3137":70,"3142":2,"3143":59,"3146":4,"3152":14,"3153":9,"3156":15,"3157":28,"3158":223,"3161":1,"3165":173,"3190":378,"3222":790,"3302":3,"3330":0,"3504":1001,"3508":1,"3742":7,"3748":6,"3814":3,"3916":91,"4005":350,"4401":58,"4628":73,"4629":38,"4633":4,"4645":36,"4646":38,"6333":12,"6610":10,"6617":938,"6620":898,"6621":1255,"6631":5,"6653":32,"6655":53,"6657":30,"6662":73,"6664":39,"6665":55,"6672":10,"6673":3,"6675":2,"6676":10,"6692":19,"6694":2,"6695":6,"6696":2,"6698":2,"6699":3,"6701":0,"8010":25,"8020":58,"126697":7};
// ── 기댓값 기준선(모드별) ─────────────────────────────────────────
//   "잘할 수밖에 없었던 판은 짜게, 못할 수밖에 없었던 판은 후하게" — 절대량이 아니라 기댓값 초과분으로 센다.
//   기댓값을 챔피언 하나가 아니라 여러 단으로 세운다. 뒤 단은 앞 단의 잔차에 얹는다.
//     증바람(q2400): 챔프 → 증강 → 아이템 → 아군 구성 → 상대 구성 → 상대 아이템   (전수 50,608판)
//     일반(q450):    챔프 → 아이템 → 아군 구성 → 상대 구성 → 상대 아이템          (전수 67,987판)
//   ⚠️ 두 모드는 절대 안 섞는다 — 표도 축도 따로다(증바람엔 아군 힐·실드가 데이터에 0, 일반엔 증강이 없다).
//   상대 구성을 넣으면 분당 딜 설명력이 0.236 → 0.323 으로 오른다(홀드아웃). 상대가 물렁해서 나온 딜을 걸러낸다.
const MT_EXPECT_2400 = {"AX":["dmg","taken","mit","heal","cc","gold","k","a","d"],"TBL":{"dmg":{"gm":2030.29,"layers":[{"nm":"ch","tab":{"1":-167.5,"2":52.9,"3":-310.1,"4":-127.6,"5":93.7,"6":-105.5,"7":42.7,"8":240.3,"9":-75.5,"10":38.1,"11":187,"12":-586.4,"13":431.5,"14":243.4,"15":315.1,"16":-1488.4,"17":-142,"18":253.1,"19":-108.1,"20":-373.8,"21":176.8,"22":-71.5,"23":-22.6,"24":53.6,"25":-283.9,"26":-612.4,"27":-136,"28":236.3,"29":374.8,"30":843.3,"31":-187.7,"32":-334.1,"33":-463.7,"34":-451.2,"35":-188.3,"36":298.2,"37":-1044.5,"38":273.3,"39":8,"40":-1266,"41":370.9,"42":514.2,"43":-824.6,"44":-976.1,"45":-209.2,"48":-345.9,"50":20.5,"51":416.7,"53":-717.9,"54":-228.5,"55":316.9,"56":-56.4,"57":-140.9,"58":-271.5,"59":-144.4,"60":-9.4,"61":-68,"62":-153.8,"63":420.3,"64":-175.3,"67":535,"68":509.4,"69":36.2,"72":180,"74":113.3,"75":-170.2,"76":72.4,"77":373.6,"78":-66.6,"79":-201.9,"80":83.9,"81":457.3,"82":129,"83":-338.2,"84":-62.3,"85":-153.9,"86":-132.2,"89":-349.3,"90":-167.9,"91":334.8,"92":-313.4,"96":434,"98":-124.1,"99":-342.9,"101":15.7,"102":307,"103":15.3,"104":553.8,"105":31.4,"106":-115.5,"107":180.8,"110":396.9,"111":-504.4,"112":346.9,"113":42.4,"114":148,"115":7.8,"117":-1413.5,"119":426.9,"120":234.6,"121":153.8,"122":-204.9,"126":303.6,"127":-141,"131":17.1,"133":249.1,"134":101,"136":164,"141":267.3,"142":9.7,"143":-11.6,"145":333,"147":-234.9,"150":73,"154":-385.3,"157":-102,"161":123.5,"163":111.4,"164":-211.4,"166":369.5,"200":-56.2,"201":-845.2,"202":172.8,"203":315.3,"221":433.6,"222":346.4,"223":55.7,"233":77,"234":192.1,"235":-139.9,"236":569.3,"238":312.1,"240":-9.3,"245":198.5,"246":197,"254":-142,"266":8.4,"267":-1188.4,"268":246.7,"350":-1222.2,"360":567.5,"412":-707.1,"420":142.6,"421":-321.2,"427":-1362.7,"429":284.3,"432":-848.1,"497":-930.8,"498":358.2,"516":-286.4,"517":25.3,"518":-339.9,"523":542.8,"526":-372.8,"555":-647.7,"711":35.3,"777":212.7,"799":292.6,"800":75.1,"804":582.2,"805":-298,"875":411.1,"876":477.3,"887":455.6,"888":-1050,"893":574.2,"897":-308.3,"901":306.5,"902":-1284.5,"904":59.1,"910":203.6}},{"nm":"aug","tab":{"1001":-70.7,"1002":87.2,"1004":291.6,"1005":-125.4,"1006":14.5,"1007":75.3,"1011":-149.8,"1013":10.3,"1015":189.7,"1018":-83.6,"1019":-32.3,"1020":-31.6,"1022":14.1,"1025":148.2,"1026":55.9,"1027":35.2,"1028":46,"1029":72.6,"1030":83.3,"1034":-109.3,"1036":223.2,"1037":-120.6,"1038":163.8,"1041":73.9,"1044":-91.4,"1045":217.1,"1046":1.6,"1047":29.2,"1048":61.5,"1051":115.3,"1053":89.8,"1054":54,"1056":13.8,"1057":-91.6,"1058":22.9,"1060":38.9,"1061":151,"1062":83.3,"1063":21.8,"1067":-119.3,"1068":52.6,"1071":48,"1072":-75.5,"1073":9.8,"1074":0.5,"1076":1.2,"1077":133.3,"1079":70.9,"1080":50.5,"1081":-4.1,"1084":49.9,"1087":1.9,"1088":-148.7,"1092":175,"1095":-178.8,"1097":47.7,"1098":-4.9,"1103":30.1,"1104":36.3,"1105":-34.3,"1112":-81.1,"1113":-28.3,"1115":-23,"1116":-19.4,"1118":-185.7,"1129":82.6,"1133":167.2,"1134":218.9,"1136":20.9,"1138":22.5,"1141":-168.4,"1149":-84.8,"1150":6.8,"1151":24.7,"1152":65.5,"1154":-93.2,"1156":0.7,"1170":-37.9,"1180":47.3,"1181":68.6,"1194":-183.2,"1195":220.6,"1204":99.9,"1205":62.6,"1206":105.3,"1211":20.4,"1214":47.7,"1220":68.3,"1225":112.3,"1237":-6.3,"1238":91.2,"1243":-6.2,"1301":-119.6,"1305":-50.4,"1308":47.3,"1311":46.4,"1314":25.9,"1315":10.5,"1318":-118.1,"1319":49.2,"1320":-82.5,"1322":-54.6,"1323":85.5,"1324":-104.5,"1325":27.5,"1326":-83.4,"1328":56.6,"1329":-20.9,"1331":-193.6,"1332":44.4,"1333":7.5,"1335":105.4,"1336":174.9,"1337":-140.6,"1344":-22.5,"1345":-36.3,"1347":-102.6,"1349":-77.1,"1353":30.6,"1356":224.8,"1358":-46.2,"1361":106.7,"1373":36.7,"1375":-17.4,"1379":-218.1,"1384":137.1,"1386":-251.8,"1388":63,"1389":26.6,"1390":136.9,"1392":-176.6,"1401":-28.1,"1402":-59,"1403":118.4,"1404":-29.8,"1413":-206,"1415":46.5,"1416":-17,"1420":-98.2,"1421":-231.2,"1996":114.9,"2004":-24.8,"2005":80.1,"2006":49.6,"2009":8.6,"2010":144.2,"2016":-43.1,"2018":-6.5,"2024":-152.6,"2026":-108.3,"2031":191.5,"2032":-17,"2034":-84.2,"2042":-7.1,"2043":-119.2,"2046":-384.2,"2054":-115.2,"2055":-185,"2062":-381.6,"2063":-265.7,"2064":-196.4,"2065":-241.1,"2073":-134.1,"2076":-41.5,"2077":-70,"2078":-183.6,"2080":-99.1,"2082":-3.4,"2083":133.4,"2087":-85.7,"2088":-143,"2089":-94.7,"2091":114.9,"2095":126.4,"2096":-12.7,"2097":-58.1,"2098":208.5,"2099":-71.5,"2100":-35,"2102":316,"2103":-46.9,"2104":-224.9,"2107":-51.6,"2108":-179.2,"2111":93.8,"2115":-148.8,"2116":-16.9,"2118":-221.7,"2119":-45.1,"2123":-72.3,"2125":-181.5,"2127":171.2,"2128":158.1,"2129":197.5,"2131":-80.4,"2132":74.5,"2133":110.2,"2134":-112.5,"2135":-249.3,"2136":-148.4,"2137":-89.3,"2138":-166.3,"2139":15.4,"2140":103.3,"2141":307.8,"2143":2.1,"2144":-244.6,"2157":182.9,"12317":-99.6}},{"nm":"item","tab":{"1001":-426.6,"1004":-185.3,"1006":-464,"1011":-254.4,"1018":-597.9,"1026":-275.9,"1027":-470.6,"1028":-392.2,"1029":-371.2,"1031":-317.8,"1033":-336.5,"1036":-418.6,"1037":-504.2,"1038":-435.9,"1042":-574.4,"1043":-372.1,"1052":-357.4,"1053":-242.7,"1057":-242.2,"1058":-244.4,"2003":-723.7,"2019":-232.4,"2020":-276,"2021":-249.9,"2022":-461.3,"2031":-521.9,"2051":-465.6,"2052":-26.7,"2065":-83.2,"2420":-293.7,"2421":-197.9,"2501":333.5,"2502":138.3,"2503":64.4,"2504":-50.3,"2508":-399.8,"2510":83.8,"2512":-56,"2517":370.9,"2522":130.7,"2523":56.4,"2524":-297.7,"2525":-65.8,"2526":-80,"2530":-69.9,"3003":-29.3,"3004":-338.3,"3006":-76.5,"3008":167.6,"3009":-55.2,"3020":-8.2,"3024":-346.2,"3031":66.1,"3032":-77,"3033":217,"3035":-288.2,"3036":381.7,"3039":146.6,"3040":81.1,"3042":-1.9,"3044":-284.4,"3046":77.7,"3047":-47.3,"3050":-209.5,"3051":-209.5,"3053":138.8,"3057":-387.4,"3065":81.1,"3066":-345.6,"3067":-320.8,"3068":110.4,"3070":-364.4,"3071":168.7,"3072":215,"3073":-10,"3074":144,"3075":8.7,"3076":-243.7,"3077":-169.3,"3078":-35.2,"3082":-267,"3083":83,"3084":-7.4,"3085":76.5,"3086":-478.2,"3087":-32.5,"3089":195.9,"3091":90.3,"3094":-105,"3095":-91.3,"3097":9.7,"3100":63.1,"3102":108.8,"3107":-39.6,"3108":-303.1,"3109":-189.4,"3110":-90,"3111":-66.9,"3112":-203.7,"3113":-305.7,"3114":-145.2,"3115":35.8,"3116":12.7,"3118":-53.5,"3119":-185,"3121":-36.4,"3123":-223.4,"3124":116.5,"3133":-357.1,"3134":-364.9,"3135":406.2,"3137":191.4,"3139":419.5,"3140":-57.6,"3142":93.9,"3143":-17.1,"3144":-597.3,"3145":-341.5,"3146":32.2,"3147":-314.4,"3152":-65.2,"3153":283.3,"3155":-179.7,"3156":120.3,"3157":-13.1,"3158":-113.9,"3161":63.7,"3165":258.3,"3177":-82.5,"3179":215.5,"3181":258.1,"3184":-335.4,"3190":-161.6,"3211":-248.5,"3222":-75.6,"3302":382.2,"3330":-22.6,"3400":-243.9,"3504":-65.6,"3508":-0.6,"3742":-107.7,"3748":291.8,"3801":-433.9,"3802":-384.8,"3803":-217.4,"3814":74.9,"3916":-61.1,"4003":-322.7,"4004":-36.9,"4005":-80.9,"4401":-6.5,"4628":-45.5,"4630":-32.3,"4632":-147.2,"4633":180.6,"4642":-187.6,"4645":83,"4646":13.3,"6333":140.6,"6609":372.6,"6610":-27.9,"6616":-57.3,"6617":-87.7,"6620":-145.4,"6621":-48.5,"6631":-75.8,"6653":141,"6655":-23.1,"6657":-67.7,"6660":-334.5,"6662":-74,"6664":84.3,"6665":137.5,"6670":-403.7,"6672":97.9,"6673":-27.5,"6675":-5,"6676":-75.3,"6690":-388.9,"6692":20.8,"6694":134.5,"6695":127,"6696":7.8,"6698":238.8,"6699":148.2,"8010":330.4,"8020":126.5,"123430":94.4,"124011":-189.4,"126697":12.4,"220013":-8.2,"223069":117.5,"226668":252.8,"228002":66.6,"994403":89.1}},{"nm":"mate","tab":{"1":-44.1,"2":7.4,"3":88.8,"4":-80.5,"5":-15.6,"7":-45.8,"8":-22,"9":-9.1,"10":-91.2,"11":-150.1,"12":112.5,"13":-114.1,"14":81.6,"15":-64.4,"16":154.5,"17":-36.6,"18":-103.8,"19":-10.2,"20":126.1,"21":-68.5,"22":-51,"23":-2.2,"24":-5.4,"25":-11.9,"26":12.8,"27":136.4,"28":-67.3,"29":-63.7,"30":-20.7,"31":76.2,"32":107.3,"33":97,"34":-6.7,"35":53.1,"36":-38.8,"37":69.2,"38":-63.2,"39":-36.9,"40":108.6,"41":-58.5,"42":-123.5,"43":59.8,"44":175,"45":-39.5,"48":18.8,"50":-6.8,"51":-145.2,"53":153.6,"54":51.5,"55":-55.6,"56":-6.7,"57":77.2,"58":34.4,"59":61.8,"60":-57.8,"61":-34.6,"62":31.4,"63":-109.2,"64":-33.4,"67":-188.1,"68":-84.2,"69":-56.1,"72":38,"74":-93.6,"75":14.8,"76":-101.6,"77":5.4,"78":52,"79":25.1,"80":-23.2,"81":-120.2,"82":-23.4,"83":-30.9,"84":-17.4,"85":-35.7,"86":18.8,"89":108.1,"90":-82.4,"91":-15,"92":45.3,"96":-94.4,"98":53.7,"99":-24.3,"101":-60.3,"102":-30.8,"103":-52.4,"104":-131.5,"105":11.5,"106":15.6,"107":4.4,"110":-125.1,"111":117.6,"112":-67.3,"113":35.3,"114":-77.3,"115":-82.9,"117":71.4,"119":-118.3,"120":-35.8,"121":-47.9,"122":28.2,"126":-110.7,"127":-13.4,"131":-21.4,"133":-106.1,"134":-89,"136":-50.4,"141":-44.3,"142":-68.7,"143":-72,"145":-131.2,"147":-14.4,"150":-8.7,"154":84.5,"157":15.2,"161":-83.8,"163":-72.2,"164":49.2,"166":-91.4,"200":-72,"201":120.6,"202":-75,"203":-103.9,"221":-135.6,"222":-149.9,"223":-2.2,"233":-5.1,"234":-103.1,"235":-36.9,"236":-121.7,"238":-47.3,"240":41.7,"245":-11.9,"246":-69.4,"254":19,"266":-26.5,"267":71.8,"268":-116.7,"350":42.1,"360":-140.3,"412":118.4,"420":36.9,"421":136.1,"427":127.6,"429":-104.6,"432":-7.9,"497":55.4,"498":-133.5,"516":53.5,"517":-36.4,"518":-17.8,"523":-130.3,"526":98.8,"555":67.4,"711":-64.7,"777":-42.8,"799":-59.6,"800":-76.8,"804":-153,"805":-85.5,"875":-5.4,"876":-72.9,"887":-114.1,"888":228,"893":-94.9,"895":39.8,"897":91.8,"901":-85.8,"902":87.6,"910":-60.4,"950":-69.5}},{"nm":"foe","tab":{"1":-128.6,"2":74.7,"3":159.2,"4":-166.8,"5":222.7,"6":151.8,"7":-70.7,"8":142.6,"9":-20.9,"10":-63.6,"11":-107.9,"12":325.4,"13":57.9,"14":644.2,"15":-41.2,"16":3.1,"17":-78.5,"18":-68,"19":213,"20":127,"21":-95.3,"22":-115.2,"23":87.9,"24":-13.5,"25":-103.4,"26":-87.8,"27":192.2,"28":-79.9,"29":-34,"30":24.4,"31":273.6,"32":161.3,"33":191.1,"34":3.9,"35":-94.2,"36":505.9,"37":-100,"38":7.5,"39":44.6,"40":-164.4,"41":-51.6,"42":-58,"43":-152.8,"44":178.8,"45":-98.6,"48":92.6,"50":254.7,"51":-136.2,"53":5.4,"54":35.2,"55":48.7,"56":-52.8,"57":274,"58":120.8,"59":108.7,"60":-105.8,"61":-117.5,"62":41.9,"63":-65.2,"64":-50.3,"67":-126.4,"68":-11.5,"69":31.6,"72":245.9,"74":-98.6,"75":100.9,"76":-104.5,"77":28.1,"78":235.5,"79":71.6,"80":-70.8,"81":-82,"82":91.9,"83":78.4,"84":6,"85":-89.3,"86":131,"89":247,"90":-128.1,"91":-37.5,"92":-85.6,"96":-72.1,"98":189.4,"99":-181.6,"101":-156.6,"102":44.1,"103":-84.4,"104":-71.2,"105":19.1,"106":264.2,"107":-35,"110":-110.5,"111":179.9,"112":-108.9,"113":301,"114":-6.4,"115":-104.1,"117":-187.1,"119":-17.5,"120":133.7,"121":-82.9,"122":94,"126":-139.5,"127":-13.1,"133":-90.4,"134":-138,"136":-22.2,"141":17.9,"142":-126.3,"143":-115.1,"145":-125.9,"147":-153,"150":147.9,"154":368.3,"157":-67.2,"161":-139.3,"163":-74.2,"164":49,"166":-67.2,"200":34.4,"201":169.1,"202":-91.9,"203":-41.5,"221":-67,"222":-137.3,"223":284.2,"233":95.2,"234":-39.9,"235":-70.2,"236":-82.5,"238":-115.4,"240":248.1,"245":25.6,"246":-99.7,"254":47.5,"266":118.4,"267":-74.2,"268":-71.1,"350":-254.9,"360":-50.9,"412":175.5,"420":328.5,"421":208.9,"427":-232,"429":-43,"432":-23.7,"497":115.1,"498":-74,"516":359.7,"517":100.4,"518":-93,"523":-65.9,"526":203.3,"555":-85,"711":-136.9,"777":-58.7,"799":-37.4,"800":-110.7,"804":-88,"875":298.8,"876":8,"887":65.5,"888":-51.3,"893":-53.4,"895":53.3,"897":208.2,"901":-38.2,"902":-132.6,"904":163.4,"910":-137.3,"950":-75.3}},{"nm":"foeItem","tab":{"1001":-273.8,"1004":-413.4,"1006":-205.4,"1011":-17.7,"1018":-313.7,"1026":-237.7,"1027":-391.1,"1028":-155.6,"1029":-141.3,"1031":-22.8,"1033":-128.5,"1036":-251.3,"1037":-254.9,"1038":-263,"1042":-344.7,"1043":-192.7,"1052":-298.7,"1053":-133.2,"1057":7.2,"1058":-197.4,"2003":-348.7,"2019":-106.7,"2020":-223.9,"2021":-24.9,"2022":-315.5,"2031":-393.4,"2051":-176.8,"2052":2,"2065":-13,"2139":-252.3,"2140":-48.3,"2420":-148.2,"2421":-146.4,"2501":469.6,"2502":305.9,"2503":-42.4,"2504":272,"2508":-272.7,"2510":74.7,"2512":-23.4,"2517":136.3,"2522":102.1,"2523":-60.8,"2524":14.8,"2525":276.8,"2526":-84.6,"2530":-67.4,"3003":-83.9,"3004":-144,"3006":-51.4,"3008":13.9,"3009":-4,"3020":-34.2,"3024":-57.5,"3031":-4.3,"3032":-78.4,"3033":113.4,"3035":-190.3,"3036":63.7,"3039":355.5,"3040":33.3,"3042":-20.3,"3044":-108.2,"3046":2.1,"3047":115.9,"3050":57.8,"3051":-176.7,"3053":232.5,"3057":-214.1,"3065":282.8,"3066":-57.2,"3067":-96.9,"3068":262.8,"3070":-233.1,"3071":131.2,"3072":69.2,"3073":50.8,"3074":82.3,"3075":283.9,"3076":80.5,"3077":-5,"3078":19.1,"3082":43.2,"3083":318.1,"3084":167.8,"3085":-20.3,"3086":-270.1,"3087":-30.6,"3089":58.2,"3091":55.3,"3094":-53.9,"3095":-10.6,"3097":-43.6,"3100":-21.9,"3102":74.4,"3107":-12.4,"3108":-228.2,"3109":112.5,"3110":191.3,"3111":90.6,"3112":-268,"3113":-286.5,"3114":-300.7,"3115":11.7,"3116":33,"3118":-39.4,"3119":-5.3,"3121":229.3,"3123":-22.3,"3124":-6.2,"3133":-178.8,"3134":-212.6,"3135":122.7,"3137":85.2,"3139":97.9,"3140":-60.7,"3142":2.3,"3143":262.4,"3144":-318.1,"3145":-264.3,"3146":26.8,"3147":-168.9,"3153":58.3,"3155":-59,"3156":98.2,"3157":51,"3158":-57.3,"3161":71.7,"3165":188.9,"3177":-244.9,"3179":18,"3181":290.2,"3184":-253.7,"3190":5.2,"3211":22.7,"3222":-57.3,"3302":63.9,"3330":-23.5,"3400":-455.6,"3504":-75.2,"3508":-47.7,"3742":168.9,"3748":363,"3801":-133.4,"3802":-313.8,"3803":-144.3,"3814":24.2,"3916":-42.5,"4003":-150.6,"4004":-56.2,"4005":-33.7,"4401":290.8,"4628":-77.9,"4629":93.5,"4630":-97.6,"4632":-90.5,"4633":207.9,"4642":-297.3,"4645":3.3,"4646":-43.5,"6333":101,"6609":346.5,"6610":85.4,"6616":-12.5,"6617":-80.3,"6620":19.7,"6621":8.8,"6631":78.8,"6653":15.1,"6655":-86.7,"6657":68,"6660":-4.4,"6662":175,"6664":337.8,"6665":313.1,"6670":-201.6,"6672":-12.6,"6673":2.2,"6675":-14.3,"6676":-46.1,"6690":-224.1,"6692":2.8,"6694":9.7,"6695":114.9,"6696":-44.7,"6698":26,"6699":-21.7,"8010":125.1,"8020":210.4,"123430":-34.2,"124011":5.6,"126697":-59,"220013":-1.9,"223069":197.7,"226668":95.7,"228002":-39.3,"994403":-15.4}}]},"taken":{"gm":2233.61,"layers":[{"nm":"ch","tab":{"1":-780.4,"2":461.2,"3":1279.4,"4":-786,"5":1555.4,"6":813,"7":-637,"8":642.2,"9":-114,"10":-487,"11":-187.3,"12":2008.6,"13":258.1,"14":4072.1,"15":-659.6,"16":-804.6,"17":-745.6,"18":-603.6,"19":1534.3,"20":740.6,"21":-815.3,"22":-833.8,"23":631.7,"24":355.7,"25":-684.1,"26":-755.4,"27":913.1,"28":-442.5,"29":-652,"30":-314.1,"31":1733.2,"32":1194.2,"33":1337.1,"34":-218.2,"35":-737.9,"36":3227.6,"37":-604.3,"38":242.8,"39":451.4,"40":-916.4,"41":-318.1,"42":-499.4,"43":-806.1,"44":1207.4,"45":-650.3,"48":670.8,"50":1551.6,"51":-746.7,"53":69.9,"54":340.6,"55":194.3,"56":-141.9,"57":1889.6,"58":956.4,"59":799,"60":-539.7,"61":-854.7,"62":371.1,"63":-547.9,"64":21.9,"67":-623.4,"68":-153.4,"69":-40.6,"72":1708.1,"74":-780.3,"75":765.3,"76":-668,"77":25.3,"78":1712,"79":763.3,"80":-35.5,"81":-561.9,"82":692.3,"83":468.7,"85":-638.2,"86":893,"89":1746.3,"90":-759.3,"91":-272,"92":-121.2,"96":-703.7,"98":1537.7,"99":-1121.6,"101":-1065.4,"102":316.6,"103":-576.5,"104":-249.4,"105":137.6,"106":1734.8,"107":41.7,"110":-771,"111":1441.7,"112":-747,"113":2057.8,"114":372.2,"115":-925,"117":-989.3,"119":-466.3,"120":1196.1,"121":-366.9,"122":749.8,"126":-773.3,"127":-305,"131":-24.6,"133":-639.3,"134":-870.7,"136":-406.5,"141":241.1,"142":-884.6,"143":-843.9,"145":-873.1,"147":-866.4,"150":808.7,"154":2311.5,"157":-195.2,"161":-920.3,"163":-665.3,"164":404.7,"166":-647.9,"200":347.7,"201":1440.6,"202":-834.9,"203":-517.4,"221":-587.9,"222":-713.9,"223":2097.1,"233":1089.4,"234":54.7,"235":-685.6,"236":-613.5,"238":-549.8,"240":1600.1,"245":123.2,"246":-423,"254":670.8,"266":905.1,"267":-882,"268":-580.5,"350":-1488.2,"360":-110.3,"412":1194.4,"420":1940.6,"421":1526.8,"427":-924.4,"429":-509.9,"432":-490.2,"497":1000.1,"498":-672,"516":2232.3,"517":951.2,"518":-772.4,"523":-563.3,"526":1697.5,"555":-341.8,"711":-786.1,"777":-219.6,"799":113.2,"800":-819.2,"804":-565.8,"805":-67.3,"875":2057.3,"876":39.6,"887":514.6,"888":-723.2,"893":-510.1,"895":-179.5,"897":1243.5,"901":-663.4,"902":-973.3,"904":1218.7,"910":-867.9,"950":-379.1}},{"nm":"aug","tab":{"1001":41.1,"1002":409.4,"1004":85.8,"1005":11.8,"1006":-55.4,"1007":-23.7,"1011":-133.1,"1013":715.3,"1015":134.7,"1018":-135.4,"1019":1.4,"1020":367.8,"1022":21.3,"1025":-49.9,"1026":-78.1,"1027":-63.6,"1028":-42,"1029":20.6,"1030":-59.4,"1034":-165,"1036":80.6,"1037":20.9,"1038":-104.4,"1041":784.5,"1044":-18.6,"1045":11.3,"1046":-78.5,"1047":6,"1048":-43.6,"1051":13,"1053":139.1,"1054":68.6,"1056":375.3,"1057":-120,"1058":15.4,"1060":226.9,"1061":-39.3,"1062":12.2,"1063":1.4,"1067":243.6,"1068":-19,"1071":13.9,"1072":-46.9,"1073":-5.7,"1074":65.3,"1076":3,"1077":130.7,"1079":81.8,"1080":30.5,"1081":46.2,"1084":-86.6,"1087":20.6,"1088":-116.1,"1092":-2.3,"1095":-53.1,"1097":-84.1,"1098":-24.4,"1103":28.4,"1104":-60.2,"1105":-93.1,"1112":-79.7,"1113":-33.7,"1115":-10.1,"1116":-42.6,"1118":54.5,"1129":-46.4,"1133":-52,"1134":582.7,"1136":-43.8,"1138":128.3,"1141":0.8,"1149":-57.7,"1150":64.7,"1151":9.4,"1152":717.6,"1154":-34.8,"1156":-163.1,"1170":19.2,"1180":-188.6,"1181":204.9,"1194":-76.8,"1195":-36,"1204":383.5,"1205":-12.4,"1206":23.2,"1211":-123.6,"1214":-85.1,"1220":-6.3,"1225":23.6,"1237":30.6,"1238":34.1,"1243":55.4,"1301":-31.6,"1305":-13.6,"1308":-44.7,"1311":-11.7,"1314":-3.2,"1315":-92.7,"1318":-167.4,"1319":100.6,"1320":-79.4,"1322":-53.4,"1323":-145.5,"1324":112.8,"1325":-313,"1326":-94.3,"1328":24.1,"1329":-92.3,"1331":15.3,"1332":-81.7,"1333":-11.4,"1335":-106.7,"1336":-28,"1337":31.9,"1344":-69.7,"1345":-43.4,"1347":-62.6,"1349":-74.9,"1353":525,"1356":15.7,"1358":-127,"1361":-112.6,"1373":-77.1,"1375":286.1,"1379":-5.8,"1384":55.1,"1386":-44.2,"1388":-26.9,"1389":26.3,"1390":-40.5,"1392":-100.6,"1401":377.7,"1402":-3,"1403":67.5,"1404":-40.9,"1413":-182.6,"1415":-40.1,"1416":-67.4,"1420":39.2,"1421":-83.7,"1996":128.9,"2004":7.9,"2005":3.3,"2006":303.2,"2009":11.3,"2010":33.2,"2016":-64.4,"2018":-66.7,"2024":-29.7,"2026":-24.8,"2031":37.8,"2032":-70.2,"2034":-108.1,"2042":-101.7,"2043":185.1,"2046":-307.3,"2054":-48.3,"2055":-131.3,"2062":-393.1,"2064":-204.6,"2065":-224.4,"2072":-191.9,"2073":37.2,"2076":-78.1,"2077":130,"2078":-272.4,"2080":-62.4,"2082":253.3,"2083":-95.5,"2087":-27.6,"2088":-124.4,"2089":-27.4,"2091":218.9,"2095":64,"2096":-32.5,"2097":-207,"2098":153.8,"2099":70.7,"2100":-86.2,"2102":81.3,"2103":-131.4,"2104":15,"2107":209.5,"2108":28.7,"2111":-100,"2115":60.6,"2116":-132.1,"2118":-131.1,"2119":71.1,"2123":-41.5,"2125":-107.8,"2127":-6.2,"2128":16,"2129":-609.3,"2131":-82.3,"2132":157,"2133":12.8,"2134":-13.4,"2135":-0.9,"2136":-129.5,"2137":-87,"2138":-108.5,"2139":135.2,"2140":26.5,"2141":379.6,"2143":262.7,"2144":-86.4,"2157":-41.4,"12317":-40}},{"nm":"item","tab":{"1001":-443.5,"1004":-312.2,"1006":-954.2,"1011":-400.2,"1018":-295.1,"1026":-264.2,"1027":-456.6,"1028":-604.1,"1029":-576.5,"1031":-538.5,"1033":-491.4,"1036":-318.4,"1037":-316.8,"1038":-224.5,"1042":-356.8,"1043":-183.1,"1052":-336.5,"1053":-115.9,"1057":-247,"1058":-214.2,"2003":-714.6,"2019":-272.4,"2020":-225,"2021":-173.3,"2022":-562.8,"2031":-437.4,"2051":-752.8,"2052":-31.6,"2065":-17.5,"2420":-159.5,"2421":-124.4,"2501":809,"2502":406.3,"2503":-40.1,"2504":167.9,"2508":-301.3,"2510":40.7,"2512":-9,"2517":202.6,"2522":59.4,"2523":18,"2524":-275.8,"2525":278.9,"2526":27.2,"2530":11.4,"3003":-80,"3004":-115.4,"3006":-43,"3008":123.3,"3009":-15.9,"3020":-82,"3024":-321.2,"3031":6,"3032":-25.8,"3033":84.4,"3035":-167.6,"3036":62.3,"3039":707,"3040":74.8,"3042":-1.5,"3044":-284.7,"3046":-85.2,"3047":-41.6,"3050":-440.3,"3051":-117.4,"3053":157.1,"3057":-306.9,"3065":416.4,"3066":-380,"3067":-494.1,"3068":11.4,"3070":-371.7,"3071":82.7,"3072":144.4,"3073":84.2,"3074":53,"3075":189.8,"3076":-327,"3077":-148.9,"3078":-2.1,"3082":-235.5,"3083":521.1,"3084":217,"3085":40.3,"3086":-241.6,"3087":-2.1,"3089":24.2,"3091":69,"3094":12.4,"3095":-20.3,"3097":-8,"3100":-117.2,"3102":46.3,"3107":57.8,"3108":-265.7,"3109":-10.4,"3110":66.4,"3112":-218.4,"3113":-294.1,"3114":-183,"3115":-5.4,"3116":41.5,"3118":-137.5,"3119":-173.7,"3121":168.7,"3123":-92.3,"3124":58.6,"3133":-296.5,"3134":-224.4,"3135":68.2,"3137":40.1,"3139":224.3,"3140":5,"3142":-3.3,"3143":260.7,"3144":-265.8,"3145":-274.5,"3146":-51.1,"3147":-237.7,"3152":-73.8,"3153":100.5,"3155":-100.2,"3156":109.4,"3157":19.6,"3158":-61.1,"3161":61.4,"3165":148.3,"3177":-247,"3179":58.5,"3181":310.8,"3184":-109.3,"3190":-85.2,"3211":-344.5,"3222":22.3,"3302":131.9,"3330":24.2,"3400":-560.2,"3504":16.8,"3508":-21.9,"3742":-8.4,"3748":604.6,"3801":-868.9,"3802":-321.5,"3803":-230.9,"3814":56,"3916":-67.7,"4003":-613.8,"4004":-398.9,"4005":-294.2,"4401":268.3,"4628":-75.8,"4629":28.6,"4630":-101.8,"4632":-76.4,"4633":295.7,"4642":-236.1,"4645":-46.3,"4646":-161.9,"6333":25.8,"6609":320.8,"6610":49.6,"6616":55.5,"6617":-1.2,"6620":76.1,"6621":72.6,"6631":-272.6,"6653":7.4,"6655":-90.3,"6657":59.7,"6660":-552.5,"6662":3.8,"6664":212.7,"6665":357.4,"6670":-192.1,"6672":41,"6673":-1.8,"6675":10.3,"6676":-52.6,"6690":-177.6,"6692":-138.2,"6694":54.3,"6695":33.9,"6696":-66.3,"6698":-111.8,"6699":-15.8,"8010":137.3,"8020":134.1,"123430":-81.9,"124011":8.2,"126697":-75.7,"220013":-27.3,"223069":-166,"226668":356.3,"228002":-65.7,"994403":44.7}},{"nm":"mate","tab":{"1":-77.9,"2":-18.1,"3":-2.9,"4":-76.5,"5":-41.1,"6":-22.6,"7":-14.5,"8":-4.4,"9":-38.3,"10":-49.3,"11":-88.8,"12":63.2,"13":-45.2,"14":40.1,"15":-20.5,"16":190.3,"17":21.5,"18":-58.1,"19":-51.2,"20":28.1,"21":-15.2,"22":-30.3,"23":0.7,"24":-55,"25":-36,"26":25.8,"27":43,"28":-34.7,"29":-5.9,"30":56.3,"31":-10.5,"32":-11.5,"33":18.2,"34":-19.3,"35":30.3,"36":-33.8,"37":-22.5,"38":-60.2,"39":-41.2,"40":-51.1,"41":-6,"42":-56.6,"43":-70.3,"44":5.5,"45":-40.8,"48":-13,"50":-21.3,"51":-77.5,"53":-8.9,"54":-5.3,"55":-20.9,"56":-37.1,"57":2.1,"58":-49.4,"59":-1.7,"60":-32.6,"61":-41.6,"62":-22.2,"63":-33.7,"64":-38.1,"67":-103.8,"68":-24.7,"69":-43.9,"72":7.1,"74":-49.8,"75":-37.1,"76":-32.7,"77":31.3,"78":-2,"79":-21.3,"80":-44.5,"81":-33.8,"82":-17.6,"83":-60.2,"84":-14.9,"85":-22,"86":6.2,"89":12.2,"90":-67.9,"91":3.2,"92":-52.3,"96":-31.3,"98":-26.3,"99":-57.5,"101":-28.7,"102":-48.9,"103":-49.3,"104":-87.2,"106":-37.9,"107":-18.1,"110":-51.5,"111":-2,"112":-36.4,"113":-13.5,"114":-76.9,"115":-8.8,"117":-58.1,"119":-78.9,"120":-58.7,"121":-13.9,"122":-67.4,"126":-35.5,"127":-16,"131":-15.3,"133":-83.7,"134":-61.2,"136":2.6,"141":-30.3,"142":-10.6,"143":-36.4,"145":-44.7,"147":-52.4,"150":-20.8,"154":9.9,"157":-53.3,"161":-29.1,"163":-39.7,"164":7.5,"166":-10.7,"200":-60.9,"201":-20.2,"202":-8,"203":-81.5,"221":-77.3,"222":-114.6,"223":-48.5,"233":-40.3,"234":-62.9,"235":16.3,"236":-46.3,"238":-24.4,"240":15.5,"245":-28.5,"246":-39.8,"254":-36.7,"266":-41.5,"267":70.4,"268":-22.6,"360":-139.9,"412":-9.2,"420":-19.9,"421":27.9,"427":-79.7,"429":-67,"432":39.1,"497":-18,"498":-71.3,"516":31.9,"517":-74,"518":-36.3,"523":-75.9,"526":-11.9,"555":-10.8,"711":-51.9,"777":-35.4,"799":-43.3,"800":-37.7,"804":-91.6,"805":-25.2,"875":-24.8,"876":-37.2,"887":-82,"888":188.7,"893":-23.4,"895":-34.9,"897":13.9,"901":7.6,"902":15,"904":-52.4,"910":-55.3,"950":-36}},{"nm":"foe","tab":{"1":-29.2,"2":28.7,"3":41.9,"4":-41.1,"5":29.6,"6":-12.5,"7":-2.8,"8":43.6,"9":20,"10":-63.9,"11":-68.1,"12":29.1,"13":13.4,"14":151.6,"15":11.2,"16":-95.5,"17":-16.6,"18":-67.3,"19":-15.2,"20":20.6,"21":6.2,"22":-48.9,"23":25.4,"24":12.7,"25":-23.7,"26":-50.3,"27":98.7,"28":3.1,"29":25.1,"30":166.7,"31":37,"32":35.4,"33":22.1,"34":-36.2,"35":32,"36":61.2,"37":-73.9,"38":28.1,"39":-9.7,"40":-96.6,"41":38.1,"42":13,"43":-62.6,"44":-30.1,"45":-29.7,"48":-19.4,"50":65.5,"51":-38.2,"53":34.8,"54":13.9,"55":25.1,"56":4.1,"57":70.8,"58":-16.9,"59":42.1,"60":-33.9,"61":-13.7,"62":42.4,"63":16.1,"64":-17.8,"67":-83.6,"68":48.7,"69":-32.3,"72":98.3,"74":-28.7,"75":-7.5,"76":-26.8,"77":90.6,"78":34.6,"79":22.1,"80":28.7,"81":3.1,"82":23.7,"83":-87.4,"84":-3.6,"85":-34.7,"86":2.6,"89":46.4,"90":-64.5,"91":69,"92":2,"96":9.6,"98":29.9,"99":-40.4,"101":-7,"102":26.6,"103":-14.4,"104":-8.2,"105":49.3,"106":8.1,"107":42.1,"110":-22.2,"111":52,"112":26,"113":55.5,"114":-20.7,"115":-22,"117":-135.7,"119":-25.2,"120":38.9,"121":-1.6,"122":-17.8,"126":-22.4,"127":11.1,"131":34.9,"133":-66.6,"134":-8.9,"136":23.8,"141":35,"142":-17.3,"143":-12.9,"145":-34.6,"147":-16.1,"150":2.5,"154":39.6,"157":-9,"161":-9.2,"163":8.4,"164":19.1,"166":-3.7,"200":-63.4,"201":-28.9,"202":-10.6,"203":-39.3,"221":-32.1,"222":-55.6,"223":38.9,"233":39.5,"234":-19.2,"235":-34.4,"236":-8.6,"238":41.8,"240":37.4,"245":38.3,"246":4.1,"254":20.8,"266":3.9,"267":-101.7,"268":-30,"350":-120.8,"360":-28.4,"412":1.7,"420":61.8,"421":51.4,"427":-91.9,"429":-51.4,"432":-101.7,"497":-38.1,"498":-42.8,"516":29.9,"517":9.3,"518":-57.4,"523":-19.3,"526":44.7,"555":-15.4,"711":-16.7,"777":12,"799":33.8,"800":-15.6,"804":-21.7,"805":-81.1,"875":97.9,"876":42.6,"887":9.6,"888":-45.2,"893":58.5,"895":3.2,"897":39.1,"901":5.6,"902":-108.7,"904":29.5,"910":10.4,"950":-20.8}},{"nm":"foeItem","tab":{"1001":-295.3,"1004":-370.1,"1006":-337.1,"1011":-133.9,"1018":-329.5,"1026":-207.3,"1027":-344.7,"1028":-260.7,"1029":-241.4,"1031":-186.2,"1033":-213.5,"1036":-265.8,"1037":-281.3,"1038":-230.7,"1042":-357.6,"1043":-237,"1052":-256.6,"1053":-123.3,"1057":-96.1,"1058":-154.1,"2003":-493,"2019":-146.6,"2020":-161,"2021":-117.1,"2022":-348.1,"2031":-366.4,"2051":-182.3,"2052":2.5,"2065":34,"2139":-83.8,"2140":-128,"2420":-132.1,"2421":-96.7,"2501":211.5,"2502":115.2,"2503":24.9,"2504":153.5,"2508":-273.6,"2510":61.5,"2512":33.4,"2517":185.8,"2522":104.8,"2523":28.2,"2524":29.9,"2525":169.2,"2526":-106.5,"2530":-43.5,"3003":-49.9,"3004":-106.2,"3006":-25.8,"3008":39.8,"3009":18.5,"3020":6.1,"3024":-138.1,"3031":37.9,"3032":-34.4,"3033":127.4,"3035":-176.8,"3036":114.2,"3039":202.1,"3040":68.5,"3042":40.7,"3044":-180.8,"3046":53.2,"3047":22.2,"3050":63.4,"3051":-160.9,"3053":175.6,"3057":-230.8,"3065":135.6,"3066":-128.4,"3067":-219,"3068":73.9,"3070":-267.7,"3071":112.6,"3072":145.5,"3073":68.8,"3074":81.6,"3075":118.2,"3076":-117.2,"3077":-98.8,"3078":14.1,"3082":-79.1,"3083":121.7,"3084":24.8,"3085":17.8,"3086":-267.5,"3089":120.6,"3091":86.7,"3094":23.5,"3095":106.8,"3097":67.4,"3100":42.9,"3102":185.6,"3107":17.1,"3108":-216.8,"3109":98,"3110":114.1,"3111":21.5,"3112":-197.8,"3113":-242.1,"3114":-282.7,"3115":52.4,"3116":61.5,"3118":19.7,"3119":-115.8,"3121":91.5,"3123":-100.2,"3124":14.8,"3133":-197.9,"3134":-185.6,"3135":204.9,"3137":164.9,"3139":204.9,"3140":-17.8,"3142":135.5,"3143":151.6,"3144":-332.7,"3145":-219.6,"3146":58.2,"3147":-201.9,"3152":25.5,"3153":61.3,"3155":-44.4,"3156":166.9,"3157":92.3,"3158":-17.5,"3161":83.4,"3165":208.1,"3177":-158.6,"3179":174.1,"3181":162.9,"3184":-214.1,"3190":48.2,"3211":-124.8,"3222":4.4,"3302":109.3,"3330":17.3,"3400":-281.7,"3504":-21.7,"3508":19.6,"3742":115.3,"3748":163.8,"3801":-281.2,"3802":-273.5,"3803":-227.9,"3814":135.4,"3916":-58.7,"4003":-92,"4004":157.5,"4005":15.9,"4401":181.6,"4628":61.4,"4629":115.1,"4630":-38.1,"4632":-8.2,"4633":123.2,"4642":-271.8,"4645":65.6,"4646":46.2,"6333":122.8,"6609":324.6,"6610":31,"6616":60.7,"6617":-61.6,"6620":17.6,"6621":51.6,"6631":38,"6653":51,"6655":-9.6,"6657":16.4,"6660":-250.7,"6662":55.2,"6664":132.7,"6665":200.3,"6670":-209.8,"6672":29.2,"6673":67.9,"6675":17.8,"6690":-210.8,"6692":45.6,"6694":123.6,"6695":133.7,"6696":50.2,"6698":163,"6699":104.5,"8010":188.6,"8020":200.8,"123430":95.4,"124011":-23.4,"126697":17.6,"220013":15.1,"223069":88.7,"226668":71.9,"228002":53,"994403":40.9}}]},"mit":{"gm":2193.91,"layers":[{"nm":"ch","tab":{"1":-1231.4,"2":1620.3,"3":4592.7,"4":-1490.9,"5":1277.6,"6":1229.7,"7":-1135.4,"8":-551.1,"9":-869.2,"10":-1411.5,"11":-303.8,"12":4504.1,"13":-549.4,"14":6563.8,"15":-1428.1,"16":-1299,"17":-1555.7,"18":-1381.2,"19":2575.8,"20":1697.2,"21":-1527.4,"22":-1495.1,"23":1604.2,"24":796,"25":-1274.8,"26":-1275.9,"27":1209.1,"28":-537.2,"29":-1447.4,"30":-1258.4,"31":2635.2,"32":1683,"33":4548.6,"34":-1124.9,"35":-1193.4,"36":3281.2,"37":-1055.9,"38":699,"39":1400.9,"40":-1287.2,"41":-845.4,"42":-1064.2,"43":-891.2,"44":2649.4,"45":-1260.8,"48":746.1,"50":462.5,"51":-1445.6,"53":570.7,"54":1778.5,"55":-171.9,"56":-200.8,"57":3046.9,"58":1587.5,"59":1665.1,"60":-960.4,"61":-1227.9,"62":904.2,"63":-1438.7,"64":1031,"67":-1321.8,"68":-80.5,"69":-941.5,"72":4696.2,"74":-1531.7,"75":1668.6,"76":-1192.5,"77":463.3,"78":4300,"79":1666.9,"80":113.4,"81":-1328.4,"82":1646,"83":389.1,"84":-2.5,"85":-1139.3,"86":2589.4,"89":4095.5,"90":-1284.5,"91":-391.8,"92":1805.4,"96":-1426.6,"98":3947.8,"99":-1375.3,"101":-1623.9,"102":1345.7,"103":-1326.7,"104":-576,"105":-245.6,"106":3395.5,"107":-165.7,"110":-1466.4,"111":4938.6,"112":-917.1,"113":3453.2,"114":1448.1,"115":-1634.7,"117":-1363.1,"119":-1031.3,"120":2221.1,"121":-511.6,"122":1127.2,"126":-1064.2,"127":-1115.2,"131":653.2,"133":-1141.6,"134":-1490.2,"136":-1218.5,"141":441.9,"142":-1410.4,"143":-1522.3,"145":-1287.2,"147":-1333.1,"150":983.6,"154":3258.3,"157":672.2,"161":-1545,"163":-1416.7,"164":1360.5,"166":-1072.9,"200":722.3,"201":2298.8,"202":-1505.9,"203":-1014.2,"221":-1266.4,"222":-1488.6,"223":3525.9,"233":2005.9,"234":-14.8,"235":-1406.3,"236":-1246.9,"238":-701.8,"240":2085.6,"245":-30.4,"246":-594.9,"254":1989.9,"266":1488.1,"267":-1418.8,"268":-980.6,"350":-1770.6,"360":-677.5,"412":1889.8,"420":2532,"421":2638.2,"427":-1189.1,"429":-990.3,"432":-1121.4,"497":2378,"498":-1415.8,"516":3476.1,"517":787,"518":-1362.7,"523":-1256.3,"526":4669.2,"555":-363.3,"711":-983.5,"777":492.7,"799":1449.1,"800":-1317.7,"804":-1357.1,"805":-502.5,"875":2606.8,"876":-670.6,"887":371.1,"888":-1016.8,"893":-1287.8,"895":-262.6,"897":3730.4,"901":-1448.5,"902":-1366.8,"904":1816.6,"910":-1348.8,"950":-361.1}},{"nm":"aug","tab":{"1001":324,"1002":540.2,"1004":3.5,"1005":7.2,"1006":-180.8,"1007":-53.7,"1011":-220.4,"1013":993.6,"1015":24.9,"1018":1314.4,"1019":-14.2,"1020":592.5,"1022":11.8,"1025":-78.5,"1026":-146.6,"1027":-113.5,"1028":-21.8,"1029":-51.4,"1030":-130.6,"1034":-164.2,"1036":69.3,"1037":39.4,"1038":-185.4,"1041":906.9,"1044":-55.3,"1045":-27.6,"1046":-140,"1047":-13.4,"1048":-75.8,"1051":5.8,"1053":111.7,"1054":35.3,"1056":327.9,"1057":505,"1058":-3.6,"1060":318.4,"1061":-66,"1062":235.2,"1063":595.4,"1067":313.4,"1068":-29.3,"1071":-5.9,"1072":-86.8,"1073":3.5,"1074":97.1,"1076":-6.2,"1077":72.6,"1079":56.9,"1080":42.3,"1081":23.4,"1084":-165.9,"1087":8.9,"1088":-193.7,"1092":-78.5,"1095":102.9,"1097":-148.3,"1098":-63.8,"1103":21.3,"1104":-119.3,"1105":-135.2,"1112":-85.9,"1113":-44.4,"1115":-21,"1116":-117.4,"1118":94.5,"1129":-139.1,"1133":-94.8,"1134":576.5,"1136":-62,"1138":147,"1141":-28.1,"1149":239.7,"1150":143.4,"1151":-1.4,"1152":860.5,"1154":-31,"1156":-68.2,"1170":13.7,"1180":293.4,"1181":308.5,"1194":-148.9,"1195":-38.9,"1204":423.3,"1205":-133.3,"1206":-35.8,"1211":-227.3,"1214":-124.3,"1220":-35.3,"1225":-10.5,"1237":72.1,"1238":53.2,"1243":65.8,"1301":-23.6,"1305":35.5,"1308":-56,"1311":-100,"1314":17.2,"1315":535.3,"1318":-116.6,"1319":601.9,"1320":-139.4,"1322":-100,"1323":-297.6,"1324":587,"1325":-335.2,"1326":-156.6,"1328":7.1,"1329":-195.4,"1331":201.8,"1332":-119.6,"1333":493.1,"1335":-172.3,"1336":-89.9,"1337":29.6,"1344":588.8,"1345":-93.3,"1347":98.3,"1349":-114.4,"1353":636.6,"1356":1.1,"1358":-224.1,"1361":952.3,"1373":-91.6,"1375":402.7,"1379":-104.3,"1384":115.8,"1386":-95.8,"1388":-49,"1389":-12,"1390":-91.9,"1392":-219.5,"1401":399.8,"1402":96.5,"1403":152.3,"1404":48.3,"1413":-304.2,"1415":-58.9,"1416":-93.6,"1420":46.8,"1421":-178.8,"1996":55.3,"2004":-32.3,"2006":378.3,"2009":-6.7,"2010":7.7,"2016":-104.4,"2018":-126,"2024":-42.8,"2026":-47.8,"2031":-55,"2032":-191.9,"2034":-187.1,"2042":-202.9,"2043":192,"2046":-466.7,"2054":-100.3,"2055":-186.6,"2062":-673,"2063":-131.7,"2064":-360.9,"2065":-305.4,"2072":-248.6,"2073":-20.4,"2076":1157.8,"2077":91.6,"2078":-522.6,"2080":-140.5,"2082":386.6,"2083":-237.7,"2087":-71,"2088":-194,"2089":-82.9,"2091":311.4,"2095":376,"2096":-61.7,"2097":-310.4,"2098":103,"2099":-28.6,"2100":-149.4,"2102":151.2,"2103":-166.7,"2104":-0.9,"2107":220.9,"2108":65.3,"2111":-159.5,"2115":233.8,"2116":-252.4,"2118":-223.1,"2119":182.6,"2123":-124.7,"2125":-87.4,"2127":-2.8,"2128":-2.3,"2129":-962,"2131":428.9,"2132":48.9,"2133":-9.6,"2134":-73.8,"2135":-8.6,"2136":-123.3,"2137":155.7,"2138":25.7,"2139":363.6,"2140":-199.7,"2141":-94.6,"2143":186.2,"2144":-91.8,"2157":452.8,"12317":-57.7}},{"nm":"item","tab":{"1001":-748.1,"1004":-319.5,"1006":-1904.8,"1011":-839.2,"1018":-360.6,"1026":-328.5,"1027":-536,"1028":-1309.5,"1029":-1258,"1031":-1214.8,"1033":-1127.3,"1036":-518.5,"1037":-482.5,"1038":-253.8,"1042":-446.1,"1043":-250.8,"1052":-416.4,"1053":-150.6,"1057":-588.8,"1058":-291.9,"2003":-1115.2,"2019":-684.4,"2020":-362.6,"2021":-433.9,"2022":-969.2,"2031":-517,"2051":-1337.6,"2052":-48,"2065":-17.2,"2420":-268.9,"2421":-221,"2501":812,"2502":836.3,"2503":-67.2,"2504":1234.9,"2508":-324.1,"2510":-123.1,"2512":-35.4,"2517":285.9,"2522":36.9,"2523":6.1,"2524":-114.5,"2525":581.1,"2526":14.6,"2530":-8.4,"3003":-135,"3004":-178.9,"3006":-61.2,"3008":28.5,"3009":-103.8,"3020":-135.5,"3024":-428.9,"3031":-26.3,"3032":-27.9,"3033":65.7,"3035":-191.8,"3036":32.2,"3039":443.9,"3040":115,"3042":-9.7,"3044":-505.4,"3046":-292.3,"3047":136,"3050":-236.7,"3051":-152.7,"3053":479.7,"3057":-491.4,"3065":975.5,"3066":-876.5,"3067":-1113.9,"3068":368.3,"3070":-641.1,"3071":187.9,"3072":182.7,"3073":48.3,"3074":-2.1,"3075":860.6,"3076":-789.5,"3077":-458.4,"3078":-34.4,"3082":-445.1,"3083":608.6,"3084":199.4,"3085":27,"3086":-240.4,"3087":-42.4,"3089":-49.3,"3091":225.6,"3094":2.1,"3095":-167.1,"3097":-92.2,"3100":-190.7,"3102":58.6,"3107":28.4,"3108":-379.8,"3109":270.5,"3110":799,"3111":65.7,"3112":-332.6,"3113":-363.8,"3114":-204.6,"3115":-74.6,"3116":-2.4,"3118":-240.8,"3119":-683,"3121":373,"3123":-148,"3124":58.3,"3133":-561.6,"3134":-317.1,"3135":16.5,"3137":-53.1,"3139":332.7,"3140":38.8,"3142":-118.4,"3143":1262.2,"3144":-244.4,"3145":-355.6,"3146":-150.4,"3147":-326.2,"3152":-215.2,"3153":92.2,"3155":-177.9,"3156":445,"3157":45.1,"3158":-107.5,"3161":67.2,"3165":111.1,"3177":-559.3,"3179":-43.9,"3181":54.6,"3184":-269.3,"3190":131.9,"3211":-904.4,"3222":-4.9,"3302":198.4,"3330":50.3,"3400":-692.6,"3504":-16.8,"3508":-23.6,"3742":275.4,"3748":424.7,"3801":-1634.2,"3802":-356,"3803":-335.4,"3814":-31.2,"3916":-92.3,"4003":-1252.7,"4004":-814.1,"4005":-436.1,"4401":1225.8,"4628":-97,"4629":-39.2,"4630":-164,"4632":-168.7,"4633":221.4,"4642":-293.4,"4645":-123.1,"4646":-314.6,"6333":529.3,"6609":515.9,"6610":84.3,"6616":42.8,"6617":-22.5,"6620":22.1,"6621":38.5,"6631":-520.5,"6653":-37.9,"6655":-123.5,"6657":1.8,"6660":-1672.3,"6662":258.9,"6664":463.9,"6665":1360.3,"6670":-282.2,"6672":23.5,"6673":15.5,"6675":-4.4,"6676":-92.7,"6690":-237.3,"6692":13,"6694":27.8,"6695":-13.5,"6696":-145.8,"6698":-288.2,"6699":-129,"8010":50.8,"8020":664.1,"123430":447.9,"124011":-38.6,"126697":-182.3,"220013":-36,"223069":709.7,"226668":7.5,"228002":33.4,"994403":126.7}},{"nm":"mate","tab":{"1":-87.4,"2":-25.8,"3":-6.8,"4":-96.2,"5":-102.1,"6":-71,"7":-37,"8":-33.1,"9":-29.1,"10":-131.7,"11":-154.4,"12":10.5,"13":-99.1,"14":10.8,"15":-48.2,"16":151.8,"17":55.8,"18":-102.7,"19":-70.8,"20":20.3,"21":-19.5,"22":-59.9,"23":-8,"24":-81.1,"25":-6.9,"26":18.3,"27":49.9,"28":-18,"29":-19.9,"30":110.9,"31":-19.5,"32":-43.2,"33":-15.8,"34":-32.3,"35":57.6,"36":-80.1,"37":30,"38":-88.3,"39":-90.9,"40":21.1,"41":-40.9,"42":-69.2,"43":23.9,"44":64.8,"45":-42.4,"48":-67.6,"50":-32.9,"51":-106.4,"53":13.5,"54":-0.9,"55":-39.7,"56":-26.2,"58":-51.2,"59":-15.8,"60":-31.4,"61":11.7,"62":-38.3,"63":-32.8,"64":-56.3,"67":-169.4,"68":-45.1,"69":-61.4,"72":-40.8,"74":-50.4,"75":-79.9,"76":-42.4,"77":5.8,"78":-30.4,"79":-34.7,"80":-58.9,"81":-44.2,"82":-29.4,"83":-107,"84":-22.5,"85":-42.9,"86":10,"89":-9.2,"90":-90.3,"91":12.3,"92":-74.7,"96":-43.5,"98":-43.6,"99":14.2,"101":-28.1,"102":-91.7,"103":-61.8,"104":-140.3,"105":-3.2,"106":-94.5,"107":-18.6,"110":-82.5,"111":-36.5,"112":-50.3,"113":-52.4,"114":-147.2,"115":2.1,"117":14.3,"119":-125.6,"120":-108.3,"121":-13.2,"122":-80.4,"126":-74,"127":-21,"131":-33.7,"133":-107.5,"134":-87.7,"136":-1.7,"141":-53.2,"142":-28,"143":-31.4,"145":-76.7,"147":-28.2,"150":-67,"154":-34.7,"157":-83.9,"161":-3.2,"163":-52.1,"164":-11.4,"166":-68.2,"200":-140.9,"201":-21.7,"202":-27.2,"203":-149,"221":-132.7,"222":-193,"223":-86.5,"233":-54.9,"234":-103.7,"235":-4.1,"236":-68.6,"238":-10.6,"240":-15,"245":-59.5,"246":-32.1,"254":-70.9,"266":-89.4,"267":28.8,"268":-55,"350":75.2,"360":-205.9,"412":-1.8,"420":-25.4,"421":13.1,"427":53,"429":-120.1,"432":-5.5,"497":-28.6,"498":-120.2,"516":17.4,"517":-110.8,"518":-11.9,"523":-119.2,"526":-35.6,"555":-2.4,"711":-57.9,"777":-47.5,"799":-74.6,"800":-43.2,"804":-155.1,"805":-82.3,"875":-57.4,"876":-61.2,"887":-190,"888":68.2,"893":-45.6,"895":-53.3,"897":11.6,"901":8.9,"902":69,"904":-67.2,"910":-32.5,"950":-56.6}},{"nm":"foe","tab":{"1":-135.2,"2":29.5,"3":79.8,"4":-67.5,"5":129.7,"6":133.6,"7":-89.5,"8":26.4,"9":-28.6,"10":-24.1,"11":-97.3,"12":52,"13":-26.5,"14":271.7,"15":122.4,"16":-143.2,"17":18.7,"18":16.4,"19":29.2,"20":32.7,"21":27,"22":14.9,"23":180.9,"24":90.7,"25":-24.8,"26":-30.6,"27":164.9,"28":-135.2,"29":66.3,"30":111.9,"31":20.2,"32":-10.4,"33":83.4,"34":-34.8,"35":35.5,"36":157.1,"37":-105,"38":-6.8,"39":83.7,"40":-120.3,"41":-56.2,"42":-58,"43":-102.9,"44":-53.9,"45":-46.1,"48":-50.5,"50":101.3,"51":3.2,"53":-4.1,"54":33.3,"55":34.5,"56":-49.9,"57":137.6,"58":25,"59":19.6,"60":-70,"61":-72.2,"62":50.6,"63":4.7,"64":-36.7,"67":-218.5,"68":-51.2,"69":-16,"72":193.5,"74":11.7,"75":-17.8,"76":-81.9,"77":37.2,"78":136.4,"79":9.8,"80":-45.6,"81":56,"82":56.7,"83":-95.2,"84":-62.3,"85":-67.3,"86":-14.6,"89":120.4,"90":-82.2,"91":-43.4,"92":45.3,"96":14.2,"98":109.2,"99":-63.7,"101":-42,"102":38.4,"103":-146,"104":-32.3,"105":49.8,"106":80.6,"107":-48.3,"110":13.3,"111":103.4,"112":-13.3,"113":150.2,"114":-126.3,"115":-18.4,"117":-160.2,"119":-21.8,"120":111.9,"121":-115.9,"122":-80.9,"126":-108.6,"127":-24.8,"131":-17.8,"133":-51.7,"134":-71.8,"136":22.9,"141":31,"142":-151.6,"143":9.1,"145":30,"147":-32,"150":76,"154":75.3,"157":101.4,"161":-100.8,"163":-32,"164":-7.5,"166":45.2,"200":-90.3,"201":-6.8,"203":33.7,"221":33.7,"222":12.6,"223":64.9,"233":69.3,"234":-3,"235":8.6,"236":43.9,"238":-76.6,"240":132.7,"246":-138.9,"254":45.2,"266":62.6,"267":-101.3,"268":-58.1,"350":-177.6,"360":-37.9,"412":19.6,"420":270.2,"421":48.8,"427":-114.3,"429":35.4,"432":-104.3,"497":-29.4,"498":46.5,"516":85.8,"517":-1.7,"518":-100.2,"523":-53.3,"526":-17.7,"555":-131.4,"711":-82.5,"777":99.2,"799":-31.7,"800":-45,"804":54.2,"805":-161.4,"875":153.6,"876":-8.4,"887":-5.6,"888":-24.4,"893":-65.7,"895":-29.2,"897":115.4,"901":54.6,"902":-124.1,"904":46.4,"910":-13.4,"950":-116.5}},{"nm":"foeItem","tab":{"1001":-486,"1004":-576.9,"1006":-537.4,"1011":-236.1,"1018":-509.3,"1026":-376.6,"1027":-571.6,"1028":-431.8,"1029":-408.4,"1031":-316.4,"1033":-355.1,"1036":-439.5,"1037":-444.6,"1038":-357.1,"1042":-556,"1043":-373.9,"1052":-440.5,"1053":-197.2,"1057":-161.5,"1058":-295.7,"2003":-703.5,"2019":-257.4,"2020":-324,"2021":-205.9,"2022":-560.3,"2031":-582.2,"2051":-308,"2052":8.6,"2065":92.7,"2139":-179.3,"2140":-153.9,"2420":-239.9,"2421":-226.7,"2501":396.8,"2502":195,"2503":17.5,"2504":292.9,"2508":-431.5,"2510":102,"2512":89.2,"2517":284.8,"2522":100.3,"2523":79.9,"2524":59.8,"2525":276,"2526":-138.5,"2530":-51.3,"3003":-86.2,"3004":-139.9,"3008":37,"3009":34.8,"3020":-17.1,"3024":-276.1,"3031":70,"3032":41.9,"3033":228.9,"3035":-299.4,"3036":174.4,"3039":388.8,"3040":108.2,"3042":64.8,"3044":-280,"3046":112.8,"3047":31.2,"3050":76.2,"3051":-248.4,"3053":333.3,"3057":-379.6,"3065":245.9,"3066":-219.6,"3067":-362.4,"3068":119.7,"3070":-434.8,"3071":173.3,"3072":280.6,"3073":105.4,"3074":118.5,"3075":231.9,"3076":-215.1,"3077":-190,"3078":36.8,"3082":-143.3,"3083":213.2,"3084":50.3,"3085":95.6,"3086":-401.8,"3087":50.5,"3089":163,"3091":199.3,"3094":77.1,"3095":82.6,"3097":92.9,"3100":34.2,"3102":256.2,"3107":48.9,"3108":-373,"3109":143.2,"3110":200.2,"3111":46.5,"3112":-366.1,"3113":-393.7,"3114":-440.2,"3115":102.4,"3116":92.3,"3118":6.8,"3119":-145.4,"3121":150.3,"3123":-149.6,"3124":69.2,"3133":-333.1,"3134":-321.1,"3135":265,"3137":229.5,"3139":345.4,"3140":-32.6,"3142":116,"3143":249.2,"3144":-481.5,"3145":-367.1,"3146":67.5,"3147":-355.3,"3153":146.9,"3155":-89.4,"3156":270.8,"3157":134.6,"3158":-29.1,"3161":154.6,"3165":359.2,"3177":-333.5,"3179":108.7,"3181":342.9,"3184":-363.5,"3190":91.6,"3211":-213,"3222":31,"3302":193.4,"3330":-27.5,"3400":-547.8,"3504":10.7,"3508":29.9,"3742":224.6,"3748":340.7,"3801":-442.5,"3802":-438.1,"3803":-354.8,"3814":139.3,"3916":-144.5,"4003":-224.3,"4004":119.3,"4005":29.6,"4401":327.2,"4628":85,"4629":168.8,"4630":-145.1,"4632":-67.1,"4633":189.7,"4642":-412.9,"4645":69.1,"4646":21.8,"6333":215.7,"6609":553.5,"6610":80.6,"6616":74.4,"6617":-72.9,"6620":49.9,"6621":103,"6631":69.7,"6653":59.4,"6655":-35.1,"6657":26.9,"6660":-439.2,"6662":150.7,"6664":253.4,"6665":371.5,"6670":-336.6,"6672":117.6,"6673":154.6,"6675":105.2,"6676":-8.5,"6690":-353.4,"6692":66.7,"6694":118.8,"6695":253.2,"6696":-18.2,"6698":113.4,"6699":50.7,"8010":229.4,"8020":274,"123430":193.1,"124011":4.3,"126697":-51.9,"220013":20.9,"223069":202,"226668":67.2,"228002":110,"994403":85.7}}]},"heal":{"gm":541.83,"layers":[{"nm":"ch","tab":{"1":-396.8,"2":155.9,"3":-56.3,"4":-376.6,"5":964.7,"6":-101,"7":-308.5,"8":1460.6,"9":74.1,"10":67.5,"11":-180.5,"12":1004.3,"13":96.5,"14":414.1,"15":-241.5,"16":2219.9,"17":-382.8,"18":-258.7,"19":930,"20":484.4,"21":-365.2,"22":-356.8,"23":199,"24":-21.2,"25":-212.1,"26":57.8,"27":-18.9,"28":-38.6,"29":-345,"30":-435.5,"31":179.6,"32":-115.7,"33":-42.5,"34":-216.4,"35":-364.9,"36":719.6,"37":843.4,"38":-40.5,"39":140.2,"40":509.3,"41":-35.1,"42":-245.3,"43":-88,"44":956.7,"45":-249.2,"48":580.2,"50":1118.7,"51":-274.1,"53":-306.9,"54":-225,"55":-108.1,"56":-197.3,"57":841.8,"58":364,"59":-41.3,"60":-172.1,"61":-340,"62":-57.3,"63":-334.9,"64":58.3,"67":-290.2,"68":-172.4,"69":68.2,"72":133.3,"74":-339.5,"75":145.4,"76":174.9,"77":-178.9,"78":220.3,"79":447,"80":-113,"81":-160.5,"82":290.4,"83":237.1,"84":-118.8,"85":-370.2,"86":-112.5,"89":80.9,"90":-353.3,"91":-270.5,"92":-130.5,"96":-343.1,"98":45.3,"99":-404.1,"101":-407.6,"102":57.6,"103":-110.8,"104":-51.1,"105":-220.9,"106":422.7,"107":-25.5,"110":-326.5,"111":29.1,"112":-289.9,"113":102.4,"114":391.7,"115":-380.8,"117":13.9,"119":-153,"120":595,"121":-97.6,"122":231.8,"126":-356.1,"127":-205.7,"131":-232.6,"133":-294.8,"134":-323.5,"136":-244,"141":163.5,"142":-357.3,"143":-346.3,"145":-356.4,"147":-140,"150":-88.4,"154":2075.1,"157":-133.5,"161":-358.8,"163":-299.1,"164":53.5,"166":-306.7,"200":198.4,"201":-91.8,"202":-346.7,"203":65.7,"221":-297.2,"222":-316.1,"223":1080.3,"233":1237.1,"234":123.6,"235":354.9,"236":-277.9,"238":-298.5,"240":-63.7,"245":144.3,"246":-325.5,"254":-32.5,"266":795.3,"267":763.1,"268":-282.3,"350":272,"360":-0.8,"412":-114,"420":823,"421":1012.1,"427":138.9,"429":-238.1,"432":645.3,"497":227.7,"498":-286.9,"516":139.6,"517":547.6,"518":-383.6,"523":-152.9,"526":112.4,"555":98,"711":-344,"777":-113.5,"799":51.3,"800":-325.6,"804":-258.3,"805":34.8,"875":9.7,"876":272.8,"887":447.9,"888":-116.6,"893":-91.8,"895":59.6,"897":43.6,"901":-287.4,"902":579.4,"904":660.6,"910":-317.4,"950":-137.1}},{"nm":"aug","tab":{"1001":-33.6,"1002":190.7,"1004":117.3,"1005":267.6,"1006":-82.6,"1007":-18.9,"1011":-88.1,"1013":167.4,"1015":5.6,"1018":-49,"1019":-28.6,"1020":390.2,"1022":-4,"1025":-106.2,"1026":-56.1,"1027":-78.7,"1028":-34.9,"1029":-22.6,"1030":-38.3,"1034":-93.2,"1036":-1.2,"1037":154.5,"1038":-56,"1041":128.6,"1044":-44.4,"1045":-23.6,"1046":-65.2,"1047":-12.4,"1048":-40,"1051":-14.9,"1053":21.9,"1054":12.5,"1056":68.4,"1057":-59,"1058":-16.5,"1060":320.1,"1061":-41.6,"1062":96.8,"1063":12.4,"1067":610.1,"1068":-18.8,"1071":-7,"1072":-70.6,"1073":-4.3,"1074":-6.9,"1076":39,"1077":148.6,"1079":55.3,"1080":19.2,"1081":3.9,"1084":-51.6,"1087":-5.4,"1088":-83.6,"1092":-15.1,"1095":-22.2,"1097":-40.5,"1098":-27,"1103":-11,"1104":-67.8,"1105":-53.6,"1112":-62.8,"1113":-40.9,"1115":-26.3,"1116":-42.8,"1118":334.5,"1129":-31.3,"1133":-45.1,"1134":348.1,"1136":-23,"1138":174.4,"1141":173.8,"1149":-63,"1150":10.4,"1151":-15.4,"1152":172.7,"1154":-81.8,"1156":-47.2,"1170":-16.8,"1180":-86.1,"1181":13.2,"1194":-75.9,"1195":-22.3,"1204":113.2,"1205":-11.6,"1206":-10.1,"1211":-69.9,"1214":-46.2,"1220":-31.4,"1225":-6,"1237":-2.8,"1238":21.1,"1243":10.9,"1301":-49,"1305":-17.8,"1308":-43.1,"1311":7,"1314":-61.8,"1315":-39.7,"1318":-62.1,"1319":-31.7,"1320":-60.5,"1322":-37,"1323":-98.3,"1324":262.9,"1325":-92.2,"1326":-55.1,"1328":-3.7,"1329":-93.5,"1331":22.7,"1332":363.8,"1333":8.2,"1335":-70,"1336":-13.5,"1337":-37.9,"1344":15,"1345":-53.6,"1347":-42.7,"1349":-62.2,"1353":143.6,"1356":-5.7,"1358":-86.1,"1361":-171.9,"1373":-5.1,"1375":52.1,"1379":371,"1384":17,"1386":-84.2,"1388":-19.1,"1389":-16.4,"1390":-22.1,"1392":-104.5,"1401":6.9,"1402":-18.8,"1403":20,"1404":-42.4,"1413":-119.9,"1415":-38.1,"1416":-57.5,"1420":164.3,"1421":-117.7,"1996":149.7,"2004":12.4,"2005":-52.8,"2006":278.4,"2009":-5.9,"2010":3.2,"2016":-68.1,"2018":-37.7,"2024":-38.6,"2026":-38.4,"2031":-104.6,"2032":-97.5,"2034":-95.5,"2042":-65.7,"2043":209.5,"2046":-164.5,"2054":-48.3,"2055":-80.2,"2062":-191.6,"2063":-106.5,"2064":-144.1,"2065":-156.1,"2072":-98.6,"2073":91.5,"2076":-36.2,"2077":286.5,"2078":-185.3,"2080":-88.1,"2082":343.8,"2083":-66.1,"2087":-49,"2088":-104.6,"2089":-45.3,"2091":122.4,"2095":55.4,"2096":-27.2,"2097":-115.2,"2098":165.4,"2099":147.8,"2100":-73.5,"2102":-98.9,"2103":-76.4,"2104":335.6,"2107":38.1,"2108":228.7,"2111":-61.8,"2115":-75.3,"2116":-91,"2118":-98.3,"2119":-58.4,"2123":-78.3,"2125":-49.7,"2127":-22.1,"2128":-24.4,"2129":-160.2,"2131":-38.3,"2132":222.8,"2133":-44,"2134":-71.1,"2135":-35.2,"2136":-81.7,"2137":-53.9,"2138":-72.3,"2139":-26.4,"2140":94,"2141":170.5,"2143":194.3,"2144":-9.5,"2157":38.5,"12317":-32.1}},{"nm":"item","tab":{"1001":-163.5,"1004":-251.4,"1006":-313,"1011":-137.6,"1018":-123.6,"1026":-105.9,"1027":-164.2,"1028":-235.8,"1029":-215.8,"1031":-227.7,"1033":-184,"1036":-130.7,"1037":-136.9,"1038":-86.6,"1042":-136.7,"1043":-99.8,"1052":-119.4,"1053":-72.9,"1057":-106.9,"1058":-85.3,"2003":-323,"2019":-129.3,"2020":-82.5,"2021":-103.4,"2022":-229.1,"2031":-139.5,"2051":-255.2,"2052":-8.5,"2065":-27.4,"2420":-85.9,"2421":-55.2,"2501":199.5,"2502":226.7,"2503":-13.8,"2504":-7.5,"2508":-107.5,"2510":51.5,"2512":-15.6,"2517":178.4,"2522":20.7,"2523":-14,"2524":-63,"2525":85,"2526":-203.8,"2530":97.1,"3003":-47.9,"3004":-67.3,"3006":-26.4,"3008":129.6,"3009":-26.8,"3020":-37.5,"3024":-150.1,"3031":-1.5,"3032":-20,"3033":41.1,"3035":-67.6,"3036":28.8,"3039":66.1,"3040":26,"3042":0.9,"3044":-116.5,"3046":-11.9,"3047":-19.7,"3050":-149,"3051":-49.6,"3053":74.5,"3057":-148.3,"3065":225.4,"3066":-152.6,"3067":-244.6,"3068":-8.9,"3070":-163.1,"3071":35,"3072":90.4,"3073":1,"3074":109.4,"3075":47.8,"3076":-140,"3077":-69.8,"3078":5.6,"3082":-129.3,"3083":89.7,"3084":35,"3085":54.2,"3086":-89.1,"3087":17.3,"3089":26.4,"3091":28.9,"3094":-41.7,"3095":10.4,"3097":-21.6,"3100":-47.3,"3102":7.4,"3107":171.4,"3108":-153.6,"3109":48.2,"3110":7.8,"3111":-11.5,"3112":-73.2,"3113":-158.1,"3114":-171.1,"3115":-9.6,"3116":-8.4,"3118":-48.3,"3119":-97.7,"3121":41.2,"3123":-47.2,"3124":25.7,"3133":-139.1,"3134":-98.2,"3135":47.1,"3137":34.5,"3139":139.1,"3140":-20.1,"3142":-6,"3143":51.5,"3144":-127,"3145":-107.3,"3146":56.3,"3147":-93,"3152":-56.5,"3153":62.1,"3155":-51.9,"3156":72.7,"3158":-36.3,"3161":32.6,"3165":42.2,"3177":-86.9,"3179":-17.2,"3181":14.5,"3184":-14,"3190":18.8,"3211":-160.4,"3222":71.4,"3302":68.3,"3330":1.4,"3400":-129.4,"3504":62.5,"3508":-1.4,"3742":-16.4,"3748":94.9,"3801":-300.5,"3802":-113,"3803":-66.6,"3814":-11.9,"3916":-35.1,"4003":-225.1,"4004":-151,"4005":-106.5,"4401":51.6,"4628":-30.6,"4629":37.5,"4630":-35.9,"4632":-59.1,"4633":148.1,"4642":-168.4,"4645":-15.7,"4646":-54.8,"6333":71.2,"6609":150.7,"6610":59.6,"6616":210.3,"6617":69.9,"6620":471.2,"6621":304.3,"6631":-99,"6653":-1.3,"6655":-45.6,"6657":39.3,"6660":-199.6,"6662":-9.1,"6664":33.9,"6665":138.9,"6670":-104.5,"6672":6.7,"6673":0.6,"6675":8.3,"6676":-34.2,"6690":-98.7,"6692":-48.2,"6694":21.4,"6695":11.6,"6696":-20.3,"6698":-64.3,"6699":-18.7,"8010":54.3,"8020":11.5,"123430":-13.7,"124011":410,"126697":-31.9,"220013":-3.6,"223069":-151.8,"226668":154.4,"228002":-9.7,"994403":-25.3}},{"nm":"mate","tab":{"1":-12.5,"2":-17.5,"3":5.4,"4":-26,"5":-32.6,"6":-23,"7":-3.6,"8":-18.7,"9":-1.3,"10":-41.5,"11":-40.8,"12":-1.2,"13":-30.3,"14":15.9,"15":-13.7,"16":-32,"17":9.3,"18":-26.5,"19":-30,"20":13.9,"21":-0.9,"22":-10,"23":-8.2,"24":-14.1,"25":12.8,"26":19.9,"27":27.6,"28":-0.6,"29":-3.5,"30":17.9,"31":6,"32":10.4,"33":4.2,"34":5.7,"35":15.4,"36":-23.1,"37":-26.9,"38":-26,"39":-40.6,"40":-13,"41":1.3,"42":-20.9,"44":-19.6,"45":-8.3,"48":-7.5,"50":-13.1,"51":-29.5,"53":28.6,"54":8,"55":-8.5,"56":-6,"57":9.6,"58":-9.9,"59":4,"60":-12.4,"62":1.7,"63":-5.1,"64":-16.3,"67":-38.2,"68":-6.1,"69":-5.7,"72":-0.7,"74":-5.2,"75":-22.1,"76":-22.8,"77":9.2,"78":2.1,"79":4.5,"80":-14.7,"81":-18.3,"82":-11,"83":-37.3,"84":-4.7,"85":-5.7,"86":-2.4,"89":14.3,"90":-14.9,"91":9,"92":-6.7,"96":-13.8,"98":-0.6,"99":-1.5,"101":4,"102":-26.4,"103":-8.9,"104":-37.3,"105":1.6,"106":-7.1,"107":-10.4,"110":-18.4,"111":10.5,"112":-8.8,"113":3.2,"114":-53.2,"117":-8.9,"119":-36,"120":-31.6,"121":-6.2,"122":-20.4,"126":-18.5,"127":-7.8,"131":-10.5,"133":-38.3,"134":-5.8,"136":7.5,"141":-25.3,"142":-7.5,"143":-1.2,"145":-23.5,"147":-8.2,"150":-1.2,"154":-8.3,"157":-12.3,"161":0.8,"163":-5.6,"164":-5.9,"166":-21.1,"200":-46.1,"201":17,"202":-6.4,"203":-40.8,"221":-36.3,"222":-41.2,"223":-6.3,"233":-25.5,"234":-34.9,"235":-20.5,"236":-21.6,"238":-5.1,"240":-22.2,"245":-10.3,"246":-5.4,"254":-21,"266":-30.9,"267":-5.7,"268":-21,"350":-44,"360":-51.9,"412":13,"420":6.5,"421":12.6,"427":-13,"429":-34.2,"432":-20.8,"497":2.6,"498":-29.2,"516":19,"517":-33.6,"518":-2.4,"523":-41.4,"526":9.2,"555":13,"711":-19.1,"777":-19.9,"799":-22.9,"800":-13.9,"804":-37.2,"805":-21.1,"875":-1.9,"876":-6.4,"887":-42.4,"888":12.2,"893":-6,"895":-21,"897":7.8,"901":-5.5,"902":-14.4,"904":-24.8,"910":-5.2,"950":-22.6}},{"nm":"foe","tab":{"1":-20,"2":30.4,"3":39.3,"4":-23.1,"5":36.9,"6":19.8,"7":-6.6,"8":41.6,"9":-1.5,"10":-25,"11":-19,"12":44.1,"13":-0.6,"14":98.1,"15":7.5,"16":-17.8,"17":3.6,"18":-30.9,"19":24.2,"20":22.6,"21":-11.1,"22":-29.8,"23":34.6,"24":9.8,"25":-26.4,"26":-27.4,"27":27.7,"28":-13.2,"29":-5.3,"30":57.9,"31":23.4,"32":21.8,"33":37.8,"34":-19.7,"35":13,"36":64.1,"37":-24.9,"38":17.3,"39":18.3,"40":-27.3,"41":1.2,"42":-9.6,"43":-19.6,"44":25.1,"45":-24.2,"48":5.8,"50":31.9,"51":-33,"53":-10.7,"54":20.6,"55":15.1,"56":3.9,"57":56.9,"58":23.5,"59":24.6,"60":-13.4,"61":-13.6,"62":44.1,"63":-29,"64":10.7,"67":-55.7,"68":5.2,"69":-9.8,"72":63.3,"74":-11.3,"75":15,"76":-1.8,"77":28.1,"78":42.9,"79":17.7,"80":-10.4,"81":6.1,"82":12.9,"83":14,"84":10.9,"85":-14.4,"86":28.2,"89":45.1,"90":-34.1,"91":23.3,"92":8.5,"96":-12.6,"98":33.8,"99":-23,"101":-20.1,"102":24.3,"103":-26.3,"104":-18.9,"105":18.3,"106":40.6,"107":-2.5,"110":-30.7,"111":35.4,"112":-7.4,"113":29.1,"114":-3.7,"115":-3.5,"117":-44.8,"119":-9.7,"120":41.7,"121":-0.9,"126":-16.8,"127":-6.2,"131":28.5,"133":-30.2,"134":-21.3,"136":-9.9,"141":14.4,"142":-22.6,"143":-7.2,"145":-15.9,"147":-36.3,"150":10.3,"154":49.8,"157":11,"161":-21.1,"163":-22,"164":18.1,"166":-19,"200":-15.1,"201":8.3,"202":-23.1,"203":-15.7,"221":-10.7,"222":-36.5,"223":38.1,"233":18.8,"234":-16.2,"235":-16.5,"236":-22,"238":4.1,"240":34.7,"245":5.8,"246":-3.6,"254":18.2,"266":20.6,"267":-31.9,"268":-13.6,"350":-42.7,"360":-20.6,"412":11.6,"420":59.6,"421":50.3,"427":-35,"429":-20.5,"432":-16,"497":5,"498":-25.9,"516":35,"517":10.5,"518":-16.5,"523":-12.8,"526":35.6,"555":-30.2,"711":-15.2,"777":3.6,"799":15.2,"800":-11.6,"804":-26.7,"805":-15.9,"875":44.2,"887":-1,"888":-21,"893":-6.4,"895":14.2,"897":62.2,"901":11.3,"902":-27.9,"904":30,"910":-19.2,"950":8.2}},{"nm":"foeItem","tab":{"1001":-111.2,"1004":-154,"1006":-113.2,"1011":-43.5,"1018":-120.2,"1026":-87.5,"1027":-134.9,"1028":-96.2,"1029":-93.4,"1031":-58,"1033":-81.2,"1036":-103.8,"1037":-104.3,"1038":-98.1,"1042":-134.8,"1043":-85.3,"1052":-107.7,"1053":-56.7,"1057":-28.6,"1058":-69.8,"2003":-139.1,"2019":-57.2,"2020":-73.1,"2021":-36.2,"2022":-131,"2031":-141.3,"2051":-77.6,"2052":2,"2065":10.3,"2139":-55.7,"2140":-4.3,"2420":-51.3,"2421":-53.5,"2501":106.9,"2502":64.2,"2503":-3,"2504":82.2,"2508":-97.4,"2510":24.7,"2512":0.8,"2517":69.4,"2522":25.4,"2523":-5.5,"2524":4.2,"2525":66.8,"2526":-26.5,"2530":-12.3,"3003":-18.4,"3004":-37.4,"3006":-14.9,"3008":4.9,"3009":-0.7,"3020":-3.3,"3024":-56.4,"3031":5.3,"3032":-21.7,"3033":47.8,"3035":-73.7,"3036":31.4,"3039":85,"3040":22.2,"3042":14.8,"3044":-61.4,"3046":8.8,"3047":13.7,"3050":22,"3051":-68.1,"3053":76.5,"3057":-84.3,"3065":73.9,"3066":-50.9,"3067":-75.2,"3068":50.5,"3070":-95.9,"3071":50.7,"3072":41.9,"3073":24.5,"3074":42.9,"3075":63.2,"3076":-30.3,"3077":-31.8,"3078":10,"3082":-30.4,"3083":62.4,"3084":22.7,"3085":-4.4,"3086":-104.3,"3089":37.8,"3091":33.1,"3094":1.3,"3095":17.4,"3097":4.6,"3100":11.8,"3102":62.1,"3107":12.5,"3108":-83,"3109":35.8,"3110":47.2,"3111":17.7,"3112":-87.1,"3113":-100.5,"3114":-103.3,"3115":15.5,"3116":11.6,"3118":2.7,"3119":-25.8,"3121":50.1,"3123":-29.5,"3124":-4.8,"3133":-68.3,"3134":-75.5,"3135":71.9,"3137":58.8,"3139":62.6,"3140":-27.3,"3142":30.1,"3143":66.6,"3144":-116.5,"3145":-84.7,"3146":24.2,"3147":-77.3,"3152":10.2,"3153":21.9,"3155":-16.3,"3156":67.5,"3157":31.1,"3158":-8.1,"3161":36.1,"3165":84.9,"3177":-96.8,"3179":44.4,"3181":64.6,"3184":-94.7,"3190":19.4,"3211":-36.5,"3222":5.8,"3302":21.8,"3330":-4,"3400":-167.9,"3504":-11.2,"3508":-1.8,"3742":41.8,"3748":83,"3801":-88.6,"3802":-109.8,"3803":-54.9,"3814":38.9,"3916":-31.6,"4003":-48.9,"4004":31.3,"4005":3.8,"4401":93.7,"4628":18.1,"4629":43.7,"4630":-28.1,"4632":-11.2,"4633":55.4,"4642":-105.1,"4645":18.3,"4646":9.9,"6333":52.2,"6609":170.8,"6610":24.7,"6616":17.7,"6617":-16.8,"6620":12.2,"6621":24.8,"6631":24.7,"6653":12.8,"6655":-8.8,"6657":8.3,"6660":-72.9,"6662":47.1,"6664":79.6,"6665":96.7,"6670":-82.2,"6673":18.7,"6676":-6.8,"6690":-83.7,"6692":21,"6694":36.9,"6695":55.1,"6696":8,"6698":44.4,"6699":24.1,"8010":57,"8020":85.1,"123430":34.3,"124011":-0.7,"126697":-3.2,"223069":55,"226668":30.3,"228002":9.4,"994403":-6.7}}]},"cc":{"gm":1.9,"layers":[{"nm":"ch","tab":{"2":-0.8,"3":1.4,"7":-1.1,"8":-1.4,"9":1.8,"10":-1.5,"11":-1.8,"12":2.3,"14":0.7,"15":-1.9,"16":1.5,"17":1.1,"18":-1.7,"20":0.6,"21":-0.8,"22":0.9,"25":2.3,"27":1.8,"28":-1.3,"29":-1.3,"31":4.6,"32":1,"33":1,"34":2,"36":-0.9,"37":-0.9,"38":-1.3,"39":-0.5,"40":1.3,"41":-1.2,"42":-1.7,"44":0.8,"48":1,"50":1.8,"53":1.6,"55":-1.6,"56":6.2,"57":2.8,"58":-0.6,"62":-1.1,"64":-0.6,"67":-1.4,"68":-0.8,"69":0.6,"72":1.2,"75":-0.7,"76":-1.9,"77":0.6,"78":0.8,"79":1.3,"81":-1.8,"82":-0.8,"83":-1.1,"84":-1.7,"89":1.8,"90":2.6,"91":-1.5,"96":-1,"98":0.8,"99":2.3,"102":-1,"104":-0.6,"105":-1.1,"107":-1.4,"111":3.7,"112":0.6,"114":-1.2,"117":0.7,"119":-1.1,"121":-1,"126":-1.1,"127":2.3,"131":-1.3,"134":1.4,"141":-0.6,"143":1.4,"145":-1.9,"147":1,"154":1.2,"161":0.5,"163":1.2,"166":-1.9,"201":1.1,"203":-1.7,"221":-1.6,"222":-0.7,"234":-0.6,"236":-1.9,"238":-1.4,"240":-1.3,"246":-0.5,"267":0.8,"268":-1.1,"360":-1.7,"412":1,"420":-1.5,"421":0.8,"427":1.5,"429":-1.3,"432":1.4,"497":1,"498":-0.8,"516":0.9,"518":1.4,"523":-1.1,"526":1.1,"555":0.6,"711":0.6,"799":-1.1,"800":0.9,"804":-1.4,"805":-1,"887":-1.5,"893":-1.1,"895":-1.3,"897":0.7,"901":-1.2,"950":-1.8}},{"nm":"aug","tab":{"1194":0.8,"1421":0.7,"2065":0.6}},{"nm":"item","tab":{}},{"nm":"mate","tab":{}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{}}]},"gold":{"gm":931.53,"layers":[{"nm":"ch","tab":{"1":-36.4,"2":-14,"3":-33.9,"4":-5.6,"5":-4.3,"6":-18.8,"7":-2.7,"8":-9.9,"9":-26.2,"10":9.5,"11":41.8,"12":-43.6,"13":12.7,"14":20.6,"15":45.9,"16":-104.2,"17":-22.1,"18":37.7,"19":-13.6,"20":-31.7,"21":25,"22":-8.7,"23":0.6,"24":2.7,"25":-29.2,"26":-46.5,"27":-26,"28":-7.9,"29":65.2,"30":28.1,"31":-14,"32":-31.7,"33":-35.5,"34":-42.9,"35":11.4,"36":-10,"37":-68.2,"38":6.8,"39":31.6,"40":-88.2,"41":70.3,"42":62.1,"43":-70.9,"44":-80.7,"45":-25.7,"48":-22.6,"50":-23,"51":62.5,"53":-87.4,"54":-20.6,"55":10.9,"56":23.7,"57":-36.1,"58":-31.2,"59":0.9,"60":-24.6,"61":-5.6,"62":-1.8,"63":8.5,"64":-2.4,"67":26.8,"68":15.9,"69":-4.2,"72":-4.2,"74":-22.4,"75":5.8,"76":-3.5,"77":9.7,"78":-17,"79":-37.8,"80":4.9,"81":23,"82":-25.9,"83":-47.1,"84":-9.6,"85":-34.6,"86":1.5,"89":-49.7,"90":8.3,"91":43.6,"92":-21.4,"96":13.6,"98":-39.6,"99":-31.6,"101":-18.4,"102":-3.6,"103":-13.7,"104":104.3,"105":4.4,"106":-33.3,"107":42,"110":41.5,"111":-46.5,"112":9.5,"113":-1,"114":-0.6,"115":-26.5,"117":-97.2,"119":126.8,"120":9.8,"121":31.6,"122":-20.6,"126":35.5,"127":-19.7,"131":-9.1,"133":46.1,"134":-3,"136":34.1,"141":-14.3,"142":-21,"143":-26.6,"145":25.8,"147":-17,"150":-8.6,"154":-51.3,"157":-2.3,"161":-24,"163":-14.4,"164":-31.3,"166":97.7,"200":-6.6,"201":-84.8,"202":68.4,"203":47.3,"221":76.1,"222":58.4,"223":-38.7,"233":-1.2,"234":45.6,"235":25.2,"236":76.9,"238":41.5,"240":-25.3,"245":27.7,"246":27,"254":-19.6,"266":-28.8,"267":-89.6,"268":-1.2,"350":-88.3,"360":112.9,"412":-75.5,"420":-17.5,"421":-41.5,"427":-96.9,"429":37,"432":-70.2,"497":-69.2,"498":49.1,"516":-35.9,"517":-12.4,"518":-48.3,"523":83.1,"526":-31.7,"555":4.3,"711":-14.4,"777":6.7,"799":6.4,"800":39.2,"804":65,"805":10.5,"875":-11.1,"876":4.1,"887":1.7,"888":-82.2,"893":12.4,"895":53.5,"897":-60.6,"901":21.4,"902":-85.6,"904":-18.2,"910":7.4,"950":41.4}},{"nm":"aug","tab":{"1001":-11.3,"1002":-4.3,"1004":19.4,"1005":-1.8,"1006":0.7,"1007":5.6,"1011":-9.9,"1013":0.8,"1015":7.5,"1018":-10,"1019":-3,"1020":-6.9,"1022":1,"1025":-6,"1026":6.3,"1027":-5.3,"1028":-1.1,"1029":-1.7,"1030":1.1,"1034":-5,"1036":-2,"1037":-4.6,"1038":67.7,"1044":-7,"1045":10.1,"1047":-2.7,"1048":3.4,"1051":1.9,"1053":7.4,"1054":1.3,"1056":2.4,"1057":-5.9,"1058":-3,"1060":3.5,"1061":2.4,"1062":7.6,"1063":-2.3,"1067":-7.2,"1068":1.9,"1072":-8.8,"1073":2.7,"1074":-11.1,"1076":-1.4,"1077":10.1,"1079":1.1,"1080":6.2,"1081":-2.5,"1084":-1.6,"1087":-6,"1088":-12.1,"1092":6.4,"1095":-6.2,"1097":0.8,"1098":-1.9,"1103":1,"1104":1.8,"1105":1.2,"1112":-6.5,"1113":-9.2,"1115":-3.7,"1116":3.9,"1118":-13.9,"1129":4,"1133":-1.1,"1134":18.5,"1136":-2.8,"1138":1.3,"1141":-8.3,"1149":-9.7,"1150":-6.2,"1151":-2.2,"1152":-10.4,"1154":-9.8,"1156":1.1,"1170":-5,"1180":2.9,"1181":3.8,"1194":-14.9,"1195":9,"1204":-2.9,"1205":5.4,"1206":8.4,"1211":-2.5,"1214":0.8,"1220":3.2,"1225":9.8,"1237":0.8,"1238":3.7,"1243":2.4,"1301":-7.3,"1305":-0.9,"1308":6.6,"1314":2.5,"1315":-0.6,"1318":9.5,"1319":90.9,"1320":45.6,"1322":-1.7,"1323":-0.7,"1324":-7.3,"1325":-7.1,"1326":-0.7,"1329":1.7,"1331":-9.4,"1332":4.9,"1333":5,"1335":83.1,"1336":37.7,"1337":-6.7,"1344":-2.2,"1345":-6.9,"1347":-7.1,"1349":-6.9,"1353":1.2,"1356":17.8,"1358":-5,"1361":20,"1373":1.9,"1375":-7.6,"1379":-15.5,"1384":109.7,"1386":-20.4,"1388":2.6,"1389":7.7,"1390":2.2,"1392":-13,"1401":-6.5,"1402":-5.2,"1403":5.7,"1404":-4.1,"1413":-18.3,"1415":1.7,"1421":-18.7,"1996":17.5,"2004":-1.2,"2005":4.7,"2006":37.5,"2009":-0.8,"2010":5.7,"2016":-8.8,"2018":-4.4,"2024":-10.4,"2026":-1,"2031":19.9,"2032":-3.6,"2034":-10.1,"2042":-2.4,"2043":-10.8,"2046":-39.9,"2054":-1.8,"2055":-24,"2062":0.9,"2063":-30.3,"2064":-18.2,"2065":-23.5,"2072":-7.6,"2073":-12.5,"2076":-15.3,"2077":-8.6,"2078":-19.5,"2080":-13.1,"2082":-7.1,"2083":3,"2087":-8.9,"2088":-8.2,"2089":18.2,"2091":-1.2,"2095":10.2,"2096":-3.6,"2097":3.9,"2099":3,"2100":-10.8,"2102":2,"2103":-13.4,"2104":-8.5,"2107":-6.2,"2108":-9.2,"2111":11.8,"2115":-15.8,"2116":-6.4,"2118":-17.8,"2119":-7.4,"2123":-9.8,"2125":-14.8,"2127":8.5,"2128":107.9,"2129":21.7,"2131":-9.1,"2132":3.5,"2133":2.1,"2134":-12.1,"2135":-15.5,"2136":-10.7,"2137":-8.7,"2138":-15.5,"2139":-8,"2140":38.6,"2141":35.4,"2143":26.2,"2144":-15.9,"2157":38.6,"12317":-10.9}},{"nm":"item","tab":{"1001":-41.1,"1004":-30.1,"1006":-57.1,"1011":-30.6,"1018":-61.3,"1026":-33.2,"1027":-49.4,"1028":-46.4,"1029":-43.2,"1031":-41.9,"1033":-38.1,"1036":-42.6,"1037":-53,"1038":-39.5,"1042":-52.5,"1043":-43.9,"1052":-36.4,"1053":-24.2,"1057":-30.4,"1058":-26.6,"2003":-85.5,"2019":-24,"2020":-19.8,"2021":-28.2,"2022":-50.4,"2031":-50.7,"2051":-43.8,"2052":-2.7,"2065":6.2,"2420":-22.7,"2421":-13.9,"2501":21,"2502":9.4,"2503":3.6,"2504":5.5,"2508":-44.4,"2510":6.5,"2512":1.3,"2517":34.4,"2522":13.1,"2523":6.2,"2524":-13.6,"2525":2.9,"2526":-16.1,"2530":-0.8,"3003":-7.3,"3004":-20.5,"3006":-5.8,"3008":15.6,"3009":-2,"3020":-0.9,"3024":-39.8,"3031":12.6,"3032":-10.2,"3033":16.4,"3035":-30.6,"3036":22.3,"3039":8.6,"3040":8.3,"3042":1.4,"3044":-32.7,"3046":12.8,"3047":-2.2,"3050":-12.6,"3051":-25.9,"3053":16.8,"3057":-37,"3065":8.6,"3066":-38.8,"3067":-42.7,"3068":34.3,"3070":-43.2,"3071":7.1,"3072":34.9,"3073":4.5,"3074":21.1,"3075":7.2,"3076":-34.2,"3077":-19.7,"3078":-1,"3082":-26.3,"3083":10.7,"3084":-6.6,"3085":7.3,"3086":-46.3,"3087":1.5,"3089":22.8,"3091":11.1,"3094":0.5,"3095":11.5,"3097":10.2,"3100":8.7,"3102":32.6,"3107":6.6,"3108":-36.7,"3110":6.4,"3111":-5.4,"3112":-16,"3113":-34.5,"3114":-27.6,"3115":4.7,"3116":4.4,"3118":-4.3,"3119":-18.5,"3121":-1.1,"3123":-38.1,"3124":5.6,"3133":-36.9,"3134":-39.2,"3135":31.2,"3137":23,"3139":52.9,"3140":2.3,"3142":18.2,"3143":13.1,"3144":-59.4,"3145":-39.4,"3146":11.5,"3147":-37.7,"3152":2.5,"3153":6.5,"3155":-13.9,"3156":26.1,"3157":14,"3158":-8.4,"3161":8.2,"3165":19.3,"3177":10.6,"3179":25.3,"3181":20,"3184":-16.1,"3190":5.9,"3211":-30.8,"3222":5.5,"3302":23.5,"3400":-16.9,"3504":3.1,"3508":1.2,"3742":6.1,"3748":19.3,"3801":-56.4,"3802":-40.7,"3803":-40.2,"3814":21,"3916":-20.1,"4003":-22,"4004":5.5,"4005":-6.5,"4401":11.6,"4628":-0.5,"4629":8.3,"4630":-9,"4632":3.4,"4633":12.5,"4642":-31.1,"4645":12,"4646":7.3,"6333":16.5,"6609":18,"6610":-3.8,"6616":9.4,"6617":-3.2,"6620":-1,"6621":10.3,"6631":1.4,"6653":5.2,"6657":-5,"6660":-34,"6662":-1.8,"6664":24,"6665":21.6,"6670":-41.2,"6672":9.7,"6673":7.9,"6675":0.8,"6676":14.7,"6690":-42.5,"6692":-0.7,"6694":17.7,"6695":5.3,"6696":6.4,"6698":29.6,"6699":20.5,"8010":24.9,"8020":11.4,"123430":8.2,"124011":-7.9,"126697":1.5,"220013":0.9,"223069":16.1,"226668":25.3,"228002":7.9,"994403":9.6}},{"nm":"mate","tab":{"1":-0.9,"2":-4.5,"3":3,"4":0.9,"5":-1.9,"6":-6,"7":-7.9,"8":-4,"9":2.3,"10":-6.4,"11":-16.2,"12":3.7,"13":-7.9,"15":-4.3,"16":6.2,"18":-8.6,"19":-7.4,"20":-3.2,"21":-3.3,"22":1,"23":-6.9,"24":-3.9,"25":2.1,"27":12,"28":-6.2,"29":-8,"30":4,"31":-5.9,"32":4.1,"33":2,"35":-8.3,"36":-6.3,"37":3,"38":-6.3,"39":-10.9,"40":4.3,"41":-9.4,"42":-9,"43":3.4,"44":3.3,"45":-3.6,"48":-1.1,"51":-9.5,"53":15,"54":-1,"55":-7,"56":-8.6,"57":5.2,"58":-4.8,"59":-3.9,"60":-3.3,"61":-3.4,"62":-5.9,"63":3.3,"64":-10.4,"67":-4.3,"69":-2.6,"74":-1.5,"75":-7.9,"76":-10.8,"77":4.6,"78":-1.5,"79":1.8,"80":-3.9,"81":-5.5,"82":-0.6,"83":-9,"84":-10.2,"85":-1.5,"86":-9,"89":5.4,"90":-4.4,"91":-8.3,"92":-2,"98":0.9,"99":-1,"101":-3,"102":-3.3,"103":0.5,"104":-13.1,"105":-3.7,"106":-5.6,"107":-6.1,"110":-8.2,"111":7,"112":-1.4,"113":-2.1,"114":-4.2,"115":-1.4,"117":2.2,"119":-14.5,"120":-7.6,"121":-10.3,"122":-3.1,"126":-11.1,"127":3.2,"131":-2.8,"133":-9.4,"134":-1.2,"136":-3.5,"141":-1.5,"142":-2.8,"143":0.5,"145":-10.5,"147":2.6,"150":-3,"154":2.2,"157":-1.2,"161":1,"163":4.2,"166":-7,"200":-8.7,"201":4.2,"202":-11.1,"203":-11.4,"221":-9.7,"222":-8.9,"223":-1.2,"233":-0.8,"234":-12.6,"235":-2.4,"236":-10,"238":-9.8,"240":1.7,"245":-7,"246":-7.4,"254":-1.6,"266":-3.5,"267":3.4,"268":-4.4,"350":1,"360":-17.1,"412":5.7,"420":-1.4,"421":3.3,"427":5.9,"429":-9.7,"432":-4.4,"498":-6.6,"517":-4.8,"523":-9,"526":3.9,"555":10.8,"711":-1.1,"777":-2.1,"799":-3.3,"800":-17.3,"804":-7.1,"805":-20.4,"875":0.6,"876":2.2,"887":-4.4,"888":7.9,"893":-2,"895":-9,"897":2,"901":-5.8,"902":3.5,"904":1.1,"910":-1.5,"950":-15.9}},{"nm":"foe","tab":{"1":2.7,"2":6.8,"3":1.5,"4":-4.8,"5":6,"6":6.9,"7":6.4,"8":4.2,"9":1.3,"10":-2.4,"11":2.1,"12":-2.7,"14":3.9,"15":0.5,"16":-19.9,"17":2.8,"18":0.5,"19":5.5,"20":5.4,"21":-2.1,"22":-2,"23":6.9,"24":2.9,"25":-6,"26":-8.5,"27":7.3,"28":1.1,"29":6.2,"30":14.1,"31":1.6,"32":5.6,"33":5.5,"34":-3.2,"35":9.5,"37":-13.8,"38":2.4,"39":8.9,"40":-17.3,"41":1.4,"42":1.2,"43":-10.9,"44":-5.9,"45":-3.7,"51":-5.4,"53":1.2,"54":4.4,"55":7.5,"56":5.9,"57":0.5,"58":3.1,"59":7.8,"60":1.9,"61":-3.6,"62":4.2,"63":1.3,"64":4.4,"67":-2.9,"68":4.6,"69":-0.5,"72":3,"74":-1.7,"76":-6.1,"77":9.9,"78":1.5,"79":-1.3,"80":2.6,"81":-3.8,"82":4.9,"83":3.2,"84":5.6,"85":4.7,"86":6.9,"89":2.5,"90":-2.1,"91":8.2,"92":2.1,"98":-2,"99":-8.4,"101":-5.7,"103":-2.6,"104":-1.2,"105":6.5,"106":0.8,"107":9.3,"110":-2.6,"111":1.7,"112":-3.6,"113":2.8,"114":2.6,"115":-4.1,"117":-15.8,"119":-0.5,"120":5.7,"121":4.6,"122":2.6,"126":0.8,"127":7.2,"131":4.6,"134":-3.2,"136":3.4,"141":6.2,"143":-1.6,"145":-1.5,"147":-8.3,"150":2.4,"154":7.5,"157":1.6,"161":-4.3,"164":7,"166":2.4,"200":4.1,"203":-0.7,"222":-6.9,"223":-6.4,"233":8.4,"234":4.1,"235":-5.2,"236":1.3,"238":2.7,"240":6.2,"245":3,"246":4.9,"254":5.5,"266":4.6,"267":-10.2,"268":3.4,"350":-16.8,"360":1,"412":0.6,"421":2.2,"427":-14.7,"429":2.1,"432":-5.8,"497":-2.3,"498":-2.9,"516":1.3,"517":3.1,"518":-1.7,"523":-2,"555":-2.1,"711":-1.6,"777":4.8,"799":5.7,"800":-1.2,"804":-2.2,"805":9.4,"876":-0.9,"887":-0.5,"888":-8.4,"895":3.2,"897":6.2,"901":2.8,"902":-14.6,"904":1,"910":-7.7,"950":6.5}},{"nm":"foeItem","tab":{"1001":-21.8,"1004":-44.3,"1006":-30.3,"1011":-12.3,"1018":-20.7,"1026":-17.6,"1027":-32.8,"1028":-22,"1029":-22.1,"1031":-13.8,"1033":-19.3,"1036":-20,"1037":-19,"1038":-19.1,"1042":-27.5,"1043":-14.2,"1052":-24.4,"1053":-9.9,"1057":-7.1,"1058":-14.7,"2003":-28.6,"2019":-9.4,"2020":-10.6,"2021":-7.9,"2022":-29.8,"2031":-33.4,"2051":-19.1,"2139":-12.2,"2140":12.8,"2420":-7,"2421":-11.8,"2501":11.2,"2502":5.6,"2504":13.3,"2508":-17.6,"2510":4.1,"2512":5,"2517":13.1,"2522":6.1,"2523":1.1,"2524":1.9,"2525":11,"2526":-5.5,"2530":-10.7,"3003":-1.1,"3004":-4.3,"3006":-0.6,"3008":2.1,"3009":1,"3024":-15.9,"3031":2.3,"3032":-2,"3033":12.9,"3035":-14.6,"3036":9.5,"3039":16.2,"3040":3.3,"3042":2.9,"3044":-9.1,"3046":6.8,"3047":-1.5,"3050":3.2,"3051":-13.3,"3053":13.4,"3057":-17.7,"3065":9.4,"3066":-12,"3067":-17.7,"3068":5.5,"3070":-20.3,"3071":9.1,"3072":11.5,"3073":7.2,"3074":9.3,"3075":9.1,"3076":-8.7,"3077":-7,"3078":1.2,"3082":-5.7,"3083":5.1,"3084":1,"3085":1.1,"3086":-19.2,"3087":0.5,"3089":8.2,"3091":11.5,"3094":2.7,"3095":10.2,"3097":6,"3100":4.9,"3102":18.9,"3107":-4.6,"3108":-19.4,"3109":6.8,"3110":7.7,"3111":2.8,"3112":-20.9,"3113":-23.4,"3114":-31.3,"3115":5.9,"3116":3.9,"3118":2.1,"3119":-5.7,"3121":4.4,"3123":-2.3,"3124":3.8,"3133":-12.9,"3134":-11.4,"3135":16.6,"3137":15.6,"3139":20.6,"3140":2.3,"3142":10,"3143":11.9,"3144":-21.1,"3145":-17.8,"3146":10.3,"3147":-15.6,"3152":5,"3153":6.7,"3156":17,"3157":9.8,"3158":-2.6,"3161":6.9,"3165":17.4,"3177":-18.9,"3179":15.3,"3181":9.8,"3184":-18.7,"3211":-11,"3222":-4,"3302":9.5,"3330":0.5,"3400":-43.9,"3504":-8.1,"3508":2.1,"3742":10.9,"3748":11.5,"3801":-18.4,"3802":-25,"3803":-20.2,"3814":13.3,"3916":-2.5,"4003":-5.8,"4004":7.5,"4401":17.3,"4628":1.7,"4629":7,"4630":-3.1,"4632":3.1,"4633":8.2,"4642":-30.2,"4645":4.7,"4646":3.6,"6333":10.5,"6609":26.7,"6610":3.7,"6616":-4.8,"6617":-11.5,"6620":-5.7,"6621":-3.2,"6631":6.7,"6653":2.5,"6655":-2.3,"6660":-12.7,"6662":4.4,"6664":10.3,"6665":15.8,"6670":-13.2,"6672":4.1,"6673":6.8,"6675":3,"6676":1.8,"6690":-16.8,"6692":6.1,"6694":10,"6695":16.4,"6696":4.7,"6698":11.8,"6699":8.8,"8010":13.5,"8020":12.4,"123430":5.6,"124011":-6.4,"126697":3,"220013":-1.3,"223069":1.6,"226668":12,"228002":1,"994403":2.6}}]},"k":{"gm":0.6,"layers":[{"nm":"ch","tab":{}},{"nm":"aug","tab":{}},{"nm":"item","tab":{}},{"nm":"mate","tab":{}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{}}]},"a":{"gm":1.45,"layers":[{"nm":"ch","tab":{"16":0.9,"37":0.9,"40":0.8,"44":0.7,"107":-0.5,"117":0.7,"147":0.7,"267":0.8,"350":0.9,"427":0.8,"888":0.6,"902":0.9}},{"nm":"aug","tab":{}},{"nm":"item","tab":{}},{"nm":"mate","tab":{}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{}}]},"d":{"gm":0.6,"layers":[{"nm":"ch","tab":{}},{"nm":"aug","tab":{}},{"nm":"item","tab":{}},{"nm":"mate","tab":{}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{}}]}},"games":50608};
const MT_EXPECT_450 = {"AX":["dmg","taken","mit","heal","prot","cc","gold","cs","k","a","d"],"TBL":{"dmg":{"gm":1478.79,"layers":[{"nm":"ch","tab":{"0":-22.8,"1":-102.3,"2":231.5,"3":-504.4,"4":-57,"5":119.3,"6":-143.1,"7":223.1,"8":204.3,"9":-97.3,"10":-202.4,"11":400.6,"12":-786.4,"13":147.7,"14":-189.9,"15":181.5,"16":-1018.4,"17":-56.5,"18":146.6,"19":-229,"20":-425.3,"21":200.5,"22":14.9,"23":161.8,"24":-36.5,"25":-265.5,"26":-600,"27":-289.9,"28":219.7,"29":274.2,"30":691.3,"31":-246.9,"32":-533,"33":-558,"34":-294.1,"35":-57.9,"36":-80.9,"37":-805.4,"38":151.9,"39":268.8,"40":-1056.7,"41":349.3,"42":557.1,"43":-512.4,"44":-891.8,"45":-205.2,"48":-568.5,"50":-82.8,"51":213.8,"53":-660.3,"54":-244.5,"55":380.5,"56":202.7,"57":-487.2,"58":8.5,"59":-112.9,"60":20.7,"61":-44.1,"62":-47.5,"63":129.6,"64":121.8,"67":113.5,"68":298.1,"69":-55.2,"72":-227.8,"74":3.9,"75":-309,"76":213.5,"77":50.9,"78":-296.7,"79":-200.1,"80":273.9,"81":468.4,"82":-23.7,"83":-271.5,"84":96.3,"85":68.8,"86":-33.4,"89":-638.1,"90":-214.1,"91":433.2,"92":23,"96":414.7,"98":-392.4,"99":-252.6,"101":82.2,"102":11,"103":26.9,"104":303.2,"105":72.9,"106":-260.4,"107":258.3,"110":340.3,"111":-659.6,"112":164.6,"113":-343.8,"114":23.9,"115":58.7,"117":-1013.6,"119":385.1,"120":381.5,"121":361.6,"122":-159.1,"126":437.2,"127":35.5,"131":134.5,"133":179.1,"134":83.5,"136":-77,"141":50.7,"142":272.8,"143":-74.2,"145":270.9,"147":-340.5,"150":88.2,"154":-528.9,"157":-132.9,"161":105.8,"163":96.1,"164":101.7,"166":166,"200":-51.1,"201":-814.6,"202":165.8,"203":294.6,"221":373.4,"222":94.4,"223":-324.1,"233":119,"234":196.8,"235":-105.8,"236":474.4,"238":442.9,"240":64.5,"245":78.4,"246":548.4,"254":22.3,"266":168,"267":-869.9,"268":84,"350":-778.7,"360":487.7,"412":-621.5,"420":-35.9,"421":-74.7,"427":-1024.3,"429":400.8,"432":-360.6,"497":-857.9,"498":324.3,"516":-501.7,"517":25.5,"518":-132.4,"523":194.4,"526":-763.7,"555":-309.4,"711":77.3,"777":102.4,"799":206.4,"800":68.9,"804":284.3,"805":-0.9,"875":-80.5,"876":-30.6,"887":144.4,"888":-890.9,"893":334.6,"895":-34.4,"897":-336.9,"901":190.8,"902":-1040.2,"904":4.6,"910":64.6,"950":290.7}},{"nm":"item","tab":{"2065":-43.7,"2139":89.2,"2152":-412.9,"2501":183.3,"2502":83.8,"2503":42.8,"2504":-23.8,"2510":74.4,"2512":34.8,"2517":335.8,"2522":157.3,"2523":149.7,"2524":-62.8,"2525":-72.4,"2526":-21.7,"2530":-93.7,"3002":-39.5,"3004":-527.9,"3006":-12.8,"3008":162.7,"3009":31.4,"3020":42.6,"3031":164,"3032":-36,"3033":267.5,"3036":330.7,"3040":46.8,"3042":45.5,"3046":183.1,"3047":30.6,"3050":-22.9,"3053":118.5,"3065":37.4,"3068":101.6,"3071":120.4,"3072":239,"3073":18.2,"3074":119.7,"3075":99.4,"3076":-15.7,"3078":16.1,"3083":43.9,"3084":62.1,"3085":105.5,"3087":-19.8,"3089":260,"3091":116.8,"3094":67,"3095":65.8,"3097":74.4,"3100":95.3,"3102":168.9,"3107":-50.3,"3109":-80.3,"3110":-10,"3111":-15.8,"3115":40.3,"3116":53.8,"3118":6.4,"3119":-217.5,"3121":18.8,"3123":-43.9,"3124":107.7,"3135":314.6,"3137":237.7,"3139":398.5,"3142":145.1,"3143":-72.2,"3146":-33.1,"3152":41.2,"3153":141.5,"3156":185.6,"3157":119.1,"3158":-34.8,"3161":126.4,"3165":240.9,"3177":87.8,"3179":214.7,"3181":18.8,"3190":-79.1,"3222":-73.1,"3302":307.3,"3330":22.6,"3400":8.5,"3504":-48.4,"3508":16.6,"3742":11.5,"3748":114.3,"3803":-215.1,"3814":143.7,"3916":18.7,"4003":-13.3,"4004":210.6,"4005":-11.8,"4401":-12.1,"4628":58.1,"4629":85.2,"4633":100.8,"4645":115.7,"4646":86.5,"6333":175.4,"6609":245.4,"6610":41.7,"6616":-49.6,"6617":-90.4,"6620":-128.2,"6621":-95,"6631":27.6,"6653":106.2,"6655":30.8,"6657":-67.8,"6662":17.2,"6664":121.1,"6665":73.3,"6672":58.4,"6673":147,"6675":59.2,"6692":1.1,"6694":212.6,"6695":89.5,"6696":49.1,"6698":225.6,"6699":157.2,"6701":180.2,"8010":216.7,"8020":62.9,"126697":46.1}},{"nm":"mate","tab":{"0":-67.9,"1":-38.9,"2":-82.6,"3":1,"4":-73,"5":-77,"6":-55,"7":-75.3,"8":-93.9,"9":-34.6,"10":-82.2,"11":-143.7,"12":12.6,"13":-99,"14":11.6,"15":-64.1,"16":76.2,"17":-90.5,"18":-95.3,"19":-30.6,"20":4.2,"21":-86.4,"22":-48.2,"23":-52.8,"24":-65.3,"25":-28.4,"26":-13.8,"27":28.6,"28":-103.4,"29":-63.1,"30":-64.6,"31":-27.9,"32":10.5,"33":30.3,"34":-29,"35":-30.6,"36":-82,"37":3.5,"38":-106.9,"39":-97.6,"40":48.1,"41":-102.7,"42":-94.8,"43":-11.6,"44":31.3,"45":-52.6,"48":-31.2,"50":-48.2,"51":-83.7,"53":57.5,"54":-45.4,"55":-132.6,"56":-61.4,"57":-16.9,"58":-67.2,"59":-39.7,"60":-93.5,"61":-74.7,"62":-70.8,"63":-79.2,"64":-87.8,"67":-94.5,"68":-106.2,"69":-56.8,"72":-42.4,"74":-83.3,"75":-54.1,"76":-100,"77":-39.3,"78":-28.4,"79":-30.2,"80":-66.5,"81":-100.5,"82":-70.7,"83":-91.9,"84":-95.9,"85":-81.7,"86":-51.1,"89":1,"90":-58.5,"91":-86,"92":-55.9,"96":-74.2,"98":-26,"99":-38,"101":-63.3,"102":-109.1,"103":-74.8,"104":-94.3,"105":-46.9,"106":-31.1,"107":-75.7,"110":-87.9,"111":18.5,"112":-83.9,"113":-43.9,"114":-64.6,"115":-98.6,"117":36.7,"119":-98.4,"120":-128.3,"121":-106.3,"122":-44.6,"126":-114.1,"127":-52.7,"131":-83,"133":-58.8,"134":-84.5,"136":-83.3,"141":-55,"142":-95.7,"143":-63.5,"145":-102,"147":-52,"150":-89.6,"154":-1.9,"157":-40.6,"161":-75.8,"163":-49.5,"164":-65.2,"166":-65.4,"200":-55,"201":14,"202":-49.4,"203":-98.3,"221":-93.1,"222":-83.6,"223":-29.8,"233":-40.9,"234":-114.7,"235":-32,"236":-107.5,"238":-97.8,"240":-49.7,"245":-55.3,"246":-121.2,"254":-37.5,"266":-91.4,"267":17.9,"268":-95.1,"350":5.2,"360":-120.5,"412":-6.7,"420":-37.8,"421":-47,"427":64.2,"429":-102.1,"432":-45.2,"497":27.1,"498":-79.5,"516":4.4,"517":-68.6,"518":-41.9,"523":-80.7,"526":5.1,"555":23.7,"711":-79.8,"777":-81.7,"799":-100.9,"800":-92.1,"804":-93.4,"805":-113.3,"875":-47.3,"876":-81.5,"887":-117.2,"888":151.3,"893":-89.8,"895":-22.9,"897":-26.8,"901":-77,"902":22.8,"904":-49.5,"910":-60.8,"950":-107.7}},{"nm":"foe","tab":{"1":-29.9,"2":50.2,"3":-6.3,"4":-40.7,"5":66.3,"6":125,"7":-9.4,"8":98.2,"9":38.5,"10":37.2,"11":-52.2,"12":62.5,"13":33.4,"14":345.6,"15":9,"16":37,"17":17.7,"18":-4.1,"19":95.1,"20":70.7,"21":-4.5,"22":-27.1,"23":88.7,"24":23.3,"25":-20.9,"26":-9.9,"27":97.7,"28":-28.2,"29":12.3,"30":102.9,"31":120.5,"32":6.1,"33":18.5,"34":58.8,"35":-28.3,"36":243.7,"37":-23.8,"38":50.6,"39":21.1,"40":-82.5,"41":-13.6,"42":-12.1,"43":-87.4,"44":-2,"45":8.9,"48":123.6,"50":182.3,"51":-33.5,"53":2.2,"54":27.3,"55":6.4,"57":95.6,"58":89.6,"59":9.1,"60":-54.5,"61":-62,"62":11.1,"63":9.2,"64":-11.9,"67":-11.3,"68":9.7,"69":51.4,"74":-21.5,"75":109.6,"76":-10.2,"77":33.7,"78":38.2,"79":11.3,"80":-20,"81":-14.4,"82":98.9,"83":59.8,"84":39.1,"85":-35.6,"86":41.3,"89":7.5,"90":-50.2,"91":15.8,"92":-63.8,"96":16.1,"98":68,"99":-77,"101":-63.2,"102":42.3,"103":-25.6,"104":-6.3,"105":36.2,"106":145.1,"107":10.1,"110":-52.6,"111":-5.7,"112":-33.2,"113":78.5,"114":35.2,"115":-27.7,"117":-89.3,"119":-0.9,"120":-2.2,"121":-52.8,"122":31.5,"126":-75.6,"127":-8.9,"131":10.9,"133":-8.4,"134":-59.5,"136":35.6,"141":50.4,"142":-62.9,"143":-59.1,"145":-29.7,"147":-56.8,"154":105,"157":-25.6,"161":-56.1,"163":-39.4,"164":7.3,"166":-5.3,"200":9.2,"201":6.2,"202":-15.9,"203":-5.5,"221":6.2,"222":-35.8,"223":160.4,"233":83.2,"234":-20.3,"235":9.2,"236":-30.2,"238":-66.7,"240":110.1,"245":59.4,"246":-87.9,"254":6.7,"266":53.7,"267":-46,"268":4.3,"350":-145.9,"360":-16.4,"420":125.3,"421":22.9,"427":-133.5,"429":-36.9,"432":18.7,"497":-53.4,"498":-1.6,"516":101.9,"517":91.8,"518":-36,"523":3.8,"526":-71.3,"555":-32.2,"711":-64.7,"777":-23.2,"800":-36.2,"804":-6.4,"805":40.6,"875":99.2,"876":62.7,"887":59.2,"888":-1.2,"893":-11.6,"895":42.1,"897":27.3,"901":25.5,"902":-76.2,"904":112.1,"910":-78.4,"950":-68.1}},{"nm":"foeItem","tab":{"1001":-23.8,"1011":33.5,"1018":43.5,"1028":-17.8,"1029":-15.7,"1033":98.9,"1036":-10.9,"1037":52.3,"1052":21.9,"1057":43,"1058":120.1,"2031":-42.8,"2051":-15.7,"2065":13.4,"2138":99,"2139":50.4,"2140":53.5,"2152":-192.4,"2501":216.5,"2502":161,"2503":-17.4,"2504":68.3,"2510":63.3,"2512":22.8,"2517":99.6,"2520":-16,"2522":85.8,"2523":-12.9,"2524":35.5,"2525":76.4,"2526":-36.7,"2530":-29.2,"3002":61,"3004":-196.6,"3006":1.6,"3008":-7.2,"3009":1.5,"3020":5.1,"3031":43.7,"3032":4.1,"3033":83.9,"3036":87,"3040":52,"3042":1.4,"3046":34.1,"3047":22.5,"3050":-30.8,"3053":134.1,"3065":168,"3067":74.5,"3068":122.4,"3070":-69.2,"3071":81.9,"3072":100.5,"3073":61.8,"3074":86.4,"3075":176.6,"3076":102.8,"3078":24.2,"3083":174.8,"3084":171.2,"3085":40.1,"3087":-1.7,"3089":84,"3091":78.6,"3094":41.7,"3095":-15.9,"3097":-1.7,"3100":31.1,"3102":89,"3107":22.2,"3109":45.2,"3110":78.9,"3111":39.9,"3112":-73.8,"3115":35.7,"3116":61.6,"3118":-4,"3119":-164.3,"3121":80.8,"3123":26.8,"3124":24.2,"3135":114.2,"3137":94.2,"3139":154.5,"3142":35.1,"3143":35.6,"3146":38.6,"3152":13.2,"3153":36,"3156":104.6,"3157":89.1,"3158":-10.2,"3161":77.7,"3165":159.1,"3177":8.3,"3179":26.9,"3181":134.2,"3190":0.7,"3222":14.2,"3302":77.8,"3330":34,"3400":-132.6,"3504":-4.4,"3508":2.5,"3742":122.8,"3748":102.3,"3803":-123.1,"3814":63.2,"3916":3.6,"4003":-39.3,"4004":47.5,"4005":-12.5,"4401":95.9,"4628":-16.8,"4629":107,"4633":113.5,"4645":34.3,"4646":16,"6333":78,"6609":198.1,"6610":34,"6616":-0.6,"6617":-45.5,"6620":-6.8,"6621":44.5,"6631":47.1,"6653":30,"6655":-29.8,"6657":72,"6662":91.4,"6664":198.5,"6665":126.9,"6672":-4.8,"6673":39.3,"6675":32.6,"6676":-9.1,"6692":24,"6694":44.5,"6695":79.2,"6696":-15.9,"6698":-12,"6699":-29.5,"6701":-8.7,"8010":109.3,"8020":113.1,"126697":-33.7}}]},"taken":{"gm":1617.28,"layers":[{"nm":"ch","tab":{"0":-21.8,"1":-361.9,"2":475,"3":436.8,"4":-347.1,"5":742.3,"6":631.7,"7":-306.7,"8":370.4,"9":102.7,"10":-179,"11":79.2,"12":704.1,"13":17.4,"14":2179.3,"15":-273.5,"16":-525,"17":-341,"18":-260.3,"19":908.1,"20":473.6,"21":-335,"22":-370.9,"23":772.4,"24":414.5,"25":-301.8,"26":-544.3,"27":548,"28":-211.6,"29":-254.7,"30":282.5,"31":817.3,"32":361.9,"33":326.6,"34":70.2,"35":-449.8,"36":1481.5,"37":-354.2,"38":154.6,"39":587.1,"40":-585.3,"41":-135.2,"42":-132.5,"43":-530.8,"44":418.9,"45":-307.5,"48":847.8,"50":904.3,"51":-389.1,"53":250.6,"54":165.4,"55":212.1,"56":136,"57":835.3,"58":912.2,"59":400.7,"60":-208.3,"61":-498.8,"62":355.1,"63":-273.2,"64":224.1,"67":-227.8,"68":-74.2,"69":20.1,"72":531.9,"74":-444.7,"75":521.8,"76":-245.4,"77":255.6,"78":576.9,"79":374.9,"80":216.6,"81":-270.1,"82":506,"83":552.6,"84":139.8,"85":-227.5,"86":436.6,"89":465.7,"90":-457.7,"91":59.3,"92":95.4,"96":-308.5,"98":691.7,"99":-667.9,"101":-631.1,"102":288.8,"103":-260.4,"104":-107.8,"105":108.3,"106":954.5,"107":423.8,"110":-430,"111":407.5,"112":-423.5,"113":718.2,"114":375.1,"115":-540.9,"117":-661.9,"119":-184.1,"120":693.8,"121":-186.7,"122":569.1,"126":-356.9,"127":-71,"131":142,"133":-247,"134":-539.5,"136":-167.7,"141":357.4,"142":-455.9,"143":-531.7,"145":-384.8,"147":-467.6,"150":237.4,"154":1030,"157":-4.1,"161":-544.7,"163":-374.6,"164":394.2,"166":-290,"200":446.3,"201":437.6,"202":-444.6,"203":-158.4,"221":-190.3,"222":-318.8,"223":1282.5,"233":1003.2,"234":243.6,"235":-316.1,"236":-266.2,"238":-281.3,"240":992.9,"245":209,"246":-198,"254":294.1,"266":718.6,"267":-608.5,"268":-259.7,"350":-963.4,"360":33,"412":387.6,"420":732.8,"421":807.7,"427":-636.4,"429":-183.6,"432":-74,"497":98.3,"498":-261.9,"516":835,"517":627.1,"518":-326,"523":-249,"526":233.9,"555":-139.8,"711":-411.4,"777":-25.4,"799":249.5,"800":-493.8,"804":-226.9,"805":138.7,"875":775.6,"876":65.7,"887":388,"888":-414.5,"893":-263.1,"895":9.8,"897":579.9,"901":-301.9,"902":-652.9,"904":934.5,"910":-520.5,"950":-140.8}},{"nm":"item","tab":{"2065":18.4,"2139":70.7,"2152":-321.1,"2501":357.9,"2502":330.5,"2503":-23.4,"2504":82.3,"2510":81.1,"2512":1.8,"2517":197.2,"2522":50.7,"2523":34.3,"2524":-30.8,"2525":190.3,"2526":34.7,"2530":13.1,"3002":51.2,"3004":-222.7,"3006":-5.1,"3008":81.7,"3009":3.6,"3020":-28,"3031":45.1,"3032":-7.3,"3033":83.1,"3036":70.2,"3040":27.8,"3042":3.4,"3046":56.7,"3047":46.1,"3050":-67.7,"3053":206.3,"3065":326.3,"3068":152.1,"3071":164.6,"3072":148.4,"3073":125,"3074":65.8,"3075":288.7,"3076":122.6,"3078":13.2,"3083":481.7,"3084":460.2,"3085":64.8,"3087":1.1,"3089":48.3,"3091":99.1,"3094":48.8,"3095":102.5,"3097":25,"3100":-63.1,"3102":83.5,"3107":56.4,"3109":56,"3110":76.7,"3111":63.8,"3115":15.4,"3116":72.9,"3118":-56.8,"3119":-217.9,"3121":194.7,"3123":5.4,"3124":65.4,"3135":75.9,"3137":87.3,"3139":190.8,"3142":30.7,"3143":12.9,"3146":-79.4,"3152":5.3,"3153":68.6,"3156":153.3,"3157":79.5,"3158":-9.3,"3161":145.9,"3165":145.8,"3177":-40.8,"3179":18.9,"3181":196.5,"3190":-14.4,"3222":52.1,"3302":138.9,"3330":9.4,"3400":-141.7,"3504":26.3,"3508":-16.1,"3742":136.2,"3748":186.5,"3803":-92.6,"3814":60.2,"3916":-18,"4003":-258.1,"4004":-45,"4005":-89.4,"4401":102.8,"4628":-8.8,"4629":102.7,"4633":144.1,"4645":-6.2,"4646":-62.4,"6333":127.6,"6609":234.2,"6610":95.2,"6616":35.5,"6617":7.1,"6620":52.6,"6621":80.1,"6631":9.1,"6653":30.4,"6655":-54.7,"6657":134,"6662":146.7,"6664":303.4,"6665":183.8,"6672":15.9,"6673":48.1,"6675":38.9,"6676":-33.4,"6692":-34.4,"6694":53.4,"6695":11.2,"6696":-32,"6698":-72.4,"6699":-36.4,"6701":-32.5,"8010":159,"8020":192.9,"126697":-44.6}},{"nm":"mate","tab":{"0":-45.6,"1":-50.5,"2":-58.5,"3":-50.3,"4":-60.9,"5":-73.3,"6":-5.4,"7":-24.7,"8":-35.1,"9":-49.5,"10":-21.4,"11":-91.2,"12":-18,"13":-44.7,"14":20.9,"15":-34.9,"16":98.2,"17":-2.3,"18":-48.9,"19":-62,"20":-23.7,"21":-27.1,"22":-43.7,"23":-55,"24":-57.3,"25":-45.4,"26":22.4,"27":1.1,"28":-50.3,"29":-26.8,"30":1.8,"31":-23.7,"32":-47.8,"33":-17.7,"34":-28.3,"36":-22.3,"37":-38.1,"38":-37.3,"39":-93.1,"40":-45.7,"41":-36.6,"42":-65.8,"43":-75,"44":-49.4,"45":-24.8,"48":-29.3,"50":-30.7,"51":-60.5,"53":-45.2,"54":-20.7,"55":-77.9,"56":-50.7,"57":-39.6,"58":-70.6,"59":-58.2,"60":-83.5,"61":-65.5,"62":-73.1,"63":-35,"64":-71.3,"67":-60.4,"68":-38.3,"69":-43.4,"72":-53.4,"74":-39.7,"75":-10.7,"76":-31.3,"77":-18.7,"78":-37.9,"79":-58.3,"80":-63.4,"81":-48.2,"82":-23.1,"83":-67.2,"84":-46.2,"85":-77.3,"86":-31,"89":-49.4,"90":-54,"91":-37.2,"92":-98.5,"96":-18.5,"98":-32.3,"99":-56,"101":-37.5,"102":-45.1,"103":-61.9,"104":-46.6,"105":-23.9,"106":-7.9,"107":-75.9,"110":-65.5,"111":-60.8,"112":-42.4,"113":-30,"114":-47.1,"115":-26.7,"117":-38.1,"119":-64.8,"120":-122.2,"121":-62.3,"122":-74.5,"126":-65,"127":-61.1,"131":-69.9,"133":-57.3,"134":-57.6,"136":-17.9,"141":-38.2,"142":-56.8,"143":-54.8,"145":-49.3,"147":-68.1,"150":-60.4,"154":-33.5,"157":-47.2,"161":-50.3,"163":-55.6,"164":-66.1,"166":-24.3,"200":-76.2,"201":-57.6,"202":-19.4,"203":-65.6,"221":-52.2,"222":-73.6,"223":-52.1,"233":-78.8,"234":-88,"235":1.3,"236":-58.7,"238":-53.5,"240":-66,"245":-29,"246":-89.2,"254":-50.8,"266":-85.1,"267":15.5,"268":-36,"350":-24.3,"360":-106.4,"412":-71.9,"420":-17,"421":-90.9,"427":-78.1,"429":-91.6,"432":-5.2,"497":-69.8,"498":-51.1,"516":-18.2,"517":-54.1,"518":-58.3,"523":-55.1,"526":-83.3,"555":-19.5,"711":-75.6,"777":-50.9,"799":-68.1,"800":-37.4,"804":-54.2,"805":-59.9,"875":-33,"876":-23.9,"887":-74.4,"888":134.5,"893":-47.5,"895":-37.7,"897":-46.9,"901":-3.1,"902":-17.2,"904":-64.8,"910":-75.6,"950":-84.6}},{"nm":"foe","tab":{"1":7.8,"2":7.5,"3":-3,"4":-23.2,"5":5.7,"6":-6.2,"7":29.5,"8":15.3,"9":11,"10":-57.7,"11":-16.9,"12":-35.2,"13":-8.3,"14":68.7,"15":3.2,"16":-42.9,"17":-10.9,"18":-39.4,"19":-20.6,"20":15.9,"21":3.8,"22":-16.8,"23":23.3,"24":-14.5,"25":2,"26":-34.9,"27":52.2,"28":19.9,"29":11.8,"30":130.6,"31":26.1,"32":2.1,"33":11,"34":-6.7,"35":32.1,"36":9.5,"37":-48.3,"38":10,"39":-4.4,"40":-64.4,"41":23.4,"42":37,"43":-25.7,"44":-30.8,"45":-20,"48":-39.8,"50":17.7,"51":-15.2,"53":30.6,"55":-3.4,"56":27.6,"57":-4.7,"58":-7.7,"59":11,"60":-23.1,"61":-18.6,"62":-11.3,"63":24.4,"64":-3.8,"67":-52,"68":24.4,"69":-19.2,"72":16.7,"74":-3.7,"75":-31.2,"76":11.7,"77":44.2,"78":6.1,"79":12.5,"80":43.8,"81":20.3,"82":11.6,"83":-52.4,"84":-13.4,"85":-5.8,"86":9.1,"89":-11,"90":-23.4,"91":49,"92":-18.2,"96":46,"98":-2.9,"99":-1.5,"101":29.4,"102":-22.6,"103":-8.4,"104":7.1,"105":20.4,"106":0.8,"107":22.2,"110":1.3,"111":-3.3,"112":10,"113":-0.8,"114":-17.8,"115":4.1,"117":-64.3,"119":-7.8,"120":-6.9,"121":17.1,"122":-19.9,"126":23.7,"127":15.6,"131":5.7,"133":-12.4,"134":1.1,"136":-4,"141":7.7,"142":17.9,"143":-4.2,"145":-16.6,"147":-24.2,"150":-10.3,"154":-6.3,"157":-14.8,"161":14.7,"163":24.6,"164":8.4,"166":-9.1,"200":-18.9,"201":-25.2,"202":25,"203":-26.6,"221":-11.1,"222":-42.3,"223":2.6,"233":30,"234":-27.3,"235":-9.7,"236":-1.1,"238":33.5,"240":3.7,"245":17.4,"246":29.9,"254":16.4,"266":-6.6,"267":-51.2,"268":-16.7,"350":-44.4,"360":-13.8,"412":-8.3,"420":20.9,"427":-51.4,"429":-20.6,"432":-17.3,"497":-32.8,"498":-7.8,"516":7.2,"517":4.6,"518":4.9,"523":-31.9,"526":-41.7,"555":34.2,"711":-1.5,"777":-9.1,"799":-2.3,"800":-1,"804":-22.8,"805":-40.1,"875":17,"876":-6.6,"887":-26.5,"888":-46.2,"893":40.9,"895":-32.5,"897":-5.9,"901":4.9,"902":-83.5,"904":4.7,"910":4.6,"950":-6.4}},{"nm":"foeItem","tab":{"1001":23.3,"1011":68.4,"1018":-10.6,"1028":-9,"1029":-99.8,"1033":105.4,"1036":1.3,"1037":40.4,"1052":-7.2,"1057":62.4,"1058":125.6,"2031":-52.8,"2051":18.6,"2065":49.6,"2138":64.2,"2139":75.5,"2140":43.1,"2152":-229.6,"2501":120.5,"2502":71.8,"2503":9.1,"2504":78.8,"2510":34.4,"2512":26.5,"2517":134.7,"2520":100.5,"2522":82.2,"2523":18,"2524":48.6,"2525":61.9,"2526":-75.4,"2530":-16.2,"3002":108.3,"3004":-238.5,"3006":-10.8,"3008":19.1,"3009":26.2,"3020":15,"3031":68.4,"3032":-11,"3033":84.9,"3036":105.2,"3040":39.4,"3042":47,"3046":52.7,"3047":12.6,"3050":8.2,"3053":105.7,"3065":98.7,"3067":188.1,"3068":49.5,"3070":-104.5,"3071":65.9,"3072":130.6,"3073":37.1,"3074":65.7,"3075":105.3,"3076":2.8,"3078":10.3,"3083":96.8,"3084":17.1,"3085":32.7,"3087":-9.9,"3089":137.7,"3091":80.2,"3094":66.7,"3095":8.8,"3097":21.2,"3100":51.4,"3102":155,"3107":44.2,"3109":68.3,"3110":77.3,"3111":17.4,"3112":25.9,"3115":17.9,"3116":60.8,"3118":13.9,"3119":-238.6,"3121":45.4,"3123":-15.1,"3124":18.9,"3135":149.1,"3137":137.2,"3139":188.9,"3142":122.4,"3143":43.5,"3146":9.4,"3152":27.5,"3153":23.1,"3156":148.6,"3157":108.1,"3158":6.2,"3161":76.1,"3165":174.9,"3177":24.3,"3179":127.4,"3181":67.9,"3190":39.2,"3222":31.3,"3302":88.9,"3330":16.3,"3400":-13.1,"3504":24.1,"3508":13.5,"3742":96.2,"3748":43.7,"3803":-201.1,"3814":141.4,"3916":7,"4003":21,"4004":160.2,"4005":8.3,"4401":105.7,"4628":61,"4629":89.2,"4633":47.9,"4645":68.4,"4646":57.6,"6333":89.5,"6609":205,"6610":15.7,"6616":69.8,"6617":-31.2,"6620":11.9,"6621":89.3,"6631":23.2,"6653":38.4,"6655":7.6,"6657":-4.6,"6662":34,"6664":87.6,"6665":115.5,"6672":-4.7,"6673":66.7,"6675":29.1,"6676":9.7,"6692":35.8,"6694":122.6,"6695":83.2,"6696":54.2,"6698":82.6,"6699":66.7,"6701":108,"8010":128.7,"8020":131.4,"126697":19.8}}]},"mit":{"gm":1349.79,"layers":[{"nm":"ch","tab":{"0":-1349.8,"1":-696.2,"2":951.9,"3":2250.1,"4":-759.7,"5":553.1,"6":1059.4,"7":-586.4,"8":-421,"9":-418.2,"10":-726.2,"11":61.4,"12":2184.4,"13":-206.9,"14":3003.2,"15":-722.1,"16":-743.2,"17":-812.4,"18":-616.8,"19":1397.6,"20":1222.1,"21":-762.9,"22":-732.3,"23":1415,"24":612.8,"25":-685.8,"26":-685.7,"27":694,"28":-277.7,"29":-642,"30":-482.4,"31":1125.6,"32":838.1,"33":2596.8,"34":-468.3,"35":-677.8,"36":1381.5,"37":-536.5,"38":249,"39":868.6,"40":-756.8,"41":-428.7,"42":-389.5,"43":-524.2,"44":1345.7,"45":-704.6,"48":992.6,"50":125.3,"51":-747,"53":983.7,"54":1183.5,"55":-87.5,"56":21.1,"57":1261.5,"58":888.8,"59":1028,"60":-352.7,"61":-708.5,"62":524.4,"63":-767,"64":788.7,"67":-507.1,"68":-11.9,"69":-495,"72":1953.9,"74":-875,"75":995.4,"76":-566.5,"77":862.5,"78":2064.2,"79":912.8,"80":265,"81":-712,"82":1033.8,"83":555,"84":-120.9,"85":-546.1,"86":1549.5,"89":1627.8,"90":-665.6,"91":-59.5,"92":946.8,"96":-682.7,"98":1915.9,"99":-693.1,"101":-916,"102":726.8,"103":-740,"104":-303.9,"105":-62.7,"106":1937.2,"107":316.3,"110":-776.6,"111":2114.3,"112":-449.2,"113":1620.6,"114":841.6,"115":-931.5,"117":-775.6,"119":-476.4,"120":1048.9,"121":-254.1,"122":742,"126":-494.1,"127":-616.3,"131":551.6,"133":-473.9,"134":-861.2,"136":-674.7,"141":233.9,"142":-737.8,"143":-856.3,"145":-485.5,"147":-792.4,"150":304.2,"154":1527.1,"157":474.1,"161":-870.4,"163":-794.9,"164":798.7,"166":-401.5,"200":797.7,"201":1177.6,"202":-819.8,"203":-380.1,"221":-594.2,"222":-777.6,"223":2181,"233":1315.2,"234":67.6,"235":-711.9,"236":-592.8,"238":-349.6,"240":974.3,"245":101.6,"246":-283.1,"254":824.1,"266":681.6,"267":-847.5,"268":-402.2,"350":-997.4,"360":-439.4,"412":1168.2,"420":775,"421":1043.4,"427":-711.3,"429":-287.4,"432":-110.7,"497":1140.1,"498":-704.1,"516":1632.6,"517":320.8,"518":-721.8,"523":-655.3,"526":1689.9,"555":-12.8,"711":-491.4,"777":394.3,"799":818,"800":-722.5,"804":-685.5,"805":-243.1,"875":931,"876":-399.7,"887":190.4,"888":-498,"893":-723.8,"895":-111.6,"897":2069.1,"901":-754.4,"902":-816.7,"904":844.5,"910":-747.9,"950":-130.9}},{"nm":"item","tab":{"2065":38.7,"2139":19.9,"2152":-449.9,"2501":343.2,"2502":698.6,"2503":-25.2,"2504":791.3,"2510":33.5,"2512":-3.8,"2517":324.3,"2522":62.6,"2523":24.2,"2524":142.5,"2525":403.8,"2526":10.4,"2530":11.7,"3002":336.6,"3004":-252.9,"3006":-23.1,"3008":36.4,"3009":-32,"3020":-62.6,"3031":44.6,"3032":-9.1,"3033":89.1,"3036":63.5,"3040":70.4,"3042":6.7,"3046":30.5,"3047":169.2,"3050":60,"3053":461,"3065":792.7,"3068":499.6,"3071":203.3,"3072":203.7,"3073":100.6,"3074":141.6,"3075":915.7,"3076":238.1,"3083":637.2,"3084":324.1,"3085":46.1,"3087":-10,"3089":30.4,"3091":294.4,"3094":23,"3095":46.9,"3097":10.8,"3100":-112.8,"3102":126.8,"3107":63.7,"3109":371.6,"3110":621.8,"3111":145.3,"3115":4.2,"3116":48.1,"3118":-114.7,"3119":-917,"3121":453.7,"3123":3.2,"3124":67,"3135":67.8,"3137":65.9,"3139":339.6,"3142":-8.2,"3143":492.8,"3146":-99.4,"3152":-62.8,"3153":70,"3156":493,"3157":126.7,"3158":-37.4,"3161":177.1,"3165":131.6,"3177":-1465.7,"3179":-62.2,"3181":35.7,"3190":189.3,"3222":51.2,"3302":217,"3330":7.4,"3400":-188,"3504":19.8,"3508":-13.7,"3742":437.9,"3748":23.2,"3803":-206.1,"3814":26,"3916":-25.2,"4003":-454.2,"4004":-168.3,"4005":-111.9,"4401":653.4,"4628":-21.4,"4629":51.4,"4633":122.6,"4645":-44.9,"4646":-154.3,"6333":498.4,"6609":389.5,"6610":88.5,"6616":40.9,"6617":3.8,"6620":45.2,"6621":75.2,"6631":-23.2,"6653":-3.4,"6655":-75.9,"6657":92.1,"6662":383.7,"6664":560.4,"6665":824.7,"6672":10.5,"6673":100.1,"6675":32.4,"6676":-49,"6692":117,"6694":58.6,"6695":15.1,"6696":-74.2,"6698":-145.1,"6699":-83.4,"6701":-117,"8010":128,"8020":632.2,"126697":-93.9}},{"nm":"mate","tab":{"0":-67.3,"1":-68.9,"2":-95.1,"3":-89.8,"4":-115.9,"5":-126.9,"6":-68.2,"7":-57.1,"8":-97.9,"9":-81.1,"10":-97.3,"11":-140.9,"12":-81.5,"13":-112.4,"14":-30.1,"15":-95.7,"16":36.6,"17":-29.6,"18":-116.5,"19":-113.8,"20":-87.1,"21":-73.6,"22":-94.7,"23":-125.5,"24":-110.4,"25":-51.3,"26":-19.5,"27":-40.4,"28":-117.7,"29":-83.4,"30":-20.8,"31":-65.6,"32":-82.7,"33":-65.7,"34":-64.8,"35":-5.3,"36":-67.7,"37":-29.1,"38":-105.4,"39":-162.1,"40":-10,"41":-67.6,"42":-117.4,"43":-47.6,"44":-84.3,"45":-68.7,"48":-94.9,"50":-77.3,"51":-106.5,"53":-72.6,"54":-61.1,"55":-137,"56":-104.4,"57":-77.2,"58":-114.4,"59":-108.4,"60":-153.6,"61":-76,"62":-119.3,"63":-66,"64":-104.5,"67":-118.2,"68":-84.7,"69":-94.5,"72":-103.1,"74":-60.3,"75":-80.9,"76":-87,"77":-67.1,"78":-76.6,"79":-100.3,"80":-106.4,"81":-102.4,"82":-63.1,"83":-119.2,"84":-84.8,"85":-135.6,"86":-70,"89":-95.8,"90":-95.9,"91":-62.3,"92":-163.5,"96":-38.8,"98":-56.2,"99":-41.3,"101":-70.4,"102":-117.8,"103":-110.7,"104":-95.1,"105":-70.9,"106":-59.6,"107":-137.6,"110":-105.7,"111":-109.7,"112":-84.6,"113":-80.6,"114":-109.9,"115":-62.1,"117":-12.2,"119":-119.1,"120":-204.2,"121":-98.9,"122":-106.2,"126":-118.3,"127":-123.1,"131":-139.7,"133":-113.3,"134":-101.8,"136":-62.8,"141":-91.5,"142":-106.1,"143":-86.5,"145":-109.9,"147":-91,"150":-110.6,"154":-92.4,"157":-97.1,"161":-93.8,"163":-101.9,"164":-125.7,"166":-86.2,"200":-137.8,"201":-68.1,"202":-55.7,"203":-132.6,"221":-116.5,"222":-143.3,"223":-92.7,"233":-132.3,"234":-144.3,"235":-32.5,"236":-108.3,"238":-79.3,"240":-156.2,"245":-87.9,"246":-139.9,"254":-98.6,"266":-133.6,"267":-39.1,"268":-78.6,"350":-26.9,"360":-178.4,"412":-78.6,"420":-60.5,"421":-154.2,"427":-38.4,"429":-171.3,"432":-59.6,"497":-85.8,"498":-94.6,"516":-55.8,"517":-112.6,"518":-107,"523":-116.6,"526":-140,"555":-50.4,"711":-135.7,"777":-93.4,"799":-129.1,"800":-81,"804":-119,"805":-121.7,"875":-74.2,"876":-78.7,"887":-169.4,"888":-14.5,"893":-97.3,"895":-86,"897":-80.6,"901":-42.8,"902":-3.6,"904":-123.1,"910":-97.2,"950":-149.3}},{"nm":"foe","tab":{"1":-26.5,"2":-33,"3":-4.6,"4":-9.6,"5":33.9,"6":44.1,"7":-12.6,"8":-10.8,"9":4.5,"10":-36.7,"11":-72.2,"12":-45.9,"13":9,"14":100.2,"15":52.8,"16":-28.3,"17":35.3,"18":-7.3,"20":-8.2,"21":3.6,"22":29.6,"23":49.6,"24":5.6,"25":18.6,"26":26.6,"27":65.2,"28":-58.2,"29":8.6,"30":136.3,"31":-0.6,"32":-20.7,"33":28.7,"34":14.4,"35":71,"36":39.4,"37":-31.7,"38":16,"39":28.6,"40":-38.4,"41":-8.2,"42":-35.7,"43":-40.1,"44":-72.8,"45":-7.7,"48":-51.5,"50":24.2,"51":24.5,"53":8.7,"54":7.7,"55":-4.9,"56":-2.2,"57":8.5,"58":15.4,"59":3.1,"60":-58.2,"61":-31.3,"62":-20.9,"63":50.1,"64":19,"67":-80.7,"68":-12.6,"69":7.7,"72":15.7,"74":60.2,"75":-46,"76":-8.2,"77":45.7,"78":52.8,"80":13,"81":58.3,"82":21.4,"83":-44.3,"84":-19.9,"85":-35,"86":-3.6,"89":-17.6,"90":5.2,"91":21.9,"92":-9.5,"96":35.5,"98":28.5,"99":8.5,"101":35.8,"102":-7.5,"103":-83.7,"104":-6.3,"105":12.9,"106":50.7,"107":-35,"111":-13,"112":20,"113":15.4,"114":-65.5,"115":39.7,"117":-52.9,"119":-20.8,"120":5.8,"121":-26.5,"122":-74.9,"126":-11.2,"127":-3.1,"131":-13.9,"133":-5.7,"134":-20.3,"136":24,"141":10.2,"142":-46,"143":43.4,"145":32.7,"147":-5.7,"150":29.5,"154":-20.9,"157":51.9,"161":-22.9,"163":10.5,"164":-45.2,"166":10.6,"200":-46.8,"201":-23,"202":34.7,"203":-7.1,"221":27.8,"222":-9.1,"223":-4.4,"233":7.9,"234":-22.1,"235":20.6,"236":19.7,"238":3.2,"240":3.4,"246":-61.5,"254":7.6,"266":22.4,"267":-36.1,"268":6,"350":-54.5,"360":-39.9,"412":-4.1,"420":93.2,"421":-43.1,"427":-43,"429":6.4,"497":-48.6,"498":53.6,"516":29,"517":-7.5,"518":-11.5,"523":-48.1,"526":-118,"555":-37.2,"711":-19.5,"777":39,"799":-35.8,"800":7.3,"804":3.1,"805":-70.8,"875":9.8,"876":-21.3,"887":-60.4,"888":-29.1,"893":-8.6,"895":-72.2,"897":17.6,"901":62.4,"902":-47.7,"910":19.2,"950":-52.6}},{"nm":"foeItem","tab":{"1001":-1064.3,"1011":-1027.9,"1018":-947.4,"1028":-1002.9,"1029":-1252.5,"1033":-1259.5,"1036":-1073.1,"1037":-993.9,"1052":-1120.6,"1057":-1067,"1058":-1204.7,"2031":-1120.4,"2051":-942,"2065":133,"2138":98.8,"2139":91.2,"2140":6.1,"2152":-377.2,"2501":203.1,"2502":133.9,"2503":15.7,"2504":156.5,"2510":65.8,"2512":66.2,"2517":234.5,"2520":-6.4,"2522":150.4,"2523":57.5,"2524":91.8,"2525":109.4,"2526":-79.8,"2530":11,"3002":165.5,"3004":-331.7,"3006":10,"3008":30.7,"3009":33.6,"3020":14.7,"3031":134.1,"3032":34.5,"3033":163.7,"3036":177.9,"3040":89.5,"3042":66.4,"3046":123.4,"3047":11.7,"3050":-1.1,"3053":213.7,"3065":192.6,"3067":-1100.6,"3068":96.7,"3070":-1014.9,"3071":108.6,"3072":278.7,"3073":73.9,"3074":106.1,"3075":206.5,"3076":5.5,"3078":24.4,"3083":191.7,"3084":38.4,"3085":94.4,"3087":22.7,"3089":229,"3091":186.7,"3094":147.3,"3095":94.5,"3097":67.7,"3100":75.4,"3102":277.1,"3107":124.9,"3109":144.5,"3110":143,"3111":36.7,"3112":-1003,"3115":56.5,"3116":114.8,"3118":10.6,"3119":-304.8,"3121":76.8,"3123":-26.3,"3124":62.6,"3135":245.7,"3137":241.8,"3139":388.8,"3142":148,"3143":75.7,"3146":19.9,"3152":30.8,"3153":67.6,"3156":265,"3157":195.4,"3158":15.8,"3161":143.1,"3165":354.9,"3177":-1125.9,"3179":99,"3181":103.7,"3190":89,"3222":98.9,"3302":191,"3330":6.1,"3400":-137.9,"3504":105,"3508":38.8,"3742":168.7,"3748":72.2,"3803":-280.6,"3814":188.7,"4003":-52.1,"4004":181.2,"4005":32.1,"4401":187,"4628":101.8,"4629":160.5,"4633":75.7,"4645":93.3,"4646":61,"6333":164.9,"6609":375.5,"6610":25.1,"6616":149.7,"6617":-11.3,"6620":47.1,"6621":199,"6631":34,"6653":58.1,"6655":1.2,"6657":15.8,"6662":94.9,"6664":176.2,"6665":227.9,"6672":28.7,"6673":146.5,"6675":89.9,"6676":3.5,"6692":69.6,"6694":154.3,"6695":133.9,"6696":21.8,"6698":39.9,"6699":40.5,"6701":76.8,"8010":226.1,"8020":231.1,"126697":-18.5}}]},"heal":{"gm":289.82,"layers":[{"nm":"ch","tab":{"0":-289.8,"1":-240.1,"2":133.5,"3":-129.2,"4":-182,"5":389.9,"6":-107.4,"7":-190.2,"8":736,"9":41,"10":168.8,"11":-62.9,"12":426,"13":-80.9,"14":34,"15":-36.2,"16":1343.6,"17":-215.6,"18":-73.6,"19":584.2,"20":356.5,"21":-120.5,"22":-114.1,"23":380.8,"24":3.2,"25":-88.5,"26":97,"27":-93.5,"28":5.8,"29":-107.8,"30":-248.3,"31":-51.8,"32":-180.4,"33":-103.4,"34":-73.8,"35":-209.5,"36":472.7,"37":578.9,"38":-101.3,"39":298.8,"40":352.2,"41":27,"42":-81.2,"43":-98.9,"44":478.7,"45":-161.6,"48":559.6,"50":452.9,"51":-86.4,"53":-142.7,"54":-158.1,"55":-22.5,"56":-81.7,"57":317,"58":400.5,"59":13.9,"60":-127.6,"61":-216,"62":63.3,"63":-233.8,"64":122.7,"67":-38.8,"68":-197.2,"69":-1.2,"72":-76.5,"74":-217.2,"75":127.6,"76":270.8,"77":-70.6,"78":-17.9,"79":235.9,"80":18.7,"81":-54.5,"82":125.7,"83":310.5,"84":-118.5,"85":-230.8,"86":-81,"89":-100.8,"90":-232.6,"91":-100.5,"92":17.8,"96":-135.3,"98":-33.9,"99":-224.2,"101":-228.7,"102":-20.3,"103":-27.9,"104":-84.5,"105":-180.2,"106":114.4,"107":210,"110":-144.7,"111":-134.7,"112":-184.7,"113":-74.6,"114":349.5,"115":-223.8,"117":-30.4,"119":-9,"120":446,"121":-34.3,"122":141.2,"126":-183.6,"127":-110.2,"131":-158.6,"133":-56.9,"134":-221.6,"136":-195.6,"141":203.2,"142":-184.2,"143":-225.2,"145":-109.4,"147":-43.8,"150":-54.5,"154":1152.8,"157":-31.1,"161":-210.4,"163":-219.6,"164":18,"166":-122,"200":227.2,"201":-42.8,"202":-117.9,"203":232.2,"221":-87.8,"222":-97.6,"223":596.7,"233":1072,"234":226.3,"235":407.8,"236":-99.6,"238":-179.1,"240":18.7,"245":31.7,"246":-204.3,"254":-45.6,"266":588.8,"267":558.6,"268":-209.5,"350":231.5,"360":24.5,"412":-131.3,"420":186.2,"421":565.9,"427":-6.7,"429":7.9,"432":413.8,"497":92.2,"498":-61.4,"516":-45.9,"517":233.6,"518":-234.2,"523":-5.5,"526":-155.3,"555":105.1,"711":-232.7,"777":-15.5,"799":77.9,"800":-216.6,"804":-89.7,"805":140.6,"875":-94.8,"876":55.3,"887":157.1,"888":-146.5,"893":-108.7,"895":121,"897":-27.5,"901":-119.9,"902":408.5,"904":451.5,"910":-210.5,"950":-40.8}},{"nm":"item","tab":{"2065":49.6,"2139":-3.5,"2152":-122.8,"2501":54.8,"2502":152.1,"2503":-12,"2510":28.5,"2512":-16.5,"2517":151.5,"2522":21,"2523":24.1,"2524":15.3,"2525":71.6,"2526":-80.3,"2530":103.4,"3002":28,"3004":-78,"3006":-12.2,"3008":102,"3009":-9.5,"3020":-14.9,"3031":20.3,"3032":-13.4,"3033":42.7,"3036":35.2,"3040":16.8,"3042":-3,"3046":32.1,"3047":17.6,"3050":-24.7,"3053":79.3,"3065":170.5,"3068":54.6,"3071":65,"3072":107.3,"3073":14.5,"3074":98.5,"3075":96.6,"3076":27.8,"3083":79,"3084":74.7,"3085":31.2,"3087":-16.4,"3089":21.3,"3091":49.9,"3094":16.5,"3095":66.3,"3097":12.3,"3100":-8.8,"3102":9.2,"3107":175.7,"3109":58.2,"3110":27.9,"3111":13.2,"3115":1.4,"3116":4.4,"3118":-25.6,"3119":-46.7,"3121":56.5,"3123":-10.7,"3124":34.1,"3135":13.6,"3137":36.7,"3139":113.6,"3142":-6.9,"3143":-9,"3146":37.7,"3152":-11.2,"3153":55,"3156":78.6,"3157":15.3,"3158":-1.9,"3161":52.2,"3165":34.9,"3177":-381.1,"3179":-52.1,"3181":-27.2,"3190":23.5,"3222":77,"3302":80.3,"3330":6.5,"3400":-7.3,"3504":84.8,"3508":-1.6,"3742":36.1,"3748":9.2,"3803":-45.6,"3814":-17.3,"3916":-13,"4003":-81.4,"4004":-63.3,"4005":-35.4,"4401":13.1,"4628":-12.3,"4629":54,"4633":61.6,"4645":-10.2,"4646":-26.4,"6333":99,"6609":87.5,"6610":62,"6616":183.6,"6617":66.4,"6620":249.6,"6621":285.6,"6631":-10.2,"6653":-4.3,"6655":-19.6,"6657":73.7,"6662":45.1,"6664":62.5,"6665":61.5,"6672":9.1,"6673":28.4,"6675":13.4,"6676":-25.4,"6692":-19.2,"6694":6.5,"6695":-4.7,"6696":-29.3,"6698":-54.5,"6699":-21,"6701":-48.3,"8010":26.9,"8020":48.9,"126697":-24.8}},{"nm":"mate","tab":{"0":-0.9,"1":-9.7,"2":-30.2,"3":-11.9,"4":-24.7,"5":-28.9,"6":-18,"7":-11.8,"8":-28.9,"9":-15.3,"10":-19.8,"11":-33,"12":-18.2,"13":-26.5,"14":-3.6,"15":-21.1,"16":-28,"17":-12.6,"18":-29.4,"19":-29.3,"20":-18.5,"21":-16.9,"22":-17.6,"23":-26.1,"24":-21.9,"25":-5.6,"26":1.8,"27":-1.5,"28":-25.3,"29":-17,"30":-7.4,"31":-10.7,"32":-8.3,"33":-10.8,"34":-10.3,"35":2.6,"36":-25.6,"37":-25.2,"38":-27,"39":-40.2,"40":-11.6,"41":-13,"42":-25.2,"43":-12.3,"44":-25.5,"45":-12.6,"48":-21.8,"50":-24.5,"51":-19.2,"53":-0.8,"54":-10.9,"55":-30.4,"56":-20.9,"57":-13.7,"58":-31.8,"59":-17.4,"60":-28,"61":-15.8,"62":-24.3,"63":-11.2,"64":-27.9,"67":-26.7,"68":-19,"69":-15.5,"72":-16.2,"74":-9.5,"75":-26.9,"76":-19.8,"77":-15.3,"78":-10.7,"79":-10.8,"80":-18.4,"81":-21.8,"82":-18.6,"83":-27.3,"84":-21.5,"85":-20.4,"86":-14.9,"89":-12.6,"90":-15.1,"91":-14.2,"92":-28.3,"96":-10.2,"98":-8.2,"99":-13,"101":-8.3,"102":-35.1,"103":-19.6,"104":-24.4,"105":-12.5,"106":-18,"107":-34.3,"110":-15.4,"111":-12.7,"112":-16.8,"113":-15.9,"114":-32.7,"115":-18.1,"117":-8.1,"119":-29.6,"120":-49.4,"121":-22.1,"122":-22.5,"126":-23.1,"127":-16.9,"131":-28.5,"133":-18.2,"134":-16,"136":-17.1,"141":-24.9,"142":-20.2,"143":-14,"145":-25.7,"147":-19.4,"150":-21.1,"154":-19.2,"157":-20.5,"161":-12.8,"163":-11.1,"164":-26.2,"166":-22.9,"200":-28.9,"201":-10.8,"202":-12,"203":-26.3,"221":-27,"222":-27.2,"223":-10.7,"233":-31.5,"234":-33.8,"235":-18.7,"236":-24.7,"238":-14.9,"240":-29.5,"245":-18.6,"246":-23.1,"254":-16.6,"266":-32.4,"267":-17.3,"268":-23.1,"350":-28.8,"360":-33.9,"412":-7.3,"420":-15.7,"421":-25.9,"427":-15.3,"429":-27.4,"432":-12.3,"497":-11.3,"498":-19.2,"516":-6.1,"517":-28.4,"518":-12,"523":-26.9,"526":-14.8,"711":-19.4,"777":-25.4,"799":-32,"800":-17.8,"804":-27.8,"805":-33.6,"875":-13.9,"876":-20.9,"887":-40.7,"888":-2.9,"893":-15.7,"895":-22.4,"897":-12.9,"901":-17.1,"902":-21.7,"904":-28.5,"910":-14,"950":-29.3}},{"nm":"foe","tab":{"1":-1.5,"2":9.2,"3":5.5,"4":-3.8,"5":6.6,"6":20.1,"7":3.9,"8":12.9,"9":4.5,"10":3.9,"11":-8,"13":2.2,"14":39.1,"15":6.1,"16":1.4,"17":13.9,"18":-4.6,"19":5.9,"20":9.4,"21":-1.8,"22":-6,"23":10.8,"24":2.6,"25":-7.2,"26":1.9,"27":2.9,"29":-1,"30":27.5,"31":10.4,"32":-1.8,"33":10.7,"34":-2,"35":15.1,"36":30.9,"37":-3.3,"38":13.6,"39":-1.1,"40":-2.6,"41":2.6,"42":1.1,"43":-4.3,"44":-8.3,"45":-4.1,"48":5.8,"50":12.7,"51":-3.4,"53":-7.1,"54":8.8,"55":-4.7,"56":9.2,"57":11.1,"58":8.2,"59":2.2,"60":-13.2,"61":-6.2,"62":11,"63":-1.9,"64":5.5,"67":-5.8,"68":1.8,"69":-3.4,"72":4.7,"74":6.3,"75":10.9,"76":1.8,"77":15.3,"78":13.9,"79":0.7,"80":-3.1,"81":5.1,"82":18.7,"83":10.7,"84":8,"85":-9.6,"86":13,"89":-3.1,"90":-5.6,"91":12.8,"92":-8.8,"96":12.1,"98":13.6,"99":-2,"101":-1.8,"102":13.7,"103":-10.5,"105":9.3,"106":28.2,"107":-4.5,"110":-11.8,"111":-3.7,"112":0.6,"113":9.8,"114":7.2,"115":7.9,"117":-11.9,"119":-3.2,"120":-5.7,"121":-3.7,"122":-5.1,"126":-5.2,"127":-11.2,"131":10,"133":-2.3,"134":-5.6,"136":2.9,"141":7,"142":-6.1,"143":-1.6,"147":-11.3,"150":-1,"154":3.6,"157":6.7,"161":-9,"163":-12.7,"164":-2.5,"166":5,"200":-6.9,"201":-1.7,"202":-3.7,"203":-3.7,"221":1.9,"222":-9.3,"223":15.2,"233":1.5,"234":-8.3,"235":1.4,"236":-5.4,"238":-0.6,"240":2,"245":7.7,"246":-14.8,"254":1.8,"266":0.7,"267":-11.8,"268":7.9,"350":-11.3,"360":-7.8,"412":-8.4,"420":19.9,"421":-6.5,"427":-10.2,"429":-9.9,"432":-2.2,"497":-6.6,"498":-1,"516":8.2,"517":10.8,"518":-7.8,"523":-1.2,"526":-15.2,"555":-13.7,"711":-10.1,"777":4.3,"799":3.8,"800":-1.1,"804":-2.2,"805":1.6,"875":11.4,"876":11.4,"887":5.4,"888":-3.2,"895":7.8,"897":10.6,"901":18.3,"902":-6.2,"904":4.3,"910":-11,"950":-1.5}},{"nm":"foeItem","tab":{"1001":-239.4,"1011":-221.6,"1018":-219.7,"1028":-177.9,"1029":-267.3,"1033":-274.6,"1036":-220.2,"1037":-200.2,"1052":-232.3,"1057":-205.7,"1058":-272.4,"2031":-249.9,"2051":-193.2,"2065":15.5,"2138":4.7,"2139":28,"2140":-7.5,"2152":-59.4,"2501":45.9,"2502":32.9,"2503":-4.3,"2504":30.6,"2510":15,"2512":8.2,"2517":36.6,"2520":7.9,"2522":22.8,"2523":1.5,"2524":10.5,"2525":19.1,"2526":-7.9,"2530":1.7,"3002":24,"3004":-54.4,"3020":4.5,"3031":17.8,"3032":1.5,"3033":24.4,"3036":29,"3040":14,"3042":9.6,"3046":13.2,"3050":-3,"3053":38.7,"3065":42.3,"3067":-233.5,"3068":27,"3070":-245.3,"3071":20.8,"3072":42.1,"3073":16.7,"3074":27.7,"3075":42.4,"3076":10.3,"3078":6.4,"3083":37.8,"3084":21,"3085":11.2,"3087":6.1,"3089":39.8,"3091":31.4,"3094":21.5,"3095":-5,"3097":4.6,"3100":15.7,"3102":47.4,"3107":24,"3109":18.9,"3110":21.6,"3111":10.5,"3112":-221.1,"3115":14.1,"3116":16.2,"3118":3.1,"3119":-50.3,"3121":16.8,"3123":-1.5,"3124":6.7,"3135":44.9,"3137":38.9,"3139":58.3,"3142":25,"3143":10.6,"3146":12.3,"3152":6.1,"3153":9.3,"3156":46.4,"3157":32.9,"3158":1.9,"3161":25.7,"3165":60.2,"3177":-231.2,"3179":22.7,"3181":18.7,"3190":11.2,"3222":16.7,"3302":26.4,"3330":4.5,"3400":-49.4,"3504":14.9,"3508":5.5,"3742":33.3,"3748":13.9,"3803":-35.7,"3814":34.4,"3916":-7.1,"4003":-16.9,"4004":37.8,"4005":1.4,"4401":35.3,"4628":14.8,"4629":31.3,"4633":22.5,"4645":19.1,"4646":17.2,"6333":26.5,"6609":79.3,"6610":4.5,"6616":19.8,"6617":-1.7,"6620":4.2,"6621":32.7,"6631":9.1,"6653":8.2,"6655":1.3,"6657":7.5,"6662":24.5,"6664":45,"6665":42.2,"6672":-1.7,"6673":20.1,"6675":10.7,"6692":15.7,"6694":27.9,"6695":22.6,"6696":4.7,"6698":7.8,"6699":7,"6701":12.2,"8010":34.8,"8020":39.1,"126697":-3}}]},"prot":{"gm":64.61,"layers":[{"nm":"ch","tab":{"0":-64.6,"1":111.3,"2":-64.5,"3":19.7,"4":-63.7,"5":-64.5,"6":-64.4,"7":-63.7,"8":-63.7,"9":-64.3,"10":56.7,"11":-64.6,"12":270,"13":-64.1,"14":-63.6,"15":-63.6,"16":1254,"17":-62.8,"18":-61.6,"19":-62.8,"20":-61.5,"21":-58.9,"22":-64,"23":-62.6,"24":-64.4,"25":87.6,"26":133.8,"27":-61.5,"28":-64.1,"29":-63.9,"30":-64.2,"31":-58,"32":-57.4,"33":-57.6,"34":-63.8,"35":-63.3,"36":-62.3,"37":978.8,"38":-64.3,"39":-64.5,"40":947.5,"41":-64.5,"42":-63.8,"43":549.7,"44":442.2,"45":-61.8,"48":-55.1,"50":-64.3,"51":-64,"53":-41.6,"54":-59.4,"55":-64.6,"56":-64.6,"57":-54.3,"58":-64.6,"59":-63.3,"60":-63.7,"61":108.6,"62":-64.6,"63":-63.8,"64":40.7,"67":-64.3,"68":-64.2,"69":-64,"72":-61.7,"74":-63,"75":-58,"76":83.4,"77":-63.9,"78":-61.7,"79":-59.4,"80":-64.5,"81":-60.9,"82":-64.4,"83":-58.4,"84":-64.5,"85":-64.3,"86":-64.4,"89":-54.1,"90":-63.9,"91":-64.6,"92":-64.6,"96":-63.9,"98":43.3,"99":225.2,"101":-63.2,"102":-64.2,"103":-63.5,"104":-64.5,"105":-63.3,"106":-63.4,"107":-64.3,"110":-63.7,"111":-59,"112":-63.1,"113":-54.7,"114":65.8,"115":-62.4,"117":758.6,"119":-64,"120":-64.6,"121":-64.6,"122":-63.8,"126":-64.3,"127":-63.6,"131":-64.5,"133":-61.2,"134":-62.4,"136":-63.1,"141":-64.6,"142":-54.6,"143":-62.9,"145":-63.9,"147":327.5,"150":-62.4,"154":-58.7,"157":-64.5,"161":-58.5,"163":-62.9,"164":-64.5,"166":-64.2,"200":-64,"201":36,"202":-63.9,"203":136.8,"221":-64.2,"222":-64,"223":-7.6,"233":-64.4,"234":-58.9,"235":310.6,"236":-62.2,"238":-64.6,"240":-64.5,"245":-64.2,"246":-64.6,"254":-64.5,"266":-64.5,"267":691.7,"268":-63.7,"350":928.2,"360":-64.6,"412":107.6,"420":-64.4,"421":-63.7,"427":941.8,"429":-64.3,"432":179.4,"497":290,"498":-64,"516":-52.5,"517":-57.3,"518":-63.7,"523":-64.4,"526":-56.1,"555":-64,"711":-63.9,"777":-64.6,"799":-64.6,"800":-62.5,"804":-64.4,"805":-64.4,"875":-64.2,"876":-63.6,"887":-64.5,"888":382.6,"893":-63.8,"895":26,"897":57.8,"901":-63.5,"902":934,"904":-64.5,"910":79.2,"950":-64.6}},{"nm":"item","tab":{"2065":90.5,"2139":-13,"2152":-29.7,"2502":4.2,"2503":-2.8,"2504":0.7,"2510":-0.6,"2517":1.2,"2523":-4.1,"2524":29.4,"2525":2.1,"2526":-146.1,"2530":162.8,"3002":13.4,"3004":1.3,"3006":-1.6,"3008":-0.8,"3009":-4.2,"3020":-7,"3031":-0.6,"3032":-0.9,"3040":4.6,"3050":-1.4,"3053":1.1,"3065":5.1,"3068":3.2,"3071":-1.2,"3072":0.6,"3073":0.5,"3074":3.5,"3075":6.1,"3076":0.8,"3083":17.5,"3084":-1.1,"3087":-20.2,"3089":1.4,"3091":-1.6,"3094":-8.2,"3097":-1.3,"3100":-5.4,"3102":2.3,"3107":239.2,"3109":51.7,"3110":2.3,"3111":0.8,"3115":-1.3,"3116":-3.7,"3118":-18.1,"3119":-6.5,"3121":6.9,"3123":1.2,"3124":-4,"3137":10.8,"3139":0.7,"3143":-4.4,"3146":-0.5,"3152":-2,"3153":-2,"3156":1.8,"3157":0.9,"3158":20.2,"3165":20.2,"3177":-3.8,"3181":-3.6,"3190":108.4,"3222":128.9,"3302":-3.2,"3400":-5.5,"3504":160.4,"3803":-89.5,"3916":-2.9,"4003":1.3,"4004":-0.9,"4005":-21.6,"4628":-10.4,"4645":-5.1,"4646":-7.7,"6333":1,"6609":10.4,"6616":301.1,"6617":132.5,"6620":301,"6621":439.2,"6653":-3.7,"6655":-12.6,"6657":-2.3,"6662":-3.2,"6664":5.5,"6665":3,"6672":-3.3,"6676":-1.2,"6692":-0.7,"6698":-1.1,"6701":-0.7,"8010":1.5,"8020":7.6}},{"nm":"mate","tab":{"0":1,"1":-5.6,"2":-5.7,"3":-2.5,"4":-5.5,"5":-3.2,"6":-0.9,"7":-3.4,"8":-4.2,"9":-5.2,"10":-7,"11":-9.2,"12":-2.5,"13":-5,"14":1.2,"15":-5,"16":-2.2,"17":-5.3,"18":-8,"19":-2.7,"20":-3.4,"21":-4.8,"22":-6.5,"23":-3.5,"24":-3.1,"25":-4.5,"26":-3.8,"27":-0.9,"28":-7.3,"29":-6.6,"30":-1.5,"32":-3.1,"33":-3.1,"34":-3.3,"35":-1.9,"36":-2.1,"37":-2.7,"38":-5.3,"39":-4.6,"40":-2.6,"41":-2.6,"42":-3.5,"43":-3.2,"44":-2,"45":-4,"48":-2.2,"50":-2.7,"51":-4.6,"53":-1.2,"54":-4.1,"55":-6.6,"56":-3.6,"57":-2.5,"58":-3.3,"59":-4.2,"60":-4.8,"61":-5.5,"62":-6.4,"63":-3.3,"64":-4.8,"67":-4.9,"68":-3.8,"69":-1.8,"72":-3.2,"74":-3.1,"75":-5.8,"76":-4.5,"77":-3.4,"79":-0.6,"80":-3,"81":-4,"82":-2.5,"83":-4.5,"84":-3.1,"85":-5.4,"86":-3,"89":-3.2,"90":-5.8,"91":-2.7,"92":-5.6,"96":-4.2,"98":-1.6,"99":-5,"101":-5.6,"102":-8.1,"103":-4.2,"104":-4,"105":-5.2,"106":-0.7,"107":-4.8,"110":-4.2,"111":-2,"112":-4.9,"113":-2.1,"114":-3.6,"115":-6.8,"117":-3.6,"119":-6.6,"120":-7.2,"121":-4.7,"122":-2.3,"126":-6.5,"127":-5.3,"131":-5.8,"133":-5.3,"134":-4.4,"136":-3.8,"141":-5.2,"142":-5.7,"143":-5,"145":-6.2,"147":-4.7,"150":-3.5,"154":-3.7,"157":-3.6,"161":-4.4,"163":-3.4,"164":-4.8,"166":-5,"200":-3.5,"201":-1.3,"202":-5.3,"203":-4.6,"221":-7.1,"222":-9.6,"233":-2.6,"234":-7.3,"235":-4.8,"236":-3.9,"238":-5,"240":-5.5,"245":-3,"246":-4.6,"254":-3.9,"266":-3.1,"267":-4.2,"268":-5.8,"350":-7.5,"360":-7.1,"412":-2,"421":-4.5,"427":-5.9,"429":-5,"432":-2.1,"497":-2.8,"498":-4.5,"516":-2.8,"517":-3.5,"518":-5.2,"523":-6.9,"526":-4.7,"555":-3.2,"711":-5.1,"777":-4.3,"799":-5.8,"800":-3.4,"804":-5.8,"805":-8,"875":-3.1,"876":-3.8,"887":-5.5,"888":-3.3,"893":-4,"895":-4,"897":-1.8,"901":-4.5,"902":-5.3,"904":-3.5,"910":-3.8,"950":-6.1}},{"nm":"foe","tab":{"2":-2.8,"3":1.2,"4":1.1,"6":4.3,"7":2.2,"8":0.9,"9":-0.7,"10":1.5,"11":-1.5,"12":-1.2,"13":-0.8,"14":2.5,"15":2.1,"16":-0.6,"17":7.7,"19":-0.6,"22":0.6,"23":1,"25":0.8,"26":2.9,"27":1.2,"28":-1.4,"29":-1.8,"30":10.2,"31":0.6,"32":-2.1,"33":2.9,"35":7.4,"36":3.2,"38":-1.2,"39":-1.7,"44":-1,"45":-2.5,"48":0.7,"50":1,"51":-0.7,"53":-2.1,"54":-0.5,"55":-2.4,"56":-1.1,"57":2.3,"59":-1.9,"60":-2.1,"63":2.6,"68":1.5,"69":1.6,"72":0.5,"74":4.7,"75":0.9,"76":2.2,"77":4.7,"78":2.6,"79":-0.7,"80":-1.7,"83":0.8,"85":-2.6,"86":2.9,"89":-2,"90":3.5,"91":2.3,"92":-1.8,"96":3,"99":-1,"101":1.4,"102":1.4,"103":-1.5,"104":-0.7,"105":1.3,"106":5.9,"107":-1.4,"110":-1.3,"111":-1.5,"112":1.2,"113":1.6,"114":1.9,"115":3.2,"117":-0.7,"119":-0.9,"120":-3,"122":-0.6,"126":-1.4,"127":-2.2,"136":2.3,"141":0.7,"143":5.2,"145":0.5,"147":-2.1,"154":-1.4,"157":-2,"164":-1.5,"166":0.6,"200":-1.5,"201":-0.6,"203":0.7,"221":0.7,"222":-1.6,"223":1.1,"234":-1.5,"238":0.9,"240":-2.7,"246":-3.3,"266":-1.3,"267":-1.1,"268":2,"350":-1.5,"360":-2.8,"412":-1.4,"420":4.1,"421":-1.3,"427":-1.8,"429":-1.1,"497":-2.5,"498":1.2,"518":-3.7,"526":-6.1,"555":-1.8,"711":-1.9,"799":-1.4,"800":1.4,"805":-2.1,"875":-0.6,"876":2.3,"888":-2.2,"895":1.3,"897":1.2,"901":5,"902":0.8,"904":-0.9,"950":0.9}},{"nm":"foeItem","tab":{"1001":-44.1,"1011":-32,"1018":-22.5,"1028":-26.4,"1029":-38.4,"1033":-22.8,"1036":-34.3,"1037":-28.2,"1052":-29.5,"1057":-60.1,"1058":-21.7,"2031":-38.3,"2051":-37.3,"2065":5.8,"2138":-0.7,"2139":3.3,"2140":-4.5,"2152":-11.1,"2501":7.8,"2502":6.6,"2503":1.5,"2504":5.7,"2510":2.4,"2512":2.1,"2517":7.5,"2520":9,"2522":5.2,"2524":2.2,"2525":3.8,"2526":-2,"2530":1.4,"3002":7.9,"3004":-15.4,"3008":-0.8,"3009":0.8,"3020":1.3,"3031":4.5,"3032":0.8,"3033":8.1,"3036":7.6,"3040":3.4,"3042":2.5,"3046":4,"3047":0.9,"3050":-1.7,"3053":7.8,"3065":8.2,"3067":-61.2,"3068":4.3,"3070":-54.7,"3071":5.2,"3072":9.7,"3073":1.9,"3074":6.2,"3075":9.4,"3076":2,"3078":1,"3083":7.9,"3084":2.5,"3085":3.2,"3087":1,"3089":9.9,"3091":6.2,"3094":5.5,"3095":-3.2,"3097":1.4,"3100":3.2,"3102":11.9,"3107":7,"3109":5.3,"3110":6.1,"3111":1.5,"3112":-45.4,"3115":3.1,"3116":5.2,"3118":0.7,"3119":-14.7,"3121":3.5,"3123":-1,"3124":2.4,"3135":12.5,"3137":11.7,"3139":14.6,"3142":5.9,"3143":3,"3146":1.4,"3153":2.4,"3156":9.2,"3157":8.2,"3158":0.8,"3161":5,"3165":17.5,"3177":-35.3,"3179":5.3,"3181":2,"3190":3.1,"3222":5.2,"3302":7.2,"3400":-11.4,"3504":5,"3508":1.1,"3742":6.4,"3748":1.3,"3803":-12.1,"3814":8.9,"4003":-3.2,"4004":8.4,"4005":1.4,"4401":7.1,"4628":4.5,"4629":7,"4633":4.4,"4645":4.4,"4646":3.2,"6333":6,"6609":17.9,"6616":7.5,"6617":0.8,"6620":2.4,"6621":8.8,"6631":0.9,"6653":3.7,"6657":1.1,"6662":4.6,"6664":7.6,"6665":9.4,"6673":3.9,"6675":3.2,"6692":2.8,"6694":7.3,"6695":7.7,"6696":1,"6698":1.2,"6699":0.5,"6701":5.6,"8010":11.5,"8020":9,"126697":-0.5}}]},"cc":{"gm":1.71,"layers":[{"nm":"ch","tab":{"0":-1.7,"1":0.5,"2":-0.6,"3":1.5,"7":-1.1,"8":-1.3,"9":1.9,"10":-1.3,"11":-1.7,"12":2.3,"14":0.8,"15":-1.7,"16":1.4,"17":0.9,"18":-1.5,"20":0.7,"21":-1,"22":1,"25":1.6,"27":1.8,"28":-1.2,"29":-1.1,"31":4.5,"32":1.2,"33":1,"34":1.6,"36":-0.7,"37":-0.8,"38":-1.3,"40":1.7,"41":-1,"42":-1.7,"44":0.7,"48":1.3,"50":1.5,"53":1.5,"55":-1.7,"56":6,"57":2.7,"58":-0.6,"62":-0.9,"64":-0.6,"67":-1.1,"68":-0.7,"69":0.6,"72":1.4,"76":-1.7,"77":0.8,"78":0.9,"79":1.4,"81":-1.7,"82":-0.8,"83":-1,"84":-1.6,"86":0.6,"89":1.7,"90":2.7,"91":-1.4,"96":-0.9,"98":0.6,"99":1.7,"102":-1.1,"105":-1,"107":-0.8,"111":3.2,"112":0.6,"114":-1,"117":0.9,"119":-1,"120":-0.5,"121":-0.7,"126":-1,"127":2.2,"131":-1.1,"134":1.4,"143":1.1,"145":-1.7,"154":1.3,"163":1.3,"166":-1.7,"201":1,"203":-1.6,"221":-1.5,"234":-0.5,"235":0.5,"236":-1.7,"238":-1.3,"240":-1.3,"267":0.8,"268":-0.9,"360":-1.6,"412":1.1,"420":-1.4,"421":0.6,"427":1.6,"429":-1,"432":1.6,"497":1.1,"498":-0.6,"516":1.1,"518":1.3,"523":-0.8,"526":1.4,"711":0.7,"799":-1,"804":-1.2,"805":-0.8,"887":-1.3,"893":-1,"895":-1.2,"897":0.6,"901":-1.1,"950":-1.7}},{"nm":"item","tab":{"3177":-1}},{"nm":"mate","tab":{}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{"1001":-1.3,"1011":-1.3,"1018":-1.1,"1028":-0.9,"1029":-1,"1033":-1.2,"1036":-1.3,"1037":-1.2,"1052":-1.3,"1057":-1.4,"1058":-1.4,"2031":-1.2,"2051":-1.1,"3067":-1.5,"3070":-1,"3112":-1.3,"3177":-1.3}}]},"gold":{"gm":749.69,"layers":[{"nm":"ch","tab":{"0":20,"1":-48.7,"2":20.9,"3":-82.4,"4":-7.7,"5":15,"6":-21.9,"7":6.3,"8":3.8,"9":-57.7,"10":12.3,"11":93.4,"12":-103.3,"13":5.2,"14":-55.7,"15":51.5,"16":-115.6,"17":-47.8,"18":69.9,"19":-22.3,"20":-54.8,"21":51.7,"22":-1.9,"23":36.8,"24":4.5,"25":-48.5,"26":-69,"27":-59.9,"28":-13.8,"29":60.9,"30":20.1,"31":-55.4,"32":-102.7,"33":-98.1,"34":-38.6,"35":-39.9,"36":-64.2,"37":-85,"38":9.1,"39":107.1,"40":-110.9,"41":70.8,"42":93.1,"43":-71.8,"44":-83.6,"45":-33.1,"48":-51.4,"50":-45.7,"51":47.3,"53":-119.7,"54":-66.2,"55":75.7,"56":20.1,"57":-97.6,"58":14,"59":-7.1,"60":8.2,"61":-16.8,"62":13.7,"63":-39.7,"64":34.8,"67":33.5,"68":-5.8,"69":-17.1,"72":-63.7,"74":-52.5,"75":-20.1,"76":26.2,"77":-32.5,"78":-69,"79":-63.5,"80":29.2,"81":40.6,"82":-26.6,"83":-34.8,"84":-9.4,"85":-32.9,"86":-15.1,"89":-118.1,"90":-21,"91":49.7,"92":35.2,"96":27.3,"98":-69.5,"99":-42.4,"101":-31.1,"103":-15.9,"104":90.6,"105":0.7,"106":-73.4,"107":66.1,"110":60.5,"111":-105,"112":8.4,"113":-72.1,"114":25.8,"115":-33.6,"117":-105.8,"119":148.2,"120":77.5,"121":49.6,"122":-16.3,"126":90.5,"127":-15.9,"131":5.2,"133":50.4,"134":-7.7,"136":-2.8,"141":-8.9,"142":17.9,"143":-47.5,"145":66.5,"147":-47.4,"150":-0.6,"154":-94.3,"157":15.1,"161":-34.8,"164":15.9,"166":94.3,"200":42.3,"201":-105.5,"202":60.5,"203":77.1,"221":87.7,"222":53,"223":-78.6,"233":6.8,"234":78.1,"235":23,"236":104.8,"238":39.4,"240":24.1,"245":9.5,"246":76.1,"266":8.2,"267":-102.7,"268":-13.3,"350":-97.7,"360":155.6,"412":-94.6,"420":-44.1,"421":-0.5,"427":-110.8,"429":107.4,"432":-51.7,"497":-109.5,"498":60.6,"516":-94.1,"517":-6.8,"518":-53.4,"523":58.2,"526":-99.9,"555":-1.3,"711":-14.4,"777":22.3,"799":35,"800":28.3,"804":53.6,"805":38.8,"875":-49.4,"876":-38.5,"887":28.5,"888":-107.4,"893":-2.5,"895":79.5,"897":-62,"901":7.9,"902":-111.7,"904":0.6,"910":-7,"950":61}},{"nm":"item","tab":{"2065":-14.2,"2139":2.6,"2152":79.4,"2501":-5.9,"2502":-7.9,"2503":2.6,"2504":-20.7,"2510":0.9,"2517":15.7,"2523":14.6,"2524":-10,"2525":-20.4,"2526":3.5,"2530":-10.1,"3002":-23.3,"3004":15.9,"3006":-2.7,"3008":25.3,"3009":4.5,"3020":-2.2,"3031":8.4,"3032":-10.5,"3033":7.5,"3036":9,"3040":-4.1,"3042":-5.5,"3046":14.1,"3047":2.6,"3050":-3.4,"3053":-16.9,"3065":-20.3,"3068":5.3,"3071":-6,"3072":1,"3073":-9,"3074":1.6,"3075":-10.6,"3076":-9.5,"3078":-2.3,"3083":-16.4,"3084":-8.8,"3085":2.1,"3089":0.7,"3091":-13.6,"3094":-5.7,"3095":-6.3,"3097":-3.2,"3100":2.4,"3102":-15,"3107":-17.8,"3109":-16.1,"3110":-14,"3111":-10.5,"3115":-2.8,"3116":-6,"3118":-4.3,"3119":9.8,"3121":-6.5,"3123":-10.7,"3124":4.8,"3135":-2.8,"3137":-4.5,"3139":4,"3142":-10.3,"3143":-17.6,"3146":-5.5,"3152":3.8,"3153":-0.8,"3156":-13.9,"3157":-12,"3158":-10.7,"3161":-4.5,"3165":-16.2,"3177":51.7,"3179":11,"3181":13.2,"3190":-11.7,"3222":-17.4,"3302":4.8,"3330":1,"3400":30.6,"3504":-13.3,"3508":-4.1,"3742":-18.5,"3748":8.5,"3803":9.1,"3814":-16.1,"3916":-1.8,"4003":5.4,"4004":6.7,"4005":-5.6,"4401":-21.4,"4628":-8.7,"4629":-8.7,"4633":-1.6,"4645":-0.9,"4646":-5.5,"6609":-32.4,"6610":1.8,"6616":-13.9,"6617":-8.8,"6620":-15.9,"6621":-21.8,"6631":4.7,"6655":1.7,"6657":-12.5,"6662":-10.1,"6664":2.4,"6665":-18.6,"6672":8.4,"6673":4.1,"6675":-2.9,"6676":15.5,"6692":-14.1,"6694":-2.5,"6695":-12.6,"6696":2.1,"6698":28.1,"6699":16.6,"6701":15.4,"8010":-7.5,"8020":-19.9,"126697":6.2}},{"nm":"mate","tab":{"0":1.1,"1":7.1,"2":4.6,"3":18.1,"4":5.8,"5":11.4,"6":-1.4,"7":-6.3,"8":1.3,"9":9.4,"10":-10.4,"12":16.1,"13":-3.1,"14":6.8,"15":2,"16":5.7,"17":-17.8,"18":-1.8,"19":0.6,"20":7.7,"21":-7.7,"22":5,"23":9.8,"24":8.3,"25":1.1,"26":-10,"27":14,"28":-4.4,"29":-2.4,"30":3.2,"31":-1.6,"32":17.4,"33":13.5,"34":-3.1,"35":-16.3,"36":-3.1,"37":5.5,"38":-5,"41":-9.3,"42":1.9,"43":5.9,"44":27.9,"45":-6.1,"48":2.6,"50":4.4,"51":-4.2,"53":20.8,"54":1.4,"56":9.2,"57":10.4,"58":5,"59":9.6,"60":8.8,"61":-3.6,"62":2.7,"63":2.4,"64":-4.1,"67":-0.9,"69":-2.7,"72":19.8,"74":-7.9,"75":-10,"76":-9.1,"77":11.9,"78":4.9,"79":12.4,"80":7.7,"82":-2.7,"83":2.1,"84":-7.3,"85":10.3,"86":-3.8,"89":23.7,"90":-5.6,"91":-5.9,"92":11.2,"96":-6.6,"98":3.4,"99":-3.8,"101":-2.1,"102":-1.4,"103":3.2,"104":-6,"106":-2.1,"107":14.3,"110":-1.2,"111":23.7,"112":-4.9,"113":7.5,"114":6.3,"115":-7.9,"117":9,"119":-5.8,"120":12.2,"121":-2.5,"122":3,"126":-2,"127":14.2,"131":9.9,"136":-13.8,"141":8.8,"143":-0.7,"145":-9.3,"147":4,"150":3.6,"154":19.7,"157":0.9,"161":2.9,"163":10.3,"164":15.5,"166":1.6,"200":6.1,"201":12.7,"202":-9.9,"221":-4.1,"222":0.6,"223":10.6,"233":21.1,"234":-5,"236":-6.5,"238":-7.3,"240":24.1,"245":-1.8,"246":6.2,"254":12.6,"266":5.3,"267":6.7,"268":-7.7,"350":13.1,"360":-3.7,"412":10.3,"420":6.9,"421":20.6,"427":13.9,"429":-0.7,"497":21.1,"498":-3,"516":10.6,"517":4.3,"518":12.1,"523":-0.7,"526":27.7,"555":21.7,"711":7.1,"799":4.6,"800":-17.4,"804":2.1,"805":-13.9,"875":10.4,"887":7.1,"888":9.2,"893":5.3,"897":7.6,"901":-10.5,"902":1.9,"904":14.6,"910":1.2,"950":3.5}},{"nm":"foe","tab":{"1":4.5,"2":5.3,"3":-0.6,"4":0.9,"5":4.4,"6":9.9,"7":5.7,"8":3.5,"9":2.9,"10":5.4,"11":6.7,"12":-3.2,"13":2.1,"14":1.7,"15":2.4,"16":-16.6,"17":2.8,"18":6,"19":4.3,"20":6.7,"21":2,"22":1,"23":4.5,"24":4.9,"25":-6.5,"26":-10.2,"27":5.3,"28":2,"29":6.2,"30":4.5,"31":-1.4,"32":1.8,"33":2.6,"34":-6.3,"36":5,"37":-8.7,"38":12.1,"39":6.1,"40":-13.9,"41":-5.9,"42":-0.8,"43":-7.7,"44":-3,"45":-0.7,"48":6,"50":3.7,"51":-4.2,"53":-2.7,"54":6.1,"55":8.1,"56":8.4,"59":3.9,"60":2.5,"61":-5.1,"62":1.7,"63":-2.4,"64":1.8,"67":2.4,"68":1.8,"69":-1.3,"72":-1.1,"74":-4.8,"75":9.2,"76":-4.8,"77":6.3,"78":-5.1,"79":-6.2,"80":1.2,"81":-4,"82":3,"83":3.7,"84":5.9,"85":1.1,"86":-1,"90":-2.4,"91":2.6,"92":-1.5,"96":-4,"99":-9.3,"101":-7.4,"102":4.9,"104":3.2,"105":7.1,"106":1,"107":10.2,"110":-4.7,"111":3.3,"112":-5.6,"113":4.5,"114":7,"115":-7.2,"117":-9.2,"119":2.4,"120":4.4,"121":-0.8,"122":-5.5,"126":1.2,"127":2.9,"131":5.9,"133":1.2,"134":-5.3,"136":4.5,"141":5.5,"142":-3.3,"143":-7.8,"145":0.6,"147":-4.5,"150":-2.8,"154":3.5,"157":2.9,"161":-8.6,"163":-3.4,"164":5.6,"166":7,"200":0.9,"201":-1,"202":-3.2,"222":1.5,"223":-1.7,"233":3.9,"234":2.1,"235":-5.4,"236":-0.6,"238":-3.8,"240":5.2,"245":5.5,"254":5.5,"266":-2,"267":-14.1,"268":0.9,"350":-8.5,"360":4.2,"412":-5.4,"420":1.9,"421":-1.7,"427":-8.7,"429":-1.4,"432":-9.4,"497":-3.8,"498":-3.5,"516":-1.2,"517":7.1,"518":-2.6,"523":2.8,"555":-0.6,"711":-3.2,"777":3,"799":6,"800":-3.3,"804":4.6,"805":15.9,"875":2.7,"876":7.9,"887":8.4,"888":-3.5,"893":0.6,"895":5.7,"897":-2.1,"901":3.1,"902":-13.7,"904":1.8,"910":-12.6,"950":4}},{"nm":"foeItem","tab":{"1001":35.6,"1011":-6,"1018":48.3,"1028":14.3,"1029":47.2,"1033":20.7,"1036":27.9,"1037":44.6,"1052":38.1,"1057":6.4,"1058":3.2,"2031":29.2,"2051":11.5,"2065":-23.8,"2138":-5.4,"2139":-10,"2140":14.7,"2152":42.4,"2501":-12.2,"2502":-10.2,"2503":-2.6,"2504":-18.7,"2510":-3.3,"2512":-3.4,"2517":-20.1,"2520":-20.7,"2522":-12.3,"2523":-7.8,"2524":-11.5,"2525":-14.7,"2526":10.8,"2530":-14.7,"3002":-27,"3004":44.7,"3006":2.2,"3008":-5.5,"3009":-5.5,"3020":-2.3,"3031":-13.4,"3032":2,"3033":-13.9,"3036":-15.1,"3040":-9.1,"3042":-6.4,"3046":-10.1,"3047":-3.1,"3050":-8,"3053":-18.7,"3065":-17.7,"3067":27.7,"3068":-3.9,"3070":42.7,"3071":-7.6,"3072":-27.4,"3073":-5.7,"3074":-3.8,"3075":-16.2,"3076":3.5,"3078":-0.8,"3083":-24,"3084":4.6,"3085":-5.1,"3089":-24.9,"3091":-14.4,"3094":-15.2,"3095":-11.9,"3097":-7.4,"3100":-5.8,"3102":-28.7,"3107":-24.6,"3109":-22.6,"3110":-17.2,"3111":-1.7,"3112":6.1,"3115":-2.4,"3116":-10.3,"3119":28,"3121":-8.8,"3123":10.6,"3124":-5.2,"3135":-21.6,"3137":-22.3,"3139":-31.6,"3142":-17.2,"3143":-13.6,"3146":3.1,"3152":-2.5,"3153":-1.8,"3156":-22.6,"3157":-18.9,"3158":-3.7,"3161":-11,"3165":-28,"3177":20.2,"3179":-8.2,"3181":-5.2,"3190":-16.9,"3222":-19.6,"3302":-17.9,"3330":1.7,"3400":2.2,"3504":-22.5,"3508":-1.1,"3742":-22.1,"3748":-2.7,"3803":37.1,"3814":-23.2,"3916":-1.4,"4003":3.7,"4004":-19.3,"4005":-8.7,"4401":-18.7,"4628":-14.1,"4629":-15,"4633":-2.6,"4645":-10.5,"4646":-8.3,"6333":-15.7,"6609":-24.3,"6610":-1,"6616":-32.2,"6617":-11.8,"6620":-17.1,"6621":-34.2,"6631":-2.4,"6653":-5.7,"6655":-3,"6662":-6,"6664":-7.8,"6665":-21.1,"6673":-12.3,"6675":-3.5,"6676":-1.1,"6692":-1.6,"6694":-17.6,"6695":-7.2,"6696":-4.5,"6698":-6.7,"6699":-8.6,"6701":-14.4,"8010":-18.7,"8020":-19.8}}]},"cs":{"gm":2.35,"layers":[{"nm":"ch","tab":{"0":-2.4,"1":-1,"3":-1.1,"7":-1,"9":-0.6,"10":0.9,"12":-1.9,"13":1.2,"14":-0.5,"15":2.3,"16":-1.8,"18":1.4,"20":-0.6,"21":1.4,"22":0.9,"24":-0.6,"28":-1.2,"29":0.6,"30":1.2,"31":-0.8,"32":-1.4,"33":-1.3,"35":-1.2,"36":-0.7,"37":-1.6,"39":3,"40":-1.6,"41":0.6,"42":1.1,"43":-1.1,"44":-1.3,"48":-1,"51":1.5,"53":-1.8,"54":-1.1,"57":-1.3,"59":-1,"60":-0.7,"62":-0.5,"64":-0.6,"67":0.8,"72":-1.2,"76":-0.6,"77":-0.6,"78":-1.3,"79":-1.1,"80":-0.9,"81":1.4,"84":-0.8,"89":-1.9,"90":2,"96":0.6,"98":-1.5,"104":1.4,"105":-0.8,"106":-1.1,"110":0.8,"111":-1.6,"113":-0.9,"115":0.7,"117":-1.8,"119":1.4,"121":-0.6,"133":0.6,"136":0.6,"145":1.8,"147":-0.7,"154":-1.5,"157":1,"163":0.5,"164":-0.6,"166":1.1,"201":-2,"202":1.2,"203":1.5,"221":2.4,"222":1.8,"223":-1.6,"233":-0.5,"236":1.8,"254":-0.9,"266":-0.6,"267":-1.9,"268":0.6,"350":-2.1,"360":1.4,"412":-1.6,"421":-1.1,"427":-1.9,"429":1.7,"432":-1.3,"497":-1.9,"498":2.1,"516":-1.3,"517":-0.7,"523":1.6,"526":-1.9,"555":-1.8,"777":0.8,"800":0.7,"804":2.1,"805":-0.6,"875":-0.6,"888":-1.5,"895":1.4,"897":-0.8,"901":1.7,"902":-1.7,"910":0.5,"950":0.7}},{"nm":"item","tab":{"2152":-0.6,"3004":-0.6,"3072":0.6,"3074":0.5,"3139":0.7,"3177":-2.3,"3181":0.7,"6664":0.5}},{"nm":"mate","tab":{"39":-0.6}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{"1001":-1.6,"1011":-1.7,"1018":-1.5,"1028":-1.4,"1029":-1.4,"1033":-1.7,"1036":-1.5,"1037":-1.6,"1052":-1.6,"1057":-1.7,"1058":-2.1,"2031":-1.6,"2051":-1.5,"3067":-1.8,"3070":-1.2,"3112":-1.6,"3177":-1.6}}]},"k":{"gm":0.6,"layers":[{"nm":"ch","tab":{"360":0.5}},{"nm":"item","tab":{}},{"nm":"mate","tab":{}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{}}]},"a":{"gm":1.51,"layers":[{"nm":"ch","tab":{"12":0.6,"16":0.7,"37":0.9,"40":0.7,"44":0.9,"59":0.6,"117":0.8,"147":0.6,"201":0.6,"267":0.9,"350":0.9,"427":0.7,"497":0.7,"526":0.8,"888":0.6,"902":0.8}},{"nm":"item","tab":{}},{"nm":"mate","tab":{}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{}}]},"d":{"gm":0.61,"layers":[{"nm":"ch","tab":{}},{"nm":"item","tab":{}},{"nm":"mate","tab":{}},{"nm":"foe","tab":{}},{"nm":"foeItem","tab":{}}]}},"games":67987};
function mtExpect(EX, key, ctx) {
  const T = EX.TBL[key]; if (!T) return 0;
  let v = T.gm;
  for (let i = 0; i < T.layers.length; i++) {
    const keys = ctx[i]; if (!keys || !keys.length) continue;
    const tab = T.layers[i].tab; let s = 0, n = 0;
    for (const k of keys) { const t = tab[k]; if (t != null) { s += t; n++; } }
    if (n) v += s / n;
  }
  return v;
}
// 축 가중치 — 전부 양수(합 1.00). ⚠️ 음수를 두면 "모든 축이 더 나은 사람이 아래로 가는" 일이 생긴다(실측 0.88%→0.00%).
const MT_W2 = { dmg: 0.14, mit: 0.14, cc: 0.08, taken: 0.04, heal: 0.11, gold: 0.08, k: 0.15, a: 0.03, surv: 0.23 };
const MT_W2_450 = { dmg: 0.13, mit: 0.13, cc: 0.07, taken: 0.04, heal: 0.07, prot: 0.07, gold: 0.07, cs: 0.04, k: 0.14, a: 0.03, surv: 0.21 };
const MT_PROT_CAP = 300;  // 포화점 — 지킨 만큼 인정하되 극단 보호를 최상위로 밀어올리지 않는다(600↑ 구간 실측 승률 43.8%)
const MT_PROT_W = 1.0;    // 산출(outp)에 넣는 보호 추정 계수
const MT_AST_W = 0.25;    // 산출에 넣는 어시 계수(분당 어시 × 그 경기 평균 분당 딜) — 챔피언·빌드와 무관한 참여의 증거
// ── 가중치(합 1.0) ─────────────────────────────────────────────
//   운영자 기준(2026-08-26 문답):
//   · 어시스트 = 메이킹 공헌으로 인정한다. 많이 죽었어도 어시가 많으면 봐준다. 킬은 여전히 0.
//   · 딜 절대 1위·피해감소 절대 1위를 우대하지 않는다("멀대같이 대준 상대를 때린 것"·"그냥 가서 쳐맞은 것").
//   · 고른 증강·아이템의 기대 산출 대비 실제를 본다(잘 뽑고 말아먹었나 / 못 뽑고 분전했나).
//   2026-08-29: 킬 0.18→0.15, 회복 0.08→0.11 (합 0.99 유지). 힐·실드로 일한 판이 구조적으로 밀리던 것을 되돌린다.
const MT_W = { dmg: 0.14, mit: 0.14, cc: 0.08, taken: 0.04, heal: 0.11, econ: 0.08, aug: 0.10, make: 0.03, kill: 0.15, build: 0.12 };
const MT_NEG = 0.8; // 음수 기여 완화
const MT_DEATH_PEN = 0.34;
const MT_CLIP = 1.8;      // 한 축이 아무리 튀어도 여기까지 — 극단 한 방으로 1등이 되지 않게
const MT_ABS = 0.10;      // 절대치 비중(나머지는 "기대치 대비 배수")
const MT_BUILD_MIX = 0.55; // 기준선에서 고른 빌드 기대가 차지하는 몫(나머지는 챔피언 평균)
function mtMean(xs) { return xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length); }
function mtZ(xs) { const m = mtMean(xs); const sd = Math.sqrt(mtMean(xs.map(x => (x - m) * (x - m)))) || 1; return xs.map(x => (x - m) / sd); }
function mtClip(v) { const c = Math.max(-MT_CLIP, Math.min(MT_CLIP, v)); return c < 0 ? c * MT_NEG : c; }
// "챔피언 평균 대비 배수"는 완충 log 로 펴서 z 에 넣는다 — 기준선이 작은 유틸 챔프는 배수가 2~4배로 널뛰어
//   원배수 z 를 그대로 쓰면 유틸이 매 판 극단 z 를 독식한다(캐리 챔프는 1.2~1.6배 안에서 논다).
//   +0.25 완충 = 그 스탯이 원래 0인 챔프(CC 없는 원딜 등)가 log(0)으로 바닥에 꽂히지 않게 −1.6에서 포화. 1배=0 유지.
const mtLog = v => Math.log((Math.max(0, v) + 0.25) / 1.25);
// 그 사람이 고른 증강 + 아이템의 기대 분당 산출(둘 다 45,546판 실측 평균)
function mtBuildExpect(r) {
  const pool = [];
  for (const a of (r.augments || [])) if (a && a.e) pool.push(a.e);
  for (const idRaw of (r.items || [])) {
    const id = Number(idRaw) || 0; if (!id || MT_NOINFO_ITEM.has(id)) continue;
    const v = MT_ITEM_EXPECT.e[String(id)]; if (v) pool.push({ dmg: v[0], taken: v[1], mit: v[2], cc: v[3], heal: v[4], gold: v[5] });
  }
  if (!pool.length) return null;
  const o = {}; for (const k of MT_AX) if (k !== "death") o[k] = mtMean(pool.map(x => x[k] || 0));
  return o;
}
// ── 2026-09-25 증강 칼바람 등수 = 이기려는 선택 + 그만큼 해냈나 ─────────────────────────────────────
//   운영자: "궁극적으로 그 유저가 이 10명의 5:5전투에서 이기려고 했는가 지려고 했는가, 그만큼 수행도 잘 해냈는가 못해냈는가 이런걸 종합적으로 보라는거야"
//           → 결정 보드 '전적 등수 새 기준' 2판 → "이대로 등수 시스템 바뀌도록 칼바람 분석기의 증강칼바람쪽 등수를 발행하면 돼".
//   재료 = static/api/rank-model-season2.json (aram_mayhem_auto/tools/am_rank_model_build.mjs · 발견기 원본 최근 60일 · 하루 한 번 · 관문 통과 때만 교체).
//   선택 점수 = 그 챔프로 고른 증강·아이템과 그 짝(증강×아이템 · 증강×증강)이 실제로 이기는 쪽이었나(로지스틱 · 아이템·증강 개수는 따로 떼어 냄).
//   수행 점수 = 행동 9개(킬·데스·어시·챔프딜·받은피해·피해감소·회복·CC·헛죽음 비율)를 이 파일 아래 MT_EXPECT_2400 상황 기대치와 비교한 초과 z(±3) × 챔프별 승패 비중.
//   둘 다 로그 오즈 눈금 → 더해서 10명 줄 세우기. 식은 am_rank_model_build.mjs 와 같다(바꾸면 둘 다). 파일을 못 받으면 아래 종전 식 그대로.
//   ⚠️ 증강 칼바람만. 일반 칼바람(q450)은 종전 식(같은 재료가 없다).
const RM_ACT = [["k", r => r.k], ["d", r => r.d], ["a", r => r.a], ["dmg", r => r.dmg], ["taken", r => r.taken], ["mit", r => r.mit], ["heal", r => r.heal], ["cc", r => r.cc], [null, null]];
let _rm = null, _rmFailAt = 0;
async function rankModel() {
  if (Date.now() - _rmFailAt < 60000) return _rm;   // 못 받으면 60초 쉰다(있던 모델은 계속 쓴다)
  let j; try { j = await loadData("rank-model-season2.json"); } catch { _rmFailAt = Date.now(); return _rm; }
  if (!j || j.kind !== "rank-model" || !j.choice || !j.exec || !j.base || !(j.pairBuckets > 0 || j.version >= 2)) return _rm;   // 1판=해시 칸 · 2판(09-25)=짝 이름
  _rm = j; return _rm;
}
function rmPairs(rm, m) { if (!m._pq) { const b = Buffer.from(m.pq, "base64"); const u = new Uint8Array(b); m._pq = rm.pairBytes === 2 ? new Int16Array(u.buffer, 0, u.byteLength >> 1) : new Int8Array(u.buffer); } return m._pq; }
function rmChoice(rm, c, items, augs) {
  const m = rm.choice[String(c)]; if (!m) return 0;
  let z = m.b[0] + m.b[1] * Math.min(6, items.length) / 6 + m.b[2] * Math.min(6, augs.length) / 4;
  const its = [], aus = [];
  for (const it of items.slice(0, 6)) { const w = m.items[it]; if (w != null) { z += w; its.push(it); } }
  for (const a of augs.slice(0, 6)) { const w = m.augs[a]; if (w != null) { z += w; aus.push(a); } }
  if (m.pq) { const PB = rm.pairBuckets, pq = rmPairs(rm, m);   // 1판: 짝을 해시 칸(4096)에
    for (const a of aus) { for (const it of its) z += pq[((Math.imul(a, 0x9E3779B1) ^ Math.imul(it, 0x85EBCA6B)) >>> 0) % PB] * m.ps;
      for (const b of aus) if (b > a) z += pq[((Math.imul(a, 0xC2B2AE35) ^ Math.imul(b, 0x27D4EB2F)) >>> 0) % PB] * m.ps; }
  } else {   // ★2판(09-25): 짝을 이름으로 — px[증강][아이템] · pa[작은 증강][큰 증강]. 없는 짝은 0(해시 칸을 나눠 쓰던 남의 값이 안 섞인다)
    for (const a of aus) { const pi = m.px && m.px[a], pa = m.pa && m.pa[a];
      if (pi) for (const it of its) { const v = pi[it]; if (v != null) z += v; }
      if (pa) for (const b of aus) if (b > a) { const v = pa[b]; if (v != null) z += v; } }
  }
  return z - m.mean;
}
function rmScore(rm, rows, duration) {   // 그 판 10명 → [{ ch, ex }] (로그 오즈)
  const mins = Math.max(1 / 60, Number(duration || 0) / 60);
  const Q = rows.map(r => ({ r, c: Number(r.champId) || 0, items: [...new Set((r.items || []).map(Number).filter(x => x && !MT_NOINFO_ITEM.has(x)))], augs: (r.augIds || []).map(Number).filter(Boolean) }));
  return Q.map(q => {
    const base = rm.base[String(q.c)], w = rm.exec[String(q.c)] || rm.execGlobal;
    const foes = Q.filter(x => x.r.team !== q.r.team);
    const ctx = [[q.c], q.augs, q.items, Q.filter(x => x.r.team === q.r.team && x !== q).map(x => x.c), foes.map(x => x.c), [...new Set(foes.flatMap(x => x.items))]];
    let ex = 0;
    RM_ACT.forEach(([key, get], a) => {
      if (key == null ? (q.r.k == null || q.r.d == null || q.r.a == null) : get(q.r) == null) return;   // 옛 방식 저장분(partial)은 KDA 가 비어 온다 — 빈 값은 0 이 아니라 '모름'(z 0)
      const v = key == null ? Number(q.r.d || 0) / (1 + Number(q.r.k || 0) + Number(q.r.a || 0)) : Number(get(q.r) || 0) / mins;
      let e = key && MT_EXPECT_2400.TBL[key] ? mtExpect(MT_EXPECT_2400, key, ctx) : null; if (e == null) e = base ? base[0][a] : v;
      const sd = base ? base[1][a] : 0; const z = sd > 0 ? Math.max(-rm.clip, Math.min(rm.clip, (v - e) / sd)) : 0;
      ex += w[a] * z;
    });
    return { ch: rmChoice(rm, q.c, q.items, q.augs), ex };
  });
}
// ── 2026-09-26 증강 칼바람 등수 D ─────────────────────────────────────────────────────────────
//   운영자(09-26): "반박할 수 없을만큼 사실이어야 하는게 최종 등수의 이상적인 방법이야" · "노데스하면 팀에 얼마나 큰 민폐인데" ·
//   "내가 보고 판단할테니, 그대로 칼바람 분석기 등수 시스템에 반영해봐" (결정 보드 '전적 등수 새 기준' 4판 D).
//   ① 같은 판에서 딜·받아 낸 피해(받은+감소)·회복·CC 네 칸이 모두 이상(하나라도 더 많음)인 사람은 반드시 위 — 반박할 수 없는 순서.
//   ② 나머지 = 그 챔피언 평소(분당 중앙값) 대비 네 칸을 얼마나 더 했나(평소 많이 하는 칸일수록 크게) → 그 챔피언 판들 가운데 자리 + 선택 점수.
//   데스·킬·어시는 안 센다(09-25 식은 덜 죽은 걸 좋게 쳐서 15분 넘는 판 2데스 이하가 평균 1.9~2.0등이었다).
//   재료 = 이 폴더 rank_d_season2.json(09-18 뒤 증바람 6만 판) · 못 읽으면 09-25 식(선택+수행) 그대로. 식은 measure 쪽 시험 도구(build_d2)와 글자 그대로 같다.
//   ⚠️ 평소 CC 가 0 인 챔피언(루시안·카이사 등)은 흩어짐이 반올림으로 0 이 되어 0 나누기가 났다(표 version 1) → 표 version 2 는 흩어짐 바닥
//      (그 칸 전체 중앙값의 10%)을 두고, 여기서는 빈 칸·무한대가 하나라도 있는 표를 아예 안 쓴다(등수가 깨지느니 09-25 식).
let _rdTable;
function rdTableOk(j) {
  if (!(j && j.kind === "rank-d" && j.norms && j.quant && Array.isArray(j.popMed) && j.popMed.length === 4 && j.popMed.every(v => v > 0) && j.scale > 0 && j.clip > 0 && j.emphMin > 0)) return false;
  for (const c of Object.keys(j.norms)) { const nm = j.norms[c], tb = j.quant[c];
    if (!Array.isArray(nm) || nm.length !== 4 || nm.some(x => !Array.isArray(x) || !(Number.isFinite(x[0]) && x[0] >= 0 && Number.isFinite(x[1]) && x[1] > 0))) return false;
    if (!tb || !(tb.n > 0) || !Array.isArray(tb.q) || tb.q.length !== 101 || tb.q.some(v => !Number.isFinite(v))) return false; }
  return true;
}
function rankDTable() {
  if (_rdTable !== undefined) return _rdTable;
  _rdTable = null;
  for (const dir of [__dirname, BUNDLE_DIR].filter(Boolean)) {
    try { const j = JSON.parse(readFileSync(path.join(dir, "rank_d_season2.json"), "utf8"));
      if (rdTableOk(j)) { _rdTable = j; break; } } catch {}
  }
  return _rdTable;
}
function rdRaw(rd, nm, pm) {   // 네 칸(분당) → 그 챔피언 평소 대비 점수. 모르는 칸은 건너뛴다
  if (!nm) return null;
  let num = 0, den = 0;
  for (let a = 0; a < 4; a++) { const v = pm[a]; if (v == null) continue; const md = nm[a][0], sd = nm[a][1]; if (!(sd > 0)) continue;
    const z = Math.max(-rd.clip, Math.min(rd.clip, (v - md) / sd)); const emph = Math.max(rd.emphMin, md / rd.popMed[a]); num += emph * z; den += emph; }
  return den > 0 ? num / den : null;
}
function rdPct(tb, v) {   // 그 챔피언 판들 가운데 자리(0~1) — 101칸 분위표에서 선형으로
  if (!tb || v == null) return 0.5;
  const q = tb.q; if (v <= q[0]) return 0.5 / tb.n; if (v >= q[100]) return 1 - 0.5 / tb.n;
  let lo = 0, hi = 100; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (q[md] <= v) lo = md; else hi = md; }
  return (lo + (v - q[lo]) / ((q[hi] - q[lo]) || 1)) / 100;
}
function rdProbit(p) {   // 정규 눈금으로(Acklam 근사)
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771201e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549671010322563e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; p = Math.min(1 - 1e-6, Math.max(1e-6, p));
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= 1 - pl) { const q = p - 0.5, r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
function rdBeats(Y, X) {   // Y 가 X 를 네 칸 모두 이상 · 하나라도 더 많음(모르는 칸이 있으면 판정하지 않는다)
  for (const v of [Y, X]) if (v.some(x => x == null)) return false;
  let ge = true, gt = false; for (let a = 0; a < 4; a++) { if (Y[a] < X[a]) ge = false; if (Y[a] > X[a]) gt = true; }
  return ge && gt;
}
// ── 2026-09-26 증강 칼바람 등수 = 선택(영리했나) + 피지컬(해냈나) — 결정 보드 '전적 등수 새 기준' 8판 ────────────────────────
//   운영자: "선택은 생각을 잘 해서 판단이 좋았는가, 수행점수는 실제로 그걸 가지고 퍼포먼스도 잘 냈는가 … 종합되면 잘했구나(승패 무관)"
//           · "모든 각 챔피언에 대해 모든 각 증강에 대해, 모든 각 아이템에 대해 상관관계를 따져서" · "탱커라고 마음대로 정하지 말라" → "이대로 발행해".
//   선택 = beta × rmChoice(그 챔피언 × 고른 증강·아이템·짝) · 피지컬 = Σ 칸 wC[챔피언][칸] × (실제 몫 − 기대 몫)
//   기대 = 같은 챔피언·같은 증강·같은 아이템·같은 아군·상대에서 보통 나오는 1분당 값(챔피언×증강 · 챔피언×아이템 포함 · 09-18 뒤 11만 8천 판)
//   받은 피해·피해 감소는 우리 팀 안 몫(팀이 많이 맞은 흐름은 뺀다) · 딜·회복·CC 는 판 전체 몫. 역할 묶음·데스·킬·어시·승패 없음.
//   재료 = 이 폴더 rank_ce_season2.json(선택 모델 rm 도 그 안에 — beta 를 배운 09-25 모델 사본. 매일 다시 만드는 라이브 모델을 섞으면 보드와 310명 중 41명이 달라졌다)
//   · 못 읽으면 아래 D. 식은 measure/rankcmp/pattern(ce_fit_new · ce_score_cache)과 글자 그대로 같다(분석기 판 31개 310명 등수 전부 일치).
//   ★2026-09-27 9판(결정 보드 9판 · 운영자 "이런 등수 로직 괜찮네. 이대로 발행해") — 식은 그대로, 재료(version 2) 값만 바뀌었다:
//     칸 무게 마이너스 0(8판은 CC 를 더 걸면 챔피언 173개 중 130개가 깎였다) · 딜·회복·CC = 모든 챔피언 공통 무게(카서스 딜이 공통의 1/5 이던 흔들림 제거)
//     · 받은 피해·피해 감소 = 챔피언별 무게 · beta = 8판의 1/4(분석기 판 18% 에서 피지컬 4등 밖이 선택만으로 1등이었다).
//     재료 = measure/rankcmp/pattern/make_rank_ce9.cjs · 대조 = verify_server_ce9.cjs(분석기 판 827판 8,270명 등수 = 보드 9판 · 차이 0).
//   ⚠️ 표에 없는 새 증강·아이템(다음 패치)은 선택·기대치 모두 0(중립)으로 센다 — 표를 다시 만들 때까지.
const CE_AX = ["dmg", "taken", "mit", "heal", "cc"];
let _ceTable;
function ceTableOk(j) {
  if (!(j && j.kind === "rank-ce" && j.beta > 0 && Array.isArray(j.gW) && j.gW.length === 5 && j.gW.every(Number.isFinite) && j.wC && j.expect && Array.isArray(j.teamAxes))) return false;
  if (!(j.rm && j.rm.choice && typeof j.rm.choice === "object" && Object.keys(j.rm.choice).length)) return false;
  for (const m of Object.values(j.rm.choice)) if (!(m && Array.isArray(m.b) && m.b.length === 3 && m.b.every(Number.isFinite) && Number.isFinite(m.mean) && m.items && m.augs)) return false;
  for (const w of Object.values(j.wC)) if (!Array.isArray(w) || w.length !== 5 || !w.every(Number.isFinite)) return false;
  for (const st of CE_AX) { const e = j.expect[st]; if (!e || !Number.isFinite(e.mu) || !Array.isArray(e.eff) || e.eff.length !== 7) return false;
    for (const g of e.eff) { if (!g || typeof g !== "object") return false; for (const k in g) if (!Number.isFinite(g[k])) return false; } }
  return true;
}
function rankCETable() {
  if (_ceTable !== undefined) return _ceTable;
  _ceTable = null;
  for (const dir of [__dirname, BUNDLE_DIR].filter(Boolean)) {
    try { const j = JSON.parse(readFileSync(path.join(dir, "rank_ce_season2.json"), "utf8")); if (!ceTableOk(j)) continue;
      const X = {}; for (const st of CE_AX) X[st] = { mu: j.expect[st].mu, eff: j.expect[st].eff.map(g => { const m = new Map(); for (const k in g) m.set(Number(k), g[k]); return m; }) };
      _ceTable = { beta: j.beta, gW: j.gW, wC: new Map(Object.entries(j.wC).map(([c, w]) => [Number(c), w])), teamAxes: new Set(j.teamAxes), X, rm: j.rm }; break; } catch {}
  }
  return _ceTable;
}
function ceExpect(X, c, augs, items, mates, foes) {   // 같은 챔피언·선택·아군·상대에서 보통 나오는 1분당 값
  let v = X.mu + (X.eff[0].get(c) || 0);
  for (const a of augs) v += (X.eff[1].get(a) || 0) + (X.eff[2].get(c * 1e6 + a) || 0);
  for (const x of items) v += (X.eff[3].get(x) || 0) + (X.eff[4].get(c * 1e6 + x) || 0);
  for (const m of mates) v += X.eff[5].get(m) || 0;
  for (const f of foes) v += X.eff[6].get(f) || 0;
  return v;
}
function rankMatchTeam(p, rm, rd, ce) {
  const rows = (p && p.rows) || []; if (rows.length < 2) return p;
  const mins = Math.max(1 / 60, Number(p.duration || 0) / 60);
  const K = ["dmg", "taken", "mit", "cc", "heal", "gold"];
  const pm = rows.map(r => ({ dmg: Number(r.dmg || 0) / mins, taken: Number(r.taken || 0) / mins,
    mit: Number(r.mit || 0) / mins, cc: Number(r.cc || 0) / mins, heal: Number(r.heal || 0) / mins,
    gold: Number(r.gold || 0) / mins, ast: Number(r.a || 0) / mins }));
  const rel = rows.map((r, i) => {
    const b = MT_BASE.b[String(r.champId)] || null;
    const be = mtBuildExpect(r);
    const o = {};
    K.forEach((k, j) => { const cb = b ? b[MT_AX.indexOf(k)] : MT_BASE.a[MT_AX.indexOf(k)];
      const base = be ? (cb * (1 - MT_BUILD_MIX) + be[k] * MT_BUILD_MIX) : cb;
      o[k] = pm[i][k] / Math.max(1e-6, base || MT_BASE.a[MT_AX.indexOf(k)]); });
    return o;
  });
  // 피해 감소는 "죽지 않고 받아냈나" — 그냥 계속 맞고 죽은 것이 플러스가 되지 않게.
  //   계수는 3/(2+죽음) — 예전 3/max(1,죽음)은 1죽음↔6죽음이 6배 갈려 무죽음 유틸이 탱커 축(0.14)을
  //   독식하고 정면 탱커가 깎였다. 죽음 자체 벌점은 헛죽음 축이 따로 진다.
  rows.forEach((r, i) => { const f = 3 / (2 + Math.max(0, Number(r.d || 0))); pm[i].mit = pm[i].mit * f; rel[i].mit = rel[i].mit * f; });
  const half = k => { const A = mtZ(pm.map(x => x[k])), R = mtZ(rel.map(x => mtLog(x[k])));
    return rows.map((_, i) => mtClip(MT_ABS * A[i] + (1 - MT_ABS) * R[i])); };
  const S = { dmg: half("dmg"), mit: half("mit"), cc: half("cc"), taken: half("taken"), heal: half("heal") };
  // 킬·어시를 그 챔피언 평균 대비로 — "역할군 특성상 킬을 쓸어먹을 수밖에 없다"를 기준선이 흡수한다
  const iAst = MT_AX.indexOf("ast"), iKill = MT_AX.indexOf("kill");
  const astRel = rows.map((r, i) => { const b = MT_BASE.b[String(r.champId)];
    return pm[i].ast / Math.max(0.05, b ? b[iAst] : MT_BASE.a[iAst]); });
  const killRel = rows.map((r, i) => { const b = MT_BASE.b[String(r.champId)];
    return (Number(r.k || 0) / mins) / Math.max(0.03, b ? b[iKill] : MT_BASE.a[iKill]); });
  const make = mtZ(astRel.map(mtLog)).map(mtClip);
  const kill = mtZ(killRel.map(mtLog)).map(mtClip);
  // CC 는 여기부터 챔피언 보정치(자기 기준선 대비 배수 × 전체평균)로만 센다 — 녹턴류(기준 7.8/분, 전체평균 1.9)가
  //   생 CC초로 빌드초과·자원효율·헛죽음 방어까지 사면 안 된다. CC 축 자체는 이미 기준선으로 나눠져 있다.
  const iCc = MT_AX.indexOf("cc");
  const ccAdj = rows.map((r, i) => { const b = MT_BASE.b[String(r.champId)];
    return pm[i].cc / Math.max(0.05, b ? b[iCc] : MT_BASE.a[iCc]) * MT_BASE.a[iCc]; });
  // 빌드 초과 = 고른 증강·아이템 기대 산출 대비 실제
  const bRatio = rows.map((r, i) => { const be = mtBuildExpect(r); if (!be) return 1;
    const act = pm[i].dmg + 0.5 * (Number(r.mit || 0) / mins) + 300 * ccAdj[i] + 0.4 * pm[i].heal;
    const exp = be.dmg + 0.5 * be.mit + 300 * be.cc + 0.4 * be.heal;
    return act / Math.max(1e-6, exp); });
  const build = mtZ(bRatio.map(mtLog)).map(mtClip);
  const mDmg = mtMean(pm.map(x => x.dmg)), mCc = mtMean(ccAdj) || 1;
  const ccUnit = mDmg / mCc * 0.35;
  // 그 판에 산 아이템이 말하는 아군 보호(포화 곡선). 아이템이 하나도 안 잡히면 0 — 지어내지 않는다.
  const protBuild = rows.map(r => {
    const v = [];
    for (const idRaw of (r.items || [])) { const id = Number(idRaw) || 0;
      if (!id || MT_NOINFO_ITEM.has(id)) continue; const e = MT_PROT_ITEM[id]; if (e != null) v.push(e); }
    if (!v.length) return 0;
    return MT_PROT_CAP * (1 - Math.exp(-mtMean(v) / MT_PROT_CAP));
  });
  // 산출 = "이 사람이 낸 것". 헛죽음 축(계수 0.34, 전 축 최대)과 자원효율 축이 같이 쓴다.
  //   ⚠️ 여기에 아군 힐·실드가 한 줄도 없어서, 안 보이는 일을 한 판이 상시로 헛죽음 판정을 받았다
  //      (실측: 아군을 분당 600↑ 지킨 판의 63%). 어시(참여의 흔적)와 빌드 기반 보호 추정을 넣어 그걸 끊는다.
  const outp = pm.map((x, i) => x.dmg + 0.45 * x.mit + ccUnit * ccAdj[i] + 0.30 * x.heal
    + MT_PROT_W * protBuild[i] + MT_AST_W * x.ast * mDmg);
  const econ = mtZ(rows.map((_, i) => outp[i] / Math.max(1e-6, pm[i].gold))).map(mtClip);
  const known = rows.map(r => { const a = (r.augments || []).filter(x => x && x.winRate != null); return a.length ? mtMean(a.map(x => x.winRate)) : null; });
  const kv = known.filter(v => v != null); const aM = kv.length ? mtMean(kv) : 50;
  const aSd = kv.length > 1 ? (Math.sqrt(mtMean(kv.map(v => (v - aM) * (v - aM)))) || 1) : 1;
  const augZ = known.map(v => v == null ? 0 : mtClip((v - aM) / aSd));
  const useless = rows.map(() => 0);
  for (const t of [...new Set(rows.map(r => r.team))]) {
    const idx = rows.map((r, i) => [r, i]).filter(([r]) => r.team === t).map(([, i]) => i);
    const dT = idx.reduce((s, i) => s + Number(rows[i].d || 0), 0) || 1;
    const oT = idx.reduce((s, i) => s + outp[i], 0) || 1;
    for (const i of idx) useless[i] = Math.max(0, Number(rows[i].d || 0) / dT - outp[i] / oT);
  }
  const uZ = mtZ(useless);
  // ── 기댓값 초과분 채점 ──────────────────────────────────────────
  //   그 챔피언·증강·아이템으로 그 아군·상대를 만났을 때 "보통 이만큼 나온다"를 빼고 남은 것만 센다.
  //   앞에서 맞아주는 게 당연한 챔프가 많이 맞은 건 초과가 아니고, 딜이 안 나오는 챔프가 딜을 내면 초과가 크다.
  const EX = (Number(p.queueId) === 2400 || rows.some(r => (r.augments || []).length)) ? MT_EXPECT_2400 : MT_EXPECT_450;
  const isAug = EX === MT_EXPECT_2400;
  const W2 = isAug ? MT_W2 : MT_W2_450;
  const ctxOf = (r) => {
    const foes = rows.filter(x => x.team !== r.team);
    const items = [...new Set((r.items || []).map(Number).filter(Boolean))];
    const augs = (r.augIds || (r.augments || []).map(a => a && (a.value != null ? a.value : a.id))).map(Number).filter(Boolean);
    const mates = rows.filter(x => x.team === r.team && x !== r).map(x => Number(x.champId) || 0);
    const foeCh = foes.map(x => Number(x.champId) || 0);
    const foeItems = [...new Set(foes.flatMap(x => (x.items || []).map(Number).filter(Boolean)))];
    const own = [Number(r.champId) || 0];
    return isAug ? [own, augs, items, mates, foeCh, foeItems] : [own, items, mates, foeCh, foeItems];
  };
  const CTX = rows.map(ctxOf);
  const RAW = { dmg: i => pm[i].dmg, taken: i => Number(rows[i].taken || 0) / mins,
    mit: i => Number(rows[i].mit || 0) / mins, heal: i => Number(rows[i].heal || 0) / mins,
    cc: i => Number(rows[i].cc || 0) / mins, gold: i => pm[i].gold,
    cs: i => Number(rows[i].cs || 0) / mins, prot: i => Number(rows[i].prot || 0) / mins,
    k: i => Number(rows[i].k || 0) / mins, a: i => pm[i].ast, d: i => Number(rows[i].d || 0) / mins };
  const exc = {};
  for (const key of Object.keys(RAW)) {
    if (!EX.TBL[key]) continue;
    exc[key] = rows.map((_, i) => RAW[key](i) - mtExpect(EX, key, CTX[i]));
  }
  exc.surv = (exc.d || rows.map(() => 0)).map(v => -v);      // 기댓값보다 덜 죽으면 플러스
  const zc = arr => { const m = mtMean(arr); const sd = Math.sqrt(mtMean(arr.map(x => (x - m) * (x - m)))) || 1;
    return arr.map(v => Math.max(-MT_CLIP, Math.min(MT_CLIP, (v - m) / sd))); };
  const Z2 = {}; for (const key of Object.keys(W2)) Z2[key] = zc(exc[key] || rows.map(() => 0));
  const score = rows.map((_, i) => { let s = 0; for (const key of Object.keys(W2)) s += W2[key] * Z2[key][i]; return s; });
  const __legacy = rows.map((_, i) => MT_W.dmg * S.dmg[i] + MT_W.mit * S.mit[i] + MT_W.cc * S.cc[i] + MT_W.taken * S.taken[i]
    + MT_W.heal * S.heal[i] + MT_W.econ * econ[i] + MT_W.aug * augZ[i] + MT_W.make * make[i] + MT_W.kill * kill[i] + MT_W.build * build[i]
    - MT_DEATH_PEN * Math.max(0, uZ[i]));
  let fin = score;
  if (isAug && rm) {   // ★2026-09-25 증강 칼바람 = 선택 점수 + 수행 점수(위 rmScore) · 등수·MVP/ACE 는 이 합으로
    const sc = rmScore(rm, rows, p.duration);
    fin = sc.map(x => x.ch + x.ex);
    rows.forEach((r, i) => { r.choice = Math.round(sc[i].ch * 1000) / 1000; r.exec = Math.round(sc[i].ex * 1000) / 1000; });
    p.rankBy = "choice+exec";
  }
  rows.forEach((r, i) => { r.score = Math.round(fin[i] * 1000) / 1000; r.useless = Math.round(useless[i] * 1000) / 1000;
    r.buildRatio = Math.round(bRatio[i] * 100) / 100; });
  if (isAug && ce) {   // ★2026-09-26 증강 칼바람 = 선택 + 피지컬(위 rankCETable 주석) · 등수·MVP/ACE — 재료가 없으면 아래 D
    const mn = Math.max(1, Number(p.duration || 0) / 60);
    const items = rows.map(r => [...new Set((r.items || []).map(Number).filter(x => x > 0))]);
    const augs = rows.map(r => (r.augIds || []).map(Number).filter(x => x > 0));
    const raw = rows.map(r => CE_AX.map(k => r[k] == null ? null : Number(r[k])));
    const E = rows.map((r, i) => { const mates = [], foes = []; rows.forEach((q, j) => { if (j !== i) (q.team === r.team ? mates : foes).push(Number(q.champId) || 0); });
      return CE_AX.map(k => Math.max(1e-3, ceExpect(ce.X[k], Number(r.champId) || 0, augs[i], items[i], mates, foes))); });
    const dev = rows.map(() => [0, 0, 0, 0, 0]);
    for (let a = 0; a < 5; a++) { if (raw.some(v => v[a] == null)) continue;   // 모르는 칸(옛 저장분)은 모두 0 — 지어내지 않는다
      const inTeam = ce.teamAxes.has(a), groups = inTeam ? [...new Set(rows.map(r => r.team))].map(t => rows.map((_, i) => i).filter(i => rows[i].team === t)) : [rows.map((_, i) => i)];
      for (const idx of groups) { let se = 0, sx = 0; for (const i of idx) { se += E[i][a]; sx += raw[i][a] / mn; }
        for (const i of idx) dev[i][a] = (sx > 0 ? raw[i][a] / mn / sx : (inTeam ? 0.2 : 0.1)) - E[i][a] / se; } }
    const ch = rows.map((r, i) => ce.beta * rmChoice(ce.rm, Number(r.champId) || 0, items[i].filter(x => !MT_NOINFO_ITEM.has(x)), augs[i]));
    const wOf = r => ce.wC.get(Number(r.champId) || 0) || ce.gW;
    const ex = rows.map((r, i) => { const w = wOf(r); let s = 0; for (let a = 0; a < 5; a++) s += w[a] * dev[i][a]; return s; });
    const sc = rows.map((_, i) => { const v = ch[i] + ex[i]; return Number.isFinite(v) ? v : 0; });
    const facts = rows.map(r => { const t = r.taken == null ? null : Number(r.taken), m = r.mit == null ? null : Number(r.mit);
      return [r.dmg == null ? null : Number(r.dmg), (t == null || m == null) ? null : t + m, r.heal == null ? null : Number(r.heal), r.cc == null ? null : Number(r.cc)]; });
    const left = new Set(rows.map((_, i) => i)); let k = 0;
    while (left.size) {   // 남은 사람 중 네 칸 모두 앞선 사람이 없는 사람들 가운데 선택+피지컬 높은 순
      let best = -1;
      for (const i of left) { let beaten = false; for (const j of left) if (j !== i && rdBeats(facts[j], facts[i])) { beaten = true; break; } if (beaten) continue;
        if (best < 0 || sc[i] > sc[best] || (sc[i] === sc[best] && Number(rows[i].pid || 0) < Number(rows[best].pid || 0))) best = i; }
      if (best < 0) best = [...left][0];   // 값이 깨져 누구도 못 고르면(없어야 함) 남은 첫 사람 — 화면이 통째로 죽지 않게
      rows[best].rank = ++k; left.delete(best);
    }
    rows.forEach((r, i) => { r.score = Math.round(sc[i] * 1000) / 1000; r.choice = Math.round(ch[i] * 1000) / 1000; r.exec = Math.round(ex[i] * 1000) / 1000; });
    const top = {}; rows.forEach(r => { const t = String(r.team); if (!top[t] || r.rank < top[t].rank) top[t] = r; });
    rows.forEach(r => { r.badge = (top[String(r.team)] === r) ? (r.win ? "MVP" : "ACE") : null; });
    p.rankBy = "ce"; p.ranked = true;
    return p;
  }
  if (isAug && rd) {   // ★2026-09-26 증강 칼바람 = D(위 rankDTable 주석) · 등수·MVP/ACE 를 이걸로 다시 매긴다
    const facts = rows.map(r => { const t = r.taken == null ? null : Number(r.taken), m = r.mit == null ? null : Number(r.mit);
      return [r.dmg == null ? null : Number(r.dmg), (t == null || m == null) ? null : t + m, r.heal == null ? null : Number(r.heal), r.cc == null ? null : Number(r.cc)]; });
    const ch = rows.map(r => { if (!rm) return 0;
      const items = [...new Set((r.items || []).map(Number).filter(x => x && !MT_NOINFO_ITEM.has(x)))], augs = (r.augIds || []).map(Number).filter(Boolean);
      return Math.round(rmChoice(rm, Number(r.champId) || 0, items, augs) * 1000) / 1000; });
    const sc = rows.map((r, i) => { const c = String(Number(r.champId) || 0);
      const raw = rdRaw(rd, rd.norms[c], facts[i].map(x => x == null ? null : x / mins));
      const v = ch[i] + rd.scale * rdProbit(rdPct(rd.quant[c], raw));
      return Number.isFinite(v) ? v : ch[i]; });
    const left = new Set(rows.map((_, i) => i)); let k = 0;
    while (left.size) {   // 남은 사람 중 네 칸 모두 앞선 사람이 없는 사람들 가운데 점수 높은 순
      let best = -1;
      for (const i of left) { let beaten = false; for (const j of left) if (j !== i && rdBeats(facts[j], facts[i])) { beaten = true; break; } if (beaten) continue;
        if (best < 0 || sc[i] > sc[best] || (sc[i] === sc[best] && Number(rows[i].pid || 0) < Number(rows[best].pid || 0))) best = i; }
      if (best < 0) best = [...left][0];   // 값이 깨져 누구도 못 고르면(없어야 함) 남은 첫 사람 — 화면이 통째로 죽지 않게
      rows[best].rank = ++k; left.delete(best);
    }
    rows.forEach((r, i) => { r.score = Math.round(sc[i] * 1000) / 1000; r.choice = ch[i]; });   // ★09-26 등수 근거(평소 대비 %)는 화면에서 뺐다 — 운영자 "왜 그런 등수인지도 알리지 마"
    const top = {}; rows.forEach(r => { const t = String(r.team); if (!top[t] || r.rank < top[t].rank) top[t] = r; });
    rows.forEach(r => { r.badge = (top[String(r.team)] === r) ? (r.win ? "MVP" : "ACE") : null; });
    p.rankBy = "d4"; p.ranked = true;
    return p;
  }
  const order = rows.map((r, i) => i).sort((a, b) => (fin[b] - fin[a]) || (useless[a] - useless[b]) || (Number(rows[a].pid || 0) - Number(rows[b].pid || 0)));
  order.forEach((i, k) => { rows[i].rank = k + 1; });
  const best = {};
  rows.forEach(r => { const k = String(r.team); if (!best[k] || r.score > best[k].score) best[k] = r; });
  rows.forEach(r => { r.badge = (best[String(r.team)] === r) ? (r.win ? "MVP" : "ACE") : null; });
  p.ranked = true;
  return p;
}
// ── 신규 증강 자동 해석 ────────────────────────────────────────────────────
//   패치가 나오면 우리 검색풀·db 카탈로그보다 먼저 새 증강 id 가 경기에 등장한다. 그때 이름이 없다고 멈추지 않고
//   CommunityDragon 공식 카탈로그에서 그 자리에서 해석한다(latest → 아직 없으면 pbe. pbe 가 패치를 먼저 싣는다).
//   ⚠️ 지어내지 않는다 — 두 소스 어디에도 없으면 그대로 비워 둔다. 결과는 디스크에 하루 캐시(외부 PC도 동일 동작).
const CDRAGON_AUG_CACHE = path.join(os.tmpdir(), "aram-mayhem-cache", "cdragon_augments.json");
const CDRAGON_AUG_TTL = 24 * 60 * 60 * 1000;
let _cdragonAug = null, _cdragonAugAt = 0, _cdragonAugBusy = null;
function cdragonIconUrl(branch, p) {
  const rel = String(p || "").replace(/^\/lol-game-data\/assets\//i, "").toLowerCase();
  return rel ? `https://raw.communitydragon.org/${branch}/game/${rel}` : "";
}
const CDRAGON_RARITY = { kprismatic: "prismatic", kgold: "gold", ksilver: "silver", kbronze: "silver" };
async function cdragonAugments() {
  const now = Date.now();
  if (_cdragonAug && now - _cdragonAugAt < CDRAGON_AUG_TTL) return _cdragonAug;
  if (_cdragonAugBusy) return _cdragonAugBusy;
  _cdragonAugBusy = (async () => {
    try { const c = JSON.parse(readFileSync(CDRAGON_AUG_CACHE, "utf8"));
      if (c && c.at && now - c.at < CDRAGON_AUG_TTL && c.map) { _cdragonAug = c.map; _cdragonAugAt = c.at; return _cdragonAug; } } catch {}
    const map = {};
    for (const branch of ["latest", "pbe"]) {   // latest 먼저 → 없는 신규만 pbe 가 채운다
      try {
        const list = await fetchJsonU(`https://raw.communitydragon.org/${branch}/plugins/rcp-be-lol-game-data/global/ko_kr/v1/cherry-augments.json`);
        for (const a of (Array.isArray(list) ? list : [])) {
          const id = Number(a && a.id); if (!id || map[id]) continue;
          const nm = String(a.nameTRA || a.simpleNameTRA || "").trim(); if (!nm) continue;
          const small = cdragonIconUrl(branch, a.augmentSmallIconPath);
          map[id] = { name: nm, icon: small.replace(/_small\.png$/i, "_large.png") || small, iconSmall: small,
            rarity: CDRAGON_RARITY[String(a.rarity || "").toLowerCase()] || null, branch };
        }
      } catch {}
    }
    if (Object.keys(map).length) {
      _cdragonAug = map; _cdragonAugAt = Date.now();
      try { writeFileSync(CDRAGON_AUG_CACHE, JSON.stringify({ at: _cdragonAugAt, map })); } catch {}
    }
    return _cdragonAug || {};
  })().finally(() => { _cdragonAugBusy = null; });
  return _cdragonAugBusy;
}
function headOk(url) { // 큰 아이콘이 실제로 있는지만 확인(채우는 항목이 소수라 저렴하다)
  return new Promise(res => { try {
    const u = new URL(url);
    const rq = https.request({ method: "HEAD", host: u.hostname, path: u.pathname + u.search, timeout: 6000 }, r => { r.resume(); res(r.statusCode === 200); });
    rq.on("timeout", () => { rq.destroy(); res(false); }); rq.on("error", () => res(false)); rq.end();
  } catch { res(false); } });
}
const AUG_PLACEHOLDER = /^(증강|augment)\s*#?\d*$/i;
// 이름이 비었거나 "증강 2157" 같은 자리표시자면 CommunityDragon 으로 메운다. 채운 것만 바꾸고 나머진 그대로.
async function fillUnknownAugments(list) {
  const need = (list || []).filter(a => a && a.id != null && (!a.name || AUG_PLACEHOLDER.test(String(a.name).trim()) || !a.icon));
  if (!need.length) return 0;
  const cat = await cdragonAugments(); if (!cat) return 0;
  let n = 0;
  for (const a of need) {
    const c = cat[Number(a.id)]; if (!c) continue;
    if (!a.name || AUG_PLACEHOLDER.test(String(a.name).trim())) a.name = c.name;
    if (!a.icon) {
      if (c.okLarge === undefined) c.okLarge = c.icon && c.icon !== c.iconSmall ? await headOk(c.icon) : true;
      a.icon = c.okLarge ? c.icon : (c.iconSmall || c.icon);
    }
    if (a.rarity == null && c.rarity) a.rarity = c.rarity;
    n++;
  }
  return n;
}
// 경기 상세 스코어보드 10인의 증강 id → 이름/아이콘/등급.
//   소스 = season2 검색풀. loadPool은 원격(aram-mayhem.com) → 디스크캐시 → 로컬 순이라
//   db.json·pages_site 가 없는 다른 PC에서도 그대로 채워진다. 풀에 없으면 빈 채로 두고 지어내지 않는다.
async function enrichMatchTeamAugments(p) {
  const rows = (p && p.rows) || [];
  if (!rows.some(r => (r.augIds || []).length)) return p;
  let am = null;
  try { const pool = await loadPool("search-pool-all-observedAugments-season2.json"); am = new Map(); for (const r of pool) for (const k of [r.value, r.id, r.rawAugmentId]) if (k != null && !am.has(Number(k))) am.set(Number(k), r); } catch {}
  for (const r of rows) {
    r.augments = (r.augIds || []).map(id => {
      const x = am ? am.get(Number(id)) : null;
      const g = x ? Number(x.games) || 0 : 0;
      const dm = x ? Number(x.duration) / 60 : 0; // 그 증강을 든 사람들의 기대 분당 산출(등수의 "빌드 기대치" 재료)
      const e = (x && dm > 0) ? { dmg: Number(x.damage) / dm, taken: Number(x.taken) / dm, mit: Number(x.mitigated) / dm,
        cc: Number(x.cc) / dm, heal: Number(x.heal) / dm, gold: Number(x.gold) / dm } : null;
      return { id, name: (x && (x.localName || x.name)) || "", icon: (x && x.icon) || "", rarity: (x && x.rarity) || null,
        winRate: (x && x.winRate != null && g >= 200) ? Number(x.winRate) : null, e }; // 표본 200판 미만은 픽 질 판단에 안 씀
    });
  }
  // 검색풀보다 먼저 나온 신규 증강(패치 직후)은 여기서 CommunityDragon 으로 메운다 — "증강 2157" 로 두지 않는다
  try { await fillUnknownAugments((p.rows || []).flatMap(r => r.augments || [])); } catch {}
  return p;
}
// PNG 바이트를 ingest 워커 /share로 전달(binary POST) → {ok,url}. 실패해도 던지지 않고 {ok:false} 반환.
function postShareToWorker(buf) {
  return new Promise((resolve) => {
    let u; try { u = new URL(String(SHARE_ENDPOINT).replace(/\/$/, "") + "/share"); } catch { return resolve({ ok: false, error: "bad-endpoint" }); }
    const lib = u.protocol === "http:" ? http : https; // prod=https(워커), 테스트=http mock 허용
    const rq = lib.request({ method: "POST", hostname: u.hostname, path: u.pathname, port: u.port || (u.protocol === "http:" ? 80 : 443),
      headers: { "Content-Type": "image/png", "Content-Length": buf.length, "X-Contrib-Token": SHARE_TOKEN } },
      r => { const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => { try { const j = JSON.parse(Buffer.concat(ch).toString("utf8")); resolve(j && typeof j === "object" ? j : { ok: false, error: "bad-response" }); } catch { resolve({ ok: false, error: "bad-response", status: r.statusCode }); } }); });
    rq.on("error", e => resolve({ ok: false, error: String((e && e.message) || e) }));
    rq.setTimeout(30000, () => { rq.destroy(); resolve({ ok: false, error: "timeout" }); });
    rq.end(buf);
  });
}
// 공유 렌더 스냅샷(JSON)을 ingest 워커 /share-meta로 전달 — 사이트 /r/<id> 살아있는 풀이 페이지 재생용(postShareToWorker 동형).
function postShareMetaToWorker(buf) {
  return new Promise((resolve) => {
    let u; try { u = new URL(String(SHARE_ENDPOINT).replace(/\/$/, "") + "/share-meta"); } catch { return resolve({ ok: false, error: "bad-endpoint" }); }
    const lib = u.protocol === "http:" ? http : https;
    const rq = lib.request({ method: "POST", hostname: u.hostname, path: u.pathname, port: u.port || (u.protocol === "http:" ? 80 : 443),
      headers: { "Content-Type": "application/json", "Content-Length": buf.length, "X-Contrib-Token": SHARE_TOKEN } },
      r => { const ch = []; r.on("data", c => ch.push(c)); r.on("end", () => { try { const j = JSON.parse(Buffer.concat(ch).toString("utf8")); resolve(j && typeof j === "object" ? j : { ok: false, error: "bad-response" }); } catch { resolve({ ok: false, error: "bad-response", status: r.statusCode }); } }); });
    rq.on("error", e => resolve({ ok: false, error: String((e && e.message) || e) }));
    rq.setTimeout(30000, () => { rq.destroy(); resolve({ ok: false, error: "timeout" }); });
    rq.end(buf);
  });
}
async function summonerRecord(riotId) {
  const cfg = riotCfg(); if (!cfg.apiKey) throw Object.assign(new Error("no key"), { code: "NO_KEY" });
  const reg = (cfg.regional || "asia") + ".api.riotgames.com";
  let gn = String(riotId || "").trim(), tl = cfg.tagLine || "KR1";
  if (gn.indexOf("#") >= 0) { const a = gn.split("#"); gn = a[0].trim(); tl = (a[1] || "").trim() || tl; }
  const acct = await riotGet(reg, "/riot/account/v1/accounts/by-riot-id/" + encodeURIComponent(gn) + "/" + encodeURIComponent(tl));
  const puuid = acct.puuid;
  const ids = await riotGet(reg, "/lol/match/v5/matches/by-puuid/" + puuid + "/ids?queue=450&start=0&count=20");
  const dd = await champDD();
  const matches = [];
  for (let i = 0; i < ids.length; i += 5) { const b = await Promise.all(ids.slice(i, i + 5).map(id => riotGet(reg, "/lol/match/v5/matches/" + id).catch(() => null))); b.forEach(x => { if (x) matches.push(x); }); }
  let wins = 0, total = 0, k = 0, d = 0, a = 0, tDmg = 0, tTaken = 0, tDur = 0; const by = new Map(), recent = [], form = [];
  for (const mt of matches) {
    const info = mt.info || {}, p = (info.participants || []).find(x => x.puuid === puuid); if (!p) continue;
    total++; const w = !!p.win; if (w) wins++; k += p.kills || 0; d += p.deaths || 0; a += p.assists || 0;
    tDmg += p.totalDamageDealtToChampions || 0; tTaken += p.totalDamageTaken || 0; tDur += info.gameDuration || 0; // 칼바람 의미지표(분당 딜량/받은피해)용
    const cd = dd.get(p.championName) || { name: p.championName, icon: "" };
    const c = by.get(p.championName) || { name: cd.name, icon: cd.icon, games: 0, wins: 0 }; c.games++; c.wins += w ? 1 : 0; by.set(p.championName, c);
    if (recent.length < 10) { const its = []; for (let n = 0; n < 6; n++) { const id = p["item" + n]; its.push(id ? `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/item/${id}.png` : ""); }
      const dur = info.gameDuration || 0; const ratio = ((p.kills || 0) + (p.assists || 0)) / Math.max(1, p.deaths || 0);
      recent.push({ name: cd.name, icon: cd.icon, win: w, taken: p.totalDamageTaken || 0, items: its, dmg: p.totalDamageDealtToChampions || 0, gold: p.goldEarned || 0, mk: p.largestMultiKill || 0, dur: Math.floor(dur / 60) + ":" + String(dur % 60).padStart(2, "0"), date: "" }); } // 칼바람 KDA·CS·레벨 무의미=미수집
    if (form.length < 20) form.push(w); // 20게임 승패 스트립(1:2 그라데이션 사각형)에 맞춰 20판 — 개인기록(lcu_personal)도 slice(0,20)로 일치
  }
  const champs = [...by.values()].map(c => ({ name: c.name, icon: c.icon, games: c.games, winRate: Math.round(c.wins / c.games * 100), thin: c.games < 3 })).sort((x, y) => y.games - x.games);
  return { who: gn + "#" + tl, searched: true, standard: { total, wins, winRate: total ? Math.round(wins / total * 100) : 0, avgDpm: tDur > 0 ? Math.round(tDmg / (tDur / 60)) : 0, avgTaken: tDur > 0 ? Math.round(tTaken / (tDur / 60)) : 0, form, recent, champs } };
}
const SHARD_NAME = { 5001: "체력", 5005: "공격 속도", 5007: "스킬 가속", 5008: "적응형 능력치", 5010: "이동 속도", 5011: "체력 증가", 5013: "강인함 및 둔화 저항" };

// ── 2026-07-09 인게임(픽창) 모드 — 픽창 읽기+픽 추천(승률·아군시너지)+인게임 상대분석. 데이터 모드분리(일칼 q450 / 증바람 q2400). 룬표시는 UI가 기존 /api/champ 재사용. ──
let _champIdMap = null;
async function champIdMap() { // 숫자 championId → {name(현지),icon}
  if (_champIdMap && _champIdMap.size) return _champIdMap;
  const m = new Map();
  try { const j = await fetchJsonU(`https://ddragon.leagueoflegends.com/cdn/${DDV}/data/ko_KR/champion.json`);
    for (const k in (j.data || {})) { const c = j.data[k]; if (c && c.key) m.set(Number(c.key), { name: c.name, icon: `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/champion/${c.image.full}` }); } } catch {}
  if (m.size) _champIdMap = m;
  return m;
}
// ★2026-07-22 캐시: 이건 픽창에서 2.5초마다 호출된다(index.html igPoll). 캐시가 없어서 매번 1만4천여 행을 돌며
//   NFKC 정규화를 수만 번 다시 했고, 그게 Electron 메인 프로세스(=창의 UI 스레드)에서 돌아 픽창 내내 끊겼다.
//   norm() 도 챔프 이름이 173종뿐이라 행 루프 밖 작은 메모로 재사용한다.
const _pairWRMem = new Map(); // mode → { map, at }
async function champPairWR(mode) { // norm(a)|norm(b) → 팀 챔프쌍(궁합) 승률. 일칼=코호트 observedChampionPairs / 증강=season2 챔프쌍 풀. 양쪽 필드shape 대응.
  const cached = _pairWRMem.get(mode);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.map;
  const map = new Map();
  const _nm = new Map(), nrm = s => { let v = _nm.get(s); if (v === undefined) { v = norm(s); _nm.set(s, v); } return v; };
  try {
    let rows = [];
    if (mode === "augment") { rows = (await loadPool("search-pool-all-observedChampionPairs-season2.json")) || []; }
    else { const r = await hydrateStdReport(await loadLite("standard-aram-cohort-all.json"), ["pairs"]); rows = (r.personalRecommendations && r.personalRecommendations.observedChampionPairs) || r.observedChampionPairs || []; } // 쌍 풀만 필요
    for (const x of rows) { if (!x) continue;
      const cs = (x.champions || []).map(c => c && (c.localName || c.name)).filter(Boolean);
      const a = cs[0] || x.championName || x.leftLabel || x.leftLocalName || x.leftName || x.a;
      const b = cs[1] || x.rightLabel || x.rightLocalName || x.rightName || x.b;
      const g = Number(x.games || 0);
      const wr = Number(x.winRate != null ? x.winRate : (g ? (Number(x.wins || 0) / g * 100) : NaN));
      if (!a || !b || !Number.isFinite(wr) || g < 5) continue; // 표본 5판 미만 쌍 제외(노이즈)
      const na = nrm(a), nb = nrm(b);
      map.set(na + "|" + nb, wr); map.set(nb + "|" + na, wr);
    }
  } catch {}
  if (map.size) _pairWRMem.set(mode, { map, at: Date.now() }); // 빈 결과는 캐시 안 함(데이터 늦게 오는 첫 호출이 굳지 않게)
  return map;
}
// ── 2026-09-25 증강 칼바람 픽창 조합 모델 ─────────────────────────────────────────────────
//   운영자 결정: "픽창 추천 — 바꾼다. 대신 아는 척을 크게 해선 안돼. 앞라인이 비어서 같은 소리는 하지 마." (결정 보드 '픽창 추천 고르는 법')
//   재료 = static/api/pick-model-season2.json (aram_mayhem_auto/tools/am_pick_model_build.mjs — 최근 6주 증바람 판을 팀 대 팀 승패로 센 것).
//   F(팀) = Σ 챔프 힘 a + Σ 아군 짝 궁합 s(윗삼각 i<j). 예상 승률 = 실제 상대 팀들 힘 분포(opp 분위 401개)에 대고 σ(F − 상대) 평균.
//   ⚠️ 이유 문구를 만들지 마라(운영자 금지) — 숫자와 순서만 낸다. 모델에 없는 챔프(새 챔프)는 0(= 평균 챔프)으로 둔다.
//   ⚠️ 증강 칼바람만. 일반 칼바람 픽창은 종전 식 그대로(표본이 22배 작아 따로 시험해야 한다).
const PM_SWAP_MARGIN = 1.0; // 대기석 최고가 지금 내 챔프보다 이만큼(%p) 넘게 높을 때만 바꾸라고 한다 — 작은 차이로 아는 척하지 않는다
let _pm = null, _pmFailAt = 0;
async function pickModel() {
  // 못 받으면 60초 동안 다시 안 두드린다 — 픽창은 1~2초마다 묻는데, 매번 원격 실패 + 1.5초 재시도를 기다리면 종전 식 화면까지 늦게 뜬다.
  if (Date.now() - _pmFailAt < 60000) return null;
  let j; try { j = await loadData("pick-model-season2.json"); } catch { _pmFailAt = Date.now(); return null; }
  if (_pm && _pm.src === j) return _pm;
  if (!j || j.kind !== "pick-model" || !Array.isArray(j.ids) || !Array.isArray(j.a) || !Array.isArray(j.s) || !Array.isArray(j.opp) || !j.opp.length) return null;
  const C = j.ids.length;
  if (j.a.length !== C || j.s.length !== C * (C - 1) / 2) return null;
  const base = new Float64Array(C); for (let i = 0; i < C; i += 1) base[i] = i * (C - 1) - i * (i - 1) / 2 - i - 1; // s 칸 = base[i] + j (i<j)
  // t = 누름값 — 만들 때 떼어 둔 판에서 "띄운 숫자 = 실제 승률" 이 되게 고른 값(1 보다 작으면 숫자를 50% 쪽으로 누른다 · 아는 척 막기). 없으면 1.
  const t = Number(j.t) > 0 ? Number(j.t) : 1;
  _pm = { src: j, C, ix: new Map(j.ids.map((id, i) => [Number(id), i])), a: Float64Array.from(j.a), s: Float64Array.from(j.s), base, opp: Float64Array.from(j.opp), t };
  // ★2026-09-25 팀 합 모자람·넘침(res) — 운영자: "어떤 챔피언이든 역할군으로 생각할것도 아니고, 각각의 독립적인 항목으로 봤을때, 조화에 대한 계산이 될거아니냐."
  //   챔프마다 실제 경기 분당 양(딜·받아 낸 피해·회복·CC)의 표준화 값 z · 팀 다섯의 합 R · 꺾인 선 beta. 식은 제작 도구
  //   aram_mayhem_auto/tools/am_pick_model_build.mjs ②″ 와 같다(식을 바꾸면 둘 다). 칸이 없거나 모양이 틀리면(옛 파일) 짝 계산만.
  const r = j.res;
  if (r && Array.isArray(r.met) && Array.isArray(r.z) && Array.isArray(r.knots) && Array.isArray(r.beta)) {
    const NM = r.met.length, KQ = Array.isArray(r.knots[0]) ? r.knots[0].length : 0, NF = NM * (1 + KQ);
    if (NM > 0 && r.z.length === C * NM && r.knots.length === NM && r.knots.every(k => Array.isArray(k) && k.length === KQ) && r.beta.length === NF) {
      _pm.res = { NM, KQ, z: Float64Array.from(r.z), knots: r.knots.map(k => Float64Array.from(k)), beta: Float64Array.from(r.beta) };
    }
  }
  return _pm;
}
function pmTeamF(m, champIds) { // 그 다섯의 팀 힘 F = Σ 챔프 힘 + Σ 짝 값 + 팀 합 모자람·넘침(res 가 있을 때). 모르는 챔프·빈 자리 = 0(평균)
  const ix = []; for (const id of champIds) { const i = m.ix.get(Number(id)); if (i != null && !ix.includes(i)) ix.push(i); }
  let f = 0; for (const i of ix) f += m.a[i];
  for (let x = 0; x < ix.length; x += 1) for (let y = x + 1; y < ix.length; y += 1) { const i = Math.min(ix[x], ix[y]), j = Math.max(ix[x], ix[y]); f += m.s[m.base[i] + j]; }
  const r = m.res;
  if (r) {
    const R = new Float64Array(r.NM); for (const i of ix) for (let k = 0; k < r.NM; k += 1) R[k] += r.z[i * r.NM + k];
    let q = 0; for (let k = 0; k < r.NM; k += 1) { f += r.beta[q++] * R[k]; for (let j = 0; j < r.KQ; j += 1) f += r.beta[q++] * Math.max(0, R[k] - r.knots[k][j]); }
  }
  return f;
}
function pmTeamWin(m, champIds) { // 그 다섯으로 가면 우리 팀 예상 승률(%) — 화면엔 안 띄운다(추천 고르는 규칙에만 쓴다)
  const f = pmTeamF(m, champIds);
  let p = 0; for (const o of m.opp) p += 1 / (1 + Math.exp(-m.t * (f - o)));
  return p / m.opp.length * 100;
}
// ★2026-09-25 조합 완성도(0~100점) — 화면에 띄우는 숫자. 운영자: "조합의 완성도를 니가 좋고 나쁨에 대한 정보를 지표처럼 내라고" ·
//   "지금 챔피언을 뭘로 바꿔야 얼만큼 더 좋고 나쁨을 표시하라고" (결정 보드 '픽창 추천 고르는 법' 4차 "이대로 넣기").
//   = 그 다섯의 팀 힘 F 가 실제 증바람 팀 조합들의 팀 힘 줄(opp 분위 401칸, 오름차순) 가운데 서는 자리. 50 = 딱 중간.
//   예상 승률(%)을 띄웠더니 62.5% 가 떠도 지면 상심이 컸다 — 승률이 아니라 조합이 얼마나 갖춰졌나로 읽히게 한다.
function pmTeamPct(m, champIds) {
  const f = pmTeamF(m, champIds), o = m.opp, n = o.length;
  if (f <= o[0]) return 0;
  if (f >= o[n - 1]) return 100;
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (o[md] <= f) lo = md; else hi = md; }
  return Math.round((lo + (f - o[lo]) / ((o[hi] - o[lo]) || 1)) / (n - 1) * 100);
}
function ingameMock(kind) { // 라이브 클라 없이 UI/분석 검증용 가짜 세션
  // ★2026-09-25 시험용 임의 픽창 "cs:아군넷|내챔프|대기석…"(챔프 번호 · 쉼표) — 목업·검증 전용. 실제 게임 세션에는 안 쓰인다.
  const cs = /^cs:([\d,]+)\|(\d+)\|([\d,]*)$/.exec(String(kind || ""));
  if (cs) {
    const al = cs[1].split(",").map(Number).filter(Boolean), me = Number(cs[2]), bn = cs[3] ? cs[3].split(",").map(Number).filter(Boolean) : [];
    const myTeam = [...al.slice(0, 2).map((c, i) => ({ cellId: i, championId: c })), { cellId: 2, championId: me }, ...al.slice(2).map((c, i) => ({ cellId: 3 + i, championId: c }))];
    return { phase: "ChampSelect", session: { localPlayerCellId: 2, benchEnabled: true, rerollsRemaining: 1, myTeam, benchChampions: bn.map(c => ({ championId: c })) } };
  }
  if (kind === "loading") return { phase: "GameStart" }; // Live 데이터 아직 안 뜬 전환 구간(로딩 뷰 검증)
  if (kind === "ingame-noself") return { phase: "InProgress", live: { activePlayer: { summonerName: "" }, allPlayers: [ // self 식별 실패(빈 summonerName) 검증 — 조합 오버레이 폴백
    { championName: "미스 포츈", summonerName: "X1", team: "ORDER" }, { championName: "루시안", summonerName: "X2", team: "ORDER" }, { championName: "브랜드", summonerName: "X3", team: "ORDER" }, { championName: "쓰레쉬", summonerName: "X4", team: "ORDER" }, { championName: "말파이트", summonerName: "X5", team: "ORDER" },
    { championName: "제이스", summonerName: "Y1", team: "CHAOS" }, { championName: "이즈리얼", summonerName: "Y2", team: "CHAOS" }, { championName: "카이사", summonerName: "Y3", team: "CHAOS" }, { championName: "룰루", summonerName: "Y4", team: "CHAOS" }, { championName: "오른", summonerName: "Y5", team: "CHAOS" } ] } };
  if (kind === "ingame") return { phase: "InProgress", live: { activePlayer: { summonerName: "나" }, allPlayers: [
    { championName: "미스 포츈", summonerName: "나", team: "ORDER" }, { championName: "루시안", summonerName: "A", team: "ORDER" }, { championName: "브랜드", summonerName: "B", team: "ORDER" }, { championName: "쓰레쉬", summonerName: "C", team: "ORDER" }, { championName: "말파이트", summonerName: "D", team: "ORDER" },
    { championName: "제이스", summonerName: "E", team: "CHAOS" }, { championName: "이즈리얼", summonerName: "F", team: "CHAOS" }, { championName: "카이사", summonerName: "G", team: "CHAOS" }, { championName: "룰루", summonerName: "H", team: "CHAOS" }, { championName: "오른", summonerName: "I", team: "CHAOS" } ] } };
  return { phase: "ChampSelect", session: { localPlayerCellId: 2, benchEnabled: true, rerollsRemaining: 1,
    myTeam: [ { cellId: 0, championId: 21 }, { cellId: 1, championId: 236 }, { cellId: 2, championId: 63 }, { cellId: 3, championId: 412 }, { cellId: 4, championId: 54 } ],
    benchChampions: [ { championId: 22 }, { championId: 81 }, { championId: 39 }, { championId: 64 }, { championId: 157 } ] } };
}
async function ingameState(mode, mock, opt = {}) {
  let phase = "Off", session = null, live = null, detectedMode = null;
  if (mock) { const m = ingameMock(mock); phase = m.phase; session = m.session || null; live = m.live || null; if (mock === "augment-cs" || /^cs:/.test(mock)) { detectedMode = "augment"; } else { detectedMode = "standard"; } } // ★mock도 실게임처럼 gameMode 감지 흉내 → detectedMode 설정(일반 챔프 mock=standard). 안 하면 클라 전달모드(탐색 augment) 그대로라 상세가 엉뚱 모드로 조회됨
  else { phase = await ingameGameflowPhase();
    if (phase === "ChampSelect") { session = await ingameChampSelect(); }
    else if (phase === "InProgress" || phase === "GameStart" || phase === "Reconnect") { live = await ingameLiveGame(); }
    if (phase && phase !== "Off" && phase !== "None") { const q = await ingameQueue(); if (q && q.mode) detectedMode = q.mode; } // ★로비 포함 어느 단계든 큐 감지 → 픽창 들어가기 전에 미리 모드 확정(증강 탐색↔일반 전환). gameMode 기준.
    // ★출시일 플립 포인트: 클래식(2450)은 큐 감지는 정확히 되지만 표시부(테이블 청사진·풀·라벨 39지점)가 아직 augment/standard 2분기다.
    //   지금 "classic" 을 그대로 흘리면 safeTableMode 가 standard 로 흡수해 2450 게임에 일반칼바람(q450) 데이터가 뜬다.
    //   → 표시부가 classic 을 지원할 때까지는 증강 화면으로 보낸다(종전과 동일한 동작). 표시부 배선 후 이 두 줄만 지우면 된다.
    if (detectedMode === "classic") detectedMode = "augment";
  }
  if (detectedMode) mode = detectedMode; // ★실제 큐(gameMode)로 모드 자동판별 — 수동 토글과 무관하게 올바른 데이터·룬
  const idMap = await champIdMap();
  const metaList = await champMeta(mode).catch(() => []);
  const metaBy = new Map((metaList || []).map(c => [norm(c.name), c]));
  const ann = (cid) => { const dd = idMap.get(Number(cid)); if (!dd) return null; const meta = metaBy.get(norm(dd.name)) || null; return { championId: Number(cid), name: dd.name, icon: dd.icon, winRate: meta ? meta.winRate : null, tier: meta ? meta.tier : null, games: meta ? meta.games : 0 }; };

  if (phase === "ChampSelect" && session) {
    const myCell = session.localPlayerCellId;
    const myTeam = (session.myTeam || []).map(p => { const a = ann(p.championId || p.championPickIntent); return { ...(a || { championId: 0, name: "", icon: "", winRate: null, tier: null, games: 0 }), cellId: p.cellId, isSelf: p.cellId === myCell }; });
    const bench = (session.benchChampions || []).map(b => ann(b.championId)).filter(Boolean);
    const me = myTeam.find(p => p.isSelf) || null;
    // ★2026-09-25 증강 칼바람 = 조합 모델. 내 챔프가 정해지면 바로 계산한다 — 아직 안 정해진 아군 자리는 0(= 평균 챔프,
    //   모델에 없는 새 챔프와 같은 처리)으로 두고, 정해지는 대로 다음 조회(1~2초)에서 다시 센다.
    //   운영자(09-25): "그 진입하자 마자 나오는 창도 똑같이 수정본처럼 나와야" — 종전엔 아군 넷이 다 정해질 때까지(allyIds.length === 4)
    //   아래 옛 식으로 그려서, 픽창 들어가자마자는 옛 화면이었다가 모두 정해진 뒤에야 새 화면으로 바뀌었다.
    //   아군 번호는 세션 원본에서 읽는다 — 이름표(ann)가 아직 안 붙은 아군도 모델에는 들어가게.
    //   opt.legacy = 종전 식 강제(목업에서 옛 화면과 나란히 보이려는 시험용).
    //   ★09-26: 내 챔프가 아직 없거나 모델을 못 받았으면 옛 식으로 떨어지지 않고 기다림(waiting)을 보낸다 — 아래 블록 끝 참고.
    if (mode === "augment" && !opt.legacy) {
      const allyIds = (session.myTeam || []).filter(p => p.cellId !== myCell).map(p => Number(p.championId || p.championPickIntent) || 0).filter(Boolean);
      const pm = (me && me.championId) ? await pickModel().catch(() => null) : null;
      if (pm) {
        const wOf = cid => Math.round(pmTeamWin(pm, [...allyIds, cid]) * 10) / 10;
        const pOf = cid => pmTeamPct(pm, [...allyIds, cid]);
        const meW = wOf(me.championId), meP = pOf(me.championId);
        const benchW = bench.map(b => ({ ...b, teamWR: wOf(b.championId), pct: pOf(b.championId) }));
        const best = benchW.slice().sort((a, b) => b.teamWR - a.teamWR)[0] || null;
        const meRow = { ...me, teamWR: meW, pct: meP };
        const rec = (best && best.teamWR - meW > PM_SWAP_MARGIN) ? best : meRow;
        const ranked = [meRow, ...benchW].sort((a, b) => b.teamWR - a.teamWR);
        return { ok: true, phase, mode, view: "champselect", pickModel: true, benchEnabled: !!session.benchEnabled, rerollsRemaining: session.rerollsRemaining ?? null,
          me: meRow, myTeam, bench: benchW, myOptionsRanked: ranked, recommend: { ...rec, score: rec.teamWR }, teamComp: meW, teamPct: meP,
          model: { generatedAt: pm.src.generatedAt || "", games: pm.src.games || 0 }, detected: !!detectedMode };
      }
      // ★2026-09-26 증강 칼바람 픽창은 아래 옛 승률 식 화면을 절대 그리지 않는다.
      //   운영자(09-26): "여전히 픽창에 들어가자마자 아직도 %같은 잔재가 즉시 떴다가 바로 바뀐대로 조합처럼 뜨던데 … 챔피언별로 승률같은게 뜨다가
      //   다시 승률이 아니라 조합으로 바뀌게 되고". 픽창 첫 순간엔 세션에 내 자리·내 챔프 번호가 아직 없거나 조합 모델을 아직 못 받았을 수 있는데,
      //   그때 옛 식으로 떨어져 챔프마다 승률(%)을 그렸다가 1~2초 뒤 다음 조회에서 조합 화면으로 바뀌었다 — 그게 그 잔재다.
      //   이제는 기다림 한 줄만 보낸다: me = 내 챔프 아직 모름 · model = 조합 모델 받는 중 · model-fail = 못 받음(60초 뒤 다시 받는다).
      const waiting = !(me && me.championId) ? "me" : (Date.now() - _pmFailAt < 60000 ? "model-fail" : "model");
      return { ok: true, phase, mode, view: "champselect", pickModel: true, waiting, benchEnabled: !!session.benchEnabled, rerollsRemaining: session.rerollsRemaining ?? null,
        me: null, myTeam: [], bench: [], myOptionsRanked: [], recommend: null, detected: !!detectedMode };
    }
    const allies = myTeam.filter(p => !p.isSelf && p.name).map(p => p.name);
    const pairWR = await champPairWR(mode);
    const scoreOf = (o) => { let base = Number(o.winRate) || 0; if (pairWR && pairWR.size && allies.length) { let s = 0, n = 0; for (const al of allies) { const w = pairWR.get(norm(o.name) + "|" + norm(al)); if (w != null) { s += w; n++; } } if (n) base = base * 0.7 + (s / n) * 0.3; } return base; };
    const ranked = [me, ...bench].filter(Boolean).map(o => ({ ...o, score: Math.round(scoreOf(o) * 10) / 10, synergy: !!(pairWR && pairWR.size && allies.length) })).sort((a, b) => (b.score || 0) - (a.score || 0));
    // ★팀 조합 승률 — 각 팀원 solo승률을 나머지 팀원과의 궁합으로 보정(base*0.7+평균쌍승률*0.3), 팀 평균. 팀이 바뀔 때마다 갱신됨.
    const teamNames = myTeam.filter(p => p.name).map(p => p.name);
    const compOf = (name) => { let base = Number((metaBy.get(norm(name)) || {}).winRate); if (!Number.isFinite(base)) base = 50; let s = 0, n = 0; for (const t of teamNames) if (norm(t) !== norm(name)) { const w = pairWR.get(norm(name) + "|" + norm(t)); if (w != null) { s += w; n++; } } return { wr: n ? Math.round((base * 0.7 + (s / n) * 0.3) * 10) / 10 : Math.round(base * 10) / 10, pairs: n }; };
    myTeam.forEach(p => { if (p.name) { const c = compOf(p.name); p.compWR = c.wr; p.compPairs = c.pairs; } });
    const named = myTeam.filter(p => p.name && p.compWR != null);
    const teamComp = named.length ? Math.round(named.reduce((a, p) => a + p.compWR, 0) / named.length * 10) / 10 : null;
    const bestAlly = named.slice().sort((a, b) => b.compWR - a.compWR)[0] || null;
    const worstAlly = named.slice().sort((a, b) => a.compWR - b.compWR)[0] || null;
    return { ok: true, phase, mode, view: "champselect", benchEnabled: !!session.benchEnabled, rerollsRemaining: session.rerollsRemaining ?? null, me, myTeam, bench, myOptionsRanked: ranked, recommend: ranked[0] || null, teamComp, teamPairsKnown: named.reduce((a, p) => a + (p.compPairs || 0), 0), bestAlly: bestAlly ? bestAlly.name : null, worstAlly: worstAlly ? worstAlly.name : null, detected: !!detectedMode };
  }
  if (live && Array.isArray(live.allPlayers) && live.allPlayers.length) {
    const meName = live.activePlayer && (live.activePlayer.summonerName || live.activePlayer.riotIdGameName);
    const byName2 = new Map([...idMap.values()].map(x => [norm(x.name), x]));
    const ap = (p) => { const meta = metaBy.get(norm(p.championName)); const dd2 = byName2.get(norm(p.championName)); return { name: p.championName, icon: dd2 ? dd2.icon : "", summoner: p.summonerName || p.riotIdGameName || "", team: p.team, winRate: meta ? meta.winRate : null, tier: meta ? meta.tier : null, isSelf: (!!p.summonerName && p.summonerName === meName) || (!!p.riotIdGameName && p.riotIdGameName === meName) }; }; // ★summonerName 빈 신클라 대비 riotIdGameName로도 self 식별(안 하면 self 못 찾아 인게임 화면 통째 안 뜸)
    const players = live.allPlayers.map(ap);
    const selfP = players.find(p => p.isSelf) || null;
    const mySide = (players.find(p => p.isSelf) || players[0] || {}).team;
    const allies = players.filter(p => p.team === mySide), enemies = players.filter(p => p.team !== mySide);
    // ★양 팀 조합 승률(팀내 시너지 반영) + 상대 대비. 각 멤버 solo*0.7 + 팀내 평균쌍승률*0.3.
    const pairWR = await champPairWR(mode);
    const compTeam = (arr) => { const names = arr.map(p => p.name); arr.forEach(p => { let base = Number(p.winRate); if (!Number.isFinite(base)) base = 50; let s = 0, n = 0; for (const t of names) if (norm(t) !== norm(p.name)) { const w = pairWR.get(norm(p.name) + "|" + norm(t)); if (w != null) { s += w; n++; } } p.compWR = n ? Math.round((base * 0.7 + (s / n) * 0.3) * 10) / 10 : Math.round(base * 10) / 10; }); };
    compTeam(allies); compTeam(enemies);
    const teamAvg = (arr) => arr.length ? Math.round(arr.reduce((s, p) => s + (Number(p.compWR) || 50), 0) / arr.length * 10) / 10 : 50;
    const myComp = teamAvg(allies), enemyComp = teamAvg(enemies);
    const expectedWin = Math.max(5, Math.min(95, Math.round(50 + (myComp - enemyComp) * 1.2)));
    const strongestEnemy = enemies.slice().sort((a, b) => (Number(b.compWR) || 0) - (Number(a.compWR) || 0))[0] || null;
    const sAlly = allies.filter(p => !p.isSelf).slice().sort((a, b) => (Number(b.compWR) || 0) - (Number(a.compWR) || 0))[0] || null;
    return { ok: true, phase, mode, view: "ingame", me: selfP ? { name: selfP.name, icon: selfP.icon } : null, allies, enemies, expectedWin, myComp, enemyComp, strongestEnemy, strongestAlly: sAlly ? sAlly.name : null, detected: !!detectedMode, note: "상대 룬은 Riot이 실측을 가려서, 각 챔프 대표(최고승률) 룬 기준 예상치입니다. 조합=팀 궁합 반영." }; // ★me=self 챔프(클라 상세 오픈 폴백용)
  }
  // ★게임 시작~로딩 구간(InProgress/GameStart/Reconnect인데 Live Client Data 2999가 아직 안 뜬 상태): view:none으로 떨어뜨리지 말고
  //   로딩 인게임 뷰를 유지 → 픽창→게임 전환에서 오버레이가 잠깐 꺼졌다(닷지처럼) 다시 뜨는 공백 제거.
  if (phase === "InProgress" || phase === "GameStart" || phase === "Reconnect") {
    return { ok: true, phase, mode, view: "ingame", loading: true, detected: !!detectedMode };
  }
  return { ok: true, phase, mode, view: "none", detected: !!detectedMode }; // detected=실제 큐로 감지됨(클라 모드 동기화용)
}
// 룬 트리 구조(runesReforged) → perkId→{treeId,slot}, treeId→slots. 룬 페이지 조립용.
let _runeStruct = null;
async function runeTreeStruct() {
  if (_runeStruct) return _runeStruct;
  const perk = new Map(); const trees = new Map();
  try {
    const rr = await fetchJsonU(`https://ddragon.leagueoflegends.com/cdn/${DDV}/data/ko_KR/runesReforged.json`);
    for (const tree of (rr || [])) { const tid = Number(tree.id); const slots = []; (tree.slots || []).forEach((slot, si) => { const ids = (slot.runes || []).map(x => Number(x.id)); slots.push(ids); ids.forEach(id => perk.set(id, { treeId: tid, slot: si })); }); trees.set(tid, { id: tid, slots }); }
  } catch {}
  if (trees.size) _runeStruct = { perk, trees };
  return { perk, trees };
}
async function bestRunePage(name) { // 일반칼바람 최고승률 룬 페이지 조립(항상 유효한 9퍼크+스타일 반환, 데이터 부족분은 폴백)
  const struct = await runeTreeStruct();
  if (!struct.trees.size) return null;
  const r = await hydrateStdReport(await loadLite("standard-aram-cohort-all.json"), ["championAugment"]); // 룬 트리는 championAugment 만 읽는다
  const champRunes = topCombos(r, name, "augmentName", 0, 400) || []; // [{id,winRate,games,...}]
  const wrById = new Map(); for (const x of champRunes) { const id = Number(x.id); if (id) wrById.set(id, Number(x.winRate) || 0); }
  const bestInSlot = (ids) => { let best = null, bestWr = -1; for (const id of (ids || [])) { const w = wrById.has(id) ? wrById.get(id) : -0.5; if (w > bestWr) { bestWr = w; best = id; } } return best != null ? best : (ids && ids[0]); };
  const treeScore = (t) => { let s = 0, n = 0; (t.slots || []).forEach(sl => sl.forEach(id => { if (wrById.has(id)) { s += wrById.get(id); n++; } })); return n ? s / n : 0; };
  const treeArr = [...struct.trees.values()];
  // 주 트리 = 챔프 룬 승률 평균 최고(데이터 없으면 정밀8000)
  let primary = treeArr.slice().sort((a, b) => treeScore(b) - treeScore(a))[0] || struct.trees.get(8000) || treeArr[0];
  const keystone = bestInSlot(primary.slots[0]);
  const p1 = bestInSlot(primary.slots[1]), p2 = bestInSlot(primary.slots[2]), p3 = bestInSlot(primary.slots[3]);
  // 보조 트리 = 주 트리 제외 최고
  let secondary = treeArr.filter(t => t.id !== primary.id).sort((a, b) => treeScore(b) - treeScore(a))[0] || treeArr.find(t => t.id !== primary.id);
  const secCands = [...(secondary.slots[1] || []), ...(secondary.slots[2] || []), ...(secondary.slots[3] || [])];
  const secRanked = secCands.slice().sort((a, b) => (wrById.has(b) ? wrById.get(b) : -0.5) - (wrById.has(a) ? wrById.get(a) : -0.5));
  const s1 = secRanked[0], s2 = secRanked.find(x => x !== s1) || secRanked[1] || secCands[1];
  const selectedPerkIds = [keystone, p1, p2, p3, s1, s2, 5008, 5008, 5001].map(Number).filter(x => x); // 스탯파편=적응/적응/체력(안전 기본)
  if (selectedPerkIds.length < 9) return null; // 조립 실패 시 세팅 안 함(무효 페이지 방지)
  return { name, primaryStyleId: primary.id, subStyleId: secondary.id, selectedPerkIds };
}
function send(res, code, type, body) { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); }
// ★2026-07-22 번들 폴백: 원격 런타임으로 돌면 __dirname 은 userData/runtime 이고 거기엔 R2 가 배포하는 5개 파일만 있다.
//   그래서 폰트(public/fonts/*)처럼 런타임에 안 들어가는 정적 자산이 설치 유저에게 항상 404 였다(= 시스템 폰트로 렌더).
//   런타임 → 번들 순으로 찾는다. 안 바뀌는 자산이라 재다운로드도 필요 없다.
const BUNDLE_DIR = process.env.MAYHEM_BUNDLE_DIR || "";
// ★옛 설치본(오버레이보다 먼저 나온 셸)은 MAYHEM_BUNDLE_DIR 을 넘겨주지 않는다.
//   그러면 아래 자가완성·셸 교체가 "개발 환경"으로 오판해 통째로 건너뛴다(실측: 그래서 아무 일도 안 일어났다).
//   패키징된 Electron 안에서 도는 이상 설치 폴더는 resourcesPath 로 직접 찾을 수 있다.
function resolveAppBundleDir() {
  if (BUNDLE_DIR) return BUNDLE_DIR;
  try {
    const rp = process.resourcesPath;
    if (rp) for (const d of [path.join(rp, "app"), path.join(rp, "app.asar")]) {
      if (existsSync(path.join(d, "package.json"))) return d;
    }
  } catch {}
  return "";
}
const APP_DIR = resolveAppBundleDir();
// 자가완성이 받아둔 파일 보관함도 마찬가지다 — 옛 셸은 MAYHEM_CACHE_DIR 도 안 넘긴다.
//   런타임 캐시에서 돌고 있으면 그 부모가 userData 다(<userData>/runtime).
const RUNTIME_STORE_DIR = path.basename(__dirname) === "runtime"
  ? path.join(path.dirname(__dirname), "runtime_store")
  : path.join(CACHE_ROOT, "runtime_store");

// ── 런타임 자가완성 — "한 번 설치하면 영원히 갱신"을 실제로 지키는 부분 ─────────────
//  【왜 필요했나】 소프트업데이트가 받을 파일 목록은 runtime_sync.cjs 에 하드코딩돼 있었다.
//    그 파일은 설치 번들 안에 있어 갱신되지 않는다 = 새 파일이 하나라도 늘면 이미 깔린 앱은
//    그 파일만 영영 못 받는다. 그리고 새 코드가 그걸 require 하는 순간 조용히 죽는다.
//    (증강 오버레이의 reader.cjs / ocr_slots.cjs / panel.html / tessdata 가 실제로 이 사고를 냈다.)
//  【어떻게 고쳤나】 옛 부트스트랩이라도 server.mjs 만은 반드시 새것을 받아 실행한다.
//    그래서 목록을 여기서, 서명된 매니페스트에서 직접 읽어 내 폴더의 빠진 파일을 스스로 채운다.
//    앞으로 파일이 몇 개 늘든 재설치가 필요 없다 — 부트스트랩이 낡아도 이 코드가 메운다.
//  【안전】 부트스트랩과 똑같은 신뢰 사슬을 쓴다: ed25519 서명이 맞는 매니페스트만 믿고,
//    파일마다 sha256 을 대조한다. 이름은 경로 탈출이 불가능한 형태만 통과시킨다.
//  【낭비 방지】 받은 파일은 해시 이름으로 userData/runtime_assets 에 남긴다. 부트스트랩은 rev 가
//    오를 때마다 캐시 폴더를 통째로 지우는데, 그때 23MB tessdata 를 다시 받지 않고 여기서 복사한다.
const RUNTIME_R2_BASE = "https://pub-05f47b0b01de41feaa96c0efaedde627.r2.dev/companion-runtime";
const RUNTIME_PUBKEY_PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAIqn1Mw6sl0n47L1HTjyU4fZzx0023lN19tJh6oZ2tV4=\n-----END PUBLIC KEY-----\n";
const SAFE_RUNTIME_NAME = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

const sha256hex = buf => crypto.createHash("sha256").update(buf).digest("hex");
const fetchRuntimeFile = name => fetchBuf(RUNTIME_R2_BASE + "/" + name.split("/").map(encodeURIComponent).join("/"));

async function healRuntime() {
  if (!APP_DIR) return { skipped: "dev" };                                      // 개발 트리 = 소프트업데이트 대상 아님
  if (path.resolve(__dirname) === path.resolve(APP_DIR)) return { skipped: "bundle" };  // 번들에서 실행 = 이미 완비
  let myRev = 0;
  try { myRev = parseInt(String(readFileSync(path.join(__dirname, "rev"), "utf8")).trim(), 10) || 0; } catch {}
  const manifestBuf = await fetchRuntimeFile("manifest.json");
  const sigBuf = await fetchRuntimeFile("manifest.json.sig");
  const pub = crypto.createPublicKey(RUNTIME_PUBKEY_PEM);
  if (!crypto.verify(null, manifestBuf, pub, Buffer.from(String(sigBuf).trim(), "base64"))) throw new Error("manifest signature invalid");
  const manifest = JSON.parse(manifestBuf.toString("utf8"));
  const rev = parseInt(manifest.rev, 10) || 0;
  // rev 가 다른 파일을 섞지 않는다. 더 새 rev 는 다음 실행 때 부트스트랩이 통째로 받아온다.
  if (myRev && rev !== myRev) return { skipped: "rev-mismatch", myRev, rev };
  try { mkdirSync(RUNTIME_STORE_DIR, { recursive: true }); } catch {}
  let kept = 0, reused = 0, fetched = 0;
  for (const entry of manifest.files || []) {
    const name = String((entry && entry.name) || "");
    const hash = String((entry && entry.sha256) || "");
    if (!SAFE_RUNTIME_NAME.test(name) || name.split("/").includes("..")) continue;
    if (!/^[0-9a-f]{64}$/.test(hash)) continue;
    const dest = path.join(__dirname, name);
    try { if (sha256hex(readFileSync(dest)) === hash) { kept++; continue; } } catch {}
    const store = path.join(RUNTIME_STORE_DIR, hash);
    let buf = null;
    try { const cached = readFileSync(store); if (sha256hex(cached) === hash) { buf = cached; reused++; } } catch {}
    if (!buf) {
      buf = await fetchRuntimeFile(name);
      if (sha256hex(buf) !== hash) throw new Error("hash mismatch: " + name);
      try { writeFileSync(store, buf); } catch {}
      fetched++;
    }
    try { mkdirSync(path.dirname(dest), { recursive: true }); } catch {}
    writeFileSync(dest, buf);
  }
  try {                                                                          // 이번 매니페스트에 없는 보관본 정리(무한 증식 방지)
    const live = new Set((manifest.files || []).map(f => String((f && f.sha256) || "")));
    for (const n of readdirSync(RUNTIME_STORE_DIR)) if (!live.has(n)) unlinkSync(path.join(RUNTIME_STORE_DIR, n));
  } catch {}
  return { rev, kept, reused, fetched };
}

let runtimeHealPromise = null;
// 한 번 실패했다고 다음 실행까지 기다리지 않는다 — 회선이 잠깐 끊겨도 스스로 채운다.
let runtimeRetryTimer = null;
function scheduleRuntimeRetry() {
  if (runtimeRetryTimer) return;
  runtimeRetryTimer = setTimeout(() => {
    runtimeRetryTimer = null;
    runtimeHealPromise = null;            // 다음 호출이 처음부터 다시 받게
    ensureRuntimeComplete().then(r => { if (!r || r.error) scheduleRuntimeRetry(); });
  }, 5 * 60 * 1000);
  try { runtimeRetryTimer.unref(); } catch {}
}

function ensureRuntimeComplete() {
  if (!runtimeHealPromise) {
    runtimeHealPromise = healRuntime()
      .then(r => { lastHealResult = r; if (r && (r.fetched || r.reused)) console.log("[runtime heal]", JSON.stringify(r)); return r; })
      .catch(e => { lastHealResult = { error: String((e && e.message) || e) }; scheduleRuntimeRetry(); return lastHealResult; });
  }
  return runtimeHealPromise;
}

// ── 2026-09-26 켜 둔 분석기가 새 판을 알아챈다 ─────────────────────────────────────────────
//   운영자(09-26): "두 칼바람 분석기에서 같은 데이터인데도 등수가 다르다는 제보도 들어오고 그래. 이것도 같이 해결해야하고".
//   원인(재현 완료): 분석기는 켤 때만 새 판을 받는다(위 healRuntime 도 "더 새 rev 는 다음 실행 때").
//     09-25 12:54~14:01 에 395번으로 켜 두고 끄지 않은 분석기는, 395번이 2판 등수 재료를 거절하고 먼저 읽은 1판을
//     계속 써서 같은 판을 다른 등수로 매겼다(제보 판 LCU-8394693154: 2판 = 캡처 2 그대로 · 1판 = 캡처 1 에 가장 가까움).
//   → 20분마다 서명된 매니페스트의 rev 만 본다. 지금 도는 rev 보다 새것이 있으면 화면 위에 한 줄로 알리고,
//     '다시 시작' 을 누르면 앱을 다시 켜서 적용한다. 픽창~게임이 끝날 때까지는 다시 켜지 않는다(게임 밖 판정 = outOfGameNow).
//   ⚠️ 저절로 다시 켜지 마라 — 설치 셸(main.cjs)은 켜질 때 창을 앞으로 띄워(show+focus) 롤 클라이언트의 앞자리를 뺏는다.
let _rtRev = null;
function runtimeRunningRev() {   // 지금 이 서버가 돌고 있는 폴더의 rev(설치 PC = userData/runtime/rev · 번들 = runtime.rev)
  if (_rtRev != null) return _rtRev;
  let r = 0;
  for (const n of ["rev", "runtime.rev"]) { try { const v = parseInt(String(readFileSync(path.join(__dirname, n), "utf8")).trim(), 10); if (v > r) r = v; } catch {} }
  return (_rtRev = r);
}
const RT_CHECK_MS = 20 * 60 * 1000;
const _rtLatest = { rev: 0, at: 0, busy: null };
async function runtimeLatestRev() {
  if (Date.now() - _rtLatest.at < RT_CHECK_MS) return _rtLatest.rev;
  if (_rtLatest.busy) return _rtLatest.busy;
  _rtLatest.busy = (async () => {
    try {
      const manifestBuf = await fetchRuntimeFile("manifest.json");
      const sigBuf = await fetchRuntimeFile("manifest.json.sig");
      const pub = crypto.createPublicKey(RUNTIME_PUBKEY_PEM);
      if (crypto.verify(null, manifestBuf, pub, Buffer.from(String(sigBuf).trim(), "base64")))   // 서명이 안 맞으면 모른 척(알리지 않는다)
        _rtLatest.rev = parseInt(JSON.parse(manifestBuf.toString("utf8")).rev, 10) || 0;
    } catch {}
    _rtLatest.at = Date.now();   // 못 받아도 20분은 다시 안 두드린다
    _rtLatest.busy = null;
    return _rtLatest.rev;
  })();
  return _rtLatest.busy;
}
async function runtimeRestart() {
  let app = null;
  try { const { createRequire } = await import("node:module"); const el = createRequire(import.meta.url)("electron"); app = el && typeof el === "object" ? el.app : null; } catch {}
  if (!app || typeof app.relaunch !== "function") return { ok: false, error: "not-app" };   // 개발용 node 실행 등 — 사람이 직접 껐다 켠다
  if (!(await outOfGameNow())) return { ok: false, error: "in-game" };                    // 픽창~게임 끝 = 누른 사람에게 "끝나고 다시" 라고만 알린다
  augmentOverlayStopOnExit();   // 옛 판 오버레이가 혼자 남지 않게 먼저 내린다(종료 때도 내리지만 순서를 확실히)
  app.relaunch();
  setTimeout(() => { try { app.quit(); } catch {} }, 200);   // 응답이 화면에 닿을 틈을 준다
  return { ok: true, restarting: true };
}


// ── 증강 오버레이 프로세스 관리 ──────────────────────────────────────────────
//   컴패니언과 별도 창(투명·클릭통과)이라 같은 프로세스 안에서 못 띄운다. 패키징된
//   Electron 은 자기 실행파일을 --augment-overlay 로 다시 띄우는 게 유일하게 확실한 길이다
//   (asar 안의 다른 엔트리를 직접 실행할 수는 없다).
let augmentOverlayProc = null;
function augmentOverlayEntry() {
  // 개발 트리를 맨 앞에 둔다 — 이 PC 에서는 "발행 직전 코드"를 그대로 쓰게 된다.
  //   다른 PC 에는 이 경로가 없으므로 런타임 캐시 → 설치 번들 순으로 내려간다.
  const cands = [
    path.resolve(__dirname, "../../aram_mayhem_auto/augment_overlay/main.cjs"), // 개발 리포
    path.resolve(__dirname, "augment_overlay", "main.cjs"),                     // 개발 미러
    path.join(__dirname, "augment_overlay", "main.cjs"),                        // 런타임 캐시
    APP_DIR ? path.join(APP_DIR, "augment_overlay", "main.cjs") : ""            // 설치 번들
  ].filter(Boolean);
  for (const f of cands) { try { if (existsSync(f)) return f; } catch {} }
  return "";
}
let lastHealResult = null;
function augmentOverlayStatus() {
  const entry = augmentOverlayEntry();
  return {
    ok: true,
    running: Boolean(augmentOverlayProc && augmentOverlayProc.exitCode === null),
    entry: entry || null,
    appDir: APP_DIR || null,          // 설치 폴더를 못 찾으면 자가완성·셸교체가 통째로 건너뛴다
    heal: lastHealResult,             // 런타임 자가완성 결과(왜 파일이 안 채워졌는지 여기서 보인다)
    obs: "http://127.0.0.1:8900/"
  };
}
// ── 옛 셸 자가교체 — "발행만으로 갱신"을 오버레이까지 확장 ──────────────────────
//  설치 셸(resources/app/main.cjs)은 R2 소프트업데이트가 닿지 않는 유일한 층이다. 오버레이보다
//  먼저 나온 설치본에는 --augment-overlay 분기가 아예 없어서, 오버레이 파일을 다 받아도 띄울 수가 없다.
//  → 셸 파일을 고쳐 쓰는 대신, 번들 옆에 우리 진입점을 하나 놓고 package.json 의 main 을 그리로 돌린다.
//    평소 실행은 원래 main.cjs 를 그대로 require 하므로 동작은 한 글자도 바뀌지 않는다.
//  안전장치: 문법 검사(vm) 통과분만 설치 · package.json 원본 백업 · 오버레이가 즉사하면 되돌림.
const OVERLAY_SHELL_NAME = "overlay_shell.cjs";
const NLCHAR = String.fromCharCode(10);
function overlayShellSource(originalMain) {
  return [
    '// 자동 생성 파일 — 증강 오버레이 진입점. 평소에는 원래 셸을 그대로 실행한다.',
    'const path = require(' + JSON.stringify('path') + ');',
    'if (process.argv.includes(' + JSON.stringify('--augment-overlay') + ')) {',
    '  const entry = process.env.AM_AUGMENT_OVERLAY_ENTRY || path.join(__dirname, ' + JSON.stringify('augment_overlay') + ', ' + JSON.stringify('main.cjs') + ');',
    '  try { require(entry); } catch (error) {',
    '    try {',
    '      const fs = require(' + JSON.stringify('fs') + ');',
    '      let dir = ' + JSON.stringify('') + '; try { dir = require(' + JSON.stringify('electron') + ').app.getPath(' + JSON.stringify('userData') + '); } catch (e) {}',
    '      if (!dir) dir = path.join(process.env.APPDATA || process.env.TEMP || ' + JSON.stringify('.') + ', ' + JSON.stringify('aram-mayhem-companion') + ');',
    '      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}',
    '      fs.appendFileSync(path.join(dir, ' + JSON.stringify('overlay-boot.log') + '),',
    '        ' + JSON.stringify('[') + ' + new Date().toISOString() + ' + JSON.stringify('] ') + ' + entry + ' + JSON.stringify(NLCHAR) + ' + ((error && error.stack) || String(error)) + ' + JSON.stringify(NLCHAR) + ');',
    '    } catch (e) {}',
    '    try { require(' + JSON.stringify('electron') + ').app.quit(); } catch (e) {}',
    '    process.exit(1);',
    '  }',
    '} else {',
    '  require(' + JSON.stringify('./' + originalMain) + ');',
    '}',
    ''
  ].join(NLCHAR);
}
// 반환: { ok, why } — ok=true 면 이 셸로 오버레이를 띄울 수 있다.
function ensureOverlayShell() {
  if (!APP_DIR) return { ok: false, why: "no-bundle" };
  const pkgPath = path.join(APP_DIR, "package.json");
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); } catch { return { ok: false, why: "no-package" }; }
  const current = String(pkg.main || "main.cjs");
  try {                                                        // 이미 오버레이를 아는 셸이면 손대지 않는다
    if (readFileSync(path.join(APP_DIR, current), "utf8").includes("--augment-overlay")) return { ok: true, why: "already" };
  } catch {}
  const original = current === OVERLAY_SHELL_NAME ? "main.cjs" : current;
  const shellPath = path.join(APP_DIR, OVERLAY_SHELL_NAME);
  const source = overlayShellSource(original);
  try { new vm.Script(source, { filename: shellPath }); } catch { return { ok: false, why: "bad-source" }; }
  try {
    const tmpShell = shellPath + ".tmp";
    writeFileSync(tmpShell, source);
    renameSync(tmpShell, shellPath);
    const backup = pkgPath + ".pre-overlay.bak";
    if (!existsSync(backup)) writeFileSync(backup, readFileSync(pkgPath));
    pkg.main = OVERLAY_SHELL_NAME;
    const tmpPkg = pkgPath + ".tmp";
    writeFileSync(tmpPkg, JSON.stringify(pkg, null, 2) + NLCHAR);
    renameSync(tmpPkg, pkgPath);
    console.log("[overlay shell] installed shim; original main =", original);
    return { ok: true, why: "installed" };
  } catch (error) {
    return { ok: false, why: "not-writable" };                 // 관리자 설치 등 쓰기 불가 → 화면에 이유를 표시한다
  }
}
function revertOverlayShell() {
  try {
    const pkgPath = path.join(APP_DIR, "package.json");
    const backup = pkgPath + ".pre-overlay.bak";
    if (existsSync(backup)) { writeFileSync(pkgPath, readFileSync(backup)); console.log("[overlay shell] reverted"); }
  } catch {}
}
// ★ELECTRON_RUN_AS_NODE 는 "빈 값으로 설정" 하면 안 되고 **지워야** 한다.
//   예전엔 상속을 끊으려고 ""(빈 문자열)을 넘겼는데, 윈도우에서 빈 문자열은 "없음"이 아니라 "빈 값으로 존재"다.
//   Electron 은 값이 아니라 존재 여부만 보므로, 그러면 GUI 가 아니라 순수 Node 로 떠서 --augment-overlay 를
//   못 알아듣고 exit code 9 로 즉사한다(실측). 내 PC 는 개발용 electron 갈래라 이 변수를 안 넘겨서 멀쩡했고,
//   설치본 갈래를 타는 다른 PC 는 전부 죽었다 = "스위치를 켜도 아무 일도 안 일어남"의 정체.
function overlayChildEnv(entry) {
  const env = { ...process.env, AM_AUGMENT_OVERLAY_ENTRY: entry, AM_PARENT_PID: String(process.pid) };
  if (APP_DIR) env.MAYHEM_BUNDLE_DIR = APP_DIR;          // 옛 셸은 이 값을 안 넘겨준다
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
// 오버레이를 띄우기 전에 "이 폴더로 정말 돌 수 있나"를 본다. 런타임(73MB)을 아직 받는
//   중이면 띄워도 OCR 이 안 된다 — 그럴 땐 띄우지 말고 다 받아질 때까지 스스로 다시 시도한다.
function overlayRuntimeReady(entry) {
  try {
    const dir = path.dirname(entry);                       // .../augment_overlay
    if (!existsSync(path.join(dir, "tessdata", "kor.traineddata"))) return false;
    if (!existsSync(path.join(dir, "reader.cjs"))) return false;
    // tesseract 는 런타임 폴더나 설치 번들 어느 쪽에 있어도 된다.
    const roots = [path.dirname(dir), APP_DIR].filter(Boolean);
    return roots.some(root => existsSync(path.join(root, "node_modules", "tesseract.js", "package.json"))
                           && existsSync(path.join(root, "node_modules", "tesseract.js-core", "package.json")));
  } catch { return false; }
}

// 스위치가 켜져 있는 한, 준비가 될 때까지 사람이 다시 누르지 않아도 알아서 재시도한다.
let overlayWantsOn = false;
let overlayRetryTimer = null;
function scheduleOverlayRetry(delay = 20000) {
  if (overlayRetryTimer || !overlayWantsOn) return;
  overlayRetryTimer = setTimeout(() => {
    overlayRetryTimer = null;
    if (!overlayWantsOn) return;
    if (augmentOverlayProc && augmentOverlayProc.exitCode === null) return;
    augmentOverlayStart().then(r => { if (!r || !r.ok) scheduleOverlayRetry(); }).catch(() => scheduleOverlayRetry());
  }, delay);
  try { overlayRetryTimer.unref(); } catch {}
}

let overlayStarting = null;
async function augmentOverlayStart() {
  if (overlayStarting) return overlayStarting;        // ★같은 순간의 두 번째 요청은 첫 번째 결과를 함께 쓴다
  overlayStarting = augmentOverlayStartOnce().finally(() => { overlayStarting = null; });
  return overlayStarting;
}
async function augmentOverlayStartOnce() {
  overlayWantsOn = true;
  if (augmentOverlayProc && augmentOverlayProc.exitCode === null) return augmentOverlayStatus();
  // 오버레이 파일은 자가완성으로 채워진다 — 다 차기 전에 띄우면 require 에서 죽는다.
  //   상한을 두어 회선이 아주 느려도 앱이 이 요청에 영영 묶이지는 않게 한다(다음 실행에 완성됨).
  await Promise.race([ensureRuntimeComplete(), new Promise(r => setTimeout(r, 120000))]);
  const entry = augmentOverlayEntry();
  if (!entry) { scheduleOverlayRetry(); return { ok: false, error: "overlay-not-installed" }; }
  // ⚠️ 예전엔 여기서 "아직 다 안 받았으면 띄우지 않는다"로 막았다. 그런데 그 판정이
  //   한 군데라도 어긋나면(설치 번들로 뜨는 경우 등) 영영 아무것도 안 뜨는 새 원인이 된다.
  //   지금은 글자 인식이 실패해도 reader 가 스스로 다시 시도하므로 막을 이유가 없다.
  //   덜 받았으면 띄워두고 뒤에서 마저 받는다 — 다 받아지는 순간 저절로 읽기 시작한다.
  if (!overlayRuntimeReady(entry)) {
    ensureRuntimeComplete();          // 뒤에서 계속 채운다
    scheduleOverlayRetry(30000);      // 그래도 못 뜨면 다시 시도
  }
  const { spawn } = await import("node:child_process");
  // 두 갈래다.
  //  (1) 개발 트리에 electron 바이너리가 있으면 그걸로 오버레이를 직접 띄운다.
  //      설치된 셸(main.cjs)은 R2 소프트업데이트 대상이 아니라 --augment-overlay 분기가
  //      아직 없을 수 있는데, 이 길은 셸과 무관하게 지금 당장 동작한다.
  //  (2) 없으면 자기 실행파일을 --augment-overlay 로 다시 띄운다(설치본 정식 경로).
  //   electron 바이너리는 오버레이 엔트리를 기준으로 찾는다(개발 트리에서만 존재).
  let devElectron = [
    path.resolve(path.dirname(entry), "..", "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    path.resolve(__dirname, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
    path.resolve(path.dirname(entry), "..", "node_modules/electron/dist/electron.exe"),
    path.resolve(path.dirname(entry), "../../mayhem-model/companion/node_modules/electron/dist/electron.exe"),
    path.resolve(__dirname, "node_modules/electron/dist/electron.exe")
  ].find(p => { try { return existsSync(p); } catch { return false; } }) || "";
  // 엔트리 옆에 electron_path.txt 가 있으면 그 바이너리를 쓴다(개발/발행 전 확인용).
  //   설치 셸의 main.cjs 는 소프트업데이트 대상이 아니라 --augment-overlay 분기가 아직
  //   없을 수 있고, 그러면 자기 자신이 한 번 더 떴다가 단일 인스턴스에 막혀 조용히 죽는다.
  //   이 파일은 발행 목록에 없으므로 다른 PC 에는 존재하지 않는다(정상 경로로 내려감).
  try {
    const hint = path.join(path.dirname(entry), "electron_path.txt");
    if (existsSync(hint)) {
      const hinted = readFileSync(hint, "utf8").trim();
      if (hinted && existsSync(hinted)) devElectron = hinted;
    }
  } catch {}
  const useDev = Boolean(devElectron);
  // ★설치 셸이 오버레이를 띄울 줄 아는 버전인지 먼저 본다.
  //   옛 셸(main.cjs 에 --augment-overlay 분기가 없음)에 이 인자를 주면 오버레이 대신 컴패니언이
  //   한 번 더 떴다가 단일 인스턴스 잠금에 막혀 조용히 죽는다 = 사용자에겐 "그냥 안 켜짐"으로만 보인다.
  let shimJustInstalled = false;
  if (!useDev) {
    const shell = ensureOverlayShell();
    if (!shell.ok) { augmentOverlayProc = null; return { ok: false, error: "shell-too-old" }; }
    shimJustInstalled = shell.why === "installed";
  }
  augmentOverlayProc = useDev
    ? spawn(devElectron, [entry], { detached: true, stdio: "ignore", windowsHide: true,
        env: { ...process.env, AM_PARENT_PID: String(process.pid) } })
    : spawn(process.execPath, ["--augment-overlay"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        // 엔트리를 환경변수로 넘긴다 — 셸의 main.cjs 가 이 값을 보고 오버레이로 부팅한다.
        env: overlayChildEnv(entry)
      });
  let exitedCode = null;
  augmentOverlayProc.on("error", () => { augmentOverlayProc = null; });
  augmentOverlayProc.on("exit", code => { exitedCode = code; augmentOverlayProc = null; });
  try { augmentOverlayProc.unref(); } catch {}
  // 띄웠다고 끝이 아니다 — 바로 죽는 경우가 실제로 있었다. 잠깐 보고 살아있을 때만 성공으로 돌려준다.
  await new Promise(r => setTimeout(r, 1800));
  if (!augmentOverlayProc || augmentOverlayProc.exitCode !== null) {
    const code = exitedCode === null ? (augmentOverlayProc && augmentOverlayProc.exitCode) : exitedCode;
    augmentOverlayProc = null;
    // 오버레이는 이미 떠 있으면 스스로 물러나며 0 으로 끝낸다 = 정상이다(되돌리면 안 된다).
    if (code === 0) return { ok: true, running: true, entry: augmentOverlayEntry() || null, alreadyRunning: true, obs: "http://127.0.0.1:8900/" };
    if (shimJustInstalled) revertOverlayShell();   // 진짜 실패일 때만 방금 바꾼 진입점을 원상복구한다
    return { ok: false, error: "overlay-exited", code };
  }
  return augmentOverlayStatus();
}
// ⚠️ 오버레이는 detached 로 띄운다(컴패니언이 잠깐 멈춰도 안 끊기게).
//   그래서 컴패니언을 꺼도 혼자 남는다 — 종료 때 반드시 같이 내려야 한다.
function augmentOverlayCancelRetry() {
  overlayWantsOn = false;
  if (overlayRetryTimer) { clearTimeout(overlayRetryTimer); overlayRetryTimer = null; }
}

function augmentOverlayStopOnExit() {
  if (augmentOverlayProc && augmentOverlayProc.exitCode === null) {
    try { process.kill(augmentOverlayProc.pid); } catch {}
  }
  augmentOverlayProc = null;
}
for (const signal of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, augmentOverlayStopOnExit);
}

async function augmentOverlayStop() {
  augmentOverlayCancelRetry();   // 껐으면 자동 재시도도 멈춘다
  // 내가 띄운 것만 내린다 — 이미지명으로 일괄 종료하면 남의 electron 까지 죽는다.
  if (augmentOverlayProc && augmentOverlayProc.exitCode === null) {
    try { process.kill(augmentOverlayProc.pid); } catch {}
  }
  augmentOverlayProc = null;
  return { ok: true, running: false };
}
async function sendAsset(res, rel, type) {
  const cands = [path.join(__dirname, rel)];
  if (BUNDLE_DIR && BUNDLE_DIR !== __dirname) cands.push(path.join(BUNDLE_DIR, rel));
  for (const f of cands) { try { return send(res, 200, type, await readFile(f)); } catch {} }
  send(res, 404, "text/plain", "not found");
}
// ★2026-07-23 자가복구 — 포로 관상가 그림이 설치 유저에게서 통째로 사라진 사고의 근본 대응.
//   설치된 셸의 runtime_sync.cjs 는 **소프트업데이트 대상이 아니다**(RUNTIME_FILES 목록에 자기 자신이 없다).
//   2026-07-22 에 발행 목록을 public/poro.png → public/poro_cutout.png 로 바꿨는데 설치본의 목록은 옛 이름에
//   묶여 있어 새 파일을 영영 안 받는다(실측: userData/runtime/public 에 index.html 하나뿐 · /poro_cutout.png = 404).
//   그러면 index.html 의 pim() 이 붙인 onerror="this.remove()" 가 <img> 자체를 지워 그림이 사라진다
//   (공유 스냅샷에도 <img> 없이 올라가 /r/<id> 링크에서도 같이 사라진다).
//   → 로컬(런타임캐시 → 번들) 어디에도 없으면 R2 에서 1회 받아 userData 에 캐시한다. 재설치 없이 스스로 복구된다.
//   ⚠️ 2026-08-20: 이 사고가 증강 오버레이에서 그대로 재발했다(reader.cjs 등 4개를 영영 못 받음).
//   그래서 파일 하나씩 폴백을 다는 대신 원인을 없앴다 — 위쪽 healRuntime() 이 서명된 매니페스트를 읽어
//   빠진 파일을 종류 불문 전부 채운다. 아래 함수는 그 이전부터 있던 개별 대응으로, 남겨둬도 해가 없다.
async function sendAssetSelfHeal(res, rel, type) {
  const healed = path.join(CACHE_ROOT, "runtime-assets", path.basename(rel));
  const cands = [path.join(__dirname, rel)];
  if (BUNDLE_DIR && BUNDLE_DIR !== __dirname) cands.push(path.join(BUNDLE_DIR, rel));
  cands.push(healed);
  for (const f of cands) { try { return send(res, 200, type, await readFile(f)); } catch {} }
  try {
    const buf = await fetchBuf(R2_BASE + "/companion-runtime/" + String(rel).split(path.sep).join("/"));
    if (buf && buf.length > 512) {
      try { mkdirSync(path.dirname(healed), { recursive: true }); await writeFile(healed, buf); } catch {}
      return send(res, 200, type, buf);
    }
  } catch {}
  send(res, 404, "text/plain", "not found");
}
async function sendFile(res, f, type) { try { send(res, 200, type, await readFile(f)); } catch { send(res, 404, "text/plain", "not found"); } }

// 메타 평균 KDA(추가 표기) — 표준=코호트 championRows, 증강=season2 풀(championRows엔 avgKills 누락이라 풀에서). 데이터 없으면 null(지어내지 않음).
async function metaChampKda(mode, name) {
  const q = norm(name);
  let k, d, a;
  if (mode === "augment") {
    const pool = await loadPool("search-pool-all-observedChampions-season2.json");
    const r = pool.find(x => norm(x.localName || x.name) === q || norm(x.key) === q) || {};
    k = r.avgKills; d = r.avgDeaths; a = r.avgAssists;
  } else {
    const co = await loadLite("standard-aram-cohort-all.json"); // championRows 만
    const c = (co.championRows || []).find(x => [x.localName, x.displayName, x.champion].some(v => norm(v) === q)) || {};
    k = c.avgKills; d = c.avgDeaths; a = c.avgAssists;
  }
  return (k != null && d != null && a != null) ? `${(+k).toFixed(1)}/${(+d).toFixed(1)}/${(+a).toFixed(1)}` : null;
}
// ── 로컬(루프백) 전용 접근 가드 — DNS 리바인딩 + 외부 오리진 CSRF 차단 ──
//   이 서버는 127.0.0.1 루프백에만 바인딩하지만, 그것만으로는 같은 PC의 브라우저(악성 웹페이지)가
//   자기 호스트명을 127.0.0.1로 리바인딩하거나 교차출처로 fetch/<img> 하는 것을 못 막는다.
//   따라서: ①Host 헤더 호스트명이 루프백이 아니면 거부(리바인딩된 브라우저는 공격자 원래 호스트명을 Host로 보냄),
//           ②Origin 헤더가 있으면 루프백이어야 함(교차출처 fetch 차단),
//           ③Sec-Fetch-Site 가 cross-site/cross-origin 이면 거부(<img> 등 교차출처 GET CSRF 차단).
//   정상 앱(127.0.0.1:port 로딩)의 same-origin 요청·주소창 최초 진입만 통과한다.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function loopbackHostname(hostHeaderValue) {
  const h = String(hostHeaderValue || "").trim();
  if (!h) return true; // Host 부재(비브라우저 로컬 도구) → 허용
  try { return LOOPBACK_HOSTS.has(new URL("http://" + h).hostname); } catch { return false; }
}
function isLocalRequest(req) {
  if (!loopbackHostname(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin) { try { if (!LOOPBACK_HOSTS.has(new URL(origin).hostname)) return false; } catch { return false; } }
  const sfs = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (sfs === "cross-site" || sfs === "cross-origin") return false;
  return true;
}
// ── MMR 조회 (2026-09-12) ────────────────────────────────────────────────────
//   화면의 "MMR 0000" 배지용. 점수 파일 전체는 67만 명 23MB 라 앱에 통째로 줄 수 없다 —
//   사이트가 64칸으로 나눠 올려두면(tools/am_mmr_publish_lookup.mjs) 자기 칸 하나(32KB)만 받는다.
//   ⚠️ 열쇠(소문자+공백제거한 이름#태그)와 칸 계산(FNV-1a % 64)은 그 도구와 **글자 그대로 같아야** 한다.
//      한 쪽만 바꾸면 조회가 통째로 빈다.
//   ⚠️ 태그가 다르면 다른 사람이다 — 이름만으로 찾는 폴백을 절대 만들지 마라.
//   ⚠️ 증강 칼바람(q2400) 전용. 일반 칼바람엔 MMR 이 없다(부르는 쪽에서 거른다).
const MMR_SHARDS = 64;
const mmrKey = s => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, "");   // ⚠️ NFC 로 모아야 한다 — 조합형(NFD)으로 붙여넣으면 눈에는 같은데 글자 수가 달라 열쇠가 안 맞는다(실측: 11자 vs 19자).
function mmrShardOf(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % MMR_SHARDS).toString(16).padStart(2, "0");
}
/* ★★2026-09-26 【사이트 서버에 이름을 보내 그 사람 줄만 받는다】 운영자: "칼바람 분석기에서도 조회할거고, 사람이 수동으로도 조회하고
     할건데, 엄청나게 많은 인기가 끌림에 따라 조회가 느려지는 경우가 발생한다면 그렇지 않아야해서. 기술적으로 조회 속도를 항상 일정하게"
   종전: 칸 파일(79만 바이트 · 2만 명)을 통째로 받아 그 안에서 찾았다 — 한 판 10명이면 약 9칸, 조회 창은 이름마다 칸을 차례로 받았다.
     칸은 사람 수에 비례해 커진다(09-26 130만 명).
   이제: 사이트 워커(aram_mayhem_auto/public/_worker.js amMmrLookupApi)가 칸에서 물어본 이름 줄만 꺼내 준다 — 여러 명도 요청 1번 · 수백 바이트.
   ⚠️ 워커가 답하지 못하면(옛 배포·네트워크·칸 못 읽음) 종전 길(칸 받기)로 넘어간다 — 종전 길을 지우지 마라.
   답: { ok, v:조회표 판(meta.updatedAt), r:[ null | {m:[MMR,판수,등수,티어(,지금 이름)], k:주 선택 3열} | {e:1} ] } — r[i] 는 보낸 i번째 이름. */
const MMR_API_URL = DATA_BASE + "/mmr/lookup";
function mmrApi(names, pick) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ k: names, pick: !!pick }), "utf8");
    let req = null;
    const budget = setTimeout(() => { if (req) req.destroy(new Error("budget")); }, 15000);   // 무통신 타이머만으로는 느린 회선에서 끝이 없다(fetchData 와 같은 이유)
    try {
      req = (MMR_API_URL.startsWith("http:") ? http : https).request(MMR_API_URL, { method: "POST", timeout: 10000, headers: { "Content-Type": "application/json", "Content-Length": body.length, "Accept-Encoding": "br, gzip, deflate" } }, r => {
        if (r.statusCode !== 200) { clearTimeout(budget); r.resume(); return reject(new Error("status " + r.statusCode)); }
        const enc = String(r.headers["content-encoding"] || "").toLowerCase();
        const dec = enc === "br" ? zlib.createBrotliDecompress() : enc === "gzip" ? zlib.createGunzip() : enc === "deflate" ? zlib.createInflate() : null;
        const src = dec ? r.pipe(dec) : r;
        if (dec) dec.on("error", e => { clearTimeout(budget); reject(e); });
        const ch = []; src.on("data", c => ch.push(c));
        src.on("end", () => {
          clearTimeout(budget);
          let j = null; try { j = JSON.parse(Buffer.concat(ch).toString("utf8")); } catch {}   // 조각을 모아 한 번에 푼다(한글이 조각 경계에서 깨지지 않게)
          if (!j || !j.ok || !Array.isArray(j.r) || j.r.length !== names.length) return reject(new Error("bad"));
          resolve(j);
        });
      });
    } catch (e) { clearTimeout(budget); return reject(e); }
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", e => { clearTimeout(budget); reject(e); });
    req.end(body);
  });
}
async function mmrLookup(riotId) {
  const key = mmrKey(riotId);
  if (!key || key.indexOf("#") < 1) return { ok: false, reason: "태그가 없다" };
  /* 먼저 사이트 서버에 그 사람 줄만 묻는다(위 mmrApi). 답하지 못하면 아래 종전 길(칸 받기). */
  try {
    const [a, meta] = await Promise.all([mmrApi([riotId], false), loadData("mmr/meta.json").catch(() => null)]);
    const r = a.r[0];
    if (!(r && r.e)) {
      const hit = r && Array.isArray(r.m) ? r.m : null;
      return {
        ok: true, found: !!hit,
        mmr: hit ? hit[0] : null, games: hit ? hit[1] : null, rank: hit ? (hit[2] || 0) : 0,
        tier: (hit && meta && meta.tiers) ? hit[3] : null,       // 아래 종전 길과 같은 규칙(meta 에 tiers 가 있을 때만 딱지)
        minGames: Number(meta && meta.minGames) || 10,
        meta: meta || null
      };
    }
  } catch {}
  const [shard, meta] = await Promise.all([
    loadData("mmr/" + mmrShardOf(key) + ".json").catch(() => null),
    loadData("mmr/meta.json").catch(() => null)
  ]);
  if (!shard) return { ok: false, reason: "조회표를 못 받았다" };
  const hit = shard.p && shard.p[key];          // [MMR, 판수, 등수(30판 이상 안에서 · 0=못 매김), 티어 번호(0=아이언 … 9=챌린저)]
  return {
    ok: true, found: !!hit,
    mmr: hit ? hit[0] : null, games: hit ? hit[1] : null, rank: hit ? (hit[2] || 0) : 0,
    /* ★2026-09-12 넷째 칸이 "꼭대기에 걸렸나" 에서 티어 번호로 바뀌었다.
       3000 천장을 걷어내 그 위도 값이 갈리므로 "3000+" 딱지는 더는 쓸 데가 없다. */
    /* ⚠️ 사이트 조회표가 아직 옛 형식이면 넷째 칸은 티어가 아니라 "3000 에 걸렸나"(0/1) 다.
       그대로 읽으면 2849 짜리에 아이언(0) 딱지가 붙는다 — 실제로 그렇게 떴다.
       새 형식인지는 meta 에 tiers 가 실려 있는지로 가른다. 없으면 딱지를 아예 안 준다. */
    tier: (hit && meta && meta.tiers) ? hit[3] : null,
    minGames: Number(shard.minGames) || 10,
    meta: meta || null
  };
}

/* ── 전적 개요 MMR 열 · 팀 평균 MMR (2026-09-25) ─────────────────────────────────────
   운영자 지시: "내 전적을 누르면 해당 계정들에 대해 MMR이 검색되는거지 … 이런 시스템을 갖췄을 때
     서버나 프로그램이나 부하 및 검색에 대한 로딩 이슈가 유저가 많아짐에 따라 발생하지 않도록"
   · 화면은 한 판(10명)에 **한 번만** 묻는다. 여기서 같은 칸끼리 묶어 칸 파일을 한 번씩만 연다(10명이면 보통 9칸).
   · 사이트의 /static/api 는 워커(_worker.js)를 거쳐 나간다 = 받는 파일 하나하나가 워커 요청이다.
     그래서 칸 파일은 조회표 판(meta.updatedAt · 1시간에 한 번 바뀐다)이 그대로인 동안 사이트에 다시 묻지 않는다.
     판이 바뀌었는지는 meta(600바이트) 하나로 본다. 종전 5분 캐시를 그대로 타면 상세를 열 때마다
     칸마다 "바뀌었나"(304)를 물어 한 판에 워커 요청이 ~10건씩 쌓인다.
   · 칸(약 75만 바이트 · 2만 명)을 통째로 메모리에 들고 있지 않는다 — 64칸을 다 들면 앱 힙이 수백 MB 다.
     필요한 사람 값만 뽑아 작게 들고, 칸은 디스크 사본으로 둔다(다음에 같은 판이면 디스크에서 읽는다).
   ⚠️ 열쇠·칸 계산은 mmrLookup 과 같은 mmrKey·mmrShardOf 다(사이트 조회표와 글자 그대로 같아야 한다).
   ⚠️ 태그가 다르면 다른 사람이다 — 이름만으로 찾는 폴백을 만들지 마라. 못 찾으면 null(화면은 " - "). */
const MMR_MANY_MAX = 12;                        // 한 판 10명 + 여유
const MMR_FILE_RECHECK_MS = 30 * 60 * 1000;     // 판이 그대로여도 30분이 지나면 한 번은 사이트에 묻는다(안전판 · 같으면 304 로 본문 없이 끝난다)
const _mmrFileSeen = new Map();                 // 칸 파일 → { ver, at } = 이 판으로 사이트와 맞춰 본 사본이 디스크에 있다
const _mmrPick = new Map();                     // 열쇠 → { ver, v } · v = [MMR, 판수, 등수, 티어] 또는 null(조회표에 없음)
const MMR_PICK_MAX = 4000;
let _mmrTopCut = { ver: "", v: null };          // 평균 점수 → 티어 딱지용(마스터·그마·챌린저 최저 점수) — 판마다 한 번
/* 칸 파일의 **본문 글자**를 돌려준다(없으면 null). 통째 JSON.parse 는 하지 않는다 —
   칸 하나(75만 바이트 · 2만 명)를 해석하면 2만 명 몫 객체가 한꺼번에 생겨, 상세를 열 때마다 수십 MB 찌꺼기와
   앱 창(서버가 Electron 메인 프로세스에서 돈다) 멈칫이 생겼다(09-25 실측: 64판 연속 조회에 134 → 561MB · 쉬면 150MB 로 돌아옴).
   그 사람 한 줄만 꺼내는 건 mmrPickFromText 가 한다.
   ⚠️ loadData 를 안 거친다 — 그 5분 캐시가 준 사본은 어느 판 것인지 몰라 판 기록을 못 남기고, 그러면 5분 동안 매번 통째 해석으로 빠졌다.
      대신 디스크 사본·.meta(ETag) 는 loadData 와 **같은 파일**을 쓴다(내 배지·MMR 조회 창과 사본을 나눠 쓴다).
   순서: 같은 판 + 30분 안 → 디스크 사본 그대로(요청 0) · 아니면 사이트에 "바뀌었나"(304 면 본문 없이 끝) · 사이트가 안 되면 디스크 사본(낡았어도) → 로컬 정본. */
const mmrTextOk = t => !!t && t.charCodeAt(0) === 123 && /\}\s*$/.test(t.slice(-8));   // 잘리거나 HTML 이면 거른다
const _mmrTextInflight = new Map();
function mmrFileText(file, ver) {
  const k = file + "|" + ver;
  if (_mmrTextInflight.has(k)) return _mmrTextInflight.get(k);   // 같은 칸을 동시에 두 번 받지 않는다
  const p = _mmrFileText(file, ver).finally(() => _mmrTextInflight.delete(k));
  _mmrTextInflight.set(k, p);
  return p;
}
async function _mmrFileText(file, ver) {
  const diskF = dataDisk(file), metaF = diskF + ".meta";
  const seen = _mmrFileSeen.get(file);
  const have = await readTextOrNull(diskF);
  if (ver && seen && seen.ver === ver && Date.now() - seen.at < MMR_FILE_RECHECK_MS && mmrTextOk(have)) return have;   // 같은 판 — 사이트에 묻지 않는다
  let meta = null; try { meta = JSON.parse(readFileSync(metaF, "utf8")); } catch {}
  try {
    const r = await fetchData(`${DATA_BASE}/${file}`, mmrTextOk(have) ? meta : null);   // 사본이 멀쩡할 때만 "바뀌었나"로 묻는다
    const now = Date.now();
    if (r.notModified && mmrTextOk(have)) {
      _mmrFileSeen.set(file, { ver, at: now });
      try { writeFileSync(metaF, JSON.stringify({ ...(meta || {}), fetchedAt: now })); } catch {}
      return have;
    }
    if (!r.notModified && mmrTextOk(r.body)) {
      _mmrFileSeen.set(file, { ver, at: now });
      try { await writeFile(diskF, r.body); writeFileSync(metaF, JSON.stringify({ etag: r.etag, lastModified: r.lastModified, fetchedAt: now })); } catch {}
      if (dataMem[file]) dataMemDrop(file);       // 메모리에 옛 판 해석본이 있으면 놓는다(다음에 쓰는 쪽이 새 사본을 읽게)
      return r.body;
    }
  } catch {}
  if (mmrTextOk(have)) return have;               // 사이트가 안 된다 — 낡았어도 디스크 사본(판 기록은 안 남긴다)
  const lt = await readTextOrNull(path.join(API_DIR, file));
  return mmrTextOk(lt) ? lt : null;               // 마지막: 로컬 정본(운영자 PC)
}
/* 칸 본문에서 한 사람 값 배열만 꺼낸다. 열쇠는 조회표를 쓴 JSON.stringify 와 같은 모양("열쇠":[)으로 찾고,
   바로 앞 글자가 { 또는 , 인 자리(= 열쇠 자리)만 인정한다 — 이름 속 \" 뒤에 우연히 같은 글자가 이어진 자리를 거른다.
   값 배열(숫자 4개 + 옛 이름 칸이면 지금 이름 1개)만 JSON.parse 한다. 없으면 null, 본문이 이상하면 undefined(= 못 받은 것으로). */
function mmrPickFromText(text, key) {
  const needle = JSON.stringify(key) + ":[";
  for (let at = text.indexOf(needle); at > 0; at = text.indexOf(needle, at + 1)) {
    const pre = text.charCodeAt(at - 1);
    if (pre !== 123 && pre !== 44) continue;
    const i = at + needle.length - 1;             // '[' 자리
    let inStr = false, esc = false;
    for (let k = i + 1; k < text.length; k++) {
      const c = text.charCodeAt(k);
      if (inStr) { if (esc) esc = false; else if (c === 92) esc = true; else if (c === 34) inStr = false; continue; }
      if (c === 34) inStr = true;
      else if (c === 93) { try { const v = JSON.parse(text.slice(i, k + 1)); return Array.isArray(v) ? v : undefined; } catch { return undefined; } }
    }
    return undefined;
  }
  return null;
}
async function mmrTierCuts(meta, ver) {
  const t = meta && meta.tiers;
  if (!t || !Array.isArray(t.cuts)) return null;          // 옛 형식 조회표 — 딱지를 안 준다(mmrLookup 과 같은 규칙)
  if (_mmrTopCut.ver !== ver || !_mmrTopCut.v) {
    let top = null; try { top = parseJsonRemote(await mmrFileText("mmr/top.json", ver)); } catch {}   // 명단은 3만 바이트라 통째로 읽는다
    const minOf = k => { const g = ((top && top.groups) || []).find(x => x && x.key === k); const n = g ? Number(g.minMmr) : NaN; return Number.isFinite(n) ? n : null; };
    const v = { chal: minOf("challenger"), gm: minOf("grandmaster"), master: minOf("master") };
    if (v.chal == null && Number.isFinite(Number(t.challengerMmr))) v.chal = Number(t.challengerMmr);
    if (top) _mmrTopCut = { ver, v };                     // 명단을 못 받았으면 적어 두지 않는다(다음 조회가 다시 받는다)
    else return { cuts: t.cuts.map(Number), ...v };
  }
  return { cuts: t.cuts.map(Number), ..._mmrTopCut.v };
}
async function mmrLookupMany(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(x => String(x == null ? "" : x).slice(0, 80)).filter(Boolean).slice(0, MMR_MANY_MAX);
  const meta = await loadData("mmr/meta.json").catch(() => null);
  const ver = meta ? String(meta.updatedAt || meta.builtAt || "") : "";
  const hasTier = !!(meta && meta.tiers);
  const out = {}, need = new Map();              // 칸 파일 → [[받은 이름, 열쇠], …]
  for (const id of list) {
    const key = mmrKey(id);
    if (!key || key.indexOf("#") < 1) { out[id] = null; continue; }
    const hit = _mmrPick.get(key);
    if (ver && hit && hit.ver === ver) { out[id] = hit.v; continue; }
    const f = "mmr/" + mmrShardOf(key) + ".json";
    if (!need.has(f)) need.set(f, []);
    need.get(f).push([id, key]);
  }
  /* ★2026-09-26 먼저 사이트 서버에 한 판 몫을 한 번에 묻는다(위 mmrApi) — 답한 이름은 칸 파일을 안 연다.
     답하지 못한 이름({e:1} · 요청 실패)만 아래 종전 길로 간다. */
  const pend = [];
  for (const pairs of need.values()) for (const pr of pairs) pend.push(pr);
  if (pend.length) {
    try {
      const a = await mmrApi(pend.map(pr => pr[0]), false);
      const answered = new Set();
      pend.forEach(([id, key], i) => {
        const r = a.r[i];
        if (r && r.e) return;
        const h = r && Array.isArray(r.m) ? r.m : null;
        const v = h ? [h[0], h[1], h[2] || 0, hasTier ? h[3] : null] : null;
        out[id] = v;
        _mmrPick.delete(key); _mmrPick.set(key, { ver, v });
        answered.add(id);
      });
      for (const [f, pairs] of [...need]) {
        const left = pairs.filter(pr => !answered.has(pr[0]));
        if (left.length) need.set(f, left); else need.delete(f);
      }
    } catch {}
  }
  let failed = 0;
  await Promise.all([...need].map(async ([f, pairs]) => {
    let text = null; try { text = await mmrFileText(f, ver); } catch {}
    if (!text) { failed += pairs.length; for (const [id] of pairs) out[id] = null; return; }   // 칸을 못 받았다 — 모르는 것으로. 적어 두지 않아 다음에 다시 묻는다
    for (const [id, key] of pairs) {
      const h = mmrPickFromText(text, key);
      if (h === undefined) { failed += 1; out[id] = null; continue; }   // 본문이 이상하다 — 모르는 것으로 두되 적어 두지 않는다
      const v = h ? [h[0], h[1], h[2] || 0, hasTier ? h[3] : null] : null;
      out[id] = v;
      _mmrPick.delete(key); _mmrPick.set(key, { ver, v });
    }
  }));
  while (_mmrPick.size > MMR_PICK_MAX) _mmrPick.delete(_mmrPick.keys().next().value);
  let tiers = null; try { tiers = await mmrTierCuts(meta, ver); } catch {}
  return { ok: true, ver, p: out, failed, tiers, basePeople: meta ? Number(meta.basePeople) || 0 : 0, minGames: meta ? Number(meta.minGames) || 10 : 10 };
}

/**
 * @param {string} pathname
 * @param {string} [method]
 * @param {URLSearchParams} [searchParams]
 * @param {Buffer | null} [bodyBuffer]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string | Buffer | Uint8Array }>}
 */
/**
 * @param {string} pathname
 * @param {string} [method]
 * @param {URLSearchParams} [searchParams]
 * @param {Buffer | null} [bodyBuffer]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string | Buffer | Uint8Array }>}
 */
async function webProfileLookup(rawName) {
  let q = String(rawName || "").trim();
  if (!q) return { ok: false, error: "EMPTY" };
  if (q.indexOf("#") < 0) q = q + "#KR1";
  const key = mmrKey(q);
  const hasRiot = !!riotCfg().apiKey;

  const mmrTask = (async () => {
    try {
      const [apiRes, mmrMeta, pickMeta] = await Promise.all([
        mmrApi([key], true).catch(() => null),
        loadData("mmr/meta.json").catch(() => null),
        loadData("mmr/pick/meta.json").catch(() => null)
      ]);
      let hit = null, pick = null;
      if (apiRes && apiRes.ok && Array.isArray(apiRes.r) && apiRes.r[0] && !(apiRes.r[0].e)) {
        const x = apiRes.r[0];
        hit = Array.isArray(x.m) ? x.m : null;
        pick = x.k || null;
      } else {
        const sh = mmrShardOf(key);
        const shard = await loadData("mmr/" + sh + ".json").catch(() => null);
        hit = shard && shard.p ? shard.p[key] : null;
        if (hit) {
          const pShard = await loadData("mmr/pick/" + sh + ".json").catch(() => null);
          pick = pShard && pShard.p ? pShard.p[key] : null;
        }
      }
      if (!hit) return null;
      const tiers = (mmrMeta && Array.isArray(mmrMeta.tiers)) ? mmrMeta.tiers : ["아이언", "브론즈", "실버", "골드", "플래티넘", "에메랄드", "다이아몬드", "마스터", "그랜드마스터", "챌린저"];
      const tierIdx = Number(hit[3]);
      const tierName = (Number.isFinite(tierIdx) && tierIdx >= 0 && tierIdx < tiers.length) ? tiers[tierIdx] : null;
      const resolvePick = (arr, kind) => {
        if (!Array.isArray(arr)) return [];
        const dict = pickMeta && (kind === "champion" ? pickMeta.champions : kind === "augment" ? pickMeta.augments : pickMeta.items);
        return arr.map(([id, cnt]) => {
          const info = dict && dict[String(id)];
          return {
            id: String(id),
            name: (info && info.n) || String(id),
            icon: (info && info.i) || (kind === "item" ? `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/item/${id}.png` : ""),
            games: Number(cnt) || 0
          };
        });
      };
      const rawPicks = Array.isArray(pick) ? pick : [];
      return {
        found: true,
        mmr: hit[0],
        games: hit[1],
        rank: hit[2] || 0,
        tier: Number.isFinite(tierIdx) ? tierIdx : null,
        tierName,
        minGames: Number(mmrMeta && mmrMeta.minGames) || 10,
        picks: {
          champions: resolvePick(rawPicks[0], "champion"),
          augments: resolvePick(rawPicks[1], "augment"),
          items: resolvePick(rawPicks[2], "item")
        }
      };
    } catch {
      return null;
    }
  })();

  const riotTask = hasRiot ? summonerRecord(q).catch(e => ({ error: e.code === "NO_KEY" ? "NO_KEY" : (e.status === 404 ? "NOT_FOUND" : "FAIL") })) : Promise.resolve(null);
  const [mmrData, riotData] = await Promise.all([mmrTask, riotTask]);

  if (!mmrData && (!riotData || riotData.error)) {
    return {
      ok: false,
      who: q,
      error: (riotData && riotData.error === "NOT_FOUND") ? "NOT_FOUND" : "NOT_FOUND",
      msg: "해당 계정의 칼바람 전적을 찾지 못했습니다. 닉네임#태그를 확인해주세요."
    };
  }

  return {
    ok: true,
    who: (riotData && riotData.who) || q,
    searched: true,
    webProfile: true,
    mmr: mmrData,
    standard: (riotData && !riotData.error && riotData.standard) ? riotData.standard : null
  };
}

/**
 * @param {string} pathname
 * @param {string} [method]
 * @param {URLSearchParams} [searchParams]
 * @param {Buffer | null} [bodyBuffer]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string | Buffer | Uint8Array }>}
 */
export function handleApiRequest(pathname, method = "GET", searchParams = new URLSearchParams(), bodyBuffer = null) {
  return new Promise(async (resolve) => {
    let statusCode = 200;
    let headers = {};
    let settled = false;
    const res = {
      writeHead(s, h = {}) { statusCode = s; headers = { ...headers, ...h }; },
      end(data) {
        if (settled) return;
        settled = true;
        resolve({ status: statusCode, headers, body: data });
      }
    };
    const qs = searchParams.toString();
    const reqUrl = pathname + (qs ? "?" + qs : "");
    const req = {
      url: reqUrl,
      method,
      headers: {
        host: "localhost",
        ...(bodyBuffer ? { "content-length": String(bodyBuffer.length) } : {})
      },
      async *[Symbol.asyncIterator]() {
        if (bodyBuffer && bodyBuffer.length) yield bodyBuffer;
      }
    };
    const u = new URL(req.url, "http://localhost");
    try {
    // ★2026-07-22: 시작 모드·동의 여부를 셸에 미리 심는다. 예전엔 localStorage 로 판단했는데 Electron 이 매 실행 랜덤 포트라
    //   origin 이 바뀌어 localStorage 가 항상 비어 있었다 → 증강으로 시작하는 유저는 standard 로 한 번 다 불러온 뒤
    //   /api/settings 응답을 받고 augment 로 **또 한 번** 통째로 불러왔다(첫 번째 결과는 그대로 버려짐).
    if (u.pathname === "/" || u.pathname === "/index.html") {
      for (const dir of [__dirname, BUNDLE_DIR].filter(Boolean)) {
        try {
          let html = await readFile(path.join(dir, "public", "index.html"), "utf8");
          const s = readSettings();
          const boot = `<script>window.__amBootMode=${JSON.stringify(s.startMode === "augment" || s.startMode === "standard" ? s.startMode : "standard")};window.__amConsent=${JSON.stringify(String(s.consent || ""))};</script>`;
          const at = html.indexOf("<script>");
          if (at >= 0) html = html.slice(0, at) + boot + html.slice(at);
          return send(res, 200, "text/html; charset=utf-8", html);
        } catch {}
      }
      return send(res, 404, "text/plain", "not found");
    }
    if (u.pathname === "/poro.png") return sendAsset(res, path.join("public", "poro.png"), "image/png");
    if (u.pathname === "/poro_cutout.png") return sendAssetSelfHeal(res, path.join("public", "poro_cutout.png"), "image/png"); // 사주풀이 히어로 — 예전엔 index.html 안에 687KB base64 문자열로 박혀 있었다. 설치본 런타임엔 안 들어와 자가복구 경로로 뺀다
    if (u.pathname === "/fonts/PretendardVariable.woff2") return sendAsset(res, path.join("public", "fonts", "PretendardVariable.woff2"), "font/woff2"); // §11 fable 리스킨 로컬 폰트
    if (u.pathname === "/img") {
      const url = u.searchParams.get("u") || "";
      try { if (!ICON_HOSTS.has(new URL(url).host)) return send(res, 400, "text/plain", "bad host");
        const buf = await getIcon(url);
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=604800" }); return res.end(buf);
      } catch { return send(res, 404, "text/plain", "img"); }
    }
    if (u.pathname === "/api/augdrift") { // 증강 제공 변동 5탭 데이터(사이트 정적 JSON 통째, 메모리·디스크 TTL 캐시는 loadData 가 맡는다)
      try { const j = await loadData(AUG_DRIFT_FILE); res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=600" }); return res.end(JSON.stringify(j)); }
      catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
    }
    if (u.pathname === "/api/tables") {
      const tableMode = safeTableMode(u.searchParams.get("mode") || "standard");
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({
        ok: true,
        mode: tableMode,
        season: tableMode === "augment" ? "season2" : "standard",
        ranges: TABLE_RANGES,
        tabs: publicTableTabs(tableMode),
        tables: publicTableDefs(tableMode)
      }));
    }
    if (u.pathname === "/api/table") {
      const payload = await publicTablePayload(u.searchParams);
      return send(res, payload.ok === false ? 404 : 200, "application/json; charset=utf-8", JSON.stringify(payload));
    }
    if (u.pathname === "/api/search") { // 통합검색 — 쿼리를 엔티티 표 전반에 매칭, 결과 카드(사이트 경험 이식)
      const mode = safeTableMode(u.searchParams.get("mode") || "standard");
      const range = u.searchParams.get("range") || "all";
      const q = u.searchParams.get("q") || "";
      const cards = await unifiedSearchCards(mode, range, q);
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, mode, range, query: q, cards }));
    }
    if (u.pathname === "/api/settings") { // #21 시작모드·자동불러오기·동의 영구 저장(읽기 + ?key=val 쓰기). origin 독립.
      // ⚠️ 동의(consent)도 여기 저장 — Electron은 매 실행 랜덤 포트(startServer(0))라 localStorage가 origin마다 초기화돼 매번 동의창이 떴음. 서버 파일에 저장해야 영구.
      let s = readSettings(), changed = false;
      for (const k of ["startMode", "autoLoad", "contribute", "consent"]) { if (u.searchParams.has(k)) { s[k] = u.searchParams.get(k); changed = true; } }
      if (changed) writeSettings(s);
      // riotKey: 소환사 검색(다른 사람) 가능 여부 = Riot API 키 보유 여부. 키 자체는 노출 안 하고 boolean만. 키 없는 배포 유저는 프런트가 소환사검색 UI를 숨김.
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ...s, riotKey: !!riotCfg().apiKey }));
    }
    /* ★2026-09-23 증바람MMR 즐겨찾기 — 운영자 지시 "칼바람 분석기에서도 즐겨찾기는 그대로 만들어낼 수 있을걸로 보이는데.
       칼바람 분석기에서도 가능하게 해줘". 화면 쪽은 사이트와 같은 블록이고(public/index.html 끝 · window.__amMmrFavStore="app"),
       저장만 여기서 한다 — 앱은 켤 때마다 포트가 바뀌어 localStorage 가 origin 마다 비워지므로(동의창과 같은 이유) 설정 폴더 파일에 적는다.
       모양: [{n:"닉네임#태그", at:ms}] · 최대 50개 · 같은 사람(NFC·소문자·공백 제거 열쇠)은 한 번만. 읽기 GET · 쓰기 POST(목록 통째). */
    if (u.pathname === "/api/mmr-fav") {
      const FAV_FILE = path.join(path.dirname(SETTINGS_FILE), "mmr-favorites.json");
      const J = "application/json; charset=utf-8";
      if (req.method === "POST") {
        let raw = ""; for await (const c of req) { raw += c; if (raw.length > 32768) break; }
        let arr = null; try { arr = JSON.parse(raw); } catch { }
        if (!Array.isArray(arr)) return send(res, 400, J, JSON.stringify({ ok: false, error: "bad-body" }));
        const seen = new Set(), clean = [];
        for (const x of arr) {
          const n = String((x && x.n) || "").normalize("NFC").trim().slice(0, 40);
          const k = n.toLowerCase().replace(/\s+/g, "");
          if (!n || k.indexOf("#") < 1 || seen.has(k)) continue;
          seen.add(k); clean.push({ n, at: Number(x && x.at) || Date.now() });
          if (clean.length >= 50) break;
        }
        try {
          mkdirSync(path.dirname(FAV_FILE), { recursive: true });
          writeFileSync(FAV_FILE + ".tmp", JSON.stringify(clean));
          renameSync(FAV_FILE + ".tmp", FAV_FILE);
        } catch (e) { return send(res, 500, J, JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 120) })); }
        return send(res, 200, J, JSON.stringify({ ok: true, n: clean.length }));
      }
      let list = []; try { list = JSON.parse(readFileSync(FAV_FILE, "utf8")); } catch { }
      return send(res, 200, J, JSON.stringify(Array.isArray(list) ? list : []));
    }
    // ── 증강 오버레이 on/off ────────────────────────────────────────────────
    //   증강 칼바람에서 고를 증강 3개 위에 티어·승률을 띄우는 별도 프로세스.
    //   기본은 꺼짐이라, 켜달라고 한 사람에게만 뜬다.
    if (u.pathname === "/api/augment-overlay/start" && req.method === "POST") {
      try { return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await augmentOverlayStart())); }
      catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
    }
    // 오버레이가 지금 무엇을 보고 있는지 — 남의 PC 에서 "그냥 안 떠요" 가 되지 않게,
    //   원인을 그 사람 화면에 그대로 보여주려고 만든다(로그 파일은 아무도 안 읽는다).
    if (u.pathname === "/api/augment-overlay/state" && req.method === "POST") {
      try {
        const raw = await new Promise((resolve) => {
          const r = http.request({ host: "127.0.0.1", port: 8900, path: "/debug", timeout: 2500 }, x => {
            const c = []; x.on("data", d => c.push(d));
            x.on("end", () => resolve(Buffer.concat(c).toString("utf8")));
          });
          r.on("error", () => resolve("")); r.on("timeout", () => { r.destroy(); resolve(""); });
          r.end();
        });
        if (!raw) return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, why: "overlay-down" }));
        const d = JSON.parse(raw);
        let why = "ready";
        if (!d.gameWindow) why = "no-game-window";
        else if (!d.gameFront) why = "game-not-front";
        else if (d.hasOffer) why = "reading";
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify({
          ok: true, why,
          championName: d.championName || null,
          gameMode: d.gameMode || null,
          window: d.gameWindow ? (d.gameWindow.width + "x" + d.gameWindow.height) : null,
          panelRows: d.panelRows || null
        }));
      } catch { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, why: "overlay-down" })); }
    }
    if (u.pathname === "/api/augment-overlay/stop" && req.method === "POST") {
      try { return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await augmentOverlayStop())); }
      catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
    }
    if (u.pathname === "/api/augment-overlay/status") {
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(augmentOverlayStatus()));
    }
    if (u.pathname === "/api/data-status") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await dataStatusPayload()));
    if (u.pathname === "/api/mmr") { // 증강 칼바람 내 계정 MMR — 사이트 조회표에서 자기 칸 하나만 읽는다
      try { return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await mmrLookup(u.searchParams.get("id") || ""))); }
      catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, reason: String(e && e.message || e).slice(0, 120) })); }
    }
    if (u.pathname === "/api/mmr-many" && req.method === "POST") { // 전적 개요 MMR 열 — 한 판 10명을 한 번에(위 mmrLookupMany)
      try {
        const ch = []; let n = 0;
        for await (const c of req) { ch.push(c); n += c.length; if (n > 8192) break; }   // 조각을 모아 한 번에 푼다 — 문자열로 이으면 한글이 조각 경계에서 깨진다
        let ids = []; try { ids = JSON.parse(Buffer.concat(ch).toString("utf8") || "{}").ids || []; } catch {}
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await mmrLookupMany(ids)));
      } catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, reason: String(e && e.message || e).slice(0, 120) })); }
    }
    /* ★2026-09-26 증바람MMR 조회 창 — 이름을 한 번에 사이트 서버로 넘겨 그 사람 줄(+주 선택 3열)만 받는다(위 mmrApi).
       실패하면 { ok:false } — 화면은 종전 길(/api/mmr-file 로 칸 받기)로 넘어간다. 이름은 60개까지(사이트 조회창과 같다). */
    if (u.pathname === "/api/mmr-lookup" && req.method === "POST") {
      try {
        const ch = []; let n = 0;
        for await (const c of req) { ch.push(c); n += c.length; if (n > 16384) break; }
        let body = {}; try { body = JSON.parse(Buffer.concat(ch).toString("utf8") || "{}"); } catch {}
        const ids = (Array.isArray(body.ids) ? body.ids : []).map(x => String(x == null ? "" : x).slice(0, 80)).slice(0, 60);
        if (!ids.length) return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, v: "", r: [] }));
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await mmrApi(ids, body.pick !== false)));
      } catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, reason: String(e && e.message || e).slice(0, 120) })); }
    }
    /* ★2026-09-14 증바람MMR 검색 창(조회·최상위 플레이어)이 쓰는 조회표 통과.
       화면에서 사이트로 바로 묻지 않고 여기를 거친다 — loadData 의 메모리 TTL·디스크 캐시·304·
       오프라인 폴백을 그대로 쓰려고 그런다(창을 여닫을 때마다 사이트까지 가지 않는다).
       ⚠️ 받은 이름을 경로에 그대로 잇지 않는다. 64칸(00~3f)·meta·top 만 통과시킨다. */
    if (u.pathname === "/api/mmr-file") {
      const f = String(u.searchParams.get("f") || "");
      const bad = (code, why) => send(res, code, "application/json; charset=utf-8", JSON.stringify({ ok: false, reason: why }));
      /* 칸은 0x00~0x3f 64개뿐이다. [0-9a-f]{2} 로 열어 두면 99.json 같은 없는 이름이 사이트까지 나간다(실측 502).
         ★2026-09-15 pick/ 하위도 같은 규칙으로 연다 — 주 선택 3열(챔피언·증강·아이템)이 쓰는 칸이다.
         조회표와 **같은 64칸 샤딩**이고 meta.json 은 이름·아이콘 사전이다. 접두사만 더했고 이름 규칙은 그대로다. */
      if (!/^(pick\/)?(meta\.json|top\.json|[0-3][0-9a-f]\.json)$/.test(f)) return bad(400, "알 수 없는 파일");
      try {
        const j = await loadData("mmr/" + f);
        if (j == null) return bad(502, "조회표를 못 받았다");
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(j));
      } catch { return bad(502, "조회표를 못 받았다"); }
    }
    /* ★2026-09-15 MMR 구간 티어리스트 — 사이트가 쓰는 파일 그대로 넘긴다(약 3.5MB).
       loadData 가 메모리·디스크 TTL 을 잡아 주므로 매번 원격을 때리지 않는다.
       실패해도 화면이 죽지 않게 빈 껍데기를 준다 — 구간 필터는 곁가지다. */
    if (u.pathname === "/api/tierbands") {
      try {
        const j = await loadData("tierbands-season2.json");
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(j || { data: {} }));
      } catch { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ data: {} })); }
    }
    if (u.pathname === "/api/champs") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await champMeta(u.searchParams.get("mode") || "standard")));
    // ── 2026-07-09 인게임(픽창) 모드 라우트 ──
    if (u.pathname === "/api/ingame/state") { try { return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await ingameState(u.searchParams.get("mode") || "standard", u.searchParams.get("mock") || "", { legacy: u.searchParams.get("legacy") === "1" }))); } catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String(e && e.message || e), view: "none" })); } }
    if (u.pathname === "/api/ingame/swap" && req.method === "POST") { try { let raw = ""; for await (const c of req) { raw += c; if (raw.length > 4096) break; } let cid = 0; try { cid = Number(JSON.parse(raw || "{}").championId); } catch {} if (!cid) return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "no-championId" })); const r = await ingameBenchSwap(cid); return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, result: r })); } catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String(e && e.message || e) })); } }
    if (u.pathname === "/api/ingame/runes" && req.method === "POST") { try { let raw = ""; for await (const c of req) { raw += c; if (raw.length > 8192) break; } let body = {}; try { body = JSON.parse(raw || "{}"); } catch {}
      // 클라가 계산한 페이지(정본 runePage 로직) 우선. 없으면 이름으로 서버 조립 폴백.
      let page = (body.page && Array.isArray(body.page.selectedPerkIds) && body.page.selectedPerkIds.length >= 6 && body.page.primaryStyleId && body.page.subStyleId) ? { name: String(body.name || body.page.name || ""), primaryStyleId: Number(body.page.primaryStyleId), subStyleId: Number(body.page.subStyleId), selectedPerkIds: body.page.selectedPerkIds.map(Number) } : (body.name ? await bestRunePage(String(body.name)) : null);
      if (!page) return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "no-runepage" }));
      if (u.searchParams.get("dry") === "1") return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, page, dry: true }));
      const r = await ingameSetRunes(page); return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, page, result: r })); } catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String(e && e.message || e) })); } }
    if (u.pathname === "/api/fortune-cohort") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await fortuneCohortStats(u.searchParams.get("mode") || "standard"))); // 사주풀이 z-score 코호트 축통계
    if (u.pathname === "/api/items") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await itemMeta(u.searchParams.get("mode") || "standard")));
    // 경기 상세 "전체(10인)" 스코어보드 — 그 한 판의 5:5 전원. 상세를 연 순간에만 호출(지연 로드).
    if (u.pathname === "/api/match-team") {
      const mode = u.searchParams.get("mode") === "augment" ? "augment" : "standard";
      const gid = String(u.searchParams.get("gid") || "");
      try {
        const p = await matchTeamRows(mode, gid);
        if (p && p.found && mode === "augment") await enrichMatchTeamAugments(p);
        if (p && p.found) rankMatchTeam(p, mode === "augment" ? await rankModel().catch(() => null) : null, mode === "augment" ? rankDTable() : null, mode === "augment" ? rankCETable() : null); // 등수·MVP/ACE 부여(증강 이름/승률이 붙은 뒤에 해야 픽 질 축이 산다) · ★09-26 증강=선택+피지컬(없으면 D)
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(p));
      } catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, found: false, error: String(e && e.message || e) })); }
    }
    // 최근 N판 내 평균 등수 — 헤더 카드 배지용. 전적 개요와 같은 계산(rankMatchTeam)을 그대로 쓴다.
    //   게임별 결과는 matchTeamRows 의 렌더 캐시를 타므로, 이미 펼쳐 본 판은 즉시 나온다.
    //   각 PC 는 자기 LCU 로만 판을 읽으므로 남의 전적이 섞이지 않는다.
    if (u.pathname === "/api/recent-rank") {
      const mode = u.searchParams.get("mode") === "augment" ? "augment" : "standard";
      const gids = String(u.searchParams.get("gids") || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 40);
      /* ★2026-09-14 목표 판수. 화면은 예비까지 보내고, 여기서 목표를 채우는 순간 멈춘다.
         예전엔 받은 걸 전부 돌면서 못 구한 판을 조용히 빼서 '최근 20판' 이 15판으로 줄었다.
         이제 못 구한 만큼 뒤에서 당겨 채우므로 평소엔 딱 목표만큼 돌고 끝난다(비용도 그대로). */
      const want = Math.max(1, Math.min(40, Number(u.searchParams.get("want")) || 20));
      const ranks = [];
      let looked = 0;
      for (const gid of gids) {
        if (ranks.length >= want) break;   /* 목표를 채웠다 — 나머지 예비는 안 본다 */
        try {
          looked += 1;
          const p = await matchTeamRows(mode, gid);
          if (!p || !p.found) continue;
          if (mode === "augment") await enrichMatchTeamAugments(p);
          rankMatchTeam(p, mode === "augment" ? await rankModel().catch(() => null) : null, mode === "augment" ? rankDTable() : null, mode === "augment" ? rankCETable() : null);   // ★09-26 전적 개요와 같은 계산(증강=선택+피지컬 · 없으면 D)
          const mine = (p.rows || []).find(r => r && r.me);
          if (mine && Number(mine.rank) > 0) ranks.push({ gid, rank: Number(mine.rank), win: !!mine.win });
        } catch { /* 한 판 실패가 배지 전체를 막지 않는다 */ }
      }
      const avg = ranks.length ? ranks.reduce((a, x) => a + x.rank, 0) / ranks.length : null;
      const best = ranks.length ? Math.min(...ranks.map(x => x.rank)) : null;
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({
        /* asked = 실제로 들여다본 판 수(예비 전부가 아니다). n 과 같으면 화면이 꼬리말을 안 단다. */
        ok: true, mode, want, asked: looked, n: ranks.length,
        avg: avg == null ? null : Math.round(avg * 100) / 100, best, ranks
      }));
    }
    if (u.pathname === "/api/runes") return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await runeMeta(u.searchParams.get("mode") || "standard")));
    if (u.pathname === "/api/build-panel") { // 세로데이터 우측 빌드패널 — 엔티티 1개의 룬/증강·아이템 기여도(전량). 행 클릭 시에만 호출(지연 로드).
      const mode = u.searchParams.get("mode") === "augment" ? "augment" : "standard";
      const range = /^[a-z0-9]+$/i.test(u.searchParams.get("range") || "") ? u.searchParams.get("range") : "all";
      const t = u.searchParams.get("type") || "champion";
      const type = (t === "item" || t === "augment") ? t : "champion";
      const key = u.searchParams.get("key") || "";
      if (!key) return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: true, found: false, cols: [] }));
      const p = await contribRows(mode, range, type, { key, name: u.searchParams.get("name") || "" });
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(p));
    }
    if (u.pathname === "/api/analysis") { // 개인 상세분석 12종 — 두 모드 같은 구성(증강 자리를 룬이 대체). 각자 PC LCU 캐시(8896 로직 재구성)
      const mode = u.searchParams.get("mode") === "augment" ? "augment" : "standard";
      if (mode === "augment") maybeCaptureAugfullLocal(); // 증분 캡처 킥(백그라운드) — 첫 실행만 상세 fetch 다수, 이후 0~수개
      else maybeCaptureStdfullLocal(); // 일반도 동일 — 아군/상대 팀 구성은 상세에만 있다
      const a = await personalAnalysis(mode);
      const _icm = await itemClassMap(), _crm = await champRoleMap(); // 아이템/챔피언 클래스 필터용(class-overrides.json 단일소스). cls=한글(전사~유틸)
      const itCls = c => GROUP_KO[_icm.get(norm(c.label))] || ""; // 아이템명→클래스(있는 것만)
      const chCls = c => GROUP_KO[_crm.get(norm(c.label))] || ""; // 챔피언명→역할
      const enrichItem = im => arr => (arr || []).map(c => ({ ...c, id: Number(c.key), label: im.get(Number(c.key)) || ("아이템 " + c.key), icon: itemIconUrl(c.key) })).filter(c => !isRemovedAramItem(c.id, c.label)).map(c => ({ ...c, cls: itCls(c) }));
      // ── 쌍(내 챔피언+증강/룬, 내 챔피언+아이템, 내 증강/룬+아이템) 라벨·아이콘 붙이기 ──────────
      //   챔피언 쪽은 lcu_personal이 champMaps로 이미 붙여 보낸다(aLabel/aIcon). 나머지 쪽만 여기서
      //   각 모드의 정본 소스(증강=season2 풀 / 룬=fullRuneCatalog / 아이템=ddItemMap)로 채운다.
      const pairSide = (kind, key, ctx) => kind === "item" ? ctx.item(key) : kind === "rune" ? ctx.rune(key) : kind === "augment" ? ctx.aug(key) : { label: "", icon: "" };
      const pairFix = (arr, ctx) => (arr || []).map(c => {
        const A = c.kindA === "champion" ? { label: c.aLabel || ("챔피언 #" + c.a), icon: c.aIcon || "" } : pairSide(c.kindA, c.a, ctx);
        const B = pairSide(c.kindB, c.b, ctx);
        return { ...c, label: A.label + " + " + B.label, icon: A.icon, icon2: B.icon,
          aKey: c.kindA === "champion" ? (c.aLabel || "") : c.a, // 챔피언 쌍 클릭 → 그 챔프 상세(openChamp는 이름으로 조회)
          _drop: (c.kindA === "item" && isRemovedAramItem(Number(c.a), A.label)) || (c.kindB === "item" && isRemovedAramItem(Number(c.b), B.label)) };
      }).filter(c => !c._drop).map(({ _drop, ...c }) => c); // 칼바람서 빠진 아이템이 낀 쌍은 제외(단일 아이템 탭과 동일 규칙)
      if (a && a.ok && mode === "augment") {
        // 증강 라벨/아이콘/등급 enrich: season2 풀(value·id·rawAugmentId → localName·icon·rarity). 없는 id는 "증강 #id"(지어내지 않음).
        let am = null;
        try { const pool = await loadPool("search-pool-all-observedAugments-season2.json"); am = new Map(); for (const r of pool) for (const k of [r.value, r.id, r.rawAugmentId]) if (k != null && !am.has(Number(k))) am.set(Number(k), r); } catch {}
        const fixAug = arr => (arr || []).map(c => { const r = am && am.get(Number(c.key)); return { ...c, id: Number(c.key) || null, label: (r && (r.localName || r.name)) || (typeof c.key === "string" ? c.key : "증강 #" + c.key), icon: (r && r.icon) || "", rarity: (r && r.rarity) || null, desc: (r && r.description) || "" }; });
        a.myAugments = fixAug(a.myAugments); a.allyAugments = fixAug(a.allyAugments); a.enemyAugments = fixAug(a.enemyAugments);
        const im = await ddItemMap();
        a.myItems = enrichItem(im)(a.myItems);
        a.allyItems = enrichItem(im)(a.allyItems); // 아군 아이템 — myItems와 동일 enrich+필터+cls
        a.enemyItems = enrichItem(im)(a.enemyItems); // 상대 아이템 — myItems와 동일 enrich+필터+cls
        a.allyChampions = (a.allyChampions || []).map(c => ({ ...c, cls: chCls(c) })); // 챔피언 역할 필터용 cls(요구④)
        a.enemyChampions = (a.enemyChampions || []).map(c => ({ ...c, cls: chCls(c) }));
        const augCtx = {
          item: k => ({ label: im.get(Number(k)) || ("아이템 " + k), icon: itemIconUrl(k) }),
          aug: k => { const r = am && am.get(Number(k)); return { label: (r && (r.localName || r.name)) || (typeof k === "string" ? k : "증강 #" + k), icon: (r && r.icon) || "" }; },
          rune: k => ({ label: "룬 #" + k, icon: "" })
        };
        a.myChampAugments = pairFix(a.myChampAugments, augCtx);
        a.myChampItems = pairFix(a.myChampItems, augCtx);
        a.myAugmentItems = pairFix(a.myAugmentItems, augCtx);
        a.capturing = _augfullBusy; // 첫 캡처 진행 중이면 UI가 "수집 중" 표기 후 재조회 가능
      } else if (a && a.ok) {
        // 일반 칼바람 — 증강모드와 같은 항목 구성. 증강 자리를 룬이 대체(사이트 q450↔q2400 대응과 동일).
        const im = await ddItemMap();
        a.myItems = enrichItem(im)(a.myItems);
        a.allyItems = enrichItem(im)(a.allyItems); // 아군 아이템 — 증강모드와 동일 enrich+필터+cls
        a.enemyItems = enrichItem(im)(a.enemyItems); // 상대 아이템 — 동일
        const cat = await fullRuneCatalog(); const rm = new Map(cat.map(r => [Number(r.id), r]));
        const fixRune = arr => (arr || []).map(c => { const r = rm.get(Number(c.key)); return { ...c, id: Number(c.key), label: (r && r.name) || SHARD_NAME[Number(c.key)] || ("룬 #" + c.key), icon: (r && r.icon) || shardIcon(c.key) || "", cat: (r && r.cat) || null, tree: (r && r.tree) || null }; });
        a.myRunes = fixRune(a.myRunes);
        a.allyRunes = fixRune(a.allyRunes); // 증강모드의 아군 증강에 대응
        a.enemyRunes = fixRune(a.enemyRunes); // 증강모드의 상대 증강에 대응
        a.myShards = (a.myShards || []).map(c => ({ ...c, id: Number(c.key), label: SHARD_NAME[Number(c.key)] || ("파편 #" + c.key), icon: shardIcon(c.key) || "" }));
        a.allyChampions = (a.allyChampions || []).map(c => ({ ...c, cls: chCls(c) }));
        a.enemyChampions = (a.enemyChampions || []).map(c => ({ ...c, cls: chCls(c) }));
        const stdCtx = {
          item: k => ({ label: im.get(Number(k)) || ("아이템 " + k), icon: itemIconUrl(k) }),
          rune: k => { const r = rm.get(Number(k)); return { label: (r && r.name) || SHARD_NAME[Number(k)] || ("룬 #" + k), icon: (r && r.icon) || shardIcon(k) || "" }; },
          aug: k => ({ label: "증강 #" + k, icon: "" })
        };
        a.myChampRunes = pairFix(a.myChampRunes, stdCtx);
        a.myChampItems = pairFix(a.myChampItems, stdCtx);
        a.myRuneItems = pairFix(a.myRuneItems, stdCtx);
        a.capturing = _stdfullBusy; // 팀 구성 수집 중이면 UI가 "수집 중 · 새로고침" 표기
      }
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(a));
    }
    if (u.pathname === "/api/mychamp") { // 내 챔프 개인 빌드 — 메타 페이지와 동일 레이아웃, 내 데이터로(토글·지표·아군 조합 포함)
      const mode = u.searchParams.get("mode") || "standard", name = u.searchParams.get("name") || "", q = norm(name);
      const b = await personalChampBuild(mode, name);
      if (mode !== "augment") { const cohort = await loadLite("standard-aram-cohort-all.json"); const nm = new Map(); for (const it of (cohort.itemRows || [])) if (!isRemovedAramItem(it.id, it.localName || it.name)) nm.set(Number(it.id), { name: it.localName || it.name, icon: it.icon }); b.items = (b.items || []).map(it => { const r = nm.get(Number(it.id)); return r ? { ...it, name: r.name, icon: r.icon } : it; }).filter(it => it.name && !isRemovedAramItem(it.id, it.name)); } // itemRows 만 읽음
      const impact = src => { b.metaMit = src.avgMitigatedPerMinute != null ? Math.round(src.avgMitigatedPerMinute) : null; b.metaHeal = src.avgHealPerMinute != null ? Math.round(src.avgHealPerMinute) : null; b.metaCc = src.avgCcPerMinute != null ? Number(src.avgCcPerMinute).toFixed(1) : null; b.teamDmgPct = src.avgTeamDamagePct != null ? Math.round(src.avgTeamDamagePct) : null; }; // 메타 피해감소/회복/CC/팀딜 → meta* (나의 b.mit/heal/cc는 personalChampBuild서 옴, 라디아 나vs메타 비교용)
      if (mode === "augment") { const meta = await augMeta().then(m => (m.champions || []).find(x => norm(x.name) === q) || {}, () => ({})); /* 번들은 obs 에 없는 칸의 보충용 — 못 받아도 내 빌드는 그린다(2026-09-25) */ const augRep = (await publicReport("augment", "all")).report; const obs = publicChampionDetailRow(augRep, q, rangeSources("augment", u.searchParams.get("range") || "all").win) || {}; /* ★메타 지표 = 상세 표면의 사이트 미러 소스(dailyReport.patch, resolveEntity와 동일·feedback-companion-mirror-site-per-surface-source). top-level championRows는 익명 기여매치 전투스탯 결측이라 avgDpm/mit/heal/cc가 0/null(애쉬 등 80챔프) → 메타 지표 0 회귀. 풀 전체통일은 사이트와 어긋나 금지. */ const gpm = obs.avgGoldPerMinute ?? obs.avgGpm; b.metaDpm = obs.avgDpm != null ? Math.round(obs.avgDpm) : (meta.dpm || 0); b.metaTank = obs.avgTakenPerMinute != null ? Math.round(obs.avgTakenPerMinute) : (meta.taken || 0); b.metaGpm = gpm != null ? Math.round(gpm) : (meta.gpm || 0); impact(obs); b.synergies = await augmentPartnerChamps(name, obs.winRate ?? meta.winRate); /* 잘 맞는 아군 base = 메타 챔프 평균 승률(/api/champ 증강과 동일 소스) */
        // ★내 증강/아이템 이름·아이콘·등급 enrich — 외부 PC(db.json 없음) 병합행은 증강 value·아이템 id만 있어 이름 결측. /api/analysis와 동일 소스(season2 풀·ddItemMap)로 채움(운영자 db행은 이미 이름 있으면 보존).
        try { const pool = await loadPool("search-pool-all-observedAugments-season2.json"); const am = new Map(); for (const r of pool) for (const k of [r.value, r.id, r.rawAugmentId]) if (k != null && !am.has(Number(k))) am.set(Number(k), r); b.augments = (b.augments || []).map(a => { const r = am.get(Number(a.id)); return r ? { ...a, name: (r.localName || r.name || a.name), icon: (r.icon || a.icon), rarity: (a.rarity || r.rarity || null), desc: (r.description || a.desc || "") } : a; }); } catch {}
        try { const im = await ddItemMap(); b.items = (b.items || []).map(it => { const nm = im.get(Number(it.id)); const good = it.name && !/^\d+$/.test(String(it.name)); return { ...it, name: good ? it.name : (nm || it.name), icon: it.icon || itemIconUrl(it.id) }; }).filter(it => !isRemovedAramItem(it.id, it.name)); } catch {}
      }
      else { const r = await hydrateStdReport(await loadLite("standard-aram-cohort-all.json"), ["pairs"]); const c = (r.championRows || []).find(x => [x.localName, x.displayName, x.champion].some(v => norm(v) === q)) || {}; b.metaDpm = Math.round(c.avgDpm || 0); b.metaTank = Math.round(c.avgTakenPerMinute || 0); b.metaGpm = Math.round(c.avgGoldPerMinute || 0); impact(c); b.synergies = topSynergies(r, name, Math.round(Number(c.winRate) || 0)); } // championRows + 시너지(쌍 풀)만. 잘 맞는 아군 base = 메타 챔프 평균 승률(/api/champ 일칼과 동일)
      b.metaKda = await metaChampKda(mode, name); // 메타 평균 KDA(나=b.kda vs 메타 비교용)
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(b));
    }
    if (u.pathname === "/api/champ") {
      const mode = u.searchParams.get("mode") || "standard", name = u.searchParams.get("name") || "", q = norm(name);
      const champRange = u.searchParams.get("range") || "all";   // 상세도 선택 기간의 창을 읽는다(표=상세 판수 일치)
      // ★2026-09-25 외부 PC 신고 "게임 로딩창부터 '통계를 못 받았어요 · 서버 응답 500'": 종전엔 받을 파일(리포트 · R2 번들 · 풀 4개)
      //   중 **하나만** 못 받아도 응답 전체가 500 이었다. 머리 수치의 정본(증바람 = 리포트 · 일칼 = 코호트)만 필수로 두고
      //   — 그게 없으면 503(잠시 뒤 다시) — 나머지 조각은 못 받으면 그 칸만 비워 그리고 partial 에 이름을 적는다(클라가 잠시 뒤 채운다).
      //   ⚠️ 리포트를 못 받았다고 R2 번들로 머리 수치를 대신 채우지 마라 — 08-27 에 멈춘 사본이라 판수가 100배 다르다
      //      (09-25 실측: 아리 3,954판 vs 리포트 400,360판). 사이트와 다른 숫자를 띄우느니 기다렸다 다시 받는다.
      const partial = [];
      const soft = (tag, fn, dflt) => Promise.resolve().then(fn).catch(e => { partial.push(tag); poolWarnOnce(`champ:${tag}`, `[champ] ${tag} 못 받음(${(e && e.message) || e}) — 상세는 그 칸만 비우고 그린다`); return dflt; });
      const coreMissing = (what, e) => send(res, 503, "application/json; charset=utf-8", JSON.stringify({ error: `${what}를 아직 못 받았어요 · ${String((e && e.message) || e).slice(0, 140)}`, retry: true }));
      if (mode === "augment") { // 증강 = 10명 전체 메타(teamParticipants) + 추천은 pool 파일
        let augRep;
        try { augRep = (await publicReport("augment", "all")).report; } catch (e) { return coreMissing("증강 칼바람 통계", e); }
        const reportRow = publicChampionDetailRow(augRep, q, rangeSources("augment", champRange).win) || {};
        const chRow = (augRep.championRows || []).find(x => [x.localName, x.champion, x.displayName].some(v => norm(v) === q)) || {};
        let caBundle = {}; // R2 번들 = 리포트에 없는 필드의 보충용일 뿐 — 못 받아도 화면 수치는 온전하므로 partial 로 치지 않는다(치면 번들이 안 닿는 PC 는 상세마다 헛된 재요청)
        try { caBundle = ((await augMeta()).champions || []).find(x => norm(x.name) === q) || {}; } catch {}
        const ca = {
          ...caBundle,
          ...reportRow,
          name: firstText(reportRow.localName, reportRow.label, reportRow.displayName, caBundle.name, name),
          icon: reportRow.icon || caBundle.icon || "",
          games: Number(reportRow.games ?? caBundle.games ?? 0),
          winRate: Number(reportRow.winRate ?? caBundle.winRate ?? 0),
          tier: reportRow.tier ?? caBundle.tier ?? null
        };
        const [runes, items, synergies, kda] = await Promise.all([
          soft("augments", () => augmentCombos(name, "augment", 24), []),
          soft("items", () => augmentCombos(name, "item", 24), []),
          soft("synergies", () => augmentPartnerChamps(name, ca.winRate), []), // 잘 맞는 아군 base = 아래 응답 winRate와 같은 값
          soft("kda", () => metaChampKda("augment", ca.name || name), null) // 메타 평균 KDA
        ]);
        const dvb = chRow.deltaVsBenchmark ?? reportRow.deltaVsBenchmark; // 벤치마크(기대승률 대비)는 top-level championRows 고유 필드라 유지
        // ★상세 지표·표본 = reportRow(=dailyReport.patch) 단일 소스 — 사이트 상세(resolveEntity)와 동일 표면 미러(feedback-companion-mirror-site-per-surface-source). top-level championRows(chRow) 우선 제거(기여매치 전투스탯 결측→0/null). 풀 전체통일은 사이트와 어긋나 금지.
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify({
          name: ca.name || name, icon: ca.icon || "", tier: ca.tier ?? null, winRate: ca.winRate || 0, games: ca.games || 0,
          dpm: Math.round(ca.avgDpm ?? ca.dpm ?? 0),
          gpm: Math.round(ca.avgGoldPerMinute ?? ca.avgGpm ?? ca.gpm ?? 0),
          tank: Math.round(ca.avgTakenPerMinute ?? ca.taken ?? 0),
          mit: ca.avgMitigatedPerMinute != null ? Math.round(ca.avgMitigatedPerMinute) : null,
          heal: ca.avgHealPerMinute != null ? Math.round(ca.avgHealPerMinute) : null,
          cc: ca.avgCcPerMinute != null ? Number(ca.avgCcPerMinute).toFixed(1) : null,
          cls: GROUP_KO[fixChampRole(ca.name || name, ca.group)] || ca.roleLabel || "", rank: ca.rank ?? null, // 클래스 오버라이드(class-overrides.json) 적용 — 상세 헤더 역할군도 티어리스트와 일치
          teamDmgPct: ca.avgTeamDamagePct != null ? Math.round(ca.avgTeamDamagePct) : null,
          deltaVsBenchmark: dvb != null ? Number(Number(dvb).toFixed(1)) : null, // 기대 승률 대비(+면 기대 이상)
          kda, // 메타 평균 KDA(추가)
          counter: null, // 상세 페이지 상대법 제거(2026-07-22 사용자 지시)
          runes, items, synergies,
          ...(partial.length ? { partial } : {})
        }));
      }
      let r;
      try { r = await load("standard-aram-cohort-all.json"); } catch (e) { return coreMissing("일반 칼바람 통계", e); }
      // 기간(전체/최근 28일/최근 14일)에 따라 좁아져야 한다 → 선택 기간의 dailyReport 창 행을 우선하고 championRows 로 보충.
      //   (예전엔 기간이 리포트 파일을 갈아끼워 championRows 자체가 좁아졌다. 지금은 파일이 all 한 벌이라 창으로 좁힌다.)
      const range = u.searchParams.get("range") || "all";
      const cBase = (r.championRows || []).find(x => [x.localName, x.displayName, x.champion].some(v => norm(v) === q)) || {};
      const cWin = dailyRichRows(r, "champion", "standard", rangeSources("standard", range).win)
        .find(x => [x.localName, x.displayName, x.champion, x.label, x.name].some(v => norm(v) === q)) || {};
      const c = { ...cBase, ...cWin };
      const [kda, runeCatalog] = await Promise.all([
        soft("kda", () => metaChampKda("standard", c.localName || name), null), // 메타 평균 KDA
        soft("runeCatalog", () => fullRuneCatalog(), []) // 전체 룬 트리(runesReforged 완전체: 키스톤행+3줄×3, lolalytics식 정렬)
      ]);
      if (!r._comboHydrated) partial.push("combos"); // 외부 풀(룬·아이템 전체)을 아직 못 받아 임베드 미리보기로 그린 상태 — 클라가 잠시 뒤 다시 받아 채운다
      if (runeCatalog.length <= 9 && !partial.includes("runeCatalog")) partial.push("runeCatalog"); // 파편 9칸만 = 룬 트리(ddragon)를 못 받음
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({
        name: c.localName || name, icon: c.icon || "", tier: c.tier ?? null, winRate: Math.round(c.winRate || 0), games: c.games || 0,
        dpm: Math.round(c.avgDpm || 0), gpm: Math.round(c.avgGoldPerMinute ?? c.avgGpm ?? 0), tank: Math.round(c.avgTakenPerMinute || 0),
        mit: c.avgMitigatedPerMinute != null ? Math.round(c.avgMitigatedPerMinute) : null, heal: c.avgHealPerMinute != null ? Math.round(c.avgHealPerMinute) : null, cc: c.avgCcPerMinute != null ? Number(c.avgCcPerMinute).toFixed(1) : null,
        cls: GROUP_KO[fixChampRole(c.localName || name, c.group)] || c.roleLabel || "", rank: c.rank ?? null, // 클래스 오버라이드(class-overrides.json) 적용 — 티어리스트서 옮긴 역할(타릭=탱커 등)이 상세에도 반영
        teamDmgPct: c.avgTeamDamagePct != null ? Math.round(c.avgTeamDamagePct) : null,
        kda, // 메타 평균 KDA(추가)
        counter: null, // 상세 페이지 상대법 제거(2026-07-22 사용자 지시)
        runes: topCombos(r, name, "augmentName", 20, 40), items: topCombos(r, name, "itemName", 20, 24), synergies: topSynergies(r, name, Math.round(c.winRate || 0)), // 잘 맞는 아군 base = 위 응답 winRate와 같은 값
        runeCatalog,
        ...(partial.length ? { partial } : {})
      }));
    }
    if (u.pathname === "/api/item") {
      const mode = u.searchParams.get("mode") || "standard", id = u.searchParams.get("id") || "", range = u.searchParams.get("range") || "all";
      const data = (mode === "augment") ? await augItemDetail(id, range) : await stdItemDetail(id, range);
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(data));
    }
    if (u.pathname === "/api/rune") { // 룬은 표준 모드 전용
      const id = u.searchParams.get("id") || "", range = u.searchParams.get("range") || "all";
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await stdRuneDetail(id, range)));
    }
    if (u.pathname === "/api/augment") { // 증강은 증강 모드 전용
      const id = u.searchParams.get("id") || "", range = u.searchParams.get("range") || "all";
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await augAugmentDetail(id, range)));
    }
    if (u.pathname === "/api/me") {
      try {
        if (!u.searchParams.has("mock")) {
          return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ leagueOff: true, webMode: true }));
        }
        const rec = await getRecords({ mock: true });
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await enrichRecordAugmentNames(await enrichPickItemNames(rec))));
      }
      catch (e) { if (e.code === "LEAGUE_OFF") return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ leagueOff: true, webMode: true })); throw e; }
    }
    if (u.pathname === "/api/summoner") { // 다른 소환사 검색(Riot API, 일반 ARAM 450)
      try { return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await summonerRecord(u.searchParams.get("name") || ""))); }
      catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ error: e.code === "NO_KEY" ? "NO_KEY" : (e.status === 404 ? "NOT_FOUND" : "FAIL"), msg: String(e.message || e) })); }
    }
    if (u.pathname === "/api/web-profile") {
      try { return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await webProfileLookup(u.searchParams.get("name") || ""))); }
      catch (e) { return send(res, 500, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "FAIL", msg: String(e && e.message || e) })); }
    }
    if (u.pathname === "/api/share" && req.method === "POST") { // 링크 공유 — 클라 PNG를 워커 /share로 전달하고 공개 URL 반환(CORS 우회)
      try {
        if (Number(req.headers["content-length"] || 0) > MAX_SHARE_BYTES) { res.writeHead(413, { "content-type": "application/json; charset=utf-8" }); return res.end(JSON.stringify({ ok: false, error: "too-large" })); } // 선검사(대개 CL 있음) → 본문 안 읽고 즉시 거절
        const chunks = []; let total = 0, over = false;
        for await (const c of req) { total += c.length; if (total > MAX_SHARE_BYTES) { over = true; break; } chunks.push(c); } // CL 없는 청크 전송 백스톱(파괴 대신 드레인 후 413)
        if (over) return send(res, 413, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "too-large" }));
        const buf = Buffer.concat(chunks);
        if (!buf.length) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "empty" }));
        const out = await postShareToWorker(buf);
        return send(res, out && out.ok ? 200 : 502, "application/json; charset=utf-8", JSON.stringify(out));
      } catch (e) { return send(res, 500, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String((e && e.message) || e) })); }
    }
    if (u.pathname === "/api/share-meta" && req.method === "POST") { // 공유 렌더 스냅샷(JSON) → 워커 /share-meta(사주 /r 페이지 재생용)
      try {
        if (Number(req.headers["content-length"] || 0) > 262144) { res.writeHead(413, { "content-type": "application/json; charset=utf-8" }); return res.end(JSON.stringify({ ok: false, error: "too-large" })); }
        const chunks = []; let total = 0, over = false;
        for await (const c of req) { total += c.length; if (total > 262144) { over = true; break; } chunks.push(c); }
        if (over) return send(res, 413, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "too-large" }));
        const buf = Buffer.concat(chunks);
        if (!buf.length) return send(res, 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: "empty" }));
        const out = await postShareMetaToWorker(buf);
        return send(res, out && out.ok ? 200 : 502, "application/json; charset=utf-8", JSON.stringify(out));
      } catch (e) { return send(res, 500, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String((e && e.message) || e) })); }
    }
    if (u.pathname === "/api/runtime-update") {   // ★09-26 켜 둔 분석기의 새 판 알림 — 지금 도는 rev vs R2 서명 매니페스트 rev
      const running = runtimeRunningRev(), latest = await runtimeLatestRev();
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ running, latest, ready: running > 0 && latest > running }));
    }
    if (u.pathname === "/api/runtime-update/restart" && req.method === "POST") {
      try { return send(res, 200, "application/json; charset=utf-8", JSON.stringify(await runtimeRestart())); }
      catch (e) { return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String((e && e.message) || e) })); }
    }
    if (u.pathname === "/api/version") {
      return send(res, 200, "application/json; charset=utf-8", JSON.stringify({ current: "web-1.0.0", latest: "web-1.0.0", updateAvailable: false, url: "", notes: "" }));
    }
    send(res, 404, "application/json", '{"error":"not found"}');
  } catch (e) { send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: String(e.message || e) })); }
  });
}
