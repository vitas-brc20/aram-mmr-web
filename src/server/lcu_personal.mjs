// 칼바람 컴패니언 1단계 — LCU에서 내 ARAM 개인기록을 로컬 생성(일반450·증강2400). production key 0.
// 실행: League 클라이언트 켠 상태에서  node mayhem-model/companion/lcu_personal.mjs
//       node mayhem-model/companion/lcu_personal.mjs --mock   (League 없이 출력형태 확인)
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REL_API_DIR = path.resolve(__dirname, "../../aram_mayhem_auto/data/pages_site/static/api");
const ABS_API_DIR = "E:\\프린서버\\plugins\\Skript\\scripts\\aram_mayhem_auto\\data\\pages_site\\static\\api"; // 설치본 폴백
const API_DIR = process.env.MAYHEM_API_DIR || (existsSync(REL_API_DIR) ? REL_API_DIR : ABS_API_DIR);
const DB_PATH = path.resolve(API_DIR, "../../../db.json"); // 증강 누적 저장소(본섭+PBE 전체) — LCU 최근창보다 많음
// 개인기록 캐시 — 어느 PC든 존재하는 홈 폴더에 저장(데이터 디렉토리는 메인PC 전용 하드코딩 경로라 다른 PC선 없어 쓰기 실패함)
const CACHE_DIR = path.join(os.tmpdir(), "aram-mayhem-cache");
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
const STD_CACHE_PATH = path.join(CACHE_DIR, "mayhem_companion_std.json"); // 일반(450) LCU 누적(롤 꺼도 다음부터 보이게)
const AUG_CACHE_PATH = path.join(CACHE_DIR, "mayhem_companion_aug.json"); // 증강(2400) LCU 폴백 누적(db.json 없는 다른 PC)
const AUGFULL_CACHE_PATH = path.join(CACHE_DIR, "mayhem_companion_augfull.json"); // 증강 기여용 전체행(teamParticipants+augments) — 상세 fetch 결과 1회 캐시(새 게임만 추가)
// 일반(450) 아군/상대 분석용 팀 구성 캐시 — 증강 augfull과 파일부터 분리(모드 안 섞음).
//   ⚠️ LCU 목록(getMatches)엔 내 참가자 하나뿐이다. 실측: std/aug 캐시 495행 전부 dmgShare가 정확히 100.0%
//      (= 팀 피해 합 == 내 피해). 그래서 아군/상대는 게임별 상세 fetch 없이는 절대 못 얻는다 — 지어내지 말 것.
//   ⚠️ 이 캐시는 로컬 분석 전용이며 업로드 경로가 없다(기여 화이트리스트 CONTRIB_MODES = 2400/2450).
//      그래서 애초에 PII(이름·puuid)를 담지 않는다. 아이콘 URL 등 문자열도 없이 id만 — 행 비대화 방지.
const STDFULL_CACHE_PATH = path.join(CACHE_DIR, "mayhem_companion_stdfull.json");
// 클래식 스타일(2450) — 증바람 캐시와 파일부터 분리한다. 한 파일에 섞으면 증바람 개인 판수가 즉시 오염된다.
const CLASSIC_CACHE_PATH = path.join(CACHE_DIR, "mayhem_companion_classic.json");
const CLASSICFULL_CACHE_PATH = path.join(CACHE_DIR, "mayhem_companion_classicfull.json");
const SUMMONER_CACHE_PATH = path.join(CACHE_DIR, "mayhem_companion_summoner.json"); // 본인 LCU 소환사명 캐시(롤 꺼도 "나"/남의이름 아닌 본인 이름으로 표시)
// 옛 위치(데이터 디렉토리)에 누적 캐시가 있으면 새 위치로 1회 이전 — 메인PC 기존 기록 보존
for (const [oldP, newP] of [["../mayhem_companion_std.json", STD_CACHE_PATH], ["../mayhem_companion_aug.json", AUG_CACHE_PATH]]) {
  try { const op = path.resolve(DB_PATH, oldP); if (existsSync(op) && !existsSync(newP)) writeFileSync(newP, readFileSync(op)); } catch {}
}
const Q_STANDARD = 450, Q_AUGMENT = 2400; // 일반칼바람 / 증바람(아수라장)
// 아수라장 클래식 스타일(gameMode KIWI_JADE, 커스텀 3280). 증강을 갖지만 증바람(2400)과 다른 모드 — 절대 합치지 않는다.
const Q_CLASSIC = 2450;
const MIN_DUR = 480; // 8분(480초) 미만 게임(리메이크/조기종료)은 집계 제외 — aram-mayhem.com 사이트(server.js MIN_REPORT_GAME_DURATION_SECONDS, search.js MIN_DURATION_SECONDS)와 일치
// 증강 시즌2 술어(server.js makeAugmentSeasonFilter와 동일): gameVersion 16.12+ & 2026-06-04 경계 이후
const AUG_S2_VERNUM = 1612, AUG_S2_BOUNDARY_MS = 1780535674230;
const augVerNum = x => { const v = String((x && x.gameVersion) || "").match(/(\d+)\.(\d+)/); return v ? +v[1] * 100 + +v[2] : 0; };

