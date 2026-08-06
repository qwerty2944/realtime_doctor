import { Fragment } from 'react';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Absolute: the root layout applies a "%s | RightHand 사전 문진" template that
  // does not apply to the company homepage.
  title: { absolute: 'Entanglecare' },
  description:
    'Entanglecare(엔탱글케어) — 교육·헬스케어 모바일 앱을 직접 기획·개발·운영하는 1인 소프트웨어 스튜디오.',
};

/**
 * Company homepage (bold-typography design).
 *
 * All styles live in the string below and are scoped under the `.ec` root class
 * so they cannot leak into /righthand/* screens, which use the Tailwind/TDS
 * tokens from globals.css. The design intentionally does not use those tokens.
 */
const css = `
.ec{
  --paper:#f2f1ee;
  --ink:#0a0a0a;
  --ink-2:#575552;
  --ink-3:#8f8c87;
  --line:#0a0a0a;
  --line-soft:#d6d4cf;
  --accent:#ff3b1f;
  --accent-ink:#ffffff;
  --sans:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Segoe UI",Roboto,"Noto Sans KR","Malgun Gothic",sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --max:1240px;
  --pad:clamp(18px,4.5vw,52px);
}
@media (prefers-color-scheme: dark){
  .ec{
    --paper:#0b0b0b;
    --ink:#f4f2ee;
    --ink-2:#a6a29c;
    --ink-3:#6e6a64;
    --line:#f4f2ee;
    --line-soft:#2a2926;
    --accent:#ff4a2e;
    --accent-ink:#0b0b0b;
  }
}

/* base */
.ec,.ec *,.ec *::before,.ec *::after{box-sizing:border-box}
.ec{
  flex:1 0 auto;width:100%;max-width:100%;overflow-x:hidden;
  background:var(--paper);color:var(--ink);
  font-family:var(--sans);font-size:16px;line-height:1.65;letter-spacing:-.012em;
  -webkit-font-smoothing:antialiased;
  word-break:keep-all;overflow-wrap:break-word;
}
.ec svg{display:block}
.ec h1,.ec h2,.ec h3,.ec p,.ec ul,.ec dl,.ec dd{margin:0}
.ec ul{list-style:none;padding:0}
.ec a{color:inherit}
.ec ::selection{background:var(--accent);color:var(--accent-ink)}
.ec :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.ec .wrap{max-width:var(--max);margin-inline:auto;padding-inline:var(--pad)}
.ec .mono{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}

@keyframes ec-clipUp{from{opacity:0;transform:translateY(.28em)}to{opacity:1;transform:none}}
@keyframes ec-wipe{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes ec-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.ec .up{animation:ec-clipUp 1s cubic-bezier(.16,.84,.28,1) both}
.ec .d1{animation-delay:.05s}.ec .d2{animation-delay:.13s}.ec .d3{animation-delay:.21s}
.ec .d4{animation-delay:.29s}.ec .d5{animation-delay:.37s}
@media (prefers-reduced-motion: reduce){.ec *,.ec *::before,.ec *::after{animation:none!important;transition:none!important}}

/* header */
.ec .site-head{position:sticky;top:0;z-index:40;background:var(--paper);border-bottom:2px solid var(--line)}
.ec .site-head .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;height:56px}
.ec .brand{font-family:var(--mono);font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;text-decoration:none}
.ec .brand em{font-style:normal;color:var(--accent)}
.ec .nav{display:flex;gap:clamp(12px,2.6vw,26px)}
.ec .nav a{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;color:var(--ink-2);transition:color .2s}
.ec .nav a:hover{color:var(--accent)}
@media (max-width:480px){.ec .nav a:nth-child(1){display:none}}

/* hero */
.ec .hero{padding:clamp(34px,6vh,68px) 0 0}
.ec .hero-top{display:flex;flex-wrap:wrap;gap:10px 24px;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:12px;margin-bottom:clamp(20px,4vw,40px)}
.ec .display{
  font-size:clamp(3.2rem,15.2vw,11.5rem);
  line-height:.86;font-weight:800;letter-spacing:-.055em;
  text-transform:uppercase;word-break:break-word;
}
.ec .display .l2{display:block;color:var(--accent)}
.ec .display .l2 .sm{font-size:.34em;letter-spacing:-.03em;vertical-align:.42em;color:var(--ink-3)}
.ec .tagline{
  margin-top:clamp(22px,4vw,44px);
  display:grid;gap:clamp(16px,3vw,40px);grid-template-columns:1fr;
  border-top:2px solid var(--line);padding-top:clamp(18px,3vw,32px);
}
@media (min-width:860px){.ec .tagline{grid-template-columns:1.15fr .85fr;align-items:start}}
.ec .tagline h1{font-size:clamp(1.5rem,3.6vw,2.6rem);line-height:1.28;letter-spacing:-.042em;font-weight:700;max-width:20ch}
.ec .tagline h1 mark{background:var(--accent);color:var(--accent-ink);padding:0 .12em;border-radius:2px}
.ec .tagline .side{color:var(--ink-2);font-size:15px;line-height:1.75;max-width:44ch}
.ec .tagline .side .mono{display:block;margin-bottom:10px}

/* marquee strip */
.ec .strip{margin-top:clamp(28px,5vw,56px);border-top:2px solid var(--line);border-bottom:2px solid var(--line);background:var(--accent);color:var(--accent-ink);overflow:hidden;padding:9px 0}
.ec .strip .track{display:flex;width:max-content;animation:ec-marquee 30s linear infinite}
.ec .strip span{font-family:var(--mono);font-size:11.5px;letter-spacing:.22em;text-transform:uppercase;padding-inline:22px;white-space:nowrap}

/* sections */
.ec section{padding:clamp(48px,8vh,104px) 0}
.ec .sec-label{display:flex;align-items:center;gap:14px;margin-bottom:clamp(20px,3.5vw,36px)}
.ec .sec-label .num{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--accent)}
.ec .sec-label h2{font-size:clamp(1.6rem,5vw,3rem);font-weight:800;letter-spacing:-.05em;text-transform:uppercase;line-height:1}
.ec .sec-label .bar{flex:1;height:2px;background:var(--line);transform-origin:left;animation:ec-wipe 1.1s cubic-bezier(.16,.84,.28,1) both}

.ec .about-grid{display:grid;gap:clamp(20px,3.5vw,48px);grid-template-columns:1fr}
@media (min-width:860px){.ec .about-grid{grid-template-columns:.34fr 1fr}}
.ec .about-grid .lead{font-size:clamp(1.15rem,2.6vw,1.9rem);line-height:1.45;letter-spacing:-.035em;font-weight:600}
.ec .about-grid .lead b{color:var(--accent);font-weight:800}
.ec .about-grid .note{margin-top:18px;color:var(--ink-2);font-size:15px;max-width:56ch;line-height:1.8}
.ec .meta{display:grid;gap:0;align-content:start;border-top:1px solid var(--line-soft)}
.ec .meta div{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid var(--line-soft)}
.ec .meta dt{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.ec .meta dd{font-size:13.5px;font-weight:600;text-align:right}

/* product index */
.ec .index{border-top:2px solid var(--line)}
.ec .row{
  display:grid;grid-template-columns:auto 1fr;gap:4px 16px;align-items:baseline;
  padding:clamp(18px,3vw,28px) 0;border-bottom:1px solid var(--line-soft);
  position:relative;transition:padding-inline .35s cubic-bezier(.16,.84,.28,1);
}
@media (min-width:820px){
  .ec .row{grid-template-columns:88px minmax(0,1.1fr) minmax(0,1.25fr) auto;gap:24px;align-items:center}
}
.ec .row::before{
  content:"";position:absolute;inset:0;background:var(--accent);z-index:-1;
  transform:scaleY(0);transform-origin:bottom;transition:transform .4s cubic-bezier(.16,.84,.28,1);
}
.ec .row:hover::before{transform:scaleY(1)}
.ec .row:hover{padding-inline:clamp(10px,2vw,22px)}
.ec .row:hover .num,.ec .row:hover .name,.ec .row:hover .desc,.ec .row:hover .st{color:var(--accent-ink)}
.ec .row:hover .st{border-color:var(--accent-ink)}
.ec .row>*{transition:color .3s ease,border-color .3s ease}
.ec .row .num{font-family:var(--mono);font-size:11px;letter-spacing:.14em;color:var(--ink-3)}
.ec .row .name{
  font-size:clamp(1.45rem,4.6vw,2.5rem);font-weight:800;letter-spacing:-.045em;line-height:1.06;
}
.ec .row .name .live{
  display:inline-block;vertical-align:middle;margin-left:10px;
  font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--accent-ink);background:var(--accent);padding:3px 8px;border-radius:2px;
}
.ec .row:hover .name .live{background:var(--accent-ink);color:var(--accent)}
.ec .row .desc{color:var(--ink-2);font-size:14.5px;line-height:1.6;grid-column:1/-1}
@media (min-width:820px){.ec .row .desc{grid-column:auto}}
.ec .row .links{display:flex;flex-wrap:wrap;gap:8px;grid-column:1/-1;margin-top:6px}
@media (min-width:820px){.ec .row .links{grid-column:auto;margin-top:0;justify-content:flex-end}}
.ec .st{
  display:inline-flex;align-items:center;gap:6px;text-decoration:none;
  font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  border:1.5px solid var(--line);border-radius:2px;padding:6px 10px;white-space:nowrap;
}
.ec .st svg{width:12px;height:12px;flex:none}
.ec .st:hover{background:var(--line);color:var(--paper)}
.ec .row:hover .st:hover{background:var(--accent-ink);color:var(--accent)}

/* contact */
.ec .contact-inner{border-top:2px solid var(--line);border-bottom:2px solid var(--line);padding:clamp(32px,6vw,64px) 0}
.ec .contact-inner .mono{display:block;margin-bottom:16px;font-family:var(--sans);font-size:13px;letter-spacing:.02em;text-transform:none}
.ec .mail{
  display:block;text-decoration:none;font-weight:800;letter-spacing:-.05em;line-height:1.05;
  font-size:clamp(1.55rem,7.2vw,4.6rem);word-break:break-word;
  transition:color .3s ease;
}
.ec .mail:hover{color:var(--accent)}
.ec .contact-inner p{margin-top:20px;color:var(--ink-2);font-size:15px;max-width:46ch}

/* footer */
.ec .site-foot{padding:26px 0 44px}
.ec .site-foot .wrap{display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between;align-items:center}
.ec .site-foot p{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
`;

