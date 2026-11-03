import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { digest, type State, type Transfer } from '../src/domain';
import './style.css';
import { remoteApi, downloadEvidence, ApiError, SESSION_KEY } from './remote-api';
import { commitPending, loadPending, PENDING_KEY, PENDING_PREFIX, type PendingRequest } from './action-journal';
import { loadWorkspace, restartExpiredReview, CURRENT_KEY, type SessionInfo, type WorkspaceSnapshot } from './workspace';
import { IntakePanel } from './intake-panel';
import type { DrillSummary } from '../cloudflare/store';
const icon = (name: string) =>
  ({ overview: '◫', plan: '≋', transfers: '⇄', evidence: '▤' })[name] || '·';
const api = remoteApi;
function App() {
  const [s, setS] = useState<State | null>(null),
    [tab, setTab] = useState('overview'),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState(''),
    [notice, setNotice] = useState(''),
    [kind, setKind] = useState('outage'),
    [seed, setSeed] = useState(7),
    [checked, setChecked] = useState(false),
    [counts, setCounts] = useState<Record<string, number>>({ 'leaf-01': 6, 'fruit-02': 6 }),
    [draft, setDraft] = useState<Transfer[] | null>(null),
    [pending, setPending] = useState<PendingRequest | null>(null),
    [menu, setMenu] = useState(false),
    [connection, setConnection] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading'),
    [session, setSession] = useState<SessionInfo | null>(null),
    [drills, setDrills] = useState<DrillSummary[]>([]),
    [intakeRevision, setIntakeRevision] = useState(0),
    [intakeRef, setIntakeRef] = useState<{ id: string; digest: string } | null>(null),
    [sourceNotes, setSourceNotes] = useState('');
  const expiredToken = useRef<string | null>(null);
  const blocked = busy || connection !== 'ready';
  const running = useRef(false);
  const applyWorkspace = (snapshot: WorkspaceSnapshot) => {
    setSession(snapshot.session);
    setDrills(snapshot.drills);
    setS(snapshot.incident);
    setPending(loadPending(localStorage));
    setDraft(null);
    setChecked(false);
    setIntakeRef(null);
    setConnection('ready');
    expiredToken.current = null;
  };
  const reportError = (error: unknown) => {
    setErr(String(error));
    if (error instanceof ApiError && error.code === 'SESSION_EXPIRED') {
      setConnection('expired');
      expiredToken.current = localStorage.getItem(SESSION_KEY);
    } else if (error instanceof ApiError && error.status === 401) {
      setConnection('error');
    }
  };
  const connect = async () => {
    setConnection('loading');
    setErr('');
    try {
      setPending(loadPending(localStorage));
      applyWorkspace(await loadWorkspace(api, localStorage));
    } catch (error) {
      setConnection('error');
      reportError(error);
    }
  };
  useEffect(() => {
    void connect();
    const syncPending = (event: StorageEvent) => {
      if (event.key === PENDING_KEY || event.key?.startsWith(PENDING_PREFIX)) setPending(loadPending(localStorage));
      if (event.key === SESSION_KEY || event.key === null) {
        setConnection('error');
        setS(null);
        setDrills([]);
        setSession(null);
        setErr('The review session changed in another tab. Refresh the workspace before continuing.');
      }
    };
    window.addEventListener('storage', syncPending);
    return () => window.removeEventListener('storage', syncPending);
  }, []);
  const refresh = async (id = s?.id) => {
    if (id) {
      const x = await api('/incidents/' + id);
      setS(x);
      localStorage.setItem(CURRENT_KEY, id);
      setDrills(await api('/drills'));
    }
  };
  const run = async (fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setErr('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      reportError(e);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const act = async (action: string, payload: any = {}, ref?: string) => {
    if (!s) return;
    if (connection !== 'ready') throw new Error('Connect to the review workspace before making changes.');
    if (loadPending(localStorage)) throw new Error('Recover the pending receipt before another action.');
    const route =
      action === 'approve' || action === 'reserve'
        ? `/plans/${ref}/${action}`
        : ['dispatch', 'report', 'arrival', 'cancel'].includes(action)
          ? `/work-orders/${ref}/${action === 'report' ? 'arrival-report' : action}`
          : `/incidents/${s.id}/${({ intake: 'intake', facts: 'facts', observe: 'observations', clock: 'clock', plan: 'plans', reconcile: 'reconcile' } as any)[action]}`;
    const { actionId } = await api(`/incidents/${s.id}/actions`, { kind: action });
    const request = {
      route,
      body: { actionId, expectedVersion: s.version, incidentId: s.id, payload },
    };
    setPending(request);
    try {
      const out = await commitPending(api, localStorage, request);
      setNotice(`Committed ${action.replaceAll('_', ' ')} · receipt ${out.actionId.slice(0, 8)}`);
      if (action === 'intake') setIntakeRevision(value => value + 1);
      return out;
    } finally {
      setPending(loadPending(localStorage));
      await refresh();
    }
  };
  const newDrill = () =>
    run(async () => {
      if (connection !== 'ready') throw new Error('Connect to the review workspace before starting a drill.');
      if (loadPending(localStorage)) throw new Error('Recover the pending receipt before starting another drill.');
      const x = await api('/incidents', { scenario: kind, seed, ...(sourceNotes.trim() ? { sourceNotes } : {}) });
      setS(x);
      localStorage.setItem(CURRENT_KEY, x.id);
      setDrills(await api('/drills'));
      setDraft(null);
      setChecked(false);
    setIntakeRef(null);
      setTab('overview');
      setNotice('New isolated drill created. All stock and readings are synthetic.');
    });
  const plan = s?.plans.at(-1);
  const total = s?.batches.reduce((n, b) => n + b.quantity, 0) || 0;
  const transit =
    s?.batches.reduce(
      (n, b) =>
        n +
        Object.entries(b.locations)
          .filter(([l]) => l.startsWith('transit:'))
          .reduce((a, [, q]) => a + q, 0),
      0,
    ) || 0;
  const delivered =
    s?.batches.reduce(
      (n, b) =>
        n +
        Object.entries(b.locations)
          .filter(([l]) => l !== b.origin && !l.startsWith('transit:'))
          .reduce((a, [, q]) => a + q, 0),
      0,
    ) || 0;
  const occ = (rid: string) =>
    s!.rooms.find((r) => r.id === rid)!.background +
    s!.batches.reduce((n, b) => n + (b.locations[rid] || 0) * b.slotsPerUnit, 0);
  const held = (rid: string) =>
    s!.work
      .filter(
        (w) =>
          w.transfer.destination === rid &&
          ['RESERVED', 'DISPATCHED', 'ARRIVAL_REPORTED'].includes(w.state),
      )
      .reduce(
        (n, w) =>
          n + w.transfer.quantity * s!.batches.find((b) => b.id === w.transfer.batch)!.slotsPerUnit,
        0,
      );
  return (
    <div className="app">
      <aside className={menu ? 'sidebar open' : 'sidebar'}>
        <a className="brand" href="/">
          <span className="brand-symbol">
            c<span>↗</span>
          </span>
          coldspan<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">OPERATIONS WORKSPACE</div>
        <nav aria-label="Workspace">
          {['overview', 'plan', 'transfers', 'evidence'].map((t) => (
            <button
              key={t}
              className={tab === t ? 'nav active' : 'nav'}
              onClick={() => {
                setTab(t);
                setMenu(false);
              }}
            >
              <span>{icon(t)}</span>
              {t === 'plan'
                ? 'Recovery plan'
                : t === 'transfers'
                  ? 'Transfer board'
                  : t[0].toUpperCase() + t.slice(1)}
              {t === 'transfers' && s && <i>{s.work.length}</i>}
            </button>
          ))}
        </nav>
        <div className="side-note">
          <span className="pulse" /> SIMULATOR MODE<p>A safe place to rehearse a difficult day.</p>
          <small>
            Synthetic stock. Synthetic readings.
            <br />
            No real transport is dispatched.
          </small>
        </div>
        <div className="profile">
          <span>CS</span>
          <div>
            Review workspace<small>Cloudflare-backed review</small>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            ☰
          </button>
          <div>
            Workspace <span>/</span> Incident recovery
          </div>
          <div className="header-right">
            <span className="pill">MODEL UNAVAILABLE</span>
            <span className="avatar">OP</span>
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">COLD CHAIN RECOVERY · CLOUDFLARE WORKSPACE</div>
              <h1>
                {tab === 'overview'
                  ? 'Keep the chain together.'
                  : tab === 'plan'
                    ? 'A plan you can account for.'
                    : tab === 'transfers'
                      ? 'Every crate, every handoff.'
                      : 'The ledger is open to scrutiny.'}
              </h1>
              <p>
                {tab === 'overview'
                  ? 'Turn a cold-room outage into a controlled, traceable recovery drill.'
                  : tab === 'plan'
                    ? 'Review exact quantities and destinations before approving this revision.'
                    : tab === 'transfers'
                      ? 'Reservations hold space. Simulator observations confirm arrivals.'
                      : 'Export the initial state and event history for independent replay.'}
              </p>
            </div>
            <button
              className="outline"
              onClick={() =>
                document.getElementById('drill')?.scrollIntoView({
                  behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'auto'
                    : 'smooth',
                })
              }
            >
              ＋ New drill
            </button>
          </div>
          <div className="simulation-strip">
            <span className="tiny-circle" /> SYNTHETIC DRILL{' '}
            <span>Synthetic drill. State and retry receipts are saved on Cloudflare for seven days.</span>
            <span className="strip-end">PREVIEW · MODEL UNAVAILABLE</span>
          </div>
          <section className="workspace-tools" aria-label="Saved workspace">
            <div role="status">
              <strong>{connection === 'ready' ? 'Cloudflare connected' : connection === 'loading' ? 'Connecting to your review…' : connection === 'expired' ? 'Review expired' : 'Connection needs attention'}</strong>
              <small>{session && connection === 'ready' ? 'Access expires ' + new Date(session.expiresAt).toLocaleString() : 'Each review keeps its own synthetic drills for seven days.'}</small>
            </div>
            <label>
              Saved drill
              <select value={s?.id ?? ''} disabled={blocked || !drills.length} onChange={event => void run(async () => {
                await refresh(event.target.value);
                setDraft(null);
                setChecked(false);
    setIntakeRef(null);
                setTab('overview');
              })}>
                {!drills.length && <option value="">No saved drills yet</option>}
                {drills.map(drill => <option key={drill.id} value={drill.id}>{drill.scenario.replaceAll('-', ' ')} · {drill.status.replaceAll('_', ' ')} · seed {drill.seed} · {drill.id.slice(0, 8)}</option>)}
              </select>
            </label>
            <button className="outline" disabled={busy} onClick={() => void run(connect)}>Refresh workspace</button>
          </section>
          {connection === 'expired' && <div className="alert" role="alert">
            This review has expired. Starting another review creates a separate workspace. Any unresolved action identities are retained in this browser as expired-review records. Expired cloud data cannot be recovered here.
            <button disabled={busy} onClick={() => void run(async () => {
              const token = expiredToken.current;
              if (!token) throw new Error('Refresh the workspace before starting another review.');
              applyWorkspace(await restartExpiredReview(api, localStorage, token));
              setNotice('New isolated review opened. Previous unresolved identities were retained locally.');
            })}>Start a new review</button>
          </div>}
          {err && (
            <div className="alert error" role="alert">
              {err}
              <button onClick={() => run(connect)} disabled={busy}>
                Retry connection / refresh workspace
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
            </div>
          )}
          {pending && (
            <div className="alert">
              An action receipt is unresolved. Retry its original identity before continuing.
              <button
                disabled={blocked}
                onClick={() =>
                  run(async () => {
                    try {
                      const result = await commitPending(api, localStorage, pending);
                      if (pending.route.endsWith('/intake')) setIntakeRevision(value => value + 1);
                      setNotice('Original receipt recovered: ' + result.actionId);
                    } finally {
                      setPending(loadPending(localStorage));
                      await refresh(pending.body.incidentId);
                    }
                  })
                }
              >
                Recover receipt
              </button>
            </div>
          )}
          {!s ? (
            <section className="welcome">
              <span className="large-mark">↗</span>
              <h2>Rehearse the moment the cooling stops.</h2>
              <p>
                Open an outage drill with 12 crates, three rooms, two responders and two simulated
                vans. Nothing moves until you approve it.
              </p>
              <button className="primary" onClick={newDrill} disabled={blocked}>
                {connection === 'loading' ? 'Connecting…' : 'Start your first drill →'}
              </button>
            </section>
          ) : (
            <>
              <section className="incident-band">
                <div className="incident-id">
                  DRILL / {s.id.slice(0, 8).toUpperCase()}
                  <h2>
                    {s.scenario === 'healthy'
                      ? 'Healthy control drill'
                      : 'North room cooling failure'}
                  </h2>
                  <div className="muted">
                    Seed {s.seed} <span>·</span> Revision {s.version} <span>·</span>{' '}
                    {s.batches.length} tracked batches
                  </div>
                </div>
                <div className="incident-status">
                  <span className={s.status === 'RECONCILED' ? 'status good' : 'status'}>
                    {s.status.replaceAll('_', ' ')}
                  </span>
                  <div className="clock">
                    T + {String(s.clock).padStart(2, '0')}
                    <small>SIMULATED MINUTES</small>
                  </div>
                  <button
                    className="text-button"
                    disabled={blocked || s.status === 'RECONCILED'}
                    onClick={() => run(() => act('clock', { minutes: 5 }))}
                  >
                    Advance 5 min ↗
                  </button>
                </div>
              </section>
              <div className="steps">
                {[
                  'Review facts',
                  'Approve plan',
                  'Reserve space',
                  'Move & confirm',
                  'Reconcile',
                ].map((t, i) => (
                  <div
                    key={t}
                    className={
                      (i === 0 && !s.uncertain) ||
                      (i === 1 && plan?.approved) ||
                      (i === 2 && s.work.length) ||
                      (i === 3 &&
                        s.work.length > 0 &&
                        s.work.every((w) => w.state === 'ARRIVAL_CONFIRMED')) ||
                      (i === 4 && s.status === 'RECONCILED')
                        ? 'step done'
                        : 'step'
                    }
                  >
                    <span>{i + 1}</span>
                    {t}
                  </div>
                ))}
              </div>
              {tab === 'overview' && (
                <>
                  <div className="stats">
                    <div>
                      <span>TRACKED INVENTORY</span>
                      <strong>
                        {total}
                        <small>crates</small>
                      </strong>
                      <p>Integer units, fully accounted</p>
                    </div>
                    <div>
                      <span>IN TRANSIT</span>
                      <strong>
                        {transit}
                        <small>crates</small>
                      </strong>
                      <p>Custody remains recorded</p>
                    </div>
                    <div>
                      <span>AT RECOVERY ROOMS</span>
                      <strong>
                        {delivered}
                        <small>crates</small>
                      </strong>
                      <p>Confirmed by the simulator</p>
                    </div>
                    <div>
                      <span>OBSERVATION HEALTH</span>
                      <strong>
                        {
                          s.rooms.filter((r) => s.clock - r.observation.at <= r.observation.ttl)
                            .length
                        }
                        <small>/ 3 fresh</small>
                      </strong>
                      <p>30-minute freshness window</p>
                    </div>
                  </div>
                  <div className="section-title">
                    <h2>Room readiness</h2>
                    <span>CAPACITY IN NORMALIZED SLOTS</span>
                  </div>
                  <div className="room-grid">
                    {s.rooms.map((r, i) => (
                      <article
                        className={'room-card ' + (!r.observation.healthy ? 'room-failed' : '')}
                        key={r.id}
                      >
                        <div className="room-head">
                          <span className="room-icon">{i === 0 ? '▥' : '▦'}</span>
                          <span
                            className={r.observation.healthy ? 'room-label' : 'room-label warn'}
                          >
                            {r.observation.healthy ? 'AVAILABLE' : 'COOLING FAILED'}
                          </span>
                        </div>
                        <h3>{r.name}</h3>
                        <div className="temperature">
                          {(r.observation.temp / 10).toFixed(1)}
                          <small>°C</small>
                          <span>SYNTHETIC</span>
                        </div>
                        <div className="capacity-label">
                          <span>
                            {occ(r.id)} occupied · {held(r.id)} held
                          </span>
                          <strong>{r.capacity} slots</strong>
                        </div>
                        <div className="bar">
                          <span style={{ width: `${(occ(r.id) / r.capacity) * 100}%` }} />
                          <i style={{ width: `${(held(r.id) / r.capacity) * 100}%` }} />
                        </div>
                        <div className="reading">
                          <span
                            className={
                              s.clock - r.observation.at > r.observation.ttl ? 'stale' : ''
                            }
                          >
                            {s.clock - r.observation.at > r.observation.ttl ? 'STALE' : 'FRESH'} ·{' '}
                            {s.clock - r.observation.at} min ago
                          </span>
                          <span>{r.classes.join(' / ') || 'No compatibility'}</span>
                        </div>
                        <div className="room-actions">
                          <button
                            disabled={blocked || s.status === 'RECONCILED'}
                            onClick={() =>
                              run(() =>
                                act('observe', {
                                  room: r.id,
                                  temp: r.observation.temp,
                                  healthy: r.observation.healthy,
                                }),
                              )
                            }
                          >
                            Refresh reading
                          </button>
                          {i > 0 && (
                            <button
                              disabled={blocked || s.status === 'RECONCILED'}
                              onClick={() =>
                                run(() =>
                                  act('observe', {
                                    room: r.id,
                                    temp: r.observation.healthy ? 120 : 40,
                                    healthy: !r.observation.healthy,
                                  }),
                                )
                              }
                            >
                              {r.observation.healthy ? 'Inject warming' : 'Restore cooling'}
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  <IntakePanel state={s} blocked={blocked} revision={intakeRevision} onAnalyze={mode => void run(async () => { setIntakeRef(null); setChecked(false); await act('intake', { mode }); })} onApply={record => {
                    if (!record.review?.candidate || record.version !== s.version) return;
                    setCounts(Object.fromEntries(record.review.candidate.facts.map(fact => [fact.batchId, fact.quantity])));
                    setIntakeRef({ id: record.actionId, digest: digest(record.review.candidate) });
                    setChecked(false);
                    setNotice('Candidates copied for your review. Counts and uncertainty still need your confirmation.');
                  }} />
                  <div className="two-col">
                    <section className="panel">
                      <div className="panel-title">
                        <h2>Review the source facts</h2>
                        <span className={s.uncertain ? 'badge amber' : 'badge'}>
                          {s.uncertain ? 'NEEDS REVIEW' : 'CONFIRMED'}
                        </span>
                      </div>
                      <blockquote>{s.notes}</blockquote>
                      <p className="muted">
                        Manual confirmation gate. Check the source quotes and counts
                        before planning.
                      </p>
                      <div className="fact-fields">
                        {s.batches.map((b) => (
                          <label key={b.id}>
                            {b.name}
                            <div>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={counts[b.id]}
                                disabled={!s.uncertain}
                                onChange={(e) => { setCounts({ ...counts, [b.id]: Number(e.target.value) }); setIntakeRef(null); }}
                              />
                              <span>crates</span>
                            </div>
                          </label>
                        ))}
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={checked || !s.uncertain}
                          disabled={!s.uncertain}
                          onChange={(e) => setChecked(e.target.checked)}
                        />
                        I reviewed these synthetic source counts.
                      </label>
                      <button
                        className="primary"
                        disabled={blocked || !checked || !s.uncertain}
                        onClick={() =>
                          run(() => act('facts', { confirmed: true, quantities: counts, ...(intakeRef ? { intakeId: intakeRef.id, intakeDigest: intakeRef.digest } : {}) }))
                        }
                      >
                        {s.uncertain ? 'Confirm inventory →' : 'Facts confirmed'}
                      </button>
                    </section>
                    <section className="panel next-panel">
                      <span className="eyebrow">YOUR NEXT MOVE</span>
                      <h2>
                        {s.uncertain
                          ? 'Start with what you know.'
                          : s.status === 'RECONCILED'
                            ? 'Every quantity is reconciled.'
                            : 'Make a bounded recovery plan.'}
                      </h2>
                      <p>
                        {s.uncertain
                          ? 'A handwritten count can change an entire recovery. Resolve uncertainty before space is reserved.'
                          : 'A nearest-compatible-capacity rule proposes transfers. The kernel checks capacity, freshness and custody at execution.'}
                      </p>
                      <button
                        className="outline"
                        disabled={s.uncertain}
                        onClick={() => setTab(s.status === 'RECONCILED' ? 'evidence' : 'plan')}
                      >
                        {s.status === 'RECONCILED' ? 'Open evidence' : 'Review recovery plan'} →
                      </button>
                      <div className="source-note">
                        ✓ Human approval gates execution
                        <br />✓ Retry receipts persist on Cloudflare
                        <br />✓ Unknown custody blocks reconciliation
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === 'plan' && (
                <section className="panel">
                  <div className="panel-title">
                    <h2>Recovery plan {plan ? `/ revision ${plan.revision}` : ''}</h2>
                    <span className="badge">RULE-ONLY BASELINE</span>
                  </div>
                  <p className="muted">
                    A proposal does not reserve space. Editing creates a new revision that needs its
                    own approval.
                  </p>
                  <div className="action-row">
                    <button
                      className="primary"
                      disabled={blocked || s.uncertain || s.status === 'RECONCILED'}
                      onClick={() =>
                        run(async () => {
                          await act('plan', {});
                          setDraft(null);
                        })
                      }
                    >
                      Propose compatible transfers →
                    </button>
                    {plan && (
                      <button
                        className="outline"
                        onClick={() => setDraft(structuredClone(plan.transfers))}
                      >
                        Edit as new revision
                      </button>
                    )}
                  </div>
                  {plan && (
                    <>
                      <div className="digest">
                        PLAN DIGEST <code>{plan.digest}</code>
                      </div>
                      {plan.transfers.length === 0 ? (
                        <div className="empty">
                          <h3>No transfers proposed.</h3>
                          <p>
                            {s.scenario === 'healthy'
                              ? s.status === 'RECONCILED'
                                ? 'Healthy control reconciled. Zero stock moved.'
                                : 'The rooms are healthy. Complete the no-action control by reconciling.'
                              : 'No feasible moves were found, or stock is already held. Review room conditions, responders and capacity.'}
                          </p>
                        </div>
                      ) : (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Batch</th>
                                <th>Quantity</th>
                                <th>Destination</th>
                                <th>Responder / van</th>
                                <th>State</th>
                              </tr>
                            </thead>
                            <tbody>
                              {plan.transfers.map((t, i) => (
                                <tr key={i}>
                                  <td>
                                    {s.batches.find((b) => b.id === t.batch)?.name}
                                    <small>{t.batch}</small>
                                  </td>
                                  <td>{t.quantity} crates</td>
                                  <td>{s.rooms.find((r) => r.id === t.destination)?.name}</td>
                                  <td>
                                    {t.responder}
                                    <small>{t.vehicle}</small>
                                  </td>
                                  <td>
                                    <span className="badge">
                                      {plan.approved ? 'APPROVED' : 'PROPOSED'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className="action-row">
                        <button
                          className="primary"
                          disabled={blocked || plan.approved || s.status === 'RECONCILED'}
                          onClick={() =>
                            run(() => act('approve', { digest: plan.digest }, plan.id))
                          }
                        >
                          Approve exact revision
                        </button>
                        <button
                          className="outline"
                          disabled={
                            blocked ||
                            !plan.approved ||
                            s.status === 'RECONCILED' ||
                            s.work.some((w) => w.planId === plan.id && w.state !== 'CANCELLED')
                          }
                          onClick={() =>
                            run(async () => {
                              await act('reserve', { digest: plan.digest }, plan.id);
                              setTab('transfers');
                            })
                          }
                        >
                          Reserve destination space →
                        </button>
                        <button
                          className="text-button"
                          disabled={blocked || s.status === 'RECONCILED'}
                          onClick={() => run(() => act('reconcile'))}
                        >
                          Reconcile no-action drill
                        </button>
                      </div>
                    </>
                  )}
                  {draft && (
                    <div className="editor">
                      <h3>New plan revision</h3>
                      {draft.map((t, i) => (
                        <div className="edit-row" key={i}>
                          <span>{t.batch}</span>
                          <label>
                            Crates
                            <input
                              aria-label={`${t.batch} crates`}
                              type="number"
                              value={t.quantity}
                              onChange={(e) =>
                                setDraft(
                                  draft.map((x, n) =>
                                    n === i ? { ...x, quantity: Number(e.target.value) } : x,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label>
                            Destination
                            <select
                              value={t.destination}
                              onChange={(e) =>
                                setDraft(
                                  draft.map((x, n) =>
                                    n === i ? { ...x, destination: e.target.value } : x,
                                  ),
                                )
                              }
                            >
                              {s.rooms.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ))}
                      <button
                        className="primary"
                        disabled={blocked}
                        onClick={() =>
                          run(async () => {
                            await act('plan', { transfers: draft, replacesPlanId: plan?.id });
                            setDraft(null);
                          })
                        }
                      >
                        Create unapproved revision
                      </button>
                    </div>
                  )}
                </section>
              )}
              {tab === 'transfers' && (
                <>
                  <div className="section-title">
                    <h2>Transfer board</h2>
                    <span>{s.work.length} WORK ORDERS · SIMULATED CUSTODY</span>
                  </div>
                  {!s.work.length ? (
                    <div className="panel empty">
                      <h3>No space reserved yet.</h3>
                      <p>Approve a plan and reserve destination capacity first.</p>
                      <button className="primary" onClick={() => setTab('plan')}>
                        Open recovery plan
                      </button>
                    </div>
                  ) : (
                    <div className="work-grid">
                      {s.work.map((w) => (
                        <article className="panel work-card" key={w.id}>
                          <div className="panel-title">
                            <span className="eyebrow">{w.id.toUpperCase()}</span>
                            <span
                              className={w.state === 'ARRIVAL_CONFIRMED' ? 'badge' : 'badge amber'}
                            >
                              {w.state.replaceAll('_', ' ')}
                            </span>
                          </div>
                          <h3>{s.batches.find((b) => b.id === w.transfer.batch)?.name}</h3>
                          <div className="transfer-path">
                            <span>North room</span>
                            <span>→</span>
                            <strong>
                              {s.rooms.find((r) => r.id === w.transfer.destination)?.name}
                            </strong>
                          </div>
                          <div className="work-details">
                            <div>
                              <span>QUANTITY</span>
                              {w.transfer.quantity} crates
                            </div>
                            <div>
                              <span>RESPONDER</span>
                              {w.transfer.responder}
                            </div>
                            <div>
                              <span>VEHICLE</span>
                              {w.transfer.vehicle}
                            </div>
                            <div>
                              <span>HOLD EXPIRES</span>T + {w.expires} min
                            </div>
                          </div>
                          <div className="action-row">
                            {w.state === 'RESERVED' && (
                              <>
                                <button
                                  className="primary"
                                  disabled={blocked}
                                  onClick={() =>
                                    run(() => act('dispatch', { fence: w.fence }, w.id))
                                  }
                                >
                                  Dispatch simulation →
                                </button>
                                <button
                                  className="text-button"
                                  disabled={blocked}
                                  onClick={() => run(() => act('cancel', { fence: w.fence }, w.id))}
                                >
                                  Release hold
                                </button>
                              </>
                            )}
                            {w.state === 'DISPATCHED' && (
                              <button
                                className="primary"
                                disabled={blocked}
                                onClick={() =>
                                  run(() =>
                                    act(
                                      'report',
                                      { fence: w.fence, actor: w.transfer.responder },
                                      w.id,
                                    ),
                                  )
                                }
                              >
                                Report simulated arrival
                              </button>
                            )}
                            {w.state === 'ARRIVAL_REPORTED' && (
                              <button
                                className="primary"
                                disabled={blocked}
                                onClick={() => run(() => act('arrival', { fence: w.fence }, w.id))}
                              >
                                Check simulator & confirm →
                              </button>
                            )}
                            {w.state === 'ARRIVAL_CONFIRMED' && (
                              <span className="verified">✓ Simulator receipt recorded</span>
                            )}
                          </div>
                          {['DISPATCHED', 'ARRIVAL_REPORTED'].includes(w.state) && (
                            <p className="muted">
                              Advance the clock at least 5 minutes after departure. Destination must
                              remain fresh and healthy.
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                  <div className="panel reconcile-panel">
                    <div>
                      <h2>Close the loop.</h2>
                      <p>All work must be resolved and every crate in a healthy room.</p>
                    </div>
                    <button
                      className="primary"
                      disabled={blocked || s.status === 'RECONCILED'}
                      onClick={() => run(() => act('reconcile'))}
                    >
                      {s.status === 'RECONCILED' ? 'Reconciled ✓' : 'Reconcile inventory →'}
                    </button>
                  </div>
                </>
              )}
              {tab === 'evidence' && (
                <>
                  <div className="two-col">
                    <section className="panel">
                      <span className="eyebrow">VERSIONED EVIDENCE BUNDLE</span>
                      <h2>Make the result replayable.</h2>
                      <p>
                        Download the initial stock, ordered events, final state and SHA-256
                        manifest. The independent Python checker reconstructs custody and
                        reservations.
                      </p>
                      <a className="primary download" href="#evidence" onClick={e=>{e.preventDefault();void run(()=>downloadEvidence(s.id));}}>
                        Download evidence .json ↓
                      </a>
                      <pre>python3 verifier/check.py coldspan-evidence.json</pre>
                      <p className="muted">
                        Replay status is determined by the checker after download. This interface
                        does not claim an independent replay has run.
                      </p>
                    </section>
                    <section className="panel">
                      <h2>What this proves</h2>
                      <ul className="proof-list">
                        <li>Internal quantity and capacity consistency</li>
                        <li>Approval and ordered custody transitions</li>
                        <li>Tampering relative to the included manifest</li>
                      </ul>
                      <h3>Trust boundary</h3>
                      <p className="muted">
                        A rewritten bundle can have new hashes. There is no external signature or
                        proof of physical temperature, food safety, or avoided spoilage. Meta
                        integration is unavailable.
                      </p>
                    </section>
                  </div>
                  <section className="panel">
                    <div className="panel-title">
                      <h2>Custody & decision ledger</h2>
                      <span className="badge">{s.events.length} EVENTS</span>
                    </div>
                    <div className="ledger">
                      {s.events.length ? (
                        s.events.map((e) => (
                          <div className="ledger-row" key={e.seq}>
                            <span className="seq">{String(e.seq).padStart(2, '0')}</span>
                            <span>
                              <strong>{e.kind.replaceAll('_', ' ')}</strong>
                              <small>
                                Action {e.actionId.slice(0, 8)} · prior version {e.priorVersion}
                              </small>
                            </span>
                            <code>{e.hash.slice(0, 12)}</code>
                            <span>T + {e.at}</span>
                          </div>
                        ))
                      ) : (
                        <p className="muted">No committed events yet.</p>
                      )}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
          <section id="drill" className="drill-builder">
            <div>
              <h3>Start an isolated drill</h3>
              <p>Drills expire after seven days. This browser holds the access key. Clearing site data loses access.</p>
            </div>
            <label>
              Scenario
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {[
                  ['outage', 'Complete outage'],
                  ['healthy', 'Healthy, no-action control'],
                  ['last-slot', 'Last-slot capacity'],
                  ['stale', 'Stale readings'],
                  ['no-space', 'No free space'],
                  ['no-responder', 'Missing responder'],
                  ['incompatible', 'Incompatible stock'],
                  ['uncertain', 'Uncertain inventory'],
                ].map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Seed
              <input
                type="number"
                min="0"
                max="99999"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
              />
            </label>
            <label className="source-notes-field">Optional synthetic source notes
              <textarea rows={3} maxLength={4000} value={sourceNotes} onChange={event => setSourceNotes(event.target.value)} placeholder="Leave blank to use the scenario note." />
              <small>Fixture inventory stays at six crates of greens and six crates of tomatoes. Conflicting notes require review.</small>
            </label>
            <button className="outline" disabled={blocked} onClick={newDrill}>
              Create drill →
            </button>
          </section>
          <footer>
            <span className="footer-brand">coldspan.</span>
            <span>Recovery you can trace.</span>
            <span>Cloudflare-backed simulator · Meta unavailable · No physical validation</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