// 매치카드용 아이콘/추출(필드명은 기존 aram_mayhem_auto/server.js 검증값과 동일)
// 데이터드래곤 버전(아이콘/이름 전용) — 신 챔피언(로크=Locke 등) 깨짐 방지. 최신 폴백 + 라이브 동적 갱신.
//   ⚠️ 위의 증강 시즌2 경계(gameVersion 16.12+)와는 별개(시즌 경계는 절대 안 건드림).
let DDV = "16.13.1";
(async () => { try { const v = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json"); if (Array.isArray(v) && /^\d+\.\d+/.test(String(v[0] || ""))) DDV = v[0]; } catch {} })();
const SPELL_ICON = { 1:"SummonerBoost",3:"SummonerExhaust",4:"SummonerFlash",6:"SummonerHaste",7:"SummonerHeal",11:"SummonerSmite",12:"SummonerTeleport",13:"SummonerMana",14:"SummonerDot",21:"SummonerBarrier",30:"SummonerPoroRecall",31:"SummonerPoroThrow",32:"SummonerSnowball",39:"SummonerSnowball" };
const spellIcon = id => SPELL_ICON[Number(id)] ? `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/spell/${SPELL_ICON[Number(id)]}.png` : "";
const itemIconUrl = id => Number(id) > 0 ? `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/item/${Number(id)}.png` : "";
// 소모품·영약·와드·트링킷·기본부품 등 빌드 추천에 안 뜨게(사이트 STANDARD_ARAM_EXCLUDED_ITEM_IDS와 동일) + 6701/3400(삭제 아이템)
export const EXCLUDE_ITEM = new Set([
  2052, 2051, 3112, 3177, 3184, 222051, 223112, 223177, 223184, 223185,
  2421, 2138, 2139, 2140, 2150, 2151, 2152, 2055, 2056, 3340, 3363, 3364, 3400, 2520, 6701, 220013, // 220013=포로 간식(아수라장 소모품, base 13이라 %10000으로도 안 잡힘 → 명시)
  1001, 1004, 1006, 1011, 1018, 1026, 1027, 1028, 1029, 1031, 1033, 1035, 1036, 1037, 1038, 1039,
  1042, 1043, 1052, 1053, 1054, 1055, 1056, 1057, 1058, 1082, 1083,
  1500, 1501, 1502, 1503, 1504, 1506, 1507, 1508, 1509, 1510, 1511, 1512, 1515, 1516, 1517, 1518, 1519, 1520,
  2003, 2010, 2015, 2019, 2020, 2021, 2022, 2031, 2032, 2033, 2049, 2050, 2403, 2419, 2420, 2422, 2423,
  3003, 2508, 3012, 3023, 3024, 3035, 3044, 3051, 3057, 3066, 3067, 3070, 3077, 3082, 3086, 3105,
  3108, 3113, 3114, 3133, 3134, 3140, 3144, 3145, 3147, 3155, 3211, 3801, 3802,
  3865, 3866, 3867, 3869, 3917, 4630, 4632, 4635, 4642, 6029, 6660, 6670, 6690
]);
const isExcludedItem = v => EXCLUDE_ITEM.has(v) || EXCLUDE_ITEM.has(v % 10000); // 증강 변종(22xxxx)도 baseId로 차단
const isRuneLikeItemId = v => Number(v) >= 8000 && Number(v) < 9000; // 오래된 캐시에 룬 ID가 items에 섞인 경우 방어
function pickItems(p, s) { const out = []; for (let i = 0; i < 7; i++) { const v = Number((p && p["item" + i]) ?? (s && s["item" + i]) ?? 0); if (v > 0 && !isExcludedItem(v) && !isRuneLikeItemId(v)) out.push(v); } return out; }
function runeIdsFromItemLeak(items) { return [...new Set((items || []).map(Number).filter(isRuneLikeItemId))]; }
const durStr = sec => { sec = Math.round(sec || 0); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };

function findLockfile(skipProcessProbe) {
  if (process.env.MAYHEM_NO_LCU) return null; // 테스트용 — "LCU 없는 다른 PC/PC방" 시뮬레이션(leagueOff)
  // 0) 수동 지정(양 OS 최우선) — 자동탐지 실패 시 사용자가 lockfile 절대경로를 지정.
  if (process.env.LCU_LOCKFILE && existsSync(process.env.LCU_LOCKFILE)) return process.env.LCU_LOCKFILE;
  if (process.platform === "linux") return findLockfileLinux(); // 리눅스(Wine/Lutris/Bottles로 롤 실행)
  if (process.platform === "darwin") return findLockfileMac(); // macOS(롤 공식 Mac 클라이언트)
  return findLockfileWin(skipProcessProbe); // Windows — 권위 출처(라이엇 설치 메타데이터 + 실행 프로세스) 기반. 드라이브/폴더 추측 금지(비표준 E: 설치·이동설치도 잡힘).
}
// PowerShell 1회 실행(프로필 미로드·비대화·콘솔 숨김·짧은 타임아웃). 오류는 흡수 → 빈문자열(상위에서 다음 출처로 폴백). 2>&1 금지(PS5.1 native-stderr 래핑 이슈).
function _ps(cmd) {
  // ⚠️ execSync 는 Electron 메인 프로세스(=창의 UI 스레드)를 그대로 세운다. 타임아웃은 '창이 굳는 최대 시간'과 같으므로 짧게 잡는다.
  try { return execSync('powershell -NoProfile -NonInteractive -Command "' + cmd + '"', { encoding: "utf8", timeout: 2500, windowsHide: true }); }
  catch { return ""; }
}
// 설치 디렉터리 후보(라이브 우선, PBE 후순위) — C:\ProgramData 메타데이터에서. 어느 드라이브/폴더에 깔려도 여기에 경로가 적힘(클라 꺼져 있어도 경로는 나옴, lockfile은 실행 중에만 존재).
function _winInstallDirs() {
  const pd = process.env.ProgramData || "C:\\ProgramData";
  const dirs = [];
  for (const ch of ["league_of_legends.live", "league_of_legends.pbe"]) { // product_settings.yaml → product_install_full_path
    try { const y = readFileSync(path.join(pd, "Riot Games", "Metadata", ch, ch + ".product_settings.yaml"), "utf8");
      const m = y.match(/product_install_full_path:\s*"?([^"\r\n]+)"?/); if (m && m[1]) dirs.push(m[1].trim()); } catch {}
  }
  try { const j = JSON.parse(readFileSync(path.join(pd, "Riot Games", "RiotClientInstalls.json"), "utf8")); // associated_client 키 = 설치 디렉터리들(rc_default/rc_live는 RiotClientServices.exe라 무시)
    for (const k of Object.keys(j.associated_client || {})) dirs.push(k); } catch {}
  return [...new Set(dirs)].sort((a, b) => (/\(PBE\)|\.pbe/i.test(a) ? 1 : 0) - (/\(PBE\)|\.pbe/i.test(b) ? 1 : 0));
}
function findLockfileWin(skipProcessProbe) {
  // 1) 설치 메타데이터 경로 → lockfile (드라이브/폴더/한글경로 무관)
  for (const d of (_rlInstallDirs || (_rlInstallDirs = _winInstallDirs()))) { const lf = path.join(String(d).replace(/[\\/]+$/, ""), "lockfile"); if (existsSync(lf)) return lf; } // 설치 경로는 안 바뀌므로 캐시 재사용
  // 2) 실행 중 LeagueClientUx 이미지경로(CIM ExecutablePath → Get-Process .Path) — 메타데이터가 낡았거나 없을 때 백스톱
  //    ★프로세스가 없다고 방금 확인됐으면(skipProcessProbe) 이 PowerShell 2회는 건너뛴다 — 답이 정해져 있는데 창만 굳힌다.
  if (!skipProcessProbe) {
    const out = _ps("$ErrorActionPreference='SilentlyContinue';(Get-CimInstance Win32_Process|Where-Object{$_.Name -eq 'LeagueClientUx.exe'}|Select-Object -ExpandProperty ExecutablePath)") ||
                _ps("$ErrorActionPreference='SilentlyContinue';(Get-Process LeagueClientUx|Select-Object -First 1 -ExpandProperty Path)");
    const exe = String(out).split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (exe) { const lf = path.join(path.dirname(exe), "lockfile"); if (existsSync(lf)) return lf; }
  }
  // 3) 최후 보조: 흔한 표준 경로 스윕(메타데이터·프로세스 모두 실패한 희귀 케이스)
  const rel = "/Riot Games/League of Legends/lockfile";
  return ["C:" + rel, "D:" + rel, "E:" + rel, "F:" + rel, "G:" + rel,
    "C:/Program Files" + rel, "C:/Program Files (x86)" + rel, "D:/Program Files" + rel, "E:/Program Files" + rel].find(p => existsSync(p)) || null;
}
// 실행 중 LeagueClientUx 커맨드라인에서 포트+토큰 직접 추출(파일·경로 불필요 → 드라이브/한글경로/이동설치/오래된락파일에 강함). 관리자권한 클라면 CIM CommandLine이 NULL → null 반환(경로기반으로 폴백).
// ★2026-07-22: 프로세스 유무를 같이 알아낸다. 예전엔 null 이 "안 켜짐"과 "켜졌는데 CommandLine 이 가려짐(관리자권한)"을
//   구분 못 해서, 클라가 아예 없을 때도 findLockfileWin 이 PowerShell 을 두 번 더 돌렸다(같은 사실을 세 번 물음).
//   서버가 Electron 메인 프로세스에서 돌기 때문에 그 execSync 시간만큼 창이 그대로 굳는다. ProcessId 마커로 판별한다.
let _lcuProcSeen = false;
function discoverLcuFromProcess() {
  const out = _ps("$ErrorActionPreference='SilentlyContinue';(Get-CimInstance Win32_Process|Where-Object{$_.Name -eq 'LeagueClientUx.exe'}|ForEach-Object{'#'+$_.ProcessId+'|'+$_.CommandLine})");
  _lcuProcSeen = /(^|\r?\n)#\d+\|/.test(String(out)); // 프로세스가 실제로 있으면 true(커맨드라인이 비어도)
  const lines = String(out).split(/\r?\n/).filter(l => /--app-port=/.test(l))
    .sort((a, b) => (/\(PBE\)|league_of_legends\.pbe/i.test(a) ? 1 : 0) - (/\(PBE\)|league_of_legends\.pbe/i.test(b) ? 1 : 0)); // 라이브 우선
  for (const line of lines) {
    const p = line.match(/--app-port=(\d+)/), t = line.match(/--remoting-auth-token=([\w-]+)/);
    if (p && t) return { port: Number(p[1]), password: t[1] };
  }
  return null;
}
// macOS: 실행 중인 LeagueClientUx 커맨드라인에서 포트+토큰 직접 추출
function discoverLcuFromProcessMac() {
  try {
    const out = execSync("ps -ax -o args=", { encoding: "utf8", timeout: 2000 });
    const lines = String(out).split(/\r?\n/).filter(l => /LeagueClientUx/i.test(l) && /--app-port=/.test(l))
      .sort((a, b) => (/\(PBE\)|league_of_legends\.pbe/i.test(a) ? 1 : 0) - (/\(PBE\)|league_of_legends\.pbe/i.test(b) ? 1 : 0));
    for (const line of lines) {
      const p = line.match(/--app-port=(\d+)/), t = line.match(/--remoting-auth-token=([\w-]+)/);
      if (p && t) return { port: Number(p[1]), password: t[1] };
    }
  } catch {}
  return null;
}
// macOS: 롤 공식 Mac 클라이언트. lockfile은 League 설치앱 안(Contents/LoL/lockfile). LCU 접속은 동일(127.0.0.1:port https).
function findLockfileMac() {
  const home = os.homedir();
  const rel = "/Contents/LoL/lockfile";
  const cands = [
    "/Applications/League of Legends.app" + rel,
    home + "/Applications/League of Legends.app" + rel,
    "/Applications/Riot Games/League of Legends.app" + rel
  ];
  for (const p of cands) { try { if (existsSync(p)) return p; } catch {} }
  return null;
}
// 리눅스: 롤을 Wine/Lutris/Bottles prefix로 돌리는 경우의 lockfile 탐지. 자동탐지 실패하면 LCU_LOCKFILE 환경변수로 수동지정.
//   LCU 자체(127.0.0.1:port https)는 Wine가 호스트 loopback을 공유하므로 네이티브 리눅스 앱에서 그대로 접속됨.
function findLockfileLinux() {
  const home = os.homedir();
  const rel = "/drive_c/Riot Games/League of Legends/lockfile";
  const roots = [
    process.env.WINEPREFIX,
    home + "/.wine",
    home + "/Games/league-of-legends",
    home + "/Games/lutris/league-of-legends",
    home + "/.local/share/lutris/prefixes/league-of-legends",
    home + "/.var/app/net.lutris.Lutris/data/lutris/prefixes/league-of-legends", // Flatpak Lutris
    home + "/.PlayOnLinux/wineprefix/LeagueOfLegends"
  ].filter(Boolean);
  for (const r of roots) { try { const p = r + rel; if (existsSync(p)) return p; } catch {} }
  // 알 수 없는 prefix: 흔한 루트 아래 얕게(깊이 3) "drive_c/Riot Games/League of Legends/lockfile" 탐색.
  for (const base of [home + "/Games", home + "/.local/share/lutris/prefixes", home + "/.local/share/bottles/bottles"]) {
    const found = shallowFindLockfile(base, 3);
    if (found) return found;
  }
  return null;
}
function shallowFindLockfile(dir, depth) {
  if (depth < 0) return null;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = dir + "/" + e.name;
    try { const direct = sub + "/drive_c/Riot Games/League of Legends/lockfile"; if (existsSync(direct)) return direct; } catch {}
    const found = shallowFindLockfile(sub, depth - 1);
    if (found) return found;
  }
  return null;
}
// ★★드래그 렉 수정: readLockfile은 매 폴(2.5초)마다 호출되는데, 원래 구현은 Windows에서 동기 PowerShell(discoverLcuFromProcess+findLockfileWin, execSync ~2초)을 매번 돌려 Electron 메인 프로세스(=창 드래그)를 주기적으로 ~2초 막았다("2초마다 렉").
//   → 여기 래퍼로: (1) 설치 메타 dir의 lockfile을 existsSync로 빠르게 본다(실행중이면 즉시 포트 획득, PowerShell 없음. 게임 시작/종료도 여기서 바로 감지). (2) 메타에 lockfile 없을 때만(대개 클라 꺼짐) 비싼 PowerShell 폴백을 캐시로 드물게(꺼짐 45s/비표준 실행 15s) 돌린다. 표준 설치+실행중이면 PowerShell 아예 안 탐 → 창 안 막힘.
let _rlInstallDirs = null, _rlCache = { at: 0, lcu: undefined };
function _rlFindMetaLockfile() { // 설치 메타데이터 dir에 lockfile 있으면 그 경로(=실행중), win인데 없으면 null, 비win이면 undefined. execSync/PowerShell 안 씀.
  if (process.platform !== "win32") return undefined;
  try { if (!_rlInstallDirs) _rlInstallDirs = _winInstallDirs(); for (const d of _rlInstallDirs) { const lf = path.join(String(d).replace(/[\\/]+$/, ""), "lockfile"); if (existsSync(lf)) return lf; } return null; } catch { return null; }
}
function readLockfile() {
  const now = Date.now();
  if (process.env.MAYHEM_NO_LCU) return null;
  if (process.env.LCU_LOCKFILE && existsSync(process.env.LCU_LOCKFILE)) { try { const p = readFileSync(process.env.LCU_LOCKFILE, "utf8").trim().split(":"); return { port: Number(p[2]), password: p[3] }; } catch { return null; } }
  const lf = _rlFindMetaLockfile();
  if (lf) { try { const p = readFileSync(lf, "utf8").trim().split(":"); if (p[2]) { const lcu = { port: Number(p[2]), password: p[3] }; _rlCache = { at: now, lcu }; return lcu; } } catch {} } // 실행중 — 매번 신선 읽기(재시작 포트변경 대응), PowerShell 없음
  // win·메타 락파일 없음 → PowerShell 폴백을 캐시로 드물게만.
  //   ★2026-07-22: 클라가 꺼져 있을 때 45초→3분으로 늘렸다. 그 사이 클라를 켜면 위 179줄의 메타 락파일 경로가
  //   PowerShell 없이 즉시 잡으므로 정상 설치에선 감지가 늦어지지 않는다. 설치 경로 캐시는 폴백 때마다 새로 읽어
  //   앱 실행 후 롤을 새로 설치한 경우도 따라잡는다.
  if (lf === null) {
    const ttl = _rlCache.lcu ? 15000 : 180000;
    if (_rlCache.lcu !== undefined && now - _rlCache.at < ttl) return _rlCache.lcu;
    _rlInstallDirs = null;
    const v = _readLockfileReal(); _rlCache = { at: now, lcu: v }; return v;
  }
  if (_rlCache.lcu !== undefined && now - _rlCache.at < 8000) return _rlCache.lcu; // 비win(mac/linux) — 가벼운 8s 캐시
  const v = _readLockfileReal(); _rlCache = { at: now, lcu: v }; return v;
}
function _readLockfileReal() {
  if (process.env.MAYHEM_NO_LCU) return null; // 테스트용 — LCU 없는 PC 시뮬(leagueOff). discoverLcuFromProcess보다 반드시 먼저.
  if (process.env.LCU_LOCKFILE && existsSync(process.env.LCU_LOCKFILE)) { // 수동 지정 최우선(양 OS)
    const p = readFileSync(process.env.LCU_LOCKFILE, "utf8").trim().split(":"); return { port: Number(p[2]), password: p[3] };
  }
  let skipProbe = false;
  if (process.platform === "win32") { const direct = discoverLcuFromProcess(); if (direct) return direct; skipProbe = !_lcuProcSeen; } // 실행 중 클라 커맨드라인에서 포트+토큰 직접(가장 강건). 프로세스 자체가 없으면 아래 재확인 생략
  if (process.platform === "darwin") { const direct = discoverLcuFromProcessMac(); if (direct) return direct; }
  const f = findLockfile(skipProbe); if (!f) return null;
  const parts = readFileSync(f, "utf8").trim().split(":"); // name:pid:port:password:protocol
  return { port: Number(parts[2]), password: parts[3] };
}
function lcuGet(lcu, p) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: "127.0.0.1", port: lcu.port, path: p, method: "GET", rejectUnauthorized: false,
      headers: { Authorization: "Basic " + Buffer.from("riot:" + lcu.password).toString("base64") }
    }, res => { const ch = []; res.on("data", c => ch.push(c)); res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString("utf8"))); } catch { reject(new Error("LCU 응답 파싱 실패: " + p)); } }); });
    req.setTimeout(5000, () => req.destroy(new Error("LCU timeout: " + p))); // ★없으면 클라가 응답을 늦추는 순간(로딩·패치 중) 요청 하나가 무한 대기하고 화면이 그만큼 멈춘다
    req.on("error", reject); req.end();
  });
}
async function getMatches(lcu, count = 2000) {
  const out = [], seen = new Set(), PAGE = 100; // 큰 페이지로 한 번에 더 많이(LCU 캐시 깊이만큼)
  for (let beg = 0; beg < count; beg += PAGE) {
    const end = Math.min(beg + PAGE - 1, count - 1);
    const j = await lcuGet(lcu, `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${beg}&endIndex=${end}`);
    const g = (j && j.games && j.games.games) || [];
    let added = 0;
    for (const game of g) { const id = game.gameId; if (id != null && seen.has(id)) continue; if (id != null) seen.add(id); out.push(game); added++; } // gameId 중복제거 — LCU 페이징 무시 ×N 부풀림 차단
    if (g.length === 0 || added === 0) break; // 끝 or 새 게임 없음 → 중단
  }
  return out;
}
function fetchJson(url, timeoutMs = 8000) { // 공개 JSON GET(ddragon 등) — 타임아웃 포함
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const ch = []; res.on("data", c => ch.push(c)); res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString("utf8"))); } catch (e) { reject(e); } }); // Buffer 연결(한글 청크경계 □□ 방지)
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}
const CHAMP_DD_CACHE = path.join(CACHE_DIR, "ddragon_champions.json");
function ddMap(data) { const names = new Map(), icons = new Map(); for (const k of Object.keys(data || {})) { const c = data[k]; const id = Number(c.key); if (!id) continue; names.set(id, c.name); icons.set(id, `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/champion/${c.id}.png`); } return { names, icons }; }
async function fetchChampionDDragon() { // 다른 PC용 — 챔프 이름/아이콘을 공개 CDN에서(로컬 코호트 없을 때)
  try { const c = JSON.parse(readFileSync(CHAMP_DD_CACHE, "utf8")); if (c.v === DDV && c.data && (Date.now() - (c.t || 0) < 7 * 864e5)) return ddMap(c.data); } catch {}
  const j = await fetchJson(`https://ddragon.leagueoflegends.com/cdn/${DDV}/data/ko_KR/champion.json`);
  try { writeFileSync(CHAMP_DD_CACHE, JSON.stringify({ v: DDV, t: Date.now(), data: j.data })); } catch {}
  return ddMap(j.data);
}
let _maps = null;
async function champMaps() {
  if (_maps) return _maps; // 세션 캐시(1회만)
  try { // 1) 로컬 코호트(메인PC) — 사이트와 동일 이름/아이콘
    const j = JSON.parse(await readFile(path.join(API_DIR, "standard-aram-cohort-all.json"), "utf8"));
    const names = new Map(), icons = new Map();
    for (const c of (j.report && j.report.championRows) || []) { const id = Number(c.championId); if (!id) continue; names.set(id, c.localName || c.displayName); if (c.icon) icons.set(id, c.icon); }
    if (names.size) return (_maps = { names, icons });
  } catch {}
  try { // 2) 폴백: ddragon champion.json — 로컬 코호트 없는 다른 PC. "챔프#id" 깨짐 해소(공개 CDN, 어디서나 동작)
    const dd = await fetchChampionDDragon();
    if (dd.names.size) return (_maps = dd);
  } catch {}
  return { names: new Map(), icons: new Map() }; // 둘 다 실패 시 비움(다음 호출 재시도)
}
// 경기 상세용 룬 추출 — LCU 매치 리스트는 형식이 두 가지다:
//  (A) stats.perk0..5 + statPerk0..2 + perkPrimaryStyle/subStyle (구 LCU/match-v4)
//  (B) participant.perks.styles[].selections[].perk + perks.statPerks (match-v5형)
// 둘 다 처리해 어느 쪽이 와도 6룬+3파편이 채워지게 한다(perks.ids=1 빈약 사례 보강).
const isShardId = n => n >= 5000 && n < 6000; // 스탯 파편 id대(5001~5013). 룬 퍼크(8xxx/9xxx)와 구분.
export function extractPerks(p, s) {
  let ids = [s.perk0, s.perk1, s.perk2, s.perk3, s.perk4, s.perk5].map(Number).filter(n => n > 0);
  let shards = [s.statPerk0, s.statPerk1, s.statPerk2].map(Number).filter(n => n > 0);
  let primary = Number(s.perkPrimaryStyle) || null;
  let sub = Number(s.perkSubStyle) || null;
  const pk = p && p.perks;
  if (ids.length < 4) {
    const direct = []
      .concat(Array.isArray(p && p.perkIds) ? p.perkIds : [])
      .concat(Array.isArray(p && p.selectedPerkIds) ? p.selectedPerkIds : [])
      .concat(Array.isArray(pk && pk.perkIds) ? pk.perkIds : [])
      .map(Number).filter(n => n > 0);
    if (direct.length) ids = direct;
  }
  if (pk && Array.isArray(pk.styles)) { // (B) 스타일 리스트: primary/sub는 항상, ids는 빈약할 때만 보강
    const sel = [];
    for (const st of pk.styles) {
      for (const x of (st.selections || [])) { const v = Number(x.perk); if (v > 0) sel.push(v); }
      if (st.description === "primaryStyle" && Number(st.style)) primary = Number(st.style);
      if (st.description === "subStyle" && Number(st.style)) sub = Number(st.style);
    }
    if (ids.length < 4 && sel.length) ids = sel;
  }
  // 파편(statPerks) 추출을 ids 게이트 밖 독립 블록으로 — 룬 ids가 perkIds로 먼저 채워져도 파편이 빠지지 않게(파편 미수집 버그 수정). match-v5 객체형.
  if (!shards.length && pk && pk.statPerks) {
    const sp = [pk.statPerks.offense, pk.statPerks.flex, pk.statPerks.defense].map(Number).filter(n => n > 0);
    if (sp.length) shards = sp;
  }
  // 파편이 룬 id 평면배열에 섞여온 경우(일부 LCU 포맷) 분리 — 5xxx를 파편으로.
  if (!shards.length) { const sh = ids.filter(isShardId); if (sh.length) shards = sh; }
  ids = ids.filter(n => n > 0 && !isShardId(n)); // 룬 집계에 파편이 섞이지 않게 5xxx 제거
  if (ids.length < 1) ids = runeIdsFromItemLeak(pickItemsWithRunes(p, s));
  return { primary, sub, ids, shards };
}
function pickItemsWithRunes(p, s) { const out = []; for (let i = 0; i < 7; i++) { const v = Number((p && p["item" + i]) ?? (s && s["item" + i]) ?? 0); if (v > 0) out.push(v); } return out; }
// ── 팀내 피해/받은피해 점유(%) — 사주풀이 '선공 기질(share-aggression)' 입력. 5인팀이라 균등 = 20%.
//   10인 teamParticipants(db.json·augfull) 와 stdfull 린 tp(pid/tm/d/td) 양쪽 스키마를 다 먹는다.
//   ★team.length < 2 하드가드 = 이번 버그의 정확한 재발 지점이다. 팀 행이 자기 하나뿐이면 자기/자기 = 100%가
//     나온다 — 그게 2026-07-17 이전 495행이 전부 100.0%였던 이유다. 구하지 못하면 지어내지 말고 null.
function teamShares(tp, myPuuid, myPid) {
  const rows = Array.isArray(tp) ? tp : [];
  const me = (myPuuid && rows.find(p => p && p.puuid && p.puuid === myPuuid))
    || (myPid != null && rows.find(p => p && Number(p.participantId ?? p.pid) === Number(myPid))) || null;
  if (!me) return { dmgShare: null, takenShare: null };
  const tid = me.teamId ?? me.tm;
  const team = rows.filter(p => (p.teamId ?? p.tm) === tid);
  if (team.length < 2) return { dmgShare: null, takenShare: null };
  const D = p => Number(p.totalDamageDealtToChampions ?? p.d) || 0, T = p => Number(p.totalDamageTaken ?? p.td) || 0;
  let sd = 0, st = 0; for (const p of team) { sd += D(p); st += T(p); }
  return { dmgShare: sd > 0 ? D(me) / sd * 100 : null, takenShare: st > 0 ? T(me) / st * 100 : null };
}
function myStat(game, puuid) {
  let p = (game.participants || []).find(x => x.puuid === puuid);
  if (!p) { const pi = (game.participantIdentities || []).find(x => x.player && x.player.puuid === puuid); p = (game.participants || []).find(x => x.participantId === (pi && pi.participantId)); }
  if (!p) return null; // 내 참가자를 못 찾으면 버린다 — 남의 전적 오귀속 금지
  const s = p.stats || {};
  const myDmg = s.totalDamageDealtToChampions || 0, myTaken = s.totalDamageTaken || 0;
  // ⚠️ 선공 기질 입력(dmgShare/takenShare)은 여기서 만들 수 없다. LCU '목록'(getMatches)의 game.participants 엔
  //    내 참가자 하나뿐이라 "팀 합 == 내 값" → 항상 100%가 됐다(실측 2026-07-17: std 8 + aug 487 = 495행 전부 100.0%).
  //    팀 합은 게임별 상세(teamParticipants / stdfull tp)에만 있다 → getRecords·mergeAugmentRows 에서 조인해 붙인다.
  return {
    puuid: puuid || (p && p.puuid) || "", // 어느 계정 게임인지(같은 PC 다계정 분리용) — 캐시는 합산하되 표시는 현재 계정만
    gid: game.gameId ?? null, championId: p.championId, win: !!s.win, k: s.kills || 0, d: s.deaths || 0, a: s.assists || 0,
    queueId: game.queueId, t: game.gameCreation || 0, dur: game.gameDuration || 0,
    cs: (s.totalMinionsKilled || 0) + (s.neutralMinionsKilled || 0),
    dmg: myDmg, taken: myTaken, gold: s.goldEarned || 0,
    mit: s.damageSelfMitigated || 0, heal: s.totalHeal || 0, cc: s.timeCCingOthers || 0, shield: s.totalDamageShieldedOnTeammates || 0, // 칼바람 임팩트 라디아+경기 상세지표용(피해감소/회복/CC/실드) — 표준은 신규 게임부터 수집
    dmgShare: null, takenShare: null, // 상세(teamParticipants) 조인으로만 채움 — 목록에선 구조적으로 불가(위 주석)
    lvl: s.champLevel || 0, mk: s.largestMultiKill || 0,
    spells: [spellIcon(p.spell1Id ?? s.spell1Id ?? p.summoner1Id ?? s.summoner1Id), spellIcon(p.spell2Id ?? s.spell2Id ?? p.summoner2Id ?? s.summoner2Id)].filter(Boolean),
    items: pickItems(p, s),
    // 경기 상세용 룬(일반 칼바람) — 두 LCU 형식 모두 처리. 아이콘 매핑은 클라(runesReforged).
    perks: extractPerks(p, s)
  };
}
function buildRecord(rows, m) {
  const names = m.names, icons = m.icons;
  rows = (Array.isArray(rows) ? rows : []).filter(r => Number(r.dur || 0) >= MIN_DUR); // 8분 미만 게임 집계 제외(사이트와 일치)
  const total = rows.length, wins = rows.filter(r => r.win).length, by = new Map();
  const itemBy = new Map(), augmentBy = new Map(), runeBy = new Map();
  const addPick = (map, key, win, extra = {}) => {
    if (!key) return;
    const c = map.get(key) || { id: extra.id ?? null, name: "", icon: "", games: 0, wins: 0 };
    if (!c.name && extra.name) c.name = extra.name;
    if (!c.icon && extra.icon) c.icon = extra.icon;
    c.games++; c.wins += win ? 1 : 0; map.set(key, c);
  };
  const adj = (w, g) => g ? Math.round(((w + 3) / (g + 6)) * 100) : 50;
  let TK = 0, TD = 0, TA = 0;
  for (const r of rows) {
    const c = by.get(r.championId) || { games: 0, wins: 0, k: 0, d: 0, a: 0, dmg: 0, taken: 0, gold: 0, dur: 0, mit: 0, heal: 0, cc: 0 };
    c.games++; c.wins += r.win ? 1 : 0; c.k += r.k; c.d += r.d; c.a += r.a;
    c.dmg += r.dmg || 0; c.taken += r.taken || 0; c.gold += r.gold || 0; c.dur += r.dur || 0; c.mit += r.mit || 0; c.heal += r.heal || 0; c.cc += r.cc || 0; by.set(r.championId, c);
    const itemRows = (r.itemDetails && r.itemDetails.length)
      ? r.itemDetails
      : (r.items || []).map(id => ({ id, name: "", icon: itemIconUrl(id) }));
    const seenItems = new Set();
    for (const it of itemRows) {
      const id = Number(it && it.id);
      if (!(id > 0) || isExcludedItem(id) || isRuneLikeItemId(id) || seenItems.has(id)) continue;
      seenItems.add(id);
      addPick(itemBy, "item:" + id, r.win, { id, name: it.name || it.localName || "", icon: it.icon || itemIconUrl(id) });
    }
    for (const a of (r.augments || [])) {
      const id = a && a.value != null ? Number(a.value) : null;
      const name = (a && (a.localName || a.name)) || "";
      addPick(augmentBy, id ? "aug:" + id : "aug:" + name, r.win, { id, name, icon: (a && a.icon) || "" });
    }
    const perkIds = (r.perks && Array.isArray(r.perks.ids) && r.perks.ids.length) ? r.perks.ids : runeIdsFromItemLeak(r.items);
    for (const id of perkIds) {
      const n = Number(id);
      if (n > 0) addPick(runeBy, "rune:" + n, r.win, { id: n });
    }
    TK += r.k; TD += r.d; TA += r.a;
  }
  const nm = id => names.get(Number(id)) || ("챔프#" + id), ic = id => icons.get(Number(id)) || "";
  const fd = t => { const d = new Date(t || 0); return (d.getMonth() + 1) + "/" + d.getDate(); }; // 월/일. 게임 한 시각(AM/PM)은 불필요(사용자). 목록엔 게임길이 분단위, 상세엔 MM:SS를 클라서 붙임.
  const mkPicks = map => [...map.values()].map(c => ({
    id: c.id, name: c.name || "", icon: c.icon || "", games: c.games, wins: c.wins,
    winRate: Math.round(c.wins / c.games * 100), adj: adj(c.wins, c.games), thin: c.games < 3
  })).sort((a, b) => b.games - a.games);
  const champs = [...by.entries()].map(([id, c]) => {
    const mins = (c.dur || 0) / 60;
    return {
      id: Number(id), name: nm(id), icon: ic(id), games: c.games, wins: c.wins, thin: c.games < 8,
      winRate: Math.round(c.wins / c.games * 100), adj: adj(c.wins, c.games),
      kda: `${(c.k / c.games).toFixed(1)}/${(c.d / c.games).toFixed(1)}/${(c.a / c.games).toFixed(1)}`,
      dpm: mins > 0 ? Math.round(c.dmg / mins) : 0, taken: mins > 0 ? Math.round(c.taken / mins) : 0, gpm: mins > 0 ? Math.round(c.gold / mins) : 0, // 분당 개인지표(메타 비교용)
      mit: mins > 0 ? Math.round(c.mit / mins) : 0, heal: mins > 0 ? Math.round(c.heal / mins) : 0, cc: mins > 0 ? +(c.cc / mins).toFixed(1) : 0 // 레이더 내 값(피해감소/회복/CC) — 챔프 합계에 빠져 '-'로 뜨던 것 보강(매치엔 있었음)
    };
  }).sort((a, b) => b.games - a.games);
  const sorted = [...rows].sort((a, b) => (b.t || 0) - (a.t || 0));
  const _sumMin = rows.reduce((s, r) => s + (r.dur || 0), 0) / 60;
  return {
    total, wins, winRate: total ? Math.round(wins / total * 100) : 0,
    avgKda: total ? `${(TK / total).toFixed(1)}/${(TD / total).toFixed(1)}/${(TA / total).toFixed(1)}` : "-",
    avgDpm: _sumMin > 0 ? Math.round(rows.reduce((s, r) => s + (r.dmg || 0), 0) / _sumMin) : 0, // 분당 평균 딜량(칼바람 KDA 대체 요약지표)
    avgTaken: _sumMin > 0 ? Math.round(rows.reduce((s, r) => s + (r.taken || 0), 0) / _sumMin) : 0,
    form: sorted.slice(0, 20).map(r => r.win),
    /* ★2026-09-14 평균 등수 배지용 예비 판 번호. 화면에 그리는 recent 는 20판 그대로 두고,
       등수를 매길 후보만 40판까지 따로 싣는다(문자열 40개라 비용이 없다).
       왜: 20판만 보내면 gid 가 없거나 상세를 못 구한 판이 그대로 빠져 '최근 20판' 이
       17판·15판으로 흔들렸다. 예비를 줘야 20판을 채울 수 있다. */
    rankGids: sorted.slice(0, 40).map(r => (r.gid != null ? String(r.gid) : null)).filter(Boolean),
    recent: sorted.slice(0, 20).map(r => {
      const fallbackPerkIds = runeIdsFromItemLeak(r.items);
      const perks = (r.perks && Array.isArray(r.perks.ids) && r.perks.ids.length)
        ? r.perks
        : (fallbackPerkIds.length ? { primary: null, sub: null, ids: fallbackPerkIds, shards: [] } : null);
      return {
        // ★2026-07-22 gid 동봉: 클라가 경기 상세를 **배열 인덱스**로 히스토리에 저장하고 있었는데, 목록은 3분마다·창 포커스마다
        //   통째로 갱신된다. 새 경기가 앞에 끼면 인덱스가 밀려 같은 히스토리 엔트리가 다른 경기(=다른 챔피언)를 열었다.
        //   원본 행에 이미 있는 안정 키를 그대로 실어 보낸다.
        gid: (r.gid != null ? String(r.gid) : null),
        name: nm(r.championId), icon: ic(r.championId), win: r.win,
        kda: `${r.k}/${r.d}/${r.a}`, ratio: r.d ? ((r.k + r.a) / r.d).toFixed(2) : "Perfect",
        date: fd(r.t), dur: durStr(r.dur), cs: r.cs || 0, dmg: r.dmg || 0, taken: r.taken || 0, gold: r.gold || 0, lvl: r.lvl || 0, mk: r.mk || 0,
        mit: (r.mit ?? null), heal: (r.heal ?? null), cc: (r.cc ?? null), shield: (r.shield ?? null), // 경기 상세지표(피해감소/회복/CC/실드)
        dmgShare: r.dmgShare ?? null, takenShare: r.takenShare ?? null, // 선공 기질(share-aggression) 입력
        spells: r.spells || [], items: (r.items || []).map(itemIconUrl),
        augments: r.augments || [], perks
      };
    }),
    champs,
    picks: (() => {
      const rr = augmentRarityMap(), rm = runeMetaMap(); // 증강 rarity + 룬 슬롯/등급 맵(사주풀이 등급쿼터용, LCU 픽엔 없어 db.json에서 부착)
      return {
        items: mkPicks(itemBy),
        // 증강 등급쿼터(2프리즘/2골드/1실버): id 우선, 이름 폴백
        augments: mkPicks(augmentBy).map(p => ({ ...p, rarity: (p.id != null ? rr.get("id:" + Number(p.id)) : null) || rr.get(_norm(p.name)) || null })),
        // 룬 쿼터(2메인/2하위/1파편): runeSlot===1=키스톤(메인), rarity 파편=파편 — id로 부착
        runes: mkPicks(runeBy).map(p => { const m = (p.id != null ? rm.get(Number(p.id)) : null); return m ? { ...p, runeSlot: m.runeSlot, runeCategory: m.runeCategory, rarity: m.rarity, sourceKind: m.sourceKind } : p; })
      };
    })()
  };
}
function printRecord(title, rec, hint) {
  console.log(`\n■ ${title} — ${rec.total}판  ${rec.winRate}% (${rec.wins}승)`);
  if (!rec.total && hint) { console.log("   " + hint); return; }
  rec.champs.slice(0, 8).forEach(c => console.log(`   ${String(c.name).padEnd(7)} ${c.games}판  ${c.winRate}%  KDA ${c.kda}`));
}
function mockGames(puuid) {
  const g = (cid, win, k, d, a, q, items, sp, dmg, gold, cs, lvl, mk, dur) => ({
    queueId: q, gameCreation: Date.now(), gameDuration: dur,
    participantIdentities: [{ participantId: 1, player: { puuid } }],
    participants: [{
      participantId: 1, championId: cid, spell1Id: sp[0], spell2Id: sp[1],
      stats: Object.assign({ win, kills: k, deaths: d, assists: a, totalDamageDealtToChampions: dmg, totalDamageTaken: Math.round(dmg * 0.85), goldEarned: gold, totalMinionsKilled: cs, champLevel: lvl, largestMultiKill: mk }, items.reduce((o, it, i) => (o["item" + i] = it, o), {}))
    }]
  });
  return [
    g(63, 1, 12, 8, 20, 450, [6655, 3020, 3157, 3165, 3089, 3135], [4, 32], 31200, 13400, 41, 18, 2, 1140),
    g(63, 0, 5, 11, 14, 450, [6655, 3020, 3157, 3165], [4, 32], 18900, 9800, 28, 15, 0, 980),
    g(99, 1, 8, 6, 25, 450, [3115, 3089, 3157, 3165, 3135], [4, 7], 27600, 12100, 35, 17, 0, 1080),
    g(81, 1, 14, 7, 16, 450, [3142, 3814, 3179, 6694, 3036], [4, 32], 34800, 14200, 44, 18, 3, 1210),
    g(266, 1, 9, 10, 19, 2400, [6630, 3047, 3076, 3193, 3143], [4, 6], 22400, 11600, 0, 18, 0, 1320),
    g(266, 0, 4, 12, 11, 2400, [6630, 3047, 3076], [4, 6], 14100, 8200, 0, 16, 0, 1090),
    g(157, 1, 11, 6, 13, 2400, [6673, 3031, 3094, 3036, 3072], [4, 32], 29800, 13900, 0, 18, 2, 1250)
  ];
}
function readDb() { try { return JSON.parse(readFileSync(DB_PATH, "utf8")); } catch { return null; } }
// 현재 로그인 계정과 '같은 Riot 신원(gameName#tagLine)'의 puuid 집합.
//   Riot puuid 포맷 이관으로 같은 사람이 구RSO·신형 두 puuid를 가질 수 있어 같은 이름#태그면 함께 묶되,
//   PBE 등 '다른 계정'(예: Nangman2#PBE)은 제외 → "계정이 다르면 전적도 다르게".
//   viewPuuid를 모르면(첫 실행·롤 꺼짐·미로그인) 빈 집합 반환 → 호출측이 종전대로 전 계정 폴백(0판 방지).
function myIdentityPuuids(db, viewPuuid) {
  const set = new Set();
  const vp = String(viewPuuid || "").trim();
  if (!vp) return set;
  set.add(vp);
  const accts = (db && Array.isArray(db.accounts)) ? db.accounts : [];
  const me = accts.find(a => a.puuid === vp);
  if (me) for (const a of accts) if (a.gameName === me.gameName && String(a.tagLine || "") === String(me.tagLine || "") && a.puuid) set.add(a.puuid);
  return set;
}
// 증강 개인기록은 db.json(누적 저장소)에서 — 시즌2만. LCU 최근창이 아니라 전체.
//   ⚠️ onlyPuuids(현재 로그인 신원) 지정 시 그 계정만(PBE 등 다른 계정 제외). 미지정이면 종전대로 db 전 계정.
function augmentRowsFromDb(db, onlyPuuids = null) { // db.json → 시즌2 증강 행(buildRecord 호환). 병합용으로 행을 그대로 노출.
  if (!db || !Array.isArray(db.matches)) return [];
  const allow = (onlyPuuids instanceof Set && onlyPuuids.size) ? onlyPuuids : new Set((db.accounts || []).map(a => a.puuid).filter(Boolean));
  const seen = new Set();
  return db.matches.filter(x => {
    if (x.queueId !== Q_AUGMENT) return false;
    if (Number(x.gameDuration || 0) < MIN_DUR) return false; // 8분 미만 게임 집계 제외(사이트와 일치)
    if (allow.size && !allow.has(x.puuid)) return false; // 현재 로그인 계정만(PBE 등 다른 계정 제외)
    if (augVerNum(x) < AUG_S2_VERNUM || (x.gameCreation || 0) < AUG_S2_BOUNDARY_MS) return false; // 시즌2만(시즌1 구증강 섞지 않음)
    const id = x.matchId + "|" + x.puuid; if (seen.has(id)) return false; seen.add(id); return true;
  }).map(x => ({
    // ★gid 동봉: db.json matchId 는 "LCU-<gameId>" 다. 이걸 안 실으면 소유자 PC 에서만 증강 recent 의 gid 가
    //   전부 null 이 되고(dedupeByTime 이 db 행을 이기게 하므로), 경기 상세의 10인 스코어보드가 통째로 안 뜬다.
    //   외부 PC 는 db.json 이 없어 LCU 행(gid 보유)을 그대로 써서 멀쩡했다 = 내 PC 에서만 나던 증상.
    gid: (String(x.matchId || "").match(/(\d{5,})/) || [])[1] || null,
    championId: x.championId, win: !!x.win, k: x.kills || 0, d: x.deaths || 0, a: x.assists || 0,
    queueId: Q_AUGMENT, t: x.gameCreation || 0, dur: x.gameDuration || 0, cs: x.totalMinionsKilled || 0,
    dmg: x.totalDamageDealtToChampions || 0, taken: x.totalDamageTaken || 0, gold: x.goldEarned || 0, lvl: 0, mk: x.largestMultiKill || 0,
    mit: (x.damageSelfMitigated ?? null), heal: (x.totalHeal ?? null), cc: (x.timeCCingOthers ?? null), shield: (x.totalDamageShieldedOnTeammates ?? null), // 경기 상세지표(있을 때만; 없으면 '-')
    spells: (x.spells || []).map(spellIcon).filter(Boolean),
    items: (x.items || []).filter(id => Number(id) > 0 && !isExcludedItem(Number(id))),
    itemDetails: (x.itemsDetailed || []).map(d => ({ id: d.id, name: d.localName || d.name || "", icon: d.icon || "" })).filter(d => Number(d.id) > 0 && !isExcludedItem(Number(d.id)) && !isRuneLikeItemId(Number(d.id))),
    // 경기 상세용 증강(증강 칼바람) — 그 게임에서 내가 고른 증강(이름+아이콘).
    augments: (x.augments || []).map(a => ({ name: a.localName || a.name || "", icon: a.icon || "", value: a.value })).filter(a => a.name),
    ...teamShares(x.teamParticipants, x.puuid, null) // 선공 기질 — db.json 10인 행에서 팀 합(실측: q2400 725/725 계산가능)
  }));
}
function augmentRecordFromDb(db, m) { return buildRecord(augmentRowsFromDb(db), m); }
// 증강 개인 집계 = 내 픽만(내 챔피언 통계 열). 시즌2 ~200판 → 카서스 12판 등.
export async function augmentAggregate() {
  const m = await champMaps();
  return augmentRecordFromDb(readDb(), m).champs; // [{name,icon,games,winRate,kda,dpm,taken,gpm}]
}
// 증강 메타 = 게임당 10명 전체(teamParticipants) 집계 — 내 픽이 아니라 전체 표본. 200게임×10명=2000행 → aram-mayhem.com 메타와 같은 의미.
export async function augmentMetaFromTeams(extraMatches = []) {
  const m = await champMaps(), db = readDb();
  if (!db || !Array.isArray(db.matches)) return [];
  const seen = new Set(), by = new Map();
  for (const x of [...db.matches, ...extraMatches]) { // extraMatches = 옵트인 크라우드소싱 기여(matchId로 dedup·기본 []=무회귀)
    if (x.queueId !== Q_AUGMENT) continue;
    if (augVerNum(x) < AUG_S2_VERNUM || (x.gameCreation || 0) < AUG_S2_BOUNDARY_MS) continue;
    if (seen.has(x.matchId)) continue; seen.add(x.matchId); // 게임당 1회(10명 한 번씩)
    const dur = x.gameDuration || 0;
    if (dur < MIN_DUR) continue; // 8분 미만 게임 집계 제외(사이트와 일치)
    for (const p of (x.teamParticipants || [])) {
      const id = Number(p.champion); if (!id) continue;
      const c = by.get(id) || { games: 0, wins: 0, k: 0, d: 0, a: 0, dmg: 0, taken: 0, gold: 0, dur: 0 };
      c.games++; c.wins += p.win ? 1 : 0; c.k += p.kills || 0; c.d += p.deaths || 0; c.a += p.assists || 0;
      c.dmg += p.totalDamageDealtToChampions || 0; c.taken += p.totalDamageTaken || 0; c.gold += p.goldEarned || 0; c.dur += dur;
      by.set(id, c);
    }
  }
  const nm = id => m.names.get(Number(id)) || ("챔프#" + id), ic = id => m.icons.get(Number(id)) || "";
  const list = [...by.entries()].map(([id, c]) => {
    const mins = c.dur / 60;
    return { name: nm(id), icon: ic(id), games: c.games, thin: c.games < 10, winRate: Math.round(c.wins / c.games * 100),
      kda: `${(c.k / c.games).toFixed(1)}/${(c.d / c.games).toFixed(1)}/${(c.a / c.games).toFixed(1)}`,
      dpm: mins > 0 ? Math.round(c.dmg / mins) : 0, taken: mins > 0 ? Math.round(c.taken / mins) : 0, gpm: mins > 0 ? Math.round(c.gold / mins) : 0 };
  }).filter(c => c.name);
  // 티어 배정 — 일반과 일관(적응형 백분위 1~5, cut 6/30/72/96%), 표본보정 점수로 정렬(소표본 50%수축)
  const ranked = list.map(c => ({ c, s: (c.winRate / 100 * c.games + 10) / (c.games + 20) })).sort((a, b) => b.s - a.s);
  ranked.forEach((o, i) => { const p = ranked.length ? i / ranked.length : 1; o.c.tier = p < 0.06 ? 1 : p < 0.30 ? 2 : p < 0.72 ? 3 : p < 0.96 ? 4 : 5; });
  return list.sort((a, b) => b.games - a.games);
}
// 증강 아이템 메타 = 게임당 10명 전체(teamParticipants)의 아이템 집계. 이름/아이콘은 server가 itemRows로 붙임.
export function augmentItemAgg(extraMatches = []) {
  const db = readDb();
  if (!db || !Array.isArray(db.matches)) return [];
  const seen = new Set(), by = new Map();
  for (const x of [...db.matches, ...extraMatches]) { // extraMatches = 옵트인 크라우드소싱 기여(matchId로 dedup·기본 []=무회귀)
    if (x.queueId !== Q_AUGMENT) continue;
    if (augVerNum(x) < AUG_S2_VERNUM || (x.gameCreation || 0) < AUG_S2_BOUNDARY_MS) continue;
    if (seen.has(x.matchId)) continue; seen.add(x.matchId);
    if ((x.gameDuration || 0) < MIN_DUR) continue; // 8분 미만 게임 집계 제외(사이트와 일치)
    for (const p of (x.teamParticipants || [])) {
      const ids = [...new Set((p.items || []).map(Number))]; // 게임당 같은 아이템 1회
      for (const id of ids) {
        if (!(id > 0) || isExcludedItem(id)) continue;
        const c = by.get(id) || { games: 0, wins: 0 }; c.games++; c.wins += p.win ? 1 : 0; by.set(id, c);
      }
    }
  }
  return [...by.entries()].map(([id, c]) => ({ id, games: c.games, wins: c.wins, winRate: Math.round(c.wins / c.games * 100) }));
}
const _norm = s => String(s || "").normalize("NFKC").trim().toLowerCase();
// 증강 메타 = 게임당 10명 전체(teamParticipants)의 증강 집계. value→이름은 db.meta.augmentDetails(505, value=id 정확매핑). 사이트와 일치(전환:프리즘 174판).
export function augmentAugmentMeta(extraMatches = []) {
  const db = readDb();
  if (!db || !Array.isArray(db.matches)) return [];
  const nameMap = new Map(), iconMap = new Map();
  for (const a of (db.meta && db.meta.augmentDetails) || []) { const id = Number(a.id); if (id) { nameMap.set(id, a.localName || a.name); if (a.icon) iconMap.set(id, a.icon); } } // 이름·아이콘 둘 다 augmentDetails(505 전체)에서 — 본인 미픽 증강도 아이콘 나오게
  for (const x of db.matches) for (const a of (x.augments || [])) { const v = Number(a.value); if (!v) continue; if (a.icon && !iconMap.has(v)) iconMap.set(v, a.icon); if (!nameMap.has(v) && (a.localName || a.name)) nameMap.set(v, a.localName || a.name); } // augmentDetails(communitydragon) 우선, 매치기록 아이콘(metasrc 등 비허용호스트)은 빈 곳만 보충
  const seen = new Set(), by = new Map();
  for (const x of [...db.matches, ...extraMatches]) { // extraMatches = 옵트인 크라우드소싱 기여(matchId로 dedup·기본 []=무회귀)
    if (x.queueId !== Q_AUGMENT || augVerNum(x) < AUG_S2_VERNUM || (x.gameCreation || 0) < AUG_S2_BOUNDARY_MS || (x.gameDuration || 0) < MIN_DUR) continue; // 8분 미만 게임 집계 제외(사이트와 일치)
    if (seen.has(x.matchId)) continue; seen.add(x.matchId);
    for (const p of (x.teamParticipants || [])) for (const a of (p.augments || [])) {
      const v = Number(a.value); if (!v) continue;
      const c = by.get(v) || { games: 0, wins: 0 }; c.games++; c.wins += p.win ? 1 : 0; by.set(v, c);
    }
  }
  return [...by.entries()].map(([v, c]) => ({ name: nameMap.get(v) || null, icon: iconMap.get(v) || "", games: c.games, winRate: Math.round(c.wins / c.games * 100), thin: c.games < 10 })).filter(x => x.name).sort((a, b) => b.games - a.games);
}
// 증강 rarity(프리즘/골드/실버) 맵 — db.json meta.augmentDetails 기준(이름→등급). 챔프상세 추천증강 등급묶음용(메인PC: db.json 있음).
export function augmentRarityMap() {
  const db = readDb(); const m = new Map();
  for (const a of (db && db.meta && db.meta.augmentDetails) || []) { const r = a.rarity; if (!r) continue; const rl = String(r).toLowerCase(); const nm = a.localName || a.name; if (nm) m.set(_norm(nm), rl); if (a.id != null) m.set("id:" + Number(a.id), rl); } // 이름+id 둘 다 키(개인 augment 픽은 id=value로 매칭이 더 정확 — 사주풀이 증강 등급쿼터 2프리즘/2골드/1실버용)
  return m;
}
// 룬 슬롯/등급 맵(id→{runeSlot,runeCategory,rarity,sourceKind}) — db.json runeDetails 기준. 사주풀이 룬 쿼터(2메인/2하위/1파편)용: LCU 룬 픽엔 슬롯/등급이 없어 부착.
export function runeMetaMap() {
  const db = readDb(); const m = new Map();
  for (const r of (db && db.meta && (db.meta.runeDetails || db.meta.perkDetails)) || []) { if (r && r.id != null) m.set(Number(r.id), { runeSlot: r.runeSlot ?? null, runeCategory: r.runeCategory || null, rarity: r.rarity || null, sourceKind: r.sourceKind || null }); }
  return m;
}
// 개인 챔프 빌드 — 내가 그 챔프로 찍은 증강·아이템(+승률). 메타와 비교용("나는 이걸 찍었을때 승률").
export async function personalChampBuild(mode, name) {
  const m = await champMaps(), q = _norm(name);
  let champId = null, icon = ""; for (const [id, n] of m.names) if (_norm(n) === q) { champId = id; icon = m.icons.get(id) || ""; break; }
  const aug = mode === "augment";
  let rows;
  if (aug) {
    // ★외부 PC 포함 '자기 데이터' — augfull ∪ db.json 병합(getRecords 챔프목록과 동일 mergeAugmentRows). 옛 db.json-only는 다른 PC(db 없음)서 0판→UI가 방송리포트 상세로 폴백하던 버그(사용자 신고).
    const who = readSummonerCache();
    const merged = mergeAugmentRows(readDb(), readAugCache(), readPuuidCache(), who, !!who);
    rows = merged.filter(r => Number(r.dur || 0) >= MIN_DUR && ((champId != null && Number(r.championId) === champId) || _norm(r.championLocalName) === q || _norm(r.championDisplayName) === q)); // 8분 미만 제외 — getRecords(buildRecord)와 카운트 일치
  } else {
    const viewPuuid = readPuuidCache(); // 챔프목록(getRecords stdView)과 동일 계정 스코프 — 다계정 PC서 목록 판수=상세 판수 일치
    rows = readStdCache().filter(r => Number(r.championId) === champId && Number(r.dur || 0) >= MIN_DUR && (!viewPuuid || !r.puuid || r.puuid === viewPuuid));
  }
  const games = rows.length, wins = rows.filter(r => r.win).length;
  const augBy = new Map(), itemBy = new Map(), runePageBy = new Map();
  for (const x of rows) {
    if (aug) for (const a of (x.augments || [])) { const vid = a.value != null ? Number(a.value) : NaN; const k = Number.isFinite(vid) ? vid : (a.localName || a.name); if (k == null || k === "") continue; const c = augBy.get(k) || { games: 0, wins: 0, id: Number.isFinite(vid) ? vid : null, name: a.localName || a.name || "", icon: a.icon || "" }; if (!c.name && (a.localName || a.name)) c.name = a.localName || a.name; if (!c.icon && a.icon) c.icon = a.icon; c.games++; c.wins += x.win ? 1 : 0; augBy.set(k, c); } // key=증강 id(augfull value)·없으면 이름(db). 이름/아이콘 결측(외부 PC)은 서버가 season2 풀로 채움
    const its = aug ? ((x.itemDetails && x.itemDetails.length) ? x.itemDetails.map(d => ({ id: d.id, name: d.name, icon: d.icon })) : (x.items || []).map(id => ({ id, name: null, icon: null }))) : (x.items || []).map(id => ({ id, name: null, icon: null })); // 병합행: db=itemDetails(이름有), LCU=items(id만)→서버가 ddItemMap로 이름 채움
    for (const it of its) { if (!it.id || isExcludedItem(Number(it.id))) continue; const c = itemBy.get(it.id) || { games: 0, wins: 0, name: it.name, icon: it.icon }; if (!c.name && it.name) c.name = it.name; if (!c.icon && it.icon) c.icon = it.icon; c.games++; c.wins += x.win ? 1 : 0; itemBy.set(it.id, c); }
    // 일반(450) 룬 페이지 집계 — 개별 전적과 똑같은 x.perks(LCU서 이미 수집됨). '내 빌드'가 룬을 집계 안 하던 누락 수정(옛 "LCU 미수집" 라벨은 오류였음). 페이지(ids+파편) 시그니처로 묶어 가장 흔한/최고승률 페이지 표기.
    if (!aug && x.perks && Array.isArray(x.perks.ids) && x.perks.ids.length) {
      const rids = x.perks.ids.map(Number).filter(n => n > 0);
      const rsh = Array.isArray(x.perks.shards) ? x.perks.shards.map(Number).filter(n => n > 0) : [];
      const sig = rids.join(",") + "|" + rsh.join(",");
      const c = runePageBy.get(sig) || { ids: rids, shards: rsh, games: 0, wins: 0 };
      c.games++; c.wins += x.win ? 1 : 0; runePageBy.set(sig, c);
    }
  }
  const _adj = (w, g) => Math.round((g ? (w + 10) / (g + 20) : 0.5) * 100);
  const _imp = (w, g) => g ? g * (w / g * 100 - 50) * g / (g + 20) : 0; // 기여도(사이트 rankImpact) — 아이템=|impact|↓. 메타 topCombos와 동일(정확 승수).
  const _wil = (w, g) => { if (!g) return 0; const z = 1.64, p = w / g, n = g, dn = 1 + z * z / n, c = p + z * z / (2 * n), mrg = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return (c - mrg) / dn * 100; }; // Wilson 하한(z=1.64) — 룬 픽 정렬용(클라 게이트 50판과 함께). 메타 topCombos와 동일.
  let dmg = 0, taken = 0, gold = 0, dur = 0, mit = 0, heal = 0, cc = 0, K = 0, D = 0, A = 0; // 내 분당 지표(메타 비교) + 칼바람 임팩트 라디아용(피해감소/회복/CC) + KDA(추가 표기)
  for (const x of rows) { // 일반·증강 모두 정규화 필드(myStat/augmentRowsFromDb): dmg/taken/gold/dur(초)/mit/heal/cc/k/d/a. 옛 증강분기의 raw db 필드(totalDamageDealtToChampions 등)는 augfull 병합행에 없어 0 회귀 → 폐기하고 통일
    dmg += x.dmg || 0; taken += x.taken || 0; gold += x.gold || 0; dur += x.dur || 0; mit += x.mit || 0; heal += x.heal || 0; cc += x.cc || 0; K += x.k || 0; D += x.d || 0; A += x.a || 0;
  }
  const mins = dur / 60;
  const mk = (map, isItem) => [...map.entries()].map(([k, c]) => ({ name: c.name || k, icon: c.icon || (isItem && typeof k === "number" ? itemIconUrl(k) : ""), id: typeof k === "number" ? k : null, games: c.games, winRate: Math.round(c.wins / c.games * 100), adj: _adj(c.wins, c.games), impact: _imp(c.wins, c.games), wilson: _wil(c.wins, c.games), thin: c.games < 3 })).sort((a, b) => b.games - a.games); // isItem일 때만 itemIconUrl 폴백(증강 id에 아이템 아이콘 URL 오폴백 방지 — 증강 아이콘은 서버가 season2 풀로 채움)
  return { name, icon, games, wins, winRate: games ? Math.round(wins / games * 100) : 0, dpm: mins > 0 ? Math.round(dmg / mins) : 0, taken: mins > 0 ? Math.round(taken / mins) : 0, gpm: mins > 0 ? Math.round(gold / mins) : 0, mit: mins > 0 ? Math.round(mit / mins) : 0, heal: mins > 0 ? Math.round(heal / mins) : 0, cc: mins > 0 ? +(cc / mins).toFixed(1) : 0, kda: games ? `${(K / games).toFixed(1)}/${(D / games).toFixed(1)}/${(A / games).toFixed(1)}` : null, augments: aug ? (au => { const rr = augmentRarityMap(); return au.map(a => ({ ...a, rarity: rr.get(_norm(a.name)) || null })); })(mk(augBy, false)) : [], items: mk(itemBy, true), runes: aug ? [] : [...runePageBy.values()].map(c => ({ ids: c.ids, shards: c.shards, games: c.games, wins: c.wins, winRate: Math.round(c.wins / c.games * 100), adj: _adj(c.wins, c.games), impact: _imp(c.wins, c.games), wilson: _wil(c.wins, c.games), thin: c.games < 3 })).sort((a, b) => b.games - a.games) }; // 개인 증강에 rarity(프리즘/골드/실버) 부착 → 챔프상세 '내 증강' 등급묶음(augGroups). runes=일반 룬 페이지(가장 흔한순)
}
// 일반(450) 로컬 누적 캐시 — LCU엔 최근창만, 어디에도 저장 안 되므로 불러올 때마다 합쳐 보존(롤 꺼도 다음부터 보임)
function readStdCache() { try { const j = JSON.parse(readFileSync(STD_CACHE_PATH, "utf8")); return Array.isArray(j.games) ? j.games : []; } catch { return []; } }
function writeStdCache(games) { try { writeFileSync(STD_CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), games })); } catch {} }
function readAugCache() { try { const j = JSON.parse(readFileSync(AUG_CACHE_PATH, "utf8")); return Array.isArray(j.games) ? j.games : []; } catch { return []; } }
function writeAugCache(games) { try { writeFileSync(AUG_CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), games })); } catch {} }
// 클래식(2450) 누적 — LCU 최근창은 굴러 사라지므로 본 것은 즉시 보존한다(출시 전 PBE 표본이 유일한 소스).
function readClassicCache() { try { const j = JSON.parse(readFileSync(CLASSIC_CACHE_PATH, "utf8")); return Array.isArray(j.games) ? j.games : []; } catch { return []; } }
function writeClassicCache(games) { try { writeFileSync(CLASSIC_CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), games })); } catch {} }
// 본인 LCU 소환사명 캐시 — LCU가 잡힐 때만 본인 이름을 저장. 롤 꺼졌을 때 이 캐시를 who로 사용(없으면 "사용자").
//   ⚠️ db.json 소유자명(운영자) 폴백 금지: 다른 PC/다른 유저에게 남의 이름 노출 방지.
function readSummonerCache() { try { const j = JSON.parse(readFileSync(SUMMONER_CACHE_PATH, "utf8")); const n = String(j && j.who || "").trim(); return n || ""; } catch { return ""; } }
function readSummonerTag() { try { const j = JSON.parse(readFileSync(SUMMONER_CACHE_PATH, "utf8")); return String(j && j.tag || "").trim(); } catch { return ""; } } // 롤 꺼도 마지막 태그 표시
function readPuuidCache() { try { const j = JSON.parse(readFileSync(SUMMONER_CACHE_PATH, "utf8")); return String(j && j.puuid || "").trim(); } catch { return ""; } } // 마지막 로그인 계정(롤 꺼졌을 때 표시 기준)
function writeSummonerCache(who, puuid, tag) { try { const n = String(who || "").trim(); let prev = {}; try { prev = JSON.parse(readFileSync(SUMMONER_CACHE_PATH, "utf8")) || {}; } catch {} const p = String(puuid || prev.puuid || "").trim(); const t = String(tag || prev.tag || "").trim(); if (n && n !== "나") writeFileSync(SUMMONER_CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), who: n, puuid: p, tag: t })); } catch {} }
function mergeStd(cache, fresh) {
  const by = new Map();
  const key = r => (r.gid != null ? "g" + r.gid : "x" + r.championId + "_" + r.t);
  for (const r of cache) by.set(key(r), r);
  for (const r of fresh) by.set(key(r), r);
  return [...by.values()];
}
// gameCreation(초) 기준 중복제거 — 같은 게임이면 먼저 들어온 행(db.json)이 이김, LCU의 새 게임만 추가됨.
function dedupeByTime(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = Math.round((r.t || 0) / 1000);
    const prev = by.get(k);
    if (!prev) { by.set(k, r); continue; }
    if (prev.gid == null && r.gid != null) prev.gid = r.gid; // 이긴 행에 gid 만 없으면 그것만 보강 — "먼저 들어온 행이 이김" 계약은 그대로
  }
  return [...by.values()];
}
// ★증강 개인기록 병합 = augDbRows(소유자 db.json) ∪ augLcuRows(LCU 누적 augGames + augfull 증강픽 조인). getRecords(챔프목록)·personalChampBuild(챔프 상세빌드)가 이 한 함수로 동일 소스를 읽어야 '목록 판수=상세 판수' 불변식이 로컬·외부 모두에서 성립(옛 personalChampBuild은 db.json만 읽어 다른 PC서 0판→방송리포트 폴백하던 버그).
//   who/lcuFound는 소유자 판정용 — 외부 PC(db.json 없음)는 dbOwner=false라 항상 augLcuRows(자기 데이터)만.
function mergeAugmentRows(db, augGames, viewPuuid, who, lcuFound) {
  const dbOwner = !!(db && Array.isArray(db.accounts) && db.accounts.length);
  const isOwner = dbOwner && (!lcuFound || (db.accounts || []).some(a => a.gameName && a.gameName === who)); // 다른 PC/다른 유저면 db.json(방송인) 데이터 안 섞음
  const mine = myIdentityPuuids(db, viewPuuid); // 현재 로그인 계정(같은 이름#태그 puuid 묶음) — PBE 등 다른 계정 제외
  const inMine = p => !mine.size || !p || mine.has(p); // 신원 모르면(빈집합)·태깅없는 옛 행은 통과(종전 동작 보존)
  const augDbRows = isOwner ? augmentRowsFromDb(db, mine) : []; // 방송인일 때만 전체 히스토리(단 현재 로그인 계정만)
  const augFullByGid = new Map();
  for (const g of readAugFull()) { // gid→{내 증강 픽(value=id), 팀 점유}. 증강 픽도 팀 합도 둘 다 상세에만 있다.
    const gid = String((g && g.matchId) || "").replace(/^LCU-/, ""); if (!gid) continue;
    const augs = ((g && g.augments) || []).filter(a => a && Number(a.value) > 0).map(a => ({ value: Number(a.value) }));
    augFullByGid.set(gid, { augs, sh: teamShares(g.teamParticipants, g.puuid, null) }); // 이름/아이콘은 서버가 season2 풀로 채움
  }
  const augLcuRows = (augGames || []).filter(r => (r.t || 0) >= AUG_S2_BOUNDARY_MS && inMine(r.puuid)) // 현재 로그인 계정의 시즌2 증강만(PBE 등 다른 계정 제외)
    .map(r => { // augGames(스탯)에 augfull(증강 픽 + 팀 점유) 조인
      const f = augFullByGid.get(String((r && r.gid) || ""));
      if (!f) return { ...r, dmgShare: null, takenShare: null }; // ★옛 캐시의 100% 오염행을 읽는 시점에 무력화(재fetch 없이 즉시 정상화)
      const out = (f.augs.length && !((r.augments || []).length)) ? { ...r, augments: f.augs } : { ...r };
      out.dmgShare = f.sh.dmgShare; out.takenShare = f.sh.takenShare;
      return out;
    });
  return dedupeByTime([...augDbRows, ...augLcuRows]); // db 우선 + LCU의 새 게임 추가
}
// 서버/CLI 공용: 표준=LCU(450)+로컬누적, 증강=db.json(시즌2 본섭+PBE). leagueOff=LCU 못읽음(표준 비는 이유 구분용).
export async function getRecords({ mock = false } = {}) {
  const m = await champMaps();
  if (mock) {
    const stat = mockGames("MOCK").map(g => myStat(g, "MOCK")).filter(Boolean);
    return { who: "(테스트)", leagueOff: false, augmentQueue: Q_AUGMENT,
      standard: buildRecord(stat.filter(s => s.queueId === Q_STANDARD), m),
      augment: buildRecord(stat.filter(s => s.queueId === Q_AUGMENT), m) };
  }
  const db = readDb();
  let who = "나", whoTag = "", leagueOff = true, stdGames = readStdCache(), augGames = readAugCache(), viewPuuid = "";
  const lcuInfo = { found: false, total: 0, byQueue: {}, standard: 0, error: null };
  try {
    const lcu = readLockfile();
    if (lcu) {
      leagueOff = false; lcuInfo.found = true;
      const me = await lcuGet(lcu, "/lol-summoner/v1/current-summoner");
      who = me.gameName || me.displayName || "나"; whoTag = me.tagLine || ""; // 닉네임#태그 전체 표시용
      const myPuuid = me.puuid || ""; viewPuuid = myPuuid; // 현재 로그인 계정 — 화면·사주는 이 계정만
      writeSummonerCache(who, myPuuid, whoTag); // 이름+puuid+태그 로컬 캐시(롤 꺼도 마지막 계정 기준 표시)
      const all = (await getMatches(lcu, 2000)).map(g => myStat(g, me.puuid)).filter(Boolean); // 깊게 긁어 일반 최대수집
      lcuInfo.total = all.length;
      for (const s of all) lcuInfo.byQueue[s.queueId] = (lcuInfo.byQueue[s.queueId] || 0) + 1; // 큐별 진단(진짜 버그/데이터없음 구분)
      const fresh = all.filter(s => s.queueId === Q_STANDARD);
      lcuInfo.standard = fresh.length;
      stdGames = mergeStd(stdGames, fresh);
      if (myPuuid) stdGames = stdGames.map(r => r.puuid ? r : { ...r, puuid: myPuuid }); // 옛 미태깅 캐시 → 현재 계정에 1회 귀속(이후 계정 전환 시 분리)
      writeStdCache(stdGames); // 누적 보존(전 계정 합산 저장)
      const freshAug = all.filter(s => s.queueId === Q_AUGMENT); augGames = mergeStd(augGames, freshAug);
      if (myPuuid) augGames = augGames.map(r => r.puuid ? r : { ...r, puuid: myPuuid });
      writeAugCache(augGames); // 증강도 누적(다른 PC db.json 폴백용)
      // 클래식(2450)은 자기 캐시에만 쌓는다 — augGames/stdGames 어느 쪽에도 섞지 않는다(섞는 순간 그 모드 판수 오염).
      const freshClassic = all.filter(s => s.queueId === Q_CLASSIC);
      if (freshClassic.length) {
        let classicGames = mergeStd(readClassicCache(), freshClassic);
        if (myPuuid) classicGames = classicGames.map(r => r.puuid ? r : { ...r, puuid: myPuuid });
        writeClassicCache(classicGames);
      }
    }
  } catch (e) { lcuInfo.error = String((e && e.message) || e); }
  if (!viewPuuid) viewPuuid = readPuuidCache(); // 롤 꺼졌으면 마지막 로그인 계정 기준
  // 캐시는 합산 누적(위에서 전체 저장)하되, 화면·사주풀이는 현재 로그인 계정만. 미태깅(옛 캐시) 행은 함께 표시(첫 로드 때 귀속됨).
  const stdView = viewPuuid ? stdGames.filter(r => !r.puuid || r.puuid === viewPuuid) : stdGames;
  // 선공 기질 입력 = stdfull(상세)의 팀 합. 아직 상세를 못 받은 게임은 null — 결측을 100%로 지어내지 않는다.
  //   else 분기가 옛 100% 오염행의 세정 지점이다(myStat이 이제 null을 넣지만, 캐시에 남은 옛 행은 여기서 걷힌다).
  const stdShareByGid = new Map();
  for (const f of readStdFull()) { const gid = String((f && f.matchId) || "").replace(/^LCU-/, ""); if (gid) stdShareByGid.set(gid, teamShares(f.tp, "", f.mypid)); }
  const standard = buildRecord(stdView.map(r => {
    const sh = r.gid != null ? stdShareByGid.get(String(r.gid)) : null;
    return sh ? { ...r, dmgShare: sh.dmgShare, takenShare: sh.takenShare } : { ...r, dmgShare: null, takenShare: null };
  }), m);
  // who 확정(League 꺼졌으면 본인 LCU 캐시명으로) — 표시용 이름.
  //   ⚠️ db.json 소유자명(운영자/강준치) 폴백은 절대 금지: 다른 PC/다른 유저에게 남의 이름이 새어 "나님"/운영자명이 뜨던 버그.
  //   본인 LCU가 한 번이라도 잡혔으면 그 이름을 쓰고, 없으면 "사용자"(중립). 아래 isOwner(증강 데이터)는 League-off면 db 존재만으로 판정 — 표시명과 무관.
  if (who === "나") who = readSummonerCache() || "사용자";
  if (!whoTag) whoTag = readSummonerTag(); // 롤 꺼졌으면 캐시된 태그 사용
  // 증강 개인기록 = db.json 전체 히스토리 + LCU 실시간 2400 병합(gameCreation 중복제거). 새 게임이 db.json 갱신 전에도 즉시 반영(동결 버그 해소).
  const dbOwner = !!(db && Array.isArray(db.accounts) && db.accounts.length);
  const isOwner = dbOwner && (!lcuInfo.found || (db.accounts || []).some(a => a.gameName && a.gameName === who)); // 다른 PC/다른 유저면 db.json(방송인) 데이터 안 섞음
  // 비-소유자(db.json 없는 다른 PC)만 로드 시 augfull 캡처 — 증강 픽은 getMatches(목록)엔 없어 게임별 상세에서 채워야 자기 증강이 보인다(소유자는 기여로 augfull 상시 최신 → 로드속도 보존). 첫 로드만 상세 fetch 다수, 이후 증분.
  // ★2026-07-22: 예전엔 이걸 await 해서, 설치 유저(비-소유자)만 /api/me 응답 앞에 LCU 상세 80건 순차 조회를 통째로 기다렸다.
  //   운영자는 소유자라 이 코드를 아예 안 타서 이 지연을 겪은 적이 없다. 응답은 막지 않고 뒤에서 조금씩 채운다(증분이라 몇 번 쓰면 따라잡는다).
  if (!isOwner && lcuInfo.found) kickAugfullBackfill();
  const augMerged = mergeAugmentRows(db, augGames, viewPuuid, who, lcuInfo.found); // db(소유자 방송인)∪LCU+augfull — personalChampBuild과 동일 소스로 '챔프목록 판수=상세빌드 판수' 불변식 보장
  const augment = augMerged.length ? buildRecord(augMerged, m) : buildRecord(augGames, m);
  return { who, whoTag, leagueOff, lcuInfo, augmentQueue: Q_AUGMENT, standard, augment };
}
// augfull 백필을 응답 밖에서 조금씩. 한 번에 12건만 받고 90초 쿨다운 — 첫 화면을 붙잡지 않으면서 몇 번 쓰면 따라잡는다.
let _augfullBusy = false, _augfullAt = 0;
function kickAugfullBackfill() {
  const now = Date.now();
  if (_augfullBusy || now - _augfullAt < 90000) return;
  _augfullBusy = true; _augfullAt = now;
  Promise.resolve()
    .then(() => captureAugmentContributions({ maxDetail: 12 }))
    .catch(() => {})
    .finally(() => { _augfullBusy = false; });
}