const APP_STORE_PATH =
  'M16.4 12.8c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.5-.2-2.8.8-3.6.8-.7 0-1.9-.8-3.1-.8-1.6 0-3 .9-3.8 2.4-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3.1-.7 1.4 0 1.8.7 3.1.7 1.3 0 2.1-1.1 2.8-2.2.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.9zM14 5.9c.6-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.8-1.5z';

const PLAY_STORE_PATH =
  'M3.6 2.3c-.3.3-.5.8-.5 1.4v16.6c0 .6.2 1.1.5 1.4l.1.1 9.3-9.3v-.2L3.6 2.3zM17 15.5l-3.1-3.1v-.2L17 9.1l.1.1 3.7 2.1c1 .6 1 1.6 0 2.2L17 15.5zM16.4 16.1L13.2 12.9 3.8 22.3c.4.4 1 .4 1.7.1l10.9-6.3zM16.4 7.9L5.5 1.6C4.8 1.3 4.2 1.3 3.8 1.7l9.4 9.4 3.2-3.2z';

const MARQUEE_ITEMS = ['비수다', 'HAE:ON', '오큐가이드', '한자한입', '라틴토이', '원서한장'];

export default function HomePage() {
  return (
    <div className="ec">
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <header className="site-head">
        <div className="wrap">
          <a className="brand" href="#top">
            Entangle<em>care</em>
          </a>
          <nav className="nav" aria-label="주요 메뉴">
            <a href="#about">About</a>
            <a href="#products">Products</a>
            <a href="#contact">Contact</a>
          </nav>
        </div>
      </header>

      <main id="top">
        {/* HERO */}
        <div className="hero">
          <div className="wrap">
            <div className="hero-top up d1">
              <span className="mono">Independent software studio</span>
              <span className="mono">Education × Healthcare — Est. Seoul</span>
            </div>
            <div className="display up d2">
              <span className="l1">Entangle</span>
              <span className="l2">
                care<span className="sm">®</span>
              </span>
            </div>
            <div className="tagline">
              <h1 className="up d3">
                배움과 <mark>돌봄</mark>을
                <br />
                소프트웨어로 엮습니다.
              </h1>
              <div className="side up d4">
                <span className="mono">Statement</span>
                엔탱글케어는 교육과 헬스케어 사이의 문제를 모바일 앱으로 풀어냅니다. 기획부터 개발,
                운영까지 한 사람의 손에서 시작하고 끝냅니다.
              </div>
            </div>
          </div>
          <div className="strip" aria-hidden="true">
            <div className="track">
              {/* Duplicated once: the marquee translates by -50%, so the second
                  copy seamlessly takes over when the first scrolls out. */}
              {[0, 1].map((copy) =>
                MARQUEE_ITEMS.map((item) => (
                  <Fragment key={`${copy}-${item}`}>
                    <span>{item}</span>
                    <span>·</span>
                  </Fragment>
                )),
              )}
            </div>
          </div>
        </div>

        {/* ABOUT */}
        <section id="about">
          <div className="wrap">
            <div className="sec-label">
              <span className="num">01</span>
              <h2>About</h2>
              <span className="bar" />
            </div>
            <div className="about-grid">
              <dl className="meta">
                <div>
                  <dt>Company</dt>
                  <dd>Entanglecare</dd>
                </div>
                <div>
                  <dt>Team</dt>
                  <dd>1인 스튜디오</dd>
                </div>
                <div>
                  <dt>Products</dt>
                  <dd>모바일 앱 6종</dd>
                </div>
                <div>
                  <dt>Platform</dt>
                  <dd>iOS · Android</dd>
                </div>
                <div>
                  <dt>Web</dt>
                  <dd>entanglecare.com</dd>
                </div>
              </dl>
              <div>
                <p className="lead">
                  교육·헬스케어 분야의 모바일 앱을 직접 기획·개발·운영하는{' '}
                  <b>1인 소프트웨어 스튜디오</b>입니다.
                </p>
                <p className="note">
                  수능 국어 학습부터 의료 이용 안내까지, 사람이 반복해서 겪는 불편을 관찰하고 가장
                  단순한 형태의 소프트웨어로 옮깁니다. 외주 없이 스스로 만들기에 결정은 빠르고,
                  사용자 피드백은 곧바로 다음 버전에 반영됩니다.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* PRODUCTS */}
        <section id="products">
          <div className="wrap">
            <div className="sec-label">
              <span className="num">02</span>
              <h2>Products</h2>
              <span className="bar" />
            </div>
            <ul className="index">
              <li className="row">
                <span className="num">P—01</span>
                <span className="name">
                  비수다<span className="live">Live</span>
                </span>
                <span className="desc">
                  수능 국어 비문학 기출을 3회독 구조로 반복 훈련하는 학습 앱.
                </span>
                <span className="links">
                  <a
                    className="st"
                    href="https://apps.apple.com/app/id6795456254"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d={APP_STORE_PATH} />
                    </svg>
                    App Store
                  </a>
                  <a
                    className="st"
                    href="https://play.google.com/store/apps/details?id=com.dagger.bisuda"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d={PLAY_STORE_PATH} />
                    </svg>
                    Google Play
                  </a>
                </span>
              </li>

              <li className="row">
                <span className="num">P—02</span>
                <span className="name">HAE:ON</span>
                <span className="desc">교육 현장의 소통을 돕는 커뮤니케이션 앱.</span>
              </li>

              <li className="row">
                <span className="num">P—03</span>
                <span className="name">오큐가이드 with 세브란스</span>
                <span className="desc">의료 이용 과정을 단계별로 안내하는 환자용 가이드 앱.</span>
              </li>

              <li className="row">
                <span className="num">P—04</span>
                <span className="name">한자한입</span>
                <span className="desc">하루 한 입 분량으로 익히는 한자 학습 앱.</span>
              </li>

              <li className="row">
                <span className="num">P—05</span>
                <span className="name">라틴토이</span>
                <span className="desc">놀이하듯 접근하는 라틴어 입문 학습 앱.</span>
              </li>

              <li className="row">
                <span className="num">P—06</span>
                <span className="name">원서한장</span>
                <span className="desc">하루 한 장씩 이어가는 원서 읽기 학습 앱.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* CONTACT */}
        <section id="contact">
          <div className="wrap">
            <div className="sec-label">
              <span className="num">03</span>
              <h2>Contact</h2>
              <span className="bar" />
            </div>
            <div className="contact-inner">
              <span className="mono">함께 만들 것이 있다면</span>
              <a className="mail" href="mailto:entanglecare@gmail.com">
                entanglecare@gmail.com
              </a>
              <p>제품 문의, 제휴, 기술 협업 모두 이메일로 받고 있습니다.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-foot">
        <div className="wrap">
          <p>© 2026 Entanglecare. All rights reserved.</p>
          <p>entanglecare.com</p>
        </div>
      </footer>
    </div>
  );
}
