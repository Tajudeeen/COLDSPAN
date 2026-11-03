import React, { useEffect, useRef } from 'react';

export const INTRO_SESSION_KEY = 'coldspan.intro.seen.v1';
export function ColdspanMark({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 96 96" fill="none" aria-hidden="true">
    <path d="M72 23a35 35 0 1 0 0 50" stroke="currentColor" strokeWidth="5" strokeLinecap="square" />
    <path d="M43 48h40M72 37l11 11-11 11" stroke="currentColor" strokeWidth="5" strokeLinejoin="miter" />
    <path d="M29 38h13v20H29z" fill="currentColor" opacity=".3" />
    <rect x="41" y="43" width="10" height="10" fill="#d3a269" />
  </svg>;
}
export function SplashScreen({ onDismiss }: { onDismiss: () => void }) {
  const enter = useRef<HTMLButtonElement>(null), skip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    enter.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onDismiss(); }
      if (event.key === 'Tab') {
        const target = document.activeElement === enter.current ? skip.current : enter.current;
        event.preventDefault(); target?.focus();
      }
    };
    document.addEventListener('keydown', keys);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keys); };
  }, [onDismiss]);
  return <section className="coldspan-splash" role="dialog" aria-modal="true" aria-labelledby="intro-title" aria-describedby="intro-description">
    <div className="intro-frame" aria-hidden="true" />
    <svg className="intro-grid" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><pattern id="intro-grid-pattern" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0v64" fill="none" stroke="currentColor" strokeWidth=".5" /></pattern></defs>
      <rect width="1200" height="800" fill="url(#intro-grid-pattern)" />
      <path className="intro-route" d="M-40 620h280V490h160M1240 180H950v130H790" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="236" y="616" width="8" height="8" fill="currentColor" /><rect x="946" y="176" width="8" height="8" fill="currentColor" />
    </svg>
    <header className="intro-top"><span>COLDSPAN <i>/</i> RECOVERY WORKSPACE</span><button ref={skip} onClick={onDismiss}>Skip intro <span aria-hidden="true">↗</span></button></header>
    <div className="intro-center">
      <div className="intro-wordmark"><ColdspanMark className="intro-mark" /><span>coldspan<span className="intro-dot">.</span></span></div>
      <div className="intro-eyebrow"><span /> A CLEARER PATH THROUGH AN OUTAGE</div>
      <h1 id="intro-title">Keep the chain<br /><em>together.</em></h1>
      <p id="intro-description">When the cooling stops, every decision counts.<br className="intro-desktop-break" /> Rehearse the recovery. Keep the record.</p>
      <div className="intro-sequence" aria-label="Review, approve, trace">
        <span><i>01</i> Review</span><b aria-hidden="true" /><span><i>02</i> Approve</span><b aria-hidden="true" /><span><i>03</i> Trace</span>
      </div>
      <button ref={enter} className="intro-enter" onClick={onDismiss}>Enter workspace <span aria-hidden="true">→</span></button>
    </div>
    <div className="intro-bottom"><span>HUMAN JUDGMENT. A TRACEABLE RECOVERY.</span><span>Synthetic drills. No real transport.</span></div>
  </section>;
}
export function WorkspaceFooter({ onNavigate, onReplay }: { onNavigate: (tab: string) => void; onReplay: () => void }) {
  return <footer className="workspace-footer">
    <div className="footer-main">
      <div className="footer-identity">
        <button className="footer-wordmark" onClick={() => onNavigate('overview')} aria-label="Coldspan overview"><ColdspanMark /><span>coldspan<span className="intro-dot">.</span></span></button>
        <h2>Recovery you can trace.</h2>
        <p>Review the facts. Approve the plan.<br />Follow every handoff.</p>
        <span className="footer-signature" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></span>
      </div>
      <nav className="footer-nav" aria-label="Footer workspace navigation">
        <h3>THE WORKSPACE</h3>
        <button onClick={() => onNavigate('overview')}>Incident overview</button>
        <button onClick={() => onNavigate('plan')}>Recovery plan</button>
        <button onClick={() => onNavigate('transfers')}>Transfer board</button>
        <button onClick={() => onNavigate('evidence')}>Evidence &amp; receipts</button>
      </nav>
      <nav className="footer-nav" aria-label="Project resources">
        <h3>BEHIND THE WORK</h3>
        <a href="https://github.com/Tajudeeen/COLDSPAN" target="_blank" rel="noopener noreferrer">Source code <span aria-hidden="true">↗</span></a>
        <a href="https://github.com/Tajudeeen/COLDSPAN#review-the-workflow" target="_blank" rel="noopener noreferrer">Review guide <span aria-hidden="true">↗</span></a>
        <button onClick={onReplay}>Replay introduction <span aria-hidden="true">↺</span></button>
      </nav>
    </div>
    <div className="footer-bottom"><span className="footer-mode"><i aria-hidden="true" /> SYNTHETIC SIMULATOR</span><span>No real transport. Every movement needs approval.</span><span>© 2026 Coldspan <i aria-hidden="true">/</i> Built by <a href="https://github.com/Tajudeeen" target="_blank" rel="noopener noreferrer">Deeen_Code</a></span></div>
  </footer>;
}