// ───────────────────────────────────────────────────────────────────────────
// 증강 기여 캡처(옵트인) — 증강(2400/KIWI) 게임의 10인 전원 증강을 LCU 상세에서 캡처.
//   ⚠️ 일반 getMatches(목록)+myStat 경로는 증강을 통째로 버린다(목록엔 증강 없음, myStat은 단일플레이어 축약).
//      → db.json과 동일하게 게임별 상세 /lol-match-history/v1/games/{gameId} 를 받아 teamParticipants+augments로 정규화.
//   ⚠️ 일반 칼바람(450)은 절대 대상 아님 — 증강(2400)만. 업로드 단계에서 거르는 항목은 CONTRIB_PII 참조
//      (2026-09-12부터 라이엇 ID·puuid 는 동봉한다 — 동의창도 같이 바뀌었다).
// ───────────────────────────────────────────────────────────────────────────
function capExtractPatch(gameVersion) { const p = String(gameVersion || "").split("."); return p.length >= 2 ? `${p[0]}.${p[1]}` : ""; }
function capStats(participant) { return (participant && participant.stats) || participant || {}; }
function capGameId(game) { return (game && (game.gameId || game.id || game.game_id)) || (game && game.gameCreation) || ""; }
function capWalkAugments(value, prefix = "", out = []) {
  if (!value || typeof value !== "object") return out;
  for (const [k, child] of Object.entries(value)) {
    const pk = prefix ? `${prefix}.${k}` : k;
    if (/augment/i.test(k) && child !== null && typeof child !== "object") out.push({ key: pk, value: child });
    if (child && typeof child === "object") capWalkAugments(child, pk, out);
  }
  return out;
}
function capAugments(participant) {
  const stats = capStats(participant);
  const direct = [];
  // 슬롯 6까지 — 클래식 스타일(2450)은 playerAugment1..6 을 노출한다. 2400엔 5·6 필드가 없어 Number(undefined)>0=false → 기존 출력 불변.
  for (let s = 1; s <= 6; s += 1) { const v = stats[`playerAugment${s}`] ?? participant?.[`playerAugment${s}`]; if (Number(v) > 0) direct.push({ key: `playerAugment${s}`, value: v }); }
  if (direct.length) return direct;
  return capWalkAugments({ participant, stats }).filter(a => Number(a.value || 0) > 0);
}
function capItems(participant = {}, stats = {}) {
  const fields = [0, 1, 2, 3, 4, 5, 6].map(i => participant?.[`item${i}`] ?? stats?.[`item${i}`]);
  const arr = Array.isArray(participant?.items) ? participant.items : (Array.isArray(stats?.items) ? stats.items : []);
  return [...fields, ...arr].filter(x => Number(x) > 0).map(x => Number(x));
}
function capSpells(participant = {}, stats = {}) {
  return [participant?.summoner1Id, participant?.summoner2Id, participant?.spell1Id, participant?.spell2Id, stats?.summoner1Id, stats?.summoner2Id, stats?.spell1Id, stats?.spell2Id]
    .filter(x => Number(x) > 0).map(x => Number(x));
}
function capFindParticipant(game, puuid) {
  const ps = Array.isArray(game.participants) ? game.participants : [];
  const ids = Array.isArray(game.participantIdentities) ? game.participantIdentities : [];
  const direct = ps.find(p => p.puuid === puuid);
  if (direct) return direct;
  const id = ids.find(r => (r.player || {}).puuid === puuid);
  if (id) { const byId = ps.find(p => p.participantId === id.participantId); if (byId) return byId; }
  return null;
}
// 원시 LCU 게임(목록+상세 병합) → db.json 호환 증강행(10인 teamParticipants). server.js normalizeLcuGame과 동일 의미.
export function normalizeAugmentGame(game, puuid) {
  const me = capFindParticipant(game, puuid);
  const myStats = capStats(me);
  const idByPid = new Map((Array.isArray(game.participantIdentities) ? game.participantIdentities : []).map(i => [Number(i.participantId || 0), i.player || {}]));
  const teamParticipants = (game.participants || []).map(item => {
    const st = capStats(item);
    const idp = idByPid.get(Number(item.participantId || 0)) || {};
    return {
      participantId: item.participantId || 0,
      puuid: item.puuid || st.puuid || idp.puuid || "",
      summonerName: item.summonerName || idp.summonerName || idp.gameName || "",
      riotIdGameName: item.riotIdGameName || idp.riotIdGameName || idp.gameName || "",
      riotIdTagline: item.riotIdTagline || idp.riotIdTagline || idp.tagLine || "",
      champion: item.championName || item.championId || st.championName || st.championId || "",
      teamId: item.teamId || st.teamId || 0,
      win: Boolean(st.win || st.WIN),
      kills: st.kills || 0, deaths: st.deaths || 0, assists: st.assists || 0,
      goldEarned: st.goldEarned || 0,
      totalDamageDealtToChampions: st.totalDamageDealtToChampions || 0,
      totalDamageTaken: st.totalDamageTaken || 0,
      damageDealtToObjectives: st.damageDealtToObjectives || 0,
      timeCCingOthers: st.timeCCingOthers || 0,
      damageSelfMitigated: st.damageSelfMitigated || 0,
      totalHeal: st.totalHeal || 0,
      totalHealsOnTeammates: st.totalHealsOnTeammates || 0,
      totalDamageShieldedOnTeammates: st.totalDamageShieldedOnTeammates || 0,
      totalMinionsKilled: st.totalMinionsKilled || 0,
      /* ★2026-09-17 【받아온 값을 버리지 않는다】 외부 사용자 신고: 롤 클라가 꺼져 있을 때 결과판이
         포탑·억제기·선취점·멀티 킬·포탑에 가한 피해량·피해 분해 없이 짧게만 뜬다.
         원인은 이 캡처가 /lol-match-history/v1/games/{gid} 로 **이미 받아온** 전체 응답에서
         아래 값들을 안 담고 버려서다(추가 호출 0). 이름·정의는 normalizeMatchTeamGame 과 글자 그대로 같다.
         ⚠️ 여기 담은 값은 **로컬 화면 전용**이다 — 업로드 단계(stripContribPII)에서 다시 걷어내므로
            기여로 나가는 내용은 한 글자도 안 바뀐다. */
      champLevel: st.champLevel == null ? null : Number(st.champLevel || 0),
      turretKills: Number(st.turretKills || 0), inhibitorKills: Number(st.inhibitorKills || 0),
      doubleKills: Number(st.doubleKills || 0), tripleKills: Number(st.tripleKills || 0),
      quadraKills: Number(st.quadraKills || 0), pentaKills: Number(st.pentaKills || 0),
      largestKillingSpree: Number(st.largestKillingSpree || 0),
      damageDealtToTurrets: Number(st.damageDealtToTurrets || 0), goldSpent: Number(st.goldSpent || 0),
      physicalDamageDealtToChampions: Number(st.physicalDamageDealtToChampions || 0),
      magicDamageDealtToChampions: Number(st.magicDamageDealtToChampions || 0),
      trueDamageDealtToChampions: Number(st.trueDamageDealtToChampions || 0),
      firstBloodKill: !!st.firstBloodKill, firstTowerKill: !!st.firstTowerKill,
      augments: capAugments(item),
      items: capItems(item, st),
      spells: capSpells(item, st)
    };
  });
  /* 포탑·억제기·선취점의 정본은 참가자 합이 아니라 game.teams 다(결과판 정본과 같은 판단). */
  const isWinTeamA = x => x && (x.win === true || String(x.win).toUpperCase() === "WIN");
  const teams = (Array.isArray(game.teams) ? game.teams : []).map(x => ({
    team: Number(x.teamId) || 0, win: isWinTeamA(x),
    firstBlood: !!x.firstBlood, firstTower: !!x.firstTower, firstInhibitor: !!x.firstInhibitor,
    towerKills: x.towerKills == null ? null : Number(x.towerKills || 0),
    inhibitorKills: x.inhibitorKills == null ? null : Number(x.inhibitorKills || 0)
  }));
  const championId = Number(me?.championId || myStats.championId || game.championId || 0);
  const queueId = Number(game.queueId || game.queue || 0);
  return {
    matchId: `LCU-${capGameId(game)}`,
    platformId: String(game.platformId || ""),   // 판의 서버(KR·JP1·NA1…) — 한국 판만 업로드하려고 남긴다. 업로드 본문엔 안 실린다(CONTRIB_DROP_LOCALONLY)
    puuid,
    gameCreation: game.gameCreation || 0,
    gameDuration: game.gameDuration || 0,
    // 2400은 항상 KIWI(아수라장), 2450은 항상 KIWI_JADE(클래식 스타일)이므로 필드 누락 시 보강 — 인제스트 검증에서 정당한 데이터가 탈락하지 않게.
    gameMode: game.gameMode || game.gameType || (queueId === Q_AUGMENT ? "KIWI" : queueId === Q_CLASSIC ? "KIWI_JADE" : ""),
    queueId,
    gameVersion: game.gameVersion || "",
    patch: capExtractPatch(game.gameVersion),
    champion: me?.championName || myStats.championName || championId || "",
    championId,
    win: Boolean(myStats.win || myStats.WIN),
    augments: me ? capAugments(me) : [],
    rsv: AUGFULL_RSV,       // 결과판 칸을 담은 판인지 표시 — 이 값이 낮으면 아래 캡처가 그 판만 다시 받는다
    teams,
    teamParticipants
  };
}
// 기본 인자 = 증바람 augfull(기존 호출부 동작 불변). 클래식은 CLASSICFULL_CACHE_PATH 를 넘겨 파일부터 분리한다.
/* 결과판 칸을 담기 시작한 판 번호. 올리면 옛 줄을 한 번씩 다시 받는다. */
const AUGFULL_RSV = 1;
function readAugFull(p = AUGFULL_CACHE_PATH) { try { const j = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(j.games) ? j.games : []; } catch { return []; } }
function writeAugFull(games, p = AUGFULL_CACHE_PATH) { try { writeFileSync(p, JSON.stringify({ updatedAt: Date.now(), games })); } catch {} }

