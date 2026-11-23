import Script from "next/script";

export default function HomePage() {
  return (
    <>
      <div className="top">
        <div className="brand">
          칼바람 <b>분석기</b>
          <span className="web-badge">WEB</span>
        </div>
        <div className="toggle">
          <button data-mode="standard" className="on" type="button">
            일반 칼바람
          </button>
          <button data-mode="augment" type="button">
            증강 칼바람
          </button>
        </div>
        <div className="search">
          <input
            id="q"
            type="text"
            placeholder="페이지 내 검색"
            autoComplete="off"
          />
          <span className="findnav" id="findnav" hidden>
            <b id="findcount">0/0</b>
            <button
              type="button"
              id="findprev"
              title="이전 (Shift+Enter)"
              aria-label="이전 결과"
            >
              ▲
            </button>
            <button
              type="button"
              id="findnext"
              title="다음 (Enter)"
              aria-label="다음 결과"
            >
              ▼
            </button>
          </span>
        </div>
        <span className="ao-help web-hide" id="aohelp" tabIndex={0} aria-label="증강 오버레이 안내">
          ?
          <span className="ao-tip" role="tooltip"></span>
        </span>
        <div
          className="igsw-wrap web-hide"
          id="aobtn"
          role="switch"
          aria-checked="false"
          tabIndex={0}
          aria-label="증강 오버레이"
        >
          ✨<span className="sw" id="aosw"></span>
        </div>
        <button
          className="topbtn web-hide"
          id="aoobs"
          type="button"
          aria-label="방송(OBS)에 띄우기"
        >
          📺
        </button>
        <div
          className="igsw-wrap web-hide"
          id="igbtn"
          role="switch"
          aria-checked="false"
          tabIndex={0}
          aria-label="인게임 모드"
        >
          🎮<span className="sw" id="igsw"></span>
        </div>
        <button className="topbtn" id="setbtn" type="button" aria-label="설정" title="설정">
          ⚙
        </button>
      </div>

      <div className="wrap">
        <div className="col">
          <div className="card">
            <h3 className="me-head">
              <div className="me-row1">
                <span className="btoggle" id="me-switch">
                  <button data-meview="record" className="on" type="button">
                    전적
                  </button>
                  <button data-meview="champs" type="button">
                    챔피언 통계
                  </button>
                </span>
                <button className="head-more" id="anlbtn" type="button">
                  상세 분석
                </button>
                <span id="me-mode">올해</span>
              </div>
              <div className="me-actions">
                <button className="head-action" id="readbtn" type="button">
                  사주풀이
                </button>
                <button className="head-action" id="mmrbtn" type="button" hidden>
                  MMR
                </button>
              </div>
            </h3>
            <div className="pad load-row web-search-row">
              <form id="summoner-search-form" className="web-sform">
                <input
                  id="summoner-input"
                  className="web-sinput"
                  type="text"
                  placeholder="계정명#태그 (예: 주대각#kr12)"
                  autoComplete="off"
                />
                <button className="btn web-sbtn" id="load" type="submit">
                  검색
                </button>
              </form>
              <div className="web-sactions">
                <button
                  className="btn-demo"
                  id="load-demo"
                  type="button"
                  title="데모 전적으로 사주풀이·개인 통계를 체험해보세요"
                >
                  데모 전적 체험
                </button>
                <button
                  className="anon-tog"
                  id="anonbtn"
                  type="button"
                  aria-pressed="false"
                  title="익명 모드 — 내 닉네임은 익명#--로, 전적 개요에 나오는 다른 사람 닉네임은 챔피언 이름으로 덮어요"
                >
                  <span>익명</span>
                  <i className="anon-sw"></i>
                </button>
              </div>
            </div>
            <div id="me"></div>
            <div id="mychamps" style={{ display: "none" }}>
              <p className="hint">
                전적을 불러오면 내가 한 챔피언이 메타와 나란히 표시돼요.
              </p>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="tabs" id="meta-tabs">
              <button data-tab="broadcast" className="on" type="button">
                메타 통계
              </button>
              <button data-tab="champion" type="button">
                챔피언
              </button>
              <button data-tab="rune" id="tab-rune" type="button">
                룬
              </button>
              <button data-tab="item" type="button">
                아이템
              </button>
              <button data-tab="combo" type="button">
                조합
              </button>
              <button data-tab="analysis" type="button">
                지표 분석
              </button>
            </div>
            <div id="meta">
              <p className="hint">불러오는 중…</p>
            </div>
          </div>
        </div>
      </div>

      <div id="champpage"></div>
      <div id="setpage"></div>
      <div id="ingamepage"></div>

      <div
        id="amConsentGate"
        className="consent-gate"
        hidden
        role="dialog"
        aria-modal="true"
        aria-label="데이터 제공 동의"
      >
        <div className="consent-card">
          <div className="consent-title">
            <span style={{ color: "var(--accent)" }}>◆</span> 칼바람 분석기
          </div>
          <p className="consent-sub">
            더 정확한 통계를 위해, 당신의 무작위 총력전(증강·일반 칼바람) 전적을 모아 전체 통계에 보탭니다.
          </p>
          <ul className="consent-list">
            <li>
              보내는 것은 게임이 끝난 뒤 남는 기록(챔피언·증강·아이템·승패)과, 게임에서 서로 보이던 라이엇 ID입니다.
            </li>
            <li>
              비밀번호·이메일 같은 계정 정보는 <b>다루지 않습니다.</b>
            </li>
            <li>
              모인 기록은 <b>전체 메타 통계</b>와 전적 조회에 쓰입니다.
            </li>
          </ul>
          <label className="consent-check">
            <input type="checkbox" id="amConsentCheck" /> 데이터 제공에 동의합니다.
          </label>
          <button className="consent-btn" id="amConsentBtn" type="button" disabled>
            동의하고 시작
          </button>
        </div>
      </div>

      <div
        id="amMmrModal"
        className="mmr-modal"
        hidden
        role="dialog"
        aria-modal="true"
        aria-label="증바람MMR"
      >
        <div className="mmr-card">
          <div className="mmr-bar">
            <span className="mmr-tabs">
              <button type="button" className="on" data-mmrtab="lookup">
                증바람MMR 조회
              </button>
              <button type="button" data-mmrtab="top">
                증바람MMR 최상위 플레이어
              </button>
            </span>
            <button type="button" className="mmr-x" id="amMmrClose" aria-label="닫기">
              ✕
            </button>
          </div>
          <div className="mmr-body" id="amMmrBody"></div>
        </div>
      </div>

      <Script src="/app-client.js" strategy="afterInteractive" />
    </>
  );
}