// 옵트인 기여용: 내 LCU의 증강(2400) 게임을 상세 fetch해 전체행 캡처(증분·캐시). 일반칼바람 불간섭.
//   반환 = db.json 호환 증강행 배열(teamParticipants+augments). 업로드(정리·dedup)는 호출측 책임.
//   ⚠️ opts.queueId 로 큐를 갈아끼울 수 있다(클래식 2450 재사용). 기본값 = Q_AUGMENT 라 기존 호출부 동작은 불변.
//      큐마다 캐시 파일이 반드시 달라야 한다 — 한 파일에 두 모드가 섞이면 그대로 집계 오염.
export async function captureAugmentContributions(opts = {}) {
  const wantQ = Number(opts.queueId ?? Q_AUGMENT);
  const cachePath = opts.cachePath ?? (wantQ === Q_CLASSIC ? CLASSICFULL_CACHE_PATH : AUGFULL_CACHE_PATH);
  const scan = opts.scan ?? 600;            // 목록을 최근 몇 게임까지 훑을지
  const maxDetail = opts.maxDetail ?? 250;  // 1회 실행당 상세 fetch 상한(증분이라 평소 0~수개, 첫 실행만 다수)
  const lcu = readLockfile();
  if (!lcu) return [];                       // League 꺼짐 → 조용히 아무것도 안 함
  let puuid = "";
  try { const me = await lcuGet(lcu, "/lol-summoner/v1/current-summoner"); puuid = me && me.puuid; } catch { return []; }
  if (!puuid) return [];
  const cache = readAugFull(cachePath);
  /* ★2026-09-17 결과판 칸(rsv)이 없는 옛 줄은 "아직 안 받은 것"으로 친다 — 한 번씩 다시 받아 제자리에 덮는다.
     ⚠️ push 로 밀어 넣으면 같은 matchId 가 두 줄이 된다. 반드시 자리를 찾아 바꾼다.
     ⚠️ 한 번에 maxDetail 개까지만 받으므로(백필은 12개) 첫 설치 때와 같은 속도로 몇 번에 나눠 따라잡는다. */
  const at = new Map(cache.map((r, i) => [r.matchId, i]));
  const have = new Set(cache.filter(r => Number(r.rsv || 0) >= AUGFULL_RSV).map(r => r.matchId));
  let games = [];
  try { games = await getMatches(lcu, scan); } catch { return cache; }
  const augList = games.filter(g => Number(g.queueId ?? g.queue ?? 0) === wantQ);
  let fetched = 0, added = 0;
  for (const g of augList) {
    const gid = capGameId(g);
    if (!gid) continue;
    const matchId = `LCU-${gid}`;
    if (have.has(matchId)) continue;          // 이미 캡처 → 상세 재fetch 안 함(증분)
    if (fetched >= maxDetail) break;
    let full = g;
    try { full = await lcuGet(lcu, `/lol-match-history/v1/games/${encodeURIComponent(gid)}`); fetched += 1; }
    catch { continue; }                       // 상세 실패 → 증강 못 얻으니 스킵
    const merged = { ...g, ...full };
    if (Number(merged.queueId ?? merged.queue ?? 0) !== wantQ) continue;
    const row = normalizeAugmentGame(merged, puuid);
    if (!row.matchId || row.matchId === "LCU-") continue;
    if (!(row.teamParticipants || []).some(p => (p.augments || []).length > 0)) continue; // 증강 0이면 가치 없음 → 제외
    // 시즌2 경계는 증바람(2400) 전용 개념 — 클래식(2450)에 걸면 표본이 통째로 0이 된다. 반대로 여기서 걷어내면 증바람 시즌1 구증강이 되살아난다.
    if (wantQ === Q_AUGMENT && (augVerNum(row) < AUG_S2_VERNUM || (row.gameCreation || 0) < AUG_S2_BOUNDARY_MS)) continue;
    const pos = at.get(matchId);
    if (pos != null) cache[pos] = row; else { cache.push(row); at.set(matchId, cache.length - 1); }
    have.add(matchId); added += 1;
  }
  if (added) writeAugFull(cache, cachePath);
  return cache;
}

// ───────────────────────────────────────────────────────────────────────────
// 일반 칼바람(450) 팀 구성 캡처 — 아군/상대 챔피언·룬·아이템 분석 소스.
//   증강(2400)이 쓰는 상세 fetch 증분 캡처와 같은 방식. 다만 캐시 파일·스키마가 완전히 분리돼 있고
//   업로드 경로가 없다(로컬 전용). 그래서 PII도 URL 문자열도 담지 않는다 — id만.
//   ⚠️ 내 개인 항목(내 룬/아이템/쌍)은 std 캐시만으로 전 기간 계산된다. 여기가 필요한 건 아군/상대뿐이다.
//   ⚠️ 유휴 양보: 1회 실행당 maxDetail 개만 상세를 받고, 이미 받은 게임은 matchId로 건너뛴다(증분).
//      첫 실행만 여러 개, 이후 0~수개. 게임/방송 중 LCU를 두들기지 않게 상한을 낮게 잡는다.
// ───────────────────────────────────────────────────────────────────────────
function readStdFull() { try { const j = JSON.parse(readFileSync(STDFULL_CACHE_PATH, "utf8")); return Array.isArray(j.games) ? j.games : []; } catch { return []; } }
function writeStdFull(games) { try { writeFileSync(STDFULL_CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), games })); } catch {} }
// 원시 LCU 게임(목록+상세 병합) → 린 팀행. 이름·puuid·아이콘 없음(로컬 전용·업로드 없음).
function normalizeStandardTeamGame(game, puuid) {
  const me = capFindParticipant(game, puuid);
  const myStats = capStats(me);
  const tp = (game.participants || []).map(item => {
    const st = capStats(item);
    return {
      pid: Number(item.participantId || 0),
      c: Number(item.championId || st.championId || 0) || 0,
      tm: Number(item.teamId || st.teamId || 0) || 0,
      w: Boolean(st.win || st.WIN),
      it: capItems(item, st).filter(id => !isExcludedItem(id) && !isRuneLikeItemId(id)),
      d: Number(st.totalDamageDealtToChampions) || 0, // 선공 기질용 팀 합(목록엔 없다). 행 +16.6%뿐이라 담을 값어치가 있다.
      td: Number(st.totalDamageTaken) || 0,
      r: (extractPerks(item, st).ids || []).filter(n => n > 0) // ⚠️ extractPerks는 s를 무가드 접근 → capStats가 항상 객체를 준다
    };
  });
  return {
    matchId: `LCU-${capGameId(game)}`,
    gameCreation: game.gameCreation || 0,
    gameDuration: game.gameDuration || 0,
    queueId: Number(game.queueId || game.queue || 0),
    championId: Number(me?.championId || myStats.championId || game.championId || 0) || 0,
    win: Boolean(myStats.win || myStats.WIN),
    mypid: Number(me?.participantId || 0),
    team: Number(me?.teamId || myStats.teamId || 0) || 0,
    tp
  };
}
export async function captureStandardTeams(opts = {}) {
  const scan = opts.scan ?? 600;
  const maxDetail = opts.maxDetail ?? 60; // 증강(250)보다 보수적 — 유휴 양보
  const lcu = readLockfile();
  if (!lcu) return [];
  let puuid = "";
  try { const me = await lcuGet(lcu, "/lol-summoner/v1/current-summoner"); puuid = me && me.puuid; } catch { return []; }
  if (!puuid) return [];
  const cache = readStdFull();
  // ⚠️ 스키마 마이그레이션: 옛 행엔 tp[].d/td(피해)가 없다. "이미 있으면 스킵"만 하면 그 행은 영영 안 채워진다.
  //    v2(피해 포함)가 아닌 행은 다시 받아 **제자리 교체**한다 — push 하면 같은 matchId 가 중복돼 아군/상대 판수가 부푼다.
  const hasDmg = r => Array.isArray(r.tp) && r.tp.length >= 2 && r.tp.every(p => p && p.d != null);
  const idx = new Map(cache.map((r, i) => [r.matchId, i]));
  let games = [];
  try { games = await getMatches(lcu, scan); } catch { return cache; }
  let fetched = 0, added = 0;
  for (const g of games.filter(x => Number(x.queueId ?? x.queue ?? 0) === Q_STANDARD)) {
    const gid = capGameId(g);
    if (!gid) continue;
    const matchId = `LCU-${gid}`;
    const at = idx.get(matchId);
    if (at != null && hasDmg(cache[at])) continue; // 증분 — 이미 v2로 받은 게임은 상세 재fetch 안 함
    if (fetched >= maxDetail) break;
    let full = g;
    try { full = await lcuGet(lcu, `/lol-match-history/v1/games/${encodeURIComponent(gid)}`); fetched += 1; }
    catch { continue; }
    const merged = { ...g, ...full };
    if (Number(merged.queueId ?? merged.queue ?? 0) !== Q_STANDARD) continue; // 모드 안 섞음
    const row = normalizeStandardTeamGame(merged, puuid);
    if (!row.matchId || row.matchId === "LCU-") continue;
    if (!row.mypid || (row.tp || []).length < 2) continue; // 팀 구성 못 얻은 게임은 담지 않는다(빈 행으로 표본만 부풀리지 않게)
    if (at != null) cache[at] = row; else { cache.push(row); idx.set(matchId, cache.length - 1); } // 제자리 교체(중복 방지)
    added += 1;
  }
  if (added) writeStdFull(cache);
  return cache;
}

// ───────────────────────────────────────────────────────────────────────────
// 경기 상세 "전체(10인)" — 한 판의 5:5 전원 행(챔피언·아이템·룬/증강·지표).
//   ★설치된 다른 PC 전제: 로컬 pages_site·db.json·기존 캡처 캐시가 하나도 없는 게 정상이다.
//     그래서 정본 소스 = 각자 PC의 LCU 상세 1회 fetch(경기 상세를 연 그 순간만, 1 request).
//     내 PC에만 있는 파일에 의존하는 경로는 전부 폴백으로 내렸다.
//   ★결과는 렌더 전용 캐시에만 쌓는다 — 집계 캐시(augfull/stdfull)는 큐·시즌 필터가 걸린
//     별개 파일이라 절대 안 건드린다(여기 넣으면 그대로 집계 오염).
//   ★조회 순서: 렌더캐시 → augfull(증강, 이미 풀 데이터) → LCU 상세 → stdfull(일반 린 폴백).
//     한 번 본 경기는 롤을 꺼도 계속 뜬다.
// ───────────────────────────────────────────────────────────────────────────
const MATCHTEAM_CACHE_PATH = path.join(CACHE_DIR, "mayhem_companion_matchteam.json");
const MATCHTEAM_MAX = 400; // 한 판 ≈ 3KB → 상한 ~1.2MB. 넘으면 오래된 것부터 버림.
/* ★2026-09-13 캐시 스키마 번호. 결과판이 쓰는 필드(teams·포탑·선취점·멀티킬·피해분해)를 더했으므로
   그 전에 저장된 캐시는 값이 비어 있다 — 실측: 포탑 0 · 선취점 false · 피해분해 0/0/0 으로 떴다.
   번호를 올려 옛 캐시를 한 번만 버리게 한다(다음 조회에서 LCU 로 다시 받아 채운다). */
const MT_SCHEMA = 2;
function readMatchTeamCache() { try { const j = JSON.parse(readFileSync(MATCHTEAM_CACHE_PATH, "utf8")); return (j && j.games && typeof j.games === "object") ? { games: j.games } : { games: {} }; } catch { return { games: {} }; } }
function writeMatchTeamCache(c) {
  try {
    /* ⚠️ 같은 캐시 파일을 다른 인스턴스가 함께 쓸 수 있다(앱이 두 번 떠 있거나 검증용 서버가 붙었을 때).
       통째로 덮으면 상대가 방금 채운 항목이 조용히 사라진다 — 실측: 굳혀 둔 타임라인이 다음 조회에서 없어졌다.
       쓰기 직전에 디스크를 다시 읽어 합친다(같은 판은 방금 만든 내 값이 이긴다). */
    let games = Object.assign({}, readMatchTeamCache().games, c.games || {});
    const ent = Object.entries(games);
    if (ent.length > MATCHTEAM_MAX) { ent.sort((a, b) => (b[1] && b[1].at || 0) - (a[1] && a[1].at || 0)); games = Object.fromEntries(ent.slice(0, MATCHTEAM_MAX)); }
    writeFileSync(MATCHTEAM_CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), games }));
  } catch {}
}
// LCU 상세 1건 → 10인 렌더 행. 큐와 무관하게 같은 스키마라 일반/증바람 화면이 동일해진다.
//   증강은 2400/2450에서만 값이 있고, 룬은 어느 큐에서나 나온다 — 있는 것만 담고 지어내지 않는다.
function normalizeMatchTeamGame(game, puuid) {
  const idByPid = new Map((Array.isArray(game.participantIdentities) ? game.participantIdentities : []).map(i => [Number(i.participantId || 0), i.player || {}]));
  const me = capFindParticipant(game, puuid), myStats = capStats(me);
  const rows = (game.participants || []).map(item => {
    const st = capStats(item);
    const idp = idByPid.get(Number(item.participantId || 0)) || {};
    const pk = extractPerks(item, st);
    return {
      pid: Number(item.participantId || 0),
      champId: Number(item.championId || st.championId || 0) || 0,
      lvl: Number(st.champLevel || 0) || null,
      name: item.riotIdGameName || idp.riotIdGameName || idp.gameName || item.summonerName || idp.summonerName || "",
      tag: item.riotIdTagline || idp.riotIdTagline || idp.tagLine || "",
      team: Number(item.teamId || st.teamId || 0) || 0,
      win: Boolean(st.win || st.WIN),
      k: Number(st.kills || 0), d: Number(st.deaths || 0), a: Number(st.assists || 0),
      gold: Number(st.goldEarned || 0),
      dmg: Number(st.totalDamageDealtToChampions || 0),
      taken: Number(st.totalDamageTaken || 0),
      // 지표 정의는 개인 레이더(mit/heal/cc)와 같은 정본 필드를 쓴다 — 화면마다 다른 뜻이 되면 안 된다.
      mit: st.damageSelfMitigated == null ? null : Number(st.damageSelfMitigated || 0),
      heal: st.totalHeal == null ? null : Number(st.totalHeal || 0),
      cc: st.timeCCingOthers == null ? null : Number(st.timeCCingOthers || 0),
      items: capItems(item, st).slice(0, 7),      // 7칸 그대로(소모품·트링킷 포함 — op.gg와 같게). 빌드 추천용 제외필터는 여기 안 건다.
      spells: capSpells(item, st).slice(0, 2),
      /* ★2026-09-13 결과판(8892 사용자 설정 전적의 LCK 결과판)이 쓰는 값들. 같은 LCU 응답에 이미 들어 있어
         추가 호출이 없다 — 여태 뽑지 않고 버리고 있었을 뿐이다. 이름·정의는 8892 resultStats 와 글자 그대로 맞춘다. */
      turrets: Number(st.turretKills || 0), inhibs: Number(st.inhibitorKills || 0),
      dk: Number(st.doubleKills || 0), tk: Number(st.tripleKills || 0), qk: Number(st.quadraKills || 0), pk: Number(st.pentaKills || 0),
      spree: Number(st.largestKillingSpree || 0),
      physDmg: Number(st.physicalDamageDealtToChampions || 0),
      magicDmg: Number(st.magicDamageDealtToChampions || 0),
      trueDmg: Number(st.trueDamageDealtToChampions || 0),
      dmgTurrets: Number(st.damageDealtToTurrets || 0), goldSpent: Number(st.goldSpent || 0),
      firstBlood: !!st.firstBloodKill, firstTower: !!st.firstTowerKill,
      augIds: capAugments(item).map(a => Number(a.value != null ? a.value : a.id)).filter(n => n > 0),
      runeIds: (pk.ids || []).map(Number).filter(n => n > 0)
    };
  });
  /* LCU 의 teams 는 포탑·억제기·선취점의 **정본**이다(참가자 합보다 정확하다). 여태 버리고 있었다. */
  const isWinTeam = x => x && (x.win === true || String(x.win).toUpperCase() === "WIN");
  const teams = (Array.isArray(game.teams) ? game.teams : []).map(x => ({
    team: Number(x.teamId) || 0, win: isWinTeam(x),
    firstBlood: !!x.firstBlood, firstTower: !!x.firstTower, firstInhibitor: !!x.firstInhibitor,
    towerKills: x.towerKills == null ? null : Number(x.towerKills || 0),
    inhibitorKills: x.inhibitorKills == null ? null : Number(x.inhibitorKills || 0)
  }));
  return {
    gid: String(capGameId(game) || ""), queueId: Number(game.queueId || game.queue || 0) || 0,
    duration: Number(game.gameDuration || 0) || 0,
    myTeam: Number(me?.teamId || myStats.teamId || 0) || 0, myPid: Number(me?.participantId || 0) || 0,
    teams, surrender: !!game.gameEndedInSurrender, earlySurrender: !!game.gameEndedInEarlySurrender,
    rows
  };
}
let _mtPuuid = "";                                                       // current-summoner 왕복을 매 상세마다 반복하지 않게(세션 캐시)
async function fetchMatchTeamFromLcu(gid, wantQ) {
  const lcu = readLockfile(); if (!lcu) return null;                     // 롤 꺼짐 → 폴백으로
  let puuid = _mtPuuid;
  if (!puuid) { try { const me = await lcuGet(lcu, "/lol-summoner/v1/current-summoner"); puuid = _mtPuuid = (me && me.puuid) || ""; } catch { return null; } }
  if (!puuid) return null;
  let full = null;
  try { full = await lcuGet(lcu, `/lol-match-history/v1/games/${encodeURIComponent(gid)}`); } catch { return null; }
  if (!full || !Array.isArray(full.participants) || full.participants.length < 2) return null;
  const q = Number(full.queueId ?? full.queue ?? 0);
  if (wantQ && q && q !== wantQ) return null;                            // 큐가 다르면 안 그린다(일칼/증바람 안 섞음)
  const n = normalizeMatchTeamGame(full, puuid);
  return (n.rows.length >= 2 && n.myPid) ? n : null;
}
// augfull(증강 기여 캡처) 행 → 같은 렌더 스키마. 이미 10인 풀 데이터라 LCU를 안 두들긴다.
function matchTeamFromAugfullRow(r) {
  const tp = r.teamParticipants || [];
  const me = tp.find(p => p.puuid && p.puuid === r.puuid) || null;
  const rows = tp.map(p => ({
    pid: Number(p.participantId || 0), champId: Number(p.champion) || 0,
    lvl: p.champLevel == null ? null : Number(p.champLevel),   // ★2026-09-17 캡처가 담기 시작했다(옛 줄은 그대로 null)
    name: p.riotIdGameName || p.summonerName || "", tag: p.riotIdTagline || "",
    team: Number(p.teamId) || 0, win: !!p.win,
    k: Number(p.kills || 0), d: Number(p.deaths || 0), a: Number(p.assists || 0), gold: Number(p.goldEarned || 0),
    dmg: Number(p.totalDamageDealtToChampions || 0), taken: Number(p.totalDamageTaken || 0),
    mit: p.damageSelfMitigated == null ? null : Number(p.damageSelfMitigated || 0),
    heal: p.totalHeal == null ? null : Number(p.totalHeal || 0),
    cc: p.timeCCingOthers == null ? null : Number(p.timeCCingOthers || 0),
    items: (p.items || []).slice(0, 7), spells: (p.spells || []).slice(0, 2),
    /* ★2026-09-17 결과판 칸 — 캡처가 담은 줄에만 있다. 없는 옛 줄은 null 로 두고 화면이 그 줄을 뺀다. */
    turrets: p.turretKills == null ? null : Number(p.turretKills),
    inhibs: p.inhibitorKills == null ? null : Number(p.inhibitorKills),
    dk: p.doubleKills == null ? null : Number(p.doubleKills),
    tk: p.tripleKills == null ? null : Number(p.tripleKills),
    qk: p.quadraKills == null ? null : Number(p.quadraKills),
    pk: p.pentaKills == null ? null : Number(p.pentaKills),
    spree: p.largestKillingSpree == null ? null : Number(p.largestKillingSpree),
    dmgTurrets: p.damageDealtToTurrets == null ? null : Number(p.damageDealtToTurrets),
    goldSpent: p.goldSpent == null ? null : Number(p.goldSpent),
    physDmg: p.physicalDamageDealtToChampions == null ? null : Number(p.physicalDamageDealtToChampions),
    magicDmg: p.magicDamageDealtToChampions == null ? null : Number(p.magicDamageDealtToChampions),
    trueDmg: p.trueDamageDealtToChampions == null ? null : Number(p.trueDamageDealtToChampions),
    firstBlood: p.firstBloodKill == null ? null : !!p.firstBloodKill,
    firstTower: p.firstTowerKill == null ? null : !!p.firstTowerKill,
    augIds: (p.augments || []).map(a => Number(a.value != null ? a.value : a.id)).filter(n => n > 0),
    runeIds: [] // augfull 스키마엔 룬이 없다 — 증강 모드 화면은 룬 열을 안 쓴다
  }));
  return { gid: String(r.matchId || "").replace(/^LCU-/, ""), queueId: Number(r.queueId || 0) || 0, duration: Number(r.gameDuration || 0) || 0, myTeam: Number(me?.teamId || 0) || 0, myPid: Number(me?.participantId || 0) || 0, rows, teams: Array.isArray(r.teams) ? r.teams : undefined };
}
// stdfull(일반 팀 캡처) 행 → 같은 스키마. 린 스키마라 이름·KDA·골드·감소·회복·CC가 없다(partial).
function matchTeamFromStdfullRow(r) {
  const rows = (r.tp || []).map(p => ({
    pid: Number(p.pid) || 0, champId: Number(p.c) || 0, lvl: null, name: "", tag: "",
    team: Number(p.tm) || 0, win: !!p.w,
    k: null, d: null, a: null, gold: null,
    dmg: Number(p.d || 0), taken: Number(p.td || 0), mit: null, heal: null, cc: null,
    items: (p.it || []).slice(0, 7), spells: [], augIds: [], runeIds: (p.r || []).map(Number).filter(n => n > 0)
  }));
  return { gid: String(r.matchId || "").replace(/^LCU-/, ""), queueId: Number(r.queueId || 0) || 0, duration: Number(r.gameDuration || 0) || 0, myTeam: Number(r.team || 0) || 0, myPid: Number(r.mypid || 0) || 0, rows, partial: true };
}
/* ★2026-09-13 【결과판(전적 개요 위) — 8892 사용자 설정 전적에서 쓰는 그 화면을 개인 전적에도】
   운영자 지시: "8892 여기에서 쓰는 win loss하는 전적개요 위 내용들을 칼바람 분석기 개인 전적들에게도 넣고 싶어"
   집계 정의는 custom-records/server.mjs resultStats 와 **글자 그대로 같다**. 두 화면이 다른 값을 내면 안 된다.
   ⚠️ 협곡 오브젝트(용·바론·전령·유충·밴)는 칼바람에서 전부 0 이라 안 넣는다(8892 와 같은 이유). */
function resultStatsLcu(base, rows, timeline, lean) {
  const T = {};
  for (const t of [100, 200]) {
    const ps = rows.filter(r => r.team === t);
    const tm = (base.teams || []).find(x => x.team === t) || {};
    const sum = k => ps.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    /* ★2026-09-17 【아무도 안 가진 값은 0 이 아니라 null】 외부 사용자 신고: 전적 개요 아래 '게임 통계'의
       결과판이 통째로 안 뜬다. 원인은 아래 hasResultSource 가 폴백 소스를 통으로 막고 있던 것이고,
       그걸 풀려면 먼저 "없는 값"과 "0"을 갈라야 한다 — 안 그러면 포탑 0:0 · 멀티킬 없음 같은 거짓 화면이 된다.
       실측(augfull 참가자 줄 7,930개 전수): kills·deaths·assists·goldEarned·피해·받은피해·피해감소·회복·CC 는 100% 있고,
       goldSpent·turretKills·inhibitorKills·선취점·더블~펜타·연속처치·포탑피해·물리/마법/고정 분해는 0% 다.
       ⚠️ LCU 소스 rows 는 이 값들을 전부 Number(...||0) 으로 담으므로 null 이 될 수 없다 — 그쪽 결과는 한 글자도 안 바뀐다. */
    const sumN = k => ps.some(r => r[k] != null) ? sum(k) : null;
    const flagN = key => (tm[key] != null || ps.some(r => r[key] != null)) ? (!!tm[key] || ps.some(r => !!r[key])) : null;
    T[t] = {
      team: t, win: tm.win != null ? !!tm.win : ps.some(r => r.win),
      k: sumN("k"), d: sumN("d"), a: sumN("a"), gold: sumN("gold"), goldSpent: sumN("goldSpent"),
      towers: tm.towerKills != null ? tm.towerKills : sumN("turrets"),
      inhibs: tm.inhibitorKills != null ? tm.inhibitorKills : sumN("inhibs"),
      firstBlood: flagN("firstBlood"),
      firstTower: flagN("firstTower"),
      firstInhib: tm.firstInhibitor != null ? !!tm.firstInhibitor : null,
      dk: sumN("dk"), tk: sumN("tk"), qk: sumN("qk"), pk: sumN("pk"),
      spree: ps.some(r => r.spree != null) ? Math.max(0, ...ps.map(r => Number(r.spree) || 0)) : null,
      mit: sumN("mit"), heal: sumN("heal"), cc: sumN("cc"), dmgTurrets: sumN("dmgTurrets"),
      dmg: sumN("dmg"), taken: sumN("taken"), phys: sumN("physDmg"), magic: sumN("magicDmg"), trueD: sumN("trueDmg")
    };
  }
  return { blue: T[100], red: T[200], surrender: !!base.surrender, earlySurrender: !!base.earlySurrender, timeline: timeline || null, lean: !!lean };
}
/* 골드 차이 타임라인 — LCU 한 번 더 부른다(상세 창을 열 때만, 캐시에 남는다).
   ⚠️ 없으면 그래프만 빠지고 나머지는 그대로 그린다 — 이거 하나로 결과판 전체를 막지 않는다. */
async function fetchMatchTimeline(gid, rows) {
  const lcu = readLockfile(); if (!lcu) return null;
  const teamOf = new Map(rows.map(r => [Number(r.pid), Number(r.team)]));
  let t; try { t = await lcuGet(lcu, `/lol-match-history/v1/game-timelines/${encodeURIComponent(gid)}`); } catch { return null; }
  const frames = (t && t.frames) || []; if (!frames.length) return null;
  /* kills 는 결과판(goldSvg·resultHtml)이 한 군데도 안 쓴다 — 한 판에 160개씩 쌓여 캐시만 불린다. 안 담는다. */
  const fr = [], ev = [];
  for (const f of frames) {
    const pf = f.participantFrames || {}; let blue = 0, red = 0;
    for (const k of Object.keys(pf)) {
      const x = pf[k] || {}; const pid = Number(x.participantId || k) || 0;
      const team = teamOf.get(pid) || (pid <= 5 ? 100 : 200);
      const gold = Number(x.totalGold || 0);
      if (team === 100) blue += gold; else red += gold;
    }
    const min = Math.round(Number(f.timestamp || 0) / 60000 * 10) / 10;
    fr.push({ min, diff: blue - red, blue, red });
    for (const e of (f.events || [])) {
      const emin = Math.round(Number(e.timestamp || 0) / 60000 * 10) / 10;
      if (e.type === "BUILDING_KILL") ev.push({ min: emin, type: e.buildingType === "INHIBITOR_BUILDING" ? "INHIB" : "TOWER", team: Number(e.teamId || 0)   /* BUILDING_KILL 의 teamId = 부서진 건물의 주인 팀(실측 확인) — 뒤집으면 파괴한 팀이 되어 아이콘 색이 반대로 나온다 */, sub: String(e.towerType || "") });
    }
  }
  return { frames: fr, events: ev };
}

export async function matchTeamRows(mode, gid) {
  const key = String(gid == null ? "" : gid).trim();
  if (!key || !/^\d+$/.test(key)) return { ok: true, found: false, reason: "no-gid" };
  const wantQ = mode === "augment" ? Q_AUGMENT : Q_STANDARD;
  // ⚠️ 캐시/폴백 히트마다 큐를 다시 검증한다. gid 하나가 두 모드에서 조회되므로(모드 토글) 큐를 안 보면
  //    일반 경기가 증바람 화면에 그대로 뜬다 — 두 모드는 절대 안 섞는다.
  const okQ = b => !!b && (!b.queueId || !wantQ || b.queueId === wantQ);
  const cache = readMatchTeamCache();
  const hit = cache.games[key];
  let base = (hit && Number(hit.v || 1) >= MT_SCHEMA && hit.data) || null, source = base ? "cache" : "";
  if (!okQ(base)) { base = null; source = ""; }
  if (!base) {                                                            // ★정본 = 각자 PC의 LCU. 다른 PC는 여기서 전부 나온다
    const got = await fetchMatchTeamFromLcu(key, wantQ);
    if (got) { base = got; source = "lcu"; cache.games[key] = { at: Date.now(), v: MT_SCHEMA, data: got }; writeMatchTeamCache(cache); }
  }
  if (!base && mode === "augment") {                                      // 롤 꺼짐 폴백 — 증강 기여 캡처(10인 풀, 레벨만 없음)
    const row = readAugFull().find(r => r.matchId === "LCU-" + key);
    if (row && (row.teamParticipants || []).length >= 2) { const b = matchTeamFromAugfullRow(row); if (okQ(b)) { base = b; source = "augfull"; } }
  }
  if (!base && mode !== "augment") {                                      // 롤 꺼짐 폴백 — 일반 팀 캡처(린: 이름·KDA 없음)
    const row = readStdFull().find(r => r.matchId === "LCU-" + key);
    if (row && (row.tp || []).length >= 2) { const b = matchTeamFromStdfullRow(row); if (okQ(b)) { base = b; source = "stdfull"; } }
  }
  if (!base) return { ok: true, found: false, reason: readLockfile() ? "not-found" : "no-lcu" };
  const m = await champMaps();                                            // 로컬 코호트 → 없으면 ddragon(다른 PC)
  const teamKills = {};
  for (const r of base.rows) if (r.k != null) teamKills[r.team] = (teamKills[r.team] || 0) + Number(r.k || 0);
  const rows = base.rows.map(r => ({
    ...r,
    champName: m.names.get(r.champId) || ("챔프#" + r.champId),
    champIcon: m.icons.get(r.champId) || "",
    mine: base.myTeam ? r.team === base.myTeam : false,
    me: base.myPid ? r.pid === base.myPid : false,
    kp: (r.k == null) ? null : (teamKills[r.team] ? Math.round((Number(r.k || 0) + Number(r.a || 0)) / teamKills[r.team] * 100) : 0),
    spellIcons: (r.spells || []).map(spellIcon).filter(Boolean),
    itemIcons: (r.items || []).map(itemIconUrl)
  }));
  /* 결과판 — 팀 합계는 항상, 골드 그래프는 LCU 가 줄 때만(폴백 소스엔 타임라인이 없다).
     ⚠️ 타임라인은 한 번 받으면 캐시에 굳힌다. game-timelines 는 응답이 커서 클라가 게임 중일 땐
        lcuGet 의 5초 타임아웃에 자주 걸린다 — 실측: 같은 판을 연달아 3번 불러 1·2회차 null, 3회차에야 24프레임.
        굳혀 두면 한 번만 성공하면 그 뒤로는 항상 즉시 나온다. 실패해도 그래프만 빠지고 나머지는 그대로 그린다. */
  let timeline = (cache.games[key] && cache.games[key].tl2) || null;   // tl2 = 건물 주인 팀 기준(2026-09-13). 옛 tl 은 파괴한 팀 기준이라 안 쓴다
  /* ★2026-09-17 augfull 을 여기 들인다. 종전엔 lcu·cache 만 통과시켜서, 롤 클라를 안 켠 외부 사용자는
      결과판이 **통째로** 안 떴다(신고). augfull 은 10인 풀 데이터라 팀 KDA·골드·피해·받은피해·회복·CC 가 다 있다.
      없는 것(포탑·억제기·멀티킬·선취점·피해분해·골드 타임라인)은 위 sumN 이 null 로 두고 화면이 그 줄을 뺀다 — 0 으로 그리지 않는다.
      ⚠️ stdfull(일반 칼바람 린 스키마)은 그대로 제외한다: k·d·a·gold·mit·heal·cc 가 전부 없어 남는 줄이 두 개뿐이다. */
  const hasResultSource = (source === "lcu" || source === "cache" || source === "augfull");
  const leanResult = (source === "augfull");   // 골드 차이 타임라인은 롤 클라가 켜져 있을 때만 나온다
  if (!timeline && hasResultSource) {
    timeline = await fetchMatchTimeline(key, rows).catch(() => null);
    if (timeline && cache.games[key]) { cache.games[key].tl2 = timeline; delete cache.games[key].tl; writeMatchTeamCache(cache); }
  }
  /* ⚠️ 폴백 소스면 결과판을 아예 안 보낸다 — 없는 값을 0 으로 그리면 포탑 0·억제기 0·멀티킬 없음 같은
     거짓 화면이 된다. 화면은 result 가 없으면 그 자리를 비우고 전적 개요부터 그린다. */
  const result = hasResultSource ? resultStatsLcu(base, rows, timeline, leanResult) : null;
  return {
    ok: true, found: true, source, gid: key, queueId: base.queueId || 0, duration: base.duration || 0,
    partial: !!base.partial, result,
    hasKda: rows.some(r => r.k != null), hasNames: rows.some(r => !!r.name), hasGold: rows.some(r => r.gold != null && r.gold > 0),
    hasMit: rows.some(r => r.mit != null), hasHeal: rows.some(r => r.heal != null), hasCc: rows.some(r => r.cc != null),
    hasLvl: rows.some(r => r.lvl != null), hasSpells: rows.some(r => (r.spellIcons || []).length > 0),
    rows
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 기여 정리 + 업로드 (옛 contribution.mjs + contribute_upload.mjs 를 여기로 인라인).
//   ⚠️ 인라인 이유: 소프트업데이트는 RUNTIME_FILES(server.mjs·lcu_personal.mjs·index.html·package.json)만 받는다.
//      별도 .mjs로 두면 설치된 앱이 그 파일을 못 받아 server.mjs import가 깨진다(rev68 실제 사고: ERR_MODULE_NOT_FOUND→번들 폴백→토글 안 뜸).
// ───────────────────────────────────────────────────────────────────────────
// ★2026-09-12 【기여는 더 이상 익명이 아니다】 puuid·riotIdGameName·riotIdTagline 을 남긴다.
//   왜: 이름표가 없으면 올라온 판이 누구 것인지 영영 알 수 없어 개인 지표(MMR)·전적 조회에 쓸 수가 없다.
//       실측(2026-09-12) — 지금까지 올라온 65,841판 중 참가자를 되짚을 수 있던 건 2,478판(3.8%) 뿐이었고,
//       분석기를 깔아준 264명은 한 명도 직접 집지 못했다. 판 번호로 추측하던 걸 그만두려고 바꾼다.
//   ⚠️ 동의창(index.html CONSENT_VERSION="2026-09-12")을 같이 바꿔 기존 설치도 재동의를 받는다.
//      이 둘은 반드시 함께 나가야 한다 — 코드만 바꾸면 화면에 쓴 약속을 어기는 것이 된다.
//   ⚠️ 소급 불가: 이전에 올라온 판은 영원히 익명이다. 이름이 붙는 건 이 버전이 깔린 뒤의 판부터다.
//   계속 빼는 것 = 라이엇 내부 계정번호(accountId·summonerId)와 안 쓰는 옛 소환사명(summonerName),
//   그리고 이름#태그를 통째로 담은 riotId(gameName·tagLine 로 이미 들어와 중복).
const CONTRIB_PII = new Set(["summonerName", "riotId", "accountId", "summonerId"]);
const CONTRIB_DROP_META = new Set(["importedAt", "source", "detailFetched", "detailError", "identityStatus", "participantFound", "rawKeysWithAugment", "augmentStatus"]);
const CONTRIB_DROP_DERIVABLE = new Set(["itemsDetailed", "description", "descriptionSource", "icon", "championIcon", "championDisplayName", "championTitle", "championLocalName", "augmentNames", "displayName"]);
/* ★2026-09-17 결과판을 그리려고 로컬에만 담는 값들. 기여로는 안 내보낸다 — 업로드 내용은 종전과 한 글자도 같다. */
const CONTRIB_DROP_LOCALONLY = new Set(["rsv", "teams", "champLevel", "turretKills", "inhibitorKills",
  "doubleKills", "tripleKills", "quadraKills", "pentaKills", "largestKillingSpree",
  "damageDealtToTurrets", "goldSpent", "physicalDamageDealtToChampions",
  "magicDamageDealtToChampions", "trueDamageDealtToChampions", "firstBloodKill", "firstTowerKill",
  "platformId"]);   // ★2026-09-23 한국 판 거르기용(아래 uploadContributions) — 업로드 본문은 종전과 같다
function stripContribPII(o) {
  if (Array.isArray(o)) return o.map(stripContribPII);
  if (o && typeof o === "object") {
    const r = {};
    for (const [k, v] of Object.entries(o)) { if (CONTRIB_PII.has(k) || CONTRIB_DROP_META.has(k) || CONTRIB_DROP_DERIVABLE.has(k) || CONTRIB_DROP_LOCALONLY.has(k)) continue; r[k] = stripContribPII(v); }
    return r;
  }
  return o;
}
// 기여 대상 = (큐ID, gameMode) 쌍 화이트리스트. 인제스트 워커의 검증과 같은 목록이어야 한다.
//   ★gameMode.startsWith("KIWI") 같은 접두 매칭 절대 금지 — "KIWI_JADE"가 "KIWI"에 걸려 2450이 증바람 파이프라인으로 통째 유입된다.
const CONTRIB_MODES = [[Q_AUGMENT, "KIWI"], [Q_CLASSIC, "KIWI_JADE"]];
function isContribAugmentMatch(m) {
  if (!m) return false;
  const q = Number(m.queueId), gm = String(m.gameMode || "").toUpperCase();
  return CONTRIB_MODES.some(([qq, mm]) => q === qq && gm === mm);
}
// 매치 배열 → 기여 레코드(증강만·matchId dedup·CONTRIB_PII 등 불필요 키 재귀제거)
export function matchesToContributions(matches) {
  const seen = new Set(), out = [];
  for (const m of matches || []) {
    if (!isContribAugmentMatch(m) || !m.matchId || seen.has(m.matchId)) continue;
    seen.add(m.matchId); out.push(stripContribPII(m));
  }
  return out;
}

const CONTRIB_STATE = path.join(CACHE_DIR, "contribute_state.json"); // 보낸 matchId(중복전송 방지). 캐시폴더라 소프트업데이트에도 보존.
const CONTRIB_ENDPOINT = process.env.MAYHEM_INGEST_URL || "https://aram-mayhem-ingest.xhunt79.workers.dev";
const CONTRIB_TOKEN = process.env.MAYHEM_INGEST_TOKEN || "amx_contrib_9f3a7b2e6d14";
const CONTRIB_BATCH = 25; // 작은 배치 — 워커가 배치당 R2 put을 순차로 하므로 크면 타임아웃/부하. 실패해도 다음 실행에 재시도(서버 dedup).
// ⚠️ 예전엔 saveSentContrib 가 파일을 통째로 {uploaded:[...]} 로 덮었다. 이제 이 파일에 설치 ID 도 살기 때문에
//    반드시 기존 키를 보존하며 병합해야 한다(안 그러면 앱이 기여할 때마다 설치 ID 가 새로 발급돼 인원이 부풀어 오른다).
function readContribState() { try { return JSON.parse(readFileSync(CONTRIB_STATE, "utf8")) || {}; } catch { return {}; } }
function writeContribState(patch) { try { writeFileSync(CONTRIB_STATE, JSON.stringify({ ...readContribState(), ...patch })); } catch {} }
function loadSentContrib() { const u = readContribState().uploaded; return new Set(Array.isArray(u) ? u : []); }
function saveSentContrib(set) { writeContribState({ uploaded: [...set] }); }

// ── 익명 설치 ID ─────────────────────────────────────────────────────────────
//   "이 표본이 몇 명에게서 온 건가" 를 셀 수 있게 하는 유일한 재료. 무작위 UUID 하나이고
//   라이엇 계정·PC 이름·IP 어느 것과도 연결되지 않는다(기존 PII 제거 규칙은 그대로다).
//   CACHE_DIR 에 있는 contribute_state.json 에 살아서 소프트업데이트로 앱 코드가 갈려도 유지된다.
//   ⚠️ 소급 불가 — 이걸 켜기 전에 들어온 기여는 누가 올렸는지 알 수 없다. 오늘부터 세는 값이다.
let _installId = "";
export function installId() {
  if (_installId) return _installId;
  const saved = readContribState().installId;
  if (typeof saved === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(saved)) { _installId = saved; return _installId; }
  _installId = randomUUID();
  writeContribState({ installId: _installId });
  return _installId;
}
// https POST(JSON) — Electron Node에서 global fetch 의존 안 함(lcuGet과 동일 https.request).
function httpsPostJson(url, body, token, timeout = 30000, extraHeaders = {}) {
  return new Promise((resolve) => {
    let done = false; const finish = v => { if (!done) { done = true; resolve(v); } };
    let u; try { u = new URL(url); } catch { return finish({ ok: false, status: 0 }); }
    const data = Buffer.from(JSON.stringify(body), "utf8");
    const req = https.request({ method: "POST", hostname: u.hostname, path: u.pathname + u.search, port: u.port || 443,
      headers: { "Content-Type": "application/json", "Content-Length": data.length, "X-Contrib-Token": token, ...extraHeaders } },
      res => { res.resume(); res.on("end", () => finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode })); });
    req.on("error", () => finish({ ok: false, status: 0 }));
    req.setTimeout(timeout, () => { req.destroy(); finish({ ok: false, status: 0 }); });
    req.end(data);
  });
}
// 정리 후 아직 안 보낸 matchId만 배치 업로드(서버도 matchId로 dedup).
/* ★2026-09-23 사이트 집계로는 한국 서버 판만 보낸다 — 운영자: "전적 불러오기나 그런걸 차단할 건 아닌데, 내 사이트에 집계를 절대 넘겨선 안된다".
     전적 불러오기·분석 등 기능은 서버와 상관없이 그대로 쓴다(지표는 어차피 사이트 = 한국 서버 것을 받는다). 막는 건 이 업로드 하나다.
     ① 판마다 LCU 가 주는 platformId 가 있으면 KR 인 판만 보낸다.
     ② platformId 가 없는 옛 캐시 행은 지금 롤 클라이언트의 서버(opts.region, /riotclient/region-locale)가 KR 일 때만 보낸다 —
        못 읽었으면 이번엔 안 보내고 다음 차례에 다시 본다(보낸 목록에 안 넣으므로 잃지 않는다).
     사이트 쪽 회수(am_pull_contributions_seq)도 한국 밖 판을 게임 번호로 한 번 더 거른다(09-23 전수: 기여 1,338판이 한국 밖이었다). */
const isKrPlatform = (p) => String(p || "").toUpperCase() === "KR";
export async function uploadContributions(matches, opts = {}) {
  const endpoint = opts.endpoint ?? CONTRIB_ENDPOINT, token = opts.token ?? CONTRIB_TOKEN;
  const sent = loadSentContrib();
  const krOnly = (matches || []).filter(m => m && (m.platformId ? isKrPlatform(m.platformId) : isKrPlatform(opts.region)));
  const fresh = matchesToContributions(krOnly).filter(c => !sent.has(c.matchId));
  let ok = 0, failed = 0;
  for (let i = 0; i < fresh.length; i += CONTRIB_BATCH) {
    const batch = fresh.slice(i, i + CONTRIB_BATCH);
    const r = await httpsPostJson(endpoint, { matches: batch }, token, 30000, { "X-Install": installId() });
    if (r.ok) { batch.forEach(c => sent.add(c.matchId)); ok += batch.length; } else { failed += batch.length; }
  }
  if (fresh.length) saveSentContrib(sent);
  return { ok: failed === 0, fresh: fresh.length, sent: ok, failed, notKr: (matches || []).length - krOnly.length };
}
// 지금 롤 클라이언트의 서버(KR·JP·NA…). 못 읽으면 "" — 업로드 쪽은 "" 를 한국이 아닌 것으로 본다.
async function clientRegion() {
  try { const lcu = readLockfile(); if (!lcu) return ""; const r = await lcuGet(lcu, "/riotclient/region-locale"); return String((r && r.region) || "").toUpperCase(); }
  catch { return ""; }
}
// ── 하트비트 ─────────────────────────────────────────────────────────────────
//   보내는 것: 익명 설치 ID + 앱 버전. 그게 전부다(게임 기록·계정·전적은 안 실린다).
//   쓰는 곳: "지금 켜져 있는 앱 수"(최근 15분 내 하트비트) 와 "버전 도달률"(발행한 수정이 몇 대에 갔나).
//   실패는 조용히 무시한다 — 계측이 본업(앱 동작)을 절대 방해하면 안 된다.
export async function sendHeartbeat(version = "") {
  try { return await httpsPostJson(CONTRIB_ENDPOINT + "/beat", { install: installId(), version: String(version || "") }, CONTRIB_TOKEN, 8000); }
  catch { return { ok: false, status: 0 }; }
}

// 옵트인 한 방: 증강(시즌2) 캡처 → 정리 → 업로드. server.mjs는 이 함수 하나만 부른다(파일 의존 없음).
export async function captureAndUploadAugments(opts = {}) {
  const rows = await captureAugmentContributions(opts);
  if (!rows || !rows.length) return { captured: 0, fresh: 0, sent: 0 };
  const region = await clientRegion();
  const up = await uploadContributions(rows, { ...opts, region });
  return { captured: rows.length, region, ...up };
}

// ── 분석기 계정 · 같이 뛴 사람 보내기(2026-09-26) ─────────────────────────────────
//   운영자: "칼바람 분석기에서 계정을 로그인하고 … 그 단일 계정이 1순위 … 그 계정에서 불러온 모든 게임들에서 나머지 9개의 계정들 중
//     … 2순위 긁기" · "MMR도 뜨지 않는 10판 미만의 계정들을 2순위로" · "기존에 쓰던 유저들도 … 새로운 발행을 받게 된다면
//     그들이 제공하는 게임들에서도 한번씩 다 되게".
//   보내는 것 = 이 PC 캐시(augfull)의 한국 서버 증강 칼바람 판에서 ① 판을 불러온 계정(판 맨 위 puuid · 본계·부계) + 지금 로그인한 계정
//     ② 그 판들에 같이 있던 사람(puuid · 이름 · 태그 · 가장 최근 판 시각). 동의 문구("게임에서 서로 보이던 라이엇 ID")의 범위다.
//   부르는 곳 = 기여 업로드와 같은 자리(동의 + 게임 밖 + 5분 간격 — server.mjs maybeContributeAugments). 동의 안 한 설치는 아무것도 안 보낸다.
//   ⚠️⚠️ 설치 번호를 싣지 않는다(본문·머리 둘 다) — 설치 번호는 하트비트로 시간별 기록이 남아, 계정과 짝지으면 동의 밖 추적이 된다.
//   ROSTER_V 가 바뀌면 설치마다 가진 판 전부를 한 번 다시 보낸다(1 = 이번 발행 — 처음 한 번 전부, 그 뒤엔 새 판·새 계정만).
const ROSTER_V = 1;
const ROSTER_CHUNK = 500;          // 한 번에 보내는 같이 뛴 사람 수(워커 상한 600)
const PUUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function uploadRoster(opts = {}) {
  const post = opts.post || ((body) => httpsPostJson((opts.endpoint ?? CONTRIB_ENDPOINT) + "/roster", body, opts.token ?? CONTRIB_TOKEN, 30000));
  const st = readContribState();
  const sameV = Number(st.rosterV || 0) === ROSTER_V;
  const covered = new Set(sameV && Array.isArray(st.rosterGames) ? st.rosterGames : []);
  const sentAccts = new Set(sameV && Array.isArray(st.rosterAccts) ? st.rosterAccts : []);
  const games = (opts.games || readAugFull()).filter(m => m && m.matchId && Number(m.queueId) === Q_AUGMENT
    && (m.platformId ? isKrPlatform(m.platformId) : isKrPlatform(opts.region)));
  const accts = new Map();
  const addAcct = (pu, name, tag) => { pu = String(pu || ""); if (PUUID_RE.test(pu) && !accts.has(pu)) accts.set(pu, { puuid: pu, name: String(name || "").slice(0, 40), tag: String(tag || "").slice(0, 10) }); };
  for (const m of games) { const p = (m.teamParticipants || []).find(x => x && x.puuid === m.puuid) || {}; addAcct(m.puuid, p.riotIdGameName, p.riotIdTagline); }
  if (isKrPlatform(opts.region)) addAcct(opts.me ?? readPuuidCache(), opts.meName ?? readSummonerCache(), opts.meTag ?? readSummonerTag());   // 판이 아직 없어도 로그인한 계정
  const fresh = games.filter(m => !covered.has(m.matchId));
  const newAccts = [...accts.keys()].filter(p => !sentAccts.has(p));
  if (!fresh.length && !newAccts.length) return { ok: true, games: 0, accounts: 0, mates: 0 };
  const mates = new Map();
  for (const m of fresh) {
    const gc = Number(m.gameCreation || 0) || 0;
    for (const p of m.teamParticipants || []) {
      const pu = String((p && p.puuid) || "");
      if (!PUUID_RE.test(pu) || accts.has(pu)) continue;
      const cur = mates.get(pu);
      if (!cur || gc >= cur.gc) mates.set(pu, { puuid: pu, name: String(p.riotIdGameName || "").slice(0, 40), tag: String(p.riotIdTagline || "").slice(0, 10), gc });
    }
  }
  const list = [...mates.values()], acctList = [...accts.values()].slice(0, 20);
  const chunks = [];
  for (let i = 0; i < list.length; i += ROSTER_CHUNK) chunks.push(list.slice(i, i + ROSTER_CHUNK));
  if (!chunks.length) chunks.push([]);                         // 새 계정만 있을 때도 한 번은 보낸다
  for (let i = 0; i < chunks.length; i += 1) {
    const r = await post({ accounts: i === 0 ? acctList : [], mates: chunks[i] });
    if (!r || !r.ok) return { ok: false, status: r && r.status, games: fresh.length, mates: list.length };   // 다음 차례에 처음부터 다시(서버가 겹침을 거른다)
  }
  writeContribState({ rosterV: ROSTER_V, rosterGames: [...covered, ...fresh.map(m => m.matchId)], rosterAccts: [...new Set([...sentAccts, ...accts.keys()])] });
  return { ok: true, games: fresh.length, accounts: acctList.length, mates: list.length };
}
export async function uploadRosterNow() { return uploadRoster({ region: await clientRegion() }); }

// ─────────────────────────────────────────────────────────────────────────────
// 개인 상세분석 12종 — 두 모드가 같은 항목·같은 갯수. 증강 자리를 룬이 대체하는 것만 다르다.
//   증강(2400): 내 증강 · 내 아이템 · 내 챔피언+증강 · 내 챔피언+아이템 · 내 증강+아이템 ·
//               아군/상대 아이템 · 아군/상대 챔피언 · 아군/상대 증강 · 시간대
//   일반(450) : 내 룬  · 내 아이템 · 내 챔피언+룬  · 내 챔피언+아이템 · 내 룬+아이템  ·
//               아군/상대 아이템 · 아군/상대 챔피언 · 아군/상대 룬  · 시간대
//   = 8896 운영자 대시보드(aram_mayhem_auto/server.js)의 개인분석 로직을 각자 PC LCU 캐시로 재구성.
//   증강모드 소스 = augfull 캐시(teamParticipants+augments) ∪ db.json(메인PC) — matchId dedup.
//     augfull은 captureAugmentContributions가 증분으로 채움(분석은 로컬캐시만 읽음, 업로드와 무관).
//   표준모드 소스 = std 캐시(자기 행 + myStat이 q450에만 붙이는 tp = 10인 압축 구성).
//     ⚠️ tp는 LCU를 한 번 이상 읽은 뒤 목록 깊이 안에 있는 게임에만 붙는다(mergeStd가 fresh로 덮어써 백필).
//        그 밖의 옛 캐시 행엔 없다 → 지어내지 말고 건너뛰고, ctxGames로 표본을 정직하게 표기한다.
//   산식 8896 미러: ctx행 min 5판, delta=승률-전체승률(±방향), |delta|→games 정렬 /
//     시간대 = KST(UTC+9) 시작·종료·경기중(activeHour 자정넘김 포함) 24버킷 + 게임길이 분버킷 + best/worst(표본 max(3,총3%)+).
// ─────────────────────────────────────────────────────────────────────────────
const KST_OFFSET_MS = 9 * 3600 * 1000;
const kstHour = ms => new Date(Number(ms) + KST_OFFSET_MS).getUTCHours();
function kstTouchedHours(startMs, durSec) { // 경기 중 걸친 KST 시간대 전부(자정 넘김 처리) — 8896 kstTouchedHours 미러
  const out = new Set(); const start = Number(startMs) || 0, end = start + Math.max(0, Number(durSec) || 0) * 1000;
  for (let t = start; ; t += 3600 * 1000) { out.add(kstHour(Math.min(t, end))); if (t >= end) break; }
  return [...out];
}
const rate1 = (w, g) => g ? Math.round(w / g * 1000) / 10 : 0;
function buildTimePattern(rows) { // rows: [{t(ms), dur(sec), win}]
  const mkH = () => Array.from({ length: 24 }, (_, h) => ({ key: String(h).padStart(2, "0"), label: String(h).padStart(2, "0") + "시", order: h, games: 0, wins: 0 }));
  const startHour = mkH(), endHour = mkH(), activeHour = mkH(), durB = new Map();
  const durKey = min => min < 8 ? "under8" : min >= 25 ? "25plus" : String(min);
  const durLabel = k => k === "under8" ? "8분 미만" : k === "25plus" ? "25분 이상" : k + "분";
  const durOrder = k => k === "under8" ? -1 : k === "25plus" ? 999 : Number(k);
  let counted = 0;
  for (const r of rows) {
    const t = Number(r.t) || 0; if (!t) continue; counted++;
    const w = r.win ? 1 : 0, dur = Number(r.dur) || 0;
    const sh = startHour[kstHour(t)]; sh.games++; sh.wins += w;
    const eh = endHour[kstHour(t + dur * 1000)]; eh.games++; eh.wins += w;
    for (const h of kstTouchedHours(t, dur)) { activeHour[h].games++; activeHour[h].wins += w; }
    const dk = durKey(Math.round(dur / 60));
    const b = durB.get(dk) || { key: dk, label: durLabel(dk), order: durOrder(dk), games: 0, wins: 0 };
    b.games++; b.wins += w; durB.set(dk, b);
  }
  const fin = arr => arr.map(b => ({ ...b, losses: b.games - b.wins, winRate: rate1(b.wins, b.games), sampleShare: rate1(b.games, counted) }));
  const sH = fin(startHour), eH = fin(endHour), aH = fin(activeHour);
  const dM = fin([...durB.values()].sort((a, b) => a.order - b.order));
  const minHi = Math.max(3, Math.ceil(counted * 0.03));
  const pick = (arr, best) => { const c = arr.filter(b => b.games >= minHi); if (!c.length) return null; return c.slice().sort((a, b) => best ? (b.winRate - a.winRate) || (b.games - a.games) : (a.winRate - b.winRate) || (b.games - a.games))[0]; };
  return {
    timezone: "Asia/Seoul", games: counted, minHighlightGames: minHi,
    startHour: sH, endHour: eH, activeHour: aH, durationMinute: dM,
    summary: { bestActiveHour: pick(aH, true), worstActiveHour: pick(aH, false), bestStartHour: pick(sH, true), worstStartHour: pick(sH, false), bestEndHour: pick(eH, true), worstEndHour: pick(eH, false), bestDuration: pick(dM, true), worstDuration: pick(dM, false) }
  };
}
const _anBump = (map, key, win) => { if (key == null || key === "" || key === 0) return; const c = map.get(key) || { key, games: 0, wins: 0 }; c.games++; c.wins += win ? 1 : 0; map.set(key, c); };
// ── 쌍(pair) 집계: 같은 게임에서 함께 나온 두 항목의 조합별 내 승률 ──────────────────────────
//   증바람 = 내 챔피언+증강 / 내 챔피언+아이템 / 내 증강+아이템
//   일반   = 내 챔피언+룬  / 내 챔피언+아이템 / 내 룬+아이템   (증강 자리를 룬이 대체 — 사이트와 동일 대응)
//   kindA/kindB = champion|augment|item|rune → 라벨·아이콘은 server.mjs가 각 정본 소스로 붙인다.
const _pairBump = (map, a, b, win) => {
  if (a == null || a === "" || a === 0 || b == null || b === "" || b === 0) return;
  const k = a + "|" + b;
  const c = map.get(k) || { key: k, a, b, games: 0, wins: 0 };
  c.games++; c.wins += win ? 1 : 0; map.set(k, c);
};
//   챔피언 쪽 라벨·아이콘만 여기서(champMaps가 여기 있으므로) 붙이고, 증강/아이템/룬 쪽은 server가 붙인다.
//   표본 1판 쌍은 승률이 0%/100% 둘뿐이라 정보가 없다 → 2판부터. (캡 없음 — 검색·정렬로 좁힌다)
const _finPair = (map, kindA, kindB, m) => [...map.values()]
  .map(c => ({
    ...c, losses: c.games - c.wins, winRate: rate1(c.wins, c.games), kindA, kindB,
    ...(kindA === "champion" ? { aLabel: m.names.get(Number(c.a)) || ("챔피언 #" + c.a), aIcon: m.icons.get(Number(c.a)) || "" } : {})
  }))
  .filter(c => c.games >= 2)
  .sort((a, b) => b.games - a.games || b.winRate - a.winRate);
export async function personalAnalysis(mode) {
  const m = await champMaps();
  if (mode === "augment") {
    // 소스: augfull ∪ db.json(있으면) — matchId dedup, 시즌2·8분·큐2400 필터(personalChampBuild와 동일 게이트)
    const seen = new Set(); const rows = [];
    const ok = x => Number(x.queueId) === Q_AUGMENT && Number(x.gameDuration || 0) >= MIN_DUR && augVerNum(x) >= AUG_S2_VERNUM && (x.gameCreation || 0) >= AUG_S2_BOUNDARY_MS;
    const _mine = myIdentityPuuids(readDb(), readPuuidCache()); // 현재 로그인 계정만(PBE 등 다른 계정 제외)
    const _isMine = x => !_mine.size || !x.puuid || _mine.has(x.puuid); // 신원 모르면(빈집합)·태깅없는 옛 행은 통과(종전 동작 보존)
    for (const x of readAugFull()) if (ok(x) && _isMine(x) && x.matchId && !seen.has(x.matchId)) { seen.add(x.matchId); rows.push(x); }
    try { const db = readDb(); const puuids = _mine.size ? _mine : new Set(((db && db.accounts) || []).map(a => a.puuid)); for (const x of ((db && db.matches) || [])) if (ok(x) && puuids.has(x.puuid) && x.matchId && !seen.has(x.matchId)) { seen.add(x.matchId); rows.push(x); } } catch {}
    const games = rows.length, winsTotal = rows.filter(r => r.win).length, baseWinRate = rate1(winsTotal, games);
    const augBy = new Map(), itemBy = new Map(), allyCh = new Map(), enemyCh = new Map(), allyAug = new Map(), enemyAug = new Map(), enemyItem = new Map(), allyItem = new Map();
    const myChAug = new Map(), myChItem = new Map(), myAugItem = new Map(); // 쌍: 내 챔피언+증강 / 내 챔피언+아이템 / 내 증강+아이템
    let ctxGames = 0; // teamParticipants 있는 게임 수(아군/상대 분석 표본)
    const augKey = a => { const v = Number(a && (a.value ?? a.id)) || 0; return v || String((a && (a.localName || a.name)) || ""); };
    for (const x of rows) {
      const win = !!x.win;
      for (const a of (x.augments || [])) _anBump(augBy, augKey(a), win); // 내 증강
      const tp = Array.isArray(x.teamParticipants) ? x.teamParticipants : [];
      let own = tp.find(p => p.puuid && p.puuid === x.puuid) || null;
      if (!own && x.championId) own = tp.find(p => Number(p.champion) === Number(x.championId) && !!p.win === win) || null; // puuid 익명화행 폴백
      // 내 아이템: own 행 items(숫자 id) 우선, 없으면 itemsDetailed(db.json) — 게임당 dedup, 소모품/룬형 제외
      const myItems = own && Array.isArray(own.items) && own.items.length ? own.items.map(Number) : ((x.itemsDetailed || []).map(d => Number(d && d.id)).filter(Boolean));
      const seenIt = new Set();
      for (const id of myItems) { if (!id || isExcludedItem(id) || isRuneLikeItemId(id) || seenIt.has(id)) continue; seenIt.add(id); _anBump(itemBy, id, win); }
      // 쌍 집계 — 이 게임의 내 챔피언 × 내 증강 × 내 아이템(게임당 각각 dedup된 집합끼리 곱)
      const myChId = Number(x.championId) || (own ? Number(own.champion) : 0) || 0;
      const myAugKeys = [...new Set((x.augments || []).map(augKey).filter(k => k))];
      const myItemIds = [...seenIt];
      for (const ak of myAugKeys) {
        _pairBump(myChAug, myChId, ak, win);
        for (const it of myItemIds) _pairBump(myAugItem, ak, it, win);
      }
      for (const it of myItemIds) _pairBump(myChItem, myChId, it, win);
      if (own && own.teamId != null && tp.length >= 2) {
        ctxGames++;
        const seenEn = new Set(), seenAl = new Set(); // 상대/아군팀 아이템 각각 게임당 dedup(여러 명이 같은 아이템 = 1판)
        for (const p of tp) {
          const same = p.teamId === own.teamId;
          if (p !== own) _anBump(same ? allyCh : enemyCh, Number(p.champion) || String(p.champion || ""), win); // 챔피언: 자신 제외(8896 미러)
          for (const a of (p.augments || [])) _anBump(same ? allyAug : enemyAug, augKey(a), win); // 증강: 아군에 자신 포함(8896 미러)
          if (!same && Array.isArray(p.items)) { for (const id of p.items.map(Number)) { if (!id || isExcludedItem(id) || isRuneLikeItemId(id) || seenEn.has(id)) continue; seenEn.add(id); _anBump(enemyItem, id, win); } } // 상대 아이템: 상대팀이 이 아이템 보유한 게임의 내 승률
          if (same && p !== own && Array.isArray(p.items)) { for (const id of p.items.map(Number)) { if (!id || isExcludedItem(id) || isRuneLikeItemId(id) || seenAl.has(id)) continue; seenAl.add(id); _anBump(allyItem, id, win); } } // 아군 아이템: 아군(본인 제외)이 이 아이템 보유한 게임의 내 승률(상대 아이템과 대칭)
        }
      }
    }
    const finCtx = map => [...map.values()].map(c => { const wr = rate1(c.wins, c.games); return { ...c, losses: c.games - c.wins, winRate: wr, delta: Math.round((wr - baseWinRate) * 10) / 10, direction: wr >= baseWinRate ? "높음" : "낮음" }; })
      .filter(c => c.games >= 5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.games - a.games);
    const finMine = map => [...map.values()].map(c => ({ ...c, losses: c.games - c.wins, winRate: rate1(c.wins, c.games) })).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    const chFix = arr => arr.map(c => { const idn = Number(c.key) || 0; return { ...c, id: idn || null, label: idn ? (m.names.get(idn) || ("챔피언 #" + idn)) : String(c.key), icon: idn ? (m.icons.get(idn) || "") : "" }; });
    return {
      ok: true, mode, games, ctxGames, baseWinRate,
      myAugments: finMine(augBy), myItems: finMine(itemBy),
      myChampAugments: _finPair(myChAug, "champion", "augment", m), myChampItems: _finPair(myChItem, "champion", "item", m), myAugmentItems: _finPair(myAugItem, "augment", "item", m),
      allyChampions: chFix(finCtx(allyCh)), enemyChampions: chFix(finCtx(enemyCh)),
      allyAugments: finCtx(allyAug), enemyAugments: finCtx(enemyAug), allyItems: finCtx(allyItem), enemyItems: finCtx(enemyItem),
      timePattern: buildTimePattern(rows.map(x => ({ t: x.gameCreation, dur: x.gameDuration, win: x.win })))
    };
  }
  // 표준(450) — 증강모드와 같은 항목 구성. 증강 자리를 룬이 대체한다(사이트 aram-mayhem.com의 q450↔q2400 대응과 동일).
  //   내 항목(내 룬·아이템·쌍) 소스 = std 캐시(전 기간).
  //   아군/상대 소스 = stdfull 캐시(captureStandardTeams가 상세에서 증분 수집) — gid로 조인.
  //     ⚠️ 목록엔 내 참가자밖에 없어서 아군/상대는 상세 없이는 못 얻는다. 아직 안 받은 게임은
  //        세지 않고 건너뛴다(ctxGames로 표본을 정직하게 표기 — 결측을 0으로 렌더하지 않는다).
  const rows = readStdCache().filter(r => (r.queueId == null || Number(r.queueId) === 450) && Number(r.dur || 0) >= MIN_DUR);
  const tpByGid = new Map(); // "LCU-<gid>" → stdfull 행
  for (const f of readStdFull()) if (f && f.matchId) tpByGid.set(f.matchId, f);
  const games = rows.length, winsTotal = rows.filter(r => r.win).length, baseWinRate = rate1(winsTotal, games);
  const itemBy = new Map(), runeBy = new Map(), shardBy = new Map();
  const allyCh = new Map(), enemyCh = new Map(), allyRune = new Map(), enemyRune = new Map(), allyItem = new Map(), enemyItem = new Map();
  const myChRune = new Map(), myChItem = new Map(), myRuneItem = new Map(); // 쌍: 내 챔피언+룬 / 내 챔피언+아이템 / 내 룬+아이템
  let runeGames = 0; // perks 있는 게임 수(옛 게임 미수집 커버리지 표기용)
  let ctxGames = 0;  // tp(팀 구성) 있는 게임 수 — 아군/상대 분석 표본
  for (const r of rows) {
    const win = !!r.win, seenIt = new Set();
    for (const raw of (r.items || [])) { const id = Number(raw) || Number((String(raw).match(/\/(\d+)\.png/) || [])[1]) || 0; if (!id || isExcludedItem(id) || isRuneLikeItemId(id) || seenIt.has(id)) continue; seenIt.add(id); _anBump(itemBy, id, win); }
    const pk = r.perks || null;
    let myRuneIds = [];
    if (pk && Array.isArray(pk.ids) && pk.ids.length) {
      runeGames++;
      myRuneIds = [...new Set(pk.ids.map(Number).filter(Boolean))];
      for (const id of myRuneIds) _anBump(runeBy, id, win);
      for (const id of new Set(((pk.shards || [])).map(Number).filter(Boolean))) _anBump(shardBy, id, win);
    }
    // 쌍 집계 — 증강모드와 동일 규칙(증강 자리 = 룬)
    const myChId = Number(r.championId) || 0, myItemIds = [...seenIt];
    for (const rid of myRuneIds) {
      _pairBump(myChRune, myChId, rid, win);
      for (const it of myItemIds) _pairBump(myRuneItem, rid, it, win);
    }
    for (const it of myItemIds) _pairBump(myChItem, myChId, it, win);
    // 아군/상대 — stdfull에 팀 구성이 있는 게임만(아직 상세를 안 받은 게임은 건너뛴다)
    const fr = r.gid != null ? tpByGid.get("LCU-" + r.gid) : null;
    const tp = fr && Array.isArray(fr.tp) ? fr.tp : [];
    const myTeam = fr ? fr.team : null;
    if (tp.length >= 2 && myTeam) {
      ctxGames++;
      const seenEn = new Set(), seenAl = new Set(), seenEnR = new Set(), seenAlR = new Set();
      for (const p of tp) {
        const me = !!fr.mypid && p.pid === fr.mypid;
        const same = p.tm === myTeam;
        if (!me) _anBump(same ? allyCh : enemyCh, Number(p.c) || 0, win); // 챔피언: 자신 제외(증강모드 미러)
        // 룬: 아군에 자신 포함(증강모드의 아군 증강과 동일). 단 아이템처럼 게임당 dedup —
        //   같은 룬(정복자 등)은 한 팀에 여러 명이 겹치는 게 흔해, 안 거르면 판수가 부풀어 거짓이 된다.
        for (const rid of new Set((p.r || []).map(Number).filter(Boolean))) {
          const seenR = same ? seenAlR : seenEnR;
          if (seenR.has(rid)) continue; seenR.add(rid);
          _anBump(same ? allyRune : enemyRune, rid, win);
        }
        if (!same) { for (const id of (p.it || []).map(Number)) { if (!id || isExcludedItem(id) || isRuneLikeItemId(id) || seenEn.has(id)) continue; seenEn.add(id); _anBump(enemyItem, id, win); } } // 상대 아이템: 상대팀이 이 아이템 보유한 게임의 내 승률
        if (same && !me) { for (const id of (p.it || []).map(Number)) { if (!id || isExcludedItem(id) || isRuneLikeItemId(id) || seenAl.has(id)) continue; seenAl.add(id); _anBump(allyItem, id, win); } } // 아군 아이템: 아군(본인 제외) 보유 게임의 내 승률
      }
    }
  }
  const finMine = map => [...map.values()].map(c => ({ ...c, losses: c.games - c.wins, winRate: rate1(c.wins, c.games) })).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  const finCtx = map => [...map.values()].map(c => { const wr = rate1(c.wins, c.games); return { ...c, losses: c.games - c.wins, winRate: wr, delta: Math.round((wr - baseWinRate) * 10) / 10, direction: wr >= baseWinRate ? "높음" : "낮음" }; })
    .filter(c => c.games >= 5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.games - a.games); // 증강모드와 동일 게이트(5판+)
  const chFix = arr => arr.map(c => { const idn = Number(c.key) || 0; return { ...c, id: idn || null, label: idn ? (m.names.get(idn) || ("챔피언 #" + idn)) : String(c.key), icon: idn ? (m.icons.get(idn) || "") : "" }; });
  return {
    ok: true, mode: "standard", games, ctxGames, baseWinRate, runeGames,
    myRunes: finMine(runeBy), myItems: finMine(itemBy), myShards: finMine(shardBy),
    myChampRunes: _finPair(myChRune, "champion", "rune", m), myChampItems: _finPair(myChItem, "champion", "item", m), myRuneItems: _finPair(myRuneItem, "rune", "item", m),
    allyChampions: chFix(finCtx(allyCh)), enemyChampions: chFix(finCtx(enemyCh)),
    allyRunes: finCtx(allyRune), enemyRunes: finCtx(enemyRune), allyItems: finCtx(allyItem), enemyItems: finCtx(enemyItem),
    timePattern: buildTimePattern(rows.map(r => ({ t: r.t, dur: r.dur, win: r.win })))
  };
}

async function main() {
  try {
    const r = await getRecords({ mock: process.argv.includes("--mock") });
    console.log(`\n=== ${r.who} 님 — 칼바람 개인기록 (LCU·로컬, Riot API키 0) ===`);
    printRecord("일반 칼바람 (올해)", r.standard, "올해 일반칼바람 기록 없음.");
    printRecord("증강 칼바람 (증바람)", r.augment, `증바람(큐${Q_AUGMENT}) 기록 0 — 큐ID 다르면 Q_AUGMENT 수정.`);
    console.log("");
  } catch (e) { console.error(e.code === "LEAGUE_OFF" ? "❌ League 실행 후 다시 / 또는 LCU_LOCKFILE 지정." : (e.stack || e)); process.exit(1); }
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) main();

// ── 2026-07-09 인게임(픽창) 모드 LCU 헬퍼 — 관용영역만(픽창 QoL·룬임포트). 인게임 오버레이/스크립트 없음. ──
//   readLockfile()+lcuGet()(위 정의) 재사용 + 액션용 lcuReq(POST/PUT/DELETE). 클라 꺼져 있으면 전부 null/throw로 안전.
function lcuReq(lcu, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { Authorization: "Basic " + Buffer.from("riot:" + lcu.password).toString("base64") };
    if (data) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = data.length; }
    const req = https.request({ host: "127.0.0.1", port: lcu.port, path: p, method, rejectUnauthorized: false, headers }, res => {
      const ch = []; res.on("data", c => ch.push(c)); res.on("end", () => {
        const t = Buffer.concat(ch).toString("utf8"); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
        else reject(new Error("LCU " + res.statusCode + " " + method + " " + p + " " + String(t).slice(0, 140)));
      });
    });
    req.on("error", reject); req.setTimeout(2500, function () { try { req.destroy(); } catch (e) {} reject(new Error("LCU timeout " + p)); }); if (data) req.write(data); req.end();
  });
}
export async function ingameGameflowPhase() { // "None"|"Lobby"|"ChampSelect"|"InProgress"... / 클라 꺼짐="Off"
  try { const lcu = readLockfile(); if (!lcu) return "Off"; return await lcuReq(lcu, "GET", "/lol-gameflow/v1/gameflow-phase"); } catch { return "Off"; }
}
export async function ingameChampSelect() { // 픽창 세션(내 팀·벤치·액션·내 슬롯). 픽창 아니면 null.
  try { const lcu = readLockfile(); if (!lcu) return null; return await lcuReq(lcu, "GET", "/lol-champ-select/v1/session"); } catch { return null; }
}
export async function ingameQueue() { // 현재 큐 → {queueId, mode}. ★gameMode 기준(일반=ARAM / 아수라장·증강=KIWI). 큐ID는 450·2400·3220(커스텀) 등 다양해서 단독으론 부족 → gameMode+설명 키워드가 안정적.
  try {
    const lcu = readLockfile(); if (!lcu) return null;
    const classify = (q) => { if (!q) return null;
      const gm = String(q.gameMode || "").toUpperCase();
      const qid = Number(q.id != null ? q.id : q.queueId); const qn = Number.isFinite(qid) && qid > 0 ? qid : null;
      const txt = String((q.description || "") + " " + (q.detailedDescription || "") + " " + (q.shortName || "") + " " + (q.name || "") + " " + (q.assetMutator || "")).toLowerCase();
      // ★클래식 스타일(2450)을 반드시 먼저 가로챈다 — 큐 이름이 "무작위 총력전: 아수라장 클래식 스타일"이라
      //   아래 증강 정규식의 "아수라장"에 걸려 증바람(2400)으로 오분류된다. 순서를 바꾸면 그 순간 회귀.
      if (qn === Q_CLASSIC || gm === "KIWI_JADE" || qn === 3280) return { queueId: qn, mode: "classic", gameMode: gm };
      // 증강(아수라장) 지표 우선 — 맵이 칼바람이라 gameMode가 ARAM으로 올 수도 있어 키워드/큐ID로도 확인.
      if (qn === Q_AUGMENT || gm === "KIWI" || /증강|아수라장|augment|mayhem|kiwi|swiftplay/.test(txt)) return { queueId: qn, mode: "augment", gameMode: gm };
      if (gm === "ARAM" || qn === Q_STANDARD || qn === 3220) return { queueId: qn, mode: "standard", gameMode: gm };
      return null;
    };
    // 1) gameflow 세션 gameData.queue (픽창·게임 중에도 유효)
    try { const s = await lcuReq(lcu, "GET", "/lol-gameflow/v1/session"); const r = classify(s && s.gameData && s.gameData.queue); if (r) return r; } catch {}
    // 2) 로비 gameConfig (로비 단계)
    try { const l = await lcuReq(lcu, "GET", "/lol-lobby/v2/lobby"); const r = classify(l && l.gameConfig); if (r) return r; } catch {}
    return null;
  } catch { return null; }
}
export async function ingameDiag() { // 진단: 큐 감지 소스별 원시 응답 덤프(모드 오판 원인 추적용). 라이브 클라 없으면 {off:true}.
  const out = { at: new Date().toISOString() };
  try { const lcu = readLockfile(); if (!lcu) return { off: true, reason: "no lockfile(클라 꺼짐)" }; out.lockfile = { port: lcu.port };
    const grab = async (p, pick) => { try { const r = await lcuReq(lcu, "GET", p); return pick ? pick(r) : r; } catch (e) { return { err: String(e && e.message || e) }; } };
    out.phase = await grab("/lol-gameflow/v1/gameflow-phase");
    out.gameflowSession = await grab("/lol-gameflow/v1/session", s => ({ phase: s && s.phase, gameDataQueue: s && s.gameData && s.gameData.queue, gameDataQueueId: s && s.gameData && s.gameData.queueId, gameId: s && s.gameData && s.gameData.gameId }));
    out.lobby = await grab("/lol-lobby/v2/lobby", l => ({ gameConfigQueueId: l && l.gameConfig && l.gameConfig.queueId, gameMode: l && l.gameConfig && l.gameConfig.gameMode }));
    out.playerStatus = await grab("/lol-gameflow/v1/gameflow-metadata/player-status", ps => ({ currentLobbyStatus: ps && ps.currentLobbyStatus }));
    out.champSelectSession = await grab("/lol-champ-select/v1/session", cs => cs ? { hasSession: true, benchEnabled: cs.benchEnabled, keys: Object.keys(cs).slice(0, 40) } : null);
    out.detected = await ingameQueue();
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
}
export async function ingameBenchSwap(championId) { // ARAM 벤치 스왑(내 챔프↔벤치의 고를 수 있는 챔프)
  const lcu = readLockfile(); if (!lcu) { const e = new Error("LEAGUE_OFF"); e.code = "LEAGUE_OFF"; throw e; }
  return await lcuReq(lcu, "POST", "/lol-champ-select/v1/session/bench/swap/" + Number(championId));
}
export async function ingameSetRunes(page) { // page={name, primaryStyleId, subStyleId, selectedPerkIds:[9]} — 전용페이지만 지우고 재생성(인벤 상한 회피)
  const lcu = readLockfile(); if (!lcu) { const e = new Error("LEAGUE_OFF"); e.code = "LEAGUE_OFF"; throw e; }
  const TAG = "[칼바람]";
  try { const pages = await lcuGet(lcu, "/lol-perks/v1/pages"); for (const pg of (pages || [])) { if (pg && typeof pg.name === "string" && pg.name.indexOf(TAG) === 0 && pg.isDeletable !== false) { try { await lcuReq(lcu, "DELETE", "/lol-perks/v1/pages/" + pg.id); } catch {} } } } catch {}
  const body = { name: TAG + " " + (page.name || ""), primaryStyleId: Number(page.primaryStyleId), subStyleId: Number(page.subStyleId), selectedPerkIds: (page.selectedPerkIds || []).map(Number), current: true };
  const created = await lcuReq(lcu, "POST", "/lol-perks/v1/pages", body);
  try { if (created && created.id != null) await lcuReq(lcu, "PUT", "/lol-perks/v1/currentpage", created.id); } catch {}
  return created;
}
export function ingameLiveGame() { // Live Client Data(공식 read-only, 2999) — 인게임 진입 후 양팀 챔프 노출. 아니면 null.
  return new Promise((resolve) => {
    const req = https.request({ host: "127.0.0.1", port: 2999, path: "/liveclientdata/allgamedata", method: "GET", rejectUnauthorized: false }, res => {
      const ch = []; res.on("data", c => ch.push(c)); res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString("utf8"))); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null)); req.setTimeout(1500, () => { try { req.destroy(); } catch {} resolve(null); }); req.end();
  });
}
